/**
 * @fileoverview 起動ベンチマーク用にExtension Host内で実行される計測スクリプト。
 * 実行境界: @vscode/test-electron が起動した実VS CodeのExtension Host（scripts/benchmark-vscode-startup.mjs から起動）。
 * 入力: 環境変数 MVE_STARTUP_FILE（計測文書）、MVE_STARTUP_RESULT（結果JSONの出力先）、各種 MVE_STARTUP_WAIT_* フラグ。
 * 出力: 結果JSON。トップレベルは初回オープン（cold）の計測値で、旧形式と互換。warm プロパティに同一プロセスでの再オープン計測値を持つ。
 * 副作用: 文書を開閉し、最後にVS Codeを終了する。計測値は拡張機能の起動計測コマンド（MVE_STARTUP_BENCHMARK=1 時のみ登録）から取得する。
 */
/**
 * 起動計測の期待値を検証するNode.jsの厳密なアサーション関数。
 */
const assert = require('node:assert/strict');
/**
 * Extension Hostから提供されるVS Code API。
 */
const vscode = require('vscode');

/**
 * 計測待機の上限。初回のMermaidはブラウザー起動を含むため長めに取る。
 */
const TIMING_DEADLINE_MS = 30_000;

/**
 * 初回オープン（cold）と同一プロセスでの再オープン（warm）を順に計測し、結果JSONを書き出してVS Codeを終了する。
 * @returns 計測と後始末が終わると解決するPromise。必須タイミングが30秒以内に揃わない場合は失敗する。
 */
async function run() {
  const filePath = process.env.MVE_STARTUP_FILE;
  const resultPath = process.env.MVE_STARTUP_RESULT;
  const expectations = {
    mermaid: process.env.MVE_STARTUP_WAIT_FOR_MERMAID === '1',
    preview: process.env.MVE_STARTUP_WAIT_FOR_PREVIEW !== '0',
    rich: process.env.MVE_STARTUP_WAIT_FOR_RICH === '1',
    visibleMermaid: process.env.MVE_STARTUP_WAIT_FOR_VISIBLE_MERMAID === '1'
  };
  const measureWarm = process.env.MVE_STARTUP_MEASURE_WARM !== '0';
  assert.ok(filePath, 'MVE_STARTUP_FILE is required.');
  assert.ok(resultPath, 'MVE_STARTUP_RESULT is required.');
  await persist(resultPath, { stage: 'loaded', file: filePath });
  const uri = vscode.Uri.file(filePath);
  const cold = await measureOpen(uri, resultPath, filePath, expectations, 0);
  const result = { ...cold, vscodeVersion: vscode.version };
  if (measureWarm) {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    result.warm = await measureOpen(uri, resultPath, filePath, expectations, cold.resolveSequence);
  }
  await persist(resultPath, result);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await vscode.commands.executeCommand('workbench.action.quit');
}

/**
 * 文書をビジュアルエディターで開き、必須タイミングが揃うまで待って計測値を返す。
 * @param uri - 計測対象のMarkdown文書URI。
 * @param resultPath - 途中経過を書き出すJSONファイルのパス。
 * @param filePath - 計測結果に記録する文書パス。
 * @param expectations - 待機対象にする計測項目のフラグ。
 * @param previousSequence - 直前の計測で得た resolveSequence。これ以下の計測値は古いものとして無視する。
 * @returns エディターを開くまでの時間、全体時間、拡張機能が記録した各計測値。
 */
async function measureOpen(uri, resultPath, filePath, expectations, previousSequence) {
  const startedAt = Date.now();
  await vscode.workspace.openTextDocument(uri);
  await persist(resultPath, { stage: 'document-opened', file: filePath, elapsedMs: Date.now() - startedAt });
  await vscode.commands.executeCommand(
    'vscode.openWith',
    uri,
    'markdownEasyVisualEditor.editor'
  );
  const editorOpenedMs = Date.now() - startedAt;
  await persist(resultPath, { stage: 'editor-opened', file: filePath, editorOpenedMs });
  const timing = await waitForTiming(uri, resultPath, filePath, editorOpenedMs, expectations, previousSequence);
  return {
    file: filePath,
    editorOpenedMs,
    endToEndMs: Date.now() - startedAt,
    ...timing
  };
}

/**
 * 起動計測コマンドが必須のタイミングを返すまで、途中経過を書き出しながら50ms間隔で待機する。
 * 計測値自体はHostがメッセージ受信時刻で記録するため、ポーリング間隔は endToEndMs 以外に影響しない。
 * @param uri - 計測対象のMarkdown文書URI。
 * @param resultPath - 途中経過を書き出すJSONファイルのパス。
 * @param filePath - 途中経過に記録する文書パス。
 * @param editorOpenedMs - エディターが開くまでに経過したミリ秒数。
 * @param expectations - 待機対象にする計測項目のフラグ。
 * @param previousSequence - これ以下の resolveSequence を持つ計測値は前回オープンのものとして無視する。
 * @returns 初期化、プレビュー、必要に応じてMermaid・最終描画の計測値。
 */
async function waitForTiming(uri, resultPath, filePath, editorOpenedMs, expectations, previousSequence) {
  const deadline = Date.now() + TIMING_DEADLINE_MS;
  let lastError;
  let lastPersistedAt = 0;
  while (Date.now() < deadline) {
    try {
      const timing = await vscode.commands.executeCommand(
        'markdownEasyVisualEditor._getStartupTiming',
        uri.toString()
      );
      const marpFailure = timing?.marpStages?.slice().reverse().find(
        /**
         * Marpの段階名にerrorを含むものを失敗として扱う。
         * @param stage - Webviewが通知したMarp起動段階。
         * @returns 失敗段階ならtrue。
         */
        (stage) => stage.stage.includes('error'));
      if (marpFailure) {
        throw new Error(`Marp preview failed before startup readiness: ${JSON.stringify({ marpFailure, marpStages: timing.marpStages })}`);
      }
      if (
        timing &&
        timing.resolveSequence > previousSequence &&
        timing.initializedMs !== undefined &&
        (!expectations.preview || timing.previewReadyMs !== undefined) &&
        (!expectations.mermaid || timing.firstMermaidReadyMs !== undefined) &&
        (!expectations.rich || timing.richReadyMs !== undefined) &&
        (!expectations.visibleMermaid || timing.visibleMermaidReadyMs !== undefined)
      ) return timing;
      lastError = timing ? `timing=${JSON.stringify(timing)}` : 'timing=undefined';
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Marp preview failed')) throw error;
      // Custom Editor activation and the benchmark-only command registration are asynchronous.
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() - lastPersistedAt >= 1_000) {
      lastPersistedAt = Date.now();
      await persist(resultPath, { stage: 'waiting', file: filePath, editorOpenedMs, lastError });
    }
    await new Promise(
    /**
     * 次のポーリングまで待機する。
     * @param resolve - Promiseの成功を通知する関数。
     */
    (resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`The real VS Code Webview did not finish its startup measurement within ${TIMING_DEADLINE_MS / 1000} seconds: ${lastError ?? 'no startup timing was returned'}`);
}

/**
 * 計測結果または途中経過をJSONとして書き出す。
 * @param resultPath - 計測結果を書き出すJSONファイルのパス。
 * @param value - JSONへ直列化して書き出す値。
 * @returns 書き込み完了時に解決するPromise。
 */
async function persist(resultPath, value) {
  assert.ok(resultPath, 'MVE_STARTUP_RESULT is required.');
  await vscode.workspace.fs.writeFile(vscode.Uri.file(resultPath), Buffer.from(JSON.stringify(value), 'utf8'));
}

module.exports = { run };

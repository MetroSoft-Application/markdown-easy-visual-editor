/**
 * @file startup.cjs
 * 実行境界: テスト実行環境。
 * 責務: 現行実装の仕様と回帰条件を検証する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テスト用のモック、ブラウザー、ファイルを必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
/** 起動テストの期待値を検証するNode標準アサーション。 */
const assert = require('node:assert/strict');
/** 「fs」は、関連する処理間で共有する設定値または状態です。 */
const fs = require('node:fs/promises');
/** 「vscode」は、関連する処理間で共有する設定値または状態です。 */
const vscode = require('vscode');

/**
 * 「run」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @returns 「run」が実行した検証シナリオ処理の結果を返します。
 */
async function run() {
  const filePath = process.env.MVE_STARTUP_FILE;
  const resultPath = process.env.MVE_STARTUP_RESULT;
  const waitForMermaid = process.env.MVE_STARTUP_WAIT_FOR_MERMAID === '1';
  const waitForPreview = process.env.MVE_STARTUP_WAIT_FOR_PREVIEW !== '0';
  assert.ok(filePath, 'MVE_STARTUP_FILE is required.');
  await persist(resultPath, { stage: 'loaded', file: filePath });
  const uri = vscode.Uri.file(filePath);
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
  const timing = await waitForTiming(uri, resultPath, filePath, editorOpenedMs, waitForMermaid, waitForPreview);
  const result = {
    file: filePath,
    editorOpenedMs,
    endToEndMs: Date.now() - startedAt,
    ...timing
  };
  assert.ok(resultPath, 'MVE_STARTUP_RESULT is required.');
  await persist(resultPath, result);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

/**
 * wait・for・timingを待機します。
 * @param uri 「uri」は、「waitForTiming」が検証シナリオの処理対象を特定する入力です。
 * @param resultPath 「resultPath」は、「waitForTiming」が検証シナリオで処理する対象を特定する入力です。
 * @param filePath 「filePath」は、「waitForTiming」が検証シナリオで処理する対象を特定する入力です。
 * @param editorOpenedMs 「editorOpenedMs」は、「waitForTiming」が検証シナリオの処理対象を特定する入力です。
 * @param expectsMermaid 「expectsMermaid」は、「waitForTiming」が検証シナリオの処理対象を特定する入力です。
 * @param expectsPreview 「expectsPreview」は、「waitForTiming」が検証シナリオの処理対象を特定する入力です。
 * @returns 「waitForTiming」が検証シナリオの入力を処理して得た固有の結果を返します。
 */
async function waitForTiming(uri, resultPath, filePath, editorOpenedMs, expectsMermaid, expectsPreview) {
  const deadline = Date.now() + 30_000;
  let lastError;
  let lastPersistedAt = 0;
  while (Date.now() < deadline) {
    try {
      const timing = await vscode.commands.executeCommand(
        'markdownEasyVisualEditor._getStartupTiming',
        uri.toString()
      );
      if (
        timing?.initializedMs !== undefined &&
        (!expectsPreview || timing.previewReadyMs !== undefined) &&
        (!expectsMermaid || timing.firstMermaidReadyMs !== undefined)
      ) return timing;
      lastError = timing ? `timing=${JSON.stringify(timing)}` : 'timing=undefined';
    } catch (error) {
      // Custom Editor activation and the benchmark-only command registration are asynchronous.
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() - lastPersistedAt >= 1_000) {
      lastPersistedAt = Date.now();
      await persist(resultPath, { stage: 'waiting', file: filePath, editorOpenedMs, lastError });
    }
    await new Promise(
    /**
     * 予約されたタイミングで「resolve」を受け取り、遅延処理を実行するコールバックです。
     * @param resolve Promiseの完了または失敗を通知する関数です。
     * @returns エラー処理またはフォールバックの結果を返します。
     */
    (resolve) => setTimeout(resolve, 50));
  }
  throw new Error('The real VS Code Webview did not finish its first preview within 30 seconds.');
}

/**
 * 「persist」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param resultPath 「resultPath」は、「persist」が検証シナリオで処理する対象を特定する入力です。
 * @param value 「persist」で検証・変換する入力値です。
 * @returns 「persist」が検証シナリオの入力を処理して得た固有の結果を返します。
 */
async function persist(resultPath, value) {
  assert.ok(resultPath, 'MVE_STARTUP_RESULT is required.');
  await vscode.workspace.fs.writeFile(vscode.Uri.file(resultPath), Buffer.from(JSON.stringify(value), 'utf8'));
}

module.exports = { run };

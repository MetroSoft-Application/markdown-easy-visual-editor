/**
 * @fileoverview 起動の回帰の仕様と回帰条件を検証する。失敗時は期待値と実装差分を示す。
 */
/**
 * 起動の回帰のassertに関する状態または設定。
 */
const assert = require('node:assert/strict');
/**
 * 起動の回帰で扱う一覧または対応表。
 */
const fs = require('node:fs/promises');
/**
 * 起動の回帰のvscodeに関する状態または設定。
 */
const vscode = require('vscode');

/**
 * 起動の回帰の処理順序と完了状態を管理する。
 * @returns 起動の回帰のrunが生成する結果。
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
 * 起動の回帰が指定条件を満たすまで待機する。
 * @param uri - VS Codeまたはブラウザーが扱うリソースURI。
 * @param resultPath - 計測結果を書き出すJSONファイルのパス。
 * @param filePath - 読み書きするファイルのパス。
 * @param editorOpenedMs - 起動の回帰へ渡す入力。
 * @param expectsMermaid - 起動の回帰の対象や分岐を識別する値。
 * @param expectsPreview - 起動の回帰の位置・寸法・件数・時間を表す数値。
 * @returns 起動の回帰のwait・for・timingが生成する結果。
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
     * 遅延処理の完了または失敗を待機側へ通知する。
     * @param resolve - Promiseの成功を通知する関数。
     * @returns 非同期処理の完了値。
     */
    (resolve) => setTimeout(resolve, 50));
  }
  throw new Error('The real VS Code Webview did not finish its first preview within 30 seconds.');
}

/**
 * 起動の回帰の値を保存先または共有状態へ書き出す。
 * @param resultPath - 計測結果を書き出すJSONファイルのパス。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns 起動の回帰のpersistが生成する結果。
 */
async function persist(resultPath, value) {
  assert.ok(resultPath, 'MVE_STARTUP_RESULT is required.');
  await vscode.workspace.fs.writeFile(vscode.Uri.file(resultPath), Buffer.from(JSON.stringify(value), 'utf8'));
}

module.exports = { run };

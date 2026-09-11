const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const vscode = require('vscode');

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
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('The real VS Code Webview did not finish its first preview within 30 seconds.');
}

async function persist(resultPath, value) {
  assert.ok(resultPath, 'MVE_STARTUP_RESULT is required.');
  await vscode.workspace.fs.writeFile(vscode.Uri.file(resultPath), Buffer.from(JSON.stringify(value), 'utf8'));
}

module.exports = { run };

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

async function run() {
  const extension = vscode.extensions.getExtension('MetroSoft-Application.markdown-easy-visual-editor');
  assert.ok(extension, 'Markdown Easy Visual EditorがExtension Hostに読み込まれていません。');
  await extension.activate();
  assert.equal(extension.isActive, true, 'Markdown Easy Visual Editorをアクティベートできませんでした。');

  const representativeSample = vscode.Uri.file(path.resolve(__dirname, '..', '..', 'sample', '06-specification-template.md'));
  await vscode.workspace.openTextDocument(representativeSample);
  // エクスプローラー／エディターのコンテキストメニューと同じ公開コマンドを使う。
  await vscode.commands.executeCommand('markdownEasyVisualEditor.openVisual', representativeSample);
  await waitFor(() => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    return input && 'viewType' in input && input.viewType === 'markdownEasyVisualEditor.editor';
  }, '総合サンプルをCustom Editorで開けませんでした。');
  await vscode.commands.executeCommand('markdownEasyVisualEditor.openSource');
  await waitFor(
    () => vscode.window.activeTextEditor?.document.uri.toString() === representativeSample.toString(),
    'Markdownをテキストとして開けませんでした。'
  );
  assert.ok(vscode.window.tabGroups.all.length >= 2, 'テキストエディタが右側のグループに開かれませんでした。');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');

  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-host-'));
  const markdownPath = path.join(temporaryDirectory, '動作確認.md');
  const uri = vscode.Uri.file(markdownPath);
  try {
    const emptyUri = vscode.Uri.file(path.join(temporaryDirectory, 'empty-crlf.md'));
    await vscode.workspace.fs.writeFile(emptyUri, Buffer.from('', 'utf8'));
    const emptyDocument = await vscode.workspace.openTextDocument(emptyUri);
    const emptyEditor = await vscode.window.showTextDocument(emptyDocument);
    assert.equal(await emptyEditor.edit((builder) => builder.setEndOfLine(vscode.EndOfLine.CRLF)), true);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand('vscode.openWith', emptyUri, 'markdownEasyVisualEditor.editor');
    await waitFor(() => {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      return input && 'viewType' in input && input.viewType === 'markdownEasyVisualEditor.editor';
    }, 'Empty CRLF document did not open in the custom editor.');
    await new Promise((resolve) => setTimeout(resolve, 500));

    let emptyDocumentChangeCount = 0;
    const emptyDocumentChanges = [];
    const emptyChangeDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
      if (
        event.document.uri.toString() === emptyUri.toString() &&
        event.contentChanges.length > 0
      ) {
        emptyDocumentChangeCount += 1;
        emptyDocumentChanges.push({
          version: event.document.version,
          text: event.document.getText(),
          changes: event.contentChanges.map((change) => ({
            rangeOffset: change.rangeOffset,
            rangeLength: change.rangeLength,
            text: change.text
          }))
        });
      }
    });
    try {
      const leadingNewline = new vscode.WorkspaceEdit();
      leadingNewline.insert(emptyUri, new vscode.Position(0, 0), '\n');
      assert.equal(await vscode.workspace.applyEdit(leadingNewline), true);
      await waitFor(() => emptyDocument.getText() === '\r\n', 'The first CRLF newline was not applied exactly once.');
      await new Promise((resolve) => setTimeout(resolve, 750));
      assert.equal(emptyDocument.getText(), '\r\n', 'The first CRLF newline kept growing.');
      assert.equal(
        emptyDocumentChangeCount,
        1,
        `The first CRLF newline caused repeated document changes: ${JSON.stringify(emptyDocumentChanges)}`
      );
    } finally {
      emptyChangeDisposable.dispose();
    }
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    await vscode.workspace.fs.writeFile(uri, Buffer.from('# 動作確認\n\n初期テキスト\n', 'utf8'));
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.commands.executeCommand('vscode.openWith', uri, 'markdownEasyVisualEditor.editor');
    await waitFor(() => {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      return input && 'viewType' in input && input.viewType === 'markdownEasyVisualEditor.editor';
    }, 'カスタムエディタが開きませんでした。');
    await vscode.commands.executeCommand('workbench.action.splitEditor');
    await waitFor(() => vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => tab.input && 'viewType' in tab.input && tab.input.viewType === 'markdownEasyVisualEditor.editor')
      .length >= 2, '同じ文書のCustom Editorを2パネルで開けませんでした。');

    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, document.positionAt(document.getText().length), '\n保存確認');
    assert.equal(await vscode.workspace.applyEdit(edit), true, '文書編集を適用できませんでした。');
    assert.match(document.getText(), /保存確認/, '外部編集がカスタムエディタ文書へ反映されませんでした。');
    assert.equal(await document.save(), true, 'Markdown文書を保存できませんでした。');
    assert.match(await fs.readFile(markdownPath, 'utf8'), /保存確認/, '保存内容がディスクへ反映されませんでした。');

    const htmlPath = markdownPath.replace(/\.md$/i, '.html');
    await vscode.commands.executeCommand('markdownEasyVisualEditor.exportHtml', uri);
    await waitFor(async () => fileHasBytes(htmlPath), '遅延フォントを含むHTML出力が完了しませんでした。', 30_000);
    const exportedHtml = await fs.readFile(htmlPath, 'utf8');
    assert.match(exportedHtml, /保存確認/, 'HTML出力へ最新の本文が反映されませんでした。');
    assert.match(exportedHtml, /@font-face/, 'HTML出力から埋め込みフォントが欠落しました。');
    assert.match(exportedHtml, /data:font\//, 'HTML出力のフォントが自己完結していません。');

    const pdfPath = markdownPath.replace(/\.md$/i, '.pdf');
    await vscode.commands.executeCommand('markdownEasyVisualEditor.exportPdf', uri);
    await waitFor(async () => fileHasBytes(pdfPath), '遅延PlaywrightによるPDF出力が完了しませんでした。', 60_000);
    const pdfHeader = (await fs.readFile(pdfPath)).subarray(0, 5).toString('ascii');
    assert.equal(pdfHeader, '%PDF-', 'PDF出力が正しいPDFファイルではありません。');

    await new Promise((resolve) => setTimeout(resolve, 750));
    await vscode.commands.executeCommand('markdownEasyVisualEditor.undo');
    await waitFor(() => !document.getText().includes('保存確認'), 'extension undo command did not update the document.');
    await vscode.commands.executeCommand('markdownEasyVisualEditor.redo');
    await waitFor(() => document.getText().includes('保存確認'), 'extension redo command did not update the document.');

    await vscode.commands.executeCommand('undo');
    await waitFor(() => !document.getText().includes('保存確認'), 'Undoが文書へ反映されませんでした。');
    await vscode.commands.executeCommand('redo');
    await waitFor(() => document.getText().includes('保存確認'), 'Redoが文書へ反映されませんでした。');
  } finally {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function waitFor(predicate, message, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

async function fileHasBytes(filePath) {
  try {
    return (await fs.stat(filePath)).size > 0;
  } catch {
    return false;
  }
}

module.exports = { run };

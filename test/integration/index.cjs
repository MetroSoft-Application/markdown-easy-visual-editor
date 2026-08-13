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
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

module.exports = { run };

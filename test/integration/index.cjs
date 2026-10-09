/**
 * @fileoverview VS Code統合テストを起動し、構成済みのテストスイートとExtension Hostへ処理を渡す。
 */
/**
 * Node.jsの厳密なアサーション関数を読み込む。
 */
const assert = require('node:assert/strict');
/**
 * indexの回帰で扱う一覧または対応表。
 */
const fs = require('node:fs/promises');
/**
 * indexの回帰で扱う一覧または対応表。
 */
const os = require('node:os');
/**
 * indexの回帰で読み書きするリソースの場所。
 */
const path = require('node:path');
/**
 * Extension Host内のVS Code APIを読み込む。
 */
const vscode = require('vscode');

/**
 * indexの回帰の処理順序と完了状態を管理する。
 * @returns indexの回帰のrunが生成する結果。
 */
async function run() {
  const extension = vscode.extensions.getExtension('MetroSoft-Application.markdown-easy-visual-editor');
  assert.ok(extension, 'Markdown Easy Visual EditorがExtension Hostに読み込まれていません。');
  await extension.activate();
  assert.equal(extension.isActive, true, 'Markdown Easy Visual Editorをアクティベートできませんでした。');

  const exportedHtml = vscode.Uri.file(path.resolve(__dirname, '..', '..', 'sample', '03-images.html'));
  await vscode.commands.executeCommand('markdownEasyVisualEditor.previewHtml', exportedHtml);
  await waitFor(() => vscode.window.tabGroups.all.some((group) => group.tabs.some((tab) =>
    tab.input && 'viewType' in tab.input && tab.input.viewType === 'mainThreadWebview-markdownEasyVisualEditor.htmlPreview'
  )), 'HTMLを専用プレビューで開けませんでした。');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');

  const representativeSample = vscode.Uri.file(path.resolve(__dirname, '..', '..', 'sample', '06-specification-template.md'));
  await vscode.workspace.openTextDocument(representativeSample);
  // エクスプローラー／エディターのコンテキストメニューと同じ公開コマンドを使う。
  await vscode.commands.executeCommand('markdownEasyVisualEditor.openVisual', representativeSample);
  await waitFor(
  /**
    * Custom Editorのアクティブ入力がMarkdown用viewTypeかを待つ。
    * @returns 条件を満たすとtrue。タイムアウトまで成立しない場合はwaitForが失敗する。
   */
  () => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    return input && 'viewType' in input && input.viewType === 'markdownEasyVisualEditor.editor';
  }, '総合サンプルをCustom Editorで開けませんでした。');
  await vscode.commands.executeCommand('markdownEasyVisualEditor.openSource');
  await waitFor(

    /**
     * アクティブなテキストエディターが対象サンプル文書かを待つ。
     * @returns URIが一致すればtrue。waitForが指定時間内に成功しない場合は失敗する。
     */
    () => vscode.window.activeTextEditor?.document.uri.toString() === representativeSample.toString(),
    'Markdownをテキストとして開けませんでした。'
  );
  assert.ok(vscode.window.tabGroups.all.length >= 2, 'テキストエディタが右側のグループに開かれませんでした。');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');

  await vscode.commands.executeCommand('vscode.open', representativeSample);
  await waitFor(
    () => vscode.window.activeTextEditor?.document.uri.toString() === representativeSample.toString(),
    '既定設定のvscode.openがテキストエディターを開きませんでした。'
  );
  const defaultTabInput = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  assert.ok(
    !defaultTabInput || !('viewType' in defaultTabInput) || defaultTabInput.viewType !== 'markdownEasyVisualEditor.editor',
    '既定設定のvscode.openがMarkdown Easy Visual Editorを選択しました。'
  );
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');

  await vscode.workspace.getConfiguration('workbench').update('editorAssociations', {
    '*.md': 'vscode.markdown.preview.editor'
  }, vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand('vscode.open', representativeSample);
  await waitFor(
    () => {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      return input && 'viewType' in input && input.viewType === 'vscode.markdown.preview.editor';
    }, '既定Markdown Previewでリンク元のタブを開けませんでした。');
  await vscode.commands.executeCommand(
    'vscode.open',
    representativeSample.with({ fragment: 'extended-syntax' })
  );
  await waitFor(
    () => {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      return input && 'viewType' in input && input.viewType === 'vscode.markdown.preview.editor';
    }, 'Markdown Previewの既定設定でvscode.openがMarkdown Previewを選択しませんでした。');
  assert.equal(
    vscode.window.tabGroups.activeTabGroup.activeTab?.input?.uri?.fragment,
    'extended-syntax',
    '既定Markdown Previewがresource URIのfragmentを受け取りませんでした.'
  );
  const markdownPreviewTabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter((tab) =>
    tab.input && 'viewType' in tab.input && tab.input.viewType === 'vscode.markdown.preview.editor'
  );
  assert.equal(markdownPreviewTabs.length, 1, 'fragment付きURIでMarkdown Previewが重複タブを開きました。');
  await vscode.commands.executeCommand(
    'vscode.open',
    representativeSample.with({ fragment: 'another-section' })
  );
  await waitFor(
    () => vscode.window.tabGroups.activeTabGroup.activeTab?.input?.uri?.fragment === 'another-section',
    'Markdown Previewが異なるfragmentを受け取りませんでした。'
  );
  const markdownPreviewTabsAfterSecondFragment = vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter((tab) =>
    tab.input && 'viewType' in tab.input && tab.input.viewType === 'vscode.markdown.preview.editor'
  );
  assert.equal(markdownPreviewTabsAfterSecondFragment.length, 1, '異なるfragmentを続けて開くとMarkdown Previewが重複タブを開きました。');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');

  await vscode.workspace.getConfiguration('workbench').update('editorAssociations', {
    '*.md': 'markdownEasyVisualEditor.editor'
  }, vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand('vscode.open', representativeSample);
  await waitFor(
    () => {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      return input && 'viewType' in input && input.viewType === 'markdownEasyVisualEditor.editor';
    }, '既定エディター設定後にvscode.openがMarkdown Easy Visual Editorを選択しませんでした。');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');

  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-host-'));
  const markdownPath = path.join(temporaryDirectory, '動作確認.md');
  const uri = vscode.Uri.file(markdownPath);
  try {
    const emptyUri = vscode.Uri.file(path.join(temporaryDirectory, 'empty-crlf.md'));
    await vscode.workspace.fs.writeFile(emptyUri, Buffer.from('', 'utf8'));
    const emptyDocument = await vscode.workspace.openTextDocument(emptyUri);
    const emptyEditor = await vscode.window.showTextDocument(emptyDocument);
    assert.equal(await emptyEditor.edit(
    /**
     * @param builder - indexの回帰へ渡す入力。
     */
    (builder) => builder.setEndOfLine(vscode.EndOfLine.CRLF)), true);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand('vscode.openWith', emptyUri, 'markdownEasyVisualEditor.editor');
    await waitFor(
    /**
     * アクティブタブがカスタムエディターかを確認する。
     */
    () => {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      return input && 'viewType' in input && input.viewType === 'markdownEasyVisualEditor.editor';
    }, 'Empty CRLF document did not open in the custom editor.');
    await new Promise(
    /**
     * 遅延処理の完了または失敗を待機側へ通知する。
     * @param resolve - Promiseの成功を通知する関数。
     */
    (resolve) => setTimeout(resolve, 500));

    let emptyDocumentChangeCount = 0;
    const emptyDocumentChanges = [];
    const emptyChangeDisposable = vscode.workspace.onDidChangeTextDocument(
    /**
     * @param event - 変更文書と内容変更を含むVS Codeの文書変更イベント。
     */
    (event) => {
      if (
        event.document.uri.toString() === emptyUri.toString() &&
        event.contentChanges.length > 0
      ) {
        emptyDocumentChangeCount += 1;
        emptyDocumentChanges.push({
          version: event.document.version,
          text: event.document.getText(),
          changes: event.contentChanges.map(
          (change) => ({
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
      await waitFor(

      () => emptyDocument.getText() === '\r\n', 'The first CRLF newline was not applied exactly once.');
      await new Promise(
      /**
       * 遅延処理の完了または失敗を待機側へ通知する。
       * @param resolve - Promiseの成功を通知する関数。
       */
      (resolve) => setTimeout(resolve, 750));
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

    await vscode.workspace.fs.writeFile(uri, Buffer.from('# 動作確認\n\n初期テキスト\n\n```html\n</script><script>globalThis.bootstrapUnsafe = true</script>\n```\n', 'utf8'));
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.commands.executeCommand('vscode.openWith', uri, 'markdownEasyVisualEditor.editor');
    await waitFor(
    /**
     * アクティブタブがカスタムエディターかを確認する。
     */
    () => {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      return input && 'viewType' in input && input.viewType === 'markdownEasyVisualEditor.editor';
    }, 'カスタムエディタが開きませんでした。');
    await vscode.commands.executeCommand('workbench.action.splitEditor');
    await waitFor(

    () => vscode.window.tabGroups.all
      .flatMap(
      /**

       * @param group - indexの回帰へ渡す入力。
       */
      (group) => group.tabs)
      .filter(
      /**
       * inputの条件を満たすtabだけを残す。
       * @param tab - tabのinputを参照する走査対象。

       */
      (tab) => tab.input && 'viewType' in tab.input && tab.input.viewType === 'markdownEasyVisualEditor.editor')
      .length >= 2, '同じ文書のCustom Editorを2パネルで開けませんでした。');

    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, document.positionAt(document.getText().length), '\n保存確認');
    assert.equal(await vscode.workspace.applyEdit(edit), true, '文書編集を適用できませんでした。');
    assert.match(document.getText(), /保存確認/, '外部編集がカスタムエディタ文書へ反映されませんでした。');
    assert.equal(await document.save(), true, 'Markdown文書を保存できませんでした。');
    assert.match(await fs.readFile(markdownPath, 'utf8'), /保存確認/, '保存内容がディスクへ反映されませんでした。');

    const htmlPath = markdownPath.replace(/\.md$/i, '.html');
    await vscode.commands.executeCommand('markdownEasyVisualEditor.exportHtml', uri);
    await waitFor(
    async () => fileHasBytes(htmlPath), '遅延フォントを含むHTML出力が完了しませんでした。', 30_000);
    const exportedHtml = await fs.readFile(htmlPath, 'utf8');
    assert.match(exportedHtml, /保存確認/, 'HTML出力へ最新の本文が反映されませんでした。');
    assert.match(exportedHtml, /bootstrapUnsafe/, 'script終端を含む初期Markdownが欠落しました。');
    assert.match(exportedHtml, /@font-face/, 'HTML出力から埋め込みフォントが欠落しました。');
    assert.match(exportedHtml, /data:font\//, 'HTML出力のフォントが自己完結していません。');

    const pdfPath = markdownPath.replace(/\.md$/i, '.pdf');
    await vscode.commands.executeCommand('markdownEasyVisualEditor.exportPdf', uri);
    await waitFor(
    async () => fileHasBytes(pdfPath), '遅延PlaywrightによるPDF出力が完了しませんでした。', 60_000);
    const pdfHeader = (await fs.readFile(pdfPath)).subarray(0, 5).toString('ascii');
    assert.equal(pdfHeader, '%PDF-', 'PDF出力が正しいPDFファイルではありません。');

    await new Promise(
    /**
     * 遅延処理の完了または失敗を待機側へ通知する。
     * @param resolve - Promiseの成功を通知する関数。
     */
    (resolve) => setTimeout(resolve, 750));
    await vscode.commands.executeCommand('markdownEasyVisualEditor.undo');
    await waitFor(
    /**
     * @returns 条件が成立したかを示す真偽値。
     */
    () => !document.getText().includes('保存確認'), 'extension undo command did not update the document.');
    await vscode.commands.executeCommand('markdownEasyVisualEditor.redo');
    await waitFor(

    () => document.getText().includes('保存確認'), 'extension redo command did not update the document.');

    await vscode.commands.executeCommand('undo');
    await waitFor(
    /**
     * @returns 条件が成立したかを示す真偽値。
     */
    () => !document.getText().includes('保存確認'), 'Undoが文書へ反映されませんでした。');
    await vscode.commands.executeCommand('redo');
    await waitFor(

    () => document.getText().includes('保存確認'), 'Redoが文書へ反映されませんでした。');
  } finally {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

/**
 * 非同期条件を一定間隔で確認し、制限時間内に成立しなければ指定メッセージで失敗させる。
 * @param predicate - 条件成立時にtrueを返す確認関数。
 * @param message - 制限時間を超えたときに表示するエラー。
 * @param timeout - 条件成立を待つ最大時間（ミリ秒）。
 * @returns 条件が成立した場合に解決するPromise。
 */
async function waitFor(predicate, message, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(
    /**
     * 遅延処理の完了または失敗を待機側へ通知する。
     * @param resolve - Promiseの成功を通知する関数。
     */
    (resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

/**
 * 出力ファイルが存在し、1バイト以上あることを確認する。
 * @param filePath - 確認する出力ファイルのパス。
 * @returns ファイルが存在して空でなければtrue。
 */
async function fileHasBytes(filePath) {
  try {
    return (await fs.stat(filePath)).size > 0;
  } catch {
    return false;
  }
}

module.exports = { run };

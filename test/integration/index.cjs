/**
 * @file index.cjs
 * 実行境界: テスト実行環境。
 * 責務: 現行実装の仕様と回帰条件を検証する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テスト用のモック、ブラウザー、ファイルを必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
/** 統合テストの期待値を検証するNode標準アサーション。 */
const assert = require('node:assert/strict');
/** 「fs」は、関連する処理間で共有する設定値または状態です。 */
const fs = require('node:fs/promises');
/** 「os」は、関連する処理間で共有する設定値または状態です。 */
const os = require('node:os');
/** 「path」は、対象ファイルまたは実行環境の場所を表す値です。 */
const path = require('node:path');
/** 「vscode」は、関連する処理間で共有する設定値または状態です。 */
const vscode = require('vscode');

/**
 * 「run」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @returns 「run」が実行した検証シナリオ処理の結果を返します。
 */
async function run() {
  const extension = vscode.extensions.getExtension('MetroSoft-Application.markdown-easy-visual-editor');
  assert.ok(extension, 'Markdown Easy Visual EditorがExtension Hostに読み込まれていません。');
  await extension.activate();
  assert.equal(extension.isActive, true, 'Markdown Easy Visual Editorをアクティベートできませんでした。');

  const representativeSample = vscode.Uri.file(path.resolve(__dirname, '..', '..', 'sample', '06-specification-template.md'));
  await vscode.workspace.openTextDocument(representativeSample);
  // エクスプローラー／エディターのコンテキストメニューと同じ公開コマンドを使う。
  await vscode.commands.executeCommand('markdownEasyVisualEditor.openVisual', representativeSample);
  await waitFor(
  /**
 * 受け取った入力または現在の状態を検証し、呼び出し元へ必要な処理結果を返すコールバックです。
   * @returns 「vscode.commands.executeCommand」の呼び出し結果を返します。
   */
  () => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    return input && 'viewType' in input && input.viewType === 'markdownEasyVisualEditor.editor';
  }, '総合サンプルをCustom Editorで開けませんでした。');
  await vscode.commands.executeCommand('markdownEasyVisualEditor.openSource');
  await waitFor(

    /**
 * 受け取った入力または現在の状態を検証し、呼び出し元へ必要な処理結果を返すコールバックです。
     * @returns 「document.uri.toString」の呼び出し結果を返します。
     */
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
    assert.equal(await emptyEditor.edit(
    /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
     * @param builder builderとして渡される、このコールバックの入力値です。
     * @returns 「builder」が生成したデータまたはオブジェクトを返します。
     */
    (builder) => builder.setEndOfLine(vscode.EndOfLine.CRLF)), true);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand('vscode.openWith', emptyUri, 'markdownEasyVisualEditor.editor');
    await waitFor(
    /**
 * Promiseの完了または失敗を通知し、非同期処理の状態を確定するコールバックです。
     * @returns 「Promise」の呼び出し結果を返します。
     */
    () => {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      return input && 'viewType' in input && input.viewType === 'markdownEasyVisualEditor.editor';
    }, 'Empty CRLF document did not open in the custom editor.');
    await new Promise(
    /**
     * 予約されたタイミングで「resolve」を受け取り、遅延処理を実行するコールバックです。
     * @param resolve Promiseの完了または失敗を通知する関数です。
     * @returns 「setTimeout」を実行し、値を返しません。
     */
    (resolve) => setTimeout(resolve, 500));

    let emptyDocumentChangeCount = 0;
    const emptyDocumentChanges = [];
    const emptyChangeDisposable = vscode.workspace.onDidChangeTextDocument(
    /**
     * 予約されたタイミングで「event」を受け取り、遅延処理を実行するコールバックです。
     * @param event 処理対象のイベントです。
     * @returns イベントに応じた状態更新または委譲処理を実行し、値を返しません。
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
          /**
 * 「change」を変換し、変換後の要素を返すコールバックです。
           * @param change changeとして渡される、このコールバックの入力値です。
           * @returns 入力要素から生成した変換後の値を返します。
           */
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
      /**
 * Promiseの完了または失敗を通知し、非同期処理の状態を確定するコールバックです。
       * @returns 「emptyDocument.getText」の呼び出し結果を返します。
       */
      () => emptyDocument.getText() === '\r\n', 'The first CRLF newline was not applied exactly once.');
      await new Promise(
      /**
       * 予約されたタイミングで「resolve」を受け取り、遅延処理を実行するコールバックです。
       * @param resolve Promiseの完了または失敗を通知する関数です。
       * @returns 「setTimeout」を実行し、値を返しません。
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
 * 受け取った入力または現在の状態を検証し、呼び出し元へ必要な処理結果を返すコールバックです。
     * @returns 「vscode.commands.executeCommand」の呼び出し結果を返します。
     */
    () => {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      return input && 'viewType' in input && input.viewType === 'markdownEasyVisualEditor.editor';
    }, 'カスタムエディタが開きませんでした。');
    await vscode.commands.executeCommand('workbench.action.splitEditor');
    await waitFor(
    /**
 * 受け取った入力または現在の状態を検証し、呼び出し元へ必要な処理結果を返すコールバックです。
     * @returns 「flatMap」の呼び出し結果を返します。
     */
    () => vscode.window.tabGroups.all
      .flatMap(
      /**
 * 「group」を受け取り、入力文字列を置換して変換する処理です。
       * @param group groupとして渡される、このコールバックの入力値です。
       * @returns 置換後の文字列を返します。
       */
      (group) => group.tabs)
      .filter(
      /**
 * 「tab」が条件に一致するか判定し、残す要素を決めるコールバックです。
       * @param tab tabとして渡される、このコールバックの入力値です。
       * @returns 要素を採用するかどうかの真偽値を返します。
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
    /**
     * 「async」として関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
     * @returns 置換後の文字列を返します。
     */
    async () => fileHasBytes(htmlPath), '遅延フォントを含むHTML出力が完了しませんでした。', 30_000);
    const exportedHtml = await fs.readFile(htmlPath, 'utf8');
    assert.match(exportedHtml, /保存確認/, 'HTML出力へ最新の本文が反映されませんでした。');
    assert.match(exportedHtml, /bootstrapUnsafe/, 'script終端を含む初期Markdownが欠落しました。');
    assert.match(exportedHtml, /@font-face/, 'HTML出力から埋め込みフォントが欠落しました。');
    assert.match(exportedHtml, /data:font\//, 'HTML出力のフォントが自己完結していません。');

    const pdfPath = markdownPath.replace(/\.md$/i, '.pdf');
    await vscode.commands.executeCommand('markdownEasyVisualEditor.exportPdf', uri);
    await waitFor(
    /**
     * 「async」として関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
     * @returns 「fileHasBytes」の呼び出し結果を返します。
     */
    async () => fileHasBytes(pdfPath), '遅延PlaywrightによるPDF出力が完了しませんでした。', 60_000);
    const pdfHeader = (await fs.readFile(pdfPath)).subarray(0, 5).toString('ascii');
    assert.equal(pdfHeader, '%PDF-', 'PDF出力が正しいPDFファイルではありません。');

    await new Promise(
    /**
     * 予約されたタイミングで「resolve」を受け取り、遅延処理を実行するコールバックです。
     * @param resolve Promiseの完了または失敗を通知する関数です。
     * @returns 「setTimeout」を実行し、値を返しません。
     */
    (resolve) => setTimeout(resolve, 750));
    await vscode.commands.executeCommand('markdownEasyVisualEditor.undo');
    await waitFor(
    /**
 * 指定時間の経過後に後続処理を実行するコールバックです。
     * @returns 「document.getText」の呼び出し結果を返します。
     */
    () => !document.getText().includes('保存確認'), 'extension undo command did not update the document.');
    await vscode.commands.executeCommand('markdownEasyVisualEditor.redo');
    await waitFor(
    /**
     * 予約されたタイミングでタイマーまたはフレーム後の処理を実行するコールバックです。
     * @returns 「document.getText」の呼び出し結果を返します。
     */
    () => document.getText().includes('保存確認'), 'extension redo command did not update the document.');

    await vscode.commands.executeCommand('undo');
    await waitFor(
    /**
 * 受け取った入力または現在の状態を検証し、呼び出し元へ必要な処理結果を返すコールバックです。
     * @returns 「document.getText」の呼び出し結果を返します。
     */
    () => !document.getText().includes('保存確認'), 'Undoが文書へ反映されませんでした。');
    await vscode.commands.executeCommand('redo');
    await waitFor(
    /**
 * 受け取った入力または現在の状態を検証し、呼び出し元へ必要な処理結果を返すコールバックです。
     * @returns 「document.getText」の呼び出し結果を返します。
     */
    () => document.getText().includes('保存確認'), 'Redoが文書へ反映されませんでした。');
  } finally {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

/**
 * wait・forを待機します。
 * @param predicate 「predicate」は、「waitFor」が検証シナリオの処理対象を特定する入力です。
 * @param message 処理対象のメッセージです。
 * @param timeout 処理対象のタイムアウトです。
 * @returns 「waitFor」が検証シナリオの入力を処理して得た固有の結果を返します。
 */
async function waitFor(predicate, message, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(
    /**
     * 予約されたタイミングで「resolve」を受け取り、遅延処理を実行するコールバックです。
     * @param resolve Promiseの完了または失敗を通知する関数です。
     * @returns 「setTimeout」を実行し、値を返しません。
     */
    (resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

/**
 * 「fileHasBytes」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param filePath 「filePath」は、「fileHasBytes」が検証シナリオで処理する対象を特定する入力です。
 * @returns 「fileHasBytes」が検証シナリオの入力を処理して得た固有の結果を返します。
 */
async function fileHasBytes(filePath) {
  try {
    return (await fs.stat(filePath)).size > 0;
  } catch {
    return false;
  }
}

module.exports = { run };

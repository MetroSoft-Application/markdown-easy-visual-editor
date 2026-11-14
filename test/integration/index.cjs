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
 * DOCX出力（ZIP）の本文XMLを展開して検査するため、Deflateの展開に使う。
 */
const zlib = require('node:zlib');

/**
 * DOCX（ZIP）が書き終わったかを判定する。書き込み途中のファイルを読んで誤判定しないよう、
 * ファイル末尾付近にZIPの終端レコードがある場合だけ完了とみなす。
 * @param {string} file - 出力されるDOCXのパス。
 * @returns {Promise<boolean>} 終端レコードまで書き込まれていればtrue。ファイルがない場合はfalse。
 */
async function docxIsComplete(file) {
  const data = await fs.readFile(file).catch(() => undefined);
  if (!data || data.length < 22) return false;
  const eocd = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  // 終端レコードは末尾22バイトと最大65535バイトのコメントの範囲にある。
  return eocd >= 0 && eocd >= data.length - 22 - 0xffff;
}

/**
 * ZIPの中央ディレクトリから指定名のエントリを探し、展開した内容を返す。
 * DOCXはデータディスクリプター付きで書かれることがあり、ローカルヘッダーのサイズが0になり得るため中央ディレクトリを使う。
 * @param {Buffer} zip - ZIP（DOCX）ファイルの内容。
 * @param {string} name - 取り出すエントリ名（例: word/document.xml）。
 * @returns {Buffer | undefined} 展開した内容。エントリがない場合はundefined。
 * @throws ZIPの終端レコードがない、または未対応の圧縮方式の場合。
 */
function readZipEntry(zip, name) {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, 'DOCX出力にZIPの終端レコードがありません。');
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  for (let index = 0; index < count; index += 1) {
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const entryName = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (entryName === name) {
      const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
      const data = zip.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error(`未対応のZIP圧縮方式です: ${method}`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return undefined;
}

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

    // DOCX出力: 同梱した出力エンジン（docx-extract.jsを含む）で、最新の本文を持つWord文書を書くこと。
    const docxPath = markdownPath.replace(/\.md$/i, '.docx');
    await vscode.commands.executeCommand('markdownEasyVisualEditor.exportDocx', uri);
    await waitFor(
    async () => docxIsComplete(docxPath), 'DOCX出力が完了しませんでした。', 60_000);
    const docx = await fs.readFile(docxPath);
    assert.equal(docx.readUInt32LE(0), 0x04034b50, 'DOCX出力がZIP形式（PK\x03\x04）ではありません。');
    const documentXml = readZipEntry(docx, 'word/document.xml');
    assert.ok(documentXml, 'DOCX出力にword/document.xmlがありません。');
    assert.match(documentXml.toString('utf8'), /保存確認/, 'DOCX出力へ最新の本文が反映されませんでした。');

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

    const marpExportPath = path.join(temporaryDirectory, 'marp-export.md');
    const marpExportMarkdown = [
      '---',
      'marp: true',
      '---',
      '',
      '# Marp export regression',
      '',
      'This content must keep the existing Markdown export path.',
      '',
    ].join('\n');
    await fs.writeFile(marpExportPath, marpExportMarkdown, 'utf8');
    const marpExportUri = vscode.Uri.file(marpExportPath);
    await vscode.commands.executeCommand(
      'vscode.openWith',
      marpExportUri,
      'markdownEasyVisualEditor.editor',
    );
    await waitFor(
      () => {
        const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
        return input && 'viewType' in input &&
          input.viewType === 'markdownEasyVisualEditor.editor' &&
          input.uri?.toString() === marpExportUri.toString();
      },
      'MarpのPDF／HTML出力検査用文書をCustom Editorで開けませんでした。',
    );

    const marpHtmlPath = marpExportPath.replace(/\.md$/i, '.html');
    await vscode.commands.executeCommand('markdownEasyVisualEditor.exportHtml', marpExportUri);
    await waitFor(
      async () => fileHasBytes(marpHtmlPath),
      'Marpマーカー付きMarkdownの既存HTML出力が完了しませんでした。',
      30_000,
    );
    const marpHtml = await fs.readFile(marpHtmlPath, 'utf8');
    assert.match(marpHtml, /Marp export regression/, 'Marp文書のHTML出力から見出しが欠落しました。');
    assert.match(marpHtml, /existing Markdown export path/, 'Marp文書のHTML出力から本文が欠落しました。');
    assert.doesNotMatch(marpHtml, /marp:\s*true/i, 'Marp設定用front matterがHTML本文に表示されました。');
    assert.doesNotMatch(marpHtml, /class=["']marpit(?:\s|["'])/i, 'HTML出力がMarpスライド形式へ変わりました。');

    const marpPdfPath = marpExportPath.replace(/\.md$/i, '.pdf');
    await vscode.commands.executeCommand('markdownEasyVisualEditor.exportPdf', marpExportUri);
    await waitFor(
      async () => fileHasBytes(marpPdfPath),
      'Marpマーカー付きMarkdownの既存PDF出力が完了しませんでした。',
      60_000,
    );
    const marpPdf = await fs.readFile(marpPdfPath);
    assert.equal(marpPdf.subarray(0, 5).toString('ascii'), '%PDF-', 'Marp文書のPDF出力形式が変わりました。');

    // Marp文書のDOCXは、出力エンジンの仕様どおりスライドではなく通常の文書として書かれること。
    const marpDocxPath = marpExportPath.replace(/\.md$/i, '.docx');
    await vscode.commands.executeCommand('markdownEasyVisualEditor.exportDocx', marpExportUri);
    await waitFor(
      async () => docxIsComplete(marpDocxPath),
      'Marpマーカー付きMarkdownのDOCX出力が完了しませんでした。',
      60_000,
    );
    const marpDocumentXml = readZipEntry(await fs.readFile(marpDocxPath), 'word/document.xml');
    assert.ok(marpDocumentXml, 'Marp文書のDOCX出力にword/document.xmlがありません。');
    assert.match(marpDocumentXml.toString('utf8'), /Marp export regression/, 'Marp文書のDOCX出力から見出しが欠落しました。');
    assert.doesNotMatch(marpDocumentXml.toString('utf8'), /marp:\s*true/i, 'Marp設定用front matterがDOCX本文に表示されました。');

    // Marp以外のYAML front matterは、プレビューと同じく本文として出力に残ること（エンジン0.1.3以降の既定autoでは消える）。
    const frontMatterPath = path.join(temporaryDirectory, 'front-matter-export.md');
    await fs.writeFile(frontMatterPath, '---\ntitle: Front matter title\nversion: 1.0\n---\n\n# Front matter body\n', 'utf8');
    const frontMatterUri = vscode.Uri.file(frontMatterPath);
    // ヘッダーの{title}・{date}は印刷プレビューと同じく文字どおり出力されること（エンジンに展開させない）。
    // 新しく開くパネルの初期設定へ載せるため、文書を開く前にグローバル設定へ書き、検査後に元へ戻す。
    const editorConfig = vscode.workspace.getConfiguration('markdownEasyVisualEditor');
    const previousHeader = editorConfig.inspect('pdf.header')?.globalValue;
    await editorConfig.update('pdf.header', 'H {title} {date}', vscode.ConfigurationTarget.Global);
    let frontMatterPdf;
    try {
      const frontMatterHtmlPath = frontMatterPath.replace(/\.md$/i, '.html');
      await vscode.commands.executeCommand('markdownEasyVisualEditor.exportHtml', frontMatterUri);
      await waitFor(
        async () => fileHasBytes(frontMatterHtmlPath),
        'front matter付き文書のHTML出力が完了しませんでした。',
        30_000,
      );
      assert.match(await fs.readFile(frontMatterHtmlPath, 'utf8'), /version: 1\.0/,
        'front matterがHTML出力から消え、プレビューと一致しません。');
      const frontMatterDocxPath = frontMatterPath.replace(/\.md$/i, '.docx');
      await vscode.commands.executeCommand('markdownEasyVisualEditor.exportDocx', frontMatterUri);
      await waitFor(
        async () => docxIsComplete(frontMatterDocxPath),
        'front matter付き文書のDOCX出力が完了しませんでした。',
        60_000,
      );
      const frontMatterXml = readZipEntry(await fs.readFile(frontMatterDocxPath), 'word/document.xml');
      assert.ok(frontMatterXml, 'front matter付き文書のDOCX出力にword/document.xmlがありません。');
      assert.match(frontMatterXml.toString('utf8'), /version: 1\.0/,
        'front matterがDOCX出力から消え、プレビューと一致しません。');
      const frontMatterHeaderXml = readZipEntry(await fs.readFile(frontMatterDocxPath), 'word/header1.xml');
      assert.ok(frontMatterHeaderXml, 'ヘッダーを設定したDOCX出力にword/header1.xmlがありません。');
      assert.match(frontMatterHeaderXml.toString('utf8'), /H \{title\} \{date\}/,
        'ヘッダーの{title}・{date}が展開され、印刷プレビューと一致しません。');
      // PDFも同じ共通経路でfront matterを本文として描画すること（本文の検査は下でpdfjsを読み込んでから行う）。
      const frontMatterPdfPath = frontMatterPath.replace(/\.md$/i, '.pdf');
      await vscode.commands.executeCommand('markdownEasyVisualEditor.exportPdf', frontMatterUri);
      await waitFor(
        async () => fileHasBytes(frontMatterPdfPath),
        'front matter付き文書のPDF出力が完了しませんでした。',
        60_000,
      );
      frontMatterPdf = await fs.readFile(frontMatterPdfPath);
    } finally {
      // 失敗時も、後続の検査や次回の実行へヘッダー設定を残さない。
      await editorConfig.update('pdf.header', previousHeader, vscode.ConfigurationTarget.Global);
    }
    const marpPdfStructure = marpPdf.toString('latin1');
    assert.equal(
      (marpPdfStructure.match(/\/Type\s*\/Page\b/g) ?? []).length,
      1,
      'Marp文書の既存PDF出力ページ数が変わりました。',
    );
    assert.match(
      marpPdfStructure,
      /\/MediaBox\s*\[\s*0\s+0\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s*\]/,
      'Marp文書の既存PDF出力からページ寸法が欠落しました。',
    );
    const canvas = require('@napi-rs/canvas');
    globalThis.DOMMatrix ??= canvas.DOMMatrix;
    globalThis.Path2D ??= canvas.Path2D;
    globalThis.ImageData ??= canvas.ImageData;
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = require('node:url').pathToFileURL(
      require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ).href;
    const pdfLoadingTask = pdfjs.getDocument({
      data: new Uint8Array(marpPdf),
      disableAutoFetch: true,
      useWorkerFetch: false,
      isEvalSupported: false,
    });
    const parsedMarpPdf = await pdfLoadingTask.promise;
    try {
      const pdfPage = await parsedMarpPdf.getPage(1);
      const pageViewport = pdfPage.getViewport({ scale: 1 });
      assert.ok(
        Math.abs(pageViewport.width / pageViewport.height - 16 / 9) < 0.02,
        `Marp PDFのページ比率が16:9ではありません: ${pageViewport.width}x${pageViewport.height}`,
      );
      const pdfText = (await pdfPage.getTextContent()).items
        .map((item) => 'str' in item ? item.str : '')
        .join(' ');
      assert.match(pdfText, /Marp export regression/, 'Marp文書の既存PDF出力から見出しが欠落しました。');
      assert.match(pdfText, /existing Markdown export path/, 'Marp文書の既存PDF出力から本文が欠落しました。');
    } finally {
      await pdfLoadingTask.destroy();
    }
    const frontMatterPdfTask = pdfjs.getDocument({
      data: new Uint8Array(frontMatterPdf),
      disableAutoFetch: true,
      useWorkerFetch: false,
      isEvalSupported: false,
    });
    try {
      const frontMatterPage = await (await frontMatterPdfTask.promise).getPage(1);
      const frontMatterText = (await frontMatterPage.getTextContent()).items
        .map((item) => 'str' in item ? item.str : '')
        .join(' ');
      assert.match(frontMatterText, /version: 1\.0/, 'front matterがPDF出力から消え、プレビューと一致しません。');
      assert.match(frontMatterText, /H \{title\} \{date\}/, 'PDFヘッダーの{title}・{date}が展開され、印刷プレビューと一致しません。');
    } finally {
      await frontMatterPdfTask.destroy();
    }
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

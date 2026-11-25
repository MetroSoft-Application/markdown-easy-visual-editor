/**
 * @fileoverview ChromiumでPDFプレビューを開き、ページ描画、置換、ズーム、エラー表示を確認する。
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * 指定した名前のファイルを検証用ディレクトリから再帰的に探す。
 * @param root - 再帰検索を始めるディレクトリ。
 * @param name - 大文字小文字を区別せず探すファイル名。
 * @returns 一致したファイルのパス。見つからない場合はundefined。
 */
async function findFile(root, name) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return candidate;
    if (entry.isDirectory()) {
      const nested = await findFile(candidate, name);
      if (nested) return nested;
    }
  }
}

/**
 * PDF・プレビュー・スモーク検証で読み書きするリソースの場所。
 */
const executablePath = await findFile(path.resolve('.chromium'), 'chrome-headless-shell.exe');
if (!executablePath) throw new Error('Chromiumがありません。npm run pdf:install-browserを実行してください。');

/**
 * PDF・プレビュー・スモーク検証で一時生成物または検証対象を置くディレクトリ。
 */
const root = path.resolve('dist');
/**
 * プレビュー負荷の計測に使用する大きなMarkdownサンプル。
 */
const largeSample = (await readFile('sample/09-large-document.md', 'utf8')).replace(/\r\n?/g, '\n');
/**
 * PDF・プレビュー・スモーク検証のserverとして読み込んだ本文または設定。
 */
const server = createServer(
/**
 * dist内のアセット要求へファイル内容とMIME型を返す簡易HTTPハンドラー。
 * @param request - URLから配信対象ファイルを決める受信リクエスト。
 * @param response - ファイル内容または404を返すレスポンス。
 */
async (request, response) => {
  const name = request.url === '/' ? 'index.html' : request.url?.slice(1) ?? '';
  try {
    const body = await readFile(path.join(root, name));
    const contentType = name.endsWith('.css')
      ? 'text/css'
      : name.endsWith('.js') || name.endsWith('.mjs')
        ? 'text/javascript'
        : 'text/html';
    response.writeHead(200, { 'content-type': contentType });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});

await new Promise(
/**
 * 非同期処理のlisten通知を待機側へ渡す。
 * @param resolve - Promiseの成功を通知する関数。
 */
(resolve) => server.listen(0, '127.0.0.1', resolve));
/**
 * PDF・プレビュー・スモーク検証のportとして利用する実行環境または外部資源。
 */
const port = server.address().port;
/**
 * PDFプレビューを開くために使うChromiumインスタンスです。
 */
const browser = await chromium.launch({ executablePath, headless: true });

try {
  const pdfSource = await browser.newPage();
  const darkPdfHtml = '<!doctype html><html><body><h1 style="color:#0550ae">PDF preview smoke</h1>'
    + '<p>large document page content</p>'.repeat(160)
    + '</body></html>';
  await pdfSource.setContent(darkPdfHtml);
  const darkPdf = await pdfSource.pdf({ format: 'A4', printBackground: true });
  await pdfSource.setContent('<!doctype html><html><body><h1 style="color:#0969da">PDF preview light</h1>'
    + '</body></html>');
  const lightPdf = await pdfSource.pdf({ format: 'A4', printBackground: true });
  const targetPdfByteLength = Math.max(darkPdf.length, lightPdf.length);
  const previewPdfs = [darkPdf, lightPdf].map(
    /**
     * PDF末尾へ空白を足し、異なる文書でもReactのページkeyが同じ長さになる状態を作る。
     * @param pdf - 目標サイズまで空白で拡張するPDFデータ。
     * @returns 同じBase64文字列長になるよう拡張したPDFデータ。
     */
    (pdf) => Buffer.concat([pdf, Buffer.alloc(targetPdfByteLength - pdf.length, 32)]).toString('base64'));
  if (previewPdfs[0] === previewPdfs[1]) {
    throw new Error('Theme transition fixtures must contain different PDF data.');
  }
  if (previewPdfs[0].length !== previewPdfs[1].length) {
    throw new Error('Theme transition fixtures must have equal Base64 lengths.');
  }
  await pdfSource.close();

  const context = await browser.newContext();
  await context.addInitScript(
  /**
   * @param previewDocuments - テーマ切替前後にPDFプレビューへ渡す同じ長さのPDF一覧。
   */
  (previewDocuments) => {
    window.__mveDebugEnabled = true;
    window.__mveMessages = [];
    window.__mvePdfResponseIndex = 0;
    window.__mvePdfResponsesSent = 0;
    window.acquireVsCodeApi =
    /**
     * WebviewからVS Codeのメッセージ送信・状態保存APIを取得する。
     * @returns VS Codeのメッセージ送信・状態保存API。
     */
    () => ({

      
      postMessage: /**
       * Webviewから送られたメッセージを検証用キューへ記録する。
       * @param message - Webviewが送信したプロトコルメッセージ。
       */ (message) => {
        window.__mveMessages.push(message);
        if (message.type === 'renderPdfPreview') {
          const responseIndex = Math.min(window.__mvePdfResponseIndex, previewDocuments.length - 1);
          window.__mvePdfResponseIndex += 1;
          setTimeout(
          /**
           * 指定時間の経過後に後続処理を実行する。
           */
          () => {
            window.__mvePdfResponsesSent += 1;
            window.dispatchEvent(new MessageEvent('message', {
              data: { type: 'pdfPreviewReady', requestId: message.requestId, pdfBase64: previewDocuments[responseIndex] }
            }));
          }, 0);
        }
      },

      
      getState: /**
       * @returns 条件に一致する値。未検出時はundefinedまたはnull。
       */ () => undefined,

      
      setState: /**
       * PDF・プレビュー・スモーク検証の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
       */ () => undefined
    });
  }, previewPdfs);

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror',
  /**
   * pageerrorイベントで一覧追加を実行する。
   * @param error - ユーザー操作またはDOMから通知されたイベント。
   */
  (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.addStyleTag({ path: path.join(root, 'styles.css') });
  await page.addStyleTag({ path: path.join(root, 'webview.css') });
  await page.addScriptTag({ url: `http://127.0.0.1:${port}/webview.js` });
  await page.waitForFunction(
  /**
   * HostとWebviewのメッセージ状態が完了条件を満たすまで待機する。
   */
  () => window.__mveMessages.some(
  /**

   * @param message - HostとWebviewの間で受け渡すメッセージ。
   */
  (message) => message.type === 'ready'));

  const settings = {
    imageDirectory: 'assets/${documentBasename}',
    maxPasteSizeMb: 20,
    remoteImagesEnabled: false,
    mermaidTheme: 'default',
    workspaceTrusted: true,
    language: 'ja',
    editorTheme: 'dark',
    editorFontFamily: '',
    previewFontFamily: 'Test Preview Font',
    pdfOptions: { fontFamily: 'Test Preview Font' }
  };
  await page.evaluate(
   /** PDFをプレビューへ渡す初期化メッセージをブラウザーから送る。 */
  ({ text, initSettings }) => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'init', text, version: 1, uri: 'file:///C:/large.md', settings: initSettings }
    }));
  }, { text: largeSample, initSettings: settings });
  await page.locator('.split-editor').waitFor();
  await page.locator('[role="tab"]').nth(4).click();
  const exportButtons = page.locator('.ribbon-content button');
  // 印刷設定はプレビューとは独立したボタンから開く。
  await exportButtons.nth(0).click();
  await page.locator('.pdf-settings-panel').waitFor();
  // 保存した設定が何件あっても次の設定を追加できるよう、「新規保存」は常に見えていて、名前を入れて保存を要求できる。
  const addSavedSettings = page.locator('.pdf-settings-panel .output-preset-add-button');
  if (!(await addSavedSettings.isVisible())) throw new Error('The button to save new settings is not visible.');
  await addSavedSettings.click();
  await page.locator('.pdf-settings-panel .output-preset-name-edit input').fill('Smoke settings');
  await page.locator('.pdf-settings-panel .output-preset-name-edit input').press('Enter');
  const saveRequests = await page.evaluate(
  /**
   * 保存した設定の保存要求だけを取り出す。
   * @returns 送信された保存要求。
   */
  () => window.__mveMessages.filter((message) => message.type === 'saveOutputPreset'));
  if (saveRequests.length !== 1 || saveRequests[0].name !== 'Smoke settings' || saveRequests[0].presetId !== undefined
    || !saveRequests[0].values?.pdfOptions) {
    throw new Error(`Saving new settings did not send the expected request: ${JSON.stringify(saveRequests)}`);
  }
  // 保存するのは印刷設定パネルの項目（PDF設定）だけ。フォント・テーマ・HTML・DOCX は含めない。
  if (Object.keys(saveRequests[0].values).sort().join() !== 'pdfOptions') {
    throw new Error(`Saved settings included settings outside the print panel: ${Object.keys(saveRequests[0].values).join()}`);
  }
  if (await page.locator('.pdf-settings-panel .output-preset-name-edit').count() !== 0) {
    throw new Error('The name field stayed open after saving.');
  }
  // 保存した設定が1件あり選択中でも、2件目を追加できる（Hostの保存結果の通知を再現する）。
  const firstSaved = { id: 'user-0000aaaa-0001', name: 'Smoke settings', ...saveRequests[0].values };
  await page.evaluate(
  /**
   * 1件目を保存したあとにHostが送る設定通知を再現する。
   * @param args - 初期設定と保存済みの設定。
   */
  ({ base, saved }) => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'settingsChanged', settings: { ...base, outputPresets: [saved], activeOutputPresetId: saved.id } }
    }));
  }, { base: settings, saved: firstSaved });
  await page.locator('.pdf-settings-panel .output-preset-select option', { hasText: 'Smoke settings' }).waitFor({ state: 'attached' });
  await addSavedSettings.click();
  const secondNameInput = page.locator('.pdf-settings-panel .output-preset-name-edit input');
  if (await secondNameInput.inputValue() !== 'Smoke settings (2)') {
    throw new Error(`The second name was not suggested without a collision: ${await secondNameInput.inputValue()}`);
  }
  // 日本語入力の変換を確定するEnterでは保存しない。合成イベントでは keyCode を指定できない（0 になる）ため、
  // ここで検査するのは isComposing の分岐。keyCode 229 の分岐は実装側の同じ条件式で扱う。
  await secondNameInput.fill('二件目');
  await secondNameInput.evaluate(
  /**
   * 変換確定中のEnterを送る。
   * @param element - 名前欄。
   */
  (element) => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true })));
  const afterComposingEnter = await page.evaluate(
  /**
   * 保存要求の件数を数える。
   * @returns 保存要求の件数。
   */
  () => window.__mveMessages.filter((message) => message.type === 'saveOutputPreset').length);
  if (afterComposingEnter !== 1) throw new Error('Enter during IME composition saved the settings.');
  // 既存と同じ名前を入れても確認やエラーで止めず、ボタンが「上書き保存」になる。
  await secondNameInput.fill('smoke SETTINGS');
  const sameNameButton = page.locator('.pdf-settings-panel .output-preset-name-edit button.primary');
  if (await page.locator('.pdf-settings-panel .output-preset-name-error').count() !== 0
    || !(await sameNameButton.isEnabled())
    || (await sameNameButton.textContent())?.trim() !== '上書き保存') {
    throw new Error('A same name did not offer to overwrite without confirmation.');
  }
  await secondNameInput.fill('二件目');
  await secondNameInput.press('Enter');
  const secondRequests = await page.evaluate(
  /**
   * 2件目の保存要求を取り出す。
   * @returns 保存要求の一覧。
   */
  () => window.__mveMessages.filter((message) => message.type === 'saveOutputPreset'));
  if (secondRequests.length !== 2 || secondRequests[1].name !== '二件目' || secondRequests[1].presetId !== undefined) {
    throw new Error(`The second settings were not saved as new: ${JSON.stringify(secondRequests.map((item) => item.name))}`);
  }
  // 保存した設定を選ぶと、Hostの書き込み完了（利用者の環境では数秒かかる）を待たずに画面へ反映する。
  // 書き込み中に届く古い設定通知では戻らず、失敗の完了通知では実際の値へ戻る。
  // 2件目は以前の形式で保存されたフォント（今のフォントと違う値）を持つ。フォントは保存した印刷設定に含まれないので、
  // 選んでもプレビューのフォントは Test Preview Font のまま変わらないことを確かめる。
  const secondSaved = {
    ...firstSaved,
    id: 'user-0000aaaa-0002',
    name: 'Smoke A3',
    previewFontFamily: 'Old Saved Font',
    pdfOptions: { ...firstSaved.pdfOptions, format: 'A3', orientation: 'landscape', fontFamily: 'Old Saved Font' }
  };
  const presetSelect = page.locator('.pdf-settings-panel .output-preset-select');
  const paperFormat = page.locator('.pdf-settings-panel .pdf-paper-format');
  const firstFormat = firstSaved.pdfOptions.format;
  if (firstFormat === 'A3') throw new Error('The first saved settings must differ from A3 for this check.');
  /**
   * Hostが送る設定通知を再現する。
   * @param activeId - Hostが記録している最後に適用した設定のID。
   * @param pdfOptions - Hostの構成に書き込まれているPDF設定。
   */
  const sendHostSettings = (activeId, pdfOptions) => page.evaluate(
  /**
   * 設定通知を送る。
   * @param args - 初期設定、保存した設定、最後に適用したID、PDF設定。
   */
  ({ base, saved, activeId: id, pdf }) => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'settingsChanged', settings: { ...base, outputPresets: saved, activeOutputPresetId: id, pdfOptions: pdf } }
    }));
  }, { base: settings, saved: [firstSaved, secondSaved], activeId, pdf: pdfOptions });
  /**
   * Webviewが送った適用要求を読む。
   * @returns 適用要求の設定IDと要求番号の一覧（送信順）。
   */
  const applyRequestsSent = () => page.evaluate(
  /**
   * 適用要求を取り出す。
   * @returns 設定IDと要求番号。
   */
  () => window.__mveMessages.filter((message) => message.type === 'applyOutputPreset')
    .map((message) => ({ presetId: message.presetId, applyId: message.applyId })));
  /**
   * Hostの適用完了通知を、送信順で index 番目の適用要求への応答として再現する。
   * @param index - 応答する適用要求の位置（送信順、0始まり）。
   * @param succeeded - 書き込みに成功したか。
   */
  const sendApplied = async (index, succeeded) => {
    const request = (await applyRequestsSent())[index];
    if (!request) throw new Error(`No apply request at ${index}`);
    await page.evaluate(
    /**
     * 完了通知を送る。
     * @param args - 設定ID、要求番号、成否。
     */
    ({ presetId, applyId, ok }) => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'outputPresetApplied', presetId, applyId, succeeded: ok } }));
    }, { ...request, ok: succeeded });
  };
  /**
   * 選択欄と用紙サイズの表示を読む。
   * @returns 選択中の設定名と用紙サイズ。
   */
  const shownPreset = async () => ({
    name: (await presetSelect.locator('option:checked').textContent())?.trim(),
    format: await paperFormat.inputValue()
  });
  // Host 側の「同じフォルダへ直接出力」(PDF) をオンにしておく。保存した印刷設定には含まれないので、選んでも変わらない。
  await sendHostSettings(firstSaved.id, { ...firstSaved.pdfOptions, saveWithoutDialog: true });
  await presetSelect.locator('option', { hasText: 'Smoke A3' }).waitFor({ state: 'attached' });
  const directExport = page.locator('.ribbon-content input[type="checkbox"]').first();
  if (!(await directExport.isChecked())) throw new Error('The PDF direct-export checkbox was not turned on by the Host settings.');
  await presetSelect.selectOption(secondSaved.id);
  if (!(await directExport.isChecked())) throw new Error('Selecting saved print settings changed the PDF direct-export setting.');
  // フォントはプレビューと共通の設定で、保存した印刷設定に含まれない。選んでもプレビューのフォントは変わらない。
  const previewFontAfterSelect = await page.evaluate(
    /**
     * プレビューに効かせているフォントを読む。
     * @returns 文書ルートの --mve-preview-font-family。
     */
    () => document.documentElement.style.getPropertyValue('--mve-preview-font-family'));
  if (!previewFontAfterSelect.startsWith('Test Preview Font')) {
    throw new Error(`Selecting saved print settings changed the preview font: ${previewFontAfterSelect}`);
  }
  let shown = await shownPreset();
  if (shown.name !== 'Smoke A3' || shown.format !== 'A3') {
    throw new Error(`Selecting saved settings was not reflected before the Host finished: ${JSON.stringify(shown)}`);
  }
  // 書き込み前の値を持つ古い通知では、選んだ値を戻さない。
  await sendHostSettings(firstSaved.id, firstSaved.pdfOptions);
  shown = await shownPreset();
  if (shown.name !== 'Smoke A3' || shown.format !== 'A3') {
    throw new Error(`A stale settings notification reverted the selected settings: ${JSON.stringify(shown)}`);
  }
  // 書き込みが終わると、Hostの実際の値（ここでは選んだ値）のまま確定する。
  await sendHostSettings(secondSaved.id, secondSaved.pdfOptions);
  await sendApplied(0, true);
  shown = await shownPreset();
  if (shown.name !== 'Smoke A3' || shown.format !== 'A3') {
    throw new Error(`The applied settings did not stay after the Host finished: ${JSON.stringify(shown)}`);
  }
  // 書き込みに失敗した場合は、完了通知の直前に届いた実際の値へ戻る。
  await presetSelect.selectOption(firstSaved.id);
  if ((await shownPreset()).format !== firstFormat) throw new Error('Selecting the first saved settings was not reflected immediately.');
  await sendHostSettings(secondSaved.id, secondSaved.pdfOptions);
  await sendApplied(1, false);
  shown = await shownPreset();
  if (shown.name !== 'Smoke A3' || shown.format !== 'A3') {
    throw new Error(`A failed apply did not restore the actual settings: ${JSON.stringify(shown)}`);
  }
  // 同じ設定を続けて選ぶ（A→B→A）。最初の A の完了通知や、B の書き込み後の通知で、最後に選んだ A から戻らない。
  await presetSelect.selectOption(firstSaved.id);
  await presetSelect.selectOption(secondSaved.id);
  await presetSelect.selectOption(firstSaved.id);
  await sendHostSettings(firstSaved.id, firstSaved.pdfOptions);
  await sendApplied(2, true);
  await sendHostSettings(secondSaved.id, secondSaved.pdfOptions);
  shown = await shownPreset();
  if (shown.name !== 'Smoke settings' || shown.format !== firstFormat) {
    throw new Error(`An earlier completion for the same settings released the latest selection: ${JSON.stringify(shown)}`);
  }
  await sendApplied(3, true);
  await sendHostSettings(firstSaved.id, firstSaved.pdfOptions);
  await sendApplied(4, true);
  shown = await shownPreset();
  if (shown.name !== 'Smoke settings' || shown.format !== firstFormat) {
    throw new Error(`The latest selection did not stay after all writes finished: ${JSON.stringify(shown)}`);
  }
  const applyRequests = await applyRequestsSent();
  const expectedOrder = [secondSaved.id, firstSaved.id, firstSaved.id, secondSaved.id, firstSaved.id];
  if (applyRequests.map((request) => request.presetId).join() !== expectedOrder.join()
    || new Set(applyRequests.map((request) => request.applyId)).size !== applyRequests.length) {
    throw new Error(`Unexpected apply requests: ${JSON.stringify(applyRequests)}`);
  }
  // 新規保存で既存と同じ名前を確定すると、その設定への上書き保存を要求する（確認は出さない）。
  // 上書き前と違う値で上書きし、元に戻すが上書き前の内容を送ることを区別できるようにする。
  // どの保存した設定とも一致しない値（A3・縦）にして、選択中が1件目のまま「変更あり」になる状態から上書きする。
  await sendHostSettings(firstSaved.id, { ...firstSaved.pdfOptions, format: 'A3' });
  await addSavedSettings.click();
  await secondNameInput.fill('SMOKE settings');
  await secondNameInput.press('Enter');
  const overwriteRequest = await page.evaluate(
  /**
   * 最後の保存要求を取り出す。
   * @returns 保存要求。
   */
  () => window.__mveMessages.filter((message) => message.type === 'saveOutputPreset').at(-1));
  if (overwriteRequest?.presetId !== firstSaved.id || overwriteRequest?.name !== 'Smoke settings'
    || overwriteRequest.values?.pdfOptions?.format !== 'A3') {
    throw new Error(`Saving with an existing name did not overwrite it: ${JSON.stringify(overwriteRequest)}`);
  }
  // 上書きも確認なしで行い、状態行の「元に戻す」で上書き前の内容による保存し直しを要求する。
  const overwrittenText = (await page.locator('.pdf-settings-panel .output-preset-change').textContent())?.trim();
  if (overwrittenText !== '「Smoke settings」を上書きしました') throw new Error(`The overwrite was not reported: ${overwrittenText}`);
  await page.locator('.pdf-settings-panel .output-preset-status .output-preset-link', { hasText: '元に戻す' }).click();
  const revertRequest = await page.evaluate(
  /**
   * 最後の保存要求を取り出す。
   * @returns 保存要求。
   */
  () => window.__mveMessages.filter((message) => message.type === 'saveOutputPreset').at(-1));
  if (revertRequest?.presetId !== firstSaved.id || revertRequest.values?.pdfOptions?.format === 'A3'
    || JSON.stringify(revertRequest.values?.pdfOptions) !== JSON.stringify(firstSaved.pdfOptions)) {
    throw new Error(`Undo did not request restoring the overwritten settings: ${JSON.stringify(revertRequest?.presetId)}`);
  }
  // 削除は確認なしで即時に要求し、状態行の「元に戻す」で削除前の位置・選択状態のまま戻すよう要求する。
  await page.locator('.pdf-settings-panel .output-preset-menu-button').click();
  await page.locator('.pdf-settings-panel .output-preset-menu .output-preset-menu-danger').click();
  const deleteRequests = await page.evaluate(
  /**
   * 削除要求の対象IDを取り出す。
   * @returns 削除を要求した設定のID。
   */
  () => window.__mveMessages.filter((message) => message.type === 'deleteOutputPreset').map((message) => message.presetId));
  if (deleteRequests.join() !== firstSaved.id) throw new Error(`Delete was not requested immediately: ${deleteRequests.join()}`);
  if (await page.locator('.pdf-settings-panel .output-preset-confirm').count() !== 0) {
    throw new Error('A delete confirmation was shown.');
  }
  const deletedText = (await page.locator('.pdf-settings-panel .output-preset-change').textContent())?.trim();
  if (deletedText !== '「Smoke settings」を削除しました') throw new Error(`The deletion was not reported: ${deletedText}`);
  await page.locator('.pdf-settings-panel .output-preset-status .output-preset-link', { hasText: '元に戻す' }).click();
  const restoreRequest = await page.evaluate(
  /**
   * 削除の取り消し要求を取り出す。
   * @returns 取り消し要求。
   */
  () => window.__mveMessages.filter((message) => message.type === 'restoreOutputPreset').at(-1));
  if (restoreRequest?.preset?.id !== firstSaved.id || restoreRequest.index !== 0) {
    throw new Error(`Undo did not request restoring the deleted settings: ${JSON.stringify(restoreRequest && { id: restoreRequest.preset?.id, index: restoreRequest.index })}`);
  }
  if (await page.locator('.pdf-settings-panel .output-preset-change').count() !== 0) {
    throw new Error('The undo link stayed after undoing.');
  }
  // 以降の検査は1件目を選んだ状態から始める。
  await sendHostSettings(firstSaved.id, firstSaved.pdfOptions);
  // 本文サイズ・行間は常時表示し、見出し6段階・コード・段落間隔の8項目は詳細設定に折りたたむ（計10項目）。
  const typographyInputs = page.locator('.pdf-typography-fields input[type="number"]');
  const advancedNumberInputs = page.locator('.pdf-advanced-settings input[type="number"]');
  const typographyInputCount = await typographyInputs.count();
  const advancedNumberInputCount = await advancedNumberInputs.count();
  if (typographyInputCount !== 2 || advancedNumberInputCount !== 8) {
    throw new Error(`Typography settings did not render all 10 controls: main=${typographyInputCount}, advanced=${advancedNumberInputCount}`);
  }
  // 先頭の選択欄はプリセットのため、用紙サイズ欄は専用のclassで特定する。
  const paperSelect = page.locator('.pdf-settings-panel .pdf-paper-format');
  const paperOptions = await paperSelect.locator('option').allTextContents();
  if (paperOptions.join(',') !== 'A0,A1,A2,A3,A4,A5,A6,B4,B5') {
    throw new Error(`Unexpected paper size options: ${paperOptions.join(',')}`);
  }
  await typographyInputs.nth(0).click();
  await typographyInputs.nth(0).press('Control+A');
  await typographyInputs.nth(0).pressSequentially('13');
  await paperSelect.selectOption('B5');
  await page.locator('.pdf-settings-panel .panel-title button').click();
  if (await page.locator('.pdf-settings-panel').count() !== 0) {
    throw new Error('Print settings panel did not close.');
  }
  const savedPdfOptionMessages = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態のfilter結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveMessages
    .filter(
    /**
     * 種別「setPdfOptions」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。

     */
    (message) => message.type === 'setPdfOptions')
  );
  const savedPdfOptions = savedPdfOptionMessages.at(-1)?.options;
  if (savedPdfOptionMessages.length !== 1
    || savedPdfOptions?.bodyFontSize !== 13
    || savedPdfOptions?.format !== 'B5') {
    throw new Error(`PDF typography setting was not debounced/persisted: ${JSON.stringify(savedPdfOptionMessages)}`);
  }
  await exportButtons.nth(1).click();
  await page.waitForSelector('.pdf-preview-pdf-layer.is-preparing');
  const liveDuringPdfRender = await page.locator('.pdf-preview-live-layer').count();
  if (liveDuringPdfRender !== 1) throw new Error('Live preview was not shown while the actual PDF was rendering.');
  await page.waitForSelector('.pdf-page-ready');
  await page.waitForTimeout(500);

  const widthBeforeZoom = await page.locator('.pdf-page').first().evaluate(
  /**
   * @param element - PDFプレビューのズーム前に画像幅を測定する要素。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (element) => element.getBoundingClientRect().width);
  await page.locator('.pdf-page').first().hover();
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await page.waitForSelector('.pdf-page-ready');
  await page.waitForTimeout(500);
  const widthAfterZoom = await page.locator('.pdf-page').first().evaluate(
  /**
   * @param element - PDFプレビューを拡大した後に画像幅を測定する要素。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (element) => element.getBoundingClientRect().width);
  if (widthAfterZoom <= widthBeforeZoom) {
    throw new Error(`PDF zoom did not enlarge the page: ${widthBeforeZoom} -> ${widthAfterZoom}`);
  }

  await page.locator('.pdf-page').first().hover();
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 100);
  await page.keyboard.up('Control');
  await page.waitForSelector('.pdf-page-ready');
  await page.waitForTimeout(500);
  const widthAfterShrink = await page.locator('.pdf-page').first().evaluate(
  /**
   * @param element - PDFプレビューを縮小した後に画像幅を測定する要素。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (element) => element.getBoundingClientRect().width);
  if (widthAfterShrink >= widthAfterZoom) {
    throw new Error(`PDF zoom did not shrink the page: ${widthAfterZoom} -> ${widthAfterShrink}`);
  }

  await page.getByRole('button', { name: 'PDFズームイン' }).click();
  await page.waitForSelector('.pdf-page-ready');
  await page.waitForTimeout(500);
  const widthAfterButtonZoom = await page.locator('.pdf-page').first().evaluate(
  /**
   * @param element - PDFプレビューのボタン操作後に画像幅を測定する要素。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (element) => element.getBoundingClientRect().width);
  if (widthAfterButtonZoom <= widthAfterShrink) {
    throw new Error(`PDF zoom button did not enlarge the page: ${widthAfterShrink} -> ${widthAfterButtonZoom}`);
  }

  await page.waitForSelector('.pdf-preview-pdf-layer:not(.is-preparing)');
  const initialPageCount = Number(await page.locator('.pdf-pages').getAttribute('data-page-count'));
  await page.evaluate(
  /**
   * テーマ切替後の設定をHostメッセージとしてWebviewへ通知する。
   * @param lightSettings - ライトテーマを含む更新後のWebview設定。
   */
  (lightSettings) => window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'settingsChanged', settings: lightSettings }
  })), { ...settings, editorTheme: 'light' });
  await page.waitForFunction(
    /**
     * ライトテーマでのPDF再生成要求が送られたことを確認する。
     * @returns 対象テーマのPDF要求が存在するときtrue。
     */
    () => window.__mveMessages.some(
      /**
       * ライトテーマを指定したPDFプレビュー要求を選択する。
       * @param message - WebviewがHostへ送ったメッセージ。
       * @returns ライトテーマ向けのPDFプレビュー要求の場合はtrue。
       */
      (message) => message.type === 'renderPdfPreview' && message.editorTheme === 'light'));
  await page.waitForFunction(
    /**
     * 新しい1ページPDFが描画され、PDFレイヤーが表示状態へ戻ることを確認する。
     * @returns 新しいページの描画完了とレイヤー表示を確認できたときtrue。
     */
    () => Number(document.querySelector('.pdf-pages')?.getAttribute('data-page-count')) === 1
      && document.querySelector('.pdf-page-ready') !== null
      && document.querySelector('.pdf-preview-pdf-layer:not(.is-preparing)') !== null);

  const result = await page.evaluate(
  /**
   * ブラウザー内のPDFページ状態とズーム値を読み取り、検証用の値へ変換する。
   * @param metrics - ズーム操作前後の幅とテーマ切替前のページ数。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  ({ widthBeforeZoom, widthAfterZoom, widthAfterShrink, widthAfterButtonZoom, initialPageCount }) => ({
    previewMessages: window.__mveMessages.filter(
    /**
     * 種別「renderPdfPreview」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。

     */
    (message) => message.type === 'renderPdfPreview'),
    pages: initialPageCount,
    readyPages: document.querySelectorAll('.pdf-page-ready').length,
    visiblePdfLayers: document.querySelectorAll('.pdf-preview-pdf-layer:not(.is-preparing)').length,
    visibleLiveLayers: document.querySelectorAll('.pdf-preview-live-layer').length,
    themeTransitionPages: Number(document.querySelector('.pdf-pages')?.getAttribute('data-page-count') ?? 0),
    widthBeforeZoom,
    widthAfterZoom,
    widthAfterShrink,
    widthAfterButtonZoom,
    zoom: document.querySelector('.pdf-preview-shell')?.getAttribute('data-pdf-zoom'),
    debugEvents: (window.__mveDebugLog ?? [])
      .filter(
      /**
       * 種別「pdf.zoom-button」のエントリだけを残す。
       * @param entry - エントリのイベントを参照する走査対象。

       */
      (entry) => entry.event === 'pdf.zoom-button' || entry.event === 'zoom.changed')
      .map(
      /**
       * 各エントリからイベントを取り出して一覧化する。
       * @param entry - エントリのイベントを参照する走査対象。
       * @returns イベントを取り出した変換結果の一覧。
       */
      (entry) => entry.event)
  }), { widthBeforeZoom, widthAfterZoom, widthAfterShrink, widthAfterButtonZoom, initialPageCount });
  result.requests = result.previewMessages.length;
  result.previewCssChars = Math.max(...result.previewMessages.map(
  /**
   * 各メッセージからcssを取り出して一覧化する。
   * @param message - メッセージのcssを参照する走査対象。
   * @returns cssを取り出した変換結果の一覧。
   */
  (message) => message.css?.length ?? 0), 0);
  if (!result.previewMessages[0]?.css?.includes('body{font-family:Test Preview Font, "Noto Sans JP", "Yu Gothic UI", sans-serif;')) {
    throw new Error('Preview font was not applied to the PDF preview CSS.');
  }
  if (pageErrors.length) throw new Error(`PDF preview page error: ${pageErrors.join(' / ')}`);
  if (result.requests !== 2 || result.previewCssChars >= 200_000
    || result.pages < 2 || result.readyPages < 1 || result.visiblePdfLayers !== 1 || result.visibleLiveLayers !== 0) {
    throw new Error(`PDF preview smoke failed: ${JSON.stringify(result)}`);
  }
  if (!result.debugEvents.includes('pdf.zoom-button') || result.debugEvents.filter(
  /**
   * 条件を満たすイベントだけを残す。
   * @param event - zoom.changed debug eventを数える一覧要素。

   */
  (event) => event === 'zoom.changed').length < 3) {
    throw new Error(`PDF zoom debug events missing: ${JSON.stringify(result.debugEvents)}`);
  }
  console.log(`PDF preview metrics: requests=${result.requests}, cssChars=${result.previewCssChars}`);
  console.log(`PDFプレビュー確認: 初期${result.pages}ページ、テーマ切替後${result.themeTransitionPages}ページ、描画済み${result.readyPages}ページ、表示PDFレイヤー${result.visiblePdfLayers}件、要求${result.requests}回、幅${result.widthBeforeZoom}->${result.widthAfterZoom}->${result.widthAfterShrink}->${result.widthAfterButtonZoom}`);
  await context.close();
} finally {
  await browser.close();
  await new Promise(
  /**
   * 非同期処理の閉じる通知を待機側へ渡す。
   * @param resolve - Promiseの成功を通知する関数。
   */
  (resolve) => server.close(resolve));
}

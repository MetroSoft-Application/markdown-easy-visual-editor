/**
 * @file pdf-preview-smoke.mjs
 * 実行境界: 開発・検証スクリプト。
 * 責務: ビルド、スモーク、統合検証または補助生成を実行する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: プロセス、生成物、Webview、VS Code、Chromiumなどの外部環境を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * ファイルを取得または解決します。
 * @param root 処理対象のルートです。
 * @param name 対象を識別する名前で、表示または処理分岐に使用します。
 * @returns 「findFile」が読み取りまたは正規化した結果を返します。
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

/** 「executablePath」は、対象ファイルまたは実行環境の場所を表す値です。 */
const executablePath = await findFile(path.resolve('.chromium'), 'chrome-headless-shell.exe');
if (!executablePath) throw new Error('Chromiumがありません。npm run pdf:install-browserを実行してください。');

/** 「root」は、対象ファイルまたは実行環境の場所を表す値です。 */
const root = path.resolve('dist');
/** 「largeSample」は、関連する処理間で共有する設定値または状態です。 */
const largeSample = (await readFile('sample/09-large-document.md', 'utf8')).replace(/\r\n?/g, '\n');
/** 「server」は、関連する処理間で共有する設定値または状態です。 */
const server = createServer(
/**
 * 「async」として「request」「response」を受け取り、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param request 処理対象の要求です。
 * @param response 「response」は、「async」がPDFプレビュー・出力の処理対象を特定する入力です。
 * @returns 「slice」を実行し、値を返しません。
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
 * Promiseの完了または失敗を通知し、非同期処理の状態を確定するコールバックです。
 * @param resolve Promiseの完了または失敗を通知する関数です。
 * @returns 「server.listen」を実行し、値を返しません。
 */
(resolve) => server.listen(0, '127.0.0.1', resolve));
/** 「port」は、関連する処理間で共有する設定値または状態です。 */
const port = server.address().port;
/** 「browser」は、ブラウザー処理の共有状態または実行設定です。 */
const browser = await chromium.launch({ executablePath, headless: true });

try {
  const pdfSource = await browser.newPage();
  await pdfSource.setContent('<!doctype html><html><body>'
    + '<h1>PDF preview smoke</h1><p>large document page content</p>'.repeat(160)
    + '</body></html>');
  const pdfBase64 = (await pdfSource.pdf({ format: 'A4', printBackground: true })).toString('base64');
  await pdfSource.close();

  const context = await browser.newContext();
  await context.addInitScript(
  /**
 * ブラウザーのWebviewテストで使用するグローバル状態を初期化するコールバックです。
   * @param previewPdf previewPdfとして渡される、このコールバックの入力値です。
   * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
   */
  (previewPdf) => {
    window.__mveDebugEnabled = true;
    window.__mveMessages = [];
    window.acquireVsCodeApi =
    /**
 * WebviewテストへVS Code API互換オブジェクトを提供するコールバックです。
     * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
     */
    () => ({

      /**
       * 「postMessage」は、言語や通信契約に応じた表示文言または対応表を保持します。
       * @param message 処理対象のメッセージです。
       * @returns メッセージをHostまたはWebviewへ送信し、値は返しません。
       */
      postMessage: /**
 * 「postMessage」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param message 「message」は、「postMessage」がPDFで処理する対象を特定する入力です。
 * @returns メッセージをHostまたはWebviewへ送信し、値は返しません。
 */ (message) => {
        window.__mveMessages.push(message);
        if (message.type === 'renderPdfPreview') {
          setTimeout(
          /**
 * 指定時間の経過後に遅延処理を実行するコールバックです。
           * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
           */
          () => window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'pdfPreviewReady', requestId: message.requestId, pdfBase64: previewPdf }
          })), 0);
        }
      },

      /**
       * 状態を取得または解決します。
       * @returns Hostが保持する保存済み状態を返し、未保存の場合はundefinedを返します。
       */
      getState: /**
 * 「getState」は、要求された状態、値、または対象を読み取ります。
 * @returns Hostが保持する保存済み状態を返し、未保存の場合はundefinedを返します。
 */ () => undefined,

      /**
       * 状態を更新または保存します。
       * @returns 指定された状態をHostへ保存し、値は返しません。
       */
      setState: /**
 * 「setState」は、入力を検証して対象の状態または内容へ適用します。
 * @returns 指定された状態をHostへ保存し、値は返しません。
 */ () => undefined
    });
  }, pdfBase64);

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror',
  /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
   * @param error 発生したエラーです。
   * @returns 「pageErrors.push」を実行し、値を返しません。
   */
  (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.addStyleTag({ path: path.join(root, 'styles.css') });
  await page.addStyleTag({ path: path.join(root, 'webview.css') });
  await page.addScriptTag({ url: `http://127.0.0.1:${port}/webview.js` });
  await page.waitForFunction(
  /**
 * Webviewへメッセージイベントを発火する処理を実行するコールバックです。
   * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
   */
  () => window.__mveMessages.some(
  /**
 * 「message」が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
   * @param message 処理対象のメッセージです。
   * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
   */
  (message) => message.type === 'ready'));

  const settings = {
    imageDirectory: 'assets/${documentBasename}',
    maxPasteSizeMb: 20,
    remoteImagesEnabled: false,
    mermaidTheme: 'default',
    workspaceTrusted: true,
    language: 'ja',
    editorFontFamily: '',
    previewFontFamily: 'Test Preview Font',
    pdfOptions: { fontFamily: 'Test Preview Font' }
  };
  await page.evaluate(
  /**
 * 「text」「initSettings」を受け取り、Webviewへメッセージイベントを発火する処理です。
   * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはtext、initSettingsです。
   * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
   */
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
  const typographyInputs = page.locator('.pdf-typography-fields input');
  const typographyInputCount = await typographyInputs.count();
  if (typographyInputCount !== 10) {
    throw new Error(`Typography settings did not render all 10 controls after moving the font setting: ${typographyInputCount}`);
  }
  const paperOptions = await page.locator('.pdf-settings-panel select').first().locator('option').allTextContents();
  if (paperOptions.join(',') !== 'A0,A1,A2,A3,A4,A5,A6,B4,B5') {
    throw new Error(`Unexpected paper size options: ${paperOptions.join(',')}`);
  }
  await typographyInputs.nth(0).click();
  await typographyInputs.nth(0).press('Control+A');
  await typographyInputs.nth(0).pressSequentially('13');
  await page.locator('.pdf-settings-panel select').first().selectOption('B5');
  await page.locator('.pdf-settings-panel .panel-title button').click();
  if (await page.locator('.pdf-settings-panel').count() !== 0) {
    throw new Error('Print settings panel did not close.');
  }
  const savedPdfOptionMessages = await page.evaluate(
  /**
 * WebviewのDOMまたは状態を読み取り、検証側へ値を返すコールバックです。
   * @returns Webviewの状態から取得した値を返します。
   */
  () => window.__mveMessages
    .filter(
    /**
 * 「message」が条件に一致するか判定し、残す要素を決めるコールバックです。
     * @param message 処理対象のメッセージです。
     * @returns 要素を採用するかどうかの真偽値を返します。
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
 * 「element」を受け取り、登録された副作用または結果を生成する処理です。
   * @param element 処理対象の要素です。
   * @returns 「element」から生成した処理結果を返します。
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
 * 「element」を受け取り、登録された副作用または結果を生成する処理です。
   * @param element 処理対象の要素です。
   * @returns 「element」から生成した処理結果を返します。
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
 * 「element」を受け取り、登録された副作用または結果を生成する処理です。
   * @param element 処理対象の要素です。
   * @returns 「element」から生成した処理結果を返します。
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
 * WebviewのDOMまたは状態を読み取り、検証側へ値を返すコールバックです。
   * @param element 処理対象の要素です。
   * @returns 「element」から生成した処理結果を返します。
   */
  (element) => element.getBoundingClientRect().width);
  if (widthAfterButtonZoom <= widthAfterShrink) {
    throw new Error(`PDF zoom button did not enlarge the page: ${widthAfterShrink} -> ${widthAfterButtonZoom}`);
  }

  const result = await page.evaluate(
  /**
 * WebviewのDOMまたは状態を読み取り、検証側へ値を返すコールバックです。
   * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはwidthBeforeZoom、widthAfterZoom、widthAfterShrink、widthAfterButtonZoomです。
   * @returns 初期化したオブジェクト（previewMessages、pages、readyPages、visiblePdfLayers、layer）を返します。
   */
  ({ widthBeforeZoom, widthAfterZoom, widthAfterShrink, widthAfterButtonZoom }) => ({
    previewMessages: window.__mveMessages.filter(
    /**
 * 「message」が条件に一致するか判定し、残す要素を決めるコールバックです。
     * @param message 処理対象のメッセージです。
     * @returns 要素を採用するかどうかの真偽値を返します。
     */
    (message) => message.type === 'renderPdfPreview'),
    pages: Number(document.querySelector('.pdf-pages')?.getAttribute('data-page-count') ?? 0),
    readyPages: document.querySelectorAll('.pdf-page-ready').length,
    visiblePdfLayers: document.querySelectorAll('.pdf-preview-pdf-layer:not(.is-preparing)').length,
    visibleLiveLayers: document.querySelectorAll('.pdf-preview-live-layer').length,
    widthBeforeZoom,
    widthAfterZoom,
    widthAfterShrink,
    widthAfterButtonZoom,
    zoom: document.querySelector('.pdf-preview-shell')?.getAttribute('data-pdf-zoom'),
    debugEvents: (window.__mveDebugLog ?? [])
      .filter(
      /**
 * 「entry」が条件に一致するか判定し、残す要素を決めるコールバックです。
       * @param entry entryとして渡される、このコールバックの入力値です。
       * @returns 要素を採用するかどうかの真偽値を返します。
       */
      (entry) => entry.event === 'pdf.zoom-button' || entry.event === 'zoom.changed')
      .map(
      /**
 * 「entry」を変換し、変換後の要素を返すコールバックです。
       * @param entry entryとして渡される、このコールバックの入力値です。
       * @returns 入力要素から生成した変換後の値を返します。
       */
      (entry) => entry.event)
  }), { widthBeforeZoom, widthAfterZoom, widthAfterShrink, widthAfterButtonZoom });
  result.requests = result.previewMessages.length;
  result.previewCssChars = Math.max(...result.previewMessages.map(
  /**
 * 「message」を変換し、変換後の要素を返すコールバックです。
   * @param message 処理対象のメッセージです。
   * @returns 入力要素から生成した変換後の値を返します。
   */
  (message) => message.css?.length ?? 0), 0);
  if (!result.previewMessages[0]?.css?.includes('body{font-family:Test Preview Font, "Noto Sans JP", "Yu Gothic UI", sans-serif;')) {
    throw new Error('Preview font was not applied to the PDF preview CSS.');
  }
  if (pageErrors.length) throw new Error(`PDF preview page error: ${pageErrors.join(' / ')}`);
  if (result.requests !== 1 || result.previewCssChars >= 200_000
    || result.pages < 2 || result.readyPages < 1 || result.visiblePdfLayers !== 1 || result.visibleLiveLayers !== 0) {
    throw new Error(`PDF preview smoke failed: ${JSON.stringify(result)}`);
  }
  if (!result.debugEvents.includes('pdf.zoom-button') || result.debugEvents.filter(
  /**
 * 「event」が条件に一致するか判定し、残す要素を決めるコールバックです。
   * @param event 処理対象のイベントです。
   * @returns 要素を採用するかどうかの真偽値を返します。
   */
  (event) => event === 'zoom.changed').length < 3) {
    throw new Error(`PDF zoom debug events missing: ${JSON.stringify(result.debugEvents)}`);
  }
  console.log(`PDF preview metrics: requests=${result.requests}, cssChars=${result.previewCssChars}`);
  console.log(`PDFプレビュー確認: ${result.pages}ページ、描画済み${result.readyPages}ページ、要求${result.requests}回、幅${result.widthBeforeZoom}->${result.widthAfterZoom}->${result.widthAfterShrink}->${result.widthAfterButtonZoom}`);
  await context.close();
} finally {
  await browser.close();
  await new Promise(
  /**
 * Promiseの完了または失敗を通知し、非同期処理の状態を確定するコールバックです。
   * @param resolve Promiseの完了または失敗を通知する関数です。
   * @returns Promiseの完了または失敗を通知し、値を返しません。
   */
  (resolve) => server.close(resolve));
}

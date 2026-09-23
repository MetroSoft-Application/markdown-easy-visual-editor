/**
 * @fileoverview PDF・プレビュー・スモーク検証を開発・検証環境で実行する。前提条件や失敗条件を終了コードとログで示す。
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * 指定した名前のファイルを検証用ディレクトリから再帰的に探す。
 * @param root - PDF・プレビュー・スモーク検証へ渡す入力。
 * @param name - PDF・プレビュー・スモーク検証の対象や分岐を識別する値。
 * @returns PDF・プレビュー・スモーク検証のfind・fileが生成する結果。
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
 * PDF・プレビュー・スモーク検証のlarge・sampleとして読み込んだ本文または設定。
 */
const largeSample = (await readFile('sample/09-large-document.md', 'utf8')).replace(/\r\n?/g, '\n');
/**
 * PDF・プレビュー・スモーク検証のserverとして読み込んだ本文または設定。
 */
const server = createServer(
/**
 * requestをsliceへ渡し、PDF・プレビュー・スモーク検証の結果または副作用を処理する。
 * @param request - PDF・プレビュー・スモーク検証へ渡す入力。
 * @param response - PDF・プレビュー・スモーク検証へ渡す入力。
 * @returns PDF・プレビュー・スモーク検証のコールバックが生成する結果。
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
 * @returns 非同期処理の完了値。
 */
(resolve) => server.listen(0, '127.0.0.1', resolve));
/**
 * PDF・プレビュー・スモーク検証のportとして利用する実行環境または外部資源。
 */
const port = server.address().port;
/**
 * PDF・プレビュー・スモーク検証の位置・寸法・件数・時間を表す数値。
 */
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
   * preview・pdfを一覧追加へ渡し、PDF・プレビュー・スモーク検証の結果または副作用を処理する。
   * @param previewPdf - PDF・プレビュー・スモーク検証へ渡す入力。
   * @returns PDF・プレビュー・スモーク検証のコールバックが生成する結果。
   */
  (previewPdf) => {
    window.__mveDebugEnabled = true;
    window.__mveMessages = [];
    window.acquireVsCodeApi =
    /**
     * WebviewからVS Codeのメッセージ送信・状態保存APIを取得する。
     * @returns VS Codeのメッセージ送信・状態保存API。
     */
    () => ({

      
      postMessage: /**
       * PDF・プレビュー・スモーク検証の変更または要求をHost・Webview間へ通知する。
       * @param message - HostとWebviewの間で受け渡すメッセージ。
       * @returns PDF・プレビュー・スモーク検証のpost・messageが生成する結果。
       */ (message) => {
        window.__mveMessages.push(message);
        if (message.type === 'renderPdfPreview') {
          setTimeout(
          /**
           * 指定時間の経過後に後続処理を実行する。
           * @returns 副作用を完了し、値は返さない。
           */
          () => window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'pdfPreviewReady', requestId: message.requestId, pdfBase64: previewPdf }
          })), 0);
        }
      },

      
      getState: /**
       * PDF・プレビュー・スモーク検証から必要な値またはリソースを取得する。
       * @returns 条件に一致する値。未検出時はundefinedまたはnull。
       */ () => undefined,

      
      setState: /**
       * PDF・プレビュー・スモーク検証の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
       * @returns 副作用を完了し、値は返さない。
       */ () => undefined
    });
  }, pdfBase64);

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror',
  /**
   * pageerrorイベントで一覧追加を実行する。
   * @param error - ユーザー操作またはDOMから通知されたイベント。
   * @returns 副作用を完了し、値は返さない。
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
   * @returns PDF・プレビュー・スモーク検証のコールバックが生成する結果。
   */
  () => window.__mveMessages.some(
  /**
   * PDF・プレビュー・スモーク検証のコールバックとしてメッセージを処理する。
   * @param message - HostとWebviewの間で受け渡すメッセージ。
   * @returns PDF・プレビュー・スモーク検証のコールバックが生成する結果。
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
   * Webviewの実行状態のdispatch・event結果を読み取り、検証用の値へ変換する。
   * @param options - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
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
   * HostとWebviewのメッセージ状態のfilter結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveMessages
    .filter(
    /**
     * 種別「setPdfOptions」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
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
   * ブラウザー内の状態のget・bounding・client・rect結果を読み取り、検証用の値へ変換する。
   * @param element - ブラウザー内で評価するコールバック。
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
   * ブラウザー内の状態のget・bounding・client・rect結果を読み取り、検証用の値へ変換する。
   * @param element - ブラウザー内で評価するコールバック。
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
   * ブラウザー内の状態のget・bounding・client・rect結果を読み取り、検証用の値へ変換する。
   * @param element - ブラウザー内で評価するコールバック。
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
   * ブラウザー内の状態のget・bounding・client・rect結果を読み取り、検証用の値へ変換する。
   * @param element - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (element) => element.getBoundingClientRect().width);
  if (widthAfterButtonZoom <= widthAfterShrink) {
    throw new Error(`PDF zoom button did not enlarge the page: ${widthAfterShrink} -> ${widthAfterButtonZoom}`);
  }

  const result = await page.evaluate(
  /**
   * ブラウザー内の「.pdf-pages」を読み取り、検証用の値へ変換する。
   * @param options - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  ({ widthBeforeZoom, widthAfterZoom, widthAfterShrink, widthAfterButtonZoom }) => ({
    previewMessages: window.__mveMessages.filter(
    /**
     * 種別「renderPdfPreview」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
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
       * 種別「pdf.zoom-button」のエントリだけを残す。
       * @param entry - エントリのイベントを参照する走査対象。
       * @returns 条件を満たした要素だけを含む一覧。
       */
      (entry) => entry.event === 'pdf.zoom-button' || entry.event === 'zoom.changed')
      .map(
      /**
       * 各エントリからイベントを取り出して一覧化する。
       * @param entry - エントリのイベントを参照する走査対象。
       * @returns イベントを取り出した変換結果の一覧。
       */
      (entry) => entry.event)
  }), { widthBeforeZoom, widthAfterZoom, widthAfterShrink, widthAfterButtonZoom });
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
  if (result.requests !== 1 || result.previewCssChars >= 200_000
    || result.pages < 2 || result.readyPages < 1 || result.visiblePdfLayers !== 1 || result.visibleLiveLayers !== 0) {
    throw new Error(`PDF preview smoke failed: ${JSON.stringify(result)}`);
  }
  if (!result.debugEvents.includes('pdf.zoom-button') || result.debugEvents.filter(
  /**
   * 条件を満たすイベントだけを残す。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @returns 条件を満たした要素だけを含む一覧。
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
   * 非同期処理の閉じる通知を待機側へ渡す。
   * @param resolve - Promiseの成功を通知する関数。
   * @returns 非同期処理の完了値。
   */
  (resolve) => server.close(resolve));
}

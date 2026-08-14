import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

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

const executablePath = await findFile(path.resolve('.chromium'), 'chrome-headless-shell.exe');
if (!executablePath) throw new Error('Chromiumがありません。npm run pdf:install-browserを実行してください。');

const root = path.resolve('dist');
const largeSample = await readFile('sample/09-large-document.md', 'utf8');
const server = createServer(async (request, response) => {
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

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const browser = await chromium.launch({ executablePath, headless: true });

try {
  const pdfSource = await browser.newPage();
  await pdfSource.setContent('<!doctype html><html><body>'
    + '<h1>PDF preview smoke</h1><p>large document page content</p>'.repeat(160)
    + '</body></html>');
  const pdfBase64 = (await pdfSource.pdf({ format: 'A4', printBackground: true })).toString('base64');
  await pdfSource.close();

  const context = await browser.newContext();
  await context.addInitScript((previewPdf) => {
    window.__mveMessages = [];
    window.acquireVsCodeApi = () => ({
      postMessage: (message) => {
        window.__mveMessages.push(message);
        if (message.type === 'renderPdfPreview') {
          setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'pdfPreviewReady', requestId: message.requestId, pdfBase64: previewPdf }
          })), 0);
        }
      },
      getState: () => undefined,
      setState: () => undefined
    });
  }, pdfBase64);

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.addStyleTag({ path: path.join(root, 'styles.css') });
  await page.addScriptTag({ url: `http://127.0.0.1:${port}/webview.js` });
  await page.waitForFunction(() => window.__mveMessages.some((message) => message.type === 'ready'));

  const settings = {
    imageDirectory: 'assets/${documentBasename}',
    maxPasteSizeMb: 20,
    remoteImagesEnabled: false,
    mermaidTheme: 'default',
    workspaceTrusted: true,
    language: 'ja'
  };
  await page.evaluate(({ text, initSettings }) => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'init', text, version: 1, uri: 'file:///C:/large.md', settings: initSettings }
    }));
  }, { text: largeSample, initSettings: settings });
  await page.locator('.split-editor').waitFor();
  await page.locator('[role="tab"]').nth(4).click();
  await page.locator('.ribbon-content button').first().click();
  await page.waitForSelector('.pdf-preview-pdf-layer.is-preparing');
  const fallbackDuringPdfRender = await page.locator('.pdf-preview-dom-layer:not(.is-hidden)').count();
  if (fallbackDuringPdfRender !== 1) throw new Error('DOM preview disappeared while PDF.js was rendering.');
  const fallbackWidthBeforeZoom = await page.locator('.pdf-preview-sheet').first().evaluate((element) => element.getBoundingClientRect().width);
  await page.getByRole('button', { name: 'PDFズームイン' }).click();
  await page.waitForFunction(() => document.querySelector('.pdf-preview-shell')?.getAttribute('data-pdf-zoom') === '1.1');
  const fallbackWidthAfterZoom = await page.locator('.pdf-preview-sheet').first().evaluate((element) => element.getBoundingClientRect().width);
  if (fallbackWidthAfterZoom <= fallbackWidthBeforeZoom) {
    throw new Error(`DOM PDF preview zoom did not enlarge the fallback: ${fallbackWidthBeforeZoom} -> ${fallbackWidthAfterZoom}`);
  }

  await page.locator('.pdf-settings-panel .panel-title button').click();
  if (await page.locator('.pdf-settings-panel').count() !== 0
    || await page.locator('.app.print-preview-mode').count() !== 1) {
    throw new Error('Closing print settings unexpectedly closed print preview.');
  }
  await page.locator('.ribbon-content button').first().click();
  await page.locator('.pdf-settings-panel').waitFor();
  await page.waitForSelector('.pdf-page-ready');
  await page.waitForTimeout(500);

  const widthBeforeZoom = await page.locator('.pdf-page').first().evaluate((element) => element.getBoundingClientRect().width);
  await page.locator('.pdf-page').first().hover();
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await page.waitForSelector('.pdf-page-ready');
  await page.waitForTimeout(500);
  const widthAfterZoom = await page.locator('.pdf-page').first().evaluate((element) => element.getBoundingClientRect().width);
  if (widthAfterZoom <= widthBeforeZoom) {
    throw new Error(`PDF zoom did not enlarge the page: ${widthBeforeZoom} -> ${widthAfterZoom}`);
  }

  await page.locator('.pdf-page').first().hover();
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 100);
  await page.keyboard.up('Control');
  await page.waitForSelector('.pdf-page-ready');
  await page.waitForTimeout(500);
  const widthAfterShrink = await page.locator('.pdf-page').first().evaluate((element) => element.getBoundingClientRect().width);
  if (widthAfterShrink >= widthAfterZoom) {
    throw new Error(`PDF zoom did not shrink the page: ${widthAfterZoom} -> ${widthAfterShrink}`);
  }

  await page.getByRole('button', { name: 'PDFズームイン' }).click();
  await page.waitForSelector('.pdf-page-ready');
  await page.waitForTimeout(500);
  const widthAfterButtonZoom = await page.locator('.pdf-page').first().evaluate((element) => element.getBoundingClientRect().width);
  if (widthAfterButtonZoom <= widthAfterShrink) {
    throw new Error(`PDF zoom button did not enlarge the page: ${widthAfterShrink} -> ${widthAfterButtonZoom}`);
  }

  const result = await page.evaluate(({ widthBeforeZoom, widthAfterZoom, widthAfterShrink, widthAfterButtonZoom, fallbackWidthBeforeZoom, fallbackWidthAfterZoom }) => ({
    requests: window.__mveMessages.filter((message) => message.type === 'renderPdfPreview').length,
    pages: Number(document.querySelector('.pdf-pages')?.getAttribute('data-page-count') ?? 0),
    readyPages: document.querySelectorAll('.pdf-page-ready').length,
    widthBeforeZoom,
    widthAfterZoom,
    widthAfterShrink,
    widthAfterButtonZoom,
    fallbackWidthBeforeZoom,
    fallbackWidthAfterZoom,
    zoom: document.querySelector('.pdf-preview-shell')?.getAttribute('data-pdf-zoom'),
    debugEvents: (window.__mveDebugLog ?? [])
      .filter((entry) => entry.event === 'pdf.zoom-button' || entry.event === 'zoom.changed')
      .map((entry) => entry.event)
  }), { widthBeforeZoom, widthAfterZoom, widthAfterShrink, widthAfterButtonZoom, fallbackWidthBeforeZoom, fallbackWidthAfterZoom });
  if (pageErrors.length) throw new Error(`PDF preview page error: ${pageErrors.join(' / ')}`);
  if (result.requests < 1 || result.pages < 2 || result.readyPages < 1) {
    throw new Error(`PDF preview smoke failed: ${JSON.stringify(result)}`);
  }
  if (!result.debugEvents.includes('pdf.zoom-button') || result.debugEvents.filter((event) => event === 'zoom.changed').length < 3) {
    throw new Error(`PDF zoom debug events missing: ${JSON.stringify(result.debugEvents)}`);
  }
  console.log(`PDFプレビュー確認: ${result.pages}ページ、描画済み${result.readyPages}ページ、要求${result.requests}回、幅${result.widthBeforeZoom}->${result.widthAfterZoom}->${result.widthAfterShrink}->${result.widthAfterButtonZoom}`);
  await context.close();
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

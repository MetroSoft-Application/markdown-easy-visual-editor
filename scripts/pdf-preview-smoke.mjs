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

  await page.locator('.pdf-settings-panel .panel-title button').click();
  if (await page.locator('.pdf-settings-panel').count() !== 0
    || await page.locator('.app.print-preview-mode').count() !== 1) {
    throw new Error('Closing print settings unexpectedly closed print preview.');
  }
  await page.locator('.ribbon-content button').first().click();
  await page.locator('.pdf-settings-panel').waitFor();
  await page.waitForSelector('.pdf-page-ready');
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => ({
    requests: window.__mveMessages.filter((message) => message.type === 'renderPdfPreview').length,
    pages: Number(document.querySelector('.pdf-pages')?.getAttribute('data-page-count') ?? 0),
    readyPages: document.querySelectorAll('.pdf-page-ready').length
  }));
  if (pageErrors.length) throw new Error(`PDF preview page error: ${pageErrors.join(' / ')}`);
  if (result.requests < 1 || result.pages < 2 || result.readyPages < 1) {
    throw new Error(`PDF preview smoke failed: ${JSON.stringify(result)}`);
  }
  console.log(`PDFプレビュー確認: ${result.pages}ページ、描画済み${result.readyPages}ページ、要求${result.requests}回`);
  await context.close();
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

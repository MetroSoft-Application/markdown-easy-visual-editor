/**
 * @fileoverview VS Code上で初期化後の遅延読み込み、Worker応答、PDF依存ランタイムの利用開始を確認する。
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * lazy・ランタイム・スモーク検証で読み書きするリソースの場所。
 */
const executablePath = await findFile(path.resolve('.chromium'), 'chrome-headless-shell.exe');
if (!executablePath) throw new Error('Chromium がありません。npm run pdf:install-browser を実行してください。');

/**
 * lazy・ランタイム・スモーク検証の条件を示すフラグ。
 */
const allowedAssets = new Set([
  'export-fonts.css',
  'markdown-fallback.js',
  'markdown-worker.js',
  'markdown-rich-worker.js',
  'marp-frame.js',
  'marp-worker.js',
  'mermaid.min.js',
  'styles.css',
  'webview.css',
  'webview.js'
]);
let raceWorkerStarted = false;
const stalledResourceRequests = new Set();
let marpFrameNotFoundResponseCount = 0;
/**
 * ビルド済みWebview資材の許可リストだけをlocalhostへ配信するテスト用HTTP server。
 */
const server = createServer(
/**
  * Webview shellと許可済みdist資材だけを返し、その他のURLを404にする。
  * @param request - HTTP要求。
  * @param response - テストfixtureへ返すHTTP応答。
 */
async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/race-worker-start') {
      raceWorkerStarted = true;
      response.writeHead(204).end();
      return;
    }
    if (url.pathname === '/hang-marp-worker-response-start') {
      stalledResourceRequests.add(url.pathname);
      response.writeHead(204, { 'Access-Control-Allow-Origin': '*' }).end();
      return;
    }
    if (url.pathname === '/hang-marp-worker.js' || url.pathname === '/hang-marp-frame.js') {
      stalledResourceRequests.add(url.pathname);
      return;
    }
    if (url.pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end('<!doctype html><html><head></head><body><div id="root"></div></body></html>');
      return;
    }
    const match = /^\/dist\/(.+)$/.exec(url.pathname);
    if (!match) {
      response.writeHead(404).end('not found');
      return;
    }
    const fileName = decodeURIComponent(match[1]);
    if (fileName === 'marp-worker-invalid.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
        .end('self.addEventListener("message", event => self.postMessage({ id: event.data.id, slides: "invalid", sourceRanges: [], css: "" }));');
      return;
    }
    if (fileName === 'marp-frame-not-found.js') {
      marpFrameNotFoundResponseCount += 1;
      response.writeHead(404, { 'Access-Control-Allow-Origin': '*' }).end('not found');
      return;
    }
    if (fileName === 'marp-frame-layout-unavailable.js') {
      const frameScript = await readFile(path.resolve('dist', 'marp-frame.js'), 'utf8');
      const forceZeroSlideHeight = `const mveOriginalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'); Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.classList?.contains('mve-marp-slide') ? 0 : mveOriginalOffsetHeight.get.call(this); } });`;
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
        .end(`${forceZeroSlideHeight}\n${frameScript}`);
      return;
    }
    if (fileName === 'marp-worker-no-response.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
        .end(`self.addEventListener("message", () => fetch("${origin}/hang-marp-worker-response-start").catch(() => {}));`);
      return;
    }
    if (fileName === 'marp-frame-no-ready.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
        .end('document.documentElement.dataset.mveFrameLoaded = "true";');
      return;
    }
    if (fileName === 'marp-worker-race.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }).end(`self.addEventListener("message", event => {
        const markdown = event.data.markdown;
        const heading = markdown.includes("Latest generation") ? "Latest generation" : "Stale generation";
        const delay = heading === "Stale generation" ? 700 : 10;
        fetch("${origin}/race-worker-start").catch(() => {});
        setTimeout(() => self.postMessage({
          id: event.data.id,
          slides: ["<section><h1>" + heading + "</h1></section>"],
          sourceRanges: [{ index: 1, startLine: 1, endLine: markdown.split("\\n").length, startOffset: 0, endOffset: markdown.length, heading }],
          css: "",
          renderDurationMs: delay
        }), delay);
      });`);
      return;
    }
    if (!allowedAssets.has(fileName)) {
      response.writeHead(404).end('not found');
      return;
    }
    const assetPath = path.resolve('dist', fileName);
    const relativeToDist = path.relative(path.resolve('dist'), assetPath);
    if (relativeToDist.startsWith('..') || path.isAbsolute(relativeToDist)) {
      response.writeHead(403).end('forbidden');
      return;
    }
    const body = await readFile(assetPath);
    const contentType = fileName.endsWith('.css') ? 'text/css' : 'text/javascript';
    response.writeHead(200, {
      'Content-Type': `${contentType}; charset=utf-8`,
      'Access-Control-Allow-Origin': '*'
    }).end(body);
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
});
await new Promise(
/**
 * 非同期処理のonce通知を待機側へ渡す。
 * @param resolve - Promiseの成功を通知する関数。
 * @param reject - Promiseの失敗を通知する関数。
 */
(resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
/**
 * lazy・ランタイム・スモーク検証で扱う一覧または対応表。
 */
const address = server.address();
if (!address || typeof address === 'string') throw new Error('テスト HTTP サーバーを開始できませんでした。');
/**
 * lazy・ランタイム・スモーク検証のoriginとして利用する実行環境または外部資源。
 */
const origin = `http://127.0.0.1:${address.port}`;

/**
 * 遅延ランタイムの起動確認に使うChromiumインスタンスです。
 */
const browser = await chromium.launch({ executablePath, headless: true });
try {
  await verifyMarkdownFallback();
  await verifyRichMarkdownFallback();
  await verifyLazyMarpWorker();
  await verifyMarpDetectionFailurePreservesSource();
  await verifyMarpWorkerFailurePreservesSource();
  await verifyMarpFrameFetchFailurePreservesSource();
  await verifyMarpFrameLayoutUnavailablePreservesSource();
  await verifyMarpExportStageReleaseAfterPrintPreview();
  await verifyMarpWorkerFetchWaitsWithoutFailure();
  await verifyMarpWorkerResponseWaitsWithoutFailure();
  await verifyMarpFrameInitializationWaitsWithoutFailure();
  await verifyMarpFrameReadyWaitsWithoutFailure();
  await verifyMarpWorkerDiscardsStaleResponse();
  await verifyInlineMermaidFallback();
  await verifyCompactMermaidAvoidsHostStartup();
  await verifyLargeMermaidKeepsHostIsolation();
  await verifyLazyExportFonts();
  console.log('遅延ランタイム: Markdown Worker 障害時フォールバック、Mermaid Host 障害時フォールバック、出力フォントを確認しました。');
} finally {
  await browser.close();
  await new Promise(
  /**
   * 非同期処理の閉じる通知を待機側へ渡す。
   * @param resolve - Promiseの成功を通知する関数。
   */
  (resolve) => server.close(resolve));
}

/**
 * 通常MarkdownではMarp Workerを読み込まず、判定待ちでは通常表示へ切り替わらない。
 */
async function verifyLazyMarpWorker() {
  const ordinaryMarkdown = '# Ordinary Markdown\n\nExisting preview path.\n';
  const marpMarkdown = '---\nmarp: true\n---\n# Marp preview\n';
  const page = await openEditor(ordinaryMarkdown, {
    workerUri: `${origin}/dist/markdown-worker.js`,
    mermaidHostRendering: false,
    marpWorkerUri: `${origin}/dist/marp-worker.js`,
    marpFrameUri: `${origin}/dist/marp-frame.js`,
    marpKatexFontsUri: `${origin}/dist/marp-katex-fonts/`,
    marpDetectionDelayMs: 500,
  });
  const marpWorkerRequests = [];
  const marpFrameRequests = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/marp-worker.js')) {
      marpWorkerRequests.push(request.url());
    }
    if (pathname.endsWith('/marp-frame.js')) marpFrameRequests.push(request.url());
  });
  try {
    await page.locator('.split-preview .rendered-markdown').waitFor();
    await page.waitForTimeout(250);
    if (marpWorkerRequests.length !== 0 || marpFrameRequests.length !== 0) {
      throw new Error(`通常MarkdownでMarp専用資産を取得しました: worker=${marpWorkerRequests.length}, frame=${marpFrameRequests.length}`);
    }
    await page.evaluate(({ text, previousText }) => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'externalChanges',
          baseVersion: 1,
          version: 2,
          changes: [{ rangeOffset: 0, rangeLength: previousText.length, text }]
        }
      }));
    }, { text: marpMarkdown, previousText: ordinaryMarkdown });
    const splitLoading = page.locator('.split-preview .mve-marp-detection-loading');
    await splitLoading.waitFor({ state: 'visible' });
    if (await page.locator('.split-preview .rendered-markdown').count() !== 0) {
      throw new Error('Marp判定中に通常Markdownプレビューへ一時切替されました。');
    }
    const pdfRequestsWhileDetecting = await page.evaluate(() => window.__mveMessages.filter(
      (message) => message.type === 'renderPdfPreview',
    ).length);
    if (pdfRequestsWhileDetecting !== 0) {
      throw new Error(`Marp判定中にPDFプレビュー要求が送られました: ${pdfRequestsWhileDetecting}`);
    }
    await page.getByRole('button', { name: 'プレビューのみ', exact: true }).click();
    const printLoading = page.locator('.editor-area .mve-marp-detection-loading');
    await printLoading.waitFor({ state: 'visible' });
    if (await page.locator('.split-preview .rendered-markdown').count() !== 0) {
      throw new Error('Marp判定中のプレビュー専用モードで通常Markdownへ切替されました。');
    }
    const printPdfRequestsWhileDetecting = await page.evaluate(() => window.__mveMessages.filter(
      (message) => message.type === 'renderPdfPreview',
    ).length);
    if (printPdfRequestsWhileDetecting !== 0) {
      throw new Error(`Marp判定中のプレビュー専用モードでPDF要求が送られました: ${printPdfRequestsWhileDetecting}`);
    }
    try {
      await page.locator('.split-preview .mve-marp-preview[data-mve-marp-status="ready"]').waitFor();
    } catch (error) {
      const state = await page.evaluate(() => ({
      marpRoots: Array.from(document.querySelectorAll('.mve-marp-preview'), (element) => ({
          className: element.className,
          status: element.getAttribute('data-mve-marp-status'),
          text: element.innerText,
          slideCount: element.getAttribute('data-mve-marp-slide-count'),
        })),
        detectionLoading: Array.from(document.querySelectorAll('.mve-marp-detection-loading'),
          (element) => ({ className: element.className, visible: element.getBoundingClientRect().height > 0 })),
        pdfPreviewCount: document.querySelectorAll('.pdf-preview-shell').length,
        ordinaryPreviewCount: document.querySelectorAll('.rendered-markdown').length,
        messages: window.__mveMessages.map((message) => ({
          type: message.type,
          requestId: message.requestId,
          isMarp: message.isMarp,
        })),
      }));
      throw new Error(`Marp preview-only did not reach ready: ${JSON.stringify(state)}; ${error instanceof Error ? error.message : String(error)}`);
    }
    if (marpWorkerRequests.length !== 1 || marpFrameRequests.length !== 1) {
      throw new Error(`Marp判定後の専用資産取得回数が1ではありません: worker=${marpWorkerRequests.length}, frame=${marpFrameRequests.length}`);
    }

    const disabledMarpMarkdown = marpMarkdown.replace('marp: true', 'marp: false');
    await page.evaluate(({ text, previousText }) => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'externalChanges',
          baseVersion: 2,
          version: 3,
          changes: [{ rangeOffset: 0, rangeLength: previousText.length, text }]
        }
      }));
    }, { text: disabledMarpMarkdown, previousText: marpMarkdown });
    await page.locator('.editor-area .mve-marp-detection-loading').waitFor({ state: 'visible' });
    if (await page.locator('.mve-marp-preview').count() !== 0) {
      throw new Error('marp:trueからfalseへの判定中に前のMarpスライドを表示しました。');
    }
    if (await page.locator('.rendered-markdown').count() !== 0) {
      throw new Error('marp:trueからfalseへの判定中に通常Markdownを先行表示しました。');
    }
    const pdfRequestsDuringDisableDetection = await page.evaluate(() => window.__mveMessages.filter(
      (message) => message.type === 'renderPdfPreview',
    ).length);
    if (pdfRequestsDuringDisableDetection !== 0) {
      throw new Error(`marp:trueからfalseへの判定中にPDF要求が送られました: ${pdfRequestsDuringDisableDetection}`);
    }
    const ordinaryPreview = page.locator('.split-preview .rendered-markdown');
    try {
      await ordinaryPreview.waitFor({ state: 'visible' });
    } catch (error) {
      const state = await page.evaluate(() => {
        const splitPreview = document.querySelector('.split-preview');
        return {
          splitPreviewText: splitPreview?.innerText,
          splitPreviewHtml: splitPreview?.innerHTML.slice(0, 2_000),
          ordinaryPreviewCount: document.querySelectorAll('.split-preview .rendered-markdown').length,
          ordinaryPreviewText: splitPreview?.querySelector('.rendered-markdown')?.innerText,
          marpPreviews: Array.from(document.querySelectorAll('.mve-marp-preview'), (element) => ({
            status: element.getAttribute('data-mve-marp-status'),
            text: element.innerText,
          })),
          detectionLoaders: document.querySelectorAll('.mve-marp-detection-loading').length,
          messages: window.__mveMessages.map((message) => ({
            type: message.type,
            requestId: message.requestId,
            isMarp: message.isMarp,
          })),
        };
      });
      throw new Error(`marp:false確定後の通常プレビュー状態を取得できません: ${JSON.stringify(state)}; ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!(await ordinaryPreview.innerText()).includes('Marp preview')) {
      throw new Error('marp:false判定後の通常プレビューに現在の本文が反映されませんでした。');
    }
    if (await page.locator('.mve-marp-preview').count() !== 0) {
      throw new Error('marp:false判定完了後もMarpプレビューが残りました。');
    }
  } finally {
    await page.close();
  }
}

/**
 * Marp Workerの取得失敗と不正応答を表示し、ソース編集が継続できることを確認する。
 */
async function verifyMarpWorkerFailurePreservesSource() {
  const markdown = '---\nmarp: true\n---\n# Worker failure fixture\n';
  const workerUris = [
    `${origin}/dist/marp-worker-not-found.js`,
    `${origin}/dist/marp-worker-invalid.js`,
  ];
  for (const marpWorkerUri of workerUris) {
    const page = await openEditor(markdown, {
      workerUri: `${origin}/dist/markdown-worker.js`,
      mermaidHostRendering: false,
      marpWorkerUri,
      marpFrameUri: `${origin}/dist/marp-frame.js`,
      marpKatexFontsUri: `${origin}/dist/marp-katex-fonts/`,
    });
    try {
      const preview = page.locator('.split-preview .mve-marp-preview[data-mve-marp-status="error"]');
      await preview.locator('[role="alert"]').waitFor();
      if (!(await preview.locator('[role="alert"]').innerText()).includes('失敗')) {
        throw new Error(`Marp Worker障害時のローカライズ済みエラーが表示されません: ${marpWorkerUri}`);
      }
      const source = page.locator('.split-editor .cm-content');
      if (!(await source.isVisible()) || !(await source.innerText()).includes('Worker failure fixture')) {
        throw new Error(`Marp Worker障害時にMarkdownソースを表示できません: ${marpWorkerUri}`);
      }
      if (await source.getAttribute('contenteditable') !== 'true') {
        throw new Error(`Marp Worker障害時にMarkdownソースを編集できません: ${marpWorkerUri}`);
      }
      const pdfRequests = await page.evaluate(() => window.__mveMessages.filter(
        (message) => message.type === 'renderPdfPreview',
      ).length);
      if (pdfRequests !== 0) {
        throw new Error(`Marp Worker障害時にPDFプレビュー要求が送られました: ${pdfRequests}`);
      }
      const ordinaryPreviews = await page.locator('.split-preview .rendered-markdown').count();
      if (ordinaryPreviews !== 0) {
        throw new Error(`Marp Worker障害時に通常Markdownプレビューへ切り替わりました: ${ordinaryPreviews}`);
      }
    } finally {
      await page.close();
    }
  }
}

/**
 * Marp front matter検出失敗時に通常MarkdownやPDFへ切り替えず、状態を解除する。
 */
async function verifyMarpDetectionFailurePreservesSource() {
  const markdown = '---\nmarp: true\n---\n# Detection failure fixture\n';
  const page = await openEditor(markdown, {
    workerUri: `${origin}/dist/markdown-worker.js`,
    mermaidHostRendering: false,
    marpWorkerUri: `${origin}/dist/marp-worker.js`,
    marpFrameUri: `${origin}/dist/marp-frame.js`,
    marpKatexFontsUri: `${origin}/dist/marp-katex-fonts/`,
    marpDetectionFailure: true,
  });
  try {
    const splitError = page.locator('.split-preview .mve-marp-preview-error[role="alert"]');
    await splitError.waitFor({ state: 'visible' });
    await verifyMarpDetectionErrorDoesNotBlockSource(page, splitError);
    if (!(await splitError.innerText()).includes('判定できませんでした')) {
      throw new Error('Marp判定失敗時のエラー表示がありません。');
    }
    if (await page.locator('.split-preview .rendered-markdown').count() !== 0) {
      throw new Error('Marp判定失敗後に通常Markdownプレビューへ切り替わりました。');
    }
    const source = page.locator('.split-editor .cm-content');
    if (!(await source.isVisible()) || !(await source.innerText()).includes('Detection failure fixture')) {
      throw new Error('Marp判定失敗後にMarkdownソースを表示できません。');
    }
    if (await source.getAttribute('contenteditable') !== 'true') {
      throw new Error('Marp判定失敗後にMarkdownソースを編集できません。');
    }
    await page.getByRole('tab', { name: '出力', exact: true }).click();
    await page.getByRole('button', { name: '印刷プレビュー', exact: true }).click();
    const printError = page.locator('.editor-area .mve-marp-preview-error[role="alert"]');
    await printError.waitFor({ state: 'visible' });
    if (await page.locator('.editor-area .pdf-preview').count() !== 0) {
      throw new Error('Marp判定失敗後にPDFプレビューへ切り替わりました。');
    }
    await page.waitForTimeout(700);
    const outputRequests = await page.evaluate(() => window.__mveMessages.filter(
      (message) => message.type === 'renderPdfPreview',
    ).length);
    if (outputRequests !== 0) {
      const outputRequestMessages = await page.evaluate(() => window.__mveMessages.filter(
        (message) => message.type === 'renderPdfPreview',
      ));
      throw new Error(`Marp判定失敗後にPDFプレビュー要求が送られました: ${outputRequests}; ${JSON.stringify(outputRequestMessages)}`);
    }
  } finally {
    await page.close();
  }
}

/**
 * Marp判定エラーがソース領域に重ならず、編集操作が継続できることを確認する。
 */
async function verifyMarpDetectionErrorDoesNotBlockSource(page, error) {
  const source = page.locator('.split-editor .cm-content');
  const [sourceBounds, errorBounds] = await Promise.all([
    source.boundingBox(),
    error.boundingBox(),
  ]);
  if (!sourceBounds || !errorBounds) {
    throw new Error('Marp判定エラーとソース領域の位置を計測できません。');
  }
  const overlapsSource =
    sourceBounds.x < errorBounds.x + errorBounds.width &&
    sourceBounds.x + sourceBounds.width > errorBounds.x &&
    sourceBounds.y < errorBounds.y + errorBounds.height &&
    sourceBounds.y + sourceBounds.height > errorBounds.y;
  if (overlapsSource) {
    throw new Error('Marp判定エラー表示が分割表示のソース領域に重なっています。');
  }

  const before = await source.innerText();
  await source.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('x');
  await page.waitForFunction((previousText) => {
    return document.querySelector('.split-editor .cm-content')?.innerText !== previousText;
  }, before);
}

/**
 * Marp iframe補助コードのHTTP取得失敗を表示し、ソース編集が継続できることを確認する。
 */
async function verifyMarpFrameFetchFailurePreservesSource() {
  const markdown = '---\nmarp: true\n---\n# Frame asset failure fixture\n';
  const previousResponseCount = marpFrameNotFoundResponseCount;
  const page = await openEditor(markdown, {
    workerUri: `${origin}/dist/markdown-worker.js`,
    mermaidHostRendering: false,
    marpWorkerUri: `${origin}/dist/marp-worker.js`,
    marpFrameUri: `${origin}/dist/marp-frame-not-found.js`,
    marpKatexFontsUri: `${origin}/dist/marp-katex-fonts/`,
  });
  try {
    await waitForNodeCondition(
      () => marpFrameNotFoundResponseCount === previousResponseCount + 1,
      5_000,
      '404応答を返したMarp iframe資産要求',
    );
    const preview = page.locator('.split-preview .mve-marp-preview[data-mve-marp-status="error"]');
    await preview.locator('[role="alert"]').waitFor();
    if (!(await preview.locator('[role="alert"]').innerText()).includes('失敗')) {
      throw new Error('Marp iframe資産取得失敗時にローカライズ済みエラーが表示されません。');
    }
    const source = page.locator('.split-editor .cm-content');
    if (!(await source.isVisible()) || !(await source.innerText()).includes('Frame asset failure fixture')) {
      throw new Error('Marp iframe資産取得失敗時にMarkdownソースを表示できません。');
    }
    if (await source.getAttribute('contenteditable') !== 'true') {
      throw new Error('Marp iframe資産取得失敗時にMarkdownソースを編集できません。');
    }
    const pdfRequests = await page.evaluate(() => window.__mveMessages.filter(
      (message) => message.type === 'renderPdfPreview',
    ).length);
    if (pdfRequests !== 0) {
      throw new Error(`Marp iframe資産取得失敗時にPDFプレビュー要求が送信されました: ${pdfRequests}`);
    }
    const ordinaryPreviews = await page.locator('.split-preview .rendered-markdown').count();
    if (ordinaryPreviews !== 0) {
      throw new Error(`Marp iframe資産取得失敗時に通常Markdownプレビューへ切り替わりました: ${ordinaryPreviews}`);
    }
  } finally {
    await page.close();
  }
}

/** Marp iframeが有効なスライド寸法を取得できない場合にエラーを表示してソースを保つ。 */
async function verifyMarpFrameLayoutUnavailablePreservesSource() {
  const markdown = '---\nmarp: true\n---\n# Layout unavailable fixture\n';
  const page = await openEditor(markdown, {
    workerUri: `${origin}/dist/markdown-worker.js`,
    mermaidHostRendering: false,
    marpWorkerUri: `${origin}/dist/marp-worker.js`,
    marpFrameUri: `${origin}/dist/marp-frame-layout-unavailable.js`,
    marpKatexFontsUri: `${origin}/dist/marp-katex-fonts/`,
  });
  try {
    const preview = page.locator('.split-preview .mve-marp-preview[data-mve-marp-status="error"]');
    await preview.locator('[role="alert"]').waitFor({ timeout: 10_000 });
    if (await page.locator('.split-preview .rendered-markdown').count() !== 0) {
      throw new Error('Marpスライド寸法の取得失敗後に通常Markdownプレビューへ切り替わりました。');
    }
    const source = page.locator('.split-editor .cm-content');
    if (!(await source.isVisible()) || !(await source.innerText()).includes('Layout unavailable fixture')) {
      throw new Error('Marpスライド寸法の取得失敗後にMarkdownソースを表示できません。');
    }
    if (await source.getAttribute('contenteditable') !== 'true') {
      throw new Error('Marpスライド寸法の取得失敗後にMarkdownソースを編集できません。');
    }
  } finally {
    await page.close();
  }
}

/**
 * Marp印刷プレビュー中のPDF/HTML出力後に、出力用DOM要求が残らないことを確認する。
 */
async function verifyMarpExportStageReleaseAfterPrintPreview() {
  const markdown = '---\nmarp: true\n---\n# Export stage lifecycle fixture\n';
  const page = await openEditor(markdown, {
    workerUri: `${origin}/dist/markdown-worker.js`,
    mermaidHostRendering: false,
    marpWorkerUri: `${origin}/dist/marp-worker.js`,
    marpFrameUri: `${origin}/dist/marp-frame.js`,
    marpKatexFontsUri: `${origin}/dist/marp-katex-fonts/`,
  });
  try {
    await page.locator('.split-preview .mve-marp-preview[data-mve-marp-status="ready"]').waitFor();
    await page.getByRole('tab', { name: '出力', exact: true }).click();
    await page.getByRole('button', { name: '印刷プレビュー', exact: true }).click();
    await page.locator('.mve-marp-preview-print').waitFor();
    if (await page.locator('.export-stage').count() !== 1) {
      throw new Error('印刷プレビュー中に出力用DOMがありません。');
    }

    for (const command of ['exportHtml', 'exportPdf']) {
      const previousCount = await page.evaluate((type) =>
        window.__mveMessages.filter((message) => message.type === type).length, command);
      await page.evaluate((value) => window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'hostCommand', command: value },
      })), command);
      await page.waitForFunction(({ type, count }) =>
        window.__mveMessages.filter((message) => message.type === type).length > count,
      { type: command, count: previousCount }, { timeout: 20_000 });
    }

    await page.getByRole('button', { name: '印刷プレビュー', exact: true }).click();
    await page.locator('.mve-marp-preview-print').waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelector('.export-stage') === null);
    await page.locator('.split-preview .mve-marp-preview[data-mve-marp-status="ready"]').waitFor();
  } finally {
    await page.close();
  }
}

/**
 * Marp Worker資産の応答が停止しても、経過時間だけで失敗表示へ切り替わらない。
 */
async function verifyMarpWorkerFetchWaitsWithoutFailure() {
  const markdown = '---\nmarp: true\n---\n# Worker fetch timeout fixture\n';
  const page = await openEditor(markdown, {
    workerUri: `${origin}/dist/markdown-worker.js`,
    mermaidHostRendering: false,
    marpWorkerUri: `${origin}/hang-marp-worker.js`,
    marpFrameUri: `${origin}/dist/marp-frame.js`,
    marpKatexFontsUri: `${origin}/dist/marp-katex-fonts/`,
  });
  try {
    await waitForNodeCondition(
      () => stalledResourceRequests.has('/hang-marp-worker.js'),
      5_000,
      '停止したMarp Worker資産要求',
    );
    await assertMarpRemainsLoadingAfterDelay(page, 'Marp Worker資産');
  } finally {
    await page.close();
  }
}

/**
 * Marp Workerが描画要求を受信後に応答しなくても、経過時間だけで失敗表示へ切り替わらない。
 */
async function verifyMarpWorkerResponseWaitsWithoutFailure() {
  const markdown = '---\nmarp: true\n---\n# Worker response fixture\n';
  const page = await openEditor(markdown, {
    workerUri: `${origin}/dist/markdown-worker.js`,
    mermaidHostRendering: false,
    marpWorkerUri: `${origin}/dist/marp-worker-no-response.js`,
    marpFrameUri: `${origin}/dist/marp-frame.js`,
    marpKatexFontsUri: `${origin}/dist/marp-katex-fonts/`,
  });
  try {
    await waitForNodeCondition(
      () => stalledResourceRequests.has('/hang-marp-worker-response-start'),
      5_000,
      'Marp Worker描画要求の受信記録',
    );
    await assertMarpRemainsLoadingAfterDelay(page, 'Marp Worker応答');
  } finally {
    await page.close();
  }
}

/**
 * Marp iframe補助コードの取得が停止しても、経過時間だけで失敗表示へ切り替わらない。
 */
async function verifyMarpFrameInitializationWaitsWithoutFailure() {
  const markdown = '---\nmarp: true\n---\n# Frame initialization timeout fixture\n';
  const page = await openEditor(markdown, {
    workerUri: `${origin}/dist/markdown-worker.js`,
    mermaidHostRendering: false,
    marpWorkerUri: `${origin}/dist/marp-worker.js`,
    marpFrameUri: `${origin}/hang-marp-frame.js`,
    marpKatexFontsUri: `${origin}/dist/marp-katex-fonts/`,
  });
  try {
    await waitForNodeCondition(
      () => stalledResourceRequests.has('/hang-marp-frame.js'),
      5_000,
      '停止したMarp iframe補助コード要求',
    );
    await assertMarpRemainsLoadingAfterDelay(page, 'Marp iframe補助コード');
  } finally {
    await page.close();
  }
}

/**
 * iframe補助コードが読み込まれてもready通知が届かない場合に読み込み中を保つ。
 */
async function verifyMarpFrameReadyWaitsWithoutFailure() {
  const markdown = '---\nmarp: true\n---\n# Frame ready timeout fixture\n';
  const page = await openEditor(markdown, {
    workerUri: `${origin}/dist/markdown-worker.js`,
    mermaidHostRendering: false,
    marpWorkerUri: `${origin}/dist/marp-worker.js`,
    marpFrameUri: `${origin}/dist/marp-frame-no-ready.js`,
    marpKatexFontsUri: `${origin}/dist/marp-katex-fonts/`,
  });
  try {
    await page.frameLocator('.split-preview .mve-marp-preview iframe')
      .locator('html[data-mve-frame-loaded="true"]')
      .waitFor();
    await assertMarpRemainsLoadingAfterDelay(page, 'Marp iframe ready通知');
  } finally {
    await page.close();
  }
}

/**
 * 描画の進行が遅くても失敗表示を出さず、ソース編集を維持する。
 * @param page - 描画待ち状態を確認するブラウザーのページ。
 * @param stage - 待機中のMarp処理段階。
 */
async function assertMarpRemainsLoadingAfterDelay(page, stage) {
  const preview = page.locator('.split-preview .mve-marp-preview');
  const source = page.locator('.split-editor .cm-content');
  await preview.locator('[role="status"]').waitFor({ state: 'visible' });
  await source.waitFor({ state: 'visible' });
  await page.waitForTimeout(15_500);
  const status = await preview.getAttribute('data-mve-marp-status');
  const alertCount = await preview.locator('[role="alert"]').count();
  if (status !== 'loading' || alertCount !== 0 || !(await preview.locator('[role="status"]').isVisible())) {
    throw new Error(`${stage}が完了していない状態で、経過時間だけを理由に失敗表示へ切り替わりました。`);
  }
  if (!(await source.innerText()).includes('fixture') || await source.getAttribute('contenteditable') !== 'true') {
    throw new Error(`${stage}待機中にMarkdownソースの表示または編集ができなくなりました。`);
  }
  const pdfRequests = await page.evaluate(() => window.__mveMessages.filter(
    (message) => message.type === 'renderPdfPreview',
  ).length);
  if (pdfRequests !== 0) throw new Error(`${stage}待機中にPDFプレビュー要求が送信されました: ${pdfRequests}`);
}

/**
 * 遅延した旧世代Worker応答が最新のMarpスライドを上書きしないことを確認する。
 */
async function verifyMarpWorkerDiscardsStaleResponse() {
  const staleMarkdown = '---\nmarp: true\n---\n# Stale generation\n';
  const latestMarkdown = '---\nmarp: true\n---\n# Latest generation\n';
  const page = await openEditor(staleMarkdown, {
    workerUri: `${origin}/dist/markdown-worker.js`,
    mermaidHostRendering: false,
    marpWorkerUri: `${origin}/dist/marp-worker-race.js`,
    marpFrameUri: `${origin}/dist/marp-frame.js`,
    marpKatexFontsUri: `${origin}/dist/marp-katex-fonts/`,
  });
  try {
    await waitForNodeCondition(() => raceWorkerStarted, 5_000, '旧世代Marp Workerの開始');
    await page.evaluate(({ text, previousText }) => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'externalChanges',
          baseVersion: 1,
          version: 2,
          changes: [{ rangeOffset: 0, rangeLength: previousText.length, text }],
        },
      }));
    }, { text: latestMarkdown, previousText: staleMarkdown });
    const heading = page.frameLocator('.split-preview .mve-marp-preview iframe').locator('h1');
    await heading.waitFor();
    await page.waitForTimeout(800);
    if ((await heading.textContent())?.trim() !== 'Latest generation') {
      throw new Error('旧世代Marp Workerの遅延応答が最新プレビューを上書きしました。');
    }
    await page.waitForFunction(() => window.__mveFrameMessages?.some(
      (message) => message.type === 'layout' && Number.isInteger(message.renderId),
    ));
    const latestLayout = await page.evaluate(() => window.__mveFrameMessages
      .filter((message) => message.type === 'layout')
      .at(-1));
    if (!latestLayout?.token || !Number.isInteger(latestLayout.renderId)) {
      throw new Error('現在のMarp iframe layout応答を取得できません。');
    }
    const preview = page.locator('.split-preview .mve-marp-preview');
    const currentFrameHeight = await preview.locator('iframe').evaluate(
      (frame) => getComputedStyle(frame).height,
    );
    await page.evaluate((layout) => {
      const frame = document.querySelector('.split-preview .mve-marp-preview iframe');
      if (!frame?.contentWindow) throw new Error('Marp iframeが見つかりません。');
      const staleRenderId = layout.renderId - 1;
      const staleMessages = [
        { ...layout, renderId: staleRenderId, height: 99_999 },
        { ...layout, type: 'render-error', renderId: staleRenderId, detail: 'stale fixture' },
        { ...layout, type: 'invalid', renderId: staleRenderId },
      ];
      for (const data of staleMessages) {
        window.dispatchEvent(new MessageEvent('message', {
          data: { ...data, channel: 'mve-marp', token: layout.token },
          origin: 'null',
          source: frame.contentWindow,
        }));
      }
    }, latestLayout);
    const status = await preview.getAttribute('data-mve-marp-status');
    const frameHeightAfter = await preview.locator('iframe').evaluate(
      (frame) => getComputedStyle(frame).height,
    );
    if (status !== 'ready' || await preview.locator('[role="alert"]').count() !== 0) {
      throw new Error('旧世代Marp iframeのエラー応答が最新表示へ適用されました。');
    }
    if (frameHeightAfter !== currentFrameHeight) {
      throw new Error(`旧世代Marp iframeのlayout応答が高さを変更しました: ${currentFrameHeight} -> ${frameHeightAfter}`);
    }
  } finally {
    await page.close();
  }
}

/**
 * Node側のfixture serverから通知される条件が成立するまで待つ。
 * @param predicate - 待機を終える条件を返す関数。
 * @param timeoutMs - 条件が成立するまでの最大時間。
 * @param description - timeout時に表示する状況説明。
 */
async function waitForNodeCondition(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`${description}が${timeoutMs}ms以内に開始しませんでした。`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * 2つの小型図がWebview内で描画され、Host描画要求が発生せずSVG IDも衝突しないことを確認する。
 */
async function verifyCompactMermaidAvoidsHostStartup() {
  const markdown = [
    '```mermaid',
    'flowchart TD',
    '  Start --> Ready',
    '```',
    '',
    '```mermaid',
    'flowchart LR',
    '  Start --> Ready',
    '```',
    ''
  ].join('\n');
  const page = await openEditor(markdown, {
    workerUri: `${origin}/dist/markdown-worker.js`,
    mermaidHostRendering: true
  });
  try {
    await page.waitForFunction(
    /**
     * ブラウザー内に「.split-preview .mermaid[data-mermaid-status=」が現れるまで待機する。
     */
    () => (
      document.querySelectorAll('.split-preview .mermaid[data-mermaid-status="ready"] svg').length === 2
    ), undefined, { timeout: 20_000 });
    const state = await page.evaluate(
    /**
     * ブラウザー内の「.split-preview .mermaid svg」を読み取り、検証用の値へ変換する。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    () => {
      const diagrams = [...document.querySelectorAll('.split-preview .mermaid svg')];
      const ids = diagrams.flatMap(
      /**
       * @param svg - Mermaidが生成したSVG本文。
       */
      (svg) => [...svg.querySelectorAll('[id]')].map(
      /**
       * 各要素から識別子を取り出して一覧化する。
       * @param element - 要素の識別子を参照する走査対象。
       * @returns 識別子を取り出した変換結果の一覧。
       */
      (element) => element.id));
      return {
        hostRequests: window.__mveMessages.filter(
        /**
         * 種別「renderMermaid」のメッセージだけを残す。
         * @param message - メッセージのtypeを参照する走査対象。

         */
        (message) => message.type === 'renderMermaid').length,
        duplicateIds: ids.filter(
        /**
         * 重複している識別子だけを抽出する。
         * @param id - 重複判定する識別子。
         * @param index - 先行同一値の検索に使う配列位置。

         */
        (id, index) => ids.indexOf(id) !== index),
        text: diagrams.map(
        (svg) => svg.textContent ?? '')
      };
    });
    if (state.hostRequests !== 0) {
      throw new Error(`小型 Mermaid が Host Chromium を起動しました: ${state.hostRequests} requests`);
    }
    if (state.duplicateIds.length) {
      throw new Error(`小型 Mermaid 間で SVG ID が衝突しました: ${JSON.stringify(state.duplicateIds)}`);
    }
    if (state.text.some(
    /**
     * @param text - 表示・解析・変換の対象となる本文。
     * @returns 条件が成立したかを示す真偽値。
     */
    (text) => !text.includes('Start') || !text.includes('Ready'))) {
      throw new Error(`小型 Mermaid のラベルが欠落しました: ${JSON.stringify(state.text)}`);
    }
  } finally {
    await page.close();
  }
}

/**
 * 大きな図の描画要求がHostへ送られ、Webview側Mermaid runtimeを読み込まないことを確認する。
 */
async function verifyLargeMermaidKeepsHostIsolation() {
  const edges = Array.from({ length: 240 },

  (_, index) => `  N${index} --> N${index + 1}`);
  const markdown = `\`\`\`mermaid\nflowchart TD\n${edges.join("\n")}\n\`\`\`\n`;
  const page = await openEditor(markdown, {
    workerUri: `${origin}/dist/markdown-worker.js`,
    mermaidHostRendering: true
  });
  try {
    await page.waitForFunction(
    /**
     * HostとWebviewのメッセージ状態が完了条件を満たすまで待機する。
     */
    () => (
      window.__mveMessages.some(
      /**

       * @param message - HostとWebviewの間で受け渡すメッセージ。
       */
      (message) => message.type === 'renderMermaid')
    ), undefined, { timeout: 20_000 });
  } finally {
    await page.close();
  }
}

/**
 * worker読込失敗後もMarkdown fallbackが目次・数式を描画し、HTMLイベント属性を実行しないことを確認する。
 */
async function verifyMarkdownFallback() {
  const markdown = [
    '# Fallback',
    '',
    '[TOC]',
    '',
    '**worker failure recovery**',
    '',
    '$$x^2 + y^2$$',
    '',
    '<img src="x" onerror="window.__mveXss = true">',
    '<script>window.__mveXss = true</script>',
    ''
  ].join('\n');
  const page = await openEditor(markdown, {
    workerUri: `${origin}/dist/missing-worker.js`,
    mermaidHostRendering: true
  });
  try {
    try {
      await page.waitForFunction(
      /**
       * ブラウザー内に「.split-preview p strong」が現れるまで待機する。
       */
      () => (
        document.body.dataset.mveMarkdownWorkerStatus === 'fallback'
        && document.querySelector('.split-preview p strong')?.textContent === 'worker failure recovery'
      ), undefined, { timeout: 15_000 });
    } catch (error) {
      const state = await page.evaluate(
      /**
       * ブラウザー内の「.split-preview」を読み取り、検証用の値へ変換する。
       * @returns ブラウザー内で読み取った値または変換結果。
       */
      () => ({
        workerStatus: document.body.dataset.mveMarkdownWorkerStatus,
        html: document.querySelector('.split-preview')?.innerHTML.slice(0, 2_000)
      }));
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(state)}`);
    }
    const unsafe = await page.evaluate(
    /**
     * ブラウザー内の「.split-preview .table-of-contents」を読み取り、検証用の値へ変換する。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    () => ({
      hasToc: Boolean(document.querySelector('.split-preview .table-of-contents')),
      hasKatex: Boolean(document.querySelector('.split-preview .katex')),
      scriptCount: document.querySelectorAll('.split-preview script').length,
      eventHandlerCount: document.querySelectorAll('.split-preview [onerror]').length,
      executed: window.__mveXss === true,
      html: document.querySelector('.split-preview')?.innerHTML.slice(0, 2_000)
    }));
    if (!unsafe.hasToc || !unsafe.hasKatex || unsafe.scriptCount || unsafe.eventHandlerCount || unsafe.executed) {
      throw new Error(`Markdown フォールバックのサニタイズが失敗しました: ${JSON.stringify(unsafe)}`);
    }
  } finally {
    await page.close();
  }
}

/**
 * rich worker読込失敗時も通常workerへ切り替わり、コードブロックの強調表示が完了することを確認する。
 */
async function verifyRichMarkdownFallback() {
  const markdown = '# Rich fallback\n\n```javascript\nconst answer = 42;\n```\n';
  const page = await openEditor(markdown, {
    workerUri: `${origin}/dist/markdown-worker.js`,
    richWorkerUri: `${origin}/dist/missing-rich-worker.js`,
    mermaidHostRendering: true
  });
  try {
    await page.waitForFunction(
    /**
     * ブラウザー内に「.split-preview .hljs-keyword」が現れるまで待機する。
     */
    () => (
      document.body.dataset.mveMarkdownWorkerStatus === 'fallback'
      && document.querySelector('.split-preview .hljs-keyword')?.textContent === 'const'
    ), undefined, { timeout: 20_000 });
  } finally {
    await page.close();
  }
}

/**
 * lazy・ランタイム・スモーク検証の入力と不変条件を検証し、違反時に失敗を通知する。
 */
async function verifyInlineMermaidFallback() {
  const markdown = '# Mermaid\n\n```mermaid\ngraph TD\n  A --> B\n```\n';
  const page = await openEditor(markdown, {
    workerUri: `${origin}/dist/markdown-worker.js`,
    mermaidHostRendering: false
  });
  try {
    try {
      await page.waitForFunction(
      /**
       * ブラウザー内に「.split-preview .mermaid[data-mermaid-status=」が現れるまで待機する。
       * @returns Mermaid SVGがプレビューへ表示された場合はtrue。
       */
      () => (
        document.querySelector('.split-preview .mermaid[data-mermaid-status="ready"] svg') !== null
      ), undefined, { timeout: 20_000 });
    } catch (error) {
      const state = await page.evaluate(
      /**
       * ブラウザー内の「.mermaid」を読み取り、検証用の値へ変換する。
       * @returns Worker状態、Mermaid runtimeの有無・型、constructor名を含む診断情報。
       */
      () => ({
        workerStatus: document.body.dataset.mveMarkdownWorkerStatus,
        mermaidLoaded: Boolean(window.mermaid),
        mermaidType: typeof window.mermaid,
        mermaidConstructor: window.mermaid?.constructor?.name,
        mermaidValue: String(window.mermaid).slice(0, 200),
        mermaidKeys: window.mermaid ? Object.keys(window.mermaid).slice(0, 20) : [],
        diagrams: [...document.querySelectorAll('.mermaid')].map(
         (node) => ({
          status: node.getAttribute('data-mermaid-status'),
          text: node.textContent
        }))
      }));
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(state)}`);
    }
  } finally {
    await page.close();
  }
}

/**
 * HTML export要求をWebviewへ送り、応答CSSに遅延ロードされた埋め込みfontが含まれることを確認する。
 */
async function verifyLazyExportFonts() {
  const markdown = '# Export fonts\n\n埋め込みフォントの回帰検証。\n';
  const page = await openEditor(markdown, {
    workerUri: `${origin}/dist/markdown-worker.js`,
    mermaidHostRendering: true
  });
  try {
    await page.waitForFunction(
    /**
     * ブラウザー内に「.split-preview .rendered-markdown」が現れるまで待機する。
     * @param length - プレビューのdata-document-lengthと照合する期待本文長。
     */
    (length) => (
      Number(document.querySelector('.split-preview .rendered-markdown')?.getAttribute('data-document-length')) === length
    ), markdown.length);
    await page.evaluate(
     () => window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'hostCommand', command: 'exportHtml' }
    })));
    await page.waitForFunction(
    /**
     * HostとWebviewのメッセージ状態が完了条件を満たすまで待機する。
     */
    () => window.__mveMessages.some(
    /**

     * @param message - HostとWebviewの間で受け渡すメッセージ。
     */
    (message) => message.type === 'exportHtml'), undefined, {
      timeout: 20_000
    });
    const css = await page.evaluate(
    /**
     * HostとWebviewのメッセージ状態のfind結果を読み取り、検証用の値へ変換する。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    () => window.__mveMessages.find(
    /**
     * typeが条件に一致する最初のメッセージを取得する。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件に一致した最初の要素。未検出時はundefined。
     */
    (message) => message.type === 'exportHtml')?.css ?? '');
    if (css.length < 1024 * 1024 || !css.includes('@font-face') || !css.includes('data:font/')) {
      throw new Error(`HTML 出力 CSS に埋め込みフォントがありません: ${css.length} chars`);
    }
  } finally {
    await page.close();
  }
}

/**
 * worker URIとWebview設定を注入し、テスト用Host shim付きページを起動する。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param options - ブラウザー内Webviewの起動設定。
 * @param options.workerUri - Markdown workerの読み込み先URI。
 * @param options.richWorkerUri - リッチMarkdown workerの読み込み先URI。省略時は配布先の既定URIを使う。
 * @param options.mermaidHostRendering - Mermaid図をHost側で描画するかを示す設定。
 * @param options.marpDetectionDelayMs - Marp判定結果を返すまでの検証用遅延時間。
 * @returns 設定済みWebviewを読み込んだPlaywright Page。
 */
async function openEditor(markdown, options) {
  const {
    workerUri,
    richWorkerUri = `${origin}/dist/markdown-rich-worker.js`,
    mermaidHostRendering,
    marpWorkerUri,
    marpFrameUri,
    marpKatexFontsUri,
    marpDetectionDelayMs = 0,
    marpDetectionFailure = false,
  } = options;
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror',
  /**
   * pageerrorイベントで一覧追加を実行する。
   * @param error - ユーザー操作またはDOMから通知されたイベント。
   */
  (error) => errors.push(error.message));
  await page.goto(origin);
  await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態のメッセージ送信結果を読み取り、検証用の値へ変換する。
  * @returns ブラウザー内で読み取った値または変換結果。
   */
  ({ markdown, mermaidHostRendering, workerUri, richWorkerUri, marpWorkerUri, marpFrameUri, marpKatexFontsUri, marpDetectionDelayMs, marpDetectionFailure, origin }) => {
    document.body.dataset.mveMarkdownWorkerUri = workerUri;
    document.body.dataset.mveMarkdownRichWorkerUri = richWorkerUri;
    document.body.dataset.mveMarkdownFallbackUri = `${origin}/dist/markdown-fallback.js`;
    document.body.dataset.mveMarpWorkerUri = marpWorkerUri ?? '';
    document.body.dataset.mveMarpFrameUri = marpFrameUri ?? '';
    document.body.dataset.mveMarpKatexFontsUri = marpKatexFontsUri ?? '';
    document.body.dataset.mveCspSource = origin;
    document.body.dataset.mveMermaidUri = `${origin}/dist/mermaid.min.js`;
    document.body.dataset.mveExportFontsUri = `${origin}/dist/export-fonts.css`;
    window.__mveMessages = [];
    window.__mveFrameMessages = [];
    window.addEventListener('message', (event) => {
      if (event.data?.channel === 'mve-marp') window.__mveFrameMessages.push(event.data);
    });
    window.acquireVsCodeApi =
    /**
     * WebviewからVS Codeのメッセージ送信・状態保存APIを取得する。
     * @returns VS Codeのメッセージ送信・状態保存API。
     */
    () => ({
      /**
        * Webviewの要求を記録し、ready通知には初期化メッセージを返す。
        * @param message - WebviewからテストHostへ送られた要求。
       */
      postMessage(message) {
        window.__mveMessages.push(message);
        if (message.type === 'detectMarpMarkdown') {
          if (marpDetectionFailure) {
            setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
              data: {
                type: 'operationFailed',
                requestId: message.requestId,
                message: 'Simulated Marp detection failure',
              },
            })), marpDetectionDelayMs);
            return;
          }
          const source = message.markdown.charCodeAt(0) === 0xfeff
            ? message.markdown.slice(1)
            : message.markdown;
          const frontMatter = /^---[ \t]*\r?\n([\s\S]*?)^(?:---|\.\.\.)[ \t]*\r?$/m.exec(source);
          const isMarp = Boolean(
            frontMatter && /^marp:[ \t]*true[ \t]*(?:#.*)?$/m.test(frontMatter[1]),
          );
          setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
            data: {
              type: 'marpDetectionResult',
              requestId: message.requestId,
              isMarp,
            },
          })), marpDetectionDelayMs);
          return;
        }
        if (message.type !== 'ready') return;
        setTimeout(
        /**
         * 指定時間の経過後に後続処理を実行する。
         */
        () => window.dispatchEvent(new MessageEvent('message', {
          data: {
            type: 'init',
            text: markdown,
            version: 1,
            uri: 'file:///lazy-runtime.md',
            settings: {
              language: 'ja',
              imageDirectory: 'assets/${documentBasename}',
              maxPasteSizeMb: 20,
              remoteImagesEnabled: false,
              mermaidTheme: 'default',
              mermaidHostRendering,
              editorTheme: 'dark',
              viewMode: 'both',
              scrollSyncEnabled: true,
              previewImageResizeControlsVisible: true,
              workspaceTrusted: true
            }
          }
        })), 0);
      },

      
      getState: /**
       * @returns 条件に一致する値。未検出時はundefinedまたはnull。
       */ () => undefined,

      
      setState: /**
       * lazy・ランタイム・スモーク検証の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
       */ () => undefined
    });
  }, { markdown, mermaidHostRendering, workerUri, richWorkerUri, marpWorkerUri, marpFrameUri, marpKatexFontsUri, marpDetectionDelayMs, marpDetectionFailure, origin });
  await page.addStyleTag({ url: `${origin}/dist/styles.css` });
  await page.addStyleTag({ url: `${origin}/dist/webview.css` });
  await page.addScriptTag({ url: `${origin}/dist/webview.js` });
  page.setDefaultTimeout(15_000);
  try {
    await page.locator('.split-editor').waitFor();
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${errors.join('\n')}`);
  }
  return page;
}

/**
 * 指定した名前のファイルを検証用ディレクトリから再帰的に探す。
 * @param root - 再帰検索を開始するディレクトリ。
 * @param name - 探すファイル名。
 * @returns 見つかったファイルの絶対パス。該当しない場合はundefined。
 */
async function findFile(root, name) {
  try {
    await access(root);
  } catch {
    return undefined;
  }
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return candidate;
    if (entry.isDirectory()) {
      const nested = await findFile(candidate, name);
      if (nested) return nested;
    }
  }
  return undefined;
}

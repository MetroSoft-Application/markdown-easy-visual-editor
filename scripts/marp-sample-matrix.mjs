/**
 * @fileoverview sample/marpの全デッキを通常プレビューと印刷プレビューで実描画検証する。
 */
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { parseDocument } from 'yaml';

const sampleDirectory = path.resolve('sample/marp');
const sampleEntries = await readdir(sampleDirectory, { withFileTypes: true });
const sampleFiles = sampleEntries
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
  .map((entry) => entry.name)
  .sort();
if (sampleFiles.length < 10) {
  throw new Error(`sample/marpには10個以上のMarkdownが必要です。実際: ${sampleFiles.length}`);
}

const samples = await Promise.all(sampleFiles.map(async (name) => {
  const markdown = (await readFile(path.join(sampleDirectory, name), 'utf8')).replace(/\r\n?/g, '\n');
  const frontMatter = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(markdown);
  if (!frontMatter) throw new Error(`${name}にfront matterがありません。`);
  const parsed = parseDocument(frontMatter[1], { strict: true, uniqueKeys: true });
  if (parsed.errors.length || parsed.toJS()?.marp !== true) {
    throw new Error(`${name}のmarp: trueを読み取れません。`);
  }
  const slideCount = Number(/<!-- matrix:slides=(\d+) -->/.exec(markdown)?.[1]);
  if (!Number.isInteger(slideCount) || slideCount < 1) {
    throw new Error(`${name}に検証用のスライド数がありません。`);
  }
  const expectedHeadings = extractExpectedSlideHeadings(markdown);
  if (expectedHeadings.length !== slideCount) {
    throw new Error(`${name}の期待見出し数がスライド数と一致しません: headings=${expectedHeadings.length}, slides=${slideCount}`);
  }
  return { name, markdown, slideCount, expectedHeadings };
}));

const expectedFiles = [
  '01-minimal.md',
  '02-multiple-slides.md',
  '03-theme-default.md',
  '04-theme-gaia.md',
  '05-theme-uncover.md',
  '06-page-size-4-3.md',
  '07-directives.md',
  '08-local-inline-image.md',
  '09-local-background-image.md',
  '10-math-katex.md',
  '11-fit-and-code.md',
  '12-large-deck-performance.md',
];
for (const name of expectedFiles) {
  if (!sampleFiles.includes(name)) throw new Error(`必須サンプルがありません: ${name}`);
}
const largeDeck = samples.find((sample) => sample.name === '12-large-deck-performance.md');
const renderOrder = [largeDeck, ...samples.filter((sample) => sample !== largeDeck)];

const extensionRoot = path.resolve('dist');
const sampleRoot = path.resolve('sample');
const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? '/', origin ?? 'http://127.0.0.1');
  if (requestUrl.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(createWebviewShell(origin));
    return;
  }

  const baseDirectory = requestUrl.pathname.startsWith('/dist/')
    ? extensionRoot
    : requestUrl.pathname.startsWith('/sample/')
      ? sampleRoot
      : undefined;
  if (!baseDirectory) {
    response.writeHead(404).end('not found');
    return;
  }
  const relativePath = decodeURIComponent(requestUrl.pathname.slice(
    requestUrl.pathname.startsWith('/dist/') ? '/dist/'.length : '/sample/'.length,
  ));
  const filePath = path.resolve(baseDirectory, relativePath);
  const relativeToBase = path.relative(baseDirectory, filePath);
  if (relativeToBase.startsWith('..') || path.isAbsolute(relativeToBase)) {
    response.writeHead(403).end('forbidden');
    return;
  }
  try {
    const content = await readFile(filePath);
    response.writeHead(200, { 'content-type': contentType(filePath) }).end(content);
  } catch {
    response.writeHead(404).end('not found');
  }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('検証用HTTPサーバーを開始できません。');
const origin = `http://127.0.0.1:${address.port}`;
const remoteRequests = [];
const remoteServer = createServer((request, response) => {
  remoteRequests.push(request.url ?? '/');
  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': 'image/svg+xml; charset=utf-8',
  });
  response.end('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#17324d"/><text x="20" y="100" fill="white">Remote image fixture</text></svg>');
});
await new Promise((resolve, reject) => {
  remoteServer.once('error', reject);
  remoteServer.listen(0, '127.0.0.1', resolve);
});
const remoteAddress = remoteServer.address();
if (!remoteAddress || typeof remoteAddress === 'string') throw new Error('外部画像fixtureサーバーを開始できません。');
const remoteOrigin = `http://127.0.0.1:${remoteAddress.port}`;

const chromiumDirectory = path.resolve('.chromium');
const browserPath = await findFile(chromiumDirectory, 'chrome-headless-shell.exe');
if (!browserPath) throw new Error('Chromiumがありません。npm run pdf:install-browserを実行してください。');
const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const externalRequests = [];
const localImageRequests = [];
const marpWorkerRequests = [];
const workerInstanceCounts = { created: 0, revoked: 0 };
const measurements = [];
const themeCssByName = new Map();
const pageErrors = [];
const consoleErrors = [];

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(20_000);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin && url.origin !== remoteOrigin) externalRequests.push(request.url());
    if (url.pathname.endsWith('/marp-worker.js')) marpWorkerRequests.push(Date.now());
    if (url.pathname.endsWith('/sample/assets/local-sample.svg')) localImageRequests.push(request.url());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.addInitScript(({ firstMarkdown, firstUri }) => {
    window.__mveMessages = [];
    window.__mveSettings = {
      language: 'ja',
      imageDirectory: 'assets/${documentBasename}',
      maxPasteSizeMb: 20,
      remoteImagesEnabled: false,
      mermaidTheme: 'default',
      mermaidHostRendering: false,
      editorTheme: 'dark',
      viewMode: 'both',
      scrollSyncEnabled: true,
      previewImageResizeControlsVisible: true,
      workspaceTrusted: true,
    };
    if (window === window.top) {
      const scrollPerf = { active: false, handlerDurations: [], frameIntervals: [], longTasks: [] };
      window.__mveScrollPerf = scrollPerf;
      const listenerWrappers = new WeakMap();
      const originalAddEventListener = EventTarget.prototype.addEventListener;
      const originalRemoveEventListener = EventTarget.prototype.removeEventListener;
      const captureValue = (options) => typeof options === 'boolean' ? options : Boolean(options?.capture);
      EventTarget.prototype.addEventListener = function(type, listener, options) {
        if (type !== 'scroll' || !listener) return originalAddEventListener.call(this, type, listener, options);
        let targetListeners = listenerWrappers.get(this);
        if (!targetListeners) {
          targetListeners = new Map();
          listenerWrappers.set(this, targetListeners);
        }
        let captureListeners = targetListeners.get(listener);
        if (!captureListeners) {
          captureListeners = new Map();
          targetListeners.set(listener, captureListeners);
        }
        const capture = captureValue(options);
        let wrapper = captureListeners.get(capture);
        if (!wrapper) {
          wrapper = function(event) {
            const startedAt = performance.now();
            try {
              if (typeof listener === 'function') return listener.call(this, event);
              return listener.handleEvent(event);
            } finally {
              if (scrollPerf.active) scrollPerf.handlerDurations.push(performance.now() - startedAt);
            }
          };
          captureListeners.set(capture, wrapper);
        }
        return originalAddEventListener.call(this, type, wrapper, options);
      };
      EventTarget.prototype.removeEventListener = function(type, listener, options) {
        if (type !== 'scroll' || !listener) return originalRemoveEventListener.call(this, type, listener, options);
        const captureListeners = listenerWrappers.get(this)?.get(listener);
        const wrapper = captureListeners?.get(captureValue(options));
        return originalRemoveEventListener.call(this, type, wrapper ?? listener, options);
      };
      if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
        new PerformanceObserver((entries) => {
          scrollPerf.longTasks.push(...entries.getEntries().map((entry) => entry.duration));
        }).observe({ type: 'longtask', buffered: false });
      }
    }
    window.__mveHostText = firstMarkdown;
    window.__mveHostVersion = 1;
    window.__mveInitSent = false;
    window.__mveMarpBlobUrls = new Set();
    window.__mveMarpWorkerObjectUrls = new Set();
    window.__mveMarpBlobCreated = 0;
    window.__mveMarpBlobRevoked = 0;
    window.__mveNonMarpWorkerMessageCount = 0;
    window.__mveDelayWorkerMessages = false;
    window.__mveDelayedWorkerMessageCount = 0;
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, {
      construct(target, argumentsList) {
        const workerUrl = String(argumentsList[0] ?? '');
        const worker = Reflect.construct(target, argumentsList, target);
        const originalPostMessage = worker.postMessage.bind(worker);
        Object.defineProperty(worker, 'postMessage', {
          configurable: true,
          value: (...messageArguments) => {
            if (!window.__mveMarpWorkerObjectUrls.has(workerUrl)) {
              window.__mveNonMarpWorkerMessageCount += 1;
            }
            return originalPostMessage(...messageArguments);
          },
        });
        let onmessage;
        let wrappedMessageListener;
        Object.defineProperty(worker, 'onmessage', {
          configurable: true,
          get: () => onmessage,
          set: (handler) => {
            if (wrappedMessageListener) {
              worker.removeEventListener('message', wrappedMessageListener);
              wrappedMessageListener = undefined;
            }
            onmessage = handler;
            if (typeof handler === 'function') {
              wrappedMessageListener = (event) => {
                if (!window.__mveDelayWorkerMessages) {
                  handler.call(worker, event);
                  return;
                }
                window.__mveDelayedWorkerMessageCount += 1;
                window.setTimeout(() => handler.call(worker, event), 16_000);
              };
              worker.addEventListener('message', wrappedMessageListener);
            }
          },
        });
        return worker;
      },
    });
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = originalCreateObjectURL(blob);
      if (blob.size >= 950_000 && blob.size < 1_100_000) {
        window.__mveMarpBlobUrls.add(url);
        window.__mveMarpWorkerObjectUrls.add(url);
        window.__mveMarpBlobCreated += 1;
      }
      return url;
    };
    URL.revokeObjectURL = (url) => {
      if (window.__mveMarpBlobUrls.delete(url)) window.__mveMarpBlobRevoked += 1;
      originalRevokeObjectURL(url);
    };
    window.acquireVsCodeApi = () => ({
      postMessage(message) {
        window.__mveMessages.push(message);
        if (message.type === 'detectMarpMarkdown') {
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
          })), 0);
          return;
        }
        if (message.type !== 'ready' || window.__mveInitSent) return;
        window.__mveInitSent = true;
        setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
          data: {
            type: 'init',
            text: firstMarkdown,
            version: 1,
            uri: firstUri,
            settings: window.__mveSettings,
          },
        })), 0);
      },
      getState: () => undefined,
      setState: () => undefined,
    });
  }, {
    firstMarkdown: renderOrder[0].markdown,
    firstUri: `file:///C:/sample/marp/${renderOrder[0].name}`,
  });
  await page.goto(origin);
  await page.locator('.split-editor').waitFor();
  await page.waitForFunction(() => window.__mveMessages.some((message) => message.type === 'ready'));

  let currentMarkdown = renderOrder[0].markdown;
  let currentVersion = 1;
  await waitForRenderedDeck(page, '.split-preview .mve-marp-preview', renderOrder[0].slideCount);
  const initialElapsedMs = Date.now() - marpWorkerRequests[0];
  measurements.push({ name: renderOrder[0].name, mode: 'split', elapsedMs: initialElapsedMs });
  if (initialElapsedMs > 2_000) {
    throw new Error(`24枚デッキの初回表示が2秒を超えました: ${initialElapsedMs} ms`);
  }
  if (marpWorkerRequests.length !== 1) {
    throw new Error(`Marp Workerの初回取得回数が1ではありません: ${marpWorkerRequests.length}`);
  }
  await verifySample(page, renderOrder[0], '.split-preview .mve-marp-preview', themeCssByName);
  await verifySplitMarpScrollSync(page);
  await verifyNoPdfRequest(page, () => clickPrintPreview(page),
    '.mve-marp-preview-print', renderOrder[0].slideCount);
  await verifyPrintPreviewInteractions(page, renderOrder[0].slideCount);
  const nonMarpWorkerMessagesDuringMarp = await page.evaluate(() =>
    window.__mveNonMarpWorkerMessageCount);
  if (nonMarpWorkerMessagesDuringMarp !== 0) {
    throw new Error(`Marp表示中に通常Markdown Workerへ描画依頼が送信されました: ${nonMarpWorkerMessagesDuringMarp}`);
  }
  await page.waitForTimeout(100);
  const firstPrintSlide = page.frameLocator('.mve-marp-preview-print iframe').locator('.mve-marp-slide').first();
  const printSlideGeometry = await firstPrintSlide.evaluate((slide) => {
    const rect = slide.getBoundingClientRect();
    const heading = slide.querySelector('h1');
    const headingStyle = heading ? getComputedStyle(heading) : undefined;
    const svg = slide.querySelector('svg');
    const foreignObject = svg?.querySelector('foreignObject');
    const section = foreignObject?.querySelector('section');
    const box = (element) => {
      const value = element?.getBoundingClientRect();
      return value ? { x: value.x, y: value.y, width: value.width, height: value.height } : undefined;
    };
    return {
      slide: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      svg: box(svg),
      foreignObject: box(foreignObject),
      section: box(section),
      headingBox: box(heading),
      visibility: getComputedStyle(slide).visibility,
      opacity: getComputedStyle(slide).opacity,
      heading: heading?.textContent ?? '',
      headingColor: headingStyle?.color,
      headingFontSize: headingStyle?.fontSize,
    };
  });
  if (printSlideGeometry.slide.width < 300 || printSlideGeometry.slide.height < 200 ||
    !printSlideGeometry.foreignObject || printSlideGeometry.foreignObject.height < 200 ||
    printSlideGeometry.visibility !== 'visible' || printSlideGeometry.opacity === '0' ||
    !printSlideGeometry.heading.includes('Performance deck 01')) {
    throw new Error(`印刷プレビューの先頭スライドが可視状態ではありません: ${JSON.stringify(printSlideGeometry)}`);
  }
  const screenshotPath = path.join(os.tmpdir(), 'markdown-easy-visual-editor-marp-preview.png');
  await page.locator('.mve-marp-preview-print').screenshot({ path: screenshotPath });
  const slideScreenshotPath = path.join(os.tmpdir(), 'markdown-easy-visual-editor-marp-first-slide.png');
  await firstPrintSlide.screenshot({ path: slideScreenshotPath });
  const printPreviewText = await page.frameLocator('.mve-marp-preview-print iframe').locator('body').innerText();
  if (!printPreviewText.includes('Performance deck 01') || printPreviewText.includes('div.marpit > svg')) {
    throw new Error(`印刷プレビューにテーマCSSが文字として表示されるか、スライド本文がありません: ${printPreviewText.slice(0, 300)}`);
  }
  await clickPrintPreview(page);
  await waitForRenderedDeck(page, '.split-preview .mve-marp-preview', renderOrder[0].slideCount);

  for (const sample of renderOrder.slice(1)) {
    const elapsedMs = await replaceDocument(
      page,
      sample.markdown,
      currentMarkdown,
      currentVersion,
      '.split-preview .mve-marp-preview',
      sample.slideCount,
    );
    currentMarkdown = sample.markdown;
    currentVersion += 1;
    measurements.push({ name: sample.name, mode: 'split', elapsedMs });
    await verifySample(page, sample, '.split-preview .mve-marp-preview', themeCssByName);
    await verifyNoPdfRequest(page, () => clickPrintPreview(page),
      '.mve-marp-preview-print', sample.slideCount);
    await verifySample(page, sample, '.mve-marp-preview-print', themeCssByName);
    await clickPrintPreview(page);
    await waitForRenderedDeck(page, '.split-preview .mve-marp-preview', sample.slideCount);
    const outstandingWorkerUrls = await page.evaluate(() => window.__mveMarpBlobUrls.size);
    if (outstandingWorkerUrls > 1) {
      throw new Error(`Marp Worker Blob URLが増加しました: ${outstandingWorkerUrls}`);
    }
  }

  const themeNames = ['default', 'gaia', 'uncover'];
  if (themeNames.some((theme) => !themeCssByName.has(theme)) ||
    new Set(themeNames.map((theme) => themeCssByName.get(theme))).size !== themeNames.length) {
    throw new Error('Marpのdefault、gaia、uncoverテーマが個別に適用されていません。');
  }

  const performanceDurations = [];
  const performanceBase = renderOrder.find((sample) => sample.name === '12-large-deck-performance.md');
  let lastMarkdown = currentMarkdown;
  let lastVersion = currentVersion;
  for (let index = 0; index < 10; index += 1) {
    const updated = `${performanceBase.markdown}\n\n<!-- performance edit ${index + 1} -->\n`;
    const startedAt = Date.now();
    await replaceDocument(
      page,
      updated,
      lastMarkdown,
      lastVersion,
      '.split-preview .mve-marp-preview',
      performanceBase.slideCount,
    );
    const duration = await page.locator('.split-preview .mve-marp-preview')
      .getAttribute('data-mve-marp-render-duration-ms');
    performanceDurations.push(Number(duration));
    measurements.push({ name: `large redraw ${index + 1}`, mode: 'split', elapsedMs: Date.now() - startedAt });
    lastMarkdown = updated;
    lastVersion += 1;
  }
  const sortedDurations = [...performanceDurations].sort((left, right) => left - right);
  const p95RenderMs = sortedDurations[Math.ceil(sortedDurations.length * 0.95) - 1] ?? Infinity;
  if (p95RenderMs > 1_000) {
    throw new Error(`Worker起動後の24枚デッキ再描画p95が1秒を超えました: ${p95RenderMs} ms`);
  }

  const beforeRapidRenderCount = Number(await page.locator('.split-preview .mve-marp-preview')
    .getAttribute('data-mve-marp-render-count'));
  const rapidEditBase = performanceBase.markdown;
  for (let index = 0; index < 50; index += 1) {
    const changed = `${rapidEditBase}\n\nRapid revision ${index + 1}.\n`;
    await sendExternalChanges(page, changed, lastMarkdown, lastVersion);
    lastMarkdown = changed;
    lastVersion += 1;
  }
  await waitForRenderCount(page, '.split-preview .mve-marp-preview', beforeRapidRenderCount);
  await waitForRenderedDeck(page, '.split-preview .mve-marp-preview', performanceBase.slideCount);
  const finalText = await page.locator('.split-preview .mve-marp-preview iframe').contentFrame()
    .locator('.mve-marp-slide').last().textContent();
  if (!finalText?.includes('Rapid revision 50.') || finalText.includes('Rapid revision 49.')) {
    throw new Error(`連続編集後に最新世代だけが表示されていません: ${finalText?.slice(-240)}`);
  }

  for (let cycle = 0; cycle < 25; cycle += 1) {
    await clickPrintPreview(page);
    await waitForRenderedDeck(page, '.mve-marp-preview-print', performanceBase.slideCount);
    const printText = await page.frameLocator('.mve-marp-preview-print iframe')
      .locator('.mve-marp-slide').last().textContent();
    if (!printText?.includes('Rapid revision 50.') || printText.includes('Rapid revision 49.')) {
      throw new Error(`プレビュー専用モード${cycle + 1}回目の切替で最新編集が残りません: ${printText?.slice(-240)}`);
    }

    await clickPrintPreview(page);
    await waitForRenderedDeck(page, '.split-preview .mve-marp-preview', performanceBase.slideCount);
    const splitText = await page.locator('.split-preview .mve-marp-preview iframe').contentFrame()
      .locator('.mve-marp-slide').last().textContent();
    if (!splitText?.includes('Rapid revision 50.') || splitText.includes('Rapid revision 49.')) {
      throw new Error(`分割プレビュー${cycle + 1}回目の切替で最新編集が残りません: ${splitText?.slice(-240)}`);
    }
  }

  const delayedRenderMarkdown = `${performanceBase.markdown}\n\nDelayed render status probe.\n`;
  await page.evaluate(() => { window.__mveDelayWorkerMessages = true; });
  await sendExternalChanges(page, delayedRenderMarkdown, lastMarkdown, lastVersion);
  lastMarkdown = delayedRenderMarkdown;
  lastVersion += 1;
  await page.waitForFunction(() => window.__mveDelayedWorkerMessageCount > 0);
  await page.waitForTimeout(15_500);
  const delayedRenderState = await page.locator('.split-preview .mve-marp-preview')
    .evaluate((root) => ({
      status: root.getAttribute('data-mve-marp-status'),
      hasError: Boolean(root.querySelector('[role="alert"]')),
    }));
  if (delayedRenderState.status !== 'loading' || delayedRenderState.hasError) {
    throw new Error(`15秒を超えて描画中のMarp文書がエラー扱いになりました: ${JSON.stringify(delayedRenderState)}`);
  }
  await page.evaluate(() => { window.__mveDelayWorkerMessages = false; });
  await waitForRenderedDeck(page, '.split-preview .mve-marp-preview', performanceBase.slideCount);
  const delayedRenderText = await page.locator('.split-preview .mve-marp-preview iframe').contentFrame()
    .locator('.mve-marp-slide').last().textContent();
  if (!delayedRenderText?.includes('Delayed render status probe.')) {
    throw new Error('15秒を超えて待機したMarp Workerの応答がプレビューへ反映されませんでした。');
  }

  const scrollPerformance = await measureMarpScrollPerformance(page);
  if (scrollPerformance.handlerMaximumMs >= 15 || scrollPerformance.longTaskCount !== 0 ||
    scrollPerformance.frameMaximumMs > 60 || scrollPerformance.frameP95Ms > 35) {
    throw new Error(`Marpスクロール性能の上限を超えました: ${JSON.stringify(scrollPerformance)}`);
  }

  console.log(`Marp scroll performance: ${JSON.stringify(scrollPerformance)}`);
  const marpPdfRequests = await page.evaluate(() => window.__mveMessages.filter(
    (message) => message.type === 'renderPdfPreview',
  ).length);
  if (marpPdfRequests !== 0) throw new Error(`Marp文書からPDF描画要求が送信されました: ${marpPdfRequests}`);

  const remoteMarkdown = [
    '---',
    'marp: true',
    '---',
    '',
    '# Remote image setting',
    '',
    `![Remote image](${remoteOrigin}/fixture.svg)`,
    '',
  ].join('\n');
  await replaceDocument(page, remoteMarkdown, lastMarkdown, lastVersion,
    '.split-preview .mve-marp-preview', 1);
  lastMarkdown = remoteMarkdown;
  lastVersion += 1;
  const remoteImage = page.frameLocator('.split-preview .mve-marp-preview iframe').locator('.mve-marp-slide img');
  await remoteImage.waitFor();
  const blockedRemoteImage = await remoteImage.evaluate((image) => ({
    source: image.getAttribute('src'),
    naturalWidth: image.naturalWidth,
  }));
  if (blockedRemoteImage.source !== null || blockedRemoteImage.naturalWidth !== 0 || remoteRequests.length !== 0) {
    throw new Error(`remoteImages無効時に外部画像が読み込まれています: ${JSON.stringify({ blockedRemoteImage, remoteRequests })}`);
  }
  const beforeRemoteEnableCount = Number(await page.locator('.split-preview .mve-marp-preview')
    .getAttribute('data-mve-marp-render-count'));
  await sendRemoteImagesSetting(page, true);
  await waitForRenderCount(page, '.split-preview .mve-marp-preview', beforeRemoteEnableCount);
  await waitForRenderedDeck(page, '.split-preview .mve-marp-preview', 1);
  await page.waitForFunction(() => {
    const frame = document.querySelector('.split-preview .mve-marp-preview iframe');
    return frame?.srcdoc.includes(`img-src`) && frame.srcdoc.includes('https: http:');
  });
  await remoteImage.evaluate((image) => image.decode());
  const enabledRemoteImage = await remoteImage.evaluate((image) => ({
    source: image.getAttribute('src'),
    naturalWidth: image.naturalWidth,
  }));
  if (!enabledRemoteImage.source?.startsWith(remoteOrigin) || enabledRemoteImage.naturalWidth <= 0) {
    throw new Error(`remoteImages有効時に外部画像が表示されません: ${JSON.stringify(enabledRemoteImage)}`);
  }
  if (remoteRequests.length === 0) throw new Error('remoteImages有効時に外部画像を取得していません。');
  const remoteRequestCountAfterEnable = remoteRequests.length;
  const beforeRemoteDisableCount = Number(await page.locator('.split-preview .mve-marp-preview')
    .getAttribute('data-mve-marp-render-count'));
  await sendRemoteImagesSetting(page, false);
  await waitForRenderCount(page, '.split-preview .mve-marp-preview', beforeRemoteDisableCount);
  await waitForRenderedDeck(page, '.split-preview .mve-marp-preview', 1);
  await page.waitForFunction(() => {
    const frame = document.querySelector('.split-preview .mve-marp-preview iframe');
    return frame?.srcdoc.includes('img-src') && !frame.srcdoc.includes('https: http:');
  });
  await expectBlockedRemoteImage(remoteImage, remoteOrigin);
  if (remoteRequests.length !== remoteRequestCountAfterEnable) {
    throw new Error(`remoteImages無効化後も外部画像を取得しました: ${remoteRequestCountAfterEnable} -> ${remoteRequests.length}`);
  }
  if (externalRequests.length) {
    throw new Error(`外部CDNまたは未許可外部リソースへの要求が発生しました: ${externalRequests.join(', ')}`);
  }

  const ordinaryMarkdown = '# Ordinary Markdown\n\nThis uses the existing preview path.\n';
  await replaceDocument(page, ordinaryMarkdown, lastMarkdown, lastVersion, '.split-preview .rendered-markdown');
  await page.waitForFunction(() => window.__mveMarpBlobUrls.size === 0);
  await page.waitForFunction(() => window.__mveNonMarpWorkerMessageCount > 0);
  const workerCountAfterMarp = marpWorkerRequests.length;
  await clickPrintPreview(page);
  await page.waitForFunction(() => window.__mveMessages.some((message) => message.type === 'renderPdfPreview'));
  if (marpWorkerRequests.length !== workerCountAfterMarp) {
    throw new Error('通常Markdownへ戻った後にMarp Workerが再取得されました。');
  }

  if (externalRequests.length) {
    throw new Error(`外部CDNまたは外部リソースへの要求が発生しました: ${externalRequests.join(', ')}`);
  }
  if (localImageRequests.length === 0) {
    throw new Error('ローカル画像の取得が発生していません。Marp資産プロキシを確認してください。');
  }
  if (pageErrors.length) throw new Error(`Webviewまたはiframeで実行時エラーが発生しました: ${pageErrors.join(' | ')}`);
  const workerLifecycle = await page.evaluate(() => ({
    created: window.__mveMarpBlobCreated,
    revoked: window.__mveMarpBlobRevoked,
    outstanding: window.__mveMarpBlobUrls.size,
  }));
  workerInstanceCounts.created = workerLifecycle.created;
  workerInstanceCounts.revoked = workerLifecycle.revoked;
  if (workerLifecycle.created !== workerLifecycle.revoked || workerLifecycle.outstanding !== 0) {
    throw new Error(`Marp WorkerのObject URLが残っています: ${JSON.stringify(workerLifecycle)}`);
  }
  if (marpWorkerRequests.length !== 1 || workerLifecycle.created !== 1 || workerLifecycle.revoked !== 1) {
    throw new Error(`Webview内でMarp Workerが再利用されません: ${JSON.stringify({ requests: marpWorkerRequests.length, workerLifecycle })}`);
  }
  console.log(`Marp sample matrix: ${sampleFiles.length} files × split/print preview; initial24=${initialElapsedMs}ms; redraw p95=${p95RenderMs.toFixed(1)}ms; worker fetches=${marpWorkerRequests.length}; screenshot=${screenshotPath}; firstSlide=${slideScreenshotPath}; geometry=${JSON.stringify(printSlideGeometry)}`);
  console.log(`Worker URL lifecycle: created=${workerInstanceCounts.created}, revoked=${workerInstanceCounts.revoked}`);
  console.log(`rendered modes=${measurements.length}; themes=${[...themeCssByName.keys()].join(', ')}`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => remoteServer.close(resolve));
}

/**
 * Marp文書からコードフェンス外のスライド見出しを順番に取り出す。
 * @param markdown - 見出しを検証するMarp Markdown本文。
 * @returns スライド順に並べた期待見出し一覧。
 */
function extractExpectedSlideHeadings(markdown) {
  const body = markdown
    .replace(/^---[ \t]*\r?\n[\s\S]*?^(?:---|\.\.\.)[ \t]*\r?$/m, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const headings = [];
  let fenceCharacter;
  let fenceLength = 0;
  for (const line of body.split('\n')) {
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const marker = fence[1] ?? '';
      if (!fenceCharacter) {
        fenceCharacter = marker[0];
        fenceLength = marker.length;
      } else if (marker[0] === fenceCharacter && marker.length >= fenceLength) {
        fenceCharacter = undefined;
        fenceLength = 0;
      }
      continue;
    }
    if (fenceCharacter) continue;
    const heading = /^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    if (heading?.[1]) headings.push(heading[1].trim());
  }
  return headings;
}

/**
 * WebviewのCSP、base URI、Workerとiframe資産を含むテスト用HTMLを返す。
 * @param baseOrigin - テストサーバーのorigin。
 * @returns Webviewに似せたHTML shell。
 */
function createWebviewShell(baseOrigin) {
  const nonce = 'marp-matrix-shell-nonce';
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><base href="${baseOrigin}/sample/marp/"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${baseOrigin} https: http: data: blob:; font-src ${baseOrigin} data:; style-src ${baseOrigin} 'unsafe-inline'; script-src ${baseOrigin} 'nonce-${nonce}'; worker-src blob: data:; frame-src 'self' ${baseOrigin}; connect-src ${baseOrigin} blob:;"><link rel="stylesheet" href="${baseOrigin}/dist/styles.css"><link rel="stylesheet" href="${baseOrigin}/dist/webview.css"></head><body data-mve-markdown-worker-uri="${baseOrigin}/dist/markdown-worker.js" data-mve-markdown-rich-worker-uri="${baseOrigin}/dist/markdown-rich-worker.js" data-mve-markdown-fallback-uri="${baseOrigin}/dist/markdown-fallback.js" data-mve-marp-worker-uri="${baseOrigin}/dist/marp-worker.js" data-mve-marp-frame-uri="${baseOrigin}/dist/marp-frame.js" data-mve-marp-katex-fonts-uri="${baseOrigin}/dist/marp-katex-fonts/" data-mve-csp-source="${baseOrigin}" data-mve-csp-nonce="${nonce}" data-mve-remote-images="false" data-mve-export-fonts-uri="${baseOrigin}/dist/export-fonts.css" data-mve-mermaid-uri="${baseOrigin}/dist/mermaid.min.js"><div id="root"></div><script nonce="${nonce}" src="${baseOrigin}/dist/webview.js"></script></body></html>`;
}

/**
 * ファイル拡張子からHTTP応答のContent-Typeを決定する。
 * @param filePath - Content-Typeを求めるファイルパス。
 * @returns ブラウザーへ返すMIME type。
 */
function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  })[extension] ?? 'application/octet-stream';
}

/**
 * 指定したディレクトリから対象ファイル名を再帰検索する。
 * @param directory - 再帰検索を開始するディレクトリ。
 * @param targetName - 大文字小文字を区別せず検索するファイル名。
 * @returns 見つかったファイルの絶対パス。未検出時はundefined。
 */
async function findFile(directory, targetName) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === targetName.toLowerCase()) return candidate;
    if (entry.isDirectory()) {
      const nested = await findFile(candidate, targetName);
      if (nested) return nested;
    }
  }
  return undefined;
}

/**
 * Webview本文を外部変更として送信し、指定したプレビュー内容を待つ。
 * @param page - Marp検証に使用するWebviewページ。
 * @param markdown - Hostから同期する新しい本文。
 * @param previousMarkdown - Hostが保持している直前の本文。
 * @param previousVersion - 直前本文のHost version。
 * @param previewSelector - 描画完了を待つプレビュー要素selector。
 * @param expectedSlideCount - 期待するスライド数。通常Markdownでは省略する。
 * @returns Host更新を送信してから描画を確認するまでの経過時間。
 */
async function replaceDocument(page, markdown, previousMarkdown, previousVersion, previewSelector, expectedSlideCount) {
  const startedAt = Date.now();
  const previousRenderCount = expectedSlideCount
    ? Number(await page.locator(`${previewSelector}[data-mve-marp-status="ready"]`)
      .first().getAttribute('data-mve-marp-render-count'))
    : undefined;
  await sendExternalChanges(page, markdown, previousMarkdown, previousVersion);
  if (expectedSlideCount) {
    await waitForRenderCount(page, previewSelector, previousRenderCount);
    await waitForRenderedDeck(page, previewSelector, expectedSlideCount);
  } else {
    await page.waitForFunction(({ selector, length }) => (
      Number(document.querySelector('.source-editor')?.getAttribute('data-document-length')) === length &&
      document.querySelector(selector) !== null
    ), { selector: previewSelector, length: markdown.length });
  }
  return Date.now() - startedAt;
}

/**
 * Host versionを進め、完全置換のexternalChangesをWebviewへ送る。
 * @param page - Marp検証に使用するWebviewページ。
 * @param markdown - Hostから同期する新しい本文。
 * @param previousMarkdown - Hostが保持している直前の本文。
 * @param previousVersion - 直前本文のHost version。
 */
async function sendExternalChanges(page, markdown, previousMarkdown, previousVersion) {
  await page.evaluate(({ text, previousText, baseVersion }) => {
    window.__mveHostText = text;
    window.__mveHostVersion = baseVersion + 1;
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'externalChanges',
        baseVersion,
        version: baseVersion + 1,
        changes: [{ rangeOffset: 0, rangeLength: previousText.length, text }],
      },
    }));
  }, { text: markdown, previousText: previousMarkdown, baseVersion: previousVersion });
}

/**
 * 指定領域のMarp Worker描画とiframe内スライド数を確認する。
 * @param page - Marp検証に使用するWebviewページ。
 * @param selector - Marpプレビューのroot selector。
 * @param expectedSlideCount - 期待するスライド数。
 */
async function waitForRenderedDeck(page, selector, expectedSlideCount) {
  const root = page.locator(`${selector}[data-mve-marp-status="ready"]`).first();
  try {
    await page.waitForFunction(({ rootSelector }) => {
      const preview = document.querySelector(rootSelector);
      return preview?.getAttribute('data-mve-marp-status') === 'ready' ||
        preview?.getAttribute('data-mve-marp-status') === 'error';
    }, { rootSelector: selector });
  } catch (error) {
    const diagnostics = await page.evaluate(({ rootSelector }) => ({
      previews: Array.from(document.querySelectorAll(rootSelector), (preview) => ({
        status: preview.getAttribute('data-mve-marp-status'),
        renderCount: preview.getAttribute('data-mve-marp-render-count'),
        error: preview.querySelector('[role="alert"]')?.textContent,
        loading: preview.querySelector('[role="status"]')?.textContent,
      })),
      messages: window.__mveMessages.slice(-12).map((message) => message.type),
      marpWorkerUri: document.body.dataset.mveMarpWorkerUri,
      markdownWorkerStatus: document.body.dataset.mveMarkdownWorkerStatus,
      bodyText: document.body.innerText.slice(-1000),
    }), { rootSelector: selector });
    throw new Error(`Marpプレビューの状態待機が期限内に完了しませんでした: ${JSON.stringify({ diagnostics, marpWorkerRequests: marpWorkerRequests.length, pageErrors: pageErrors.slice(-8), consoleErrors: consoleErrors.slice(-8) })}; ${error instanceof Error ? error.message : String(error)}`);
  }
  const previewStatus = await page.locator(selector).first().getAttribute('data-mve-marp-status');
  if (previewStatus === 'error') {
    const errorText = await page.locator(`${selector} [role="alert"]`).first().textContent();
    throw new Error(`Marp Workerまたはiframeから描画失敗が通知されました: ${errorText ?? '詳細なし'}`);
  }
  const reportedSlideCount = Number(await root.getAttribute('data-mve-marp-slide-count'));
  if (reportedSlideCount !== expectedSlideCount) {
    throw new Error(`${selector}の描画完了通知スライド数が不一致です: expected=${expectedSlideCount}, actual=${reportedSlideCount}`);
  }
  const frame = page.frameLocator(`${selector} iframe`);
  try {
    await frame.locator('.mve-marp-slide').nth(expectedSlideCount - 1).waitFor();
  } catch (error) {
    const srcdoc = await page.locator(`${selector} iframe`).evaluate((element) => element.srcdoc);
    throw new Error(`${error instanceof Error ? error.message : String(error)}; iframe script loading diagnostics: ${JSON.stringify({ srcdocPrefix: srcdoc.slice(0, 520), consoleErrors: consoleErrors.slice(-8) })}`);
  }
  const actualCount = await frame.locator('.mve-marp-slide').count();
  if (actualCount !== expectedSlideCount) {
    throw new Error(`${selector}のスライド数が不一致です: expected=${expectedSlideCount}, actual=${actualCount}`);
  }
  const slideSizes = await frame.locator('.mve-marp-slide').evaluateAll((slides) => slides.map((slide) => {
    const rect = slide.getBoundingClientRect();
    const foreignObject = slide.querySelector('svg foreignObject');
    const foreignRect = foreignObject?.getBoundingClientRect();
    return {
      index: Number(slide.getAttribute('data-slide-index')),
      width: rect.width,
      height: rect.height,
      foreignWidth: foreignRect?.width ?? 0,
      foreignHeight: foreignRect?.height ?? 0,
      visibility: getComputedStyle(slide).visibility,
      opacity: getComputedStyle(slide).opacity,
    };
  }));
  const invalidSlide = slideSizes.find((slide, index) =>
    slide.index !== index ||
    slide.width < 300 ||
    slide.height < 200 ||
    slide.foreignWidth < 300 ||
    slide.foreignHeight < 200 ||
    slide.visibility !== 'visible' ||
    slide.opacity === '0');
  if (invalidSlide) {
    throw new Error(`${selector}に内容領域のないスライドがあります: ${JSON.stringify(invalidSlide)}`);
  }
}

/**
 * Marp Workerの描画回数が指定値より増えるまで待機する。
 * @param page - Marp検証に使用するWebviewページ。
 * @param selector - Marpプレビューのroot selector。
 * @param previousCount - 更新前の描画回数。
 */
async function waitForRenderCount(page, selector, previousCount) {
  await page.waitForFunction(({ rootSelector, count }) => {
    const root = document.querySelector(rootSelector);
    return Number(root?.getAttribute('data-mve-marp-render-count')) > count;
  }, { rootSelector: selector, count: previousCount });
}

/**
 * Marpのプレビューコンテナーを一定時間往復スクロールして性能値を収集する。
 * @param page - Marp検証に使用するWebviewページ。
 * @returns ハンドラー、Long Task、描画フレーム間隔の計測値。
 */
async function measureMarpScrollPerformance(page) {
  await page.locator('.split-preview .mve-marp-preview[data-mve-marp-status="ready"]').waitFor();
  const raw = await page.evaluate(async () => {
    const container = document.querySelector('.split-preview');
    const measurements = window.__mveScrollPerf;
    if (!container || !measurements) throw new Error('Marpスクロール計測器を初期化できません。');
    measurements.handlerDurations.length = 0;
    measurements.frameIntervals.length = 0;
    measurements.longTasks.length = 0;
    measurements.active = true;
    const initialTop = container.scrollTop;
    const maximumTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const startedAt = performance.now();
    await new Promise((resolve) => {
      let previousFrame = startedAt;
      let direction = 1;
      const step = (now) => {
        measurements.frameIntervals.push(now - previousFrame);
        previousFrame = now;
        if (container.scrollTop >= maximumTop - 1) direction = -1;
        if (container.scrollTop <= 1) direction = 1;
        container.scrollTop = Math.max(0, Math.min(maximumTop, container.scrollTop + direction * 28));
        if (now - startedAt < 1_800) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    measurements.active = false;
    container.scrollTop = initialTop;
    const durations = measurements.handlerDurations.slice().sort((left, right) => left - right);
    const frames = measurements.frameIntervals.slice().sort((left, right) => left - right);
    const percentile = (values, fraction) => values[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? Infinity;
    return {
      handlerCount: durations.length,
      handlerMaximumMs: durations.at(-1) ?? Infinity,
      handlerP95Ms: percentile(durations, 0.95),
      longTaskCount: measurements.longTasks.length,
      longTaskMaximumMs: Math.max(0, ...measurements.longTasks),
      frameCount: frames.length,
      frameMaximumMs: frames.at(-1) ?? Infinity,
      frameP95Ms: percentile(frames, 0.95),
      frameP99Ms: percentile(frames, 0.99),
    };
  });
  if (raw.handlerCount < 10 || raw.frameCount < 30) {
    throw new Error(`Marpスクロール性能計測のサンプル数が不足しています: ${JSON.stringify(raw)}`);
  }
  return raw;
}

/**
 * テストWebviewへリモート画像許可設定を送信する。
 * @param page - Marp検証に使用するWebviewページ。
 * @param enabled - リモート画像を許可する場合はtrue。
 */
async function sendRemoteImagesSetting(page, enabled) {
  await page.evaluate((remoteImagesEnabled) => {
    window.__mveSettings = { ...window.__mveSettings, remoteImagesEnabled };
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'settingsChanged', settings: window.__mveSettings },
    }));
  }, enabled);
}

/**
 * リモート画像設定が無効な状態で、iframe CSPが外部画像を拒否することを確認する。
 * @param image - Marp iframe内の外部画像。
 * @param remoteOriginValue - テスト用外部画像サーバーのorigin。
 */
async function expectBlockedRemoteImage(image, remoteOriginValue) {
  await image.evaluate((element) => element.decode().catch(() => undefined));
  const state = await image.evaluate((element) => ({
    source: element.getAttribute('src'),
    naturalWidth: element.naturalWidth,
  }));
  if ((state.source !== null && !state.source.startsWith(remoteOriginValue)) || state.naturalWidth !== 0) {
    throw new Error(`remoteImages無効時も外部画像が表示されています: ${JSON.stringify(state)}`);
  }
}

/**
 * サンプル固有のテーマ、画像、数式、比率、directiveを確認する。
 * @param page - Marp検証に使用するWebviewページ。
 * @param sample - ファイル名、本文、期待するスライド数を持つサンプル。
 * @param selector - Marpプレビューのroot selector。
 * @param themeCssByName - テーマ別CSSを比較するMap。
 */
async function verifySample(page, sample, selector, themeCssByName) {
  await waitForRenderedDeck(page, selector, sample.slideCount);
  const frame = page.frameLocator(`${selector} iframe`);
  const renderedSlides = await frame.locator('.mve-marp-slide').evaluateAll((slides) => slides.map((slide) => {
    const heading = slide.querySelector('h1, h2, h3, h4, h5, h6');
    const headingRect = heading?.getBoundingClientRect();
    return {
      heading: heading?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      content: slide.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      headingWidth: headingRect?.width ?? 0,
      headingHeight: headingRect?.height ?? 0,
    };
  }));
  for (const [index, expectedHeading] of sample.expectedHeadings.entries()) {
    const actual = renderedSlides[index];
    const normalizedExpected = expectedHeading.replace(/\s+/g, ' ').trim();
    if (!actual || !actual.heading.includes(normalizedExpected) ||
      !actual.content.includes(normalizedExpected) || actual.headingWidth <= 0 || actual.headingHeight <= 0) {
      throw new Error(`${sample.name}の${index + 1}枚目に期待する見出しが可視描画されていません: expected=${JSON.stringify(normalizedExpected)}, actual=${JSON.stringify(actual)}`);
    }
  }
  const themeCss = await frame.locator('#mve-marp-theme').textContent() ?? '';
  if (themeCss.length < 100) throw new Error(`${sample.name}のテーマCSSが空です。`);
  const themeStyleDisplay = await frame.locator('#mve-marp-theme').evaluate((element) => getComputedStyle(element).display);
  if (themeStyleDisplay !== 'none') throw new Error(`${sample.name}のテーマCSSが表示状態です: ${themeStyleDisplay}`);
  const theme = /^theme:\s*(\w+)/m.exec(sample.markdown)?.[1] ?? 'default';
  themeCssByName.set(theme, themeCss);

  if (sample.name === '06-page-size-4-3.md') {
    const viewBox = await frame.locator('.mve-marp-slide svg').first().getAttribute('viewBox');
    const dimensions = viewBox?.split(/\s+/).map(Number) ?? [];
    if (dimensions.length !== 4 || Math.abs(dimensions[2] / dimensions[3] - 4 / 3) > 0.01) {
      throw new Error(`4:3スライドの比率が保たれていません: ${viewBox}`);
    }
  }
  if (sample.name === '07-directives.md') {
    const html = await frame.locator('.mve-marp-slide').first().innerHTML();
    if (!html.includes('#17324d') || !html.includes('#f4f7fa')) {
      throw new Error('Marp global color directiveが適用されていません。');
    }
    const secondSlide = await frame.locator('.mve-marp-slide').nth(1).innerHTML();
    if (!secondSlide.includes('lead') || !secondSlide.includes('#f1e4c6')) {
      throw new Error('Marp local slide directiveが適用されていません。');
    }
  }
  if (sample.name === '08-local-inline-image.md') {
    const image = frame.locator('.mve-marp-slide img').first();
    await image.waitFor();
    const state = await image.evaluate((node) => ({
      complete: node.complete,
      width: node.naturalWidth,
      source: node.getAttribute('src') ?? '',
    }));
    if (!state.complete || state.width <= 0 || !state.source.startsWith('data:image/svg+xml;base64,')) {
      throw new Error(`ローカルのインライン画像がsandbox用data URIで表示されていません: ${JSON.stringify(state)}`);
    }
    if (selector === '.mve-marp-preview-print') {
      await image.click();
      const dialog = page.locator('.image-preview-dialog');
      await dialog.waitFor({ state: 'visible' });
      const previewSource = await dialog.locator('.image-preview-canvas img').getAttribute('src');
      if (!previewSource?.includes('/sample/assets/local-sample.svg') || previewSource.startsWith('data:')) {
        throw new Error(`画像詳細表示に元のローカル画像URIが渡されていません: ${previewSource}`);
      }
      await dialog.locator('.image-preview-close-button').click();
    }
  }
  if (sample.name === '09-local-background-image.md') {
    const background = frame.locator('.mve-marp-slide figure[style*="background-image"]').first();
    if (!(await background.count())) throw new Error('Marp background image directiveがスライドにありません。');
    const backgroundImage = await background.evaluate((node) => getComputedStyle(node).backgroundImage);
    if (!backgroundImage.includes('data:image/svg+xml;base64,')) {
      throw new Error(`ローカル背景画像がsandbox iframe向けのdata URIに変換されていません: ${backgroundImage}`);
    }
  }
  if (sample.name === '10-math-katex.md') {
    if (!(await frame.locator('.katex').count())) {
      throw new Error('同梱KaTeXで数式が描画されていません。');
    }
    if (!/url\(["']?data:[^)]+\)/i.test(themeCss)) {
      throw new Error('KaTeXフォントがsandbox iframe向けdata URIへ変換されていません。');
    }
    const fontsReady = await frame.locator('.katex').first().evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check('16px KaTeX_Main');
    });
    if (!fontsReady) throw new Error('同梱KaTeXフォントが読み込まれていません。');
  }
  if (sample.name === '11-fit-and-code.md' && !(await frame.locator('.hljs-keyword').count())) {
    throw new Error('Marpのfit見出しまたは主要言語のコード描画がありません。');
  }
  if (sample.name === '12-large-deck-performance.md' && !(await frame.locator('.mve-marp-slide').last().textContent())?.includes('Performance deck 24')) {
    throw new Error('24枚目のスライドが最終位置にありません。');
  }
}

/**
 * 印刷プレビューモードを開閉し、MarpではPDF要求を送らず描画されることを確認する。
 * @param page - Marp検証に使用するWebviewページ。
 * @param toggle - 印刷プレビューを開閉する関数。
 * @param selector - Marp印刷プレビューroot selector。
 * @param slideCount - 期待するスライド数。
 */
async function verifyNoPdfRequest(page, toggle, selector, slideCount) {
  const before = await page.evaluate(() => window.__mveMessages.filter(
    (message) => message.type === 'renderPdfPreview',
  ).length);
  await toggle();
  await waitForRenderedDeck(page, selector, slideCount);
  const after = await page.evaluate(() => window.__mveMessages.filter(
    (message) => message.type === 'renderPdfPreview',
  ).length);
  if (after !== before) throw new Error(`Marp印刷プレビューがPDF描画を依頼しました: ${before} -> ${after}`);
}

/**
 * 印刷プレビューのズーム、スクロール、アウトライン移動とアンカー復元を確認する。
 * @param page - Marp検証に使用するWebviewページ。
 * @param slideCount - 期待するスライド数。
 */
async function verifyPrintPreviewInteractions(page, slideCount) {
  if (slideCount < 2) return;
  const preview = page.locator('.mve-marp-preview-print');
  const toolbar = preview.locator('.pdf-preview-toolbar');
  await toolbar.waitFor({ state: 'visible' });
  const zoomValue = toolbar.locator('.pdf-preview-zoom-value');
  const beforeZoom = await zoomValue.textContent();
  const frame = preview.locator('iframe');
  const beforeZoomWidth = await frame.evaluate((element) => element.getBoundingClientRect().width);
  await toolbar.getByRole('button', { name: 'PDFズームイン' }).click();
  await page.waitForFunction((previous) => {
    const value = document.querySelector('.mve-marp-preview-print .pdf-preview-zoom-value')?.textContent;
    return value !== previous;
  }, beforeZoom);
  const afterZoomWidth = await frame.evaluate((element) => element.getBoundingClientRect().width);
  if (afterZoomWidth <= beforeZoomWidth * 1.05) {
    throw new Error(`Marpスライドのズームで表示幅が拡大しません: ${beforeZoomWidth} -> ${afterZoomWidth}`);
  }

  const editorArea = page.locator('.editor-area');
  const editorMetrics = await editorArea.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  if (editorMetrics.scrollHeight <= editorMetrics.clientHeight) {
    throw new Error(`Marp印刷プレビューの外側スクロール領域が生成されていません: ${JSON.stringify(editorMetrics)}`);
  }
  await editorArea.hover();
  await page.mouse.wheel(0, 1_200);
  await page.waitForFunction(() => document.querySelector('.editor-area')?.scrollTop > 0);
  const scrolledTop = await editorArea.evaluate((element) => element.scrollTop);
  if (scrolledTop <= 0) throw new Error('Marp印刷プレビューの外側スクロールが反応しません。');

  const targetSlide = Math.min(11, slideCount - 1);
  const targetHeading = `Performance deck ${String(targetSlide + 1).padStart(2, '0')}`;
  const outlineItem = page.locator('.outline-item').filter({ hasText: targetHeading }).first();
  if (!(await outlineItem.count())) throw new Error(`アウトラインに対象見出しがありません: ${targetHeading}`);
  await outlineItem.click();
  await page.waitForTimeout(80);
  const targetViewportTop = await getPrintSlideViewportTop(page, targetSlide);
  if (Math.abs(targetViewportTop) > 160) {
    throw new Error(`アウトライン操作が${targetHeading}のスライドへ移動しません: ${targetViewportTop}px`);
  }
  const zoomedValue = await zoomValue.textContent();
  await toolbar.getByRole('button', { name: 'PDFズームアウト' }).click();
  await page.waitForFunction((previous) => {
    const value = document.querySelector('.mve-marp-preview-print .pdf-preview-zoom-value')?.textContent;
    return value !== previous;
  }, zoomedValue);
  const restoredTop = await waitForPrintSlideTop(page, targetSlide, 180, 2_000);
  if (Math.abs(restoredTop) > 180) {
    const restoreState = await page.evaluate(() => {
      const editor = document.querySelector('.editor-area');
      const previewRoot = document.querySelector('.mve-marp-preview-print');
      const iframe = previewRoot?.querySelector('iframe');
      return {
        zoom: previewRoot?.querySelector('.pdf-preview-zoom-value')?.textContent,
        editorScrollTop: editor?.scrollTop,
        editorScrollHeight: editor?.scrollHeight,
        previewTop: previewRoot?.getBoundingClientRect().top,
        previewScrollTop: previewRoot?.scrollTop,
        iframeTop: iframe?.getBoundingClientRect().top,
        iframeTransform: iframe?.parentElement ? getComputedStyle(iframe.parentElement).transform : undefined,
      };
    });
    throw new Error(`印刷プレビューのズーム後に表示アンカーが復元されません: ${restoredTop}px ${JSON.stringify(restoreState)}`);
  }

  const firstMidSlideTop = await setPrintSlideViewportTop(page, targetSlide, -110);
  if (firstMidSlideTop > -30 || firstMidSlideTop < -260) {
    throw new Error(`再ズーム検査の開始位置を対象スライド途中へ設定できません: ${firstMidSlideTop}px`);
  }
  const beforeSecondZoom = await zoomValue.textContent();
  await toolbar.getByRole('button', { name: 'PDFズームイン' }).click();
  await page.waitForFunction((previous) =>
    document.querySelector('.mve-marp-preview-print .pdf-preview-zoom-value')?.textContent !== previous,
  beforeSecondZoom);
  const afterSecondZoomTop = await waitForPrintSlideTop(page, targetSlide, 25, 2_000);
  if (Math.abs(afterSecondZoomTop - firstMidSlideTop) > 25) {
    throw new Error(`途中スクロール後のズームで表示位置が飛びました: ${firstMidSlideTop} -> ${afterSecondZoomTop}`);
  }

  const secondMidSlideTop = await setPrintSlideViewportTop(page, targetSlide, -180);
  if (secondMidSlideTop > -40 || secondMidSlideTop < -320) {
    throw new Error(`モード切替検査の開始位置を対象スライド途中へ設定できません: ${secondMidSlideTop}px`);
  }
  await clickPrintPreview(page);
  await waitForRenderedDeck(page, '.split-preview .mve-marp-preview', slideCount);
  await clickPrintPreview(page);
  await waitForRenderedDeck(page, '.mve-marp-preview-print', slideCount);
  const restoredAfterModeChange = await waitForPrintSlideTop(page, targetSlide, 30, 2_000);
  if (Math.abs(restoredAfterModeChange - secondMidSlideTop) > 30) {
    throw new Error(`プレビュー切替後に途中スクロール位置が復元されません: ${secondMidSlideTop} -> ${restoredAfterModeChange}`);
  }

  const frameContent = page.frameLocator('.mve-marp-preview-print iframe');
  await frameContent.locator('.mve-marp-slide').nth(targetSlide).click({ position: { x: 20, y: 20 } });
  const beforePageDown = await editorArea.evaluate((element) => element.scrollTop);
  await page.keyboard.press('PageDown');
  await page.waitForFunction((previous) =>
    (document.querySelector('.editor-area')?.scrollTop ?? previous) > previous + 80,
  beforePageDown);
  const afterPageDown = await editorArea.evaluate((element) => element.scrollTop);
  await page.keyboard.press('Home');
  await page.waitForFunction(() => (document.querySelector('.editor-area')?.scrollTop ?? 1) <= 1);
  if (afterPageDown <= beforePageDown + 80) {
    throw new Error(`iframeフォーカス中のPageDownが印刷プレビューをスクロールしません: ${beforePageDown} -> ${afterPageDown}`);
  }
}

/**
 * Marpのスライドスクロールから既存のソース表示位置同期が動くことを確認する。
 * @param page - Marp検証に使用するWebviewページ。
 */
async function verifySplitMarpScrollSync(page) {
  const sourceScroller = page.locator('.split-source-pane:not(.pane-hidden) .cm-scroller');
  const preview = page.locator('.split-preview');
  const initialSourceTop = await sourceScroller.evaluate((element) => element.scrollTop);
  await preview.hover();
  await page.mouse.wheel(0, 900);
  await page.waitForFunction((initial) => {
    const scroller = document.querySelector('.split-source-pane:not(.pane-hidden) .cm-scroller');
    return scroller && Math.abs(scroller.scrollTop - initial) > 5;
  }, initialSourceTop, { timeout: 5_000 }).catch(() => undefined);
  const nextSourceTop = await sourceScroller.evaluate((element) => element.scrollTop);
  if (Math.abs(nextSourceTop - initialSourceTop) <= 5) {
    throw new Error(`Marpプレビューのスクロールがソース位置へ同期されません: ${initialSourceTop} -> ${nextSourceTop}`);
  }
  const initialPreviewTop = await preview.evaluate((element) => element.scrollTop);
  const sourceMetrics = await sourceScroller.evaluate((element) => ({
    top: element.scrollTop,
    maximum: element.scrollHeight - element.clientHeight,
    offset: element.closest('.source-editor')?.getAttribute('data-viewport-offset'),
  }));
  await sourceScroller.hover();
  await page.mouse.wheel(0, sourceMetrics.top + 200 < sourceMetrics.maximum ? 900 : -900);
  await page.waitForFunction((initial) => {
    const element = document.querySelector('.split-source-pane:not(.pane-hidden) .cm-scroller');
    return element && Math.abs(element.scrollTop - initial) > 5;
  }, sourceMetrics.top, { timeout: 5_000 }).catch(() => undefined);
  const sourceTopAfterWheel = await sourceScroller.evaluate((element) => element.scrollTop);
  const sourceOffsetAfterWheel = await sourceScroller.evaluate((element) =>
    element.closest('.source-editor')?.getAttribute('data-viewport-offset'));
  if (Math.abs(sourceTopAfterWheel - sourceMetrics.top) <= 5) {
    throw new Error(`検証用ソーススクロールが動作しません: ${JSON.stringify(sourceMetrics)} -> ${sourceTopAfterWheel}`);
  }
  await page.waitForFunction((initial) => {
    const element = document.querySelector('.split-preview');
    return element && Math.abs(element.scrollTop - initial) > 5;
  }, initialPreviewTop, { timeout: 5_000 }).catch(() => undefined);
  const nextPreviewTop = await preview.evaluate((element) => element.scrollTop);
  if (Math.abs(nextPreviewTop - initialPreviewTop) <= 5) {
    throw new Error(`ソーススクロールがMarpプレビューへ同期されません: ${initialPreviewTop} -> ${nextPreviewTop}; source=${JSON.stringify(sourceMetrics)}->${sourceTopAfterWheel}/${sourceOffsetAfterWheel}`);
  }
}

/**
 * 印刷プレビューの外側表示領域に対する対象スライドの位置を測る。
 * @param page - Marp検証に使用するWebviewページ。
 * @param slideIndex - 0始まりの対象スライド番号。
 * @returns 対象スライド先頭のビューポートY座標。
 */
async function getPrintSlideViewportTop(page, slideIndex) {
  const frame = page.frameLocator('.mve-marp-preview-print iframe');
  const slideTop = await frame.locator('.mve-marp-slide').nth(slideIndex)
    .evaluate((element) => element.getBoundingClientRect().top);
  const frameMetrics = await page.locator('.mve-marp-preview-print iframe').evaluate((element) => ({
    top: element.getBoundingClientRect().top,
    transform: getComputedStyle(element.parentElement).transform,
  }));
  const scale = Number(/matrix\(([-.\d]+)/.exec(frameMetrics.transform)?.[1] ?? 1);
  return frameMetrics.top + slideTop * scale;
}

/**
 * 指定スライドの先頭をプレビュー表示領域内の指定位置へ移動する。
 * @param page - Marp検証に使用するWebviewページ。
 * @param slideIndex - 0始まりの対象スライド番号。
 * @param targetTop - 対象スライド先頭の目標ビューポートY座標。
 * @returns 移動後に実測したスライド先頭のビューポートY座標。
 */
async function setPrintSlideViewportTop(page, slideIndex, targetTop) {
  const currentTop = await getPrintSlideViewportTop(page, slideIndex);
  await page.locator('.editor-area').evaluate((element, delta) => {
    element.scrollTop += delta;
  }, currentTop - targetTop);
  await page.waitForTimeout(80);
  return getPrintSlideViewportTop(page, slideIndex);
}

/**
 * 対象スライドが指定位置へ戻るまで実測値を再確認する。
 * @param page - Marp検証に使用するWebviewページ。
 * @param slideIndex - 0始まりの対象スライド番号。
 * @param maximumDistance - 目標ビューポート位置から許容する最大距離。
 * @param timeoutMs - 復元を待つ最大時間。
 * @returns 最後に取得した対象スライド先頭のビューポートY座標。
 */
async function waitForPrintSlideTop(page, slideIndex, maximumDistance, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let top = Infinity;
  while (Date.now() < deadline) {
    top = await getPrintSlideViewportTop(page, slideIndex);
    if (Math.abs(top) <= maximumDistance) return top;
    await page.waitForTimeout(50);
  }
  return top;
}

/**
 * 印刷プレビューの切替ボタンを実操作する。
 * @param page - Marp検証に使用するWebviewページ。
 */
async function clickPrintPreview(page) {
  await page.getByRole('tab', { name: '出力', exact: true }).click();
  await page.getByRole('button', { name: '印刷プレビュー', exact: true }).click();
}

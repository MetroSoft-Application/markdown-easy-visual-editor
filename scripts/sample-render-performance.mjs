/**
 * @fileoverview sample配下の全Markdownを実際のWebviewで開き、初回描画と表示内容を検証する。
 */
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { isMap, parseDocument } from 'yaml';

const sampleRoot = path.resolve('sample');
const distRoot = path.resolve('dist');
const resourcesRoot = path.resolve('resources');
const markdownPaths = (await listMarkdownFiles(sampleRoot)).sort();
if (markdownPaths.length < 10) {
  throw new Error(`sample内のMarkdownが10個未満です: ${markdownPaths.length}`);
}

const samples = await Promise.all(markdownPaths.map(async (relativePath) => {
  const filePath = path.join(sampleRoot, ...relativePath.split('/'));
  const markdown = (await readFile(filePath, 'utf8')).replace(/\r\n?/g, '\n');
  const expectedHeadings = extractHeadings(markdown);
  return {
    relativePath,
    markdown,
    bytes: (await stat(filePath)).size,
    isMarp: isMarpMarkdown(markdown),
    expectedText: expectedHeadings[0] ?? extractFirstContent(markdown),
    expectedHeadings,
    expectedMissingImageRefs: extractExpectedMissingImageRefs(markdown),
  };
}));
const requestedSamples = process.env.MVE_SAMPLE_RENDER_FILTER
  ? new Set(process.env.MVE_SAMPLE_RENDER_FILTER.split(',').map((value) => value.trim()).filter(Boolean))
  : undefined;
const selectedSamples = requestedSamples
  ? samples.filter((sample) => requestedSamples.has(sample.relativePath))
  : samples;
if (requestedSamples && selectedSamples.length !== requestedSamples.size) {
  const missingSamples = [...requestedSamples].filter((relativePath) =>
    !samples.some((sample) => sample.relativePath === relativePath));
  throw new Error(`sample性能検証に存在しないパスが指定されました: ${missingSamples.join(', ')}`);
}
const repetitions = Math.max(1, Number.parseInt(process.env.MVE_SAMPLE_RENDER_RUNS ?? '3', 10) || 3);
/**
 * 再利用するHTTP/Chromiumキャッシュの条件を検証用環境変数から読み込む。
 */
const renderConditions = (process.env.MVE_SAMPLE_RENDER_CONDITIONS ?? 'cold')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
if (!renderConditions.length || renderConditions.some((condition) => !['cold', 'warm'].includes(condition))) {
  throw new Error(`不明なsample描画条件です: ${renderConditions.join(',')}`);
}

const externalRequests = [];
const servedResourceCounts = new Map();
let origin;
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', origin ?? 'http://127.0.0.1');
  if (url.pathname === '/') {
    const sampleDirectory = decodeURIComponent(url.searchParams.get('directory') ?? '');
    if (sampleDirectory.split('/').some((segment) => segment === '..')) {
      response.writeHead(400).end('invalid sample directory');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(createWebviewShell(origin, sampleDirectory));
    return;
  }

  const baseDirectory = url.pathname.startsWith('/dist/')
    ? distRoot
    : url.pathname.startsWith('/sample/')
      ? sampleRoot
      : url.pathname.startsWith('/resources/')
      ? resourcesRoot
      : undefined;
  if (!baseDirectory) {
    response.writeHead(404).end('not found');
    return;
  }

  const relativePath = decodeURIComponent(url.pathname.slice(url.pathname.indexOf('/', 1) + 1));
  const filePath = path.resolve(baseDirectory, relativePath);
  const relativeToRoot = path.relative(baseDirectory, filePath);
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    response.writeHead(403).end('forbidden');
    return;
  }

  servedResourceCounts.set(url.pathname, (servedResourceCounts.get(url.pathname) ?? 0) + 1);
  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      'content-type': `${contentType(filePath)}; charset=utf-8`,
      'cache-control': 'public, max-age=3600',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end('not found');
  }
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('sample性能検証用HTTPサーバーを開始できません。');
origin = `http://127.0.0.1:${address.port}`;

const browserPath = await findFile(path.resolve('.chromium'), 'chrome-headless-shell.exe');
if (!browserPath) throw new Error('Chromiumがありません。npm run pdf:install-browserを実行してください。');
const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const measurements = [];
const pageErrors = [];
const failures = [];

try {
  console.log(`sample描画性能計測: files=${selectedSamples.length}, conditions=${renderConditions.join(',')}, runs=${repetitions}`);
  for (const condition of renderConditions) {
    for (let run = 1; run <= repetitions; run += 1) {
      for (const sample of selectedSamples) {
        try {
          const measurement = await measureSample(sample, condition);
          measurements.push({ ...measurement, condition, run });
          console.log(`${condition} run ${run}/${repetitions} ${sample.relativePath}: ${measurement.firstVisibleMs} ms`);
        } catch (error) {
          const failure = {
            path: sample.relativePath,
            type: sample.isMarp ? 'Marp' : 'Markdown',
            condition,
            run,
            error: error instanceof Error ? error.message.slice(0, 2500) : String(error).slice(0, 2500),
          };
          failures.push(failure);
          console.error(`FAIL ${condition} run ${run}/${repetitions} ${sample.relativePath}: ${failure.error}`);
        }
      }
    }
  }

  const fileSummaries = renderConditions.flatMap((condition) =>
    summarizeFiles(
      selectedSamples,
      measurements.filter((measurement) => measurement.condition === condition),
    ).map((summary) => {
      const failedRuns = failures
        .filter((failure) => failure.path === summary.path && failure.condition === condition)
        .map((failure) => failure.run);
      return {
        ...summary,
        condition,
        status: failedRuns.length ? 'failed' : summary.runs === repetitions ? 'passed' : 'incomplete',
        failedRuns,
      };
    }),
  );
  const report = {
    generatedAt: new Date().toISOString(),
    browser: path.basename(browserPath),
    browserVersion: browser.version(),
    environment: {
      os: `${os.platform()} ${os.release()}`,
      architecture: process.arch,
      node: process.version,
      viewport: { width: 1440, height: 1000 },
    },
    conditionDefinitions: {
      cold: '新しいBrowserContextと空のHTTPキャッシュ。ChromiumプロセスとOSのファイルキャッシュは起動済み。',
      warm: '同一BrowserContextの同一ページで1回描画後に再読込して測定。静的資材はCache-Control max-age=3600で提供し、主要資材の2回目取得でHTTPサーバー要求が増えないことを確認。',
    },
    sampleCount: selectedSamples.length,
    repetitions,
    conditions: renderConditions,
    marpCount: selectedSamples.filter((sample) => sample.isMarp).length,
    ordinaryCount: selectedSamples.filter((sample) => !sample.isMarp).length,
    summary: summarizeMeasurements(measurements),
    summaryByCondition: Object.fromEntries(renderConditions.map((condition) => [
      condition,
      summarizeMeasurements(measurements.filter((measurement) => measurement.condition === condition)),
    ])),
    files: fileSummaries,
    measurements,
    failures,
    externalRequests,
    pageErrors,
  };
  const reportDirectory = await mkdtemp(path.join(os.tmpdir(), 'mve-sample-render-performance-'));
  const reportPath = path.join(reportDirectory, 'report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  for (const summary of fileSummaries) console.log(formatFileSummary(summary));
  console.log(`sample描画性能: files=${selectedSamples.length}/${samples.length}, conditions=${renderConditions.join(',')}, runs=${repetitions}, Markdown=${report.ordinaryCount}, Marp=${report.marpCount}`);
  console.log(`集計: ${JSON.stringify(report.summaryByCondition)}`);
  console.log(`JSON: ${reportPath}`);

  if (externalRequests.length) {
    throw new Error(`sample描画中に外部ネットワーク要求が発生しました: ${externalRequests.join(', ')}`);
  }
  if (failures.length) {
    throw new Error(`sample描画検証に失敗した実行があります: ${failures.length}; JSON: ${reportPath}`);
  }
  if (pageErrors.length) {
    throw new Error(`sample描画中にWebviewエラーが発生しました: ${pageErrors.join(' | ')}`);
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

/**
 * sample配下のMarkdownを再帰的に列挙する。
 * @param directory - 列挙対象のディレクトリ。
 * @returns sampleルートからの相対Markdownパス。
 */
async function listMarkdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...await listMarkdownFiles(candidate));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      results.push(path.relative(sampleRoot, candidate).split(path.sep).join('/'));
    }
  }
  return results;
}

/**
 * sampleを新しいブラウザーコンテキストで開き、可視描画と所要時間を測る。
 * @param sample - 本文、ファイル位置、期待内容、Marp判定を含むsample。
 * @returns 表示完了時の計測値。
 */
async function measureSample(sample, condition) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const sampleDiagnostics = [];
  const sampleRequests = [];
  page.setDefaultTimeout(20_000);
  page.on('request', (request) => {
    sampleRequests.push(request.url());
    const requestUrl = new URL(request.url());
    if (['http:', 'https:'].includes(requestUrl.protocol) && requestUrl.origin !== origin) {
      externalRequests.push(`${sample.relativePath}: ${request.url()}`);
    }
  });
  page.on('pageerror', (error) => pageErrors.push(`${sample.relativePath}: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') sampleDiagnostics.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (request) => sampleDiagnostics.push(
    `request failed: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`,
  ));
  page.on('response', (response) => {
    if (response.status() >= 400) sampleDiagnostics.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  await page.addInitScript((init) => {
    window.__mveMessages = [];
    window.__mveIncomingMessages = [];
    window.addEventListener('message', (event) => window.__mveIncomingMessages.push(event.data));
    window.__mveHostText = init.markdown;
    window.__mveHostVersion = 1;
    window.__mveInitSent = false;
    window.__mvePerfStartedAt = performance.now();
    window.acquireVsCodeApi = () => ({
      postMessage(message) {
        window.__mveMessages.push(message);
        if (message.type === 'detectMarpMarkdown') {
          setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
            data: {
              type: 'marpDetectionResult',
              requestId: message.requestId,
              isMarp: init.isMarp,
            },
          })), 0);
          return;
        }
        if (message.type !== 'ready' || window.__mveInitSent) return;
        window.__mveInitSent = true;
        setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
          data: {
            type: 'init',
            text: init.markdown,
            version: 1,
            uri: init.uri,
            settings: {
              language: 'ja',
              imageDirectory: 'assets',
              maxPasteSizeMb: 20,
              remoteImagesEnabled: false,
              mermaidTheme: 'default',
              mermaidHostRendering: false,
              editorTheme: 'dark',
              viewMode: 'both',
              scrollSyncEnabled: true,
              previewImageResizeControlsVisible: true,
              workspaceTrusted: true,
            },
          },
        })), 0);
      },
      getState: () => undefined,
      setState: () => undefined,
    });
  }, {
    markdown: sample.markdown,
    isMarp: sample.isMarp,
    uri: `file:///C:/sample/${sample.relativePath.split('/').map(encodeURIComponent).join('/')}`,
  });

  try {
    const directory = path.posix.dirname(sample.relativePath);
    const pageUrl = `${origin}/?directory=${encodeURIComponent(directory === '.' ? '' : directory)}`;
    let warmedResourceCounts;
    if (condition === 'warm') {
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
      await page.locator('.split-editor .cm-content').waitFor();
      await page.waitForFunction(() => window.__mveMessages.some((message) => message.type === 'ready'));
      if (sample.isMarp) {
        await waitForMarpContent(page, sample);
      } else {
        await waitForMarkdownContent(page, sample);
      }
      sampleRequests.length = 0;
      sampleDiagnostics.length = 0;
      warmedResourceCounts = new Map(servedResourceCounts);
    }
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('.split-editor .cm-content').waitFor();
    await page.waitForFunction(() => window.__mveMessages.some((message) => message.type === 'ready'));

    if (sample.isMarp) {
      await waitForMarpContent(page, sample);
    } else {
      await waitForMarkdownContent(page, sample);
    }
    const marpVisibleText = sample.isMarp
      ? await page.frameLocator('.split-preview .mve-marp-preview iframe').locator('body').innerText()
      : undefined;
    const marpHeadingCount = sample.isMarp
      ? await page.frameLocator('.split-preview .mve-marp-preview iframe').locator('h1,h2,h3,h4,h5,h6').count()
      : undefined;
    const marpFrameMetrics = sample.isMarp
      ? await page.frameLocator('.split-preview .mve-marp-preview iframe').locator('body').evaluate((body) => {
        const images = Array.from(body.querySelectorAll('img'));
        return {
          imageCount: images.length,
          imageReadyCount: images.filter((image) => image.complete && image.naturalWidth > 0).length,
          failedImages: images.filter((image) => image.complete && image.naturalWidth === 0)
            .map((image) => ({ alt: image.alt, src: image.getAttribute('data-original-src') ?? image.currentSrc ?? image.src })),
        };
      })
      : undefined;

    const measurement = await page.evaluate(({ sampleInfo }) => {
      const elapsedMs = performance.now() - window.__mvePerfStartedAt;
      const markdownRoot = document.querySelector('.split-preview .rendered-markdown');
      const marpRoot = document.querySelector('.split-preview .mve-marp-preview');
      const previewRoot = sampleInfo.isMarp ? marpRoot : markdownRoot;
      const mermaidNodes = Array.from(markdownRoot?.querySelectorAll('.mermaid') ?? []);
      const images = sampleInfo.isMarp ? [] : Array.from(markdownRoot?.querySelectorAll('img') ?? []);
      const visibleText = sampleInfo.isMarp
        ? sampleInfo.marpVisibleText ?? ''
        : markdownRoot?.innerText ?? '';
      const visibleImages = images.filter((image) => {
        const rect = image.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0 &&
          rect.left < window.innerWidth && rect.right > 0;
      });
      return {
        path: sampleInfo.relativePath,
        type: sampleInfo.isMarp ? 'Marp' : 'Markdown',
        bytes: sampleInfo.bytes,
        characters: sampleInfo.markdown.length,
        renderedDocumentLength: sampleInfo.isMarp ? undefined : Number(markdownRoot?.getAttribute('data-document-length')),
        renderRevision: Number(sampleInfo.isMarp
          ? marpRoot?.getAttribute('data-mve-marp-render-count')
          : markdownRoot?.getAttribute('data-render-revision')),
        previewRootVisible: Boolean(previewRoot && previewRoot.getBoundingClientRect().width > 0 &&
          previewRoot.getBoundingClientRect().height > 0 && getComputedStyle(previewRoot).visibility === 'visible'),
        firstVisibleMs: Math.round(elapsedMs),
        markdownWorkerMs: performance.getEntriesByName('mve-preview-markdown-worker').at(-1)?.duration,
        marpWorkerMs: Number(marpRoot?.getAttribute('data-mve-marp-render-duration-ms')) || undefined,
        slideCount: Number(marpRoot?.getAttribute('data-mve-marp-slide-count')) || undefined,
        headingCount: sampleInfo.isMarp
          ? sampleInfo.marpHeadingCount
          : markdownRoot?.querySelectorAll('h1,h2,h3,h4,h5,h6').length ?? 0,
        mermaidCount: mermaidNodes.length,
        mermaidReadyCount: mermaidNodes.filter((node) => ['ready', 'error'].includes(node.getAttribute('data-mermaid-status') ?? '')).length,
        imageCount: sampleInfo.isMarp ? sampleInfo.marpFrameMetrics?.imageCount ?? 0 : images.length,
        imageReadyCount: sampleInfo.isMarp
          ? sampleInfo.marpFrameMetrics?.imageReadyCount ?? 0
          : images.filter((image) => image.complete && image.naturalWidth > 0).length,
        visibleImageCount: sampleInfo.isMarp
          ? sampleInfo.marpFrameMetrics?.imageCount ?? 0
          : visibleImages.length,
        visibleImageReadyCount: sampleInfo.isMarp
          ? sampleInfo.marpFrameMetrics?.imageReadyCount ?? 0
          : visibleImages.filter((image) => image.complete && image.naturalWidth > 0).length,
        visibleImageFailedCount: sampleInfo.isMarp
          ? (sampleInfo.marpFrameMetrics?.failedImages.length ?? 0)
          : visibleImages.filter((image) => image.complete && image.naturalWidth === 0).length,
        failedImages: sampleInfo.isMarp
          ? sampleInfo.marpFrameMetrics?.failedImages ?? []
          : images.filter((image) => image.complete && image.naturalWidth === 0)
          .map((image) => ({ alt: image.alt, src: image.currentSrc || image.src })),
        visibleTextCharacters: visibleText.trim().length,
      };
    }, { sampleInfo: { ...sample, marpVisibleText, marpHeadingCount, marpFrameMetrics } });
    measurement.marpWorkerFetchCount = sampleRequests.filter((request) => {
      try {
        return new URL(request).pathname.endsWith('/marp-worker.js');
      } catch {
        return false;
      }
    }).length;
    if (condition === 'warm' && warmedResourceCounts) {
      const requiredAssets = [
        '/dist/webview.js',
        '/dist/webview.css',
        sample.isMarp ? '/dist/marp-worker.js' : '/dist/markdown-worker.js',
      ];
      if (sample.isMarp) requiredAssets.push('/dist/marp-frame.js');
      measurement.warmCacheEvidence = requiredAssets.map((asset) => ({
        asset,
        afterPriming: warmedResourceCounts.get(asset) ?? 0,
        afterMeasuredLoad: servedResourceCounts.get(asset) ?? 0,
        reused: (warmedResourceCounts.get(asset) ?? 0) === (servedResourceCounts.get(asset) ?? 0),
      }));
      const cacheMisses = measurement.warmCacheEvidence.filter((asset) => !asset.reused);
      if (cacheMisses.length) {
        throw new Error(`温間計測の主要資材がHTTPキャッシュから再利用されませんでした: ${JSON.stringify(cacheMisses)}`);
      }
    }

    const isEmptyMarkdown = !sample.isMarp && sample.markdown.trim().length === 0;
    const hasLoadedImages = measurement.visibleImageCount > 0 &&
      measurement.visibleImageReadyCount === measurement.visibleImageCount && measurement.visibleImageFailedCount === 0;
    const unexpectedFailedImages = measurement.failedImages.filter((image) =>
      !sample.expectedMissingImageRefs.some((reference) => isExpectedMissingImage(image, reference, sample)));
    if (!measurement.previewRootVisible ||
      (sample.isMarp && measurement.renderRevision < 1) ||
      (!isEmptyMarkdown && measurement.visibleTextCharacters < 5 && !hasLoadedImages) ||
      (sample.isMarp ? measurement.marpWorkerFetchCount !== 1 : measurement.marpWorkerFetchCount !== 0) ||
      unexpectedFailedImages.length > 0 ||
      (isEmptyMarkdown && (!measurement.previewRootVisible ||
        measurement.renderedDocumentLength !== sample.markdown.length || measurement.renderRevision < 1))) {
      throw new Error(`${sample.relativePath}の描画結果に可視コンテンツがないか画像の期待状態と一致しません: ${JSON.stringify({ measurement, expectedMissingImageRefs: sample.expectedMissingImageRefs })}`);
    }
    return measurement;
  } catch (error) {
    const status = await page.locator('.split-preview .mve-marp-preview').getAttribute('data-mve-marp-status').catch(() => undefined);
    const alert = await page.locator('.split-preview [role="alert"]').innerText().catch(() => undefined);
    const diagnostics = await page.evaluate(() => ({
      location: window.location.href,
      readyState: document.readyState,
      bodyText: document.body?.innerText?.slice(0, 500),
      renderedMarkdown: document.querySelector('.split-preview .rendered-markdown')?.innerText?.slice(0, 500),
      renderedMarkdownLength: document.querySelector('.split-preview .rendered-markdown')?.getAttribute('data-document-length'),
      renderRevision: document.querySelector('.split-preview .rendered-markdown')?.getAttribute('data-render-revision'),
      messageTypes: (window.__mveMessages ?? []).slice(-10).map((message) => message?.type),
      incomingMessageTypes: (window.__mveIncomingMessages ?? []).slice(-10).map((message) => message?.type),
      workerUri: document.body.dataset.mveMarpWorkerUri,
      frameUri: document.body.dataset.mveMarpFrameUri,
      resources: performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('marp')),
      marpPreview: (() => {
        const root = document.querySelector('.split-preview .mve-marp-preview');
        const frame = root?.querySelector('iframe');
        let frameState;
        try {
          frameState = {
            readyState: frame?.contentDocument?.readyState,
            slideCount: frame?.contentDocument?.querySelectorAll('.mve-marp-slide').length,
            content: frame?.contentDocument?.querySelector('#mve-marp-slides')?.innerHTML.slice(0, 400),
          };
        } catch (error) {
          frameState = String(error);
        }
        return {
          status: root?.getAttribute('data-mve-marp-status'),
          renderCount: root?.getAttribute('data-mve-marp-render-count'),
          workerRenderMs: root?.getAttribute('data-mve-marp-render-duration-ms'),
          frameSrcdocLength: frame?.srcdoc.length,
          frameState,
        };
      })(),
      debugEntries: (window.__mveDebugLog ?? []).slice(-10).map((entry) => String(entry?.message ?? entry).slice(0, 200)),
    })).catch((diagnosticError) => ({ evaluationError: String(diagnosticError) }));
    const frameDiagnostics = await Promise.all(page.frames()
      .filter((frame) => frame.url() === 'about:srcdoc')
      .map(async (frame) => frame.evaluate(() => ({
        readyState: document.readyState,
        title: document.title,
        token: document.currentScript?.getAttribute('data-mve-token'),
        rootPresent: Boolean(document.querySelector('#mve-marp-slides')),
        slideCount: document.querySelectorAll('.mve-marp-slide').length,
        slidesHtml: document.querySelector('#mve-marp-slides')?.innerHTML.slice(0, 600),
        styleLength: document.querySelector('#mve-marp-theme')?.textContent?.length,
      })).catch((frameError) => String(frameError))));
    const failure = {
      path: sample.relativePath,
      expectedText: sample.expectedText,
      cause: error instanceof Error ? error.message : String(error),
      status,
      alert,
      diagnostics,
      frame: frameDiagnostics,
      browser: sampleDiagnostics.slice(-20),
      pageErrors: pageErrors.slice(-10),
      requests: sampleRequests.filter((request) => request.includes('marp')).slice(-20),
    };
    throw new Error(JSON.stringify(failure));
  } finally {
    await context.close();
  }
}

/**
 * Webviewメッセージから本文全体を除き、診断に必要な項目だけを残す。
 * @param messages - Webviewとpreviewの診断メッセージ。
 * @returns 本文サイズを保った短いメッセージ要約。
 */
function summarizeMessages(messages) {
  return messages.map((message) => {
    if (!message || typeof message !== 'object') return String(message).slice(0, 200);
    const summary = {};
    for (const key of ['type', 'requestId', 'isMarp', 'version', 'status', 'stage', 'detail', 'error']) {
      if (message[key] !== undefined) summary[key] = String(message[key]).slice(0, 200);
    }
    if (typeof message.text === 'string') summary.textLength = message.text.length;
    if (typeof message.markdown === 'string') summary.markdownLength = message.markdown.length;
    return summary;
  });
}

/**
 * Marpを可視描画し、全スライドの内容領域と最初の見出しを確認する。
 * @param page - sampleを表示中のWebviewページ。
 * @param sample - 本文と期待見出しを含むsample。
 */
async function waitForMarpContent(page, sample) {
  const preview = page.locator('.split-preview .mve-marp-preview');
  await page.waitForFunction(() => {
    const root = document.querySelector('.split-preview .mve-marp-preview');
    return ['ready', 'error'].includes(root?.getAttribute('data-mve-marp-status') ?? '');
  });
  const status = await preview.getAttribute('data-mve-marp-status');
  if (status !== 'ready') {
    const alert = await preview.locator('[role="alert"]').innerText().catch(() => '');
    throw new Error(`${sample.relativePath}のMarp描画が完了しません: ${alert}`);
  }
  const frame = page.frameLocator('.split-preview .mve-marp-preview iframe');
  const slides = await frame.locator('.mve-marp-slide').evaluateAll((nodes) => nodes.map((slide) => {
    const heading = slide.querySelector('h1,h2,h3,h4,h5,h6');
    const rect = slide.getBoundingClientRect();
    const headingRect = heading?.getBoundingClientRect();
    const foreignRect = slide.querySelector('svg foreignObject')?.getBoundingClientRect();
    return {
      text: slide.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      heading: heading?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      width: rect.width,
      height: rect.height,
      headingWidth: headingRect?.width ?? 0,
      headingHeight: headingRect?.height ?? 0,
      foreignWidth: foreignRect?.width ?? 0,
      foreignHeight: foreignRect?.height ?? 0,
    };
  }));
  if (!slides.length) throw new Error(`${sample.relativePath}のMarp描画結果にスライドがありません。`);
  for (const slide of slides) {
    if (slide.width < 300 || slide.height < 200 || slide.headingWidth <= 0 || slide.headingHeight <= 0 ||
      slide.foreignWidth < 300 || slide.foreignHeight < 200) {
      throw new Error(`${sample.relativePath}のMarpスライド領域が空または不可視です: ${JSON.stringify(slide)}`);
    }
  }
  if (sample.expectedHeadings.length && !slides[0]?.heading.includes(sample.expectedHeadings[0] ?? '')) {
    throw new Error(`${sample.relativePath}の先頭スライド見出しが一致しません: expected=${sample.expectedHeadings[0]}, actual=${slides[0]?.heading}`);
  }
}

/**
 * 通常Markdownの最初の見出しまたは本文が実DOMに可視化されるまで待つ。
 * @param page - sampleを表示中のWebviewページ。
 * @param sample - 本文と期待する最初の可視テキストを含むsample。
 */
async function waitForMarkdownContent(page, sample) {
  await page.waitForFunction(({ expectedLength, expectedText, emptyMarkdown }) => {
    const root = document.querySelector('.split-preview .rendered-markdown');
    const rect = root?.getBoundingClientRect();
    const visible = root && rect && rect.width > 0 && rect.height > 0 &&
      getComputedStyle(root).visibility === 'visible';
    const normalizedText = root?.innerText?.replace(/\s+/g, ' ').trim() ?? '';
    const images = Array.from(root?.querySelectorAll('img') ?? []);
    const visibleImages = images.filter((image) => {
      const rect = image.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0 &&
        rect.left < window.innerWidth && rect.right > 0;
    });
    const visibleImagesLoaded = visibleImages.every((image) => image.complete);
    const visibleImageContentReady = visibleImages.some((image) =>
      image.complete && image.naturalWidth > 0,
    );
    const contentReady = expectedText
      ? normalizedText.includes(expectedText)
      : emptyMarkdown || normalizedText.length > 0 || visibleImageContentReady;
    return visible &&
      Number(root?.getAttribute('data-document-length')) === expectedLength &&
      Number(root?.getAttribute('data-render-revision')) > 0 &&
      visibleImagesLoaded &&
      contentReady;
  }, {
    expectedLength: sample.markdown.length,
    expectedText: sample.expectedText,
    emptyMarkdown: sample.markdown.trim().length === 0,
  });
}

/**
 * YAML front matterのルートmarp値が真偽値trueかを調べる。
 * @param markdown - 判定するMarkdown本文。
 * @returns front matter直下のmarpが真偽値trueならtrue。
 */
function isMarpMarkdown(markdown) {
  const source = markdown.charCodeAt(0) === 0xfeff ? markdown.slice(1) : markdown;
  const opening = /^---[ \t]*\r?\n/.exec(source);
  if (!opening) return false;
  const closingPattern = /^(?:---|\.\.\.)[ \t]*\r?$/gm;
  closingPattern.lastIndex = opening[0].length;
  const closing = closingPattern.exec(source);
  if (!closing) return false;
  const parsed = parseDocument(source.slice(opening[0].length, closing.index), { strict: true, uniqueKeys: true });
  if (parsed.errors.length || parsed.warnings.length || !isMap(parsed.contents)) return false;
  const root = parsed.toJS({ mapAsMap: true });
  return root instanceof Map && root.get('marp') === true;
}

/**
 * Front matterとHTMLコメントを除き、コードフェンス外のMarkdown見出しを取り出す。
 * @param markdown - 見出しを抽出するMarkdown本文。
 * @returns Markdown本文内の見出し一覧。
 */
function extractHeadings(markdown) {
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
    if (heading?.[1]) headings.push(normalizeMarkdownText(heading[1]));
  }
  return headings;
}

/**
 * 見出しがない文書用に最初の有意な本文行を取り出す。
 * @param markdown - 期待する本文を探すMarkdown文書。
 * @returns 描画結果と照合する本文文字列。
 */
function extractFirstContent(markdown) {
  const body = markdown
    .replace(/^---[ \t]*\r?\n[\s\S]*?^(?:---|\.\.\.)[ \t]*\r?$/m, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  for (const line of body.split('\n')) {
    if (!line.trim() || /^\s*(```|~~~)/.test(line)) continue;
    if (/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(line)) continue;
    const text = normalizeMarkdownText(line);
    if (text.length >= 5) return text;
  }
  return '';
}

/**
 * 明示的に欠損を想定したMarkdown画像のalt文字列を抽出する。
 * @param markdown - 検査するMarkdown文書。
 * @returns 欠損画像として指定されたalt文字列。
 */
function extractExpectedMissingImageRefs(markdown) {
  const lines = [];
  let fenceCharacter;
  let fenceLength = 0;
  for (const line of markdown.replace(/<!--([\s\S]*?)-->/g, '').split('\n')) {
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
    if (!fenceCharacter) lines.push(line);
  }

  const references = [];
  for (const line of lines) {
    for (const match of line.matchAll(/!\[([^\]]*)\]\((<[^>]+>|[^)\s]+)[^)]*\)/g)) {
      const source = (match[2] ?? '').replace(/^<|>$/g, '');
      if (/(?:存在しない|missing|not[-_]?found|broken)/i.test(`${match[1]} ${source}`)) {
        references.push({ alt: match[1] ?? '', source });
      }
    }
  }
  return references;
}

/**
 * レンダー失敗画像が、文書内で明示された欠損画像参照と一致するか調べる。
 * @param image - Webviewで読み込めなかった画像。
 * @param reference - 文書で欠損想定された画像参照。
 * @param sample - 表示中のMarkdown sample。
 * @returns 欠損参照と失敗URLが一致する場合はtrue。
 */
function isExpectedMissingImage(image, reference, sample) {
  const basePath = `/sample/${path.posix.dirname(sample.relativePath)}`;
  const expectedPath = path.posix.normalize(path.posix.join(basePath, reference.source.split(/[?#]/, 1)[0] ?? ''));
  try {
    return decodeURIComponent(new URL(image.src).pathname) === expectedPath;
  } catch {
    return false;
  }
}

/**
 * Markdown・Textileのインライン記法と表区切りを除き、本文照合用の文字列へ整える。
 * @param value - MarkdownまたはTextile記法を含む文字列。
 * @returns HTMLテキストに近い照合用の文字列。
 */
function normalizeMarkdownText(value) {
  return value
    .replace(/!([^!\s()]+)(?:\(([^)]*)\))?!https?:\/\/[^\s]+/g,
      (match, _source, alt) => `${alt ?? ''}${/[.,;!?]+$/u.exec(match)?.[0] ?? ''}`)
    .replace(/!([^!\s()]+)(?:\(([^)]*)\))?!/g, (_match, _source, alt) => alt ?? '')
    .replace(/\[([a-z][\w-]*)\]https?:\/\/[^\s\]]+/gi,
      (match, label) => `${label}${/[.,;!?]+$/u.exec(match)?.[0] ?? ''}`)
    .replace(/"(?:\([^)]+\)\.\s*)?([^"\r\n]+)":\S+/g,
      (match, label) => `${label}${/[.,;!?]+$/u.exec(match)?.[0] ?? ''}`)
    .replace(/%\([^)]+\)([^%\r\n]+)%/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .replace(/\s*\|\s*/g, ' ')
    .replace(/\s+\{#[^}]+\}/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/(^|\s)\+([^+]+)\+(?=$|\s|[.,;:!?])/gu, '$1$2')
    .replace(/(^|\s)-([^-]+)-(?=$|\s|[.,;:!?])/gu, '$1$2')
    .replace(/\?\?([^?]+)\?\?/gu, '$1')
    .replace(/@([^@]+)@/gu, '$1')
    .replace(/\^([^^]+)\^/gu, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\\([\\`*_{}\[\]()#+.!>\-])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * WebviewのCSP、base URI、Workerとiframe資産を含むテスト用HTMLを返す。
 * @param baseOrigin - テストサーバーのorigin。
 * @param sampleDirectory - sampleルートからの文書ディレクトリ。
 * @returns Webviewに似せたHTML shell。
 */
function createWebviewShell(baseOrigin, sampleDirectory) {
  const nonce = 'sample-performance-shell-nonce';
  const basePath = sampleDirectory ? `/sample/${sampleDirectory.replace(/\\/g, '/')}/` : '/sample/';
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><base href="${baseOrigin}${basePath}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${baseOrigin} data: blob:; font-src ${baseOrigin} data:; style-src ${baseOrigin} 'unsafe-inline'; script-src ${baseOrigin} 'nonce-${nonce}'; worker-src blob: data:; frame-src 'self' ${baseOrigin}; connect-src ${baseOrigin} blob:;"><link rel="stylesheet" href="${baseOrigin}/dist/styles.css"><link rel="stylesheet" href="${baseOrigin}/dist/webview.css"></head><body data-mve-markdown-worker-uri="${baseOrigin}/dist/markdown-worker.js" data-mve-markdown-rich-worker-uri="${baseOrigin}/dist/markdown-rich-worker.js" data-mve-markdown-fallback-uri="${baseOrigin}/dist/markdown-fallback.js" data-mve-marp-worker-uri="${baseOrigin}/dist/marp-worker.js" data-mve-marp-frame-uri="${baseOrigin}/dist/marp-frame.js" data-mve-marp-katex-fonts-uri="${baseOrigin}/dist/marp-katex-fonts/" data-mve-csp-source="${baseOrigin}" data-mve-csp-nonce="${nonce}" data-mve-remote-images="false" data-mve-export-fonts-uri="${baseOrigin}/dist/export-fonts.css" data-mve-mermaid-uri="${baseOrigin}/dist/mermaid.min.js"><div id="root"></div><script nonce="${nonce}" src="${baseOrigin}/dist/webview.js"></script></body></html>`;
}

/**
 * URLの拡張子に合わせたテスト配信用のContent-Typeを返す。
 * @param filePath - 配信するファイルパス。
 * @returns HTTP Content-Type値。
 */
function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    '.css': 'text/css',
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
  })[extension] ?? 'application/octet-stream';
}

/**
 * 指定ファイル名をChromiumキャッシュ配下から再帰検索する。
 * @param directory - 検索開始ディレクトリ。
 * @param targetName - 大文字小文字を区別せず検索するファイル名。
 * @returns 見つかったChromium実行ファイルのパス。
 */
async function findFile(directory, targetName) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
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
 * 同一モードの測定値から中央値、p95、最大値をまとめる。
 * @param measurementsToSummarize - 集計する全Markdown計測結果。
 * @returns MarkdownとMarpそれぞれの描画統計。
 */
function summarizeMeasurements(measurementsToSummarize) {
  const summary = {};
  for (const type of ['Markdown', 'Marp']) {
    const values = measurementsToSummarize
      .filter((measurement) => measurement.type === type)
      .map((measurement) => measurement.firstVisibleMs)
      .sort((left, right) => left - right);
    if (!values.length) continue;
    summary[type] = {
      count: values.length,
      medianFirstVisibleMs: percentile(values, 0.5),
      p95FirstVisibleMs: percentile(values, 0.95),
      maximumFirstVisibleMs: values.at(-1),
    };
  }
  return summary;
}

/**
 * sample単位で反復計測を集約し、中央値、p95、最大値を返す。
 * @param samplesToSummarize - 計測対象のsample一覧。
 * @param measurementsToSummarize - 反復して取得した描画計測結果。
 * @returns sampleパスごとの性能集計一覧。
 */
function summarizeFiles(samplesToSummarize, measurementsToSummarize) {
  return samplesToSummarize.map((sample) => {
    const runs = measurementsToSummarize.filter((measurement) => measurement.path === sample.relativePath);
    const durations = runs.map((measurement) => measurement.firstVisibleMs).sort((left, right) => left - right);
    const workerDurations = runs
      .map((measurement) => measurement.markdownWorkerMs ?? measurement.marpWorkerMs)
      .filter(Number.isFinite)
      .sort((left, right) => left - right);
    const latest = runs.at(-1);
    return {
      path: sample.relativePath,
      type: sample.isMarp ? 'Marp' : 'Markdown',
      bytes: sample.bytes,
      characters: sample.markdown.length,
      runs: durations.length,
      medianFirstVisibleMs: percentile(durations, 0.5),
      p95FirstVisibleMs: percentile(durations, 0.95),
      maximumFirstVisibleMs: durations.at(-1) ?? 0,
      medianWorkerMs: workerDurations.length ? percentile(workerDurations, 0.5) : undefined,
      slideCount: latest?.slideCount,
      headingCount: latest?.headingCount,
      visibleTextCharacters: latest?.visibleTextCharacters ?? 0,
      marpWorkerFetchCount: latest?.marpWorkerFetchCount ?? 0,
    };
  });
}

/**
 * 昇順の標本からnearest-rank percentileを計算する。
 * @param sortedValues - 昇順に並んだ数値。
 * @param percentileValue - 0から1のpercentile値。
 * @returns 標本に含まれるpercentile値。
 */
function percentile(sortedValues, percentileValue) {
  const index = Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1);
  return sortedValues[index] ?? 0;
}

/**
 * Markdown1ファイルの計測値を一覧表示用の短い文字列へ整える。
 * @param measurement - 描画完了時の計測値。
 * @returns 主要な時間、容量、内容数を含む行。
 */
function formatFileSummary(summary) {
  return `${summary.condition.padEnd(4)} ${summary.type.padEnd(8)} ${summary.path} | median=${summary.medianFirstVisibleMs} ms` +
    ` p95=${summary.p95FirstVisibleMs} ms max=${summary.maximumFirstVisibleMs} ms` +
    ` | worker median=${summary.medianWorkerMs?.toFixed(1) ?? '-'} ms` +
    ` | slides=${summary.slideCount ?? '-'} headings=${summary.headingCount}` +
    ` | text=${summary.visibleTextCharacters} chars`;
}

import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const executablePath = await findFile(path.resolve('.chromium'), 'chrome-headless-shell.exe');
if (!executablePath) throw new Error('Chromium がありません。npm run pdf:install-browser を実行してください。');

const allowedAssets = new Set([
  'export-fonts.css',
  'markdown-fallback.js',
  'markdown-worker.js',
  'mermaid.min.js',
  'styles.css',
  'webview.css',
  'webview.js'
]);
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end('<!doctype html><html><head></head><body><div id="root"></div></body></html>');
      return;
    }
    const match = /^\/dist\/([^/]+)$/.exec(url.pathname);
    if (!match || !allowedAssets.has(match[1])) {
      response.writeHead(404).end('not found');
      return;
    }
    const fileName = match[1];
    const body = await readFile(path.resolve('dist', fileName));
    const contentType = fileName.endsWith('.css') ? 'text/css' : 'text/javascript';
    response.writeHead(200, {
      'Content-Type': `${contentType}; charset=utf-8`,
      'Access-Control-Allow-Origin': '*'
    }).end(body);
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('テスト HTTP サーバーを開始できませんでした。');
const origin = `http://127.0.0.1:${address.port}`;

const browser = await chromium.launch({ executablePath, headless: true });
try {
  await verifyMarkdownFallback();
  await verifyInlineMermaidFallback();
  await verifyCompactMermaidAvoidsHostStartup();
  await verifyLargeMermaidKeepsHostIsolation();
  await verifyLazyExportFonts();
  console.log('遅延ランタイム: Markdown Worker 障害時フォールバック、Mermaid Host 障害時フォールバック、出力フォントを確認しました。');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

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
    await page.waitForFunction(() => (
      document.querySelectorAll('.split-preview .mermaid[data-mermaid-status="ready"] svg').length === 2
    ), undefined, { timeout: 20_000 });
    const state = await page.evaluate(() => {
      const diagrams = [...document.querySelectorAll('.split-preview .mermaid svg')];
      const ids = diagrams.flatMap((svg) => [...svg.querySelectorAll('[id]')].map((element) => element.id));
      return {
        hostRequests: window.__mveMessages.filter((message) => message.type === 'renderMermaid').length,
        duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
        text: diagrams.map((svg) => svg.textContent ?? '')
      };
    });
    if (state.hostRequests !== 0) {
      throw new Error(`小型 Mermaid が Host Chromium を起動しました: ${state.hostRequests} requests`);
    }
    if (state.duplicateIds.length) {
      throw new Error(`小型 Mermaid 間で SVG ID が衝突しました: ${JSON.stringify(state.duplicateIds)}`);
    }
    if (state.text.some((text) => !text.includes('Start') || !text.includes('Ready'))) {
      throw new Error(`小型 Mermaid のラベルが欠落しました: ${JSON.stringify(state.text)}`);
    }
  } finally {
    await page.close();
  }
}

async function verifyLargeMermaidKeepsHostIsolation() {
  const edges = Array.from({ length: 240 }, (_, index) => `  N${index} --> N${index + 1}`);
  const markdown = `\`\`\`mermaid\nflowchart TD\n${edges.join("\n")}\n\`\`\`\n`;
  const page = await openEditor(markdown, {
    workerUri: `${origin}/dist/markdown-worker.js`,
    mermaidHostRendering: true
  });
  try {
    await page.waitForFunction(() => (
      window.__mveMessages.some((message) => message.type === 'renderMermaid')
    ), undefined, { timeout: 20_000 });
  } finally {
    await page.close();
  }
}

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
      await page.waitForFunction(() => (
        document.body.dataset.mveMarkdownWorkerStatus === 'fallback'
        && document.querySelector('.split-preview p strong')?.textContent === 'worker failure recovery'
      ), undefined, { timeout: 15_000 });
    } catch (error) {
      const state = await page.evaluate(() => ({
        workerStatus: document.body.dataset.mveMarkdownWorkerStatus,
        html: document.querySelector('.split-preview')?.innerHTML.slice(0, 2_000)
      }));
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(state)}`);
    }
    const unsafe = await page.evaluate(() => ({
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

async function verifyInlineMermaidFallback() {
  const markdown = '# Mermaid\n\n```mermaid\ngraph TD\n  A --> B\n```\n';
  const page = await openEditor(markdown, {
    workerUri: `${origin}/dist/markdown-worker.js`,
    mermaidHostRendering: false
  });
  try {
    try {
      await page.waitForFunction(() => (
        document.querySelector('.split-preview .mermaid[data-mermaid-status="ready"] svg') !== null
      ), undefined, { timeout: 20_000 });
    } catch (error) {
      const state = await page.evaluate(() => ({
        workerStatus: document.body.dataset.mveMarkdownWorkerStatus,
        mermaidLoaded: Boolean(window.mermaid),
        mermaidType: typeof window.mermaid,
        mermaidConstructor: window.mermaid?.constructor?.name,
        mermaidValue: String(window.mermaid).slice(0, 200),
        mermaidKeys: window.mermaid ? Object.keys(window.mermaid).slice(0, 20) : [],
        diagrams: [...document.querySelectorAll('.mermaid')].map((node) => ({
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

async function verifyLazyExportFonts() {
  const markdown = '# Export fonts\n\n埋め込みフォントの回帰検証。\n';
  const page = await openEditor(markdown, {
    workerUri: `${origin}/dist/markdown-worker.js`,
    mermaidHostRendering: true
  });
  try {
    await page.waitForFunction((length) => (
      Number(document.querySelector('.split-preview .rendered-markdown')?.getAttribute('data-document-length')) === length
    ), markdown.length);
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'hostCommand', command: 'exportHtml' }
    })));
    await page.waitForFunction(() => window.__mveMessages.some((message) => message.type === 'exportHtml'), undefined, {
      timeout: 20_000
    });
    const css = await page.evaluate(() => window.__mveMessages.find((message) => message.type === 'exportHtml')?.css ?? '');
    if (css.length < 1024 * 1024 || !css.includes('@font-face') || !css.includes('data:font/')) {
      throw new Error(`HTML 出力 CSS に埋め込みフォントがありません: ${css.length} chars`);
    }
  } finally {
    await page.close();
  }
}

async function openEditor(markdown, { workerUri, mermaidHostRendering }) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.evaluate(({ markdown, mermaidHostRendering, workerUri, origin }) => {
    document.body.dataset.mveMarkdownWorkerUri = workerUri;
    document.body.dataset.mveMarkdownFallbackUri = `${origin}/dist/markdown-fallback.js`;
    document.body.dataset.mveMermaidUri = `${origin}/dist/mermaid.min.js`;
    document.body.dataset.mveExportFontsUri = `${origin}/dist/export-fonts.css`;
    window.__mveMessages = [];
    window.acquireVsCodeApi = () => ({
      postMessage(message) {
        window.__mveMessages.push(message);
        if (message.type !== 'ready') return;
        setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
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
      getState: () => undefined,
      setState: () => undefined
    });
  }, { markdown, mermaidHostRendering, workerUri, origin });
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

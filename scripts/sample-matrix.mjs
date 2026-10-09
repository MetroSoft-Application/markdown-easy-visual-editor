/**
 * @fileoverview サンプルMarkdown文書群をプレビューへ読み込み、描画完了と診断結果をまとめて確認する。
 */
import { chromium } from 'playwright-core';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * 指定した名前のファイルを検証用ディレクトリから再帰的に探す。
 * @param root - 再帰検索を開始するディレクトリ。
 * @param name - 検索するファイル名。
 * @returns 見つかったファイルの絶対パス。該当なしならundefined。
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
 * サンプル検証・マトリクスで読み書きするリソースの場所。
 */
const executablePath = await findFile(path.resolve('.chromium'), 'chrome-headless-shell.exe');
if (!executablePath) throw new Error('Chromium がありません。npm run pdf:install-browser を実行してください。');
/**
 * サンプル検証・マトリクスで扱う一覧または対応表。
 */
const entries = await readdir(path.resolve('sample'));
/**
 * サンプル検証・マトリクスで扱う一覧または対応表。
 */
const samples = {};
for (
  /**
   * 今回の反復で確認する番号付きMarkdownサンプル番号です。
   */
  const index of [1, 2, 3, 4, 5, 6, 7, 9, 11]
) {
  const prefix = String(index).padStart(2, '0');
  const file = entries.find(
  (entry) => entry.startsWith(`${prefix}-`) && entry.endsWith('.md'));
  if (!file) throw new Error(`sample/${prefix} がありません。`);
  samples[index] = (await readFile(path.resolve('sample', file), 'utf8')).replace(/\r\n?/g, '\n');
}
/**
 * サンプル検証・マトリクスで解析・表示・保存する本文。
 */
const localSvg = await readFile(path.resolve('sample/assets/local-sample.svg'));
/**
 * サンプル検証・マトリクスで解析・表示・保存する本文。
 */
const markdownWorkerScript = await readFile(path.resolve('dist/markdown-worker.js'));
/**
 * サンプル検証・マトリクスで解析・表示・保存する本文。
 */
const markdownRichWorkerScript = await readFile(path.resolve('dist/markdown-rich-worker.js'));
/**
 * Host描画の大きなMermaid応答をPNG経路へ通すための1x1透明PNGデータ。
 */
const mermaidPngPlaceholder = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
/**
 * Webviewを使うプレビュー確認用のChromiumインスタンスです。
 */
const browser = await chromium.launch({ executablePath, headless: true });
/**
 * 描画確認を行うレンダラー用のChromiumインスタンスです。
 */
const rendererBrowser = await chromium.launch({ executablePath, headless: true });
try {
  const context = await browser.newContext();
  const rendererContext = await rendererBrowser.newContext();
  const pageErrors = [];
  await context.addInitScript(

  () => {
    window.__mveMessages = [];
    window.__mveHostVersion = 1;
    window.__mveHostText = '';
    window.__mveAckDelay = 0;
    window.__mveOutstandingOperations = 0;
    window.__mveMaximumOutstandingOperations = 0;
    window.acquireVsCodeApi =
    /**
     * WebviewからVS Codeのメッセージ送信・状態保存APIを取得する。
     * @returns VS Codeのメッセージ送信・状態保存API。
     */
    () => ({

      
      postMessage: /**
       * Webview要求を記録し、編集要求はシミュレートしたHost本文へ適用してackを返す。
       * @param message - サンプル検証中のWebviewから送られたHost要求。
       */ (message) => {
        window.__mveMessages.push(message);
        if (message.type === 'localChanges') {
          window.__mveOutstandingOperations += 1;
          window.__mveMaximumOutstandingOperations = Math.max(
            window.__mveMaximumOutstandingOperations,
            window.__mveOutstandingOperations
          );
          const baseVersion = window.__mveHostVersion;
          for (const change of [...message.changes].sort(
          /**
           * 2つの値を比較して並び順を決める。
           * @param left - 比較対象の左側の値。
           * @param right - 比較対象の右側の値。
           * @returns 2つの要素の順序を示す数値。
           */
          (left, right) => right.rangeOffset - left.rangeOffset)) {
            window.__mveHostText = window.__mveHostText.slice(0, change.rangeOffset)
              + change.text
              + window.__mveHostText.slice(change.rangeOffset + change.rangeLength);
          }
          window.__mveHostVersion += 1;
          setTimeout(
          /**
           * 指定時間の経過後に後続処理を実行する。
           */
          () => {
            window.__mveOutstandingOperations = Math.max(0, window.__mveOutstandingOperations - 1);
            window.dispatchEvent(new MessageEvent('message', {
              data: {
                type: 'editAck',
                clientId: message.clientId,
                opId: message.opId,
                baseVersion,
                version: window.__mveHostVersion,
                changes: message.changes
              }
            }));
          }, window.__mveAckDelay);
        }
        void window.__mveHostPostMessage(message);
      },

      
      getState: /**
       * @returns 条件に一致する値。未検出時はundefinedまたはnull。
       */ () => undefined,

      
      setState: /**
       * サンプル検証・マトリクスの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
       */ () => undefined
    });
  });
  const rendererPage = await rendererContext.newPage();
  await rendererPage.setContent('<!doctype html><html><body></body></html>');
  await rendererPage.addScriptTag({ path: path.resolve('dist/mermaid.min.js') });
  let rendererQueue = Promise.resolve();
  let lightweightMermaidRendering = false;
  const cancelledRenderRequests = new Set();
  const page = await context.newPage();
  page.on('pageerror',
  /**
   * pageerrorイベントで一覧追加を実行する。
   * @param error - ユーザー操作またはDOMから通知されたイベント。
   */
  (error) => pageErrors.push(error.message));
  page.on('console',
  /**
   * consoleイベントでifを実行する。
   * @param message - ユーザー操作またはDOMから通知されたイベント。
   */
  (message) => { if (message.type() === 'error') pageErrors.push(message.text()); });
  let closingContext = false;
  await page.exposeFunction('__mveHostPostMessage',
  /**
   * @param message - HostとWebviewの間で受け渡すメッセージ。
   */
  (message) => {
    if (closingContext) return;
    if (message.type === 'cancelMermaidRender') {
      cancelledRenderRequests.add(message.requestId);
      return;
    }
    if (message.type !== 'renderMermaid') return;
    rendererQueue = rendererQueue.then(
    /**
      * キューを直列処理し、要求が未取消しの場合だけMermaidを描画して結果を返す。
     */
    async () => {
      if (cancelledRenderRequests.delete(message.requestId)) return;
      try {
        const rendered = lightweightMermaidRendering
          ? await new Promise(
          /**
           * 遅延処理の完了または失敗を待機側へ通知する。
           * @param resolve - Promiseの成功を通知する関数。
           */
          (resolve) => setTimeout(
          /**
           * 指定時間の経過後に後続処理を実行する。
           */
          () => resolve({
              svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80"><text x="8" y="42">Mermaid host result</text></svg>',
              interactions: [],
              ariaLabel: 'Mermaid host result'
            }), 20))
          : await rendererPage.evaluate(
          /**
           * ブラウザー内の「svg」を読み取り、検証用の値へ変換する。
          * @returns ブラウザー内で読み取った値または変換結果。
           */
          async ({ source, theme, requestId }) => {
              window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme, suppressErrorRendering: true });
              await window.mermaid.parse(source);
              const svg = (await window.mermaid.render(`sample-matrix-${requestId}`, source)).svg;
              const container = document.createElement('div');
              container.style.cssText = 'position:absolute;left:-100000px;top:0;width:1200px;visibility:hidden';
              container.innerHTML = svg;
              document.body.append(container);
              const root = container.querySelector('svg');
              const rootRect = root.getBoundingClientRect();
              const interactions = [...root.querySelectorAll('text, foreignObject')].slice(0, 500).map(

              (element) => {
                const rect = element.getBoundingClientRect();
                return {
                  type: 'text',
                  text: element.textContent?.trim() ?? '',
                  left: (rect.left - rootRect.left) / rootRect.width,
                  top: (rect.top - rootRect.top) / rootRect.height,
                  width: rect.width / rootRect.width,
                  height: rect.height / rootRect.height
                };
              }).filter(
              /**
               * 本文の条件を満たす項目だけを残す。
               * @param item - 項目の本文を参照する走査対象。

               */
              (item) => item.text && item.width > 0 && item.height > 0);
              container.remove();
              return { svg, interactions, ariaLabel: interactions.slice(0, 20).map(
              /**
               * 各項目から本文を取り出して一覧化する。
               * @param item - 項目の本文を参照する走査対象。
               * @returns 本文を取り出した変換結果の一覧。
               */
              (item) => item.text).join(', ') };
            }, message);
        if (cancelledRenderRequests.delete(message.requestId)) return;
        if (rendered.svg.length >= 80_000) rendered.pngBase64 = mermaidPngPlaceholder;
        if (closingContext || page.isClosed()) return;
        await page.evaluate(
        ({ requestId, result }) => {
          window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'mermaidRendered', requestId, ...result }
          }));
        }, { requestId: message.requestId, result: rendered });
      } catch (error) {
        if (closingContext || page.isClosed()) return;
        await page.evaluate(
        ({ requestId, text }) => {
          window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'mermaidRendered', requestId, error: text }
          }));
        }, { requestId: message.requestId, text: error instanceof Error ? error.message : String(error) });
      }
    });
  });
  page.setDefaultTimeout(7_000);
  await page.route('https://mve.test/sample/assets/**
    * ローカルSVG fixtureだけを返し、その他のsample asset要求は404にする。
    * @param route - Playwrightが横取りしたsample asset要求。
   */
  async (route) => {
    if (route.request().url().endsWith('/local-sample.svg')) {
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: localSvg });
    } else {
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing sample asset' });
    }
  });
  await page.route('https://mve.test/dist/markdown-worker.js',
  /**
   * ビルド済みMarkdown workerを固定URLから配信する。
   * @param route - Playwrightが横取りしたMarkdown worker要求。
   */
  async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: markdownWorkerScript });
  });
  await page.route('https://mve.test/dist/markdown-rich-worker.js',
  /**
   * ビルド済みrich Markdown workerを固定URLから配信する。
   * @param route - Playwrightが横取りしたrich worker要求。
   */
  async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: markdownRichWorkerScript
    });
  });
  await page.route('https://mve.test/sample/',
  /**
   * テスト対象のWebview shell HTMLを固定URLへ返す。
   * @param route - Playwrightが横取りしたsample page要求。
   */
  async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html lang="ja"><head><meta charset="utf-8"><base href="https://mve.test/sample/"></head><body data-mve-markdown-worker-uri="https://mve.test/dist/markdown-worker.js" data-mve-markdown-rich-worker-uri="https://mve.test/dist/markdown-rich-worker.js"><div id="root"></div></body></html>'
    });
  });
  await page.goto('https://mve.test/sample/');
  await page.addStyleTag({ path: path.resolve('dist/styles.css') });
  await page.addScriptTag({ path: path.resolve('dist/webview.js') });
  try {
    await page.waitForFunction(
    /**
     * HostとWebviewのメッセージ状態が完了条件を満たすまで待機する。
     */
    () => window.__mveMessages.some(
    /**

     * @param message - HostとWebviewの間で受け渡すメッセージ。
     */
    (message) => message.type === 'ready'));
  } catch (error) {
    throw new Error(`Webview did not become ready: ${pageErrors.join(' | ')}`, { cause: error });
  }
  const settings = { imageDirectory: 'assets/${documentBasename}', maxPasteSizeMb: 20, remoteImagesEnabled: false, mermaidTheme: 'default', mermaidHostRendering: true, workspaceTrusted: true };
  await page.evaluate(
  /**
   * Host側の本文状態を読み取り、検証用の値へ変換する。
   * @param value - Host本文として設定するMarkdown文字列。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (value) => { window.__mveHostText = value; }, samples[1]);
  await page.evaluate(
  ({ value, settings: initSettings }) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'init', text: value, version: 1, uri: 'file:///C:/sample.md', settings: initSettings } })), { value: samples[1], settings });
  await page.locator('.split-editor').waitFor();

  /**
   * 指定したサンプル本文をHost/Webviewへ送り、プレビューとソース長が同期するまで待つ。
   * @param index - 表示するサンプル本文の配列位置。
   */
  async function load(index) {
    const value = samples[index];
    const heading = (/^#\s+(.+)$/m.exec(value)?.[1] ?? '').replace(/\s+\{#[^}]+\}\s*$/, '');
    await page.evaluate(
    /**
     * Host側の本文状態のwhile結果を読み取り、検証用の値へ変換する。
     * @param text - HostからWebviewへ通知する新しいMarkdown本文。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    (text) => {
      const before = window.__mveHostText;
      let prefix = 0;
      while (prefix < before.length && prefix < text.length && before[prefix] === text[prefix]) prefix += 1;
      let beforeSuffix = before.length;
      let afterSuffix = text.length;
      while (beforeSuffix > prefix && afterSuffix > prefix && before[beforeSuffix - 1] === text[afterSuffix - 1]) {
        beforeSuffix -= 1;
        afterSuffix -= 1;
      }
      const baseVersion = window.__mveHostVersion;
      const change = { rangeOffset: prefix, rangeLength: beforeSuffix - prefix, text: text.slice(prefix, afterSuffix) };
      window.__mveHostText = text;
      window.__mveHostVersion += 1;
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'externalChanges', baseVersion, version: window.__mveHostVersion, changes: [change] }
      }));
    }, value);
    await page.waitForFunction(
    /**
     * ブラウザー内に「.split-preview」が現れるまで待機する。
     * @param text - プレビュー内に含まれるか調べる文字列。
     */
    (text) => document.querySelector('.split-preview')?.textContent?.includes(text), heading);
    try {
      await page.waitForFunction(
      /**
       * ブラウザー内に「.source-editor」が現れるまで待機する。
       * @param expectedLength - ソースエディターで期待する本文長。
       */
      (expectedLength) => (
        Number(document.querySelector('.source-editor')?.getAttribute('data-document-length')) === expectedLength
      ), value.length);
    } catch (error) {
      const actualLength = await page.locator('.source-editor').getAttribute('data-document-length');
      const mismatch = await page.locator('.source-editor').getAttribute('data-document-mismatch');
      throw new Error(`sample/${index} source length mismatch: expected=${value.length}, actual=${actualLength}, diff=${mismatch}`, { cause: error });
    }
  }

  await load(1);
  if ((await page.locator('.split-preview br').count()) < 2) throw new Error('sample/01 のハード改行を確認できません。');
  await load(2);
  if (!(await page.locator('.split-preview .katex').count())) throw new Error('sample/02 の数式を確認できません。');
  await load(3);
  await page.waitForFunction(
  /**
   * ブラウザー内に「.split-preview img[src*=」が現れるまで待機する。
   */
  () => document.querySelector('.split-preview img[src*="local-sample.svg"]')?.naturalWidth > 0);
  if (!(await page.locator('.split-preview .blocked-image').count())) throw new Error('sample/03 のリモート画像制御を確認できません。');
  await load(4);
  if ((await page.locator('.split-preview table').count()) < 2) throw new Error('sample/04 のテーブルを確認できません。');
  await load(5);
  if ((await page.locator('.split-preview .code-figure').count()) < 1) throw new Error('sample/05 のコードブロックを確認できません。');
  await page.waitForFunction(
  /**
   * ブラウザーのDOM状態が完了条件を満たすまで待機する。
   */
  () => document.body.dataset.mveMarkdownWorkerStatus === 'ready');
  if (!(await page.locator('.split-preview code .hljs-keyword, .split-preview code .hljs-built_in, .split-preview code .hljs-selector-tag').count())) {
    throw new Error('sample/05 の遅延シンタックスハイライトを確認できません。');
  }
  await page.locator('.split-preview .mermaid').first().scrollIntoViewIfNeeded();
  await page.waitForFunction(
  /**
   * ブラウザー内に「.split-preview .mermaid[data-mermaid-status=」が現れるまで待機する。
   */
  () => document.querySelectorAll('.split-preview .mermaid[data-mermaid-status="ready"]').length >= 1);
  await load(6);
  await page.locator('.split-preview .mermaid').first().scrollIntoViewIfNeeded();
  await page.waitForFunction(
  /**
   * ブラウザー内に「.split-preview .mermaid[data-mermaid-status=」が現れるまで待機する。
   */
  () => document.querySelectorAll('.split-preview .mermaid[data-mermaid-status="ready"]').length >= 1);
  if (!(await page.locator('.split-preview .katex').count()) || !(await page.locator('.split-preview table').count())) throw new Error('sample/06 の数式・表を確認できません。');
  await load(7);
  await load(9);
  if ((await page.locator('.split-preview h2').count()) < 18) throw new Error('sample/09 large document did not render all sections');
  if ((await page.locator('.split-preview table').count()) < 2) throw new Error('sample/09 large document tables are missing');
  if (!(await page.locator('.split-preview').textContent()).includes('verylongtoken_without_break_points_')) throw new Error('sample/07 の長いRaw文字列を確認できません。');
  const renderRequestStart = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態のfilter結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveMessages.filter(
  /**
   * 種別「renderMermaid」のメッセージだけを残す。
   * @param message - メッセージのtypeを参照する走査対象。

   */
  (message) => message.type === 'renderMermaid').length);
  await load(11);
  await page.locator('.cm-content').click();
  await page.locator('.cm-content').press('Control+Home');
  await page.waitForFunction(
  /**
   * ブラウザー内に「.cm-scroller」が現れるまで待機する。
   */
  () => (document.querySelector('.cm-scroller')?.scrollTop ?? 0) < 80);
  // scrollIntoViewだけでは直前のソース→プレビュー同期に上書きされ得る。
  // 実際のホイール操作と同じ意図を先に通知し、大規模図を確実に可視範囲へ入れる。
  await page.locator('.split-preview').dispatchEvent('wheel', { deltaY: 1 });
  await page.locator('.split-preview .mermaid').first().evaluate(
  (node) => node.scrollIntoView({ block: 'center' }));
  try {
    await page.waitForFunction(
    /**
     * ブラウザー内に「.split-preview」が現れるまで待機する。
     */
    () => {
      const container = document.querySelector('.split-preview');
      const node = container?.querySelector('.mermaid');
      if (!container || !node) return false;
      const viewport = container.getBoundingClientRect();
      const rect = node.getBoundingClientRect();
      return rect.bottom >= viewport.top && rect.top <= viewport.bottom;
    });
  } catch (error) {
    const state = await page.evaluate(
    /**
     * ブラウザー内の「.split-preview」を読み取り、検証用の値へ変換する。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    () => ({
      previewScrollTop: document.querySelector('.split-preview')?.scrollTop,
      debug: (window.__mveDebugLog ?? []).slice(-100)
    }));
    throw new Error(`preview user scroll was overwritten: ${JSON.stringify(state)}`, { cause: error });
  }
  await page.evaluate(
  /**
   * Webviewの実行状態のnow結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    window.__mveResponsiveness = { startedAt: performance.now(), previous: performance.now(), maximumGap: 0, ticks: 0 };
    window.__mveLongTasks = [];
    window.__mveLongTaskObserver = new PerformanceObserver(
    /**
     * @param list - サンプル検証・マトリクスへ渡す入力。
     */
    (list) => {
      window.__mveLongTasks.push(...list.getEntries().map(
      (entry) => ({ startTime: entry.startTime, duration: entry.duration })));
    });
    window.__mveLongTaskObserver.observe({ type: 'longtask', buffered: false });
    window.__mveResponsivenessTimer = setInterval(

    () => {
      const state = window.__mveResponsiveness;
      const now = performance.now();
      state.maximumGap = Math.max(state.maximumGap, now - state.previous);
      state.previous = now;
      state.ticks += 1;
    }, 16);
  });
  try {
    await page.waitForFunction(
    /**
     * HostとWebviewのメッセージ状態が完了条件を満たすまで待機する。
     * @param start - 操作前のMermaid描画要求数のスナップショット。
     */
    (start) => window.__mveMessages.filter(
    /**
     * 種別「renderMermaid」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。

     */
    (message) => message.type === 'renderMermaid').length > start, renderRequestStart);
  } catch (error) {
    const mermaidWaitState = await page.evaluate(
    /**
     * ブラウザー内の「.split-preview」を読み取り、検証用の値へ変換する。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    () => ({
      inputActive: document.body.dataset.mveInputActive,
      preview: (

      () => {
        const element = document.querySelector('.split-preview');
        return element ? { scrollTop: element.scrollTop, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight } : undefined;
      })(),
      nodes: [...document.querySelectorAll('.split-preview .mermaid')].slice(0, 5).map(
      (node) => ({
        connected: node.isConnected,
        status: node.getAttribute('data-mermaid-status'),
        top: node.getBoundingClientRect().top,
        source: decodeURIComponent(node.getAttribute('data-mermaid-source') ?? '').slice(0, 80)
      })),
      requestCount: window.__mveMessages.filter(
      /**
       * 種別「renderMermaid」のメッセージだけを残す。
       * @param message - メッセージのtypeを参照する走査対象。

       */
      (message) => message.type === 'renderMermaid').length,
      lastMessages: window.__mveMessages.slice(-5).map(
      /**
       * 各メッセージからtypeを取り出して一覧化する。
       * @param message - メッセージのtypeを参照する走査対象。
       * @returns typeを取り出した変換結果の一覧。
       */
      (message) => message.type),
      documentLength: document.querySelector('.split-preview .rendered-markdown')?.getAttribute('data-document-length'),
      renderRevision: document.querySelector('.split-preview .rendered-markdown')?.getAttribute('data-render-revision'),
      debug: (window.__mveDebugLog ?? []).slice(-80)
    }));
    throw new Error(`sample/11 Mermaid render request did not start: ${JSON.stringify(mermaidWaitState)}`, { cause: error });
  }
  await page.keyboard.press('x');
  const initialBlurDuration = await page.evaluate(
  /**
   * ブラウザーのDOM状態のnow結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    const startedAt = performance.now();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    return performance.now() - startedAt;
  });
  await page.waitForTimeout(2_500);
  const responsiveness = await page.evaluate(
  () => {
    clearInterval(window.__mveResponsivenessTimer);
    window.__mveLongTaskObserver.disconnect();
    return {
      ...window.__mveResponsiveness,
      markdownRender: performance.getEntriesByName('mve-preview-markdown').at(-1)?.duration ?? 0,
      markdownWorker: performance.getEntriesByName('mve-preview-markdown-worker').at(-1)?.duration ?? 0,
      domReconcile: performance.getEntriesByName('mve-preview-dom-reconcile').at(-1)?.duration ?? 0,
      slowestSanitizeBlock: window.__mveSlowestSanitizeBlock,
      longTasks: window.__mveLongTasks,
      mermaidApply: performance.getEntriesByName('mve-preview-mermaid-apply').at(-1)?.duration ?? 0,
      timingMarks: performance.getEntriesByType('mark')
        .filter(
        /**
         * nameの条件を満たすエントリだけを残す。
         * @param entry - エントリのnameを参照する走査対象。

         */
        (entry) => entry.name.startsWith('mve-preview-'))
        .slice(-12)
        .map(
        /**
         * 各エントリからnameを取り出して一覧化する。
         * @param entry - エントリのnameを参照する走査対象。
         * @returns nameを取り出した変換結果の一覧。
         */
        (entry) => ({ name: entry.name, startTime: entry.startTime }))
    };
  });
  if (initialBlurDuration >= 50 || responsiveness.longTasks.length > 0 || responsiveness.ticks < 100) {
    throw new Error(`sample/11 Mermaid描画中にUIイベントループが停止しました: ${JSON.stringify(responsiveness)}`);
  }
  try {
    await page.waitForFunction(
    /**
     * ブラウザー内に「.split-preview .mermaid-svg-image」が現れるまで待機する。
     */
    () => document.querySelectorAll('.split-preview .mermaid-svg-image').length >= 1, undefined, { timeout: 15_000 });
  } catch (error) {
    const mermaidFailure = await page.evaluate(
    /**
     * ブラウザー内の「.split-preview .rendered-markdown」を読み取り、検証用の値へ変換する。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    () => ({
      requests: window.__mveMessages.filter(
      /**
       * 種別「renderMermaid」のメッセージだけを残す。
       * @param message - メッセージのtypeを参照する走査対象。

       */
      (message) => message.type === 'renderMermaid'),
      cancellations: window.__mveMessages.filter(
      /**
       * 種別「cancelMermaidRender」のメッセージだけを残す。
       * @param message - メッセージのtypeを参照する走査対象。

       */
      (message) => message.type === 'cancelMermaidRender'),
      previewLength: document.querySelector('.split-preview .rendered-markdown')?.getAttribute('data-document-length'),
      nodes: [...document.querySelectorAll('.split-preview .mermaid')].map(
      (node) => ({
        status: node.getAttribute('data-mermaid-status'),
        children: [...node.children].map(
        (child) => child.className || child.tagName),
        text: node.textContent?.slice(0, 120)
      }))
    }));
    throw new Error(`sample/11 initial Mermaid rendering did not complete: ${JSON.stringify(mermaidFailure)}`, { cause: error });
  }
  await page.waitForFunction(
  /**
   * ブラウザー内に「.split-preview .mermaid-svg-frame[data-mve-rasterized=」が現れるまで待機する。
   */
  () => document.querySelector(
    '.split-preview .mermaid-svg-frame[data-mve-rasterized="true"]'
  ), undefined, { timeout: 15_000 });
  await page.locator('.split-preview .mermaid-svg-frame[data-mve-rasterized="true"]').first().scrollIntoViewIfNeeded();
  await page.waitForFunction(
  /**
   * ブラウザー内に「.split-preview .mermaid-interaction-text」が現れるまで待機する。
   */
  () => document.querySelectorAll('.split-preview .mermaid-interaction-text').length >= 1, undefined, { timeout: 15_000 });
  await page.waitForFunction(
  /**
   * ブラウザー内に「.split-preview .mermaid」が現れるまで待機する。
   */
  () => {
    const diagrams = [...document.querySelectorAll('.split-preview .mermaid')];
    return diagrams.some(
    /**
     * @param node - サンプル検証・マトリクスで走査または更新する要素。
     */
    (node) => ['ready', 'error'].includes(node.getAttribute('data-mermaid-status')))
      && !diagrams.some(
      /**
       * @param node - サンプル検証・マトリクスで走査または更新する要素。
       */
      (node) => node.getAttribute('data-mermaid-status') === 'rendering');
  }, undefined, { timeout: 30_000 });
  const sustainedStart = await page.evaluate(
  /**
   * Webviewの実行状態のnow結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    window.__mveMaximumOutstandingOperations = window.__mveOutstandingOperations;
    window.__mveAckDelay = 2_000;
    window.__mveSustainedResponsiveness = { previous: performance.now(), maximumGap: 0, ticks: 0 };
    window.__mveSustainedLongTasks = [];
    window.__mveSustainedLongTaskObserver = new PerformanceObserver(
    /**
     * @param list - サンプル検証・マトリクスへ渡す入力。
     */
    (list) => {
      window.__mveSustainedLongTasks.push(...list.getEntries().map(
      (entry) => ({
        startTime: entry.startTime,
        duration: entry.duration
      })));
    });
    window.__mveSustainedLongTaskObserver.observe({ type: 'longtask', buffered: false });
    window.__mveSustainedTimer = setInterval(

    () => {
      const state = window.__mveSustainedResponsiveness;
      const now = performance.now();
      state.maximumGap = Math.max(state.maximumGap, now - state.previous);
      state.previous = now;
      state.ticks += 1;
    }, 16);
    return {
      messages: window.__mveMessages.length,
      mermaidRequests: window.__mveMessages.filter(
      /**
       * 種別「renderMermaid」のメッセージだけを残す。
       * @param message - メッセージのtypeを参照する走査対象。

       */
      (message) => message.type === 'renderMermaid').length,
      mermaidNodes: document.querySelectorAll('.split-preview .mermaid').length,
      mermaidImages: document.querySelectorAll('.split-preview .mermaid-svg-image').length,
      hostLength: window.__mveHostText.length,
      editorLength: Number(document.querySelector('.source-editor')?.getAttribute('data-document-length'))
    };
  });
  await page.locator('.cm-content').click();
  await page.locator('.cm-content').press('Control+Home');
  const waveAverages = [];
  let worstInput = 0;
  let typedText = '';
  for (let wave = 0; wave < 24; wave += 1) {
    const durations = [];
    for (let index = 0; index < 80; index += 1) {
      const startedAt = performance.now();
      const character = String.fromCharCode(97 + ((wave + index) % 26));
      typedText += character;
      await page.keyboard.insertText(character);
      const duration = performance.now() - startedAt;
      durations.push(duration);
      worstInput = Math.max(worstInput, duration);
    }
    waveAverages.push(durations.reduce(
    /**
     * 要素を順に加算して累積値を求める。
     * @param total - 累積値へ加算する要素。
     * @param duration - 累積値へ加算する要素。
     * @returns 要素を集約した累積値。
     */
    (total, duration) => total + duration, 0) / durations.length);
    // 220ms settled + 120ms preview予約を越え、Worker開始直後に次の入力波を重ねる。
    await page.waitForTimeout(370);
  }
  const sustainedBlurDuration = await page.evaluate(
  /**
   * ブラウザーのDOM状態のnow結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    const startedAt = performance.now();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    return performance.now() - startedAt;
  });
  await page.waitForFunction(
  /**
   * ブラウザー内に「.split-preview .rendered-markdown」が現れるまで待機する。
   * @param expectedLength - プレビューで期待するMarkdown本文長。
   */
  (expectedLength) => (
    Number(document.querySelector('.split-preview .rendered-markdown')?.getAttribute('data-document-length')) === expectedLength
  ), sustainedStart.hostLength + typedText.length, { timeout: 30_000 });
  try {
    await page.waitForFunction(
    /**
     * ブラウザー内に「.split-preview .mermaid」が現れるまで待機する。
     */
    () => {
      const diagrams = [...document.querySelectorAll('.split-preview .mermaid')];
      return diagrams.some(
      /**
       * @param node - サンプル検証・マトリクスで走査または更新する要素。
       */
      (node) => ['ready', 'error'].includes(node.getAttribute('data-mermaid-status')))
        && !diagrams.some(
        /**
         * @param node - サンプル検証・マトリクスで走査または更新する要素。
         */
        (node) => node.getAttribute('data-mermaid-status') === 'rendering');
    }, undefined, { timeout: 30_000 });
  } catch (error) {
    const state = await page.evaluate(
    /**
     * ブラウザー内の「.split-preview .mermaid」を読み取り、検証用の値へ変換する。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    () => ({
      workerStatus: document.body.dataset.mveMarkdownWorkerStatus,
      diagrams: [...document.querySelectorAll('.split-preview .mermaid')].map(
      (node) => ({
        status: node.getAttribute('data-mermaid-status'),
        source: decodeURIComponent(node.getAttribute('data-mermaid-source') ?? '').slice(0, 80)
      })),
      outstandingOperations: window.__mveOutstandingOperations,
      recentMessages: window.__mveMessages.slice(-10).map(
      /**
       * 各メッセージからtypeを取り出して一覧化する。
       * @param message - メッセージのtypeを参照する走査対象。
       * @returns typeを取り出した変換結果の一覧。
       */
      (message) => ({
        type: message.type,
        requestId: message.requestId
      })),
      debug: (window.__mveDebugLog ?? []).slice(-30)
    }));
    throw new Error(`continuous Mermaid rendering did not settle: ${JSON.stringify(state)}`, { cause: error });
  }
  await page.waitForTimeout(500);
  const sustained = await page.evaluate(
  /**
   * ブラウザー内の「.split-preview .mermaid」を読み取り、検証用の値へ変換する。
   * @param start - 長時間テスト開始時のカウンターと本文長のスナップショット。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (start) => {
    clearInterval(window.__mveSustainedTimer);
    window.__mveSustainedLongTaskObserver.disconnect();
    window.__mveAckDelay = 0;
    const messages = window.__mveMessages.slice(start.messages);
    return {
      responsiveness: window.__mveSustainedResponsiveness,
      longTasks: window.__mveSustainedLongTasks,
      localOperations: messages.filter(
      /**
       * 種別「localChanges」のメッセージだけを残す。
       * @param message - メッセージのtypeを参照する走査対象。

       */
      (message) => message.type === 'localChanges').length,
      maximumOutstandingOperations: window.__mveMaximumOutstandingOperations,
      hostLength: window.__mveHostText.length,
      mermaidRequests: window.__mveMessages.filter(
      /**
       * 種別「renderMermaid」のメッセージだけを残す。
       * @param message - メッセージのtypeを参照する走査対象。

       */
      (message) => message.type === 'renderMermaid').length - start.mermaidRequests,
      mermaidNodes: document.querySelectorAll('.split-preview .mermaid').length,
      mermaidImages: document.querySelectorAll('.split-preview .mermaid-svg-image').length,
      previewPerformanceEntries: performance.getEntriesByType('mark')
        .filter(
        /**
         * nameの条件を満たすエントリだけを残す。
         * @param entry - エントリのnameを参照する走査対象。

         */
        (entry) => entry.name.startsWith('mve-preview-')).length
        + performance.getEntriesByType('measure')
          .filter(
          /**
           * nameの条件を満たすエントリだけを残す。
           * @param entry - エントリのnameを参照する走査対象。

           */
          (entry) => entry.name.startsWith('mve-preview-') || entry.name.startsWith('mve-source-')).length,
      mermaidStates: [...document.querySelectorAll('.split-preview .mermaid')].map(
      (node) => ({
        status: node.getAttribute('data-mermaid-status'),
        children: [...node.children].map(
        (child) => child.className || child.tagName),
        text: node.textContent?.slice(0, 120)
      }))
    };
  }, sustainedStart);
  try {
    await page.waitForFunction(
    /**
     * Host側の本文状態が完了条件を満たすまで待機する。
     */
    ({ prefix, length }) => (
      window.__mveHostText.length === length && window.__mveHostText.startsWith(prefix)
    ), { prefix: typedText, length: sustainedStart.hostLength + typedText.length }, { timeout: 10_000 });
  } catch (error) {
    const convergence = await page.evaluate(
    /**
     * HostとWebviewのメッセージ状態のslice結果を読み取り、検証用の値へ変換する。
     * @param prefix - 収束後のHost本文先頭と照合する文字列。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    (prefix) => ({
      hostLength: window.__mveHostText.length,
      expectedPrefix: prefix.slice(0, 80),
      actualPrefix: window.__mveHostText.slice(0, 80),
      resyncRequests: window.__mveMessages.filter(
      /**
       * 種別「requestResync」のメッセージだけを残す。
       * @param message - メッセージのtypeを参照する走査対象。

       */
      (message) => message.type === 'requestResync'),
      localOperations: window.__mveMessages.filter(
      /**
       * 種別「localChanges」のメッセージだけを残す。
       * @param message - メッセージのtypeを参照する走査対象。

       */
      (message) => message.type === 'localChanges').map(
      (message) => ({
        clientId: message.clientId,
        opId: message.opId,
        baseVersion: message.baseVersion,
        changes: message.changes.map(
        (change) => ({
          offset: change.rangeOffset,
          removed: change.rangeLength,
          inserted: change.text.length,
          prefix: change.text.slice(0, 24)
        }))
      }))
    }), typedText);
    throw new Error(`continuous edits did not converge after ACK recovery: ${JSON.stringify(convergence)}`, { cause: error });
  }
  await page.waitForFunction(
  /**
   * Webviewの実行状態が完了条件を満たすまで待機する。
   */
  () => window.__mveOutstandingOperations === 0, undefined, { timeout: 10_000 });
  const workerStatus = await page.evaluate(
  /**
   * ブラウザーのDOM状態を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => document.body.dataset.mveMarkdownWorkerStatus);
  if (workerStatus !== 'ready') throw new Error(`Markdown Worker did not remain active: ${workerStatus}`);
  const firstWaveAverage = waveAverages.slice(0, 4).reduce(
  /**
   * 要素を順に加算して累積値を求める。
   * @param total - 累積値へ加算する要素。
   * @param value - 累積値へ加算する要素。
   * @returns 要素を集約した累積値。
   */
  (total, value) => total + value, 0) / 4;
  const lastWaveAverage = waveAverages.slice(-4).reduce(
  /**
   * 要素を順に加算して累積値を求める。
   * @param total - 累積値へ加算する要素。
   * @param value - 累積値へ加算する要素。
   * @returns 要素を集約した累積値。
   */
  (total, value) => total + value, 0) / 4;
  if (lastWaveAverage > firstWaveAverage * 1.2 + 2 || worstInput >= 50) {
    throw new Error(`sample/11 continuous input degraded: ${JSON.stringify({ waveAverages, firstWaveAverage, lastWaveAverage, worstInput })}`);
  }
  if (sustainedBlurDuration >= 50
    || sustained.responsiveness.maximumGap > 60
    || sustained.responsiveness.ticks < 100
    || sustained.longTasks.length > 0) {
    throw new Error(`sample/11 continuous editing blocked UI: ${JSON.stringify({ responsiveness: sustained.responsiveness, longTasks: sustained.longTasks })}`);
  }
  if (sustained.localOperations >= 120) {
    throw new Error(`sample/11 retained too many local operations: ${sustained.localOperations}`);
  }
  if (sustained.maximumOutstandingOperations > 1) {
    throw new Error(`sample/11 accumulated host synchronization operations: ${sustained.maximumOutstandingOperations}`);
  }
  if (sustained.previewPerformanceEntries > 64) {
    throw new Error(`sample/11 accumulated performance entries: ${sustained.previewPerformanceEntries}`);
  }
  if (sustained.mermaidRequests > 1
    || sustained.mermaidNodes !== sustainedStart.mermaidNodes
    || sustained.mermaidImages !== sustainedStart.mermaidImages) {
    throw new Error(`sample/11 Mermaid work accumulated during continuous editing: ${JSON.stringify(sustained)}`);
  }
  await rendererQueue;
  lightweightMermaidRendering = true;
  await rendererPage.close();
  const scrollPerformance = await page.evaluate(
  /**
   * ブラウザー内の「.split-preview」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  async () => {
    const preview = document.querySelector('.split-preview');
    if (!(preview instanceof HTMLElement)) throw new Error('split preview is missing');
    const maximumScrollTop = Math.max(0, preview.scrollHeight - preview.clientHeight);
    const samples = [];
    const frameIntervals = [];
    const longTasks = [];
    const longTaskObserver = new PerformanceObserver(
    /**
     * @param list - サンプル検証・マトリクスへ渡す入力。
     */
    (list) => {
      longTasks.push(...list.getEntries().map(
      (entry) => ({
        startTime: entry.startTime,
        duration: entry.duration
      })));
    });
    longTaskObserver.observe({ type: 'longtask', buffered: false });
    let previousFrame = performance.now();
    for (let index = 0; index < 120; index += 1) {
      const startedAt = performance.now();
      preview.scrollTop = maximumScrollTop * ((index % 60) / 59);
      await new Promise(
      /**
       * 非同期処理の成功結果を待機側へ通知する。
       * @param resolve - Promiseの成功を通知する関数。
       */
      (resolve) => requestAnimationFrame(
      /**
       * 次の描画フレームで表示更新を実行する。
       * @param now - 次の描画フレームで実行するコールバック。
       */
      (now) => {
        frameIntervals.push(now - previousFrame);
        previousFrame = now;
        resolve();
      }));
      const appScrollMeasure = performance.getEntriesByName('mve-preview-scroll-handler').at(-1);
      const previewSyncMeasure = performance.getEntriesByName('mve-preview-scroll-sync').at(-1);
      const sourceSyncMeasure = performance.getEntriesByName('mve-source-scroll-sync').at(-1);
      const mermaidScheduleMeasure = performance.getEntriesByName('mve-preview-scroll-mermaid-schedule').at(-1);
      const imageEnhanceMeasure = performance.getEntriesByName('mve-preview-image-enhance').at(-1);
      const mermaidApplyMeasure = performance.getEntriesByName('mve-preview-mermaid-apply').at(-1);
      const previewBounds = preview.getBoundingClientRect();
      const viewportElement = document.elementFromPoint(
        previewBounds.left + previewBounds.width / 2,
        previewBounds.top + Math.min(80, previewBounds.height / 2)
      );
      const viewportBlock = viewportElement?.closest('.markdown-source-block');
      samples.push({
        index,
        scrollTop: preview.scrollTop,
        appScrollDuration: appScrollMeasure?.startTime >= startedAt ? appScrollMeasure.duration : 0,
        previewSyncDuration: previewSyncMeasure?.startTime >= startedAt ? previewSyncMeasure.duration : 0,
        sourceSyncDuration: sourceSyncMeasure?.startTime >= startedAt ? sourceSyncMeasure.duration : 0,
        mermaidScheduleDuration: mermaidScheduleMeasure?.startTime >= startedAt ? mermaidScheduleMeasure.duration : 0,
        imageEnhanceDuration: imageEnhanceMeasure?.startTime >= startedAt ? imageEnhanceMeasure.duration : 0,
        mermaidApplyDuration: mermaidApplyMeasure?.startTime >= startedAt ? mermaidApplyMeasure.duration : 0,
        viewportBlockFrom: viewportBlock?.getAttribute('data-source-from'),
        viewportBlockTo: viewportBlock?.getAttribute('data-source-to'),
        viewportBlockElement: viewportBlock?.firstElementChild?.className || viewportBlock?.firstElementChild?.tagName,
        viewportContainsMermaidImage: Boolean(viewportBlock?.querySelector('.mermaid-svg-image')),
        frameInterval: frameIntervals.at(-1) ?? 0,
        sourceScrollTop: document.querySelector('.split-source-pane .cm-scroller')?.scrollTop ?? 0,
        mermaidRequests: window.__mveMessages.filter(
        /**
         * 種別「renderMermaid」のメッセージだけを残す。
         * @param message - メッセージのtypeを参照する走査対象。

         */
        (message) => message.type === 'renderMermaid').length
      });
    }
    longTaskObserver.disconnect();
    const sortedFrames = [...frameIntervals].sort(
    /**
     * 2つの値を比較して並び順を決める。
     * @param left - 比較対象の左側の値。
     * @param right - 比較対象の右側の値。
     * @returns 2つの要素の順序を示す数値。
     */
    (left, right) => left - right);
    const maximumHandlerDuration = Math.max(0, ...samples.map(
    (sample) => Math.max(
      sample.appScrollDuration,
      sample.previewSyncDuration,
      sample.sourceSyncDuration,
      sample.mermaidScheduleDuration,
      sample.imageEnhanceDuration,
      sample.mermaidApplyDuration
    )));
    return {
      maximumHandlerDuration,
      maximumFrameInterval: sortedFrames.at(-1) ?? 0,
      p95FrameInterval: sortedFrames[Math.min(sortedFrames.length - 1, Math.floor(sortedFrames.length * 0.95))] ?? 0,
      p99FrameInterval: sortedFrames[Math.min(sortedFrames.length - 1, Math.floor(sortedFrames.length * 0.99))] ?? 0,
      longTasks,
      slowest: samples
        .sort(
        /**
         * 2つの値を比較して並び順を決める。
         * @param left - 比較対象の左側の値。
         * @param right - 比較対象の右側の値。
         * @returns 2つの要素の順序を示す数値。
         */
        (left, right) => right.frameInterval - left.frameInterval)
        .slice(0, 8)
    };
  });
  if (scrollPerformance.maximumHandlerDuration >= 15
    || scrollPerformance.longTasks.length > 0
    || scrollPerformance.maximumFrameInterval > 60
    || scrollPerformance.p95FrameInterval > 35) {
    throw new Error(`sample/11 preview scrolling blocked UI: ${JSON.stringify(scrollPerformance)}`);
  }
  const sourceScroller = await page.locator('.split-source-pane .cm-scroller').boundingBox();
  if (!sourceScroller) throw new Error('sample/11 source scroller is missing');
  await page.evaluate(
  /**
   * Webviewの実行状態のnow結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    window.__mveSelectionResponsiveness = { previous: performance.now(), maximumGap: 0, ticks: 0 };
    window.__mveSelectionTimer = setInterval(

    () => {
      const state = window.__mveSelectionResponsiveness;
      const now = performance.now();
      state.maximumGap = Math.max(state.maximumGap, now - state.previous);
      state.previous = now;
      state.ticks += 1;
    }, 16);
  });
  const dragX = sourceScroller.x + Math.min(180, sourceScroller.width / 2);
  await page.mouse.move(dragX, sourceScroller.y + 40);
  await page.mouse.down();
  await page.mouse.move(dragX, sourceScroller.y + sourceScroller.height - 40, { steps: 80 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const selectionPerformance = await page.evaluate(
  /**
   * ブラウザー内の「.source-editor」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    clearInterval(window.__mveSelectionTimer);
    const editor = document.querySelector('.source-editor');
    return {
      ...window.__mveSelectionResponsiveness,
      from: Number(editor?.getAttribute('data-selection-from')),
      to: Number(editor?.getAttribute('data-selection-to'))
    };
  });
  if (selectionPerformance.from === selectionPerformance.to || selectionPerformance.maximumGap > 60) {
    throw new Error(`sample/11 drag selection blocked UI: ${JSON.stringify(selectionPerformance)}`);
  }
  let rendererQueueSettled = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(250);
    const observedQueue = rendererQueue;
    await observedQueue;
    await page.waitForTimeout(250);
    if (observedQueue === rendererQueue) {
      rendererQueueSettled = true;
      break;
    }
  }
  if (!rendererQueueSettled) throw new Error('Mermaid renderer queue did not settle after scrolling');
  console.log(`continuous waves=${waveAverages.map(
  (value) => value.toFixed(1)).join('/')}ms; first4=${firstWaveAverage.toFixed(1)}ms; last4=${lastWaveAverage.toFixed(1)}ms; worst=${worstInput.toFixed(1)}ms; loop-gap=${sustained.responsiveness.maximumGap.toFixed(1)}ms; blur=${sustainedBlurDuration.toFixed(1)}ms; scroll-handler-max=${scrollPerformance.maximumHandlerDuration.toFixed(1)}ms; scroll-frame-p95=${scrollPerformance.p95FrameInterval.toFixed(1)}ms; scroll-frame-p99=${scrollPerformance.p99FrameInterval.toFixed(1)}ms; selection-gap=${selectionPerformance.maximumGap.toFixed(1)}ms; operations=${sustained.localOperations}; perf-entries=${sustained.previewPerformanceEntries}; Mermaid requests=${sustained.mermaidRequests}`);
  closingContext = true;
  await context.close();
  console.log(`サンプル01〜07、09、11を確認しました。巨大Mermaid描画中の最大UI停止=${responsiveness.maximumGap.toFixed(1)}ms、Worker=${responsiveness.markdownWorker.toFixed(1)}ms、UIサニタイズ=${responsiveness.markdownRender.toFixed(1)}ms、DOM差分=${responsiveness.domReconcile.toFixed(1)}ms、Mermaid適用=${responsiveness.mermaidApply.toFixed(1)}ms、最遅ブロック=${JSON.stringify(responsiveness.slowestSanitizeBlock)}、LongTasks=${JSON.stringify(responsiveness.longTasks)}、Marks=${JSON.stringify(responsiveness.timingMarks)}。`);
} finally {
  await Promise.all([browser.close(), rendererBrowser.close()]);
}

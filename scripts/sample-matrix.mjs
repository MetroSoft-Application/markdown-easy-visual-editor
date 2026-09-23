/**
 * @file sample-matrix.mjs
 * 実行境界: 開発・検証スクリプト。
 * 責務: ビルド、スモーク、統合検証または補助生成を実行する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: プロセス、生成物、Webview、VS Code、Chromiumなどの外部環境を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { chromium } from 'playwright-core';
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
if (!executablePath) throw new Error('Chromium がありません。npm run pdf:install-browser を実行してください。');
/** 「entries」は、後続処理で順序を保って参照する一覧です。 */
const entries = await readdir(path.resolve('sample'));
/** 「samples」は、関連する処理間で共有する設定値または状態です。 */
const samples = {};
for (
  /** 収集対象サンプルの連番を示すループ変数です。 */
  const index of [1, 2, 3, 4, 5, 6, 7, 9, 11]
) {
  const prefix = String(index).padStart(2, '0');
  const file = entries.find(
  /**
 * 「entry」が検索条件に一致するか判定するコールバックです。
   * @param entry entryとして渡される、このコールバックの入力値です。
   * @returns 置換後の文字列を返します。
   */
  (entry) => entry.startsWith(`${prefix}-`) && entry.endsWith('.md'));
  if (!file) throw new Error(`sample/${prefix} がありません。`);
  samples[index] = (await readFile(path.resolve('sample', file), 'utf8')).replace(/\r\n?/g, '\n');
}
/** 「localSvg」は、関連する処理間で共有する設定値または状態です。 */
const localSvg = await readFile(path.resolve('sample/assets/local-sample.svg'));
/** 「markdownWorkerScript」は、関連する処理間で共有する設定値または状態です。 */
const markdownWorkerScript = await readFile(path.resolve('dist/markdown-worker.js'));
/** 「markdownRichWorkerScript」は、関連する処理間で共有する設定値または状態です。 */
const markdownRichWorkerScript = await readFile(path.resolve('dist/markdown-rich-worker.js'));
/** 「mermaidPngPlaceholder」は、関連する処理間で共有する設定値または状態です。 */
const mermaidPngPlaceholder = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
/** 「browser」は、ブラウザー処理の共有状態または実行設定です。 */
const browser = await chromium.launch({ executablePath, headless: true });
/** 「rendererBrowser」は、ブラウザー処理の共有状態または実行設定です。 */
const rendererBrowser = await chromium.launch({ executablePath, headless: true });
try {
  const context = await browser.newContext();
  const rendererContext = await rendererBrowser.newContext();
  const pageErrors = [];
  await context.addInitScript(
  /**
 * ブラウザーのWebviewテストで使用するグローバル状態を初期化するコールバックです。
   * @returns 「window.__mveMessages.push」を実行し、値を返しません。
   */
  () => {
    window.__mveMessages = [];
    window.__mveHostVersion = 1;
    window.__mveHostText = '';
    window.__mveAckDelay = 0;
    window.__mveOutstandingOperations = 0;
    window.__mveMaximumOutstandingOperations = 0;
    window.acquireVsCodeApi =
    /**
 * WebviewテストへVS Code API互換オブジェクトを提供するコールバックです。
     * @returns 初期化したオブジェクト（postMessage）を返します。
     */
    () => ({

      /**
       * 「postMessage」は、言語や通信契約に応じた表示文言または対応表を保持します。
       * @param message 処理対象のメッセージです。
       * @returns メッセージをHostまたはWebviewへ送信し、値は返しません。
       */
      postMessage: /**
 * 「postMessage」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param message 「message」は、「postMessage」が関連処理で処理する対象を特定する入力です。
 * @returns メッセージをHostまたはWebviewへ送信し、値は返しません。
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
 * 「left」「right」を比較し、並び順を示す数値を返すコールバックです。
           * @param left 比較対象の左側の値です。
           * @param right 比較対象の右側の値です。
           * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
           */
          (left, right) => right.rangeOffset - left.rangeOffset)) {
            window.__mveHostText = window.__mveHostText.slice(0, change.rangeOffset)
              + change.text
              + window.__mveHostText.slice(change.rangeOffset + change.rangeLength);
          }
          window.__mveHostVersion += 1;
          setTimeout(
          /**
 * 指定時間の経過後に遅延処理を実行するコールバックです。
           * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
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
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
   * @param error 発生したエラーです。
   * @returns 「error」から生成した処理結果を返します。
   */
  (error) => pageErrors.push(error.message));
  page.on('console',
  /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
   * @param message 処理対象のメッセージです。
   * @returns 「if」を実行し、値を返しません。
   */
  (message) => { if (message.type() === 'error') pageErrors.push(message.text()); });
  let closingContext = false;
  await page.exposeFunction('__mveHostPostMessage',
  /**
 * 非同期処理の完了値を受け取り、次の処理へ渡す結果を生成するコールバックです。
   * @param message 処理対象のメッセージです。
   * @returns 「if」を実行し、値を返しません。
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
     * 「async」として関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
     * @returns 解決値を処理した結果を返します。
     */
    async () => {
      if (cancelledRenderRequests.delete(message.requestId)) return;
      try {
        const rendered = lightweightMermaidRendering
          ? await new Promise(
          /**
           * 予約されたタイミングで「resolve」を受け取り、遅延処理を実行するコールバックです。
           * @param resolve Promiseの完了または失敗を通知する関数です。
           * @returns 解決値を処理した結果を返します。
           */
          (resolve) => setTimeout(
          /**
 * 指定時間の経過後に遅延処理を実行するコールバックです。
           * @returns 「resolve」を実行し、値を返しません。
           */
          () => resolve({
              svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80"><text x="8" y="42">Mermaid host result</text></svg>',
              interactions: [],
              ariaLabel: 'Mermaid host result'
            }), 20))
          : await rendererPage.evaluate(
          /**
 * 「source」「theme」「requestId」を受け取り、登録された副作用または結果を生成する処理です。
           * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはsource、theme、requestIdです。
           * @returns 「window.mermaid.initialize」を実行し、値を返しません。
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
              /**
 * 「element」を変換し、変換後の要素を返すコールバックです。
               * @param element 処理対象の要素です。
               * @returns 入力要素から生成した変換後の値を返します。
               */
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
 * 「item」が条件に一致するか判定し、残す要素を決めるコールバックです。
               * @param item 変換または処理の対象となる値です。
               * @returns 要素を採用するかどうかの真偽値を返します。
               */
              (item) => item.text && item.width > 0 && item.height > 0);
              container.remove();
              return { svg, interactions, ariaLabel: interactions.slice(0, 20).map(
              /**
 * 「item」を変換し、変換後の要素を返すコールバックです。
               * @param item 変換または処理の対象となる値です。
               * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
               */
              (item) => item.text).join(', ') };
            }, message);
        if (cancelledRenderRequests.delete(message.requestId)) return;
        if (rendered.svg.length >= 80_000) rendered.pngBase64 = mermaidPngPlaceholder;
        if (closingContext || page.isClosed()) return;
        await page.evaluate(
        /**
 * 「requestId」「result」を受け取り、Webviewへメッセージイベントを発火する処理です。
         * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはrequestId、resultです。
         * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
         */
        ({ requestId, result }) => {
          window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'mermaidRendered', requestId, ...result }
          }));
        }, { requestId: message.requestId, result: rendered });
      } catch (error) {
        if (closingContext || page.isClosed()) return;
        await page.evaluate(
        /**
 * 非同期処理の失敗理由を受け取り、回復処理または代替値を生成するコールバックです。
         * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはrequestId、textです。
         * @returns エラー処理またはフォールバックの結果を返します。
         */
        ({ requestId, text }) => {
          window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'mermaidRendered', requestId, error: text }
          }));
        }, { requestId: message.requestId, text: error instanceof Error ? error.message : String(error) });
      }
    });
  });
  page.setDefaultTimeout(7_000);
  await page.route('https://mve.test/sample/assets/**',
  /**
   * 「async」として「route」を受け取り、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param route 「route」は、「async」が関連処理の処理対象を特定する入力です。
   * @returns 「if」を実行し、値を返しません。
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
   * 「async」として「route」を受け取り、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param route 「route」は、「async」が関連処理の処理対象を特定する入力です。
   * @returns 「route.fulfill」を実行し、値を返しません。
   */
  async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: markdownWorkerScript });
  });
  await page.route('https://mve.test/dist/markdown-rich-worker.js',
  /**
   * 「async」として「route」を受け取り、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param route 「route」は、「async」が関連処理の処理対象を特定する入力です。
   * @returns 「route.fulfill」を実行し、値を返しません。
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
   * 「async」として「route」を受け取り、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param route 「route」は、「async」が関連処理の処理対象を特定する入力です。
   * @returns 「route.fulfill」を実行し、値を返しません。
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
 * ブラウザーのDOM状態が期待条件を満たすか確認する述語コールバックです。
     * @returns 期待条件の真偽値または条件に一致した要素を返します。
     */
    () => window.__mveMessages.some(
    /**
 * 「message」が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
     * @param message 処理対象のメッセージです。
     * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
     */
    (message) => message.type === 'ready'));
  } catch (error) {
    throw new Error(`Webview did not become ready: ${pageErrors.join(' | ')}`, { cause: error });
  }
  const settings = { imageDirectory: 'assets/${documentBasename}', maxPasteSizeMb: 20, remoteImagesEnabled: false, mermaidTheme: 'default', mermaidHostRendering: true, workspaceTrusted: true };
  await page.evaluate(
  /**
 * 「value」を受け取り、Webviewへメッセージイベントを発火する処理です。
   * @param value 「value」で検証・変換する入力値です。
   * @returns エラー処理またはフォールバックの結果を返します。
   */
  (value) => { window.__mveHostText = value; }, samples[1]);
  await page.evaluate(
  /**
 * 非同期処理の失敗理由を受け取り、回復処理または代替値を生成するコールバックです。
   * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはvalue、settingsです。
   * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
   */
  ({ value, settings: initSettings }) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'init', text: value, version: 1, uri: 'file:///C:/sample.md', settings: initSettings } })), { value: samples[1], settings });
  await page.locator('.split-editor').waitFor();

  /**
   * loadを取得または解決します。
   * @param index 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 「load」が準備した関連処理の結果をPromiseで返します。
   */
  async function load(index) {
    const value = samples[index];
    const heading = (/^#\s+(.+)$/m.exec(value)?.[1] ?? '').replace(/\s+\{#[^}]+\}\s*$/, '');
    await page.evaluate(
    /**
 * 「text」を受け取り、Webviewへメッセージイベントを発火する処理です。
     * @param text 処理対象の本文です。
     * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
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
 * ブラウザーのDOM状態が期待条件を満たすか確認する述語コールバックです。
     * @param text 処理対象の本文です。
     * @returns 「text」から生成した処理結果を返します。
     */
    (text) => document.querySelector('.split-preview')?.textContent?.includes(text), heading);
    try {
      await page.waitForFunction(
      /**
 * 非同期処理の失敗理由を受け取り、回復処理または代替値を生成するコールバックです。
       * @param expectedLength expectedLengthとして渡される、このコールバックの入力値です。
       * @returns 「expectedLength」から生成した処理結果を返します。
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
 * ブラウザーのDOM状態が期待条件を満たすか確認する述語コールバックです。
   * @returns 期待条件の真偽値または条件に一致した要素を返します。
   */
  () => document.querySelector('.split-preview img[src*="local-sample.svg"]')?.naturalWidth > 0);
  if (!(await page.locator('.split-preview .blocked-image').count())) throw new Error('sample/03 のリモート画像制御を確認できません。');
  await load(4);
  if ((await page.locator('.split-preview table').count()) < 2) throw new Error('sample/04 のテーブルを確認できません。');
  await load(5);
  if ((await page.locator('.split-preview .code-figure').count()) < 1) throw new Error('sample/05 のコードブロックを確認できません。');
  await page.waitForFunction(
  /**
 * ブラウザーのDOM状態が期待条件を満たすか確認する述語コールバックです。
   * @returns 期待条件の真偽値または条件に一致した要素を返します。
   */
  () => document.body.dataset.mveMarkdownWorkerStatus === 'ready');
  if (!(await page.locator('.split-preview code .hljs-keyword, .split-preview code .hljs-built_in, .split-preview code .hljs-selector-tag').count())) {
    throw new Error('sample/05 の遅延シンタックスハイライトを確認できません。');
  }
  await page.locator('.split-preview .mermaid').first().scrollIntoViewIfNeeded();
  await page.waitForFunction(
  /**
 * ブラウザーのDOM状態が期待条件を満たすか確認する述語コールバックです。
   * @returns 期待条件の真偽値または条件に一致した要素を返します。
   */
  () => document.querySelectorAll('.split-preview .mermaid[data-mermaid-status="ready"]').length >= 1);
  await load(6);
  await page.locator('.split-preview .mermaid').first().scrollIntoViewIfNeeded();
  await page.waitForFunction(
  /**
 * ブラウザーのDOM状態が期待条件を満たすか確認する述語コールバックです。
   * @returns 期待条件の真偽値または条件に一致した要素を返します。
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
 * WebviewのDOMまたは状態を読み取り、検証側へ値を返すコールバックです。
   * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
   */
  () => window.__mveMessages.filter(
  /**
 * 「message」が条件に一致するか判定し、残す要素を決めるコールバックです。
   * @param message 処理対象のメッセージです。
   * @returns 要素を採用するかどうかの真偽値を返します。
   */
  (message) => message.type === 'renderMermaid').length);
  await load(11);
  await page.locator('.cm-content').click();
  await page.locator('.cm-content').press('Control+Home');
  await page.waitForFunction(
  /**
 * ブラウザーのDOM状態が期待条件を満たすか確認する述語コールバックです。
   * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
   */
  () => (document.querySelector('.cm-scroller')?.scrollTop ?? 0) < 80);
  // scrollIntoViewだけでは直前のソース→プレビュー同期に上書きされ得る。
  // 実際のホイール操作と同じ意図を先に通知し、大規模図を確実に可視範囲へ入れる。
  await page.locator('.split-preview').dispatchEvent('wheel', { deltaY: 1 });
  await page.locator('.split-preview .mermaid').first().evaluate(
  /**
 * 「node」を受け取り、検証対象のJSONペイロードを生成する処理です。
   * @param node nodeとして渡される、このコールバックの入力値です。
   * @returns 「node」から生成した処理結果を返します。
   */
  (node) => node.scrollIntoView({ block: 'center' }));
  try {
    await page.waitForFunction(
    /**
 * 非同期処理の失敗理由を受け取り、回復処理または代替値を生成するコールバックです。
     * @returns 期待条件の真偽値または条件に一致した要素を返します。
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
     * Promiseの失敗理由を受け取り、エラー表示またはフォールバックを実行するコールバックです。
     * @returns エラー処理またはフォールバックの結果を返します。
     */
    () => ({
      previewScrollTop: document.querySelector('.split-preview')?.scrollTop,
      debug: (window.__mveDebugLog ?? []).slice(-100)
    }));
    throw new Error(`preview user scroll was overwritten: ${JSON.stringify(state)}`, { cause: error });
  }
  await page.evaluate(
  /**
 * 非同期処理の失敗理由を受け取り、回復処理または代替値を生成するコールバックです。
   * @returns 「performance.now」を実行し、値を返しません。
   */
  () => {
    window.__mveResponsiveness = { startedAt: performance.now(), previous: performance.now(), maximumGap: 0, ticks: 0 };
    window.__mveLongTasks = [];
    window.__mveLongTaskObserver = new PerformanceObserver(
    /**
 * 「list」を受け取り、登録された副作用または結果を生成する処理です。
     * @param list 処理対象となる複数要素の集合です。
     * @returns 「window.__mveLongTasks.push」を実行し、値を返しません。
     */
    (list) => {
      window.__mveLongTasks.push(...list.getEntries().map(
      /**
 * 「entry」を変換し、変換後の要素を返すコールバックです。
       * @param entry entryとして渡される、このコールバックの入力値です。
       * @returns 入力要素から生成した変換後の値を返します。
       */
      (entry) => ({ startTime: entry.startTime, duration: entry.duration })));
    });
    window.__mveLongTaskObserver.observe({ type: 'longtask', buffered: false });
    window.__mveResponsivenessTimer = setInterval(
    /**
 * 一定間隔で状態を監視または更新するコールバックです。
     * @returns 定期監視または状態更新を実行し、値を返しません。
     */
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
 * ブラウザーのDOM状態が期待条件を満たすか確認する述語コールバックです。
     * @param start startとして渡される、このコールバックの入力値です。
     * @returns 「start」が開始した処理の結果または非同期Promiseを返します。
     */
    (start) => window.__mveMessages.filter(
    /**
 * 「message」が条件に一致するか判定し、残す要素を決めるコールバックです。
     * @param message 処理対象のメッセージです。
     * @returns 要素を採用するかどうかの真偽値を返します。
     */
    (message) => message.type === 'renderMermaid').length > start, renderRequestStart);
  } catch (error) {
    const mermaidWaitState = await page.evaluate(
    /**
     * 配列要素を採用するか判定するコールバックです。
     * @returns 要素を採用するかどうかの真偽値を返します。
     */
    () => ({
      inputActive: document.body.dataset.mveInputActive,
      preview: (
      /**
       * Promiseの失敗理由を受け取り、エラー表示またはフォールバックを実行するコールバックです。
       * @returns エラー処理またはフォールバックの結果を返します。
       */
      () => {
        const element = document.querySelector('.split-preview');
        return element ? { scrollTop: element.scrollTop, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight } : undefined;
      })(),
      nodes: [...document.querySelectorAll('.split-preview .mermaid')].slice(0, 5).map(
      /**
 * 「node」を変換し、変換後の要素を返すコールバックです。
       * @param node nodeとして渡される、このコールバックの入力値です。
       * @returns 入力要素から生成した変換後の値を返します。
       */
      (node) => ({
        connected: node.isConnected,
        status: node.getAttribute('data-mermaid-status'),
        top: node.getBoundingClientRect().top,
        source: decodeURIComponent(node.getAttribute('data-mermaid-source') ?? '').slice(0, 80)
      })),
      requestCount: window.__mveMessages.filter(
      /**
 * 「message」が条件に一致するか判定し、残す要素を決めるコールバックです。
       * @param message 処理対象のメッセージです。
       * @returns 要素を採用するかどうかの真偽値を返します。
       */
      (message) => message.type === 'renderMermaid').length,
      lastMessages: window.__mveMessages.slice(-5).map(
      /**
 * 「message」を変換し、変換後の要素を返すコールバックです。
       * @param message 処理対象のメッセージです。
       * @returns 入力要素から生成した変換後の値を返します。
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
 * 処理結果を生成する処理を実行するコールバックです。
   * @returns Webviewの状態から取得した値を返します。
   */
  () => {
    const startedAt = performance.now();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    return performance.now() - startedAt;
  });
  await page.waitForTimeout(2_500);
  const responsiveness = await page.evaluate(
  /**
 * WebviewのDOMまたは状態を読み取り、検証側へ値を返すコールバックです。
   * @returns Webviewの状態から取得した値を返します。
   */
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
 * 「entry」が条件に一致するか判定し、残す要素を決めるコールバックです。
         * @param entry entryとして渡される、このコールバックの入力値です。
         * @returns 要素を採用するかどうかの真偽値を返します。
         */
        (entry) => entry.name.startsWith('mve-preview-'))
        .slice(-12)
        .map(
        /**
 * 「entry」を変換し、変換後の要素を返すコールバックです。
         * @param entry entryとして渡される、このコールバックの入力値です。
         * @returns 入力要素から生成した変換後の値を返します。
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
 * ブラウザーのDOM状態が期待条件を満たすか確認する述語コールバックです。
     * @returns 期待条件の真偽値または条件に一致した要素を返します。
     */
    () => document.querySelectorAll('.split-preview .mermaid-svg-image').length >= 1, undefined, { timeout: 15_000 });
  } catch (error) {
    const mermaidFailure = await page.evaluate(
    /**
     * Promiseの失敗理由を受け取り、エラー表示またはフォールバックを実行するコールバックです。
     * @returns エラー処理またはフォールバックの結果を返します。
     */
    () => ({
      requests: window.__mveMessages.filter(
      /**
 * 「message」が条件に一致するか判定し、残す要素を決めるコールバックです。
       * @param message 処理対象のメッセージです。
       * @returns 要素を採用するかどうかの真偽値を返します。
       */
      (message) => message.type === 'renderMermaid'),
      cancellations: window.__mveMessages.filter(
      /**
 * 「message」が条件に一致するか判定し、残す要素を決めるコールバックです。
       * @param message 処理対象のメッセージです。
       * @returns 要素を採用するかどうかの真偽値を返します。
       */
      (message) => message.type === 'cancelMermaidRender'),
      previewLength: document.querySelector('.split-preview .rendered-markdown')?.getAttribute('data-document-length'),
      nodes: [...document.querySelectorAll('.split-preview .mermaid')].map(
      /**
 * 「node」を変換し、変換後の要素を返すコールバックです。
       * @param node nodeとして渡される、このコールバックの入力値です。
       * @returns 入力要素から生成した変換後の値を返します。
       */
      (node) => ({
        status: node.getAttribute('data-mermaid-status'),
        children: [...node.children].map(
        /**
 * 「child」を変換し、変換後の要素を返すコールバックです。
         * @param child childとして渡される、このコールバックの入力値です。
         * @returns 入力要素から生成した変換後の値を返します。
         */
        (child) => child.className || child.tagName),
        text: node.textContent?.slice(0, 120)
      }))
    }));
    throw new Error(`sample/11 initial Mermaid rendering did not complete: ${JSON.stringify(mermaidFailure)}`, { cause: error });
  }
  await page.waitForFunction(
  /**
 * ブラウザーのDOM状態が期待条件を満たすか確認する述語コールバックです。
   * @returns 期待条件の真偽値または条件に一致した要素を返します。
   */
  () => document.querySelector(
    '.split-preview .mermaid-svg-frame[data-mve-rasterized="true"]'
  ), undefined, { timeout: 15_000 });
  await page.locator('.split-preview .mermaid-svg-frame[data-mve-rasterized="true"]').first().scrollIntoViewIfNeeded();
  await page.waitForFunction(
  /**
 * 登録された処理が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
   * @returns 期待条件の真偽値または条件に一致した要素を返します。
   */
  () => document.querySelectorAll('.split-preview .mermaid-interaction-text').length >= 1, undefined, { timeout: 15_000 });
  await page.waitForFunction(
  /**
 * 登録された処理が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
   * @returns 期待条件の真偽値または条件に一致した要素を返します。
   */
  () => {
    const diagrams = [...document.querySelectorAll('.split-preview .mermaid')];
    return diagrams.some(
    /**
 * 「node」が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
     * @param node nodeとして渡される、このコールバックの入力値です。
     * @returns 条件判定の結果を示す真偽値を返します。
     */
    (node) => ['ready', 'error'].includes(node.getAttribute('data-mermaid-status')))
      && !diagrams.some(
      /**
 * 「node」が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
       * @param node nodeとして渡される、このコールバックの入力値です。
       * @returns 条件判定の結果を示す真偽値を返します。
       */
      (node) => node.getAttribute('data-mermaid-status') === 'rendering');
  }, undefined, { timeout: 30_000 });
  const sustainedStart = await page.evaluate(
  /**
 * 登録された処理が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
   * @returns 「performance.now」を実行し、値を返しません。
   */
  () => {
    window.__mveMaximumOutstandingOperations = window.__mveOutstandingOperations;
    window.__mveAckDelay = 2_000;
    window.__mveSustainedResponsiveness = { previous: performance.now(), maximumGap: 0, ticks: 0 };
    window.__mveSustainedLongTasks = [];
    window.__mveSustainedLongTaskObserver = new PerformanceObserver(
    /**
 * 「list」を受け取り、処理結果を生成する処理です。
     * @param list 処理対象となる複数要素の集合です。
     * @returns 「list」から生成した処理結果を返します。
     */
    (list) => {
      window.__mveSustainedLongTasks.push(...list.getEntries().map(
      /**
 * 「entry」を変換し、変換後の要素を返すコールバックです。
       * @param entry entryとして渡される、このコールバックの入力値です。
       * @returns 入力要素から生成した変換後の値を返します。
       */
      (entry) => ({
        startTime: entry.startTime,
        duration: entry.duration
      })));
    });
    window.__mveSustainedLongTaskObserver.observe({ type: 'longtask', buffered: false });
    window.__mveSustainedTimer = setInterval(
    /**
 * 一定間隔で状態を監視または更新するコールバックです。
     * @returns DOM検索で得た要素または状態を返します。
     */
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
 * 「message」が条件に一致するか判定し、残す要素を決めるコールバックです。
       * @param message 処理対象のメッセージです。
       * @returns 要素を採用するかどうかの真偽値を返します。
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
     * 累積値と入力を「total」「duration」を受け取り、集約結果を更新するコールバックです。
     * @param total totalとして渡される、このコールバックの入力値です。
     * @param duration 表示領域のサイズまたは倍率で、画面レイアウト計算に使用します。
     * @returns 更新後の累積値を返します。
     */
    (total, duration) => total + duration, 0) / durations.length);
    // 220ms settled + 120ms preview予約を越え、Worker開始直後に次の入力波を重ねる。
    await page.waitForTimeout(370);
  }
  const sustainedBlurDuration = await page.evaluate(
  /**
 * 累積値と登録された処理から更新後の累積値を計算するコールバックです。
   * @returns DOM検索で得た要素または状態を返します。
   */
  () => {
    const startedAt = performance.now();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    return performance.now() - startedAt;
  });
  await page.waitForFunction(
  /**
 * ブラウザーのDOM状態が期待条件を満たすか確認する述語コールバックです。
   * @param expectedLength expectedLengthとして渡される、このコールバックの入力値です。
   * @returns 「expectedLength」から生成した処理結果を返します。
   */
  (expectedLength) => (
    Number(document.querySelector('.split-preview .rendered-markdown')?.getAttribute('data-document-length')) === expectedLength
  ), sustainedStart.hostLength + typedText.length, { timeout: 30_000 });
  try {
    await page.waitForFunction(
    /**
 * 登録された処理が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
     * @returns 期待条件の真偽値または条件に一致した要素を返します。
     */
    () => {
      const diagrams = [...document.querySelectorAll('.split-preview .mermaid')];
      return diagrams.some(
      /**
 * 「node」が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
       * @param node nodeとして渡される、このコールバックの入力値です。
       * @returns 条件判定の結果を示す真偽値を返します。
       */
      (node) => ['ready', 'error'].includes(node.getAttribute('data-mermaid-status')))
        && !diagrams.some(
        /**
 * 「node」が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
         * @param node nodeとして渡される、このコールバックの入力値です。
         * @returns 条件判定の結果を示す真偽値を返します。
         */
        (node) => node.getAttribute('data-mermaid-status') === 'rendering');
    }, undefined, { timeout: 30_000 });
  } catch (error) {
    const state = await page.evaluate(
    /**
     * Promiseの失敗理由を受け取り、エラー表示またはフォールバックを実行するコールバックです。
     * @returns エラー処理またはフォールバックの結果を返します。
     */
    () => ({
      workerStatus: document.body.dataset.mveMarkdownWorkerStatus,
      diagrams: [...document.querySelectorAll('.split-preview .mermaid')].map(
      /**
 * 「node」を変換し、変換後の要素を返すコールバックです。
       * @param node nodeとして渡される、このコールバックの入力値です。
       * @returns 入力要素から生成した変換後の値を返します。
       */
      (node) => ({
        status: node.getAttribute('data-mermaid-status'),
        source: decodeURIComponent(node.getAttribute('data-mermaid-source') ?? '').slice(0, 80)
      })),
      outstandingOperations: window.__mveOutstandingOperations,
      recentMessages: window.__mveMessages.slice(-10).map(
      /**
 * 「message」を変換し、変換後の要素を返すコールバックです。
       * @param message 処理対象のメッセージです。
       * @returns 入力要素から生成した変換後の値を返します。
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
 * WebviewのDOMまたは状態を読み取り、検証側へ値を返すコールバックです。
   * @param start startとして渡される、このコールバックの入力値です。
   * @returns 「start」が開始した処理の結果または非同期Promiseを返します。
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
 * 「message」が条件に一致するか判定し、残す要素を決めるコールバックです。
       * @param message 処理対象のメッセージです。
       * @returns 要素を採用するかどうかの真偽値を返します。
       */
      (message) => message.type === 'localChanges').length,
      maximumOutstandingOperations: window.__mveMaximumOutstandingOperations,
      hostLength: window.__mveHostText.length,
      mermaidRequests: window.__mveMessages.filter(
      /**
 * 「message」が条件に一致するか判定し、残す要素を決めるコールバックです。
       * @param message 処理対象のメッセージです。
       * @returns 要素を採用するかどうかの真偽値を返します。
       */
      (message) => message.type === 'renderMermaid').length - start.mermaidRequests,
      mermaidNodes: document.querySelectorAll('.split-preview .mermaid').length,
      mermaidImages: document.querySelectorAll('.split-preview .mermaid-svg-image').length,
      previewPerformanceEntries: performance.getEntriesByType('mark')
        .filter(
        /**
 * 「entry」が条件に一致するか判定し、残す要素を決めるコールバックです。
         * @param entry entryとして渡される、このコールバックの入力値です。
         * @returns 要素を採用するかどうかの真偽値を返します。
         */
        (entry) => entry.name.startsWith('mve-preview-')).length
        + performance.getEntriesByType('measure')
          .filter(
          /**
 * 「entry」が条件に一致するか判定し、残す要素を決めるコールバックです。
           * @param entry entryとして渡される、このコールバックの入力値です。
           * @returns 要素を採用するかどうかの真偽値を返します。
           */
          (entry) => entry.name.startsWith('mve-preview-') || entry.name.startsWith('mve-source-')).length,
      mermaidStates: [...document.querySelectorAll('.split-preview .mermaid')].map(
      /**
 * 「node」を変換し、変換後の要素を返すコールバックです。
       * @param node nodeとして渡される、このコールバックの入力値です。
       * @returns 入力要素から生成した変換後の値を返します。
       */
      (node) => ({
        status: node.getAttribute('data-mermaid-status'),
        children: [...node.children].map(
        /**
 * 「child」を変換し、変換後の要素を返すコールバックです。
         * @param child childとして渡される、このコールバックの入力値です。
         * @returns 入力要素から生成した変換後の値を返します。
         */
        (child) => child.className || child.tagName),
        text: node.textContent?.slice(0, 120)
      }))
    };
  }, sustainedStart);
  try {
    await page.waitForFunction(
    /**
 * ブラウザーのDOM状態が期待条件を満たすか確認する述語コールバックです。
     * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはprefix、lengthです。
     * @returns 「prefix」「length」から生成した処理結果を返します。
     */
    ({ prefix, length }) => (
      window.__mveHostText.length === length && window.__mveHostText.startsWith(prefix)
    ), { prefix: typedText, length: sustainedStart.hostLength + typedText.length }, { timeout: 10_000 });
  } catch (error) {
    const convergence = await page.evaluate(
    /**
 * WebviewのDOMまたは状態を読み取り、検証側へ値を返すコールバックです。
     * @param prefix prefixとして渡される、このコールバックの入力値です。
     * @returns エラー処理またはフォールバックの結果を返します。
     */
    (prefix) => ({
      hostLength: window.__mveHostText.length,
      expectedPrefix: prefix.slice(0, 80),
      actualPrefix: window.__mveHostText.slice(0, 80),
      resyncRequests: window.__mveMessages.filter(
      /**
 * 「message」が条件に一致するか判定し、残す要素を決めるコールバックです。
       * @param message 処理対象のメッセージです。
       * @returns 要素を採用するかどうかの真偽値を返します。
       */
      (message) => message.type === 'requestResync'),
      localOperations: window.__mveMessages.filter(
      /**
 * 「message」が条件に一致するか判定し、残す要素を決めるコールバックです。
       * @param message 処理対象のメッセージです。
       * @returns 要素を採用するかどうかの真偽値を返します。
       */
      (message) => message.type === 'localChanges').map(
      /**
 * 「message」を変換し、変換後の要素を返すコールバックです。
       * @param message 処理対象のメッセージです。
       * @returns 入力要素から生成した変換後の値を返します。
       */
      (message) => ({
        clientId: message.clientId,
        opId: message.opId,
        baseVersion: message.baseVersion,
        changes: message.changes.map(
        /**
 * 「change」を変換し、変換後の要素を返すコールバックです。
         * @param change changeとして渡される、このコールバックの入力値です。
         * @returns 入力要素から生成した変換後の値を返します。
         */
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
 * ブラウザーのDOM状態が期待条件を満たすか確認する述語コールバックです。
   * @returns 期待条件の真偽値または条件に一致した要素を返します。
   */
  () => window.__mveOutstandingOperations === 0, undefined, { timeout: 10_000 });
  const workerStatus = await page.evaluate(
  /**
 * 累積値と登録された処理から更新後の累積値を計算するコールバックです。
   * @returns Webviewの状態から取得した値を返します。
   */
  () => document.body.dataset.mveMarkdownWorkerStatus);
  if (workerStatus !== 'ready') throw new Error(`Markdown Worker did not remain active: ${workerStatus}`);
  const firstWaveAverage = waveAverages.slice(0, 4).reduce(
  /**
   * 累積値と入力を「total」「value」を受け取り、集約結果を更新するコールバックです。
   * @param total totalとして渡される、このコールバックの入力値です。
   * @param value 「total」で検証・変換する入力値です。
   * @returns 更新後の累積値を返します。
   */
  (total, value) => total + value, 0) / 4;
  const lastWaveAverage = waveAverages.slice(-4).reduce(
  /**
   * 累積値と入力を「total」「value」を受け取り、集約結果を更新するコールバックです。
   * @param total totalとして渡される、このコールバックの入力値です。
   * @param value 「total」で検証・変換する入力値です。
   * @returns 更新後の累積値を返します。
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
   * 「async」として関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @returns 「document.querySelector」を実行し、値を返しません。
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
 * 「list」を受け取り、登録された副作用または結果を生成する処理です。
     * @param list 処理対象となる複数要素の集合です。
     * @returns 「longTasks.push」を実行し、値を返しません。
     */
    (list) => {
      longTasks.push(...list.getEntries().map(
      /**
 * 「entry」を変換し、変換後の要素を返すコールバックです。
       * @param entry entryとして渡される、このコールバックの入力値です。
       * @returns 入力要素から生成した変換後の値を返します。
       */
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
       * 予約されたタイミングで「resolve」を受け取り、遅延処理を実行するコールバックです。
       * @param resolve Promiseの完了または失敗を通知する関数です。
       * @returns Promiseの完了または失敗を通知し、値を返しません。
       */
      (resolve) => requestAnimationFrame(
      /**
       * 予約されたタイミングで「now」を受け取り、遅延処理を実行するコールバックです。
       * @param now nowとして渡される、このコールバックの入力値です。
       * @returns 「frameIntervals.push」を実行し、値を返しません。
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
 * 「message」が条件に一致するか判定し、残す要素を決めるコールバックです。
         * @param message 処理対象のメッセージです。
         * @returns 要素を採用するかどうかの真偽値を返します。
         */
        (message) => message.type === 'renderMermaid').length
      });
    }
    longTaskObserver.disconnect();
    const sortedFrames = [...frameIntervals].sort(
    /**
 * 「left」「right」を比較し、並び順を示す数値を返すコールバックです。
     * @param left 比較対象の左側の値です。
     * @param right 比較対象の右側の値です。
     * @returns 比較対象の順序を示す負数、0、または正数を返します。
     */
    (left, right) => left - right);
    const maximumHandlerDuration = Math.max(0, ...samples.map(
    /**
 * 「sample」を変換し、変換後の要素を返すコールバックです。
     * @param sample sampleとして渡される、このコールバックの入力値です。
     * @returns 入力要素から生成した変換後の値を返します。
     */
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
 * 「left」「right」を比較し、並び順を示す数値を返すコールバックです。
         * @param left 比較対象の左側の値です。
         * @param right 比較対象の右側の値です。
         * @returns 比較対象の順序を示す負数、0、または正数を返します。
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
 * WebviewのDOMまたは状態を読み取り、検証側へ値を返すコールバックです。
   * @returns 「performance.now」を実行し、値を返しません。
   */
  () => {
    window.__mveSelectionResponsiveness = { previous: performance.now(), maximumGap: 0, ticks: 0 };
    window.__mveSelectionTimer = setInterval(
    /**
 * 処理結果を生成する処理を実行するコールバックです。
     * @returns DOM検索で得た要素または状態を返します。
     */
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
 * 検証対象のJSONペイロードを生成する処理を実行するコールバックです。
   * @returns DOM検索で得た要素または状態を返します。
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
  /**
 * 「value」を変換し、変換後の要素を返すコールバックです。
   * @param value 「value」で検証・変換する入力値です。
   * @returns 入力要素から生成した変換後の値を返します。
   */
  (value) => value.toFixed(1)).join('/')}ms; first4=${firstWaveAverage.toFixed(1)}ms; last4=${lastWaveAverage.toFixed(1)}ms; worst=${worstInput.toFixed(1)}ms; loop-gap=${sustained.responsiveness.maximumGap.toFixed(1)}ms; blur=${sustainedBlurDuration.toFixed(1)}ms; scroll-handler-max=${scrollPerformance.maximumHandlerDuration.toFixed(1)}ms; scroll-frame-p95=${scrollPerformance.p95FrameInterval.toFixed(1)}ms; scroll-frame-p99=${scrollPerformance.p99FrameInterval.toFixed(1)}ms; selection-gap=${selectionPerformance.maximumGap.toFixed(1)}ms; operations=${sustained.localOperations}; perf-entries=${sustained.previewPerformanceEntries}; Mermaid requests=${sustained.mermaidRequests}`);
  closingContext = true;
  await context.close();
  console.log(`サンプル01〜07、09、11を確認しました。巨大Mermaid描画中の最大UI停止=${responsiveness.maximumGap.toFixed(1)}ms、Worker=${responsiveness.markdownWorker.toFixed(1)}ms、UIサニタイズ=${responsiveness.markdownRender.toFixed(1)}ms、DOM差分=${responsiveness.domReconcile.toFixed(1)}ms、Mermaid適用=${responsiveness.mermaidApply.toFixed(1)}ms、最遅ブロック=${JSON.stringify(responsiveness.slowestSanitizeBlock)}、LongTasks=${JSON.stringify(responsiveness.longTasks)}、Marks=${JSON.stringify(responsiveness.timingMarks)}。`);
} finally {
  await Promise.all([browser.close(), rendererBrowser.close()]);
}

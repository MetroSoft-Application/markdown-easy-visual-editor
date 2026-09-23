/**
 * @file lazy-runtime-smoke.mjs
 * 実行境界: 開発・検証スクリプト。
 * 責務: ビルド、スモーク、統合検証または補助生成を実行する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: プロセス、生成物、Webview、VS Code、Chromiumなどの外部環境を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/** 「executablePath」は、対象ファイルまたは実行環境の場所を表す値です。 */
const executablePath = await findFile(path.resolve('.chromium'), 'chrome-headless-shell.exe');
if (!executablePath) throw new Error('Chromium がありません。npm run pdf:install-browser を実行してください。');

/** 「allowedAssets」は、関連する処理間で共有する設定値または状態です。 */
const allowedAssets = new Set([
  'export-fonts.css',
  'markdown-fallback.js',
  'markdown-worker.js',
  'markdown-rich-worker.js',
  'mermaid.min.js',
  'styles.css',
  'webview.css',
  'webview.js'
]);
/** 「server」は、関連する処理間で共有する設定値または状態です。 */
const server = createServer(
/**
 * 「async」として「request」「response」を受け取り、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param request 処理対象の要求です。
 * @param response 「response」は、「async」が検証シナリオの処理対象を特定する入力です。
 * @returns 「URL」を実行し、値を返しません。
 */
async (request, response) => {
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
await new Promise(
/**
 * 非同期処理の失敗理由を受け取り、回復処理または代替値を生成するコールバックです。
 * @param resolve Promiseの完了または失敗を通知する関数です。
 * @param reject Promiseの完了または失敗を通知する関数です。
 * @returns エラー処理またはフォールバックの結果を返します。
 */
(resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
/** 「address」は、関連する処理間で共有する設定値または状態です。 */
const address = server.address();
if (!address || typeof address === 'string') throw new Error('テスト HTTP サーバーを開始できませんでした。');
/** 「origin」は、関連する処理間で共有する設定値または状態です。 */
const origin = `http://127.0.0.1:${address.port}`;

/** 「browser」は、ブラウザー処理の共有状態または実行設定です。 */
const browser = await chromium.launch({ executablePath, headless: true });
try {
  await verifyMarkdownFallback();
  await verifyRichMarkdownFallback();
  await verifyInlineMermaidFallback();
  await verifyCompactMermaidAvoidsHostStartup();
  await verifyLargeMermaidKeepsHostIsolation();
  await verifyLazyExportFonts();
  console.log('遅延ランタイム: Markdown Worker 障害時フォールバック、Mermaid Host 障害時フォールバック、出力フォントを確認しました。');
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

/**
 * verify・compact・mermaid・avoids・host・startupを検証します。
 * @returns 「verifyCompactMermaidAvoidsHostStartup」が検証シナリオの入力を処理して得た固有の結果を返します。
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
 * ブラウザーのDOM状態が期待条件を満たすか確認する述語コールバックです。
     * @returns 期待条件の真偽値または条件に一致した要素を返します。
     */
    () => (
      document.querySelectorAll('.split-preview .mermaid[data-mermaid-status="ready"] svg').length === 2
    ), undefined, { timeout: 20_000 });
    const state = await page.evaluate(
    /**
 * WebviewのDOMまたは状態を読み取り、検証側へ値を返すコールバックです。
     * @returns DOM検索で得た要素または状態を返します。
     */
    () => {
      const diagrams = [...document.querySelectorAll('.split-preview .mermaid svg')];
      const ids = diagrams.flatMap(
      /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
       * @param svg svgとして渡される、このコールバックの入力値です。
       * @returns 「svg」から生成した処理結果を返します。
       */
      (svg) => [...svg.querySelectorAll('[id]')].map(
      /**
 * 「element」を変換し、変換後の要素を返すコールバックです。
       * @param element 処理対象の要素です。
       * @returns 入力要素から生成した変換後の値を返します。
       */
      (element) => element.id));
      return {
        hostRequests: window.__mveMessages.filter(
        /**
 * 「message」が条件に一致するか判定し、残す要素を決めるコールバックです。
         * @param message 処理対象のメッセージです。
         * @returns 条件判定の結果を示す真偽値を返します。
         */
        (message) => message.type === 'renderMermaid').length,
        duplicateIds: ids.filter(
        /**
 * 「id」「index」が条件に一致するか判定し、残す要素を決めるコールバックです。
         * @param id idとして渡される、このコールバックの入力値です。
         * @param index 本文、表、配列内の対象位置を示すインデックスです。
         * @returns 要素を採用するかどうかの真偽値を返します。
         */
        (id, index) => ids.indexOf(id) !== index),
        text: diagrams.map(
        /**
 * 「svg」を変換し、変換後の要素を返すコールバックです。
         * @param svg svgとして渡される、このコールバックの入力値です。
         * @returns 入力要素から生成した変換後の値を返します。
         */
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
 * 「text」が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
     * @param text 処理対象の本文です。
     * @returns 条件判定の結果を示す真偽値を返します。
     */
    (text) => !text.includes('Start') || !text.includes('Ready'))) {
      throw new Error(`小型 Mermaid のラベルが欠落しました: ${JSON.stringify(state.text)}`);
    }
  } finally {
    await page.close();
  }
}

/**
 * verify・large・mermaid・keeps・host・isolationを検証します。
 * @returns 「verifyLargeMermaidKeepsHostIsolation」が検証シナリオの入力を処理して得た固有の結果を返します。
 */
async function verifyLargeMermaidKeepsHostIsolation() {
  const edges = Array.from({ length: 240 },
  /**
 * 「_」「index」から配列要素を生成するコールバックです。
   * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
   * @param index 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 「_」「index」から生成した処理結果を返します。
   */
  (_, index) => `  N${index} --> N${index + 1}`);
  const markdown = `\`\`\`mermaid\nflowchart TD\n${edges.join("\n")}\n\`\`\`\n`;
  const page = await openEditor(markdown, {
    workerUri: `${origin}/dist/markdown-worker.js`,
    mermaidHostRendering: true
  });
  try {
    await page.waitForFunction(
    /**
 * 登録された処理が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
     * @returns 期待条件の真偽値または条件に一致した要素を返します。
     */
    () => (
      window.__mveMessages.some(
      /**
 * 「message」が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
       * @param message 処理対象のメッセージです。
       * @returns 条件判定の結果を示す真偽値を返します。
       */
      (message) => message.type === 'renderMermaid')
    ), undefined, { timeout: 20_000 });
  } finally {
    await page.close();
  }
}

/**
 * verify・markdown・fallbackを検証します。
 * @returns 「verifyMarkdownFallback」が生成または整形した検証シナリオの文字列を返します。
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
 * 非同期処理の失敗理由を受け取り、回復処理または代替値を生成するコールバックです。
       * @returns 期待条件の真偽値または条件に一致した要素を返します。
       */
      () => (
        document.body.dataset.mveMarkdownWorkerStatus === 'fallback'
        && document.querySelector('.split-preview p strong')?.textContent === 'worker failure recovery'
      ), undefined, { timeout: 15_000 });
    } catch (error) {
      const state = await page.evaluate(
      /**
       * Promiseの失敗理由を受け取り、エラー表示またはフォールバックを実行するコールバックです。
       * @returns エラー処理またはフォールバックの結果を返します。
       */
      () => ({
        workerStatus: document.body.dataset.mveMarkdownWorkerStatus,
        html: document.querySelector('.split-preview')?.innerHTML.slice(0, 2_000)
      }));
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(state)}`);
    }
    const unsafe = await page.evaluate(
    /**
 * 非同期処理の失敗理由を受け取り、回復処理または代替値を生成するコールバックです。
     * @returns 初期化したオブジェクト（hasToc、hasKatex、scriptCount、eventHandlerCount、executed）を返します。
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
 * verify・rich・markdown・fallbackを検証します。
 * @returns 「verifyRichMarkdownFallback」が生成または整形した検証シナリオの文字列を返します。
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
 * ブラウザーのDOM状態が期待条件を満たすか確認する述語コールバックです。
     * @returns 期待条件の真偽値または条件に一致した要素を返します。
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
 * verify・inline・mermaid・fallbackを検証します。
 * @returns 「verifyInlineMermaidFallback」が検証シナリオの入力を処理して得た固有の結果を返します。
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
 * 非同期処理の失敗理由を受け取り、回復処理または代替値を生成するコールバックです。
       * @returns 期待条件の真偽値または条件に一致した要素を返します。
       */
      () => (
        document.querySelector('.split-preview .mermaid[data-mermaid-status="ready"] svg') !== null
      ), undefined, { timeout: 20_000 });
    } catch (error) {
      const state = await page.evaluate(
      /**
       * Promiseの失敗理由を受け取り、エラー表示またはフォールバックを実行するコールバックです。
       * @returns エラー処理またはフォールバックの結果を返します。
       */
      () => ({
        workerStatus: document.body.dataset.mveMarkdownWorkerStatus,
        mermaidLoaded: Boolean(window.mermaid),
        mermaidType: typeof window.mermaid,
        mermaidConstructor: window.mermaid?.constructor?.name,
        mermaidValue: String(window.mermaid).slice(0, 200),
        mermaidKeys: window.mermaid ? Object.keys(window.mermaid).slice(0, 20) : [],
        diagrams: [...document.querySelectorAll('.mermaid')].map(
        /**
 * 「node」を変換し、変換後の要素を返すコールバックです。
         * @param node nodeとして渡される、このコールバックの入力値です。
         * @returns 入力要素から生成した変換後の値を返します。
         */
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
 * verify・lazy・export・fontsを検証します。
 * @returns 「verifyLazyExportFonts」が検証シナリオの入力を処理して得た固有の結果を返します。
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
 * 「length」を受け取り、Webviewへメッセージイベントを発火する処理です。
     * @param length lengthとして渡される、このコールバックの入力値です。
     * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
     */
    (length) => (
      Number(document.querySelector('.split-preview .rendered-markdown')?.getAttribute('data-document-length')) === length
    ), markdown.length);
    await page.evaluate(
    /**
 * 登録された処理が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
     * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
     */
    () => window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'hostCommand', command: 'exportHtml' }
    })));
    await page.waitForFunction(
    /**
 * ブラウザーのDOM状態が期待条件を満たすか確認する述語コールバックです。
     * @returns 期待条件の真偽値または条件に一致した要素を返します。
     */
    () => window.__mveMessages.some(
    /**
 * 「message」が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
     * @param message 処理対象のメッセージです。
     * @returns 条件判定の結果を示す真偽値を返します。
     */
    (message) => message.type === 'exportHtml'), undefined, {
      timeout: 20_000
    });
    const css = await page.evaluate(
    /**
 * WebviewのDOMまたは状態を読み取り、検証側へ値を返すコールバックです。
     * @returns Webviewの状態から取得した値を返します。
     */
    () => window.__mveMessages.find(
    /**
 * 「message」が検索条件に一致するか判定するコールバックです。
     * @param message 処理対象のメッセージです。
     * @returns 条件に一致した要素、または該当しない場合はundefinedを返します。
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
 * エディターを開始します。
 * @param markdown 解析・編集・変換の対象となる本文または生成済み内容です。
 * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはworkerUri、richWorkerUriです。
 * @returns 「openEditor」が検証シナリオの入力を処理して得た固有の結果を返します。
 */
async function openEditor(markdown, {
  workerUri,
  richWorkerUri = `${origin}/dist/markdown-rich-worker.js`,
  mermaidHostRendering
}) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror',
  /**
 * 「error」を受け取り、登録された副作用または結果を生成する処理です。
   * @param error 発生したエラーです。
   * @returns 「error」から生成した処理結果を返します。
   */
  (error) => errors.push(error.message));
  await page.goto(origin);
  await page.evaluate(
  /**
 * WebviewのDOMまたは状態を読み取り、検証側へ値を返すコールバックです。
   * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはmarkdown、mermaidHostRendering、workerUri、richWorkerUri、originです。
   * @returns 「postMessage」を実行し、値を返しません。
   */
  ({ markdown, mermaidHostRendering, workerUri, richWorkerUri, origin }) => {
    document.body.dataset.mveMarkdownWorkerUri = workerUri;
    document.body.dataset.mveMarkdownRichWorkerUri = richWorkerUri;
    document.body.dataset.mveMarkdownFallbackUri = `${origin}/dist/markdown-fallback.js`;
    document.body.dataset.mveMermaidUri = `${origin}/dist/mermaid.min.js`;
    document.body.dataset.mveExportFontsUri = `${origin}/dist/export-fonts.css`;
    window.__mveMessages = [];
    window.acquireVsCodeApi =
    /**
 * 指定時間の経過後に遅延処理を実行するコールバックです。
     * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
     */
    () => ({
      /**
       * 「postMessage」は、言語や通信契約に応じた表示文言または対応表を保持します。
       * @param message 処理対象のメッセージです。
       * @returns メッセージをHostまたはWebviewへ送信し、値は返しません。
       */
      postMessage(message) {
        window.__mveMessages.push(message);
        if (message.type !== 'ready') return;
        setTimeout(
        /**
 * 指定時間の経過後に遅延処理を実行するコールバックです。
         * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
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
  }, { markdown, mermaidHostRendering, workerUri, richWorkerUri, origin });
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
 * ファイルを取得または解決します。
 * @param root 処理対象のルートです。
 * @param name 対象を識別する名前で、表示または処理分岐に使用します。
 * @returns 「findFile」が読み取りまたは正規化した結果を返します。
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

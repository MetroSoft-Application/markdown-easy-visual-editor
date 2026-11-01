/**
 * @fileoverview 本番と同じ「HTMLへ初期本文を埋め込む（bootstrap）」起動経路で、Webviewの初回プレビュー描画を検証するChromiumスモーク。
 * 対象環境: npm run build 済みの dist と、.chromium の chrome-headless-shell（npm run pdf:install-browser）。
 * 検証する仕様と回帰リスク:
 * - Reactのマウント前に始める先行描画（軽量／rich）が、Appの初回描画要求として二重送信されずに引き継がれること。
 * - コードハイライトが不要な文書では軽量Workerの結果を最終結果とし、その後rich Workerへ差し替えて、以降の編集を従来どおり1回の描画で処理すること。
 * - rich Workerを取得できない場合も、従来どおりフォールバック描画で表示が完了すること。
 * - テキスト表示やMarp候補など、初回描画の入力が確定しない条件では先行描画を始めないこと。
 * 失敗条件: いずれかの検証に失敗、ページ例外、待機タイムアウト（固定sleepは使わず状態を待つ）で例外を投げ、非0で終了する。
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { startWebviewAssetServer } from './webview-test-server.mjs';

/**
 * 既定のWebview設定。拡張機能の getSettings が返す主要項目と同じ形にする。
 */
const baseSettings = {
  language: 'ja',
  imageDirectory: 'assets',
  maxPasteSizeMb: 20,
  remoteImagesEnabled: false,
  mermaidTheme: 'default',
  mermaidFontSize: 16,
  mermaidHostRendering: true,
  editorTheme: 'dark',
  viewMode: 'both',
  scrollSyncEnabled: true,
  previewImageResizeControlsVisible: true,
  workspaceTrusted: true,
  startupProbe: true
};

/**
 * Chromium実行ファイルを再帰的に探す。
 * @param directory - 探索するフォルダー。
 * @param name - 実行ファイル名。
 * @returns 見つかったパス。無ければundefined。
 */
async function findFile(directory, name) {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true }).catch(() => []);
  const entry = entries.find((candidate) => candidate.isFile() && candidate.name === name);
  return entry ? path.join(entry.parentPath ?? entry.path, entry.name) : undefined;
}

const executablePath = await findFile(path.resolve('.chromium'), 'chrome-headless-shell.exe');
if (!executablePath) throw new Error('Chromium がありません。npm run pdf:install-browser を実行してください。');
const server = await startWebviewAssetServer();
const browser = await chromium.launch({ executablePath, headless: true });

try {
  await verifyPlainDocumentUsesLightResult();
  await verifyCodeDocumentAdoptsBothSpeculativeRenders();
  await verifyRichWorkerFailureFallsBack();
  await verifyTextModeSkipsSpeculation();
  await verifyMarpCandidateSkipsSpeculation();
  await verifyResentInitAppliesChangedSettings();
  console.log('bootstrap起動スモーク: 先行描画の引き継ぎ、rich描画の省略と差し替え、rich取得失敗時のフォールバック、先行描画の抑止条件、init再送時の設定反映を確認しました。');
} finally {
  await browser.close();
  await server.close();
}

/**
 * bootstrap付きHTMLでWebviewを開き、Worker・Hostメッセージを記録できる状態のページを返す。
 * @param options - 本文・文書URI・設定・復元状態・遮断するリソース。
 * @returns ページと、ページ例外の一覧。
 */
async function openWebview({ text, uri = 'file:///C:/sample/doc.md', settings = {}, restoredState, blockRichWorker = false }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  if (blockRichWorker) {
    await page.route('**/dist/markdown-rich-worker.js', (route) => route.fulfill({ status: 404, body: 'blocked' }));
  }
  const bootstrap = { text, version: 1, uri, settings: { ...baseSettings, ...settings } };
  await page.addInitScript(({ bootstrapData, restored }) => {
    window.__hostMessages = [];
    window.__workerLog = [];
    window.__blobSizes = new Map();
    const createObjectUrl = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = createObjectUrl(blob);
      if (blob instanceof Blob) window.__blobSizes.set(url, blob.size);
      return url;
    };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        this.__mveLogIndex = window.__workerLog.length;
        // rich Workerはhighlight.jsを含み、軽量Workerの2倍以上の大きさになる。
        const size = window.__blobSizes.get(String(url)) ?? 0;
        window.__workerLog.push({ kind: size > 1_000_000 ? 'rich' : 'light', posts: [], terminated: false });
      }
      postMessage(message, transfer) {
        window.__workerLog[this.__mveLogIndex].posts.push(message?.id);
        return super.postMessage(message, transfer);
      }
      terminate() {
        window.__workerLog[this.__mveLogIndex].terminated = true;
        return super.terminate();
      }
    };
    window.acquireVsCodeApi = () => ({
      postMessage(message) {
        window.__hostMessages.push(message);
        if (message.type === 'ready') {
          setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'init', text: bootstrapData.text, version: 1, uri: bootstrapData.uri, settings: bootstrapData.settings }
          })), 0);
        }
        if (message.type === 'detectMarpMarkdown') {
          setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'marpDetectionResult', requestId: message.requestId, isMarp: false }
          })), 0);
        }
      },
      getState: () => restored,
      setState: () => undefined
    });
  }, { bootstrapData: bootstrap, restored: restoredState });
  await page.goto(server.origin);
  const origin = server.origin;
  const serialized = JSON.stringify(bootstrap).replace(/</g, '\\u003c');
  await page.setContent(`<!doctype html><html lang="ja"><head><meta charset="utf-8">
    <link rel="stylesheet" href="${origin}/dist/styles.css"><link rel="stylesheet" href="${origin}/dist/webview.css">
    <script>globalThis.__mveBootstrap=${serialized};</script></head>
    <body data-mve-markdown-worker-uri="${origin}/dist/markdown-worker.js" data-mve-markdown-rich-worker-uri="${origin}/dist/markdown-rich-worker.js" data-mve-markdown-fallback-uri="${origin}/dist/markdown-fallback.js">
    <div id="root"></div><script src="${origin}/dist/webview.js"></script></body></html>`);
  return { page, errors, close: () => context.close() };
}

/**
 * Webviewが記録したWorkerの利用状況を取得する。
 * @param page - 対象ページ。
 * @returns Workerごとの種類・送信した要求ID・終了済みか。
 */
function workerLog(page) {
  return page.evaluate(() => window.__workerLog);
}

/**
 * 最終描画の反映通知（起動計測用 startupRichReady）を待つ。
 * @param page - 対象ページ。
 */
async function waitForFinalPreview(page) {
  await page.waitForFunction(() => window.__hostMessages.some((message) => message.type === 'startupRichReady'));
}

/**
 * 条件が成り立たなければ、状況を添えて失敗させる。
 * @param condition - 検証条件。
 * @param message - 失敗時の説明。
 * @param detail - 失敗時に添える状況。
 */
function assert(condition, message, detail) {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(detail)}`);
}

/**
 * コードを含まない文書: 先行した軽量描画が唯一の描画要求として引き継がれ、rich描画を待たずに最終結果になること。
 * その後rich Workerへ差し替わり、コードを追加する編集は簡易描画を挟まずrich Workerの1回の描画で反映されること。
 */
async function verifyPlainDocumentUsesLightResult() {
  const { page, errors, close } = await openWebview({ text: '# 見出し\n\n本文の段落です。\n' });
  try {
    await waitForFinalPreview(page);
    await page.locator('.split-preview h1', { hasText: '見出し' }).waitFor();
    const status = await page.evaluate(() => document.body.dataset.mveMarkdownWorkerStatus);
    assert(status === 'ready', '軽量描画の結果が最終状態になっていません', status);
    // 差し替え用のrich Workerが待機状態で用意されるまで待つ。
    await page.waitForFunction(() => window.__workerLog.some((entry) => entry.kind === 'rich'));
    await page.waitForFunction(() => window.__workerLog.filter((entry) => entry.kind === 'light').every((entry) => entry.terminated));
    let log = await workerLog(page);
    const light = log.filter((entry) => entry.kind === 'light');
    assert(light.length === 1 && light[0].posts.length === 1 && light[0].posts[0] === -1,
      '軽量Workerへの描画要求が先行描画の1回だけになっていません', log);
    const rich = log.filter((entry) => entry.kind === 'rich');
    assert(rich.length === 1 && rich[0].posts.length === 0, 'rich Workerが待機状態で差し替えられていません', log);

    await page.locator('.split-editor .cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n```js\nconst answer = 42;\n```\n');
    await page.locator('.split-preview code .hljs-keyword', { hasText: 'const' }).waitFor();
    log = await workerLog(page);
    assert(log.filter((entry) => entry.kind === 'light').length === 1, '編集で簡易描画用の軽量Workerが再生成されました', log);
    assert(log.filter((entry) => entry.kind === 'rich').length === 1, '編集でrich Workerが再生成されました', log);
    assert(errors.length === 0, 'ページ例外が発生しました', errors);
  } finally {
    await close();
  }
}

/**
 * コードを含む文書: 軽量描画とrich描画の両方が先行し、Appが追加の描画要求を送らずに両方の結果を引き継ぐこと。
 */
async function verifyCodeDocumentAdoptsBothSpeculativeRenders() {
  const { page, errors, close } = await openWebview({ text: '# コード\n\n```js\nconst answer = 42;\n```\n' });
  try {
    await waitForFinalPreview(page);
    await page.locator('.split-preview code .hljs-keyword', { hasText: 'const' }).waitFor();
    const log = await workerLog(page);
    const light = log.filter((entry) => entry.kind === 'light');
    const rich = log.filter((entry) => entry.kind === 'rich');
    assert(light.length === 1 && light[0].posts.join() === '-1', '軽量描画の先行要求が引き継がれていません', log);
    assert(rich.length === 1 && rich[0].posts.join() === '-1', 'rich描画の先行要求が引き継がれていません', log);
    const status = await page.evaluate(() => document.body.dataset.mveMarkdownWorkerStatus);
    assert(status === 'ready', 'rich描画の結果が最終状態になっていません', status);
    assert(errors.length === 0, 'ページ例外が発生しました', errors);
  } finally {
    await close();
  }
}

/**
 * rich Workerを取得できない場合: 先行描画に失敗しても、従来どおりフォールバック描画でハイライト付きの表示が完了すること。
 */
async function verifyRichWorkerFailureFallsBack() {
  const { page, close } = await openWebview({
    text: '# 失敗時\n\n```js\nconst answer = 42;\n```\n',
    blockRichWorker: true
  });
  try {
    await page.waitForFunction(() => document.body.dataset.mveMarkdownWorkerStatus === 'fallback');
    await page.locator('.split-preview code', { hasText: 'answer' }).waitFor();
    await waitForFinalPreview(page);
  } finally {
    await close();
  }
}

/**
 * テキストだけを表示する復元状態: プレビュー描画が要求されないため、先行描画も始めないこと。
 */
async function verifyTextModeSkipsSpeculation() {
  const { page, close } = await openWebview({ text: '# テキスト\n', restoredState: { viewMode: 'text' } });
  try {
    await page.waitForFunction(() => window.__hostMessages.some((message) => message.type === 'initialized'));
    await page.locator('.split-editor .cm-content').waitFor();
    const log = await workerLog(page);
    assert(log.every((entry) => !entry.posts.includes(-1)), 'テキスト表示で先行描画が始まりました', log);
  } finally {
    await close();
  }
}

/**
 * init の再送: 内容が同じ設定では表示が変わらず、内容が異なる設定（表示言語）は確実に反映されること。
 * 同じ内容の設定で前のstateを再利用する最適化が、設定変更の取りこぼしを起こさないことを確認する。
 */
async function verifyResentInitAppliesChangedSettings() {
  const text = '# 設定\n';
  const { page, errors, close } = await openWebview({ text });
  try {
    await waitForFinalPreview(page);
    assert(await page.evaluate(() => document.documentElement.lang) === 'ja', '初期の表示言語が反映されていません', null);
    const dispatchInit = (language) => page.evaluate(({ markdown, lang, settings }) => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'init', text: markdown, version: 1, uri: 'file:///C:/sample/doc.md', settings: { ...settings, language: lang } }
      }));
    }, { markdown: text, lang: language, settings: baseSettings });
    await dispatchInit('ja');
    await page.locator('.split-preview h1', { hasText: '設定' }).waitFor();
    assert(await page.evaluate(() => document.documentElement.lang) === 'ja', '同じ設定の再送で表示言語が変わりました', null);
    await dispatchInit('en');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    assert(errors.length === 0, 'ページ例外が発生しました', errors);
  } finally {
    await close();
  }
}

/**
 * Marp候補のfront matter: Host判定でプレビュー経路が変わるため、先行描画を始めないこと。
 */
async function verifyMarpCandidateSkipsSpeculation() {
  const { page, close } = await openWebview({ text: '---\nmarp: false\n---\n\n# Marp候補\n' });
  try {
    await page.waitForFunction(() => window.__hostMessages.some((message) => message.type === 'detectMarpMarkdown'));
    await waitForFinalPreview(page);
    const log = await workerLog(page);
    assert(log.every((entry) => !entry.posts.includes(-1)), 'Marp候補で先行描画が始まりました', log);
  } finally {
    await close();
  }
}

/**
 * @file outline-reorder-smoke.mjs
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

/**
 * 「stripInstructions」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param markdown 解析・編集・変換の対象となる本文または生成済み内容です。
 * @returns 「stripInstructions」が検証シナリオの入力を処理して得た固有の結果を返します。
 */
function stripInstructions(markdown) {
  return markdown.replace(/^<!--[\s\S]*?-->\s*/, '');
}

/**
 * move・heading・blockを移動または調整します。
 * @param markdown 解析・編集・変換の対象となる本文または生成済み内容です。
 * @param sourceHeading 「sourceHeading」は、「moveHeadingBlock」が検証シナリオの処理対象を特定する入力です。
 * @param targetHeading 「targetHeading」は、「moveHeadingBlock」が検証シナリオの処理対象を特定する入力です。
 * @param position 「position」は、「moveHeadingBlock」が検証シナリオの処理対象を特定する入力です。
 * @returns 「moveHeadingBlock」が検証シナリオの入力を処理して得た固有の結果を返します。
 */
function moveHeadingBlock(markdown, sourceHeading, targetHeading, position) {
  const lines = markdown.split('\n');
  const sourceStart = lines.indexOf(sourceHeading);
  if (sourceStart < 0) throw new Error(`Missing source heading: ${sourceHeading}`);
  const sourceLevel = sourceHeading.match(/^#+/)?.[0].length ?? 0;

  /**
   * 「sectionEnd」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param sourceLines 「sourceLines」は、「sectionEnd」が検証シナリオの処理対象を特定する入力です。
   * @param start 「start」は、「sectionEnd」が検証シナリオの処理対象を特定する入力です。
   * @param level 「level」は、「sectionEnd」が検証シナリオの処理対象を特定する入力です。
   * @returns 「sectionEnd」が検証シナリオの入力を処理して得た固有の結果を返します。
   */
  const sectionEnd = /**
 * 「sectionEnd」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param sourceLines 「sourceLines」は、「sectionEnd」が検証シナリオで処理する対象を特定する入力です。
 * @param start 「start」は、「sectionEnd」が検証シナリオで処理する対象を特定する入力です。
 * @param level 処理対象を特定する位置、範囲、または数量です。
 * @returns 「sectionEnd」が検証シナリオの入力を処理して得た固有の結果を返します。
 */ (sourceLines, start, level) => {
    for (let index = start + 1; index < sourceLines.length; index += 1) {
      const heading = /^(#+)\s+/.exec(sourceLines[index]);
      if (heading && heading[1].length <= level) return index;
    }
    return lines.length;
  };
  const sourceEnd = sectionEnd(lines, sourceStart, sourceLevel);
  const block = lines.slice(sourceStart, sourceEnd);
  const withoutSource = lines.slice(0, sourceStart).concat(lines.slice(sourceEnd));
  const targetStart = withoutSource.indexOf(targetHeading);
  if (targetStart < 0) throw new Error(`Missing target heading: ${targetHeading}`);
  const targetLevel = targetHeading.match(/^#+/)?.[0].length ?? 0;
  const insertion = position === 'before' ? targetStart : sectionEnd(withoutSource, targetStart, targetLevel);
  return withoutSource.slice(0, insertion).concat(block, withoutSource.slice(insertion)).join('\n');
}

/** 「executablePath」は、対象ファイルまたは実行環境の場所を表す値です。 */
const executablePath = await findFile(path.resolve('.chromium'), 'chrome-headless-shell.exe');
if (!executablePath) throw new Error('Chromium is not installed.');
/** 「webviewBundle」は、関連する処理間で共有する設定値または状態です。 */
const webviewBundle = await readFile(path.resolve('dist/webview.js'), 'utf8');
/** 「markdownWorkerBundle」は、関連する処理間で共有する設定値または状態です。 */
const markdownWorkerBundle = await readFile(path.resolve('dist/markdown-worker.js'), 'utf8');
/** 「markdownRichWorkerBundle」は、関連する処理間で共有する設定値または状態です。 */
const markdownRichWorkerBundle = await readFile(path.resolve('dist/markdown-rich-worker.js'), 'utf8');
/** 「fixture」は、関連する処理間で共有する設定値または状態です。 */
const fixture = (await readFile(path.resolve('test/fixtures/outline-reorder-undo.md'), 'utf8')).replace(/\r\n?/g, '\n');
/** 「initialText」は、関連する処理間で共有する設定値または状態です。 */
const initialText = stripInstructions(fixture);
/** 「initialLines」は、関連する処理間で共有する設定値または状態です。 */
const initialLines = initialText.split('\n');
/** 「topLevelHeadings」は、関連する処理間で共有する設定値または状態です。 */
const topLevelHeadings = initialLines.filter(
/**
 * 「line」が条件に一致するか判定し、残す要素を決めるコールバックです。
 * @param line lineとして渡される、このコールバックの入力値です。
 * @returns 要素を採用するかどうかの真偽値を返します。
 */
(line) => /^#\s+/.test(line));
/** 「childHeadings」は、関連する処理間で共有する設定値または状態です。 */
const childHeadings = initialLines.filter(
/**
 * 「line」が条件に一致するか判定し、残す要素を決めるコールバックです。
 * @param line lineとして渡される、このコールバックの入力値です。
 * @returns 要素を採用するかどうかの真偽値を返します。
 */
(line) => /^##\s+/.test(line));
/** 「grandchildHeading」は、関連する処理間で共有する設定値または状態です。 */
const grandchildHeading = initialLines.find(
/**
 * 「line」が検索条件に一致するか判定するコールバックです。
 * @param line lineとして渡される、このコールバックの入力値です。
 * @returns 要素を採用するかどうかの真偽値を返します。
 */
(line) => /^###\s+/.test(line));
/** 「parentMovedText」は、関連する処理間で共有する設定値または状態です。 */
const parentMovedText = moveHeadingBlock(initialText, topLevelHeadings[0], topLevelHeadings[1], 'after');
/** 「childMovedText」は、関連する処理間で共有する設定値または状態です。 */
const childMovedText = moveHeadingBlock(parentMovedText, childHeadings[0], childHeadings[1], 'after');
/** 「crossParentMovedText」は、関連する処理間で共有する設定値または状態です。 */
const crossParentMovedText = moveHeadingBlock(childMovedText, childHeadings[0], childHeadings[2], 'after');
/** 「emptyParentMovedText」は、関連する処理間で共有する設定値または状態です。 */
const emptyParentMovedText = [
  '# Parent B',
  '',
  'Parent B body.',
  '## Child B-1',
  '',
  'Child B-1 body.',
  '# Parent A',
  '',
  'Parent A body.',
  '## Child A-2',
  '',
  'Child A-2 body.',
  '# Parent C',
  '',
  'Parent C body.',
  '## Child C-1',
  '',
  'Child C-1 body.',
  '# Parent D',
  '',
  'Parent D body.',
  '## Child A-1',
  '',
  'Child A-1 body.',
  '### Grandchild A-1-a',
  '',
  'Grandchild A-1-a body.',
  ''
].join('\n');
/** 「initialOutline」は、関連する処理間で共有する設定値または状態です。 */
const initialOutline = [topLevelHeadings[0], childHeadings[0], grandchildHeading, childHeadings[1], topLevelHeadings[1], childHeadings[2], topLevelHeadings[2], childHeadings[3], topLevelHeadings[3]];
/** 「parentMovedOutline」は、関連する処理間で共有する設定値または状態です。 */
const parentMovedOutline = [topLevelHeadings[1], childHeadings[2], topLevelHeadings[0], childHeadings[0], grandchildHeading, childHeadings[1], topLevelHeadings[2], childHeadings[3], topLevelHeadings[3]];
/** 「childMovedOutline」は、関連する処理間で共有する設定値または状態です。 */
const childMovedOutline = [topLevelHeadings[1], childHeadings[2], topLevelHeadings[0], childHeadings[1], childHeadings[0], grandchildHeading, topLevelHeadings[2], childHeadings[3], topLevelHeadings[3]];
/** 「crossParentMovedOutline」は、関連する処理間で共有する設定値または状態です。 */
const crossParentMovedOutline = [topLevelHeadings[1], childHeadings[2], childHeadings[0], grandchildHeading, topLevelHeadings[0], childHeadings[1], topLevelHeadings[2], childHeadings[3], topLevelHeadings[3]];
/** 「emptyParentMovedOutline」は、関連する処理間で共有する設定値または状態です。 */
const emptyParentMovedOutline = [topLevelHeadings[1], childHeadings[2], topLevelHeadings[0], childHeadings[1], topLevelHeadings[2], childHeadings[3], topLevelHeadings[3], childHeadings[0], grandchildHeading];

/** 「browser」は、ブラウザー処理の共有状態または実行設定です。 */
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const context = await browser.newContext();
  await context.addInitScript(
  /**
 * ブラウザーのWebviewテストで使用するグローバル状態を初期化するコールバックです。
   * @returns 「window.__mveMessages.push」を実行し、値を返しません。
   */
  () => {
    window.__mveMessages = [];
    window.__mveHostVersion = 1;
    window.__mveHostText = '';
    window.__mveUndoStack = [];
    window.__mveRedoStack = [];
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
 * @param message 「message」は、「postMessage」が検証シナリオで処理する対象を特定する入力です。
 * @returns メッセージをHostまたはWebviewへ送信し、値は返しません。
 */ (message) => {
        window.__mveMessages.push(message);
        if (message.type === 'localChanges') {
          window.__mveUndoStack.push(window.__mveHostText);
          window.__mveRedoStack = [];
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
          () => window.dispatchEvent(new MessageEvent('message', {
            data: {
              type: 'editAck',
              clientId: message.clientId,
              opId: message.opId,
              baseVersion,
              version: window.__mveHostVersion,
              changes: message.changes
            }
          })), 0);
        }
        if (message.type === 'historyCommand') {
          const sourceStack = message.command === 'undo' ? window.__mveUndoStack : window.__mveRedoStack;
          const targetStack = message.command === 'undo' ? window.__mveRedoStack : window.__mveUndoStack;
          const nextText = sourceStack.pop();
          if (nextText === undefined) return;
          const previousText = window.__mveHostText;
          targetStack.push(previousText);
          const baseVersion = window.__mveHostVersion;
          window.__mveHostText = nextText;
          window.__mveHostVersion += 1;
          setTimeout(
          /**
 * 指定時間の経過後に遅延処理を実行するコールバックです。
           * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
           */
          () => window.dispatchEvent(new MessageEvent('message', {
            data: {
              type: 'externalChanges',
              baseVersion,
              version: window.__mveHostVersion,
              changes: [{ rangeOffset: 0, rangeLength: previousText.length, text: nextText }]
            }
          })), 0);
        }
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

  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  const errors = [];
  page.on('pageerror',
  /**
 * 「error」を受け取り、テスト用のWorkerまたはBlob URLを登録する処理です。
   * @param error 発生したエラーです。
   * @returns 「errors.push」を実行し、値を返しません。
   */
  (error) => errors.push(error.message));
  page.on('console',
  /**
 * 「message」を受け取り、テスト用のWorkerまたはBlob URLを登録する処理です。
   * @param message 処理対象のメッセージです。
   * @returns 「if」を実行し、値を返しません。
   */
  (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('about:blank');
  await page.setContent('<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>');
  await page.evaluate(
  /**
 * 「workerSource」「richWorkerSource」を受け取り、テスト用のWorkerまたはBlob URLを登録する処理です。
   * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはworkerSource、richWorkerSourceです。
   * @returns 「URL.createObjectURL」を実行し、値を返しません。
   */
  ({ workerSource, richWorkerSource }) => {
    document.body.dataset.mveMarkdownWorkerUri = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    document.body.dataset.mveMarkdownRichWorkerUri = URL.createObjectURL(new Blob([richWorkerSource], { type: 'text/javascript' }));
  }, { workerSource: markdownWorkerBundle, richWorkerSource: markdownRichWorkerBundle });
  await page.addStyleTag({ path: path.resolve('dist/styles.css') });
  await page.addStyleTag({ path: path.resolve('dist/webview.css') });
  await page.addScriptTag({ path: path.resolve('dist/webview.js') });
  await page.waitForFunction(
  /**
 * Webviewへメッセージイベントを発火する処理を実行するコールバックです。
   * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
   */
  () => window.__mveMessages.some(
  /**
 * 「message」が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
   * @param message 処理対象のメッセージです。
   * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
   */
  (message) => message.type === 'ready'));
  await page.evaluate(
  /**
 * 「text」を受け取り、Webviewへメッセージイベントを発火する処理です。
   * @param text 処理対象の本文です。
   * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
   */
  (text) => { window.__mveHostText = text; }, initialText);
  await page.evaluate(
  /**
 * 「text」を受け取り、Webviewへメッセージイベントを発火する処理です。
   * @param text 処理対象の本文です。
   * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
   */
  (text) => window.dispatchEvent(new MessageEvent('message', {
    data: {
      type: 'init',
      text,
      version: 1,
      uri: 'file:///C:/outline-reorder-undo.md',
      settings: {
        language: 'ja',
        imageDirectory: 'assets/${documentBasename}',
        maxPasteSizeMb: 20,
        remoteImagesEnabled: false,
        mermaidTheme: 'default',
        workspaceTrusted: true
      }
    }
  })), initialText);
  await page.locator('.outline-item').first().waitFor();


  /**
   * 「outlineIndex」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param heading 「heading」は、「outlineIndex」が検証シナリオの処理対象を特定する入力です。
   * @returns 「outlineIndex」が計算した位置・サイズ・件数などの数値を返します。
   */
  const outlineIndex = /**
 * 「outlineIndex」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param heading 「heading」は、「outlineIndex」が検証シナリオで処理する対象を特定する入力です。
 * @returns 置換後の文字列を返します。
 */ async (heading) => page.locator('.outline-item').evaluateAll(

    /**
 * 「elements」「expected」を受け取り、入力文字列を置換して変換する処理です。
     * @param elements elementsとして渡される、このコールバックの入力値です。
     * @param expected expectedとして渡される、このコールバックの入力値です。
     * @returns 置換後の文字列を返します。
     */
    (elements, expected) => elements.findIndex(
    /**
 * 「element」を受け取り、入力文字列を置換して変換する処理です。
     * @param element 処理対象の要素です。
     * @returns 置換後の文字列を返します。
     */
    (element) => element.textContent?.trim() === expected.replace(/^#+\s+/, '')),
    heading
  );

  /**
   * 「drag」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param sourceHeading 「sourceHeading」は、「drag」が検証シナリオの処理対象を特定する入力です。
   * @param targetHeading 「targetHeading」は、「drag」が検証シナリオの処理対象を特定する入力です。
   * @returns 「drag」が検証シナリオの入力を処理して得た固有の結果を返します。
   */
  const drag = /**
 * 「drag」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param sourceHeading 「sourceHeading」は、「drag」が検証シナリオで処理する対象を特定する入力です。
 * @param targetHeading 「targetHeading」は、「drag」が検証シナリオで処理する対象を特定する入力です。
 * @returns 「drag」が検証シナリオの入力を処理して得た固有の結果を返します。
 */ async (sourceHeading, targetHeading) => {
    const items = page.locator('.outline-item');
    const source = await items.nth(await outlineIndex(sourceHeading)).boundingBox();
    const target = await items.nth(await outlineIndex(targetHeading)).boundingBox();
    if (!source || !target) throw new Error(`Could not locate drag target: ${sourceHeading} -> ${targetHeading}`);
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(target.x + target.width / 2, target.y + target.height * 0.75);
    await page.mouse.up({ button: 'right' });
  };

  /**
   * 「localChangeCount」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @returns 「localChangeCount」が計算した位置・サイズ・件数などの数値を返します。
   */
  const localChangeCount = /**
 * 「localChangeCount」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @returns Webviewの状態から取得した値を返します。
 */ () => page.evaluate(

    /**
 * WebviewのDOMまたは状態を読み取り、検証側へ値を返すコールバックです。
     * @returns Webviewの状態から取得した値を返します。
     */
    () => window.__mveMessages.filter(
    /**
 * 「message」が条件に一致するか判定し、残す要素を決めるコールバックです。
     * @param message 処理対象のメッセージです。
     * @returns 要素を採用するかどうかの真偽値を返します。
     */
    (message) => message.type === 'localChanges').length
  );

  /**
   * wait・for・hostを待機します。
   * @param expected 検証で期待する値または状態です。
   * @returns 「waitForHost」が検証シナリオの入力を処理して得た固有の結果を返します。
   */
  const waitForHost = /**
 * 「waitForHost」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param expected 「expected」は、「waitForHost」が検証シナリオで処理する対象を特定する入力です。
 * @returns 「waitForHost」が検証シナリオの入力を処理して得た固有の結果を返します。
 */ async (expected) => {
    try {
      await page.waitForFunction(
      /**
 * 非同期処理の失敗理由を受け取り、回復処理または代替値を生成するコールバックです。
       * @param text 処理対象の本文です。
       * @returns 「text」から生成した処理結果を返します。
       */
      (text) => window.__mveHostText === text, expected);
      await page.waitForTimeout(250);
    } catch (error) {
      const actual = await page.evaluate(
      /**
       * Promiseの失敗理由を受け取り、エラー表示またはフォールバックを実行するコールバックです。
       * @returns エラー処理またはフォールバックの結果を返します。
       */
      () => ({
        text: window.__mveHostText,
        messages: window.__mveMessages
      }));
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nExpected: ${JSON.stringify(expected)}\nActual state: ${JSON.stringify(actual)}`);
    }
  };

  /**
   * wait・for・outlineを待機します。
   * @param expected 検証で期待する値または状態です。
   * @returns 「waitForOutline」が検証シナリオの入力を処理して得た固有の結果を返します。
   */
  const waitForOutline = /**
 * 「waitForOutline」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param expected 「expected」は、「waitForOutline」が検証シナリオで処理する対象を特定する入力です。
 * @returns 置換後の文字列を返します。
 */ (expected) => page.waitForFunction(
  /**
 * 「items」を受け取り、入力文字列を置換して変換する処理です。
   * @param items 処理対象となる複数要素の集合です。
   * @returns 置換後の文字列を返します。
   */
  (items) => (
    [...document.querySelectorAll('.outline-item')].map(
    /**
 * 「element」を変換し、変換後の要素を返すコールバックです。
     * @param element 処理対象の要素です。
     * @returns 置換後の文字列を返します。
     */
    (element) => element.textContent?.trim()).join('\n')
      === items.map(
      /**
 * 「item」を変換し、変換後の要素を返すコールバックです。
       * @param item 変換または処理の対象となる値です。
       * @returns 置換後の文字列を返します。
       */
      (item) => item.replace(/^#+\s+/, '')).join('\n')
  ), expected);

  /**
   * assert・no・opを検証します。
   * @param sourceHeading 「sourceHeading」は、「assertNoOp」が検証シナリオの処理対象を特定する入力です。
   * @param targetHeading 「targetHeading」は、「assertNoOp」が検証シナリオの処理対象を特定する入力です。
   * @param expected 検証で期待する値または状態です。
   * @returns 「assertNoOp」が判定した検証結果を返します。
   */
  const assertNoOp = /**
 * 「assertNoOp」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param sourceHeading 「sourceHeading」は、「assertNoOp」が検証シナリオで処理する対象を特定する入力です。
 * @param targetHeading 「targetHeading」は、「assertNoOp」が検証シナリオで処理する対象を特定する入力です。
 * @param expected 「expected」は、「assertNoOp」が検証シナリオで処理する対象を特定する入力です。
 * @returns 「assertNoOp」が判定した検証結果を返します。
 */ async (sourceHeading, targetHeading, expected) => {
    const before = await localChangeCount();
    await drag(sourceHeading, targetHeading);
    await page.waitForTimeout(150);
    const after = await localChangeCount();
    if (after !== before) throw new Error(`Forbidden move emitted localChanges: ${sourceHeading} -> ${targetHeading}`);
    if (await page.evaluate(
    /**
 * WebviewのDOMまたは状態を読み取り、検証側へ値を返すコールバックです。
     * @returns Webviewの状態から取得した値を返します。
     */
    () => window.__mveHostText) !== expected) {
      throw new Error(`Forbidden move changed text: ${sourceHeading} -> ${targetHeading}`);
    }
  };

  await assertNoOp(topLevelHeadings[0], childHeadings[2], initialText);
  await assertNoOp(childHeadings[0], grandchildHeading, initialText);
  await drag(topLevelHeadings[0], topLevelHeadings[1]);
  await waitForHost(parentMovedText);
  await waitForOutline(parentMovedOutline);
  await page.keyboard.press('Control+Z');
  await waitForHost(initialText);
  await waitForOutline(initialOutline);
  await page.keyboard.press('Control+Shift+Z');
  await waitForHost(parentMovedText);
  await waitForOutline(parentMovedOutline);
  await page.locator('.ribbon-tool').nth(0).click();
  await waitForHost(initialText);
  await waitForOutline(initialOutline);
  await page.locator('.ribbon-tool').nth(1).click();
  await waitForHost(parentMovedText);
  await waitForOutline(parentMovedOutline);
  await drag(childHeadings[0], childHeadings[1]);
  await waitForHost(childMovedText);
  await waitForOutline(childMovedOutline);
  await page.keyboard.press('Control+Z');
  await waitForHost(parentMovedText);
  await waitForOutline(parentMovedOutline);
  await page.keyboard.press('Control+Y');
  await waitForHost(childMovedText);
  await waitForOutline(childMovedOutline);
  await drag(childHeadings[0], childHeadings[2]);
  await waitForHost(crossParentMovedText);
  await waitForOutline(crossParentMovedOutline);
  await page.keyboard.press('Control+Z');
  await waitForHost(childMovedText);
  await waitForOutline(childMovedOutline);
  await page.keyboard.press('Control+Y');
  await waitForHost(crossParentMovedText);
  await waitForOutline(crossParentMovedOutline);
  await drag(childHeadings[0], topLevelHeadings[3]);
  await waitForHost(emptyParentMovedText);
  await waitForOutline(emptyParentMovedOutline);
  await page.keyboard.press('Control+Z');
  await waitForHost(crossParentMovedText);
  await waitForOutline(crossParentMovedOutline);
  await page.keyboard.press('Control+Y');
  await waitForHost(emptyParentMovedText);
  await waitForOutline(emptyParentMovedOutline);

  if (errors.length) throw new Error(`Browser errors: ${errors.join('\n')}`);
  console.log(JSON.stringify({
    ok: true,
    checks: [
      'parent-with-descendants',
      'child-same-parent-with-descendants',
      'child-cross-parent',
      'child-empty-parent',
      'level-change-rejected',
      'keyboard-undo-redo',
      'ribbon-undo-redo'
    ]
  }));
} finally {
  await browser.close();
}

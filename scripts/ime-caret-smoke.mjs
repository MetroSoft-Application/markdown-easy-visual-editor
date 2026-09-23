/**
 * @file ime-caret-smoke.mjs
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
/** 「webviewBundle」は、関連する処理間で共有する設定値または状態です。 */
const webviewBundle = await readFile(path.resolve('dist/webview.js'), 'utf8');
/** 「markdownWorkerBundle」は、関連する処理間で共有する設定値または状態です。 */
const markdownWorkerBundle = await readFile(path.resolve('dist/markdown-worker.js'), 'utf8');
/** 「markdownRichWorkerBundle」は、関連する処理間で共有する設定値または状態です。 */
const markdownRichWorkerBundle = await readFile(path.resolve('dist/markdown-rich-worker.js'), 'utf8');
/** 「browser」は、ブラウザー処理の共有状態または実行設定です。 */
const browser = await chromium.launch({ executablePath, headless: true });

try {
  const context = await browser.newContext();
  await context.addInitScript(
  /**
 * ブラウザーのWebviewテストで使用するグローバル状態を初期化するコールバックです。
   * @returns 「Set」を実行し、値を返しません。
   */
  () => {
    window.__mveMessages = [];
    window.__mveHostVersion = 1;
    window.__mveHostText = '';
    window.__mveAckDelay = 120;
    window.__mveAppliedOperations = new Set();
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
          const version = window.__mveHostVersion;
          window.__mveAppliedOperations.add(`${message.clientId}\0${message.opId}`);
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
              version,
              changes: message.changes
            }
          })), window.__mveAckDelay);
          return;
        }
        if (message.type === 'requestResync') {
          setTimeout(
          /**
 * 指定時間の経過後に遅延処理を実行するコールバックです。
           * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
           */
          () => window.dispatchEvent(new MessageEvent('message', {
            data: {
              type: 'resyncRequired',
              clientId: message.clientId,
              opId: message.opId,
              operationApplied: message.opId
                ? window.__mveAppliedOperations.has(`${message.clientId}\0${message.opId}`)
                : undefined,
              text: window.__mveHostText,
              version: window.__mveHostVersion,
              reason: message.reason
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
  const cdp = await context.newCDPSession(page);
  page.setDefaultTimeout(5_000);
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
  await page.addScriptTag({ content: webviewBundle });
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

  const source = '最中最中に\n文字入力\n最中に何か入力';
  await page.evaluate(
  /**
 * 「text」を受け取り、Webviewへメッセージイベントを発火する処理です。
   * @param text 処理対象の本文です。
   * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
   */
  (text) => {
    window.__mveHostText = text;
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'init',
        text,
        version: 1,
        uri: 'file:///C:/ime-caret.md',
        settings: {
          language: 'ja',
          imageDirectory: 'assets/${documentBasename}',
          maxPasteSizeMb: 20,
          remoteImagesEnabled: false,
          mermaidTheme: 'default',
          workspaceTrusted: true
        }
      }
    }));
  }, source);
  const editor = page.locator('.cm-content');
  await editor.waitFor();
  await editor.click({ position: { x: 20, y: 10 } });
  await editor.press('Home');
  await editor.press('End');
  await page.evaluate(
  /**
 * 登録された処理を受け取り、イベントに応じた状態更新または委譲処理を実行するコールバックです。
   * @returns 「for」を実行し、値を返しません。
   */
  () => {
    window.__mveImeEvents = [];
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input', 'keydown', 'keyup']) {
      document.addEventListener(type,
      /**
       * イベント情報を「event」を受け取り、DOMまたは画面状態を更新するコールバックです。
       * @param event 処理対象のイベントです。
       * @returns 「event」から生成した処理結果を返します。
       */
      (event) => window.__mveImeEvents.push({
        type,
        data: event.data,
        inputType: event.inputType,
        key: event.key,
        isComposing: event.isComposing
      }), true);
    }
  });
  const start = await page.evaluate(
  /**
 * 登録された処理を受け取り、イベントに応じた状態更新または委譲処理を実行するコールバックです。
   * @returns DOM検索で得た要素または状態を返します。
   */
  () => Number(document.querySelector('.source-editor')?.getAttribute('data-selection-from')));
  // Windowsの日本語IMEは、予測・文節変換中のpreedit選択を入力開始位置へ置くことがある。
  const firstComposition = ['ば', 'ばっくすらっしゅ', 'バックスラッシュ', 'バックスラッシュによる'];
  for (const text of firstComposition) {
    await cdp.send('Input.imeSetComposition', { text, selectionStart: 0, selectionEnd: 0 });
  }
  const firstPreeditOperations = await page.evaluate(

    /**
 * Webviewへメッセージイベントを発火する処理を実行するコールバックです。
     * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
     */
    () => window.__mveMessages.filter(
    /**
 * 「message」が条件に一致するか判定し、残す要素を決めるコールバックです。
     * @param message 処理対象のメッセージです。
     * @returns 要素を採用するかどうかの真偽値を返します。
     */
    (message) => message.type === 'localChanges').length
  );
  if (firstPreeditOperations !== 0) {
    throw new Error(`IMEの変換途中に同期操作が送信された: ${firstPreeditOperations}`);
  }
  await page.evaluate(
  /**
 * WebviewのDOMまたは状態を読み取り、検証側へ値を返すコールバックです。
   * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
   */
  () => {
    const baseVersion = window.__mveHostVersion;
    const text = '\n外部エディター追記';
    const change = { rangeOffset: window.__mveHostText.length, rangeLength: 0, text };
    window.__mveHostText += text;
    window.__mveHostVersion += 1;
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'externalChanges', baseVersion, version: window.__mveHostVersion, changes: [change] }
    }));
  });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await cdp.send('Input.insertText', { text: firstComposition.at(-1) });
  await page.waitForFunction(

    /**
 * ブラウザーのDOM状態が期待条件を満たすか確認する述語コールバックです。
     * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
     */
    () => window.__mveMessages.filter(
    /**
 * 「message」が条件に一致するか判定し、残す要素を決めるコールバックです。
     * @param message 処理対象のメッセージです。
     * @returns 要素を採用するかどうかの真偽値を返します。
     */
    (message) => message.type === 'localChanges').length === 1
  );
  await page.evaluate(
  /**
   * 配列要素を採用するか判定するコールバックです。
   * @returns 要素を採用するかどうかの真偽値を返します。
   */
  () => {
    const content = document.querySelector('.cm-content');
    content?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Shift', code: 'ShiftLeft' }));
  });
  const secondComposition = ['か', 'かいぎょうの', '改行の'];
  const operationsBeforeSecondPreedit = await page.evaluate(

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
  for (const text of secondComposition) {
    await cdp.send('Input.imeSetComposition', { text, selectionStart: 0, selectionEnd: 0 });
  }
  const secondPreeditOperations = await page.evaluate(

    /**
 * WebviewのDOMまたは状態を読み取り、検証側へ値を返すコールバックです。
     * @returns DOM検索で得た要素または状態を返します。
     */
    () => window.__mveMessages.filter(
    /**
 * 「message」が条件に一致するか判定し、残す要素を決めるコールバックです。
     * @param message 処理対象のメッセージです。
     * @returns 要素を採用するかどうかの真偽値を返します。
     */
    (message) => message.type === 'localChanges').length
  );
  if (secondPreeditOperations !== operationsBeforeSecondPreedit) {
    throw new Error(`2回目のIME変換途中に同期操作が送信された: ${secondPreeditOperations}`);
  }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await cdp.send('Input.insertText', { text: secondComposition.at(-1) });
  const selectionBeforeNextKey = await page.evaluate(
  /**
 * 処理結果を生成する処理を実行するコールバックです。
   * @returns イベントを発火し、通知処理の成否を示す真偽値を返します。
   */
  () => {
    const content = document.querySelector('.cm-content');
    // compositionendと確定タイマーの間に次のキーが来ても、入力先を先頭へ戻さない。
    content?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'k', code: 'KeyK' }));
    return Number(document.querySelector('.source-editor')?.getAttribute('data-selection-from'));
  });
  await page.waitForTimeout(800);
  const result = await page.evaluate(
  /**
 * （hostText、editorText、selectionFrom、selectionTo、domSelectionOffset）を持つオブジェクトを初期化して返すコールバックです。
   * @returns 初期化したオブジェクト（hostText、editorText、selectionFrom、selectionTo、domSelectionOffset）を返します。
   */
  () => ({
    hostText: window.__mveHostText,
    editorText: document.querySelector('.cm-content')?.textContent,
    selectionFrom: Number(document.querySelector('.source-editor')?.getAttribute('data-selection-from')),
    selectionTo: Number(document.querySelector('.source-editor')?.getAttribute('data-selection-to')),
    domSelectionOffset: (
    /**
 * 受け取った入力または現在の状態を検証し、呼び出し元へ必要な処理結果を返すコールバックです。
     * @returns DOM検索で得た要素または状態を返します。
     */
    () => {
      const content = document.querySelector('.cm-content');
      const selection = document.getSelection();
      if (!content || !selection?.focusNode || !content.contains(selection.focusNode)) return Number.NaN;
      const range = document.createRange();
      range.setStart(content, 0);
      range.setEnd(selection.focusNode, selection.focusOffset);
      return range.toString().length;
    })(),
    events: window.__mveImeEvents
  }));
  const committedText = `${firstComposition.at(-1)}${secondComposition.at(-1)}`;
  const expected = start + committedText.length;
  const expectedHostText = `${source.slice(0, start)}${committedText}${source.slice(start)}\n外部エディター追記`;
  if (result.events.filter(
  /**
 * 「event」が条件に一致するか判定し、残す要素を決めるコールバックです。
   * @param event 処理対象のイベントです。
   * @returns 要素を採用するかどうかの真偽値を返します。
   */
  (event) => event.type === 'compositionend').length !== 2
    || result.hostText !== expectedHostText
    || selectionBeforeNextKey !== expected
    || result.selectionFrom !== expected
    || result.selectionTo !== expected
    || result.domSelectionOffset !== expected) {
    throw new Error(`IMEをEnterですぐ確定した後のカーソル位置が不正です: expected=${expected}, result=${JSON.stringify(result)}`);
  }
  await editor.press('k');
  await page.waitForTimeout(100);
  const marker = await page.evaluate(
  /**
 * 「offset」を受け取り、検証対象のJSONペイロードを生成する処理です。
   * @param offset 本文または選択範囲を示すゼロ基準の位置です。範囲の開始・終了や写像の基準になります。
   * @returns 「offset」から生成した処理結果を返します。
   */
  (offset) => window.__mveHostText.slice(offset, offset + 1), expected);
  if (marker !== 'k') throw new Error(`IME確定後の次の入力位置が不正です: expected=${expected}, actual=${JSON.stringify(marker)}`);
  console.log('IME caret smoke test passed.');
} finally {
  await browser.close();
}

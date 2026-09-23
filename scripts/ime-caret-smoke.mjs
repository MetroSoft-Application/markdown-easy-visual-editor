/**
 * @fileoverview IME・キャレット・スモーク検証を開発・検証環境で実行する。前提条件や失敗条件を終了コードとログで示す。
 */
import { chromium } from 'playwright-core';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * 指定した名前のファイルを検証用ディレクトリから再帰的に探す。
 * @param root - IME・キャレット・スモーク検証へ渡す入力。
 * @param name - IME・キャレット・スモーク検証の対象や分岐を識別する値。
 * @returns IME・キャレット・スモーク検証のfind・fileが生成する結果。
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
 * IME・キャレット・スモーク検証で読み書きするリソースの場所。
 */
const executablePath = await findFile(path.resolve('.chromium'), 'chrome-headless-shell.exe');
if (!executablePath) throw new Error('Chromium がありません。npm run pdf:install-browser を実行してください。');
/**
 * IME・キャレット・スモーク検証のwebview・bundleとして読み込んだ本文または設定。
 */
const webviewBundle = await readFile(path.resolve('dist/webview.js'), 'utf8');
/**
 * IME・キャレット・スモーク検証で解析・表示・保存する本文。
 */
const markdownWorkerBundle = await readFile(path.resolve('dist/markdown-worker.js'), 'utf8');
/**
 * IME・キャレット・スモーク検証で解析・表示・保存する本文。
 */
const markdownRichWorkerBundle = await readFile(path.resolve('dist/markdown-rich-worker.js'), 'utf8');
/**
 * IME・キャレット・スモーク検証の位置・寸法・件数・時間を表す数値。
 */
const browser = await chromium.launch({ executablePath, headless: true });

try {
  const context = await browser.newContext();
  await context.addInitScript(
  /**
   * 要素をsetへ渡し、IME・キャレット・スモーク検証の結果または副作用を処理する。
   * @returns IME・キャレット・スモーク検証のコールバックが生成する結果。
   */
  () => {
    window.__mveMessages = [];
    window.__mveHostVersion = 1;
    window.__mveHostText = '';
    window.__mveAckDelay = 120;
    window.__mveAppliedOperations = new Set();
    window.acquireVsCodeApi =
    /**
     * WebviewからVS Codeのメッセージ送信・状態保存APIを取得する。
     * @returns VS Codeのメッセージ送信・状態保存API。
     */
    () => ({

      
      postMessage: /**
       * IME・キャレット・スモーク検証の変更または要求をHost・Webview間へ通知する。
       * @param message - HostとWebviewの間で受け渡すメッセージ。
       * @returns IME・キャレット・スモーク検証のpost・messageが生成する結果。
       */ (message) => {
        window.__mveMessages.push(message);
        if (message.type === 'localChanges') {
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
          const version = window.__mveHostVersion;
          window.__mveAppliedOperations.add(`${message.clientId}\0${message.opId}`);
          setTimeout(
          /**
           * 指定時間の経過後に後続処理を実行する。
           * @returns 副作用を完了し、値は返さない。
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
           * 指定時間の経過後に後続処理を実行する。
           * @returns 副作用を完了し、値は返さない。
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

      
      getState: /**
       * IME・キャレット・スモーク検証から必要な値またはリソースを取得する。
       * @returns 条件に一致する値。未検出時はundefinedまたはnull。
       */ () => undefined,

      
      setState: /**
       * IME・キャレット・スモーク検証の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
       * @returns 副作用を完了し、値は返さない。
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
   * ブラウザーのDOM状態のcreate・object・url結果を読み取り、検証用の値へ変換する。
   * @param options - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
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
   * HostとWebviewのメッセージ状態が完了条件を満たすまで待機する。
   * @returns IME・キャレット・スモーク検証のコールバックが生成する結果。
   */
  () => window.__mveMessages.some(
  /**
   * IME・キャレット・スモーク検証のコールバックとしてメッセージを処理する。
   * @param message - HostとWebviewの間で受け渡すメッセージ。
   * @returns IME・キャレット・スモーク検証のコールバックが生成する結果。
   */
  (message) => message.type === 'ready'));

  const source = '最中最中に\n文字入力\n最中に何か入力';
  await page.evaluate(
  /**
   * Host側の本文状態のdispatch・event結果を読み取り、検証用の値へ変換する。
   * @param text - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
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
   * ブラウザーのDOM状態のfor結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    window.__mveImeEvents = [];
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input', 'keydown', 'keyup']) {
      document.addEventListener(type,
      /**
       * イベントで一覧追加を実行する。
       * @param event - ユーザー操作またはDOMから通知されたイベント。
       * @returns 副作用を完了し、値は返さない。
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
   * ブラウザー内の「.source-editor」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => Number(document.querySelector('.source-editor')?.getAttribute('data-selection-from')));
  // Windowsの日本語IMEは、予測・文節変換中のpreedit選択を入力開始位置へ置くことがある。
  const firstComposition = ['ば', 'ばっくすらっしゅ', 'バックスラッシュ', 'バックスラッシュによる'];
  for (const text of firstComposition) {
    await cdp.send('Input.imeSetComposition', { text, selectionStart: 0, selectionEnd: 0 });
  }
  const firstPreeditOperations = await page.evaluate(

    /**
     * HostとWebviewのメッセージ状態のfilter結果を読み取り、検証用の値へ変換する。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    () => window.__mveMessages.filter(
    /**
     * 種別「localChanges」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'localChanges').length
  );
  if (firstPreeditOperations !== 0) {
    throw new Error(`IMEの変換途中に同期操作が送信された: ${firstPreeditOperations}`);
  }
  await page.evaluate(
  /**
   * Host側の本文状態のdispatch・event結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
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
     * HostとWebviewのメッセージ状態が完了条件を満たすまで待機する。
     * @returns IME・キャレット・スモーク検証のコールバックが生成する結果。
     */
    () => window.__mveMessages.filter(
    /**
     * 種別「localChanges」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'localChanges').length === 1
  );
  await page.evaluate(
  /**
   * ブラウザー内の「.cm-content」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    const content = document.querySelector('.cm-content');
    content?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Shift', code: 'ShiftLeft' }));
  });
  const secondComposition = ['か', 'かいぎょうの', '改行の'];
  const operationsBeforeSecondPreedit = await page.evaluate(

    /**
     * HostとWebviewのメッセージ状態のfilter結果を読み取り、検証用の値へ変換する。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    () => window.__mveMessages.filter(
    /**
     * 種別「localChanges」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'localChanges').length
  );
  for (const text of secondComposition) {
    await cdp.send('Input.imeSetComposition', { text, selectionStart: 0, selectionEnd: 0 });
  }
  const secondPreeditOperations = await page.evaluate(

    /**
     * HostとWebviewのメッセージ状態のfilter結果を読み取り、検証用の値へ変換する。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    () => window.__mveMessages.filter(
    /**
     * 種別「localChanges」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
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
   * ブラウザー内の「.cm-content」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
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
   * ブラウザー内の「.cm-content」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => ({
    hostText: window.__mveHostText,
    editorText: document.querySelector('.cm-content')?.textContent,
    selectionFrom: Number(document.querySelector('.source-editor')?.getAttribute('data-selection-from')),
    selectionTo: Number(document.querySelector('.source-editor')?.getAttribute('data-selection-to')),
    domSelectionOffset: (
    /**
     * 要素をquery・selectorへ渡し、IME・キャレット・スモーク検証の結果または副作用を処理する。
     * @returns IME・キャレット・スモーク検証のコールバックが生成する結果。
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
   * 種別「compositionend」のイベントだけを残す。
   * @param event - イベントのtypeを参照する走査対象。
   * @returns 条件を満たした要素だけを含む一覧。
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
   * Host側の本文状態のslice結果を読み取り、検証用の値へ変換する。
   * @param offset - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (offset) => window.__mveHostText.slice(offset, offset + 1), expected);
  if (marker !== 'k') throw new Error(`IME確定後の次の入力位置が不正です: expected=${expected}, actual=${JSON.stringify(marker)}`);
  console.log('IME caret smoke test passed.');
} finally {
  await browser.close();
}

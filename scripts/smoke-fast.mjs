/**
 * @fileoverview スモーク検証・高速を開発・検証環境で実行する。前提条件や失敗条件を終了コードとログで示す。
 */
import { chromium } from 'playwright-core';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * 指定した名前のファイルを検証用ディレクトリから再帰的に探す。
 * @param root - スモーク検証・高速へ渡す入力。
 * @param name - スモーク検証・高速の対象や分岐を識別する値。
 * @returns スモーク検証・高速のfind・fileが生成する結果。
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
 * スモーク検証・高速で読み書きするリソースの場所。
 */
const executablePath = await findFile(path.resolve('.chromium'), 'chrome-headless-shell.exe');
if (!executablePath) throw new Error('Chromium がありません。npm run pdf:install-browser を実行してください。');
/**
 * スモーク検証・高速のwebview・bundleとして読み込んだ本文または設定。
 */
const webviewBundle = await readFile(path.resolve('dist/webview.js'), 'utf8');
/**
 * スモーク検証・高速で解析・表示・保存する本文。
 */
const markdownWorkerBundle = await readFile(path.resolve('dist/markdown-worker.js'), 'utf8');
/**
 * スモーク検証・高速で解析・表示・保存する本文。
 */
const markdownRichWorkerBundle = await readFile(path.resolve('dist/markdown-rich-worker.js'), 'utf8');
if (/react\.development\.js|@milkdown|MILKDOWN_LISTENER/.test(webviewBundle)) {
  throw new Error('製品Webviewバンドルに開発用ReactまたはMilkdownが残っています。');
}
/**
 * スモーク検証・高速の位置・寸法・件数・時間を表す数値。
 */
const browser = await chromium.launch({ executablePath, headless: true });
/**
 * スモーク検証・高速で扱う一覧または対応表。
 */
const errors = [];
try {
  const context = await browser.newContext();
  await context.addInitScript(
  /**
   * 要素をsetへ渡し、スモーク検証・高速の結果または副作用を処理する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => {
    window.__mveMessages = [];
    window.__mveHostVersion = 1;
    window.__mveHostText = '';
    window.__mvePhysicalText = '';
    window.__mveAckDelay = 0;
    window.__mveHoldLocalOperations = false;
    window.__mveHeldOperations = [];
    window.__mveAppliedOperations = new Set();
    window.__mveAcks = [];
    window.__mveUndoStack = [];
    window.__mveRedoStack = [];
    window.__mveGlobalSettings = undefined;
    window.acquireVsCodeApi =
    /**
     * WebviewからVS Codeのメッセージ送信・状態保存APIを取得する。
     * @returns VS Codeのメッセージ送信・状態保存API。
     */
    () => ({

      
      postMessage: /**
       * スモーク検証・高速の変更または要求をHost・Webview間へ通知する。
       * @param message - HostとWebviewの間で受け渡すメッセージ。
       * @returns スモーク検証・高速のpost・messageが生成する結果。
       */ (message) => {
        window.__mveMessages.push(message);
        if (message.type === 'localChanges') {
          if (window.__mveHoldLocalOperations) {
            window.__mveHeldOperations.push(message);
            return;
          }
          window.__mveUndoStack.push(window.__mveHostText);
          window.__mveRedoStack = [];
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
          window.__mvePhysicalText = window.__mveHostText.replace(/\n/g, '\r\n');
          window.__mveHostVersion += 1;
          window.__mveAppliedOperations.add(`${message.clientId}\0${message.opId}`);
          setTimeout(
          /**
           * 指定時間の経過後に後続処理を実行する。
           * @returns 副作用を完了し、値は返さない。
           */
          () => {
            const ack = {
              type: 'editAck',
              clientId: message.clientId,
              opId: message.opId,
              baseVersion,
              version: window.__mveHostVersion,
              changes: message.changes
            };
            window.__mveAcks.push(ack);
            window.dispatchEvent(new MessageEvent('message', { data: ack }));
          }, window.__mveAckDelay);
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
          window.__mvePhysicalText = nextText.replace(/\n/g, '\r\n');
          window.__mveHostVersion += 1;
          setTimeout(
          /**
           * 指定時間の経過後に後続処理を実行する。
           * @returns 副作用を完了し、値は返さない。
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
        if (message.type === 'requestResync') setTimeout(
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
        if (message.type === 'setScrollSyncEnabled') {
          window.__mveGlobalSettings = {
            ...window.__mveGlobalSettings,
            scrollSyncEnabled: message.enabled
          };
          setTimeout(
          /**
           * 指定時間の経過後に後続処理を実行する。
           * @returns 副作用を完了し、値は返さない。
           */
          () => window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'settingsChanged', settings: window.__mveGlobalSettings }
          })), 0);
        }
        if (message.type === 'setOutlineVisible') {
          window.__mveGlobalSettings = {
            ...window.__mveGlobalSettings,
            outlineVisible: message.visible
          };
          setTimeout(
          /**
           * 指定時間の経過後に後続処理を実行する。
           * @returns 副作用を完了し、値は返さない。
           */
          () => window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'settingsChanged', settings: window.__mveGlobalSettings }
          })), 0);
        }
        if (message.type === 'setImageDirectory') {
          window.__mveGlobalSettings = {
            ...window.__mveGlobalSettings,
            imageDirectory: message.directory
          };
          setTimeout(
          /**
           * 指定時間の経過後に後続処理を実行する。
           * @returns 副作用を完了し、値は返さない。
           */
          () => window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'settingsChanged', settings: window.__mveGlobalSettings }
          })), 300);
        }
        if (message.type === 'setFontFamilies') {
          window.__mveGlobalSettings = {
            ...window.__mveGlobalSettings,
            editorFontFamily: message.editorFontFamily,
            previewFontFamily: message.previewFontFamily
          };
          setTimeout(
          /**
           * 指定時間の経過後に後続処理を実行する。
           * @returns 副作用を完了し、値は返さない。
           */
          () => window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'settingsChanged', settings: window.__mveGlobalSettings }
          })), 0);
        }
      },

      
      getState: /**
       * スモーク検証・高速から必要な値またはリソースを取得する。
       * @returns 条件に一致する値。未検出時はundefinedまたはnull。
       */ () => undefined,

      
      setState: /**
       * スモーク検証・高速の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
       * @returns 副作用を完了し、値は返さない。
       */ () => undefined
    });
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  page.setDefaultTimeout(5_000);
  page.on('pageerror',
  /**
   * pageerrorイベントで一覧追加を実行する。
   * @param error - ユーザー操作またはDOMから通知されたイベント。
   * @returns 副作用を完了し、値は返さない。
   */
  (error) => errors.push(error.message));
  page.on('console',
  /**
   * consoleイベントでifを実行する。
   * @param message - ユーザー操作またはDOMから通知されたイベント。
   * @returns 副作用を完了し、値は返さない。
   */
  (message) => { if (message.type() === 'error') errors.push(message.text()); });
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
  await page.addScriptTag({ path: path.resolve('dist/webview.js') });
  await page.waitForFunction(
  /**
   * HostとWebviewのメッセージ状態が完了条件を満たすまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => window.__mveMessages.some(
  /**
   * スモーク検証・高速のコールバックとしてメッセージを処理する。
   * @param message - HostとWebviewの間で受け渡すメッセージ。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (message) => message.type === 'ready'));
  const settings = { language: 'ja', imageDirectory: 'assets/${documentBasename}', maxPasteSizeMb: 20, remoteImagesEnabled: false, mermaidTheme: 'default', outlineVisible: true, workspaceTrusted: true, editorFontFamily: '', previewFontFamily: '' };
  await page.evaluate(
  /**
   * Webviewの共有設定のdispatch・event結果を読み取り、検証用の値へ変換する。
   * @param initSettings - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (initSettings) => {
    window.__mveGlobalSettings = { ...initSettings, scrollSyncEnabled: true };
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'init', text: '', version: 1, uri: 'file:///C:/empty-crlf.md', settings: window.__mveGlobalSettings }
    }));
  }, settings);
  await page.locator('.split-editor .cm-content').waitFor();
  await page.setViewportSize({ width: 475, height: 720 });
  const messageCountBeforeSettings = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveMessages.length);
  await page.getByRole('tab', { name: '設定', exact: true }).click();
  await page.waitForTimeout(200);
  const messageCountAfterSettings = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveMessages.length);
  if (messageCountAfterSettings !== messageCountBeforeSettings) throw new Error('opening settings sent an unexpected host message');
  const editorFontInput = page.locator('input[aria-label="エディタ フォント"]');
  const previewFontInput = page.locator('input[aria-label="プレビュー フォント"]');
  await editorFontInput.scrollIntoViewIfNeeded();
  await editorFontInput.waitFor();
  await editorFontInput.fill('Arial');
  await editorFontInput.blur();
  await page.waitForFunction(
  /**
   * Webviewの共有設定が完了条件を満たすまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => window.__mveGlobalSettings.editorFontFamily === 'Arial');
  await editorFontInput.click();
  await editorFontInput.fill('Enter Font');
  await editorFontInput.press('Enter');
  await page.waitForFunction(
  /**
   * Webviewの共有設定が完了条件を満たすまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => window.__mveGlobalSettings.editorFontFamily === 'Enter Font');
  await editorFontInput.fill('Unsaved Font');
  await editorFontInput.press('Escape');
  if (await editorFontInput.inputValue() !== 'Enter Font') {
    throw new Error('Escape did not restore the confirmed font family');
  }
  const editorFontMessageStart = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveMessages.length);
  await editorFontInput.fill('Editor Test Font');
  const editorMessagesWhileTyping = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態のslice結果を読み取り、検証用の値へ変換する。
   * @param start - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (start) => window.__mveMessages.slice(start).filter(
  /**
   * 種別「setFontFamilies」のメッセージだけを残す。
   * @param message - メッセージのtypeを参照する走査対象。
   * @returns 条件を満たした要素だけを含む一覧。
   */
  (message) => message.type === 'setFontFamilies').length, editorFontMessageStart);
  if (editorMessagesWhileTyping !== 0) throw new Error('editor font input sent host messages while typing');
  await editorFontInput.blur();
  await page.waitForFunction(
  /**
   * Webviewの共有設定が完了条件を満たすまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => window.__mveGlobalSettings.editorFontFamily === 'Editor Test Font');
  const previewFontMessageStart = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveMessages.length);
  await previewFontInput.fill('Preview Test Font');
  const previewMessagesWhileTyping = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態のslice結果を読み取り、検証用の値へ変換する。
   * @param start - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (start) => window.__mveMessages.slice(start).filter(
  /**
   * 種別「setFontFamilies」のメッセージだけを残す。
   * @param message - メッセージのtypeを参照する走査対象。
   * @returns 条件を満たした要素だけを含む一覧。
   */
  (message) => message.type === 'setFontFamilies').length, previewFontMessageStart);
  if (previewMessagesWhileTyping !== 0) throw new Error('preview font input sent host messages while typing');
  await previewFontInput.blur();
  await page.waitForFunction(
  /**
   * Webviewの共有設定が完了条件を満たすまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => window.__mveGlobalSettings.editorFontFamily === 'Editor Test Font'
    && window.__mveGlobalSettings.previewFontFamily === 'Preview Test Font');
  const appliedFontStyles = await page.evaluate(
  /**
   * ブラウザー内の「.cm-content」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => ({
    editor: getComputedStyle(document.documentElement).getPropertyValue('--mve-editor-font-family').trim(),
    preview: getComputedStyle(document.documentElement).getPropertyValue('--mve-preview-font-family').trim(),
    editorContent: getComputedStyle(document.querySelector('.cm-content')).fontFamily,
    previewContent: getComputedStyle(document.querySelector('.rendered-markdown')).fontFamily
  }));
  if (!appliedFontStyles.editor.includes('Editor Test Font')
    || !appliedFontStyles.preview.includes('Preview Test Font')
    || !appliedFontStyles.editorContent.includes('Editor Test Font')
    || !appliedFontStyles.previewContent.includes('Preview Test Font')) {
    throw new Error(`editor and preview font CSS variables were not applied independently: ${JSON.stringify(appliedFontStyles)}`);
  }
  await editorFontInput.fill('Test; color: red');
  if (await editorFontInput.inputValue() !== '') {
    throw new Error('invalid font input was not normalized during editing');
  }
  await editorFontInput.blur();
  await page.waitForFunction(
  /**
   * Webviewの共有設定が完了条件を満たすまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => window.__mveGlobalSettings.editorFontFamily === '');
  const invalidFontFallback = await page.evaluate(
  /**
   * ブラウザーのDOM状態のget・computed・style結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => getComputedStyle(document.documentElement).getPropertyValue('--mve-editor-font-family').trim());
  await editorFontInput.fill('');
  await previewFontInput.fill('');
  await previewFontInput.blur();
  await page.waitForFunction(
  /**
   * Webviewの共有設定が完了条件を満たすまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => window.__mveGlobalSettings.editorFontFamily === ''
    && window.__mveGlobalSettings.previewFontFamily === '');
  const emptyFontFallback = await page.evaluate(
  /**
   * ブラウザーのDOM状態のget・computed・style結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => ({
    editor: getComputedStyle(document.documentElement).getPropertyValue('--mve-editor-font-family').trim(),
    preview: getComputedStyle(document.documentElement).getPropertyValue('--mve-preview-font-family').trim()
  }));
  if (invalidFontFallback !== emptyFontFallback.editor
    || emptyFontFallback.editor !== '"Noto Sans JP", "Yu Gothic UI", sans-serif'
    || emptyFontFallback.preview !== emptyFontFallback.editor) {
    throw new Error(`empty and invalid font values did not use the same fallback: ${JSON.stringify({ invalidFontFallback, emptyFontFallback })}`);
  }
  const imageDirectoryInput = page.getByRole('textbox', { name: '画像保存先のパスルール', exact: true });
  await imageDirectoryInput.fill('images/${documentBasename}');
  const settingBounds = await page.evaluate(
  /**
   * ブラウザー内の「.ribbon-settings-group」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    const group = document.querySelector('.ribbon-settings-group')?.getBoundingClientRect();
    const input = document.querySelector('.ribbon-setting-form input')?.getBoundingClientRect();
    return group && input
      ? { groupWidth: group.width, groupRight: group.right, inputWidth: input.width, inputRight: input.right }
      : undefined;
  });
  if (!settingBounds
    || settingBounds.groupWidth > 350
    || settingBounds.inputWidth < 279
    || settingBounds.inputWidth > 281
    || settingBounds.inputRight > settingBounds.groupRight + 1) {
    throw new Error(`image setting controls overflowed their group: ${JSON.stringify(settingBounds)}`);
  }
  if (await page.locator('.ribbon-setting-form button').count()) {
    throw new Error('image setting form still contains an apply button');
  }
  await imageDirectoryInput.press('Enter');
  await page.getByRole('tab', { name: '挿入', exact: true }).click();
  await page.locator('button[title^="画像"]').click();
  const requestedImageDirectory = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態のreverse結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => [...window.__mveMessages]
    .reverse().find(
    /**
     * typeが条件に一致する最初のメッセージを取得する。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件に一致した最初の要素。未検出時はundefined。
     */
    (message) => message.type === 'pickImage')?.imageDirectory);
  if (requestedImageDirectory !== 'images/${documentBasename}') {
    throw new Error(`image setting was not applied to the next save request: ${requestedImageDirectory}`);
  }
  await page.waitForFunction(
  /**
   * Webviewの共有設定が完了条件を満たすまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => window.__mveGlobalSettings.imageDirectory === 'images/${documentBasename}');
  await page.getByRole('tab', { name: 'ホーム', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(500);
  const emptyCrLfStart = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態のfilter結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => ({
    local: window.__mveMessages.filter(
    /**
     * 種別「localChanges」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'localChanges').length,
    resync: window.__mveMessages.filter(
    /**
     * 種別「requestResync」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'requestResync').length
  }));
  await page.locator('.split-editor .cm-content').press('Enter');
  await page.waitForFunction(
  /**
   * Host側の本文状態が完了条件を満たすまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => window.__mveHostText === '\n' && window.__mvePhysicalText === '\r\n');
  await page.waitForTimeout(300);
  const emptyCrLfResult = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態のfilter結果を読み取り、検証用の値へ変換する。
   * @param start - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (start) => ({
    text: window.__mveHostText,
    physicalText: window.__mvePhysicalText,
    local: window.__mveMessages.filter(
    /**
     * 種別「localChanges」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'localChanges').length - start.local,
    resync: window.__mveMessages.filter(
    /**
     * 種別「requestResync」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'requestResync').length - start.resync
  }), emptyCrLfStart);
  if (emptyCrLfResult.text !== '\n' || emptyCrLfResult.physicalText !== '\r\n'
    || emptyCrLfResult.local !== 1 || emptyCrLfResult.resync !== 0) {
    throw new Error(`first empty CRLF line did not converge once: ${JSON.stringify(emptyCrLfResult)}`);
  }
  const zoomImageSource = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
  const source = ('# Smoke\n\nfirst\\\nsecond\n\nReference [link][target] and note[^note].\n\n<!-- ordinary comment -->\n\n<div>raw-one</div>\n<div>raw-two</div>\n\n[target]: https://example.com\n\n[^note]: footnote body\n\n```ts\nconst value = 1;\n```\n'
    + Array.from({ length: 220 },
    /**
     * ・をrepeatへ渡し、スモーク検証・高速の結果または副作用を処理する。
     * @param _ - 引数位置を維持するための未使用値。
     * @param index - 配列・行列・文字列の要素位置を示す番号。
     * @returns スモーク検証・高速のコールバックが生成する結果。
     */
    (_, index) => `\n## Long section ${index}\n\n${'content '.repeat(16)}${index}\n`).join('')
    + '\n| H1 | H2 |\n| --- | --- |\n| old | old2 |\n');
  const sourceVersion = await page.evaluate(
  /**
   * Host側の本文状態のreplace結果を読み取り、検証用の値へ変換する。
   * @param text - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (text) => {
    window.__mveHostText = text;
    window.__mvePhysicalText = text.replace(/\n/g, '\r\n');
    window.__mveHostVersion += 1;
    window.__mveUndoStack = [];
    window.__mveRedoStack = [];
    return window.__mveHostVersion;
  }, source);
  await page.evaluate(
  /**
   * Webviewの共有設定のdispatch・event結果を読み取り、検証用の値へ変換する。
   * @param options - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  ({ text, version }) => window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'init', text, version, uri: 'file:///C:/smoke.md', settings: window.__mveGlobalSettings }
  })), { text: source, version: sourceVersion });
  try {
    await page.locator('.split-editor').waitFor();
    await page.waitForFunction(
    /**
     * ブラウザー内に「.split-preview .rendered-markdown」が現れるまで待機する。
     * @param expectedLength - ブラウザー内で評価するコールバック。
     * @returns スモーク検証・高速のコールバックが生成する結果。
     */
    (expectedLength) => (
      Number(document.querySelector('.split-preview .rendered-markdown')?.getAttribute('data-document-length')) === expectedLength
    ), source.length);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nBrowser errors:\n${errors.join('\n')}`);
  }
  if (!(await page.locator('.split-preview br').count())) throw new Error('hardbreak rendering failed');
  const anchorMarkup = await page.evaluate(
  /**
   * ブラウザー内の「.split-preview .markdown-source-block」を読み取り、検証用の値へ変換する。
   * @param text - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (text) => {
    const reference = [...document.querySelectorAll('.split-preview .markdown-source-block')]
      .find(
      /**
       * text・contentが条件に一致する最初の要素を取得する。
       * @param element - 要素のtext・contentを参照する走査対象。
       * @returns 条件に一致した最初の要素。未検出時はundefined。
       */
      (element) => element.textContent?.includes('Reference'));
    const rawOne = [...document.querySelectorAll('.split-preview div')].find(
    /**
     * text・contentが条件に一致する最初の要素を取得する。
     * @param element - 要素のtext・contentを参照する走査対象。
     * @returns 条件に一致した最初の要素。未検出時はundefined。
     */
    (element) => element.textContent === 'raw-one');
    const rawTwo = [...document.querySelectorAll('.split-preview div')].find(
    /**
     * text・contentが条件に一致する最初の要素を取得する。
     * @param element - 要素のtext・contentを参照する走査対象。
     * @returns 条件に一致した最初の要素。未検出時はundefined。
     */
    (element) => element.textContent === 'raw-two');
    const footnotes = document.querySelector('.split-preview .footnotes');
    return {
      referenceFrom: reference?.getAttribute('data-source-from'),
      expectedReferenceFrom: String(text.indexOf('Reference')),
      rawSharedAnchor: rawOne?.closest('[data-source-from]') === rawTwo?.closest('[data-source-from]'),
      footnoteFrom: footnotes?.getAttribute('data-source-from'),
      expectedFootnoteFrom: String(text.indexOf('[^note]:')),
      linked: document.querySelector('.split-preview a[href="https://example.com"]') !== null,
      noted: document.querySelector('.split-preview #fn-note') !== null
    };
  }, source);
  if (anchorMarkup.referenceFrom !== anchorMarkup.expectedReferenceFrom) throw new Error(`paragraph source anchor mismatch: ${JSON.stringify(anchorMarkup)}`);
  if (!anchorMarkup.rawSharedAnchor) throw new Error('one raw HTML token did not retain one source anchor');
  if (anchorMarkup.footnoteFrom !== anchorMarkup.expectedFootnoteFrom || !anchorMarkup.linked || !anchorMarkup.noted) {
    throw new Error(`reference/footnote source anchors are invalid: ${JSON.stringify(anchorMarkup)}`);
  }

  
  const runImageZoomSmoke = /**
   * スモーク検証・高速の処理順序と完了状態を管理する。
   * @returns スモーク検証・高速のrun・image・zoom・smokeが生成する結果。
   */ async () => {
    const zoomImage = page.locator('.split-preview img[data-mve-image-kind="html"]').first();
    await zoomImage.waitFor();
    await zoomImage.scrollIntoViewIfNeeded();
    await page.waitForFunction(
    /**
     * ブラウザー内に「.split-preview img[data-mve-image-kind=」が現れるまで待機する。
     * @returns スモーク検証・高速のコールバックが生成する結果。
     */
    () => {
      const image = document.querySelector('.split-preview img[data-mve-image-kind="html"]');
      return Boolean(image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
        && image.closest('.mve-image-frame'));
    });
    const imageZoomBefore = await page.evaluate(
    /**
     * ブラウザー内の「.split-preview img[data-mve-image-kind=」を読み取り、検証用の値へ変換する。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    () => {
      const image = document.querySelector('.split-preview img[data-mve-image-kind="html"]');
      const frame = image?.closest('.mve-image-frame');
      return {
        frameWidth: frame?.getBoundingClientRect().width ?? 0,
        logicalWidth: Number.parseFloat((frame instanceof HTMLElement ? frame.style.width : '') || '0'),
        sourceWidth: image?.getAttribute('width'),
        zoom: document.querySelector('.split-preview .rendered-markdown')?.getAttribute('data-mve-image-zoom'),
        sourceText: window.__mveHostText
      };
    });
    if (Math.abs(imageZoomBefore.frameWidth - 160) > 2
      || imageZoomBefore.logicalWidth !== 160
      || imageZoomBefore.sourceWidth !== '160'
      || imageZoomBefore.zoom !== '1') {
      throw new Error(`image zoom baseline was invalid: ${JSON.stringify(imageZoomBefore)}`);
    }
    const imageZoomStatusBefore = await page.locator('.status-bar').textContent();
    await page.locator('.editor-area').dispatchEvent('wheel', { deltaY: -100, ctrlKey: true });
    await page.waitForFunction(
    /**
     * ブラウザー内に「.status-bar」が現れるまで待機する。
     * @param value - ブラウザー内で評価するコールバック。
     * @returns スモーク検証・高速のコールバックが生成する結果。
     */
    (value) => document.querySelector('.status-bar')?.textContent !== value, imageZoomStatusBefore);
    await page.waitForFunction(
    /**
     * ブラウザー内に「.split-preview .rendered-markdown」が現れるまで待機する。
     * @returns スモーク検証・高速のコールバックが生成する結果。
     */
    () => document.querySelector('.split-preview .rendered-markdown')?.getAttribute('data-mve-image-zoom') === '1.1');
    const imageZoomAfter = await page.evaluate(
    /**
     * ブラウザー内の「.split-preview img[data-mve-image-kind=」を読み取り、検証用の値へ変換する。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    () => {
      const image = document.querySelector('.split-preview img[data-mve-image-kind="html"]');
      const frame = image?.closest('.mve-image-frame');
      return {
        frameWidth: frame?.getBoundingClientRect().width ?? 0,
        logicalWidth: Number.parseFloat((frame instanceof HTMLElement ? frame.style.width : '') || '0'),
        sourceWidth: image?.getAttribute('width'),
        sourceText: window.__mveHostText
      };
    });
    if (Math.abs(imageZoomAfter.frameWidth - 176) > 2
      || imageZoomAfter.logicalWidth !== 160
      || imageZoomAfter.sourceWidth !== '160'
      || imageZoomAfter.sourceText !== imageZoomBefore.sourceText) {
      throw new Error(`image did not follow preview zoom without changing Markdown: ${JSON.stringify(imageZoomBefore)} -> ${JSON.stringify(imageZoomAfter)}`);
    }
    const imageResizeSourceBefore = await page.evaluate(
    /**
     * Host側の本文状態を読み取り、検証用の値へ変換する。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    () => window.__mveHostText);
    const imageResizeHandle = page.locator('.split-preview .mve-image-handle').first();
    await imageResizeHandle.hover();
    const imageResizeHandleBounds = await imageResizeHandle.boundingBox();
    if (!imageResizeHandleBounds) throw new Error('image resize handle is not visible during zoom smoke');
    await page.mouse.move(imageResizeHandleBounds.x + imageResizeHandleBounds.width / 2, imageResizeHandleBounds.y + imageResizeHandleBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(imageResizeHandleBounds.x + imageResizeHandleBounds.width / 2 + 22, imageResizeHandleBounds.y + imageResizeHandleBounds.height / 2);
    await page.mouse.up();
    await page.waitForFunction(
    /**
     * Host側の本文状態が完了条件を満たすまで待機する。
     * @param text - ブラウザー内で評価するコールバック。
     * @returns スモーク検証・高速のコールバックが生成する結果。
     */
    (text) => window.__mveHostText !== text, imageResizeSourceBefore);
    if (!(await page.evaluate(
    /**
     * Host側の本文状態のincludes結果を読み取り、検証用の値へ変換する。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    () => window.__mveHostText.includes('width="180"')))) {
      throw new Error(`image resize while zoomed did not save a logical width: ${await page.evaluate(
      /**
       * Host側の本文状態を読み取り、検証用の値へ変換する。
       * @returns ブラウザー内で読み取った値または変換結果。
       */
      () => window.__mveHostText)}`);
    }
    await page.waitForFunction(
    /**
     * ブラウザー内に「.split-preview img[data-mve-image-kind=」が現れるまで待機する。
     * @returns スモーク検証・高速のコールバックが生成する結果。
     */
    () => {
      const image = document.querySelector('.split-preview img[data-mve-image-kind="html"]');
      const frame = image?.closest('.mve-image-frame');
      return Boolean(image?.getAttribute('width') === '180'
        && frame instanceof HTMLElement
        && frame.style.width === '180px'
        && Math.abs(frame.getBoundingClientRect().width - 198) <= 2);
    });
    const imageZoomStatusBeforeShrink = await page.locator('.status-bar').textContent();
    await page.locator('.editor-area').dispatchEvent('wheel', { deltaY: 100, ctrlKey: true });
    await page.waitForFunction(
    /**
     * ブラウザー内に「.status-bar」が現れるまで待機する。
     * @param value - ブラウザー内で評価するコールバック。
     * @returns スモーク検証・高速のコールバックが生成する結果。
     */
    (value) => document.querySelector('.status-bar')?.textContent !== value, imageZoomStatusBeforeShrink);
    await page.waitForFunction(
    /**
     * ブラウザー内に「.split-preview .rendered-markdown」が現れるまで待機する。
     * @returns スモーク検証・高速のコールバックが生成する結果。
     */
    () => document.querySelector('.split-preview .rendered-markdown')?.getAttribute('data-mve-image-zoom') === '1');
    const imageZoomAfterShrink = await page.evaluate(
    /**
     * ブラウザー内の「.split-preview img[data-mve-image-kind=」を読み取り、検証用の値へ変換する。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    () => {
      const image = document.querySelector('.split-preview img[data-mve-image-kind="html"]');
      const frame = image?.closest('.mve-image-frame');
      return {
        frameWidth: frame?.getBoundingClientRect().width ?? 0,
        logicalWidth: Number.parseFloat((frame instanceof HTMLElement ? frame.style.width : '') || '0'),
        sourceWidth: image?.getAttribute('width')
      };
    });
    if (Math.abs(imageZoomAfterShrink.frameWidth - 180) > 2
      || imageZoomAfterShrink.logicalWidth !== 180
      || imageZoomAfterShrink.sourceWidth !== '180') {
      throw new Error(`image did not return to its logical display width after zoom out: ${JSON.stringify(imageZoomAfterShrink)}`);
    }
    const imageZoomStatusBeforeRegrow = await page.locator('.status-bar').textContent();
    await page.locator('.editor-area').dispatchEvent('wheel', { deltaY: -100, ctrlKey: true });
    await page.waitForFunction(
    /**
     * ブラウザー内に「.status-bar」が現れるまで待機する。
     * @param value - ブラウザー内で評価するコールバック。
     * @returns スモーク検証・高速のコールバックが生成する結果。
     */
    (value) => document.querySelector('.status-bar')?.textContent !== value, imageZoomStatusBeforeRegrow);
    await page.waitForFunction(
    /**
     * ブラウザー内に「.split-preview .rendered-markdown」が現れるまで待機する。
     * @returns スモーク検証・高速のコールバックが生成する結果。
     */
    () => document.querySelector('.split-preview .rendered-markdown')?.getAttribute('data-mve-image-zoom') === '1.1');
    const imageZoomAfterRegrow = await page.evaluate(
    /**
     * ブラウザー内の「.split-preview img[data-mve-image-kind=」を読み取り、検証用の値へ変換する。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    () => {
      const image = document.querySelector('.split-preview img[data-mve-image-kind="html"]');
      const frame = image?.closest('.mve-image-frame');
      return {
        frameWidth: frame?.getBoundingClientRect().width ?? 0,
        logicalWidth: Number.parseFloat((frame instanceof HTMLElement ? frame.style.width : '') || '0'),
        sourceWidth: image?.getAttribute('width')
      };
    });
    if (Math.abs(imageZoomAfterRegrow.frameWidth - 198) > 2
      || imageZoomAfterRegrow.logicalWidth !== 180
      || imageZoomAfterRegrow.sourceWidth !== '180') {
      throw new Error(`image was double-scaled after preview redraw and zoom cycle: ${JSON.stringify(imageZoomAfterRegrow)}`);
    }
    const imageZoomStatusAfterRegrow = await page.locator('.status-bar').textContent();
    await page.locator('.editor-area').dispatchEvent('wheel', { deltaY: 100, ctrlKey: true });
    await page.waitForFunction(
    /**
     * ブラウザー内に「.status-bar」が現れるまで待機する。
     * @param value - ブラウザー内で評価するコールバック。
     * @returns スモーク検証・高速のコールバックが生成する結果。
     */
    (value) => document.querySelector('.status-bar')?.textContent !== value, imageZoomStatusAfterRegrow);
    await page.waitForFunction(
    /**
     * ブラウザー内に「.split-preview .rendered-markdown」が現れるまで待機する。
     * @returns スモーク検証・高速のコールバックが生成する結果。
     */
    () => document.querySelector('.split-preview .rendered-markdown')?.getAttribute('data-mve-image-zoom') === '1');
    const imageZoomRestored = await page.evaluate(
    /**
     * ブラウザー内の「.split-preview img[data-mve-image-kind=」を読み取り、検証用の値へ変換する。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    () => {
      const image = document.querySelector('.split-preview img[data-mve-image-kind="html"]');
      const frame = image?.closest('.mve-image-frame');
      return {
        frameWidth: frame?.getBoundingClientRect().width ?? 0,
        logicalWidth: Number.parseFloat((frame instanceof HTMLElement ? frame.style.width : '') || '0'),
        sourceWidth: image?.getAttribute('width')
      };
    });
    if (Math.abs(imageZoomRestored.frameWidth - 180) > 2
      || imageZoomRestored.logicalWidth !== 180
      || imageZoomRestored.sourceWidth !== '180') {
      throw new Error(`image state was not restored to 100% after zoom smoke: ${JSON.stringify(imageZoomRestored)}`);
    }
    await page.locator('.split-preview').evaluate(
    /**
     * ブラウザー内の状態を読み取り、検証用の値へ変換する。
     * @param element - ブラウザー内で評価するコールバック。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    (element) => { element.scrollTop = 0; });
  };
  // 表エディターの実UIと、変更なし適用時の同期抑止を確認する。
  const sourceEditor = page.locator('.split-editor .cm-content');
  const cutLine = page.locator('.split-editor .cm-line').filter({ hasText: 'Reference [link]' }).first();
  await cutLine.click();
  await sourceEditor.press('Home');
  await sourceEditor.press('Shift+End');
  const beforeCutText = await page.evaluate(
  /**
   * Host側の本文状態を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveHostText);
  await sourceEditor.press('Control+X');
  await page.waitForFunction(
  /**
   * Host側の本文状態が完了条件を満たすまで待機する。
   * @param text - ブラウザー内で評価するコールバック。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (text) => window.__mveHostText !== text, beforeCutText);
  if (await page.evaluate(
  /**
   * Host側の本文状態のincludes結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveHostText.includes('Reference [link]'))) throw new Error('Ctrl+X did not delete the selected line');
  await sourceEditor.press('Control+Z');
  await page.waitForFunction(
  /**
   * Host側の本文状態が完了条件を満たすまで待機する。
   * @param text - ブラウザー内で評価するコールバック。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (text) => window.__mveHostText === text, beforeCutText);
  await page.locator('.split-editor .cm-line').filter({ hasText: 'Reference [link]' }).first().waitFor();
  await sourceEditor.click();
  await sourceEditor.press('Control+End');
  const tableSourceLine = page.locator('.split-editor .cm-line').filter({ hasText: '| old | old2 |' }).first();
  await tableSourceLine.click();
  await page.getByRole('tab', { name: '表', exact: true }).click();
  await page.getByRole('button', { name: '表を編集', exact: true }).click();
  await page.locator('.mve-table-editor').waitFor();
  if (await page.locator('.mve-table-editor-grid tbody tr').count() !== 2) throw new Error('table editor did not read the table');
  const tableEditorGuide = await page.locator('.mve-table-editor-status').textContent();
  if (!tableEditorGuide?.includes('Alt+Enter') || !tableEditorGuide.includes('<br>')) {
    throw new Error(`table editor Alt+Enter guide is missing: ${JSON.stringify(tableEditorGuide)}`);
  }
  const cellBreakButton = page.getByRole('group', { name: 'Excel連携', exact: true })
    .getByRole('button', { name: 'セル内改行', exact: true });
  if (!(await cellBreakButton.getAttribute('title'))?.includes('Alt+Enter')) {
    throw new Error('table editor cell break button does not describe the Alt+Enter shortcut');
  }
  const tableEditorSize = await page.locator('.mve-table-editor').evaluate(
  /**
   * ブラウザー内の状態のget・bounding・client・rect結果を読み取り、検証用の値へ変換する。
   * @param element - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (element) => {
    const bounds = element.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  });
  if (tableEditorSize.width < 900 || tableEditorSize.height < 620) {
    throw new Error(`table editor default size was not expanded: ${JSON.stringify(tableEditorSize)}`);
  }
  for (const label of ['列コピー', '行コピー']) {
    if (await page.getByRole('button', { name: label, exact: true }).count() !== 1) {
      throw new Error(`table editor copy button is missing: ${label}`);
    }
  }
  if (await page.getByRole('group', { name: '行', exact: true }).getByRole('button', { name: '行コピー', exact: true }).count() !== 1) {
    throw new Error('table editor row copy is not in the row operations group');
  }
  if (await page.getByRole('group', { name: '列', exact: true }).getByRole('button', { name: '列コピー', exact: true }).count() !== 1) {
    throw new Error('table editor column copy is not in the column operations group');
  }
  if (await page.getByRole('group', { name: 'Excel連携', exact: true }).getByRole('button', { name: '行コピー', exact: true }).count() !== 0
    || await page.getByRole('group', { name: 'Excel連携', exact: true }).getByRole('button', { name: '列コピー', exact: true }).count() !== 0) {
    throw new Error('table editor row/column copy remains in the Excel integration group');
  }
  const altEnterCell = page.locator('[data-table-cell="1:0"]');
  await altEnterCell.click();
  await altEnterCell.press('End');
  const hostBeforeAltEnter = await page.evaluate(
  /**
   * Host側の本文状態を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveHostText);
  const rowHeightBeforeAltEnter = Number(await page.locator('.mve-table-editor-row-resizer').nth(1).getAttribute('aria-valuenow'));
  await altEnterCell.press('Alt+Enter');
  await page.waitForFunction(
  /**
   * ブラウザー内に「[data-table-cell=」が現れるまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => {
    const value = document.querySelector('[data-table-cell="1:0"]')?.value ?? '';
    return value.includes('<br>') && value.includes('\n');
  });
  await page.waitForFunction(
  /**
   * ブラウザー内に「.mve-table-editor-row-resizer」が現れるまで待機する。
   * @param before - ブラウザー内で評価するコールバック。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (before) => Number(document.querySelectorAll('.mve-table-editor-row-resizer')[1]?.getAttribute('aria-valuenow')) > before, rowHeightBeforeAltEnter);
  const altEnterCellMetrics = await altEnterCell.evaluate(
  /**
   * ブラウザー内の「.mve-table-editor-row-resizer」を読み取り、検証用の値へ変換する。
   * @param element - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (element) => ({
    value: element.value,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    rowHeight: element.closest('tr')?.querySelector('.mve-table-editor-row-resizer')?.getAttribute('aria-valuenow'),
  }));
  if (altEnterCellMetrics.scrollHeight > altEnterCellMetrics.clientHeight) {
    throw new Error(`table editor Alt+Enter cell is clipped: ${JSON.stringify(altEnterCellMetrics)}`);
  }
  if (await page.evaluate(
  /**
   * Host側の本文状態を読み取り、検証用の値へ変換する。
   * @param text - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (text) => window.__mveHostText !== text, hostBeforeAltEnter)) throw new Error('table editor Alt+Enter changed the source document before Apply');
  const rowHeightAfterAltEnter = Number(await page.locator('.mve-table-editor-row-resizer').nth(1).getAttribute('aria-valuenow'));
  if (rowHeightAfterAltEnter <= rowHeightBeforeAltEnter) throw new Error(`Alt+Enter did not expand the table row: ${rowHeightBeforeAltEnter}->${rowHeightAfterAltEnter}`);
  await page.getByRole('button', { name: '適用', exact: true }).click();
  await page.locator('.mve-table-editor').waitFor({ state: 'detached' });
  await page.waitForFunction(
  /**
   * Host側の本文状態が完了条件を満たすまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => window.__mveHostText.includes('| old<br> | old2 |'));
  await sourceEditor.press('Control+Z');
  await page.waitForFunction(
  /**
   * Host側の本文状態が完了条件を満たすまで待機する。
   * @param text - ブラウザー内で評価するコールバック。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (text) => window.__mveHostText === text, hostBeforeAltEnter);
  await page.getByRole('button', { name: '表を編集', exact: true }).click();
  await page.locator('.mve-table-editor').waitFor();
  await page.getByRole('button', { name: '行コピー', exact: true }).click();
  if (await page.locator('.mve-table-editor-grid tbody tr').count() !== 3) throw new Error('table editor row copy did not duplicate the selected row');
  const copiedRowState = await page.locator('.mve-table-editor-grid tbody tr').evaluateAll(
  /**
   * table・rowsをmapへ渡し、スモーク検証・高速の結果または副作用を処理する。
   * @param tableRows - スモーク検証・高速で走査または更新する要素。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (tableRows) =>
    tableRows.map(
    /**
     * 各行から対象DOM要素を抽出して一覧化する。
     * @param row - 行のquery・selector・allを参照する走査対象。
     * @returns query・selector・allを取り出した変換結果の一覧。
     */
    (row) => [...row.querySelectorAll('textarea')].map(
    /**
     * 各セルから値を取り出して一覧化する。
     * @param cell - セルの値を参照する走査対象。
     * @returns 値を取り出した変換結果の一覧。
     */
    (cell) => cell.value))
  );
  if (!copiedRowState.some(
  /**
   * 行をstringifyへ渡し、スモーク検証・高速の結果または副作用を処理する。
   * @param row - スモーク検証・高速で走査または更新する要素。
   * @param index - 配列・行列・文字列の要素位置を示す番号。
   * @returns スモーク検証・高速で利用する文字列。
   */
  (row, index) => index > 0 && JSON.stringify(row) === JSON.stringify(copiedRowState[index - 1]))) {
    throw new Error(`table editor row copy did not preserve row values: ${JSON.stringify(copiedRowState)}`);
  }
  await page.getByRole('button', { name: '列コピー', exact: true }).click();
  const copiedColumnCount = await page.locator('.mve-table-editor-grid col').count();
  if (copiedColumnCount !== 5) throw new Error(`table editor column copy did not duplicate the selected column range: ${copiedColumnCount}`);
  const copiedColumnState = await page.locator('.mve-table-editor-grid tbody tr').first().locator('textarea').evaluateAll(
  /**
   * cellsをmapへ渡し、スモーク検証・高速の結果または副作用を処理する。
   * @param cells - スモーク検証・高速で走査または更新する要素。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (cells) => cells.map(
  /**
   * 各セルから値を取り出して一覧化する。
   * @param cell - セルの値を参照する走査対象。
   * @returns 値を取り出した変換結果の一覧。
   */
  (cell) => cell.value));
  if (copiedColumnState.length !== 4 || JSON.stringify(copiedColumnState.slice(0, 2)) !== JSON.stringify(copiedColumnState.slice(2))) {
    throw new Error(`table editor column copy did not preserve column values: ${JSON.stringify(copiedColumnState)}`);
  }
  page.once('dialog',
  /**
   * dialogをacceptへ渡し、スモーク検証・高速の結果または副作用を処理する。
   * @param dialog - スモーク検証・高速へ渡す入力。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await page.locator('.mve-table-editor').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '表を編集', exact: true }).click();
  await page.locator('.mve-table-editor').waitFor();
  if (await page.locator('.mve-table-editor-grid tbody tr').count() !== 2) throw new Error('table editor copy smoke setup was not reset');
  await page.locator('th.mve-table-editor-row-selector').first().click();
  if (!(await page.getByRole('button', { name: '行コピー', exact: true }).isDisabled())) throw new Error('table editor header row copy should be disabled');
  await page.locator('[data-table-cell="1:0"]').click();
  await page.getByRole('button', { name: '＋行', exact: true }).click();
  if (await page.locator('.mve-table-editor-grid tbody tr').count() !== 3) throw new Error('table editor row draft action did not apply once');
  for (let index = 0; index < 4; index += 1) {
    await page.getByRole('button', { name: '＋列', exact: true }).click();
  }
  const tableColumnBefore = await page.locator('.mve-table-editor-grid col').nth(1).evaluate(
  /**
   * ブラウザー内の状態のget・bounding・client・rect結果を読み取り、検証用の値へ変換する。
   * @param element - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (element) => element.getBoundingClientRect().width);
  const columnResizer = page.locator('.mve-table-editor-column-resizer').first();
  const tableColumnStateBefore = Number(await columnResizer.getAttribute('aria-valuenow'));
  for (let step = 1; step <= 4; step += 1) {
    await columnResizer.press('ArrowRight');
    await page.waitForFunction(
    /**
     * ブラウザー内に「.mve-table-editor-column-resizer」が現れるまで待機する。
     * @param expected - ブラウザー内で評価するコールバック。
     * @returns スモーク検証・高速のコールバックが生成する結果。
     */
    (expected) => Number(document.querySelector('.mve-table-editor-column-resizer')?.getAttribute('aria-valuenow')) === expected, tableColumnStateBefore + step * 12);
  }
  const tableColumnAfter = await page.locator('.mve-table-editor-grid col').nth(1).evaluate(
  /**
   * ブラウザー内の状態のget・bounding・client・rect結果を読み取り、検証用の値へ変換する。
   * @param element - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (element) => element.getBoundingClientRect().width);
  const tableColumnStateAfter = Number(await columnResizer.getAttribute('aria-valuenow'));
  if (tableColumnStateAfter !== tableColumnStateBefore + 48 || tableColumnAfter <= tableColumnBefore) {
    throw new Error(`table editor column did not resize: state=${tableColumnStateBefore}->${tableColumnStateAfter}, rendered=${tableColumnBefore}->${tableColumnAfter}`);
  }
  const autoFitCell = page.locator('[data-table-cell="1:0"]');
  await autoFitCell.fill('auto fit content '.repeat(10));
  const autoFitColumnBefore = Number(await columnResizer.getAttribute('aria-valuenow'));
  await columnResizer.click();
  await page.waitForFunction(
  /**
   * ブラウザー内に「.mve-table-editor-column-resizer」が現れるまで待機する。
   * @param before - ブラウザー内で評価するコールバック。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (before) => Number(document.querySelector('.mve-table-editor-column-resizer')?.getAttribute('aria-valuenow')) > before, autoFitColumnBefore);
  const autoFitColumnAfter = Number(await columnResizer.getAttribute('aria-valuenow'));
  if (autoFitColumnAfter <= autoFitColumnBefore) {
    throw new Error(`table editor column auto-fit did not apply: state=${autoFitColumnBefore}->${autoFitColumnAfter}`);
  }
  const rowResizer = page.locator('.mve-table-editor-row-resizer').nth(1);
  const rowHeightBefore = Number(await rowResizer.getAttribute('aria-valuenow'));
  await autoFitCell.fill('line one<br>line two');
  await rowResizer.click();
  await page.waitForFunction(
  /**
   * ブラウザー内に「.mve-table-editor-row-resizer」が現れるまで待機する。
   * @param before - ブラウザー内で評価するコールバック。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (before) => Number(document.querySelectorAll('.mve-table-editor-row-resizer')[1]?.getAttribute('aria-valuenow')) > before, rowHeightBefore);
  const rowHeightAfter = Number(await rowResizer.getAttribute('aria-valuenow'));
  if (rowHeightAfter <= rowHeightBefore) {
    throw new Error(`table editor row auto-fit did not apply: state=${rowHeightBefore}->${rowHeightAfter}`);
  }
  const autoFitRowMetrics = await autoFitCell.evaluate(
  /**
   * ブラウザー内の状態を読み取り、検証用の値へ変換する。
   * @param element - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (element) => ({
    value: element.value,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  if (autoFitRowMetrics.scrollHeight > autoFitRowMetrics.clientHeight) {
    throw new Error(`table editor auto-fit row is clipped: ${JSON.stringify(autoFitRowMetrics)}`);
  }
  page.once('dialog',
  /**
   * dialogをacceptへ渡し、スモーク検証・高速の結果または副作用を処理する。
   * @param dialog - スモーク検証・高速へ渡す入力。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await page.locator('.mve-table-editor').waitFor({ state: 'detached' });
  const noOpMessageStart = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveMessages.length);
  await page.getByRole('button', { name: '表を編集', exact: true }).click();
  await page.getByRole('button', { name: '適用', exact: true }).click();
  await page.waitForTimeout(300);
  const noOpLocalChanges = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態のslice結果を読み取り、検証用の値へ変換する。
   * @param start - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (start) => window.__mveMessages
    .slice(start).filter(
    /**
     * 種別「localChanges」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'localChanges'), noOpMessageStart);
  if (noOpLocalChanges.length !== 0) throw new Error(`untouched table apply emitted synchronization: ${JSON.stringify(noOpLocalChanges)}`);
  const editMessageStart = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveMessages.length);
  await page.getByRole('button', { name: '表を編集', exact: true }).click();
  await page.locator('[data-table-cell="1:0"]').click();
  const editableCell = page.locator('[data-table-cell="1:0"]');
  await editableCell.fill('alpha<br>beta');
  await editableCell.evaluate(
  /**
   * ブラウザー内の状態のindex・of結果を読み取り、検証用の値へ変換する。
   * @param element - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (element) => {
    const start = element.value.indexOf('<br>');
    element.focus();
    element.setSelectionRange(start + '<br>'.length, start + '<br>'.length);
  });
  await editableCell.press('Backspace');
  const naturalDeleteValue = await editableCell.inputValue();
  if (naturalDeleteValue !== 'alphabeta') {
    throw new Error(`backspace at the visible <br> boundary produced: ${JSON.stringify(naturalDeleteValue)}`);
  }
  await editableCell.fill('alpha<br>beta');
  await editableCell.evaluate(
  /**
   * ブラウザー内の状態のindex・of結果を読み取り、検証用の値へ変換する。
   * @param element - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (element) => {
    const start = element.value.indexOf('<br>');
    element.focus();
    element.setSelectionRange(start + '<br>'.length + 1, start + '<br>'.length + 1);
  });
  await editableCell.press('Backspace');
  await page.waitForFunction(
  /**
   * ブラウザー内に「[data-table-cell=」が現れるまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => document.querySelector('[data-table-cell="1:0"]')?.value === 'alphabeta');
  await editableCell.fill('alpha<br>beta');
  await editableCell.evaluate(
  /**
   * ブラウザー内の状態のindex・of結果を読み取り、検証用の値へ変換する。
   * @param element - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (element) => {
    const start = element.value.indexOf('<br>');
    element.focus();
    element.setSelectionRange(start, start + '<br>'.length);
  });
  await editableCell.press('Backspace');
  await page.waitForFunction(
  /**
   * ブラウザー内に「[data-table-cell=」が現れるまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => document.querySelector('[data-table-cell="1:0"]')?.value === 'alphabeta');
  if ((await editableCell.inputValue()).includes('<br><br>')) {
    throw new Error(`deleting a visible <br> duplicated it: ${await editableCell.inputValue()}`);
  }
  await editableCell.fill('beforeafter');
  await page.getByRole('group', { name: 'Excel連携', exact: true })
    .getByRole('button', { name: 'セル内改行', exact: true })
    .click();
  const toolbarCellBreakValue = await page.locator('[data-table-cell="1:0"]').inputValue();
  if (!toolbarCellBreakValue.includes('<br>') || !toolbarCellBreakValue.includes('\n')) {
    throw new Error(`table editor cell break did not render a newline: ${JSON.stringify(toolbarCellBreakValue)}`);
  }
  await page.getByRole('button', { name: '適用', exact: true }).click();
  try {
    await page.waitForFunction(
    /**
     * Host側の本文状態が完了条件を満たすまで待機する。
     * @returns スモーク検証・高速のコールバックが生成する結果。
     */
    () => window.__mveHostText.includes('| beforeafter<br> | old2 |'));
  } catch (error) {
    const state = await page.evaluate(
    /**
     * HostとWebviewのメッセージ状態のslice結果を読み取り、検証用の値へ変換する。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    () => ({
      hostTail: window.__mveHostText.slice(-300),
      messages: window.__mveMessages.slice(-5)
    }));
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nTable edit state: ${JSON.stringify(state)}`);
  }
  const tableEditMessages = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態のslice結果を読み取り、検証用の値へ変換する。
   * @param start - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (start) => window.__mveMessages
    .slice(start).filter(
    /**
     * 種別「localChanges」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'localChanges'), editMessageStart);
  if (tableEditMessages.length !== 1) throw new Error(`table apply emitted ${tableEditMessages.length} synchronization operations`);
  const lineBreakMessageStart = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveMessages.length);
  await page.getByRole('button', { name: '表を編集', exact: true }).click();
  await page.locator('[data-table-cell="1:0"]').fill('new');
  await page.getByRole('button', { name: '適用', exact: true }).click();
  await page.waitForFunction(
  /**
   * Host側の本文状態が完了条件を満たすまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => window.__mveHostText.includes('| new | old2 |'));
  const lineBreakMessages = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態のslice結果を読み取り、検証用の値へ変換する。
   * @param start - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (start) => window.__mveMessages
    .slice(start).filter(
    /**
     * 種別「localChanges」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'localChanges'), lineBreakMessageStart);
  if (lineBreakMessages.length !== 1) throw new Error(`follow-up table apply emitted ${lineBreakMessages.length} synchronization operations`);
  await page.getByRole('tab', { name: 'ホーム', exact: true }).click();
  const editorNode = await page.locator('.split-editor .cm-editor').elementHandle();
  const sourceEditMessageStart = await page.evaluate(
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
  (message) => message.type === 'localChanges').length);
  await sourceEditor.click();
  await sourceEditor.press('Control+Home');
  await sourceEditor.press('ArrowDown');
  await sourceEditor.press('ArrowDown');
  await sourceEditor.press('ArrowDown');
  await sourceEditor.press('End');
  await sourceEditor.type('  \nX');
  await page.waitForFunction(
  /**
   * Host側の本文状態が完了条件を満たすまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => window.__mveHostText.includes('second  \n'));
  if ((await page.evaluate(
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
  (message) => message.type === 'localChanges').length)) <= sourceEditMessageStart) {
    throw new Error('source edit did not emit a synchronization operation');
  }
  const beforeRibbonUndo = await page.evaluate(
  /**
   * Host側の本文状態を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveHostText);
  await sourceEditor.press('Z');
  await page.waitForFunction(
  /**
   * Host側の本文状態が完了条件を満たすまで待機する。
   * @param text - ブラウザー内で評価するコールバック。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (text) => window.__mveHostText.length === text.length + 1, beforeRibbonUndo);
  await page.locator('button[title^="元に戻す"]').click();
  await page.waitForFunction(
  /**
   * Host側の本文状態が完了条件を満たすまで待機する。
   * @param text - ブラウザー内で評価するコールバック。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (text) => window.__mveHostText === text, beforeRibbonUndo);
  await page.locator('button[title^="やり直す"]').click();
  await page.waitForFunction(
  /**
   * Host側の本文状態が完了条件を満たすまで待機する。
   * @param text - ブラウザー内で評価するコールバック。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (text) => window.__mveHostText.length === text.length + 1, beforeRibbonUndo);
  const beforeKeyboardUndo = await page.evaluate(
  /**
   * Host側の本文状態を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveHostText);
  await sourceEditor.click();
  await sourceEditor.press('Q');
  await page.waitForFunction(
  /**
   * Host側の本文状態が完了条件を満たすまで待機する。
   * @param text - ブラウザー内で評価するコールバック。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (text) => window.__mveHostText.length === text.length + 1, beforeKeyboardUndo);
  await sourceEditor.press('Control+Z');
  await page.waitForFunction(
  /**
   * Host側の本文状態が完了条件を満たすまで待機する。
   * @param text - ブラウザー内で評価するコールバック。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (text) => window.__mveHostText === text, beforeKeyboardUndo);
  await sourceEditor.press('Control+Shift+Z');
  await page.waitForFunction(
  /**
   * Host側の本文状態が完了条件を満たすまで待機する。
   * @param text - ブラウザー内で評価するコールバック。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (text) => window.__mveHostText.length === text.length + 1, beforeKeyboardUndo);
  await sourceEditor.press('Control+Z');
  await page.waitForFunction(
  /**
   * Host側の本文状態が完了条件を満たすまで待機する。
   * @param text - ブラウザー内で評価するコールバック。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (text) => window.__mveHostText.length === text.length, beforeKeyboardUndo);
  await sourceEditor.press('Control+Z');
  await page.waitForFunction(
  /**
   * Host側の本文状態が完了条件を満たすまで待機する。
   * @param text - ブラウザー内で評価するコールバック。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (text) => window.__mveHostText === text, beforeRibbonUndo);
  await page.evaluate(
  /**
   * Webviewの実行状態を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    window.__mveDebugEnabled = true;
    window.__mveDebugLog = [];
  });
  await sourceEditor.press('Control+Home');
  await sourceEditor.press('ArrowDown');
  await sourceEditor.press('ArrowDown');
  await sourceEditor.press('ArrowDown');
  await sourceEditor.press('ArrowDown');
  await sourceEditor.press('End');
  await page.waitForTimeout(50);
  if (!(await page.evaluate(
  /**
   * ブラウザー内の「.split-editor .cm-editor」を読み取り、検証用の値へ変換する。
   * @param node - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (node) => node === document.querySelector('.split-editor .cm-editor'), editorNode))) throw new Error('blank-line edit remounted the source editor');
  await page.locator('.cm-scroller').dispatchEvent('wheel', { deltaY: 1 });
  await page.locator('.split-preview').dispatchEvent('wheel', { deltaY: 1 });
  await page.locator('.cm-scroller').evaluate(
  /**
   * ブラウザー内の状態を読み取り、検証用の値へ変換する。
   * @param element - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (element) => { element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.7; });
  await page.locator('.split-preview').evaluate(
  /**
   * ブラウザー内の状態を読み取り、検証用の値へ変換する。
   * @param element - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (element) => { element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.7; });
  await page.waitForTimeout(200);
  const beforeExternal = await page.evaluate(
  /**
   * ブラウザー内の「.split-preview」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    const preview = document.querySelector('.split-preview');
    const bounds = preview?.getBoundingClientRect();
    const hit = bounds
      ? document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + 1)
      : undefined;
    const block = hit?.closest('[data-source-from]')
      ?? [...(preview?.querySelectorAll('[data-source-from]') ?? [])]
        .find(
        /**
         * get・bounding・client・rectが条件に一致する最初の要素を取得する。
         * @param element - 要素のget・bounding・client・rectを参照する走査対象。
         * @returns 条件に一致した最初の要素。未検出時はundefined。
         */
        (element) => element.getBoundingClientRect().bottom > (bounds?.top ?? 0) + 1);
    const blockBounds = block?.getBoundingClientRect();
    return {
      source: document.querySelector('.cm-scroller')?.scrollTop ?? 0,
      preview: preview?.scrollTop ?? 0,
      previewOffset: Number(block?.getAttribute('data-source-from')),
      previewTopOffset: (blockBounds?.top ?? 0) - (bounds?.top ?? 0)
    };
  });
  const externalLength = await page.evaluate(
  /**
   * Host側の本文状態のdispatch・event結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    const baseVersion = window.__mveHostVersion;
    const change = { rangeOffset: window.__mveHostText.length, rangeLength: 0, text: '\nexternal-host-change' };
    window.__mveHostText += change.text;
    window.__mveHostVersion += 1;
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'externalChanges', baseVersion, version: window.__mveHostVersion, changes: [change] }
    }));
    return window.__mveHostText.length;
  });
  await page.waitForFunction(
  /**
   * ブラウザー内に「.split-preview .rendered-markdown」が現れるまで待機する。
   * @param length - ブラウザー内で評価するコールバック。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (length) => (
    Number(document.querySelector('.split-preview .rendered-markdown')?.getAttribute('data-document-length')) === length
  ), externalLength);
  await page.waitForTimeout(100);
  const afterExternal = await page.evaluate(
  /**
   * ブラウザー内の「.split-preview」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    const preview = document.querySelector('.split-preview');
    const bounds = preview?.getBoundingClientRect();
    const hit = bounds
      ? document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + 1)
      : undefined;
    const block = hit?.closest('[data-source-from]')
      ?? [...(preview?.querySelectorAll('[data-source-from]') ?? [])]
        .find(
        /**
         * get・bounding・client・rectが条件に一致する最初の要素を取得する。
         * @param element - 要素のget・bounding・client・rectを参照する走査対象。
         * @returns 条件に一致した最初の要素。未検出時はundefined。
         */
        (element) => element.getBoundingClientRect().bottom > (bounds?.top ?? 0) + 1);
    const blockBounds = block?.getBoundingClientRect();
    return {
      source: document.querySelector('.cm-scroller')?.scrollTop ?? 0,
      preview: preview?.scrollTop ?? 0,
      previewOffset: Number(block?.getAttribute('data-source-from')),
      previewTopOffset: (blockBounds?.top ?? 0) - (bounds?.top ?? 0),
      debug: (window.__mveDebugLog ?? []).slice(-80)
    };
  });
  if (Math.abs(afterExternal.source - beforeExternal.source) > 1) throw new Error(`host synchronization moved source scroll: ${beforeExternal.source} -> ${afterExternal.source}`);
  if (afterExternal.previewOffset !== beforeExternal.previewOffset
    || Math.abs(afterExternal.previewTopOffset - beforeExternal.previewTopOffset) > 1) {
    throw new Error(`host synchronization moved preview viewport: ${JSON.stringify(beforeExternal)} -> ${JSON.stringify(afterExternal)}`);
  }
  const beforeTopInsertion = await page.evaluate(
  /**
   * ブラウザー内の「.split-preview」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    const preview = document.querySelector('.split-preview');
    const previewBounds = preview?.getBoundingClientRect();
    const hit = previewBounds
      ? document.elementFromPoint(previewBounds.left + previewBounds.width / 2, previewBounds.top + 1)
      : undefined;
    const previewBlock = hit?.closest('[data-source-from]')
      ?? [...(preview?.querySelectorAll('[data-source-from]') ?? [])]
        .find(
        /**
         * get・bounding・client・rectが条件に一致する最初の要素を取得する。
         * @param element - 要素のget・bounding・client・rectを参照する走査対象。
         * @returns 条件に一致した最初の要素。未検出時はundefined。
         */
        (element) => element.getBoundingClientRect().bottom > (previewBounds?.top ?? 0) + 1);
    const blockBounds = previewBlock?.getBoundingClientRect();
    const from = Number(previewBlock?.getAttribute('data-source-from'));
    const to = Math.max(from + 1, Number(previewBlock?.getAttribute('data-source-to')));
    const progress = previewBounds && blockBounds && blockBounds.top < previewBounds.top
      ? Math.min(1, Math.max(0, (previewBounds.top - blockBounds.top) / Math.max(1, blockBounds.height)))
      : 0;
    return {
      sourceOffset: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-offset')),
      sourceEndOffset: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-end-offset')),
      sourceTopOffset: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-top-offset')),
      previewOffset: Math.round(from + progress * (Math.max(from, to - 1) - from)),
      previewTopOffset: progress > 0 ? 0 : (blockBounds?.top ?? 0) - (previewBounds?.top ?? 0)
    };
  });
  const { insertedLength: topInsertionLength, documentLength: expectedTopInsertionDocumentLength } = await page.evaluate(
  /**
   * Host側の本文状態のfrom結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    const baseVersion = window.__mveHostVersion;
    const prefix = Array.from({ length: 40 },
    /**
     * スモーク検証・高速のコールバックとして・を処理する。
     * @param _ - 引数位置を維持するための未使用値。
     * @param index - 配列・行列・文字列の要素位置を示す番号。
     * @returns スモーク検証・高速のコールバックが生成する結果。
     */
    (_, index) => `# inserted-${index}\n\nbody\n\n`).join('');
    const change = { rangeOffset: 0, rangeLength: 0, text: prefix };
    window.__mveHostText = prefix + window.__mveHostText;
    window.__mveHostVersion += 1;
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'externalChanges', baseVersion, version: window.__mveHostVersion, changes: [change] }
    }));
    return { insertedLength: prefix.length, documentLength: window.__mveHostText.length };
  });
  try {
    await page.waitForFunction(
    /**
     * ブラウザー内に「.split-preview .rendered-markdown」が現れるまで待機する。
     * @param expectedLength - ブラウザー内で評価するコールバック。
     * @returns スモーク検証・高速のコールバックが生成する結果。
     */
    (expectedLength) => (
      Number(document.querySelector('.split-preview .rendered-markdown')?.getAttribute('data-document-length')) === expectedLength
    ), expectedTopInsertionDocumentLength);
  } catch (error) {
    const state = await page.evaluate(
    /**
     * ブラウザー内の「.source-editor」を読み取り、検証用の値へ変換する。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    () => ({
      sourceLength: document.querySelector('.source-editor')?.getAttribute('data-document-length'),
      previewLength: document.querySelector('.split-preview .rendered-markdown')?.getAttribute('data-document-length'),
      workerMeasures: performance.getEntriesByName('mve-preview-markdown-worker').map(
      /**
       * 各エントリからdurationを取り出して一覧化する。
       * @param entry - エントリのdurationを参照する走査対象。
       * @returns durationを取り出した変換結果の一覧。
       */
      (entry) => entry.duration)
    }));
    throw new Error(`external preview did not settle: ${JSON.stringify(state)}\nBrowser errors:\n${errors.join('\n')}`, { cause: error });
  }
  try {
    await page.waitForFunction(
    /**
     * ブラウザー内に「.source-editor」が現れるまで待機する。
     * @param options - ブラウザー内で評価するコールバック。
     * @returns スモーク検証・高速のコールバックが生成する結果。
     */
    ({ sourceOffset, previewOffset, insertedLength }) => {
      const currentSource = Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-offset'));
      const currentSourceEnd = Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-end-offset'));
      const preview = document.querySelector('.split-preview');
      const previewBounds = preview?.getBoundingClientRect();
      const hit = previewBounds
        ? document.elementFromPoint(previewBounds.left + previewBounds.width / 2, previewBounds.top + 1)
        : undefined;
      const previewBlock = hit?.closest('[data-source-from]')
        ?? [...(preview?.querySelectorAll('[data-source-from]') ?? [])]
          .find(
          /**
           * get・bounding・client・rectが条件に一致する最初の要素を取得する。
           * @param element - 要素のget・bounding・client・rectを参照する走査対象。
           * @returns 条件に一致した最初の要素。未検出時はundefined。
           */
          (element) => element.getBoundingClientRect().bottom > (previewBounds?.top ?? 0) + 1);
      const blockBounds = previewBlock?.getBoundingClientRect();
      const from = Number(previewBlock?.getAttribute('data-source-from'));
      const to = Math.max(from + 1, Number(previewBlock?.getAttribute('data-source-to')));
      const progress = previewBounds && blockBounds && blockBounds.top < previewBounds.top
        ? Math.min(1, Math.max(0, (previewBounds.top - blockBounds.top) / Math.max(1, blockBounds.height)))
        : 0;
      const currentPreview = Math.round(from + progress * (Math.max(from, to - 1) - from));
      const expectedSource = sourceOffset + insertedLength;
      const expectedPreview = previewOffset + insertedLength;
      return currentSource <= expectedSource
        && expectedSource <= currentSourceEnd
        && (Math.abs(currentPreview - expectedPreview) <= 32
          || (from <= expectedPreview && expectedPreview < to));
    }, { sourceOffset: beforeTopInsertion.sourceOffset, previewOffset: beforeTopInsertion.previewOffset, insertedLength: topInsertionLength });
  } catch (error) {
    const anchorState = await page.evaluate(
    /**
     * ブラウザー内の「.split-preview」を読み取り、検証用の値へ変換する。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    () => {
      const preview = document.querySelector('.split-preview');
      const previewBounds = preview?.getBoundingClientRect();
      const hit = previewBounds
        ? document.elementFromPoint(previewBounds.left + previewBounds.width / 2, previewBounds.top + 1)
        : undefined;
      const previewBlock = hit?.closest('[data-source-from]')
        ?? [...(preview?.querySelectorAll('[data-source-from]') ?? [])]
          .find(
          /**
           * get・bounding・client・rectが条件に一致する最初の要素を取得する。
           * @param element - 要素のget・bounding・client・rectを参照する走査対象。
           * @returns 条件に一致した最初の要素。未検出時はundefined。
           */
          (element) => element.getBoundingClientRect().bottom > (previewBounds?.top ?? 0) + 1);
      const blockBounds = previewBlock?.getBoundingClientRect();
      const from = Number(previewBlock?.getAttribute('data-source-from'));
      const to = Math.max(from + 1, Number(previewBlock?.getAttribute('data-source-to')));
      const progress = previewBounds && blockBounds && blockBounds.top < previewBounds.top
        ? Math.min(1, Math.max(0, (previewBounds.top - blockBounds.top) / Math.max(1, blockBounds.height)))
        : 0;
      return {
        sourceOffset: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-offset')),
        sourceEndOffset: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-end-offset')),
        previewOffset: Math.round(from + progress * (Math.max(from, to - 1) - from)),
        previewBlockFrom: from,
        previewBlockTo: to,
        previewProgress: progress,
        previewScrollTop: preview?.scrollTop,
        debug: (window.__mveDebugLog ?? []).slice(-100)
      };
    });
    throw new Error(`external viewport did not restore: before=${JSON.stringify(beforeTopInsertion)}, after=${JSON.stringify(anchorState)}, inserted=${topInsertionLength}`, { cause: error });
  }
  const afterTopInsertion = await page.evaluate(
  /**
   * ブラウザー内の「.split-preview」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    const preview = document.querySelector('.split-preview');
    const previewBounds = preview?.getBoundingClientRect();
    const hit = previewBounds
      ? document.elementFromPoint(previewBounds.left + previewBounds.width / 2, previewBounds.top + 1)
      : undefined;
    const previewBlock = hit?.closest('[data-source-from]')
      ?? [...(preview?.querySelectorAll('[data-source-from]') ?? [])]
        .find(
        /**
         * get・bounding・client・rectが条件に一致する最初の要素を取得する。
         * @param element - 要素のget・bounding・client・rectを参照する走査対象。
         * @returns 条件に一致した最初の要素。未検出時はundefined。
         */
        (element) => element.getBoundingClientRect().bottom > (previewBounds?.top ?? 0) + 1);
    const blockBounds = previewBlock?.getBoundingClientRect();
    const from = Number(previewBlock?.getAttribute('data-source-from'));
    const to = Math.max(from + 1, Number(previewBlock?.getAttribute('data-source-to')));
    const progress = previewBounds && blockBounds && blockBounds.top < previewBounds.top
      ? Math.min(1, Math.max(0, (previewBounds.top - blockBounds.top) / Math.max(1, blockBounds.height)))
      : 0;
    return {
      sourceOffset: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-offset')),
      sourceEndOffset: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-end-offset')),
      sourceTopOffset: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-top-offset')),
      previewOffset: Math.round(from + progress * (Math.max(from, to - 1) - from)),
      previewBlockFrom: from,
      previewBlockTo: to,
      previewTopOffset: progress > 0 ? 0 : (blockBounds?.top ?? 0) - (previewBounds?.top ?? 0)
    };
  });
  const mappedTopSourceOffset = beforeTopInsertion.sourceOffset + topInsertionLength;
  const mappedTopPreviewOffset = beforeTopInsertion.previewOffset + topInsertionLength;
  if (afterTopInsertion.sourceOffset > mappedTopSourceOffset
    || afterTopInsertion.sourceEndOffset < mappedTopSourceOffset
    || Math.abs(afterTopInsertion.sourceTopOffset - beforeTopInsertion.sourceTopOffset) > 1) {
    throw new Error(`top insertion moved source viewport: ${JSON.stringify(beforeTopInsertion)} -> ${JSON.stringify(afterTopInsertion)}`);
  }
  if (Math.abs(afterTopInsertion.previewOffset - mappedTopPreviewOffset) > 32
    && !(afterTopInsertion.previewBlockFrom <= mappedTopPreviewOffset
      && mappedTopPreviewOffset < afterTopInsertion.previewBlockTo)) {
    throw new Error(`top insertion moved preview viewport: ${JSON.stringify(beforeTopInsertion)} -> ${JSON.stringify(afterTopInsertion)}`);
  }
  if (!(await page.locator('.split-editor .cm-editor.cm-focused').count())) throw new Error('focused editor did not retain its natural focus');
  await sourceEditor.type('Y');
  await page.waitForTimeout(350);
  if (!(await page.evaluate(
  /**
   * Host側の本文状態のincludes結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveHostText.includes('second  \nXY')))) throw new Error('blank-line edit moved the caret');
  if (await page.evaluate(
  /**
   * Host側の本文状態のincludes結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveHostText.includes('\r'))) throw new Error('host protocol text is not LF-normalized');
  const queuedMessageStart = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    window.__mveAckDelay = 500;
    return window.__mveMessages.length;
  });
  await sourceEditor.press('A');
  await sourceEditor.press('B');
  await sourceEditor.press('C');
  await page.waitForTimeout(1_200);
  const queuedOperations = await page.evaluate(
  /**
   * ブラウザー内の「.cm-content」を読み取り、検証用の値へ変換する。
   * @param start - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (start) => {
    window.__mveAckDelay = 0;
    return {
      operations: window.__mveMessages.slice(start).filter(
      /**
       * 種別「localChanges」のメッセージだけを残す。
       * @param message - メッセージのtypeを参照する走査対象。
       * @returns 条件を満たした要素だけを含む一覧。
       */
      (message) => message.type === 'localChanges'),
      hostText: window.__mveHostText,
      editorText: document.querySelector('.cm-content')?.textContent ?? ''
    };
  }, queuedMessageStart);
  if (queuedOperations.operations.length !== 2
    || !queuedOperations.hostText.includes('second  \nXYABC')
    || !queuedOperations.editorText.includes('XYABC')) {
    throw new Error(`rapid input was not collapsed to one in-flight and one follow-up operation: ${JSON.stringify(queuedOperations)}`);
  }
  await page.getByRole('tab', { name: 'ホーム', exact: true }).click();
  await page.locator('button[title^="元に戻す"]').click();
  await page.waitForTimeout(50);
  if (!(await page.evaluate(
  /**
   * Host側の本文状態のstarts・with結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveHostText.startsWith('# inserted-0\n')))) {
    throw new Error('undo incorrectly reverted an external host change');
  }
  await page.locator('button[title^="やり直す"]').click();
  await page.waitForTimeout(50);

  const focusTarget = page.getByRole('button', { name: '検索', exact: true });
  await focusTarget.click();
  await page.waitForFunction(
  /**
   * ブラウザーのDOM状態が完了条件を満たすまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => document.activeElement?.getAttribute('aria-label') === '検索文字列');
  const activeBeforeBlurSync = await page.evaluate(
  /**
   * ブラウザーのDOM状態のget・attribute結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent);
  await page.evaluate(
  /**
   * Host側の本文状態のdispatch・event結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    const baseVersion = window.__mveHostVersion;
    const change = { rangeOffset: window.__mveHostText.length, rangeLength: 0, text: '\nblurred-host-change' };
    window.__mveHostText += change.text;
    window.__mveHostVersion += 1;
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'externalChanges', baseVersion, version: window.__mveHostVersion, changes: [change] }
    }));
  });
  await page.waitForTimeout(50);
  const activeAfterBlurSync = await page.evaluate(
  /**
   * ブラウザーのDOM状態のget・attribute結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent);
  if (activeAfterBlurSync !== activeBeforeBlurSync) {
    throw new Error(`blurred host synchronization stole focus: before=${JSON.stringify(activeBeforeBlurSync)}, after=${JSON.stringify(activeAfterBlurSync)}`);
  }
  await page.getByRole('tab', { name: '表示', exact: true }).click();
  const openSourceMessageStart = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveMessages.length);
  await page.getByRole('button', { name: 'テキストを右側に開く', exact: true }).click();
  await page.waitForFunction(
  /**
   * HostとWebviewのメッセージ状態が完了条件を満たすまで待機する。
   * @param start - ブラウザー内で評価するコールバック。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (start) => window.__mveMessages.slice(start).some(
  /**
   * スモーク検証・高速のコールバックとしてメッセージを処理する。
   * @param message - HostとWebviewの間で受け渡すメッセージ。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (message) => message.type === 'openSource'), openSourceMessageStart);
  const outline = page.locator('[title="アウトラインの表示/非表示"]');
  await outline.click();
  await page.locator('.outline-panel').waitFor({ state: 'hidden' });
  await page.waitForTimeout(300);
  await outline.click();
  await page.locator('.outline-panel').waitFor();
  await page.getByRole('button', { name: 'アウトラインを非表示', exact: true }).click();
  await page.locator('.outline-panel').waitFor({ state: 'hidden' });
  await page.waitForFunction(
  /**
   * Webviewの共有設定が完了条件を満たすまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => window.__mveGlobalSettings.outlineVisible === false);
  await page.waitForTimeout(300);
  await outline.click();
  await page.locator('.outline-panel').waitFor();
  await page.waitForFunction(
  /**
   * Webviewの共有設定が完了条件を満たすまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => window.__mveGlobalSettings.outlineVisible === true);
  await page.getByRole('button', { name: '検索', exact: true }).click();
  await page.getByRole('textbox', { name: '検索文字列' }).fill('Long section 150');
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await page.locator('.search-panel').getByRole('button', { name: '閉じる', exact: true }).click();
  const formatMessageStart = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveMessages.length);
  await page.getByRole('tab', { name: 'ホーム', exact: true }).click();
  await page.locator('button[title^="太字"]').click();
  await page.waitForTimeout(100);
  const formatOperation = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態のslice結果を読み取り、検証用の値へ変換する。
   * @param start - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (start) => window.__mveMessages
    .slice(start)
    .find(
    /**
     * typeが条件に一致する最初のメッセージを取得する。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件に一致した最初の要素。未検出時はundefined。
     */
    (message) => message.type === 'localChanges'), formatMessageStart);
  const expectedFormatOffset = await page.evaluate(
  /**
   * Host側の本文状態のindex・of結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveHostText.indexOf('**Long section 150**'));
  if (!formatOperation || formatOperation.changes.length !== 1
    || Math.abs(formatOperation.changes[0].rangeOffset - expectedFormatOffset) > 2
    || formatOperation.changes[0].rangeLength > 40) {
    throw new Error(`CRLF formatting produced a non-local change: ${JSON.stringify(formatOperation)}`);
  }
  await page.getByRole('button', { name: '検索', exact: true }).click();
  await page.getByRole('textbox', { name: '検索文字列' }).fill('first');
  await page.getByText('1/1', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: '置換文字列' }).fill('replaced');
  await page.locator('.search-panel button').nth(2).click();
  await page.locator('.search-panel button').nth(4).click();

  await page.getByRole('tab', { name: '表示', exact: true }).click();
  await page.getByRole('button', { name: '左右分割', exact: true }).click();
  await page.locator('.split-editor').waitFor();
  const scrollSync = page.getByRole('button', { name: 'スクロール同期', exact: true });
  if (await scrollSync.getAttribute('aria-pressed') !== 'true') throw new Error('scroll sync is not enabled by default');
  await scrollSync.click();
  await page.waitForFunction(
  /**
   * ブラウザー内に「button[title=」が現れるまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => document.querySelector('button[title="テキストとプレビューのスクロール位置を同期します"]')?.getAttribute('aria-pressed') === 'false');
  const scrollSyncDisabledMessage = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態のreverse結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => [...window.__mveMessages]
    .reverse()
    .find(
    /**
     * typeが条件に一致する最初のメッセージを取得する。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件に一致した最初の要素。未検出時はundefined。
     */
    (message) => message.type === 'setScrollSyncEnabled'));
  if (scrollSyncDisabledMessage?.enabled !== false) throw new Error(`scroll sync OFF was not sent to host: ${JSON.stringify(scrollSyncDisabledMessage)}`);
  await page.waitForTimeout(300);
  const previewBeforeDisabledSourceScroll = await page.locator('.split-preview').evaluate(
  /**
   * ブラウザー内の状態を読み取り、検証用の値へ変換する。
   * @param element - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (element) => element.scrollTop);
  await page.locator('.cm-scroller').dispatchEvent('wheel', { deltaY: 1 });
  await page.locator('.cm-scroller').evaluate(
  /**
   * ブラウザー内の状態を読み取り、検証用の値へ変換する。
   * @param element - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (element) => {
    const maximum = element.scrollHeight - element.clientHeight;
    element.scrollTop = element.scrollTop < maximum / 2 ? maximum : 0;
  });
  await page.waitForTimeout(150);
  const disabledScrollPositions = await page.evaluate(
  /**
   * ブラウザー内の「.cm-scroller」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => ({
    source: document.querySelector('.cm-scroller')?.scrollTop ?? 0,
    preview: document.querySelector('.split-preview')?.scrollTop ?? 0
  }));
  if (Math.abs(disabledScrollPositions.preview - previewBeforeDisabledSourceScroll) > 1) {
    throw new Error(`scroll sync OFF still moved the other pane: ${JSON.stringify(disabledScrollPositions)}`);
  }
  await page.evaluate(
  /**
   * Webviewの共有設定のdispatch・event結果を読み取り、検証用の値へ変換する。
   * @param options - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  ({ text, version }) => window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'init', text, version, uri: 'file:///C:/another-document.md', settings: window.__mveGlobalSettings }
  })), { text: await page.evaluate(
  /**
   * Host側の本文状態を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveHostText), version: await page.evaluate(
  /**
   * Webviewの実行状態を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveHostVersion) });
  await outline.click();
  await page.locator('.outline-panel').waitFor({ state: 'hidden' });
  await page.waitForFunction(
  /**
   * Webviewの共有設定が完了条件を満たすまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => window.__mveGlobalSettings.outlineVisible === false);
  await page.evaluate(
  /**
   * Webviewの共有設定のdispatch・event結果を読み取り、検証用の値へ変換する。
   * @param options - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  ({ text, version }) => window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'init', text, version, uri: 'file:///C:/third-document.md', settings: window.__mveGlobalSettings }
  })), { text: await page.evaluate(
  /**
   * Host側の本文状態を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveHostText), version: await page.evaluate(
  /**
   * Webviewの実行状態を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveHostVersion) });
  await page.locator('.outline-panel').waitFor({ state: 'hidden' });
  await page.waitForTimeout(300);
  await outline.click();
  await page.locator('.outline-panel').waitFor();
  if (await scrollSync.getAttribute('aria-pressed') !== 'false') throw new Error('scroll sync setting did not persist across documents');
  await scrollSync.click();
  await page.waitForFunction(
  /**
   * ブラウザー内に「button[title=」が現れるまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => document.querySelector('button[title="テキストとプレビューのスクロール位置を同期します"]')?.getAttribute('aria-pressed') === 'true');
  await page.evaluate(
  /**
   * Webviewの実行状態を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    window.__mveDebugEnabled = true;
    window.__mveDebugLog = [];
  });
  await page.locator('.cm-scroller').dispatchEvent('wheel', { deltaY: -10_000 });
  await page.locator('.cm-scroller').evaluate(
  /**
   * ブラウザー内の状態を読み取り、検証用の値へ変換する。
   * @param element - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (element) => { element.scrollTop = 0; });
  await page.waitForTimeout(150);
  const topScrollState = await page.evaluate(
  /**
   * ブラウザー内の「.cm-scroller」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => ({
    source: document.querySelector('.cm-scroller')?.scrollTop ?? Number.POSITIVE_INFINITY,
    preview: document.querySelector('.split-preview')?.scrollTop ?? Number.POSITIVE_INFINITY
  }));
  if (topScrollState.source > 1 || topScrollState.preview > 1) {
    throw new Error(`source top scroll did not synchronize to preview top: ${JSON.stringify(topScrollState)}`);
  }
  await page.evaluate(
  /**
   * ブラウザー内の「.split-preview」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    window.__mveBottomScrollSamples = [];
    window.__mveBottomScrollSampler = window.setInterval(
    /**
     * 要素をquery・selectorへ渡し、スモーク検証・高速の結果または副作用を処理する。
     * @returns スモーク検証・高速のコールバックが生成する結果。
     */
    () => {
      const preview = document.querySelector('.split-preview');
      if (!preview) return;
      window.__mveBottomScrollSamples.push({
        at: performance.now(),
        gap: preview.scrollHeight - preview.clientHeight - preview.scrollTop
      });
    }, 16);
  });
  await page.locator('.cm-scroller').dispatchEvent('wheel', { deltaY: 10_000 });
  await page.locator('.cm-scroller').evaluate(
  /**
   * ブラウザー内の状態を読み取り、検証用の値へ変換する。
   * @param element - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (element) => { element.scrollTop = element.scrollHeight; });
  await page.waitForTimeout(800);
  const bottomScrollState = await page.evaluate(
  /**
   * ブラウザー内の「.cm-scroller」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    window.clearInterval(window.__mveBottomScrollSampler);
    const source = document.querySelector('.cm-scroller');
    const preview = document.querySelector('.split-preview');
    const samples = window.__mveBottomScrollSamples ?? [];
    return {
      sourceGap: source ? source.scrollHeight - source.clientHeight - source.scrollTop : Number.POSITIVE_INFINITY,
      previewGap: preview ? preview.scrollHeight - preview.clientHeight - preview.scrollTop : Number.POSITIVE_INFINITY,
      minimumPreviewGap: samples.length ? Math.min(...samples.map(
      /**
       * 各sampleからgapを取り出して一覧化する。
       * @param sample - sampleのgapを参照する走査対象。
       * @returns gapを取り出した変換結果の一覧。
       */
      (sample) => sample.gap)) : Number.POSITIVE_INFINITY,
      samples: samples.slice(-12),
      debug: (window.__mveDebugLog ?? []).slice(-30)
    };
  });
  if (bottomScrollState.sourceGap > 1 || bottomScrollState.previewGap > 1) {
    throw new Error(`source bottom scroll did not remain synchronized at preview bottom: ${JSON.stringify(bottomScrollState)}`);
  }
  await page.locator('.split-preview').dispatchEvent('wheel', { deltaY: -10_000 });
  await page.locator('.split-preview').evaluate(
  /**
   * ブラウザー内の状態を読み取り、検証用の値へ変換する。
   * @param element - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (element) => { element.scrollTop = 0; });
  await page.waitForTimeout(150);
  const reverseTopScrollState = await page.evaluate(
  /**
   * ブラウザー内の「.cm-scroller」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => ({
    source: document.querySelector('.cm-scroller')?.scrollTop ?? Number.POSITIVE_INFINITY,
    preview: document.querySelector('.split-preview')?.scrollTop ?? Number.POSITIVE_INFINITY
  }));
  if (reverseTopScrollState.source > 1 || reverseTopScrollState.preview > 1) {
    throw new Error(`preview top scroll did not synchronize to source top: ${JSON.stringify(reverseTopScrollState)}`);
  }
  await page.locator('.split-preview').dispatchEvent('wheel', { deltaY: 10_000 });
  await page.locator('.split-preview').evaluate(
  /**
   * ブラウザー内の状態を読み取り、検証用の値へ変換する。
   * @param element - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (element) => { element.scrollTop = element.scrollHeight; });
  await page.waitForTimeout(300);
  const reverseBottomScrollState = await page.evaluate(
  /**
   * ブラウザー内の「.cm-scroller」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    const source = document.querySelector('.cm-scroller');
    const preview = document.querySelector('.split-preview');
    return {
      sourceGap: source ? source.scrollHeight - source.clientHeight - source.scrollTop : Number.POSITIVE_INFINITY,
      previewGap: preview ? preview.scrollHeight - preview.clientHeight - preview.scrollTop : Number.POSITIVE_INFINITY,
      debug: (window.__mveDebugLog ?? []).slice(-40)
    };
  });
  if (reverseBottomScrollState.sourceGap > 1 || reverseBottomScrollState.previewGap > 1) {
    throw new Error(`preview bottom scroll did not synchronize to source bottom: ${JSON.stringify(reverseBottomScrollState)}`);
  }
  const divider = page.locator('.split-divider');
  const before = await page.locator('.split-editor').evaluate(
  /**
   * ブラウザー内の状態のget・computed・style結果を読み取り、検証用の値へ変換する。
   * @param element - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (element) => getComputedStyle(element).gridTemplateColumns);
  const bounds = await divider.boundingBox();
  if (!bounds) throw new Error('split divider is not visible');
  await page.mouse.move(bounds.x + 4, bounds.y + 10);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 60, bounds.y + 10);
  await page.mouse.up();
  const after = await page.locator('.split-editor').evaluate(
  /**
   * ブラウザー内の状態のget・computed・style結果を読み取り、検証用の値へ変換する。
   * @param element - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (element) => getComputedStyle(element).gridTemplateColumns);
  if (before === after) throw new Error('split divider did not resize');
  const zoomBefore = await page.locator('.status-bar').textContent();
  await page.locator('.editor-area').dispatchEvent('wheel', { deltaY: -100, ctrlKey: true });
  await page.waitForFunction(
  /**
   * ブラウザー内に「.status-bar」が現れるまで待機する。
   * @param value - ブラウザー内で評価するコールバック。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (value) => document.querySelector('.status-bar')?.textContent !== value, zoomBefore);
  await page.waitForTimeout(300);
  const resizedBottomScrollState = await page.evaluate(
  /**
   * ブラウザー内の「.cm-scroller」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    window.__mveDebugEnabled = false;
    const source = document.querySelector('.cm-scroller');
    const preview = document.querySelector('.split-preview');
    return {
      sourceGap: source ? source.scrollHeight - source.clientHeight - source.scrollTop : Number.POSITIVE_INFINITY,
      previewGap: preview ? preview.scrollHeight - preview.clientHeight - preview.scrollTop : Number.POSITIVE_INFINITY
    };
  });
  if (resizedBottomScrollState.sourceGap > 1 || resizedBottomScrollState.previewGap > 1) {
    throw new Error(`pane resize or zoom did not preserve synchronized bottom: ${JSON.stringify(resizedBottomScrollState)}`);
  }

  await page.locator('.cm-scroller').dispatchEvent('wheel', { deltaY: 1 });
  await page.locator('.cm-scroller').evaluate(
  /**
   * ブラウザー内の状態を読み取り、検証用の値へ変換する。
   * @param element - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (element) => { element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.55; });
  await page.waitForTimeout(150);
  const anchorsBeforeModeChange = await page.evaluate(
  /**
   * ブラウザー内の「.split-preview」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    const preview = document.querySelector('.split-preview');
    const previewBounds = preview?.getBoundingClientRect();
    const hit = previewBounds
      ? document.elementFromPoint(previewBounds.left + previewBounds.width / 2, previewBounds.top + 1)
      : undefined;
    const previewBlock = hit?.closest('[data-source-from]')
      ?? [...(preview?.querySelectorAll('[data-source-from]') ?? [])]
        .find(
        /**
         * get・bounding・client・rectが条件に一致する最初の要素を取得する。
         * @param element - 要素のget・bounding・client・rectを参照する走査対象。
         * @returns 条件に一致した最初の要素。未検出時はundefined。
         */
        (element) => element.getBoundingClientRect().bottom > (previewBounds?.top ?? 0) + 1);
    const blockBounds = previewBlock?.getBoundingClientRect();
    const from = Number(previewBlock?.getAttribute('data-source-from'));
    const to = Math.max(from + 1, Number(previewBlock?.getAttribute('data-source-to')));
    const progress = previewBounds && blockBounds && blockBounds.top < previewBounds.top
      ? Math.min(1, Math.max(0, (previewBounds.top - blockBounds.top) / Math.max(1, blockBounds.height)))
      : 0;
    return {
      source: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-offset')),
      sourceEnd: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-end-offset')),
      sourceTopOffset: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-top-offset')),
      preview: Math.round(from + progress * (Math.max(from, to - 1) - from)),
      previewBlockFrom: from,
      previewBlockTo: to,
      previewTopOffset: progress > 0 ? 0 : (blockBounds?.top ?? 0) - (previewBounds?.top ?? 0)
    };
  });
  await page.setViewportSize({ width: 1050, height: 720 });
  await page.waitForTimeout(150);
  await page.waitForTimeout(500);
  const anchorsAfterWindowResize = await page.evaluate(
  /**
   * ブラウザー内の「.split-preview」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    const preview = document.querySelector('.split-preview');
    const previewBounds = preview?.getBoundingClientRect();
    const hit = previewBounds
      ? document.elementFromPoint(previewBounds.left + previewBounds.width / 2, previewBounds.top + 1)
      : undefined;
    const previewBlock = hit?.closest('[data-source-from]')
      ?? [...(preview?.querySelectorAll('[data-source-from]') ?? [])]
        .find(
        /**
         * get・bounding・client・rectが条件に一致する最初の要素を取得する。
         * @param element - 要素のget・bounding・client・rectを参照する走査対象。
         * @returns 条件に一致した最初の要素。未検出時はundefined。
         */
        (element) => element.getBoundingClientRect().bottom > (previewBounds?.top ?? 0) + 1);
    const blockBounds = previewBlock?.getBoundingClientRect();
    const from = Number(previewBlock?.getAttribute('data-source-from'));
    const to = Math.max(from + 1, Number(previewBlock?.getAttribute('data-source-to')));
    const progress = previewBounds && blockBounds && blockBounds.top < previewBounds.top
      ? Math.min(1, Math.max(0, (previewBounds.top - blockBounds.top) / Math.max(1, blockBounds.height)))
      : 0;
    return {
      source: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-offset')),
      sourceEnd: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-end-offset')),
      sourceTopOffset: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-top-offset')),
      preview: Math.round(from + progress * (Math.max(from, to - 1) - from)),
      previewBlockFrom: from,
      previewBlockTo: to,
      previewTopOffset: progress > 0 ? 0 : (blockBounds?.top ?? 0) - (previewBounds?.top ?? 0)
    };
  });
  if (anchorsAfterWindowResize.source > anchorsBeforeModeChange.source
    || anchorsAfterWindowResize.sourceEnd < anchorsBeforeModeChange.source
    || (Math.abs(anchorsAfterWindowResize.preview - anchorsBeforeModeChange.preview) > 1
      && !(anchorsAfterWindowResize.previewBlockFrom <= anchorsBeforeModeChange.preview
        && anchorsBeforeModeChange.preview < anchorsAfterWindowResize.previewBlockTo))
    || Math.abs(anchorsAfterWindowResize.sourceTopOffset - anchorsBeforeModeChange.sourceTopOffset) > 20
    || Math.abs(anchorsAfterWindowResize.previewTopOffset - anchorsBeforeModeChange.previewTopOffset) > 20) {
    throw new Error(`window resize did not preserve pane anchors: ${JSON.stringify(anchorsBeforeModeChange)} -> ${JSON.stringify(anchorsAfterWindowResize)}`);
  }

  await page.getByRole('button', { name: 'テキストのみ', exact: true }).click();
  await page.locator('.split-source-pane').waitFor();
  await page.locator('.split-preview').waitFor({ state: 'hidden' });
  await page.waitForFunction(
  /**
   * ブラウザー内に「.source-editor」が現れるまで待機する。
   * @param target - ブラウザー内で評価するコールバック。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (target) => {
    const editor = document.querySelector('.source-editor');
    const from = Number(editor?.getAttribute('data-viewport-offset'));
    const to = Number(editor?.getAttribute('data-viewport-end-offset'));
    return from <= target && target <= to;
  }, anchorsBeforeModeChange.source, { timeout: 2_000 });
  if (!(await page.locator('.cm-visible-space').count())) throw new Error('source whitespace markers are missing');
  if (!(await page.locator('.cm-content span[class*="ͼ"], .cm-content .tok-keyword, .cm-content .tok-string').count())) {
    throw new Error('source syntax highlighting is missing');
  }
  const sourceAfterModeChange = await page.evaluate(
  /**
   * ブラウザー内の「.source-editor」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    return {
      source: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-offset')),
      sourceEnd: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-end-offset'))
    };
  });
  if (sourceAfterModeChange.source > anchorsBeforeModeChange.source
    || sourceAfterModeChange.sourceEnd < anchorsBeforeModeChange.source) {
    throw new Error(`text-only mode did not preserve the source anchor: ${JSON.stringify(anchorsBeforeModeChange.source)} -> ${JSON.stringify(sourceAfterModeChange)}`);
  }
  await page.getByRole('button', { name: 'プレビューのみ', exact: true }).click();
  await page.locator('.split-preview').waitFor();
  await page.locator('.split-source-pane').waitFor({ state: 'hidden' });
  await page.waitForTimeout(50);
  const previewAfterModeChange = await page.evaluate(
  /**
   * ブラウザー内の「.split-preview」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    const preview = document.querySelector('.split-preview');
    const previewBounds = preview?.getBoundingClientRect();
    const hit = previewBounds
      ? document.elementFromPoint(previewBounds.left + previewBounds.width / 2, previewBounds.top + 1)
      : undefined;
    const previewBlock = hit?.closest('[data-source-from]')
      ?? [...(preview?.querySelectorAll('[data-source-from]') ?? [])]
        .find(
        /**
         * get・bounding・client・rectが条件に一致する最初の要素を取得する。
         * @param element - 要素のget・bounding・client・rectを参照する走査対象。
         * @returns 条件に一致した最初の要素。未検出時はundefined。
         */
        (element) => element.getBoundingClientRect().bottom > (previewBounds?.top ?? 0) + 1);
    const blockBounds = previewBlock?.getBoundingClientRect();
    const from = Number(previewBlock?.getAttribute('data-source-from'));
    const to = Math.max(from + 1, Number(previewBlock?.getAttribute('data-source-to')));
    const progress = previewBounds && blockBounds && blockBounds.top < previewBounds.top
      ? Math.min(1, Math.max(0, (previewBounds.top - blockBounds.top) / Math.max(1, blockBounds.height)))
      : 0;
    return {
      offset: Math.round(from + progress * (Math.max(from, to - 1) - from)),
      from,
      to
    };
  });
  if (Math.abs(previewAfterModeChange.offset - anchorsBeforeModeChange.preview) > 1
    && !(previewAfterModeChange.from <= anchorsBeforeModeChange.preview
      && anchorsBeforeModeChange.preview < previewAfterModeChange.to)) {
    throw new Error('preview-only mode did not preserve the preview anchor');
  }

  const previewOnlyOutlineOffset = await page.evaluate(
  /**
   * Host側の本文状態のindex・of結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveHostText.indexOf('## Long section 120'));
  await page.getByRole('button', { name: 'Long section 120', exact: true }).click();
  await page.locator('.split-source-pane').waitFor({ state: 'hidden' });
  if (await page.getByRole('button', { name: 'プレビューのみ', exact: true }).getAttribute('aria-pressed') !== 'true') {
    throw new Error('outline navigation changed preview-only mode');
  }
  await page.waitForFunction(
  /**
   * ブラウザー内に「.split-preview」が現れるまで待機する。
   * @param target - ブラウザー内で評価するコールバック。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (target) => {
    const preview = document.querySelector('.split-preview');
    const previewBounds = preview?.getBoundingClientRect();
    const targetBlock = [...(preview?.querySelectorAll('[data-source-from]') ?? [])].find(
    /**
     * get・attributeが条件に一致する最初の要素を取得する。
     * @param element - 要素のget・attributeを参照する走査対象。
     * @returns 条件に一致した最初の要素。未検出時はundefined。
     */
    (element) => {
      const from = Number(element.getAttribute('data-source-from'));
      const to = Math.max(from + 1, Number(element.getAttribute('data-source-to')));
      return from <= target && target < to;
    });
    const targetBounds = targetBlock?.getBoundingClientRect();
    return Boolean(previewBounds && targetBounds
      && targetBounds.bottom > previewBounds.top
      && targetBounds.top < previewBounds.bottom);
  }, previewOnlyOutlineOffset);

  await page.getByRole('button', { name: '左右分割', exact: true }).click();
  await page.locator('.split-source-pane').waitFor();
  await page.getByRole('button', { name: 'Long section 120', exact: true }).click();
  const caretBeforePreview = await page.evaluate(
  /**
   * Host側の本文状態のindex・of結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveHostText.indexOf('## Long section 120'));
  await page.waitForFunction(
  /**
   * ブラウザー内に「.source-editor」が現れるまで待機する。
   * @param target - ブラウザー内で評価するコールバック。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (target) => {
    const from = Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-offset'));
    const to = Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-end-offset'));
    return from <= target && target <= to;
  }, caretBeforePreview);
  await page.waitForFunction(
  /**
   * ブラウザー内に「.split-preview」が現れるまで待機する。
   * @param target - ブラウザー内で評価するコールバック。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (target) => {
    const preview = document.querySelector('.split-preview');
    const previewBounds = preview?.getBoundingClientRect();
    const targetBlock = [...(preview?.querySelectorAll('.markdown-source-block') ?? [])].find(
    /**
     * get・attributeが条件に一致する最初の要素を取得する。
     * @param element - 要素のget・attributeを参照する走査対象。
     * @returns 条件に一致した最初の要素。未検出時はundefined。
     */
    (element) => {
      const from = Number(element.getAttribute('data-source-from'));
      const to = Math.max(from + 1, Number(element.getAttribute('data-source-to')));
      return from <= target && target < to;
    });
    const targetBounds = targetBlock?.getBoundingClientRect();
    return Boolean(previewBounds && targetBounds
      && targetBounds.bottom > previewBounds.top
      && targetBounds.top < previewBounds.bottom);
  }, caretBeforePreview);
  await page.waitForTimeout(400);
  const outlineSplitState = await page.evaluate(
  /**
   * ブラウザー内の「.split-preview」を読み取り、検証用の値へ変換する。
   * @param target - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (target) => {
    const preview = document.querySelector('.split-preview');
    const previewBounds = preview?.getBoundingClientRect();
    const targetBlock = [...(preview?.querySelectorAll('.markdown-source-block') ?? [])].find(
    /**
     * get・attributeが条件に一致する最初の要素を取得する。
     * @param element - 要素のget・attributeを参照する走査対象。
     * @returns 条件に一致した最初の要素。未検出時はundefined。
     */
    (element) => {
      const from = Number(element.getAttribute('data-source-from'));
      const to = Math.max(from + 1, Number(element.getAttribute('data-source-to')));
      return from <= target && target < to;
    });
    const targetBounds = targetBlock?.getBoundingClientRect();
    const sourceFrom = Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-offset'));
    const sourceTo = Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-end-offset'));
    return {
      sourceContainsTarget: sourceFrom <= target && target <= sourceTo,
      previewContainsTarget: Boolean(previewBounds && targetBounds
        && targetBounds.bottom > previewBounds.top
        && targetBounds.top < previewBounds.bottom),
      previewTop: previewBounds && targetBounds ? targetBounds.top - previewBounds.top : Number.NaN
    };
  }, caretBeforePreview);
  if (!outlineSplitState.sourceContainsTarget
    || !outlineSplitState.previewContainsTarget
    || !Number.isFinite(outlineSplitState.previewTop)) {
    throw new Error(`outline split panes lost synchronization: ${JSON.stringify(outlineSplitState)}`);
  }

  await page.getByRole('tab', { name: '出力', exact: true }).click();
  await page.getByRole('button', { name: '印刷プレビュー', exact: true }).click();
  await page.locator('.pdf-preview-shell').waitFor();
  if (await page.locator('.pdf-settings-panel').count() !== 0) {
    throw new Error('Print preview opened the print settings panel unexpectedly.');
  }
  await page.waitForTimeout(50);
  const printPreviewAnchor = await page.evaluate(
  /**
   * ブラウザー内の「.editor-area」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    const container = document.querySelector('.editor-area');
    const top = container?.getBoundingClientRect().top ?? 0;
    return [...document.querySelectorAll('.pdf-preview-content [data-source-from]')].find(
    /**
     * get・bounding・client・rectが条件に一致する最初の要素を取得する。
     * @param element - 要素のget・bounding・client・rectを参照する走査対象。
     * @returns 条件に一致した最初の要素。未検出時はundefined。
     */
    (element) => element.getBoundingClientRect().bottom > top + 1)?.getAttribute('data-source-from');
  });
  if (printPreviewAnchor !== String(caretBeforePreview)) throw new Error(`print preview mode did not preserve the preview anchor: expected=${caretBeforePreview}, actual=${printPreviewAnchor}`);
  const previewPrefixLength = await page.evaluate(
  /**
   * Host側の本文状態のdispatch・event結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    const baseVersion = window.__mveHostVersion;
    const prefix = '# preview-external\n\n';
    const change = { rangeOffset: 0, rangeLength: 0, text: prefix };
    window.__mveHostText = prefix + window.__mveHostText;
    window.__mveHostVersion += 1;
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'externalChanges', baseVersion, version: window.__mveHostVersion, changes: [change] }
    }));
    return prefix.length;
  });
  await page.waitForTimeout(50);
  await page.getByRole('button', { name: '印刷プレビュー', exact: true }).click();
  await page.getByRole('button', { name: '印刷設定', exact: true }).click();
  await page.locator('.pdf-settings-panel').waitFor();
  await page.locator('.pdf-settings-panel').getByRole('button', { name: '閉じる', exact: true }).click();
  await page.locator('.split-source-pane').waitFor();
  await page.locator('.cm-content').press('!');
  await page.waitForTimeout(100);
  const selectionRestored = await page.evaluate(
  /**
   * Host側の本文状態のslice結果を読み取り、検証用の値へ変換する。
   * @param options - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  ({ offset, prefixLength }) =>
    window.__mveHostText.slice(offset + prefixLength, offset + prefixLength + 1) === '!',
  { offset: caretBeforePreview, prefixLength: previewPrefixLength });
  if (!selectionRestored) throw new Error('preview-only external insertion did not map the unmounted source selection');
  await page.evaluate(
  /**
   * ブラウザーのDOM状態のfor結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    window.__mveImeEvents = [];
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input']) {
      document.addEventListener(type,
      /**
       * イベントで一覧追加を実行する。
       * @param event - ユーザー操作またはDOMから通知されたイベント。
       * @returns 副作用を完了し、値は返さない。
       */
      (event) => window.__mveImeEvents.push({ type, data: event.data, inputType: event.inputType }), true);
    }
  });
  const imeStart = await page.evaluate(
  /**
   * ブラウザー内の「.source-editor」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => Number(document.querySelector('.source-editor')?.getAttribute('data-selection-from')));
  await cdp.send('Input.imeSetComposition', { text: '変', selectionStart: 1, selectionEnd: 1 });
  await page.waitForTimeout(10);
  const imeAfterFirst = await page.evaluate(
  /**
   * ブラウザー内の「.cm-content」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => ({
    hostTail: window.__mveHostText.slice(-50),
    editorTail: document.querySelector('.cm-content')?.textContent?.slice(-50),
    localCount: window.__mveMessages.filter(
    /**
     * 種別「localChanges」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'localChanges').length,
    events: window.__mveImeEvents
  }));
  await page.waitForTimeout(10);
  await page.evaluate(
  /**
   * Host側の本文状態のdispatch・event結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    const baseVersion = window.__mveHostVersion;
    const change = { rangeOffset: window.__mveHostText.length, rangeLength: 0, text: '\nime-external' };
    window.__mveHostText += change.text;
    window.__mveHostVersion += 1;
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'externalChanges', baseVersion, version: window.__mveHostVersion, changes: [change] }
    }));
  });
  // Windows日本語IMEが予測候補の確定時までpreedit選択を入力開始位置へ置く経路を再現する。
  await cdp.send('Input.imeSetComposition', { text: '変換', selectionStart: 0, selectionEnd: 0 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await cdp.send('Input.insertText', { text: '変換' });
  await page.waitForTimeout(250);
  const imeResult = await page.evaluate(
  /**
   * ブラウザー内の「.cm-content」を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => ({
    hasInput: window.__mveHostText.includes('変'),
    hasExternal: window.__mveHostText.endsWith('ime-external'),
    tail: window.__mveHostText.slice(-80),
    resyncs: window.__mveMessages.filter(
    /**
     * 種別「requestResync」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'requestResync').length,
    editorTail: document.querySelector('.cm-content')?.textContent?.slice(-80),
    selectionFrom: Number(document.querySelector('.source-editor')?.getAttribute('data-selection-from')),
    selectionTo: Number(document.querySelector('.source-editor')?.getAttribute('data-selection-to')),
    events: window.__mveImeEvents
  }));
  if (!imeResult.hasInput || !imeResult.hasExternal) {
    throw new Error(`host synchronization during composition lost IME input or external text: ${JSON.stringify(imeResult)}`);
  }
  const expectedImeSelection = imeStart + '変換'.length;
  if (imeResult.selectionFrom !== expectedImeSelection || imeResult.selectionTo !== expectedImeSelection) {
    throw new Error(`quick IME confirmation left the caret at the composition start: expected=${expectedImeSelection}, actual=${JSON.stringify(imeResult)}`);
  }

  const unackedResyncStart = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態のfilter結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    window.__mveHoldLocalOperations = true;
    return window.__mveMessages.filter(
    /**
     * 種別「requestResync」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'requestResync').length;
  });
  await page.locator('.cm-content').press('u');
  await page.waitForFunction(
  /**
   * Webviewの実行状態が完了条件を満たすまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => window.__mveHeldOperations.length === 1);
  await page.evaluate(
  /**
   * Host側の本文状態のshift結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    const operation = window.__mveHeldOperations.shift();
    const externalText = 'unacked-external\n';
    const externalBaseVersion = window.__mveHostVersion;
    window.__mveHostText = externalText + window.__mveHostText;
    window.__mveHostVersion += 1;
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'externalChanges',
        baseVersion: externalBaseVersion,
        version: window.__mveHostVersion,
        changes: [{ rangeOffset: 0, rangeLength: 0, text: externalText }],
        clientId: 'other-panel',
        opId: 'other-operation'
      }
    }));
    const mappedChanges = operation.changes.map(
    /**
     * 各changeからrange・offsetを取り出して一覧化する。
     * @param change - changeのrange・offsetを参照する走査対象。
     * @returns range・offsetを取り出した変換結果の一覧。
     */
    (change) => ({
      ...change,
      rangeOffset: change.rangeOffset + externalText.length
    }));
    const ackBaseVersion = window.__mveHostVersion;
    for (const change of [...mappedChanges].sort(
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
    window.__mveHoldLocalOperations = false;
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'editAck',
        clientId: operation.clientId,
        opId: operation.opId,
        baseVersion: ackBaseVersion,
        version: window.__mveHostVersion,
        changes: mappedChanges
      }
    }));
  });
  await page.waitForTimeout(20);
  const unackedResult = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態のfilter結果を読み取り、検証用の値へ変換する。
   * @param resyncStart - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (resyncStart) => ({
    resyncs: window.__mveMessages.filter(
    /**
     * 種別「requestResync」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'requestResync').length - resyncStart,
    converged: window.__mveHostText.includes('unacked-external\n') && window.__mveHostText.includes('u'),
    requests: window.__mveMessages.filter(
    /**
     * 種別「requestResync」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'requestResync').slice(resyncStart)
  }), unackedResyncStart);
  if (unackedResult.resyncs !== 0 || !unackedResult.converged) {
    throw new Error(`unacknowledged external edit did not rebase: ${JSON.stringify(unackedResult)}`);
  }

  const mixedStart = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態のfilter結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => ({
    localCount: window.__mveMessages.filter(
    /**
     * 種別「localChanges」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'localChanges').length,
    resyncCount: window.__mveMessages.filter(
    /**
     * 種別「requestResync」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'requestResync').length
  }));
  for (let index = 0; index < 50; index += 1) {
    const beforeLocal = await page.evaluate(
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
    (message) => message.type === 'localChanges').length);
    await page.locator('.cm-content').press('x');
    await page.waitForFunction(
    /**
     * HostとWebviewのメッセージ状態が完了条件を満たすまで待機する。
     * @param count - ブラウザー内で評価するコールバック。
     * @returns スモーク検証・高速のコールバックが生成する結果。
     */
    (count) => window.__mveMessages.filter(
    /**
     * 種別「localChanges」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'localChanges').length > count, beforeLocal);
    const localOperation = await page.evaluate(
    /**
     * HostとWebviewのメッセージ状態のfilter結果を読み取り、検証用の値へ変換する。
     * @param count - ブラウザー内で評価するコールバック。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    (count) => window.__mveMessages
      .filter(
      /**
       * 種別「localChanges」のメッセージだけを残す。
       * @param message - メッセージのtypeを参照する走査対象。
       * @returns 条件を満たした要素だけを含む一覧。
       */
      (message) => message.type === 'localChanges')[count], beforeLocal);
    if (!localOperation) throw new Error(`local operation ${index} was not captured`);
    // 実ホストはローカルWorkspaceEditのACKを先に返し、その後の外部変更を配信する。
    // ACK前に外部通知を注入すると、プロトコル順序自体が壊れたテストになり、
    // 実装の競合処理ではなくテストのタイミングを検証してしまう。
    await page.waitForFunction(
    /**
     * Webviewの実行状態が完了条件を満たすまで待機する。
     * @param opId - ブラウザー内で評価するコールバック。
     * @returns スモーク検証・高速のコールバックが生成する結果。
     */
    (opId) => window.__mveAcks.some(
    /**
     * スモーク検証・高速のコールバックとしてメッセージを処理する。
     * @param message - HostとWebviewの間で受け渡すメッセージ。
     * @returns スモーク検証・高速のコールバックが生成する結果。
     */
    (message) => message.opId === opId), localOperation.opId);
    await page.evaluate(
    /**
     * Host側の本文状態のdispatch・event結果を読み取り、検証用の値へ変換する。
     * @param iteration - ブラウザー内で評価するコールバック。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    (iteration) => {
      const baseVersion = window.__mveHostVersion;
      const text = `mix-${iteration}\n`;
      const change = { rangeOffset: 0, rangeLength: 0, text };
      window.__mveHostText = text + window.__mveHostText;
      window.__mveHostVersion += 1;
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'externalChanges', baseVersion, version: window.__mveHostVersion, changes: [change] }
      }));
    }, index);
  }
  await page.waitForTimeout(50);
  const mixedResult = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態のfilter結果を読み取り、検証用の値へ変換する。
   * @param start - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (start) => ({
    localCount: window.__mveMessages.filter(
    /**
     * 種別「localChanges」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'localChanges').length - start.localCount,
    resyncCount: window.__mveMessages.filter(
    /**
     * 種別「requestResync」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'requestResync').length - start.resyncCount,
    hasFirst: window.__mveHostText.includes('mix-0\n'),
    hasLast: window.__mveHostText.startsWith('mix-49\n')
  }), mixedStart);
  if (mixedResult.localCount !== 50 || mixedResult.resyncCount !== 0 || !mixedResult.hasFirst || !mixedResult.hasLast) {
    throw new Error(`100 mixed local/external operations did not converge: ${JSON.stringify(mixedResult)}`);
  }
  await page.evaluate(
  /**
   * Webviewの実行状態を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => { window.__mveAckDelay = 150; });
  await page.locator('.cm-content').press('Backspace');
  await page.waitForFunction(
  /**
   * HostとWebviewのメッセージ状態が完了条件を満たすまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => {
    const operation = [...window.__mveMessages].reverse().find(
    /**
     * typeが条件に一致する最初のメッセージを取得する。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件に一致した最初の要素。未検出時はundefined。
     */
    (message) => message.type === 'localChanges');
    return operation?.changes[0]?.rangeLength === 1;
  });
  const resyncMessageCounts = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態のreverse結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => {
    const operation = [...window.__mveMessages].reverse().find(
    /**
     * typeが条件に一致する最初のメッセージを取得する。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件に一致した最初の要素。未検出時はundefined。
     */
    (message) => message.type === 'localChanges');
    const change = operation.changes[0];
    const withoutLocalDelete = window.__mveHostText.slice(0, change.rangeOffset)
      + '!'
      + window.__mveHostText.slice(change.rangeOffset);
    window.__mveHostText = withoutLocalDelete.slice(0, change.rangeOffset)
      + '?'
      + withoutLocalDelete.slice(change.rangeOffset + 1);
    window.__mveHostVersion += 1;
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'resyncRequired',
        clientId: operation.clientId,
        opId: operation.opId,
        operationApplied: true,
        text: window.__mveHostText,
        version: window.__mveHostVersion,
        reason: 'smoke conflict'
      }
    }));
    return {
      local: window.__mveMessages.filter(
      /**
       * 種別「localChanges」のメッセージだけを残す。
       * @param message - メッセージのtypeを参照する走査対象。
       * @returns 条件を満たした要素だけを含む一覧。
       */
      (message) => message.type === 'localChanges').length,
      resync: window.__mveMessages.filter(
      /**
       * 種別「requestResync」のメッセージだけを残す。
       * @param message - メッセージのtypeを参照する走査対象。
       * @returns 条件を満たした要素だけを含む一覧。
       */
      (message) => message.type === 'requestResync').length
    };
  });
  await page.waitForTimeout(250);
  const resyncResult = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態のfilter結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => ({
    local: window.__mveMessages.filter(
    /**
     * 種別「localChanges」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'localChanges').length,
    resync: window.__mveMessages.filter(
    /**
     * 種別「requestResync」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'requestResync').length
  }));
  if (resyncResult.local !== resyncMessageCounts.local
    || resyncResult.resync !== resyncMessageCounts.resync) {
    throw new Error(`settled operation resync did not converge silently: ${JSON.stringify({ resyncMessageCounts, resyncResult })}`);
  }
  const retryLoopStart = await page.evaluate(
  /**
   * HostとWebviewのメッセージ状態のfilter結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => ({
    local: window.__mveMessages.filter(
    /**
     * 種別「localChanges」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'localChanges').length,
    resync: window.__mveMessages.filter(
    /**
     * 種別「requestResync」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'requestResync').length
  }));
  await page.evaluate(
  /**
   * Webviewの実行状態を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => { window.__mveHoldLocalOperations = true; });
  await sourceEditor.type('retry-loop-input');
  await page.waitForFunction(
  /**
   * Webviewの実行状態が完了条件を満たすまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => window.__mveHeldOperations.length === 1);
  const firstHeld = await page.evaluate(
  /**
   * Webviewの実行状態のshift結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveHeldOperations.shift());
  await page.evaluate(
  /**
   * Host側の本文状態のdispatch・event結果を読み取り、検証用の値へ変換する。
   * @param operation - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (operation) => {
    const version = window.__mveHostVersion;
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'resyncRequired',
        clientId: operation.clientId,
        opId: operation.opId,
        operationApplied: false,
        text: window.__mveHostText,
        version,
        reason: 'same snapshot retry-loop test'
      }
    }));
  }, firstHeld);
  await page.waitForFunction(
  /**
   * Webviewの実行状態が完了条件を満たすまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => window.__mveHeldOperations.length === 1);
  const secondHeld = await page.evaluate(
  /**
   * Webviewの実行状態のshift結果を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => window.__mveHeldOperations.shift());
  await page.evaluate(
  /**
   * Host側の本文状態のdispatch・event結果を読み取り、検証用の値へ変換する。
   * @param operation - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (operation) => {
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'resyncRequired',
        clientId: operation.clientId,
        opId: operation.opId,
        operationApplied: false,
        text: window.__mveHostText,
        version: window.__mveHostVersion,
        reason: 'same snapshot retry-loop test repeated'
      }
    }));
  }, secondHeld);
  await page.waitForTimeout(100);
  const retryLoopResult = await page.evaluate(
  /**
   * ブラウザー内の「.cm-content」を読み取り、検証用の値へ変換する。
   * @param start - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (start) => ({
    local: window.__mveMessages.filter(
    /**
     * 種別「localChanges」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'localChanges').length - start.local,
    resync: window.__mveMessages.filter(
    /**
     * 種別「requestResync」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'requestResync').length - start.resync,
    held: window.__mveHeldOperations.length,
    inputStillVisible: document.querySelector('.cm-content')?.textContent?.includes('retry-loop-input') ?? false
  }), retryLoopStart);
  if (retryLoopResult.local !== 2 || retryLoopResult.resync !== 0 || retryLoopResult.held !== 0 || !retryLoopResult.inputStillVisible) {
    throw new Error(`same-snapshot resync retried indefinitely or lost input: ${JSON.stringify(retryLoopResult)}`);
  }
  await page.evaluate(
  /**
   * Webviewの実行状態を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => { window.__mveHoldLocalOperations = false; });
  await sourceEditor.type(' recovered');
  await page.waitForFunction(
  /**
   * Host側の本文状態が完了条件を満たすまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => window.__mveHostText.includes('retry-loop-input recovered'));
  await page.evaluate(
  /**
   * Webviewの実行状態を読み取り、検証用の値へ変換する。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  () => { window.__mveAckDelay = 0; });
  await page.locator('.split-preview').waitFor();
  for (let index = 0; index < 10; index += 1) {
    const currentZoom = await page.evaluate(
    /**
     * ブラウザー内の「.split-preview .rendered-markdown」を読み取り、検証用の値へ変換する。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    () => Number.parseFloat(
      document.querySelector('.split-preview .rendered-markdown')?.getAttribute('data-mve-image-zoom') ?? '',
    ));
    if (!Number.isFinite(currentZoom)) throw new Error('normal preview zoom state was unavailable for image smoke');
    if (currentZoom === 1) break;
    const previousZoom = String(currentZoom);
    await page.locator('.editor-area').dispatchEvent('wheel', {
      deltaY: currentZoom > 1 ? 100 : -100,
      ctrlKey: true,
    });
    await page.waitForFunction(
    /**
     * ブラウザー内に「.split-preview .rendered-markdown」が現れるまで待機する。
     * @param value - ブラウザー内で評価するコールバック。
     * @returns スモーク検証・高速のコールバックが生成する結果。
     */
    (value) => document.querySelector('.split-preview .rendered-markdown')?.getAttribute('data-mve-image-zoom') !== value, previousZoom);
  }
  await page.waitForFunction(
  /**
   * ブラウザー内に「.split-preview .rendered-markdown」が現れるまで待機する。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  () => document.querySelector('.split-preview .rendered-markdown')?.getAttribute('data-mve-image-zoom') === '1');
  const imageSmokeSource = `# Image zoom smoke\n\n<img src="${zoomImageSource}" width="160" alt="zoom image">\n`;
  await page.evaluate(
  /**
   * Host側の本文状態のreplace結果を読み取り、検証用の値へ変換する。
   * @param text - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (text) => {
    const previousText = window.__mveHostText;
    const baseVersion = window.__mveHostVersion;
    window.__mveHostText = text;
    window.__mvePhysicalText = text.replace(/\n/g, '\r\n');
    window.__mveHostVersion += 1;
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'externalChanges',
        baseVersion,
        version: window.__mveHostVersion,
        changes: [{ rangeOffset: 0, rangeLength: previousText.length, text }]
      }
    }));
  }, imageSmokeSource);
  await page.waitForFunction(
  /**
   * Host側の本文状態が完了条件を満たすまで待機する。
   * @param text - ブラウザー内で評価するコールバック。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (text) => window.__mveHostText === text, imageSmokeSource);
  await page.waitForFunction(
  /**
   * ブラウザー内に「.split-preview .rendered-markdown」が現れるまで待機する。
   * @param length - ブラウザー内で評価するコールバック。
   * @returns スモーク検証・高速のコールバックが生成する結果。
   */
  (length) => Number(
    document.querySelector('.split-preview .rendered-markdown')?.getAttribute('data-document-length'),
  ) === length, imageSmokeSource.length);
  await runImageZoomSmoke();
  await context.close();
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('高速スモーク: 空CRLF文書の単一改行同期、LFプロトコル、画像保存先設定、表編集、フォーカス非介入、スクロール同期設定、スクロール保持、分割表示、ズーム、空白可視化、ハイライトを確認しました。');
} finally {
  await browser.close();
}

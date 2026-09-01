import { chromium } from 'playwright-core';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

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

const executablePath = await findFile(path.resolve('.chromium'), 'chrome-headless-shell.exe');
if (!executablePath) throw new Error('Chromium がありません。npm run pdf:install-browser を実行してください。');
const webviewBundle = await readFile(path.resolve('dist/webview.js'), 'utf8');
const markdownWorkerBundle = await readFile(path.resolve('dist/markdown-worker.js'), 'utf8');
const browser = await chromium.launch({ executablePath, headless: true });

try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.__mveMessages = [];
    window.__mveHostVersion = 1;
    window.__mveHostText = '';
    window.__mveAckDelay = 120;
    window.__mveAppliedOperations = new Set();
    window.acquireVsCodeApi = () => ({
      postMessage: (message) => {
        window.__mveMessages.push(message);
        if (message.type === 'localChanges') {
          const baseVersion = window.__mveHostVersion;
          for (const change of [...message.changes].sort((left, right) => right.rangeOffset - left.rangeOffset)) {
            window.__mveHostText = window.__mveHostText.slice(0, change.rangeOffset)
              + change.text
              + window.__mveHostText.slice(change.rangeOffset + change.rangeLength);
          }
          window.__mveHostVersion += 1;
          const version = window.__mveHostVersion;
          window.__mveAppliedOperations.add(`${message.clientId}\0${message.opId}`);
          setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
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
          setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
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
      getState: () => undefined,
      setState: () => undefined
    });
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  page.setDefaultTimeout(5_000);
  await page.goto('about:blank');
  await page.setContent('<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>');
  await page.evaluate((workerSource) => {
    document.body.dataset.mveMarkdownWorkerUri = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  }, markdownWorkerBundle);
  await page.addStyleTag({ path: path.resolve('dist/styles.css') });
  await page.addStyleTag({ path: path.resolve('dist/webview.css') });
  await page.addScriptTag({ content: webviewBundle });
  await page.waitForFunction(() => window.__mveMessages.some((message) => message.type === 'ready'));

  const source = '最中最中に\r\n文字入力\r\n最中に何か入力';
  await page.evaluate((text) => {
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
  await page.evaluate(() => {
    window.__mveImeEvents = [];
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input', 'keydown', 'keyup']) {
      document.addEventListener(type, (event) => window.__mveImeEvents.push({
        type,
        data: event.data,
        inputType: event.inputType,
        key: event.key,
        isComposing: event.isComposing
      }), true);
    }
  });
  const start = await page.evaluate(() => Number(document.querySelector('.source-editor')?.getAttribute('data-selection-from')));
  // Windowsの日本語IMEは、予測・文節変換中のpreedit選択を入力開始位置へ置くことがある。
  const firstComposition = ['ば', 'ばっくすらっしゅ', 'バックスラッシュ', 'バックスラッシュによる'];
  for (const text of firstComposition) {
    await cdp.send('Input.imeSetComposition', { text, selectionStart: 0, selectionEnd: 0 });
  }
  const firstPreeditOperations = await page.evaluate(
    () => window.__mveMessages.filter((message) => message.type === 'localChanges').length
  );
  if (firstPreeditOperations !== 0) {
    throw new Error(`IMEの変換途中に同期操作が送信された: ${firstPreeditOperations}`);
  }
  await page.evaluate(() => {
    const baseVersion = window.__mveHostVersion;
    const text = '\r\n外部エディター追記';
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
    () => window.__mveMessages.filter((message) => message.type === 'localChanges').length === 1
  );
  await page.evaluate(() => {
    const content = document.querySelector('.cm-content');
    content?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Shift', code: 'ShiftLeft' }));
  });
  const secondComposition = ['か', 'かいぎょうの', '改行の'];
  const operationsBeforeSecondPreedit = await page.evaluate(
    () => window.__mveMessages.filter((message) => message.type === 'localChanges').length
  );
  for (const text of secondComposition) {
    await cdp.send('Input.imeSetComposition', { text, selectionStart: 0, selectionEnd: 0 });
  }
  const secondPreeditOperations = await page.evaluate(
    () => window.__mveMessages.filter((message) => message.type === 'localChanges').length
  );
  if (secondPreeditOperations !== operationsBeforeSecondPreedit) {
    throw new Error(`2回目のIME変換途中に同期操作が送信された: ${secondPreeditOperations}`);
  }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await cdp.send('Input.insertText', { text: secondComposition.at(-1) });
  const selectionBeforeNextKey = await page.evaluate(() => {
    const content = document.querySelector('.cm-content');
    // compositionendと確定タイマーの間に次のキーが来ても、入力先を先頭へ戻さない。
    content?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'k', code: 'KeyK' }));
    return Number(document.querySelector('.source-editor')?.getAttribute('data-selection-from'));
  });
  await page.waitForTimeout(800);
  const result = await page.evaluate(() => ({
    hostText: window.__mveHostText,
    editorText: document.querySelector('.cm-content')?.textContent,
    selectionFrom: Number(document.querySelector('.source-editor')?.getAttribute('data-selection-from')),
    selectionTo: Number(document.querySelector('.source-editor')?.getAttribute('data-selection-to')),
    domSelectionOffset: (() => {
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
  const expectedHostText = `${source.slice(0, start)}${committedText}${source.slice(start)}\r\n外部エディター追記`;
  if (result.events.filter((event) => event.type === 'compositionend').length !== 2
    || result.hostText !== expectedHostText
    || selectionBeforeNextKey !== expected
    || result.selectionFrom !== expected
    || result.selectionTo !== expected
    || result.domSelectionOffset !== expected) {
    throw new Error(`IMEをEnterですぐ確定した後のカーソル位置が不正です: expected=${expected}, result=${JSON.stringify(result)}`);
  }
  await editor.press('k');
  await page.waitForTimeout(100);
  const marker = await page.evaluate((offset) => window.__mveHostText.slice(offset, offset + 1), expected);
  if (marker !== 'k') throw new Error(`IME確定後の次の入力位置が不正です: expected=${expected}, actual=${JSON.stringify(marker)}`);
  console.log('IME caret smoke test passed.');
} finally {
  await browser.close();
}

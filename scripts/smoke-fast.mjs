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
if (/react\.development\.js|@milkdown|MILKDOWN_LISTENER/.test(webviewBundle)) {
  throw new Error('製品Webviewバンドルに開発用ReactまたはMilkdownが残っています。');
}
const browser = await chromium.launch({ executablePath, headless: true });
const errors = [];
try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.__mveMessages = [];
    window.__mveHostVersion = 1;
    window.__mveHostText = '';
    window.__mveAckDelay = 0;
    window.__mveHoldLocalOperations = false;
    window.__mveHeldOperations = [];
    window.__mveAppliedOperations = new Set();
    window.__mveUndoStack = [];
    window.__mveRedoStack = [];
    window.acquireVsCodeApi = () => ({
      postMessage: (message) => {
        window.__mveMessages.push(message);
        if (message.type === 'localChanges') {
          if (window.__mveHoldLocalOperations) {
            window.__mveHeldOperations.push(message);
            return;
          }
          window.__mveUndoStack.push(window.__mveHostText);
          window.__mveRedoStack = [];
          const baseVersion = window.__mveHostVersion;
          for (const change of [...message.changes].sort((left, right) => right.rangeOffset - left.rangeOffset)) {
            window.__mveHostText = window.__mveHostText.slice(0, change.rangeOffset)
              + change.text
              + window.__mveHostText.slice(change.rangeOffset + change.rangeLength);
          }
          window.__mveHostVersion += 1;
          window.__mveAppliedOperations.add(`${message.clientId}\0${message.opId}`);
          setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
            data: {
              type: 'editAck',
              clientId: message.clientId,
              opId: message.opId,
              baseVersion,
              version: window.__mveHostVersion,
              changes: message.changes
            }
          })), window.__mveAckDelay);
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
          setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
            data: {
              type: 'externalChanges',
              baseVersion,
              version: window.__mveHostVersion,
              changes: [{ rangeOffset: 0, rangeLength: previousText.length, text: nextText }]
            }
          })), 0);
        }
        if (message.type === 'requestResync') setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
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
      },
      getState: () => undefined,
      setState: () => undefined
    });
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  page.setDefaultTimeout(5_000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('about:blank');
  await page.setContent('<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({ path: path.resolve('dist/styles.css') });
  await page.addScriptTag({ path: path.resolve('dist/webview.js') });
  await page.waitForFunction(() => window.__mveMessages.some((message) => message.type === 'ready'));
  const source = ('# Smoke\n\nfirst\\\nsecond\n\nReference [link][target] and note[^note].\n\n<!-- ordinary comment -->\n\n<div>raw-one</div>\n<div>raw-two</div>\n\n[target]: https://example.com\n\n[^note]: footnote body\n\n```ts\nconst value = 1;\n```\n'
    + Array.from({ length: 220 }, (_, index) => `\n## Long section ${index}\n\n${'content '.repeat(16)}${index}\n`).join(''))
    .replace(/\n/g, '\r\n');
  await page.evaluate((text) => { window.__mveHostText = text; }, source);
  await page.evaluate((text) => window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'init', text, version: 1, uri: 'file:///C:/smoke.md', settings: { language: 'ja', imageDirectory: 'assets/${documentBasename}', maxPasteSizeMb: 20, remoteImagesEnabled: false, mermaidTheme: 'default', workspaceTrusted: true } }
  })), source);
  try {
    await page.locator('.split-editor').waitFor();
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nBrowser errors:\n${errors.join('\n')}`);
  }
  if (!(await page.locator('.split-preview br').count())) throw new Error('hardbreak rendering failed');
  const anchorMarkup = await page.evaluate((text) => {
    const reference = [...document.querySelectorAll('.split-preview .markdown-source-block')]
      .find((element) => element.textContent?.includes('Reference'));
    const rawOne = [...document.querySelectorAll('.split-preview div')].find((element) => element.textContent === 'raw-one');
    const rawTwo = [...document.querySelectorAll('.split-preview div')].find((element) => element.textContent === 'raw-two');
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
  const sourceEditor = page.locator('.split-editor .cm-content');
  const editorNode = await page.locator('.split-editor .cm-editor').elementHandle();
  await sourceEditor.click();
  await sourceEditor.press('Control+Home');
  await sourceEditor.press('ArrowDown');
  await sourceEditor.press('ArrowDown');
  await sourceEditor.press('ArrowDown');
  await sourceEditor.press('End');
  await sourceEditor.type('  \nX');
  await page.waitForFunction(() => window.__mveMessages.some((message) => message.type === 'localChanges'));
  if (!(await page.evaluate(() => window.__mveHostText.includes('second  \r\n')))) throw new Error('two-space hardbreak was removed during source edit');
  const beforeRibbonUndo = await page.evaluate(() => window.__mveHostText);
  await sourceEditor.press('Z');
  await page.waitForFunction((text) => window.__mveHostText.length === text.length + 1, beforeRibbonUndo);
  await page.locator('button[title^="元に戻す"]').click();
  await page.waitForFunction((text) => window.__mveHostText === text, beforeRibbonUndo);
  await page.locator('button[title^="やり直す"]').click();
  await page.waitForFunction((text) => window.__mveHostText.length === text.length + 1, beforeRibbonUndo);
  const beforeKeyboardUndo = await page.evaluate(() => window.__mveHostText);
  await sourceEditor.click();
  await sourceEditor.press('Q');
  await page.waitForFunction((text) => window.__mveHostText.length === text.length + 1, beforeKeyboardUndo);
  await sourceEditor.press('Control+Z');
  await page.waitForFunction((text) => window.__mveHostText === text, beforeKeyboardUndo);
  await sourceEditor.press('Control+Shift+Z');
  await page.waitForFunction((text) => window.__mveHostText.length === text.length + 1, beforeKeyboardUndo);
  await sourceEditor.press('Control+Z');
  await page.waitForFunction((text) => window.__mveHostText.length === text.length, beforeKeyboardUndo);
  await sourceEditor.press('Control+Z');
  await page.waitForFunction((text) => window.__mveHostText === text, beforeRibbonUndo);
  await sourceEditor.press('Control+Home');
  await sourceEditor.press('ArrowDown');
  await sourceEditor.press('ArrowDown');
  await sourceEditor.press('ArrowDown');
  await sourceEditor.press('ArrowDown');
  await sourceEditor.press('End');
  await page.waitForTimeout(50);
  if (!(await page.evaluate((node) => node === document.querySelector('.split-editor .cm-editor'), editorNode))) throw new Error('blank-line edit remounted the source editor');
  await page.locator('.cm-scroller').evaluate((element) => { element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.7; });
  await page.locator('.split-preview').evaluate((element) => { element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.7; });
  await page.waitForTimeout(50);
  const beforeExternal = await page.evaluate(() => ({
    source: document.querySelector('.cm-scroller')?.scrollTop ?? 0,
    preview: document.querySelector('.split-preview')?.scrollTop ?? 0
  }));
  await page.evaluate(() => {
    const baseVersion = window.__mveHostVersion;
    const change = { rangeOffset: window.__mveHostText.length, rangeLength: 0, text: '\r\nexternal-host-change' };
    window.__mveHostText += change.text;
    window.__mveHostVersion += 1;
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'externalChanges', baseVersion, version: window.__mveHostVersion, changes: [change] }
    }));
  });
  await page.waitForTimeout(50);
  const afterExternal = await page.evaluate(() => ({
    source: document.querySelector('.cm-scroller')?.scrollTop ?? 0,
    preview: document.querySelector('.split-preview')?.scrollTop ?? 0
  }));
  if (Math.abs(afterExternal.source - beforeExternal.source) > 1) throw new Error(`host synchronization moved source scroll: ${beforeExternal.source} -> ${afterExternal.source}`);
  if (Math.abs(afterExternal.preview - beforeExternal.preview) > 1) throw new Error(`host synchronization moved preview scroll: ${beforeExternal.preview} -> ${afterExternal.preview}`);
  const beforeTopInsertion = await page.evaluate(() => {
    const preview = document.querySelector('.split-preview');
    const previewTop = preview?.getBoundingClientRect().top ?? 0;
    const previewBlock = [...document.querySelectorAll('.split-preview [data-source-from]')]
      .find((element) => element.getBoundingClientRect().bottom > previewTop + 1);
    return {
      sourceOffset: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-offset')),
      sourceEndOffset: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-end-offset')),
      sourceTopOffset: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-top-offset')),
      previewOffset: Number(previewBlock?.getAttribute('data-source-from')),
      previewTopOffset: (previewBlock?.getBoundingClientRect().top ?? 0) - previewTop
    };
  });
  const topInsertionLength = await page.evaluate(() => {
    const baseVersion = window.__mveHostVersion;
    const prefix = Array.from({ length: 40 }, (_, index) => `# inserted-${index}\r\n\r\nbody\r\n\r\n`).join('');
    const change = { rangeOffset: 0, rangeLength: 0, text: prefix };
    window.__mveHostText = prefix + window.__mveHostText;
    window.__mveHostVersion += 1;
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'externalChanges', baseVersion, version: window.__mveHostVersion, changes: [change] }
    }));
    return prefix.length;
  });
  await page.waitForFunction(({ sourceOffset, previewOffset, insertedLength }) => {
    const currentSource = Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-offset'));
    const currentSourceEnd = Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-end-offset'));
    const preview = document.querySelector('.split-preview');
    const previewTop = preview?.getBoundingClientRect().top ?? 0;
    const previewBlock = [...document.querySelectorAll('.split-preview [data-source-from]')]
      .find((element) => element.getBoundingClientRect().bottom > previewTop + 1);
    const currentPreview = Number(previewBlock?.getAttribute('data-source-from'));
    const expectedSource = sourceOffset + insertedLength;
    return currentSource <= expectedSource
      && expectedSource <= currentSourceEnd
      && currentPreview === previewOffset + insertedLength;
  }, { sourceOffset: beforeTopInsertion.sourceOffset, previewOffset: beforeTopInsertion.previewOffset, insertedLength: topInsertionLength });
  const afterTopInsertion = await page.evaluate(() => {
    const preview = document.querySelector('.split-preview');
    const previewTop = preview?.getBoundingClientRect().top ?? 0;
    const previewBlock = [...document.querySelectorAll('.split-preview [data-source-from]')]
      .find((element) => element.getBoundingClientRect().bottom > previewTop + 1);
    return {
      sourceOffset: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-offset')),
      sourceEndOffset: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-end-offset')),
      sourceTopOffset: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-top-offset')),
      previewOffset: Number(previewBlock?.getAttribute('data-source-from')),
      previewTopOffset: (previewBlock?.getBoundingClientRect().top ?? 0) - previewTop
    };
  });
  const mappedTopSourceOffset = beforeTopInsertion.sourceOffset + topInsertionLength;
  if (afterTopInsertion.sourceOffset > mappedTopSourceOffset
    || afterTopInsertion.sourceEndOffset < mappedTopSourceOffset
    || Math.abs(afterTopInsertion.sourceTopOffset - beforeTopInsertion.sourceTopOffset) > 1) {
    throw new Error(`top insertion moved source viewport: ${JSON.stringify(beforeTopInsertion)} -> ${JSON.stringify(afterTopInsertion)}`);
  }
  if (afterTopInsertion.previewOffset !== beforeTopInsertion.previewOffset + topInsertionLength
    || Math.abs(afterTopInsertion.previewTopOffset - beforeTopInsertion.previewTopOffset) > 2) {
    throw new Error(`top insertion moved preview viewport: ${JSON.stringify(beforeTopInsertion)} -> ${JSON.stringify(afterTopInsertion)}`);
  }
  if (!(await page.locator('.split-editor .cm-editor.cm-focused').count())) throw new Error('focused editor did not retain its natural focus');
  await sourceEditor.type('Y');
  await page.waitForTimeout(350);
  if (!(await page.evaluate(() => window.__mveHostText.includes('second  \r\nXY')))) throw new Error('blank-line edit moved the caret');
  const loneLf = await page.evaluate(() => {
    const match = /(^|[^\r])\n/.exec(window.__mveHostText);
    return match ? { index: match.index, sample: JSON.stringify(window.__mveHostText.slice(Math.max(0, match.index - 20), match.index + 30)) } : undefined;
  });
  if (loneLf) throw new Error(`CRLF was normalized during source edit at ${loneLf.index}: ${loneLf.sample}`);
  const queuedMessageStart = await page.evaluate(() => {
    window.__mveAckDelay = 80;
    return window.__mveMessages.length;
  });
  await sourceEditor.press('A');
  await sourceEditor.press('B');
  await sourceEditor.press('C');
  await page.waitForTimeout(400);
  const queuedOperations = await page.evaluate((start) => {
    window.__mveAckDelay = 0;
    return window.__mveMessages.slice(start).filter((message) => message.type === 'localChanges');
  }, queuedMessageStart);
  if (queuedOperations.length !== 3) throw new Error(`local operation queue lost ordering: ${queuedOperations.length}`);
  if (queuedOperations.some((operation, index) => operation.changes.length !== 1
    || operation.changes[0].rangeLength !== 0
    || operation.changes[0].text !== 'ABC'[index]
    || (index > 0 && operation.baseVersion !== queuedOperations[index - 1].baseVersion + 1))) {
    throw new Error(`local operation queue collapsed exact changes: ${JSON.stringify(queuedOperations)}`);
  }
  await page.getByRole('tab', { name: 'ホーム', exact: true }).click();
  await page.locator('button[title^="元に戻す"]').click();
  await page.waitForTimeout(50);
  if (!(await page.evaluate(() => window.__mveHostText.startsWith('# inserted-0\r\n')))) {
    throw new Error('undo incorrectly reverted an external host change');
  }
  await page.locator('button[title^="やり直す"]').click();
  await page.waitForTimeout(50);

  const focusTarget = page.getByRole('button', { name: '検索', exact: true });
  await focusTarget.click();
  const activeBeforeBlurSync = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent);
  await page.evaluate(() => {
    const baseVersion = window.__mveHostVersion;
    const change = { rangeOffset: window.__mveHostText.length, rangeLength: 0, text: '\r\nblurred-host-change' };
    window.__mveHostText += change.text;
    window.__mveHostVersion += 1;
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'externalChanges', baseVersion, version: window.__mveHostVersion, changes: [change] }
    }));
  });
  await page.waitForTimeout(50);
  const activeAfterBlurSync = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent);
  if (activeAfterBlurSync !== activeBeforeBlurSync) throw new Error('blurred host synchronization stole focus');

  const outline = page.locator('[title="アウトラインの表示/非表示"]');
  await outline.click();
  await page.locator('.outline-panel').waitFor({ state: 'hidden' });
  await outline.click();
  await page.locator('.outline-panel').waitFor();
  await page.getByRole('button', { name: 'アウトラインを非表示', exact: true }).click();
  await page.locator('.outline-panel').waitFor({ state: 'hidden' });
  await outline.click();
  await page.locator('.outline-panel').waitFor();
  await page.getByRole('button', { name: '検索', exact: true }).click();
  await page.getByRole('textbox', { name: '検索文字列' }).fill('Long section 150');
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await page.locator('.search-panel').getByRole('button', { name: '閉じる', exact: true }).click();
  const formatMessageStart = await page.evaluate(() => window.__mveMessages.length);
  await page.getByRole('tab', { name: 'ホーム', exact: true }).click();
  await page.locator('button[title^="太字"]').click();
  await page.waitForTimeout(100);
  const formatOperation = await page.evaluate((start) => window.__mveMessages
    .slice(start)
    .find((message) => message.type === 'localChanges'), formatMessageStart);
  const expectedFormatOffset = await page.evaluate(() => window.__mveHostText.indexOf('**Long section 150**'));
  if (!formatOperation || formatOperation.changes.length !== 1
    || Math.abs(formatOperation.changes[0].rangeOffset - expectedFormatOffset) > 2
    || formatOperation.changes[0].rangeLength > 40) {
    throw new Error(`CRLF formatting produced a non-local change: ${JSON.stringify(formatOperation)}`);
  }
  await page.getByRole('button', { name: '検索', exact: true }).click();
  await page.getByRole('textbox', { name: '検索文字列' }).fill('first');
  await page.getByText('1/1', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: '置換文字列' }).fill('replaced');
  await page.getByRole('button', { name: '置換', exact: true }).click();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();

  await page.getByRole('tab', { name: '表示', exact: true }).click();
  await page.getByRole('button', { name: '左右分割', exact: true }).click();
  await page.locator('.split-editor').waitFor();
  const divider = page.locator('.split-divider');
  const before = await page.locator('.split-editor').evaluate((element) => getComputedStyle(element).gridTemplateColumns);
  const bounds = await divider.boundingBox();
  if (!bounds) throw new Error('split divider is not visible');
  await page.mouse.move(bounds.x + 4, bounds.y + 10);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 60, bounds.y + 10);
  await page.mouse.up();
  const after = await page.locator('.split-editor').evaluate((element) => getComputedStyle(element).gridTemplateColumns);
  if (before === after) throw new Error('split divider did not resize');
  const zoomBefore = await page.locator('.status-bar').textContent();
  await page.locator('.editor-area').dispatchEvent('wheel', { deltaY: -100, ctrlKey: true });
  await page.waitForFunction((value) => document.querySelector('.status-bar')?.textContent !== value, zoomBefore);

  await page.locator('.cm-scroller').evaluate((element) => { element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.55; });
  await page.locator('.split-preview').evaluate((element) => { element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.55; });
  await page.waitForTimeout(50);
  const anchorsBeforeModeChange = await page.evaluate(() => {
    const preview = document.querySelector('.split-preview');
    const previewTop = preview?.getBoundingClientRect().top ?? 0;
    const previewBlock = [...document.querySelectorAll('.split-preview [data-source-from]')].find((element) => element.getBoundingClientRect().bottom > previewTop + 1);
    return {
      source: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-offset')),
      sourceEnd: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-end-offset')),
      sourceTopOffset: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-top-offset')),
      preview: previewBlock?.getAttribute('data-source-from'),
      previewTopOffset: (previewBlock?.getBoundingClientRect().top ?? 0) - previewTop
    };
  });
  await page.setViewportSize({ width: 1050, height: 720 });
  await page.waitForTimeout(150);
  await page.waitForTimeout(500);
  const anchorsAfterWindowResize = await page.evaluate(() => {
    const preview = document.querySelector('.split-preview');
    const previewTop = preview?.getBoundingClientRect().top ?? 0;
    const previewBlock = [...document.querySelectorAll('.split-preview [data-source-from]')].find((element) => element.getBoundingClientRect().bottom > previewTop + 1);
    return {
      source: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-offset')),
      sourceEnd: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-end-offset')),
      sourceTopOffset: Number(document.querySelector('.source-editor')?.getAttribute('data-viewport-top-offset')),
      preview: previewBlock?.getAttribute('data-source-from'),
      previewTopOffset: (previewBlock?.getBoundingClientRect().top ?? 0) - previewTop
    };
  });
  if (anchorsAfterWindowResize.source > anchorsBeforeModeChange.source
    || anchorsAfterWindowResize.sourceEnd < anchorsBeforeModeChange.source
    || anchorsAfterWindowResize.preview !== anchorsBeforeModeChange.preview
    || Math.abs(anchorsAfterWindowResize.sourceTopOffset - anchorsBeforeModeChange.sourceTopOffset) > 20
    || Math.abs(anchorsAfterWindowResize.previewTopOffset - anchorsBeforeModeChange.previewTopOffset) > 20) {
    throw new Error(`window resize did not preserve pane anchors: ${JSON.stringify(anchorsBeforeModeChange)} -> ${JSON.stringify(anchorsAfterWindowResize)}`);
  }

  await page.getByRole('button', { name: 'テキストのみ', exact: true }).click();
  await page.locator('.split-source-pane').waitFor();
  await page.locator('.split-preview').waitFor({ state: 'hidden' });
  await page.waitForTimeout(50);
  if (!(await page.locator('.cm-visible-space').count())) throw new Error('source whitespace markers are missing');
  if (!(await page.locator('.cm-content span[class*="ͼ"], .cm-content .tok-keyword, .cm-content .tok-string').count())) {
    throw new Error('source syntax highlighting is missing');
  }
  const sourceAfterModeChange = await page.evaluate(() => {
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
  const previewAfterModeChange = await page.evaluate(() => {
    const preview = document.querySelector('.split-preview');
    const top = preview?.getBoundingClientRect().top ?? 0;
    return [...document.querySelectorAll('.split-preview [data-source-from]')].find((element) => element.getBoundingClientRect().bottom > top + 1)?.getAttribute('data-source-from');
  });
  if (previewAfterModeChange !== anchorsBeforeModeChange.preview) throw new Error('preview-only mode did not preserve the preview anchor');

  await page.getByRole('button', { name: 'Long section 120', exact: true }).click();
  await page.locator('.split-source-pane').waitFor();
  const caretBeforePreview = await page.evaluate(() => window.__mveHostText.indexOf('## Long section 120'));

  await page.getByRole('tab', { name: '出力', exact: true }).click();
  await page.getByRole('button', { name: '印刷プレビュー', exact: true }).click();
  await page.locator('.preview-only').waitFor();
  await page.waitForTimeout(50);
  const printPreviewAnchor = await page.evaluate(() => {
    const container = document.querySelector('.editor-area');
    const top = container?.getBoundingClientRect().top ?? 0;
    return [...document.querySelectorAll('.preview-only [data-source-from]')].find((element) => element.getBoundingClientRect().bottom > top + 1)?.getAttribute('data-source-from');
  });
  if (printPreviewAnchor !== anchorsBeforeModeChange.preview) throw new Error('print preview mode did not preserve the preview anchor');
  const previewPrefixLength = await page.evaluate(() => {
    const baseVersion = window.__mveHostVersion;
    const prefix = '# preview-external\r\n\r\n';
    const change = { rangeOffset: 0, rangeLength: 0, text: prefix };
    window.__mveHostText = prefix + window.__mveHostText;
    window.__mveHostVersion += 1;
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'externalChanges', baseVersion, version: window.__mveHostVersion, changes: [change] }
    }));
    return prefix.length;
  });
  await page.waitForTimeout(50);
  await page.locator('.pdf-settings-panel').getByRole('button', { name: '閉じる', exact: true }).click();
  await page.locator('.split-source-pane').waitFor();
  await page.locator('.cm-content').press('!');
  await page.waitForTimeout(100);
  const selectionRestored = await page.evaluate(({ offset, prefixLength }) =>
    window.__mveHostText.slice(offset + prefixLength, offset + prefixLength + 1) === '!',
  { offset: caretBeforePreview, prefixLength: previewPrefixLength });
  if (!selectionRestored) throw new Error('preview-only external insertion did not map the unmounted source selection');
  await page.evaluate(() => {
    window.__mveImeEvents = [];
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input']) {
      document.addEventListener(type, (event) => window.__mveImeEvents.push({ type, data: event.data, inputType: event.inputType }), true);
    }
  });
  await cdp.send('Input.imeSetComposition', { text: '変', selectionStart: 1, selectionEnd: 1 });
  await page.waitForTimeout(10);
  const imeAfterFirst = await page.evaluate(() => ({
    hostTail: window.__mveHostText.slice(-50),
    editorTail: document.querySelector('.cm-content')?.textContent?.slice(-50),
    localCount: window.__mveMessages.filter((message) => message.type === 'localChanges').length,
    events: window.__mveImeEvents
  }));
  await page.waitForTimeout(10);
  await page.evaluate(() => {
    const baseVersion = window.__mveHostVersion;
    const change = { rangeOffset: window.__mveHostText.length, rangeLength: 0, text: '\r\nime-external' };
    window.__mveHostText += change.text;
    window.__mveHostVersion += 1;
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'externalChanges', baseVersion, version: window.__mveHostVersion, changes: [change] }
    }));
  });
  await cdp.send('Input.imeSetComposition', { text: '変換', selectionStart: 2, selectionEnd: 2 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await page.locator('.cm-content').dispatchEvent('compositionend', { data: '変換' });
  await page.waitForTimeout(250);
  const imeResult = await page.evaluate((start) => ({
    hasInput: window.__mveHostText.includes('変'),
    hasExternal: window.__mveHostText.endsWith('ime-external'),
    tail: window.__mveHostText.slice(-80),
    resyncs: window.__mveMessages.filter((message) => message.type === 'requestResync').length,
    editorTail: document.querySelector('.cm-content')?.textContent?.slice(-80),
    events: window.__mveImeEvents
  }));
  if (!imeResult.hasInput || !imeResult.hasExternal) {
    throw new Error(`host synchronization during composition lost IME input or external text: ${JSON.stringify(imeResult)}`);
  }

  const unackedResyncStart = await page.evaluate(() => {
    window.__mveHoldLocalOperations = true;
    return window.__mveMessages.filter((message) => message.type === 'requestResync').length;
  });
  await page.locator('.cm-content').press('u');
  await page.waitForFunction(() => window.__mveHeldOperations.length === 1);
  await page.evaluate(() => {
    const operation = window.__mveHeldOperations.shift();
    const externalText = 'unacked-external\r\n';
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
    const mappedChanges = operation.changes.map((change) => ({
      ...change,
      rangeOffset: change.rangeOffset + externalText.length
    }));
    const ackBaseVersion = window.__mveHostVersion;
    for (const change of [...mappedChanges].sort((left, right) => right.rangeOffset - left.rangeOffset)) {
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
  const unackedResult = await page.evaluate((resyncStart) => ({
    resyncs: window.__mveMessages.filter((message) => message.type === 'requestResync').length - resyncStart,
    converged: window.__mveHostText.includes('unacked-external\r\n') && window.__mveHostText.includes('u'),
    requests: window.__mveMessages.filter((message) => message.type === 'requestResync').slice(resyncStart)
  }), unackedResyncStart);
  if (unackedResult.resyncs !== 0 || !unackedResult.converged) {
    throw new Error(`unacknowledged external edit did not rebase: ${JSON.stringify(unackedResult)}`);
  }

  const mixedStart = await page.evaluate(() => ({
    localCount: window.__mveMessages.filter((message) => message.type === 'localChanges').length,
    resyncCount: window.__mveMessages.filter((message) => message.type === 'requestResync').length
  }));
  for (let index = 0; index < 50; index += 1) {
    const beforeLocal = await page.evaluate(() => window.__mveMessages.filter((message) => message.type === 'localChanges').length);
    await page.locator('.cm-content').press('x');
    await page.waitForFunction((count) => window.__mveMessages.filter((message) => message.type === 'localChanges').length > count, beforeLocal);
    await page.waitForTimeout(1);
    await page.evaluate((iteration) => {
      const baseVersion = window.__mveHostVersion;
      const text = `mix-${iteration}\r\n`;
      const change = { rangeOffset: 0, rangeLength: 0, text };
      window.__mveHostText = text + window.__mveHostText;
      window.__mveHostVersion += 1;
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'externalChanges', baseVersion, version: window.__mveHostVersion, changes: [change] }
      }));
    }, index);
  }
  await page.waitForTimeout(50);
  const mixedResult = await page.evaluate((start) => ({
    localCount: window.__mveMessages.filter((message) => message.type === 'localChanges').length - start.localCount,
    resyncCount: window.__mveMessages.filter((message) => message.type === 'requestResync').length - start.resyncCount,
    hasFirst: window.__mveHostText.includes('mix-0\r\n'),
    hasLast: window.__mveHostText.startsWith('mix-49\r\n')
  }), mixedStart);
  if (mixedResult.localCount !== 50 || mixedResult.resyncCount !== 0 || !mixedResult.hasFirst || !mixedResult.hasLast) {
    throw new Error(`100 mixed local/external operations did not converge: ${JSON.stringify(mixedResult)}`);
  }
  await page.evaluate(() => { window.__mveAckDelay = 150; });
  await page.locator('.cm-content').press('Backspace');
  await page.waitForFunction(() => {
    const operation = [...window.__mveMessages].reverse().find((message) => message.type === 'localChanges');
    return operation?.changes[0]?.rangeLength === 1;
  });
  const resyncMessageCounts = await page.evaluate(() => {
    const operation = [...window.__mveMessages].reverse().find((message) => message.type === 'localChanges');
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
      local: window.__mveMessages.filter((message) => message.type === 'localChanges').length,
      resync: window.__mveMessages.filter((message) => message.type === 'requestResync').length
    };
  });
  await page.waitForTimeout(250);
  const resyncResult = await page.evaluate(() => ({
    local: window.__mveMessages.filter((message) => message.type === 'localChanges').length,
    resync: window.__mveMessages.filter((message) => message.type === 'requestResync').length
  }));
  if (resyncResult.local !== resyncMessageCounts.local
    || resyncResult.resync !== resyncMessageCounts.resync) {
    throw new Error(`settled operation resync did not converge silently: ${JSON.stringify({ resyncMessageCounts, resyncResult })}`);
  }
  await page.evaluate(() => { window.__mveAckDelay = 0; });
  await context.close();
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('高速スモーク: フォーカス非介入、スクロール保持、CRLF、分割表示、ズーム、空白可視化、ハイライトを確認しました。');
} finally {
  await browser.close();
}

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

function stripInstructions(markdown) {
  return markdown.replace(/^<!--[\s\S]*?-->\s*/, '');
}

function moveHeadingBlock(markdown, sourceHeading, targetHeading, position) {
  const lines = markdown.split('\n');
  const sourceStart = lines.indexOf(sourceHeading);
  if (sourceStart < 0) throw new Error(`Missing source heading: ${sourceHeading}`);
  const sourceLevel = sourceHeading.match(/^#+/)?.[0].length ?? 0;
  const sectionEnd = (sourceLines, start, level) => {
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

const executablePath = await findFile(path.resolve('.chromium'), 'chrome-headless-shell.exe');
if (!executablePath) throw new Error('Chromium is not installed.');
const webviewBundle = await readFile(path.resolve('dist/webview.js'), 'utf8');
const markdownWorkerBundle = await readFile(path.resolve('dist/markdown-worker.js'), 'utf8');
const fixture = await readFile(path.resolve('test/fixtures/outline-reorder-undo.md'), 'utf8');
const initialText = stripInstructions(fixture);
const initialLines = initialText.split('\n');
const topLevelHeadings = initialLines.filter((line) => /^#\s+/.test(line));
const childHeadings = initialLines.filter((line) => /^##\s+/.test(line));
const grandchildHeading = initialLines.find((line) => /^###\s+/.test(line));
const parentMovedText = moveHeadingBlock(initialText, topLevelHeadings[0], topLevelHeadings[1], 'after');
const childMovedText = moveHeadingBlock(parentMovedText, childHeadings[0], childHeadings[1], 'after');
const crossParentMovedText = moveHeadingBlock(childMovedText, childHeadings[0], childHeadings[2], 'after');
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
const initialOutline = [topLevelHeadings[0], childHeadings[0], grandchildHeading, childHeadings[1], topLevelHeadings[1], childHeadings[2], topLevelHeadings[2], childHeadings[3], topLevelHeadings[3]];
const parentMovedOutline = [topLevelHeadings[1], childHeadings[2], topLevelHeadings[0], childHeadings[0], grandchildHeading, childHeadings[1], topLevelHeadings[2], childHeadings[3], topLevelHeadings[3]];
const childMovedOutline = [topLevelHeadings[1], childHeadings[2], topLevelHeadings[0], childHeadings[1], childHeadings[0], grandchildHeading, topLevelHeadings[2], childHeadings[3], topLevelHeadings[3]];
const crossParentMovedOutline = [topLevelHeadings[1], childHeadings[2], childHeadings[0], grandchildHeading, topLevelHeadings[0], childHeadings[1], topLevelHeadings[2], childHeadings[3], topLevelHeadings[3]];
const emptyParentMovedOutline = [topLevelHeadings[1], childHeadings[2], topLevelHeadings[0], childHeadings[1], topLevelHeadings[2], childHeadings[3], topLevelHeadings[3], childHeadings[0], grandchildHeading];

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.__mveMessages = [];
    window.__mveHostVersion = 1;
    window.__mveHostText = '';
    window.__mveUndoStack = [];
    window.__mveRedoStack = [];
    window.acquireVsCodeApi = () => ({
      postMessage: (message) => {
        window.__mveMessages.push(message);
        if (message.type === 'localChanges') {
          window.__mveUndoStack.push(window.__mveHostText);
          window.__mveRedoStack = [];
          const baseVersion = window.__mveHostVersion;
          for (const change of [...message.changes].sort((left, right) => right.rangeOffset - left.rangeOffset)) {
            window.__mveHostText = window.__mveHostText.slice(0, change.rangeOffset)
              + change.text
              + window.__mveHostText.slice(change.rangeOffset + change.rangeLength);
          }
          window.__mveHostVersion += 1;
          setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
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
          setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
            data: {
              type: 'externalChanges',
              baseVersion,
              version: window.__mveHostVersion,
              changes: [{ rangeOffset: 0, rangeLength: previousText.length, text: nextText }]
            }
          })), 0);
        }
      },
      getState: () => undefined,
      setState: () => undefined
    });
  });

  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('about:blank');
  await page.setContent('<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>');
  await page.evaluate((workerSource) => {
    document.body.dataset.mveMarkdownWorkerUri = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  }, markdownWorkerBundle);
  await page.addStyleTag({ path: path.resolve('dist/styles.css') });
  await page.addStyleTag({ path: path.resolve('dist/webview.css') });
  await page.addScriptTag({ path: path.resolve('dist/webview.js') });
  await page.waitForFunction(() => window.__mveMessages.some((message) => message.type === 'ready'));
  await page.evaluate((text) => { window.__mveHostText = text; }, initialText);
  await page.evaluate((text) => window.dispatchEvent(new MessageEvent('message', {
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

  const outlineIndex = async (heading) => page.locator('.outline-item').evaluateAll(
    (elements, expected) => elements.findIndex((element) => element.textContent?.trim() === expected.replace(/^#+\s+/, '')),
    heading
  );
  const drag = async (sourceHeading, targetHeading) => {
    const items = page.locator('.outline-item');
    const source = await items.nth(await outlineIndex(sourceHeading)).boundingBox();
    const target = await items.nth(await outlineIndex(targetHeading)).boundingBox();
    if (!source || !target) throw new Error(`Could not locate drag target: ${sourceHeading} -> ${targetHeading}`);
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(target.x + target.width / 2, target.y + target.height * 0.75);
    await page.mouse.up({ button: 'right' });
  };
  const localChangeCount = () => page.evaluate(
    () => window.__mveMessages.filter((message) => message.type === 'localChanges').length
  );
  const waitForHost = async (expected) => {
    try {
      await page.waitForFunction((text) => window.__mveHostText === text, expected);
      await page.waitForTimeout(250);
    } catch (error) {
      const actual = await page.evaluate(() => ({
        text: window.__mveHostText,
        messages: window.__mveMessages
      }));
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nExpected: ${JSON.stringify(expected)}\nActual state: ${JSON.stringify(actual)}`);
    }
  };
  const waitForOutline = (expected) => page.waitForFunction((items) => (
    [...document.querySelectorAll('.outline-item')].map((element) => element.textContent?.trim()).join('\n')
      === items.map((item) => item.replace(/^#+\s+/, '')).join('\n')
  ), expected);
  const assertNoOp = async (sourceHeading, targetHeading, expected) => {
    const before = await localChangeCount();
    await drag(sourceHeading, targetHeading);
    await page.waitForTimeout(150);
    const after = await localChangeCount();
    if (after !== before) throw new Error(`Forbidden move emitted localChanges: ${sourceHeading} -> ${targetHeading}`);
    if (await page.evaluate(() => window.__mveHostText) !== expected) {
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

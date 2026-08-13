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
const entries = await readdir(path.resolve('sample'));
const samples = {};
for (const index of [1, 2, 3, 4, 5, 6, 7, 9]) {
  const file = entries.find((entry) => entry.startsWith(`0${index}-`) && entry.endsWith('.md'));
  if (!file) throw new Error(`sample/0${index} がありません。`);
  samples[index] = await readFile(path.resolve('sample', file), 'utf8');
}
const localSvg = await readFile(path.resolve('sample/assets/local-sample.svg'));
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.__mveMessages = [];
    window.__mveHostVersion = 1;
    window.__mveHostText = '';
    window.acquireVsCodeApi = () => ({
      postMessage: (message) => window.__mveMessages.push(message),
      getState: () => undefined,
      setState: () => undefined
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(7_000);
  await page.route('https://mve.test/sample/assets/**', async (route) => {
    if (route.request().url().endsWith('/local-sample.svg')) {
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: localSvg });
    } else {
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing sample asset' });
    }
  });
  await page.setContent('<!doctype html><html lang="ja"><head><meta charset="utf-8"><base href="https://mve.test/sample/"></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({ path: path.resolve('dist/styles.css') });
  await page.addScriptTag({ path: path.resolve('dist/webview.js') });
  await page.waitForFunction(() => window.__mveMessages.some((message) => message.type === 'ready'));
  const settings = { imageDirectory: 'assets/${documentBasename}', maxPasteSizeMb: 20, remoteImagesEnabled: false, mermaidTheme: 'default', workspaceTrusted: true };
  await page.evaluate((value) => { window.__mveHostText = value; }, samples[1]);
  await page.evaluate(({ value, settings: initSettings }) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'init', text: value, version: 1, uri: 'file:///C:/sample.md', settings: initSettings } })), { value: samples[1], settings });
  await page.locator('.split-editor').waitFor();

  async function load(index) {
    const value = samples[index];
    const heading = (/^#\s+(.+)$/m.exec(value)?.[1] ?? '').replace(/\s+\{#[^}]+\}\s*$/, '');
    await page.evaluate((text) => {
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
    await page.waitForFunction((text) => document.querySelector('.split-preview')?.textContent?.includes(text), heading);
  }

  await load(1);
  if ((await page.locator('.split-preview br').count()) < 2) throw new Error('sample/01 のハード改行を確認できません。');
  await load(2);
  if (!(await page.locator('.split-preview .katex').count())) throw new Error('sample/02 の数式を確認できません。');
  await load(3);
  await page.waitForFunction(() => document.querySelector('.split-preview img[src*="local-sample.svg"]')?.naturalWidth > 0);
  if (!(await page.locator('.split-preview .blocked-image').count())) throw new Error('sample/03 のリモート画像制御を確認できません。');
  await load(4);
  if ((await page.locator('.split-preview table').count()) < 2) throw new Error('sample/04 のテーブルを確認できません。');
  await load(5);
  if ((await page.locator('.split-preview .code-figure').count()) < 1) throw new Error('sample/05 のコードブロックを確認できません。');
  await page.waitForFunction(() => document.querySelectorAll('.split-preview .mermaid svg').length >= 1);
  await load(6);
  await page.waitForFunction(() => document.querySelectorAll('.split-preview .mermaid svg').length >= 1);
  if (!(await page.locator('.split-preview .katex').count()) || !(await page.locator('.split-preview table').count())) throw new Error('sample/06 の数式・表を確認できません。');
  await load(7);
  await load(9);
  if ((await page.locator('.split-preview h2').count()) < 18) throw new Error('sample/09 large document did not render all sections');
  if ((await page.locator('.split-preview table').count()) < 2) throw new Error('sample/09 large document tables are missing');
  if (!(await page.locator('.split-preview').textContent()).includes('verylongtoken_without_break_points_')) throw new Error('sample/07 の長いRaw文字列を確認できません。');
  await context.close();
  console.log('サンプル01〜07および09（大規模文書）の現行分割プレビュー表示を確認しました。');
} finally {
  await browser.close();
}

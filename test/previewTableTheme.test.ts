/**
 * @fileoverview プレビューの表で、ライト・ダーク両テーマのヘッダー背景と列境界が見分けられる色になることを実Chromiumで検証する。
 * テーマCSSの変更で表のヘッダーや境界線が背景に埋もれる回帰を防ぐ。
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { findChromium } from './chromium';

/** `npm run pdf:install-browser`で導入したChromium。未導入の環境ではテストを省略する。 */
const executablePath = findChromium();
/** Chromiumの有無に応じた実行・省略の切り替え。 */
const withBrowser = executablePath ? describe : describe.skip;

/** プレビュー用CSSを適用した表の見出し背景と境界色を、テーマを切り替えて測る。 */
withBrowser('preview table theme', () => {
    /** ライト・ダークテーマのプレビュー表でヘッダーと列境界の視認性を保つ。 */
    it('keeps preview table headers and column separators visible in both themes', async () => {
        const browser = await chromium.launch({ executablePath, headless: true });
        try {
            const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
            await page.setContent('<body data-editor-theme="light"><div class="rendered-markdown"><table><thead><tr><th>Header A</th><th>Header B</th></tr></thead><tbody><tr><td>Value A</td><td>Value B</td></tr></tbody></table></div></body>');
            await page.addStyleTag({ content: readFileSync('src/webview/styles.css', 'utf8') });
            await page.addStyleTag({ content: readFileSync('src/webview/editor/editorTheme.css', 'utf8') });

            /** 同じ表の見出し背景と見出し・本文セルの境界色を現在のテーマで測る。 */
            const measureColors = () => page.locator('.rendered-markdown').evaluate((root) => {
                const header = root.querySelector('th')!;
                const cell = root.querySelector('td')!;
                return {
                    headerBackground: getComputedStyle(header).backgroundColor,
                    headerBorder: getComputedStyle(header).borderRightColor,
                    cellBorder: getComputedStyle(cell).borderRightColor
                };
            });

            expect(await measureColors()).toEqual({
                headerBackground: 'rgb(189, 213, 239)',
                headerBorder: 'rgb(98, 107, 117)',
                cellBorder: 'rgb(98, 107, 117)'
            });

            await page.locator('body').evaluate((body) => body.setAttribute('data-editor-theme', 'dark'));
            expect(await measureColors()).toEqual({
                headerBackground: 'rgb(31, 58, 95)',
                headerBorder: 'rgb(125, 137, 152)',
                cellBorder: 'rgb(125, 137, 152)'
            });
        } finally {
            await browser.close();
        }
    }, 30_000);
});

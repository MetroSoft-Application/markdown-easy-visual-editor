/**
 * @fileoverview 分割プレビュー上端の余白が上パディングだけになり、先頭要素のmargin-topが重ならないことを検証する。
 * 先頭のh1で見出しのmargin-top(2em基準の1.5em)がパディングへ加算され、上端に大きな空白ができる回帰を防ぐ。
 * 本番と同じdiv.markdown-source-blockで包んだ構造にするため、HTMLは実際のMarkdownレンダラーで生成する。
 * 2番目以降の見出しの区切りマージンは維持されることも合わせて確認する。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { renderMarkdownUnsafe } from '../src/webview/markdown/markdownRendererCore';

/**
 * プレビュー上端に置く内容ごとの検査用Markdown。
 * HTMLコメントだけの先頭ブロックの後に続く見出しは、性能上の理由でCSSの対象外としているため含めない。
 */
const LEADING_MARKDOWN = {
    h1: '# Title\n\nBody\n\n## Section\n',
    h2: '## Section\n\nBody\n\n## Next\n',
    paragraph: 'Body\n\n## Section\n'
};

/** 分割プレビューの上パディング(px)。styles.cssの`.split-preview .rendered-markdown`と一致させる。 */
const TOP_PADDING = 24;

/** `npm run pdf:install-browser`で導入したChromium。未導入の環境ではテストを省略する。 */
const executablePath = findChromium(path.resolve('.chromium'));
/** Chromiumの有無に応じた実行・省略の切り替え。 */
const withBrowser = executablePath ? describe : describe.skip;

/** Webviewのプレビュー用CSSを実Chromiumで適用し、上端余白と後続見出しのマージンを測る。 */
withBrowser('split preview top spacing', () => {
    /** 先頭の内容によらず、最初に見える要素が上パディングの位置に来て、後続見出しの区切りは残ることを確認する。 */
    it('starts visible content at the top padding regardless of the leading block', async () => {
        const browser = await chromium.launch({ executablePath, headless: true });
        try {
            const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
            for (const [name, markdown] of Object.entries(LEADING_MARKDOWN)) {
                const html = renderMarkdownUnsafe(markdown, { remoteImagesEnabled: false, language: 'en' });
                expect(html, name).toContain('class="markdown-source-block"');
                await page.setContent(`<body data-editor-theme="dark"><div class="split-preview"><div class="rendered-markdown">${html}</div></div></body>`);
                await page.addStyleTag({ content: readFileSync('src/webview/styles.css', 'utf8') });
                await page.addStyleTag({ content: readFileSync('src/webview/editor/editorTheme.css', 'utf8') });
                const layout = await page.locator('.rendered-markdown').evaluate((root) => {
                    const blocks = [...root.querySelectorAll<HTMLElement>('.markdown-source-block > *')];
                    return {
                        top: blocks[0].getBoundingClientRect().top - root.getBoundingClientRect().top,
                        laterHeadingMargin: parseFloat(getComputedStyle(blocks.filter((element) => element.tagName === 'H2').at(-1)!).marginTop)
                    };
                });
                expect(layout.top, name).toBe(TOP_PADDING);
                expect(layout.laterHeadingMargin, name).toBeGreaterThan(0);
            }
        } finally {
            await browser.close();
        }
    }, 30_000);
});

/**
 * 導入済みChromiumのヘッドレス実行ファイルを再帰的に探す。
 * @param root - Chromiumの導入先ディレクトリ。
 * @returns 実行ファイルの絶対パス。導入先がない、または見つからない場合はundefined。
 */
function findChromium(root: string): string | undefined {
    if (!existsSync(root)) return undefined;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const file = path.join(root, entry.name);
        if (entry.isFile() && entry.name === 'chrome-headless-shell.exe') return file;
        if (entry.isDirectory()) {
            const found = findChromium(file);
            if (found) return found;
        }
    }
    return undefined;
}

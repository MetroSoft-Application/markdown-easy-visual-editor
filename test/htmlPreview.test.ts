/**
 * @fileoverview 出力HTMLプレビューのリンク遷移、断片HTMLの補完、Webview内リンク処理を検証する。
 * 一時HTMLと任意のChrome実行ファイルを使い、環境に依存するブラウザー確認は実行可能時だけ行う。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const previewMock = vi.hoisted(() => {
    const state: { panel?: any; listener?: (message: unknown) => void; root?: string } = {};
    /** VS Codeのfile URIモックを、Extension Hostテスト用に組み立てる。 */
    const file = (fsPath: string) => ({ scheme: 'file', fsPath, toString: () => `file://${fsPath}` });
    return { state, file, openExternal: vi.fn(async () => true) };
});

vi.mock('vscode', () => ({
    Uri: { file: previewMock.file, parse: (value: string) => ({ toString: () => value }) },
    ViewColumn: { Active: 1 },
    workspace: {
        getWorkspaceFolder: () => previewMock.state.root ? { uri: previewMock.file(previewMock.state.root) } : undefined,
        fs: { readFile: (uri: { fsPath: string }) => readFile(uri.fsPath) },
    },
    env: { openExternal: previewMock.openExternal },
    window: {
        createWebviewPanel: (_type: string, title: string, _column: unknown, options: unknown) => {
            const panel = {
                title,
                options,
                dispose: vi.fn(),
                webview: {
                    html: '',
                    cspSource: 'https://preview.test',
                    asWebviewUri: (uri: { fsPath: string }) => ({ toString: () => `https://preview.test${uri.fsPath.replace(/\\/gu, '/')}` }),
                    onDidReceiveMessage: (listener: (message: unknown) => void) => { previewMock.state.listener = listener; },
                },
            };
            previewMock.state.panel = panel;
            return panel;
        },
    },
}));

import { openHtmlPreview, preparePreviewHtml } from '../src/extension/htmlPreview';

const directories: string[] = [];
afterEach(async () => {
    previewMock.state.panel = undefined;
    previewMock.state.listener = undefined;
    previewMock.state.root = undefined;
    previewMock.openExternal.mockClear();
    for (const directory of directories.splice(0)) {
        await unlink(path.join(directory, '03-images.html'));
        await unlink(path.join(directory, '04-tables.html'));
        await rmdir(directory);
    }
});

describe('exported HTML preview', () => {
    it('loads a linked HTML file and retains its heading fragment in the preview', async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'mve-html-preview-'));
        directories.push(directory);
        previewMock.state.root = directory;
        const source = path.join(directory, '03-images.html');
        const linked = path.join(directory, '04-tables.html');
        const fragment = encodeURIComponent('gfmテーブル総合確認');
        await writeFile(source, `<!doctype html><html><head></head><body><a href="04-tables.html?view=compact#${fragment}">GFM</a></body></html>`);
        await writeFile(linked, '<!doctype html><html><head></head><body><h1 id="gfmテーブル総合確認">GFM</h1></body></html>');

        await openHtmlPreview(previewMock.file(source) as any);
        expect(previewMock.state.panel.title).toBe('03-images.html');
        expect(previewMock.state.panel.webview.html).toContain(`href="04-tables.html?view=compact#${fragment}"`);
        previewMock.state.listener?.({ type: 'navigate', href: `04-tables.html?view=compact#${fragment}` });
        await vi.waitFor(() => expect(previewMock.state.panel.title).toBe('04-tables.html'));
        expect(previewMock.state.panel.webview.html).toContain('id="gfmテーブル総合確認"');
        expect(previewMock.state.panel.webview.html).toContain(`const fragment = "${fragment}"`);
        expect(previewMock.openExternal).not.toHaveBeenCalled();
    });

    it('keeps fragment-only links in the same document', () => {
        const html = '<html><head></head><body><a href="#section">Section</a><h2 id="section">Section</h2></body></html>';
        const result = preparePreviewHtml(html, {
            cspSource: 'https://preview.test',
            asWebviewUri: () => ({ toString: () => 'https://preview.test/sample' }),
        } as any, previewMock.file('sample/03-images.html') as any);
        expect(result).toContain('href="#section"');
        expect(result).toContain("if (href.startsWith('#')) { reveal(href.slice(1)); return; }");
    });

    it('adds preview security and link handling to an HTML fragment without head or body tags', () => {
        const result = preparePreviewHtml('<p>Standalone content</p>', {
            cspSource: 'https://preview.test',
            asWebviewUri: () => ({ toString: () => 'https://preview.test/sample' }),
        } as any, previewMock.file('sample/03-images.html') as any);

        expect(result).toContain('<meta http-equiv="Content-Security-Policy"');
        expect(result).toContain('<body><p>Standalone content</p>');
        expect(result).toMatch(/<script nonce="[a-f0-9]+">[\s\S]*<\/script><\/body>/u);
    });

    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    it.skipIf(!existsSync(chromePath))('sends a cross-document link click to the extension host', async () => {
        const browser = await chromium.launch({ executablePath: chromePath, headless: true });
        try {
            const page = await browser.newPage();
            const messages: unknown[] = [];
            const errors: string[] = [];
            page.on('pageerror', (error) => { errors.push(error.message); });
            await page.exposeFunction('recordPreviewMessage', (message: unknown) => { messages.push(message); });
            await page.evaluate(() => {
                (window as any).acquireVsCodeApi = () => ({
                    postMessage: (message: unknown) => (window as any).recordPreviewMessage(message),
                });
            });
            const html = preparePreviewHtml(
                '<html><head></head><body><a href="04-tables.html#gfm%E3%83%86%E3%83%BC%E3%83%96%E3%83%AB">GFM</a></body></html>',
                { cspSource: 'https://preview.test', asWebviewUri: () => ({ toString: () => 'https://preview.test/sample' }) } as any,
                previewMock.file('sample/03-images.html') as any,
            );
            await page.setContent(html);
            expect(errors).toEqual([]);
            await page.getByRole('link', { name: 'GFM' }).click();
            await expect.poll(() => messages.length).toBe(1);
            expect(messages[0]).toEqual({ type: 'navigate', href: '04-tables.html#gfm%E3%83%86%E3%83%BC%E3%83%96%E3%83%AB' });

            const samePage = await browser.newPage();
            await samePage.evaluate(() => {
                (window as any).acquireVsCodeApi = () => ({ postMessage: () => undefined });
                (window as any).revealedIds = [];
                Element.prototype.scrollIntoView = function () { (window as any).revealedIds.push(this.id); };
            });
            await samePage.setContent(preparePreviewHtml(
                '<html><head></head><body><a href="#ctrlv%E7%A2%BA%E8%AA%8D%E6%AC%84">CtrlV</a><h2 id="ctrlv確認欄">CtrlV</h2></body></html>',
                { cspSource: 'https://preview.test', asWebviewUri: () => ({ toString: () => 'https://preview.test/sample' }) } as any,
                previewMock.file('sample/03-images.html') as any,
            ));
            await samePage.getByRole('link', { name: 'CtrlV' }).click();
            expect(await samePage.evaluate(() => (window as any).revealedIds)).toEqual(['ctrlv確認欄']);
            expect(messages).toHaveLength(1);
        } finally {
            await browser.close();
        }
    }, 15_000);
});

/**
 * @fileoverview MermaidのPNG変換、倍率からの独立、右クリックメニューとコピー形式を実Chromiumで検証する。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright-core';
import { closePeleRenderer, renderPeleMermaid } from '../src/extension/peleMermaid';

const executablePath = findChromium(path.resolve('.chromium'));
const withBrowser = executablePath ? describe : describe.skip;

withBrowser('Mermaid PNGコピー', () => {
    let browser: Browser;
    let bundle: string;
    let svg: string;
    beforeAll(async () => {
        const result = await build({
            stdin: { contents: `import {prepareMermaidClipboardPng} from './src/webview/preview/previewMermaidClipboard'; import {installPreviewImageContextMenu} from './src/webview/preview/previewImageContextMenu'; window.mermaidCopyTest={prepareMermaidClipboardPng,installPreviewImageContextMenu};`, resolveDir: process.cwd() },
            bundle: true, write: false, platform: 'browser', format: 'iife',
        });
        bundle = result.outputFiles[0].text;
        browser = await chromium.launch({ executablePath, headless: true });
        const markdown = readFileSync('sample/mermaid/01-flowchart-basic.md', 'utf8');
        const source = /```mermaid\s*\r?\n([\s\S]*?)\r?\n```/.exec(markdown)![1];
        svg = (await renderPeleMermaid(source, 'dark', path.resolve('dist/pele-render-worker.js'), () => Promise.resolve(browser), undefined, { fontFamily: 'Arial', resourceScope: 'png-copy-test' })).svg;
    });
    afterAll(async () => {
        await closePeleRenderer();
        await browser?.close();
    });

    async function openPage(): Promise<Page> {
        const page = await browser.newPage();
        await page.setContent(`<html lang="ja"><body style="background:#101010"><main class="rendered-markdown" data-mve-image-zoom="1.5" style="--mve-preview-image-zoom:1.5"><div id="diagram" class="diagram-block mermaid" data-mermaid-status="ready">${svg}</div><p id="ordinary">Ordinary text</p></main></body></html>`);
        await page.addStyleTag({ content: readFileSync('src/webview/styles.css', 'utf8') });
        await page.addStyleTag({ content: readFileSync('src/webview/preview/previewImageContextMenu.css', 'utf8') });
        await page.addScriptTag({ content: bundle });
        return page;
    }

    it('実Pele SVGの全体を元の寸法でPNG化し、プレビュー倍率と元DOMを変更しない', async () => {
        const page = await openPage();
        try {
            const result = await page.evaluate(async () => {
                const diagram = document.querySelector<HTMLElement>('#diagram')!;
                const original = diagram.innerHTML;
                const svg = diagram.querySelector('svg')!;
                const blob = await (window as unknown as CopyTestWindow).mermaidCopyTest.prepareMermaidClipboardPng(diagram);
                const bitmap = await createImageBitmap(blob);
                const canvas = document.createElement('canvas');
                canvas.width = bitmap.width; canvas.height = bitmap.height;
                const context = canvas.getContext('2d')!;
                context.drawImage(bitmap, 0, 0);
                const result = { type: blob.type, signature: Array.from(new Uint8Array(await blob.arrayBuffer()).slice(0, 8)), width: bitmap.width, height: bitmap.height, expectedWidth: svg.viewBox.baseVal.width, expectedHeight: svg.viewBox.baseVal.height, background: Array.from(context.getImageData(0, 0, 1, 1).data), unchanged: original === diagram.innerHTML };
                bitmap.close();
                return result;
            });
            expect(result.type).toBe('image/png');
            expect(result.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
            expect(result.width).toBe(result.expectedWidth);
            expect(result.height).toBe(result.expectedHeight);
            expect(result.background).toEqual([16, 16, 16, 255]);
            expect(result.unchanged).toBe(true);
        } finally { await page.close(); }
    });

    it('画像化したPNGを再圧縮せずコピーし、SVG画像へのフォールバックもPNG化する', async () => {
        const page = await openPage();
        try {
            const result = await page.evaluate(async () => {
                const api = (window as unknown as CopyTestWindow).mermaidCopyTest;
                const diagram = document.querySelector<HTMLElement>('#diagram')!;
                const svgText = diagram.innerHTML;
                const png = await api.prepareMermaidClipboardPng(diagram);
                const originalBytes = new Uint8Array(await png.arrayBuffer());
                const url = URL.createObjectURL(png);
                const svgUrl = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
                try {
                    diagram.innerHTML = `<div class="mermaid-svg-frame"><img class="mermaid-svg-image" src="${url}"><div class="mermaid-interaction-layer"><span>Label</span></div></div>`;
                    const copied = await api.prepareMermaidClipboardPng(diagram);
                    const copiedBytes = new Uint8Array(await copied.arrayBuffer());
                    diagram.querySelector('img')!.src = svgUrl;
                    const converted = await api.prepareMermaidClipboardPng(diagram);
                    return { unchanged: originalBytes.length === copiedBytes.length && originalBytes.every((value, index) => value === copiedBytes[index]), fallbackType: converted.type, fallbackSize: converted.size };
                } finally { URL.revokeObjectURL(url); URL.revokeObjectURL(svgUrl); }
            });
            expect(result.unchanged).toBe(true);
            expect(result.fallbackType).toBe('image/png');
            expect(result.fallbackSize).toBeGreaterThan(0);
        } finally { await page.close(); }
    });

    it('上限を超える画像化済みPNGも全体を縮小する', async () => {
        const page = await openPage();
        try {
            const result = await page.evaluate(async () => {
                const diagram = document.querySelector<HTMLElement>('#diagram')!;
                const canvas = document.createElement('canvas');
                canvas.width = 100; canvas.height = 10000;
                const context = canvas.getContext('2d')!;
                context.fillStyle = 'red'; context.fillRect(0, 0, 100, 5000);
                context.fillStyle = 'blue'; context.fillRect(0, 5000, 100, 5000);
                const png = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
                const url = URL.createObjectURL(png);
                try {
                    diagram.innerHTML = `<div class="mermaid-svg-frame"><img class="mermaid-svg-image" src="${url}"></div>`;
                    const copied = await (window as unknown as CopyTestWindow).mermaidCopyTest.prepareMermaidClipboardPng(diagram);
                    const bitmap = await createImageBitmap(copied);
                    canvas.width = bitmap.width; canvas.height = bitmap.height;
                    context.drawImage(bitmap, 0, 0);
                    const result = { width: bitmap.width, height: bitmap.height, top: Array.from(context.getImageData(0, 0, 1, 1).data), bottom: Array.from(context.getImageData(0, bitmap.height - 1, 1, 1).data) };
                    bitmap.close();
                    return result;
                } finally { URL.revokeObjectURL(url); }
            });
            expect(result.width).toBe(81);
            expect(result.height).toBe(8192);
            expect(result.top).toEqual([255, 0, 0, 255]);
            expect(result.bottom).toEqual([0, 0, 255, 255]);
        } finally { await page.close(); }
    });

    it('巨大な縦長図の全体を8192px内へ収め、未描画とキャンセル済み要求を拒否する', async () => {
        const page = await openPage();
        try {
            const result = await page.evaluate(async () => {
                const api = (window as unknown as CopyTestWindow).mermaidCopyTest;
                const diagram = document.querySelector<HTMLElement>('#diagram')!;
                diagram.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100000" width="100" height="100000"><rect width="100" height="100000" fill="red"/></svg>';
                const blob = await api.prepareMermaidClipboardPng(diagram);
                const bitmap = await createImageBitmap(blob);
                const size = { width: bitmap.width, height: bitmap.height };
                bitmap.close();
                const controller = new AbortController(); controller.abort();
                const cancelled = await api.prepareMermaidClipboardPng(diagram, controller.signal).then(() => false, () => true);
                delete diagram.dataset.mermaidStatus;
                const pending = await api.prepareMermaidClipboardPng(diagram).then(() => false, () => true);
                return { ...size, cancelled, pending };
            });
            expect(result.width).toBe(8);
            expect(result.height).toBe(8192);
            expect(result.cancelled).toBe(true);
            expect(result.pending).toBe(true);
        } finally { await page.close(); }
    });

    it('図の文字への右クリックでPNGコピーを表示し、PNGだけを書き込み、通常本文を横取りしない', async () => {
        const page = await openPage();
        try {
            await page.evaluate(() => {
                const test = window as unknown as CopyTestWindow;
                test.copiedItems = [];
                Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: async (items: ClipboardItem[]) => { test.copiedItems = items; } } });
                window.ClipboardItem = class {
                    readonly types: string[];
                    constructor(private data: Record<string, Blob>) { this.types = Object.keys(data); }
                    static supports(type: string) { return type === 'image/png'; }
                    async getType(type: string) { return this.data[type]; }
                } as unknown as typeof ClipboardItem;
                test.mermaidCopyTest.installPreviewImageContextMenu();
            });
            await page.locator('#diagram svg .pele-node text').first().click({ button: 'right' });
            const menuItem = page.getByRole('menuitem', { name: 'PNGとしてコピー', exact: true });
            await menuItem.click();
            await expect.poll(() => page.evaluate(() => (window as unknown as CopyTestWindow).copiedItems.length)).toBe(1);
            expect(await page.evaluate(() => (window as unknown as CopyTestWindow).copiedItems[0].types)).toEqual(['image/png']);
            expect(await page.getByRole('status').textContent()).toContain('コピーしました');
            const intercepted = await page.locator('#ordinary').evaluate(node => !node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
            expect(intercepted).toBe(false);
        } finally { await page.close(); }
    });
});

interface CopyTestWindow {
    mermaidCopyTest: {
        prepareMermaidClipboardPng: (node: HTMLElement, signal?: AbortSignal) => Promise<Blob>;
        installPreviewImageContextMenu: () => () => void;
    };
    copiedItems: ClipboardItem[];
}

function findChromium(root: string): string | undefined {
    if (!existsSync(root)) return undefined;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const file = path.join(root, entry.name);
        if (entry.isFile() && entry.name === 'chrome-headless-shell.exe') return file;
        if (entry.isDirectory()) { const found = findChromium(file); if (found) return found; }
    }
}

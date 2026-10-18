/**
 * @fileoverview 実際のChromium WorkerでPeleがMermaidサンプルをSVGへ描画することを検証する。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { closePeleRenderer, renderPeleMermaid } from '../src/extension/peleMermaid';

const executablePath = findFile(path.resolve('.chromium'), 'chrome-headless-shell.exe');
const describeWithBrowser = executablePath ? describe : describe.skip;

describeWithBrowser('Pele Mermaid描画', () => {
    let browser: Browser;

    beforeAll(async () => {
        browser = await chromium.launch({ executablePath, headless: true });
    });

    afterAll(async () => {
        await closePeleRenderer();
        await browser?.close();
    });

    it('日本語ラベルを持つ分岐図をChromium上で描画する', async () => {
        const markdown = readFileSync(path.resolve('sample/mermaid/02-flowchart-branches.md'), 'utf8');
        const source = /```mermaid\s*\r?\n([\s\S]*?)\r?\n```/.exec(markdown)?.[1];
        expect(source).toBeTruthy();

        const result = await renderPeleMermaid(
            source!,
            'default',
            path.resolve('dist/pele-render-worker.js'),
            () => Promise.resolve(browser),
            undefined,
            { fontFamily: 'Arial', resourceScope: 'sample/mermaid/02-flowchart-branches.md' }
        );

        expect(result.svg).toContain('<svg');
        expect(result.svg).toContain('依頼を受け付ける');
        expect(result.svg).toContain('回答を作成');
        expect(result.interactions.some((item) => item.type === 'text' && item.text.includes('障害対応'))).toBe(true);
    }, 30_000);

    it('大規模フローチャートをプレビュー幅に収めて全ラベルを描画する', async () => {
        const markdown = readFileSync(path.resolve('sample/11-performance-stress.md'), 'utf8');
        const source = /```mermaid\s*\r?\n([\s\S]*?)\r?\n```/.exec(markdown)?.[1];
        expect(source).toBeTruthy();

        const result = await renderPeleMermaid(
            source!,
            'dark',
            path.resolve('dist/pele-render-worker.js'),
            () => Promise.resolve(browser),
            undefined,
            { fontFamily: 'Arial', resourceScope: 'sample/11-performance-stress.md' }
        );
        const styles = readFileSync(path.resolve('src/webview/styles.css'), 'utf8');
        const preview = await browser.newPage({ viewport: { width: 900, height: 700 } });
        try {
            await preview.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body><main class="rendered-markdown"><div class="diagram-block mermaid" style="width:820px;height:640px"></div></main></body></html>');
            await preview.addStyleTag({ content: styles });
            await preview.locator('.diagram-block').evaluate((node, svg) => { node.innerHTML = svg; }, result.svg);
            const layout = await preview.locator('.diagram-block').evaluate((node) => {
                const svg = node.querySelector('svg');
                return {
                    containerWidth: node.clientWidth,
                    containerHeight: node.clientHeight,
                    horizontalOverflow: node.scrollWidth > node.clientWidth,
                    svgWidth: svg?.getBoundingClientRect().width ?? 0,
                    svgHeight: svg?.getBoundingClientRect().height ?? 0,
                    labels: svg?.querySelectorAll('text').length ?? 0
                };
            });

            expect(layout.svgWidth).toBeGreaterThan(0);
            expect(layout.svgWidth).toBeLessThanOrEqual(layout.containerWidth);
            expect(layout.horizontalOverflow).toBe(false);
            expect(layout.svgHeight).toBeGreaterThan(layout.containerHeight);
            expect(layout.labels).toBe(85);
        } finally {
            await preview.close();
        }
    }, 30_000);
});

function findFile(root: string, name: string): string | undefined {
    if (!existsSync(root)) return undefined;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const candidate = path.join(root, entry.name);
        if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return candidate;
        if (entry.isDirectory()) {
            const nested = findFile(candidate, name);
            if (nested) return nested;
        }
    }
    return undefined;
}

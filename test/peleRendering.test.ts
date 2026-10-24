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

    /**
     * 同じソースで文字サイズを変更したとき、以前のサイズのSVGキャッシュを返さない。
     */
    it('設定されたMermaid文字サイズで描画し、サイズ別のキャッシュを使う', async () => {
        const source = 'flowchart TD\n  A[Source] --> B[Preview]';
        const workerPath = path.resolve('dist/pele-render-worker.js');
        const commonOptions = { fontFamily: 'Arial', resourceScope: 'font-size-cache-test' };
        const small = await renderPeleMermaid(
            source,
            'default',
            workerPath,
            () => Promise.resolve(browser),
            undefined,
            { ...commonOptions, fontSize: 16 }
        );
        const large = await renderPeleMermaid(
            source,
            'default',
            workerPath,
            () => Promise.resolve(browser),
            undefined,
            { ...commonOptions, fontSize: 28 }
        );

        expect(small.svg).toContain('font:16px sans-serif');
        expect(large.svg).toContain('font:28px sans-serif');
        expect(large.svg).not.toBe(small.svg);
    }, 30_000);

    it('Mermaid構文エラー後も常駐Workerを再利用する', async () => {
        const options = { fontFamily: 'Arial', resourceScope: 'worker-recovery-test' };
        const initial = await renderPeleMermaid(
            'flowchart TD\n  A[Initial] --> B[Ready]',
            'default',
            path.resolve('dist/pele-render-worker.js'),
            () => Promise.resolve(browser),
            undefined,
            options
        );
        expect(initial.svg).toContain('<svg');
        const page = findRendererPage(browser);
        expect(page).toBeTruthy();

        await expect(renderPeleMermaid(
            'flowchart THIS_IS_NOT_VALID\n  broken -->',
            'default',
            path.resolve('dist/pele-render-worker.js'),
            () => Promise.resolve(browser),
            undefined,
            options
        )).rejects.toThrow();
        expect(page?.isClosed()).toBe(false);

        const result = await renderPeleMermaid(
            'flowchart TD\n  A[Recovered] --> B[Ready]',
            'default',
            path.resolve('dist/pele-render-worker.js'),
            () => Promise.resolve(browser),
            undefined,
            options
        );
        expect(result.svg).toContain('<svg');
        expect(result.ariaLabel).toContain('Recovered');
        expect(findRendererPage(browser)).toBe(page);
    }, 30_000);

    it('Worker異常後は破棄して次の描画で再初期化する', async () => {
        const options = { fontFamily: 'Arial', resourceScope: 'worker-crash-test' };
        const initial = await renderPeleMermaid(
            'flowchart TD\n  A[Before failure] --> B[Ready]',
            'default',
            path.resolve('dist/pele-render-worker.js'),
            () => Promise.resolve(browser),
            undefined,
            options
        );
        expect(initial.svg).toContain('<svg');
        const idlePage = findRendererPage(browser);
        expect(idlePage).toBeTruthy();
        await idlePage!.evaluate(() => {
            const worker = (window as typeof window & { __mvePeleWorker?: Worker }).__mvePeleWorker;
            if (!worker) throw new Error('Pele Worker is not initialized.');
            worker.dispatchEvent(new ErrorEvent('error', { message: 'Injected idle Worker failure.' }));
        });

        const idleRecovery = await renderPeleMermaid(
            'flowchart TD\n  A[After idle failure] --> B[Recovered]',
            'default',
            path.resolve('dist/pele-render-worker.js'),
            () => Promise.resolve(browser),
            undefined,
            options
        );
        expect(idleRecovery.svg).toContain('<svg');
        expect(idleRecovery.ariaLabel).toContain('After idle failure');
        expect(idlePage?.isClosed()).toBe(true);
        const activePage = findRendererPage(browser);
        expect(activePage).toBeTruthy();
        expect(activePage).not.toBe(idlePage);
        await activePage!.evaluate(() => {
            const worker = (window as typeof window & { __mvePeleWorker?: Worker }).__mvePeleWorker;
            if (!worker) throw new Error('Pele Worker is not initialized.');
            worker.postMessage = () => {
                window.setTimeout(() => worker.dispatchEvent(new ErrorEvent('error', { message: 'Injected active Worker failure.' })), 0);
            };
        });

        const activeRecovery = await renderPeleMermaid(
            'flowchart TD\n  A[After active failure] --> B[Recovered]',
            'default',
            path.resolve('dist/pele-render-worker.js'),
            () => Promise.resolve(browser),
            undefined,
            options
        );
        expect(activeRecovery.svg).toContain('<svg');
        expect(activeRecovery.ariaLabel).toContain('After active failure');
        expect(activePage?.isClosed()).toBe(true);
        expect(findRendererPage(browser)).not.toBe(activePage);
    }, 30_000);

    it('処理中のWorker要求をキャンセルし再試行せず後続要求を通す', async () => {
        const options = { fontFamily: 'Arial', resourceScope: 'worker-cancel-race-test' };
        const initial = await renderPeleMermaid(
            'flowchart TD\n  A[Before cancel] --> B[Ready]',
            'default',
            path.resolve('dist/pele-render-worker.js'),
            () => Promise.resolve(browser),
            undefined,
            options
        );
        expect(initial.svg).toContain('<svg');
        const page = findRendererPage(browser);
        expect(page).toBeTruthy();
        await page!.evaluate(() => {
            const worker = (window as typeof window & { __mvePeleWorker?: Worker }).__mvePeleWorker;
            if (!worker) throw new Error('Pele Worker is not initialized.');
            worker.postMessage = () => {
                window.dispatchEvent(new Event('mve-test-worker-posted'));
            };
        });
        const posted = page!.evaluate(() => new Promise<void>((resolve) => {
            window.addEventListener('mve-test-worker-posted', () => resolve(), { once: true });
        }));
        const controller = new AbortController();
        const cancelledRequest = renderPeleMermaid(
            'flowchart TD\n  A[Cancelled request] --> B[Must not retry]',
            'default',
            path.resolve('dist/pele-render-worker.js'),
            () => Promise.resolve(browser),
            controller.signal,
            options
        );
        await posted;
        controller.abort();
        await expect(cancelledRequest).rejects.toThrow('cancelled');
        for (let attempt = 0; attempt < 50 && !page!.isClosed(); attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(page?.isClosed()).toBe(true);
        expect(findRendererPage(browser)).toBeUndefined();

        const following = await renderPeleMermaid(
            'flowchart TD\n  A[Following request] --> B[Ready]',
            'default',
            path.resolve('dist/pele-render-worker.js'),
            () => Promise.resolve(browser),
            undefined,
            options
        );
        expect(following.svg).toContain('<svg');
        expect(following.ariaLabel).toContain('Following request');
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

    it('タイムアウトしたWorker要求を再送せず、キューの後続描画を実行する', async () => {
        const timeoutSource = 'flowchart TD\n  A[Timed out request] --> B[Must not retry]';
        const options = { fontFamily: 'Arial', resourceScope: 'worker-timeout-test' };
        let browserAcquisitions = 0;
        let timedOutPosts = 0;
        const acquireBrowser = () => {
            browserAcquisitions += 1;
            return Promise.resolve(browser);
        };
        const initial = await renderPeleMermaid(
            'flowchart TD\n  A[Before timeout] --> B[Ready]',
            'default',
            path.resolve('dist/pele-render-worker.js'),
            acquireBrowser,
            undefined,
            options
        );
        expect(initial.svg).toContain('<svg');
        const page = findRendererPage(browser);
        expect(page).toBeTruthy();
        const acquisitionsBeforeTimeout = browserAcquisitions;
        await page!.exposeFunction('__mveCountTimeoutPost', (source: string) => {
            if (source === timeoutSource) timedOutPosts += 1;
        });
        await page!.evaluate(() => {
            const workerState = window as typeof window & {
                __mvePeleWorker?: Worker;
                __mveCountTimeoutPost?: (source: string) => void;
            };
            const worker = workerState.__mvePeleWorker;
            if (!worker) throw new Error('Pele Worker is not initialized.');
            worker.postMessage = ((message: { source?: string }) => {
                if (message.source === 'flowchart TD\n  A[Timed out request] --> B[Must not retry]') {
                    workerState.__mveCountTimeoutPost?.(message.source);
                }
            }) as Worker['postMessage'];
        });

        await expect(renderPeleMermaid(
            timeoutSource,
            'default',
            path.resolve('dist/pele-render-worker.js'),
            acquireBrowser,
            undefined,
            { ...options, renderTimeoutMs: 100 }
        )).rejects.toThrow('timed out');

        expect(page?.isClosed()).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(timedOutPosts).toBe(1);
        expect(browserAcquisitions).toBe(acquisitionsBeforeTimeout);

        const following = await renderPeleMermaid(
            'flowchart TD\n  A[After timeout] --> B[Ready]',
            'default',
            path.resolve('dist/pele-render-worker.js'),
            acquireBrowser,
            undefined,
            options
        );
        expect(following.svg).toContain('<svg');
        expect(following.ariaLabel).toContain('After timeout');
        expect(browserAcquisitions).toBe(acquisitionsBeforeTimeout + 1);
    }, 30_000);
    it('プレビュー倍率でSVGと画像化したMermaidの操作領域を一度だけ拡大する', async () => {
        const preview = await browser.newPage({ viewport: { width: 1000, height: 800 } });
        const styles = readFileSync(path.resolve('src/webview/styles.css'), 'utf8');
        const sourceFrom = (file: string) => /```mermaid\s*\r?\n([\s\S]*?)\r?\n```/.exec(readFileSync(path.resolve(file), 'utf8'))![1];
        const small = await renderPeleMermaid(sourceFrom('sample/mermaid/01-flowchart-basic.md'), 'default', path.resolve('dist/pele-render-worker.js'), () => Promise.resolve(browser), undefined, { fontFamily: 'Arial', resourceScope: 'zoom-layout-test' });
        const wide = await renderPeleMermaid(sourceFrom('sample/11-performance-stress.md'), 'default', path.resolve('dist/pele-render-worker.js'), () => Promise.resolve(browser), undefined, { fontFamily: 'Arial', resourceScope: 'zoom-layout-test' });
        const imageSource = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="blue"/></svg>');
        try {
            await preview.setContent(`<!doctype html><html><body>
                <main id="preview" class="rendered-markdown" data-mve-image-zoom="1" style="width:800px;--mve-preview-image-zoom:1">
                    <div id="small" class="diagram-block mermaid">${small.svg}</div>
                    <div id="wide" class="diagram-block mermaid">${wide.svg}</div>
                    <div id="raster" class="diagram-block mermaid"><div class="mermaid-svg-frame" style="aspect-ratio:2"><img class="mermaid-svg-image" src="${imageSource}" alt=""><div class="mermaid-interaction-layer"><a class="mermaid-interaction" href="#target" style="left:25%;top:25%;width:20%;height:10%">Link</a></div></div></div>
                    <img id="ordinary-image" src="${imageSource}" width="160" height="80" alt="">
                </main>
                <main id="export" class="rendered-markdown" style="width:800px"><div class="diagram-block mermaid">${wide.svg}</div></main>
            </body></html>`);
            await preview.addStyleTag({ content: styles });
            await preview.locator('#preview .mermaid > svg').evaluateAll((nodes) => {
                for (const node of nodes) {
                    const svg = node as SVGSVGElement;
                    svg.style.setProperty('--mve-mermaid-width', `${svg.viewBox.baseVal.width}px`);
                }
            });
            const measure = () => preview.evaluate(() => {
                const size = (selector: string) => {
                    const node = document.querySelector(selector)!;
                    if (node instanceof SVGSVGElement) {
                        const matrix = node.getScreenCTM()!;
                        return { width: node.viewBox.baseVal.width * matrix.a, height: node.viewBox.baseVal.height * matrix.d };
                    }
                    const bounds = node.getBoundingClientRect();
                    return { width: bounds.width, height: bounds.height };
                };
                const frame = document.querySelector('#raster .mermaid-svg-frame')!.getBoundingClientRect();
                const link = document.querySelector('#raster .mermaid-interaction')!.getBoundingClientRect();
                const label = document.querySelector<SVGGraphicsElement>('#small svg text')!;
                const labelMatrix = label.getScreenCTM()!;
                return {
                    small: size('#small > svg'),
                    wide: size('#wide > svg'),
                    frame: size('#raster .mermaid-svg-frame'),
                    image: size('#raster img'),
                    ordinaryImage: size('#ordinary-image'),
                    labelScale: { width: labelMatrix.a, height: labelMatrix.d },
                    exported: size('#export svg'),
                    linkLeft: (link.left - frame.left) / frame.width,
                    linkTop: (link.top - frame.top) / frame.height,
                    linkWidth: link.width / frame.width,
                };
            });
            const baseline = await measure();
            for (const key of ['small', 'wide', 'frame'] as const) {
                expect(baseline[key].width).toBeGreaterThan(0);
                expect(baseline[key].width).toBeLessThanOrEqual(800 - 24 + 0.1);
            }
            for (const zoom of [0.5, 1.5, 2, 1]) {
                await preview.locator('#preview').evaluate((node, value) => {
                    (node as HTMLElement).style.setProperty('--mve-preview-image-zoom', String(value));
                    (node as HTMLElement).dataset.mveImageZoom = String(value);
                }, zoom);
                const actual = await measure();
                for (const key of ['small', 'wide', 'frame', 'image', 'ordinaryImage', 'labelScale'] as const) {
                    expect(actual[key].width / baseline[key].width).toBeCloseTo(zoom, 2);
                    expect(actual[key].height / baseline[key].height).toBeCloseTo(zoom, 2);
                }
                expect(actual.linkLeft).toBeCloseTo(0.25, 2);
                expect(actual.linkTop).toBeCloseTo(0.25, 2);
                expect(actual.linkWidth).toBeCloseTo(0.2, 2);
                expect(actual.exported).toEqual(baseline.exported);
                if (zoom > 1) {
                    const edge = await preview.locator('#wide').evaluate((node) => {
                        node.scrollLeft = 0;
                        const svg = node.querySelector('svg')!;
                        const diagramLeft = svg.getScreenCTM()!.e;
                        node.scrollLeft = node.scrollWidth;
                        const matrix = svg.getScreenCTM()!;
                        return {
                            scrollLeft: node.scrollLeft,
                            diagramLeft,
                            containerLeft: node.getBoundingClientRect().left,
                            diagramRight: matrix.e + svg.viewBox.baseVal.width * matrix.a,
                            containerRight: node.getBoundingClientRect().right,
                        };
                    });
                    expect(edge.scrollLeft).toBeGreaterThan(0);
                    expect(edge.diagramLeft).toBeGreaterThanOrEqual(edge.containerLeft);
                    expect(edge.diagramRight).toBeLessThanOrEqual(edge.containerRight + 1);
                }
            }
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

function findRendererPage(browser: Browser) {
    return browser.contexts().flatMap((context) => context.pages()).find((page) => page.url() === 'about:blank');
}

import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { MermaidInteraction } from '../shared/protocol';

export type MermaidTheme = 'default' | 'dark' | 'neutral';

const CACHE_LIMIT = 12;
const CACHE_BYTE_LIMIT = 24 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 30_000;
export interface MermaidBrowserResult {
    svg: string;
    pngBase64?: string;
    interactions: MermaidInteraction[];
    ariaLabel: string;
}

const svgCache = new Map<string, MermaidBrowserResult>();
interface RenderTask {
    promise: Promise<MermaidBrowserResult>;
    consumers: number;
    cancelled: boolean;
    started: boolean;
    settled: boolean;
    operation: () => Promise<MermaidBrowserResult>;
    resolve: (result: MermaidBrowserResult) => void;
    reject: (error: unknown) => void;
}
const inFlight = new Map<string, RenderTask>();
let svgCacheBytes = 0;
const renderQueue: RenderTask[] = [];
let activeRenderTask: RenderTask | undefined;
let browserContext: BrowserContext | undefined;
let rendererPage: Page | undefined;
let pagePromise: Promise<Page> | undefined;

/** 外部ブラウザを起動できず、Webview内フォールバックが必要であることを示す。 */
export class MermaidRendererUnavailableError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'MermaidRendererUnavailableError';
    }
}

class MermaidRenderCancelledError extends Error {
    constructor() {
        super('Mermaid rendering was cancelled.');
        this.name = 'MermaidRenderCancelledError';
    }
}

/** MermaidをWebviewとは別のChromiumプロセスでSVG化する。 */
export function renderMermaidInBrowser(
    source: string,
    theme: MermaidTheme,
    runtimePath: string,
    acquireBrowser: () => Promise<Browser>,
    signal?: AbortSignal
): Promise<MermaidBrowserResult> {
    if (signal?.aborted) return Promise.reject(new MermaidRenderCancelledError());
    const key = `${theme}\0${source}`;
    const cached = readCache(key);
    if (cached !== undefined) return Promise.resolve(cached);
    const current = inFlight.get(key);
    if (current) return consumeTask(key, current, signal);

    let resolveTask!: (result: MermaidBrowserResult) => void;
    let rejectTask!: (error: unknown) => void;
    const task = {
        consumers: 0,
        cancelled: false,
        started: false,
        settled: false,
        resolve: (result: MermaidBrowserResult) => resolveTask(result),
        reject: (error: unknown) => rejectTask(error)
    } as RenderTask;
    task.promise = new Promise<MermaidBrowserResult>((resolve, reject) => {
        resolveTask = resolve;
        rejectTask = reject;
    });
    task.operation = async () => {
        if (task.cancelled) throw new MermaidRenderCancelledError();
        const page = await acquireRendererPage(runtimePath, acquireBrowser);
        if (task.cancelled) throw new MermaidRenderCancelledError();
        const renderId = `mve-host-mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const containerId = `${renderId}-container`;
        const operation = (async (): Promise<MermaidBrowserResult> => {
            const rendered = await page.evaluate(async ({ diagram, diagramTheme, id, resultContainerId }) => {
                const api = (globalThis as typeof globalThis & {
                    mermaid?: {
                        initialize(config: Record<string, unknown>): void;
                        parse(value: string): Promise<unknown>;
                        render(renderId: string, value: string): Promise<{ svg: string }>;
                    };
                }).mermaid;
                if (!api) throw new Error('Mermaid runtime was not loaded.');
                api.initialize({ startOnLoad: false, securityLevel: 'strict', theme: diagramTheme, suppressErrorRendering: true });
                await api.parse(diagram);
                const svg = (await api.render(id, diagram)).svg;
                const container = document.createElement('div');
                container.id = resultContainerId;
                container.style.cssText = 'width:1200px;background:transparent';
                container.innerHTML = svg;
                document.body.append(container);
                const svgNode = container.querySelector('svg');
                if (!svgNode) throw new Error('Mermaid did not return an SVG element.');
                const rootRect = svgNode.getBoundingClientRect();
                const toInteraction = (element: Element, type: 'text' | 'link', href?: string): MermaidInteraction | undefined => {
                    const text = element.textContent?.trim() ?? '';
                    const rect = element.getBoundingClientRect();
                    if (!text || rootRect.width <= 0 || rootRect.height <= 0 || rect.width <= 0 || rect.height <= 0) return undefined;
                    return {
                        type,
                        text,
                        href,
                        left: (rect.left - rootRect.left) / rootRect.width,
                        top: (rect.top - rootRect.top) / rootRect.height,
                        width: rect.width / rootRect.width,
                        height: rect.height / rootRect.height
                    };
                };
                const textInteractions = Array.from(svgNode.querySelectorAll('text, foreignObject'))
                    .filter((element) => element.tagName.toLowerCase() !== 'text' || !element.closest('foreignObject'))
                    .map((element) => toInteraction(element, 'text'))
                    .filter((item): item is MermaidInteraction => item !== undefined);
                const linkInteractions = Array.from(svgNode.querySelectorAll('a'))
                    .map((element) => toInteraction(
                        element,
                        'link',
                        element.getAttribute('href') ?? element.getAttribute('xlink:href') ?? undefined
                    ))
                    .filter((item): item is MermaidInteraction => item !== undefined && Boolean(item.href));
                const ariaLabel = svgNode.querySelector('title')?.textContent?.trim()
                    ?? svgNode.getAttribute('aria-label')
                    ?? textInteractions.slice(0, 20).map((item) => item.text).join(', ');
                return { svg, interactions: [...textInteractions, ...linkInteractions], ariaLabel };
            }, {
                diagram: source,
                diagramTheme: theme,
                id: renderId,
                resultContainerId: containerId
            });
            try {
                if (rendered.svg.length < 80_000) return rendered;
                const png = await page.locator(`#${containerId} svg`).screenshot({
                    type: 'png',
                    animations: 'disabled'
                });
                return { ...rendered, pngBase64: png.toString('base64') };
            } finally {
                await page.evaluate((id) => document.getElementById(id)?.remove(), containerId).catch(() => undefined);
            }
        })();
        const rendered = await withTimeout(operation, RENDER_TIMEOUT_MS, resetRendererPage);
        if (task.cancelled) throw new MermaidRenderCancelledError();
        writeCache(key, rendered);
        return rendered;
    };
    inFlight.set(key, task);
    enqueue(task);
    void task.promise.finally(() => {
        if (inFlight.get(key) === task) inFlight.delete(key);
    }).catch(() => undefined);
    return consumeTask(key, task, signal);
}

/** 拡張終了時にMermaid専用ページとコンテキストを解放する。 */
export async function closeMermaidRenderer(): Promise<void> {
    for (const task of inFlight.values()) cancelTask(task);
    inFlight.clear();
    renderQueue.splice(0);
    svgCache.clear();
    svgCacheBytes = 0;
    pagePromise = undefined;
    rendererPage = undefined;
    const context = browserContext;
    browserContext = undefined;
    if (context) await context.close().catch(() => undefined);
}

function consumeTask(key: string, task: RenderTask, signal?: AbortSignal): Promise<MermaidBrowserResult> {
    task.consumers += 1;
    let settled = false;
    const release = () => {
        if (settled) return;
        settled = true;
        task.consumers = Math.max(0, task.consumers - 1);
        if (task.consumers === 0 && inFlight.get(key) === task) {
            inFlight.delete(key);
            cancelTask(task);
        }
    };
    return new Promise<MermaidBrowserResult>((resolve, reject) => {
        const onAbort = () => {
            release();
            reject(new MermaidRenderCancelledError());
        };
        if (signal?.aborted) {
            onAbort();
            return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });
        task.promise.then(
            (rendered) => {
                if (settled) return;
                signal?.removeEventListener('abort', onAbort);
                release();
                resolve(rendered);
            },
            (error) => {
                if (settled) return;
                signal?.removeEventListener('abort', onAbort);
                release();
                reject(error);
            }
        );
    });
}

function enqueue(task: RenderTask): void {
    renderQueue.push(task);
    void drainRenderQueue();
}

async function drainRenderQueue(): Promise<void> {
    if (activeRenderTask) return;
    while (renderQueue.length) {
        const task = renderQueue.shift();
        if (!task || task.settled) continue;
        if (task.cancelled) {
            settleTask(task, undefined, new MermaidRenderCancelledError());
            continue;
        }
        activeRenderTask = task;
        task.started = true;
        try {
            settleTask(task, await task.operation());
        } catch (error) {
            settleTask(task, undefined, error);
        } finally {
            if (activeRenderTask === task) activeRenderTask = undefined;
        }
    }
}

function cancelTask(task: RenderTask): void {
    if (task.cancelled || task.settled) return;
    task.cancelled = true;
    if (task.started) {
        void resetRendererPage();
        return;
    }
    const queuedIndex = renderQueue.indexOf(task);
    if (queuedIndex >= 0) renderQueue.splice(queuedIndex, 1);
    settleTask(task, undefined, new MermaidRenderCancelledError());
}

function settleTask(task: RenderTask, result?: MermaidBrowserResult, error?: unknown): void {
    if (task.settled) return;
    task.settled = true;
    if (error !== undefined) task.reject(error);
    else if (result !== undefined) task.resolve(result);
}

async function acquireRendererPage(runtimePath: string, acquireBrowser: () => Promise<Browser>): Promise<Page> {
    if (rendererPage && !rendererPage.isClosed()) return rendererPage;
    if (pagePromise) return pagePromise;
    if (rendererPage?.isClosed() || browserContext) await resetRendererPage();
    pagePromise = createRendererPage(runtimePath, acquireBrowser).finally(() => {
        pagePromise = undefined;
    });
    return pagePromise;
}

async function createRendererPage(runtimePath: string, acquireBrowser: () => Promise<Browser>): Promise<Page> {
    try {
        const browser = await acquireBrowser();
        const context = await browser.newContext({ javaScriptEnabled: true });
        browserContext = context;
        await context.route('**/*', (route) => route.abort('blockedbyclient'));
        const page = await context.newPage();
        await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
        await page.addScriptTag({ path: runtimePath });
        rendererPage = page;
        return page;
    } catch (error) {
        await closeMermaidRenderer();
        throw new MermaidRendererUnavailableError('Mermaid用ブラウザを起動できませんでした。', { cause: error });
    }
}

async function resetRendererPage(): Promise<void> {
    pagePromise = undefined;
    rendererPage = undefined;
    const context = browserContext;
    browserContext = undefined;
    if (context) await context.close().catch(() => undefined);
}

function readCache(key: string): MermaidBrowserResult | undefined {
    const rendered = svgCache.get(key);
    if (rendered === undefined) return undefined;
    svgCache.delete(key);
    svgCache.set(key, rendered);
    return rendered;
}

function writeCache(key: string, rendered: MermaidBrowserResult): void {
    const previous = svgCache.get(key);
    if (previous) svgCacheBytes -= estimateResultBytes(previous);
    svgCache.delete(key);
    svgCache.set(key, rendered);
    svgCacheBytes += estimateResultBytes(rendered);
    while (svgCache.size > CACHE_LIMIT || svgCacheBytes > CACHE_BYTE_LIMIT) {
        const oldest = svgCache.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        const removed = svgCache.get(oldest);
        svgCache.delete(oldest);
        if (removed) svgCacheBytes -= estimateResultBytes(removed);
    }
}

function estimateResultBytes(rendered: MermaidBrowserResult): number {
    return (rendered.svg.length + rendered.ariaLabel.length + (rendered.pngBase64?.length ?? 0)) * 2
        + rendered.interactions.reduce((total, interaction) => (
            total + (interaction.text.length + (interaction.href?.length ?? 0)) * 2 + 64
        ), 0);
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, onTimeout: () => Promise<void>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            void onTimeout();
            reject(new Error(`Mermaid rendering timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
    });
    try {
        return await Promise.race([operation, timeout]);
    } finally {
        if (timer) clearTimeout(timer);
        void operation.catch(() => undefined);
    }
}

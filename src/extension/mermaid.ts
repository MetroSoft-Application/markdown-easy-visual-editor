/**
 * @fileoverview Chromium上でMermaidを描画し、SVG・大きな図のPNG・操作領域をWebviewへ返す。描画キュー、キャッシュ、キャンセルを管理する。
 */
import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { MermaidInteraction } from '../shared/protocol';

/**
 * Mermaidの配色プリセットを表すリテラル型。
 */
export type MermaidTheme = 'default' | 'dark' | 'neutral';


/**
 * 保持するMermaid描画結果の最大件数。超過時は古い結果を破棄してメモリを有界に保つ。
 */
const CACHE_LIMIT = 12;

/**
 * Mermaid描画キャッシュに許容する合計バイト数。図の大きさによるメモリ増加を制限する。
 */
const CACHE_BYTE_LIMIT = 24 * 1024 * 1024;

/**
 * Mermaid描画を待機する上限時間（ミリ秒）。無限待機で後続の描画を塞がない。
 */
const RENDER_TIMEOUT_MS = 30_000;
/**
 * ブラウザー描画からWebviewへ渡すSVG、PNG、操作領域をまとめた結果。
 */
export interface MermaidBrowserResult {

    /**
     * Mermaidが生成したSVG本文。
     */
    svg: string;

    /**
     * 大きなMermaid図をPNG化したBase64本文。
     */
    pngBase64?: string;

    /**
     * 図中の文字・リンク操作領域の一覧。
     */
    interactions: MermaidInteraction[];

    /**
     * 図の内容を補足するアクセシビリティ用ラベル。
     */
    ariaLabel: string;
}


/**
 * テーマとソースが一致するMermaid描画を再利用するキャッシュ。
 */
const svgCache = new Map<string, MermaidBrowserResult>();
/**
 * Mermaidで共有するデータ形状を表すインターフェース。
 */
interface RenderTask {

    /**
     * 進行中の非同期処理を共有するPromise。
     */
    promise: Promise<MermaidBrowserResult>;

    /**
     * 同じ描画結果を待つ呼び出し側の数。
     */
    consumers: number;

    /**
     * キャンセル済みで後続処理を開始できない状態。
     */
    cancelled: boolean;

    /**
     * 実行キューから取り出して処理を開始した状態。
     */
    started: boolean;

    /**
     * 完了または失敗を通知済みの状態。
     */
    settled: boolean;
    /**
     * Mermaidのoperationを処理し、呼び出し側へ結果または副作用を返す。
     * @returns Mermaidの非同期処理で得られる描画または変換結果。
     */
    operation: () => Promise<MermaidBrowserResult>;
    /**
     * 描画タスクのPromiseを生成結果で完了させる。
     * @param result - 描画処理で生成したSVG、任意のPNG、操作領域を含む結果。
     * @returns 副作用を完了し、値は返さない。
     */
    resolve: (result: MermaidBrowserResult) => void;
    /**
     * Mermaidのrejectを処理し、呼び出し側へ結果または副作用を返す。
     * @param error - 処理に失敗した理由または例外。
     * @returns 副作用を完了し、値は返さない。
     */
    reject: (error: unknown) => void;
}

/**
 * 同一キーの重複描画をまとめる未完了タスクの対応表。
 */
const inFlight = new Map<string, RenderTask>();

/**
 * キャッシュ済みMermaid描画の概算バイト数。容量制限の判定に使う。
 */
let svgCacheBytes = 0;

/**
 * Chromium描画をFIFO順に処理する待機列。
 */
const renderQueue: RenderTask[] = [];

/**
 * 現在Chromiumへ渡している描画タスク。
 */
let activeRenderTask: RenderTask | undefined;

/**
 * Mermaid描画専用のPlaywrightブラウザーコンテキスト。
 */
let browserContext: BrowserContext | undefined;

/**
 * Mermaid描画に再利用するPlaywrightページ。
 */
let rendererPage: Page | undefined;

/**
 * 描画ページの初期化を共有するPromise。
 */
let pagePromise: Promise<Page> | undefined;

/**
 * Mermaidで失敗理由を表すError派生クラス。
 */
export class MermaidRendererUnavailableError extends Error {
    /**
     * Mermaid描画環境を利用できない理由を保持するエラーを作成する。
     * @param message - エラーとして表示する説明文。
     * @param options - causeなどの標準Error追加情報。
     */
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'MermaidRendererUnavailableError';
    }
}

/**
 * Mermaidで失敗理由を表すError派生クラス。
 */
class MermaidRenderCancelledError extends Error {
    /**
     * Mermaidで使う値または実行環境を組み立てる。
     * @returns 初期化したインスタンス。
     */
    constructor() {
        super('Mermaid rendering was cancelled.');
        this.name = 'MermaidRenderCancelledError';
    }
}

/**
 * Mermaidソースを隔離したChromiumで描画し、SVG・PNG・操作領域を返す。キャッシュと同一要求の共有を適用する。
 * @param source - Mermaid形式の図ソース本文。
 * @param theme - 描画や表示に適用する配色テーマ。
 * @param runtimePath - Mermaidランタイムを読み込むファイルのパス。
 * @param acquireBrowser - 描画用ブラウザーを取得する非同期関数。
 * @param signal - 呼び出し側のキャンセルを通知するAbortSignal。
 * @returns SVG、PNG、操作領域をまとめたMermaid描画結果。
 */
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

    /**
     * Mermaidのresolve・taskに関する状態または設定。
     */
    let resolveTask!: (result: MermaidBrowserResult) => void;
    /**
     * Mermaidのreject・taskに関する状態または設定。
     */
    let rejectTask!: (error: unknown) => void;
    const task = {
        consumers: 0,
        cancelled: false,
        started: false,
        settled: false,


        resolve: /**
         * 描画タスクのPromiseを生成結果で完了させる。
         * @param result - 描画処理で生成したSVG、任意のPNG、操作領域を含む結果。
         * @returns SVG、PNG、操作領域をまとめたMermaid描画結果。
         */ (result: MermaidBrowserResult) => resolveTask(result),


        reject: /**
         * Mermaidのrejectを処理し、呼び出し側へ結果または副作用を返す。
         * @param error - 処理に失敗した理由または例外。
         * @returns SVG、PNG、操作領域をまとめたMermaid描画結果。
         */ (error: unknown) => rejectTask(error)
    } as RenderTask;
    task.promise = new Promise<MermaidBrowserResult>(
        /**
         * 非同期処理の完了条件と失敗条件を待機側へ通知する。
         * @param resolve - Promiseの成功を通知する関数。
         * @param reject - Promiseの失敗を通知する関数。
         * @returns 非同期処理の完了値。
         */
        (resolve, reject) => {
            resolveTask = resolve;
            rejectTask = reject;
        });
    task.operation =
        /**
         * Mermaidのoperationを処理し、呼び出し側へ結果または副作用を返す。
         * @returns Mermaidの非同期処理で得られる描画または変換結果。
         */
        async () => {
            if (task.cancelled) throw new MermaidRenderCancelledError();
            const page = await acquireRendererPage(runtimePath, acquireBrowser);
            if (task.cancelled) throw new MermaidRenderCancelledError();
            const renderId = `mve-host-mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const containerId = `${renderId}-container`;
            const operation = (
                /**
                 * 要素をevaluateへ渡し、Mermaidの結果または副作用を処理する。
                 * @returns SVG、PNG、操作領域をまとめたMermaid描画結果。
                 */
                async (): Promise<MermaidBrowserResult> => {
                    const rendered = await page.evaluate(
                        /**
                         * Chromium内でMermaidを初期化し、図をSVGと操作領域へ変換する。
                         * @param payload - Chromiumへ渡す描画要求。Mermaid図ソース、テーマ、描画ID、一時コンテナーIDを含む。
                         * @returns 描画したSVGと操作領域を含むブラウザー側の結果。
                         */
                        async (payload) => {
                            const { diagram, diagramTheme, id, resultContainerId } = payload;
                            const api = (globalThis as typeof globalThis & {

                                /**
                                 * Chromiumへ読み込んだMermaid API。
                                 */
                                mermaid?: {
                                    /**
                                     * Mermaidのinitializeを処理し、呼び出し側へ結果または副作用を返す。
                                     * @param config - Mermaidの初期化に適用する設定。
                                     * @returns 副作用を完了し、値は返さない。
                                     */
                                    initialize(config: Record<string, unknown>): void;
                                    /**
                                     * Mermaidの入力を構造化した値へ変換する。
                                     * @param value - Mermaid構文を検証する図ソース。
                                     * @returns Mermaidで利用する文字列。
                                     */
                                    parse(value: string): Promise<unknown>;
                                    /**
                                     * Mermaidを表示用の結果へ変換する。
                                     * @param renderId - ブラウザー内の描画要素を識別するID。
                                     * @param value - Mermaidで描画する図ソース。
                                     * @returns Mermaidの非同期処理で得られる結果。
                                     */
                                    render(renderId: string, value: string): Promise<{
                                        /**
                                         * Mermaidが生成したSVG本文。
                                         */
                                        svg: string
                                    }>;
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


                            const toInteraction = /**
                 * SVG要素の表示文字列と矩形を親SVG基準の正規化領域へ変換する。
                 * @param element - 寸法または属性を読み取るDOM要素。
                 * @param type - 操作対象が図中テキストならtext、リンクならlinkを示す種別。
                 * @param href - リンク操作領域へ記録するSVGのhref属性値。
                 * @returns 表示領域を表す操作情報、または対象外の場合のundefined。
                 */ (element: Element, type: 'text' | 'link', href?: string): MermaidInteraction | undefined => {
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
                                .filter(
                                    /**
                                     * tag・nameの条件を満たす要素だけを残す。
                                     * @param element - foreignObject内かを判定するSVGテキスト領域の候補要素。
                                     * @returns 条件を満たした要素だけを含む一覧。
                                     */
                                    (element) => element.tagName.toLowerCase() !== 'text' || !element.closest('foreignObject'))
                                .map(
                                    /**
                                     * 各要素をto・interactionへ渡し、変換結果を一覧化する。
                                     * @param element - テキスト操作領域へ変換するSVG要素。
                                     * @returns 入力要素から生成した変換結果の一覧。
                                     */
                                    (element) => toInteraction(element, 'text'))
                                .filter(
                                    /**
                                     * 条件を満たす項目だけを残す。
                                     * @param item - toInteractionが生成したテキスト操作情報。undefinedでなければ一覧に残す。
                                     * @returns 条件を満たした要素だけを含む一覧。
                                     */
                                    (item): item is MermaidInteraction => item !== undefined);
                            const linkInteractions = Array.from(svgNode.querySelectorAll('a'))
                                .map(
                                    /**
                                     * 各要素からget・attributeを取り出して一覧化する。
                                     * @param element - hrefまたはxlink:hrefを読むSVGリンク要素。
                                     * @returns get・attributeを取り出した変換結果の一覧。
                                     */
                                    (element) => toInteraction(
                                        element,
                                        'link',
                                        element.getAttribute('href') ?? element.getAttribute('xlink:href') ?? undefined
                                    ))
                                .filter(
                                    /**
                                     * 未定義または無効な項目を除外する。
                                     * @param item - hrefを持つMermaidリンク操作情報。リンク領域一覧へ残す候補。
                                     * @returns 条件を満たした要素だけを含む一覧。
                                     */
                                    (item): item is MermaidInteraction => item !== undefined && Boolean(item.href));
                            const ariaLabel = svgNode.querySelector('title')?.textContent?.trim()
                                ?? svgNode.getAttribute('aria-label')
                                ?? textInteractions.slice(0, 20).map(
                                    /**
                                     * 各項目から本文を取り出して一覧化する。
                                     * @param item - aria-labelに連結するMermaidテキスト操作情報。
                                     * @returns 本文を取り出した変換結果の一覧。
                                     */
                                    (item) => item.text).join(', ');
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
                        await page.evaluate(
                            /**
                             * 描画後に一時DOM要素を削除する。
                             * @param id - 削除対象となる描画コンテナーのDOM id。
                             * @returns 副作用を完了し、値は返さない。
                             */
                            (id) => document.getElementById(id)?.remove(), containerId).catch(
                                /**
                                 * Mermaidのコールバックとして要素を処理する。
                                 * @returns 副作用を完了し、値は返さない。
                                 */
                                () => undefined);
                    }
                })();
            const rendered = await withTimeout(operation, RENDER_TIMEOUT_MS, resetRendererPage);
            if (task.cancelled) throw new MermaidRenderCancelledError();
            writeCache(key, rendered);
            return rendered;
        };
    inFlight.set(key, task);
    enqueue(task);
    void task.promise.finally(
        /**
         * 要素をifへ渡し、Mermaidの結果または副作用を処理する。
         * @returns 副作用を完了し、値は返さない。
         */
        () => {
            if (inFlight.get(key) === task) inFlight.delete(key);
        }).catch(
            /**
             * Mermaidのコールバックとして要素を処理する。
             * @returns 副作用を完了し、値は返さない。
             */
            () => undefined);
    return consumeTask(key, task, signal);
}

/**
 * Mermaid描画の待機列、キャッシュ、ページ、ブラウザーコンテキストを解放する。
 * @returns 副作用を完了し、値は返さない。
 */
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
    if (context) await context.close().catch(
        /**
         * Mermaidのコールバックとして要素を処理する。
         * @returns SVG、PNG、操作領域をまとめたMermaid描画結果。
         */
        () => undefined);
}

/**
 * 進行中の描画タスクを呼び出し側へ共有し、最後の購読者が離れたらキャンセルする。
 * @param key - Mermaidのソースとテーマから生成した共有描画タスクのキー。
 * @param task - Promise、購読者数、開始・完了・キャンセル状態を管理する描画タスク。
 * @param signal - 呼び出し側のキャンセルを通知するAbortSignal。
 * @returns SVG、PNG、操作領域をまとめたMermaid描画結果。
 */
function consumeTask(key: string, task: RenderTask, signal?: AbortSignal): Promise<MermaidBrowserResult> {
    task.consumers += 1;
    let settled = false;


    const release = /**
     * Mermaidの処理またはリソースを終了し、後続利用可能な状態へ戻す。
     * @returns 副作用を完了し、値は返さない。
     */ () => {
            if (settled) return;
            settled = true;
            task.consumers = Math.max(0, task.consumers - 1);
            if (task.consumers === 0 && inFlight.get(key) === task) {
                inFlight.delete(key);
                cancelTask(task);
            }
        };
    return new Promise<MermaidBrowserResult>(
        /**
         * 非同期処理の成功結果と失敗理由を待機側へ通知する。
         * @param resolve - Promiseの成功を通知する関数。
         * @param reject - Promiseの失敗を通知する関数。
         * @returns 非同期処理の完了値。
         */
        (resolve, reject) => {


            const onAbort = /**
         * Mermaidのイベントまたはメッセージを受け取り、状態を更新する。
         * @returns 副作用を完了し、値は返さない。
         */ () => {
                    release();
                    reject(new MermaidRenderCancelledError());
                };
            if (signal?.aborted) {
                onAbort();
                return;
            }
            signal?.addEventListener('abort', onAbort, { once: true });
            task.promise.then(

                /**
                 * 完了した描画結果を呼び出し元へ返す。
                 * @param rendered - 描画処理で生成したSVG、任意のPNG、操作領域を含む結果。
                 * @returns 副作用を完了し、値は返さない。
                 */
                (rendered) => {
                    if (settled) return;
                    signal?.removeEventListener('abort', onAbort);
                    release();
                    resolve(rendered);
                },

                /**
                 * errorをifへ渡し、Mermaidの結果または副作用を処理する。
                 * @param error - 処理に失敗した理由または例外。
                 * @returns 副作用を完了し、値は返さない。
                 */
                (error) => {
                    if (settled) return;
                    signal?.removeEventListener('abort', onAbort);
                    release();
                    reject(error);
                }
            );
        });
}

/**
 * Mermaidの処理順序と完了状態を管理する。
 * @param task - 実行待ちキューへ追加する描画タスク。
 * @returns 副作用を完了し、値は返さない。
 */
function enqueue(task: RenderTask): void {
    renderQueue.push(task);
    void drainRenderQueue();
}

/**
 * Mermaid描画キューをFIFO順に1件ずつ実行し、成功・失敗を待機側へ通知する。
 * @returns 副作用を完了し、値は返さない。
 */
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

/**
 * 未開始または実行中の描画タスクをキャンセルし、待機側へ専用エラーを通知する。
 * @param task - キューまたはブラウザーで進行中の描画タスク。
 * @returns 条件が成立したかを示す真偽値。
 */
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

/**
 * 描画タスクを一度だけ成功または失敗として確定させる。
 * @param task - 完了状態を更新する描画タスク。
 * @param result - 成功時に購読者へ返す描画結果。失敗時は省略する。
 * @param error - 処理に失敗した理由または例外。
 * @returns 副作用を完了し、値は返さない。
 */
function settleTask(task: RenderTask, result?: MermaidBrowserResult, error?: unknown): void {
    if (task.settled) return;
    task.settled = true;
    if (error !== undefined) task.reject(error);
    else if (result !== undefined) task.resolve(result);
}

/**
 * Mermaidランタイムを読み込んだ再利用可能なPlaywrightページを取得する。
 * @param runtimePath - Mermaidランタイムを読み込むファイルのパス。
 * @param acquireBrowser - 描画用ブラウザーを取得する非同期関数。
 * @returns Mermaidの非同期処理で得られる結果。
 */
async function acquireRendererPage(runtimePath: string, acquireBrowser: () => Promise<Browser>): Promise<Page> {
    if (rendererPage && !rendererPage.isClosed()) return rendererPage;
    if (pagePromise) return pagePromise;
    if (rendererPage?.isClosed() || browserContext) await resetRendererPage();
    pagePromise = createRendererPage(runtimePath, acquireBrowser).finally(
        /**
         * Mermaidのコールバックとして要素を処理する。
         * @returns Mermaidの非同期処理で得られる結果。
         */
        () => {
            pagePromise = undefined;
        });
    return pagePromise;
}

/**
 * Mermaidで使う値または実行環境を組み立てる。
 * @param runtimePath - Mermaidランタイムを読み込むファイルのパス。
 * @param acquireBrowser - 描画用ブラウザーを取得する非同期関数。
 * @returns Mermaidの非同期処理で得られる結果。
 */
async function createRendererPage(runtimePath: string, acquireBrowser: () => Promise<Browser>): Promise<Page> {
    try {
        const browser = await acquireBrowser();
        const context = await browser.newContext({ javaScriptEnabled: true });
        browserContext = context;
        await context.route('**/*',
            /**
             * 外部通信要求をPlaywrightルート経由で遮断する。
             * @param route - 要求をabortするPlaywright Route。
             * @returns 副作用を完了し、値は返さない。
             */
            (route) => route.abort('blockedbyclient'));
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

/**
 * 描画ページとコンテキストを破棄し、次回要求で再初期化できる状態へ戻す。
 * @returns 副作用を完了し、値は返さない。
 */
async function resetRendererPage(): Promise<void> {
    pagePromise = undefined;
    rendererPage = undefined;
    const context = browserContext;
    browserContext = undefined;
    if (context) await context.close().catch(
        /**
         * Mermaidのコールバックとして要素を処理する。
         * @returns 副作用を完了し、値は返さない。
         */
        () => undefined);
}

/**
 * テーマとソースから生成したキーで描画結果をキャッシュから取得する。
 * @param key - Mermaidソースとテーマから生成したキャッシュキー。
 * @returns キャッシュに一致する描画結果。未登録の場合はundefined。
 */
function readCache(key: string): MermaidBrowserResult | undefined {
    const rendered = svgCache.get(key);
    if (rendered === undefined) return undefined;
    svgCache.delete(key);
    svgCache.set(key, rendered);
    return rendered;
}

/**
 * 描画結果を容量制限付きキャッシュへ追加し、古い項目を削除する。
 * @param key - Mermaidソースとテーマから生成したキャッシュキー。
 * @param rendered - キャッシュへ登録するSVG、任意のPNG、操作領域を含む描画結果。
 * @returns 副作用を完了し、値は返さない。
 */
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

/**
 * 描画結果に含まれるテキスト量からキャッシュ容量の概算値を計算する。
 * @param rendered - SVG、アクセシブル名、任意のPNG、操作領域を含む描画結果。
 * @returns キャッシュ上限の判定に使う概算バイト数。
 */
function estimateResultBytes(rendered: MermaidBrowserResult): number {
    return (rendered.svg.length + rendered.ariaLabel.length + (rendered.pngBase64?.length ?? 0)) * 2
        + rendered.interactions.reduce(
            /**
             * 要素を順に加算して累積値を求める。
             * @param total - これまでに集計した概算バイト数。
             * @param interaction - サイズへ加算する操作領域情報。
             * @returns 要素を集約した累積値。
             */
            (total, interaction) => (
                total + (interaction.text.length + (interaction.href?.length ?? 0)) * 2 + 64
            ), 0);
}

/**
 * 非同期描画を上限時間まで待機し、超過時はリセット処理を実行する。
 * @param operation - 描画処理をすでに開始した非同期Promise。
 * @param timeoutMs - タイムアウトまで待つ時間（ミリ秒）。
 * @param onTimeout - 時間超過時にブラウザー描画環境をリセットする非同期処理。
 * @returns Mermaidの非同期処理で得られる結果。
 */
async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, onTimeout: () => Promise<void>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>(
        /**
         * 遅延処理の完了または失敗を待機側へ通知する。
         * @param _ - reject専用Promiseの第1引数として渡される未使用のresolve関数。
         * @param reject - Promiseの失敗を通知する関数。
         * @returns 非同期処理の完了値。
         */
        (_, reject) => {
            timer = setTimeout(
                /**
                 * 指定時間の経過後に後続処理を実行する。
                 * @returns 副作用を完了し、値は返さない。
                 */
                () => {
                    void onTimeout();
                    reject(new Error(`Mermaid rendering timed out after ${timeoutMs}ms.`));
                }, timeoutMs);
        });
    try {
        return await Promise.race([operation, timeout]);
    } finally {
        if (timer) clearTimeout(timer);
        void operation.catch(
            /**
             * Mermaidのコールバックとして要素を処理する。
             * @returns 副作用を完了し、値は返さない。
             */
            () => undefined);
    }
}

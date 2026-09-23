/**
 * @file mermaid.ts
 * 実行境界: Extension Host。
 * 責務: VS Code文書、Webview、外部リソースを連携する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: 文書、ファイル、Webview、ブラウザーなどの外部状態を必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { MermaidInteraction } from '../shared/protocol';

/**
 * 「MermaidTheme」として扱う値の型を定義します。
 */
export type MermaidTheme = 'default' | 'dark' | 'neutral';

/** 「CACHE_LIMIT」は、入力・表示・資源の上限または下限を表す値です。 */
/** Mermaid SVG結果を保持する最大エントリ数。古い結果を破棄してHostメモリの増加を抑える。 */
const CACHE_LIMIT = 12;
/** 「CACHE_BYTE_LIMIT」は、入力・表示・資源の上限または下限を表す値です。 */
/** Mermaid SVG結果の合計バイト上限。図表の大きさに依存するキャッシュを有界に保つ。 */
const CACHE_BYTE_LIMIT = 24 * 1024 * 1024;
/** 「RENDER_TIMEOUT_MS」は、時間制限または遅延量を処理間で共有する値です。 */
/** Chromium内のMermaid描画を待機する上限時間。無限待機でキューを塞がない。 */
const RENDER_TIMEOUT_MS = 30_000;
/**
 * 「MermaidBrowserResult」が満たすデータ契約を定義します。
 */
export interface MermaidBrowserResult {

    /**
     * 「svg」は、対象の内容または識別子を表す文字列です。
     */
    svg: string;

    /**
     * 「pngBase64」は、対象の内容または識別子を表す文字列です。
     */
    pngBase64?: string;

    /**
     * 「interactions」は、関連する複数の対象または識別子を保持します。
     */
    interactions: MermaidInteraction[];

    /**
     * 「ariaLabel」は、画面または通知へ表示する文言を保持します。
     */
    ariaLabel: string;
}

/** 「svgCache」は、再利用する結果を保持し、同じ処理の重複を抑えるキャッシュです。 */
/** 完了済みMermaid描画をテーマとソースの組み合わせで再利用するキャッシュ。 */
const svgCache = new Map<string, MermaidBrowserResult>();
/**
 * 「RenderTask」が満たすデータ契約を定義します。
 */
interface RenderTask {

    /**
     * 「promise」は、非同期処理またはリソースのライフサイクルを管理します。
     */
    promise: Promise<MermaidBrowserResult>;

    /**
     * 「consumers」は、位置・サイズ・件数などを表す数値です。
     */
    consumers: number;

    /**
     * 「cancelled」は、処理条件または状態を表す真偽値です。
     */
    cancelled: boolean;

    /**
     * 「started」は、処理条件または状態を表す真偽値です。
     */
    started: boolean;

    /**
     * 「settled」は、処理条件または状態を表す真偽値です。
     */
    settled: boolean;
    /**
     * 「operation」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
     * @returns 非同期処理の完了を表すPromiseです。
     */
    operation: () => Promise<MermaidBrowserResult>;
    /**
     * 「resolve」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
     * @param result 処理対象の結果です。
     * @returns 「resolve」の副作用または状態更新を実行し、値は返しません。
     */
    resolve: (result: MermaidBrowserResult) => void;
    /**
     * 「reject」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
     * @param error 発生したエラーです。
     * @returns 「reject」の副作用または状態更新を実行し、値は返しません。
     */
    reject: (error: unknown) => void;
}
/** 「inFlight」は、関連する処理間で共有する設定値または状態です。 */
/** 同一図表の重複描画をまとめる未完了タスクの一覧。 */
const inFlight = new Map<string, RenderTask>();
/** 「svgCacheBytes」は、再利用する結果を保持し、同じ処理の重複を抑えるキャッシュです。 */
/** キャッシュ済みSVGの概算バイト数。容量制限の判定に使う。 */
let svgCacheBytes = 0;
/** 「renderQueue」は、関連する処理間で共有する設定値または状態です。 */
/** Chromium描画のFIFOキュー。逐次実行でブラウザー負荷と競合を抑える。 */
const renderQueue: RenderTask[] = [];
/** 「activeRenderTask」は、関連する処理間で共有する設定値または状態です。 */
/** 現在Chromiumへ渡している描画タスク。 */
let activeRenderTask: RenderTask | undefined;
/** 「browserContext」は、ブラウザー処理の共有状態または実行設定です。 */
/** Mermaid描画専用のPlaywrightコンテキスト。 */
let browserContext: BrowserContext | undefined;
/** 「rendererPage」は、ブラウザー処理の共有状態または実行設定です。 */
/** Mermaid描画に再利用するページ。 */
let rendererPage: Page | undefined;
/** 「pagePromise」は、非同期初期化または処理の重複を防ぐ共有Promiseです。 */
/** ページ初期化の重複を防ぐ共有Promise。 */
let pagePromise: Promise<Page> | undefined;

/**
 * 外部ブラウザを起動できず、Webview内フォールバックが必要であることを示す。
 */
export class MermaidRendererUnavailableError extends Error {
    /**
     * 処理に必要な状態を初期化します。
     * @param message 処理対象のメッセージです。
     * @param options 処理経路や表示方法を指定する設定値です。
     * @returns 「constructor」がMermaid描画の入力を処理して得た固有の結果を返します。
     */
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'MermaidRendererUnavailableError';
    }
}

/**
 * 「MermaidRenderCancelledError」クラスの状態とライフサイクルを定義します。
 */
class MermaidRenderCancelledError extends Error {
    /**
     * 処理に必要な状態を初期化します。
     * @returns 「constructor」がMermaid描画の入力を処理して得た固有の結果を返します。
     */
    constructor() {
        super('Mermaid rendering was cancelled.');
        this.name = 'MermaidRenderCancelledError';
    }
}

/**
 * MermaidをWebviewとは別のChromiumプロセスでSVG化する。
 * @param source 処理対象のソースです。
 * @param theme 処理対象のテーマです。
 * @param runtimePath 「runtimePath」は、「renderMermaidInBrowser」がMermaidで処理する対象を特定する入力です。
 * @param acquireBrowser 「acquireBrowser」は、「renderMermaidInBrowser」がMermaid描画の処理対象を特定する入力です。
 * @param signal 処理対象のシグナルです。
 * @returns 非同期処理の完了を表すPromiseです。
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
     * 「resolveTask」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
     * @param result 処理対象の結果です。
     * @returns 「resolveTask」の副作用または状態更新を実行し、値は返しません。
     */
    let resolveTask!: (result: MermaidBrowserResult) => void;
    /**
     * 「rejectTask」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
     * @param error 発生したエラーです。
     * @returns 「rejectTask」の副作用または状態更新を実行し、値は返しません。
     */
    let rejectTask!: (error: unknown) => void;
    const task = {
        consumers: 0,
        cancelled: false,
        started: false,
        settled: false,

        /**
         * resolveを取得または解決します。
         * @param result 処理対象の結果です。
         * @returns 「resolve」がMermaid描画の入力を処理して得た固有の結果を返します。
         */
        resolve: /**
 * 「resolve」は、非同期処理の完了状態を通知します。
 * @param result 「result」は、「resolve」がMermaidで処理する対象を特定する入力です。
 * @returns 非同期処理の完了または失敗を通知します。
 */ (result: MermaidBrowserResult) => resolveTask(result),

        /**
         * 「reject」は、非同期処理の完了状態を通知します。
         * @param error 発生したエラーです。
         * @returns 「reject」の非同期処理が完了した結果をPromiseで返します。
         */
        reject: /**
 * 「reject」は、非同期処理の完了状態を通知します。
 * @param error 発生したエラーの情報です。
 * @returns 非同期処理の完了または失敗を通知します。
 */ (error: unknown) => rejectTask(error)
    } as RenderTask;
    task.promise = new Promise<MermaidBrowserResult>(
    /**
 * 「resolve」「reject」を受け取り、登録された副作用または結果を生成する処理です。
     * @param resolve Promiseの完了または失敗を通知する関数です。
     * @param reject Promiseの完了または失敗を通知する関数です。
     * @returns 「async」を実行し、値を返しません。
     */
    (resolve, reject) => {
        resolveTask = resolve;
        rejectTask = reject;
    });
    task.operation =
    /**
     * 「async」として関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
     * @returns 「if」を実行し、値を返しません。
     */
    async () => {
        if (task.cancelled) throw new MermaidRenderCancelledError();
        const page = await acquireRendererPage(runtimePath, acquireBrowser);
        if (task.cancelled) throw new MermaidRenderCancelledError();
        const renderId = `mve-host-mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const containerId = `${renderId}-container`;
        const operation = (
        /**
         * 「async」として関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
         * @returns 非同期処理の完了を表すPromiseです。
         */
        async (): Promise<MermaidBrowserResult> => {
            const rendered = await page.evaluate(
            /**
 * 「diagram」「diagramTheme」「id」「resultContainerId」を受け取り、登録された副作用または結果を生成する処理です。
             * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはdiagram、diagramTheme、id、resultContainerIdです。
             * @returns 「initialize」を実行し、値を返しません。
             */
            async ({ diagram, diagramTheme, id, resultContainerId }) => {
                const api = (globalThis as typeof globalThis & {

                    /**
                     * 「mermaid」は、対象の識別や処理分岐に使用する値を保持します。
                     */
                    mermaid?: {
                        /**
                         * 「initialize」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
                         * @param config 保存済み設定または処理経路を選択するオプションです。未設定時の既定値や正規化対象を含みます。
                         * @returns 「initialize」の副作用または状態更新を実行し、値は返しません。
                         */
                        initialize(config: Record<string, unknown>): void;
                        /**
                         * 「parse」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
                         * @param value 「parse」で検証・変換する入力値です。
                         * @returns 非同期処理の完了を表すPromiseです。
                         */
                        parse(value: string): Promise<unknown>;
                        /**
                         * 「render」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
                         * @param renderId 「renderId」は、「render」がMermaid描画の処理対象を特定する入力です。
                         * @param value 「render」で検証・変換する入力値です。
                         * @returns 非同期処理の完了を表すPromiseです。
                         */
                        render(renderId: string, value: string): Promise<{
                        /**
                         * 「svg」は、対象の内容または識別子を表す文字列です。
                         */
                        svg: string }>;
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

                /**
                 * 「toInteraction」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
                 * @param element 処理対象の要素です。
                 * @param type 処理対象の種別です。
                 * @param href 「href」は、「toInteraction」がMermaid描画の処理対象を特定する入力です。
                 * @returns 「toInteraction」が対象を取得できない場合はundefinedを返します。
                 */
                const toInteraction = /**
 * 「toInteraction」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param element 処理対象のDOM要素、エディター、または実行コンテキストです。
 * @param type 処理対象の種別または画面モードを表す識別値です。
 * @param href 「href」は、「toInteraction」がMermaidで処理する対象を特定する入力です。
 * @returns 「toInteraction」がMermaid描画の入力を処理して得た固有の結果を返します。
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
 * 「element」が条件に一致するか判定し、残す要素を決めるコールバックです。
                     * @param element 処理対象の要素です。
                     * @returns 要素を採用するかどうかの真偽値を返します。
                     */
                    (element) => element.tagName.toLowerCase() !== 'text' || !element.closest('foreignObject'))
                    .map(
                    /**
 * 「element」を変換し、変換後の要素を返すコールバックです。
                     * @param element 処理対象の要素です。
                     * @returns 入力要素から生成した変換後の値を返します。
                     */
                    (element) => toInteraction(element, 'text'))
                    .filter(
                    /**
 * 「item」が条件に一致するか判定し、残す要素を決めるコールバックです。
                     * @param item 変換または処理の対象となる値です。
                     * @returns 条件判定の結果を示す真偽値を返します。
                     */
                    (item): item is MermaidInteraction => item !== undefined);
                const linkInteractions = Array.from(svgNode.querySelectorAll('a'))
                    .map(
                    /**
 * 「element」を変換し、変換後の要素を返すコールバックです。
                     * @param element 処理対象の要素です。
                     * @returns 入力要素から生成した変換後の値を返します。
                     */
                    (element) => toInteraction(
                        element,
                        'link',
                        element.getAttribute('href') ?? element.getAttribute('xlink:href') ?? undefined
                    ))
                    .filter(
                    /**
 * 「item」が条件に一致するか判定し、残す要素を決めるコールバックです。
                     * @param item 変換または処理の対象となる値です。
                     * @returns 要素を採用するかどうかの真偽値を返します。
                     */
                    (item): item is MermaidInteraction => item !== undefined && Boolean(item.href));
                const ariaLabel = svgNode.querySelector('title')?.textContent?.trim()
                    ?? svgNode.getAttribute('aria-label')
                    ?? textInteractions.slice(0, 20).map(
                    /**
 * 「item」を変換し、変換後の要素を返すコールバックです。
                     * @param item 変換または処理の対象となる値です。
                     * @returns 入力要素から生成した変換後の値を返します。
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
 * 非同期処理の失敗理由を受け取り、回復処理または代替値を生成するコールバックです。
                 * @param id idとして渡される、このコールバックの入力値です。
                 * @returns 「document.getElementById」を実行し、値を返しません。
                 */
                (id) => document.getElementById(id)?.remove(), containerId).catch(
                /**
                 * Promiseの失敗理由を受け取り、エラー表示またはフォールバックを実行するコールバックです。
                 * @returns エラー処理またはフォールバックの結果を返します。
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
     * Promiseの成否にかかわらず、購読解除やリソース整理を実行するコールバックです。
     * @returns 「if」の呼び出し結果を返します。
     */
    () => {
        if (inFlight.get(key) === task) inFlight.delete(key);
    }).catch(
    /**
     * Promiseの失敗理由を受け取り、エラー表示またはフォールバックを実行するコールバックです。
     * @returns エラー処理またはフォールバックの結果を返します。
     */
    () => undefined);
    return consumeTask(key, task, signal);
}

/**
 * 拡張終了時にMermaid専用ページとコンテキストを解放する。
 * @returns 非同期処理の完了を表すPromiseです。
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
     * Promiseの失敗理由を受け取り、エラー表示またはフォールバックを実行するコールバックです。
     * @returns エラー処理またはフォールバックの結果を返します。
     */
    () => undefined);
}

/**
 * タスクを処理します。
 * @param key メッセージまたは設定表から値を取得する識別キーです。
 * @param task 処理対象のタスクです。
 * @param signal 処理対象のシグナルです。
 * @returns 非同期処理の完了を表すPromiseです。
 */
function consumeTask(key: string, task: RenderTask, signal?: AbortSignal): Promise<MermaidBrowserResult> {
    task.consumers += 1;
    let settled = false;

    /**
     * 「release」は、処理を終了し、保持していたリソースまたは状態を整理します。
     * @returns 購読解除、タイマー解除、リソース破棄などの後片付けを実行し、値は返しません。
     */
    const release = /**
 * 「release」は、処理を終了し、保持していたリソースまたは状態を整理します。
 * @returns 購読解除、タイマー解除、リソース破棄などの後片付けを実行し、値は返しません。
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
 * 「resolve」「reject」を受け取り、処理結果を生成する処理です。
     * @param resolve Promiseの完了または失敗を通知する関数です。
     * @param reject Promiseの完了または失敗を通知する関数です。
     * @returns 「release」を実行し、値を返しません。
     */
    (resolve, reject) => {

        /**
         * 「onAbort」は、イベント入力を受け取り、関連する状態またはUIを更新する処理です。
         * @returns 「release」を実行し、値を返しません。
         */
        const onAbort = /**
 * 「onAbort」は、イベント入力を検証し、関連する状態またはUIを更新します。
 * @returns 「release」を実行し、値を返しません。
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
             * イベント情報を「rendered」を受け取り、DOMまたは画面状態を更新するコールバックです。
             * @param rendered renderedとして渡される、このコールバックの入力値です。
             * @returns 解決値を処理した結果を返します。
             */
            (rendered) => {
                if (settled) return;
                signal?.removeEventListener('abort', onAbort);
                release();
                resolve(rendered);
            },

            /**
 * 非同期処理の完了値を受け取り、次の処理へ渡す結果を生成するコールバックです。
             * @param error 発生したエラーです。
             * @returns 「if」を実行し、値を返しません。
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
 * 「enqueue」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param task 処理対象のタスクです。
 * @returns 「enqueue」の副作用または状態更新を実行し、値は返しません。
 */
function enqueue(task: RenderTask): void {
    renderQueue.push(task);
    void drainRenderQueue();
}

/**
 * 「drainRenderQueue」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @returns 非同期処理の完了を表すPromiseです。
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
 * タスクを解除または削除します。
 * @param task 処理対象のタスクです。
 * @returns 購読解除、タイマー解除、またはリソース破棄を実行して値は返しません。
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
 * 「settleTask」は、入力を検証して対象の状態または内容へ適用します。
 * @param task 処理対象のタスクです。
 * @param result 処理対象の結果です。
 * @param error 発生したエラーです。
 * @returns 「settleTask」の副作用または状態更新を実行し、値は返しません。
 */
function settleTask(task: RenderTask, result?: MermaidBrowserResult, error?: unknown): void {
    if (task.settled) return;
    task.settled = true;
    if (error !== undefined) task.reject(error);
    else if (result !== undefined) task.resolve(result);
}

/**
 * ページを取得または解決します。
 * @param runtimePath 「runtimePath」は、「acquireRendererPage」がMermaidで処理する対象を特定する入力です。
 * @param acquireBrowser 「acquireBrowser」は、「acquireRendererPage」がMermaid描画の処理対象を特定する入力です。
 * @returns 非同期処理の完了を表すPromiseです。
 */
async function acquireRendererPage(runtimePath: string, acquireBrowser: () => Promise<Browser>): Promise<Page> {
    if (rendererPage && !rendererPage.isClosed()) return rendererPage;
    if (pagePromise) return pagePromise;
    if (rendererPage?.isClosed() || browserContext) await resetRendererPage();
    pagePromise = createRendererPage(runtimePath, acquireBrowser).finally(
    /**
     * Promiseの成否にかかわらず、購読解除やリソース整理を実行するコールバックです。
     * @returns 「createRendererPage」の呼び出し結果を返します。
     */
    () => {
        pagePromise = undefined;
    });
    return pagePromise;
}

/**
 * ページを作成または組み立てます。
 * @param runtimePath 「runtimePath」は、「createRendererPage」がMermaidで処理する対象を特定する入力です。
 * @param acquireBrowser 「acquireBrowser」は、「createRendererPage」がMermaid描画の処理対象を特定する入力です。
 * @returns 非同期処理の完了を表すPromiseです。
 */
async function createRendererPage(runtimePath: string, acquireBrowser: () => Promise<Browser>): Promise<Page> {
    try {
        const browser = await acquireBrowser();
        const context = await browser.newContext({ javaScriptEnabled: true });
        browserContext = context;
        await context.route('**/*',
        /**
 * 非同期処理の失敗理由を受け取り、回復処理または代替値を生成するコールバックです。
         * @param route routeとして渡される、このコールバックの入力値です。
         * @returns 「route.abort」を実行し、値を返しません。
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
 * ページを解除または削除します。
 * @returns 非同期処理の完了を表すPromiseです。
 */
async function resetRendererPage(): Promise<void> {
    pagePromise = undefined;
    rendererPage = undefined;
    const context = browserContext;
    browserContext = undefined;
    if (context) await context.close().catch(
    /**
     * Promiseの失敗理由を受け取り、エラー表示またはフォールバックを実行するコールバックです。
     * @returns エラー処理またはフォールバックの結果を返します。
     */
    () => undefined);
}

/**
 * read・cacheを取得または解決します。
 * @param key メッセージまたは設定表から値を取得する識別キーです。
 * @returns 「readCache」が対象を取得できない場合はundefinedを返します。
 */
function readCache(key: string): MermaidBrowserResult | undefined {
    const rendered = svgCache.get(key);
    if (rendered === undefined) return undefined;
    svgCache.delete(key);
    svgCache.set(key, rendered);
    return rendered;
}

/**
 * write・cacheを更新または保存します。
 * @param key メッセージまたは設定表から値を取得する識別キーです。
 * @param rendered 「rendered」は、「writeCache」がMermaid描画の処理対象を特定する入力です。
 * @returns 「writeCache」の副作用または状態更新を実行し、値は返しません。
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
 * estimate・result・bytesを計算します。
 * @param rendered 「rendered」は、「estimateResultBytes」がMermaid描画の処理対象を特定する入力です。
 * @returns 計算結果の数値です。
 */
function estimateResultBytes(rendered: MermaidBrowserResult): number {
    return (rendered.svg.length + rendered.ariaLabel.length + (rendered.pngBase64?.length ?? 0)) * 2
        + rendered.interactions.reduce(
        /**
         * 累積値と入力を「total」「interaction」を受け取り、集約結果を更新するコールバックです。
         * @param total totalとして渡される、このコールバックの入力値です。
         * @param interaction interactionとして渡される、このコールバックの入力値です。
         * @returns 更新後の累積値を返します。
         */
        (total, interaction) => (
            total + (interaction.text.length + (interaction.href?.length ?? 0)) * 2 + 64
        ), 0);
}

/**
 * 「withTimeout」は、処理時間、入力サイズ、または対象数を制限する境界値です。
 * @param operation 表示領域のサイズまたは倍率で、画面レイアウト計算に使用します。
 * @param timeoutMs 「timeoutMs」は、「withTimeout」がMermaid描画の処理対象を特定する入力です。
 * @param onTimeout 処理完了時に呼び出すコールバックです。
 * @returns 非同期処理の完了を表すPromiseです。
 */
async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, onTimeout: () => Promise<void>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>(
    /**
 * 指定時間の経過後に遅延処理を実行するコールバックです。
     * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
     * @param reject Promiseの完了または失敗を通知する関数です。
     * @returns 「_」「reject」から生成した処理結果を返します。
     */
    (_, reject) => {
        timer = setTimeout(
        /**
 * 指定時間の経過後に遅延処理を実行するコールバックです。
         * @returns 「onTimeout」の呼び出し結果を返します。
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
         * Promiseの失敗理由を受け取り、エラー表示またはフォールバックを実行するコールバックです。
         * @returns エラー処理またはフォールバックの結果を返します。
         */
        () => undefined);
    }
}

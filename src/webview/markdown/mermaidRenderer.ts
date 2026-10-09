/**
 * @fileoverview WebviewからMermaid描画を要求し、SVG結果・PNGフォールバック・クリック領域をプレビューへ反映する。
 */
import { createClientId } from '../runtime/id';
import { getMessages, type SupportedLanguage } from '../../shared/messages';
import type { HostToWebviewMessage, MermaidInteraction } from '../../shared/protocol';
import { sharedVsCodeApi } from '../runtime/vscodeApi';
import { webviewAssetUrl, webviewScriptNonce } from '../runtime/assets';

/**
 * Mermaidの配色プリセットを表すリテラル型。
 */
export type MermaidTheme = 'default' | 'dark' | 'neutral';

/**
 * Markdown内のMermaid図を描画する対象要素とソースです。
 */
interface InlineRenderTask {

    /**
     * 解析・描画・変換の起点となる本文。
     */
    source: string;

    /**
     * 描画や表示に適用する配色テーマ。
     */
    theme: MermaidTheme;

    /**
     * 呼び出し側のキャンセルを通知するAbortSignal。
     */
    signal?: AbortSignal;

    /**
     * 実行キューから取り出して処理を開始した状態。
     */
    started: boolean;

    /**
     * 完了または失敗を通知済みの状態。
     */
    settled: boolean;

    /**
     * キャンセル済みで後続処理を開始できない状態。
     */
    cancelled: boolean;
    /**
     * WebviewからHostへ要求したMermaid結果を受け取るresolver。
     * @param result - mermaidrendererへ渡す入力。
     */
    resolve: (result: MermaidRenderResult) => void;
    /**
     * WebviewからHostへ要求したMermaid描画の失敗を受け取るrejecter。
     * @param error - 処理に失敗した理由または例外。
     */
    reject: (error: unknown) => void;
    /**
     * タスク完了後にAbortSignalから登録解除する関数。
     */
    removeAbortListener: () => void;
}

/**
 * mermaidrendererの要求を順序付ける待機列。
 */
const inlineRenderQueue: InlineRenderTask[] = [];

/**
 * mermaidrendererの条件を示すフラグ。
 */
let activeInlineRender: InlineRenderTask | undefined;
/**
 * 初期化済みMermaid実行環境と描画に使う設定です。
 */
interface MermaidRuntime {
    /**
     * Mermaid runtimeへ描画セキュリティ、テーマ、出力設定を適用する。
     * @param config - Mermaidのinitializeに渡す設定一式。
     */
    initialize(config: Record<string, unknown>): void;
    /**
     * Mermaid図ソースの構文を検証する。
     * @param source - 解析・描画・変換の起点となる本文。

     */
    parse(source: string): Promise<unknown>;
    /**
     * Mermaid図をSVGへ描画する。
     * @param id - mermaidrendererの対象や分岐を識別する値。
     * @param source - 解析・描画・変換の起点となる本文。
     * @returns Mermaidが生成したSVG本文を含む描画結果。
     */
    render(id: string, source: string): Promise<{
        /**
         * Mermaidが生成したSVG本文。
         */
        svg: string
    }>;
}
/**
 * mermaidrendererで扱う一覧または対応表。
 */
declare global {
    /**
     * inline fallbackを描画するために遅延ロードされるMermaid runtime。
     */
    var mermaid: MermaidRuntime | undefined;
}

/**
 * mermaidrendererの非同期処理を共有するPromise。
 */
let mermaidRuntimePromise: Promise<MermaidRuntime> | undefined;

/**
 * mermaidrendererの待機時間または期限。
 */
const HOST_RENDER_TIMEOUT_MS = 35_000;

/**
 * mermaidrendererに許可する上限値。
 */
const COMPACT_PREVIEW_SVG_LIMIT = 80_000;
/**
 * mermaidrendererの処理結果と失敗時情報のデータ形状。
 */
export interface MermaidRenderResult {

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

    /**
     * mermaidrendererの状態を示すフラグ。
     */
    external: boolean;
}

/**
 * mermaidrendererで扱う一覧または対応表。
 */
const hostRequests = new Map<string, {
    /**
     * 成功時にHost応答のSVG、PNG、操作領域を待機中の描画Promiseへ渡す関数。
     * @param result - 表示へ適用するMermaid描画結果。
     */
    resolve: (result: MermaidRenderResult) => void;
    /**
     * 失敗時にHost描画Promiseを拒否する関数。
     * @param error - 処理に失敗した理由または例外。
     */
    reject: (error: Error) => void;

    /**
     * mermaidrendererの遅延処理を管理するタイマー。
     */
    timer: number;
    /**
     * mermaidrendererの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * AbortSignal listenerを解除する処理。戻り値はない。
     */
    removeAbortListener: () => void;
}>();

/**
 * mermaidrendererで失敗理由を表すError派生クラス。
 */
class MermaidRenderCancelledError extends Error {
    /**
     * Mermaid描画のキャンセルを表すエラーを初期化する。
     * @returns 初期化したインスタンス。
     */
    constructor() {
        super('Mermaid rendering was cancelled.');
        this.name = 'MermaidRenderCancelledError';
    }
}

/**
 * mermaidrendererで失敗理由を表すError派生クラス。
 */
export class MermaidHostRenderError extends Error {
    /**
     * Host側のMermaid描画失敗を表すエラーを初期化する。
     * @param message - HostとWebviewの間で受け渡すメッセージ。
     * @param unavailable - mermaidrendererの条件を示すフラグ。
     * @returns 初期化したインスタンス。
     */
    constructor(message: string, readonly unavailable: boolean) {
        super(message);
        this.name = 'MermaidHostRenderError';
    }
}

/**
 * Mermaid図をホストまたはWebview内で描画する。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param theme - 描画や表示に適用する配色テーマ。
 * @param signal - 呼び出し側のキャンセルを通知するAbortSignal。
 * @param useHostRenderer ホスト側レンダラーを使う場合はtrue。
 * @param allowInlineFallback ホスト描画に失敗した場合にWebview内描画へ切り替える場合はtrue。
 * @param preferInlineIfCompact ホスト描画要求の前に小さな図をWebview内で描画する場合はtrue。
 * @returns SVG、必要な場合のPNG、操作領域を含むMermaid描画結果。
 * @throws Mermaidの構文解析または描画に失敗した場合。
 */
export function renderMermaidSvg(
    source: string,
    theme: MermaidTheme,
    signal?: AbortSignal,
    useHostRenderer = false,
    allowInlineFallback = true,
    preferInlineIfCompact = false
): Promise<MermaidRenderResult> {
    if (useHostRenderer) {
        if (preferInlineIfCompact) {
            return renderMermaidInline(source, theme, signal)
                .then(
                    /**
                     * inline SVGがcompact上限を超える場合だけHost側描画を要求する。
                     * @param rendered - サイズを確認して採用またはHost描画へ切り替えるインライン描画結果。
                     */
                    (rendered) => rendered.svg.length < COMPACT_PREVIEW_SVG_LIMIT
                        ? rendered
                        : requestHostRender(source, theme, signal))
                .catch(
                    /**
                     * inline描画のcancelは伝播し、それ以外の失敗はHostへ引き継ぐ。
                     * @param error - 処理に失敗した理由または例外。
                     */
                    (error) => {
                        if (error instanceof MermaidRenderCancelledError) throw error;
                        return requestHostRender(source, theme, signal);
                    });
        }
        return requestHostRender(source, theme, signal)
            .catch(
                /**
                 * Host rendererが利用不能な場合だけ、許可設定に従ってinline描画へ切り替える。
                 * @param error - 処理に失敗した理由または例外。
                 */
                (error) => {
                    if (!(error instanceof MermaidHostRenderError) || !error.unavailable || !allowInlineFallback) throw error;
                    return renderMermaidInline(source, theme, signal);
                });
    }
    return renderMermaidInline(source, theme, signal);
}

/**
 * 対応するrequestIdの待機Promiseだけを解決し、timeoutとabort listenerを解除する。
 * @param message - Hostから返されたSVGまたはPNGを含む完了メッセージ。
 */
export function acceptMermaidRenderResult(
    message: Extract<HostToWebviewMessage, {
        /**
         * Mermaid描画完了メッセージを絞り込むtype判別値です。
         */
        type: 'mermaidRendered'
    }>
): void {
    const pending = hostRequests.get(message.requestId);
    if (!pending) return;
    hostRequests.delete(message.requestId);
    window.clearTimeout(pending.timer);
    pending.removeAbortListener();
    if (message.svg !== undefined) {
        pending.resolve({
            svg: message.svg,
            pngBase64: message.pngBase64,
            interactions: message.interactions ?? [],
            ariaLabel: message.ariaLabel ?? '',
            external: true
        });
    } else {
        pending.reject(new MermaidHostRenderError(
            message.error ?? 'Mermaid rendering failed.',
            message.rendererUnavailable === true
        ));
    }
}

/**
 * HostへMermaid描画要求を送り、SVGと操作領域を含む応答を待つ。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param theme - 描画や表示に適用する配色テーマ。
 * @param signal - 呼び出し側のキャンセルを通知するAbortSignal。
 * @returns Hostから受信したSVG、PNG、操作領域を含む描画結果。
 */
function requestHostRender(
    source: string,
    theme: MermaidTheme,
    signal?: AbortSignal
): Promise<MermaidRenderResult> {
    const requestId = createClientId();
    return new Promise<MermaidRenderResult>(
        /**
         * 遅延処理の完了または失敗を待機側へ通知する。
         * @param resolve - Promiseの成功を通知する関数。
         * @param reject - Promiseの失敗を通知する関数。
         */
        (resolve, reject) => {
            if (signal?.aborted) {
                reject(new MermaidRenderCancelledError());
                return;
            }


            const onAbort = /**
         * AbortSignalで待機要求を破棄し、HostへrequestId付きcancelを送る。
         */ () => {
                    const pending = hostRequests.get(requestId);
                    if (!pending) return;
                    hostRequests.delete(requestId);
                    window.clearTimeout(pending.timer);
                    pending.removeAbortListener();
                    sharedVsCodeApi.postMessage({ type: 'cancelMermaidRender', requestId });
                    reject(new MermaidRenderCancelledError());
                };
            const timer = window.setTimeout(
                /**
                 * 指定時間の経過後に後続処理を実行する。
                 */
                () => {
                    hostRequests.delete(requestId);
                    signal?.removeEventListener('abort', onAbort);
                    sharedVsCodeApi.postMessage({ type: 'cancelMermaidRender', requestId });
                    reject(new MermaidHostRenderError('Mermaid host rendering timed out.', true));
                }, HOST_RENDER_TIMEOUT_MS);
            hostRequests.set(requestId, {
                timer,


                resolve: /**
             * 結果受信後もabort済みなら値を公開せずcancel errorへ揃える。
             * @param result - MermaidのSVG/PNGデータ、操作領域、説明ラベルを含む描画結果オブジェクト。
             */ (result) => {
                        if (signal?.aborted) reject(new MermaidRenderCancelledError());
                        else resolve(result);
                    },
                reject,


                removeAbortListener: /**
             * Host応答またはtimeout後にAbortSignal listenerを外す。
             */ () => signal?.removeEventListener('abort', onAbort)
            });
            signal?.addEventListener('abort', onAbort, { once: true });
            sharedVsCodeApi.postMessage({ type: 'renderMermaid', requestId, source, theme });
        });
}

/**
 * Webview内のMermaid runtimeでSVGを描画し、操作領域を抽出する。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param theme - 描画や表示に適用する配色テーマ。
 * @param signal - 呼び出し側のキャンセルを通知するAbortSignal。
 * @returns Webview内で描画したSVGと操作領域を含む描画結果。
 */
function renderMermaidInline(
    source: string,
    theme: MermaidTheme,
    signal?: AbortSignal
): Promise<MermaidRenderResult> {
    if (signal?.aborted) return Promise.reject(new MermaidRenderCancelledError());
    let task!: InlineRenderTask;
    const result = new Promise<MermaidRenderResult>(
        /**
         * resolve/rejectをタスクへ保存し、AbortSignal listenerを登録する。
         * @param resolve - Promiseの成功を通知する関数。
         * @param reject - Promiseの失敗を通知する関数。
         */
        (resolve, reject) => {


            const onAbort = /**
         * mermaidrendererのイベントまたはメッセージを受け取り、状態を更新する。
         */ () => cancelInlineRender(task);
            task = {
                source,
                theme,
                signal,
                started: false,
                settled: false,
                cancelled: false,
                resolve,
                reject,


                removeAbortListener: /**
             * mermaidrendererの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
             */ () => signal?.removeEventListener('abort', onAbort)
            };
            signal?.addEventListener('abort', onAbort, { once: true });
        });
    inlineRenderQueue.push(task);
    void drainInlineRenderQueue();
    return result;
}

/**
 * mermaidrendererの処理順序と完了状態を管理する。
 */
async function drainInlineRenderQueue(): Promise<void> {
    if (activeInlineRender) return;
    while (inlineRenderQueue.length) {
        const task = inlineRenderQueue.shift();
        if (!task || task.settled) continue;
        if (task.cancelled || task.signal?.aborted) {
            settleInlineRender(task, undefined, new MermaidRenderCancelledError());
            continue;
        }
        activeInlineRender = task;
        task.started = true;
        try {
            const mermaid = await loadMermaidRuntime();
            if (task.cancelled || task.signal?.aborted) throw new MermaidRenderCancelledError();
            mermaid.initialize({
                startOnLoad: false,
                securityLevel: 'strict',
                theme: task.theme,
                suppressErrorRendering: true
            });
            await mermaid.parse(task.source);
            if (task.cancelled || task.signal?.aborted) throw new MermaidRenderCancelledError();
            const { svg } = await mermaid.render(`mve-mermaid-${createClientId()}`, task.source);
            if (task.cancelled || task.signal?.aborted) throw new MermaidRenderCancelledError();
            settleInlineRender(task, { svg, interactions: [], ariaLabel: '', external: false });
        } catch (error) {
            settleInlineRender(task, undefined, error);
        } finally {
            if (activeInlineRender === task) activeInlineRender = undefined;
        }
    }
}

/**
 * Mermaid runtimeが未定義ならnonce付きscriptを一度だけ読み込み、初期化済みruntimeを返す。
 * @returns 読み込まれたMermaid runtime。script読込または初期化失敗時はPromiseを拒否する。
 */
function loadMermaidRuntime(): Promise<MermaidRuntime> {
    if (typeof globalThis.mermaid?.initialize === 'function') {
        return Promise.resolve(globalThis.mermaid);
    }
    mermaidRuntimePromise ??= new Promise<MermaidRuntime>(
        /**
         * 非同期処理の成功結果と失敗理由を待機側へ通知する。
         * @param resolve - Promiseの成功を通知する関数。
         * @param reject - Promiseの失敗を通知する関数。
         */
        (resolve, reject) => {
            const script = document.createElement('script');
            script.src = webviewAssetUrl(
                'mermaid.min.js',
                document.body.dataset.mveMermaidUri
            );
            script.async = true;
            const nonce = webviewScriptNonce();
            if (nonce) script.nonce = nonce;
            script.addEventListener('load',
                /** 読込後にglobal runtimeの初期化状態を確認する。 */
                () => {
                    if (typeof globalThis.mermaid?.initialize === 'function') {
                        resolve(globalThis.mermaid);
                        return;
                    }
                    mermaidRuntimePromise = undefined;
                    reject(new Error('Mermaid runtime did not initialize.'));
                }, { once: true });
            script.addEventListener('error',
                /** script失敗後に再試行できるよう共有Promiseを破棄する。 */
                () => {
                    mermaidRuntimePromise = undefined;
                    reject(new Error('Mermaid runtime could not be loaded.'));
                }, { once: true });
            document.head.append(script);
        });
    return mermaidRuntimePromise;
}

/**
 * inline描画の二重settleを防ぎ、未開始タスクなら待機列から外してcancel errorを通知する。
 * @param task - 中止するインライン描画タスク。
 */
function cancelInlineRender(task: InlineRenderTask): void {
    if (task.cancelled || task.settled) return;
    task.cancelled = true;
    if (!task.started) {
        const index = inlineRenderQueue.indexOf(task);
        if (index >= 0) inlineRenderQueue.splice(index, 1);
    }
    settleInlineRender(task, undefined, new MermaidRenderCancelledError());
}

/**
 * 一度だけAbort listenerを解除し、結果か失敗をinline描画Promiseへ通知する。
 * @param task - 完了処理を一度だけ実行するインライン描画タスク。
 * @param result - エラーがない場合にタスクのPromiseへ返すMermaid描画結果。
 * @param error - 処理に失敗した理由または例外。
 */
function settleInlineRender(task: InlineRenderTask, result?: MermaidRenderResult, error?: unknown): void {
    if (task.settled) return;
    task.settled = true;
    task.removeAbortListener();
    if (error !== undefined) task.reject(error);
    else if (result !== undefined) task.resolve(result);
}

/**
 * Mermaid error本文から行・列を抽出し、現在の言語の見出しを付けた診断文字列を作る。
 * Mermaidの構文・描画失敗から得た診断値。Errorならmessageから位置を抽出する。
 * @param error - Mermaid描画の例外または拒否値。Errorならmessageから位置情報を抽出する。
 * @param language - 診断見出しを選ぶ表示言語。
 * @returns ローカライズしたエラー見出しと元の例外文。
 */
export function mermaidErrorMessage(error: unknown, language: SupportedLanguage = 'ja'): string {
    // Mermaidのエラー文字列から行・列情報を抽出し、画面表示用の文面に整える。
    const message = error instanceof Error ? error.message : String(error);
    const location = /(?:line\s+(\d+))(?:[^\d]+(?:col(?:umn)?\s*)?(\d+))?/i.exec(message);
    const messages = getMessages(language);
    const prefix = location
        ? `${messages.renderer.mermaidError} (${messages.app.line(Number(location[1]))}${location[2] ? `, ${location[2]}` : ''})`
        : messages.renderer.mermaidError;
    return `${prefix}\n${message}`;
}

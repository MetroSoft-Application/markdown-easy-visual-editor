/**
 * @fileoverview WebviewからMermaid描画を要求し、SVG結果・PNGフォールバック・クリック領域をプレビューへ反映する。
 */
import { createClientId } from './id';
import { getMessages, type SupportedLanguage } from '../shared/messages';
import type { HostToWebviewMessage, MermaidInteraction } from '../shared/protocol';
import { sharedVsCodeApi } from './vscodeApi';
import { webviewAssetUrl, webviewScriptNonce } from './assets';

/**
 * Mermaidの配色プリセットを表すリテラル型。
 */
export type MermaidTheme = 'default' | 'dark' | 'neutral';

/**
 * mermaidrendererで共有するデータ形状を表すインターフェース。
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
     * mermaidrendererから必要な値またはリソースを取得する。
     * @param result - mermaidrendererへ渡す入力。
     * @returns 副作用を完了し、値は返さない。
     */
    resolve: (result: MermaidRenderResult) => void;
    /**
     * mermaidrendererのrejectを処理し、呼び出し側へ結果または副作用を返す。
     * @param error - 処理に失敗した理由または例外。
     * @returns 副作用を完了し、値は返さない。
     */
    reject: (error: unknown) => void;
    /**
     * mermaidrendererの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @returns 副作用を完了し、値は返さない。
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
 * mermaidrendererで共有するデータ形状を表すインターフェース。
 */
interface MermaidRuntime {
    /**
     * mermaidrendererのinitializeを処理し、呼び出し側へ結果または副作用を返す。
     * @param config - 処理全体に適用する設定。
     * @returns 副作用を完了し、値は返さない。
     */
    initialize(config: Record<string, unknown>): void;
    /**
     * mermaidrendererの入力を構造化した値へ変換する。
     * @param source - 解析・描画・変換の起点となる本文。
     * @returns mermaidrendererで利用する文字列。
     */
    parse(source: string): Promise<unknown>;
    /**
     * mermaidrendererを表示用の結果へ変換する。
     * @param id - mermaidrendererの対象や分岐を識別する値。
     * @param source - 解析・描画・変換の起点となる本文。
     * @returns mermaidrendererの非同期処理で得られる結果。
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
     * mermaidrendererのmermaidに関する状態または設定。
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
     * mermaidrendererから必要な値またはリソースを取得する。
     * @param result - mermaidrendererへ渡す入力。
     * @returns 副作用を完了し、値は返さない。
     */
    resolve: (result: MermaidRenderResult) => void;
    /**
     * mermaidrendererのrejectを処理し、呼び出し側へ結果または副作用を返す。
     * @param error - 処理に失敗した理由または例外。
     * @returns 副作用を完了し、値は返さない。
     */
    reject: (error: Error) => void;

    /**
     * mermaidrendererの遅延処理を管理するタイマー。
     */
    timer: number;
    /**
     * mermaidrendererの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @returns mermaidrendererの非同期処理で得られる結果。
     */
    removeAbortListener: () => void;
}>();

/**
 * mermaidrendererで失敗理由を表すError派生クラス。
 */
class MermaidRenderCancelledError extends Error {
    /**
     * mermaidrendererで使う値または実行環境を組み立てる。
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
     * mermaidrendererで使う値または実行環境を組み立てる。
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
 * mermaidrendererを表示用の結果へ変換する。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param theme - 描画や表示に適用する配色テーマ。
 * @param signal - 呼び出し側のキャンセルを通知するAbortSignal。
 * @param useHostRenderer - mermaidrendererへ渡す入力。
 * @param allowInlineFallback - mermaidrendererの位置・寸法・件数・時間を表す数値。
 * @param preferInlineIfCompact - mermaidrendererの位置・寸法・件数・時間を表す数値。
 * @returns mermaidrendererの非同期処理で得られる結果。
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
                     * renderedをrequest・host・renderへ渡し、mermaidrendererの結果または副作用を処理する。
                     * @param rendered - mermaidrendererへ渡す入力。
                     * @returns mermaidrendererのコールバックが生成する結果。
                     */
                    (rendered) => rendered.svg.length < COMPACT_PREVIEW_SVG_LIMIT
                        ? rendered
                        : requestHostRender(source, theme, signal))
                .catch(
                    /**
                     * errorをifへ渡し、mermaidrendererの結果または副作用を処理する。
                     * @param error - 処理に失敗した理由または例外。
                     * @returns 副作用を完了し、値は返さない。
                     */
                    (error) => {
                        if (error instanceof MermaidRenderCancelledError) throw error;
                        return requestHostRender(source, theme, signal);
                    });
        }
        return requestHostRender(source, theme, signal)
            .catch(
                /**
                 * errorをifへ渡し、mermaidrendererの結果または副作用を処理する。
                 * @param error - 処理に失敗した理由または例外。
                 * @returns 副作用を完了し、値は返さない。
                 */
                (error) => {
                    if (!(error instanceof MermaidHostRenderError) || !error.unavailable || !allowInlineFallback) throw error;
                    return renderMermaidInline(source, theme, signal);
                });
    }
    return renderMermaidInline(source, theme, signal);
}

/**
 * mermaidrendererのaccept・mermaid・render・resultを処理し、呼び出し側へ結果または副作用を返す。
 * @param message - HostとWebviewの間で受け渡すメッセージ。
 * @returns 副作用を完了し、値は返さない。
 */
export function acceptMermaidRenderResult(
    message: Extract<HostToWebviewMessage, {
        /**
         * mermaidrendererで対象や分岐を識別する値の型。
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
 * mermaidrendererの変更または要求をHost・Webview間へ通知する。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param theme - 描画や表示に適用する配色テーマ。
 * @param signal - 呼び出し側のキャンセルを通知するAbortSignal。
 * @returns mermaidrendererの非同期処理で得られる結果。
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
         * @returns 非同期処理の完了値。
         */
        (resolve, reject) => {
            if (signal?.aborted) {
                reject(new MermaidRenderCancelledError());
                return;
            }


            const onAbort = /**
         * mermaidrendererのイベントまたはメッセージを受け取り、状態を更新する。
         * @returns mermaidrendererのon・abortが生成する結果。
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
                 * @returns 副作用を完了し、値は返さない。
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
             * mermaidrendererから必要な値またはリソースを取得する。
             * @param svg - Mermaidが生成したSVG本文。
             * @returns mermaidrendererの非同期処理で得られる結果。
             */ (svg) => {
                        if (signal?.aborted) reject(new MermaidRenderCancelledError());
                        else resolve(svg);
                    },
                reject,


                removeAbortListener: /**
             * mermaidrendererの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
             * @returns mermaidrendererの非同期処理で得られる結果。
             */ () => signal?.removeEventListener('abort', onAbort)
            });
            signal?.addEventListener('abort', onAbort, { once: true });
            sharedVsCodeApi.postMessage({ type: 'renderMermaid', requestId, source, theme });
        });
}

/**
 * mermaidrendererを表示用の結果へ変換する。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param theme - 描画や表示に適用する配色テーマ。
 * @param signal - 呼び出し側のキャンセルを通知するAbortSignal。
 * @returns mermaidrendererの非同期処理で得られる結果。
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
         * 非同期処理のcancel・inline・render通知を待機側へ渡す。
         * @param resolve - Promiseの成功を通知する関数。
         * @param reject - Promiseの失敗を通知する関数。
         * @returns 非同期処理の完了値。
         */
        (resolve, reject) => {


            const onAbort = /**
         * mermaidrendererのイベントまたはメッセージを受け取り、状態を更新する。
         * @returns 副作用を完了し、値は返さない。
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
             * @returns 副作用を完了し、値は返さない。
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
 * @returns 副作用を完了し、値は返さない。
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
 * mermaidrendererから必要な値またはリソースを取得する。
 * @returns mermaidrendererの非同期処理で得られる結果。
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
         * @returns 非同期処理の完了値。
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
                /**
                 * イベントでifを実行する。
                 * @returns 副作用を完了し、値は返さない。
                 */
                () => {
                    if (typeof globalThis.mermaid?.initialize === 'function') {
                        resolve(globalThis.mermaid);
                        return;
                    }
                    mermaidRuntimePromise = undefined;
                    reject(new Error('Mermaid runtime did not initialize.'));
                }, { once: true });
            script.addEventListener('error',
                /**
                 * イベントで失敗通知を実行する。
                 * @returns 副作用を完了し、値は返さない。
                 */
                () => {
                    mermaidRuntimePromise = undefined;
                    reject(new Error('Mermaid runtime could not be loaded.'));
                }, { once: true });
            document.head.append(script);
        });
    return mermaidRuntimePromise;
}

/**
 * mermaidrendererの条件を判定する。
 * @param task - mermaidrendererへ渡す入力。
 * @returns 条件が成立したかを示す真偽値。
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
 * mermaidrendererの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param task - mermaidrendererへ渡す入力。
 * @param result - mermaidrendererへ渡す入力。
 * @param error - 処理に失敗した理由または例外。
 * @returns 副作用を完了し、値は返さない。
 */
function settleInlineRender(task: InlineRenderTask, result?: MermaidRenderResult, error?: unknown): void {
    if (task.settled) return;
    task.settled = true;
    task.removeAbortListener();
    if (error !== undefined) task.reject(error);
    else if (result !== undefined) task.resolve(result);
}

/**
 * mermaidrendererのmermaid・error・messageを処理し、呼び出し側へ結果または副作用を返す。
 * @param error - 処理に失敗した理由または例外。
 * @param language - mermaidrendererの対象や分岐を識別する値。
 * @returns mermaidrendererで利用する文字列。
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

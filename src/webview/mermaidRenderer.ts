/**
 * @file mermaidRenderer.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { createClientId } from './id';
import { getMessages, type SupportedLanguage } from '../shared/messages';
import type { HostToWebviewMessage, MermaidInteraction } from '../shared/protocol';
import { sharedVsCodeApi } from './vscodeApi';
import { webviewAssetUrl, webviewScriptNonce } from './assets';

/**
 * 「MermaidTheme」として扱う値の型を定義します。
 */
export type MermaidTheme = 'default' | 'dark' | 'neutral';

/**
 * 「InlineRenderTask」が満たすデータ契約を定義します。
 */
interface InlineRenderTask {

    /**
     * 「source」は、読み込みまたは出力対象を示すパス・URL・内容を保持します。
     */
    source: string;

    /**
     * 「theme」は、表示テーマまたはスタイル設定を保持します。
     */
    theme: MermaidTheme;

    /**
     * 「signal」は、関連処理が共有する構造化データの一項目です。
     */
    signal?: AbortSignal;

    /**
     * 「started」は、処理条件または状態を表す真偽値です。
     */
    started: boolean;

    /**
     * 「settled」は、処理条件または状態を表す真偽値です。
     */
    settled: boolean;

    /**
     * 「cancelled」は、処理条件または状態を表す真偽値です。
     */
    cancelled: boolean;
    /**
     * 「resolve」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
     * @param result 処理対象の結果です。
     * @returns 「resolve」の副作用または状態更新を実行し、値は返しません。
     */
    resolve: (result: MermaidRenderResult) => void;
    /**
     * 「reject」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
     * @param error 発生したエラーです。
     * @returns 「reject」の副作用または状態更新を実行し、値は返しません。
     */
    reject: (error: unknown) => void;
    /**
     * 「removeAbortListener」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
     * @returns イベントを処理し、状態更新または副作用だけを実行して値は返しません。
     */
    removeAbortListener: () => void;
}
/** 「inlineRenderQueue」は、関連する処理間で共有する設定値または状態です。 */
/** Webview内で順番に処理するMermaid描画要求。描画中の競合を避けるためFIFOで保持する。 */
const inlineRenderQueue: InlineRenderTask[] = [];
/** 「activeInlineRender」は、関連する処理間で共有する設定値または状態です。 */
/** 現在Webview内で実行しているMermaid描画要求。 */
let activeInlineRender: InlineRenderTask | undefined;
/**
 * 「MermaidRuntime」が満たすデータ契約を定義します。
 */
interface MermaidRuntime {
    /**
     * 「initialize」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
     * @param config 保存済み設定または処理経路を選択するオプションです。未設定時の既定値や正規化対象を含みます。
     * @returns 「initialize」の副作用または状態更新を実行し、値は返しません。
     */
    initialize(config: Record<string, unknown>): void;
    /**
     * 「parse」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
     * @param source 処理対象のソースです。
     * @returns 非同期処理の完了を表すPromiseです。
     */
    parse(source: string): Promise<unknown>;
    /**
     * 「render」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
     * @param id 「id」は、「render」がMermaid描画の処理対象を特定する入力です。
     * @param source 処理対象のソースです。
     * @returns 非同期処理の完了を表すPromiseです。
     */
    render(id: string, source: string): Promise<{
    /**
     * 「svg」は、対象の内容または識別子を表す文字列です。
     */
    svg: string }>;
}
/**
 * Mermaidの遅延ロード結果をWebviewの各描画要求から参照するグローバル宣言です。
 */
declare global {
    /** 遅延ロード済みMermaidランタイム、または未初期化状態を表します。 */
    var mermaid: MermaidRuntime | undefined;
}
/** 「mermaidRuntimePromise」は、非同期初期化または処理の重複を防ぐ共有Promiseです。 */
/** Mermaidランタイムの遅延ロードを共有するPromise。複数プレビューからの重複ロードを防ぐ。 */
let mermaidRuntimePromise: Promise<MermaidRuntime> | undefined;
/** 「HOST_RENDER_TIMEOUT_MS」は、時間制限または遅延量を処理間で共有する値です。 */
/** Extension Hostへ依頼したMermaid描画を待機する上限時間。 */
const HOST_RENDER_TIMEOUT_MS = 35_000;
/** 「COMPACT_PREVIEW_SVG_LIMIT」は、入力・表示・資源の上限または下限を表す値です。 */
/** DOMへ直接配置しても過度に大きくならないSVGの目安。超過時は別表示経路へ切り替える。 */
const COMPACT_PREVIEW_SVG_LIMIT = 80_000;
/**
 * 「MermaidRenderResult」が満たすデータ契約を定義します。
 */
export interface MermaidRenderResult {

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

    /**
     * 「external」は、処理条件または状態を表す真偽値です。
     */
    external: boolean;
}
/** 「hostRequests」は、DOMまたは実行環境を保持する共有参照です。 */
/** Hostへ依頼中のMermaid描画をrequestIdで追跡し、応答・キャンセルを対応付ける表。 */
const hostRequests = new Map<string, {
    /**
     * 「resolve」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
     * @param result 処理対象の結果です。
     * @returns 「resolve」の副作用または状態更新を実行し、値は返しません。
     */
    resolve: (result: MermaidRenderResult) => void;
    /**
     * 「reject」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
     * @param error 発生したエラーです。
     * @returns 「reject」の副作用または状態更新を実行し、値は返しません。
     */
    reject: (error: Error) => void;

    /**
     * 「timer」は、位置・サイズ・件数などを表す数値です。
     */
    timer: number;
    /**
     * 「removeAbortListener」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
     * @returns イベントを処理し、状態更新または副作用だけを実行して値は返しません。
     */
    removeAbortListener: () => void;
}>();

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
 * 「MermaidHostRenderError」クラスの状態とライフサイクルを定義します。
 */
export class MermaidHostRenderError extends Error {
    /**
     * 処理に必要な状態を初期化します。
     * @param message 処理対象のメッセージです。
     * @param unavailable 「unavailable」は、「constructor」がMermaid描画の処理対象を特定する入力です。
     * @returns 「constructor」がMermaid描画の入力を処理して得た固有の結果を返します。
     */
    constructor(message: string, readonly unavailable: boolean) {
        super(message);
        this.name = 'MermaidHostRenderError';
    }
}

/**
 * Mermaidソースを指定テーマでSVGへ変換し、共有設定を壊さないよう直列実行する。
 * @param source Mermaid記法のソース。
 * @param theme Mermaidへ適用するテーマ。
 * @param signal 処理対象のシグナルです。
 * @param useHostRenderer 「useHostRenderer」は、「renderMermaidSvg」がMermaid描画の処理対象を特定する入力です。
 * @param allowInlineFallback 「allowInlineFallback」は、「renderMermaidSvg」がMermaid描画の処理対象を特定する入力です。
 * @param preferInlineIfCompact 「preferInlineIfCompact」は、「renderMermaidSvg」がMermaid描画の処理対象を特定する入力です。
 * @returns 生成されたSVG文字列を解決するPromise。
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
 * 非同期処理の完了値を受け取り、次の処理へ渡す結果を生成するコールバックです。
                 * @param rendered renderedとして渡される、このコールバックの入力値です。
                 * @returns 解決値を処理した結果を返します。
                 */
                (rendered) => rendered.svg.length < COMPACT_PREVIEW_SVG_LIMIT
                    ? rendered
                    : requestHostRender(source, theme, signal))
                .catch(
                /**
 * 非同期処理の完了値を受け取り、次の処理へ渡す結果を生成するコールバックです。
                 * @param error 発生したエラーです。
                 * @returns 解決値を処理した結果を返します。
                 */
                (error) => {
                    if (error instanceof MermaidRenderCancelledError) throw error;
                    return requestHostRender(source, theme, signal);
                });
        }
        return requestHostRender(source, theme, signal)
            .catch(
            /**
 * 非同期処理の失敗理由を受け取り、回復処理または代替値を生成するコールバックです。
             * @param error 発生したエラーです。
             * @returns エラー処理またはフォールバックの結果を返します。
             */
            (error) => {
                if (!(error instanceof MermaidHostRenderError) || !error.unavailable || !allowInlineFallback) throw error;
                return renderMermaidInline(source, theme, signal);
            });
    }
    return renderMermaidInline(source, theme, signal);
}

/**
 * ホストから返ったMermaid描画結果を、対応する要求へ配送する。
 * @param message 処理対象のメッセージです。
 * @returns 「acceptMermaidRenderResult」の副作用または状態更新を実行し、値は返しません。
 */
export function acceptMermaidRenderResult(
    message: Extract<HostToWebviewMessage, {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'mermaidRendered' }>
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
 * 「requestHostRender」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param source 処理対象のソースです。
 * @param theme 処理対象のテーマです。
 * @param signal 処理対象のシグナルです。
 * @returns 非同期処理の完了を表すPromiseです。
 */
function requestHostRender(
    source: string,
    theme: MermaidTheme,
    signal?: AbortSignal
): Promise<MermaidRenderResult> {
    const requestId = createClientId();
    return new Promise<MermaidRenderResult>(
    /**
 * 「resolve」「reject」を受け取り、処理結果を生成する処理です。
     * @param resolve Promiseの完了または失敗を通知する関数です。
     * @param reject Promiseの完了または失敗を通知する関数です。
     * @returns 「if」を実行し、値を返しません。
     */
    (resolve, reject) => {
        if (signal?.aborted) {
            reject(new MermaidRenderCancelledError());
            return;
        }

        /**
         * 「onAbort」は、イベント入力を受け取り、関連する状態またはUIを更新する処理です。
         * @returns 「hostRequests.get」を実行し、値を返しません。
         */
        const onAbort = /**
 * 「onAbort」は、イベント入力を検証し、関連する状態またはUIを更新します。
 * @returns 「hostRequests.get」を実行し、値を返しません。
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
 * 指定時間の経過後に遅延処理を実行するコールバックです。
         * @returns 「hostRequests.delete」を実行し、値を返しません。
         */
        () => {
            hostRequests.delete(requestId);
            signal?.removeEventListener('abort', onAbort);
            sharedVsCodeApi.postMessage({ type: 'cancelMermaidRender', requestId });
            reject(new MermaidHostRenderError('Mermaid host rendering timed out.', true));
        }, HOST_RENDER_TIMEOUT_MS);
        hostRequests.set(requestId, {
            timer,

            /**
             * resolveを取得または解決します。
             * @param svg 「svg」は、「resolve」がMermaid描画の処理対象を特定する入力です。
             * @returns 「resolve」がMermaid描画の入力を処理して得た固有の結果を返します。
             */
            resolve: /**
 * 「resolve」は、非同期処理の完了状態を通知します。
 * @param svg 「svg」は、「resolve」がMermaidで処理する対象を特定する入力です。
 * @returns 非同期処理の完了または失敗を通知します。
 */ (svg) => {
                if (signal?.aborted) reject(new MermaidRenderCancelledError());
                else resolve(svg);
            },
            reject,

            /**
             * remove・abort・listenerを解除または削除します。
             * @returns 「removeAbortListener」がMermaid描画の入力を処理して得た固有の結果を返します。
             */
            removeAbortListener: /**
 * 「removeAbortListener」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @returns 「removeAbortListener」がMermaid描画の入力を処理して得た固有の結果を返します。
 */ () => signal?.removeEventListener('abort', onAbort)
        });
        signal?.addEventListener('abort', onAbort, { once: true });
        sharedVsCodeApi.postMessage({ type: 'renderMermaid', requestId, source, theme });
    });
}

/**
 * render・mermaid・inlineを描画します。
 * @param source 処理対象のソースです。
 * @param theme 処理対象のテーマです。
 * @param signal 処理対象のシグナルです。
 * @returns 非同期処理の完了を表すPromiseです。
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
 * 「resolve」「reject」を受け取り、登録された副作用または結果を生成する処理です。
     * @param resolve Promiseの完了または失敗を通知する関数です。
     * @param reject Promiseの完了または失敗を通知する関数です。
     * @returns 「cancelInlineRender」を実行し、値を返しません。
     */
    (resolve, reject) => {

        /**
         * 「onAbort」は、イベント入力を受け取り、関連する状態またはUIを更新する処理です。
         * @returns 「cancelInlineRender」を実行し、値を返しません。
         */
        const onAbort = /**
 * 「onAbort」は、イベント入力を検証し、関連する状態またはUIを更新します。
 * @returns 「cancelInlineRender」を実行し、値を返しません。
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

            /**
             * remove・abort・listenerを解除または削除します。
             * @returns 「removeAbortListener」がMermaid描画の入力を処理して得た固有の結果を返します。
             */
            removeAbortListener: /**
 * 「removeAbortListener」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @returns 「removeAbortListener」がMermaid描画の入力を処理して得た固有の結果を返します。
 */ () => signal?.removeEventListener('abort', onAbort)
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
    inlineRenderQueue.push(task);
    void drainInlineRenderQueue();
    return result;
}

/**
 * 「drainInlineRenderQueue」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @returns 非同期処理の完了を表すPromiseです。
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
 * Host 描画が利用できない場合だけ、Webview 内 Mermaid を別ファイルから読む。
 * @returns 非同期処理の完了を表すPromiseです。
 */
function loadMermaidRuntime(): Promise<MermaidRuntime> {
    if (typeof globalThis.mermaid?.initialize === 'function') {
        return Promise.resolve(globalThis.mermaid);
    }
    mermaidRuntimePromise ??= new Promise<MermaidRuntime>(
    /**
 * 非同期処理の失敗理由を受け取り、回復処理または代替値を生成するコールバックです。
     * @param resolve Promiseの完了または失敗を通知する関数です。
     * @param reject Promiseの完了または失敗を通知する関数です。
     * @returns 「document.createElement」を実行し、値を返しません。
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
         * イベント情報を受け取り、DOMまたは画面状態を更新するコールバックです。
         * @returns 非同期処理へ渡す完了結果を返します。
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
         * イベント情報を受け取り、DOMまたは画面状態を更新するコールバックです。
         * @returns 「reject」の呼び出し結果を返します。
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
 * cancel・inline・renderを解除または削除します。
 * @param task 処理対象のタスクです。
 * @returns 購読解除、タイマー解除、またはリソース破棄を実行して値は返しません。
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
 * 「settleInlineRender」は、入力を検証して対象の状態または内容へ適用します。
 * @param task 処理対象のタスクです。
 * @param result 処理対象の結果です。
 * @param error 発生したエラーです。
 * @returns 「settleInlineRender」の副作用または状態更新を実行し、値は返しません。
 */
function settleInlineRender(task: InlineRenderTask, result?: MermaidRenderResult, error?: unknown): void {
    if (task.settled) return;
    task.settled = true;
    task.removeAbortListener();
    if (error !== undefined) task.reject(error);
    else if (result !== undefined) task.resolve(result);
}

/**
 * Mermaidの例外を行・列情報付きの画面表示用エラーメッセージへ変換する。
 * @param error Mermaidから受け取った例外または任意のエラー値。
 * @param language 表示文言の解決に使用する言語コードまたはロケールです。
 * @returns 画面表示用に整形したエラーメッセージ。
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

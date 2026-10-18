/**
 * @fileoverview PeleのHost描画要求を送り、返されたSVG・PNG・リンク領域をプレビューへ渡す。
 */
import { createClientId } from '../runtime/id';
import { getMessages, type SupportedLanguage } from '../../shared/messages';
import type { HostToWebviewMessage, MermaidInteraction } from '../../shared/protocol';
import { sharedVsCodeApi } from '../runtime/vscodeApi';

/** Peleの配色プリセット。 */
export type MermaidTheme = 'default' | 'dark' | 'neutral';

/** Mermaid Host描画結果としてWebviewへ渡すデータ。 */
export interface MermaidRenderResult {
    svg: string;
    pngBase64?: string;
    interactions: MermaidInteraction[];
    ariaLabel: string;
    external: boolean;
}

/** Host側描画の失敗と利用不能状態を区別するエラー。 */
export class MermaidHostRenderError extends Error {
    constructor(message: string, readonly unavailable: boolean) {
        super(message);
        this.name = 'MermaidHostRenderError';
    }
}

const HOST_RENDER_IDLE_TIMEOUT_MS = 180_000;
type MermaidRenderedMessage = Extract<HostToWebviewMessage, { type: 'mermaidRendered' }>;
type MermaidRenderProgressMessage = Extract<HostToWebviewMessage, { type: 'mermaidRenderProgress' }>;
const hostRequests = new Map<string, {
    resolve: (result: MermaidRenderResult) => void;
    reject: (error: Error) => void;
    timer: number;
    onTimeout: () => void;
    removeAbortListener: () => void;
}>();

/**
 * Mermaid図を必ずExtension HostのPele Workerで描画する。
 * @param source - Mermaid図ソース。
 * @param theme - 描画配色。
 * @param signal - 呼び出し側からのキャンセル通知。
 * @returns SVG、必要時のPNG、リンク操作領域。
 */
export function renderMermaidSvg(
    source: string,
    theme: MermaidTheme,
    signal?: AbortSignal
): Promise<MermaidRenderResult> {
    return requestHostRender(source, theme, signal);
}

/**
 * 対応するHost描画要求のPromiseを結果またはエラーで完了させる。
 * @param message - Hostから返されたMermaid描画結果。
 */
export function acceptMermaidRenderResult(
    message: MermaidRenderedMessage
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
            message.error ?? 'Pele rendering failed.',
            message.rendererUnavailable === true
        ));
    }
}

/**
 * Hostの進捗通知で、描画要求の無応答監視を更新する。
 * @param message - Hostが処理を継続中であることを示す通知。
 */
export function acceptMermaidRenderProgress(
    message: MermaidRenderProgressMessage
): void {
    const pending = hostRequests.get(message.requestId);
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pending.timer = window.setTimeout(pending.onTimeout, HOST_RENDER_IDLE_TIMEOUT_MS);
}

/**
 * HostへPele描画要求を送り、SVGまたはPNGを受け取る。
 * @param source - Mermaid図ソース。
 * @param theme - 描画配色。
 * @param signal - 呼び出し側からのキャンセル通知。
 * @returns Hostが返す描画結果。
 */
function requestHostRender(
    source: string,
    theme: MermaidTheme,
    signal?: AbortSignal
): Promise<MermaidRenderResult> {
    const requestId = createClientId();
    return new Promise<MermaidRenderResult>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error('Mermaid rendering was cancelled.'));
            return;
        }
        const onAbort = () => {
            const pending = hostRequests.get(requestId);
            if (!pending) return;
            hostRequests.delete(requestId);
            window.clearTimeout(pending.timer);
            pending.removeAbortListener();
            sharedVsCodeApi.postMessage({ type: 'cancelMermaidRender', requestId });
            reject(new Error('Mermaid rendering was cancelled.'));
        };
        const onTimeout = () => {
            const pending = hostRequests.get(requestId);
            if (!pending) return;
            hostRequests.delete(requestId);
            pending.removeAbortListener();
            sharedVsCodeApi.postMessage({ type: 'cancelMermaidRender', requestId });
            reject(new MermaidHostRenderError('Pele rendering timed out.', true));
        };
        hostRequests.set(requestId, {
            timer: window.setTimeout(onTimeout, HOST_RENDER_IDLE_TIMEOUT_MS),
            onTimeout,
            resolve: (result) => signal?.aborted
                ? reject(new Error('Mermaid rendering was cancelled.'))
                : resolve(result),
            reject,
            removeAbortListener: () => signal?.removeEventListener('abort', onAbort)
        });
        signal?.addEventListener('abort', onAbort, { once: true });
        sharedVsCodeApi.postMessage({ type: 'renderMermaid', requestId, source, theme });
    });
}

/**
 * Peleエラーの行番号を既存のMermaidローカライズ見出しへ合わせる。
 * @param error - Pele描画で発生したエラー。
 * @param language - エラーメッセージの表示言語。
 * @returns 行番号を含むローカライズ済み描画エラー。
 */
export function mermaidErrorMessage(error: unknown, language: SupportedLanguage = 'ja'): string {
    const message = error instanceof Error ? error.message : String(error);
    const location = /(?:line\s+(\d+))(?:[^\d]+(?:col(?:umn)?\s*)?(\d+))?/i.exec(message);
    const messages = getMessages(language);
    const prefix = location
        ? `${messages.renderer.mermaidError} (${messages.app.line(Number(location[1]))}${location[2] ? `, ${location[2]}` : ''})`
        : messages.renderer.mermaidError;
    return `${prefix}\n${message}`;
}

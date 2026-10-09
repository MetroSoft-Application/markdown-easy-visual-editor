/**
 * @fileoverview プレビュー画像のドラッグリサイズを処理し、表示倍率を除いた論理幅をMarkdownへ保存する。
 */
import type { HostToWebviewMessage } from '../../shared/protocol';
import { sharedVsCodeApi } from '../runtime/vscodeApi';

/**
 * 画像リサイズ操作の条件を示すフラグ。
 */
let visible = true;
/**
 * 画像リサイズ操作で扱う一覧または対応表。
 */
const listeners = new Set<(value: boolean) => void>();

/**
 * プレビュー画像のリサイズ操作を表示する設定値を返す。
 * @returns 条件が成立したかを示す真偽値。
 */
export function getPreviewImageResizeControlsVisible(): boolean {
    return visible;
}

/**
 * 画像プレビュー上にリサイズ操作を表示するか設定する。
 * @param next リサイズ操作を表示する場合はtrue。
 */
export function setPreviewImageResizeControlsVisible(next: boolean): void {
    applyPreviewImageResizeControlsVisibility(next);
    sharedVsCodeApi.postMessage({ type: 'setPreviewImageResizeControlsVisible', visible: next });
}

/**
 * 画像リサイズ操作の表示状態を購読し、購読解除関数を返す。
 * @param listener 現在と以後の表示状態を受け取るコールバック。
 * @returns 表示状態の購読を解除する関数。
 */
export function subscribePreviewImageResizeControlsVisible(listener: (value: boolean) => void): () => void {
    listeners.add(listener);
    listener(visible);
    /**
     * この表示状態リスナーを購読対象から外す。
     */
    return () => listeners.delete(listener);
}

/**
 * Hostから届く表示設定を監視し、プレビュー画像のリサイズ操作へ反映する。
 */
export function installPreviewImageResizeControls(): void {
    window.addEventListener('message', handleHostSettings);
    applyPreviewImageResizeControlsVisibility(true);
}

/**
 * Extension Hostから画像リサイズ操作の表示設定を受信して適用する。
 * @param event windowへ送られたHostメッセージを含むMessageEvent。
 */
function handleHostSettings(event: MessageEvent): void {
    const message = event.data as HostToWebviewMessage | undefined;
    if (!message || (message.type !== 'init' && message.type !== 'settingsChanged')) return;
    applyPreviewImageResizeControlsVisibility(message.settings.previewImageResizeControlsVisible !== false);
}

/**
 * 画像リサイズ操作の表示状態をDOMへ反映し、状態が変わった場合は購読者へ通知する。
 * @param next リサイズ操作を表示する場合はtrue。
 */
function applyPreviewImageResizeControlsVisibility(next: boolean): void {
    const changed = visible !== next;
    visible = next;
    document.documentElement.dataset.mveImageResizeControls = next ? 'visible' : 'hidden';
    if (changed) {
        for (const listener of listeners) listener(next);
    }
}

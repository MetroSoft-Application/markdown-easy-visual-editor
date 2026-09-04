import type { HostToWebviewMessage } from '../shared/protocol';
import { sharedVsCodeApi } from './vscodeApi';

let visible = true;
const listeners = new Set<(value: boolean) => void>();

/** Extension Hostから最後に受信した画像リサイズ操作UIの表示状態を返す。 */
export function getPreviewImageResizeControlsVisible(): boolean {
    return visible;
}

/**
 * 画像リサイズ操作UIのグローバル設定変更をExtension Hostへ要求する。
 * 反応を待たず現在パネルへも即時反映し、HostからのsettingsChangedで全パネルを確定同期する。
 */
export function setPreviewImageResizeControlsVisible(next: boolean): void {
    applyPreviewImageResizeControlsVisibility(next);
    sharedVsCodeApi.postMessage({ type: 'setPreviewImageResizeControlsVisible', visible: next });
}

/** 表示状態変更を購読する。Ribbonは別Markdownからの設定変更もここで追従する。 */
export function subscribePreviewImageResizeControlsVisible(listener: (value: boolean) => void): () => void {
    listeners.add(listener);
    listener(visible);
    return () => listeners.delete(listener);
}

/** Webview起動時にHost設定通知を監視し、すべてのMarkdownパネルで同じ表示状態へ同期する。 */
export function installPreviewImageResizeControls(): void {
    window.addEventListener('message', handleHostSettings);
    applyPreviewImageResizeControlsVisibility(true);
}

function handleHostSettings(event: MessageEvent): void {
    const message = event.data as HostToWebviewMessage | undefined;
    if (!message || (message.type !== 'init' && message.type !== 'settingsChanged')) return;
    applyPreviewImageResizeControlsVisibility(message.settings.previewImageResizeControlsVisible !== false);
}

function applyPreviewImageResizeControlsVisibility(next: boolean): void {
    const changed = visible !== next;
    visible = next;
    document.documentElement.dataset.mveImageResizeControls = next ? 'visible' : 'hidden';
    if (changed) {
        for (const listener of listeners) listener(next);
    }
}

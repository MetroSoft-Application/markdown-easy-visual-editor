/**
 * @fileoverview プレビュー画像のドラッグリサイズを処理し、表示倍率を除いた論理幅をMarkdownへ保存する。
 */
import type { HostToWebviewMessage } from '../shared/protocol';
import { sharedVsCodeApi } from './vscodeApi';

/**
 * 画像リサイズ操作の条件を示すフラグ。
 */
let visible = true;
/**
 * 画像リサイズ操作で扱う一覧または対応表。
 */
const listeners = new Set<(value: boolean) => void>();

/**
 * 画像リサイズ操作から必要な値またはリソースを取得する。
 * @returns 条件が成立したかを示す真偽値。
 */
export function getPreviewImageResizeControlsVisible(): boolean {
    return visible;
}

/**
 * 画像リサイズ操作の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param next - 画像リサイズ操作の位置・寸法・件数・時間を表す数値。
 * @returns 副作用を完了し、値は返さない。
 */
export function setPreviewImageResizeControlsVisible(next: boolean): void {
    applyPreviewImageResizeControlsVisibility(next);
    sharedVsCodeApi.postMessage({ type: 'setPreviewImageResizeControlsVisible', visible: next });
}

/**
 * 画像リサイズ操作のsubscribe・preview・image・resize・controls・visibleを処理し、呼び出し側へ結果または副作用を返す。
 * @param listener - 画像リサイズ操作の条件を示すフラグ。
 * @returns 画像リサイズ操作のsubscribe・preview・image・resize・controls・visibleが生成する結果。
 */
export function subscribePreviewImageResizeControlsVisible(listener: (value: boolean) => void): () => void {
    listeners.add(listener);
    listener(visible);
    /**
     * 画像リサイズ操作のreturnを処理し、呼び出し側へ結果または副作用を返す。
     * @returns 副作用を完了し、値は返さない。
     */
    return () => listeners.delete(listener);
}

/**
 * 画像リサイズ操作のinstall・preview・image・resize・controlsを処理し、呼び出し側へ結果または副作用を返す。
 * @returns 副作用を完了し、値は返さない。
 */
export function installPreviewImageResizeControls(): void {
    window.addEventListener('message', handleHostSettings);
    applyPreviewImageResizeControlsVisibility(true);
}

/**
 * 画像リサイズ操作のイベントまたはメッセージを受け取り、状態を更新する。
 * @param event - ユーザー操作またはDOMから通知されたイベント。
 * @returns 副作用を完了し、値は返さない。
 */
function handleHostSettings(event: MessageEvent): void {
    const message = event.data as HostToWebviewMessage | undefined;
    if (!message || (message.type !== 'init' && message.type !== 'settingsChanged')) return;
    applyPreviewImageResizeControlsVisibility(message.settings.previewImageResizeControlsVisible !== false);
}

/**
 * 画像リサイズ操作の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param next - 画像リサイズ操作の位置・寸法・件数・時間を表す数値。
 * @returns 副作用を完了し、値は返さない。
 */
function applyPreviewImageResizeControlsVisibility(next: boolean): void {
    const changed = visible !== next;
    visible = next;
    document.documentElement.dataset.mveImageResizeControls = next ? 'visible' : 'hidden';
    if (changed) {
        for (const listener of listeners) listener(next);
    }
}

/**
 * @file previewImageResizeControls.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import type { HostToWebviewMessage } from '../shared/protocol';
import { sharedVsCodeApi } from './vscodeApi';

/** 「visible」は、関連する処理間で共有する設定値または状態です。 */
let visible = true;
/**
 * 「listeners」は、関連する処理間で共有する設定値または状態を保持します。
 */
const listeners = new Set<(value: boolean) => void>();

/**
 * Extension Hostから最後に受信した画像リサイズ操作UIの表示状態を返す。
 * @returns 判定結果です。
 */
export function getPreviewImageResizeControlsVisible(): boolean {
    return visible;
}

/**
 * 画像リサイズ操作UIのグローバル設定変更をExtension Hostへ要求する。
 * 反応を待たず現在パネルへも即時反映し、HostからのsettingsChangedで全パネルを確定同期する。
 * @param next 「next」は、「setPreviewImageResizeControlsVisible」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「setPreviewImageResizeControlsVisible」の副作用または状態更新を実行し、値は返しません。
 */
export function setPreviewImageResizeControlsVisible(next: boolean): void {
    applyPreviewImageResizeControlsVisibility(next);
    sharedVsCodeApi.postMessage({ type: 'setPreviewImageResizeControlsVisible', visible: next });
}

/**
 * 表示状態変更を購読する。Ribbonは別Markdownからの設定変更もここで追従する。
 * @param listener 指定したタイミングで実行するコールバック関数です。
 * @returns 「subscribePreviewImageResizeControlsVisible」の副作用または状態更新を実行し、値は返しません。
 */
export function subscribePreviewImageResizeControlsVisible(listener: (value: boolean) => void): () => void {
    listeners.add(listener);
    listener(visible);
    return /** 登録した画像リサイズ監視を解除します。 @returns リスナーを削除できたかどうかを返します。 */ () => listeners.delete(listener);
}

/**
 * Webview起動時にHost設定通知を監視し、すべてのMarkdownパネルで同じ表示状態へ同期する。
 * @returns 「installPreviewImageResizeControls」の副作用または状態更新を実行し、値は返しません。
 */
export function installPreviewImageResizeControls(): void {
    window.addEventListener('message', handleHostSettings);
    applyPreviewImageResizeControlsVisibility(true);
}

/**
 * 設定を処理します。
 * @param event 処理対象のイベントです。
 * @returns イベントを処理し、状態更新または副作用だけを実行して値は返しません。
 */
function handleHostSettings(event: MessageEvent): void {
    const message = event.data as HostToWebviewMessage | undefined;
    if (!message || (message.type !== 'init' && message.type !== 'settingsChanged')) return;
    applyPreviewImageResizeControlsVisibility(message.settings.previewImageResizeControlsVisible !== false);
}

/**
 * apply・preview・image・resize・controls・visibilityを処理します。
 * @param next 「next」は、「applyPreviewImageResizeControlsVisibility」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「applyPreviewImageResizeControlsVisibility」の副作用または状態更新を実行し、値は返しません。
 */
function applyPreviewImageResizeControlsVisibility(next: boolean): void {
    const changed = visible !== next;
    visible = next;
    document.documentElement.dataset.mveImageResizeControls = next ? 'visible' : 'hidden';
    if (changed) {
        for (const listener of listeners) listener(next);
    }
}

import { sharedVsCodeApi } from './vscodeApi';

const STATE_KEY = 'previewImageResizeControlsVisible';

type PreviewPreferenceState = Record<string, unknown> & {
  previewImageResizeControlsVisible?: boolean;
};

/** 保存済み状態から画像リサイズ操作UIの表示フラグを読む。未設定時は従来互換で表示する。 */
export function getPreviewImageResizeControlsVisible(): boolean {
  const state = sharedVsCodeApi.getState() as PreviewPreferenceState | undefined;
  return state?.previewImageResizeControlsVisible !== false;
}

/** 画像リサイズ操作UIの表示フラグを保存し、現在のプレビューへ即時反映する。 */
export function setPreviewImageResizeControlsVisible(visible: boolean): void {
  const current = sharedVsCodeApi.getState();
  const state = current !== null && typeof current === 'object' && !Array.isArray(current)
    ? current as Record<string, unknown>
    : {};
  sharedVsCodeApi.setState({ ...state, [STATE_KEY]: visible });
  applyPreviewImageResizeControlsVisibility(visible);
}

/** Webview起動時に保存済みの表示フラグをDOMへ反映する。 */
export function installPreviewImageResizeControls(): void {
  applyPreviewImageResizeControlsVisibility(getPreviewImageResizeControlsVisible());
}

function applyPreviewImageResizeControlsVisibility(visible: boolean): void {
  document.documentElement.dataset.mveImageResizeControls = visible ? 'visible' : 'hidden';
}

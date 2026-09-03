import type { VsCodeApi } from '../shared/protocol';

declare const acquireVsCodeApi: <State = unknown>() => VsCodeApi<State>;

const PRESERVED_STATE_KEYS = ['previewImageResizeControlsVisible'] as const;
type StateRecord = Record<string, unknown>;

/** オブジェクト形式のWebview状態だけを安全にRecordとして扱う。 */
function asStateRecord(value: unknown): StateRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as StateRecord
    : undefined;
}

/**
 * Webview APIを1回だけ取得し、既存Appと追加コントローラーから共有できるようにする。
 * VS CodeのacquireVsCodeApiは複数回呼べないため、以後の取得要求には同じインスタンスを返す。
 * 表示専用の追加設定はAppのレイアウト保存で欠落しても直前値を維持する。
 */
const nativeAcquireVsCodeApi = acquireVsCodeApi;
const nativeVsCodeApi = nativeAcquireVsCodeApi<unknown>();
export const sharedVsCodeApi: VsCodeApi<unknown> = {
  postMessage: (message) => nativeVsCodeApi.postMessage(message),
  getState: () => nativeVsCodeApi.getState(),
  setState: (newState) => {
    const current = asStateRecord(nativeVsCodeApi.getState());
    const next = asStateRecord(newState);
    if (!current || !next) {
      nativeVsCodeApi.setState(newState);
      return;
    }
    const merged: StateRecord = { ...next };
    for (const key of PRESERVED_STATE_KEYS) {
      if (!(key in merged) && key in current) merged[key] = current[key];
    }
    nativeVsCodeApi.setState(merged);
  }
};

(globalThis as typeof globalThis & {
  acquireVsCodeApi: <State = unknown>() => VsCodeApi<State>;
}).acquireVsCodeApi = <State = unknown>() => sharedVsCodeApi as VsCodeApi<State>;

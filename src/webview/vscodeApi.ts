import type { VsCodeApi } from '../shared/protocol';

declare const acquireVsCodeApi: <State = unknown>() => VsCodeApi<State>;

/**
 * Webview APIを1回だけ取得し、既存Appと追加コントローラーから共有できるようにする。
 * VS CodeのacquireVsCodeApiは複数回呼べないため、以後の取得要求には同じインスタンスを返す。
 */
const nativeAcquireVsCodeApi = acquireVsCodeApi;
export const sharedVsCodeApi = nativeAcquireVsCodeApi();

(globalThis as typeof globalThis & {
  acquireVsCodeApi: <State = unknown>() => VsCodeApi<State>;
}).acquireVsCodeApi = <State = unknown>() => sharedVsCodeApi as VsCodeApi<State>;

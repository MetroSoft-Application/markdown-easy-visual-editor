/**
 * @fileoverview Webviewのvscodeapiを管理する。Hostとの通信、ユーザー操作、表示状態の契約を保つ。
 */
import type { VsCodeApi } from '../shared/protocol';

/**
 * vscodeapiのacquire・vs・code・apiに関する状態または設定。
 */
declare const acquireVsCodeApi: <State = unknown>() => VsCodeApi<State>;

/**
 * vscodeapiのnative・acquire・vs・code・apiに関する状態または設定。
 */
const nativeAcquireVsCodeApi = acquireVsCodeApi;

/**
 * vscodeapiのshared・vs・code・apiに関する状態または設定。
 */
export const sharedVsCodeApi = nativeAcquireVsCodeApi();

(globalThis as typeof globalThis & {
    /**
     * WebviewからVS Codeのメッセージ送信・状態保存APIを取得する。
     * @returns VS Codeのメッセージ送信・状態保存API。
     */
    acquireVsCodeApi: <State = unknown>() => VsCodeApi<State>;
}).acquireVsCodeApi =
    /**
     * WebviewからVS Codeのメッセージ送信・状態保存APIを取得する。
     * @returns VS Codeのメッセージ送信・状態保存API。
     */
    <State = unknown>() => sharedVsCodeApi as VsCodeApi<State>;

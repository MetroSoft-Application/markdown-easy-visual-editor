/**
 * @fileoverview WebviewのVS Code APIを一度だけ取得し、メッセージ送信と永続化状態の保存に使う。
 */
import type { VsCodeApi } from '../shared/protocol';

/**
 * WebviewがVS Codeと通信するAPIを取得するホスト提供関数。
 */
declare const acquireVsCodeApi: <State = unknown>() => VsCodeApi<State>;

/**
 * Webview初期化時にホストから提供されたAPI取得関数。
 */
const nativeAcquireVsCodeApi = acquireVsCodeApi;

/**
 * アプリ内で共有するVS Code通信APIのインスタンス。
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

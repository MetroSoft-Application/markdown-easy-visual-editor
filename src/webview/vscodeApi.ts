/**
 * @file vscodeApi.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import type { VsCodeApi } from '../shared/protocol';

/**
 * 「acquireVsCodeApi」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
 * @returns 「nativeAcquireVsCodeApi」の呼び出し結果を返します。
 */
declare const acquireVsCodeApi: <State = unknown>() => VsCodeApi<State>;

/**
 * Webview APIを1回だけ取得し、既存Appと追加コントローラーから共有できるようにする。
 * VS CodeのacquireVsCodeApiは複数回呼べないため、以後の取得要求には同じインスタンスを返す。
 */
const nativeAcquireVsCodeApi = acquireVsCodeApi;
/** 「sharedVsCodeApi」は、関連する処理間で共有する設定値または状態です。 */
/** Webview内で唯一取得したVS Code APIを共有し、acquireVsCodeApiの複数回呼び出しを防ぐ。 */
export const sharedVsCodeApi = nativeAcquireVsCodeApi();

(globalThis as typeof globalThis & {
    /**
     * 「acquireVsCodeApi」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
     * @returns 条件判定または変換の結果を返します。
     */
    acquireVsCodeApi: <State = unknown>() => VsCodeApi<State>;
}).acquireVsCodeApi =
/**
 * WebviewテストへVS Code API互換オブジェクトを提供するコールバックです。
 * @returns 条件判定または変換の結果を返します。
 */
<State = unknown>() => sharedVsCodeApi as VsCodeApi<State>;

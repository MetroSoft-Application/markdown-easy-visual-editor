/**
 * @file global.d.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
/** WebviewでCSS資産をTypeScriptから読み込むための宣言モジュール。 */
declare module '*.css';

/** TurndownのGFM拡張が提供するプラグインの型宣言モジュール。 */
declare module 'turndown-plugin-gfm' {
    import type { Plugin } from 'turndown';
    /** TurndownへGitHub Flavored Markdownの変換規則を追加するプラグイン。 */
    export const gfm: Plugin;
}

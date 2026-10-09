/**
 * @fileoverview Webviewで読み込むCSSとturndown-plugin-gfmのモジュール型宣言を補う。
 */
/**
 * CSS importを型検査できるよう、CSSモジュールを宣言する。
 */
declare module '*.css';

/**
 * turndown-plugin-gfmが公開するGFMプラグインの型を宣言する。
 */
declare module 'turndown-plugin-gfm' {
    import type { Plugin } from 'turndown';
    /**
     * GitHub Flavored Markdownの変換ルールを追加するTurndownプラグイン。
     */
    export const gfm: Plugin;
}

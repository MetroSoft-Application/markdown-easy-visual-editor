/**
 * @file markdownRenderer.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { sanitizeRenderedMarkdown } from './markdownSanitizer';
import { renderMarkdownUnsafe, type RenderOptions } from './markdownRendererCore';
import { highlightCode } from './codeHighlighter';

export { escapeHtml } from './markdownRendererCore';
export type { RenderOptions } from './markdownRendererCore';
export { sanitizeRenderedMarkdown } from './markdownSanitizer';

/**
 * MarkdownをHTML化し、Webviewへ挿入できる安全なHTMLへ無害化する。
 * @param markdown 解析・編集・変換の対象となる本文または生成済み内容です。
 * @param options 処理経路や表示方法を指定する設定値です。
 * @returns 「renderMarkdown」が生成または変換したMarkdownの文字列を返します。
 */
export function renderMarkdown(markdown: string, options: RenderOptions): string {
    return sanitizeRenderedMarkdown(renderMarkdownUnsafe(markdown, options, highlightCode));
}

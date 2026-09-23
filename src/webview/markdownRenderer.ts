/**
 * @fileoverview Markdown変換Workerとの通信、リクエストの世代管理、描画結果の受け渡しを管理する。
 */
import { sanitizeRenderedMarkdown } from './markdownSanitizer';
import { renderMarkdownUnsafe, type RenderOptions } from './markdownRendererCore';
import { highlightCode } from './codeHighlighter';

export { escapeHtml } from './markdownRendererCore';
export type { RenderOptions } from './markdownRendererCore';
export { sanitizeRenderedMarkdown } from './markdownSanitizer';

/**
 * Markdownを表示用HTMLへ変換し、見出し・画像・表などの付加情報をまとめる。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param options - 呼び出し側が指定する処理設定。
 * @returns Markdown変換で利用する文字列。
 */
export function renderMarkdown(markdown: string, options: RenderOptions): string {
    return sanitizeRenderedMarkdown(renderMarkdownUnsafe(markdown, options, highlightCode));
}

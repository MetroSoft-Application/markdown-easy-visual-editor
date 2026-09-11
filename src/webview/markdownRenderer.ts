import { sanitizeRenderedMarkdown } from './markdownSanitizer';
import { renderMarkdownUnsafe, type RenderOptions } from './markdownRendererCore';

export { escapeHtml } from './markdownRendererCore';
export type { RenderOptions } from './markdownRendererCore';
export { sanitizeRenderedMarkdown } from './markdownSanitizer';

/** MarkdownをHTML化し、Webviewへ挿入できる安全なHTMLへ無害化する。 */
export function renderMarkdown(markdown: string, options: RenderOptions): string {
    return sanitizeRenderedMarkdown(renderMarkdownUnsafe(markdown, options));
}

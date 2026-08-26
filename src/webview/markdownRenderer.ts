import DOMPurify from 'dompurify';
import { renderMarkdownUnsafe, type RenderOptions } from './markdownRendererCore';

export { escapeHtml } from './markdownRendererCore';
export type { RenderOptions } from './markdownRendererCore';

/** MarkdownをHTML化し、Webviewへ挿入できる安全なHTMLへ無害化する。 */
export function renderMarkdown(markdown: string, options: RenderOptions): string {
  return sanitizeRenderedMarkdown(renderMarkdownUnsafe(markdown, options));
}

/** Workerで生成したHTMLをUIスレッド上のDOMPurifyで無害化する。 */
export function sanitizeRenderedMarkdown(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: [
      'target',
      'data-original-src',
      'data-mve-link',
      'data-mve-image-index',
      'data-mve-image-kind',
      'data-mve-image-align',
      'data-mve-resizable',
      'data-mve-can-reset',
      'data-mermaid-source',
      'data-math-source',
      'data-copy-code',
      'data-language'
    ],
    ADD_TAGS: ['mark', 'ins'],
    ALLOW_DATA_ATTR: true
  });
}

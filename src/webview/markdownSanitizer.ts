import DOMPurify from "dompurify";

/** Worker または同期フォールバックが生成した HTML を安全に無害化する。 */
export function sanitizeRenderedMarkdown(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: [
      "target",
      "data-original-src",
      "data-mve-link",
      "data-mve-image-index",
      "data-mve-image-kind",
      "data-mve-image-align",
      "data-mve-resizable",
      "data-mve-can-reset",
      "data-mermaid-source",
      "data-math-source",
      "data-copy-code",
      "data-language",
    ],
    ADD_TAGS: ["mark", "ins"],
    ALLOW_DATA_ATTR: true,
  });
}

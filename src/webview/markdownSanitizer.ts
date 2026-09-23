/**
 * @fileoverview Markdown由来のHTML・SVGを許可範囲へ制限し、Webviewへ挿入する前に危険な要素を除去する。
 */
import DOMPurify from "dompurify";

/**
 * HTMLサニタイズの入力を許可された形式へ整える。
 * @param html - 表示または出力するHTML本文。
 * @returns HTMLサニタイズで利用する文字列。
 */
export function sanitizeRenderedMarkdown(html: string): string {
    return DOMPurify.sanitize(html, {
        ADD_ATTR: [
            "target",
            "style",
            "data-original-src",
            "data-mve-link",
            "data-mve-image-index",
            "data-mve-image-kind",
            "data-mve-image-align",
            "data-mve-resizable",
            "data-mve-can-reset",
            "data-mve-text-color",
            "data-mermaid-source",
            "data-math-source",
            "data-copy-code",
            "data-language",
        ],
        ADD_TAGS: ["mark", "ins"],
        ALLOW_DATA_ATTR: true,
    });
}

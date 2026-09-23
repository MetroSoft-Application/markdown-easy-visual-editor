/**
 * @file markdownSanitizer.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import DOMPurify from "dompurify";

/**
 * Worker または同期フォールバックが生成した HTML を安全に無害化する。
 * @param html 解析・編集・変換の対象となる本文または生成済み内容です。
 * @returns 「sanitizeRenderedMarkdown」が生成または変換したMarkdownの文字列を返します。
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

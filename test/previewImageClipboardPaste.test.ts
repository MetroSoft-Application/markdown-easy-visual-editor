/**
 * @fileoverview プレビュー画像コピーのtext/plainフォールバックから画像data URLを復元する回帰条件を検証する。
 */
import { describe, expect, it } from "vitest";
import { extractMarkdownImageDataUrl } from "../src/webview/preview/previewImageClipboardPaste";

describe(
  "extractMarkdownImageDataUrl",
  /**
   * 画像コピーのtext/plain表現を別Webviewでも復元できることを検証する。
   * @returns テストケースを登録し、値は返さない。
   */
  () => {
    it(
      "extracts a base64 image data URL from a copied Markdown image",
      /**
       * 単一のMarkdown画像からdata URLを取り出せることを確認する。
       * @returns 検証を実行し、値は返さない。
       */
      () => {
        expect(
          extractMarkdownImageDataUrl(
            "![sample](data:image/png;base64,iVBORw0KGgo=)",
          ),
        ).toBe("data:image/png;base64,iVBORw0KGgo=");
      },
    );

    it(
      "accepts escaped closing brackets in alt text",
      /**
       * コピー時にエスケープされたalt文字列でも画像を復元できることを確認する。
       * @returns 検証を実行し、値は返さない。
       */
      () => {
        expect(
          extractMarkdownImageDataUrl(
            "![a\\]b](data:image/jpeg;base64,/9j/AA==)",
          ),
        ).toBe("data:image/jpeg;base64,/9j/AA==");
      },
    );

    it(
      "does not reinterpret ordinary Markdown images or surrounding text",
      /**
       * 通常URLや複数内容を含むテキストを内部画像コピーとして誤判定しないことを確認する。
       * @returns 検証を実行し、値は返さない。
       */
      () => {
        expect(extractMarkdownImageDataUrl("![sample](./image.png)")).toBeUndefined();
        expect(
          extractMarkdownImageDataUrl(
            "before ![sample](data:image/png;base64,AA==) after",
          ),
        ).toBeUndefined();
      },
    );
  },
);

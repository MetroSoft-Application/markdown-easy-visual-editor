/**
 * @fileoverview 挿入リボンの「空行」ボタンが挿入する`BLANK_LINE_SNIPPET`（`<br>` + 空行）が、プレビューで
 * 独立した`<br>`ブロックとして描画され、直後の段落・リスト・見出しをHTMLブロックへ取り込まないことを検証する。
 * 実行境界はtest（Node）。ボタン実装と同じ定数を`src/webview/ribbon/ribbonSnippets.ts`から参照し、値の二重管理を避ける。
 * DOMPurifyはDOMのないNode環境では動かないため対象外とし、`<br>`が既定許可タグであることに依拠する。
 */
import { describe, expect, it } from "vitest";
import { renderMarkdownUnsafe } from "../src/webview/markdown/markdownRendererCore";
import { BLANK_LINE_SNIPPET } from "../src/webview/ribbon/ribbonSnippets";

/**
 * 描画テストで共通に使う最小の表示設定。
 */
const options = { remoteImagesEnabled: false, language: "ja" as const };

/**
 * `|`をカーソル位置とみなして空行ボタンの挿入文字列を差し込み、プレビューHTMLを返す。
 * @param marked - カーソル位置を`|`1文字で示した本文。
 * @returns サニタイズ前のプレビューHTML。
 */
function renderInsertedAt(marked: string): string {
    return renderMarkdownUnsafe(marked.replace("|", BLANK_LINE_SNIPPET), options);
}

describe("insert ribbon blank line",
    () => {
        it("inserts <br> followed by a blank line",
            () => {
                expect(BLANK_LINE_SNIPPET).toBe("<br>\n\n");
            });

        it("renders a standalone <br> between paragraphs when inserted on the line after a blank line",
            () => {
                const html = renderInsertedAt("段落A\n\n|段落B");

                expect(html).toMatch(/<p>段落A<\/p>[\s\S]*<br>[\s\S]*<p>段落B<\/p>/);
                expect(html).not.toMatch(/<p>[^<]*<br>/);
            });

        it("keeps the following paragraph as Markdown when inserted on an empty line without a trailing blank line",
            () => {
                const html = renderInsertedAt("段落A\n\n|\n**強調**");

                expect(html).toContain("<strong>強調</strong>");
                expect(html).not.toContain("**強調**");
            });

        it.each([
            ["list", "- 項目1\n\n|- 項目2", "<li>項目2</li>"],
            ["heading", "段落A\n\n|## 見出し", "見出し</h2>"],
            ["blockquote", "段落A\n\n|> 引用", "<blockquote>"],
        ])("does not absorb a following %s into the <br> HTML block",
            (_kind, marked, expected) => {
                expect(renderInsertedAt(marked)).toContain(expected);
            });

        it("renders a standalone <br> at the start and the end of the document",
            () => {
                expect(renderInsertedAt("|段落B")).toMatch(/<br>[\s\S]*<p>段落B<\/p>/);
                expect(renderInsertedAt("段落A\n\n|")).toMatch(/<p>段落A<\/p>[\s\S]*<br>/);
            });

        it("adds one more <br> per repeated insertion at the caret",
            () => {
                const html = renderInsertedAt(`段落A\n\n${BLANK_LINE_SNIPPET}|段落B`);

                expect(html.match(/<br>/g)).toHaveLength(2);
                expect(html).toMatch(/<p>段落A<\/p>[\s\S]*<br>[\s\S]*<br>[\s\S]*<p>段落B<\/p>/);
            });
    });

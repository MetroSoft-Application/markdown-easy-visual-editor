/**
 * @fileoverview 「行へ移動」（Ctrl+G）の入力値検証を検証する。
 * 回帰リスク: 不正値で誤った位置へ移動する、範囲外の行で offset が本文外になる、
 * 全言語の入力案内に行数が埋め込まれない。
 */
import { describe, expect, it } from "vitest";
import { canonicalOffsetAt, toCanonicalText } from "../src/shared/canonicalText";
import { parseGoToLineInput } from "../src/shared/goToLine";
import { getMessages } from "../src/shared/messages";
import manifest from "../package.json";

describe("parseGoToLineInput", () => {
  it("converts a 1-based line number to a 0-based line and ignores surrounding spaces", () => {
    expect(parseGoToLineInput("1", 10)).toBe(0);
    expect(parseGoToLineInput(" 5 ", 10)).toBe(4);
    expect(parseGoToLineInput("10", 10)).toBe(9);
  });

  it("clamps a line beyond the document to the last line like VS Code's Go to Line", () => {
    expect(parseGoToLineInput("11", 10)).toBe(9);
    expect(parseGoToLineInput("999999", 3)).toBe(2);
    // 行数が不正な場合も 1 行文書として扱い、負の行を返さない。
    expect(parseGoToLineInput("3", 0)).toBe(0);
  });

  it("rejects empty, zero, negative, decimal, non-numeric and unsafe values", () => {
    for (const value of ["", "   ", "0", "-1", "1.5", "abc", "1e3", "+2", "1:2", "99999999999999999999"]) {
      expect(parseGoToLineInput(value, 10), value).toBeUndefined();
    }
  });

  it("maps the parsed line to the start offset of that line in CRLF and LF text", () => {
    // Host は LF 正規化本文から offset を計算するため、CRLF 文書でも同じ行頭へ移動する。
    for (const source of ["# A\r\nline 2\r\n\r\nline 4", "# A\nline 2\n\nline 4", "# A\rline 2\r\rline 4"]) {
      const canonical = toCanonicalText(source);
      const line = parseGoToLineInput("4", 4);
      expect(line).toBe(3);
      expect(canonical.slice(canonicalOffsetAt(canonical, { line: line!, character: 0 }))).toBe("line 4");
    }
  });

  it("can jump to the empty last line after a trailing newline", () => {
    // VS Code の lineCount は末尾改行の後の空行も数えるため、その行頭（本文末尾）へ移動できる。
    const canonical = toCanonicalText("a\r\nb\r\n");
    const line = parseGoToLineInput("99", 3);
    expect(line).toBe(2);
    expect(canonicalOffsetAt(canonical, { line: line!, character: 0 })).toBe(canonical.length);
  });
});

describe("go to line contribution", () => {
  it("binds Ctrl+G only while this custom editor is active, using VS Code's real context key", () => {
    // VS Code が設定するのは activeCustomEditorId。存在しない activeCustomEditor を使うと when が常に偽になり、
    // 標準の「行へ移動」（テキストエディターが必要）が開いてしまう。実機で確認した回帰。
    const binding = manifest.contributes.keybindings.find(
      (item: { command: string }) => item.command === "markdownEasyVisualEditor.goToLine",
    );
    expect(binding).toMatchObject({
      key: "ctrl+g",
      when: "activeCustomEditorId == markdownEasyVisualEditor.editor && !inputFocus",
    });
    const palette = manifest.contributes.menus.commandPalette.find(
      (item: { command: string }) => item.command === "markdownEasyVisualEditor.goToLine",
    );
    expect(palette?.when).toBe("activeCustomEditorId == markdownEasyVisualEditor.editor");
  });
});

describe("go to line messages", () => {
  it("interpolates the line count in every supported language", () => {
    for (const language of ["ja", "en", "zh-cn", "ko", "fr", "de", "es"]) {
      const messages = getMessages(language);
      expect(messages.host.goToLinePrompt(42), language).toContain("42");
      expect(messages.host.goToLinePrompt(42), language).not.toContain("{lineCount}");
      expect(messages.host.goToLineInvalid, language).not.toBe("");
    }
  });
});

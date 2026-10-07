/**
 * @fileoverview PDF出力前の正規表現置換ルールについて、全件置換・順序・削除・検証を回帰テストする。
 */
import { describe, expect, it } from "vitest";
import {
  applyPdfTextReplacements,
  validatePdfTextReplacementRule,
} from "../src/shared/pdfTextReplacement";
import { normalizePdfOptions } from "../src/shared/protocol";

describe("PDF text replacements", () => {
  it("replaces every match even when g is not specified", () => {
    expect(
      applyPdfTextReplacements("secret A secret B", [
        { pattern: "secret", replacement: "[hidden]", flags: "" },
      ]),
    ).toEqual({
      text: "[hidden] A [hidden] B",
      errors: [],
    });
  });

  it("removes matches when the replacement is empty", () => {
    expect(
      applyPdfTextReplacements("公開 [INTERNAL] 非公開 [INTERNAL]", [
        { pattern: "\\s*\\[INTERNAL\\]", replacement: "" },
      ]).text,
    ).toBe("公開 非公開");
  });

  it("applies multiple rules in configured order", () => {
    expect(
      applyPdfTextReplacements("ID: ABC-123", [
        { pattern: "ABC-(\\d+)", replacement: "ticket:$1" },
        { pattern: "ticket:(\\d+)", replacement: "#$1" },
      ]).text,
    ).toBe("ID: #123");
  });

  it("supports regular-expression flags and capture references", () => {
    expect(
      applyPdfTextReplacements("Name: Alice\nNAME: Bob", [
        {
          pattern: "^name:\\s*(.+)$",
          replacement: "User=$1",
          flags: "im",
        },
      ]).text,
    ).toBe("User=Alice\nUser=Bob");
  });

  it("skips blank patterns so an unfinished rule does not match every position", () => {
    expect(
      applyPdfTextReplacements("unchanged", [
        { pattern: "", replacement: "x", flags: "" },
      ]),
    ).toEqual({ text: "unchanged", errors: [] });
  });

  it("reports invalid patterns without throwing", () => {
    const result = applyPdfTextReplacements("text", [
      { pattern: "(", replacement: "" },
    ]);

    expect(result.text).toBe("text");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].index).toBe(0);
    expect(validatePdfTextReplacementRule({ pattern: "(", replacement: "" }))
      .toBeTypeOf("string");
  });

  it("reports invalid or duplicate flags without throwing", () => {
    const result = applyPdfTextReplacements("text", [
      { pattern: "text", replacement: "x", flags: "ii" },
    ]);

    expect(result.text).toBe("text");
    expect(result.errors).toHaveLength(1);
  });

  it("normalizes persisted replacement rules without dropping user input", () => {
    const options = normalizePdfOptions({
      textReplacements: [
        { pattern: "秘密", replacement: "[非表示]", flags: "i" },
        { pattern: "(draft)", replacement: "", flags: "" },
      ],
    });

    expect(options.textReplacements).toEqual([
      { pattern: "秘密", replacement: "[非表示]", flags: "i" },
      { pattern: "(draft)", replacement: "", flags: "" },
    ]);
  });
});

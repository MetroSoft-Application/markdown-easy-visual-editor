/**
 * @fileoverview PDF出力前の正規表現置換と設定正規化を検証する。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PDF_OPTIONS,
  normalizePdfOptions,
} from "../src/shared/protocol";
import {
  applyPdfTextReplacements,
  isValidPdfTextReplacementPattern,
} from "../src/shared/pdfTextReplacement";

describe("PDF text replacements", () => {
  it("applies every rule globally in registration order", () => {
    const result = applyPdfTextReplacements(
      "ID: ABC-123 / ABC-456",
      [
        { pattern: "ABC-\\d+", replacement: "[hidden]" },
        { pattern: "\\[hidden\\]", replacement: "■" },
      ],
    );

    expect(result).toBe("ID: ■ / ■");
  });

  it("removes matches when replacement is empty", () => {
    expect(
      applyPdfTextReplacements("public INTERNAL public", [
        { pattern: "\\s*INTERNAL\\s*", replacement: " " },
      ]),
    ).toBe("public public");
  });

  it("treats replacement text literally instead of expanding $ tokens", () => {
    expect(
      applyPdfTextReplacements("secret42", [
        { pattern: "secret(\\d+)", replacement: "$1/$&" },
      ]),
    ).toBe("$1/$&");
  });

  it("skips empty and invalid patterns without failing other rules", () => {
    expect(
      applyPdfTextReplacements("keep secret", [
        { pattern: "", replacement: "x" },
        { pattern: "[", replacement: "x" },
        { pattern: "secret", replacement: "***" },
      ]),
    ).toBe("keep ***");

    expect(isValidPdfTextReplacementPattern("[")).toBe(false);
    expect(isValidPdfTextReplacementPattern("secret")).toBe(true);
  });

  it("normalizes any number of well-shaped rules and keeps editable invalid patterns", () => {
    const options = normalizePdfOptions({
      ...DEFAULT_PDF_OPTIONS,
      textReplacements: [
        { pattern: "secret", replacement: "***" },
        { pattern: "[", replacement: "" },
        { pattern: "\\d+", replacement: "N" },
      ],
    });

    expect(options.textReplacements).toEqual([
      { pattern: "secret", replacement: "***" },
      { pattern: "[", replacement: "" },
      { pattern: "\\d+", replacement: "N" },
    ]);
  });

  it("drops malformed persisted entries while preserving valid string values", () => {
    const options = normalizePdfOptions({
      ...DEFAULT_PDF_OPTIONS,
      textReplacements: [
        { pattern: "a", replacement: "b" },
        { pattern: 123, replacement: "x" },
        null,
        { pattern: " spaced ", replacement: "  " },
      ],
    });

    expect(options.textReplacements).toEqual([
      { pattern: "a", replacement: "b" },
      { pattern: " spaced ", replacement: "  " },
    ]);
  });
});

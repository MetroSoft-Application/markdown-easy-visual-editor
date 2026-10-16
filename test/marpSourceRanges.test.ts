/**
 * @fileoverview ソース位置からMarpスライドを選ぶ境界条件を検証する。
 */
import { describe, expect, it } from "vitest";
import { renderMarpMarkdown } from "../src/webview/marp/marpRenderer";
import { findMarpSourceRangeAtOffset } from "../src/webview/marp/marpSourceRanges";

describe("Marp source range selection", () => {
  it("assigns internal gaps and separators to the following slide", () => {
    const markdown = [
      "---",
      "marp: true",
      "---",
      "# First slide",
      "",
      "First content.",
      "",
      "",
      "---",
      "",
      "",
      "# Second slide",
      "",
      "Second content.",
      "",
      "---",
      "",
      "# Third slide",
    ].join("\n");
    const { sourceRanges } = renderMarpMarkdown(
      markdown,
      "file:///extension/marp-katex-fonts/",
    );

    expect(sourceRanges).toHaveLength(3);
    const first = sourceRanges[0];
    const second = sourceRanges[1];
    const third = sourceRanges[2];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(third).toBeDefined();
    if (!first || !second || !third) return;
    expect(second.startOffset).toBeGreaterThan(first.endOffset);
    expect(third.startOffset).toBeGreaterThan(second.endOffset);

    expect(findMarpSourceRangeAtOffset(sourceRanges, first.endOffset)).toBe(second);
    expect(findMarpSourceRangeAtOffset(sourceRanges, second.startOffset - 1)).toBe(second);
    expect(findMarpSourceRangeAtOffset(sourceRanges, second.startOffset)).toBe(second);
    expect(findMarpSourceRangeAtOffset(sourceRanges, second.endOffset)).toBe(third);
  });

  it("keeps offsets before and after the deck on its nearest end slide", () => {
    const ranges = [
      { startOffset: 20, endOffset: 40 },
      { startOffset: 50, endOffset: 70 },
    ];

    expect(findMarpSourceRangeAtOffset(ranges, 0)).toBe(ranges[0]);
    expect(findMarpSourceRangeAtOffset(ranges, 80)).toBe(ranges[1]);
    expect(findMarpSourceRangeAtOffset([], 10)).toBeUndefined();
    expect(findMarpSourceRangeAtOffset(ranges, Number.NaN)).toBeUndefined();
  });
});

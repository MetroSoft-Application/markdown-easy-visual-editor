/**
 * @fileoverview アウトライン欄とHTMLプレビューのアウトラインの幅制限を検証する。
 * 回帰リスク: 最小幅を下げた後も旧保存値が変わる、区切りバーの aria-valuemin と実際の下限がずれる、
 * HTMLプレビューのリサイズスクリプトだけ旧最小幅のまま残る。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({}));

import {
  clampOutlineWidth,
  OUTLINE_MAX_WIDTH,
  OUTLINE_MIN_WIDTH,
} from "../src/webview/components/outlineWidth";
import { HTML_OUTLINE_RESIZER_SCRIPT } from "../src/extension/htmlPreview";

describe("clampOutlineWidth", () => {
  it("allows the outline to shrink to 120px", () => {
    expect(OUTLINE_MIN_WIDTH).toBe(120);
    expect(clampOutlineWidth(120)).toBe(120);
    expect(clampOutlineWidth(145)).toBe(145);
    expect(clampOutlineWidth(80)).toBe(120);
  });

  it("keeps widths saved with the previous minimum and clamps the maximum", () => {
    expect(clampOutlineWidth(160)).toBe(160);
    expect(clampOutlineWidth(220)).toBe(220);
    expect(clampOutlineWidth(1000)).toBe(OUTLINE_MAX_WIDTH);
  });

  it("falls back to the default for non-finite values", () => {
    expect(clampOutlineWidth(Number.NaN)).toBe(220);
    expect(clampOutlineWidth(Number.POSITIVE_INFINITY)).toBe(220);
  });
});

describe("HTML preview outline resizer", () => {
  it("uses the same minimum as the editor outline and the exported HTML outline", () => {
    expect(HTML_OUTLINE_RESIZER_SCRIPT).toContain(`const minimumWidth = ${OUTLINE_MIN_WIDTH};`);
  });
});

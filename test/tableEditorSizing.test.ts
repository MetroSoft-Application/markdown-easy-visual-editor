import { describe, expect, it } from "vitest";
import {
  calculateAutoFitColumnWidth,
  calculateAutoFitRowHeight,
} from "../src/shared/tableEditorSizing";

describe("table editor auto-fit sizing", () => {
  it("fits the longest physical line and includes horizontal chrome", () => {
    expect(
      calculateAutoFitColumnWidth(
        ["A", "short\nlonger line"],
        (value) => value.length * 10,
        20,
      ),
    ).toBe(130);
  });

  it("keeps short and empty columns at the minimum width", () => {
    expect(
      calculateAutoFitColumnWidth(["", "a"], (value) => value.length * 8, 20),
    ).toBe(96);
  });

  it("caps unusually wide column content", () => {
    expect(
      calculateAutoFitColumnWidth(["x".repeat(500)], (value) => value.length * 10),
    ).toBe(720);
  });

  it("clamps row height to the supported range", () => {
    expect(calculateAutoFitRowHeight([28, 41.2, 39])).toBe(42);
    expect(calculateAutoFitRowHeight([])).toBe(36);
    expect(calculateAutoFitRowHeight([1000])).toBe(720);
  });
});

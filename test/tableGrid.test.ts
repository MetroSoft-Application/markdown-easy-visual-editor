import { describe, expect, it } from "vitest";
import {
  clearTableGridRange,
  moveTableGridColumn,
  moveTableGridRow,
  normalizeTableGridRange,
  tableGridColumnLabel,
  tableGridRangeCellCount,
  tableGridRangeContains,
} from "../src/shared/tableGrid";

describe("table grid helpers", () => {
  it("normalizes reverse rectangular selections and clamps them to the grid", () => {
    const range = normalizeTableGridRange(
      { anchorRow: 5, anchorColumn: 4, focusRow: -2, focusColumn: 1 },
      4,
      3,
    );
    expect(range).toEqual({
      fromRow: 0,
      toRow: 3,
      fromColumn: 1,
      toColumn: 2,
    });
    expect(tableGridRangeCellCount(range)).toBe(8);
    expect(tableGridRangeContains(range, 2, 2)).toBe(true);
    expect(tableGridRangeContains(range, 2, 0)).toBe(false);
  });

  it("moves data rows without mutating the source matrix", () => {
    const rows = [["H"], ["1"], ["2"], ["3"]];
    const moved = moveTableGridRow(rows, 1, 3);
    expect(moved).toEqual([["H"], ["2"], ["3"], ["1"]]);
    expect(rows).toEqual([["H"], ["1"], ["2"], ["3"]]);
  });

  it("moves columns and their alignment metadata together", () => {
    const moved = moveTableGridColumn(
      [
        ["A", "B", "C"],
        ["1", "2", "3"],
      ],
      ["left", "center", "right"],
      0,
      2,
    );
    expect(moved.rows).toEqual([
      ["B", "C", "A"],
      ["2", "3", "1"],
    ]);
    expect(moved.alignments).toEqual(["center", "right", "left"]);
  });

  it("clears only the requested rectangular range", () => {
    const cleared = clearTableGridRange(
      [
        ["A", "B", "C"],
        ["1", "2", "3"],
        ["4", "5", "6"],
      ],
      { fromRow: 1, toRow: 2, fromColumn: 1, toColumn: 2 },
    );
    expect(cleared).toEqual([
      ["A", "B", "C"],
      ["1", "", ""],
      ["4", "", ""],
    ]);
  });

  it("uses spreadsheet-style column labels", () => {
    expect(tableGridColumnLabel(0)).toBe("A");
    expect(tableGridColumnLabel(25)).toBe("Z");
    expect(tableGridColumnLabel(26)).toBe("AA");
    expect(tableGridColumnLabel(51)).toBe("AZ");
  });
});

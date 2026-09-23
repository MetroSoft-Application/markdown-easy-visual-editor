/**
 * @file tableGrid.test.ts
 * 実行境界: テスト実行環境。
 * 責務: 現行実装の仕様と回帰条件を検証する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テスト用のモック、ブラウザー、ファイルを必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { describe, expect, it } from "vitest";
import {
  clearTableGridRange,
  duplicateTableGridColumns,
  duplicateTableGridRows,
  moveTableGridColumn,
  moveTableGridRow,
  normalizeTableGridRange,
  tableGridColumnLabel,
  tableGridRangeCellCount,
  tableGridRangeContains,
} from "../src/shared/tableGrid";

describe("table grid helpers",
/**
 * テスト「table grid helpers」の前提条件を設定し、期待結果を検証するコールバックです。
 * @returns テストの前提条件と期待結果を検証し、値を返しません。
 */
() => {
  it("normalizes reverse rectangular selections and clamps them to the grid",
  /**
 * テスト「normalizes reverse rectangular selections and clamps them to the grid」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
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

  it("moves data rows without mutating the source matrix",
  /**
 * テスト「moves data rows without mutating the source matrix」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const rows = [["H"], ["1"], ["2"], ["3"]];
    const moved = moveTableGridRow(rows, 1, 3);
    expect(moved).toEqual([["H"], ["2"], ["3"], ["1"]]);
    expect(rows).toEqual([["H"], ["1"], ["2"], ["3"]]);
  });

  it("moves columns and their alignment metadata together",
  /**
 * テスト「moves columns and their alignment metadata together」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
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

  it("duplicates a row range after the source range",
  /**
 * テスト「duplicates a row range after the source range」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const rows = [["H"], ["1"], ["2"]];
    const duplicated = duplicateTableGridRows(rows, 1, 1);
    expect(duplicated).toEqual([["H"], ["1"], ["1"], ["2"]]);
    expect(rows).toEqual([["H"], ["1"], ["2"]]);
  });

  it("duplicates columns and their alignment metadata after the source range",
  /**
 * テスト「duplicates columns and their alignment metadata after the source range」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const duplicated = duplicateTableGridColumns(
      [
        ["A", "B", "C"],
        ["1", "2", "3"],
      ],
      ["left", "center", "right"],
      1,
      1,
    );
    expect(duplicated.rows).toEqual([
      ["A", "B", "B", "C"],
      ["1", "2", "2", "3"],
    ]);
    expect(duplicated.alignments).toEqual([
      "left",
      "center",
      "center",
      "right",
    ]);
  });

  it("clears only the requested rectangular range",
  /**
 * テスト「clears only the requested rectangular range」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
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

  it("uses spreadsheet-style column labels",
  /**
 * テスト「uses spreadsheet-style column labels」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(tableGridColumnLabel(0)).toBe("A");
    expect(tableGridColumnLabel(25)).toBe("Z");
    expect(tableGridColumnLabel(26)).toBe("AA");
    expect(tableGridColumnLabel(51)).toBe("AZ");
  });
});

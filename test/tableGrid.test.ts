/**
 * @fileoverview tablegrid・テストの回帰の仕様と回帰条件を検証する。失敗時は期待値と実装差分を示す。
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
     * 「table grid helpers」の仕様と回帰条件を検証するテストケース。
     * @returns テストケースを実行し、値は返さない。
     */
    () => {
        it("normalizes reverse rectangular selections and clamps them to the grid",
            /**
             * 「normalizes reverse rectangular selections and clamps them to the grid」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
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
             * 「moves data rows without mutating the source matrix」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const rows = [["H"], ["1"], ["2"], ["3"]];
                const moved = moveTableGridRow(rows, 1, 3);
                expect(moved).toEqual([["H"], ["2"], ["3"], ["1"]]);
                expect(rows).toEqual([["H"], ["1"], ["2"], ["3"]]);
            });

        it("moves columns and their alignment metadata together",
            /**
             * 「moves columns and their alignment metadata together」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
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
             * 「duplicates a row range after the source range」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const rows = [["H"], ["1"], ["2"]];
                const duplicated = duplicateTableGridRows(rows, 1, 1);
                expect(duplicated).toEqual([["H"], ["1"], ["1"], ["2"]]);
                expect(rows).toEqual([["H"], ["1"], ["2"]]);
            });

        it("duplicates columns and their alignment metadata after the source range",
            /**
             * 「duplicates columns and their alignment metadata after the source range」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
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
             * 「clears only the requested rectangular range」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
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
             * 「uses spreadsheet-style column labels」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(tableGridColumnLabel(0)).toBe("A");
                expect(tableGridColumnLabel(25)).toBe("Z");
                expect(tableGridColumnLabel(26)).toBe("AA");
                expect(tableGridColumnLabel(51)).toBe("AZ");
            });
    });

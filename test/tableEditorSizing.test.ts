/**
 * @fileoverview セル内容からの列幅自動調整、横方向の余白、列幅と行高の最小値・最大値を検証する。
 */
import { describe, expect, it } from "vitest";
import {
    calculateAutoFitColumnWidth,
    calculateAutoFitRowHeight,
    calculateTableEditorInitialSizes,
    remapTableEditorSizes,
    tableEditorUnwrappedCellHeight,
    tableEditorUnwrappedLineCount,
} from "../src/shared/tableEditorSizing";

describe("table editor auto-fit sizing",
    () => {
        it("fits the longest physical line and includes horizontal chrome",
            () => {
                expect(
                    calculateAutoFitColumnWidth(
                        ["A", "short\nlonger line"],

                        /**
                         * tableeditorsizing・テストの回帰の前提条件を準備し、回帰条件を検証するテストケース。
                         * @param value - Canvas計測を模擬するため幅を見積もるセル文字列。
                         */
                        (value) => value.length * 10,
                        20,
                    ),
                ).toBe(130);
            });

        it("keeps short and empty columns at the minimum width",
            () => {
                expect(
                    calculateAutoFitColumnWidth(["", "a"],
                        /**
                         * tableeditorsizing・テストの回帰の前提条件を準備し、回帰条件を検証するテストケース。
                          * @param value - Canvas計測を模擬するため幅を見積もるセル文字列。
                         */
                        (value) => value.length * 8, 20),
                ).toBe(96);
            });

        it("caps unusually wide column content",
            () => {
                expect(
                    calculateAutoFitColumnWidth(["x".repeat(500)],
                        /**
                         * tableeditorsizing・テストの回帰の前提条件を準備し、回帰条件を検証するテストケース。
                          * @param value - Canvas計測を模擬するため幅を見積もるセル文字列。
                         */
                        (value) => value.length * 10),
                ).toBe(720);
            });

        it("clamps row height to the supported range",
            () => {
                expect(calculateAutoFitRowHeight([28, 41.2, 39])).toBe(42);
                expect(calculateAutoFitRowHeight([])).toBe(36);
                expect(calculateAutoFitRowHeight([1000])).toBe(720);
            });
    });

/**
 * 表を開く前にセル文字列だけで列幅・行高を決める計算を検証する。最初の描画から内容に合った寸法で
 * 描くための計算で、折り返すセルや行高が決められない場合にDOM測定へ回すことが回帰の要点。
 */
describe("table editor initial sizes",
    () => {
        /** 1文字10px、余白20px、1行の高さ37px、行の高さ19pxの寸法情報。 */
        const metrics = {
            /**
             * @param line - 1論理行。
             * @returns 1文字10pxとした幅。
             */
            measure: (line: string) => line.length * 10,
            horizontalChrome: 20,
            singleLineHeight: 37,
            lineHeight: 19,
        };

        it("fits columns to content and derives row heights from line counts",
            /**
             * 折り返さない表は、列幅を内容へ合わせ、行高を最大の行数から求めることを検証する。
             */
            () => {
                const sizes = calculateTableEditorInitialSizes(
                    [["ID", "Name"], ["1", "first\nsecond\nthird"], ["2"]],
                    2,
                    metrics,
                );
                expect(sizes.columnWidths).toEqual([96, 96]);
                expect(sizes.rowHeights).toEqual([37, 75, 37]);
                expect(sizes.rowsNeedingMeasure).toEqual([]);
            });

        it("leaves rows whose cells wrap at the capped width to DOM measurement",
            /**
             * 上限幅でも収まらないセルの行は、高さを決めずDOM測定の対象にすることを検証する。
             */
            () => {
                const sizes = calculateTableEditorInitialSizes(
                    [["H"], ["x".repeat(100)]],
                    1,
                    metrics,
                    96,
                    300,
                );
                expect(sizes.columnWidths).toEqual([300]);
                expect(sizes.rowHeights).toEqual([37, undefined]);
                expect(sizes.rowsNeedingMeasure).toEqual([1]);
            });

        it("measures multi-line rows in the DOM when line-height is not numeric",
            /**
             * line-heightが数値でない環境では、複数行の高さを推定せずDOMで測ることを検証する。
             */
            () => {
                const sizes = calculateTableEditorInitialSizes(
                    [["a"], ["a\nb"]],
                    1,
                    { ...metrics, lineHeight: Number.NaN },
                );
                expect(sizes.rowHeights).toEqual([37, undefined]);
                expect(sizes.rowsNeedingMeasure).toEqual([1]);
            });

        it("measures cells with tab characters in the DOM",
            /**
             * タブはCanvasとtextareaで幅が一致しないため、折り返し判定をせずDOM測定へ回すことを検証する。
             */
            () => {
                expect(tableEditorUnwrappedLineCount("a\tb", 300, metrics)).toBeUndefined();
                expect(tableEditorUnwrappedLineCount("a\nb", 300, metrics)).toBe(2);
                expect(tableEditorUnwrappedCellHeight(2, metrics)).toBe(56);
            });
    });

/**
 * 行・列の挿入・削除の後も、列幅・行高が元の行・列に付いて移ることを検証する。開いた時点で行・列ごとに
 * 異なる寸法を持つため、位置のまま引き継ぐと別の行・列の寸法になる回帰を防ぐ。
 */
describe("table editor size remapping",
    () => {
        it("inserts the fill value and keeps the following sizes with their rows",
            /**
             * 挿入位置に既定値が入り、後ろの行・列の寸法がずれずに付いて移ることを検証する。
             */
            () => {
                expect(remapTableEditorSizes([37, 75, 37], { kind: "insert", index: 1, count: 1 }, 4, undefined))
                    .toEqual([37, undefined, 75, 37]);
            });

        it("drops the deleted sizes",
            /**
             * 削除した行・列の寸法を捨て、残りの寸法を保つことを検証する。
             */
            () => {
                expect(remapTableEditorSizes([96, 547, 120], { kind: "delete", index: 0, count: 1 }, 2, 160))
                    .toEqual([547, 120]);
            });

        it("keeps positions and pads or truncates without a change",
            /**
             * 挿入・削除の指定がなければ位置のまま引き継ぎ、長さを新しい行数・列数にそろえることを検証する。
             */
            () => {
                expect(remapTableEditorSizes([96, 120], undefined, 3, 160)).toEqual([96, 120, 160]);
                expect(remapTableEditorSizes([96, 120, 130], undefined, 2, 160)).toEqual([96, 120]);
            });
    });

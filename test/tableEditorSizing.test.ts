/**
 * @fileoverview セル内容からの列幅自動調整、横方向の余白、列幅と行高の最小値・最大値を検証する。
 */
import { describe, expect, it } from "vitest";
import {
    calculateAutoFitColumnWidth,
    calculateAutoFitRowHeight,
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

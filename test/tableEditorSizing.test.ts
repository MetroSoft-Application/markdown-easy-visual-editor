/**
 * @fileoverview tableeditorsizing・テストの回帰の仕様と回帰条件を検証する。失敗時は期待値と実装差分を示す。
 */
import { describe, expect, it } from "vitest";
import {
    calculateAutoFitColumnWidth,
    calculateAutoFitRowHeight,
} from "../src/shared/tableEditorSizing";

describe("table editor auto-fit sizing",
    /**
     * 「table editor auto-fit sizing」の仕様と回帰条件を検証するテストケース。
     * @returns テストケースを実行し、値は返さない。
     */
    () => {
        it("fits the longest physical line and includes horizontal chrome",
            /**
             * 「fits the longest physical line and includes horizontal chrome」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(
                    calculateAutoFitColumnWidth(
                        ["A", "short\nlonger line"],

                        /**
                         * tableeditorsizing・テストの回帰の前提条件を準備し、回帰条件を検証するテストケース。
                         * @param value - テスト本体を実行するコールバック。
                         * @returns テストケースを実行し、値は返さない。
                         */
                        (value) => value.length * 10,
                        20,
                    ),
                ).toBe(130);
            });

        it("keeps short and empty columns at the minimum width",
            /**
             * 「keeps short and empty columns at the minimum width」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(
                    calculateAutoFitColumnWidth(["", "a"],
                        /**
                         * tableeditorsizing・テストの回帰の前提条件を準備し、回帰条件を検証するテストケース。
                         * @param value - テスト本体を実行するコールバック。
                         * @returns テストケースを実行し、値は返さない。
                         */
                        (value) => value.length * 8, 20),
                ).toBe(96);
            });

        it("caps unusually wide column content",
            /**
             * 「caps unusually wide column content」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(
                    calculateAutoFitColumnWidth(["x".repeat(500)],
                        /**
                         * tableeditorsizing・テストの回帰の前提条件を準備し、回帰条件を検証するテストケース。
                         * @param value - テスト本体を実行するコールバック。
                         * @returns テストケースを実行し、値は返さない。
                         */
                        (value) => value.length * 10),
                ).toBe(720);
            });

        it("clamps row height to the supported range",
            /**
             * 「clamps row height to the supported range」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(calculateAutoFitRowHeight([28, 41.2, 39])).toBe(42);
                expect(calculateAutoFitRowHeight([])).toBe(36);
                expect(calculateAutoFitRowHeight([1000])).toBe(720);
            });
    });

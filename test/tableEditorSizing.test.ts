/**
 * @file tableEditorSizing.test.ts
 * 実行境界: テスト実行環境。
 * 責務: 現行実装の仕様と回帰条件を検証する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テスト用のモック、ブラウザー、ファイルを必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { describe, expect, it } from "vitest";
import {
  calculateAutoFitColumnWidth,
  calculateAutoFitRowHeight,
} from "../src/shared/tableEditorSizing";

describe("table editor auto-fit sizing",
/**
 * テスト「table editor auto-fit sizing」の前提条件を設定し、期待結果を検証するコールバックです。
 * @returns テストの前提条件と期待結果を検証し、値を返しません。
 */
() => {
  it("fits the longest physical line and includes horizontal chrome",
  /**
 * テスト「fits the longest physical line and includes horizontal chrome」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(
      calculateAutoFitColumnWidth(
        ["A", "short\nlonger line"],

        /**
 * テスト「fits the longest physical line and includes horizontal chrome」の前提条件を設定し、期待結果を検証するコールバックです。
         * @param value 「value」で検証・変換する入力値です。
         * @returns テストの前提条件と期待結果を検証し、値を返しません。
         */
        (value) => value.length * 10,
        20,
      ),
    ).toBe(130);
  });

  it("keeps short and empty columns at the minimum width",
  /**
 * テスト「keeps short and empty columns at the minimum width」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(
      calculateAutoFitColumnWidth(["", "a"],
      /**
 * テスト「keeps short and empty columns at the minimum width」の前提条件を設定し、期待結果を検証するコールバックです。
       * @param value 「value」で検証・変換する入力値です。
       * @returns テストの前提条件と期待結果を検証し、値を返しません。
       */
      (value) => value.length * 8, 20),
    ).toBe(96);
  });

  it("caps unusually wide column content",
  /**
 * テスト「caps unusually wide column content」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(
      calculateAutoFitColumnWidth(["x".repeat(500)],
      /**
 * テスト「caps unusually wide column content」の前提条件を設定し、期待結果を検証するコールバックです。
       * @param value 「value」で検証・変換する入力値です。
       * @returns テストの前提条件と期待結果を検証し、値を返しません。
       */
      (value) => value.length * 10),
    ).toBe(720);
  });

  it("clamps row height to the supported range",
  /**
 * テスト「clamps row height to the supported range」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(calculateAutoFitRowHeight([28, 41.2, 39])).toBe(42);
    expect(calculateAutoFitRowHeight([])).toBe(36);
    expect(calculateAutoFitRowHeight([1000])).toBe(720);
  });
});

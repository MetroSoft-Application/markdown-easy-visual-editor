/**
 * @file scrollAnchors.test.ts
 * 実行境界: テスト実行環境。
 * 責務: 現行実装の仕様と回帰条件を検証する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テスト用のモック、ブラウザー、ファイルを必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { describe, expect, it } from 'vitest';
import { getScrollRatio, getScrollTopForRatio } from '../src/shared/scroll';

describe('scroll synchronization ratio fallback',
/**
 * テスト「scroll synchronization ratio fallback」の前提条件を設定し、期待結果を検証するコールバックです。
 * @returns テストの前提条件と期待結果を検証し、値を返しません。
 */
() => {
  it('uses source anchors for ordinary interior positions',
  /**
 * テスト「uses source anchors for ordinary interior positions」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(getScrollRatio(250, 1200, 200)).toBeUndefined();
    expect(getScrollRatio(500, 1200, 200)).toBeUndefined();
  });

  it('keeps ratio synchronization at the document boundaries',
  /**
 * テスト「keeps ratio synchronization at the document boundaries」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(getScrollRatio(-10, 1200, 200)).toBe(0);
    expect(getScrollRatio(2000, 1200, 200)).toBe(1);
    expect(getScrollRatio(0, 200, 200)).toBe(0);
  });

  it('maps an explicit ratio back to the matching scroll position',
  /**
 * テスト「maps an explicit ratio back to the matching scroll position」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(getScrollTopForRatio(0.25, 1200, 200)).toBe(250);
    expect(getScrollTopForRatio(-1, 1200, 200)).toBe(0);
    expect(getScrollTopForRatio(2, 1200, 200)).toBe(1000);
    expect(getScrollTopForRatio(0.75, 200, 200)).toBe(0);
  });
});

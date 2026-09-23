/**
 * @file cmSelectionMatchHighlight.test.ts
 * 実行境界: テスト実行環境。
 * 責務: 現行実装の仕様と回帰条件を検証する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テスト用のモック、ブラウザー、ファイルを必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { describe, expect, it } from 'vitest';
import { findExactSelectionMatches } from '../src/webview/cmSelectionMatchHighlight';

describe('findExactSelectionMatches',
/**
 * テスト「findExactSelectionMatches」の前提条件を設定し、期待結果を検証するコールバックです。
 * @returns テストの前提条件と期待結果を検証し、値を返しません。
 */
() => {
  it('matches the exact selected text case-sensitively and excludes the selection itself',
  /**
 * テスト「matches the exact selected text case-sensitively and excludes the selection itself」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(findExactSelectionMatches('foo Foo foo', 'foo', 0, 3)).toEqual([
      { from: 8, to: 11 }
    ]);
  });

  it('preserves whitespace instead of trimming the selected text',
  /**
 * テスト「preserves whitespace instead of trimming the selected text」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(findExactSelectionMatches('foo foo  foo ', 'foo ', 0, 4)).toEqual([
      { from: 4, to: 8 },
      { from: 9, to: 13 }
    ]);
  });

  it('finds overlapping occurrences',
  /**
 * テスト「finds overlapping occurrences」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(findExactSelectionMatches('banana', 'ana', 1, 4)).toEqual([
      { from: 3, to: 6 }
    ]);
  });

  it('supports multiline selections without changing line breaks',
  /**
 * テスト「supports multiline selections without changing line breaks」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(findExactSelectionMatches('aa\nbb\nxx\naa\nbb', 'aa\nbb', 0, 5)).toEqual([
      { from: 9, to: 14 }
    ]);
  });

  it('returns no highlight when the selected occurrence is the only occurrence',
  /**
 * テスト「returns no highlight when the selected occurrence is the only occurrence」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(findExactSelectionMatches('only once', 'only', 0, 4)).toEqual([]);
  });

  it('respects the explicit match limit without changing match order',
  /**
 * テスト「respects the explicit match limit without changing match order」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(findExactSelectionMatches('aaaaa', 'a', 0, 1, 2)).toEqual([
      { from: 1, to: 2 },
      { from: 2, to: 3 }
    ]);
  });
});

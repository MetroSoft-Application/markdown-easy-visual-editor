/**
 * @file resource-check.test.ts
 * 実行境界: テスト実行環境。
 * 責務: 現行実装の仕様と回帰条件を検証する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テスト用のモック、ブラウザー、ファイルを必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { describe, expect, it } from 'vitest';
import { decodeLocalResourceSource, isMissingResourceError } from '../src/extension/resourceCheck';

describe('Local resource checks',
/**
 * テスト「Local resource checks」の前提条件を設定し、期待結果を検証するコールバックです。
 * @returns テストの前提条件と期待結果を検証し、値を返しません。
 */
() => {
  it('normalizes URL-encoded paths and removes query and fragment',
  /**
 * テスト「normalizes URL-encoded paths and removes query and fragment」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(decodeLocalResourceSource('docs/spec%20v1.md?view=1#details')).toBe('docs/spec v1.md');
    expect(decodeLocalResourceSource('docs/broken%ZZ.md')).toBe('docs/broken%ZZ.md');
  });

  it('distinguishes missing resources from inspection failures',
  /**
 * テスト「distinguishes missing resources from inspection failures」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(isMissingResourceError({ code: 'FileNotFound' })).toBe(true);
    expect(isMissingResourceError({ code: 'ENOENT' })).toBe(true);
    expect(isMissingResourceError(new Error('Permission denied'))).toBe(false);
    expect(isMissingResourceError({ code: 'NoPermissions' })).toBe(false);
  });
});

/**
 * @file htmlSettings.test.ts
 * 実行境界: テスト実行環境。
 * 責務: 現行実装の仕様と回帰条件を検証する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テスト用のモック、ブラウザー、ファイルを必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HTML_EXPORT_SETTINGS,
  DEFAULT_HTML_EXPORT_OPTIONS,
  mergeHtmlExportOptions,
  normalizeHtmlExportSettings,
} from '../src/shared/protocol';

describe('HTML export settings',
/**
 * テスト「HTML export settings」の前提条件を設定し、期待結果を検証するコールバックです。
 * @returns テストの前提条件と期待結果を検証し、値を返しません。
 */
() => {
  it('uses the shared defaults for missing or invalid persisted values',
  /**
 * テスト「uses the shared defaults for missing or invalid persisted values」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(normalizeHtmlExportSettings(undefined)).toEqual(DEFAULT_HTML_EXPORT_SETTINGS);
    expect(normalizeHtmlExportSettings({ embedImages: 'yes' })).toEqual(DEFAULT_HTML_EXPORT_SETTINGS);
  });

  it('preserves all global HTML export choices',
  /**
 * テスト「preserves all global HTML export choices」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(normalizeHtmlExportSettings({
      embedImages: true,
      convertLinkedMarkdown: true,
      saveWithoutDialog: false,
    })).toEqual({
      embedImages: true,
      convertLinkedMarkdown: true,
      saveWithoutDialog: false,
    });
  });

  it('applies the global saveWithoutDialog choice to export options',
  /**
 * テスト「applies the global saveWithoutDialog choice to export options」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(mergeHtmlExportOptions(
      { ...DEFAULT_HTML_EXPORT_OPTIONS, saveWithoutDialog: false },
      { embedImages: true, convertLinkedMarkdown: true, saveWithoutDialog: true },
    )).toEqual({
      embedImages: true,
      convertLinkedMarkdown: true,
      saveWithoutDialog: true,
    });
    expect(mergeHtmlExportOptions(
      { ...DEFAULT_HTML_EXPORT_OPTIONS, saveWithoutDialog: true },
      { embedImages: true, convertLinkedMarkdown: false, saveWithoutDialog: false },
    ).saveWithoutDialog).toBe(false);
  });
});

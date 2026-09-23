/**
 * @file fontFamily.test.ts
 * 実行境界: テスト実行環境。
 * 責務: 現行実装の仕様と回帰条件を検証する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テスト用のモック、ブラウザー、ファイルを必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_FONT_FAMILY_STACK,
    fontFamilyForCss,
    normalizeFontFamily,
    normalizeFontFamilySettings
} from '../src/shared/fontFamily';

describe('font family settings',
/**
 * テスト「font family settings」の前提条件を設定し、期待結果を検証するコールバックです。
 * @returns テストの前提条件と期待結果を検証し、値を返しません。
 */
() => {
    it('normalizes values without changing valid family lists',
    /**
 * テスト「normalizes values without changing valid family lists」の前提条件を設定し、期待結果を検証するコールバックです。
     * @returns テストの前提条件と期待結果を検証し、値を返しません。
     */
    () => {
        expect(normalizeFontFamily('  "Test Font", sans-serif  ')).toBe('"Test Font", sans-serif');
        expect(normalizeFontFamily('Test; color: red')).toBe('');
        expect(normalizeFontFamily('line\nfeed')).toBe('');
        expect(normalizeFontFamily('a'.repeat(513))).toBe('');
        expect(fontFamilyForCss('', 'fallback')).toBe('fallback');
        expect(fontFamilyForCss('Test; color: red', DEFAULT_FONT_FAMILY_STACK)).toBe(
            DEFAULT_FONT_FAMILY_STACK
        );
        expect(fontFamilyForCss('Missing Font', DEFAULT_FONT_FAMILY_STACK)).toBe(
            `Missing Font, ${DEFAULT_FONT_FAMILY_STACK}`
        );
        expect(fontFamilyForCss(DEFAULT_FONT_FAMILY_STACK, DEFAULT_FONT_FAMILY_STACK)).toBe(
            DEFAULT_FONT_FAMILY_STACK
        );
    });

    it('normalizes independently configured editor and preview families',
    /**
 * テスト「normalizes independently configured editor and preview families」の前提条件を設定し、期待結果を検証するコールバックです。
     * @returns テストの前提条件と期待結果を検証し、値を返しません。
     */
    () => {
        expect(normalizeFontFamilySettings({
            editorFontFamily: ' Editor Font ',
            previewFontFamily: 'Preview Font'
        })).toEqual({
            editorFontFamily: 'Editor Font',
            previewFontFamily: 'Preview Font'
        });
    });
});

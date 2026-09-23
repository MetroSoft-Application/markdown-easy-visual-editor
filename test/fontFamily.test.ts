/**
 * @fileoverview fontfamily・テストの回帰の仕様と回帰条件を検証する。失敗時は期待値と実装差分を示す。
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
     * 「font family settings」の仕様と回帰条件を検証するテストケース。
     * @returns テストケースを実行し、値は返さない。
     */
    () => {
        it('normalizes values without changing valid family lists',
            /**
             * 「normalizes values without changing valid family lists」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
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
             * 「normalizes independently configured editor and preview families」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
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

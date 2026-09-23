/**
 * @fileoverview HTML設定・テストの回帰の仕様と回帰条件を検証する。失敗時は期待値と実装差分を示す。
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
     * 「HTML export settings」の仕様と回帰条件を検証するテストケース。
     * @returns テストケースを実行し、値は返さない。
     */
    () => {
        it('uses the shared defaults for missing or invalid persisted values',
            /**
             * 「uses the shared defaults for missing or invalid persisted values」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(normalizeHtmlExportSettings(undefined)).toEqual(DEFAULT_HTML_EXPORT_SETTINGS);
                expect(normalizeHtmlExportSettings({ embedImages: 'yes' })).toEqual(DEFAULT_HTML_EXPORT_SETTINGS);
            });

        it('preserves all global HTML export choices',
            /**
             * 「preserves all global HTML export choices」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
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
             * 「applies the global saveWithoutDialog choice to export options」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
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

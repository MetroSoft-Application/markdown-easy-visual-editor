/**
 * @fileoverview リソース・check・テストの回帰の仕様と回帰条件を検証する。失敗時は期待値と実装差分を示す。
 */
import { describe, expect, it } from 'vitest';
import { decodeLocalResourceSource, isMissingResourceError } from '../src/extension/resourceCheck';

describe('Local resource checks',
    /**
     * 「Local resource checks」の仕様と回帰条件を検証するテストケース。
     * @returns テストケースを実行し、値は返さない。
     */
    () => {
        it('normalizes URL-encoded paths and removes query and fragment',
            /**
             * 「normalizes URL-encoded paths and removes query and fragment」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(decodeLocalResourceSource('docs/spec%20v1.md?view=1#details')).toBe('docs/spec v1.md');
                expect(decodeLocalResourceSource('docs/broken%ZZ.md')).toBe('docs/broken%ZZ.md');
            });

        it('distinguishes missing resources from inspection failures',
            /**
             * 「distinguishes missing resources from inspection failures」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(isMissingResourceError({ code: 'FileNotFound' })).toBe(true);
                expect(isMissingResourceError({ code: 'ENOENT' })).toBe(true);
                expect(isMissingResourceError(new Error('Permission denied'))).toBe(false);
                expect(isMissingResourceError({ code: 'NoPermissions' })).toBe(false);
            });
    });

/**
 * @fileoverview imagedirectory・テストの回帰の仕様と回帰条件を検証する。失敗時は期待値と実装差分を示す。
 */
import { describe, expect, it } from 'vitest';
import { normalizeImageDirectoryRule, resolveImageDirectoryRule } from '../src/shared/imageDirectory';

describe('image directory rules',
    /**
     * 「image directory rules」の仕様と回帰条件を検証するテストケース。
     * @returns テストケースを実行し、値は返さない。
     */
    () => {
        it('normalizes relative paths and expands the document basename',
            /**
             * 「normalizes relative paths and expands the document basename」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(normalizeImageDirectoryRule(' ./assets\\${documentBasename}/ ')).toBe('assets/${documentBasename}');
                expect(resolveImageDirectoryRule('assets/${documentBasename}', 'guide')).toBe('assets/guide');
            });

        it('allows saving beside the Markdown document',
            /**
             * 「allows saving beside the Markdown document」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(resolveImageDirectoryRule('.', 'guide')).toBe('.');
            });

        it('rejects absolute paths, traversal, URLs, and unsupported variables',
            /**
             * 「rejects absolute paths, traversal, URLs, and unsupported variables」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(normalizeImageDirectoryRule('../images')).toBeUndefined();
                expect(normalizeImageDirectoryRule('C:\\images')).toBeUndefined();
                expect(normalizeImageDirectoryRule('/images')).toBeUndefined();
                expect(normalizeImageDirectoryRule('https://example.com/images')).toBeUndefined();
                expect(normalizeImageDirectoryRule('assets/${workspaceFolder}')).toBeUndefined();
            });
    });

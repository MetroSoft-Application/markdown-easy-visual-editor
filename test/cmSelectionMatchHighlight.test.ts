/**
 * @fileoverview cmselectionmatchhighlight・テストの回帰の仕様と回帰条件を検証する。失敗時は期待値と実装差分を示す。
 */
import { describe, expect, it } from 'vitest';
import { findExactSelectionMatches } from '../src/webview/cmSelectionMatchHighlight';

describe('findExactSelectionMatches',
    /**
     * 「findExactSelectionMatches」の仕様と回帰条件を検証するテストケース。
     * @returns テストケースを実行し、値は返さない。
     */
    () => {
        it('matches the exact selected text case-sensitively and excludes the selection itself',
            /**
             * 「matches the exact selected text case-sensitively and excludes the selection itself」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(findExactSelectionMatches('foo Foo foo', 'foo', 0, 3)).toEqual([
                    { from: 8, to: 11 }
                ]);
            });

        it('preserves whitespace instead of trimming the selected text',
            /**
             * 「preserves whitespace instead of trimming the selected text」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(findExactSelectionMatches('foo foo  foo ', 'foo ', 0, 4)).toEqual([
                    { from: 4, to: 8 },
                    { from: 9, to: 13 }
                ]);
            });

        it('finds overlapping occurrences',
            /**
             * 「finds overlapping occurrences」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(findExactSelectionMatches('banana', 'ana', 1, 4)).toEqual([
                    { from: 3, to: 6 }
                ]);
            });

        it('supports multiline selections without changing line breaks',
            /**
             * 「supports multiline selections without changing line breaks」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(findExactSelectionMatches('aa\nbb\nxx\naa\nbb', 'aa\nbb', 0, 5)).toEqual([
                    { from: 9, to: 14 }
                ]);
            });

        it('returns no highlight when the selected occurrence is the only occurrence',
            /**
             * 「returns no highlight when the selected occurrence is the only occurrence」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(findExactSelectionMatches('only once', 'only', 0, 4)).toEqual([]);
            });

        it('respects the explicit match limit without changing match order',
            /**
             * 「respects the explicit match limit without changing match order」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(findExactSelectionMatches('aaaaa', 'a', 0, 1, 2)).toEqual([
                    { from: 1, to: 2 },
                    { from: 2, to: 3 }
                ]);
            });
    });

/**
 * @fileoverview スクロール位置復元・テストの回帰の仕様と回帰条件を検証する。失敗時は期待値と実装差分を示す。
 */
import { describe, expect, it } from 'vitest';
import { getScrollRatio, getScrollTopForRatio } from '../src/shared/scroll';

describe('scroll synchronization ratio fallback',
    /**
     * 「scroll synchronization ratio fallback」の仕様と回帰条件を検証するテストケース。
     * @returns テストケースを実行し、値は返さない。
     */
    () => {
        it('uses source anchors for ordinary interior positions',
            /**
             * 「uses source anchors for ordinary interior positions」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(getScrollRatio(250, 1200, 200)).toBeUndefined();
                expect(getScrollRatio(500, 1200, 200)).toBeUndefined();
            });

        it('keeps ratio synchronization at the document boundaries',
            /**
             * 「keeps ratio synchronization at the document boundaries」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(getScrollRatio(-10, 1200, 200)).toBe(0);
                expect(getScrollRatio(2000, 1200, 200)).toBe(1);
                expect(getScrollRatio(0, 200, 200)).toBe(0);
            });

        it('maps an explicit ratio back to the matching scroll position',
            /**
             * 「maps an explicit ratio back to the matching scroll position」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(getScrollTopForRatio(0.25, 1200, 200)).toBe(250);
                expect(getScrollTopForRatio(-1, 1200, 200)).toBe(0);
                expect(getScrollTopForRatio(2, 1200, 200)).toBe(1000);
                expect(getScrollTopForRatio(0.75, 200, 200)).toBe(0);
            });
    });

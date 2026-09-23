/**
 * @fileoverview canonicaltext・テストの回帰の仕様と回帰条件を検証する。失敗時は期待値と実装差分を示す。
 */
import { describe, expect, it } from 'vitest';
import {
    canonicalOffsetAt,
    canonicalPositionAt,
    canonicalizeContentChanges,
    fromCanonicalText,
    indexCanonicalText,
    materializeCanonicalChanges,
    toCanonicalText
} from '../src/shared/canonicalText';
import { applyTextChanges } from '../src/shared/textChanges';

describe('canonical text synchronization boundary',
    /**
     * 「canonical text synchronization boundary」の仕様と回帰条件を検証するテストケース。
     * @returns テストケースを実行し、値は返さない。
     */
    () => {
        it('normalizes physical line endings to one LF coordinate space',
            /**
             * 「normalizes physical line endings to one LF coordinate space」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(toCanonicalText('a\r\nb\rc\n')).toBe('a\nb\nc\n');
                expect(fromCanonicalText('a\nb\n', '\r\n')).toBe('a\r\nb\r\n');
            });

        it('maps offsets through line/character positions independently of CRLF width',
            /**
             * 「maps offsets through line/character positions independently of CRLF width」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const text = 'ab\ncd\nef';
                expect(canonicalOffsetAt(text, { line: 0, character: 2 })).toBe(2);
                expect(canonicalOffsetAt(text, { line: 1, character: 1 })).toBe(4);
                expect(canonicalPositionAt(text, 4)).toEqual({ line: 1, character: 1 });
                expect(canonicalPositionAt(text, text.length)).toEqual({ line: 2, character: 2 });
            });

        it('indexes one large document once for a batch of disjoint changes',
            /**
             * 「indexes one large document once for a batch of disjoint changes」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const lines = Array.from({ length: 2_000 },
                    /**
                     * canonicaltext・テストの回帰の前提条件を準備し、回帰条件を検証するテストケース。
                     * @param _ - テスト本体を実行するコールバック。
                     * @param index - テスト本体を実行するコールバック。
                     * @returns テストケースを実行し、値は返さない。
                     */
                    (_, index) => `line-${index}`);
                const previous = lines.join('\n');
                const contentChanges = Array.from({ length: 200 },
                    /**
                     * canonicaltext・テストの回帰のコールバックとして・を処理する。
                     * @param _ - 引数位置を維持するための未使用値。
                     * @param index - 配列・行列・文字列の要素位置を示す番号。
                     * @returns canonicaltext・テストの回帰のコールバックが生成する結果。
                     */
                    (_, index) => {
                        const line = index * 10;
                        return {
                            range: {
                                start: { line, character: 0 },
                                end: { line, character: 0 }
                            },
                            text: `${index}:`
                        };
                    });

                const changes = canonicalizeContentChanges(previous, contentChanges);
                expect(changes).toHaveLength(contentChanges.length);
                expect(changes[0]).toEqual({ rangeOffset: 0, rangeLength: 0, text: '0:' });
                expect(changes.at(-1)?.rangeOffset).toBe(previous.indexOf('line-1990'));
                expect(applyTextChanges(previous, changes)).toContain('199:line-1990');
            });

        it('uses the indexed coordinate boundary on newline characters and the final empty line',
            /**
             * 「uses the indexed coordinate boundary on newline characters and the final empty line」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const index = indexCanonicalText('ab\n');
                expect(index.positionAt(2)).toEqual({ line: 0, character: 2 });
                expect(index.positionAt(3)).toEqual({ line: 1, character: 0 });
                expect(index.offsetAt({ line: 1, character: 0 })).toBe(3);
            });

        it('reduces the first physical CRLF in an empty document to exactly one logical newline',
            /**
             * 「reduces the first physical CRLF in an empty document to exactly one logical newline」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const previous = '';
                const changes = canonicalizeContentChanges(previous, [{
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 0 }
                    },
                    text: '\r\n'
                }]);

                expect(changes).toEqual([{ rangeOffset: 0, rangeLength: 0, text: '\n' }]);
                expect(applyTextChanges(previous, changes)).toBe('\n');
            });

        it('makes the reported CRLF result equal to the Webview LF expectation instead of a competing insertion',
            /**
             * 「makes the reported CRLF result equal to the Webview LF expectation instead of a competing insertion」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const base = '';
                const webviewChange = [{ rangeOffset: 0, rangeLength: 0, text: '\n' }];
                const expected = applyTextChanges(base, webviewChange);
                const workspaceEdits = materializeCanonicalChanges(base, webviewChange, '\r\n');
                expect(workspaceEdits).toEqual([{
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 0 }
                    },
                    text: '\r\n'
                }]);
                const physicalDocumentAfterWorkspaceEdit = workspaceEdits[0].text;
                const hostResult = toCanonicalText(physicalDocumentAfterWorkspaceEdit);
                const hostChanges = canonicalizeContentChanges(base, [{
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 0 }
                    },
                    text: physicalDocumentAfterWorkspaceEdit
                }]);

                expect(hostResult).toBe(expected);
                expect(hostChanges).toEqual(webviewChange);
                expect(applyTextChanges(base, hostChanges)).toBe(expected);
            });

        it('treats a physical EOL-only conversion as no semantic text change',
            /**
             * 「treats a physical EOL-only conversion as no semantic text change」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(toCanonicalText('a\r\nb\r\n')).toBe('a\nb\n');
                expect(toCanonicalText('a\nb\n')).toBe('a\nb\n');
            });

        it('converts external CRLF edits into the same LF coordinate space',
            /**
             * 「converts external CRLF edits into the same LF coordinate space」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const previous = 'alpha\nbeta';
                const changes = canonicalizeContentChanges(previous, [{
                    range: {
                        start: { line: 1, character: 0 },
                        end: { line: 1, character: 4 }
                    },
                    text: 'BETA\r\nnext'
                }]);

                expect(changes).toEqual([{
                    rangeOffset: 6,
                    rangeLength: 4,
                    text: 'BETA\nnext'
                }]);
                expect(applyTextChanges(previous, changes)).toBe('alpha\nBETA\nnext');
            });
    });

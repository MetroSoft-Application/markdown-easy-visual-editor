/**
 * @file canonicalText.test.ts
 * 実行境界: テスト実行環境。
 * 責務: 現行実装の仕様と回帰条件を検証する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テスト用のモック、ブラウザー、ファイルを必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
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
 * テスト「canonical text synchronization boundary」の前提条件を設定し、期待結果を検証するコールバックです。
 * @returns テストの前提条件と期待結果を検証し、値を返しません。
 */
() => {
    it('normalizes physical line endings to one LF coordinate space',
    /**
 * テスト「normalizes physical line endings to one LF coordinate space」の前提条件を設定し、期待結果を検証するコールバックです。
     * @returns テストの前提条件と期待結果を検証し、値を返しません。
     */
    () => {
        expect(toCanonicalText('a\r\nb\rc\n')).toBe('a\nb\nc\n');
        expect(fromCanonicalText('a\nb\n', '\r\n')).toBe('a\r\nb\r\n');
    });

    it('maps offsets through line/character positions independently of CRLF width',
    /**
 * テスト「maps offsets through line/character positions independently of CRLF width」の前提条件を設定し、期待結果を検証するコールバックです。
     * @returns テストの前提条件と期待結果を検証し、値を返しません。
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
 * テスト「indexes one large document once for a batch of disjoint changes」の前提条件を設定し、期待結果を検証するコールバックです。
     * @returns テストデータまたは検証処理が生成した値を返します。
     */
    () => {
        const lines = Array.from({ length: 2_000 },
        /**
 * テスト「indexes one large document once for a batch of disjoint changes」の前提条件を設定し、期待結果を検証するコールバックです。
         * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
         * @param index 本文、表、配列内の対象位置を示すインデックスです。
         * @returns 配列要素または初期値を返します。
         */
        (_, index) => `line-${index}`);
        const previous = lines.join('\n');
        const contentChanges = Array.from({ length: 200 },
        /**
 * テスト「indexes one large document once for a batch of disjoint changes」の前提条件を設定し、期待結果を検証するコールバックです。
         * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
         * @param index 本文、表、配列内の対象位置を示すインデックスです。
         * @returns 配列要素または初期値を返します。
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
 * テスト「uses the indexed coordinate boundary on newline characters and the final empty line」の前提条件を設定し、期待結果を検証するコールバックです。
     * @returns テストの前提条件と期待結果を検証し、値を返しません。
     */
    () => {
        const index = indexCanonicalText('ab\n');
        expect(index.positionAt(2)).toEqual({ line: 0, character: 2 });
        expect(index.positionAt(3)).toEqual({ line: 1, character: 0 });
        expect(index.offsetAt({ line: 1, character: 0 })).toBe(3);
    });

    it('reduces the first physical CRLF in an empty document to exactly one logical newline',
    /**
 * テスト「reduces the first physical CRLF in an empty document to exactly one logical newline」の前提条件を設定し、期待結果を検証するコールバックです。
     * @returns テストの前提条件と期待結果を検証し、値を返しません。
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
 * テスト「makes the reported CRLF result equal to the Webview LF expectation instead of a competing insertion」の前提条件を設定し、期待結果を検証するコールバックです。
     * @returns テストの前提条件と期待結果を検証し、値を返しません。
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
 * テスト「treats a physical EOL-only conversion as no semantic text change」の前提条件を設定し、期待結果を検証するコールバックです。
     * @returns テストの前提条件と期待結果を検証し、値を返しません。
     */
    () => {
        expect(toCanonicalText('a\r\nb\r\n')).toBe('a\nb\n');
        expect(toCanonicalText('a\nb\n')).toBe('a\nb\n');
    });

    it('converts external CRLF edits into the same LF coordinate space',
    /**
 * テスト「converts external CRLF edits into the same LF coordinate space」の前提条件を設定し、期待結果を検証するコールバックです。
     * @returns テストの前提条件と期待結果を検証し、値を返しません。
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

import { describe, expect, it } from 'vitest';
import {
    canonicalOffsetAt,
    canonicalPositionAt,
    canonicalizeContentChanges,
    fromCanonicalText,
    toCanonicalText
} from '../src/shared/canonicalText';
import { applyTextChanges } from '../src/shared/textChanges';

describe('canonical text synchronization boundary', () => {
    it('normalizes physical line endings to one LF coordinate space', () => {
        expect(toCanonicalText('a\r\nb\rc\n')).toBe('a\nb\nc\n');
        expect(fromCanonicalText('a\nb\n', '\r\n')).toBe('a\r\nb\r\n');
    });

    it('maps offsets through line/character positions independently of CRLF width', () => {
        const text = 'ab\ncd\nef';
        expect(canonicalOffsetAt(text, { line: 0, character: 2 })).toBe(2);
        expect(canonicalOffsetAt(text, { line: 1, character: 1 })).toBe(4);
        expect(canonicalPositionAt(text, 4)).toEqual({ line: 1, character: 1 });
        expect(canonicalPositionAt(text, text.length)).toEqual({ line: 2, character: 2 });
    });

    it('reduces the first physical CRLF in an empty document to exactly one logical newline', () => {
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

    it('makes the reported CRLF result equal to the Webview LF expectation instead of a competing insertion', () => {
        const base = '';
        const webviewChange = [{ rangeOffset: 0, rangeLength: 0, text: '\n' }];
        const expected = applyTextChanges(base, webviewChange);
        const physicalDocumentAfterWorkspaceEdit = '\r\n';
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

    it('treats a physical EOL-only conversion as no semantic text change', () => {
        expect(toCanonicalText('a\r\nb\r\n')).toBe('a\nb\n');
        expect(toCanonicalText('a\nb\n')).toBe('a\nb\n');
    });

    it('converts external CRLF edits into the same LF coordinate space', () => {
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

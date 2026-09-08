import type { TextChange } from './protocol';
import { validateTextChanges } from './textChanges';

export interface TextPositionLike {
    line: number;
    character: number;
}

export interface TextRangeLike {
    start: TextPositionLike;
    end: TextPositionLike;
}

export interface TextContentChangeLike {
    range: TextRangeLike;
    text: string;
}

/** 同期プロトコルで扱う本文をLFへ正規化する。 */
export function toCanonicalText(value: string): string {
    return value.replace(/\r\n?|\n/g, '\n');
}

/** LF正規化済み本文を指定EOLへ変換する。 */
export function fromCanonicalText(value: string, eol: '\n' | '\r\n'): string {
    return toCanonicalText(value).replace(/\n/g, eol);
}

/** LF正規化済み本文の行・桁位置を本文オフセットへ変換する。 */
export function canonicalOffsetAt(
    canonicalText: string,
    position: TextPositionLike
): number {
    if (!Number.isInteger(position.line) || !Number.isInteger(position.character)
        || position.line < 0 || position.character < 0) {
        throw new RangeError(`Invalid text position: ${position.line}:${position.character}`);
    }
    let line = 0;
    let lineStart = 0;
    while (line < position.line) {
        const end = canonicalText.indexOf('\n', lineStart);
        if (end < 0) throw new RangeError(`Line is outside canonical text: ${position.line}`);
        lineStart = end + 1;
        line += 1;
    }
    const lineEnd = canonicalText.indexOf('\n', lineStart);
    const contentEnd = lineEnd < 0 ? canonicalText.length : lineEnd;
    if (lineStart + position.character > contentEnd) {
        throw new RangeError(`Character is outside canonical line: ${position.line}:${position.character}`);
    }
    return lineStart + position.character;
}

/** LF正規化済み本文のオフセットを行・桁位置へ変換する。 */
export function canonicalPositionAt(
    canonicalText: string,
    offset: number
): TextPositionLike {
    if (!Number.isInteger(offset) || offset < 0 || offset > canonicalText.length) {
        throw new RangeError(`Invalid canonical text offset: ${offset}`);
    }
    let line = 0;
    let lineStart = 0;
    while (true) {
        const end = canonicalText.indexOf('\n', lineStart);
        if (end < 0 || offset <= end) {
            return { line, character: offset - lineStart };
        }
        line += 1;
        lineStart = end + 1;
    }
}

/**
 * VS CodeのcontentChangesをLF座標のTextChangeへ変換する。
 * rangeOffset/rangeLengthはCRLF幅に依存するため使わず、Positionから再計算する。
 */
export function canonicalizeContentChanges(
    previousCanonicalText: string,
    contentChanges: readonly TextContentChangeLike[]
): TextChange[] {
    const changes = contentChanges.map((change) => {
        const from = canonicalOffsetAt(previousCanonicalText, change.range.start);
        const to = canonicalOffsetAt(previousCanonicalText, change.range.end);
        return {
            rangeOffset: from,
            rangeLength: to - from,
            text: toCanonicalText(change.text)
        };
    });
    validateTextChanges(changes, previousCanonicalText.length);
    return changes;
}

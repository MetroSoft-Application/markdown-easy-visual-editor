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

export interface CanonicalWorkspaceEditLike {
    range: TextRangeLike;
    text: string;
}

export interface CanonicalTextPositionIndex {
    offsetAt(position: TextPositionLike): number;
    positionAt(offset: number): TextPositionLike;
}

/** 同期プロトコルで扱う本文をLFへ正規化する。 */
export function toCanonicalText(value: string): string {
    return value.replace(/\r\n?|\n/g, '\n');
}

/** LF正規化済み本文を指定EOLへ変換する。 */
export function fromCanonicalText(value: string, eol: '\n' | '\r\n'): string {
    return toCanonicalText(value).replace(/\n/g, eol);
}

/**
 * LF本文の行開始位置を一度だけ構築し、複数の位置変換を対数時間で処理する。
 */
export function indexCanonicalText(canonicalText: string): CanonicalTextPositionIndex {
    const lineStarts = [0];
    let newline = canonicalText.indexOf('\n');
    while (newline >= 0) {
        lineStarts.push(newline + 1);
        newline = canonicalText.indexOf('\n', newline + 1);
    }

    return {
        offsetAt(position: TextPositionLike): number {
            if (!Number.isInteger(position.line) || !Number.isInteger(position.character)
                || position.line < 0 || position.character < 0) {
                throw new RangeError(`Invalid text position: ${position.line}:${position.character}`);
            }
            const lineStart = lineStarts[position.line];
            if (lineStart === undefined) {
                throw new RangeError(`Line is outside canonical text: ${position.line}`);
            }
            const nextLineStart = lineStarts[position.line + 1];
            const contentEnd = nextLineStart === undefined ? canonicalText.length : nextLineStart - 1;
            if (lineStart + position.character > contentEnd) {
                throw new RangeError(`Character is outside canonical line: ${position.line}:${position.character}`);
            }
            return lineStart + position.character;
        },
        positionAt(offset: number): TextPositionLike {
            if (!Number.isInteger(offset) || offset < 0 || offset > canonicalText.length) {
                throw new RangeError(`Invalid canonical text offset: ${offset}`);
            }
            let low = 0;
            let high = lineStarts.length;
            while (low < high) {
                const middle = low + Math.floor((high - low) / 2);
                if (lineStarts[middle] <= offset) low = middle + 1;
                else high = middle;
            }
            const line = Math.max(0, low - 1);
            return { line, character: offset - lineStarts[line] };
        }
    };
}

/** LF正規化済み本文の行・桁位置を本文オフセットへ変換する。 */
export function canonicalOffsetAt(
    canonicalText: string,
    position: TextPositionLike
): number {
    return indexCanonicalText(canonicalText).offsetAt(position);
}

/** LF正規化済み本文のオフセットを行・桁位置へ変換する。 */
export function canonicalPositionAt(
    canonicalText: string,
    offset: number
): TextPositionLike {
    return indexCanonicalText(canonicalText).positionAt(offset);
}

/**
 * VS CodeのcontentChangesをLF座標のTextChangeへ変換する。
 * rangeOffset/rangeLengthはCRLF幅に依存するため使わず、Positionから再計算する。
 */
export function canonicalizeContentChanges(
    previousCanonicalText: string,
    contentChanges: readonly TextContentChangeLike[]
): TextChange[] {
    const positionIndex = indexCanonicalText(previousCanonicalText);
    const changes = contentChanges.map((change) => {
        const from = positionIndex.offsetAt(change.range.start);
        const to = positionIndex.offsetAt(change.range.end);
        return {
            rangeOffset: from,
            rangeLength: to - from,
            text: toCanonicalText(change.text)
        };
    });
    validateTextChanges(changes, previousCanonicalText.length);
    return changes;
}

/** LF同期差分を、VS Codeへ渡す行・桁範囲と物理EOL本文へ変換する。 */
export function materializeCanonicalChanges(
    canonicalBaseText: string,
    changes: readonly TextChange[],
    eol: '\n' | '\r\n'
): CanonicalWorkspaceEditLike[] {
    validateTextChanges(changes, canonicalBaseText.length);
    const positionIndex = indexCanonicalText(canonicalBaseText);
    return changes.map((change) => ({
        range: {
            start: positionIndex.positionAt(change.rangeOffset),
            end: positionIndex.positionAt(change.rangeOffset + change.rangeLength)
        },
        text: fromCanonicalText(change.text, eol)
    }));
}

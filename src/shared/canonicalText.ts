/**
 * @fileoverview 改行形式を正規化した本文と元の位置の対応を計算し、HostとWebviewの変更範囲を同じ座標系で扱う。
 */
import type { TextChange } from './protocol';
import { validateTextChanges } from './textChanges';

/**
 * canonicaltextで共有するデータ形状を表すインターフェース。
 */
export interface TextPositionLike {

    /**
     * canonicaltextの位置・寸法・件数・時間を表す数値。
     */
    line: number;

    /**
     * canonicaltextのcharacterを表す数値。
     */
    character: number;
}

/**
 * canonicaltextで共有するデータ形状を表すインターフェース。
 */
export interface TextRangeLike {

    /**
     * canonicaltextのstartに関する状態または設定。
     */
    start: TextPositionLike;

    /**
     * canonicaltextのendに関する状態または設定。
     */
    end: TextPositionLike;
}

/**
 * canonicaltextで共有するデータ形状を表すインターフェース。
 */
export interface TextContentChangeLike {

    /**
     * canonicaltextのrangeに関する状態または設定。
     */
    range: TextRangeLike;

    /**
     * 表示・解析・変換の対象となる本文。
     */
    text: string;
}

/**
 * canonicaltextで共有するデータ形状を表すインターフェース。
 */
export interface CanonicalWorkspaceEditLike {

    /**
     * canonicaltextのrangeに関する状態または設定。
     */
    range: TextRangeLike;

    /**
     * 表示・解析・変換の対象となる本文。
     */
    text: string;
}

/**
 * canonicaltextで共有するデータ形状を表すインターフェース。
 */
export interface CanonicalTextPositionIndex {
    /**
     * canonicaltextのoffset・atを処理し、呼び出し側へ結果または副作用を返す。
     * @param position - canonicaltextの位置・寸法・件数・時間を表す数値。
     * @returns canonicaltextで利用する文字列。
     */
    offsetAt(position: TextPositionLike): number;
    /**
     * canonicaltextのposition・atを処理し、呼び出し側へ結果または副作用を返す。
     * @param offset - canonicaltextの位置・寸法・件数・時間を表す数値。
     * @returns canonicaltextで利用する文字列。
     */
    positionAt(offset: number): TextPositionLike;
}

/**
 * canonicaltextのto・canonical・textを処理し、呼び出し側へ結果または副作用を返す。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns canonicaltextで利用する文字列。
 */
export function toCanonicalText(value: string): string {
    return value.replace(/\r\n?|\n/g, '\n');
}

/**
 * canonicaltextのfrom・canonical・textを処理し、呼び出し側へ結果または副作用を返す。
 * @param value - 検証・変換・保存の対象となる値。
 * @param eol - canonicaltextへ渡す入力。
 * @returns canonicaltextで利用する文字列。
 */
export function fromCanonicalText(value: string, eol: '\n' | '\r\n'): string {
    return toCanonicalText(value).replace(/\n/g, eol);
}

/**
 * canonicaltextのindex・canonical・textを処理し、呼び出し側へ結果または副作用を返す。
 * @param canonicalText - canonicaltextで扱う文字列または本文。
 * @returns canonicaltextのindex・canonical・textが生成する結果。
 */
export function indexCanonicalText(canonicalText: string): CanonicalTextPositionIndex {
    const lineStarts = [0];
    let newline = canonicalText.indexOf('\n');
    while (newline >= 0) {
        lineStarts.push(newline + 1);
        newline = canonicalText.indexOf('\n', newline + 1);
    }

    return {
        /**
         * canonicaltextのoffset・atを処理し、呼び出し側へ結果または副作用を返す。
         * @param position - canonicaltextの位置・寸法・件数・時間を表す数値。
         * @returns canonicaltextで利用する数値。
         */
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
        /**
         * canonicaltextのposition・atを処理し、呼び出し側へ結果または副作用を返す。
         * @param offset - canonicaltextの位置・寸法・件数・時間を表す数値。
         * @returns canonicaltextのposition・atが生成する結果。
         */
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

/**
 * canonicaltextの条件を判定する。
 * @param canonicalText - canonicaltextで扱う文字列または本文。
 * @param position - canonicaltextの位置・寸法・件数・時間を表す数値。
 * @returns 条件が成立したかを示す真偽値。
 */
export function canonicalOffsetAt(
    canonicalText: string,
    position: TextPositionLike
): number {
    return indexCanonicalText(canonicalText).offsetAt(position);
}

/**
 * canonicaltextの条件を判定する。
 * @param canonicalText - canonicaltextで扱う文字列または本文。
 * @param offset - canonicaltextの位置・寸法・件数・時間を表す数値。
 * @returns 条件が成立したかを示す真偽値。
 */
export function canonicalPositionAt(
    canonicalText: string,
    offset: number
): TextPositionLike {
    return indexCanonicalText(canonicalText).positionAt(offset);
}

/**
 * canonicaltextの入力を許可された形式へ整える。
 * @param previousCanonicalText - canonicaltextで扱う文字列または本文。
 * @param contentChanges - canonicaltextで扱う文字列または本文。
 * @returns 条件が成立したかを示す真偽値。
 */
export function canonicalizeContentChanges(
    previousCanonicalText: string,
    contentChanges: readonly TextContentChangeLike[]
): TextChange[] {
    const positionIndex = indexCanonicalText(previousCanonicalText);
    const changes = contentChanges.map(
        /**
         * 各changeから範囲を取り出して一覧化する。
         * @param change - changeの範囲を参照する走査対象。
         * @returns 範囲を取り出した変換結果の一覧。
         */
        (change) => {
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

/**
 * canonicaltextのmaterialize・canonical・changesを処理し、呼び出し側へ結果または副作用を返す。
 * @param canonicalBaseText - canonicaltextで扱う文字列または本文。
 * @param changes - 本文へ適用する変更範囲の一覧。
 * @param eol - canonicaltextへ渡す入力。
 * @returns canonicaltextに対応する要素の一覧。
 */
export function materializeCanonicalChanges(
    canonicalBaseText: string,
    changes: readonly TextChange[],
    eol: '\n' | '\r\n'
): CanonicalWorkspaceEditLike[] {
    validateTextChanges(changes, canonicalBaseText.length);
    const positionIndex = indexCanonicalText(canonicalBaseText);
    return changes.map(
        /**
         * 各changeからrange・offsetを取り出して一覧化する。
         * @param change - changeのrange・offsetを参照する走査対象。
         * @returns range・offsetを取り出した変換結果の一覧。
         */
        (change) => ({
            range: {
                start: positionIndex.positionAt(change.rangeOffset),
                end: positionIndex.positionAt(change.rangeOffset + change.rangeLength)
            },
            text: fromCanonicalText(change.text, eol)
        }));
}

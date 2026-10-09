/**
 * @fileoverview 改行形式を正規化した本文と元の位置の対応を計算し、HostとWebviewの変更範囲を同じ座標系で扱う。
 */
import type { TextChange } from './protocol';
import { validateTextChanges } from './textChanges';

/**
 * LF正規化済み本文の変更検知に使う識別子を作る。暗号学的衝突耐性ではなく、選択範囲が古い本文に由来するかの判定に使う。
 * @param text - 比較対象のLF正規化済み本文。
 * @returns 二つの32 bitハッシュ値とUTF-16長を連結した指紋。
 */
export function fingerprintText(text: string): string {
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        first = Math.imul(first ^ code, 0x01000193);
        second = Math.imul(second ^ (code + index), 0x85ebca6b);
        second ^= second >>> 13;
    }
    return `${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}:${text.length}`;
}

/**
 * 行番号と行内文字位置を持つ、エディター互換のテキスト位置です。
 */
export interface TextPositionLike {

    /**
     * 0始まりの行番号です。
     */
    line: number;

    /**
     * 行内の0始まりUTF-16文字オフセットです。
     */
    character: number;
}

/**
 * テキスト範囲の開始位置と終了位置を表します。
 */
export interface TextRangeLike {

    /**
     * 変更範囲の開始位置。lineとcharacterは0始まりのUTF-16位置。
     */
    start: TextPositionLike;

    /**
     * 変更範囲の終了位置。end位置の文字は置換範囲に含めない。
     */
    end: TextPositionLike;
}

/**
 * 文書内の置換範囲と挿入テキストを表す変更情報です。
 */
export interface TextContentChangeLike {

    /**
     * 変更を適用する正規化済み本文上の範囲。
     */
    range: TextRangeLike;

    /**
     * 表示・解析・変換の対象となる本文。
     */
    text: string;
}

/**
 * 文書内の置換範囲と置換後テキストを持つワークスペース編集です。
 */
export interface CanonicalWorkspaceEditLike {

    /**
     * WorkspaceEditへ出力する元文書上の行・文字範囲。
     */
    range: TextRangeLike;

    /**
     * 表示・解析・変換の対象となる本文。
     */
    text: string;
}

/**
 * 文書本文から行・文字位置とUTF-16オフセットを相互変換する索引です。
 */
export interface CanonicalTextPositionIndex {
    /**
    * 行番号と行内文字位置を、正規化済み本文のオフセットへ変換する。
    * @param position 正規化済み本文に対する行番号と行内文字位置。
    * @returns 対応するUTF-16文字オフセット。
     */
    offsetAt(position: TextPositionLike): number;
    /**
     * LF正規化本文のオフセットを行と文字位置に変換する。
     * @param offset - LF正規化本文内のUTF-16オフセット。
     * @returns 0始まりの行番号とUTF-16文字位置。
     */
    positionAt(offset: number): TextPositionLike;
}

/**
 * CRLFとCRをLFへ統一し、本文を正規化座標系へ変換する。
 * @param value - 改行コードをLFへ統一する本文。
 * @returns すべての改行をLFで表した本文。
 */
export function toCanonicalText(value: string): string {
    return value.replace(/\r\n?|\n/g, '\n');
}

/**
 * LF正規化本文の改行を、出力先文書で使われている改行形式へ戻す。
 * @param value - 改行コードをLFに統一した本文。
 * @param eol - LFを変換する出力改行コード。
 * @returns 指定された改行形式を使う本文。
 */
export function fromCanonicalText(value: string, eol: '\n' | '\r\n'): string {
    return toCanonicalText(value).replace(/\n/g, eol);
}

/**
 * 行開始オフセットを前計算し、行・文字位置とUTF-16オフセットの相互変換を作る。
 * @param canonicalText - 改行がLFへ正規化済みの本文。
 * @returns `offsetAt`と`positionAt`を持つ位置index。
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
        * 行番号と行内文字位置を、正規化済み本文のオフセットへ変換する。
        * @param position 正規化済み本文に対する行番号と行内文字位置。

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
         * LF正規化本文のオフセットを行と文字位置に変換する。
         * @param offset - LF正規化本文内のUTF-16オフセット。
         * @returns 0始まりの行番号とUTF-16文字位置。
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
 * 行番号と行内文字位置を、正規化済み本文のオフセットへ変換する。
 * @param canonicalText - canonicaltextで扱う文字列または本文。
 * @param position 正規化済み本文に対する行番号と行内文字位置。
 * @returns 対応するUTF-16文字オフセット。
 */
export function canonicalOffsetAt(
    canonicalText: string,
    position: TextPositionLike
): number {
    return indexCanonicalText(canonicalText).offsetAt(position);
}

/**
 * 正規化本文内のUTF-16オフセットに対応する元本文の行と文字位置を求める。
 * @param canonicalText - canonicaltextで扱う文字列または本文。
 * @param offset - LF正規化本文内のUTF-16オフセット。
 * @returns 元本文上の0始まり行番号と文字位置。
 */
export function canonicalPositionAt(
    canonicalText: string,
    offset: number
): TextPositionLike {
    return indexCanonicalText(canonicalText).positionAt(offset);
}

/**
 * VS Codeの文書変更を正規化済み本文に適用できる変更範囲へ変換する。
 * @param previousCanonicalText - canonicaltextで扱う文字列または本文。
 * @param contentChanges 元の文書位置と挿入テキストを含む変更一覧。
 * @returns 正規化済み本文に対する変更範囲一覧。
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
 * 正規化本文に対するoffset変更をWorkspaceEditの行・文字範囲へ変換し、出力改行を復元する。
 * @param canonicalBaseText - 変更を計算したLF正規化済み本文。
 * @param changes - 本文へ適用する変更範囲の一覧。
 * @param eol - 生成する本文へ使う改行コード。
 * @returns 行・文字範囲へ変換し、出力改行を復元したWorkspaceEdit一覧。
 */
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

/**
 * @file canonicalText.ts
 * 実行境界: Extension HostとWebviewの共有層。
 * 責務: 両実行境界で共有する値、プロトコル、変換を扱う。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: 呼び出し元から渡された値を変換し、外部状態を直接変更しない。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import type { TextChange } from './protocol';
import { validateTextChanges } from './textChanges';

/**
 * 「TextPositionLike」が満たすデータ契約を定義します。
 */
export interface TextPositionLike {

    /**
     * 「line」は、位置・サイズ・件数などを表す数値です。
     */
    line: number;

    /**
     * 「character」は、位置・サイズ・件数などを表す数値です。
     */
    character: number;
}

/**
 * 「TextRangeLike」が満たすデータ契約を定義します。
 */
export interface TextRangeLike {

    /**
     * 「start」は、本文または選択範囲の開始・終了位置を保持します。
     */
    start: TextPositionLike;

    /**
     * 「end」は、本文または選択範囲の開始・終了位置を保持します。
     */
    end: TextPositionLike;
}

/**
 * 「TextContentChangeLike」が満たすデータ契約を定義します。
 */
export interface TextContentChangeLike {

    /**
     * 「range」は、本文または選択範囲の開始・終了位置を保持します。
     */
    range: TextRangeLike;

    /**
     * 「text」は、画面または通知へ表示する文言を保持します。
     */
    text: string;
}

/**
 * 「CanonicalWorkspaceEditLike」が満たすデータ契約を定義します。
 */
export interface CanonicalWorkspaceEditLike {

    /**
     * 「range」は、本文または選択範囲の開始・終了位置を保持します。
     */
    range: TextRangeLike;

    /**
     * 「text」は、画面または通知へ表示する文言を保持します。
     */
    text: string;
}

/**
 * 「CanonicalTextPositionIndex」が満たすデータ契約を定義します。
 */
export interface CanonicalTextPositionIndex {
    /**
     * 「offsetAt」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
     * @param position 「position」は、「offsetAt」が関連処理の処理対象を特定する入力です。
     * @returns 計算結果の数値です。
     */
    offsetAt(position: TextPositionLike): number;
    /**
     * 「positionAt」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
     * @param offset 本文または選択範囲を示すゼロ基準の位置です。範囲の開始・終了や写像の基準になります。
     * @returns 「positionAt」が関連処理の入力を処理して得た固有の結果を返します。
     */
    positionAt(offset: number): TextPositionLike;
}

/**
 * 同期プロトコルで扱う本文をLFへ正規化する。
 * @param value 「toCanonicalText」で検証・変換する入力値です。
 * @returns 「toCanonicalText」が生成した関連処理の表示文字列を返します。
 */
export function toCanonicalText(value: string): string {
    return value.replace(/\r\n?|\n/g, '\n');
}

/**
 * LF正規化済み本文を指定EOLへ変換する。
 * @param value 「fromCanonicalText」で検証・変換する入力値です。
 * @param eol 「eol」は、「fromCanonicalText」が関連処理の処理対象を特定する入力です。
 * @returns 「fromCanonicalText」が生成した関連処理の表示文字列を返します。
 */
export function fromCanonicalText(value: string, eol: '\n' | '\r\n'): string {
    return toCanonicalText(value).replace(/\n/g, eol);
}

/**
 * LF本文の行開始位置を一度だけ構築し、複数の位置変換を対数時間で処理する。
 * @param canonicalText 処理対象の本文です。
 * @returns 「indexCanonicalText」が計算した位置・サイズ・件数などの数値を返します。
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
         * 「offsetAt」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
         * @param position 「position」は、「offsetAt」が関連処理の処理対象を特定する入力です。
         * @returns 計算結果の数値です。
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
         * 「positionAt」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
         * @param offset 本文または選択範囲を示すゼロ基準の位置です。範囲の開始・終了や写像の基準になります。
         * @returns 「positionAt」が関連処理の入力を処理して得た固有の結果を返します。
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
 * LF正規化済み本文の行・桁位置を本文オフセットへ変換する。
 * @param canonicalText 処理対象の本文です。
 * @param position 「position」は、「canonicalOffsetAt」が関連処理の処理対象を特定する入力です。
 * @returns 計算結果の数値です。
 */
export function canonicalOffsetAt(
    canonicalText: string,
    position: TextPositionLike
): number {
    return indexCanonicalText(canonicalText).offsetAt(position);
}

/**
 * LF正規化済み本文のオフセットを行・桁位置へ変換する。
 * @param canonicalText 処理対象の本文です。
 * @param offset 本文または選択範囲を示すゼロ基準の位置です。範囲の開始・終了や写像の基準になります。
 * @returns 条件を満たすかどうかを示す真偽値を返します。
 */
export function canonicalPositionAt(
    canonicalText: string,
    offset: number
): TextPositionLike {
    return indexCanonicalText(canonicalText).positionAt(offset);
}

/**
 * VS CodeのcontentChangesをLF座標のTextChangeへ変換する。
 * rangeOffset/rangeLengthはCRLF幅に依存するため使わず、Positionから再計算する。
 * @param previousCanonicalText 処理対象の本文です。
 * @param contentChanges 「contentChanges」は、「canonicalizeContentChanges」が関連処理の処理対象を特定する入力です。
 * @returns 条件を満たすかどうかを示す真偽値を返します。
 */
export function canonicalizeContentChanges(
    previousCanonicalText: string,
    contentChanges: readonly TextContentChangeLike[]
): TextChange[] {
    const positionIndex = indexCanonicalText(previousCanonicalText);
    const changes = contentChanges.map(
    /**
 * 「change」を変換し、変換後の要素を返すコールバックです。
     * @param change changeとして渡される、このコールバックの入力値です。
     * @returns 入力要素から生成した変換後の値を返します。
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
 * LF同期差分を、VS Codeへ渡す行・桁範囲と物理EOL本文へ変換する。
 * @param canonicalBaseText 処理対象の本文です。
 * @param changes 「changes」は、「materializeCanonicalChanges」が関連処理の処理対象を特定する入力です。
 * @param eol 「eol」は、「materializeCanonicalChanges」が関連処理の処理対象を特定する入力です。
 * @returns 「materializeCanonicalChanges」が関連処理の入力を処理して得た固有の結果を返します。
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
 * 「change」を変換し、変換後の要素を返すコールバックです。
     * @param change changeとして渡される、このコールバックの入力値です。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (change) => ({
        range: {
            start: positionIndex.positionAt(change.rangeOffset),
            end: positionIndex.positionAt(change.rangeOffset + change.rangeLength)
        },
        text: fromCanonicalText(change.text, eol)
    }));
}

/**
 * @fileoverview 表編集のセル値、選択範囲、行列移動を管理し、表示用値と保存用値を分離する。
 */
/**
 * tableeditormodelで扱う値の種類と境界を表す型。
 */
export type TableEditorAlignment = 'none' | 'left' | 'center' | 'right';

/**
 * 表編集UIで選択中のソート方向。
 */
export type TableEditorSortDirection = 'ascending' | 'descending';

/**
 * 表編集UIで最後に実行したソート条件。
 */
export interface TableEditorSortState {
    /** ソート対象の列インデックス。0から始まる。 */
    column: number;
    /** 適用する昇順・降順。 */
    direction: TableEditorSortDirection;
}

/**
 * 表編集UIで列を変更したときのソート列位置の変更内容。
 */
export type TableEditorColumnChange =
    | { kind: 'move'; from: number; to: number }
    | { kind: 'insert'; index: number; count: number }
    | { kind: 'delete'; index: number; count: number };

/**
 * ソート後の行一覧と、各行の変更前インデックスを表す。
 */
export interface TableEditorSortedRows {
    /** 見出し行を先頭に保った、並べ替え後の行データ。 */
    rows: string[][];
    /** 各行がソート前にあった位置。見出し行を含むため、0は見出し行を指す。 */
    sourceRowIndexes: number[];
}

/**
 * 元のMarkdown範囲と解析した表の編集状態を保持するドラフト。
 */
export interface TableEditorDraft {

    /**
     * 元本文内で表が始まる文字オフセット。
     */
    from: number;

    /**
     * 元本文内で表が終わる位置を示す排他的文字オフセット。
     */
    to: number;

    /**
     * 編集対象だった表の元Markdown文字列。
     */
    originalText: string;
    /**
     * 表を読み取った時点のMarkdown本文。適用時の競合検出に使う。
     */
    sourceText: string;

    /**
     * 表の各行に付いていた先頭インデント。
     */
    indent: string;

    /**
     * 元本文で表の行に使われていた改行文字列。
     */
    eol: string;

    /**
     * 表のヘッダー行とデータ行を持つセル値の二次元配列。
     */
    rows: string[][];

    /**
     * 各列に指定された左寄せ、中央寄せ、右寄せ、未指定の配置。
     */
    alignments: TableEditorAlignment[];

    /**
     * 編集開始時にフォーカスしていた行のインデックス。
     */
    activeRow: number;

    /**
     * 編集開始時にフォーカスしていた列のインデックス。
     */
    activeColumn: number;
}

/**
 * 表編集ダイアログで表示・編集中の一時的な表データです。
 */
export interface RenderedTableDraft {

    /**
     * 表示・解析・変換の対象となる本文。
     */
    text: string;

    /**
     * 編集対象文字列内の0始まりのキャレット位置です。
     */
    caretOffset: number;
}

/**
 * tableeditormodelの処理結果と失敗時情報のデータ形状。
 */
export type TableEditorApplyResult =
    | {
        /**
         * メッセージ、項目、または処理の種類を識別する値。
         */
        kind: 'stale'
    }
    | {
        /**
         * メッセージ、項目、または処理の種類を識別する値。
         */
        kind: 'noop'
    }
    | {
        /**
         * メッセージ、項目、または処理の種類を識別する値。
         */
        kind: 'changed';
        /**
         * 表示・解析・変換の対象となる本文。
         */
        text: string;
        /**
         * 編集対象文字列内の0始まりのキャレット位置です。
         */
        caretOffset: number
    };

/**
 * セル内改行を追加する位置と入力文字列です。
 */
export interface TableEditorLineBreakEdit {

    /**
     * 改行挿入後の保存形式セル本文。
     */
    value: string;

    /**
     * 編集対象文字列内の0始まりのキャレット位置です。
     */
    caretOffset: number;
}

/**
 * セル内の指定した改行を削除する位置情報です。
 */
export interface TableEditorLineBreakDelete {

    /**
     * 改行削除後の保存形式セル本文。
     */
    value: string;

    /**
     * 編集対象文字列内の0始まりのキャレット位置です。
     */
    caretOffset: number;
}

/**
 * 保存形式の`<br>`タグを表示用の改行文字へ展開する。
 * @param value - 保存形式の`<br>`を表示用改行へ展開するセル値。
 * @returns 各`<br>`を改行文字へ置き換えたセル表示値。
 */
export function tableEditorCellDisplayValue(value: string): string {
    return value.replace(/<br\s*\/?>/gi,
        /**
         * 表示用の改行を付けてセル内のHTML改行タグを置換する。
         * @param lineBreak 表示用改行を付加する元のHTML改行タグ文字列。

         */
        (lineBreak) => `${lineBreak}\n`);
}

/**
 * 表示文字列を保存用セル値へ戻し、編集前の`<br>`位置を維持できる場合はその位置を優先する。
 * @param value - 保存形式へ変換するエディター上のセル表示値。
 * @param previousStoredValue - 編集前の保存形式セル値。既存br位置と表示改行の対応確認に使う。
 * @returns 表示改行を`<br>`へ変換し、既存の保存位置を保ったセル値。
 */
export function tableEditorCellStoredValue(value: string, previousStoredValue?: string): string {
    const valueWithoutDeletedBreakNewline = previousStoredValue === undefined
        ? value
        : removeDeletedBreakNewline(value, tableEditorCellDisplayValue(previousStoredValue));

    // Remove only the one display newline generated after each visible <br>.
    // Any additional newline remains and is stored as another <br>.
    return valueWithoutDeletedBreakNewline
        .replace(/<br\s*\/?>\r\n/gi, '<br>')
        .replace(/<br\s*\/?>\r/gi, '<br>')
        .replace(/<br\s*\/?>\n/gi, '<br>')
        .replace(/<br\s*\/?>/gi, '<br>')
        .replace(/\r\n|\r|\n/g, '<br>');
}

/**
 * 編集画面の表示文字列をMarkdown表のセル値へ反映する変更です。
 */
interface TableEditorDisplayEdit {

    /**
     * セル先頭のMarkdown装飾を除いた後に残る接頭部の文字数です。
     */
    prefixLength: number;

    /**
     * 編集前文字列で最後の対応済み範囲が終わるUTF-16オフセット。
     */
    previousEnd: number;

    /**
     * 編集後文字列で同じ対応済み範囲が終わるUTF-16オフセット。
     */
    nextEnd: number;
}

/**
 * セル表示文字列の編集結果から、削除されたHTML改行タグ由来の改行を取り除く。
 * @param nextDisplayValue 編集後のセル表示文字列。
 * @param previousDisplayValue 編集前のセル表示文字列。

 */
function removeDeletedBreakNewline(nextDisplayValue: string, previousDisplayValue: string): string {
    const edit = findTableEditorDisplayEdit(previousDisplayValue, nextDisplayValue);
    if (!edit) return nextDisplayValue;

    if (nextDisplayValue.length >= previousDisplayValue.length) return nextDisplayValue;

    const deletedBreak = [...previousDisplayValue.matchAll(/<br\s*\/?>/gi)].find(
        /**
         * 位置が条件に一致する最初のmatchを取得する。
         * @param match - 削除範囲と交差するか判定する保存形式のbrタグ一致。
         * @returns 条件に一致した最初の要素。未検出時はundefined。
         */
        (match) => {
            const start = match.index ?? -1;
            const end = start + match[0].length;
            return start < edit.previousEnd && end > edit.prefixLength;
        });
    if (!deletedBreak) return nextDisplayValue;

    // Treat a visible <br> as one deletion unit even when Backspace/Delete
    // removes only one character of the token. The remaining token fragment
    // and its generated newline must not be normalized into another <br>.
    const nextTokenStart = Math.min(edit.prefixLength, deletedBreak.index ?? edit.prefixLength);
    if (previousDisplayValue[deletedBreak.index! + deletedBreak[0].length] !== '\n') {
        return nextDisplayValue;
    }
    const generatedNewline = nextDisplayValue.indexOf('\n', nextTokenStart);
    if (generatedNewline < 0) return nextDisplayValue;

    return `${nextDisplayValue.slice(0, nextTokenStart)}${nextDisplayValue.slice(generatedNewline + 1)}`;
}

/**
 * 編集前後のセル表示文字列間で変更された区間を求める。
 * @param previousValue - 編集前のセル表示文字列。
 * @param nextValue 編集後のセル表示文字列。
 * @returns 条件に一致する値。未検出時はundefinedまたはnull。
 */
function findTableEditorDisplayEdit(previousValue: string, nextValue: string): TableEditorDisplayEdit | undefined {
    let prefixLength = 0;
    while (
        prefixLength < previousValue.length
        && prefixLength < nextValue.length
        && previousValue[prefixLength] === nextValue[prefixLength]
    ) {
        prefixLength += 1;
    }

    let previousEnd = previousValue.length;
    let nextEnd = nextValue.length;
    while (
        previousEnd > prefixLength
        && nextEnd > prefixLength
        && previousValue[previousEnd - 1] === nextValue[nextEnd - 1]
    ) {
        previousEnd -= 1;
        nextEnd -= 1;
    }

    if (prefixLength === previousEnd && prefixLength === nextEnd) return undefined;
    return { prefixLength, previousEnd, nextEnd };
}

/**
 * 表示側のcaret位置を保存形式のオフセットへ写し、`<br>`タグ内部を指す位置は境界へ丸める。
 * @param value - 表示オフセットに対応する保存形式のセル値。
 * @param displayOffset - 表示側セル文字列内のUTF-16 caretオフセット。
 * @returns 表示側caret位置に対応する保存形式内UTF-16オフセット。
 */
export function tableEditorCellStoredOffsetFromDisplay(value: string, displayOffset: number): number {
    const displayValue = tableEditorCellDisplayValue(value);
    const target = clampOffset(displayOffset, displayValue.length);
    let storedOffset = 0;
    let displayCursor = 0;
    while (storedOffset < value.length) {
        const lineBreak = /^<br\s*\/?>/i.exec(value.slice(storedOffset));
        if (lineBreak) {
            const tokenLength = lineBreak[0].length;
            if (target <= displayCursor) return storedOffset;
            const tokenEnd = displayCursor + tokenLength;
            if (target <= tokenEnd) {
                return storedOffset + target - displayCursor;
            }
            storedOffset += tokenLength;
            displayCursor = tokenEnd;
            if (target <= displayCursor + 1) return storedOffset;
            displayCursor += 1;
            continue;
        }
        if (target <= displayCursor) return storedOffset;
        storedOffset += 1;
        displayCursor += 1;
    }
    return value.length;
}

/**
 * 保存形式のオフセットを、`<br>`を1文字の改行として数える表示側caret位置へ写す。
 * @param value - 保存オフセットから表示位置を求めるセル値。
 * @param storedOffset - 保存形式セル値内のUTF-16オフセット。
 * @returns 保存形式内caret位置に対応する表示側UTF-16オフセット。
 */
export function tableEditorCellDisplayOffsetFromStored(value: string, storedOffset: number): number {
    const target = clampOffset(storedOffset, value.length);
    let currentStoredOffset = 0;
    let displayOffset = 0;
    while (currentStoredOffset < target) {
        const lineBreak = /^<br\s*\/?>/i.exec(value.slice(currentStoredOffset));
        if (lineBreak) {
            const tokenLength = lineBreak[0].length;
            if (target < currentStoredOffset + tokenLength) {
                return displayOffset + target - currentStoredOffset;
            }
            currentStoredOffset += tokenLength;
            displayOffset += tokenLength + 1;
        } else {
            currentStoredOffset += 1;
            displayOffset += 1;
        }
    }
    return displayOffset;
}

/**
 * 表示オフセット直前のMarkdown改行を削除し、キャレット位置を返す。
 * @param value - 改行を挿入する保存形式のセル値。
 * @param selectionStart - 改行を挿入する保存形式セル値内の選択開始オフセット。
 * @param selectionEnd - 改行を挿入する保存形式セル値内の選択終了オフセット。
 * @returns 選択範囲を置換した保存形式の値と、挿入直後のcaretオフセット。
 */
export function insertTableEditorLineBreak(value: string, selectionStart = value.length, selectionEnd = selectionStart): TableEditorLineBreakEdit {
    const from = Math.max(0, Math.min(selectionStart, value.length));
    const to = Math.max(from, Math.min(selectionEnd, value.length));
    const inserted = '<br>';
    return {
        value: `${value.slice(0, from)}${inserted}${value.slice(to)}`,
        caretOffset: from + inserted.length
    };
}

/**
 * tableeditormodelの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param value - 指定表示位置より前にある改行を削除する保存形式のセル値。
 * @param displayOffset - 削除キー操作後のセル表示文字列内caretオフセット。
 * @returns 改行を削除した保存値とキャレット位置。削除対象の改行がなければundefined。
 */
export function deleteTableEditorLineBreakBeforeDisplayOffset(
    value: string,
    displayOffset: number,
): TableEditorLineBreakDelete | undefined {
    const target = clampOffset(displayOffset, tableEditorCellDisplayValue(value).length);
    let storedOffset = 0;
    let displayCursor = 0;
    while (storedOffset < value.length) {
        const lineBreak = /^<br\s*\/?>/i.exec(value.slice(storedOffset));
        if (lineBreak) {
            const tokenLength = lineBreak[0].length;
            const generatedNewlineOffset = displayCursor + tokenLength;
            if (target === generatedNewlineOffset + 1) {
                return {
                    value: `${value.slice(0, storedOffset)}${value.slice(storedOffset + tokenLength)}`,
                    caretOffset: displayCursor,
                };
            }
            storedOffset += tokenLength;
            displayCursor += tokenLength + 1;
            continue;
        }
        storedOffset += 1;
        displayCursor += 1;
    }
    return undefined;
}

/**
 * tableeditormodelの寸法、容量、位置、または計測値を求める。
 * @param value - 文字列長の範囲へ収めるオフセット候補。
 * @param maximum - オフセットを収める対象文字列の長さ。

 */
function clampOffset(value: number, maximum: number): number {
    if (!Number.isFinite(value)) return maximum;
    return Math.max(0, Math.min(maximum, Math.trunc(value)));
}

/**
 * 指定位置にあるMarkdown表を編集用ドラフトへ読み込む。
 * @param source - 編集対象の表を含むMarkdown本文。
 * @param offset - 編集対象表を含むMarkdown本文内オフセット。
 * @returns 表のセル、列幅、配置、元範囲を持つ編集ドラフト。表がない場合はundefined。
 */
export function readTableEditorDraft(source: string, offset: number): TableEditorDraft | undefined {
    const lineBreaks = [...source.matchAll(/\r\n|\r|\n/g)].map(
        /**
         * 各matchを変換して一覧化する。
         * @param match - Markdown本文から取り出した改行一致（match[0]はCRLF/CR/LF）。

         */
        (match) => match[0]);
    const eol = lineBreaks[0] ?? '\n';
    const lines = source.split(/\r\n|\r|\n/);
    const starts: number[] = [];
    let cursor = 0;
    for (let index = 0; index < lines.length; index += 1) {
        starts.push(cursor);
        cursor += lines[index].length + (lineBreaks[index]?.length ?? 0);
    }

    const safeOffset = Math.max(0, Math.min(offset, source.length));
    let lineIndex = 0;
    while (lineIndex + 1 < starts.length && starts[lineIndex + 1] <= safeOffset) lineIndex += 1;
    if (!isTableRow(lines[lineIndex]) || isInsideMarkdownFence(lines, lineIndex)) return undefined;

    let startLine = lineIndex;
    let endLine = lineIndex;
    while (startLine > 0 && isTableRow(lines[startLine - 1])) startLine -= 1;
    while (endLine + 1 < lines.length && isTableRow(lines[endLine + 1])) endLine += 1;
    if (startLine + 1 > endLine || !isSeparatorRow(lines[startLine + 1])) return undefined;

    const rowLines = [lines[startLine], ...lines.slice(startLine + 2, endLine + 1)];
    const rows = rowLines.map(splitTableCells);
    const separator = splitTableCells(lines[startLine + 1]);
    const columnCount = Math.max(1, separator.length, ...rows.map(
        /**
         * 各行からlengthを取り出して一覧化する。
         * @param row - 行のlengthを参照する走査対象。
         * @returns lengthを取り出した変換結果の一覧。
         */
        (row) => row.length));
    for (const row of rows) while (row.length < columnCount) row.push('');
    while (separator.length < columnCount) separator.push('---');

    const activeRow = lineIndex <= startLine + 1 ? 0 : lineIndex - startLine - 1;
    const lineOffset = Math.max(0, safeOffset - starts[lineIndex]);
    const activeColumn = tableColumnAt(lines[lineIndex], lineOffset, columnCount);
    const from = starts[startLine];
    const to = starts[endLine] + lines[endLine].length;
    const indent = /^\s*/.exec(lines[startLine])?.[0] ?? '';

    return {
        from,
        to,
        originalText: source.slice(from, to),
        sourceText: source,
        indent,
        eol,
        rows,
        alignments: separator.map(separatorAlignment),
        activeRow: Math.min(activeRow, rows.length - 1),
        activeColumn
    };
}

/**
 * 表編集draftをMarkdown本文とセル位置情報を含む描画結果へ変換する。
 * @param draft - 編集開始時の基準本文を保持した適用対象draft。
 * @returns Markdown本文、セル位置、選択セル位置を含む描画結果。
 */
export function renderTableEditorDraft(draft: TableEditorDraft): RenderedTableDraft {
    const sourceRows = draft.rows.length ? draft.rows : [[]];
    const columnCount = Math.max(1, draft.alignments.length, ...sourceRows.map(
        /**
         * 各行からlengthを取り出して一覧化する。
         * @param row - 行のlengthを参照する走査対象。
         * @returns lengthを取り出した変換結果の一覧。
         */
        (row) => row.length));
    // 表セル内の未エスケープの縦棒は、セル境界と区別できるように保存時だけエスケープする。
    const rows = sourceRows.map(
        /**
         * 各行をfromへ渡し、変換結果を一覧化する。
         * @param row - 走査中の要素。

         */
        (row) => Array.from(
            { length: columnCount },


            (_, index) => escapeUnescapedPipes(row[index] ?? '')
        ));
    const alignments = Array.from({ length: columnCount },

        (_, index) => draft.alignments[index] ?? 'none');
    const renderedRows = rows.map((row) => renderRow(draft.indent, row));
    const separator = renderRow(draft.indent, alignments.map(alignmentSeparator));
    const lines = [renderedRows[0], separator, ...renderedRows.slice(1)];
    const activeRow = Math.max(0, Math.min(draft.activeRow, rows.length - 1));
    const activeColumn = Math.max(0, Math.min(draft.activeColumn, columnCount - 1));
    const renderedLineIndex = activeRow === 0 ? 0 : activeRow + 1;
    let caretOffset = 0;
    for (let index = 0; index < renderedLineIndex; index += 1) caretOffset += lines[index].length + draft.eol.length;
    caretOffset += draft.indent.length + 2;
    for (let column = 0; column < activeColumn; column += 1) caretOffset += rows[activeRow][column].length + 3;
    return { text: lines.join(draft.eol), caretOffset };
}

/**
 * 編集開始時の表ドラフトを現在のMarkdown本文へ適用する準備結果を作る。
 * @param draft - 表示行、配置、activeセルを含む表編集draft。
 * @param currentSource 現在のMarkdown本文。ドラフト作成時の本文と異なればstaleとして扱う。
 * @returns 適用可能、変更なし、または元本文が古いことを示す準備結果。
 */
export function prepareTableEditorApply(draft: TableEditorDraft, currentSource: string): TableEditorApplyResult {
    if (currentSource !== draft.sourceText) return { kind: 'stale' };
    const rendered = renderTableEditorDraft(draft);
    if (rendered.text === currentSource.slice(draft.from, draft.to)) return { kind: 'noop' };
    return { kind: 'changed', text: rendered.text, caretOffset: rendered.caretOffset };
}

/**
 * Markdown見出し行を固定し、指定列の値でデータ行を安定して並べ替える。
 * @param rows - 見出し行を先頭に含む表の行。
 * @param column - 比較に使う列番号。
 * @param direction - 昇順または降順。
 * @param locale - 文字列比較に使うロケール。
 * @returns 並べ替え後の行と、元の行番号。
 */
export function sortTableEditorRows(
    rows: readonly (readonly string[])[],
    column: number,
    direction: TableEditorSortDirection,
    locale: string,
): TableEditorSortedRows {
    if (rows.length === 0) return { rows: [], sourceRowIndexes: [] };

    const entries = rows.slice(1).map((row, index) => ({
        row,
        sourceRowIndex: index + 1,
        key: (row[column] ?? '').trim(),
    }));
    const numericKeys = entries.map((entry) => parseSortableNumber(entry.key));
    const isNumericColumn = entries.every(
        (entry, index) => entry.key.length === 0 || numericKeys[index] !== undefined,
    );
    const collator = new Intl.Collator(locale, {
        numeric: true,
        sensitivity: 'base',
    });
    const directionFactor = direction === 'ascending' ? 1 : -1;

    entries.sort((left, right) => {
        const leftBlank = left.key.length === 0;
        const rightBlank = right.key.length === 0;
        if (leftBlank !== rightBlank) return leftBlank ? 1 : -1;

        let comparison = 0;
        if (!leftBlank) {
            if (isNumericColumn) {
                const leftNumber = numericKeys[left.sourceRowIndex - 1]!;
                const rightNumber = numericKeys[right.sourceRowIndex - 1]!;
                comparison = leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
            } else {
                comparison = collator.compare(left.key, right.key);
            }
        }

        return comparison === 0
            ? left.sourceRowIndex - right.sourceRowIndex
            : comparison * directionFactor;
    });

    const sourceRowIndexes = [0, ...entries.map((entry) => entry.sourceRowIndex)];
    return {
        rows: sourceRowIndexes.map((index) => [...rows[index]]),
        sourceRowIndexes,
    };
}

/**
 * 列の移動・挿入・削除後もソート状態を同じ列データに結び付ける。
 * @param state - 現在のソート状態。未ソートの場合はundefined。
 * @param change - 列構成の変更内容。
 * @returns 変更後のソート状態。
 */
export function remapTableEditorSortState(
    state: TableEditorSortState | null,
    change: TableEditorColumnChange,
): TableEditorSortState | null {
    if (!state) return null;

    if (change.kind === 'move') {
        const { from, to } = change;
        let column = state.column;
        if (column === from) column = to;
        else if (from < to && column > from && column <= to) column -= 1;
        else if (from > to && column >= to && column < from) column += 1;
        return { ...state, column };
    }

    if (change.count <= 0) return { ...state };
    if (change.kind === 'insert') {
        return state.column >= change.index
            ? { ...state, column: state.column + change.count }
            : { ...state };
    }

    const deleteEnd = change.index + change.count;
    if (state.column >= change.index && state.column < deleteEnd) return null;
    return state.column >= deleteEnd
        ? { ...state, column: state.column - change.count }
        : { ...state };
}

const STANDARD_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * 標準的な有限10進表記を数値へ変換する。
 * @param value - trim済みのセル値。
 * @returns 有限数値。空欄や規則外の値はundefined。
 */
function parseSortableNumber(value: string): number | undefined {
    if (!STANDARD_NUMBER_PATTERN.test(value)) return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

/**
 * 指定した行に表セル区切りがあるか判定する。
 * @param line Markdown表の候補行。未指定の場合は表行ではない。
 * @returns 条件が成立したかを示す真偽値。
 */
function isTableRow(line: string | undefined): boolean {
    const trimmed = line?.trim() ?? '';
    return trimmed.includes('|') && trimmed.length > 0;
}

/**
 * 全セルがMarkdown表の区切り形式か判定する。
 * @param line 区切り行かどうかを検査するMarkdown表行。
 * @returns 条件が成立したかを示す真偽値。
 */
function isSeparatorRow(line: string): boolean {
    const cells = splitTableCells(line);
    return cells.length > 0 && cells.every(
        /**
         * @param cell - trim後のセル内容。Markdown表の必須空白行判定に使う。

         */
        (cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

/**
 * Markdown表の行をエスケープされていない縦棒でセルに分割する。
 * @param line セル分割するMarkdown表の行。
 * @returns 行に含まれるセル文字列の一覧。
 */
function splitTableCells(line: string): string[] {
    let body = line.trim();
    if (body.startsWith('|')) body = body.slice(1);
    if (body.endsWith('|') && countTrailingBackslashes(body, body.length - 1) % 2 === 0) body = body.slice(0, -1);
    const cells: string[] = [];
    let cell = '';
    for (let index = 0; index < body.length; index += 1) {
        const character = body[index];
        if (character === '|' && countTrailingBackslashes(body, index) % 2 === 0) {
            cells.push(cell.trim());
            cell = '';
            continue;
        }
        cell += character;
    }
    cells.push(cell.trim());
    return cells;
}

/**
 * 行内の指定オフセットが属する表列を返す。
 * @param line 列位置を算出するMarkdown表の行。
 * @param offset 列を判定する本文内の文字オフセット。
 * @param columnCount - 表にある総列数。判定結果を有効範囲内に収める。

 */
function tableColumnAt(line: string, offset: number, columnCount: number): number {
    const before = line.slice(0, Math.max(0, offset));
    let pipes = 0;
    for (let index = 0; index < before.length; index += 1) {
        if (before[index] === '|' && countTrailingBackslashes(before, index) % 2 === 0) pipes += 1;
    }
    return Math.max(0, Math.min(columnCount - 1, pipes - 1));
}

/**
 * Markdown table separatorの左右コロンから列配置を判定する。
 * @param value - 左右のコロンから列配置を読み取るMarkdown区切りセル。
 * @returns 左寄せ・中央寄せ・右寄せ・指定なしのいずれか。
 */
function separatorAlignment(value: string): TableEditorAlignment {
    const trimmed = value.trim();
    const left = trimmed.startsWith(':');
    const right = trimmed.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return 'none';
}

/**
 * 列配置をMarkdown table separatorのセル表記へ変換する。
 * @param alignment - Markdown区切り行へ変換する列配置（left/center/right/none）。

 */
function alignmentSeparator(alignment: TableEditorAlignment): string {
    if (alignment === 'left') return ':---';
    if (alignment === 'center') return ':---:';
    if (alignment === 'right') return '---:';
    return '---';
}

/**
 * インデントとセル列からMarkdown表の1行を生成する。
 * @param indent - 表行の前に維持するインデント文字列。
 * @param cells - Markdown表行として出力するセル文字列一覧。

 */
function renderRow(indent: string, cells: string[]): string {
    return `${indent}| ${cells.join(' | ')} |`;
}

/**
 * 指定境界の直前に連続するバックスラッシュ数を数え、縦棒がエスケープ済みか判定できるようにする。
 * @param value - end位置より前にある連続バックスラッシュを数える本文。
 * @param end - 連続するバックスラッシュを数える文字列の終端排他オフセット。

 */
function countTrailingBackslashes(value: string, end: number): number {
    let count = 0;
    for (let index = end - 1; index >= 0 && value[index] === '\\'; index -= 1) count += 1;
    return count;
}

/**
 * Markdown表セル内の未エスケープ縦棒をエスケープする。
 * @param value - 未エスケープの縦棒を処理するMarkdown表セル。

 */
function escapeUnescapedPipes(value: string): string {
    let result = '';
    for (let index = 0; index < value.length; index += 1) {
        if (value[index] === '|' && countTrailingBackslashes(value, index) % 2 === 0) result += '\\';
        result += value[index];
    }
    return result;
}

/**
 * 指定行がMarkdownコードフェンス内にあるか判定する。
 * @param lines フェンス状態を調べるMarkdown文書の行一覧。
 * @param lineIndex 調べる行の0始まりの配列インデックス。
 * @returns 条件が成立したかを示す真偽値。
 */
function isInsideMarkdownFence(lines: string[], lineIndex: number): boolean {
    let fenceCharacter = '';
    let fenceLength = 0;
    for (let index = 0; index <= lineIndex; index += 1) {
        const match = /^\s*(`{3,}|~{3,})/.exec(lines[index]);
        if (!match) continue;
        const character = match[1][0];
        if (!fenceCharacter) {
            fenceCharacter = character;
            fenceLength = match[1].length;
        } else if (character === fenceCharacter && match[1].length >= fenceLength) {
            fenceCharacter = '';
            fenceLength = 0;
        }
    }
    return Boolean(fenceCharacter);
}

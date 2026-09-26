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
    column: number;
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
    rows: string[][];
    sourceRowIndexes: number[];
}

/**
 * tableeditormodelで共有するデータ形状を表すインターフェース。
 */
export interface TableEditorDraft {

    /**
     * tableeditormodelのfromを表す数値。
     */
    from: number;

    /**
     * tableeditormodelのtoを表す数値。
     */
    to: number;

    /**
     * tableeditormodelで解析・表示・保存する本文。
     */
    originalText: string;
    /**
     * tableeditormodelで解析・表示・保存する本文。
     */
    sourceText: string;

    /**
     * tableeditormodelで扱うindentの文字列。
     */
    indent: string;

    /**
     * tableeditormodelで扱うeolの文字列。
     */
    eol: string;

    /**
     * tableeditormodelで扱うrowsの一覧。
     */
    rows: string[][];

    /**
     * tableeditormodelのalignmentsに関する状態または設定。
     */
    alignments: TableEditorAlignment[];

    /**
     * tableeditormodelの状態を示すフラグ。
     */
    activeRow: number;

    /**
     * tableeditormodelの状態を示すフラグ。
     */
    activeColumn: number;
}

/**
 * tableeditormodelで共有するデータ形状を表すインターフェース。
 */
export interface RenderedTableDraft {

    /**
     * 表示・解析・変換の対象となる本文。
     */
    text: string;

    /**
     * tableeditormodelの位置・寸法・件数・時間を表す数値。
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
         * tableeditormodelの位置・寸法・件数・時間を表す数値。
         */
        caretOffset: number
    };

/**
 * tableeditormodelで共有するデータ形状を表すインターフェース。
 */
export interface TableEditorLineBreakEdit {

    /**
     * 検証・変換・保存の対象となる値。
     */
    value: string;

    /**
     * tableeditormodelの位置・寸法・件数・時間を表す数値。
     */
    caretOffset: number;
}

/**
 * tableeditormodelで共有するデータ形状を表すインターフェース。
 */
export interface TableEditorLineBreakDelete {

    /**
     * 検証・変換・保存の対象となる値。
     */
    value: string;

    /**
     * tableeditormodelの位置・寸法・件数・時間を表す数値。
     */
    caretOffset: number;
}

/**
 * tableeditormodelのtable・editor・cell・display・valueを処理し、呼び出し側へ結果または副作用を返す。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns tableeditormodelで利用する文字列。
 */
export function tableEditorCellDisplayValue(value: string): string {
    return value.replace(/<br\s*\/?>/gi,
        /**
         * tableeditormodelのコールバックとしてline・breakを処理する。
         * @param lineBreak - tableeditormodelの位置・寸法・件数・時間を表す数値。
         * @returns tableeditormodelで利用する文字列。
         */
        (lineBreak) => `${lineBreak}\n`);
}

/**
 * tableeditormodelのtable・editor・cell・stored・valueを処理し、呼び出し側へ結果または副作用を返す。
 * @param value - 検証・変換・保存の対象となる値。
 * @param previousStoredValue - tableeditormodelで受け渡す文字列。
 * @returns tableeditormodelで利用する文字列。
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
 * tableeditormodelで共有するデータ形状を表すインターフェース。
 */
interface TableEditorDisplayEdit {

    /**
     * tableeditormodelの位置・寸法・件数・時間を表す数値。
     */
    prefixLength: number;

    /**
     * tableeditormodelのprevious・endを表す数値。
     */
    previousEnd: number;

    /**
     * tableeditormodelのnext・endを表す数値。
     */
    nextEnd: number;
}

/**
 * tableeditormodelの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param nextDisplayValue - tableeditormodelの位置・寸法・件数・時間を表す数値。
 * @param previousDisplayValue - tableeditormodelの位置・寸法・件数・時間を表す数値。
 * @returns tableeditormodelで利用する文字列。
 */
function removeDeletedBreakNewline(nextDisplayValue: string, previousDisplayValue: string): string {
    const edit = findTableEditorDisplayEdit(previousDisplayValue, nextDisplayValue);
    if (!edit) return nextDisplayValue;

    if (nextDisplayValue.length >= previousDisplayValue.length) return nextDisplayValue;

    const deletedBreak = [...previousDisplayValue.matchAll(/<br\s*\/?>/gi)].find(
        /**
         * 位置が条件に一致する最初のmatchを取得する。
         * @param match - matchの位置を参照する走査対象。
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
 * tableeditormodelから必要な値またはリソースを取得する。
 * @param previousValue - tableeditormodelで受け渡す文字列。
 * @param nextValue - tableeditormodelの位置・寸法・件数・時間を表す数値。
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
 * tableeditormodelのtable・editor・cell・stored・offset・from・displayを処理し、呼び出し側へ結果または副作用を返す。
 * @param value - 検証・変換・保存の対象となる値。
 * @param displayOffset - tableeditormodelの位置・寸法・件数・時間を表す数値。
 * @returns tableeditormodelで利用する数値。
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
 * tableeditormodelのtable・editor・cell・display・offset・from・storedを処理し、呼び出し側へ結果または副作用を返す。
 * @param value - 検証・変換・保存の対象となる値。
 * @param storedOffset - tableeditormodelの位置・寸法・件数・時間を表す数値。
 * @returns tableeditormodelで利用する数値。
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
 * tableeditormodelの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param value - 検証・変換・保存の対象となる値。
 * @param selectionStart - tableeditormodelへ渡す入力。
 * @param selectionEnd - tableeditormodelへ渡す入力。
 * @returns tableeditormodelのinsert・table・editor・line・breakが生成する結果。
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
 * @param value - 検証・変換・保存の対象となる値。
 * @param displayOffset - tableeditormodelの位置・寸法・件数・時間を表す数値。
 * @returns 副作用を完了し、値は返さない。
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
 * @param value - 検証・変換・保存の対象となる値。
 * @param maximum - tableeditormodelの位置・寸法・件数・時間を表す数値。
 * @returns tableeditormodelで利用する数値。
 */
function clampOffset(value: number, maximum: number): number {
    if (!Number.isFinite(value)) return maximum;
    return Math.max(0, Math.min(maximum, Math.trunc(value)));
}

/**
 * tableeditormodelから必要な値またはリソースを取得する。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param offset - tableeditormodelの位置・寸法・件数・時間を表す数値。
 * @returns 副作用を完了し、値は返さない。
 */
export function readTableEditorDraft(source: string, offset: number): TableEditorDraft | undefined {
    const lineBreaks = [...source.matchAll(/\r\n|\r|\n/g)].map(
        /**
         * 各matchを変換して一覧化する。
         * @param match - tableeditormodelへ渡す入力。
         * @returns 入力要素から生成した変換結果の一覧。
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
 * tableeditormodelを表示用の結果へ変換する。
 * @param draft - tableeditormodelへ渡す入力。
 * @returns tableeditormodelで生成または変換した値。
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
         * @returns 入力要素から生成した変換結果の一覧。
         */
        (row) => Array.from(
            { length: columnCount },

            /**
             * ・をescape・unescaped・pipesへ渡し、tableeditormodelの結果または副作用を処理する。
             * @param _ - 引数位置を維持するための未使用値。
             * @param index - 配列・行列・文字列の要素位置を示す番号。
             * @returns tableeditormodelのコールバックが生成する結果。
             */
            (_, index) => escapeUnescapedPipes(row[index] ?? '')
        ));
    const alignments = Array.from({ length: columnCount },
        /**
         * tableeditormodelのコールバックとして・を処理する。
         * @param _ - 引数位置を維持するための未使用値。
         * @param index - 配列・行列・文字列の要素位置を示す番号。
         * @returns tableeditormodelのコールバックが生成する結果。
         */
        (_, index) => draft.alignments[index] ?? 'none');
    const renderedRows = rows.map(
        /**
         * 各行をrender・rowへ渡し、変換結果を一覧化する。
         * @param row - 走査中の要素。
         * @returns 入力要素から生成した変換結果の一覧。
         */
        (row) => renderRow(draft.indent, row));
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
 * tableeditormodelで使う値または実行環境を組み立てる。
 * @param draft - tableeditormodelへ渡す入力。
 * @param currentSource - tableeditormodelで扱う文字列または本文。
 * @returns tableeditormodelのprepare・table・editor・applyが生成する結果。
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
 * tableeditormodelの条件を判定する。
 * @param line - tableeditormodelの位置・寸法・件数・時間を表す数値。
 * @returns 条件が成立したかを示す真偽値。
 */
function isTableRow(line: string | undefined): boolean {
    const trimmed = line?.trim() ?? '';
    return trimmed.includes('|') && trimmed.length > 0;
}

/**
 * tableeditormodelの条件を判定する。
 * @param line - tableeditormodelの位置・寸法・件数・時間を表す数値。
 * @returns 条件が成立したかを示す真偽値。
 */
function isSeparatorRow(line: string): boolean {
    const cells = splitTableCells(line);
    return cells.length > 0 && cells.every(
        /**
         * セルをtestへ渡し、tableeditormodelの結果または副作用を処理する。
         * @param cell - tableeditormodelで走査または更新する要素。
         * @returns tableeditormodelで利用する文字列。
         */
        (cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

/**
 * tableeditormodelのsplit・table・cellsを処理し、呼び出し側へ結果または副作用を返す。
 * @param line - tableeditormodelの位置・寸法・件数・時間を表す数値。
 * @returns tableeditormodelで利用する文字列。
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
 * tableeditormodelのtable・column・atを処理し、呼び出し側へ結果または副作用を返す。
 * @param line - tableeditormodelの位置・寸法・件数・時間を表す数値。
 * @param offset - tableeditormodelの位置・寸法・件数・時間を表す数値。
 * @param columnCount - tableeditormodelで走査または更新する要素。
 * @returns tableeditormodelで利用する数値。
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
 * tableeditormodelのseparator・alignmentを処理し、呼び出し側へ結果または副作用を返す。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns tableeditormodelのseparator・alignmentが生成する結果。
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
 * tableeditormodelのalignment・separatorを処理し、呼び出し側へ結果または副作用を返す。
 * @param alignment - tableeditormodelへ渡す入力。
 * @returns tableeditormodelで利用する文字列。
 */
function alignmentSeparator(alignment: TableEditorAlignment): string {
    if (alignment === 'left') return ':---';
    if (alignment === 'center') return ':---:';
    if (alignment === 'right') return '---:';
    return '---';
}

/**
 * tableeditormodelを表示用の結果へ変換する。
 * @param indent - tableeditormodelで受け渡す文字列。
 * @param cells - tableeditormodelで走査または更新する要素。
 * @returns tableeditormodelで利用する文字列。
 */
function renderRow(indent: string, cells: string[]): string {
    return `${indent}| ${cells.join(' | ')} |`;
}

/**
 * tableeditormodelのcount・trailing・backslashesを処理し、呼び出し側へ結果または副作用を返す。
 * @param value - 検証・変換・保存の対象となる値。
 * @param end - tableeditormodelで扱う数値。
 * @returns tableeditormodelで利用する数値。
 */
function countTrailingBackslashes(value: string, end: number): number {
    let count = 0;
    for (let index = end - 1; index >= 0 && value[index] === '\\'; index -= 1) count += 1;
    return count;
}

/**
 * tableeditormodelの入力を許可された形式へ整える。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns tableeditormodelで利用する文字列。
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
 * tableeditormodelの条件を判定する。
 * @param lines - tableeditormodelの位置・寸法・件数・時間を表す数値。
 * @param lineIndex - tableeditormodelの位置・寸法・件数・時間を表す数値。
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

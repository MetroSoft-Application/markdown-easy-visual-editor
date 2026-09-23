/**
 * @file tableEditorModel.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
/**
 * 「TableEditorAlignment」として扱う値の型を定義します。
 */
export type TableEditorAlignment = 'none' | 'left' | 'center' | 'right';

/**
 * 「TableEditorDraft」が満たすデータ契約を定義します。
 */
export interface TableEditorDraft {

    /**
     * 「from」は、本文または選択範囲の位置・長さを保持します。
     */
    from: number;

    /**
     * 「to」は、本文または選択範囲の位置・長さを保持します。
     */
    to: number;

    /**
     * 「originalText」は、画面または通知へ表示する文言を保持します。
     */
    originalText: string;
    /**
     * 表を開いた時点の本文全体。編集中の外部変更を検知するために保持する。
     */
    sourceText: string;

    /**
     * 「indent」は、対象の内容または識別子を表す文字列です。
     */
    indent: string;

    /**
     * 「eol」は、対象の内容または識別子を表す文字列です。
     */
    eol: string;

    /**
     * 「rows」は、対象の位置、サイズ、件数、または範囲を保持します。
     */
    rows: string[][];

    /**
     * 「alignments」は、関連する複数の対象または識別子を保持します。
     */
    alignments: TableEditorAlignment[];

    /**
     * 「activeRow」は、対象の位置、サイズ、件数、または範囲を保持します。
     */
    activeRow: number;

    /**
     * 「activeColumn」は、対象の位置、サイズ、件数、または範囲を保持します。
     */
    activeColumn: number;
}

/**
 * 「RenderedTableDraft」が満たすデータ契約を定義します。
 */
export interface RenderedTableDraft {

    /**
     * 「text」は、画面または通知へ表示する文言を保持します。
     */
    text: string;

    /**
     * 「caretOffset」は、本文または選択範囲の位置・長さを保持します。
     */
    caretOffset: number;
}

/**
 * 「TableEditorApplyResult」として扱う値の型を定義します。
 */
export type TableEditorApplyResult =
    | {
    /**
     * 「kind」は、対象の識別や処理分岐に使用する値を保持します。
     */
    kind: 'stale' }
    | {
    /**
     * 「kind」は、対象の識別や処理分岐に使用する値を保持します。
     */
    kind: 'noop' }
    | {
    /**
     * 「kind」は、対象の識別や処理分岐に使用する値を保持します。
     */
    kind: 'changed';
    /**
     * 「text」は、画面または通知へ表示する文言を保持します。
     */
    text: string;
    /**
     * 「caretOffset」は、本文または選択範囲の位置・長さを保持します。
     */
    caretOffset: number };

/**
 * 「TableEditorLineBreakEdit」が満たすデータ契約を定義します。
 */
export interface TableEditorLineBreakEdit {

    /**
     * 「value」は、対象の内容または識別子を表す文字列です。
     */
    value: string;

    /**
     * 「caretOffset」は、本文または選択範囲の位置・長さを保持します。
     */
    caretOffset: number;
}

/**
 * 「TableEditorLineBreakDelete」が満たすデータ契約を定義します。
 */
export interface TableEditorLineBreakDelete {

    /**
     * 「value」は、対象の内容または識別子を表す文字列です。
     */
    value: string;

    /**
     * 「caretOffset」は、本文または選択範囲の位置・長さを保持します。
     */
    caretOffset: number;
}

/**
 * 表編集UIに表示するセル値へ、保存済みMarkdown改行を変換する。
 * @param value 「tableEditorCellDisplayValue」で検証・変換する入力値です。
 * @returns 「tableEditorCellDisplayValue」が生成または変換した表編集の文字列を返します。
 */
export function tableEditorCellDisplayValue(value: string): string {
    return value.replace(/<br\s*\/?>/gi,
    /**
 * 「lineBreak」を受け取り、入力文字列を置換して変換する処理です。
     * @param lineBreak lineBreakとして渡される、このコールバックの入力値です。
     * @returns 置換後の文字列を返します。
     */
    (lineBreak) => `${lineBreak}\n`);
}

/**
 * 表編集UIの実改行を、Markdown表へ保存する改行タグへ変換する。
 * @param value 「tableEditorCellStoredValue」で検証・変換する入力値です。
 * @param previousStoredValue 「previousStoredValue」は、「tableEditorCellStoredValue」が表編集で処理する対象を特定する入力です。
 * @returns 「tableEditorCellStoredValue」が生成または変換した表編集の文字列を返します。
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
 * 「TableEditorDisplayEdit」が満たすデータ契約を定義します。
 */
interface TableEditorDisplayEdit {

    /**
     * 「prefixLength」は、本文または選択範囲の位置・長さを保持します。
     */
    prefixLength: number;

    /**
     * 「previousEnd」は、位置・サイズ・件数などを表す数値です。
     */
    previousEnd: number;

    /**
     * 「nextEnd」は、位置・サイズ・件数などを表す数値です。
     */
    nextEnd: number;
}

/**
 * remove・deleted・break・newlineを解除または削除します。
 * @param nextDisplayValue 「nextDisplayValue」は、「removeDeletedBreakNewline」が表編集で処理する対象を特定する入力です。
 * @param previousDisplayValue 「previousDisplayValue」は、「removeDeletedBreakNewline」が表編集で処理する対象を特定する入力です。
 * @returns 「removeDeletedBreakNewline」が生成または変換した表編集の文字列を返します。
 */
function removeDeletedBreakNewline(nextDisplayValue: string, previousDisplayValue: string): string {
    const edit = findTableEditorDisplayEdit(previousDisplayValue, nextDisplayValue);
    if (!edit) return nextDisplayValue;

    if (nextDisplayValue.length >= previousDisplayValue.length) return nextDisplayValue;

    const deletedBreak = [...previousDisplayValue.matchAll(/<br\s*\/?>/gi)].find(
    /**
 * 「match」が検索条件に一致するか判定するコールバックです。
     * @param match matchとして渡される、このコールバックの入力値です。
     * @returns 条件に一致した要素、または該当しない場合はundefinedを返します。
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
 * find・table・editor・display・editを取得または解決します。
 * @param previousValue 「previousValue」は、「findTableEditorDisplayEdit」が表編集で処理する対象を特定する入力です。
 * @param nextValue 「nextValue」は、「findTableEditorDisplayEdit」が表編集で処理する対象を特定する入力です。
 * @returns 「findTableEditorDisplayEdit」が対象を取得できない場合はundefinedを返します。
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
 * 表示上の選択位置を保存値のオフセットへ変換する。
 * @param value 「tableEditorCellStoredOffsetFromDisplay」で検証・変換する入力値です。
 * @param displayOffset 本文または選択範囲を示すゼロ基準の位置です。範囲の開始・終了や写像の基準になります。
 * @returns 計算結果の数値です。
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
 * 保存値のオフセットを表示上の選択位置へ変換する。
 * @param value 「tableEditorCellDisplayOffsetFromStored」で検証・変換する入力値です。
 * @param storedOffset 本文または選択範囲を示すゼロ基準の位置です。範囲の開始・終了や写像の基準になります。
 * @returns 計算結果の数値です。
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
 * セル内の選択範囲へMarkdown表で使う改行タグを挿入する。
 * @param value 「insertTableEditorLineBreak」で検証・変換する入力値です。
 * @param selectionStart 「selectionStart」は、「insertTableEditorLineBreak」が表編集状態の処理対象を特定する入力です。
 * @param selectionEnd 「selectionEnd」は、「insertTableEditorLineBreak」が表編集状態の処理対象を特定する入力です。
 * @returns 「insertTableEditorLineBreak」が表編集状態の入力を処理して得た固有の結果を返します。
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
 * 次の表示行の先頭からBackspaceしたときに直前のMarkdown改行を削除する。
 * @param value 「deleteTableEditorLineBreakBeforeDisplayOffset」で検証・変換する入力値です。
 * @param displayOffset 本文または選択範囲を示すゼロ基準の位置です。範囲の開始・終了や写像の基準になります。
 * @returns 「deleteTableEditorLineBreakBeforeDisplayOffset」が対象を取得できない場合はundefinedを返します。
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
 * clamp・offsetを正規化します。
 * @param value 「clampOffset」で検証・変換する入力値です。
 * @param maximum 「maximum」は、「clampOffset」が表編集状態の処理対象を特定する入力です。
 * @returns 計算結果の数値です。
 */
function clampOffset(value: number, maximum: number): number {
    if (!Number.isFinite(value)) return maximum;
    return Math.max(0, Math.min(maximum, Math.trunc(value)));
}

/**
 * カーソル位置を含むGFM表を、専用エディター用のセルモデルへ変換する。
 * @param source 処理対象のソースです。
 * @param offset 本文または選択範囲を示すゼロ基準の位置です。範囲の開始・終了や写像の基準になります。
 * @returns 「readTableEditorDraft」が対象を取得できない場合はundefinedを返します。
 */
export function readTableEditorDraft(source: string, offset: number): TableEditorDraft | undefined {
    const lineBreaks = [...source.matchAll(/\r\n|\r|\n/g)].map(
    /**
 * 「match」を変換し、変換後の要素を返すコールバックです。
     * @param match matchとして渡される、このコールバックの入力値です。
     * @returns 入力要素から生成した変換後の値を返します。
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
 * 「row」を変換し、変換後の要素を返すコールバックです。
     * @param row 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 入力要素から生成した変換後の値を返します。
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
 * セルモデルをGFM表へ戻し、現在セルの先頭位置も返す。
 * @param draft 「draft」は、「renderTableEditorDraft」が表編集状態の処理対象を特定する入力です。
 * @returns 「renderTableEditorDraft」が生成した表編集状態のデータを返します。
 */
export function renderTableEditorDraft(draft: TableEditorDraft): RenderedTableDraft {
    const sourceRows = draft.rows.length ? draft.rows : [[]];
    const columnCount = Math.max(1, draft.alignments.length, ...sourceRows.map(
    /**
 * 「row」を変換し、変換後の要素を返すコールバックです。
     * @param row 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (row) => row.length));
    // 表セル内の未エスケープの縦棒は、セル境界と区別できるように保存時だけエスケープする。
    const rows = sourceRows.map(
    /**
 * 「row」を変換し、変換後の要素を返すコールバックです。
     * @param row 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (row) => Array.from(
        { length: columnCount },

        /**
 * 「_」「index」から配列要素を生成するコールバックです。
         * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
         * @param index 本文、表、配列内の対象位置を示すインデックスです。
         * @returns 「_」「index」から生成した処理結果を返します。
         */
        (_, index) => escapeUnescapedPipes(row[index] ?? '')
    ));
    const alignments = Array.from({ length: columnCount },
    /**
 * 「_」「index」から配列要素を生成するコールバックです。
     * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
     * @param index 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 「_」「index」から生成した処理結果を返します。
     */
    (_, index) => draft.alignments[index] ?? 'none');
    const renderedRows = rows.map(
    /**
 * 「row」を変換し、変換後の要素を返すコールバックです。
     * @param row 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 入力要素から生成した変換後の値を返します。
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
 * 現在本文へ安全に適用できるかを判定し、変更がある場合だけ置換内容を返す。
 * @param draft 「draft」は、「prepareTableEditorApply」が表編集状態の処理対象を特定する入力です。
 * @param currentSource 処理対象のソースです。
 * @returns 「prepareTableEditorApply」が表編集状態の入力を処理して得た固有の結果を返します。
 */
export function prepareTableEditorApply(draft: TableEditorDraft, currentSource: string): TableEditorApplyResult {
    if (currentSource !== draft.sourceText) return { kind: 'stale' };
    const rendered = renderTableEditorDraft(draft);
    if (rendered.text === currentSource.slice(draft.from, draft.to)) return { kind: 'noop' };
    return { kind: 'changed', text: rendered.text, caretOffset: rendered.caretOffset };
}

/**
 * 行かどうかを判定します。
 * @param line 「line」は、「isTableRow」が表編集状態の処理対象を特定する入力です。
 * @returns 判定結果です。
 */
function isTableRow(line: string | undefined): boolean {
    const trimmed = line?.trim() ?? '';
    return trimmed.includes('|') && trimmed.length > 0;
}

/**
 * 行かどうかを判定します。
 * @param line 「line」は、「isSeparatorRow」が表編集状態の処理対象を特定する入力です。
 * @returns 判定結果です。
 */
function isSeparatorRow(line: string): boolean {
    const cells = splitTableCells(line);
    return cells.length > 0 && cells.every(
    /**
 * 「cell」が条件を満たすか判定し、全要素の適合結果を返すコールバックです。
     * @param cell 処理対象のセルです。
     * @returns 条件判定の結果を示す真偽値を返します。
     */
    (cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

/**
 * 「splitTableCells」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param line 「line」は、「splitTableCells」が表編集状態の処理対象を特定する入力です。
 * @returns 「splitTableCells」が生成または変換した表編集の文字列を返します。
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
 * 「tableColumnAt」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param line 「line」は、「tableColumnAt」が表編集状態の処理対象を特定する入力です。
 * @param offset 本文または選択範囲を示すゼロ基準の位置です。範囲の開始・終了や写像の基準になります。
 * @param columnCount 「columnCount」は、「tableColumnAt」が表編集で処理する対象を特定する入力です。
 * @returns 計算結果の数値です。
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
 * 「separatorAlignment」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param value 「separatorAlignment」で検証・変換する入力値です。
 * @returns 「separatorAlignment」が表編集状態の入力を処理して得た固有の結果を返します。
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
 * 「alignmentSeparator」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param alignment 「alignment」は、「alignmentSeparator」が表編集状態の処理対象を特定する入力です。
 * @returns 「alignmentSeparator」が生成または変換した表編集の文字列を返します。
 */
function alignmentSeparator(alignment: TableEditorAlignment): string {
    if (alignment === 'left') return ':---';
    if (alignment === 'center') return ':---:';
    if (alignment === 'right') return '---:';
    return '---';
}

/**
 * 行を描画します。
 * @param indent 「indent」は、「renderRow」が表編集状態の処理対象を特定する入力です。
 * @param cells 「cells」は、「renderRow」が表編集状態の処理対象を特定する入力です。
 * @returns 「renderRow」が生成または変換した表編集の文字列を返します。
 */
function renderRow(indent: string, cells: string[]): string {
    return `${indent}| ${cells.join(' | ')} |`;
}

/**
 * 「countTrailingBackslashes」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param value 「countTrailingBackslashes」で検証・変換する入力値です。
 * @param end 「end」は、「countTrailingBackslashes」が表編集状態の処理対象を特定する入力です。
 * @returns 計算結果の数値です。
 */
function countTrailingBackslashes(value: string, end: number): number {
    let count = 0;
    for (let index = end - 1; index >= 0 && value[index] === '\\'; index -= 1) count += 1;
    return count;
}

/**
 * escape・unescaped・pipesを安全な形式へ変換します。
 * @param value 「escapeUnescapedPipes」で検証・変換する入力値です。
 * @returns 「escapeUnescapedPipes」が生成または変換した表編集の文字列を返します。
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
 * is・inside・markdown・fenceかどうかを判定します。
 * @param lines 「lines」は、「isInsideMarkdownFence」が表編集状態の処理対象を特定する入力です。
 * @param lineIndex 「lineIndex」は、「isInsideMarkdownFence」が表編集で処理する対象を特定する入力です。
 * @returns 判定結果です。
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

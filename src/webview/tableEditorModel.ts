export type TableEditorAlignment = 'none' | 'left' | 'center' | 'right';

export interface TableEditorDraft {
    from: number;
    to: number;
    originalText: string;
    /** 表を開いた時点の本文全体。編集中の外部変更を検知するために保持する。 */
    sourceText: string;
    indent: string;
    eol: string;
    rows: string[][];
    alignments: TableEditorAlignment[];
    activeRow: number;
    activeColumn: number;
}

export interface RenderedTableDraft {
    text: string;
    caretOffset: number;
}

export type TableEditorApplyResult =
    | { kind: 'stale' }
    | { kind: 'noop' }
    | { kind: 'changed'; text: string; caretOffset: number };

export interface TableEditorLineBreakEdit {
    value: string;
    caretOffset: number;
}

export interface TableEditorLineBreakDelete {
    value: string;
    caretOffset: number;
}

/** 表編集UIに表示するセル値へ、保存済みMarkdown改行を変換する。 */
export function tableEditorCellDisplayValue(value: string): string {
    return value.replace(/<br\s*\/?>/gi, (lineBreak) => `${lineBreak}\n`);
}

/** 表編集UIの実改行を、Markdown表へ保存する改行タグへ変換する。 */
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

interface TableEditorDisplayEdit {
    prefixLength: number;
    previousEnd: number;
    nextEnd: number;
}

function removeDeletedBreakNewline(nextDisplayValue: string, previousDisplayValue: string): string {
    const edit = findTableEditorDisplayEdit(previousDisplayValue, nextDisplayValue);
    if (!edit) return nextDisplayValue;

    if (nextDisplayValue.length >= previousDisplayValue.length) return nextDisplayValue;

    const deletedBreak = [...previousDisplayValue.matchAll(/<br\s*\/?>/gi)].find((match) => {
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

/** 表示上の選択位置を保存値のオフセットへ変換する。 */
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

/** 保存値のオフセットを表示上の選択位置へ変換する。 */
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

/** セル内の選択範囲へMarkdown表で使う改行タグを挿入する。 */
export function insertTableEditorLineBreak(value: string, selectionStart = value.length, selectionEnd = selectionStart): TableEditorLineBreakEdit {
    const from = Math.max(0, Math.min(selectionStart, value.length));
    const to = Math.max(from, Math.min(selectionEnd, value.length));
    const inserted = '<br>';
    return {
        value: `${value.slice(0, from)}${inserted}${value.slice(to)}`,
        caretOffset: from + inserted.length
    };
}

/** 次の表示行の先頭からBackspaceしたときに直前のMarkdown改行を削除する。 */
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

function clampOffset(value: number, maximum: number): number {
    if (!Number.isFinite(value)) return maximum;
    return Math.max(0, Math.min(maximum, Math.trunc(value)));
}

/** カーソル位置を含むGFM表を、専用エディター用のセルモデルへ変換する。 */
export function readTableEditorDraft(source: string, offset: number): TableEditorDraft | undefined {
    const lineBreaks = [...source.matchAll(/\r\n|\r|\n/g)].map((match) => match[0]);
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
    const columnCount = Math.max(1, separator.length, ...rows.map((row) => row.length));
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

/** セルモデルをGFM表へ戻し、現在セルの先頭位置も返す。 */
export function renderTableEditorDraft(draft: TableEditorDraft): RenderedTableDraft {
    const sourceRows = draft.rows.length ? draft.rows : [[]];
    const columnCount = Math.max(1, draft.alignments.length, ...sourceRows.map((row) => row.length));
    // 表セル内の未エスケープの縦棒は、セル境界と区別できるように保存時だけエスケープする。
    const rows = sourceRows.map((row) => Array.from(
        { length: columnCount },
        (_, index) => escapeUnescapedPipes(row[index] ?? '')
    ));
    const alignments = Array.from({ length: columnCount }, (_, index) => draft.alignments[index] ?? 'none');
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

/** 現在本文へ安全に適用できるかを判定し、変更がある場合だけ置換内容を返す。 */
export function prepareTableEditorApply(draft: TableEditorDraft, currentSource: string): TableEditorApplyResult {
    if (currentSource !== draft.sourceText) return { kind: 'stale' };
    const rendered = renderTableEditorDraft(draft);
    if (rendered.text === currentSource.slice(draft.from, draft.to)) return { kind: 'noop' };
    return { kind: 'changed', text: rendered.text, caretOffset: rendered.caretOffset };
}

function isTableRow(line: string | undefined): boolean {
    const trimmed = line?.trim() ?? '';
    return trimmed.includes('|') && trimmed.length > 0;
}

function isSeparatorRow(line: string): boolean {
    const cells = splitTableCells(line);
    return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

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

function tableColumnAt(line: string, offset: number, columnCount: number): number {
    const before = line.slice(0, Math.max(0, offset));
    let pipes = 0;
    for (let index = 0; index < before.length; index += 1) {
        if (before[index] === '|' && countTrailingBackslashes(before, index) % 2 === 0) pipes += 1;
    }
    return Math.max(0, Math.min(columnCount - 1, pipes - 1));
}

function separatorAlignment(value: string): TableEditorAlignment {
    const trimmed = value.trim();
    const left = trimmed.startsWith(':');
    const right = trimmed.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return 'none';
}

function alignmentSeparator(alignment: TableEditorAlignment): string {
    if (alignment === 'left') return ':---';
    if (alignment === 'center') return ':---:';
    if (alignment === 'right') return '---:';
    return '---';
}

function renderRow(indent: string, cells: string[]): string {
    return `${indent}| ${cells.join(' | ')} |`;
}

function countTrailingBackslashes(value: string, end: number): number {
    let count = 0;
    for (let index = end - 1; index >= 0 && value[index] === '\\'; index -= 1) count += 1;
    return count;
}

function escapeUnescapedPipes(value: string): string {
    let result = '';
    for (let index = 0; index < value.length; index += 1) {
        if (value[index] === '|' && countTrailingBackslashes(value, index) % 2 === 0) result += '\\';
        result += value[index];
    }
    return result;
}

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

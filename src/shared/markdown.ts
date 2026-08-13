import { marked, type Token, type Tokens } from 'marked';
import { getMessages, type SupportedLanguage } from './messages';

export interface TextSelection {
    from: number;
    to: number;
}

export interface SourceEdit {
    text: string;
    selection: TextSelection;
}

export interface OutlineItem {
    level: number;
    text: string;
    line: number;
    offset: number;
    id: string;
}

export interface MarkdownBlock {
    from: number;
    to: number;
    raw: string;
    type: string;
}

export interface Diagnostic {
    severity: 'error' | 'warning' | 'info';
    code: string;
    message: string;
    line?: number;
    source?: string;
}

export interface DiagnosticSummary {
    errors: Diagnostic[];
    warnings: Diagnostic[];
    infos: Diagnostic[];
}

export interface LocalResourceReference {
    kind: 'image' | 'link';
    source: string;
    line: number;
}

interface LocalResourceDefinition {
    kind: 'image' | 'link';
    source: string;
    line: number;
}

interface ScannedResourceLink {
    kind: 'image' | 'link';
    source?: string;
    referenceLabel?: string;
    offset: number;
}

const INLINE_MARKERS: Array<[RegExp, string]> = [
    [/\*\*([^\n]+?)\*\*/g, '$1'],
    [/__([^\n]+?)__/g, '$1'],
    [/~~([^\n]+?)~~/g, '$1'],
    [/==([^\n]+?)==/g, '$1'],
    [/\+\+([^\n]+?)\+\+/g, '$1'],
    [/`([^`\n]+?)`/g, '$1'],
    [/\^([^\^\n]+?)\^/g, '$1'],
    [/~([^~\n]+?)~/g, '$1'],
    [/\*([^*\n]+?)\*/g, '$1'],
    [/_([^_\n]+?)_/g, '$1']
];

/**
 * 選択範囲を指定されたMarkdown記号で囲み、置換後の選択範囲を返す。
 * @param source 編集対象のMarkdown本文。
 * @param selection 装飾対象の選択範囲。
 * @param prefix 選択文字列の前へ挿入する記号。
 * @param suffix 選択文字列の後へ挿入する記号。省略時はprefixと同じ値。
 * @param placeholder 選択範囲が空の場合に装飾する仮文字列。
 * @returns 置換後の本文と新しい選択範囲。
 */
export function wrapSelection(
    source: string,
    selection: TextSelection,
    prefix: string,
    suffix = prefix,
    placeholder = 'テキスト'
): SourceEdit {
    // 選択範囲を正規化し、選択文字列またはプレースホルダーを装飾文字で囲む。
    const from = Math.min(selection.from, selection.to);
    const to = Math.max(selection.from, selection.to);
    const selectedSource = source.slice(from, to);
    const selected = selectedSource || placeholder;
    const hasSelection = selectedSource.length > 0;
    const before = hasSelection && !/^\s/.test(selectedSource) && from > 0 && !/\s/.test(source[from - 1]) ? ' ' : '';
    const after = hasSelection && !/\s$/.test(selectedSource) && to < source.length && !/\s/.test(source[to]) ? ' ' : '';
    const replacement = `${before}${prefix}${selected}${suffix}${after}`;
    return {
        text: source.slice(0, from) + replacement + source.slice(to),
        selection: {
            from: from + before.length + prefix.length,
            to: from + before.length + prefix.length + selected.length
        }
    };
}

/**
 * 選択範囲の各行へプレフィックスを付けるか、すでに付いていれば取り除く。
 * @param source 編集対象のMarkdown本文。
 * @param selection プレフィックスを適用する選択範囲。
 * @param prefix 行頭へ付け外しする文字列。
 * @returns 変更後の本文と選択範囲。
 */
export function prefixSelectedLines(
    source: string,
    selection: TextSelection,
    prefix: string
): SourceEdit {
    // 選択範囲に含まれる行を取得し、各行の先頭にプレフィックスを付けるか外す。
    const from = lineStart(source, Math.min(selection.from, selection.to));
    const to = lineEnd(source, Math.max(selection.from, selection.to));
    const original = source.slice(from, to);
    const lines = original.split('\n');
    const caretOnly = selection.from === selection.to;
    const allPrefixed = lines.every((line) => !line.trim() || line.startsWith(prefix));
    const changed = lines
        .map((line) => {
            if (!line.trim()) return caretOnly && lines.length === 1 ? prefix + line : line;
            if (line.startsWith(prefix)) return allPrefixed ? line.slice(prefix.length) : line;
            return prefix + line;
        })
        .join('\n');
    return {
        text: source.slice(0, from) + changed + source.slice(to),
        selection: { from, to: from + changed.length }
    };
}

/**
 * 選択行を番号付きリストへ変換するか、番号付きリストなら通常の行へ戻す。
 * @param source 編集対象のMarkdown本文。
 * @param selection 番号付きリストを切り替える範囲。
 * @returns 変更後の本文と選択範囲。
 */
export function prefixOrderedList(source: string, selection: TextSelection): SourceEdit {
    // 選択行がすべて番号付きリストなら番号を外し、それ以外なら連番を付ける。
    const from = lineStart(source, Math.min(selection.from, selection.to));
    const to = lineEnd(source, Math.max(selection.from, selection.to));
    const original = source.slice(from, to);
    const lines = original.split('\n');
    const caretOnly = selection.from === selection.to;
    const ordered = /^\s*\d+[.)]\s+/;
    const allOrdered = lines.every((line) => !line.trim() || ordered.test(line));
    const changed = caretOnly && lines.length === 1 && !lines[0].trim()
        ? [`${orderedListNumberBefore(source, from)}. `]
        : allOrdered
        ? lines.map((line) => line.replace(/^(\s*)\d+[.)]\s+/, '$1'))
        : orderedListLines(lines, orderedListNumberBefore(source, from));
    const text = changed.join('\n');
    return {
        text: source.slice(0, from) + text + source.slice(to),
        selection: { from, to: from + text.length }
    };
}

/**
 * 複数行へ開始番号から連続する番号付きリスト記号を付与する。
 * @param lines 変換対象の行配列。
 * @param firstNumber 最初の行へ付ける番号。
 * @returns 連番を付与した行配列。
 */
function orderedListLines(lines: string[], firstNumber: number): string[] {
    // 空行とインデントを維持しながら、各行へ開始番号からの連番を付ける。
    let number = firstNumber;
    return lines.map((line) => {
        if (!line.trim()) return line;
        const indentation = line.match(/^\s*/)?.[0] ?? '';
        const content = line.slice(indentation.length).replace(/^(?:[-+*]|\d+[.)])\s+/, '');
        const result = `${indentation}${number}. ${content}`;
        number += 1;
        return result;
    });
}

/**
 * 対象行の直前の番号付きリストを調べ、次に使用する番号を返す。
 * @param source 編集対象のMarkdown本文。
 * @param from 対象行の開始オフセット。
 * @returns 次の番号付きリスト項目に使う番号。
 */
function orderedListNumberBefore(source: string, from: number): number {
    // 対象行の直前にある番号付きリストを読み取り、次に使う番号を計算する。
    const previousLine = source.slice(0, Math.max(0, from - 1)).split(/\r?\n/).at(-1) ?? '';
    const match = previousLine.match(/^\s*(\d+)[.)]\s+/);
    const previousNumber = match ? Number(match[1]) : 0;
    return Number.isSafeInteger(previousNumber) ? previousNumber + 1 : 1;
}

/**
 * 選択範囲からインライン装飾記号を除去し、リンク先などの構造は維持する。
 * @param source 編集対象のMarkdown本文。
 * @param selection 装飾を除去する範囲。
 * @returns 変更後の本文と選択範囲。
 */
export function clearInlineFormatting(source: string, selection: TextSelection): SourceEdit {
    // 選択範囲のリンク先を一時退避し、本文中のインライン装飾記号だけを取り除く。
    const from = Math.min(selection.from, selection.to);
    const to = Math.max(selection.from, selection.to);
    let selected = source.slice(from, to);
    if (!selected) return { text: source, selection: { from, to } };
    const protectedTargets: string[] = [];
    // リンク先をプレースホルダーへ置き換え、装飾除去の対象から外す。
    selected = selected.replace(/(\]\()([^)]+)(\))/g, (_match, open: string, target: string, close: string) => {
        const index = protectedTargets.push(target) - 1;
        return `${open}\uE000${index}\uE001${close}`;
    });
    for (const [pattern, replacement] of INLINE_MARKERS) {
        // 定義済みの装飾パターンを順番に適用して、記号を内容へ置き換える。
        selected = selected.replace(pattern, replacement);
    }
    // 退避していたリンク先を元の位置へ戻す。
    selected = selected.replace(/\uE000(\d+)\uE001/g, (_match, index: string) => protectedTargets[Number(index)] ?? '');
    return {
        text: source.slice(0, from) + selected + source.slice(to),
        selection: { from, to: from + selected.length }
    };
}

/**
 * 選択行から見出し・引用・リスト・コードフェンスなどのブロック記号を除去する。
 * @param source 編集対象のMarkdown本文。
 * @param selection ブロック記号を除去する範囲。
 * @returns 変更後の本文と選択範囲。
 */
export function clearBlockFormatting(source: string, selection: TextSelection): SourceEdit {
    // 選択行を取り出し、コードフェンス・見出し・引用・リスト・インデントの記号を除去する。
    const selectionFrom = Math.min(selection.from, selection.to);
    const selectionTo = Math.max(selection.from, selection.to);
    if (selectionFrom === selectionTo) return { text: source, selection: { from: selectionFrom, to: selectionTo } };
    const from = lineStart(source, selectionFrom);
    const to = lineEnd(source, selectionTo);
    let lines = source.slice(from, to).split('\n');
    // 選択範囲全体がコードフェンスで囲まれている場合は、外側のフェンスを先に外す。
    if (lines.length >= 2 && /^\s*`{3,}[^`]*$/.test(lines[0]) && /^\s*`{3,}\s*$/.test(lines.at(-1) ?? '')) {
        lines = lines.slice(1, -1);
    }
    const changed = lines
        .map((line) =>
            line
                .replace(/^\s{0,3}#{1,6}\s+/, '')
                .replace(/^\s*>\s?/, '')
                .replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
                .replace(/^\s{4}/, '')
        )
        .join('\n');
    return {
        text: source.slice(0, from) + changed + source.slice(to),
        selection: { from, to: from + changed.length }
    };
}

/**
 * 指定された行数・列数の空のMarkdown表を生成する。
 * @param rows 生成する表の行数。
 * @param columns 生成する表の列数。
 * @returns 見出し・区切り・空行を含むMarkdown表。
 */
export function createTableMarkdown(rows = 3, columns = 3): string {
    // 行数と列数を許容範囲へ収め、見出し・区切り・空の本文行から表を生成する。
    const safeRows = Math.max(2, Math.min(rows, 50));
    const safeColumns = Math.max(1, Math.min(columns, 20));
    const header = `| ${Array.from({ length: safeColumns }, (_, i) => `列${i + 1}`).join(' | ')} |`;
    const divider = `| ${Array.from({ length: safeColumns }, () => '---').join(' | ')} |`;
    const body = Array.from(
        { length: safeRows - 1 },
        () => `| ${Array.from({ length: safeColumns }, () => '').join(' | ')} |`
    );
    return [header, divider, ...body].join('\n');
}

export type MarkdownTableAction =
    | 'rowBefore'
    | 'rowAfter'
    | 'deleteRow'
    | 'colBefore'
    | 'colAfter'
    | 'deleteColumn'
    | 'header'
    | 'alignLeft'
    | 'alignCenter'
    | 'alignRight'
    | 'alignColumns';

export interface MarkdownTableActionOptions {
    headerName?: string;
}

interface ParsedMarkdownTable {
    lines: string[];
    lineStarts: number[];
    eol: string;
    startLine: number;
    endLine: number;
    separatorLine: number;
    rows: string[][];
    separator: string[];
    indent: string;
    rowIndex: number;
    columnIndex: number;
}

/**
 * 選択位置を含むMarkdown表へ行・列・見出し・配置の操作を適用する。
 * @param markdown 編集対象のMarkdown本文。
 * @param selection 表内の現在の選択範囲。
 * @param action 適用する表操作。
 * @param options 列追加時などに使う操作オプション。
 * @returns 表を変更した編集結果。表外または適用不能な場合はundefined。
 */
export function applyMarkdownTableAction(
    markdown: string,
    selection: TextSelection,
    action: MarkdownTableAction,
    options: MarkdownTableActionOptions = {}
): SourceEdit | undefined {
    // 選択位置を含むGFM表を解析し、操作対象の行・列を複製して編集する。
    const table = parseMarkdownTable(markdown, selection);
    if (!table) return undefined;

    const rows = table.rows.map((row) => row.slice());
    const separator = table.separator.slice();
    let rowIndex = table.rowIndex;
    const columnIndex = table.columnIndex;

    // 指定された操作に応じて行・列・見出し・配置を変更する。
    switch (action) {
        case 'rowBefore':
            rows.splice(rowIndex, 0, Array.from({ length: separator.length }, () => ''));
            break;
        case 'rowAfter':
            rows.splice(rowIndex + 1, 0, Array.from({ length: separator.length }, () => ''));
            rowIndex += 1;
            break;
        case 'deleteRow':
            if (rows.length <= 1) return undefined;
            rows.splice(rowIndex, 1);
            rowIndex = Math.min(rowIndex, rows.length - 1);
            break;
        case 'colBefore':
            rows.forEach((row, index) => row.splice(columnIndex, 0, index === 0 ? newColumnHeader(options.headerName, columnIndex + 1) : ''));
            separator.splice(columnIndex, 0, '---');
            break;
        case 'colAfter':
            rows.forEach((row, index) => row.splice(columnIndex + 1, 0, index === 0 ? newColumnHeader(options.headerName, columnIndex + 2) : ''));
            separator.splice(columnIndex + 1, 0, '---');
            break;
        case 'deleteColumn':
            if (separator.length <= 1) return undefined;
            for (const row of rows) row.splice(columnIndex, 1);
            separator.splice(columnIndex, 1);
            break;
        case 'header':
            if (rowIndex === 0) return undefined;
            [rows[0], rows[rowIndex]] = [rows[rowIndex], rows[0]];
            rowIndex = 0;
            break;
        case 'alignLeft':
            separator[columnIndex] = ':---';
            break;
        case 'alignCenter':
            separator[columnIndex] = ':---:';
            break;
        case 'alignRight':
            separator[columnIndex] = '---:';
            break;
        case 'alignColumns': {
            // 各列の表示幅を求め、本文セルと区切りセルを同じ幅に揃える。
            const widths = Array.from({ length: separator.length }, (_, index) =>
                Math.max(
                    3,
                    displayWidth(separator[index] ?? ''),
                    ...rows.map((row) => displayWidth(row[index] ?? ''))
                )
            );
            for (const row of rows) {
                for (let index = 0; index < widths.length; index += 1) {
                    row[index] = padDisplayWidth(row[index] ?? '', widths[index]);
                }
            }
            for (let index = 0; index < widths.length; index += 1) {
                separator[index] = padDisplayWidth(separator[index] ?? '---', widths[index]);
            }
            break;
        }
    }

    return renderMarkdownTableEdit(markdown, table, rows, separator, rowIndex, columnIndex);
}

/**
 * 選択位置の周囲からMarkdown表を解析し、編集に必要な行・列情報を返す。
 * @param markdown 解析対象のMarkdown本文。
 * @param selection 表内位置を示す選択範囲。
 * @returns 解析した表情報。選択位置が有効な表でない場合はundefined。
 */
function parseMarkdownTable(markdown: string, selection: TextSelection): ParsedMarkdownTable | undefined {
    // 改行位置を記録しながら、選択行を含む連続した表の範囲を特定する。
    const lineBreaks = [...markdown.matchAll(/\r\n|\r|\n/g)].map((match) => match[0]);
    const eol = lineBreaks[0] ?? '\n';
    const lines = markdown.split(/\r\n|\r|\n/);
    const lineStarts: number[] = [];
    let offset = 0;
    for (let index = 0; index < lines.length; index += 1) {
        lineStarts.push(offset);
        offset += lines[index].length + (lineBreaks[index]?.length ?? 0);
    }

    const currentLine = findLineIndex(lineStarts, selection.from);
    if (!isTableRowLine(lines[currentLine])) return undefined;
    if (isInsideMarkdownFence(lines, currentLine)) return undefined;
    let startLine = currentLine;
    let endLine = currentLine;
    while (startLine > 0 && isTableRowLine(lines[startLine - 1])) startLine -= 1;
    while (endLine + 1 < lines.length && isTableRowLine(lines[endLine + 1])) endLine += 1;

    const separatorLine = lines.findIndex((line, index) => index >= startLine && index <= endLine && isTableSeparatorLine(line));
    if (separatorLine < 0) return undefined;
    if (separatorLine !== startLine + 1 || !isTableRowLine(lines[startLine])) return undefined;

    // 区切り行を除いた本文行をセルへ分割し、すべての行を同じ列数へ補正する。
    const rowLines = lines
        .slice(startLine, endLine + 1)
        .map((line, index) => ({ line, index: startLine + index }))
        .filter(({ index }) => index !== separatorLine);
    if (!rowLines.length) return undefined;

    const rows = rowLines.map(({ line }) => splitTableCells(line));
    const separator = splitTableCells(lines[separatorLine]);
    const columnCount = Math.max(1, separator.length, ...rows.map((row) => row.length));
    for (const row of rows) while (row.length < columnCount) row.push('');
    while (separator.length < columnCount) separator.push('---');

    const rowLineIndex = rowLines.findIndex(({ index }) => index === currentLine);
    const rowIndex = rowLineIndex < 0 ? 0 : rowLineIndex;
    const lineOffset = selection.from - lineStarts[currentLine];
    const columnIndex = tableColumnAt(lines[currentLine], lineOffset, columnCount);
    const indent = /^\s*/.exec(lines[rowLines[0].index])?.[0] ?? '';

    return {
        lines,
        lineStarts,
        eol,
        startLine,
        endLine,
        separatorLine,
        rows,
        separator,
        indent,
        rowIndex,
        columnIndex
    };
}

/**
 * 編集済みの表を本文へ再配置し、対象セルの新しいカーソル位置を計算する。
 * @param markdown 元のMarkdown本文。
 * @param table 解析済みの表情報。
 * @param rows 編集済みの本文行セル。
 * @param separator 編集済みの区切り行セル。
 * @param rowIndex カーソルを置く本文行のインデックス。
 * @param columnIndex カーソルを置く列のインデックス。
 * @returns 表を置換した本文と新しいカーソル位置。
 */
function renderMarkdownTableEdit(
    markdown: string,
    table: ParsedMarkdownTable,
    rows: string[][],
    separator: string[],
    rowIndex: number,
    columnIndex: number
): SourceEdit {
    // 編集済みの行と区切り行をMarkdownへ再出力し、選択セルの先頭へカーソルを移す。
    const renderedRows = rows.map((row) => renderTableRow(table.indent, row));
    const renderedSeparator = renderTableRow(table.indent, separator);
    const renderedTable = [renderedRows[0], renderedSeparator, ...renderedRows.slice(1)];
    const startOffset = table.lineStarts[table.startLine];
    const endOffset = table.lineStarts[table.endLine] + table.lines[table.endLine].length;
    const replacement = renderedTable.join(table.eol);
    const text = markdown.slice(0, startOffset) + replacement + markdown.slice(endOffset);
    const renderedRowIndex = rowIndex === 0 ? 0 : rowIndex + 1;
    const rowPrefix = renderedTable.slice(0, renderedRowIndex).join(table.eol);
    const rowStart = startOffset + rowPrefix.length + (renderedRowIndex ? table.eol.length : 0);
    const safeColumn = Math.min(columnIndex, rows[rowIndex].length - 1);
    const cellOffset = table.indent.length + 2
        + rows[rowIndex].slice(0, safeColumn).reduce((total, cell) => total + cell.length + 3, 0);
    const caret = rowStart + cellOffset;
    return { text, selection: { from: caret, to: caret } };
}

/**
 * TSVを指定セルからMarkdown表へ貼り付ける。
 * @param markdown 編集対象のMarkdown本文。
 * @param selection 貼り付け開始セルの選択範囲。
 * @param tsv タブと改行で区切られたクリップボード文字列。
 * @returns 表内なら既存表を更新し、表外なら新しいGFM表を挿入した編集結果。
 */
export function applyMarkdownTableTsv(
    markdown: string,
    selection: TextSelection,
    tsv: string
): SourceEdit | undefined {
    const from = Math.min(selection.from, selection.to);
    const to = Math.max(selection.from, selection.to);
    if (isMarkdownCodeFencePosition(markdown, selection)) return undefined;
    const table = parseMarkdownTable(markdown, { from, to: from });
    const pastedRows = parseTsv(tsv);
    if (!pastedRows.length || !pastedRows.some((row) => row.length)) return undefined;

    if (!table) return insertMarkdownTableFromTsv(markdown, selection, pastedRows);
    const tableEnd = table.lineStarts[table.endLine] + table.lines[table.endLine].length;
    if (to > tableEnd) return insertMarkdownTableFromTsv(markdown, selection, pastedRows);
    if (table.separatorLine === findLineIndex(table.lineStarts, from)) return undefined;

    const rows = table.rows.map((row) => row.slice());
    const separator = table.separator.slice();
    const requiredRows = table.rowIndex + pastedRows.length;
    const requiredColumns = table.columnIndex + Math.max(...pastedRows.map((row) => row.length));
    while (rows.length < requiredRows) rows.push(Array.from({ length: separator.length }, () => ''));
    while (separator.length < requiredColumns) separator.push('---');
    for (const row of rows) while (row.length < separator.length) row.push('');

    for (let rowOffset = 0; rowOffset < pastedRows.length; rowOffset += 1) {
        const row = pastedRows[rowOffset];
        for (let columnOffset = 0; columnOffset < row.length; columnOffset += 1) {
            rows[table.rowIndex + rowOffset][table.columnIndex + columnOffset] = escapeMarkdownTableCell(row[columnOffset]);
        }
    }
    return renderMarkdownTableEdit(markdown, table, rows, separator, table.rowIndex, table.columnIndex);
}

/**
 * TSV表変換を行ってよい貼り付け位置かを判定する。
 * @param markdown 編集対象のMarkdown本文。
 * @param selection 貼り付け位置。
 * @returns コードフェンス内ならtrue。
 */
export function isMarkdownCodeFencePosition(markdown: string, selection: TextSelection): boolean {
    const lines = markdown.split(/\r\n|\r|\n/);
    const lineStarts: number[] = [];
    let offset = 0;
    for (let index = 0; index < lines.length; index += 1) {
        lineStarts.push(offset);
        offset += lines[index].length + (markdown.slice(offset + lines[index].length).match(/^\r\n|^\r|^\n/)?.[0].length ?? 0);
    }
    const line = findLineIndex(lineStarts, Math.min(selection.from, selection.to));
    return isInsideMarkdownFence(lines, line);
}

/**
 * TSVの行列をGFM表へ変換し、選択範囲を表で置換する。
 * @param markdown 編集対象のMarkdown本文。
 * @param selection 表を挿入する選択範囲。
 * @param rows TSVを解析した行列。
 * @returns GFM表を挿入した編集結果。
 */
function insertMarkdownTableFromTsv(markdown: string, selection: TextSelection, rows: string[][]): SourceEdit {
    const eol = markdown.match(/\r\n|\r|\n/)?.[0] ?? '\n';
    const from = Math.max(0, Math.min(selection.from, selection.to));
    const to = Math.min(markdown.length, Math.max(selection.from, selection.to));
    const columnCount = Math.max(1, ...rows.map((row) => row.length));
    const normalizedRows = rows.map((row) => Array.from({ length: columnCount }, (_, index) => escapeMarkdownTableCell(row[index] ?? '')));
    const separator = Array.from({ length: columnCount }, () => '---');
    const rendered = [
        renderTableRow('', normalizedRows[0]),
        renderTableRow('', separator),
        ...normalizedRows.slice(1).map((row) => renderTableRow('', row))
    ].join(eol);
    const before = markdown.slice(0, from);
    const after = markdown.slice(to);
    const prefix = before.length && !before.endsWith('\n') ? eol : '';
    const suffix = after.length && !/^(?:\r\n|\r|\n)/.test(after) ? eol : '';
    const replacement = prefix + rendered + suffix;
    const text = before + replacement + after;
    const caret = from + replacement.length;
    return { text, selection: { from: caret, to: caret } };
}

/**
 * 選択位置を含むMarkdown表を、区切り行を除いたTSVへ変換する。
 * @param markdown 解析対象のMarkdown本文。
 * @param selection 表内の現在の選択範囲。
 * @returns ヘッダー行とデータ行のTSV。表外または区切り行ならundefined。
 */
export function markdownTableToTsv(markdown: string, selection: TextSelection): string | undefined {
    const table = parseMarkdownTable(markdown, selection);
    if (!table || table.separatorLine === findLineIndex(table.lineStarts, selection.from)) return undefined;
    return table.rows
        .map((row) => row.map((cell) => encodeTsvCell(stripMarkdownTableCell(cell))).join('\t'))
        .join('\r\n');
}

/**
 * TSV文字列を引用符と改行を考慮して行列へ分解する。
 * @param tsv クリップボードから取得したTSV。
 * @returns 行と列からなるTSVの行列。
 */
function parseTsv(tsv: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    let hasValue = false;
    for (let index = 0; index < tsv.length; index += 1) {
        const character = tsv[index];
        if (quoted) {
            if (character === '"' && tsv[index + 1] === '"') {
                cell += '"';
                index += 1;
            } else if (character === '"') {
                quoted = false;
            } else {
                cell += character;
            }
            hasValue = true;
            continue;
        }
        if (character === '"' && cell.length === 0) {
            quoted = true;
            hasValue = true;
        } else if (character === '\t') {
            row.push(cell);
            cell = '';
            hasValue = true;
        } else if (character === '\r' || character === '\n') {
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
            hasValue = false;
            if (character === '\r' && tsv[index + 1] === '\n') index += 1;
        } else {
            cell += character;
            hasValue = true;
        }
    }
    if (hasValue || cell.length > 0 || row.length > 0) row.push(cell);
    if (row.length) rows.push(row);
    return rows;
}

/**
 * TSVのセルをMarkdown表のセルとして安全に保存する。
 * @param value TSVセルの値。
 * @returns パイプ、バックスラッシュ、改行を処理したMarkdownセル。
 */
function escapeMarkdownTableCell(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/[|`*_~\[\]<>]/g, '\\$&')
        .replace(/\r\n|\r|\n/g, '<br>');
}

/**
 * 指定行がMarkdownのフェンスコードブロック内にあるかを判定する。
 * @param lines Markdown本文の行配列。
 * @param lineIndex 判定対象の行番号。
 * @returns フェンスコード内ならtrue。
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

/**
 * Markdown表セルをExcel向けの表示文字列へ変換する。
 * @param value Markdown表セルの値。
 * @returns Markdown記号を除去したセル値。
 */
function stripMarkdownTableCell(value: string): string {
    let text = value.trim()
        .replace(/\\\|/g, '|')
        .replace(/\\([\\`*_~+\[\]()<>])/g, '$1')
        .replace(/<br\s*\/?\s*>/gi, '\n')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, '');
    for (const [pattern, replacement] of INLINE_MARKERS) text = text.replace(pattern, replacement);
    return text;
}

/**
 * TSVセルを必要な場合だけ引用して出力する。
 * @param value 出力するセル値。
 * @returns TSVとして安全なセル文字列。
 */
function encodeTsvCell(value: string): string {
    return /[\t\r\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * 行開始オフセットの配列から指定位置を含む行を二分探索する。
 * @param lineStarts 各行の開始オフセット。
 * @param offset 検索対象の本文オフセット。
 * @returns オフセットが属する行のインデックス。
 */
function findLineIndex(lineStarts: number[], offset: number): number {
    // 行開始位置の配列を二分探索し、オフセットが属する行番号を求める。
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (lineStarts[middle] <= offset) low = middle;
        else high = middle - 1;
    }
    return low;
}

/**
 * 行が空でなく表のセル区切りを含むかを判定する。
 * @param line 判定対象の行。
 * @returns 表の行候補であればtrue。
 */
function isTableRowLine(line: string | undefined): boolean {
    // 空でなく区切り記号を含む行を表の行候補として判定する。
    const trimmed = line?.trim() ?? '';
    return trimmed.includes('|') && trimmed.length > 0;
}

/**
 * 行の全セルがMarkdown表の区切りセルとして有効かを判定する。
 * @param line 判定対象の行。
 * @returns すべてのセルが区切り形式ならtrue。
 */
function isTableSeparatorLine(line: string): boolean {
    // 全セルがMarkdown表の区切り形式になっているかを判定する。
    const cells = splitTableCells(line);
    return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

/**
 * エスケープされていない縦棒でMarkdown表の行をセルへ分割する。
 * @param line 分割対象の表行。
 * @returns 前後の外側区切りを除いて分割したセル配列。
 */
function splitTableCells(line: string): string[] {
    // エスケープされていない縦棒だけを区切りとして、表のセルを分割する。
    let body = line.trim();
    if (body.startsWith('|')) body = body.slice(1);
    if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1);
    const cells: string[] = [];
    let cell = '';
    for (let index = 0; index < body.length; index += 1) {
        const character = body[index];
        if (character === '|' && body[index - 1] !== '\\') {
            cells.push(cell.trim());
            cell = '';
        } else {
            cell += character;
        }
    }
    cells.push(cell.trim());
    return cells;
}

/**
 * 行内のカーソル位置に対応するMarkdown表の列番号を求める。
 * @param line 表行の文字列。
 * @param offset 行内のカーソルオフセット。
 * @param columnCount 表の列数。
 * @returns カーソルが属する列インデックス。
 */
function tableColumnAt(line: string, offset: number, columnCount: number): number {
    // 行内の縦棒を数え、指定オフセットが属する列番号を求める。
    const firstContent = line.search(/\S/);
    let start = firstContent < 0 ? 0 : firstContent;
    if (line[start] === '|') start += 1;
    let column = 0;
    for (let index = start; index < Math.min(offset, line.length); index += 1) {
        if (line[index] === '|' && line[index - 1] !== '\\') column += 1;
    }
    return Math.max(0, Math.min(column, columnCount - 1));
}

/**
 * インデントとセル配列からMarkdown表の1行を生成する。
 * @param indent 表行へ付けるインデント。
 * @param cells 出力するセル配列。
 * @returns Markdown表の1行。
 */
function renderTableRow(indent: string, cells: string[]): string {
    // インデントとセル配列から、1行分のMarkdown表記を生成する。
    return indent + '| ' + cells.join(' | ') + ' |';
}

/**
 * 新しい列の見出しを指定値から作り、空なら列番号を使った見出しを返す。
 * @param value ユーザーが指定した見出し。
 * @param columnNumber 既定見出しに使う列番号。
 * @returns 新しい列の見出し文字列。
 */
function newColumnHeader(value: string | undefined, columnNumber: number): string {
    // 指定された見出しを使い、空の場合は列番号から既定の見出しを作る。
    const header = value?.trim();
    return header || `列${columnNumber}`;
}

/**
 * 日本語などの全角文字を2幅として文字列の表示幅を計算する。
 * @param value 表示幅を計算する文字列。
 * @returns 表示上の文字幅。
 */
function displayWidth(value: string): number {
    // 結合文字を除外し、全角文字を2幅として表示幅を数える。
    let width = 0;
    for (const character of Array.from(value)) {
        if (/\p{Mark}/u.test(character)) continue;
        const codePoint = character.codePointAt(0) ?? 0;
        width += isWideCodePoint(codePoint) ? 2 : 1;
    }
    return width;
}

/**
 * 文字列末尾へ空白を追加し、指定された表示幅へ揃える。
 * @param value 空白を追加する文字列。
 * @param width 目標とする表示幅。
 * @returns 指定幅へ揃えた文字列。
 */
function padDisplayWidth(value: string, width: number): string {
    // 現在の表示幅が指定幅に届くまで末尾へ空白を追加する。
    return value + ' '.repeat(Math.max(0, width - displayWidth(value)));
}

/**
 * Unicodeコードポイントが全角表示の対象範囲に含まれるかを判定する。
 * @param codePoint 判定対象のUnicodeコードポイント。
 * @returns 全角表示対象ならtrue。
 */
function isWideCodePoint(codePoint: number): boolean {
    // コードポイントが全角表示されるUnicode範囲に含まれるかを判定する。
    return codePoint >= 0x1100 && (
        codePoint <= 0x115f
        || codePoint === 0x2329
        || codePoint === 0x232a
        || (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f)
        || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
        || (codePoint >= 0xf900 && codePoint <= 0xfaff)
        || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
        || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
        || (codePoint >= 0xff01 && codePoint <= 0xff60)
        || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
        || (codePoint >= 0x1f300 && codePoint <= 0x1faff)
    );
}

/**
 * 画像代替テキストのMarkdown記号と改行をエスケープまたは除去する。
 * @param value 変換対象の代替テキスト。
 * @returns 画像記法へ埋め込める1行の代替テキスト。
 */
export function escapeMarkdownAlt(value: string): string {
    // 画像の代替テキストからMarkdown記号と改行を除去して1行へ整える。
    return value.replace(/[\[\]\\]/g, '\\$&').replace(/[\r\n]+/g, ' ').trim();
}

/**
 * 画像パスと代替テキストからMarkdown画像記法を生成する。
 * @param path 画像ファイルのパス。
 * @param alt 画像の代替テキスト。
 * @returns Markdown画像記法。
 */
export function imageMarkdown(path: string, alt = getMessages('ja').editor.defaultImageAlt): string {
    // パスの区切りを正規化し、エスケープ済みの代替テキストで画像記法を作る。
    return `![${escapeMarkdownAlt(alt)}](${path.replace(/\\/g, '/')})`;
}

/**
 * Markdown見出しを走査し、アウトライン表示用の項目と一意なIDを作る。
 * @param markdown 解析対象のMarkdown本文。
 * @returns 見出しレベル・本文・行番号・オフセット・IDの一覧。
 */
export function getOutline(markdown: string): OutlineItem[] {
    // Markdownの見出しを走査し、表示名・行番号・文書内位置・重複しないIDを収集する。
    const items: OutlineItem[] = [];
    const duplicateCount = new Map<string, number>();
    let lineNumber = 1;
    for (const lineMatch of markdown.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
        const rawLine = lineMatch[0];
        if (!rawLine && lineMatch.index === markdown.length) break;
        const line = rawLine.replace(/(?:\r\n|\r|\n)$/, '');
        const match = /^(#{1,6})\s+(.+?)(?:\s+\{#([^}]+)\})?\s*#*\s*$/.exec(line);
        if (match) {
            // 装飾記号を除いた見出し文字列から、明示IDまたは自動生成IDを決める。
            const text = match[2].replace(/[*_`~+=]/g, '').trim();
            const baseId = match[3] || slugify(text);
            const count = duplicateCount.get(baseId) ?? 0;
            duplicateCount.set(baseId, count + 1);
            items.push({
                level: match[1].length,
                text,
                line: lineNumber,
                offset: lineMatch.index,
                id: count ? `${baseId}-${count}` : baseId
            });
        }
        lineNumber += 1;
    }
    return items;
}

/**
 * Markdownをmarkedのトークン単位へ分割し、元本文の範囲情報を付加する。
 * @param markdown 分割対象のMarkdown本文。
 * @returns トークンと空白を元本文の範囲付きで表すブロック一覧。
 */
export function splitMarkdownBlocks(markdown: string): MarkdownBlock[] {
    // 改行を正規化したMarkdownをmarkedで解析し、元文書のオフセットを持つブロックへ変換する。
    if (!markdown) return [{ from: 0, to: 0, raw: '', type: 'space' }];
    const { normalized, originalOffsets } = normalizeWithOriginalOffsets(markdown);
    const tokens = marked.lexer(normalized, { gfm: true, breaks: false });
    const blocks: MarkdownBlock[] = [];
    let cursor = 0;
    for (const token of tokens) {
        // トークンの前にある未分類部分を空白ブロックとして追加する。
        const raw = token.raw ?? '';
        const found = normalized.indexOf(raw, cursor);
        if (found > cursor) {
            const from = originalOffsets[cursor];
            const to = originalOffsets[found];
            blocks.push({ from, to, raw: markdown.slice(from, to), type: 'space' });
        }
        const from = found >= 0 ? found : cursor;
        const to = from + raw.length;
        const originalFrom = originalOffsets[from];
        const originalTo = originalOffsets[to];
        blocks.push({
            from: originalFrom,
            to: originalTo,
            raw: markdown.slice(originalFrom, originalTo),
            type: token.type
        });
        cursor = to;
    }
    if (cursor < normalized.length) {
        // 最後のトークン以降に残った文字列をテキストブロックとして追加する。
        const originalFrom = originalOffsets[cursor];
        blocks.push({ from: originalFrom, to: markdown.length, raw: markdown.slice(originalFrom), type: 'text' });
    }
    return blocks.length ? blocks : [{ from: 0, to: markdown.length, raw: markdown, type: 'text' }];
}

/**
 * 改行をLFへ正規化し、正規化後の位置から元本文の位置を引ける配列を作る。
 * @param markdown 正規化対象のMarkdown本文。
 * @returns 正規化後の文字列と元本文オフセットの対応表。
 */
function normalizeWithOriginalOffsets(markdown: string): { normalized: string; originalOffsets: number[] } {
    // CRLF・CRをLFへ統一し、正規化後の各文字位置から元文書位置への対応表を作る。
    let normalized = '';
    const originalOffsets = [0];
    let offset = 0;
    while (offset < markdown.length) {
        if (markdown[offset] === '\r') {
            offset += markdown[offset + 1] === '\n' ? 2 : 1;
            normalized += '\n';
        } else {
            normalized += markdown[offset];
            offset += 1;
        }
        originalOffsets.push(offset);
    }
    return { normalized, originalOffsets };
}

/**
 * コードフェンス・表・見出し・リンク・画像を検査し、Markdown診断情報を収集する。
 * @param markdown 検査対象のMarkdown本文。
 * @returns エラー・警告・情報の診断一覧。
 */
export function collectDiagnostics(markdown: string, language: SupportedLanguage | string = 'ja'): Diagnostic[] {
    // 文書全体を1回走査し、診断パネルとPDF出力前チェックが共有する結果を作る。
    const messages = getMessages(language);
    const diagnostics: Diagnostic[] = [];
    const lines = markdown.split(/\r\n|\r|\n/);
    const fencedLines = new Set<number>();
    let openFence: { marker: string; line: number } | undefined;

    lines.forEach((line, index) => {
        const match = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(stripResourceContainerPrefix(line));
        if (!openFence && !match) return;
        fencedLines.add(index + 1);
        if (!match) return;
        if (!openFence) {
            openFence = { marker: match[1], line: index + 1 };
            return;
        }
        if (match[1][0] === openFence.marker[0]
            && match[1].length >= openFence.marker.length
            && /^[ \t]*$/.test(match[2])) {
            openFence = undefined;
        }
    });
    if (openFence) {
        diagnostics.push({
            severity: 'error',
            code: 'unclosed-fence',
            line: openFence.line,
            message: messages.diagnostics.unclosedFence(openFence.marker)
        });
    }

    const seen = new Map<string, number>();
    lines.forEach((line, index) => {
        if (fencedLines.has(index + 1)) return;
        const match = /^(#{1,6})\s+(.+?)(?:\s+\{#([^}]+)\})?\s*#*\s*$/.exec(line);
        if (!match) return;
        const id = match[3] || slugify(match[2].replace(/[*_`~+=]/g, '').trim());
        const count = seen.get(id) ?? 0;
        if (count) {
            diagnostics.push({
                severity: 'warning',
                code: 'duplicate-heading',
                line: index + 1,
                message: messages.diagnostics.duplicateHeading(id)
            });
        }
        seen.set(id, count + 1);
    });

    const recognizedTableLines = new Set<number>();
    for (let index = 0; index < lines.length - 1; index += 1) {
        if (fencedLines.has(index + 1) || recognizedTableLines.has(index + 1) || !isTableRowLine(lines[index])) continue;
        const next = lines[index + 1];
        if (isTableSeparatorLine(next)) {
            diagnoseMarkdownTable(lines, index, fencedLines, diagnostics, messages);
            recognizedTableLines.add(index + 1);
            recognizedTableLines.add(index + 2);
            for (let rowIndex = index + 2; rowIndex < lines.length && isTableRowLine(lines[rowIndex]); rowIndex += 1) {
                recognizedTableLines.add(rowIndex + 1);
            }
        } else if (isInvalidTableSeparatorCandidate(next)) {
            diagnostics.push({
                severity: 'error',
                code: 'invalid-table-separator',
                line: index + 2,
                message: messages.diagnostics.invalidTableSeparator
            });
            recognizedTableLines.add(index + 1);
            recognizedTableLines.add(index + 2);
            for (let rowIndex = index + 2; rowIndex < lines.length && isTableRowLine(lines[rowIndex]); rowIndex += 1) {
                recognizedTableLines.add(rowIndex + 1);
            }
        }
    }

    const referenceDefinitions = new Set<string>();
    lines.forEach((line, index) => {
        if (fencedLines.has(index + 1)) return;
        const definition = parseReferenceDefinition(line);
        if (definition) referenceDefinitions.add(normalizeReferenceLabel(definition));
    });
    lines.forEach((line, index) => {
        if (fencedLines.has(index + 1)) return;
        if (parseReferenceDefinition(line)) return;
        const sourceLine = maskInlineCode(line);
        for (const reference of collectReferenceUsages(sourceLine)) {
            if (reference.isImage && !reference.text.trim()) {
                diagnostics.push({
                    severity: 'warning',
                    code: 'empty-image-alt',
                    line: index + 1,
                    message: messages.diagnostics.emptyImageAlt
                });
            }
            reportBrokenReference(reference.label || reference.text, index + 1, referenceDefinitions, diagnostics, messages);
        }
    });

    const imageSource = markdown.replace(/`+[^`\r\n]*`+/g, (code) => code.replace(/[^\r\n]/g, ' '));
    const imagePattern = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    let imageMatch: RegExpExecArray | null;
    while ((imageMatch = imagePattern.exec(imageSource))) {
        const line = markdown.slice(0, imageMatch.index).split(/\r\n|\r|\n/).length;
        if (fencedLines.has(line)) continue;
        if (!imageMatch[1].trim()) {
            diagnostics.push({
                severity: 'warning',
                code: 'empty-image-alt',
                line,
                message: messages.diagnostics.emptyImageAlt
            });
        }
        if (/^(?:https?:|data:|#)/i.test(imageMatch[2])) continue;
        diagnostics.push({
            severity: 'info',
            code: 'local-image',
            line,
            source: imageMatch[2],
            message: messages.diagnostics.localImageCheck(imageMatch[2])
        });
    }
    return sortDiagnostics(diagnostics);
}

/** Markdown本文からローカル画像・リンクの参照を抽出する。 */
export function collectLocalResourceReferences(markdown: string): LocalResourceReference[] {
    const lines = markdown.split(/\r\n|\r|\n/);
    const fencedLines = new Set<number>();
    let openFence: { marker: string; line: number } | undefined;
    lines.forEach((line, index) => {
        const match = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(stripResourceContainerPrefix(line));
        if (!openFence && !match) return;
        fencedLines.add(index + 1);
        if (!match) return;
        if (!openFence) {
            openFence = { marker: match[1], line: index + 1 };
            return;
        }
        if (match[1][0] === openFence.marker[0]
            && match[1].length >= openFence.marker.length
            && /^[ \t]*$/.test(match[2])) {
            openFence = undefined;
        }
    });

    const commentState = { open: false };
    const scanLines = lines.map((line, index) => {
        if (fencedLines.has(index + 1) || isIndentedResourceCodeLine(line)) return ' '.repeat(line.length);
        return maskHtmlComments(maskInlineCode(line), commentState);
    });
    const scanSource = scanLines.join('\n');
    const definitions = new Map<string, LocalResourceDefinition>();
    const definitionLines = new Set<number>();
    scanLines.forEach((line, index) => {
        const definition = parseLocalResourceDefinition(line);
        if (!definition || !isLocalResourceSource(definition.source)) return;
        definitionLines.add(index + 1);
        definitions.set(normalizeReferenceLabel(definition.label), {
            kind: definition.kind,
            source: definition.source,
            line: index + 1
        });
    });

    const references: LocalResourceReference[] = [];
    const usedDefinitions = new Set<string>();
    for (const scanned of scanMarkdownResourceLinks(scanSource)) {
        const line = lineNumberAt(scanSource, scanned.offset);
        if (definitionLines.has(line)) continue;
        if (scanned.source) {
            if (isLocalResourceSource(scanned.source)) {
                references.push({ kind: scanned.kind, source: scanned.source, line });
            }
            continue;
        }
        const label = normalizeReferenceLabel(scanned.referenceLabel ?? '');
        const definition = definitions.get(label);
        if (!definition) continue;
        usedDefinitions.add(label);
        references.push({
            kind: scanned.kind === 'image' || definition.kind === 'image' ? 'image' : 'link',
            source: definition.source,
            line
        });
    }

    // 参照定義が単独で書かれている場合も、定義行自体を検査対象にする。
    definitions.forEach((definition, label) => {
        if (!usedDefinitions.has(label)) {
            references.push({ kind: definition.kind, source: definition.source, line: definition.line });
        }
    });
    return references;
}

/** Markdownのリンク・画像を括弧のネストと改行を考慮して走査する。 */
function scanMarkdownResourceLinks(source: string): ScannedResourceLink[] {
    const links: ScannedResourceLink[] = [];
    for (let index = 0; index < source.length; index += 1) {
        const isImage = source[index] === '!' && source[index + 1] === '[';
        const open = isImage ? index + 1 : index;
        if (source[open] !== '['
            || source[open - 1] === '\\'
            || (source[open - 1] === '!' && source[open - 2] === '\\')
            || (isImage && source[index - 1] === '\\')) continue;
        const text = readBracketContent(source, open);
        if (!text) continue;
        const kind = isImage ? 'image' : 'link';
        const afterText = text.end + 1;
        if (source[afterText] === '(') {
            const destination = readInlineResourceDestination(source, afterText);
            if (destination) {
                links.push({ kind, source: destination.source, offset: index });
                index = destination.end;
                continue;
            }
        }
        if (source[afterText] === '[') {
            const label = readBracketContent(source, afterText);
            if (label) {
                links.push({
                    kind,
                    referenceLabel: label.content || text.content,
                    offset: index
                });
                index = label.end;
                continue;
            }
        }
        // 定義済みのショートカット参照は、定義マップで解決できるものだけ後段で採用する。
        links.push({ kind, referenceLabel: text.content, offset: index });
        index = text.end;
    }
    const htmlPattern = /<(img|a)\b[^>]*?\b(src|href)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/giu;
    let htmlMatch: RegExpExecArray | null;
    while ((htmlMatch = htmlPattern.exec(source))) {
        const htmlSource = htmlMatch[3] ?? htmlMatch[4] ?? htmlMatch[5] ?? '';
        links.push({
            kind: htmlMatch[1].toLowerCase() === 'img' ? 'image' : 'link',
            source: htmlSource,
            offset: htmlMatch.index
        });
    }
    return links.sort((left, right) => left.offset - right.offset);
}

/** インラインリンクのリンク先を、ネストした括弧と改行を含めて読む。 */
function readInlineResourceDestination(source: string, open: number): { source: string; end: number } | undefined {
    let index = open + 1;
    while (/\s/u.test(source[index] ?? '')) index += 1;
    if (index >= source.length) return undefined;

    let destination: string;
    if (source[index] === '<') {
        const start = ++index;
        while (index < source.length) {
            if (source[index] === '\\') {
                index += 2;
                continue;
            }
            if (source[index] === '>') break;
            index += 1;
        }
        if (source[index] !== '>') return undefined;
        destination = source.slice(start, index);
        index += 1;
    } else {
        const start = index;
        let nestedParentheses = 0;
        while (index < source.length) {
            const character = source[index];
            if (character === '\\') {
                index += 2;
                continue;
            }
            if (character === '(') {
                nestedParentheses += 1;
                index += 1;
                continue;
            }
            if (character === ')') {
                if (nestedParentheses === 0) break;
                nestedParentheses -= 1;
                index += 1;
                continue;
            }
            if (/\s/u.test(character) && nestedParentheses === 0) break;
            index += 1;
        }
        destination = source.slice(start, index);
    }
    if (!destination) return undefined;
    const close = findInlineResourceClose(source, index);
    return close < 0 ? undefined : { source: destination.replace(/\\([\\()])/g, '$1'), end: close };
}

/** インラインリンクの終端括弧を探す。 */
function findInlineResourceClose(source: string, start: number): number {
    let nestedParentheses = 0;
    for (let index = start; index < source.length; index += 1) {
        if (source[index] === '\\') {
            index += 1;
            continue;
        }
        if (source[index] === '(') nestedParentheses += 1;
        if (source[index] !== ')') continue;
        if (nestedParentheses === 0) return index;
        nestedParentheses -= 1;
    }
    return -1;
}

/** 参照リンク定義を、引用・リストのブロック接頭辞を除いて読む。 */
function parseLocalResourceDefinition(line: string): { kind: 'image' | 'link'; label: string; source: string } | undefined {
    const candidate = stripResourceContainerPrefix(line);
    const match = /^(!?)\[([^\]]*)\]:\s*(<[^>\r\n]+>|[^\s]+)(?:\s+.*)?$/u.exec(candidate);
    if (!match) return undefined;
    return {
        kind: match[1] ? 'image' : 'link',
        label: match[2],
        source: match[3].replace(/^<|>$/g, '').trim()
    };
}

/** 4スペースインデントのコードブロックを含む行か判定する。 */
function isIndentedResourceCodeLine(line: string): boolean {
    if (/^(?: {4}|\t)/u.test(line)) return true;
    if (/^\s{0,3}(?:>|(?:[-+*]|\d+[.)]))\s+ {4}/u.test(line)) return true;
    const stripped = stripResourceContainerPrefix(line);
    return stripped !== line && /^(?: {4}|\t)/u.test(stripped);
}

/** 引用・リスト接頭辞を取り除く。 */
function stripResourceContainerPrefix(line: string): string {
    if (/^(?: {4}|\t)/u.test(line)) return line;
    let result = line;
    for (let count = 0; count < 4; count += 1) {
        const next = result
            .replace(/^\s{0,3}>\s?/u, '')
            .replace(/^\s{0,3}(?:[-+*]|\d+[.)])\s+/u, '');
        if (next === result) break;
        result = next;
    }
    return result.replace(/^\s+/u, '');
}

/** HTMLコメント内を空白化し、コメント中のリンクを検出対象から除外する。 */
function maskHtmlComments(line: string, state: { open: boolean }): string {
    let result = '';
    let offset = 0;
    while (offset < line.length) {
        if (state.open) {
            const close = line.indexOf('-->', offset);
            if (close < 0) return `${result}${' '.repeat(line.length - offset)}`;
            result += ' '.repeat(close + 3 - offset);
            offset = close + 3;
            state.open = false;
            continue;
        }
        const open = line.indexOf('<!--', offset);
        if (open < 0) return result + line.slice(offset);
        result += line.slice(offset, open);
        result += ' '.repeat(4);
        offset = open + 4;
        state.open = true;
    }
    return result;
}

/** 文字オフセットを1始まりのMarkdown行番号へ変換する。 */
function lineNumberAt(source: string, offset: number): number {
    let line = 1;
    for (let index = 0; index < offset; index += 1) {
        if (source[index] === '\n') line += 1;
    }
    return line;
}

/** 診断を本文行順・生成順で安定ソートする。 */
export function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
    return diagnostics
        .map((item, index) => ({ item, index }))
        .sort((left, right) => {
            const leftLine = left.item.line ?? Number.MAX_SAFE_INTEGER;
            const rightLine = right.item.line ?? Number.MAX_SAFE_INTEGER;
            return leftLine - rightLine || left.index - right.index;
        })
        .map(({ item }) => item);
}

/**
 * 診断を重大度ごとに分類し、表示とPDF出力前チェックで共有する。
 * @param diagnostics 診断一覧。
 * @returns エラー・警告・情報に分類した診断。
 */
export function summarizeDiagnostics(diagnostics: Diagnostic[]): DiagnosticSummary {
    return {
        errors: diagnostics.filter((item) => item.severity === 'error'),
        warnings: diagnostics.filter((item) => item.severity === 'warning'),
        infos: diagnostics.filter((item) => item.severity === 'info')
    };
}

/** 表の列数・ヘッダー・区切り行を診断する。 */
function diagnoseMarkdownTable(lines: string[], headerLine: number, fencedLines: Set<number>, diagnostics: Diagnostic[], messages: ReturnType<typeof getMessages>): void {
    const header = splitTableCells(lines[headerLine]);
    const separator = splitTableCells(lines[headerLine + 1]);
    if (header.some((cell) => !cell.trim())) {
        diagnostics.push({
            severity: 'warning',
            code: 'empty-table-header',
            line: headerLine + 1,
            message: messages.diagnostics.emptyTableHeader
        });
    }
    if (header.length !== separator.length) {
        diagnostics.push({
            severity: 'error',
            code: 'table-column-mismatch',
            line: headerLine + 2,
            message: messages.diagnostics.tableColumnMismatch(header.length, separator.length, 'separator')
        });
    }
    for (let index = headerLine + 2; index < lines.length && isTableRowLine(lines[index]); index += 1) {
        if (fencedLines.has(index + 1)) break;
        const row = splitTableCells(lines[index]);
        if (row.length !== header.length) {
            diagnostics.push({
                severity: 'error',
                code: 'table-column-mismatch',
                line: index + 1,
                message: messages.diagnostics.tableColumnMismatch(header.length, row.length, 'body')
            });
        }
    }
}

/** 不正な表区切り行らしい文字列かを判定する。 */
function isLikelyTableSeparatorLine(line: string): boolean {
    const cells = splitTableCells(line);
    return cells.length > 0 && cells.some((cell) => /^:?-{1,}:?$/.test(cell.trim())) && line.includes('|');
}

/** 表ヘッダー直後の行が不正な区切り行候補かを判定する。 */
function isInvalidTableSeparatorCandidate(separator: string): boolean {
    const cells = splitTableCells(separator);
    const separatorLike = (cell: string): boolean => !cell.trim() || /^:?-{1,}:?$/.test(cell.trim());
    return isLikelyTableSeparatorLine(separator) && cells.every(separatorLike);
}

interface BracketContent {
    content: string;
    end: number;
}

interface ReferenceUsage {
    isImage: boolean;
    text: string;
    label: string;
}

/** エスケープとネストを考慮して角括弧の内容を読み取る。 */
function readBracketContent(source: string, open: number): BracketContent | undefined {
    let depth = 0;
    let content = '';
    for (let index = open + 1; index < source.length; index += 1) {
        const character = source[index];
        if (character === '\\' && index + 1 < source.length) {
            content += character + source[index + 1];
            index += 1;
            continue;
        }
        if (character === '[') {
            depth += 1;
            content += character;
            continue;
        }
        if (character === ']') {
            if (depth === 0) return { content, end: index };
            depth -= 1;
            content += character;
            continue;
        }
        content += character;
    }
    return undefined;
}

/** 明示的なfull/collapsed参照リンクと参照画像を抽出する。 */
function collectReferenceUsages(line: string): ReferenceUsage[] {
    const usages: ReferenceUsage[] = [];
    for (let index = 0; index < line.length; index += 1) {
        const isImage = line[index] === '!' && line[index + 1] === '[';
        const open = isImage ? index + 1 : index;
        if (line[open] !== '[' || (open > 0 && line[open - 1] === '\\')) continue;
        const text = readBracketContent(line, open);
        if (!text) continue;
        const labelOpen = text.end + 1;
        if (line[labelOpen] !== '[') {
            index = text.end;
            continue;
        }
        const label = readBracketContent(line, labelOpen);
        if (!label) {
            index = text.end;
            continue;
        }
        usages.push({ isImage, text: text.content, label: label.content });
        index = label.end;
    }
    return usages;
}

/** 参照定義行からラベルを抽出する。 */
function parseReferenceDefinition(line: string): string | undefined {
    const open = line.search(/\S/);
    if (open < 0 || line[open] !== '[') return undefined;
    const label = readBracketContent(line, open);
    if (!label || !/^\s*:/.test(line.slice(label.end + 1))) return undefined;
    const destination = line.slice(label.end + 1).replace(/^\s*:\s*/, '');
    if (!/^(?:<[^>\r\n]+>|\S+)/.test(destination)) return undefined;
    return label.content;
}

/** インラインコード内の文字を空白に置き換え、Markdown記法の誤診断を防ぐ。 */
function maskInlineCode(line: string): string {
    return line.replace(/`+[^`\r\n]*`+/g, (code) => code.replace(/[^\r\n]/g, ' '));
}

/** 参照リンクの定義有無を診断する。 */
function reportBrokenReference(
    label: string,
    line: number,
    definitions: Set<string>,
    diagnostics: Diagnostic[],
    messages: ReturnType<typeof getMessages>
): void {
    const normalizedLabel = normalizeReferenceLabel(label);
    if (!normalizedLabel) return;
    if (definitions.has(normalizedLabel)) return;
    diagnostics.push({
        severity: 'warning',
        code: 'broken-reference-link',
        line,
        message: messages.diagnostics.missingReference(normalizedLabel)
    });
}

/** 参照ラベルをMarkdownの比較用に正規化する。 */
function normalizeReferenceLabel(label: string): string {
    return label.trim().replace(/\\([\\\[\]])/g, '$1').replace(/\s+/g, ' ').toLowerCase();
}

/** 外部URL・アンカー等を除き、実在確認対象のローカル参照か判定する。 */
function isLocalResourceSource(source: string): boolean {
    if (!source || /^#/u.test(source)) return false;
    if (/^[A-Za-z]:[\\/]/u.test(source)) return true;
    if (/^(?:\\\\|\/\/)/u.test(source)) return true;
    if (/^file:/i.test(source)) return true;
    return !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(source);
}

/**
 * 改行形式を維持して空行を整え、Markdown本文末尾を改行で終わらせる。
 * @param markdown 整形対象のMarkdown本文。
 * @returns 整形後のMarkdown本文。
 */
export function formatMarkdown(markdown: string): string {
    // 改行形式を保ったまま過剰な空行を縮約し、末尾に改行を付ける。
    const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
    // 行末空白はMarkdownのハードブレークやユーザー入力の一部なので変更しない。
    const normalized = markdown
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => {
            const trailing = /[\t ]+$/.exec(line)?.[0] ?? '';
            return /^ {2,}$/.test(trailing) ? line : line.slice(0, line.length - trailing.length);
        })
        .join('\n')
        .replace(/\n{4,}/g, '\n\n\n');
    const finalText = normalized.length && !normalized.endsWith('\n') ? normalized + '\n' : normalized;
    return eol === '\r\n' ? finalText.replace(/\n/g, '\r\n') : finalText;
}

/**
 * Markdown全体と記号を除いた本文の文字数、および行数を計算する。
 * @param markdown 集計対象のMarkdown本文。
 * @returns Markdown文字数・本文文字数・行数を持つ統計情報。
 */
export function wordStats(markdown: string): { markdown: number; text: number; lines: number } {
    // コードやMarkdown記号を除いた本文を作り、文字数と行数を数える。
    const text = markdown
        .replace(/```[\s\S]*?```/g, '')
        .replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, '$1')
        .replace(/[*_`~+=#>|-]/g, '')
        .trim();
    return {
        markdown: markdown.length,
        text: Array.from(text).length,
        lines: markdown ? markdown.split(/\r?\n/).length : 1
    };
}

/**
 * 見出し文字列をURLやHTMLのIDとして使えるスラッグへ変換する。
 * @param value スラッグ化する文字列。
 * @returns 小文字化・記号除去・ハイフン化したID。空の場合はsection。
 */
export function slugify(value: string): string {
    // 見出し文字列を小文字化し、使用可能な文字とハイフンだけのIDへ変換する。
    return value
        .trim()
        .toLowerCase()
        .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-') || 'section';
}

/**
 * 指定オフセットを含む行の開始位置を返す。
 * @param source 行を検索する本文。
 * @param offset 行を調べる本文オフセット。
 * @returns 行頭の本文オフセット。
 */
function lineStart(source: string, offset: number): number {
    // 指定位置を含む行の開始オフセットを返す。
    return source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
}

/**
 * 指定オフセットを含む行の終端位置を返す。
 * @param source 行を検索する本文。
 * @param offset 行を調べる本文オフセット。
 * @returns 改行直前または本文末尾の本文オフセット。
 */
function lineEnd(source: string, offset: number): number {
    // 指定位置を含む行の終端オフセットを返す。
    const end = source.indexOf('\n', offset);
    return end < 0 ? source.length : end;
}

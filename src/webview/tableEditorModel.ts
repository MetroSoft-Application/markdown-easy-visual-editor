export type TableEditorAlignment = 'none' | 'left' | 'center' | 'right';

export interface TableEditorDraft {
  from: number;
  to: number;
  originalText: string;
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
  if (!isTableRow(lines[lineIndex])) return undefined;

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
  const columnCount = Math.max(1, draft.alignments.length, ...draft.rows.map((row) => row.length));
  const rows = draft.rows.map((row) => Array.from({ length: columnCount }, (_, index) => row[index] ?? ''));
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

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && splitTableCells(line).length > 0;
}

function isSeparatorRow(line: string): boolean {
  const cells = splitTableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitTableCells(line: string): string[] {
  const trimmed = line.trim();
  const body = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cell = '';
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === '|') {
      let backslashes = 0;
      for (let cursor = index - 1; cursor >= 0 && body[cursor] === '\\'; cursor -= 1) backslashes += 1;
      if (backslashes % 2 === 0) {
        cells.push(cell.trim());
        cell = '';
        continue;
      }
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
    if (before[index] !== '|') continue;
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && before[cursor] === '\\'; cursor -= 1) backslashes += 1;
    if (backslashes % 2 === 0) pipes += 1;
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

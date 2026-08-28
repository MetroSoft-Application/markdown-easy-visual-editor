export type TableGridAlignment = 'none' | 'left' | 'center' | 'right';

export interface TableGridModel {
  from: number;
  to: number;
  eol: string;
  indent: string;
  rows: string[][];
  alignments: TableGridAlignment[];
}

interface LineInfo {
  text: string;
  from: number;
  to: number;
  eol: string;
}

/**
 * 指定オフセットを含むGFM表を、セル編集用モデルとして読み取る。
 * Markdownセル内のインライン記法は生文字列のまま保持する。
 */
export function readTableGridAt(source: string, offset: number): TableGridModel | undefined {
  const lines = splitLines(source);
  if (!lines.length) return undefined;
  const lineIndex = lineIndexAt(lines, Math.max(0, Math.min(source.length, offset)));
  if (!isTableRow(lines[lineIndex]?.text)) return undefined;

  let start = lineIndex;
  let end = lineIndex;
  while (start > 0 && isTableRow(lines[start - 1].text)) start -= 1;
  while (end + 1 < lines.length && isTableRow(lines[end + 1].text)) end += 1;
  if (end - start < 1) return undefined;

  const header = splitTableRow(lines[start].text);
  const separator = splitTableRow(lines[start + 1].text);
  if (!header.length || !separator.length || !separator.every(isSeparatorCell)) return undefined;

  const rawRows = [header, ...lines.slice(start + 2, end + 1).map((line) => splitTableRow(line.text))];
  const columnCount = Math.max(separator.length, ...rawRows.map((row) => row.length));
  if (columnCount < 1) return undefined;
  const rows = rawRows.map((row) => Array.from({ length: columnCount }, (_, index) => row[index] ?? ''));
  const alignments = Array.from({ length: columnCount }, (_, index) => alignmentFromSeparator(separator[index] ?? '---'));
  const indent = /^\s*/.exec(lines[start].text)?.[0] ?? '';

  return {
    from: lines[start].from,
    to: lines[end].to,
    eol: lines[start].eol || lines[start + 1]?.eol || source.match(/\r\n|\r|\n/)?.[0] || '\n',
    indent,
    rows,
    alignments
  };
}

/** GFM表モデルを正規化されたMarkdown表へ直列化する。 */
export function serializeTableGrid(model: TableGridModel): string {
  const columnCount = Math.max(1, model.alignments.length, ...model.rows.map((row) => row.length));
  const rows = model.rows.length ? model.rows : [Array.from({ length: columnCount }, () => '')];
  const normalizedRows = rows.map((row) => Array.from({ length: columnCount }, (_, index) => sanitizeCell(row[index] ?? '')));
  const alignments = Array.from({ length: columnCount }, (_, index) => model.alignments[index] ?? 'none');
  const separator = alignments.map(separatorFromAlignment);
  const rendered = [
    renderRow(model.indent, normalizedRows[0]),
    renderRow(model.indent, separator),
    ...normalizedRows.slice(1).map((row) => renderRow(model.indent, row))
  ];
  return rendered.join(model.eol || '\n');
}

/** 直列化後の指定セル本文先頭オフセットを返す。 */
export function tableGridCellOffset(model: TableGridModel, rowIndex: number, columnIndex: number): number {
  const columnCount = Math.max(1, model.alignments.length, ...model.rows.map((row) => row.length));
  const safeRow = Math.max(0, Math.min(model.rows.length - 1, rowIndex));
  const safeColumn = Math.max(0, Math.min(columnCount - 1, columnIndex));
  const normalizedRows = model.rows.map((row) => Array.from({ length: columnCount }, (_, index) => sanitizeCell(row[index] ?? '')));
  const separator = Array.from({ length: columnCount }, (_, index) => separatorFromAlignment(model.alignments[index] ?? 'none'));
  const renderedRows = [normalizedRows[0] ?? Array.from({ length: columnCount }, () => ''), separator, ...normalizedRows.slice(1)];
  const renderedRowIndex = safeRow === 0 ? 0 : safeRow + 1;
  let offset = 0;
  for (let index = 0; index < renderedRowIndex; index += 1) {
    offset += renderRow(model.indent, renderedRows[index]).length + (model.eol || '\n').length;
  }
  offset += model.indent.length + 2;
  for (let index = 0; index < safeColumn; index += 1) {
    offset += renderedRows[renderedRowIndex][index].length + 3;
  }
  return offset;
}

/** TSVを引用符と改行を考慮して二次元配列へ変換する。 */
export function parseTableGridTsv(tsv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let touched = false;

  for (let index = 0; index < tsv.length; index += 1) {
    const char = tsv[index];
    if (quoted) {
      if (char === '"' && tsv[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      touched = true;
      continue;
    }
    if (char === '"' && cell.length === 0) {
      quoted = true;
      touched = true;
    } else if (char === '\t') {
      row.push(cell);
      cell = '';
      touched = true;
    } else if (char === '\r' || char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      touched = false;
      if (char === '\r' && tsv[index + 1] === '\n') index += 1;
    } else {
      cell += char;
      touched = true;
    }
  }
  if (touched || cell.length || row.length) row.push(cell);
  if (row.length) rows.push(row);
  return rows;
}

/** 指定セルを起点にTSV行列を貼り付け、必要なら行列を拡張する。 */
export function pasteTableGrid(model: TableGridModel, rowIndex: number, columnIndex: number, pasted: string[][]): TableGridModel {
  if (!pasted.length) return cloneTableGrid(model);
  const next = cloneTableGrid(model);
  const requiredRows = rowIndex + pasted.length;
  const pastedColumns = Math.max(0, ...pasted.map((row) => row.length));
  const requiredColumns = columnIndex + pastedColumns;
  const currentColumns = Math.max(1, next.alignments.length, ...next.rows.map((row) => row.length));
  const columnCount = Math.max(currentColumns, requiredColumns);

  while (next.rows.length < requiredRows) next.rows.push(Array.from({ length: columnCount }, () => ''));
  while (next.alignments.length < columnCount) next.alignments.push('none');
  for (const row of next.rows) while (row.length < columnCount) row.push('');

  pasted.forEach((row, rowOffset) => {
    row.forEach((value, columnOffset) => {
      next.rows[rowIndex + rowOffset][columnIndex + columnOffset] = value.replace(/\r\n|\r|\n/g, '<br>');
    });
  });
  return next;
}

export function cloneTableGrid(model: TableGridModel): TableGridModel {
  return {
    ...model,
    rows: model.rows.map((row) => row.slice()),
    alignments: model.alignments.slice()
  };
}

function splitLines(source: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let from = 0;
  const pattern = /\r\n|\r|\n/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const to = match.index;
    lines.push({ text: source.slice(from, to), from, to, eol: match[0] });
    from = match.index + match[0].length;
  }
  lines.push({ text: source.slice(from), from, to: source.length, eol: '' });
  return lines;
}

function lineIndexAt(lines: LineInfo[], offset: number): number {
  let low = 0;
  let high = lines.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (lines[mid].from <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

function isTableRow(line: string | undefined): boolean {
  if (!line?.trim()) return false;
  return splitTableRow(line).length >= 1 && hasUnescapedPipe(line);
}

function hasUnescapedPipe(line: string): boolean {
  let escaped = false;
  let codeTicks = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '\\' && !escaped) {
      escaped = true;
      continue;
    }
    if (char === '`' && !escaped) {
      let run = 1;
      while (line[index + run] === '`') run += 1;
      if (!codeTicks) codeTicks = run;
      else if (codeTicks === run) codeTicks = 0;
      index += run - 1;
      escaped = false;
      continue;
    }
    if (char === '|' && !escaped && !codeTicks) return true;
    escaped = false;
  }
  return false;
}

function splitTableRow(line: string): string[] {
  const indent = /^\s*/.exec(line)?.[0] ?? '';
  const text = line.slice(indent.length).trim();
  const cells: string[] = [];
  let cell = '';
  let escaped = false;
  let codeTicks = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\' && !escaped) {
      cell += char;
      escaped = true;
      continue;
    }
    if (char === '`' && !escaped) {
      let run = 1;
      while (text[index + run] === '`') run += 1;
      const ticks = '`'.repeat(run);
      cell += ticks;
      if (!codeTicks) codeTicks = run;
      else if (codeTicks === run) codeTicks = 0;
      index += run - 1;
      escaped = false;
      continue;
    }
    if (char === '|' && !escaped && !codeTicks) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += char;
    }
    escaped = false;
  }
  cells.push(cell.trim());
  if (text.startsWith('|') && cells[0] === '') cells.shift();
  if (text.endsWith('|') && cells.at(-1) === '') cells.pop();
  return cells;
}

function isSeparatorCell(value: string): boolean {
  return /^:?-{3,}:?$/.test(value.trim());
}

function alignmentFromSeparator(value: string): TableGridAlignment {
  const trimmed = value.trim();
  if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center';
  if (trimmed.startsWith(':')) return 'left';
  if (trimmed.endsWith(':')) return 'right';
  return 'none';
}

function separatorFromAlignment(alignment: TableGridAlignment): string {
  if (alignment === 'left') return ':---';
  if (alignment === 'center') return ':---:';
  if (alignment === 'right') return '---:';
  return '---';
}

function renderRow(indent: string, row: string[]): string {
  return `${indent}| ${row.join(' | ')} |`;
}

function sanitizeCell(value: string): string {
  const flattened = value.replace(/\r\n|\r|\n/g, '<br>');
  let result = '';
  for (let index = 0; index < flattened.length; index += 1) {
    const char = flattened[index];
    if (char !== '|') {
      result += char;
      continue;
    }
    let slashCount = 0;
    for (let cursor = result.length - 1; cursor >= 0 && result[cursor] === '\\'; cursor -= 1) slashCount += 1;
    if (slashCount % 2 === 0) result += '\\';
    result += '|';
  }
  return result.trim();
}

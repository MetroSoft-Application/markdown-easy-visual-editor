export interface TableGridRange {
  anchorRow: number;
  anchorColumn: number;
  focusRow: number;
  focusColumn: number;
}

export interface NormalizedTableGridRange {
  fromRow: number;
  toRow: number;
  fromColumn: number;
  toColumn: number;
}

export interface MovedTableGridColumn {
  rows: string[][];
  alignments: string[];
}

/** Clamp and normalize an anchor/focus range to an existing rectangular grid. */
export function normalizeTableGridRange(
  range: TableGridRange,
  rowCount: number,
  columnCount: number,
): NormalizedTableGridRange {
  const maxRow = Math.max(0, rowCount - 1);
  const maxColumn = Math.max(0, columnCount - 1);
  const anchorRow = clampInteger(range.anchorRow, 0, maxRow);
  const focusRow = clampInteger(range.focusRow, 0, maxRow);
  const anchorColumn = clampInteger(range.anchorColumn, 0, maxColumn);
  const focusColumn = clampInteger(range.focusColumn, 0, maxColumn);
  return {
    fromRow: Math.min(anchorRow, focusRow),
    toRow: Math.max(anchorRow, focusRow),
    fromColumn: Math.min(anchorColumn, focusColumn),
    toColumn: Math.max(anchorColumn, focusColumn),
  };
}

export function tableGridRangeContains(
  range: NormalizedTableGridRange,
  row: number,
  column: number,
): boolean {
  return (
    row >= range.fromRow &&
    row <= range.toRow &&
    column >= range.fromColumn &&
    column <= range.toColumn
  );
}

export function tableGridRangeCellCount(
  range: NormalizedTableGridRange,
): number {
  return (
    (range.toRow - range.fromRow + 1) *
    (range.toColumn - range.fromColumn + 1)
  );
}

/** Return a copy with one item moved to the target index. */
export function moveTableGridItem<T>(
  values: readonly T[],
  sourceIndex: number,
  targetIndex: number,
): T[] {
  if (
    sourceIndex < 0 ||
    targetIndex < 0 ||
    sourceIndex >= values.length ||
    targetIndex >= values.length ||
    sourceIndex === targetIndex
  ) {
    return values.slice();
  }
  const next = values.slice();
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

/** Move one complete table row without mutating the original row matrix. */
export function moveTableGridRow(
  rows: readonly (readonly string[])[],
  sourceIndex: number,
  targetIndex: number,
): string[][] {
  return moveTableGridItem(
    rows.map((row) => row.slice()),
    sourceIndex,
    targetIndex,
  );
}

/** Move one complete column, including its Markdown alignment metadata. */
export function moveTableGridColumn(
  rows: readonly (readonly string[])[],
  alignments: readonly string[],
  sourceIndex: number,
  targetIndex: number,
): MovedTableGridColumn {
  const columnCount = Math.max(
    alignments.length,
    ...rows.map((row) => row.length),
    0,
  );
  if (
    sourceIndex < 0 ||
    targetIndex < 0 ||
    sourceIndex >= columnCount ||
    targetIndex >= columnCount
  ) {
    return {
      rows: rows.map((row) => row.slice()),
      alignments: alignments.slice(),
    };
  }
  const normalizedRows = rows.map((row) =>
    Array.from({ length: columnCount }, (_, index) => row[index] ?? ""),
  );
  const normalizedAlignments = Array.from(
    { length: columnCount },
    (_, index) => alignments[index] ?? "none",
  );
  return {
    rows: normalizedRows.map((row) =>
      moveTableGridItem(row, sourceIndex, targetIndex),
    ),
    alignments: moveTableGridItem(
      normalizedAlignments,
      sourceIndex,
      targetIndex,
    ),
  };
}

/** Clear every cell in a rectangular range without changing table dimensions. */
export function clearTableGridRange(
  rows: readonly (readonly string[])[],
  range: NormalizedTableGridRange,
): string[][] {
  return rows.map((row, rowIndex) =>
    row.map((value, columnIndex) =>
      tableGridRangeContains(range, rowIndex, columnIndex) ? "" : value,
    ),
  );
}

/** Excel-style A, B, ... Z, AA column label. */
export function tableGridColumnLabel(column: number): string {
  let value = Math.max(0, Math.trunc(column)) + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

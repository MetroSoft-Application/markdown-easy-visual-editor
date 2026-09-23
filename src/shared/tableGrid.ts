/**
 * @file tableGrid.ts
 * 実行境界: Extension HostとWebviewの共有層。
 * 責務: 両実行境界で共有する値、プロトコル、変換を扱う。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: 呼び出し元から渡された値を変換し、外部状態を直接変更しない。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
/**
 * 「TableGridRange」が満たすデータ契約を定義します。
 */
export interface TableGridRange {

  /**
   * 「anchorRow」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  anchorRow: number;

  /**
   * 「anchorColumn」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  anchorColumn: number;

  /**
   * 「focusRow」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  focusRow: number;

  /**
   * 「focusColumn」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  focusColumn: number;
}

/**
 * 「NormalizedTableGridRange」が満たすデータ契約を定義します。
 */
export interface NormalizedTableGridRange {

  /**
   * 「fromRow」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  fromRow: number;

  /**
   * 「toRow」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  toRow: number;

  /**
   * 「fromColumn」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  fromColumn: number;

  /**
   * 「toColumn」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  toColumn: number;
}

/**
 * 「MovedTableGridColumn」が満たすデータ契約を定義します。
 */
export interface MovedTableGridColumn {

  /**
   * 「rows」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  rows: string[][];

  /**
   * 「alignments」は、関連する複数の対象または識別子を保持します。
   */
  alignments: string[];
}

/**
 * 範囲を正規化します。
 * @param range 処理対象の範囲です。
 * @param rowCount 「rowCount」は、「normalizeTableGridRange」が表編集で処理する対象を特定する入力です。
 * @param columnCount 「columnCount」は、「normalizeTableGridRange」が表編集で処理する対象を特定する入力です。
 * @returns 「normalizeTableGridRange」が読み取りまたは正規化した結果を返します。
 */
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

/**
 * 「tableGridRangeContains」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param range 処理対象の範囲です。
 * @param row 本文、表、配列内の対象位置を示すインデックスです。
 * @param column 本文、表、配列内の対象位置を示すインデックスです。
 * @returns 判定結果です。
 */
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

/**
 * 「tableGridRangeCellCount」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param range 処理対象の範囲です。
 * @returns 計算結果の数値です。
 */
export function tableGridRangeCellCount(
  range: NormalizedTableGridRange,
): number {
  return (
    (range.toRow - range.fromRow + 1) *
    (range.toColumn - range.fromColumn + 1)
  );
}

/**
 * 項目を移動または調整します。
 * @param values 「values」は、「moveTableGridItem」が表編集で処理する対象を特定する入力です。
 * @param sourceIndex 「sourceIndex」は、「moveTableGridItem」が表編集で処理する対象を特定する入力です。
 * @param targetIndex 「targetIndex」は、「moveTableGridItem」が表編集で処理する対象を特定する入力です。
 * @returns 「moveTableGridItem」が表編集状態の入力を処理して得た固有の結果を返します。
 */
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

/**
 * 行を移動または調整します。
 * @param rows 「rows」は、「moveTableGridRow」が表編集で処理する対象を特定する入力です。
 * @param sourceIndex 「sourceIndex」は、「moveTableGridRow」が表編集で処理する対象を特定する入力です。
 * @param targetIndex 「targetIndex」は、「moveTableGridRow」が表編集で処理する対象を特定する入力です。
 * @returns 「moveTableGridRow」が生成または変換した表編集の文字列を返します。
 */
export function moveTableGridRow(
  rows: readonly (readonly string[])[],
  sourceIndex: number,
  targetIndex: number,
): string[][] {
  return moveTableGridItem(
    rows.map(
    /**
 * 「row」を変換し、変換後の要素を返すコールバックです。
     * @param row 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (row) => row.slice()),
    sourceIndex,
    targetIndex,
  );
}

/**
 * 列を移動または調整します。
 * @param rows 「rows」は、「moveTableGridColumn」が表編集で処理する対象を特定する入力です。
 * @param alignments 「alignments」は、「moveTableGridColumn」が表編集状態の処理対象を特定する入力です。
 * @param sourceIndex 「sourceIndex」は、「moveTableGridColumn」が表編集で処理する対象を特定する入力です。
 * @param targetIndex 「targetIndex」は、「moveTableGridColumn」が表編集で処理する対象を特定する入力です。
 * @returns 「moveTableGridColumn」が表編集状態の入力を処理して得た固有の結果を返します。
 */
export function moveTableGridColumn(
  rows: readonly (readonly string[])[],
  alignments: readonly string[],
  sourceIndex: number,
  targetIndex: number,
): MovedTableGridColumn {
  const columnCount = Math.max(
    alignments.length,
    ...rows.map(
    /**
 * 「row」を変換し、変換後の要素を返すコールバックです。
     * @param row 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (row) => row.length),
    0,
  );
  if (
    sourceIndex < 0 ||
    targetIndex < 0 ||
    sourceIndex >= columnCount ||
    targetIndex >= columnCount
  ) {
    return {
      rows: rows.map(
      /**
 * 「row」を変換し、変換後の要素を返すコールバックです。
       * @param row 本文、表、配列内の対象位置を示すインデックスです。
       * @returns 入力要素から生成した変換後の値を返します。
       */
      (row) => row.slice()),
      alignments: alignments.slice(),
    };
  }
  const normalizedRows = rows.map(
  /**
 * 「row」を変換し、変換後の要素を返すコールバックです。
   * @param row 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 入力要素から生成した変換後の値を返します。
   */
  (row) =>
    Array.from({ length: columnCount },
    /**
 * 「_」「index」を受け取り、処理結果を生成する処理です。
     * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
     * @param index 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 「_」「index」から生成した処理結果を返します。
     */
    (_, index) => row[index] ?? ""),
  );
  const normalizedAlignments = Array.from(
    { length: columnCount },

    /**
 * 「_」「index」を受け取り、処理結果を生成する処理です。
     * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
     * @param index 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 「_」「index」から生成した処理結果を返します。
     */
    (_, index) => alignments[index] ?? "none",
  );
  return {
    rows: normalizedRows.map(
    /**
 * 「row」を変換し、変換後の要素を返すコールバックです。
     * @param row 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (row) =>
      moveTableGridItem(row, sourceIndex, targetIndex),
    ),
    alignments: moveTableGridItem(
      normalizedAlignments,
      sourceIndex,
      targetIndex,
    ),
  };
}

/**
 * 行を作成または組み立てます。
 * @param rows 「rows」は、「duplicateTableGridRows」が表編集で処理する対象を特定する入力です。
 * @param fromRow 「fromRow」は、「duplicateTableGridRows」が表編集で処理する対象を特定する入力です。
 * @param toRow 「toRow」は、「duplicateTableGridRows」が表編集で処理する対象を特定する入力です。
 * @returns 「duplicateTableGridRows」が生成または変換した表編集の文字列を返します。
 */
export function duplicateTableGridRows(
  rows: readonly (readonly string[])[],
  fromRow: number,
  toRow: number,
): string[][] {
  if (
    fromRow < 0 ||
    toRow < fromRow ||
    fromRow >= rows.length ||
    toRow >= rows.length
  ) {
    return rows.map(
    /**
 * 「row」を変換し、変換後の要素を返すコールバックです。
     * @param row 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (row) => row.slice());
  }
  const next = rows.map(
  /**
 * 「row」を変換し、変換後の要素を返すコールバックです。
   * @param row 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 入力要素から生成した変換後の値を返します。
   */
  (row) => row.slice());
  const copies = next.slice(fromRow, toRow + 1).map(
  /**
 * 「row」を変換し、変換後の要素を返すコールバックです。
   * @param row 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 入力要素から生成した変換後の値を返します。
   */
  (row) => row.slice());
  next.splice(Math.max(1, toRow + 1), 0, ...copies);
  return next;
}

/**
 * 列を作成または組み立てます。
 * @param rows 「rows」は、「duplicateTableGridColumns」が表編集で処理する対象を特定する入力です。
 * @param alignments 「alignments」は、「duplicateTableGridColumns」が表編集状態の処理対象を特定する入力です。
 * @param fromColumn 「fromColumn」は、「duplicateTableGridColumns」が表編集で処理する対象を特定する入力です。
 * @param toColumn 「toColumn」は、「duplicateTableGridColumns」が表編集で処理する対象を特定する入力です。
 * @returns 「duplicateTableGridColumns」が表編集状態の入力を処理して得た固有の結果を返します。
 */
export function duplicateTableGridColumns(
  rows: readonly (readonly string[])[],
  alignments: readonly string[],
  fromColumn: number,
  toColumn: number,
): MovedTableGridColumn {
  const columnCount = Math.max(
    alignments.length,
    ...rows.map(
    /**
 * 「row」を変換し、変換後の要素を返すコールバックです。
     * @param row 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (row) => row.length),
    0,
  );
  if (
    fromColumn < 0 ||
    toColumn < fromColumn ||
    fromColumn >= columnCount ||
    toColumn >= columnCount
  ) {
    return {
      rows: rows.map(
      /**
 * 「row」を変換し、変換後の要素を返すコールバックです。
       * @param row 本文、表、配列内の対象位置を示すインデックスです。
       * @returns 入力要素から生成した変換後の値を返します。
       */
      (row) => row.slice()),
      alignments: alignments.slice(),
    };
  }
  const normalizedRows = rows.map(
  /**
 * 「row」を変換し、変換後の要素を返すコールバックです。
   * @param row 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 入力要素から生成した変換後の値を返します。
   */
  (row) =>
    Array.from({ length: columnCount },
    /**
 * 「_」「index」を受け取り、処理結果を生成する処理です。
     * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
     * @param index 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 「_」「index」から生成した処理結果を返します。
     */
    (_, index) => row[index] ?? ""),
  );
  const normalizedAlignments = Array.from(
    { length: columnCount },

    /**
 * 「_」「index」を受け取り、処理結果を生成する処理です。
     * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
     * @param index 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 「_」「index」から生成した処理結果を返します。
     */
    (_, index) => alignments[index] ?? "none",
  );
  const insertAt = toColumn + 1;
  return {
    rows: normalizedRows.map(
    /**
 * 「row」を変換し、変換後の要素を返すコールバックです。
     * @param row 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (row) => [
      ...row.slice(0, insertAt),
      ...row.slice(fromColumn, toColumn + 1),
      ...row.slice(insertAt),
    ]),
    alignments: [
      ...normalizedAlignments.slice(0, insertAt),
      ...normalizedAlignments.slice(fromColumn, toColumn + 1),
      ...normalizedAlignments.slice(insertAt),
    ],
  };
}

/**
 * 範囲を解除または削除します。
 * @param rows 「rows」は、「clearTableGridRange」が表編集で処理する対象を特定する入力です。
 * @param range 処理対象の範囲です。
 * @returns 「clearTableGridRange」が生成または変換した表編集の文字列を返します。
 */
export function clearTableGridRange(
  rows: readonly (readonly string[])[],
  range: NormalizedTableGridRange,
): string[][] {
  return rows.map(
  /**
 * 「row」「rowIndex」を変換し、変換後の要素を返すコールバックです。
   * @param row 本文、表、配列内の対象位置を示すインデックスです。
   * @param rowIndex 「rowIndex」は、「row」が表編集で処理する対象を特定する入力です。
   * @returns 入力要素から生成した変換後の値を返します。
   */
  (row, rowIndex) =>
    row.map(
    /**
 * 「value」「columnIndex」を変換し、変換後の要素を返すコールバックです。
     * @param value 「value」で検証・変換する入力値です。
     * @param columnIndex 「columnIndex」は、「value」が表編集で処理する対象を特定する入力です。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (value, columnIndex) =>
      tableGridRangeContains(range, rowIndex, columnIndex) ? "" : value,
    ),
  );
}

/**
 * 「tableGridColumnLabel」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param column 本文、表、配列内の対象位置を示すインデックスです。
 * @returns 「tableGridColumnLabel」が生成した表編集の表示文字列を返します。
 */
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

/**
 * 整数を正規化します。
 * @param value 「clampInteger」で検証・変換する入力値です。
 * @param min 「min」は、「clampInteger」が表編集状態の処理対象を特定する入力です。
 * @param max 「max」は、「clampInteger」が表編集状態の処理対象を特定する入力です。
 * @returns 計算結果の数値です。
 */
function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

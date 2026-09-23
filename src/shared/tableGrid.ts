/**
 * @fileoverview 表の行列とセルを移動・追加・削除する純粋なモデル操作を提供し、選択範囲との整合性を保つ。
 */
/**
 * tablegridで共有するデータ形状を表すインターフェース。
 */
export interface TableGridRange {

    /**
     * tablegridの位置・寸法・件数・時間を表す数値。
     */
    anchorRow: number;

    /**
     * tablegridの位置・寸法・件数・時間を表す数値。
     */
    anchorColumn: number;

    /**
     * tablegridの位置・寸法・件数・時間を表す数値。
     */
    focusRow: number;

    /**
     * tablegridの位置・寸法・件数・時間を表す数値。
     */
    focusColumn: number;
}

/**
 * tablegridで共有するデータ形状を表すインターフェース。
 */
export interface NormalizedTableGridRange {

    /**
     * tablegridの位置・寸法・件数・時間を表す数値。
     */
    fromRow: number;

    /**
     * tablegridの位置・寸法・件数・時間を表す数値。
     */
    toRow: number;

    /**
     * tablegridの位置・寸法・件数・時間を表す数値。
     */
    fromColumn: number;

    /**
     * tablegridの位置・寸法・件数・時間を表す数値。
     */
    toColumn: number;
}

/**
 * tablegridで共有するデータ形状を表すインターフェース。
 */
export interface MovedTableGridColumn {

    /**
     * tablegridで扱うrowsの一覧。
     */
    rows: string[][];

    /**
     * tablegridで扱うalignmentsの文字列。
     */
    alignments: string[];
}

/**
 * tablegridの入力を許可された形式へ整える。
 * @param range - tablegridで範囲として扱う入力。
 * @param rowCount - tablegridで走査または更新する要素。
 * @param columnCount - tablegridで走査または更新する要素。
 * @returns tablegridで生成または変換した値。
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
 * tablegridのtable・grid・range・containsを処理し、呼び出し側へ結果または副作用を返す。
 * @param range - tablegridへ渡す入力。
 * @param row - tablegridで走査または更新する要素。
 * @param column - tablegridで走査または更新する要素。
 * @returns 条件が成立したかを示す真偽値。
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
 * tablegridのtable・grid・range・cell・countを処理し、呼び出し側へ結果または副作用を返す。
 * @param range - tablegridへ渡す入力。
 * @returns tablegridで利用する数値。
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
 * tablegridの要素を規則に従って並べ替える。
 * @param values - tablegridへ渡す要素の一覧。
 * @param sourceIndex - tablegridで扱う文字列または本文。
 * @param targetIndex - tablegridの位置・寸法・件数・時間を表す数値。
 * @returns tablegridに対応する要素の一覧。
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
 * tablegridの要素を規則に従って並べ替える。
 * @param rows - tablegridで走査または更新する要素。
 * @param sourceIndex - tablegridで扱う文字列または本文。
 * @param targetIndex - tablegridの位置・寸法・件数・時間を表す数値。
 * @returns tablegridで利用する文字列。
 */
export function moveTableGridRow(
    rows: readonly (readonly string[])[],
    sourceIndex: number,
    targetIndex: number,
): string[][] {
    return moveTableGridItem(
        rows.map(
            /**
             * 各行からsliceを取り出して一覧化する。
             * @param row - 行のsliceを参照する走査対象。
             * @returns sliceを取り出した変換結果の一覧。
             */
            (row) => row.slice()),
        sourceIndex,
        targetIndex,
    );
}

/**
 * tablegridの要素を規則に従って並べ替える。
 * @param rows - tablegridで走査または更新する要素。
 * @param alignments - tablegridで受け渡す文字列。
 * @param sourceIndex - tablegridで扱う文字列または本文。
 * @param targetIndex - tablegridの位置・寸法・件数・時間を表す数値。
 * @returns tablegridのmove・table・grid・columnが生成する結果。
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
             * 各行からlengthを取り出して一覧化する。
             * @param row - 行のlengthを参照する走査対象。
             * @returns lengthを取り出した変換結果の一覧。
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
                 * 各行からsliceを取り出して一覧化する。
                 * @param row - 行のsliceを参照する走査対象。
                 * @returns sliceを取り出した変換結果の一覧。
                 */
                (row) => row.slice()),
            alignments: alignments.slice(),
        };
    }
    const normalizedRows = rows.map(
        /**
         * 各行をfromへ渡し、変換結果を一覧化する。
         * @param row - 走査中の要素。
         * @returns 入力要素から生成した変換結果の一覧。
         */
        (row) =>
            Array.from({ length: columnCount },
                /**
                 * tablegridのコールバックとして・を処理する。
                 * @param _ - 引数位置を維持するための未使用値。
                 * @param index - 配列・行列・文字列の要素位置を示す番号。
                 * @returns tablegridで利用する文字列。
                 */
                (_, index) => row[index] ?? ""),
    );
    const normalizedAlignments = Array.from(
        { length: columnCount },

        /**
         * tablegridのコールバックとして・を処理する。
         * @param _ - 引数位置を維持するための未使用値。
         * @param index - 配列・行列・文字列の要素位置を示す番号。
         * @returns tablegridで利用する文字列。
         */
        (_, index) => alignments[index] ?? "none",
    );
    return {
        rows: normalizedRows.map(
            /**
             * 各行をmove・table・grid・itemへ渡し、変換結果を一覧化する。
             * @param row - 走査中の要素。
             * @returns 入力要素から生成した変換結果の一覧。
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
 * tablegridのduplicate・table・grid・rowsを処理し、呼び出し側へ結果または副作用を返す。
 * @param rows - tablegridで走査または更新する要素。
 * @param fromRow - tablegridで走査または更新する要素。
 * @param toRow - tablegridで走査または更新する要素。
 * @returns tablegridで利用する文字列。
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
             * 各行からsliceを取り出して一覧化する。
             * @param row - 行のsliceを参照する走査対象。
             * @returns sliceを取り出した変換結果の一覧。
             */
            (row) => row.slice());
    }
    const next = rows.map(
        /**
         * 各行からsliceを取り出して一覧化する。
         * @param row - 行のsliceを参照する走査対象。
         * @returns sliceを取り出した変換結果の一覧。
         */
        (row) => row.slice());
    const copies = next.slice(fromRow, toRow + 1).map(
        /**
         * 各行からsliceを取り出して一覧化する。
         * @param row - 行のsliceを参照する走査対象。
         * @returns sliceを取り出した変換結果の一覧。
         */
        (row) => row.slice());
    next.splice(Math.max(1, toRow + 1), 0, ...copies);
    return next;
}

/**
 * tablegridのduplicate・table・grid・columnsを処理し、呼び出し側へ結果または副作用を返す。
 * @param rows - tablegridで走査または更新する要素。
 * @param alignments - tablegridで受け渡す文字列。
 * @param fromColumn - tablegridで走査または更新する要素。
 * @param toColumn - tablegridで走査または更新する要素。
 * @returns tablegridのduplicate・table・grid・columnsが生成する結果。
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
             * 各行からlengthを取り出して一覧化する。
             * @param row - 行のlengthを参照する走査対象。
             * @returns lengthを取り出した変換結果の一覧。
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
                 * 各行からsliceを取り出して一覧化する。
                 * @param row - 行のsliceを参照する走査対象。
                 * @returns sliceを取り出した変換結果の一覧。
                 */
                (row) => row.slice()),
            alignments: alignments.slice(),
        };
    }
    const normalizedRows = rows.map(
        /**
         * 各行をfromへ渡し、変換結果を一覧化する。
         * @param row - 走査中の要素。
         * @returns 入力要素から生成した変換結果の一覧。
         */
        (row) =>
            Array.from({ length: columnCount },
                /**
                 * tablegridのコールバックとして・を処理する。
                 * @param _ - 引数位置を維持するための未使用値。
                 * @param index - 配列・行列・文字列の要素位置を示す番号。
                 * @returns tablegridで利用する文字列。
                 */
                (_, index) => row[index] ?? ""),
    );
    const normalizedAlignments = Array.from(
        { length: columnCount },

        /**
         * tablegridのコールバックとして・を処理する。
         * @param _ - 引数位置を維持するための未使用値。
         * @param index - 配列・行列・文字列の要素位置を示す番号。
         * @returns tablegridで利用する文字列。
         */
        (_, index) => alignments[index] ?? "none",
    );
    const insertAt = toColumn + 1;
    return {
        rows: normalizedRows.map(
            /**
             * 各行からsliceを取り出して一覧化する。
             * @param row - 行のsliceを参照する走査対象。
             * @returns sliceを取り出した変換結果の一覧。
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
 * tablegridの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param rows - tablegridで走査または更新する要素。
 * @param range - tablegridへ渡す入力。
 * @returns tablegridで利用する文字列。
 */
export function clearTableGridRange(
    rows: readonly (readonly string[])[],
    range: NormalizedTableGridRange,
): string[][] {
    return rows.map(
        /**
         * 各行からmapを取り出して一覧化する。
         * @param row - 行のmapを参照する走査対象。
         * @param rowIndex - tablegridで走査または更新する要素。
         * @returns mapを取り出した変換結果の一覧。
         */
        (row, rowIndex) =>
            row.map(
                /**
                 * 各値をtable・grid・range・containsへ渡し、変換結果を一覧化する。
                 * @param value - 走査中の要素。
                 * @param columnIndex - tablegridで走査または更新する要素。
                 * @returns 入力要素から生成した変換結果の一覧。
                 */
                (value, columnIndex) =>
                    tableGridRangeContains(range, rowIndex, columnIndex) ? "" : value,
            ),
    );
}

/**
 * tablegridのtable・grid・column・labelを処理し、呼び出し側へ結果または副作用を返す。
 * @param column - tablegridで走査または更新する要素。
 * @returns tablegridで利用する文字列。
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
 * tablegridの寸法、容量、位置、または計測値を求める。
 * @param value - 検証・変換・保存の対象となる値。
 * @param min - 入力または寸法に許可する下限値。
 * @param max - 入力または寸法に許可する上限値。
 * @returns tablegridで利用する数値。
 */
function clampInteger(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, Math.trunc(value)));
}

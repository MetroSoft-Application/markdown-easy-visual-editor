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
 * @param range - 行列数で端点を制限する表セル選択範囲。
 * @param rowCount - 選択範囲を収める表の行数。
 * @param columnCount - 選択範囲を収める表の列数。
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
 * @param range - 表内で選択されたfrom/to row/columnを含む正規化済みセル範囲。
 * @param row - 範囲内か判定する表行の0始まりインデックス。
 * @param column - 範囲内か判定する表列の0始まりインデックス。
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
 * @param range - 表内で選択されたfrom/to row/columnを含む正規化済みセル範囲。
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
 * 配列要素を指定位置から別の位置へ移動する。
 * @param values - 指定要素を移動する元の配列。
 * @param sourceIndex 移動元となる配列要素の0始まりインデックス。
 * @param targetIndex 移動後の配列位置を示す0始まりインデックス。
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
 * 表の行を指定位置から別の位置へ移動する。
 * @param rows - 移動対象のセル文字列を行ごとに並べた表データ。
 * @param sourceIndex 移動元となる行の0始まりインデックス。
 * @param targetIndex 移動後の行位置を示す0始まりインデックス。
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
             * @param row - セル文字列を複製して行移動に渡す元の表行。
             * @returns sliceを取り出した変換結果の一覧。
             */
            (row) => row.slice()),
        sourceIndex,
        targetIndex,
    );
}

/**
 * 表の列、セル内容、配置情報を指定位置から別の位置へ移動する。
 * @param rows - 列移動に合わせてセルを並べ替える表行一覧。
 * @param alignments - 各表列に対応する配置設定一覧。
 * @param sourceIndex 移動元となる列の0始まりインデックス。
 * @param targetIndex 移動後の列位置を示す0始まりインデックス。
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
             * @param row - 表全体の列数下限を求めるセル行。
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
                 * @param row - 範囲外の移動時に複製するセル行。
                 * @returns sliceを取り出した変換結果の一覧。
                 */
                (row) => row.slice()),
            alignments: alignments.slice(),
        };
    }
    const normalizedRows = rows.map(
        /**
         * 各行をfromへ渡し、変換結果を一覧化する。
         * @param row - 列移動用の正規化行を作る元セル行。
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
             * @param row - 移動後の表行セル配列。
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
 * 指定した表行範囲を直後へ複製する。
 * @param rows - 複製元となるセル文字列の表行一覧。
 * @param fromRow - 複製範囲の開始行インデックス。
 * @param toRow - 複製範囲の終了行インデックス。
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
             * @param row - 複製して新しい表行一覧へ出力するセル文字列行。
             * @returns sliceを取り出した変換結果の一覧。
             */
            (row) => row.slice());
    }
    const next = rows.map(
        /**
         * 各行からsliceを取り出して一覧化する。
         * @param row - 複製して新しい表行一覧へ出力するセル文字列行。
         * @returns sliceを取り出した変換結果の一覧。
         */
        (row) => row.slice());
    const copies = next.slice(fromRow, toRow + 1).map(
        /**
         * 各行からsliceを取り出して一覧化する。
         * @param row - 選択された複製範囲から抽出したセル文字列行。
         * @returns sliceを取り出した変換結果の一覧。
         */
        (row) => row.slice());
    next.splice(Math.max(1, toRow + 1), 0, ...copies);
    return next;
}

/**
 * 指定したセル列範囲と配置設定を直後へ複製する。
 * @param rows - 複製するセル列を含む表行一覧。
 * @param alignments - 各表列に対応する配置設定一覧。
 * @param fromColumn - 複製範囲の開始列インデックス。
 * @param toColumn - 複製範囲の終了列インデックス。
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
             * @param row - 表全体の列数下限を求めるセル行。
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
                 * @param row - 範囲外の複製時に複製するセル行。
                 * @returns sliceを取り出した変換結果の一覧。
                 */
                (row) => row.slice()),
            alignments: alignments.slice(),
        };
    }
    const normalizedRows = rows.map(
        /**
         * 各行をfromへ渡し、変換結果を一覧化する。
         * @param row - 列複製用の正規化行を作る元セル行。
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
             * @param row - 指定セル範囲へ複製列を挿入する正規化済みセル行。
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
 * @param rows - 選択範囲に含まれるセル文字列を空にする表行一覧。
 * @param range - 表内で選択されたfrom/to row/columnを含む正規化済みセル範囲。
 * @returns tablegridで利用する文字列。
 */
export function clearTableGridRange(
    rows: readonly (readonly string[])[],
    range: NormalizedTableGridRange,
): string[][] {
    return rows.map(
        /**
         * 各行からmapを取り出して一覧化する。
         * @param row - 選択セルをクリアする対象となるセル文字列行。
         * @param rowIndex - 選択範囲と照合する0始まりの行インデックス。
         * @returns mapを取り出した変換結果の一覧。
         */
        (row, rowIndex) =>
            row.map(
                /**
                 * 各値をtable・grid・range・containsへ渡し、変換結果を一覧化する。
                 * @param value - 選択範囲に含まれる場合クリアするセル文字列。
                 * @param columnIndex - 選択範囲と照合する0始まりの列インデックス。
                 * @returns 入力要素から生成した変換結果の一覧。
                 */
                (value, columnIndex) =>
                    tableGridRangeContains(range, rowIndex, columnIndex) ? "" : value,
            ),
    );
}

/**
 * tablegridのtable・grid・column・labelを処理し、呼び出し側へ結果または副作用を返す。
 * @param column - 列見出しラベルへ変換する0始まり列インデックス。
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
 * @param value - 指定範囲へ収める整数候補。
 * @param min - 入力または寸法に許可する下限値。
 * @param max - 入力または寸法に許可する上限値。
 * @returns tablegridで利用する数値。
 */
function clampInteger(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, Math.trunc(value)));
}

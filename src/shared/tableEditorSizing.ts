/**
 * @fileoverview 表編集グリッドの列幅・行高を測定し、表示倍率、最小値、最大値を考慮して保存値を決める。
 */
/**
 * 表編集列幅の下限。
 */
export const TABLE_EDITOR_MIN_COLUMN_WIDTH = 96;

/**
 * 表編集の自動列幅の上限。
 */
export const TABLE_EDITOR_MAX_AUTO_COLUMN_WIDTH = 720;

/**
 * 表編集行高の下限。
 */
export const TABLE_EDITOR_MIN_ROW_HEIGHT = 36;

/**
 * 表編集の自動行高の上限。
 */
export const TABLE_EDITOR_MAX_AUTO_ROW_HEIGHT = 720;

/**
 * セル文字列の測定幅から、表列の自動調整幅を計算する。
 * @param values 各セルの表示内容。
 * @param measureText セル内の1行の表示幅を測る関数。
 * @param horizontalChrome セル左右の余白や境界線に割り当てる合計幅。
 * @param minimum 結果に許可する最小列幅。
 * @param maximum 結果に許可する最大列幅。
 * @returns 最小幅と最大幅の範囲に収めた列幅。
 */
export function calculateAutoFitColumnWidth(
    values: readonly string[],
    measureText: (value: string) => number,
    horizontalChrome = 24,
    minimum = TABLE_EDITOR_MIN_COLUMN_WIDTH,
    maximum = TABLE_EDITOR_MAX_AUTO_COLUMN_WIDTH,
): number {
    let widest = 0;
    for (const value of values) {
        const lines = value.split(/\r\n|\r|\n/);
        for (const line of lines) widest = Math.max(widest, measureText(line));
    }
    return Math.max(
        minimum,
        Math.min(maximum, Math.ceil(widest + horizontalChrome)),
    );
}

/**
 * セル内容に合わせて行高を求め、上下限で制限する。
 * @param heights - 同じ表行にある各セルの計測高さ一覧。
 * @param minimum - 自動調整後に許可する行高の下限。
 * @param maximum - 自動調整後に許可する行高の上限。
 * @returns 計測高さと上下限から求めた行高。
 */
export function calculateAutoFitRowHeight(
    heights: readonly number[],
    minimum = TABLE_EDITOR_MIN_ROW_HEIGHT,
    maximum = TABLE_EDITOR_MAX_AUTO_ROW_HEIGHT,
): number {
    const largest = heights.reduce(

        /**
         * 要素を順に集約して累積値を更新する。
         * @param current - 集計途中の値。
         * @param height - 表示領域または行の高さ。
         * @returns 要素を集約した累積値。
         */
        (current, height) =>
            Number.isFinite(height) ? Math.max(current, height) : current,
        0,
    );
    return Math.max(minimum, Math.min(maximum, Math.ceil(largest)));
}

/**
 * 行または列の挿入・削除。寸法配列を元の行・列へ対応付けて移すために使う。
 */
export interface TableEditorAxisChange {
    /** 挿入か削除か。 */
    kind: 'insert' | 'delete';
    /** 挿入・削除が始まる位置（変更前の0始まりの番号）。 */
    index: number;
    /** 挿入・削除した数。 */
    count: number;
}

/**
 * 行・列の挿入・削除に合わせて寸法配列（列幅または行高）を移し、新しい長さにそろえる。
 * 挿入した位置は`fill`、削除した位置の寸法は捨て、それ以外は元の行・列の寸法を保つ。
 * `change`がなければ位置のまま引き継ぎ、足りない分を`fill`で埋める。
 * @param previous - 変更前の寸法配列。
 * @param change - 行・列の挿入・削除。省略時は位置のまま。
 * @param length - 変更後の行数・列数。
 * @param fill - 新しい行・列と、元の配列に値がない位置の寸法。
 * @returns 変更後の長さの寸法配列。
 */
export function remapTableEditorSizes<T>(
    previous: readonly T[],
    change: TableEditorAxisChange | undefined,
    length: number,
    fill: T,
): T[] {
    let mapped: T[] = previous.slice();
    if (change && change.count > 0) {
        const index = Math.max(0, Math.min(change.index, mapped.length));
        if (change.kind === 'insert') {
            mapped.splice(index, 0, ...Array.from({ length: change.count },
                /**
                 * @returns 挿入した行・列の寸法。
                 */
                () => fill));
        } else {
            mapped.splice(index, change.count);
        }
    }
    mapped = mapped.slice(0, length);
    while (mapped.length < length) mapped.push(fill);
    return mapped;
}

/**
 * セルの文字列を測るための寸法情報。表編集のセル入力欄の計算済みスタイルから作る。
 */
export interface TableEditorCellTextMetrics {
    /** 改行を含まない1行の描画幅（CSS px）を返す。 */
    measure: (line: string) => number;
    /** セル幅のうち文字に使えない左右の余白と安全余裕の合計（CSS px）。 */
    horizontalChrome: number;
    /** 1行のセルの高さ（CSS px、上下パディングと行高自動計算の余裕を含む）。 */
    singleLineHeight: number;
    /** 1行分の行の高さ（CSS px）。数値で得られない場合はNaN。 */
    lineHeight: number;
}

/**
 * セルが指定の列幅で折り返さないなら、その論理行数を返す。DOMで測らずに行高を決められるかの判定で、
 * 表を開く前の計算（{@link calculateTableEditorInitialSizes}）と、開いた後の行高の自動調整で共通に使う。
 *
 * 各論理行の幅に余白と安全余裕（`horizontalChrome`）を足して列幅に収まれば折り返さないと判定する。
 * 次の場合は文字列だけでは決められないため`undefined`を返し、呼び出し側がDOMで測る。
 * - いずれかの論理行が列幅に収まらない
 * - 複数行で、line-heightが数値で得られない
 * - タブ文字を含む（Canvasでは空白1文字、textareaでは8文字幅の位置まで進み、幅が一致しないため）
 * @param value - セルの表示文字列（`<br>`の後に表示用の改行を含む形）。
 * @param columnWidth - 列幅（CSS px）。
 * @param metrics - セル文字列の寸法情報。
 * @returns 折り返さない場合は論理行数（1以上）、決められない場合は`undefined`。
 */
export function tableEditorUnwrappedLineCount(
    value: string,
    columnWidth: number,
    metrics: TableEditorCellTextMetrics,
): number | undefined {
    if (value.includes('\t')) return undefined;
    const lines = value.split('\n');
    if (lines.length > 1 && !Number.isFinite(metrics.lineHeight)) return undefined;
    const fits = lines.every(
        /**
         * 論理行が余白込みで列幅に収まるかを判定する。
         * @param line - セル内の1論理行。
         * @returns 収まる場合はtrue。
         */
        (line) => metrics.measure(line) + metrics.horizontalChrome <= columnWidth);
    return fits ? lines.length : undefined;
}

/**
 * 折り返さないセルの高さ（CSS px、上下の余裕を含む）を論理行数から求める。
 * @param lineCount - {@link tableEditorUnwrappedLineCount}が返した論理行数。
 * @param metrics - セル文字列の寸法情報。
 * @returns 1行の高さに残りの行数分のline-heightを足した高さ。
 */
export function tableEditorUnwrappedCellHeight(
    lineCount: number,
    metrics: TableEditorCellTextMetrics,
): number {
    return lineCount > 1
        ? metrics.singleLineHeight + (lineCount - 1) * metrics.lineHeight
        : metrics.singleLineHeight;
}

/**
 * 表を開いた時点の列幅と行高を、DOMを使わずセル文字列だけから求めた結果。
 */
export interface TableEditorInitialSizes {
    /** 各列の自動フィット幅（CSS px）。 */
    columnWidths: number[];
    /** 各行の自動フィット高（CSS px）。折り返すセルがあり文字列だけでは決まらない行はundefined。 */
    rowHeights: Array<number | undefined>;
    /** 折り返すセルを含み、描画後にDOMで高さを測る必要がある行の番号。 */
    rowsNeedingMeasure: number[];
}

/**
 * 表を開く前に、セルの表示文字列から列幅と行高を求める。最初の描画から内容に合った寸法で描き、
 * 既定寸法での描画とその後の再描画（最大50行×20列で表全体の2回目の描画）を避けるため。
 *
 * 列幅は{@link calculateAutoFitColumnWidth}と同じ規則で求める。行高は、全セルが
 * {@link tableEditorUnwrappedLineCount}で折り返さないと決まる行だけ行数から求め、決まらないセルを含む行は
 * `rowsNeedingMeasure`に入れて呼び出し側のDOM測定に任せる。
 * @param displayRows - 各行のセル表示文字列（`<br>`の後に表示用の改行を含む形）。
 * @param columnCount - 表の列数。行の要素が足りない列は空文字列として扱う。
 * @param metrics - セル文字列の寸法情報。
 * @param minimumWidth - 列幅の下限。
 * @param maximumWidth - 自動フィットする列幅の上限。
 * @returns 列幅・行高と、DOM測定が必要な行の番号。
 */
export function calculateTableEditorInitialSizes(
    displayRows: readonly (readonly string[])[],
    columnCount: number,
    metrics: TableEditorCellTextMetrics,
    minimumWidth = TABLE_EDITOR_MIN_COLUMN_WIDTH,
    maximumWidth = TABLE_EDITOR_MAX_AUTO_COLUMN_WIDTH,
): TableEditorInitialSizes {
    const columnWidths = Array.from({ length: columnCount },
        /**
         * 1列分のセル文字列から列幅を求める。
         * @param _ - 未使用の初期値。
         * @param column - 列番号。
         * @returns 自動フィットした列幅。
         */
        (_, column) =>
        calculateAutoFitColumnWidth(
            displayRows.map(
                /**
                 * 行から対象列のセル文字列を取り出す。足りない列は空文字列。
                 * @param row - 1行分のセル表示文字列。
                 * @returns 対象列のセル表示文字列。
                 */
                (row) => row[column] ?? ''),
            metrics.measure,
            metrics.horizontalChrome,
            minimumWidth,
            maximumWidth,
        ));
    const rowHeights: Array<number | undefined> = [];
    const rowsNeedingMeasure: number[] = [];
    displayRows.forEach(
        /**
         * 1行分のセルが折り返さなければ行数から高さを決め、折り返すならDOM測定の対象にする。
         * @param row - 1行分のセル表示文字列。
         * @param rowIndex - 行番号。
         */
        (row, rowIndex) => {
        let lineCount = 1;
        for (let column = 0; column < columnCount; column += 1) {
            const cellLines = tableEditorUnwrappedLineCount(row[column] ?? '', columnWidths[column], metrics);
            if (cellLines === undefined) {
                rowHeights.push(undefined);
                rowsNeedingMeasure.push(rowIndex);
                return;
            }
            lineCount = Math.max(lineCount, cellLines);
        }
        rowHeights.push(calculateAutoFitRowHeight([tableEditorUnwrappedCellHeight(lineCount, metrics)]));
    });
    return { columnWidths, rowHeights, rowsNeedingMeasure };
}

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

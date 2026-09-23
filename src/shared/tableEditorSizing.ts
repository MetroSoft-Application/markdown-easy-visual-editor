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
 * tableeditorsizingの寸法、容量、位置、または計測値を求める。
 * @param values - tableeditorsizingで受け渡す文字列。
 * @param measureText - tableeditorsizingで扱う文字列または本文。
 * @param horizontalChrome - tableeditorsizingへ渡す入力。
 * @param minimum - tableeditorsizingへ渡す入力。
 * @param maximum - tableeditorsizingの位置・寸法・件数・時間を表す数値。
 * @returns tableeditorsizingで利用する数値。
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
 * tableeditorsizingの寸法、容量、位置、または計測値を求める。
 * @param heights - tableeditorsizingの位置・寸法・件数・時間を表す数値。
 * @param minimum - tableeditorsizingへ渡す入力。
 * @param maximum - tableeditorsizingの位置・寸法・件数・時間を表す数値。
 * @returns tableeditorsizingで利用する数値。
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

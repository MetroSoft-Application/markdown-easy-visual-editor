export const TABLE_EDITOR_MIN_COLUMN_WIDTH = 96;
export const TABLE_EDITOR_MAX_AUTO_COLUMN_WIDTH = 720;
export const TABLE_EDITOR_MIN_ROW_HEIGHT = 36;
export const TABLE_EDITOR_MAX_AUTO_ROW_HEIGHT = 720;

/** テキスト群から、表示上必要な列幅を計算する。 */
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

/** セルの実測高さから、表示上必要な行高を計算する。 */
export function calculateAutoFitRowHeight(
  heights: readonly number[],
  minimum = TABLE_EDITOR_MIN_ROW_HEIGHT,
  maximum = TABLE_EDITOR_MAX_AUTO_ROW_HEIGHT,
): number {
  const largest = heights.reduce(
    (current, height) =>
      Number.isFinite(height) ? Math.max(current, height) : current,
    0,
  );
  return Math.max(minimum, Math.min(maximum, Math.ceil(largest)));
}

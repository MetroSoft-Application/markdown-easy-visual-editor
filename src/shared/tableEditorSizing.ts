export const TABLE_EDITOR_MIN_COLUMN_WIDTH = 96;
export const TABLE_EDITOR_MAX_AUTO_COLUMN_WIDTH = 720;
export const TABLE_EDITOR_MIN_ROW_HEIGHT = 36;

/** テキスト群と計測関数から、表エディターの自動列幅を決定する。 */
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
  return Math.max(minimum, Math.min(maximum, Math.ceil(widest + horizontalChrome)));
}

/** 現在行高を既定値へ戻すために必要な指定刻みの操作回数を返す。 */
export function rowResetStepCount(
  current: number,
  minimum = TABLE_EDITOR_MIN_ROW_HEIGHT,
  step = 12,
): number {
  if (!Number.isFinite(current) || current <= minimum || step <= 0) return 0;
  return Math.ceil((current - minimum) / step);
}

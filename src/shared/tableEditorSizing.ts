/**
 * @file tableEditorSizing.ts
 * 実行境界: Extension HostとWebviewの共有層。
 * 責務: 両実行境界で共有する値、プロトコル、変換を扱う。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: 呼び出し元から渡された値を変換し、外部状態を直接変更しない。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
/** テーブル列をリサイズするときに許可する最小幅。 */
export const TABLE_EDITOR_MIN_COLUMN_WIDTH = 96;
/** 「TABLE_EDITOR_MAX_AUTO_COLUMN_WIDTH」は、入力・表示・資源の上限または下限を表す値です。 */
/** 内容から列幅を自動計算するときの最大幅。 */
export const TABLE_EDITOR_MAX_AUTO_COLUMN_WIDTH = 720;
/** 「TABLE_EDITOR_MIN_ROW_HEIGHT」は、入力・表示・資源の上限または下限を表す値です。 */
/** テーブル行をリサイズするときに許可する最小高さ。 */
export const TABLE_EDITOR_MIN_ROW_HEIGHT = 36;
/** 「TABLE_EDITOR_MAX_AUTO_ROW_HEIGHT」は、入力・表示・資源の上限または下限を表す値です。 */
/** 内容から行高を自動計算するときの最大高さ。 */
export const TABLE_EDITOR_MAX_AUTO_ROW_HEIGHT = 720;

/**
 * テキスト群から、表示上必要な列幅を計算する。
 * @param values 「values」は、「calculateAutoFitColumnWidth」が表編集で処理する対象を特定する入力です。
 * @param measureText 処理対象の本文です。
 * @param horizontalChrome 「horizontalChrome」は、「calculateAutoFitColumnWidth」が表編集状態の処理対象を特定する入力です。
 * @param minimum 「minimum」は、「calculateAutoFitColumnWidth」が表編集状態の処理対象を特定する入力です。
 * @param maximum 「maximum」は、「calculateAutoFitColumnWidth」が表編集状態の処理対象を特定する入力です。
 * @returns 計算結果の数値です。
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
 * セルの実測高さから、表示上必要な行高を計算する。
 * @param heights 「heights」は、「calculateAutoFitRowHeight」が表編集状態の処理対象を特定する入力です。
 * @param minimum 「minimum」は、「calculateAutoFitRowHeight」が表編集状態の処理対象を特定する入力です。
 * @param maximum 「maximum」は、「calculateAutoFitRowHeight」が表編集状態の処理対象を特定する入力です。
 * @returns 計算結果の数値です。
 */
export function calculateAutoFitRowHeight(
  heights: readonly number[],
  minimum = TABLE_EDITOR_MIN_ROW_HEIGHT,
  maximum = TABLE_EDITOR_MAX_AUTO_ROW_HEIGHT,
): number {
  const largest = heights.reduce(

    /**
     * 累積値と入力を「current」「height」を受け取り、集約結果を更新するコールバックです。
     * @param current currentとして渡される、このコールバックの入力値です。
     * @param height 処理対象の高さです。
     * @returns 更新後の累積値を返します。
     */
    (current, height) =>
      Number.isFinite(height) ? Math.max(current, height) : current,
    0,
  );
  return Math.max(minimum, Math.min(maximum, Math.ceil(largest)));
}

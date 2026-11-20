/**
 * @fileoverview 「行へ移動」（Ctrl+G）で入力された行番号文字列を検証する共通ロジック。
 * 実行境界: shared（Extension Host の入力ボックス検証と単体テストから使う）。
 * 入力: 利用者が入力した文字列と文書の行数。出力: 0始まりの行番号または undefined。
 * 副作用はなく、文書本文を変更しない。
 */

/**
 * 「行へ移動」の入力値を 0 始まりの行番号へ変換する。
 * 前後の空白は無視し、1 以上の10進整数だけを受け付ける。
 * 文書の行数を超える値は、VS Code 標準の「行へ移動」と同じく最終行へ丸める。
 * @param value - 利用者が入力した 1 始まりの行番号文字列。
 * @param lineCount - 対象文書の行数。1 未満なら 1 行として扱う。
 * @returns 0 始まりの行番号。空文字・数字以外・0 以下・安全な整数を超える値は undefined。
 */
export function parseGoToLineInput(value: string, lineCount: number): number | undefined {
    const trimmed = value.trim();
    if (!/^\d+$/u.test(trimmed)) return undefined;
    const line = Number(trimmed);
    if (!Number.isSafeInteger(line) || line < 1) return undefined;
    const maxLine = Math.max(1, Math.floor(lineCount));
    return Math.min(line, maxLine) - 1;
}

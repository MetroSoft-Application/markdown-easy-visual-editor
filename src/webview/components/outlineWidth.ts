/**
 * @fileoverview エディターのアウトライン欄の幅制限（Webview）。
 * 入力は保存・ドラッグ・キー操作で得た幅、出力は表示に使う整数ピクセル。副作用はない。
 * 不変条件: clampOutlineWidth の下限・上限と、区切りバーの aria-valuemin / aria-valuemax は同じ定数を使う。
 * JSX を含まないため、Node 側の単体テストからも型検査付きで読み込める。
 */

/**
 * アウトライン欄の最小幅（ピクセル）。狭い画面でも本文ペインを広く取れるよう、見出しの先頭数文字と閉じるボタンが残る幅にする
 * （ヘッダーの「アウトライン」は省略表示になる）。
 * 区切りバーの aria-valuemin と同じ値を使い、操作上の下限と支援技術へ伝える下限を一致させる。
 * HTMLプレビュー（extension/htmlPreview）と HTML出力（markdown-easy-converter）のアウトラインも同じ値にそろえる。
 */
export const OUTLINE_MIN_WIDTH = 80;

/**
 * アウトライン欄の最大幅（ピクセル）。本文ペインを圧迫しない上限。
 */
export const OUTLINE_MAX_WIDTH = 420;

/**
 * アウトライン欄の幅を、本文ペインを圧迫しない範囲へ制限する。
 * 以前の最小幅（160・120）以上で保存された値はそのまま復元される。
 * @param value - アウトライン幅として保存する数値（ピクセル）。
 * @returns OUTLINE_MIN_WIDTH〜OUTLINE_MAX_WIDTH の整数ピクセル。有限値でない場合は既定の 220。
 */
export function clampOutlineWidth(value: number): number {
  return Math.max(
    OUTLINE_MIN_WIDTH,
    Math.min(OUTLINE_MAX_WIDTH, Number.isFinite(value) ? Math.round(value) : 220),
  );
}

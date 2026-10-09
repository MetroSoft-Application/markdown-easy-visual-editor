/**
 * @fileoverview 本文位置とプレビュー位置の対応を計算し、スクロール同期の境界をそろえる。
 */
/**
 * スクロール位置が先頭または末尾付近かを最大スクロール量に対する比率で判定する。
 * @param scrollTop - スクロールコンテナの現在の縦位置（scrollTop、CSS px）。
 * @param scrollHeight - スクロール対象全体の高さ（CSS px）。
 * @param clientHeight - スクロール表示領域の高さ（CSS px）。
 * @returns 先頭なら0、末尾なら1。中間位置ではundefined。
 */
export function getScrollRatio(scrollTop: number, scrollHeight: number, clientHeight: number): number | undefined {
    const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
    if (maxScrollTop === 0) return 0;
    const ratio = Math.min(1, Math.max(0, scrollTop / maxScrollTop));
    if (ratio <= 0.001) return 0;
    if (ratio >= 0.999) return 1;
    return undefined;
}

/**
 * 最大スクロール量に対する比率をCSSピクセルの縦位置へ変換する。
 * @param ratio - 最大スクロール量に対するスクロール位置比（0から1）。
 * @param scrollHeight - スクロール対象全体の高さ（CSS px）。
 * @param clientHeight - スクロール表示領域の高さ（CSS px）。
 * @returns 指定比率へ丸めたスクロール位置。領域をスクロールできない場合は0。
 */
export function getScrollTopForRatio(ratio: number, scrollHeight: number, clientHeight: number): number {
    const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
    if (!Number.isFinite(ratio)) return 0;
    return Math.min(1, Math.max(0, ratio)) * maxScrollTop;
}

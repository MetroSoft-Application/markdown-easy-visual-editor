/**
 * @fileoverview 本文位置とプレビュー位置の対応を計算し、スクロール同期の境界をそろえる。
 */
/**
 * スクロールから必要な値またはリソースを取得する。
 * @param scrollTop - スクロールで扱う数値。
 * @param scrollHeight - スクロールの位置・寸法・件数・時間を表す数値。
 * @param clientHeight - スクロールの位置・寸法・件数・時間を表す数値。
 * @returns 条件に一致する値。未検出時はundefinedまたはnull。
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
 * スクロールから必要な値またはリソースを取得する。
 * @param ratio - スクロールで扱う数値。
 * @param scrollHeight - スクロールの位置・寸法・件数・時間を表す数値。
 * @param clientHeight - スクロールの位置・寸法・件数・時間を表す数値。
 * @returns スクロールで利用する数値。
 */
export function getScrollTopForRatio(ratio: number, scrollHeight: number, clientHeight: number): number {
    const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
    if (!Number.isFinite(ratio)) return 0;
    return Math.min(1, Math.max(0, ratio)) * maxScrollTop;
}

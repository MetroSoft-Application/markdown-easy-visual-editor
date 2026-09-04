/**
 * スクロール量から、コンテナー全体に対する相対位置を求める。
 *
 * 分割表示の通常位置ではソースオフセットアンカーを優先するため、
 * 比率同期は先頭・末尾の境界位置だけに限定する。
 * @param scrollTop 現在のスクロール位置。
 * @param scrollHeight スクロール対象の全体高さ。
 * @param clientHeight 表示領域の高さ。
 * @returns 先頭なら0、末尾なら1、それ以外はundefined。
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
 * スクロール比率を指定したときのスクロール位置を求める。
 * @param ratio 0から1までのスクロール比率。
 * @param scrollHeight スクロール対象の全体高さ。
 * @param clientHeight 表示領域の高さ。
 * @returns 設定すべきスクロール位置。
 */
export function getScrollTopForRatio(ratio: number, scrollHeight: number, clientHeight: number): number {
    const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
    if (!Number.isFinite(ratio)) return 0;
    return Math.min(1, Math.max(0, ratio)) * maxScrollTop;
}

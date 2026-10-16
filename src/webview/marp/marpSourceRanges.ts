/**
 * @fileoverview Marpのソース位置を対象スライドへ対応付ける。
 */

/**
 * Markdownソース範囲を持つ値。
 */
export interface MarpSourceRangeLike {
  startOffset: number;
  endOffset: number;
}

/**
 * Markdownオフセットを含むスライド範囲を検索する。
 * @param ranges - ソース順に並んだスライド範囲。
 * @param offset - Markdown本文内のUTF-16オフセット。
 * @returns 対応するスライド範囲。範囲外なら最初または最後のスライド。
 */
export function findMarpSourceRangeAtOffset<T extends MarpSourceRangeLike>(
  ranges: readonly T[],
  offset: number,
): T | undefined {
  if (ranges.length === 0 || !Number.isFinite(offset)) return undefined;

  for (const range of ranges) {
    if (offset < range.startOffset || offset < range.endOffset) return range;
  }

  return ranges.at(-1);
}

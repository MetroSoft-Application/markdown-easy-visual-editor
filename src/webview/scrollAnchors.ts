import { getScrollRatio } from '../shared/scroll';

export interface PreviewViewportAnchor {
  offset: number;
  topOffset: number;
  blockProgress?: number;
  /** コンテナー全体の最大スクロール量に対する現在位置。 */
  scrollRatio?: number;
}

interface SourceRange {
  from: number;
  to: number;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function readSourceRange(element: HTMLElement): SourceRange | undefined {
  const from = Number(element.dataset.sourceFrom);
  if (!Number.isFinite(from)) return undefined;
  const rawTo = Number(element.dataset.sourceTo);
  const to = Number.isFinite(rawTo) ? Math.max(from + 1, rawTo) : from + 1;
  return { from, to };
}

/**
 * コンテナーを指定された全体スクロール比率へ移動する。
 * 先頭・末尾など、本文アンカーだけでは表現できない境界位置の同期に使う。
 * @param container スクロール位置を変更するコンテナー。
 * @param ratio 0から1までのスクロール比率。
 * @returns スクロール位置が変化した場合はtrue。
 */
export function restoreScrollRatio(container: HTMLElement, ratio: number): boolean {
  if (container.clientHeight === 0 || !Number.isFinite(ratio)) return false;
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const nextScrollTop = clampUnit(ratio) * maxScrollTop;
  if (Math.abs(container.scrollTop - nextScrollTop) <= 0.5) return false;
  container.scrollTop = nextScrollTop;
  return true;
}

/**
 * プレビューの表示位置を、Markdownブロック内の進捗を補間したソースオフセットとして取得する。
 * 大きな画像・表・図などで描画高さがソース行数と大きく異なっても、ブロック途中の位置を失わない。
 * @param container 表示位置を取得するプレビューコンテナー。
 * @returns 復元に必要なアンカー。対象ブロックがない場合はundefined。
 */
export function capturePreviewViewport(container: HTMLElement): PreviewViewportAnchor | undefined {
  if (container.clientHeight === 0) return undefined;
  const bounds = container.getBoundingClientRect();
  const elements = Array.from(container.querySelectorAll<HTMLElement>('[data-source-from]'));
  const target = elements.find((element) => element.getBoundingClientRect().bottom > bounds.top + 1)
    ?? elements.at(-1);
  if (!target) return undefined;
  const range = readSourceRange(target);
  if (!range) return undefined;
  const targetBounds = target.getBoundingClientRect();
  const renderedProgress = targetBounds.top < bounds.top
    ? clampUnit((bounds.top - targetBounds.top) / Math.max(1, targetBounds.height))
    : 0;
  const maxOffset = Math.max(range.from, range.to - 1);
  const offset = Math.round(range.from + renderedProgress * (maxOffset - range.from));
  return {
    offset,
    topOffset: renderedProgress > 0 ? 0 : targetBounds.top - bounds.top,
    blockProgress: renderedProgress,
    scrollRatio: getScrollRatio(container.scrollTop, container.scrollHeight, container.clientHeight)
  };
}

/**
 * 保存したソースオフセットを対象Markdownブロック内の割合へ変換し、
 * その割合に対応するプレビュー上の点を同じ画面位置へ復元する。
 * @param container スクロール位置を変更するプレビューコンテナー。
 * @param anchor 復元対象のソースオフセットと画面上の位置。
 * @returns 対象ブロックを見つけてスクロールできた場合はtrue。
 */
export function restorePreviewViewport(container: HTMLElement, anchor: PreviewViewportAnchor): boolean {
  if (container.clientHeight === 0) return false;
  const elements = Array.from(container.querySelectorAll<HTMLElement>('[data-source-from]'));
  const target = elements.find((element) => {
    const range = readSourceRange(element);
    return Boolean(range && anchor.offset >= range.from && anchor.offset < range.to);
  }) ?? elements.find((element) => Number(element.dataset.sourceFrom) >= anchor.offset) ?? elements.at(-1);
  if (!target) return false;
  const range = readSourceRange(target);
  if (!range) return false;
  const bounds = container.getBoundingClientRect();
  const targetBounds = target.getBoundingClientRect();
  const sourceProgress = clampUnit((anchor.offset - range.from) / Math.max(1, range.to - range.from));
  const targetPoint = targetBounds.top + sourceProgress * targetBounds.height;
  container.scrollTop += targetPoint - bounds.top - anchor.topOffset;
  return true;
}

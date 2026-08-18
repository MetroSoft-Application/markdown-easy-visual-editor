import { getScrollRatio } from '../shared/scroll';

export interface PreviewViewportAnchor {
  offset: number;
  topOffset: number;
  blockProgress?: number;
  /** コンテナー全体の最大スクロール量に対する現在位置。 */
  scrollRatio?: number;
}

const BLOCK_LOCK_TOP_OFFSET = 0;

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
  const nextScrollTop = Math.min(1, Math.max(0, ratio)) * maxScrollTop;
  if (Math.abs(container.scrollTop - nextScrollTop) <= 0.5) return false;
  container.scrollTop = nextScrollTop;
  return true;
}

/**
 * 画面上端にあるMarkdownブロックを同期基準として取得する。
 * ブロック途中の細かな位置は保持せず、対応ブロックそのものを比較しやすくする。
 * @param container 表示位置を取得するプレビューコンテナー。
 * @returns 上端基準の表示アンカー。対象ブロックがない場合はundefined。
 */
export function capturePreviewViewport(container: HTMLElement): PreviewViewportAnchor | undefined {
  if (container.clientHeight === 0) return undefined;
  const bounds = container.getBoundingClientRect();
  const elements = Array.from(container.querySelectorAll<HTMLElement>('[data-source-from]'));
  const target = elements.find((element) => element.getBoundingClientRect().bottom > bounds.top + 1)
    ?? elements.at(-1);
  if (!target) return undefined;
  const offset = Number(target.dataset.sourceFrom);
  if (!Number.isFinite(offset)) return undefined;
  return {
    offset,
    topOffset: BLOCK_LOCK_TOP_OFFSET,
    blockProgress: 0,
    scrollRatio: getScrollRatio(container.scrollTop, container.scrollHeight, container.clientHeight)
  };
}

/**
 * 保存したソースオフセットに対応するMarkdownブロックを画面上端へ固定する。
 * 画像や図の高さに左右されず、左右で同じブロックを比較対象として揃える。
 * @param container スクロール位置を変更するプレビューコンテナー。
 * @param anchor 復元対象のソースオフセット。
 * @returns 対象ブロックを見つけてスクロールできた場合はtrue。
 */
export function restorePreviewViewport(container: HTMLElement, anchor: PreviewViewportAnchor): boolean {
  if (container.clientHeight === 0) return false;
  const elements = Array.from(container.querySelectorAll<HTMLElement>('[data-source-from]'));
  const target = elements.find((element) => {
    const from = Number(element.dataset.sourceFrom);
    const to = Number(element.dataset.sourceTo);
    return Number.isFinite(from) && Number.isFinite(to) && anchor.offset >= from && anchor.offset < Math.max(from + 1, to);
  }) ?? elements.find((element) => Number(element.dataset.sourceFrom) >= anchor.offset) ?? elements.at(-1);
  if (!target) return false;
  const bounds = container.getBoundingClientRect();
  const targetBounds = target.getBoundingClientRect();
  container.scrollTop += targetBounds.top - bounds.top - BLOCK_LOCK_TOP_OFFSET;
  return true;
}

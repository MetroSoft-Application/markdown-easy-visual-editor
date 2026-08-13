import { getScrollRatio } from '../shared/scroll';

export interface PreviewViewportAnchor {
  offset: number;
  topOffset: number;
  blockProgress?: number;
  /** コンテナー全体の最大スクロール量に対する現在位置。 */
  scrollRatio?: number;
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
  const nextScrollTop = Math.min(1, Math.max(0, ratio)) * maxScrollTop;
  if (Math.abs(container.scrollTop - nextScrollTop) <= 0.5) return false;
  container.scrollTop = nextScrollTop;
  return true;
}

/**
 * プレビューの表示位置をソースオフセットと画面上の距離として取得する。
 * @param container 表示位置を取得するプレビューコンテナー。
 * @returns 復元に必要なアンカー。対象ブロックがない場合はundefined。
 */
export function capturePreviewViewport(container: HTMLElement): PreviewViewportAnchor | undefined {
  // 表示中のMarkdownブロックと画面上端からの距離を記録し、後で同じ位置へ戻せるアンカーを作る。
  if (container.clientHeight === 0) return undefined;
  const bounds = container.getBoundingClientRect();
  const elements = Array.from(container.querySelectorAll<HTMLElement>('[data-source-from]'));
  const target = elements.find((element) => element.getBoundingClientRect().bottom > bounds.top + 1)
    ?? elements.at(-1);
  if (!target) return undefined;
  const offset = Number(target.dataset.sourceFrom);
  if (!Number.isFinite(offset)) return undefined;
  const targetBounds = target.getBoundingClientRect();
  const topOffset = targetBounds.top - bounds.top;
  return {
    offset,
    topOffset,
    blockProgress: topOffset < 0
      ? Math.min(1, Math.max(0, -topOffset / Math.max(1, targetBounds.height)))
      : 0,
    scrollRatio: getScrollRatio(container.scrollTop, container.scrollHeight, container.clientHeight)
  };
}

/**
 * 保存した表示アンカーに対応するプレビュー位置へスクロールを復元する。
 * @param container スクロール位置を変更するプレビューコンテナー。
 * @param anchor 復元対象のソースオフセットと画面上の位置。
 * @returns 対象ブロックを見つけてスクロールできた場合はtrue。
 */
export function restorePreviewViewport(container: HTMLElement, anchor: PreviewViewportAnchor): boolean {
  // 保存済みのソースオフセットに対応するブロックを探し、元の画面上位置になるようスクロールする。
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
  // 対象ブロックの高さが画像読み込みなどで変わっても、ブロック内の割合ではなく
  // 画面上端からの絶対距離を維持する。
  const desiredTopOffset = anchor.topOffset >= 0
    ? anchor.topOffset
    : anchor.blockProgress === undefined
      ? Math.max(-Math.max(0, targetBounds.height - 1), anchor.topOffset)
      : -Math.min(1, Math.max(0, anchor.blockProgress)) * Math.max(0, targetBounds.height - 1);
  container.scrollTop += targetBounds.top - bounds.top - desiredTopOffset;
  return true;
}

import { getScrollRatio } from '../shared/scroll';

export interface PreviewViewportAnchor {
  offset: number;
  topOffset: number;
  /** 復元対象Markdownブロックの開始オフセット。block内補間offsetとは分離して保持する。 */
  blockFrom?: number;
  blockProgress?: number;
  /** コンテナー全体の最大スクロール量に対する現在位置。 */
  scrollRatio?: number;
}

interface SourceRange {
  from: number;
  to: number;
}

const previewSourceElementCache = new WeakMap<HTMLElement, {
  root: HTMLElement;
  revision: string;
  elements: HTMLElement[];
  sourceElements: HTMLElement[];
}>();

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

function getPreviewSourceElements(container: HTMLElement): HTMLElement[] {
  const root = container.querySelector<HTMLElement>('.rendered-markdown') ?? container;
  const revision = root.dataset.renderRevision ?? `${root.dataset.documentLength ?? ''}:${root.childElementCount}`;
  const cached = previewSourceElementCache.get(container);
  if (cached?.root === root && cached.revision === revision) return cached.elements;
  const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-source-from]'));
  const sourceElements = [...elements].sort((left, right) => {
    const leftRange = readSourceRange(left);
    const rightRange = readSourceRange(right);
    if (!leftRange) return 1;
    if (!rightRange) return -1;
    return leftRange.from - rightRange.from || leftRange.to - rightRange.to;
  });
  previewSourceElementCache.set(container, { root, revision, elements, sourceElements });
  return elements;
}

/** DOM順とは異なる脚注セクションを含め、本文オフセット順に整列済みの要素を返す。 */
function getPreviewSourceElementsByOffset(container: HTMLElement): HTMLElement[] {
  getPreviewSourceElements(container);
  return previewSourceElementCache.get(container)?.sourceElements ?? [];
}

function findFirstVisibleSourceElement(
  elements: HTMLElement[],
  viewportTop: number
): HTMLElement | undefined {
  let low = 0;
  let high = elements.length - 1;
  let result: HTMLElement | undefined;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const element = elements[middle];
    if (element.getBoundingClientRect().bottom > viewportTop + 1) {
      result = element;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return result ?? elements.at(-1);
}

function findSourceElementAtOffset(elements: HTMLElement[], offset: number): HTMLElement | undefined {
  let low = 0;
  let high = elements.length - 1;
  let next: HTMLElement | undefined;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const element = elements[middle];
    const range = readSourceRange(element);
    if (!range) {
      low = middle + 1;
      continue;
    }
    if (offset < range.from) {
      next = element;
      high = middle - 1;
    } else if (offset >= range.to) {
      low = middle + 1;
    } else {
      return element;
    }
  }
  return next ?? elements.at(-1);
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
  // スクロール中に全ブロックのgetBoundingClientRectを呼ぶと、長い文書では
  // 強制レイアウトとO(n)走査が毎フレーム発生する。画面上端の要素は座標から
  // 直接取得し、端の余白などで取れない場合だけ従来の走査へフォールバックする。
  const point = document.elementFromPoint(
    bounds.left + Math.min(Math.max(8, bounds.width / 2), Math.max(8, bounds.width - 8)),
    bounds.top + 1
  );
  const pointedTarget = point?.closest<HTMLElement>('[data-source-from]');
  let target = pointedTarget && container.contains(pointedTarget) ? pointedTarget : undefined;
  if (!target) {
    target = findFirstVisibleSourceElement(getPreviewSourceElements(container), bounds.top);
  }
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
    blockFrom: range.from,
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
  const elements = getPreviewSourceElementsByOffset(container);
  const target = findSourceElementAtOffset(elements, anchor.blockFrom ?? anchor.offset);
  if (!target) return false;
  const range = readSourceRange(target);
  if (!range) return false;
  const bounds = container.getBoundingClientRect();
  const targetBounds = target.getBoundingClientRect();
  // 同一ブロックのリサイズでは描画進捗が最も安定する。一方、本文編集で
  // token境界が変わった場合は旧ブロック進捗を流用せず、写像済み本文位置を
  // 新しいsource rangeへ投影する。
  const sameSourceBlock = anchor.blockFrom !== undefined && range.from === anchor.blockFrom;
  const sourceProgress = sameSourceBlock && anchor.blockProgress !== undefined
    ? clampUnit(anchor.blockProgress)
    : clampUnit((anchor.offset - range.from) / Math.max(1, range.to - range.from));
  const targetPoint = targetBounds.top + sourceProgress * targetBounds.height;
  container.scrollTop += targetPoint - bounds.top - anchor.topOffset;
  return true;
}

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

interface OutlineNavigationTarget {
  preview: HTMLElement;
  offset: number;
}

const PREVIEW_ONLY_OUTLINE_TOP_OFFSET = 18;

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
 * アウトラインで選択された見出しと、分割プレビュー上の対応ブロックを求める。
 * アウトラインと見出しブロックは同じ文書順で生成されるため、同一インデックスで対応付ける。
 * @param event アウトライン操作のクリックイベント。
 * @returns 対応するプレビューとソースオフセット。対象外のクリックならundefined。
 */
function getOutlineNavigationTarget(event: MouseEvent): OutlineNavigationTarget | undefined {
  if (!(event.target instanceof Element)) return undefined;
  const button = event.target.closest<HTMLButtonElement>('.outline-panel nav button');
  if (!button) return undefined;
  const navigation = button.closest('nav');
  if (!navigation) return undefined;
  const buttons = Array.from(navigation.querySelectorAll<HTMLButtonElement>('button'));
  const outlineIndex = buttons.indexOf(button);
  if (outlineIndex < 0) return undefined;
  const preview = document.querySelector<HTMLElement>('.split-preview:not(.pane-hidden)');
  if (!preview) return undefined;
  const headingBlocks = Array.from(preview.querySelectorAll<HTMLElement>('.markdown-source-block'))
    .filter((block) => block.firstElementChild?.matches('h1,h2,h3,h4,h5,h6'));
  const headingBlock = headingBlocks[outlineIndex];
  if (!headingBlock) return undefined;
  const offset = Number(headingBlock.dataset.sourceFrom);
  return Number.isFinite(offset) ? { preview, offset } : undefined;
}

/**
 * ソース側でアウトライン移動が完了した後、アクティブ行と同じ高さへプレビュー見出しを合わせる。
 * CodeMirrorのscrollIntoViewがレイアウトへ反映された後に呼び出す。
 * @param target アウトライン対象のプレビューと本文オフセット。
 */
function alignOutlinePreviewToSource(target: OutlineNavigationTarget): void {
  const sourcePane = document.querySelector<HTMLElement>('.split-source-pane:not(.pane-hidden)');
  const sourceScroller = sourcePane?.querySelector<HTMLElement>('.cm-scroller');
  const activeLine = sourcePane?.querySelector<HTMLElement>('.cm-activeLine');
  const topOffset = sourceScroller && activeLine
    ? activeLine.getBoundingClientRect().top - sourceScroller.getBoundingClientRect().top
    : PREVIEW_ONLY_OUTLINE_TOP_OFFSET;
  restorePreviewViewport(target.preview, { offset: target.offset, topOffset });
}

/**
 * B案のアウトライン移動を表示構成に合わせて補正する。
 * 分割表示では既存のソース移動を維持し、その位置へプレビューも追従させる。
 * プレビューのみでは既存ハンドラーによるbothへの切替を止め、プレビューだけを対象見出しへ移動する。
 * @param event ドキュメント上のクリックイベント。
 */
function handleOutlineNavigationClick(event: MouseEvent): void {
  const target = getOutlineNavigationTarget(event);
  if (!target) return;
  const sourcePane = document.querySelector<HTMLElement>('.split-source-pane');
  const previewOnly = Boolean(sourcePane?.classList.contains('pane-hidden'));
  if (previewOnly) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    restorePreviewViewport(target.preview, {
      offset: target.offset,
      topOffset: PREVIEW_ONLY_OUTLINE_TOP_OFFSET
    });
    return;
  }
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => alignOutlinePreviewToSource(target));
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', handleOutlineNavigationClick, true);
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

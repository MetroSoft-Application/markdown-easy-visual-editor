/**
 * @fileoverview 本文範囲とプレビュー要素を対応付け、描画更新後のスクロール位置を復元する。
 */
import { getScrollRatio } from '../../shared/scroll';

/**
 * プレビューで復元する要素と画面内相対位置です。
 */
export interface PreviewViewportAnchor {

    /**
     * 復元対象のMarkdown本文内UTF-16オフセットです。
     */
    offset: number;

    /**
     * 対象要素上端とプレビュー表示領域上端の距離をCSSピクセル単位で示します。
     */
    topOffset: number;
    /**
     * 対応するMarkdownブロックの開始UTF-16オフセット。
     */
    blockFrom?: number;

    /**
     * ブロック内での縦位置を0から1の範囲で表した割合。
     */
    blockProgress?: number;
    /**
     * プレビュー全体の縦スクロール位置を0から1の範囲で表した割合。
     */
    scrollRatio?: number;
}

/**
 * ソース本文における対象ブロックの開始・終了位置です。
 */
interface SourceRange {

    /**
     * 対象Markdownブロックの先頭UTF-16オフセットです。
     */
    from: number;

    /**
     * 対象Markdownブロックの末尾UTF-16オフセットです。
     */
    to: number;
}

/**
 * スクロール位置復元の計算結果を再利用するキャッシュ。
 */
const previewSourceElementCache = new WeakMap<HTMLElement, {

    /**
      * スクロール可能なプレビュー全体のルート要素。
     */
    root: HTMLElement;

    /**
     * スクロール位置復元で扱うrevisionの文字列。
     */
    revision: string;

    /**
      * 可視位置の判定対象となる描画済みプレビュー要素。
     */
    elements: HTMLElement[];

    /**
      * Markdown本文の位置に対応付けられたプレビュー要素。
     */
    sourceElements: HTMLElement[];
}>();

/**
 * スクロール位置復元の寸法、容量、位置、または計測値を求める。
 * @param value - 0から1の範囲へ制限するスクロール比率。

 */
function clampUnit(value: number): number {
    return Math.min(1, Math.max(0, value));
}

/**
 * 描画要素のソース開始位置と終了位置を読み取る。
 * @param element - 寸法または属性を読み取るDOM要素。
 * @returns 有効なソース範囲。開始位置が数値でない場合はundefined。
 */
function readSourceRange(element: HTMLElement): SourceRange | undefined {
    const from = Number(element.dataset.sourceFrom);
    if (!Number.isFinite(from)) return undefined;
    const rawTo = Number(element.dataset.sourceTo);
    const to = Number.isFinite(rawTo) ? Math.max(from + 1, rawTo) : from + 1;
    return { from, to };
}

/**
  * スクロール復元対象に使うプレビュー内のブロック要素を集める。
 * @param container - 描画済みMarkdownとスクロール状態を持つプレビュー要素。
  * @returns Markdown本文との位置対応を持つプレビュー要素一覧。
 */
function getPreviewSourceElements(container: HTMLElement): HTMLElement[] {
    const root = container.querySelector<HTMLElement>('.rendered-markdown') ?? container;
    const revision = root.dataset.renderRevision ?? `${root.dataset.documentLength ?? ''}:${root.childElementCount}`;
    const cached = previewSourceElementCache.get(container);
    if (cached?.root === root && cached.revision === revision) return cached.elements;
    const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-source-from]'));
    const sourceElements = [...elements].sort(
        /**
         * 2つの値を比較して並び順を決める。
         * @param left - 比較対象の左側の値。
         * @param right - 比較対象の右側の値。
         * @returns 2つの要素の順序を示す数値。
         */
        (left, right) => {
            const leftRange = readSourceRange(left);
            const rightRange = readSourceRange(right);
            if (!leftRange) return 1;
            if (!rightRange) return -1;
            return leftRange.from - rightRange.from || leftRange.to - rightRange.to;
        });
    previewSourceElementCache.set(container, { root, revision, elements, sourceElements });
    return elements;
}

/**
  * 本文オフセット情報がない場合に、見出しや段落などから復元対象要素を集める。
 * @param container - 描画済みMarkdownとスクロール状態を持つプレビュー要素。
  * プレビュー内の復元対象要素一覧。
 */
function getPreviewSourceElementsByOffset(container: HTMLElement): HTMLElement[] {
    getPreviewSourceElements(container);
    return previewSourceElementCache.get(container)?.sourceElements ?? [];
}

/**
  * viewport上端より下にある最初の本文対応要素と、その可視位置を求める。
 * @param elements - スクロール位置復元で走査または更新する要素。
 * @param viewportTop - 可視境界判定に使うviewport上端のY座標（client CSS px）。
  * @returns 最初の可視要素とviewport上端からの距離。該当要素がなければundefined。
 */
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

/**
  * 指定した本文オフセットを含む復元対象要素を検索する。
 * @param elements - スクロール位置復元で走査または更新する要素。
 * @param offset - 表示要素に対応するMarkdown本文内のUTF-16オフセット。
  * @returns オフセットに対応する要素。対応範囲がなければundefined。
 */
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
 * スクロール位置復元の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param container - 描画済みMarkdownとスクロール状態を持つプレビュー要素。
 * @param ratio - 復元先の縦スクロール比率（0から1）。
 * @returns 条件が成立したかを示す真偽値。
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
 * プレビュー上端にある描画要素と本文オフセットを記録する。
 * @param container - 描画済みMarkdownとスクロール状態を持つプレビュー要素。
 * @returns 復元に使える要素とソース位置。表示領域またはソース位置を取得できない場合はundefined。
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
 * スクロール位置復元の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param container - 描画済みMarkdownとスクロール状態を持つプレビュー要素。
 * @param anchor - capturePreviewViewportが保存した本文位置と表示位置の復元情報。
 * @returns 条件が成立したかを示す真偽値。
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

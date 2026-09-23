/**
 * @fileoverview Webviewのスクロール位置復元を管理する。Hostとの通信、ユーザー操作、表示状態の契約を保つ。
 */
import { getScrollRatio } from '../shared/scroll';

/**
 * スクロール位置復元で共有するデータ形状を表すインターフェース。
 */
export interface PreviewViewportAnchor {

    /**
     * スクロール位置復元の位置・寸法・件数・時間を表す数値。
     */
    offset: number;

    /**
     * スクロール位置復元の位置・寸法・件数・時間を表す数値。
     */
    topOffset: number;
    /**
     * スクロール位置復元のblock・fromを表す数値。
     */
    blockFrom?: number;

    /**
     * スクロール位置復元のblock・progressを表す数値。
     */
    blockProgress?: number;
    /**
     * スクロール位置復元のscroll・ratioを表す数値。
     */
    scrollRatio?: number;
}

/**
 * スクロール位置復元で共有するデータ形状を表すインターフェース。
 */
interface SourceRange {

    /**
     * スクロール位置復元のfromを表す数値。
     */
    from: number;

    /**
     * スクロール位置復元のtoを表す数値。
     */
    to: number;
}

/**
 * スクロール位置復元の計算結果を再利用するキャッシュ。
 */
const previewSourceElementCache = new WeakMap<HTMLElement, {

    /**
     * スクロール位置復元のrootに関する状態または設定。
     */
    root: HTMLElement;

    /**
     * スクロール位置復元で扱うrevisionの文字列。
     */
    revision: string;

    /**
     * スクロール位置復元のelementsに関する状態または設定。
     */
    elements: HTMLElement[];

    /**
     * スクロール位置復元のsource・elementsに関する状態または設定。
     */
    sourceElements: HTMLElement[];
}>();

/**
 * スクロール位置復元の寸法、容量、位置、または計測値を求める。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns スクロール位置復元で利用する数値。
 */
function clampUnit(value: number): number {
    return Math.min(1, Math.max(0, value));
}

/**
 * スクロール位置復元から必要な値またはリソースを取得する。
 * @param element - 寸法または属性を読み取るDOM要素。
 * @returns 副作用を完了し、値は返さない。
 */
function readSourceRange(element: HTMLElement): SourceRange | undefined {
    const from = Number(element.dataset.sourceFrom);
    if (!Number.isFinite(from)) return undefined;
    const rawTo = Number(element.dataset.sourceTo);
    const to = Number.isFinite(rawTo) ? Math.max(from + 1, rawTo) : from + 1;
    return { from, to };
}

/**
 * スクロール位置復元から必要な値またはリソースを取得する。
 * @param container - スクロール位置復元へ渡す入力。
 * @returns スクロール位置復元に対応する要素の一覧。
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
 * スクロール位置復元から必要な値またはリソースを取得する。
 * @param container - スクロール位置復元へ渡す入力。
 * @returns スクロール位置復元に対応する要素の一覧。
 */
function getPreviewSourceElementsByOffset(container: HTMLElement): HTMLElement[] {
    getPreviewSourceElements(container);
    return previewSourceElementCache.get(container)?.sourceElements ?? [];
}

/**
 * スクロール位置復元から必要な値またはリソースを取得する。
 * @param elements - スクロール位置復元で走査または更新する要素。
 * @param viewportTop - スクロール位置復元で扱う数値。
 * @returns 条件に一致する値。未検出時はundefinedまたはnull。
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
 * スクロール位置復元から必要な値またはリソースを取得する。
 * @param elements - スクロール位置復元で走査または更新する要素。
 * @param offset - スクロール位置復元の位置・寸法・件数・時間を表す数値。
 * @returns 条件に一致する値。未検出時はundefinedまたはnull。
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
 * @param container - スクロール位置復元へ渡す入力。
 * @param ratio - スクロール位置復元で扱う数値。
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
 * スクロール位置復元のcapture・preview・viewportを処理し、呼び出し側へ結果または副作用を返す。
 * @param container - スクロール位置復元へ渡す入力。
 * @returns 副作用を完了し、値は返さない。
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
 * @param container - スクロール位置復元へ渡す入力。
 * @param anchor - スクロール位置復元へ渡す入力。
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

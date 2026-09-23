/**
 * @fileoverview 文字色操作を本文上の変更へ変換し、削除範囲をまたぐ位置と選択範囲を正しく写像する。
 */
/**
 * 文字色で解析・表示・保存する本文。
 */
export const TEXT_COLOR_HEX = {
    red: "#d32f2f",
    orange: "#e65100",
    yellow: "#9a6700",
    green: "#2e7d32",
    blue: "#1565c0",
    purple: "#7b1fa2",
    gray: "#616161",
} as const;

/**
 * 文字色で対象や分岐を識別する値の型。
 */
export type TextColorId = keyof typeof TEXT_COLOR_HEX;
/**
 * 文字色の現在状態または履歴を保持するデータ形状。
 */
export type TextColorSelectionState = TextColorId | "mixed" | undefined;

/**
 * 文字色で解析・表示・保存する本文。
 */
export const TEXT_COLOR_IDS = Object.keys(TEXT_COLOR_HEX) as TextColorId[];

/**
 * 文字色で共有するデータ形状を表すインターフェース。
 */
export interface TextColorSelection {

    /**
     * 文字色のfromを表す数値。
     */
    from: number;

    /**
     * 文字色のtoを表す数値。
     */
    to: number;
}

/**
 * 文字色で共有するデータ形状を表すインターフェース。
 */
export interface TextColorEdit {

    /**
     * 表示・解析・変換の対象となる本文。
     */
    text: string;

    /**
     * 文字色のselectionに関する状態または設定。
     */
    selection: TextColorSelection;
}

/**
 * 文字色で共有するデータ形状を表すインターフェース。
 */
interface ColorSpan {

    /**
     * 文字色のfromを表す数値。
     */
    from: number;

    /**
     * 文字色のtoを表す数値。
     */
    to: number;

    /**
     * 文字色のcolorに関する状態または設定。
     */
    color: TextColorId;
}

/**
 * 文字色で共有するデータ形状を表すインターフェース。
 */
interface ParsedSpan extends ColorSpan {

    /**
     * 文字色のorderを表す数値。
     */
    order: number;
}

/**
 * 文字色で共有するデータ形状を表すインターフェース。
 */
interface Layer {

    /**
     * 文字色のfromを表す数値。
     */
    from: number;

    /**
     * 文字色のtoを表す数値。
     */
    to: number;

    /**
     * 文字色のcolorに関する状態または設定。
     */
    color?: TextColorId;

    /**
     * 文字色のorderを表す数値。
     */
    order: number;
}

/**
 * 文字色で共有するデータ形状を表すインターフェース。
 */
interface ActiveLayer {

    /**
     * 文字色のidを表す数値。
     */
    id: number;

    /**
     * 文字色のlayerに関する状態または設定。
     */
    layer: Layer;
}

/**
 * 文字色で共有するデータ形状を表すインターフェース。
 */
interface ParsedMarkup {

    /**
     * 表示・解析・変換の対象となる本文。
     */
    text: string;

    /**
     * 文字色のspansに関する状態または設定。
     */
    spans: ParsedSpan[];

    /**
     * 文字色のremovedに関する状態または設定。
     */
    removed: TextColorSelection[];
}

/**
 * 文字色で共有するデータ形状を表すインターフェース。
 */
interface StackEntry {

    /**
     * 文字色のcolorに関する状態または設定。
     */
    color?: TextColorId;

    /**
     * 文字色のfromを表す数値。
     */
    from?: number;

    /**
     * 文字色のorderを表す数値。
     */
    order?: number;

    /**
     * 文字色のremovedを切り替えるフラグ。
     */
    removed: boolean;
}


/**
 * 文字色の入力形式を検出する正規表現。
 */
const COLOR_ATTRIBUTE_PATTERN =
    /\bdata-mve-text-color\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i;

/**
 * 文字色のtickに関する状態または設定。
 */
const TICK = String.fromCharCode(96);

/**
 * 文字色の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param selection - 文字色へ渡す入力。
 * @param color - 文字色へ渡す入力。
 * @returns 文字色のapply・text・color・formattingが生成する結果。
 */
export function applyTextColorFormatting(
    source: string,
    selection: TextColorSelection,
    color: TextColorId | undefined,
): TextColorEdit {
    const parsed = parseColorMarkup(source);
    const cleanSelection = mapSelection(selection, parsed.removed, source.length, parsed.text.length);
    const colorable = collectColorableRanges(parsed.text);
    let spans = restrictToRanges(normalizeSpans(parsed.spans, parsed.text.length), colorable);
    const paintRanges = intersectRanges(colorable, cleanSelection);
    if (paintRanges.length) spans = paintRangesOnSpans(spans, paintRanges, color);
    return serializeColorMarkup(parsed.text, spans, cleanSelection);
}

/**
 * 文字色のdetect・text・color・formattingを処理し、呼び出し側へ結果または副作用を返す。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param selection - 文字色へ渡す入力。
 * @returns 文字色のdetect・text・color・formattingが生成する結果。
 */
export function detectTextColorFormatting(
    source: string,
    selection: TextColorSelection,
): TextColorSelectionState {
    const parsed = parseColorMarkup(source);
    const cleanSelection = mapSelection(selection, parsed.removed, source.length, parsed.text.length);
    if (cleanSelection.from === cleanSelection.to) return undefined;
    const colorable = collectColorableRanges(parsed.text);
    const ranges = intersectRanges(colorable, cleanSelection);
    if (!ranges.length) return undefined;
    const spans = restrictToRanges(normalizeSpans(parsed.spans, parsed.text.length), colorable);
    const states = new Set<TextColorId | "default">();
    let start = 0;
    for (const range of ranges) {
        while (start < spans.length && spans[start].to <= range.from) start += 1;
        let cursor = range.from;
        for (let index = start; index < spans.length; index += 1) {
            const span = spans[index];
            if (span.from >= range.to) break;
            const from = Math.max(range.from, span.from);
            const to = Math.min(range.to, span.to);
            if (from > cursor) states.add("default");
            if (to > from) states.add(span.color);
            cursor = Math.max(cursor, to);
            if (states.size > 1) return "mixed";
        }
        if (cursor < range.to) states.add("default");
        if (states.size > 1) return "mixed";
    }
    const state = states.values().next().value as TextColorId | "default" | undefined;
    return state === "default" ? undefined : state;
}

/**
 * 文字色のtext・color・open・tagを処理し、呼び出し側へ結果または副作用を返す。
 * @param color - 文字色へ渡す入力。
 * @returns 文字色で利用する文字列。
 */
export function textColorOpenTag(color: TextColorId): string {
    return '<span data-mve-text-color="' + color + '" style="color:' + TEXT_COLOR_HEX[color] + '">';
}

/**
 * 文字色から不要または危険な情報を除去する。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns 文字色で利用する文字列。
 */
export function stripMveTextColorMarkup(value: string): string {
    const parts: string[] = [];
    const stack: Array<{
        /**
         * 文字色のremovedを切り替えるフラグ。
         */
        removed: boolean
    }> = [];
    const preserved = collectPreservedMarkupRanges(value);
    let preservedIndex = 0;
    let cursor = 0;


    const isPreserved = /**
   * 文字色の条件を判定する。
   * @param from - 文字色で扱う数値。
   * @param to - 文字色で扱う数値。
   * @returns 条件が成立したかを示す真偽値。
   */ (from: number, to: number) => {
            while (preservedIndex < preserved.length && preserved[preservedIndex].to <= from) preservedIndex += 1;
            const range = preserved[preservedIndex];
            return Boolean(range && range.from < to && range.to > from);
        };
    for (const { tag, from, to } of scanSpanTags(value)) {
        parts.push(value.slice(cursor, from));
        const selfClosing = /\/\s*>$/.test(tag);
        if (isPreserved(from, to) || isEscaped(value, from)) {
            parts.push(tag);
        } else if (/^<\/span\b/i.test(tag)) {
            const entry = stack.pop();
            if (!entry?.removed) parts.push(tag);
        } else if (readTextColorId(tag) && !selfClosing) {
            stack.push({ removed: true });
        } else {
            parts.push(tag);
            if (!selfClosing) stack.push({ removed: false });
        }
        cursor = to;
    }
    parts.push(value.slice(cursor));
    return parts.join("");
}

/**
 * 文字色の入力を構造化した値へ変換する。
 * @param source - 解析・描画・変換の起点となる本文。
 * @returns 文字色で生成または変換した値。
 */
function parseColorMarkup(source: string): ParsedMarkup {
    const parts: string[] = [];
    const spans: ParsedSpan[] = [];
    const removed: TextColorSelection[] = [];
    const stack: StackEntry[] = [];
    const preserved = collectPreservedMarkupRanges(source);
    let preservedIndex = 0;
    let rawCursor = 0;
    let cleanLength = 0;
    let order = 0;


    const append = /**
   * 文字色のappendを処理し、呼び出し側へ結果または副作用を返す。
   * @param value - 検証・変換・保存の対象となる値。
   * @returns 文字色のappendが生成する結果。
   */ (value: string) => {
            if (!value) return;
            parts.push(value);
            cleanLength += value.length;
        };


    const isPreserved = /**
   * 文字色の条件を判定する。
   * @param from - 文字色で扱う数値。
   * @param to - 文字色で扱う数値。
   * @returns 条件が成立したかを示す真偽値。
   */ (from: number, to: number) => {
            while (preservedIndex < preserved.length && preserved[preservedIndex].to <= from) preservedIndex += 1;
            const range = preserved[preservedIndex];
            return Boolean(range && range.from < to && range.to > from);
        };

    for (const { tag, from, to } of scanSpanTags(source)) {
        append(source.slice(rawCursor, from));
        if (isPreserved(from, to) || isEscaped(source, from)) {
            append(tag);
        } else if (/^<\/span\b/i.test(tag)) {
            const entry = stack.pop();
            if (entry?.removed) {
                removed.push({ from, to });
                if (entry.color && entry.from !== undefined) {
                    spans.push({ from: entry.from, to: cleanLength, color: entry.color, order: entry.order ?? order++ });
                }
            } else {
                append(tag);
            }
        } else {
            const color = readTextColorId(tag);
            const selfClosing = /\/\s*>$/.test(tag);
            if (color && !selfClosing) {
                removed.push({ from, to });
                stack.push({ color, from: cleanLength, order: order++, removed: true });
            } else {
                append(tag);
                if (!selfClosing) stack.push({ removed: false });
            }
        }
        rawCursor = to;
    }
    append(source.slice(rawCursor));
    for (const entry of stack) {
        if (entry.removed && entry.color && entry.from !== undefined) {
            spans.push({ from: entry.from, to: cleanLength, color: entry.color, order: entry.order ?? order++ });
        }
    }
    return { text: parts.join(""), spans, removed: mergeRanges(removed) };
}

/**
 * 文字色から必要な値またはリソースを取得する。
 * @param tag - 文字色で受け渡す文字列。
 * @returns 副作用を完了し、値は返さない。
 */
function readTextColorId(tag: string): TextColorId | undefined {
    const match = COLOR_ATTRIBUTE_PATTERN.exec(tag);
    const value = (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").toLowerCase();
    return Object.prototype.hasOwnProperty.call(TEXT_COLOR_HEX, value)
        ? value as TextColorId
        : undefined;
}

/**
 * 文字色の入力を走査し、該当する範囲または要素を順に返す。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns 文字色タグを走査するジェネレーター。
 */
function* scanSpanTags(value: string): Generator<{
    /**
     * 文字色で扱うtagの文字列。
     */
    tag: string;
    /**
     * 文字色のfromを表す数値。
     */
    from: number;
    /**
     * 文字色のtoを表す数値。
     */
    to: number
}> {
    let cursor = 0;
    while (cursor < value.length) {
        const from = value.indexOf("<", cursor);
        if (from < 0) return;
        const nameStart = value[from + 1] === "/" ? from + 2 : from + 1;
        const nameEnd = nameStart + 4;
        if (value.slice(nameStart, nameEnd).toLowerCase() !== "span" || isWordCharacter(value[nameEnd])) {
            cursor = from + 1;
            continue;
        }
        const end = value.indexOf(">", nameEnd);
        if (end < 0) return;
        const to = end + 1;
        yield { tag: value.slice(from, to), from, to };
        cursor = to;
    }
}

/**
 * 文字色の条件を判定する。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns 条件が成立したかを示す真偽値。
 */
function isWordCharacter(value: string | undefined): boolean {
    return Boolean(value && /[A-Za-z0-9_]/.test(value));
}

/**
 * 文字色のmap・selectionを処理し、呼び出し側へ結果または副作用を返す。
 * @param selection - 文字色へ渡す入力。
 * @param removed - 文字色へ渡す要素の一覧。
 * @param sourceLength - 文字色で扱う文字列または本文。
 * @param cleanLength - 文字色の位置・寸法・件数・時間を表す数値。
 * @returns 文字色で生成または変換した値。
 */
function mapSelection(
    selection: TextColorSelection,
    removed: readonly TextColorSelection[],
    sourceLength: number,
    cleanLength: number,
): TextColorSelection {

    /**
     * 文字色のmapを処理し、呼び出し側へ結果または副作用を返す。
     * @param offset - 文字色の位置・寸法・件数・時間を表す数値。
     * @returns 文字色に対応する要素の一覧。
     */
    const map = (offset: number) => {
        const safe = Math.max(0, Math.min(sourceLength, offset));
        let removedLength = 0;
        for (const range of removed) {
            if (safe >= range.to) {
                removedLength += range.to - range.from;
            } else {
                if (safe > range.from) return range.from - removedLength;
                break;
            }
        }
        return safe - removedLength;
    };
    const from = Math.max(0, Math.min(cleanLength, Math.min(map(selection.from), map(selection.to))));
    const to = Math.max(0, Math.min(cleanLength, Math.max(map(selection.from), map(selection.to))));
    return { from, to };
}

/**
 * 文字色の入力を許可された形式へ整える。
 * @param parsed - 文字色へ渡す要素の一覧。
 * @param length - 文字色の位置・寸法・件数・時間を表す数値。
 * @returns 文字色に対応する要素の一覧。
 */
function normalizeSpans(parsed: readonly ParsedSpan[], length: number): ColorSpan[] {
    return resolveLayers(parsed
        .map(
            /**
             * 各spanからfromを取り出して一覧化する。
             * @param span - spanのfromを参照する走査対象。
             * @returns fromを取り出した変換結果の一覧。
             */
            (span) => ({
                from: Math.max(0, Math.min(length, span.from)),
                to: Math.max(0, Math.min(length, span.to)),
                color: span.color,
                order: span.order,
            }))
        .filter(
            /**
             * toの条件を満たすspanだけを残す。
             * @param span - spanのtoを参照する走査対象。
             * @returns 条件を満たした要素だけを含む一覧。
             */
            (span) => span.to > span.from));
}

/**
 * 文字色を表示用の結果へ変換する。
 * @param spans - 文字色へ渡す要素の一覧。
 * @param ranges - 文字色へ渡す要素の一覧。
 * @param color - 文字色へ渡す入力。
 * @returns 文字色に対応する要素の一覧。
 */
function paintRangesOnSpans(
    spans: readonly ColorSpan[],
    ranges: readonly TextColorSelection[],
    color: TextColorId | undefined,
): ColorSpan[] {
    return resolveLayers([
        ...spans.map(
            /**
             * spansの各要素を変換して一覧化する。
             * @param span - 文字色へ渡す入力。
             * @param index - 配列・行列・文字列の要素位置を示す番号。
             * @returns 入力要素から生成した変換結果の一覧。
             */
            (span, index) => ({ ...span, order: index })),
        ...ranges.map(
            /**
             * rangesの各要素を変換して一覧化する。
             * @param range - 文字色へ渡す入力。
             * @param index - 配列・行列・文字列の要素位置を示す番号。
             * @returns 入力要素から生成した変換結果の一覧。
             */
            (range, index) => ({ ...range, color, order: spans.length + index })),
    ]);
}

/**
 * 文字色から必要な値またはリソースを取得する。
 * @param layers - 文字色の位置・寸法・件数・時間を表す数値。
 * @returns 文字色に対応する要素の一覧。
 */
function resolveLayers(layers: readonly Layer[]): ColorSpan[] {
    const events: Array<{
        /**
         * 文字色の位置・寸法・件数・時間を表す数値。
         */
        position: number;
        /**
         * 文字色のopenを切り替えるフラグ。
         */
        open: boolean;
        /**
         * 文字色の状態を示すフラグ。
         */
        active: ActiveLayer
    }> = [];
    for (const [id, layer] of layers.entries()) {
        if (layer.to <= layer.from) continue;
        const active = { id, layer };
        events.push({ position: layer.from, open: true, active });
        events.push({ position: layer.to, open: false, active });
    }
    events.sort(
        /**
         * 2つの値を比較して並び順を決める。
         * @param left - 比較対象の左側の値。
         * @param right - 比較対象の右側の値。
         * @returns 2つの要素の順序を示す数値。
         */
        (left, right) => left.position - right.position || Number(left.open) - Number(right.open));
    const active = new Set<number>();
    const heap: ActiveLayer[] = [];
    const result: ColorSpan[] = [];
    let cursor = events[0]?.position ?? 0;
    let index = 0;
    while (index < events.length) {
        const position = events[index].position;
        const top = peekActiveLayer(heap, active);
        if (top?.layer.color && position > cursor) result.push({ from: cursor, to: position, color: top.layer.color });
        while (index < events.length && events[index].position === position && !events[index].open) {
            active.delete(events[index].active.id);
            index += 1;
        }
        while (index < events.length && events[index].position === position) {
            active.add(events[index].active.id);
            pushActiveLayer(heap, events[index].active);
            index += 1;
        }
        cursor = position;
    }
    return mergeColorSpans(result);
}

/**
 * 文字色のpeek・active・layerを処理し、呼び出し側へ結果または副作用を返す。
 * @param heap - 文字色へ渡す要素の一覧。
 * @param active - 文字色で扱う数値。
 * @returns 副作用を完了し、値は返さない。
 */
function peekActiveLayer(heap: ActiveLayer[], active: ReadonlySet<number>): ActiveLayer | undefined {
    while (heap.length && !active.has(heap[0].id)) popActiveLayer(heap);
    return heap[0];
}

/**
 * 文字色のpush・active・layerを処理し、呼び出し側へ結果または副作用を返す。
 * @param heap - 文字色へ渡す要素の一覧。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns 副作用を完了し、値は返さない。
 */
function pushActiveLayer(heap: ActiveLayer[], value: ActiveLayer): void {
    heap.push(value);
    let child = heap.length - 1;
    while (child > 0) {
        const parent = Math.floor((child - 1) / 2);
        if (compareActiveLayers(heap[parent], value) >= 0) break;
        heap[child] = heap[parent];
        child = parent;
    }
    heap[child] = value;
}

/**
 * 文字色のpop・active・layerを処理し、呼び出し側へ結果または副作用を返す。
 * @param heap - 文字色へ渡す要素の一覧。
 * @returns 副作用を完了し、値は返さない。
 */
function popActiveLayer(heap: ActiveLayer[]): ActiveLayer | undefined {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length && last) {
        let parent = 0;
        while (true) {
            const left = parent * 2 + 1;
            const right = left + 1;
            let child = parent;
            if (left < heap.length && compareActiveLayers(heap[left], last) > 0) child = left;
            if (right < heap.length && compareActiveLayers(heap[right], child === parent ? last : heap[left]) > 0) child = right;
            if (child === parent) break;
            heap[parent] = heap[child];
            parent = child;
        }
        heap[parent] = last;
    }
    return top;
}

/**
 * 文字色の2つの値を比較する。
 * @param left - 親領域の左端を基準にした相対位置または比較値。
 * @param right - 文字色へ渡す入力。
 * @returns 文字色で利用する数値。
 */
function compareActiveLayers(left: ActiveLayer, right: ActiveLayer): number {
    return left.layer.order - right.layer.order || left.id - right.id;
}

/**
 * 文字色のmerge・color・spansを処理し、呼び出し側へ結果または副作用を返す。
 * @param spans - 文字色へ渡す要素の一覧。
 * @returns 文字色に対応する要素の一覧。
 */
function mergeColorSpans(spans: readonly ColorSpan[]): ColorSpan[] {
    const sorted = spans.slice().filter(
        /**
         * toの条件を満たすspanだけを残す。
         * @param span - spanのtoを参照する走査対象。
         * @returns 条件を満たした要素だけを含む一覧。
         */
        (span) => span.to > span.from)
        .sort(
            /**
             * 2つの値を比較して並び順を決める。
             * @param left - 比較対象の左側の値。
             * @param right - 比較対象の右側の値。
             * @returns 2つの要素の順序を示す数値。
             */
            (left, right) => left.from - right.from || left.to - right.to);
    const result: ColorSpan[] = [];
    for (const span of sorted) {
        const previous = result.at(-1);
        if (previous && previous.color === span.color && previous.to >= span.from) {
            previous.to = Math.max(previous.to, span.to);
        } else {
            result.push({ ...span });
        }
    }
    return result;
}

/**
 * 文字色のrestrict・to・rangesを処理し、呼び出し側へ結果または副作用を返す。
 * @param spans - 文字色へ渡す要素の一覧。
 * @param ranges - 文字色へ渡す要素の一覧。
 * @returns 文字色に対応する要素の一覧。
 */
function restrictToRanges(
    spans: readonly ColorSpan[],
    ranges: readonly TextColorSelection[],
): ColorSpan[] {
    const result: ColorSpan[] = [];
    let start = 0;
    for (const span of spans) {
        while (start < ranges.length && ranges[start].to <= span.from) start += 1;
        for (let index = start; index < ranges.length && ranges[index].from < span.to; index += 1) {
            const from = Math.max(span.from, ranges[index].from);
            const to = Math.min(span.to, ranges[index].to);
            if (to > from) result.push({ from, to, color: span.color });
        }
    }
    return mergeColorSpans(result);
}

/**
 * 文字色のintersect・rangesを処理し、呼び出し側へ結果または副作用を返す。
 * @param ranges - 文字色へ渡す要素の一覧。
 * @param selection - 文字色へ渡す入力。
 * @returns 文字色に対応する要素の一覧。
 */
function intersectRanges(
    ranges: readonly TextColorSelection[],
    selection: TextColorSelection,
): TextColorSelection[] {
    const result: TextColorSelection[] = [];
    for (const range of ranges) {
        if (range.to <= selection.from) continue;
        if (range.from >= selection.to) break;
        const from = Math.max(range.from, selection.from);
        const to = Math.min(range.to, selection.to);
        if (to > from) result.push({ from, to });
    }
    return result;
}

/**
 * 文字色から必要な値またはリソースを取得する。
 * @param source - 解析・描画・変換の起点となる本文。
 * @returns 文字色に対応する要素の一覧。
 */
function collectColorableRanges(source: string): TextColorSelection[] {
    const frontMatterEnd = findFrontMatterEnd(source);
    const inlineProtected = collectInlineProtectedRanges(source);
    let inlineProtectedIndex = 0;
    const ranges: TextColorSelection[] = [];
    let lineStart = 0;
    let fence: {
        /**
         * 文字色で扱うcharacterの文字列。
         */
        character: string;
        /**
         * 文字色の位置・寸法・件数・時間を表す数値。
         */
        length: number
    } | undefined;
    while (lineStart <= source.length) {
        const newline = source.indexOf("\n", lineStart);
        const lineEnd = newline < 0 ? source.length : newline;
        const line = source.slice(lineStart, lineEnd);
        const logical = line.slice(blockQuoteContentStart(line));
        const marker = readFence(logical);
        if (marker) {
            if (!fence) fence = marker;
            else if (marker.character === fence.character && marker.length >= fence.length && !marker.rest.trim()) fence = undefined;
        } else if (!fence && !(frontMatterEnd > 0 && lineStart < frontMatterEnd) && !isUncolorableWholeLine(logical)) {
            const projected = projectRangesToLine(inlineProtected, lineStart, lineEnd, inlineProtectedIndex);
            inlineProtectedIndex = projected.nextIndex;
            const protectedRanges = [
                ...collectProtectedLineRanges(line),
                ...projected.ranges,
            ];
            for (const range of subtractRanges({ from: 0, to: line.length }, mergeRanges(protectedRanges))) {
                const trimmed = trimWhitespace(line, range);
                if (trimmed.to > trimmed.from) ranges.push({ from: lineStart + trimmed.from, to: lineStart + trimmed.to });
            }
        }
        if (newline < 0) break;
        lineStart = lineEnd + 1;
    }
    return ranges;
}

/**
 * 文字色から必要な値またはリソースを取得する。
 * @param source - 解析・描画・変換の起点となる本文。
 * @returns 文字色に対応する要素の一覧。
 */
function collectPreservedMarkupRanges(source: string): TextColorSelection[] {
    const ranges: TextColorSelection[] = [...inlineCodeRanges(source)];
    const frontMatterEnd = findFrontMatterEnd(source);
    if (frontMatterEnd) ranges.push({ from: 0, to: frontMatterEnd });
    let lineStart = 0;
    let fence: {
        /**
         * 文字色で扱うcharacterの文字列。
         */
        character: string;
        /**
         * 文字色の位置・寸法・件数・時間を表す数値。
         */
        length: number
    } | undefined;
    while (lineStart <= source.length) {
        const newline = source.indexOf("\n", lineStart);
        const lineEnd = newline < 0 ? source.length : newline;
        const line = source.slice(lineStart, lineEnd);
        if (!(frontMatterEnd > 0 && lineStart < frontMatterEnd)) {
            const logical = line.slice(blockQuoteContentStart(line));
            const marker = readFence(logical);
            if (fence || marker) {
                ranges.push({ from: lineStart, to: lineEnd });
                if (!fence && marker) fence = marker;
                else if (fence && marker && marker.character === fence.character && marker.length >= fence.length && !marker.rest.trim()) fence = undefined;
            } else if (isIndentedCodeLine(logical)) {
                ranges.push({ from: lineStart, to: lineEnd });
            }
        }
        if (newline < 0) break;
        lineStart = lineEnd + 1;
    }
    return mergeRanges(ranges);
}

/**
 * 文字色から必要な値またはリソースを取得する。
 * @param source - 解析・描画・変換の起点となる本文。
 * @returns 文字色で利用する数値。
 */
function findFrontMatterEnd(source: string): number {
    if (!source.startsWith("---\n")) return 0;
    let start = 4;
    while (start <= source.length) {
        const newline = source.indexOf("\n", start);
        const end = newline < 0 ? source.length : newline;
        if (source.slice(start, end).trim() === "---" || source.slice(start, end).trim() === "...") return newline < 0 ? source.length : end + 1;
        if (newline < 0) return source.length;
        start = end + 1;
    }
    return source.length;
}

/**
 * 文字色から必要な値またはリソースを取得する。
 * @param line - 文字色の位置・寸法・件数・時間を表す数値。
 * @returns 文字色のread・fenceが生成する結果。
 */
function readFence(line: string): {
    /**
     * 文字色で扱うcharacterの文字列。
     */
    character: string;
    /**
     * 文字色の位置・寸法・件数・時間を表す数値。
     */
    length: number;
    /**
     * 文字色で扱うrestの文字列。
     */
    rest: string
} | undefined {
    let start = 0;
    while (start < line.length && start < 4 && line[start] === " ") start += 1;
    const character = line[start];
    if (character !== TICK && character !== "~") return undefined;
    let end = start;
    while (line[end] === character) end += 1;
    return end - start >= 3 ? { character, length: end - start, rest: line.slice(end) } : undefined;
}

/**
 * 文字色の条件を判定する。
 * @param line - 文字色の位置・寸法・件数・時間を表す数値。
 * @returns 条件が成立したかを示す真偽値。
 */
function isUncolorableWholeLine(line: string): boolean {
    if (!line.trim() || isIndentedCodeLine(line)) return true;
    if (/^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})\s*$/.test(line)) return true;
    return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

/**
 * 文字色の条件を判定する。
 * @param line - 文字色の位置・寸法・件数・時間を表す数値。
 * @returns 条件が成立したかを示す真偽値。
 */
function isIndentedCodeLine(line: string): boolean {
    if (!/^(?: {4}|\t)\S/.test(line)) return false;
    return !/^[ \t]+(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/.test(line);
}

/**
 * 文字色から必要な値またはリソースを取得する。
 * @param line - 文字色の位置・寸法・件数・時間を表す数値。
 * @returns 文字色に対応する要素の一覧。
 */
function collectProtectedLineRanges(line: string): TextColorSelection[] {
    if (/^\s*\[[^\]\n]+\]:/.test(line.slice(blockQuoteContentStart(line)))) {
        return [{ from: 0, to: line.length }];
    }
    const ranges: TextColorSelection[] = [];
    const prefix = blockPrefixEnd(line);
    if (prefix) ranges.push({ from: 0, to: prefix });
    for (let index = 0; index < line.length; index += 1) if (line[index] === "|" && !isEscaped(line, index)) ranges.push({ from: index, to: index + 1 });
    ranges.push(...htmlTagRanges(line));
    ranges.push(...footnoteRanges(line));
    ranges.push(...matchRanges(line, /\[TOC\]/gi));
    ranges.push(...matchRanges(line, /\[![A-Z][A-Z0-9-]*\]/g));
    if (/ {2,}$/.test(line)) ranges.push({ from: Math.max(0, line.length - 2), to: line.length });
    if (/\\$/.test(line) && !isEscaped(line, line.length - 1)) ranges.push({ from: line.length - 1, to: line.length });
    return mergeRanges(ranges);
}

/**
 * 文字色から必要な値またはリソースを取得する。
 * @param source - 解析・描画・変換の起点となる本文。
 * @returns 文字色に対応する要素の一覧。
 */
function collectInlineProtectedRanges(source: string): TextColorSelection[] {
    const ranges = inlineCodeRanges(source);
    addLinkSyntaxRanges(source, ranges);
    return mergeRanges(ranges);
}

/**
 * 文字色のproject・ranges・to・lineを処理し、呼び出し側へ結果または副作用を返す。
 * @param ranges - 文字色へ渡す要素の一覧。
 * @param lineStart - 文字色の位置・寸法・件数・時間を表す数値。
 * @param lineEnd - 文字色の位置・寸法・件数・時間を表す数値。
 * @param startIndex - 文字色の位置・寸法・件数・時間を表す数値。
 * @returns 文字色のproject・ranges・to・lineが生成する結果。
 */
function projectRangesToLine(
    ranges: readonly TextColorSelection[],
    lineStart: number,
    lineEnd: number,
    startIndex: number,
): {
    /**
     * 文字色のrangesに関する状態または設定。
     */
    ranges: TextColorSelection[];
    /**
     * 文字色の位置・寸法・件数・時間を表す数値。
     */
    nextIndex: number
} {
    let index = startIndex;
    while (index < ranges.length && ranges[index].to <= lineStart) index += 1;
    const nextIndex = index;
    const result: TextColorSelection[] = [];
    for (; index < ranges.length; index += 1) {
        const range = ranges[index];
        if (range.from >= lineEnd) break;
        result.push({ from: Math.max(0, range.from - lineStart), to: Math.min(lineEnd - lineStart, range.to - lineStart) });
    }
    return { ranges: result, nextIndex };
}

/**
 * 文字色のhtml・tag・rangesを処理し、呼び出し側へ結果または副作用を返す。
 * @param line - 文字色の位置・寸法・件数・時間を表す数値。
 * @returns 文字色に対応する要素の一覧。
 */
function htmlTagRanges(line: string): TextColorSelection[] {
    const ranges: TextColorSelection[] = [];
    let from = -1;
    let escaped = false;
    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (character === "\\") {
            escaped = true;
            continue;
        }
        if (character === "<" && from < 0) from = index;
        else if (character === ">" && from >= 0) {
            ranges.push({ from, to: index + 1 });
            from = -1;
        }
    }
    return ranges;
}

/**
 * 文字色のfootnote・rangesを処理し、呼び出し側へ結果または副作用を返す。
 * @param line - 文字色の位置・寸法・件数・時間を表す数値。
 * @returns 文字色に対応する要素の一覧。
 */
function footnoteRanges(line: string): TextColorSelection[] {
    const ranges: TextColorSelection[] = [];
    let cursor = 0;
    while (cursor < line.length) {
        const from = line.indexOf("[^", cursor);
        if (from < 0) break;
        const close = line.indexOf("]", from + 2);
        if (close < 0) break;
        const to = close + (line[close + 1] === ":" ? 2 : 1);
        ranges.push({ from, to });
        cursor = to;
    }
    return ranges;
}

/**
 * 文字色のadd・link・syntax・rangesを処理し、呼び出し側へ結果または副作用を返す。
 * @param line - 文字色の位置・寸法・件数・時間を表す数値。
 * @param ranges - 文字色へ渡す要素の一覧。
 * @returns 副作用を完了し、値は返さない。
 */
function addLinkSyntaxRanges(line: string, ranges: TextColorSelection[]): void {
    const bracketMatches = findBracketMatches(line);
    const parenthesisMatches = findParenthesisMatches(line);
    for (let from = 0; from < line.length; from += 1) {
        const image = line[from] === "!" && line[from + 1] === "[";
        const labelOpen = image ? from + 1 : from;
        if (line[labelOpen] !== "[" || isEscaped(line, labelOpen)) continue;
        const labelClose = bracketMatches.get(labelOpen);
        if (labelClose === undefined) continue;
        const afterLabel = labelClose + 1;
        let to = -1;
        if (line[afterLabel] === "(") to = parenthesisMatches.get(afterLabel) ?? -1;
        else if (line[afterLabel] === "[") to = bracketMatches.get(afterLabel) ?? -1;
        else {
            const whitespace = /^\s*/.exec(line.slice(afterLabel))?.[0].length ?? 0;
            const next = line[afterLabel + whitespace];
            if (next !== "(" && next !== "[" && next !== ":") to = labelClose;
        }
        if (to < 0) continue;
        if (image) ranges.push({ from, to: to + 1 });
        else {
            ranges.push({ from, to: labelOpen + 1 });
            ranges.push({ from: labelClose, to: to + 1 });
        }
        from = to;
    }
}

/**
 * 文字色から必要な値またはリソースを取得する。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns 文字色で利用する数値。
 */
function findBracketMatches(value: string): ReadonlyMap<number, number> {
    const matches = new Map<number, number>();
    const opens: number[] = [];
    let escaped = false;
    for (let index = 0; index < value.length; index += 1) {
        const character = value[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (character === "\\") {
            escaped = true;
            continue;
        }
        if (character === "[") opens.push(index);
        else if (character === "]") {
            const open = opens.pop();
            if (open !== undefined) matches.set(open, index);
        }
    }
    return matches;
}

/**
 * 文字色から必要な値またはリソースを取得する。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns 文字色で利用する数値。
 */
function findParenthesisMatches(value: string): ReadonlyMap<number, number> {
    const matches = new Map<number, number>();
    const opens: number[] = [];
    let quote: string | undefined;
    let angleDestination = false;
    let escaped = false;
    for (let index = 0; index < value.length; index += 1) {
        const character = value[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (character === "\\") {
            escaped = true;
            continue;
        }
        if (quote) {
            if (character === quote) quote = undefined;
            continue;
        }
        if (angleDestination) {
            if (character === ">") angleDestination = false;
            continue;
        }
        if (opens.length === 1 && character === "<") {
            angleDestination = true;
            continue;
        }
        if (opens.length > 0 && (character === '"' || character === "'")) {
            quote = character;
            continue;
        }
        if (character === "(") opens.push(index);
        else if (character === ")") {
            const open = opens.pop();
            if (open !== undefined) matches.set(open, index);
        }
    }
    return matches;
}

/**
 * 文字色のblock・prefix・endを処理し、呼び出し側へ結果または副作用を返す。
 * @param line - 文字色の位置・寸法・件数・時間を表す数値。
 * @returns 文字色で利用する数値。
 */
function blockPrefixEnd(line: string): number {
    let position = line.match(/^[ \t]*/)?.[0].length ?? 0;
    while (true) {
        const quote = /^>\s?/.exec(line.slice(position));
        if (!quote) break;
        position += quote[0].length;
        position += line.slice(position).match(/^[ \t]*/)?.[0].length ?? 0;
    }
    const heading = /^#{1,6}(?:[ \t]+|$)/.exec(line.slice(position));
    if (heading) position += heading[0].length;
    const list = /^(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/.exec(line.slice(position));
    if (list) position += list[0].length;
    return position;
}

/**
 * 文字色のblock・quote・content・startを処理し、呼び出し側へ結果または副作用を返す。
 * @param line - 文字色の位置・寸法・件数・時間を表す数値。
 * @returns 文字色で利用する数値。
 */
function blockQuoteContentStart(line: string): number {
    let position = 0;
    while (true) {
        const indent = /^ {0,3}/.exec(line.slice(position))?.[0].length ?? 0;
        const quote = /^>[ \t]?/.exec(line.slice(position + indent));
        if (!quote) return position;
        position += indent + quote[0].length;
    }
}

/**
 * 文字色のinline・code・rangesを処理し、呼び出し側へ結果または副作用を返す。
 * @param line - 文字色の位置・寸法・件数・時間を表す数値。
 * @returns 文字色に対応する要素の一覧。
 */
function inlineCodeRanges(line: string): TextColorSelection[] {
    const ranges: TextColorSelection[] = [];
    const opens = new Map<number, number>();
    for (let index = 0; index < line.length;) {
        if (line[index] !== TICK) {
            index += 1;
            continue;
        }
        let length = 1;
        while (line[index + length] === TICK) length += 1;
        const open = opens.get(length);
        if (open === undefined) opens.set(length, index);
        else {
            ranges.push({ from: open, to: index + length });
            opens.delete(length);
        }
        index += length;
    }
    return mergeRanges(ranges);
}

/**
 * 文字色のmatch・rangesを処理し、呼び出し側へ結果または副作用を返す。
 * @param line - 文字色の位置・寸法・件数・時間を表す数値。
 * @param pattern - 文字色へ渡す入力。
 * @returns 文字色に対応する要素の一覧。
 */
function matchRanges(line: string, pattern: RegExp): TextColorSelection[] {
    pattern.lastIndex = 0;
    const ranges: TextColorSelection[] = [];
    for (let match = pattern.exec(line); match; match = pattern.exec(line)) ranges.push({ from: match.index, to: match.index + match[0].length });
    return ranges;
}

/**
 * 文字色の条件を判定する。
 * @param value - 検証・変換・保存の対象となる値。
 * @param index - 配列・行列・文字列の要素位置を示す番号。
 * @returns 条件が成立したかを示す真偽値。
 */
function isEscaped(value: string, index: number): boolean {
    let count = 0;
    for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) count += 1;
    return count % 2 === 1;
}

/**
 * 文字色のsubtract・rangesを処理し、呼び出し側へ結果または副作用を返す。
 * @param range - 文字色へ渡す入力。
 * @param protectedRanges - 文字色へ渡す要素の一覧。
 * @returns 文字色に対応する要素の一覧。
 */
function subtractRanges(range: TextColorSelection, protectedRanges: readonly TextColorSelection[]): TextColorSelection[] {
    const result: TextColorSelection[] = [];
    let cursor = range.from;
    for (const protectedRange of protectedRanges) {
        if (protectedRange.to <= cursor) continue;
        if (protectedRange.from >= range.to) break;
        if (protectedRange.from > cursor) result.push({ from: cursor, to: protectedRange.from });
        cursor = Math.max(cursor, protectedRange.to);
        if (cursor >= range.to) break;
    }
    if (cursor < range.to) result.push({ from: cursor, to: range.to });
    return result;
}

/**
 * 文字色のmerge・rangesを処理し、呼び出し側へ結果または副作用を返す。
 * @param ranges - 文字色へ渡す要素の一覧。
 * @returns 文字色に対応する要素の一覧。
 */
function mergeRanges(ranges: readonly TextColorSelection[]): TextColorSelection[] {
    const sorted = ranges.slice().filter(
        /**
         * toの条件を満たす範囲だけを残す。
         * @param range - 範囲のtoを参照する走査対象。
         * @returns 条件を満たした要素だけを含む一覧。
         */
        (range) => range.to > range.from)
        .sort(
            /**
             * 2つの値を比較して並び順を決める。
             * @param left - 比較対象の左側の値。
             * @param right - 比較対象の右側の値。
             * @returns 2つの要素の順序を示す数値。
             */
            (left, right) => left.from - right.from || left.to - right.to);
    const result: TextColorSelection[] = [];
    for (const range of sorted) {
        const previous = result.at(-1);
        if (previous && previous.to >= range.from) previous.to = Math.max(previous.to, range.to);
        else result.push({ ...range });
    }
    return result;
}

/**
 * 文字色のtrim・whitespaceを処理し、呼び出し側へ結果または副作用を返す。
 * @param line - 文字色の位置・寸法・件数・時間を表す数値。
 * @param range - 文字色へ渡す入力。
 * @returns 文字色のtrim・whitespaceが生成する結果。
 */
function trimWhitespace(line: string, range: TextColorSelection): TextColorSelection {
    let { from, to } = range;
    while (from < to && /\s/.test(line[from])) from += 1;
    while (to > from && /\s/.test(line[to - 1])) to -= 1;
    return { from, to };
}

/**
 * 文字色を出力または保存できる文字列へ整える。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param spans - 文字色へ渡す要素の一覧。
 * @param selection - 文字色でselectionとして扱う入力。
 * @returns 文字色のserialize・color・markupが生成する結果。
 */
function serializeColorMarkup(source: string, spans: readonly ColorSpan[], selection: TextColorSelection): TextColorEdit {
    const opens = new Map<number, string[]>();
    const closes = new Map<number, string[]>();
    for (const span of spans) {
        const open = opens.get(span.from) ?? [];
        open.push(textColorOpenTag(span.color));
        opens.set(span.from, open);
        const close = closes.get(span.to) ?? [];
        close.push("</span>");
        closes.set(span.to, close);
    }
    const positions = [...new Set([0, source.length, selection.from, selection.to, ...opens.keys(), ...closes.keys()])]
        .filter(
            /**
             * 内容のないpositionを除外する。
             * @param position - 文字色の位置・寸法・件数・時間を表す数値。
             * @returns 条件を満たした要素だけを含む一覧。
             */
            (position) => position >= 0 && position <= source.length)
        .sort(
            /**
             * 2つの値を比較して並び順を決める。
             * @param left - 比較対象の左側の値。
             * @param right - 比較対象の右側の値。
             * @returns 2つの要素の順序を示す数値。
             */
            (left, right) => left - right);
    const parts: string[] = [];
    let outputLength = 0;
    let cursor = 0;
    let mappedFrom = 0;
    let mappedTo = 0;


    const append = /**
   * 文字色のappendを処理し、呼び出し側へ結果または副作用を返す。
   * @param value - 検証・変換・保存の対象となる値。
   * @returns 文字色のappendが生成する結果。
   */ (value: string) => {
            if (value) {
                parts.push(value);
                outputLength += value.length;
            }
        };
    for (const position of positions) {
        append(source.slice(cursor, position));
        if (position === selection.to) mappedTo = outputLength;
        for (const close of closes.get(position) ?? []) append(close);
        for (const open of opens.get(position) ?? []) append(open);
        if (position === selection.from) mappedFrom = outputLength;
        cursor = position;
    }
    append(source.slice(cursor));
    return { text: parts.join(""), selection: { from: mappedFrom, to: mappedTo } };
}

/**
 * @file textColor.ts
 * 実行境界: Extension HostとWebviewの共有層。
 * 責務: 両実行境界で共有する値、プロトコル、変換を扱う。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: 呼び出し元から渡された値を変換し、外部状態を直接変更しない。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
/** テキスト色IDと保存・表示に使う16進カラー値の対応表。 */
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
 * 「TextColorId」として扱う値の型を定義します。
 */
export type TextColorId = keyof typeof TEXT_COLOR_HEX;
/**
 * 「TextColorSelectionState」として扱う値の型を定義します。
 */
export type TextColorSelectionState = TextColorId | "mixed" | undefined;
/** 「TEXT_COLOR_IDS」は、関連する処理間で共有する設定値または状態です。 */
/** リボンや設定UIで列挙する色ID。対応表のキーから生成して不一致を防ぐ。 */
export const TEXT_COLOR_IDS = Object.keys(TEXT_COLOR_HEX) as TextColorId[];

/**
 * 「TextColorSelection」が満たすデータ契約を定義します。
 */
export interface TextColorSelection {

  /**
   * 「from」は、本文または選択範囲の位置・長さを保持します。
   */
  from: number;

  /**
   * 「to」は、本文または選択範囲の位置・長さを保持します。
   */
  to: number;
}

/**
 * 「TextColorEdit」が満たすデータ契約を定義します。
 */
export interface TextColorEdit {

  /**
   * 「text」は、画面または通知へ表示する文言を保持します。
   */
  text: string;

  /**
   * 「selection」は、関連処理が共有する構造化データの一項目です。
   */
  selection: TextColorSelection;
}

/**
 * 「ColorSpan」が満たすデータ契約を定義します。
 */
interface ColorSpan {

  /**
   * 「from」は、本文または選択範囲の位置・長さを保持します。
   */
  from: number;

  /**
   * 「to」は、本文または選択範囲の位置・長さを保持します。
   */
  to: number;

  /**
   * 「color」は、表示テーマまたはスタイル設定を保持します。
   */
  color: TextColorId;
}

/**
 * 「ParsedSpan」が満たすデータ契約を定義します。
 */
interface ParsedSpan extends ColorSpan {

  /**
   * 「order」は、位置・サイズ・件数などを表す数値です。
   */
  order: number;
}

/**
 * 「Layer」が満たすデータ契約を定義します。
 */
interface Layer {

  /**
   * 「from」は、本文または選択範囲の位置・長さを保持します。
   */
  from: number;

  /**
   * 「to」は、本文または選択範囲の位置・長さを保持します。
   */
  to: number;

  /**
   * 「color」は、表示テーマまたはスタイル設定を保持します。
   */
  color?: TextColorId;

  /**
   * 「order」は、位置・サイズ・件数などを表す数値です。
   */
  order: number;
}

/**
 * 「ActiveLayer」が満たすデータ契約を定義します。
 */
interface ActiveLayer {

  /**
   * 「id」は、対象の識別や処理分岐に使用する値を保持します。
   */
  id: number;

  /**
   * 「layer」は、関連処理が共有する構造化データの一項目です。
   */
  layer: Layer;
}

/**
 * 「ParsedMarkup」が満たすデータ契約を定義します。
 */
interface ParsedMarkup {

  /**
   * 「text」は、画面または通知へ表示する文言を保持します。
   */
  text: string;

  /**
   * 「spans」は、関連する複数の対象または識別子を保持します。
   */
  spans: ParsedSpan[];

  /**
   * 「removed」は、関連する複数の対象または識別子を保持します。
   */
  removed: TextColorSelection[];
}

/**
 * 「StackEntry」が満たすデータ契約を定義します。
 */
interface StackEntry {

  /**
   * 「color」は、表示テーマまたはスタイル設定を保持します。
   */
  color?: TextColorId;

  /**
   * 「from」は、本文または選択範囲の位置・長さを保持します。
   */
  from?: number;

  /**
   * 「order」は、位置・サイズ・件数などを表す数値です。
   */
  order?: number;

  /**
   * 「removed」は、処理条件または状態を表す真偽値です。
   */
  removed: boolean;
}

/** 「COLOR_ATTRIBUTE_PATTERN」は、関連する処理間で共有する設定値または状態です。 */
/** 保存済みの色付きspanから色属性を読み取るための正規表現。 */
const COLOR_ATTRIBUTE_PATTERN =
  /\bdata-mve-text-color\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i;
/** 「TICK」は、関連する処理間で共有する設定値または状態です。 */
/** コードスパン判定に使うMarkdownバッククォート。 */
const TICK = String.fromCharCode(96);

/**
 * apply・text・color・formattingを処理します。
 * @param source 処理対象のソースです。
 * @param selection 「selection」は、「applyTextColorFormatting」が関連処理の処理対象を特定する入力です。
 * @param color 処理対象の色です。
 * @returns 「source」「selection」「color」から生成した処理結果を返します。
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
 * 「detectTextColorFormatting」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param source 処理対象のソースです。
 * @param selection 「selection」は、「detectTextColorFormatting」が関連処理の処理対象を特定する入力です。
 * @returns 「detectTextColorFormatting」が生成または整形した関連処理の文字列を返します。
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
 * 「textColorOpenTag」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param color 処理対象の色です。
 * @returns 「textColorOpenTag」が生成した関連処理の表示文字列を返します。
 */
export function textColorOpenTag(color: TextColorId): string {
  return '<span data-mve-text-color="' + color + '" style="color:' + TEXT_COLOR_HEX[color] + '">';
}

/**
 * 「stripMveTextColorMarkup」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param value 「stripMveTextColorMarkup」で検証・変換する入力値です。
 * @returns 「stripMveTextColorMarkup」が生成した関連処理の表示文字列を返します。
 */
export function stripMveTextColorMarkup(value: string): string {
  const parts: string[] = [];
  const stack: Array<{
  /**
   * 「removed」は、関連処理が共有する構造化データの一項目です。
   */
  removed: boolean }> = [];
  const preserved = collectPreservedMarkupRanges(value);
  let preservedIndex = 0;
  let cursor = 0;

  /**
   * is・preservedかどうかを判定します。
   * @param from 本文または選択範囲を示すゼロ基準の位置です。範囲の開始・終了や写像の基準になります。
   * @param to 本文または選択範囲を示すゼロ基準の位置です。範囲の開始・終了や写像の基準になります。
   * @returns 条件を満たすかどうかを示す真偽値を返します。
   */
  const isPreserved = /**
 * 「isPreserved」は、後続処理へ渡す対象を判定します。
 * @param from 処理対象を特定する位置、範囲、または数量です。
 * @param to 処理対象を特定する位置、範囲、または数量です。
 * @returns 対象を保持または採用するかどうかを示す真偽値を返します。
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
 * マークアップを解析または復元します。
 * @param source 処理対象のソースです。
 * @returns 「parseColorMarkup」が読み取りまたは正規化した結果を返します。
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

  /**
   * 「append」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param value 「append」で検証・変換する入力値です。
   * @returns 「append」が関連処理の入力を処理して得た固有の結果を返します。
   */
  const append = /**
 * 「append」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param value 「append」で検証・変換する入力値です。
 * @returns 「append」が関連処理の入力を処理して得た固有の結果を返します。
 */ (value: string) => {
    if (!value) return;
    parts.push(value);
    cleanLength += value.length;
  };

  /**
   * is・preservedかどうかを判定します。
   * @param from 本文または選択範囲を示すゼロ基準の位置です。範囲の開始・終了や写像の基準になります。
   * @param to 本文または選択範囲を示すゼロ基準の位置です。範囲の開始・終了や写像の基準になります。
   * @returns 条件を満たすかどうかを示す真偽値を返します。
   */
  const isPreserved = /**
 * 「isPreserved」は、後続処理へ渡す対象を判定します。
 * @param from 処理対象を特定する位置、範囲、または数量です。
 * @param to 処理対象を特定する位置、範囲、または数量です。
 * @returns 対象を保持または採用するかどうかを示す真偽値を返します。
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
 * IDを取得または解決します。
 * @param tag 「tag」は、「readTextColorId」が関連処理の処理対象を特定する入力です。
 * @returns 「readTextColorId」が対象を取得できない場合はundefinedを返します。
 */
function readTextColorId(tag: string): TextColorId | undefined {
  const match = COLOR_ATTRIBUTE_PATTERN.exec(tag);
  const value = (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(TEXT_COLOR_HEX, value)
    ? value as TextColorId
    : undefined;
}

/**
 * 「scanSpanTags」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param value 「scanSpanTags」で検証・変換する入力値です。
 * @returns 「scanSpanTags」が生成または変換した関連処理の文字列を返します。
 */
function* scanSpanTags(value: string): Generator<{
/**
 * 「tag」は、対象の内容または識別子を表す文字列です。
 */
tag: string;
/**
 * 「from」は、本文または選択範囲の位置・長さを保持します。
 */
from: number;
/**
 * 「to」は、本文または選択範囲の位置・長さを保持します。
 */
to: number }> {
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
 * is・word・characterかどうかを判定します。
 * @param value 「isWordCharacter」で検証・変換する入力値です。
 * @returns 判定結果です。
 */
function isWordCharacter(value: string | undefined): boolean {
  return Boolean(value && /[A-Za-z0-9_]/.test(value));
}

/**
 * 「mapSelection」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param selection 「selection」は、「mapSelection」が関連処理の処理対象を特定する入力です。
 * @param removed 「removed」は、「mapSelection」が関連処理の処理対象を特定する入力です。
 * @param sourceLength 「sourceLength」は、「mapSelection」が関連処理の処理対象を特定する入力です。
 * @param cleanLength 「cleanLength」は、「mapSelection」が関連処理の処理対象を特定する入力です。
 * @returns 「mapSelection」が関連処理の入力を処理して得た固有の結果を返します。
 */
function mapSelection(
  selection: TextColorSelection,
  removed: readonly TextColorSelection[],
  sourceLength: number,
  cleanLength: number,
): TextColorSelection {

  /**
   * 削除済み範囲の長さを差し引き、元の選択位置を現在の本文座標へ写像する。
   * @param offset 本文または選択範囲を示すゼロ基準の位置です。範囲の開始・終了や写像の基準になります。
   * @returns 削除済み範囲を除いた本文上の位置を返します。
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
 * normalize・spansを正規化します。
 * @param parsed 「parsed」は、「normalizeSpans」が関連処理の処理対象を特定する入力です。
 * @param length 「length」は、「normalizeSpans」が関連処理の処理対象を特定する入力です。
 * @returns 「normalizeSpans」が読み取りまたは正規化した結果を返します。
 */
function normalizeSpans(parsed: readonly ParsedSpan[], length: number): ColorSpan[] {
  return resolveLayers(parsed
    .map(
    /**
 * 「span」を変換し、変換後の要素を返すコールバックです。
     * @param span spanとして渡される、このコールバックの入力値です。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (span) => ({
      from: Math.max(0, Math.min(length, span.from)),
      to: Math.max(0, Math.min(length, span.to)),
      color: span.color,
      order: span.order,
    }))
    .filter(
    /**
 * 「span」が条件に一致するか判定し、残す要素を決めるコールバックです。
     * @param span spanとして渡される、このコールバックの入力値です。
     * @returns 要素を採用するかどうかの真偽値を返します。
     */
    (span) => span.to > span.from));
}

/**
 * 「paintRangesOnSpans」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param spans 「spans」は、「paintRangesOnSpans」が関連処理の処理対象を特定する入力です。
 * @param ranges 「ranges」は、「paintRangesOnSpans」が関連処理の処理対象を特定する入力です。
 * @param color 処理対象の色です。
 * @returns 「paintRangesOnSpans」が関連処理の入力を処理して得た固有の結果を返します。
 */
function paintRangesOnSpans(
  spans: readonly ColorSpan[],
  ranges: readonly TextColorSelection[],
  color: TextColorId | undefined,
): ColorSpan[] {
  return resolveLayers([
    ...spans.map(
    /**
 * 「span」「index」を変換し、変換後の要素を返すコールバックです。
     * @param span spanとして渡される、このコールバックの入力値です。
     * @param index 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (span, index) => ({ ...span, order: index })),
    ...ranges.map(
    /**
 * 「range」「index」を変換し、変換後の要素を返すコールバックです。
     * @param range 処理対象の範囲です。
     * @param index 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (range, index) => ({ ...range, color, order: spans.length + index })),
  ]);
}

/**
 * resolve・layersを取得または解決します。
 * @param layers 「layers」は、「resolveLayers」が関連処理の処理対象を特定する入力です。
 * @returns 「resolveLayers」が関連処理の入力を処理して得た固有の結果を返します。
 */
function resolveLayers(layers: readonly Layer[]): ColorSpan[] {
  const events: Array<{
  /**
   * 「position」は、位置・サイズ・件数などを表す数値です。
   */
  position: number;
  /**
   * 「open」は、処理条件または状態を表す真偽値です。
   */
  open: boolean;
  /**
   * 「active」は、画面の表示モードまたは現在のUI状態を示します。
   */
  active: ActiveLayer }> = [];
  for (const [id, layer] of layers.entries()) {
    if (layer.to <= layer.from) continue;
    const active = { id, layer };
    events.push({ position: layer.from, open: true, active });
    events.push({ position: layer.to, open: false, active });
  }
  events.sort(
  /**
 * 「left」「right」を比較し、並び順を示す数値を返すコールバックです。
   * @param left 比較対象の左側の値です。
   * @param right 比較対象の右側の値です。
   * @returns 比較対象の順序を示す負数、0、または正数を返します。
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
 * 「peekActiveLayer」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param heap 「heap」は、「peekActiveLayer」が関連処理の処理対象を特定する入力です。
 * @param active 「active」は、「peekActiveLayer」が関連処理の処理対象を特定する入力です。
 * @returns 「peekActiveLayer」が対象を取得できない場合はundefinedを返します。
 */
function peekActiveLayer(heap: ActiveLayer[], active: ReadonlySet<number>): ActiveLayer | undefined {
  while (heap.length && !active.has(heap[0].id)) popActiveLayer(heap);
  return heap[0];
}

/**
 * 「pushActiveLayer」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param heap 「heap」は、「pushActiveLayer」が関連処理の処理対象を特定する入力です。
 * @param value 「pushActiveLayer」で検証・変換する入力値です。
 * @returns 「pushActiveLayer」の副作用または状態更新を実行し、値は返しません。
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
 * 「popActiveLayer」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param heap 「heap」は、「popActiveLayer」が関連処理の処理対象を特定する入力です。
 * @returns 「popActiveLayer」が対象を取得できない場合はundefinedを返します。
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
 * 「compareActiveLayers」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param left 比較または矩形計算における左右いずれかの対象です。
 * @param right 比較または矩形計算における左右いずれかの対象です。
 * @returns 計算結果の数値です。
 */
function compareActiveLayers(left: ActiveLayer, right: ActiveLayer): number {
  return left.layer.order - right.layer.order || left.id - right.id;
}

/**
 * 「mergeColorSpans」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param spans 「spans」は、「mergeColorSpans」が関連処理の処理対象を特定する入力です。
 * @returns 「mergeColorSpans」が関連処理の入力を処理して得た固有の結果を返します。
 */
function mergeColorSpans(spans: readonly ColorSpan[]): ColorSpan[] {
  const sorted = spans.slice().filter(
  /**
 * 「span」が条件に一致するか判定し、残す要素を決めるコールバックです。
   * @param span spanとして渡される、このコールバックの入力値です。
   * @returns 要素を採用するかどうかの真偽値を返します。
   */
  (span) => span.to > span.from)
    .sort(
    /**
 * 「left」「right」を比較し、並び順を示す数値を返すコールバックです。
     * @param left 比較対象の左側の値です。
     * @param right 比較対象の右側の値です。
     * @returns 要素を採用するかどうかの真偽値を返します。
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
 * 「restrictToRanges」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param spans 「spans」は、「restrictToRanges」が関連処理の処理対象を特定する入力です。
 * @param ranges 「ranges」は、「restrictToRanges」が関連処理の処理対象を特定する入力です。
 * @returns 「restrictToRanges」が関連処理の入力を処理して得た固有の結果を返します。
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
 * 「intersectRanges」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param ranges 「ranges」は、「intersectRanges」が関連処理の処理対象を特定する入力です。
 * @param selection 「selection」は、「intersectRanges」が関連処理の処理対象を特定する入力です。
 * @returns 「intersectRanges」が関連処理の入力を処理して得た固有の結果を返します。
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
 * 「collectColorableRanges」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param source 処理対象のソースです。
 * @returns 「collectColorableRanges」が関連処理の入力を処理して得た固有の結果を返します。
 */
function collectColorableRanges(source: string): TextColorSelection[] {
  const frontMatterEnd = findFrontMatterEnd(source);
  const inlineProtected = collectInlineProtectedRanges(source);
  let inlineProtectedIndex = 0;
  const ranges: TextColorSelection[] = [];
  let lineStart = 0;
  let fence: {
  /**
   * 「character」は、対象の内容または識別子を表す文字列です。
   */
  character: string;
  /**
   * 「length」は、本文または選択範囲の位置・長さを保持します。
   */
  length: number } | undefined;
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
 * 「collectPreservedMarkupRanges」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param source 処理対象のソースです。
 * @returns 「collectPreservedMarkupRanges」が関連処理の入力を処理して得た固有の結果を返します。
 */
function collectPreservedMarkupRanges(source: string): TextColorSelection[] {
  const ranges: TextColorSelection[] = [...inlineCodeRanges(source)];
  const frontMatterEnd = findFrontMatterEnd(source);
  if (frontMatterEnd) ranges.push({ from: 0, to: frontMatterEnd });
  let lineStart = 0;
  let fence: {
  /**
   * 「character」は、対象の内容または識別子を表す文字列です。
   */
  character: string;
  /**
   * 「length」は、本文または選択範囲の位置・長さを保持します。
   */
  length: number } | undefined;
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
 * find・front・matter・endを取得または解決します。
 * @param source 処理対象のソースです。
 * @returns 計算結果の数値です。
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
 * read・fenceを取得または解決します。
 * @param line 「line」は、「readFence」が関連処理の処理対象を特定する入力です。
 * @returns 「readFence」が生成または変換した関連処理の文字列を返します。
 */
function readFence(line: string): {
/**
 * 「character」は、対象の内容または識別子を表す文字列です。
 */
character: string;
/**
 * 「length」は、本文または選択範囲の位置・長さを保持します。
 */
length: number;
/**
 * 「rest」は、関連処理が共有する構造化データの一項目です。
 */
rest: string } | undefined {
  let start = 0;
  while (start < line.length && start < 4 && line[start] === " ") start += 1;
  const character = line[start];
  if (character !== TICK && character !== "~") return undefined;
  let end = start;
  while (line[end] === character) end += 1;
  return end - start >= 3 ? { character, length: end - start, rest: line.slice(end) } : undefined;
}

/**
 * is・uncolorable・whole・lineかどうかを判定します。
 * @param line 「line」は、「isUncolorableWholeLine」が関連処理の処理対象を特定する入力です。
 * @returns 判定結果です。
 */
function isUncolorableWholeLine(line: string): boolean {
  if (!line.trim() || isIndentedCodeLine(line)) return true;
  if (/^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})\s*$/.test(line)) return true;
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

/**
 * is・indented・code・lineかどうかを判定します。
 * @param line 「line」は、「isIndentedCodeLine」が関連処理の処理対象を特定する入力です。
 * @returns 判定結果です。
 */
function isIndentedCodeLine(line: string): boolean {
  if (!/^(?: {4}|\t)\S/.test(line)) return false;
  return !/^[ \t]+(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/.test(line);
}

/**
 * 「collectProtectedLineRanges」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param line 「line」は、「collectProtectedLineRanges」が関連処理の処理対象を特定する入力です。
 * @returns 「collectProtectedLineRanges」が関連処理の入力を処理して得た固有の結果を返します。
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
 * 「collectInlineProtectedRanges」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param source 処理対象のソースです。
 * @returns 「collectInlineProtectedRanges」が関連処理の入力を処理して得た固有の結果を返します。
 */
function collectInlineProtectedRanges(source: string): TextColorSelection[] {
  const ranges = inlineCodeRanges(source);
  addLinkSyntaxRanges(source, ranges);
  return mergeRanges(ranges);
}

/**
 * 「projectRangesToLine」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param ranges 「ranges」は、「projectRangesToLine」が関連処理の処理対象を特定する入力です。
 * @param lineStart 「lineStart」は、「projectRangesToLine」が関連処理の処理対象を特定する入力です。
 * @param lineEnd 「lineEnd」は、「projectRangesToLine」が関連処理の処理対象を特定する入力です。
 * @param startIndex 「startIndex」は、「projectRangesToLine」が関連処理で処理する対象を特定する入力です。
 * @returns 計算結果の数値です。
 */
function projectRangesToLine(
  ranges: readonly TextColorSelection[],
  lineStart: number,
  lineEnd: number,
  startIndex: number,
): {
/**
 * 「ranges」は、関連する複数の対象または識別子を保持します。
 */
ranges: TextColorSelection[];
/**
 * 「nextIndex」は、対象の位置、サイズ、件数、または範囲を保持します。
 */
nextIndex: number } {
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
 * 「htmlTagRanges」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param line 「line」は、「htmlTagRanges」が関連処理の処理対象を特定する入力です。
 * @returns 「htmlTagRanges」が生成または整形した関連処理の文字列を返します。
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
 * 「footnoteRanges」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param line 「line」は、「footnoteRanges」が関連処理の処理対象を特定する入力です。
 * @returns 「footnoteRanges」が関連処理の入力を処理して得た固有の結果を返します。
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
 * 「addLinkSyntaxRanges」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param line 「line」は、「addLinkSyntaxRanges」が関連処理の処理対象を特定する入力です。
 * @param ranges 「ranges」は、「addLinkSyntaxRanges」が関連処理の処理対象を特定する入力です。
 * @returns 「addLinkSyntaxRanges」の副作用または状態更新を実行し、値は返しません。
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
 * find・bracket・matchesを取得または解決します。
 * @param value 「findBracketMatches」で検証・変換する入力値です。
 * @returns 計算結果の数値です。
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
 * find・parenthesis・matchesを取得または解決します。
 * @param value 「findParenthesisMatches」で検証・変換する入力値です。
 * @returns 計算結果の数値です。
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
 * 「blockPrefixEnd」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param line 「line」は、「blockPrefixEnd」が関連処理の処理対象を特定する入力です。
 * @returns 計算結果の数値です。
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
 * 「blockQuoteContentStart」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param line 「line」は、「blockQuoteContentStart」が関連処理の処理対象を特定する入力です。
 * @returns 計算結果の数値です。
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
 * 「inlineCodeRanges」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param line 「line」は、「inlineCodeRanges」が関連処理の処理対象を特定する入力です。
 * @returns 「inlineCodeRanges」が関連処理の入力を処理して得た固有の結果を返します。
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
 * 「matchRanges」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param line 「line」は、「matchRanges」が関連処理の処理対象を特定する入力です。
 * @param pattern 「pattern」は、「matchRanges」が関連処理の処理対象を特定する入力です。
 * @returns 「matchRanges」が関連処理の入力を処理して得た固有の結果を返します。
 */
function matchRanges(line: string, pattern: RegExp): TextColorSelection[] {
  pattern.lastIndex = 0;
  const ranges: TextColorSelection[] = [];
  for (let match = pattern.exec(line); match; match = pattern.exec(line)) ranges.push({ from: match.index, to: match.index + match[0].length });
  return ranges;
}

/**
 * is・escapedかどうかを判定します。
 * @param value 「isEscaped」で検証・変換する入力値です。
 * @param index 本文、表、配列内の対象位置を示すインデックスです。
 * @returns 判定結果です。
 */
function isEscaped(value: string, index: number): boolean {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) count += 1;
  return count % 2 === 1;
}

/**
 * 「subtractRanges」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param range 処理対象の範囲です。
 * @param protectedRanges 「protectedRanges」は、「subtractRanges」が関連処理の処理対象を特定する入力です。
 * @returns 「subtractRanges」が関連処理の入力を処理して得た固有の結果を返します。
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
 * 「mergeRanges」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param ranges 「ranges」は、「mergeRanges」が関連処理の処理対象を特定する入力です。
 * @returns 「mergeRanges」が関連処理の入力を処理して得た固有の結果を返します。
 */
function mergeRanges(ranges: readonly TextColorSelection[]): TextColorSelection[] {
  const sorted = ranges.slice().filter(
  /**
 * 「range」が条件に一致するか判定し、残す要素を決めるコールバックです。
   * @param range 処理対象の範囲です。
   * @returns 要素を採用するかどうかの真偽値を返します。
   */
  (range) => range.to > range.from)
    .sort(
    /**
 * 「left」「right」を比較し、並び順を示す数値を返すコールバックです。
     * @param left 比較対象の左側の値です。
     * @param right 比較対象の右側の値です。
     * @returns 要素を採用するかどうかの真偽値を返します。
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
 * 「trimWhitespace」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param line 「line」は、「trimWhitespace」が関連処理の処理対象を特定する入力です。
 * @param range 処理対象の範囲です。
 * @returns 「trimWhitespace」が関連処理の入力を処理して得た固有の結果を返します。
 */
function trimWhitespace(line: string, range: TextColorSelection): TextColorSelection {
  let { from, to } = range;
  while (from < to && /\s/.test(line[from])) from += 1;
  while (to > from && /\s/.test(line[to - 1])) to -= 1;
  return { from, to };
}

/**
 * マークアップを安全な形式へ変換します。
 * @param source 処理対象のソースです。
 * @param spans 「spans」は、「serializeColorMarkup」が関連処理の処理対象を特定する入力です。
 * @param selection 「selection」は、「serializeColorMarkup」が関連処理の処理対象を特定する入力です。
 * @returns 「serializeColorMarkup」が入力を解析・正規化した関連処理の結果を返します。
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
 * 「position」が条件に一致するか判定し、残す要素を決めるコールバックです。
     * @param position positionとして渡される、このコールバックの入力値です。
     * @returns 要素を採用するかどうかの真偽値を返します。
     */
    (position) => position >= 0 && position <= source.length)
    .sort(
    /**
 * 「left」「right」を比較し、並び順を示す数値を返すコールバックです。
     * @param left 比較対象の左側の値です。
     * @param right 比較対象の右側の値です。
     * @returns 要素を採用するかどうかの真偽値を返します。
     */
    (left, right) => left - right);
  const parts: string[] = [];
  let outputLength = 0;
  let cursor = 0;
  let mappedFrom = 0;
  let mappedTo = 0;

  /**
   * 「append」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param value 「append」で検証・変換する入力値です。
   * @returns 「append」が関連処理の入力を処理して得た固有の結果を返します。
   */
  const append = /**
 * 「append」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param value 「append」で検証・変換する入力値です。
 * @returns 「append」が関連処理の入力を処理して得た固有の結果を返します。
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

export const TEXT_COLOR_HEX = {
  red: "#d32f2f",
  orange: "#e65100",
  yellow: "#9a6700",
  green: "#2e7d32",
  blue: "#1565c0",
  purple: "#7b1fa2",
  gray: "#616161",
} as const;

export type TextColorId = keyof typeof TEXT_COLOR_HEX;
export type TextColorSelectionState = TextColorId | "mixed" | undefined;

export const TEXT_COLOR_IDS = Object.keys(TEXT_COLOR_HEX) as TextColorId[];

export interface TextColorSelection {
  from: number;
  to: number;
}

export interface TextColorEdit {
  text: string;
  selection: TextColorSelection;
}

interface ColorSpan {
  from: number;
  to: number;
  color: TextColorId;
}

interface ParsedColorSpan extends ColorSpan {
  order: number;
}

interface RemovedRange {
  from: number;
  to: number;
}

interface ParsedColorMarkup {
  text: string;
  spans: ParsedColorSpan[];
  removed: RemovedRange[];
}

interface SpanStackEntry {
  color?: TextColorId;
  from?: number;
  order?: number;
  removed: boolean;
}

const SPAN_TAG_PATTERN = /<\/?span\b[^>]*>/gi;
const COLOR_ATTRIBUTE_PATTERN =
  /\bdata-mve-text-color\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i;

/**
 * 選択範囲へ固定パレットの文字色を適用する。undefined は文字色だけを解除する。
 * 既存のMVE文字色spanは一度論理色区間へ正規化してから再出力するため、色spanをネストしない。
 * 複数行はMarkdownのブロック構造を壊さないよう行ごとのインライン範囲へ分割する。
 */
export function applyTextColorFormatting(
  source: string,
  selection: TextColorSelection,
  color: TextColorId | undefined,
): TextColorEdit {
  const parsed = parseColorMarkup(source);
  const cleanSelection = normalizeSelection(
    {
      from: rawOffsetToClean(selection.from, parsed.removed, source.length),
      to: rawOffsetToClean(selection.to, parsed.removed, source.length),
    },
    parsed.text.length,
  );

  let spans = normalizeParsedSpans(parsed.spans, parsed.text.length);
  if (cleanSelection.from !== cleanSelection.to) {
    for (const range of collectColorableRanges(parsed.text, cleanSelection)) {
      spans = paintColor(spans, range.from, range.to, color);
    }
  }

  spans = normalizeSpansToColorableRanges(parsed.text, spans);
  return serializeColorMarkup(parsed.text, spans, cleanSelection);
}

/** 選択範囲が単一色・混在・既定色のどれかを返す。 */
export function detectTextColorFormatting(
  source: string,
  selection: TextColorSelection,
): TextColorSelectionState {
  const parsed = parseColorMarkup(source);
  const cleanSelection = normalizeSelection(
    {
      from: rawOffsetToClean(selection.from, parsed.removed, source.length),
      to: rawOffsetToClean(selection.to, parsed.removed, source.length),
    },
    parsed.text.length,
  );
  if (cleanSelection.from === cleanSelection.to) return undefined;

  const spans = normalizeSpansToColorableRanges(
    parsed.text,
    normalizeParsedSpans(parsed.spans, parsed.text.length),
  );
  const states = new Set<TextColorId | "default">();
  for (const range of collectColorableRanges(parsed.text, cleanSelection)) {
    collectRangeColorStates(range, spans, states);
    if (states.size > 1) return "mixed";
  }
  const only = states.values().next().value as
    | TextColorId
    | "default"
    | undefined;
  return only === "default" ? undefined : only;
}

/** MVE文字色spanの開始タグを返す。HTML/PDF出力でも同じ固定色が使われる。 */
export function textColorOpenTag(color: TextColorId): string {
  return `<span data-mve-text-color="${color}" style="color:${TEXT_COLOR_HEX[color]}">`;
}

function parseColorMarkup(source: string): ParsedColorMarkup {
  const parts: string[] = [];
  const spans: ParsedColorSpan[] = [];
  const removed: RemovedRange[] = [];
  const stack: SpanStackEntry[] = [];
  let rawCursor = 0;
  let cleanLength = 0;
  let order = 0;

  const append = (value: string) => {
    if (!value) return;
    parts.push(value);
    cleanLength += value.length;
  };

  SPAN_TAG_PATTERN.lastIndex = 0;
  for (
    let match = SPAN_TAG_PATTERN.exec(source);
    match;
    match = SPAN_TAG_PATTERN.exec(source)
  ) {
    const tag = match[0];
    const tagFrom = match.index;
    const tagTo = tagFrom + tag.length;
    append(source.slice(rawCursor, tagFrom));

    if (/^<\/span\b/i.test(tag)) {
      const entry = stack.pop();
      if (entry?.removed) {
        removed.push({ from: tagFrom, to: tagTo });
        if (entry.color && entry.from !== undefined) {
          spans.push({
            from: entry.from,
            to: cleanLength,
            color: entry.color,
            order: entry.order ?? order++,
          });
        }
      } else {
        append(tag);
      }
    } else {
      const color = readTextColorId(tag);
      const selfClosing = /\/\s*>$/.test(tag);
      if (color) {
        removed.push({ from: tagFrom, to: tagTo });
        if (!selfClosing) {
          stack.push({
            color,
            from: cleanLength,
            order: order++,
            removed: true,
          });
        }
      } else {
        append(tag);
        if (!selfClosing) stack.push({ removed: false });
      }
    }
    rawCursor = tagTo;
  }
  append(source.slice(rawCursor));

  for (const entry of stack) {
    if (entry.removed && entry.color && entry.from !== undefined) {
      spans.push({
        from: entry.from,
        to: cleanLength,
        color: entry.color,
        order: entry.order ?? order++,
      });
    }
  }

  return {
    text: parts.join(""),
    spans,
    removed: removed.sort((left, right) => left.from - right.from),
  };
}

function readTextColorId(tag: string): TextColorId | undefined {
  const match = COLOR_ATTRIBUTE_PATTERN.exec(tag);
  const value = (
    match?.[1] ??
    match?.[2] ??
    match?.[3] ??
    ""
  ).toLowerCase();
  return isTextColorId(value) ? value : undefined;
}

function isTextColorId(value: string): value is TextColorId {
  return Object.prototype.hasOwnProperty.call(TEXT_COLOR_HEX, value);
}

function rawOffsetToClean(
  rawOffset: number,
  removed: readonly RemovedRange[],
  sourceLength: number,
): number {
  const safeOffset = Math.max(0, Math.min(sourceLength, rawOffset));
  let removedLength = 0;
  for (const range of removed) {
    if (safeOffset >= range.to) {
      removedLength += range.to - range.from;
      continue;
    }
    if (safeOffset > range.from) return range.from - removedLength;
    break;
  }
  return safeOffset - removedLength;
}

function normalizeSelection(
  selection: TextColorSelection,
  length: number,
): TextColorSelection {
  const from = Math.max(
    0,
    Math.min(length, Math.min(selection.from, selection.to)),
  );
  const to = Math.max(
    0,
    Math.min(length, Math.max(selection.from, selection.to)),
  );
  return { from, to };
}

function normalizeParsedSpans(
  parsed: readonly ParsedColorSpan[],
  length: number,
): ColorSpan[] {
  let spans: ColorSpan[] = [];
  for (const item of [...parsed].sort((left, right) => left.order - right.order)) {
    const from = Math.max(0, Math.min(length, item.from));
    const to = Math.max(from, Math.min(length, item.to));
    spans = paintColor(spans, from, to, item.color);
  }
  return spans;
}

function paintColor(
  spans: readonly ColorSpan[],
  from: number,
  to: number,
  color: TextColorId | undefined,
): ColorSpan[] {
  if (to <= from) return spans.slice();
  const next: ColorSpan[] = [];
  for (const span of spans) {
    if (span.to <= from || span.from >= to) {
      next.push(span);
      continue;
    }
    if (span.from < from) next.push({ ...span, to: from });
    if (span.to > to) next.push({ ...span, from: to });
  }
  if (color) next.push({ from, to, color });
  return mergeColorSpans(next);
}

function mergeColorSpans(spans: readonly ColorSpan[]): ColorSpan[] {
  const sorted = spans
    .filter((span) => span.to > span.from)
    .slice()
    .sort((left, right) => left.from - right.from || left.to - right.to);
  const merged: ColorSpan[] = [];
  for (const span of sorted) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.color === span.color &&
      previous.to >= span.from
    ) {
      previous.to = Math.max(previous.to, span.to);
      continue;
    }
    merged.push({ ...span });
  }
  return merged;
}

function normalizeSpansToColorableRanges(
  source: string,
  spans: readonly ColorSpan[],
): ColorSpan[] {
  const safe: ColorSpan[] = [];
  for (const span of spans) {
    for (const range of collectColorableRanges(source, span)) {
      safe.push({ ...range, color: span.color });
    }
  }
  return mergeColorSpans(safe);
}

function collectColorableRanges(
  source: string,
  selection: TextColorSelection,
): TextColorSelection[] {
  const normalized = normalizeSelection(selection, source.length);
  if (normalized.from === normalized.to) return [];
  const frontMatterEnd = findFrontMatterEnd(source);
  const ranges: TextColorSelection[] = [];
  let lineStart = 0;
  let inFence = false;
  let fenceCharacter = "";
  let fenceLength = 0;

  while (lineStart <= source.length) {
    const newline = source.indexOf("\n", lineStart);
    const lineEnd = newline < 0 ? source.length : newline;
    const line = source.slice(lineStart, lineEnd);
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const marker = fence[1];
      const character = marker[0];
      if (!inFence) {
        inFence = true;
        fenceCharacter = character;
        fenceLength = marker.length;
      } else if (
        character === fenceCharacter &&
        marker.length >= fenceLength &&
        new RegExp(
          `^ {0,3}${escapeRegExp(character)}{${fenceLength},}\\s*$`,
        ).test(line)
      ) {
        inFence = false;
        fenceCharacter = "";
        fenceLength = 0;
      }
      if (newline < 0) break;
      lineStart = lineEnd + 1;
      continue;
    }

    const selectionFrom = Math.max(normalized.from, lineStart);
    const selectionTo = Math.min(normalized.to, lineEnd);
    const insideFrontMatter = frontMatterEnd > 0 && lineStart < frontMatterEnd;
    if (
      selectionTo > selectionFrom &&
      !inFence &&
      !insideFrontMatter &&
      !isUncolorableWholeLine(line)
    ) {
      const localFrom = selectionFrom - lineStart;
      const localTo = selectionTo - lineStart;
      const protectedRanges = collectProtectedLineRanges(line);
      for (const localRange of subtractRanges(
        { from: localFrom, to: localTo },
        protectedRanges,
      )) {
        const trimmed = trimWhitespaceRange(line, localRange);
        if (trimmed.to > trimmed.from) {
          ranges.push({
            from: lineStart + trimmed.from,
            to: lineStart + trimmed.to,
          });
        }
      }
    }

    if (newline < 0) break;
    lineStart = lineEnd + 1;
  }
  return ranges;
}

function findFrontMatterEnd(source: string): number {
  if (!source.startsWith("---\n")) return 0;
  let lineStart = 4;
  while (lineStart <= source.length) {
    const newline = source.indexOf("\n", lineStart);
    const lineEnd = newline < 0 ? source.length : newline;
    const line = source.slice(lineStart, lineEnd).trim();
    if (line === "---" || line === "...") {
      return newline < 0 ? source.length : lineEnd + 1;
    }
    if (newline < 0) return source.length;
    lineStart = lineEnd + 1;
  }
  return source.length;
}

function isUncolorableWholeLine(line: string): boolean {
  if (!line.trim()) return true;
  if (/^(?: {4}|\t)\S/.test(line)) return true;
  if (
    /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})\s*$/.test(
      line,
    )
  ) {
    return true;
  }
  if (
    /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(
      line,
    )
  ) {
    return true;
  }
  return false;
}

function collectProtectedLineRanges(line: string): TextColorSelection[] {
  const ranges: TextColorSelection[] = [];
  const prefixEnd = blockPrefixEnd(line);
  if (prefixEnd > 0) ranges.push({ from: 0, to: prefixEnd });

  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "|" && !isEscaped(line, index)) {
      ranges.push({ from: index, to: index + 1 });
    }
  }

  for (const range of matchRanges(line, /<[^>\n]+>/g)) ranges.push(range);
  for (const range of matchRanges(line, /\]\([^\n)]*\)/g)) {
    ranges.push({ from: range.from + 1, to: range.to });
  }
  for (const range of matchRanges(line, /!\[[^\]\n]*\]\([^\n)]*\)/g)) {
    ranges.push(range);
  }
  ranges.push(...inlineCodeRanges(line));

  if (/ {2,}$/.test(line)) {
    ranges.push({ from: Math.max(0, line.length - 2), to: line.length });
  }
  if (/\\$/.test(line) && !isEscaped(line, line.length - 1)) {
    ranges.push({ from: line.length - 1, to: line.length });
  }
  return mergePlainRanges(ranges);
}

function blockPrefixEnd(line: string): number {
  let position = line.match(/^[ \t]*/)?.[0].length ?? 0;
  let guard = 0;
  while (guard++ < 16) {
    const rest = line.slice(position);
    const quote = /^>\s?/.exec(rest);
    if (!quote) break;
    position += quote[0].length;
    position += line.slice(position).match(/^[ \t]*/)?.[0].length ?? 0;
  }

  const heading = /^#{1,6}(?:[ \t]+|$)/.exec(line.slice(position));
  if (heading) position += heading[0].length;

  const list = /^(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/.exec(
    line.slice(position),
  );
  if (list) position += list[0].length;
  return position;
}

function inlineCodeRanges(line: string): TextColorSelection[] {
  const ranges: TextColorSelection[] = [];
  let index = 0;
  while (index < line.length) {
    if (line[index] !== "`") {
      index += 1;
      continue;
    }
    let runLength = 1;
    while (line[index + runLength] === "`") runLength += 1;
    const marker = "`".repeat(runLength);
    const close = line.indexOf(marker, index + runLength);
    if (close < 0) {
      index += runLength;
      continue;
    }
    ranges.push({ from: index, to: close + runLength });
    index = close + runLength;
  }
  return ranges;
}

function matchRanges(
  line: string,
  pattern: RegExp,
): TextColorSelection[] {
  pattern.lastIndex = 0;
  const ranges: TextColorSelection[] = [];
  for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
    ranges.push({ from: match.index, to: match.index + match[0].length });
    if (!match[0].length) pattern.lastIndex += 1;
  }
  return ranges;
}

function isEscaped(value: string, index: number): boolean {
  let slashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && value[cursor] === "\\";
    cursor -= 1
  ) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function subtractRanges(
  range: TextColorSelection,
  protectedRanges: readonly TextColorSelection[],
): TextColorSelection[] {
  let remaining = [range];
  for (const protectedRange of protectedRanges) {
    const next: TextColorSelection[] = [];
    for (const candidate of remaining) {
      if (
        protectedRange.to <= candidate.from ||
        protectedRange.from >= candidate.to
      ) {
        next.push(candidate);
        continue;
      }
      if (candidate.from < protectedRange.from) {
        next.push({ from: candidate.from, to: protectedRange.from });
      }
      if (candidate.to > protectedRange.to) {
        next.push({ from: protectedRange.to, to: candidate.to });
      }
    }
    remaining = next;
    if (!remaining.length) break;
  }
  return remaining;
}

function mergePlainRanges(
  ranges: readonly TextColorSelection[],
): TextColorSelection[] {
  const sorted = ranges
    .filter((range) => range.to > range.from)
    .slice()
    .sort((left, right) => left.from - right.from || left.to - right.to);
  const merged: TextColorSelection[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && previous.to >= range.from) {
      previous.to = Math.max(previous.to, range.to);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function trimWhitespaceRange(
  line: string,
  range: TextColorSelection,
): TextColorSelection {
  let from = range.from;
  let to = range.to;
  while (from < to && /\s/.test(line[from])) from += 1;
  while (to > from && /\s/.test(line[to - 1])) to -= 1;
  return { from, to };
}

function collectRangeColorStates(
  range: TextColorSelection,
  spans: readonly ColorSpan[],
  states: Set<TextColorId | "default">,
): void {
  let cursor = range.from;
  for (const span of spans) {
    if (span.to <= range.from) continue;
    if (span.from >= range.to) break;
    const from = Math.max(range.from, span.from);
    const to = Math.min(range.to, span.to);
    if (from > cursor) states.add("default");
    if (to > from) states.add(span.color);
    cursor = Math.max(cursor, to);
    if (states.size > 1) return;
  }
  if (cursor < range.to) states.add("default");
}

function serializeColorMarkup(
  source: string,
  spans: readonly ColorSpan[],
  selection: TextColorSelection,
): TextColorEdit {
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

  const positions = new Set<number>([
    0,
    source.length,
    selection.from,
    selection.to,
    ...opens.keys(),
    ...closes.keys(),
  ]);
  const sorted = [...positions]
    .filter((position) => position >= 0 && position <= source.length)
    .sort((left, right) => left - right);

  const parts: string[] = [];
  let outputLength = 0;
  let cursor = 0;
  let mappedFrom = 0;
  let mappedTo = 0;
  const append = (value: string) => {
    if (!value) return;
    parts.push(value);
    outputLength += value.length;
  };

  for (const position of sorted) {
    if (position < cursor) continue;
    append(source.slice(cursor, position));
    if (position === selection.to) mappedTo = outputLength;
    for (const close of closes.get(position) ?? []) append(close);
    for (const open of opens.get(position) ?? []) append(open);
    if (position === selection.from) mappedFrom = outputLength;
    cursor = position;
  }
  append(source.slice(cursor));

  return {
    text: parts.join(""),
    selection: { from: mappedFrom, to: mappedTo },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

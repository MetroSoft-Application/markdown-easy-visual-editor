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

interface ParsedSpan extends ColorSpan {
  order: number;
}

interface Layer {
  from: number;
  to: number;
  color?: TextColorId;
  order: number;
}

interface ActiveLayer {
  id: number;
  layer: Layer;
}

interface ParsedMarkup {
  text: string;
  spans: ParsedSpan[];
  removed: TextColorSelection[];
}

interface StackEntry {
  color?: TextColorId;
  from?: number;
  order?: number;
  removed: boolean;
}

const COLOR_ATTRIBUTE_PATTERN =
  /\bdata-mve-text-color\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i;
const TICK = String.fromCharCode(96);

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

export function textColorOpenTag(color: TextColorId): string {
  return '<span data-mve-text-color="' + color + '" style="color:' + TEXT_COLOR_HEX[color] + '">';
}

export function stripMveTextColorMarkup(value: string): string {
  const parts: string[] = [];
  const stack: Array<{ removed: boolean }> = [];
  const preserved = collectPreservedMarkupRanges(value);
  let preservedIndex = 0;
  let cursor = 0;
  const isPreserved = (from: number, to: number) => {
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
  const append = (value: string) => {
    if (!value) return;
    parts.push(value);
    cleanLength += value.length;
  };
  const isPreserved = (from: number, to: number) => {
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

function readTextColorId(tag: string): TextColorId | undefined {
  const match = COLOR_ATTRIBUTE_PATTERN.exec(tag);
  const value = (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(TEXT_COLOR_HEX, value)
    ? value as TextColorId
    : undefined;
}

function* scanSpanTags(value: string): Generator<{ tag: string; from: number; to: number }> {
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

function isWordCharacter(value: string | undefined): boolean {
  return Boolean(value && /[A-Za-z0-9_]/.test(value));
}

function mapSelection(
  selection: TextColorSelection,
  removed: readonly TextColorSelection[],
  sourceLength: number,
  cleanLength: number,
): TextColorSelection {
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

function normalizeSpans(parsed: readonly ParsedSpan[], length: number): ColorSpan[] {
  return resolveLayers(parsed
    .map((span) => ({
      from: Math.max(0, Math.min(length, span.from)),
      to: Math.max(0, Math.min(length, span.to)),
      color: span.color,
      order: span.order,
    }))
    .filter((span) => span.to > span.from));
}

function paintRangesOnSpans(
  spans: readonly ColorSpan[],
  ranges: readonly TextColorSelection[],
  color: TextColorId | undefined,
): ColorSpan[] {
  return resolveLayers([
    ...spans.map((span, index) => ({ ...span, order: index })),
    ...ranges.map((range, index) => ({ ...range, color, order: spans.length + index })),
  ]);
}

function resolveLayers(layers: readonly Layer[]): ColorSpan[] {
  const events: Array<{ position: number; open: boolean; active: ActiveLayer }> = [];
  for (const [id, layer] of layers.entries()) {
    if (layer.to <= layer.from) continue;
    const active = { id, layer };
    events.push({ position: layer.from, open: true, active });
    events.push({ position: layer.to, open: false, active });
  }
  events.sort((left, right) => left.position - right.position || Number(left.open) - Number(right.open));
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

function peekActiveLayer(heap: ActiveLayer[], active: ReadonlySet<number>): ActiveLayer | undefined {
  while (heap.length && !active.has(heap[0].id)) popActiveLayer(heap);
  return heap[0];
}

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

function compareActiveLayers(left: ActiveLayer, right: ActiveLayer): number {
  return left.layer.order - right.layer.order || left.id - right.id;
}

function mergeColorSpans(spans: readonly ColorSpan[]): ColorSpan[] {
  const sorted = spans.slice().filter((span) => span.to > span.from)
    .sort((left, right) => left.from - right.from || left.to - right.to);
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

function collectColorableRanges(source: string): TextColorSelection[] {
  const frontMatterEnd = findFrontMatterEnd(source);
  const inlineProtected = collectInlineProtectedRanges(source);
  let inlineProtectedIndex = 0;
  const ranges: TextColorSelection[] = [];
  let lineStart = 0;
  let fence: { character: string; length: number } | undefined;
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

function collectPreservedMarkupRanges(source: string): TextColorSelection[] {
  const ranges: TextColorSelection[] = [...inlineCodeRanges(source)];
  const frontMatterEnd = findFrontMatterEnd(source);
  if (frontMatterEnd) ranges.push({ from: 0, to: frontMatterEnd });
  let lineStart = 0;
  let fence: { character: string; length: number } | undefined;
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

function readFence(line: string): { character: string; length: number; rest: string } | undefined {
  let start = 0;
  while (start < line.length && start < 4 && line[start] === " ") start += 1;
  const character = line[start];
  if (character !== TICK && character !== "~") return undefined;
  let end = start;
  while (line[end] === character) end += 1;
  return end - start >= 3 ? { character, length: end - start, rest: line.slice(end) } : undefined;
}

function isUncolorableWholeLine(line: string): boolean {
  if (!line.trim() || isIndentedCodeLine(line)) return true;
  if (/^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})\s*$/.test(line)) return true;
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isIndentedCodeLine(line: string): boolean {
  if (!/^(?: {4}|\t)\S/.test(line)) return false;
  return !/^[ \t]+(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/.test(line);
}

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

function collectInlineProtectedRanges(source: string): TextColorSelection[] {
  const ranges = inlineCodeRanges(source);
  addLinkSyntaxRanges(source, ranges);
  return mergeRanges(ranges);
}

function projectRangesToLine(
  ranges: readonly TextColorSelection[],
  lineStart: number,
  lineEnd: number,
  startIndex: number,
): { ranges: TextColorSelection[]; nextIndex: number } {
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

function blockQuoteContentStart(line: string): number {
  let position = 0;
  while (true) {
    const indent = /^ {0,3}/.exec(line.slice(position))?.[0].length ?? 0;
    const quote = /^>[ \t]?/.exec(line.slice(position + indent));
    if (!quote) return position;
    position += indent + quote[0].length;
  }
}

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

function matchRanges(line: string, pattern: RegExp): TextColorSelection[] {
  pattern.lastIndex = 0;
  const ranges: TextColorSelection[] = [];
  for (let match = pattern.exec(line); match; match = pattern.exec(line)) ranges.push({ from: match.index, to: match.index + match[0].length });
  return ranges;
}

function isEscaped(value: string, index: number): boolean {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) count += 1;
  return count % 2 === 1;
}

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

function mergeRanges(ranges: readonly TextColorSelection[]): TextColorSelection[] {
  const sorted = ranges.slice().filter((range) => range.to > range.from)
    .sort((left, right) => left.from - right.from || left.to - right.to);
  const result: TextColorSelection[] = [];
  for (const range of sorted) {
    const previous = result.at(-1);
    if (previous && previous.to >= range.from) previous.to = Math.max(previous.to, range.to);
    else result.push({ ...range });
  }
  return result;
}

function trimWhitespace(line: string, range: TextColorSelection): TextColorSelection {
  let { from, to } = range;
  while (from < to && /\s/.test(line[from])) from += 1;
  while (to > from && /\s/.test(line[to - 1])) to -= 1;
  return { from, to };
}

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
    .filter((position) => position >= 0 && position <= source.length)
    .sort((left, right) => left - right);
  const parts: string[] = [];
  let outputLength = 0;
  let cursor = 0;
  let mappedFrom = 0;
  let mappedTo = 0;
  const append = (value: string) => {
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

/**
 * プレビュー上の画像インデックスに対応するMarkdown画像参照です。
 * @param kind Markdown記法またはHTMLタグです。
 * @param start 参照の開始オフセットです。
 * @param end 参照の終了オフセットです。
 * @param alt 画像の代替テキストです。
 * @param source 画像の参照先です。
 * @param title 画像タイトルです。
 */
interface ImageReference {
  kind: 'markdown' | 'html';
  start: number;
  end: number;
  alt: string;
  source: string;
  title?: string;
}

export type ImageAlignment = 'left' | 'center' | 'right';

const MIN_IMAGE_WIDTH = 48;

/**
 * プレビュー上の画像を指定幅へ変更し、必要ならMarkdown記法をHTMLへ変換します。
 * @param markdown 変更前のMarkdown本文です。
 * @param imageIndex レンダリング順の画像インデックスです。
 * @param width 新しい表示幅です。
 * @returns 画像幅を変更したMarkdown本文です。対象が見つからない場合は元の本文です。
 */
export function resizeImageInMarkdown(markdown: string, imageIndex: number, width: number): string {
  const image = scanImageReferences(markdown)[imageIndex];
  if (!image) return markdown;

  const normalizedWidth = normalizeWidth(width);
  const replacement = image.kind === 'markdown'
    ? buildMarkdownReplacement(image, normalizedWidth)
    : buildHtmlReplacement(markdown.slice(image.start, image.end), normalizedWidth);

  return markdown.slice(0, image.start) + replacement + markdown.slice(image.end);
}

/**
 * プレビュー上の画像の揃え位置をMarkdown本文へ反映します。
 * @param markdown 変更前のMarkdown本文です。
 * @param imageIndex レンダリング順の画像インデックスです。
 * @param alignment 新しい揃え位置です。
 * @returns 揃え位置を変更したMarkdown本文です。対象が見つからない場合は元の本文です。
 */
export function alignImageInMarkdown(markdown: string, imageIndex: number, alignment: ImageAlignment): string {
  const image = scanImageReferences(markdown)[imageIndex];
  if (!image) return markdown;

  const normalizedAlignment = normalizeAlignment(alignment);
  const replacement = image.kind === 'markdown'
    ? buildMarkdownAlignmentReplacement(image, normalizedAlignment)
    : upsertHtmlAttribute(markdown.slice(image.start, image.end), 'align', normalizedAlignment);

  return markdown.slice(0, image.start) + replacement + markdown.slice(image.end);
}

/**
 * HTML画像の幅指定を除去して自然サイズへ戻します。
 * @param markdown 変更前のMarkdown本文です。
 * @param imageIndex レンダリング順の画像インデックスです。
 * @returns width指定を除去したMarkdown本文です。
 */
export function resetImageSizeInMarkdown(markdown: string, imageIndex: number): string {
  const image = scanImageReferences(markdown)[imageIndex];
  if (!image || image.kind !== 'html') return markdown;

  const original = markdown.slice(image.start, image.end);
  if (!hasHtmlAttribute(original, 'width')) return markdown;
  const replacement = removeHtmlAttribute(removeHtmlAttribute(original, 'height'), 'width');
  return markdown.slice(0, image.start) + replacement + markdown.slice(image.end);
}

/**
 * 幅を安全な整数へ正規化します。
 * @param width 入力された幅です。
 * @returns 48px以上の整数幅です。
 */
function normalizeWidth(width: number): number {
  return Math.max(MIN_IMAGE_WIDTH, Math.round(Number.isFinite(width) ? width : MIN_IMAGE_WIDTH));
}

function normalizeAlignment(alignment: ImageAlignment): ImageAlignment {
  return alignment === 'center' || alignment === 'right' ? alignment : 'left';
}

/**
 * Markdown本文から、表示順に画像参照を抽出します。
 * @param markdown 対象のMarkdown本文です。
 * @returns ソース順の画像参照一覧です。
 */
function scanImageReferences(markdown: string): ImageReference[] {
  const masked = maskCode(markdown);
  const definitions = collectReferenceDefinitions(markdown, masked);
  const references: ImageReference[] = [];

  for (const match of masked.matchAll(/<img\b[^>]*>/gi)) {
    const tag = markdown.slice(match.index, match.index + match[0].length);
    const source = readHtmlAttribute(tag, 'src');
    if (!source) continue;
    references.push({
      kind: 'html',
      start: match.index,
      end: match.index + match[0].length,
      source,
      alt: readHtmlAttribute(tag, 'alt') ?? ''
    });
  }

  let index = 0;
  while (index < masked.length) {
    const marker = masked.indexOf('![', index);
    if (marker < 0) break;
    index = marker + 2;

    if (marker > 0 && markdown[marker - 1] === '\\') continue;
    const closingBracket = findClosing(markdown, marker + 2, ']');
    if (closingBracket < 0) continue;

    const alt = markdown.slice(marker + 2, closingBracket);
    if (markdown[closingBracket + 1] === '(') {
      const closingParenthesis = findClosingParenthesis(markdown, closingBracket + 2);
      if (closingParenthesis < 0) continue;
      const target = parseMarkdownTarget(markdown.slice(closingBracket + 2, closingParenthesis));
      if (target.source) {
        references.push({
          kind: 'markdown',
          start: marker,
          end: closingParenthesis + 1,
          alt,
          source: target.source,
          title: target.title
        });
      }
      index = closingParenthesis + 1;
      continue;
    }

    if (markdown[closingBracket + 1] !== '[') continue;
    const referenceClosingBracket = findClosing(markdown, closingBracket + 2, ']');
    if (referenceClosingBracket < 0) continue;
    const label = normalizeReferenceLabel(markdown.slice(closingBracket + 2, referenceClosingBracket) || alt);
    const definition = definitions.get(label);
    if (definition) {
      references.push({
        kind: 'markdown',
        start: marker,
        end: referenceClosingBracket + 1,
        alt,
        source: definition.source,
        title: definition.title
      });
    }
    index = referenceClosingBracket + 1;
  }

  return references.sort((left, right) => left.start - right.start);
}

/**
 * コードフェンスとインラインコードを空白化し、画像探索対象から除外します。
 * @param source Markdown本文です。
 * @returns オフセットを保ったマスク済み本文です。
 */
function maskCode(source: string): string {
  const chars = source.split('');
  const lines = source.split(/(\r?\n)/);
  let offset = 0;
  let fence: string | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (marker) {
      if (!fence) fence = marker[1][0];
      else if (marker[1][0] === fence) fence = undefined;
      for (let charIndex = 0; charIndex < line.length; charIndex += 1) chars[offset + charIndex] = ' ';
    } else if (fence) {
      for (let charIndex = 0; charIndex < line.length; charIndex += 1) chars[offset + charIndex] = ' ';
    }
    offset += line.length;
  }

  let inlineCode = false;
  for (let index = 0; index < chars.length; index += 1) {
    if (chars[index] === '\\') {
      index += 1;
      continue;
    }
    if (chars[index] === '`') inlineCode = !inlineCode;
    else if (inlineCode) chars[index] = ' ';
  }

  return chars.join('');
}

/**
 * 参照形式画像の定義を収集します。
 * @param source 元のMarkdown本文です。
 * @param masked コードをマスクしたMarkdown本文です。
 * @returns 正規化ラベルから画像定義へのマップです。
 */
function collectReferenceDefinitions(source: string, masked: string): Map<string, { source: string; title?: string }> {
  const definitions = new Map<string, { source: string; title?: string }>();
  const lines = masked.split(/(\r?\n)/);
  let offset = 0;

  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index] ?? '';
    const original = source.slice(offset, offset + line.length);
    offset += line.length + (lines[index + 1]?.length ?? 0);
    const match = /^\s{0,3}\[([^\]]+)\]:\s*(.+)$/.exec(line);
    const originalMatch = /^\s{0,3}\[([^\]]+)\]:\s*(.+)$/.exec(original);
    if (!match || !originalMatch) continue;
    const target = parseMarkdownTarget(originalMatch[2]);
    if (target.source) definitions.set(normalizeReferenceLabel(originalMatch[1]), target);
  }

  return definitions;
}

/**
 * 参照形式ラベルを比較用に正規化します。
 * @param label 元の参照ラベルです。
 * @returns 空白を統一し、小文字化したラベルです。
 */
function normalizeReferenceLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Markdown画像記法のリンク先とタイトルを解析します。
 * @param target 記法の括弧内文字列です。
 * @returns 解析したリンク先とタイトルです。
 */
function parseMarkdownTarget(target: string): { source: string; title?: string } {
  const trimmed = target.trim();
  if (!trimmed) return { source: '' };
  if (trimmed.startsWith('<')) {
    const end = trimmed.indexOf('>');
    if (end > 0) return { source: trimmed.slice(1, end), title: parseTitle(trimmed.slice(end + 1).trim()) };
  }
  const match = /^(\S+?)(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?$/.exec(trimmed);
  return { source: match?.[1] ?? trimmed, title: match?.[2] ?? match?.[3] ?? match?.[4] };
}

/**
 * 画像タイトルを解析します。
 * @param value タイトル候補です。
 * @returns タイトルまたはundefinedです。
 */
function parseTitle(value: string): string | undefined {
  const match = /^(?:"([^"]*)"|'([^']*)'|\(([^)]*)\))$/.exec(value);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

/**
 * 括弧の終端を検索します。
 * @param source 対象文字列です。
 * @param start 検索開始位置です。
 * @param closing 終端文字です。
 * @returns 終端位置、未発見なら-1です。
 */
function findClosing(source: string, start: number, closing: string): number {
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1;
      continue;
    }
    if (source[index] === closing) return index;
  }
  return -1;
}

/**
 * Markdown画像リンクの閉じ括弧を検索します。
 * @param source 対象文字列です。
 * @param start 検索開始位置です。
 * @returns 終端位置、未発見なら-1です。
 */
function findClosingParenthesis(source: string, start: number): number {
  let depth = 1;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1;
      continue;
    }
    if (source[index] === '(') depth += 1;
    if (source[index] === ')' && --depth === 0) return index;
  }
  return -1;
}

/**
 * Markdown画像記法を幅指定付きHTMLへ変換します。
 * @param image 画像参照です。
 * @param width 正規化済みの幅です。
 * @returns 置換後のHTML画像タグです。
 */
function buildMarkdownReplacement(image: ImageReference, width: number): string {
  const attributes = [
    `src="${escapeHtmlAttribute(image.source)}"`,
    `alt="${escapeHtmlAttribute(image.alt)}"`,
    `width="${width}"`
  ];
  if (image.title !== undefined) attributes.push(`title="${escapeHtmlAttribute(image.title)}"`);
  return `<img ${attributes.join(' ')}>`;
}

/**
 * Markdown画像記法を揃え位置付きHTMLへ変換します。
 * @param image 画像参照です。
 * @param alignment 正規化済みの揃え位置です。
 * @returns 置換後のHTML画像タグです。
 */
function buildMarkdownAlignmentReplacement(image: ImageReference, alignment: ImageAlignment): string {
  const attributes = [
    `src="${escapeHtmlAttribute(image.source)}"`,
    `alt="${escapeHtmlAttribute(image.alt)}"`,
    `align="${alignment}"`
  ];
  if (image.title !== undefined) attributes.push(`title="${escapeHtmlAttribute(image.title)}"`);
  return `<img ${attributes.join(' ')}>`;
}

/**
 * HTML画像タグのwidthを更新します。
 * @param tag 元のHTML画像タグです。
 * @param width 正規化済みの幅です。
 * @returns 置換後のHTML画像タグです。
 */
function buildHtmlReplacement(tag: string, width: number): string {
  return upsertHtmlAttribute(removeHtmlAttribute(tag, 'height'), 'width', String(width));
}

/**
 * HTML属性を追加または更新します。
 * @param tag HTMLタグです。
 * @param name 属性名です。
 * @param value 属性値です。
 * @returns 属性更新後のHTMLタグです。
 */
function upsertHtmlAttribute(tag: string, name: string, value: string): string {
  const pattern = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
  if (pattern.test(tag)) return tag.replace(pattern, ` ${name}="${escapeHtmlAttribute(value)}"`);
  const closing = tag.endsWith('/>') ? '/>' : '>';
  return tag.slice(0, -closing.length) + ` ${name}="${escapeHtmlAttribute(value)}"` + closing;
}

/**
 * HTML属性を削除します。
 * @param tag HTMLタグです。
 * @param name 属性名です。
 * @returns 属性削除後のHTMLタグです。
 */
function removeHtmlAttribute(tag: string, name: string): string {
  const pattern = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'gi');
  return tag.replace(pattern, '');
}

/**
 * HTML属性の存在を確認します。
 * @param tag HTMLタグです。
 * @param name 属性名です。
 * @returns 属性があればtrueです。
 */
function hasHtmlAttribute(tag: string, name: string): boolean {
  return new RegExp(`\\s${escapeRegExp(name)}\\s*=`, 'i').test(tag);
}

/**
 * HTML属性値を読み取ります。
 * @param tag HTMLタグです。
 * @param name 属性名です。
 * @returns 属性値またはundefinedです。
 */
function readHtmlAttribute(tag: string, name: string): string | undefined {
  const pattern = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = pattern.exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

/**
 * HTML属性値をエスケープします。
 * @param value 属性値です。
 * @returns エスケープ済み属性値です。
 */
function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 正規表現に使う文字をエスケープします。
 * @param value 文字列です。
 * @returns エスケープ済み文字列です。
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

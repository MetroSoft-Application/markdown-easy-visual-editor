/**
 * @fileoverview プレビュー倍率を除いた論理幅を計算し、画像の表示幅とMarkdownへ保存する幅を分離する。
 */
/**
 * imageresizeで共有するデータ形状を表すインターフェース。
 */
interface ImageReference {

    /**
     * メッセージ、項目、または処理の種類を識別する値。
     */
    kind: 'markdown' | 'html';

    /**
     * imageresizeのstartを表す数値。
     */
    start: number;

    /**
     * imageresizeのendを表す数値。
     */
    end: number;

    /**
     * imageresizeで扱うaltの文字列。
     */
    alt: string;

    /**
     * 解析・描画・変換の起点となる本文。
     */
    source: string;

    /**
     * 画面や出力に表示するタイトル。
     */
    title?: string;
}

/**
 * imageresizeで扱う値の種類と境界を表す型。
 */
export type ImageAlignment = 'left' | 'center' | 'right';


/**
 * 画像保存幅の下限。
 */
const MIN_IMAGE_WIDTH = 48;

/**
 * imageresizeのresize・image・in・markdownを処理し、呼び出し側へ結果または副作用を返す。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param imageIndex - imageresizeの位置・寸法・件数・時間を表す数値。
 * @param width - 表示領域または列の幅。
 * @returns imageresizeで利用する文字列。
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
 * imageresizeのalign・image・in・markdownを処理し、呼び出し側へ結果または副作用を返す。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param imageIndex - imageresizeの位置・寸法・件数・時間を表す数値。
 * @param alignment - imageresizeへ渡す入力。
 * @returns imageresizeで利用する文字列。
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
 * imageresizeの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param imageIndex - imageresizeの位置・寸法・件数・時間を表す数値。
 * @returns imageresizeで利用する文字列。
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
 * imageresizeの入力を許可された形式へ整える。
 * @param width - 表示領域または列の幅。
 * @returns imageresizeで利用する数値。
 */
function normalizeWidth(width: number): number {
    return Math.max(MIN_IMAGE_WIDTH, Math.round(Number.isFinite(width) ? width : MIN_IMAGE_WIDTH));
}

/**
 * imageresizeの入力を許可された形式へ整える。
 * @param alignment - imageresizeでalignmentとして扱う入力。
 * @returns imageresizeで生成または変換した値。
 */
function normalizeAlignment(alignment: ImageAlignment): ImageAlignment {
    return alignment === 'center' || alignment === 'right' ? alignment : 'left';
}

/**
 * imageresizeの入力を走査し、該当する範囲または要素を順に返す。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @returns imageresizeに対応する要素の一覧。
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

    return references.sort(
        /**
         * 2つの値を比較して並び順を決める。
         * @param left - 比較対象の左側の値。
         * @param right - 比較対象の右側の値。
         * @returns 2つの要素の順序を示す数値。
         */
        (left, right) => left.start - right.start);
}

/**
 * imageresizeのmask・codeを処理し、呼び出し側へ結果または副作用を返す。
 * @param source - 解析・描画・変換の起点となる本文。
 * @returns imageresizeで利用する文字列。
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
 * imageresizeから必要な値またはリソースを取得する。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param masked - imageresizeで受け渡す文字列。
 * @returns imageresizeで利用する文字列。
 */
function collectReferenceDefinitions(source: string, masked: string): Map<string, {
    /**
     * 解析・描画・変換の起点となる本文。
     */
    source: string;
    /**
     * 画面や出力に表示するタイトル。
     */
    title?: string
}> {
    const definitions = new Map<string, {
        /**
         * 解析・描画・変換の起点となる本文。
         */
        source: string;
        /**
         * 画面や出力に表示するタイトル。
         */
        title?: string
    }>();
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
 * imageresizeの入力を許可された形式へ整える。
 * @param label - 画面または検証結果に表示する説明文。
 * @returns imageresizeで利用する文字列。
 */
function normalizeReferenceLabel(label: string): string {
    return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * imageresizeの入力を構造化した値へ変換する。
 * @param target - imageresizeで受け渡す文字列。
 * @returns imageresizeで生成または変換した値。
 */
function parseMarkdownTarget(target: string): {
    /**
     * 解析・描画・変換の起点となる本文。
     */
    source: string;
    /**
     * 画面や出力に表示するタイトル。
     */
    title?: string
} {
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
 * imageresizeの入力を構造化した値へ変換する。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns 副作用を完了し、値は返さない。
 */
function parseTitle(value: string): string | undefined {
    const match = /^(?:"([^"]*)"|'([^']*)'|\(([^)]*)\))$/.exec(value);
    return match?.[1] ?? match?.[2] ?? match?.[3];
}

/**
 * imageresizeから必要な値またはリソースを取得する。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param start - imageresizeで扱う数値。
 * @param closing - imageresizeで受け渡す文字列。
 * @returns imageresizeで利用する数値。
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
 * imageresizeから必要な値またはリソースを取得する。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param start - imageresizeで扱う数値。
 * @returns imageresizeで利用する数値。
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
 * imageresizeで使う値または実行環境を組み立てる。
 * @param image - imageresizeへ渡す入力。
 * @param width - 表示領域または列の幅。
 * @returns imageresizeで利用する文字列。
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
 * imageresizeで使う値または実行環境を組み立てる。
 * @param image - imageresizeへ渡す入力。
 * @param alignment - imageresizeへ渡す入力。
 * @returns imageresizeで利用する文字列。
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
 * imageresizeで使う値または実行環境を組み立てる。
 * @param tag - imageresizeで受け渡す文字列。
 * @param width - 表示領域または列の幅。
 * @returns imageresizeで利用する文字列。
 */
function buildHtmlReplacement(tag: string, width: number): string {
    return upsertHtmlAttribute(removeHtmlAttribute(tag, 'height'), 'width', String(width));
}

/**
 * imageresizeのupsert・html・attributeを処理し、呼び出し側へ結果または副作用を返す。
 * @param tag - imageresizeで受け渡す文字列。
 * @param name - imageresizeの対象や分岐を識別する値。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns imageresizeで利用する文字列。
 */
function upsertHtmlAttribute(tag: string, name: string, value: string): string {
    const pattern = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
    if (pattern.test(tag)) return tag.replace(pattern, ` ${name}="${escapeHtmlAttribute(value)}"`);
    const closing = tag.endsWith('/>') ? '/>' : '>';
    return tag.slice(0, -closing.length) + ` ${name}="${escapeHtmlAttribute(value)}"` + closing;
}

/**
 * imageresizeの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param tag - imageresizeで受け渡す文字列。
 * @param name - imageresizeの対象や分岐を識別する値。
 * @returns imageresizeで利用する文字列。
 */
function removeHtmlAttribute(tag: string, name: string): string {
    const pattern = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'gi');
    return tag.replace(pattern, '');
}

/**
 * imageresizeの条件を判定する。
 * @param tag - imageresizeで受け渡す文字列。
 * @param name - imageresizeの対象や分岐を識別する値。
 * @returns 条件が成立したかを示す真偽値。
 */
function hasHtmlAttribute(tag: string, name: string): boolean {
    return new RegExp(`\\s${escapeRegExp(name)}\\s*=`, 'i').test(tag);
}

/**
 * imageresizeから必要な値またはリソースを取得する。
 * @param tag - imageresizeで受け渡す文字列。
 * @param name - imageresizeの対象や分岐を識別する値。
 * @returns 副作用を完了し、値は返さない。
 */
function readHtmlAttribute(tag: string, name: string): string | undefined {
    const pattern = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
    const match = pattern.exec(tag);
    return match?.[1] ?? match?.[2] ?? match?.[3];
}

/**
 * imageresizeの入力を許可された形式へ整える。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns imageresizeで利用する文字列。
 */
function escapeHtmlAttribute(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * imageresizeの入力を許可された形式へ整える。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns imageresizeで利用する文字列。
 */
function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

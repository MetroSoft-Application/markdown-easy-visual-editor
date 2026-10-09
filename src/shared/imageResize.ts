/**
 * @fileoverview プレビュー倍率を除いた論理幅を計算し、画像の表示幅とMarkdownへ保存する幅を分離する。
 */
/**
 * 画像リンクの元表記と解決後の参照先を結び付けます。
 */
interface ImageReference {

    /**
     * メッセージ、項目、または処理の種類を識別する値。
     */
    kind: 'markdown' | 'html';

    /**
     * 画像参照記法の開始位置を示す本文内UTF-16オフセットです。
     */
    start: number;

    /**
     * 画像参照記法の終了位置を示す本文内UTF-16オフセットです。
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
  * Markdown本文内の指定画像へ幅を設定し、ほかの記法を保った本文を返す。
 * @param markdown - サイズ変更する画像参照を含むMarkdown本文。
 * @param imageIndex - 変更する画像参照の0始まりインデックス。
 * @param width - imgのwidth属性へ設定する幅（px）。
  * @returns 対象画像の幅だけを更新したMarkdown本文。
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
  * Markdown本文内の指定画像へ配置属性を設定し、ほかの記法を保った本文を返す。
 * @param markdown - 配置を変更する画像参照を含むMarkdown本文。
 * @param imageIndex - 変更する画像参照の0始まりインデックス。
 * @param alignment - Markdown画像に設定する配置（left、center、right）。
  * @returns 対象画像の配置だけを更新したMarkdown本文。
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
 * 指定したHTML画像のwidthとheightを取り除く。
 * @param markdown - サイズをリセットする画像参照を含むMarkdown本文。
 * @param imageIndex - リセットする画像参照の0始まりインデックス。
 * @returns 対象画像のサイズ属性を除いたMarkdown本文。対象がなければ元の本文。
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
 * 画像幅を最小値以上の整数pxへ丸める。
 * @param width - 画像へ設定するCSS幅候補（px）。

 */
function normalizeWidth(width: number): number {
    return Math.max(MIN_IMAGE_WIDTH, Math.round(Number.isFinite(width) ? width : MIN_IMAGE_WIDTH));
}

/**
 * 画像配置をleft、center、rightの有効値へ正規化する。
 * @param alignment - 画像に適用する配置値（left/center/right）。
 * @returns left、center、rightのいずれか。
 */
function normalizeAlignment(alignment: ImageAlignment): ImageAlignment {
    return alignment === 'center' || alignment === 'right' ? alignment : 'left';
}

/**
 * Markdownの画像構文とHTML img要素から参照先と本文範囲を収集する。
 * @param markdown - 画像参照を列挙するMarkdown本文。
 * @returns 参照先、画像構文の形式、本文内の範囲を持つ画像参照一覧。
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
  * コードブロックとインラインコードを空白化し、画像構文の誤検出を防ぐ走査用本文を返す。
 * @param source - コード範囲を空白化して画像参照の誤検出を防ぐMarkdown本文。
  * @returns コード範囲を空白に置き換えた本文。
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
 * コード領域を除いたMarkdownから参照画像定義を集める。
 * @param source - 参照定義の元テキストを切り出すMarkdown本文。
 * @param masked - コード記法をマスクして定義構文を走査する本文。
 * @returns 小文字化した参照ラベルから元URIと表示タイトルを引くMap。
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
 * Markdown参照ラベルの空白を統一し、小文字へ変換する。
 * @param label - Markdown参照定義との照合に使う参照ラベル。

 */
function normalizeReferenceLabel(label: string): string {
    return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Markdown画像リンクのリンク先と任意titleを解析する。
 * @param target - Markdown参照定義のリンク先と任意titleを含む文字列。
 * @returns 画像のリンク先と、指定されている場合はtitle。
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
 * Markdown画像タイトルから引用符を外した値を読み取る。
 * @param value - 引用符または括弧で囲まれたMarkdownタイトル文字列。
 * @returns タイトル本文。タイトル構文がない場合はundefined。
 */
function parseTitle(value: string): string | undefined {
    const match = /^(?:"([^"]*)"|'([^']*)'|\(([^)]*)\))$/.exec(value);
    return match?.[1] ?? match?.[2] ?? match?.[3];
}

/**
  * 入れ子や引用符を考慮して、指定位置以降で対応する閉じ括弧を探す。
 * @param source - 対応する閉じ括弧を探索するMarkdown文字列。
 * @param start - 閉じ括弧の探索を始めるUTF-16オフセット。
 * @param closing - 一致させる閉じ括弧文字。
  * @returns 対応する閉じ括弧のUTF-16位置。見つからない場合は-1。
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
  * Markdownリンク先にある入れ子の丸括弧を考慮して、閉じ括弧を探す。
 * @param source - 対応する閉じ括弧を探索するMarkdown文字列。
 * @param start - 閉じ括弧の探索を始めるUTF-16オフセット。
  * @returns 対応する閉じ丸括弧のUTF-16位置。見つからない場合は-1。
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
 * Markdown画像参照から指定幅を持つimg要素を生成する。
 * @param image - imgタグへ変換する解析済みMarkdown画像参照。
 * @param width - imgのwidth属性へ設定する画像幅（px）。

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
 * Markdown画像参照から指定配置を持つimg要素を生成する。
 * @param image - imgタグへ変換する解析済みMarkdown画像参照。
 * @param alignment - imgタグへ設定する配置値（left/center/right）。

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
 * img要素のwidth属性を指定幅へ置き換える。
 * @param tag - width属性を書き込むimg HTMLタグ全体。
 * @param width - imgのwidth属性へ設定する画像幅（px）。

 */
function buildHtmlReplacement(tag: string, width: number): string {
    return upsertHtmlAttribute(removeHtmlAttribute(tag, 'height'), 'width', String(width));
}

/**
  * imgタグ内の指定属性を追加または更新し、タグ文字列を返す。
 * @param tag - 属性を書き換えるimg HTMLタグ全体。
 * @param name - 更新するHTML属性名。
 * @param value - HTML属性へ設定する未エスケープの値。
  * @returns 属性値を更新したHTMLタグ。
 */
function upsertHtmlAttribute(tag: string, name: string, value: string): string {
    const pattern = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
    if (pattern.test(tag)) return tag.replace(pattern, ` ${name}="${escapeHtmlAttribute(value)}"`);
    const closing = tag.endsWith('/>') ? '/>' : '>';
    return tag.slice(0, -closing.length) + ` ${name}="${escapeHtmlAttribute(value)}"` + closing;
}

/**
 * imageresizeの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param tag - 属性を削除するimg HTMLタグ全体。
 * @param name - 削除するHTML属性名。

 */
function removeHtmlAttribute(tag: string, name: string): string {
    const pattern = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'gi');
    return tag.replace(pattern, '');
}

/**
 * imageresizeの条件を判定する。
 * @param tag - 属性の有無を検査するimg HTMLタグ全体。
 * @param name - 検査するHTML属性名。
 * @returns 条件が成立したかを示す真偽値。
 */
function hasHtmlAttribute(tag: string, name: string): boolean {
    return new RegExp(`\\s${escapeRegExp(name)}\\s*=`, 'i').test(tag);
}

/**
 * HTMLタグから指定属性の値を読み取る。
 * @param tag - 属性値を読み取るimg HTMLタグ全体。
 * @param name - 読み取るHTML属性名。
 * @returns 属性値。指定属性がない場合はundefined。
 */
function readHtmlAttribute(tag: string, name: string): string | undefined {
    const pattern = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
    const match = pattern.exec(tag);
    return match?.[1] ?? match?.[2] ?? match?.[3];
}

/**
 * HTML属性へ埋め込む文字列の予約文字をエスケープする。
 * @param value - HTML属性値としてエスケープする文字列。

 */
function escapeHtmlAttribute(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 正規表現のメタ文字をリテラルとして扱えるようにエスケープする。
 * @param value - 正規表現リテラルとして扱う文字列。

 */
function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @fileoverview Markdown文書の中にTextileの書き方（ブロックの接頭辞、表、リンク、画像、phraseなど）が含まれるかを原文から判定する。
 * 実行境界: Webview本体（変換タブ）・Markdown Worker・フォールバック描画の共通ロジック。DOM・KaTeX・textile-jsに依存しない。
 * 入出力: 原文の文字列を受け取り、真偽値・位置・行を返す。副作用はない（sticky正規表現の lastIndex は使うたびに設定し直す）。
 * 不変条件: 混在形式（`mixed`）の描画と変換タブは同じ判定を使う。描画コア（markdownRendererCore）から分けているのは、
 * 変換タブがこの判定のために描画コア（KaTeX・textile-jsを含む）をWebview本体のバンドルへ読み込まないようにするため。
 */
import { isTextileBlockLead, isTextileTableRow } from './markdownOutline';

/**
 * Textile表候補の直後に1列以上のMarkdown GFM区切り行があるか判定する。
 * @param source - 表候補から始まるMarkdown本文。
 * @param nextOffset - 1行目の直後にある次行の開始位置。
 * @returns Markdown表として認識される場合はtrue。
 */
export function isMarkdownPipeTable(source: string, nextOffset: number): boolean {
    const separator = readSourceLine(source, nextOffset)?.text;
    return Boolean(separator && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(separator));
}

/**
 * Markdown独自拡張と衝突しないTextile phrase modifierの候補正規表現。
 * 単語境界は候補が見つかった後にコードポイント単位で確認し、全文描画での正規表現負荷を抑える。
 */
const MIXED_TEXTILE_PHRASE_PATTERN = /(?<!\+)\+(?!\+)[^+\s\r\n](?:[^+\r\n]*[^+\s\r\n])?\+(?!\+)|(?<!-)-(?!-)[^-\s\r\n](?:[^-\r\n]*[^-\s\r\n])?-(?!-)|(?<!\?)\?\?(?!\?)[^?\s\r\n](?:[^?\r\n]*[^?\s\r\n])?\?\?(?!\?)/;

/** Textile phrase候補を現在位置で確認し、各文字位置からの再検索を避けるsticky matcher。 */
const MIXED_TEXTILE_PHRASE_AT_POSITION = new RegExp(MIXED_TEXTILE_PHRASE_PATTERN.source, 'y');
/** Textileリンク候補を現在位置で確認するsticky matcher。 */
const MIXED_TEXTILE_LINK_AT_POSITION = /"[^"\r\n]+":\S/y;
/** Textile shortcut linkをMarkdown linkと区別して確認するsticky matcher。 */
const MIXED_TEXTILE_REFERENCE_LINK_AT_POSITION = /\[[a-z][\w-]*\]https?:\/\/[^\s\]]+/iy;
/** Textile画像の後ろにリンクURLが続くNotePM形式を確認するsticky matcher。 */
const MIXED_TEXTILE_LINKED_IMAGE_AT_POSITION = /!(?!\[)[^!\s()]+(?:\([^)]*\))?!https?:\/\/[^\s]+/y;
/** Textile画像候補を現在位置で確認するsticky matcher。 */
const MIXED_TEXTILE_IMAGE_AT_POSITION = /!(?!\[)[^!\s()]+(?:\([^)]*\))?!/y;
/** Textileのclass付きphrase span候補を現在位置で確認するsticky matcher。 */
const MIXED_TEXTILE_CLASS_SPAN_AT_POSITION = /%\([a-z][\w-]*\)[^%\r\n]+%/iy;
/** Textile inline code候補を現在位置で確認するsticky matcher。 */
const MIXED_TEXTILE_CODE_AT_POSITION = /@[^@\r\n]+@/y;
/**
 * Textile固有の綴りがない文書で境界解析を省略する広い候補検査。
 * コードやHTML内の一致も許容し、正確な判定は後続の状態付き走査に任せる。
 */
const MIXED_TEXTILE_SYNTAX_HINT = /^(?: {0,3}(?:h[1-6]|p|div|bq|bc|pre|notextile)\S*\.(?:\.|[ \t]))|"(?:\([^)]+\)\.\s*)?[^"\r\n]+":\S+|\[[a-z][\w-]*\]https?:\/\/|!(?!\[)[^!\s()]+(?:\([^)]*\))?!|@[^@\r\n]+@|%\([a-z][\w-]*\)[^%\r\n]+%|(?<![\w+])\+(?!\+)[^\s+\r\n](?:[^+\r\n]*[^\s+\r\n])?\+(?![+\w])|(?<![\w>-])-(?!-)[^\s\r\n-](?:[^-\r\n]*[^-\s\r\n])?-(?![-\w>])|(?<!\w)\?\?(?!\?)[^\s?\r\n](?:[^?\r\n]*[^\s?\r\n])?\?\?(?!\?)(?!\w)/im;

/**
 * Textileブロックと記号を含む行だけ詳しく調べ、Markdownコード内の候補を除外する。
 * 混在形式（`mixed`）の描画は、この判定がfalseの文書をMarkdownだけとして描画する。変換タブも同じ判定で、
 * Markdown文書の中のTextileに見える書き方をTextileとして扱うかを決める。
 * @param source - 構文候補を調べるMarkdown本文。
 * @returns 表示可能な範囲にTextile構文候補が見つかった場合はtrue。
 */
export function hasMixedTextileSyntaxCandidate(source: string): boolean {
    if (!MIXED_TEXTILE_SYNTAX_HINT.test(source)) return source.includes('|') && hasNonMarkdownTextileTable(source);
    let fenceCharacter: string | undefined;
    let fenceLength = 0;
    let lineOffset = 0;
    // 通常文字は正規表現エンジンでまとめて飛ばし、記法候補だけ境界判定する。
    const inlineCandidates = /[\x60<"'!\[%@+\-?]/g;
    while (lineOffset < source.length) {
        const line = readSourceLine(source, lineOffset);
        if (!line) return false;
        const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line.text);
        if (fenceCharacter) {
            const isClosingFence = fence
                && fence[1][0] === fenceCharacter
                && fence[1].length >= fenceLength
                && !line.text.slice(fence[0].length).trim();
            if (isClosingFence) {
                fenceCharacter = undefined;
                fenceLength = 0;
            }
            lineOffset = line.nextOffset;
            continue;
        }
        if (fence) {
            fenceCharacter = fence[1][0];
            fenceLength = fence[1].length;
            lineOffset = line.nextOffset;
            continue;
        }
        if (isTextileBlockLead(line.text)) return true;
        if (isTextileTableRow(line.text)) {
            const separator = readSourceLine(source, line.nextOffset);
            if (separator && isMarkdownPipeTable(source, line.nextOffset)) {
                lineOffset = separator.nextOffset;
                while (lineOffset < source.length) {
                    const row = readSourceLine(source, lineOffset);
                    if (!row || !isTextileTableRow(row.text)) break;
                    lineOffset = row.nextOffset;
                }
                continue;
            }
            return true;
        }
        let cursor = lineOffset;
        while (cursor < line.nextOffset) {
            inlineCandidates.lastIndex = cursor;
            const candidate = inlineCandidates.exec(source);
            if (!candidate || candidate.index >= line.nextOffset) break;
            cursor = candidate.index;
            const character = source[cursor];
            if (character === '`') {
                cursor = skipMarkdownInlineCode(source, cursor, line.nextOffset);
                continue;
            }
            if (character === '<') {
                cursor = skipHtmlTag(source, cursor, line.nextOffset);
                continue;
            }
            const linkedImage = character === '!'
                && matchesTextileCandidateAt(MIXED_TEXTILE_LINKED_IMAGE_AT_POSITION, source, cursor);
            const matcher = character === '"' ? MIXED_TEXTILE_LINK_AT_POSITION
                : character === '[' ? MIXED_TEXTILE_REFERENCE_LINK_AT_POSITION
                    : character === '!' ? linkedImage
                        ? MIXED_TEXTILE_LINKED_IMAGE_AT_POSITION
                        : MIXED_TEXTILE_IMAGE_AT_POSITION
                        : character === '%' ? MIXED_TEXTILE_CLASS_SPAN_AT_POSITION
                        : character === '@' ? MIXED_TEXTILE_CODE_AT_POSITION
                            : character === '+' || character === '-' || character === '?'
                                ? MIXED_TEXTILE_PHRASE_AT_POSITION : undefined;
            if (!matcher) {
                cursor += 1;
                continue;
            }
            if (isMarkdownEscaped(source, cursor)) {
                cursor += 1;
                continue;
            }
            if (matcher === MIXED_TEXTILE_PHRASE_AT_POSITION) {
                if (matchesMixedTextilePhraseAt(source, cursor)) return true;
            } else if (matcher && matchesTextileCandidateAt(matcher, source, cursor)) {
                return true;
            }
            cursor += 1;
        }
        lineOffset = line.nextOffset;
    }
    return false;
}

/**
 * Textile表候補だけを検索し、GFM区切り行で確認できるMarkdown表は飛ばす。
 * @param source - 表候補を含む可能性のあるMarkdown本文。
 * @returns Markdown表以外のTextile表行が見つかった場合はtrue。
 */
function hasNonMarkdownTextileTable(source: string): boolean {
    let pipeOffset = source.indexOf('|');
    while (pipeOffset >= 0) {
        const lineStart = Math.max(
            source.lastIndexOf('\n', pipeOffset - 1),
            source.lastIndexOf('\r', pipeOffset - 1)
        ) + 1;
        const line = readSourceLine(source, lineStart);
        if (!line) return false;
        if (isTextileTableRow(line.text)) {
            const separator = readSourceLine(source, line.nextOffset);
            if (separator && isMarkdownPipeTable(source, line.nextOffset)) {
                pipeOffset = source.indexOf('|', separator.nextOffset);
                while (pipeOffset >= 0) {
                    const rowStart = Math.max(
                        source.lastIndexOf('\n', pipeOffset - 1),
                        source.lastIndexOf('\r', pipeOffset - 1)
                    ) + 1;
                    const row = readSourceLine(source, rowStart);
                    if (!row || !isTextileTableRow(row.text)) break;
                    pipeOffset = source.indexOf('|', row.nextOffset);
                }
                continue;
            }
            return true;
        }
        pipeOffset = source.indexOf('|', line.nextOffset);
    }
    return false;
}

/**
 * Textile候補matcherを現在位置から実行し、グローバル検索状態を残さない。
 * @param matcher - Textileリンク、画像、code、phraseのsticky正規表現。
 * @param source - 混在Markdown本文。
 * @param offset - 現在走査しているUTF-16位置。
 * @returns matcherが現在位置から始まる候補を認識した場合はtrue。
 */
function matchesTextileCandidateAt(matcher: RegExp, source: string, offset: number): boolean {
    matcher.lastIndex = offset;
    return matcher.exec(source)?.index === offset;
}

/**
 * Textile phrase候補を検査し、前後が単語文字なら記法として扱わない。
 * @param source - 現在の混在Markdown本文。
 * @param offset - Textile記号の候補位置。
 * @returns 完全なphrase候補が単語境界にある場合はtrue。
 */
function matchesMixedTextilePhraseAt(source: string, offset: number): boolean {
    MIXED_TEXTILE_PHRASE_AT_POSITION.lastIndex = offset;
    const match = MIXED_TEXTILE_PHRASE_AT_POSITION.exec(source);
    return match?.index === offset
        && !isUnicodeWordCharacterBefore(source, offset)
        && !isUnicodeWordCharacterAt(source, offset + match[0].length);
}

/**
 * Markedのinline start hook用に次の有効Textile phrase開始位置を探す。
 * @param source - 現在のMarked inline入力残部。
 * @returns 有効候補の位置、または候補がない場合はundefined。
 */
export function findMixedTextilePhraseCandidate(source: string): number | undefined {
    for (let offset = 0; offset < source.length; offset += 1) {
        const character = source[offset];
        if (character !== '+' && character !== '-' && character !== '?') continue;
        if (isMarkdownEscaped(source, offset)) continue;
        if (matchesMixedTextilePhraseAt(source, offset)) return offset;
    }
    return undefined;
}

/**
 * UTF-16位置にあるUnicode文字が英数字、漢字、かななどの単語文字か確認する。
 * @param source - 判定対象文字列。
 * @param offset - コードポイント開始位置。
 * @returns 文字がUnicode文字・数値・アンダースコアの場合はtrue。
 */
function isUnicodeWordCharacterAt(source: string, offset: number): boolean {
    if (offset < 0 || offset >= source.length) return false;
    const codePoint = source.codePointAt(offset);
    return codePoint !== undefined && /[\p{L}\p{N}_]/u.test(String.fromCodePoint(codePoint));
}

/**
 * UTF-16位置直前のUnicodeコードポイントが単語文字か確認する。
 * @param source - 判定対象文字列。
 * @param offset - 判定境界位置。
 * @returns 直前の文字がUnicode文字・数値・アンダースコアの場合はtrue。
 */
function isUnicodeWordCharacterBefore(source: string, offset: number): boolean {
    if (offset <= 0) return false;
    let previousIndex = offset - 1;
    const trailingUnit = source.charCodeAt(previousIndex);
    if (trailingUnit >= 0xdc00 && trailingUnit <= 0xdfff && previousIndex > 0) {
        const leadingUnit = source.charCodeAt(previousIndex - 1);
        if (leadingUnit >= 0xd800 && leadingUnit <= 0xdbff) previousIndex -= 1;
    }
    return isUnicodeWordCharacterAt(source, previousIndex);
}

/**
 * Markdownの同一行内にあるbacktick code spanを飛び越し、その内部を候補検査から除外する。
 * @param source - 混在Markdown本文。
 * @param offset - 開始backtickの位置。
 * @param lineEnd - 現在行の終端位置。
 * @returns 対応する閉じ記号の後、または開始記号の直後の位置。
 */
function skipMarkdownInlineCode(source: string, offset: number, lineEnd: number): number {
    let markerEnd = offset;
    while (markerEnd < lineEnd && source[markerEnd] === '`') markerEnd += 1;
    const markerLength = markerEnd - offset;
    let cursor = markerEnd;
    while (cursor < lineEnd) {
        const nextMarker = source.indexOf('`', cursor);
        if (nextMarker < 0 || nextMarker >= lineEnd) return markerEnd;
        let nextMarkerEnd = nextMarker;
        while (nextMarkerEnd < lineEnd && source[nextMarkerEnd] === '`') nextMarkerEnd += 1;
        if (nextMarkerEnd - nextMarker === markerLength) return nextMarkerEnd;
        cursor = nextMarkerEnd;
    }
    return markerEnd;
}

/**
 * HTML tagまたはautolinkを飛び越え、属性内のTextile記号を候補から除外する。
 * @param source - 混在Markdown本文。
 * @param offset - 開始山括弧の位置。
 * @param lineEnd - 現在行の終端位置。
 * @returns 閉じ山括弧の後、または開始山括弧の直後の位置。
 */
function skipHtmlTag(source: string, offset: number, lineEnd: number): number {
    let quote: string | undefined;
    for (let cursor = offset + 1; cursor < lineEnd; cursor += 1) {
        const character = source[cursor];
        if (quote) {
            if (character === quote) quote = undefined;
        } else if (character === '"' || character === "'") {
            quote = character;
        } else if (character === '>') {
            return cursor + 1;
        }
    }
    return offset + 1;
}

/**
 * Markdownのbackslash escapeに含まれる記号をTextile候補から除外する。
 * @param source - 混在Markdown本文。
 * @param offset - escapeされているか確認する記号位置。
 * @returns 直前の連続backslash数が奇数の場合はtrue。
 */
function isMarkdownEscaped(source: string, offset: number): boolean {
    let backslashes = 0;
    for (let cursor = offset - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) backslashes += 1;
    return backslashes % 2 === 1;
}

/**
 * Markdown本文の指定位置から改行コードを保って1行読む。
 * @param source - 原文本文。
 * @param offset - 読み始めるUTF-16オフセット。
 * @returns 行本文と次の行の開始位置。本文末尾ならundefined。
 */
export function readSourceLine(source: string, offset: number): { text: string; nextOffset: number } | undefined {
    if (offset >= source.length) return undefined;
    const match = /[^\r\n]*(?:\r\n|\r|\n|$)/.exec(source.slice(offset));
    if (!match || !match[0]) return undefined;
    const raw = match[0];
    return {
        text: raw.replace(/(?:\r\n|\r|\n)$/, ''),
        nextOffset: offset + raw.length
    };
}

/**
 * @fileoverview Markdown・Textile・混在文書の見出しアウトラインを原文から抽出し、描画済みブロックの見出しIDへ対応付ける。
 * 実行境界: Webview本体・Markdown Worker・フォールバック描画の共通ロジック。
 * KaTeX・textile-js・描画コア（markdownRendererCore の実装）に依存しないことが不変条件（型のimportだけは許す）。
 * Webview本体はWorker障害時のアウトライン計算にこのモジュールだけを読み込み、KaTeXなど重い描画ライブラリを初回起動の読み込み対象から外す。
 * markedは ../../shared/markdown 経由で読み込むため、本体バンドルに残る。抽出結果は test/outlineParity.test.ts のゴールデンで固定する。
 */
import { getOutline, nextHeadingAnchorId, type OutlineItem } from '../../shared/markdown';
import type { MarkdownRenderFormat, UnsafeMarkdownBlock } from './markdownRendererCore';

/**
 * 描画済み見出しのIDをアウトラインへ反映し、Setext見出しでもリンク先を一致させる。
 * @param outline 表示する見出し一覧。
 * @param blocks 描画後の見出しIDを含むMarkdownブロック一覧。
 * @returns 描画済みIDを反映したアウトライン。対応するブロックがない項目は除く。
 */
export function alignOutlineHeadingIds(
    outline: OutlineItem[],
    blocks: UnsafeMarkdownBlock[]
): OutlineItem[] {
    const byOffset = new Map<number, string>();
    for (const block of blocks) {
        for (const heading of block.headingIds ?? []) {
            byOffset.set(heading.offset, heading.id);
        }
        if (block.headingOffset !== undefined && block.headingId) {
            byOffset.set(block.headingOffset, block.headingId);
        }
    }
    return outline.flatMap(
        /**
         * 描画済みIDが見つかった見出しだけを残し、IDが異なる場合は描画側のIDへ置き換える。
         * @param item - 原文から抽出した見出し。
         * @returns 残す見出し（0件または1件）。
         */
        (item) => {
        const id = byOffset.get(item.offset);
        if (!id) return [];
        return [id !== item.id ? { ...item, id } : item];
    });
}

/**
 * MarkdownとTextileの見出しを描画済みブロックIDへ対応付ける。
 * @param source - 原文を変更せずに解析する文書本文。
 * @param format - Markdown専用、Textile専用、または両形式を混在させる描画形式。
 * @param blocks - 描画後の見出しIDとソース位置を含むブロック一覧。
 * @returns 文書順に並んだ見出し項目。表示できない見出しは除く。
 */
export function getOutlineForFormat(
    source: string,
    format: MarkdownRenderFormat,
    blocks: UnsafeMarkdownBlock[]
): OutlineItem[] {
    return alignOutlineHeadingIds(getSourceOutlineForFormat(source, format), blocks);
}

/**
 * 指定形式の見出しを文書順にまとめ、混在形式ではアンカーIDの重複も共有して採番する。
 * @param source - 原文を走査する文書本文。
 * @param format - Markdown専用、Textile専用、または両形式を混在させる描画形式。
 * @returns ソース順に並んだ見出し一覧。
 */
export function getSourceOutlineForFormat(
    source: string,
    format: MarkdownRenderFormat
): OutlineItem[] {
    if (format === 'textile') return getTextileOutline(source);
    const markdownItems = getOutline(source);
    if (format === 'markdown') return markdownItems;
    const textileItems = getTextileOutline(source, true);
    const counts = new Map<string, number>();
    const usedIds = new Set<string>();
    return [...markdownItems, ...textileItems]
        .sort(
            /**
             * 混在形式のMarkdown・Textile見出しを原文順へ並べる。
             * @param left - 左側の見出し候補。
             * @param right - 右側の見出し候補。
             * @returns 原文位置の昇順を示す比較値。
             */
            (left, right) => left.offset - right.offset
        )
        .map(
            /**
             * MarkdownとTextileの見出しへ文書順の重複回避IDを割り当てる。
             * @param item - MarkdownまたはTextileのアウトライン候補。
             * @returns 確定IDを割り当てたアウトライン項目。
             */
            (item) => {
                const rawLine = source.slice(item.offset).split(/\r\n|\r|\n/, 1)[0] ?? '';
                const markdownHeading = /^#{1,6}\s+(.+?)\s*$/.exec(rawLine);
                const textileHeading = /^h[1-6](?:[<>=()]*)(?:\([^)]*\))?(?:\{[^}]*\})?(?:\[[^\]]*\])?\.\s+(.+?)\s*$/i.exec(rawLine);
                const rawHeading = textileHeading
                    ? stripTextileHeadingMarkup(textileHeading[1])
                    : markdownHeading?.[1] ?? item.text;
                return {
                    ...item,
                    id: nextHeadingAnchorId(rawHeading, counts, usedIds)
                };
            }
        );
}

/**
 * Textile見出しをソース位置と一意なアンカーID付きで収集する。
 * Markdown混在時はMarkdownフェンス内を除外し、Textileコードブロック内も常に除外する。
 * @param source - 見出しを解析する文書本文。
 * @param skipMarkdownFences - 混在文書のMarkdownフェンス内容を無視する場合はtrue。
 * @returns Textile見出しのアウトライン項目。
 */
export function getTextileOutline(source: string, skipMarkdownFences = false): OutlineItem[] {
    const result: OutlineItem[] = [];
    const counts = new Map<string, number>();
    const usedIds = new Set<string>();
    let offset = 0;
    let lineNumber = 0;
    let fenceCharacter: string | undefined;
    let fenceLength = 0;
    let inTextileCode = false;
    let extendedTextileBlock = false;
    let rawPreformatted = false;
    let rawNoTextile = false;
    for (const rawLine of source.split(/(?<=\n)|(?<=\r)(?!\n)/)) {
        const line = rawLine.replace(/(?:\r\n|\r|\n)$/, '');
        const fence = /^\s{0,3}(\x60{3,}|~{3,})/.exec(line);
        if (skipMarkdownFences && fence) {
            const marker = fence[1][0];
            if (!fenceCharacter) {
                fenceCharacter = marker;
                fenceLength = fence[1].length;
            } else if (marker === fenceCharacter && fence[1].length >= fenceLength) {
                fenceCharacter = undefined;
                fenceLength = 0;
            }
            offset += rawLine.length;
            lineNumber += 1;
            continue;
        }
        if (fenceCharacter) {
            offset += rawLine.length;
            lineNumber += 1;
            continue;
        }
        if (extendedTextileBlock && isTextileBlockLead(line)) extendedTextileBlock = false;
        else if (extendedTextileBlock) {
            offset += rawLine.length;
            lineNumber += 1;
            continue;
        }
        if (rawPreformatted) {
            if (/<\/pre\s*>/i.test(line)) rawPreformatted = false;
            offset += rawLine.length;
            lineNumber += 1;
            continue;
        }
        if (rawNoTextile) {
            if (/<\/notextile\s*>/i.test(line)) rawNoTextile = false;
            offset += rawLine.length;
            lineNumber += 1;
            continue;
        }
        if (inTextileCode) {
            if (!line.trim()) inTextileCode = false;
            offset += rawLine.length;
            lineNumber += 1;
            continue;
        }
        if (/<pre\b[^>]*>/i.test(line)) {
            if (!/<\/pre\s*>/i.test(line)) rawPreformatted = true;
            offset += rawLine.length;
            lineNumber += 1;
            continue;
        }
        if (/<notextile\b[^>]*>/i.test(line)) {
            if (!/<\/notextile\s*>/i.test(line)) rawNoTextile = true;
            offset += rawLine.length;
            lineNumber += 1;
            continue;
        }
        if (isTextileExtendedBlockLead(line)) {
            extendedTextileBlock = true;
            offset += rawLine.length;
            lineNumber += 1;
            continue;
        }
        if (/^(?:bc|pre|notextile)(?:\([^)]*\))?(?:\{[^}]*\})?(?:\[[^\]]*\])?\.\s/i.test(line)) {
            inTextileCode = true;
            offset += rawLine.length;
            lineNumber += 1;
            continue;
        }
        const heading = /^h([1-6])(?:[<>=()]*)(?:\([^)]*\))?(?:\{[^}]*\})?(?:\[[^\]]*\])?\.\s+(.+?)\s*$/i.exec(line);
        if (heading) {
            const text = stripTextileHeadingMarkup(heading[2]);
            result.push({
                level: Number(heading[1]),
                text,
                line: lineNumber + 1,
                offset,
                id: nextHeadingAnchorId(text, counts, usedIds)
            });
        }
        offset += rawLine.length;
        lineNumber += 1;
    }
    return result;
}

/**
 * Textile見出しの表示文字列から装飾記号、リンク先、HTML風タグを除去する。
 * @param source - Textile見出しの記法付き本文。
 * @returns slugとアウトライン表示に使う見出し文字列。
 */
export function stripTextileHeadingMarkup(source: string): string {
    return source
        .replace(/"([^"\r\n]+)":\S+/g, '$1')
        .replace(/!([^!\r\n(]+)\(([^)]*)\)!/g, '$2')
        .replace(/!([^!\r\n]+)!/g, '')
        .replace(/@([^@\r\n]+)@/g, '$1')
        .replace(/\*\*?([^*\r\n]+)\*\*?/g, '$1')
        .replace(/__?([^_\r\n]+)__?/g, '$1')
        .replace(/\+\+?([^+\r\n]+)\+\+?/g, '$1')
        .replace(/--?([^- \r\n][^- \r\n]*?)--?/g, '$1')
        .replace(/\?\?([^?\r\n]+)\?\?/g, '$1')
        .replace(/<\/?[^>]+>/g, '')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .trim();
}

/**
 * Textileのブロック接頭辞または表行として独立して始まる行か判定する。
 * @param line - 走査中のTextile行。
 * @returns Textileブロック境界として扱う場合はtrue。
 */
export function isTextileBlockLead(line: string): boolean {
    return /^(?:p|div|bq|bc|pre|notextile|h[1-6])(?:[<>=()]*)(?:\([^)]*\))?(?:\{[^}]*\})?(?:\[[^\]]*\])?\.{1,2}(?:\s|$)/i.test(line)
        || isTextileTableRow(line)
        || /^(?:p|div|bq|bc|pre|notextile|h[1-6])\.(?:https?:\/\/|\()/i.test(line);
}

/**
 * 次の明示ブロックまで空行を含めて保持するTextile構文か判定する。
 * @param line - 描画単位の先頭候補行。
 * @returns 二重ピリオドの拡張ブロックならtrue。
 */
export function isTextileExtendedBlockLead(line: string): boolean {
    return /^(?:p|div|bq|bc|pre|notextile|h[1-6])(?:[<>=()]*)(?:\([^)]*\))?(?:\{[^}]*\})?(?:\[[^\]]*\])?\.\.(?:\s|$)/i.test(line);
}

/**
 * Textile表の行形式を判定し、通常の文章中のパイプを除外する。
 * @param line - Textile表候補行。
 * @returns 先頭と末尾を含む複数セル形式の場合はtrue。
 */
export function isTextileTableRow(line: string): boolean {
    return /^\|.+\|$/.test(line) && line.indexOf('|', 1) >= 0;
}

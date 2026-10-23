/**
 * @fileoverview Textile文書のリスト階層マーカーだけをCodeMirror可視範囲で強調し、本文やMarkdown解析を変更しない。
 */
import { type Extension as StateExtension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

/**
 * CodeMirror本文内で見つかったTextileリストマーカーのUTF-16範囲と階層。
 */
export interface TextileListMarkerRange {
    /** マーカー先頭のUTF-16オフセット。 */
    from: number;
    /** マーカー末尾のUTF-16オフセット。 */
    to: number;
    /** 連続する `*` または `#` の個数で表すリスト階層。 */
    level: number;
}

/**
 * Textileの階層付き箇条書き・番号付きリスト記号を表す装飾。
 * Decorationは表示だけを変え、ソース文字列・選択位置・保存内容を変更しない。
 */
export const textileListMarkerHighlightExtension: StateExtension = ViewPlugin.fromClass(
    /** 可視範囲に含まれるTextileリスト記号の装飾を管理する。 */
    class TextileListMarkerHighlightView {
        /** 文書編集時に更新し、スクロール中の全行再走査を避ける全文書マーカー索引。 */
        allMarkerRanges: TextileListMarkerRange[];
        /** 現在の可視範囲に対応するリスト記号の装飾。 */
        decorations: DecorationSet;

        /**
         * 初期文書と可視範囲からリスト記号の装飾を作る。
         * @param view - Textileソースと表示範囲を提供するCodeMirrorビュー。
         */
        constructor(view: EditorView) {
            this.allMarkerRanges = getTextileListMarkerRanges(view.state.doc.toString());
            this.decorations = createTextileListDecorations(this.allMarkerRanges, view.visibleRanges);
        }

        /**
         * 文書編集またはスクロール時に対象行だけを再計算する。
         * @param update - CodeMirrorの文書・可視範囲更新。
         */
        update(update: ViewUpdate): void {
            if (update.docChanged || update.viewportChanged) {
                if (update.docChanged) {
                    this.allMarkerRanges = getTextileListMarkerRanges(update.view.state.doc.toString());
                }
                this.decorations = createTextileListDecorations(this.allMarkerRanges, update.view.visibleRanges);
            }
        }
    },
    {
        decorations: (view) => view.decorations
    }
);

/**
 * Textile構文の文書から、コード領域を除いたリストマーカー範囲を返す。
 * @param source - LF区切りに正規化されたTextileソース。
 * @param visibleRanges - 省略時は全行、指定時は範囲と交差する行だけを返す表示範囲。
 * @returns `*` / `#` の階層マーカー位置。文書本文は変更しない。
 */
export function getTextileListMarkerRanges(
    source: string,
    visibleRanges?: readonly { from: number; to: number }[]
): TextileListMarkerRange[] {
    const ranges: TextileListMarkerRange[] = [];
    let offset = 0;
    let codeBlock: 'paragraph' | 'extended' | undefined;
    let rawPre = false;
    let rawNoTextile = false;
    let paragraphNoTextile = false;
    let extendedNoTextile = false;
    let markdownFence: { character: string; length: number } | undefined;

    for (const rawLine of source.split(/(?<=\n)|(?<=\r)(?!\n)/)) {
        const line = rawLine.replace(/(?:\r\n|\r|\n)$/, '');
        const lineEnd = offset + line.length;
        if (extendedNoTextile && isTextileBlockBoundary(line)) extendedNoTextile = false;
        if (extendedNoTextile) {
            offset += rawLine.length;
            continue;
        }
        if (rawPre) {
            if (/<\/pre\s*>/i.test(line)) rawPre = false;
            offset += rawLine.length;
            continue;
        }
        if (rawNoTextile) {
            if (/<\/notextile\s*>/i.test(line)) rawNoTextile = false;
            offset += rawLine.length;
            continue;
        }
        if (paragraphNoTextile) {
            if (!line.trim()) paragraphNoTextile = false;
            else {
                offset += rawLine.length;
                continue;
            }
        }
        if (codeBlock === 'extended' && isTextileBlockBoundary(line)) codeBlock = undefined;
        if (codeBlock) {
            if (codeBlock === 'paragraph' && !line.trim()) codeBlock = undefined;
            else {
                offset += rawLine.length;
                continue;
            }
        }
        if (markdownFence) {
            const closePattern = new RegExp(`^ {0,3}${escapeRegExp(markdownFence.character)}{${markdownFence.length},}\\s*$`);
            if (closePattern.test(line)) markdownFence = undefined;
            offset += rawLine.length;
            continue;
        }

        const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
        if (fence) {
            markdownFence = { character: fence[0] ?? '`', length: fence.length };
            offset += rawLine.length;
            continue;
        }
        if (/<pre\b[^>]*>/i.test(line)) {
            rawPre = !/<\/pre\s*>/i.test(line);
            offset += rawLine.length;
            continue;
        }
        if (/<notextile\b[^>]*>/i.test(line)) {
            rawNoTextile = !/<\/notextile\s*>/i.test(line);
            offset += rawLine.length;
            continue;
        }
        if (/^notextile\.\.(?:\s|$)/i.test(line)) {
            extendedNoTextile = true;
            offset += rawLine.length;
            continue;
        }
        if (/^notextile\.(?:\s|$)/i.test(line)) {
            paragraphNoTextile = true;
            offset += rawLine.length;
            continue;
        }
        const codeLead = /^(bc|pre)(?:\([^)]*\))?(?:\{[^}]*\})?(?:\[[^\]]*\])?\.(\.)?\s/i.exec(line);
        if (codeLead) {
            codeBlock = codeLead[2] ? 'extended' : 'paragraph';
            offset += rawLine.length;
            continue;
        }

        const marker = /^[ \t]*(\*+|#+)(?=\s|$)/.exec(line);
        const markerOffset = marker?.[0].search(/[\*#]/) ?? -1;
        const markerText = marker?.[1];
        const intersectsVisibleRange = !visibleRanges || visibleRanges.some(
            /**
             * 可視範囲が候補行と重なるかを判定する。
             * @param range - CodeMirrorが画面内に描画するUTF-16範囲。
             * @returns 候補マーカーを含む場合はtrue。
             */
            (range) => offset <= range.to && lineEnd >= range.from
        );
        if (markerText && markerOffset >= 0 && intersectsVisibleRange) {
            ranges.push({ from: offset + markerOffset, to: offset + markerOffset + markerText.length, level: markerText.length });
        }
        offset += rawLine.length;
    }
    return ranges;
}

/**
 * キャッシュ済みリストマーカーから現在表示する行だけの装飾を作る。
 * @param markerRanges - 現在の文書に対応する全文書マーカー索引。
 * @param visibleRanges - CodeMirrorが画面内に描画するUTF-16範囲。
 * @returns UTF-16位置順のリストマーカー装飾集合。
 */
function createTextileListDecorations(
    markerRanges: readonly TextileListMarkerRange[],
    visibleRanges: readonly { from: number; to: number }[]
): DecorationSet {
    const ranges = getVisibleTextileListMarkerRanges(markerRanges, visibleRanges);
    return Decoration.set(ranges.map(
        /**
         * 階層情報を持つハイライト装飾へ変換する。
         * @param range - ソース上のTextileリストマーカー。
         * @returns CodeMirror本文に重ねる装飾範囲。
         */
        (range) => Decoration.mark({
            class: 'cm-mve-textile-list-marker',
            attributes: { 'data-level': String(range.level) }
        }).range(range.from, range.to)
    ), true);
}

/**
 * ソート済み索引を二分探索し、画面内に交差するマーカーだけを選ぶ。
 * @param markerRanges - 文書順に並んだ全文書マーカー索引。
 * @param visibleRanges - CodeMirrorが画面内に描画する範囲。
 * @returns 表示範囲と交差するマーカー範囲。
 */
function getVisibleTextileListMarkerRanges(
    markerRanges: readonly TextileListMarkerRange[],
    visibleRanges: readonly { from: number; to: number }[]
): TextileListMarkerRange[] {
    const visible: TextileListMarkerRange[] = [];
    for (const visibleRange of visibleRanges) {
        let lower = 0;
        let upper = markerRanges.length;
        while (lower < upper) {
            const middle = lower + Math.floor((upper - lower) / 2);
            const marker = markerRanges[middle];
            if (marker && marker.to < visibleRange.from) lower = middle + 1;
            else upper = middle;
        }
        for (let index = lower; index < markerRanges.length; index += 1) {
            const marker = markerRanges[index];
            if (!marker || marker.from > visibleRange.to) break;
            if (marker.to >= visibleRange.from) visible.push(marker);
        }
    }
    return visible;
}

/**
 * Textileの明示ブロック接頭辞として行頭を使うか判定する。
 * @param line - コード・notextileブロック終了候補。
 * @returns Textileブロック境界として解析可能な場合はtrue。
 */
function isTextileBlockBoundary(line: string): boolean {
    return /^(?:p|div|bq|bc|pre|notextile|h[1-6])(?:[<>=()]*)(?:\([^)]*\))?(?:\{[^}]*\})?(?:\[[^\]]*\])?\.{1,2}(?:\s|$)/i.test(line)
        || /^\|/.test(line);
}

/**
 * 正規表現内で文字列の内容を安全なリテラルにする。
 * @param value - TextileまたはMarkdownコードフェンスの記号。
 * @returns 正規表現で特別な意味を持たない形にした文字列。
 */
function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

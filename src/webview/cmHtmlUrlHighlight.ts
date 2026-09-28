/**
 * @fileoverview Markdown本文内のHTMLでURLを保持する属性値だけを軽量に強調表示する。
 */
import { syntaxTree } from '@codemirror/language';
import type { EditorState, Extension, Range } from '@codemirror/state';
import {
    Decoration,
    EditorView,
    ViewPlugin,
    type DecorationSet,
    type ViewUpdate
} from '@codemirror/view';

/**
 * HTML URL属性の強調対象範囲。
 */
export interface HtmlUrlAttributeRange {

    /**
     * 属性値の開始オフセット。引用符は含まない。
     */
    from: number;

    /**
     * 属性値の終了オフセット。引用符は含まない。
     */
    to: number;

    /**
     * 小文字へ正規化したHTML属性名。
     */
    attribute: string;
}

/**
 * URLまたはURL一覧を値として持つHTML属性。
 *
 * src/hrefだけでなく、画像・動画・フォーム等で一般的に使われるURL属性も対象にする。
 * class/style/alt等の通常属性は対象外にして視認性を保つ。
 */
const HTML_URL_ATTRIBUTES = new Set([
    'action',
    'cite',
    'data',
    'formaction',
    'href',
    'manifest',
    'poster',
    'src',
    'srcset',
    'xlink:href'
]);

/**
 * HTMLの引用符付き属性値から、引用符を除いた本文範囲を返す。
 * @param state - 現在のCodeMirror文書状態。
 * @param from - 属性値ノードの開始位置。
 * @param to - 属性値ノードの終了位置。
 * @returns 引用符を除外した開始・終了位置。
 */
function trimAttributeQuotes(
    state: EditorState,
    from: number,
    to: number
): { from: number; to: number } {
    if (to - from < 2) return { from, to };
    const first = state.doc.sliceString(from, from + 1);
    if (first !== '"' && first !== "'") return { from, to };
    if (state.doc.sliceString(to - 1, to) !== first) return { from, to };
    return { from: from + 1, to: to - 1 };
}

/**
 * 指定範囲にあるHTML URL属性値をCodeMirrorの構文木から抽出する。
 *
 * 正規表現でMarkdown本文を再解析せず、既にCodeMirrorが保持している構文木だけを走査する。
 * 呼び出し側は可視範囲を渡すため、長大な文書でも全文走査しない。
 *
 * @param state - 現在のCodeMirror文書状態。
 * @param from - 走査開始位置。
 * @param to - 走査終了位置。
 * @returns URL属性値の範囲一覧。
 */
export function findHtmlUrlAttributeRanges(
    state: EditorState,
    from = 0,
    to = state.doc.length
): HtmlUrlAttributeRange[] {
    const scanFrom = Math.max(0, Math.min(from, state.doc.length));
    const scanTo = Math.max(scanFrom, Math.min(to, state.doc.length));
    if (scanTo <= scanFrom) return [];

    const ranges: HtmlUrlAttributeRange[] = [];
    syntaxTree(state).iterate({
        from: scanFrom,
        to: scanTo,
        /**
         * HTML Attributeノードだけを調べ、URL属性なら値ノードを装飾対象へ追加する。
         * @param node - CodeMirror構文木の現在ノード。
         * @returns Attributeの子走査を省略する場合はfalse。
         */
        enter(node) {
            if (node.name !== 'Attribute') return;

            const attributeNameNode = node.node.getChild('AttributeName');
            if (!attributeNameNode) return false;
            const attribute = state.doc
                .sliceString(attributeNameNode.from, attributeNameNode.to)
                .toLowerCase();
            if (!HTML_URL_ATTRIBUTES.has(attribute)) return false;

            const valueNode = node.node.getChild('AttributeValue')
                ?? node.node.getChild('UnquotedAttributeValue');
            if (!valueNode) return false;

            const value = trimAttributeQuotes(state, valueNode.from, valueNode.to);
            const valueFrom = Math.max(scanFrom, value.from);
            const valueTo = Math.min(scanTo, value.to);
            if (valueTo > valueFrom) {
                ranges.push({ from: valueFrom, to: valueTo, attribute });
            }
            return false;
        }
    });
    return ranges;
}

/**
 * 現在表示中の範囲だけからHTML URL属性の装飾を生成する。
 * @param view - CodeMirrorの現在ビュー。
 * @returns 可視URL属性に対応する装飾セット。
 */
function createHtmlUrlAttributeDecorations(view: EditorView): DecorationSet {
    const mark = Decoration.mark({ class: 'cm-html-url-attribute' });
    const ranges: Range<Decoration>[] = [];
    for (const visible of view.visibleRanges) {
        for (const match of findHtmlUrlAttributeRanges(
            view.state,
            visible.from,
            visible.to
        )) {
            ranges.push(mark.range(match.from, match.to));
        }
    }
    return ranges.length > 0 ? Decoration.set(ranges, true) : Decoration.none;
}

/**
 * HTML URL属性を可視範囲だけで追従させるCodeMirrorプラグイン。
 */
const htmlUrlAttributeHighlightPlugin = ViewPlugin.fromClass(class {

    /**
     * 現在表示しているURL属性の装飾。
     */
    decorations: DecorationSet;

    /**
     * @param view - 初期CodeMirrorビュー。
     */
    constructor(view: EditorView) {
        this.decorations = createHtmlUrlAttributeDecorations(view);
    }

    /**
     * 文書または可視範囲が変わった場合だけ装飾を再計算する。
     * 選択・カーソル移動だけでは再走査しない。
     * @param update - CodeMirrorビュー更新。
     * @returns 値は返さない。
     */
    update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) {
            this.decorations = createHtmlUrlAttributeDecorations(update.view);
        }
    }
}, {
    /**
     * @param plugin - URL属性装飾を保持するプラグイン。
     * @returns 現在の装飾セット。
     */
    decorations: (plugin) => plugin.decorations
});

/**
 * Markdownの通常URL色と揃え、リンク風の下線は付けずHTML属性値として区別する。
 */
const htmlUrlAttributeHighlightTheme = EditorView.baseTheme({
    '.cm-html-url-attribute': {
        color: '#4ec9b0'
    }
});

/**
 * Markdown本文内HTMLのURL属性を強調するCodeMirror extension。
 */
export const htmlUrlAttributeHighlightExtension: Extension = [
    htmlUrlAttributeHighlightPlugin,
    htmlUrlAttributeHighlightTheme
];

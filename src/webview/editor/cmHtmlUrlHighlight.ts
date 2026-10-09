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
 * CodeMirror構文木からresolveInnerで取得できる構文ノード型。
 */
type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>['resolveInner']>;

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
 * Markdown側でHTMLパーサーがoverlayとしてマウントされるホストノード。
 */
const MARKDOWN_HTML_HOST_NODES = new Set([
    'HTMLBlock',
    'HTMLTag'
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
 * MarkdownのHTMLホストノードからoverlayされたHTML構文木のルートを取得する。
 * @param host - Markdown側のHTMLBlockまたはHTMLTagノード。
 * @param preferredPosition - 現在の可視範囲に近い解決位置。
 * @returns overlayされたHTML構文木の最上位ノード。未解析時はundefined。
 */
function resolveHtmlRoot(
    host: SyntaxNode,
    preferredPosition: number
): SyntaxNode | undefined {
    if (host.to <= host.from) return undefined;

    const positions = [
        Math.min(host.to - 1, Math.max(host.from, preferredPosition)),
        host.from,
        host.to - 1
    ];
    for (const position of positions) {
        let current = host.resolveInner(position, position <= host.from ? 1 : 0);
        if (MARKDOWN_HTML_HOST_NODES.has(current.name)) continue;

        while (
            current.parent
            && !MARKDOWN_HTML_HOST_NODES.has(current.parent.name)
        ) {
            current = current.parent;
        }
        if (!MARKDOWN_HTML_HOST_NODES.has(current.name)) return current;
    }
    return undefined;
}

/**
 * HTML構文木を指定範囲だけ走査し、URL属性値を収集する。
 * @param state - 現在のCodeMirror文書状態。
 * @param node - overlayされたHTML構文ノード。
 * @param scanFrom - 走査開始位置。
 * @param scanTo - 走査終了位置。
 * @param ranges - 検出結果の格納先。
 */
function collectHtmlUrlAttributeRanges(
    state: EditorState,
    node: SyntaxNode,
    scanFrom: number,
    scanTo: number,
    ranges: HtmlUrlAttributeRange[]
): void {
    if (node.to <= scanFrom || node.from >= scanTo) return;

    if (node.name === 'Attribute') {
        const attributeNameNode = node.getChild('AttributeName');
        if (!attributeNameNode) return;
        const attribute = state.doc
            .sliceString(attributeNameNode.from, attributeNameNode.to)
            .toLowerCase();
        if (!HTML_URL_ATTRIBUTES.has(attribute)) return;

        const valueNode = node.getChild('AttributeValue')
            ?? node.getChild('UnquotedAttributeValue');
        if (!valueNode) return;

        const value = trimAttributeQuotes(state, valueNode.from, valueNode.to);
        const valueFrom = Math.max(scanFrom, value.from);
        const valueTo = Math.min(scanTo, value.to);
        if (valueTo > valueFrom) {
            ranges.push({ from: valueFrom, to: valueTo, attribute });
        }
        return;
    }

    for (let child = node.firstChild; child; child = child.nextSibling) {
        collectHtmlUrlAttributeRanges(state, child, scanFrom, scanTo, ranges);
    }
}

/**
 * 指定範囲にあるHTML URL属性値をCodeMirrorの構文木から抽出する。
 *
 * MarkdownのHTMLはoverlay構文木として保持されるため、まずHTMLBlock/HTMLTagだけを
 * Markdown側の構文木から取得し、resolveInnerで既存のHTML構文木へ入る。
 * 正規表現で本文を再解析せず、呼び出し側も可視範囲だけを渡すため全文走査しない。
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
         * Markdown側のHTMLホストノードだけでoverlay構文木へ入り、対象属性を収集する。
         * @param node - Markdown構文木の現在ノード。
         * @returns HTMLホストのMarkdown子ノード走査を省略する場合はfalse。
         */
        enter(node) {
            if (!MARKDOWN_HTML_HOST_NODES.has(node.name)) return;
            const host = node.node as SyntaxNode;
            const htmlRoot = resolveHtmlRoot(host, scanFrom);
            if (htmlRoot) {
                collectHtmlUrlAttributeRanges(
                    state,
                    htmlRoot,
                    scanFrom,
                    scanTo,
                    ranges
                );
            }
            return false;
        }
    });
    return ranges;
}

/**
 * HTML URL属性へ適用する再利用可能なDecoration。
 */
const htmlUrlAttributeMark = Decoration.mark({
    class: 'cm-html-url-attribute'
});

/**
 * 現在表示中の範囲だけからHTML URL属性の装飾を生成する。
 * @param view - CodeMirrorの現在ビュー。
 * @returns 可視URL属性に対応する装飾セット。
 */
function createHtmlUrlAttributeDecorations(view: EditorView): DecorationSet {
    const ranges: Range<Decoration>[] = [];
    for (const visible of view.visibleRanges) {
        for (const match of findHtmlUrlAttributeRanges(
            view.state,
            visible.from,
            visible.to
        )) {
            ranges.push(htmlUrlAttributeMark.range(match.from, match.to));
        }
    }
    return ranges.length > 0 ? Decoration.set(ranges) : Decoration.none;
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
     */
    update(update: ViewUpdate): void {
        if (
            update.docChanged
            || update.viewportChanged
            || syntaxTree(update.startState) !== syntaxTree(update.state)
        ) {
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
        color: 'var(--mve-syntax-html-url-attribute, #4ec9b0)'
    }
});

/**
 * Markdown本文内HTMLのURL属性を強調するCodeMirror extension。
 */
export const htmlUrlAttributeHighlightExtension: Extension = [
    htmlUrlAttributeHighlightPlugin,
    htmlUrlAttributeHighlightTheme
];

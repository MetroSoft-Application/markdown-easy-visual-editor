/**
 * @fileoverview CodeMirrorの現在選択範囲に一致する本文範囲を探し、変更に追従する装飾として表示する。
 */
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

/**
 * 選択文字列と一致したエディター範囲の開始・終了位置です。
 */
export interface SelectionMatchRange {

    /**
     * 一致範囲の先頭を示す本文内UTF-16オフセットです。
     */
    from: number;

    /**
     * 一致範囲の末尾を示す本文内UTF-16オフセットです。
     */
    to: number;
}

/**
 * 検索結果として保持する一致箇所の上限。
 */
const MAX_MATCHES = 5000;

/**
 * 文書内で選択範囲と完全一致する検索語の位置を返す。
 * @param source 検索対象の文書本文。
 * @param query 選択範囲内で検索する文字列。
 * @param selectionFrom 検索対象選択範囲の開始オフセット。
 * @param selectionTo 検索対象選択範囲の終了オフセット。
 * @param maxMatches 返す一致箇所の最大数。
 * @returns 選択範囲に完全に含まれる一致箇所の開始・終了オフセット一覧。
 */
export function findExactSelectionMatches(
    source: string,
    query: string,
    selectionFrom: number,
    selectionTo: number,
    maxMatches = MAX_MATCHES
): SelectionMatchRange[] {
    if (!query || maxMatches <= 0) return [];

    const matches: SelectionMatchRange[] = [];
    let searchFrom = 0;
    while (searchFrom <= source.length - query.length && matches.length < maxMatches) {
        const found = source.indexOf(query, searchFrom);
        if (found < 0) break;
        const to = found + query.length;
        if (found !== selectionFrom || to !== selectionTo) {
            matches.push({ from: found, to });
        }
        // 1文字だけ進め、"ana" in "banana" のような重なった一致も拾う。
        searchFrom = found + 1;
    }
    return matches;
}

/**
 * 現在の選択文字列と文書内の一致範囲をCodeMirror装飾へ変換する。
 * @param view - 選択範囲・文書・表示範囲から一致装飾を作るCodeMirrorビュー。
 * @returns 文書内の選択文字列一致箇所を表すCodeMirror装飾。
 */
function createSelectionMatchDecorations(view: EditorView): DecorationSet {
    const selection = view.state.selection;
    // 複数選択では「どの文字列を基準にするか」を勝手に決めない。
    if (selection.ranges.length !== 1) return Decoration.none;

    const range = selection.main;
    if (range.empty) return Decoration.none;

    const query = view.state.doc.sliceString(range.from, range.to, '\n');
    const matches: SelectionMatchRange[] = [];
    // 選択ドラッグ中に全文を文字列化・全走査せず、VS Code同様に現在見えている範囲だけ装飾する。
    for (const visible of view.visibleRanges) {
        const from = Math.max(0, visible.from - Math.max(0, query.length - 1));
        const to = Math.min(view.state.doc.length, visible.to + Math.max(0, query.length - 1));
        const source = view.state.doc.sliceString(from, to, '\n');
        const remaining = MAX_MATCHES - matches.length;
        if (remaining <= 0) break;
        const visibleMatches = findExactSelectionMatches(
            source,
            query,
            range.from - from,
            range.to - from,
            remaining
        );
        for (const match of visibleMatches) {
            const absolute = { from: match.from + from, to: match.to + from };
            if (absolute.to >= visible.from && absolute.from <= visible.to
                && !matches.some(
                    /**

                     * @param item - 選択範囲に一致する検索語の開始・終了位置。
                     */
                    (item) => item.from === absolute.from && item.to === absolute.to)) {
                matches.push(absolute);
            }
        }
    }
    matches.sort(
        /**
         * 2つの値を比較して並び順を決める。
         * @param left - 比較対象の左側の値。
         * @param right - 比較対象の右側の値。
         * @returns 2つの要素の順序を示す数値。
         */
        (left, right) => left.from - right.from || left.to - right.to);
    return Decoration.set(
        matches.map(
            /**
             * 各設定をmarkへ渡し、変換結果を一覧化する。

             */
            ({ from, to }) => Decoration.mark({ class: 'cm-exact-selection-match' }).range(from, to))
    );
}

/**
 * 選択文字列と完全一致する別の範囲をCodeMirrorの装飾として表示する。
 */
const exactSelectionMatchPlugin = ViewPlugin.fromClass(class {

    /**
     * 現在の文書と選択範囲から計算した一致箇所の装飾。
     */
    decorations: DecorationSet;

    /**
     * 選択文字列の一致箇所を表示する装飾プラグインを初期化する。
     * @param view - 初期の選択一致装飾を作るエディタービュー。
     * @returns 初期化したインスタンス。
     */
    constructor(view: EditorView) {
        this.decorations = createSelectionMatchDecorations(view);
    }

    /**
     * cmselectionmatchhighlightの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param update - 文書・選択範囲・表示範囲の変更を含むCodeMirror更新通知。
     */
    update(update: ViewUpdate): void {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
            this.decorations = createSelectionMatchDecorations(update.view);
        }
    }
}, {


    decorations: (plugin) => plugin.decorations
});

/**
 * 完全一致箇所を本文中の通常選択と区別して表示するテーマ。
 */
const exactSelectionMatchTheme = EditorView.baseTheme({
    '.cm-exact-selection-match': {
        backgroundColor: 'var(--vscode-editor-selectionHighlightBackground, rgba(173, 214, 255, 0.22))',
        borderRadius: '2px'
    }
});

/**
 * 完全一致箇所の装飾プラグインと表示テーマを組み合わせた拡張。
 */
export const exactSelectionMatchExtension: Extension = [exactSelectionMatchPlugin, exactSelectionMatchTheme];

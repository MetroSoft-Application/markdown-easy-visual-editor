import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

export interface SelectionMatchRange {
    from: number;
    to: number;
}

const MAX_MATCHES = 5000;

/**
 * 明示選択された文字列と完全に同じ文字列の出現位置を返す。
 * 大文字小文字・空白・改行を一切正規化せず、重なった一致も対象にする。
 * 現在選択している範囲そのものだけは一致表示から除外する。
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

/** 現在の明示選択に対応する一致Decorationを作る。 */
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
                && !matches.some((item) => item.from === absolute.from && item.to === absolute.to)) {
                matches.push(absolute);
            }
        }
    }
    matches.sort((left, right) => left.from - right.from || left.to - right.to);
    return Decoration.set(
        matches.map(({ from, to }) => Decoration.mark({ class: 'cm-exact-selection-match' }).range(from, to))
    );
}

const exactSelectionMatchPlugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
        this.decorations = createSelectionMatchDecorations(view);
    }

    update(update: ViewUpdate): void {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
            this.decorations = createSelectionMatchDecorations(update.view);
        }
    }
}, {
    decorations: (plugin) => plugin.decorations
});

const exactSelectionMatchTheme = EditorView.baseTheme({
    '.cm-exact-selection-match': {
        backgroundColor: 'var(--vscode-editor-selectionHighlightBackground, rgba(173, 214, 255, 0.22))',
        borderRadius: '2px'
    }
});

/** SourceEditor生成時に直接登録する完全一致ハイライト拡張。 */
export const exactSelectionMatchExtension: Extension = [exactSelectionMatchPlugin, exactSelectionMatchTheme];

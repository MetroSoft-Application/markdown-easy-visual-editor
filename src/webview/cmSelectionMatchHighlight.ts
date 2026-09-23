/**
 * @fileoverview Webviewのcmselectionmatchhighlightを管理する。Hostとの通信、ユーザー操作、表示状態の契約を保つ。
 */
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

/**
 * cmselectionmatchhighlightで共有するデータ形状を表すインターフェース。
 */
export interface SelectionMatchRange {

    /**
     * cmselectionmatchhighlightのfromを表す数値。
     */
    from: number;

    /**
     * cmselectionmatchhighlightのtoを表す数値。
     */
    to: number;
}

/**
 * 検索結果として保持する一致箇所の上限。
 */
const MAX_MATCHES = 5000;

/**
 * cmselectionmatchhighlightから必要な値またはリソースを取得する。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param query - cmselectionmatchhighlightの位置・寸法・件数・時間を表す数値。
 * @param selectionFrom - cmselectionmatchhighlightで扱う数値。
 * @param selectionTo - cmselectionmatchhighlightで扱う数値。
 * @param maxMatches - cmselectionmatchhighlightの位置・寸法・件数・時間を表す数値。
 * @returns cmselectionmatchhighlightに対応する要素の一覧。
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
 * cmselectionmatchhighlightで使う値または実行環境を組み立てる。
 * @param view - cmselectionmatchhighlightへ渡す入力。
 * @returns cmselectionmatchhighlightで生成または変換した値。
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
                     * cmselectionmatchhighlightのコールバックとして項目を処理する。
                     * @param item - cmselectionmatchhighlightで走査または更新する要素。
                     * @returns 副作用を完了し、値は返さない。
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
             * @param options - 呼び出し側が指定する処理設定。
             * @returns 入力要素から生成した変換結果の一覧。
             */
            ({ from, to }) => Decoration.mark({ class: 'cm-exact-selection-match' }).range(from, to))
    );
}

/**
 * cmselectionmatchhighlightのexact・selection・match・pluginに関する状態または設定。
 */
const exactSelectionMatchPlugin = ViewPlugin.fromClass(class {

    /**
     * cmselectionmatchhighlightのdecorationsに関する状態または設定。
     */
    decorations: DecorationSet;

    /**
     * cmselectionmatchhighlightで使う値または実行環境を組み立てる。
     * @param view - cmselectionmatchhighlightへ渡す入力。
     * @returns 初期化したインスタンス。
     */
    constructor(view: EditorView) {
        this.decorations = createSelectionMatchDecorations(view);
    }

    /**
     * cmselectionmatchhighlightの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param update - cmselectionmatchhighlightへ渡す入力。
     * @returns 副作用を完了し、値は返さない。
     */
    update(update: ViewUpdate): void {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
            this.decorations = createSelectionMatchDecorations(update.view);
        }
    }
}, {


    decorations: /**
     * cmselectionmatchhighlightのdecorationsを処理し、呼び出し側へ結果または副作用を返す。
     * @param plugin - cmselectionmatchhighlightへ渡す入力。
     * @returns cmselectionmatchhighlightのdecorationsが生成する結果。
     */ (plugin) => plugin.decorations
});

/**
 * cmselectionmatchhighlightのexact・selection・match・themeに関する状態または設定。
 */
const exactSelectionMatchTheme = EditorView.baseTheme({
    '.cm-exact-selection-match': {
        backgroundColor: 'var(--vscode-editor-selectionHighlightBackground, rgba(173, 214, 255, 0.22))',
        borderRadius: '2px'
    }
});

/**
 * cmselectionmatchhighlightのexact・selection・match・extensionとして順序を保つ一覧。
 */
export const exactSelectionMatchExtension: Extension = [exactSelectionMatchPlugin, exactSelectionMatchTheme];

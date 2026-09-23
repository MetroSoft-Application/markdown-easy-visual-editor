/**
 * @file cmSelectionMatchHighlight.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

/**
 * 「SelectionMatchRange」が満たすデータ契約を定義します。
 */
export interface SelectionMatchRange {

    /**
     * 「from」は、本文または選択範囲の位置・長さを保持します。
     */
    from: number;

    /**
     * 「to」は、本文または選択範囲の位置・長さを保持します。
     */
    to: number;
}

/** 「MAX_MATCHES」は、入力・表示・資源の上限または下限を表す値です。 */
const MAX_MATCHES = 5000;

/**
 * 明示選択された文字列と完全に同じ文字列の出現位置を返す。
 * 大文字小文字・空白・改行を一切正規化せず、重なった一致も対象にする。
 * 現在選択している範囲そのものだけは一致表示から除外する。
 * @param source 処理対象のソースです。
 * @param query 「query」は、「findExactSelectionMatches」がWebview UI状態の処理対象を特定する入力です。
 * @param selectionFrom 「selectionFrom」は、「findExactSelectionMatches」がWebview UI状態の処理対象を特定する入力です。
 * @param selectionTo 「selectionTo」は、「findExactSelectionMatches」がWebview UI状態の処理対象を特定する入力です。
 * @param maxMatches 「maxMatches」は、「findExactSelectionMatches」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「findExactSelectionMatches」が読み取りまたは正規化した結果を返します。
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
 * 現在の明示選択に対応する一致Decorationを作る。
 * @param view 処理対象のviewです。
 * @returns 「createSelectionMatchDecorations」が生成したデータまたはオブジェクトを返します。
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
 * 「item」が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
                 * @param item 変換または処理の対象となる値です。
                 * @returns 条件判定の結果を示す真偽値を返します。
                 */
                (item) => item.from === absolute.from && item.to === absolute.to)) {
                matches.push(absolute);
            }
        }
    }
    matches.sort(
    /**
 * 「left」「right」を比較し、並び順を示す数値を返すコールバックです。
     * @param left 比較対象の左側の値です。
     * @param right 比較対象の右側の値です。
     * @returns 比較対象の順序を示す負数、0、または正数を返します。
     */
    (left, right) => left.from - right.from || left.to - right.to);
    return Decoration.set(
        matches.map(
        /**
 * 「from」「to」を変換し、変換後の要素を返すコールバックです。
         * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはfrom、toです。
         * @returns 入力要素から生成した変換後の値を返します。
         */
        ({ from, to }) => Decoration.mark({ class: 'cm-exact-selection-match' }).range(from, to))
    );
}

/** 「exactSelectionMatchPlugin」は、関連する処理間で共有する設定値または状態です。 */
const exactSelectionMatchPlugin = ViewPlugin.fromClass(class {

    /**
     * 「decorations」は、表示領域のサイズまたは倍率を保持します。
     */
    decorations: DecorationSet;

    /**
     * 処理に必要な状態を初期化します。
     * @param view 処理対象のviewです。
     * @returns 「constructor」がWebview UI状態の入力を処理して得た固有の結果を返します。
     */
    constructor(view: EditorView) {
        this.decorations = createSelectionMatchDecorations(view);
    }

    /**
     * updateを更新または保存します。
     * @param update 「update」は、「update」がWebview UI状態の処理対象を特定する入力です。
     * @returns 状態更新または副作用を実行し、値は返しません。
     */
    update(update: ViewUpdate): void {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
            this.decorations = createSelectionMatchDecorations(update.view);
        }
    }
}, {

    /**
     * 「decorations」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
     * @param plugin 「plugin」は、「decorations」がWebview UI状態の処理対象を特定する入力です。
     * @returns 「decorations」がWebview UI状態の入力を処理して得た固有の結果を返します。
     */
    decorations: /**
 * 「decorations」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param plugin 「plugin」は、「decorations」がWebview UIで処理する対象を特定する入力です。
 * @returns 「decorations」がWebview UI状態の入力を処理して得た固有の結果を返します。
 */ (plugin) => plugin.decorations
});

/** 「exactSelectionMatchTheme」は、関連する処理間で共有する設定値または状態です。 */
const exactSelectionMatchTheme = EditorView.baseTheme({
    '.cm-exact-selection-match': {
        backgroundColor: 'var(--vscode-editor-selectionHighlightBackground, rgba(173, 214, 255, 0.22))',
        borderRadius: '2px'
    }
});

/** SourceEditor生成時に直接登録する完全一致ハイライト拡張。 */
export const exactSelectionMatchExtension: Extension = [exactSelectionMatchPlugin, exactSelectionMatchTheme];

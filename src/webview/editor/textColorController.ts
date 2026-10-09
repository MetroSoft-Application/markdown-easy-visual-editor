/**
 * @fileoverview 文字色操作のUIと本文変更を接続し、選択範囲と履歴を保ったまま色を適用する。
 */
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { clearInlineFormatting } from "../../shared/markdown";
import {
    applyTextColorFormatting,
    detectTextColorFormatting,
    type TextColorEdit,
    type TextColorId,
    type TextColorSelectionState,
} from "../../shared/textColor";
import { computeTextChanges, mapTextOffset } from "../../shared/textChanges";

/**
 * 文字色操作の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param color - 本文へ適用するプリセット色ID。未定義なら文字色書式を解除する。
 * @returns 条件が成立したかを示す真偽値。
 */
export function applyTextColorToActiveSource(
    color: TextColorId | undefined,
): boolean {
    const view = findActiveSourceView();
    if (!view) return false;
    const selection = view.state.selection.main;
    if (selection.from === selection.to) {
        view.focus();
        return false;
    }
    const source = internalDocumentValue(view);
    const edit = applyTextColorFormatting(
        source,
        { from: selection.from, to: selection.to },
        color,
    );
    applyEditorEdit(view, edit);
    return true;
}

/**
 * 選択中のソース本文に設定された文字色を取得する。
 * @returns 選択範囲の文字色状態。対象がない場合や複数色が混在する場合はundefined。
 */
export function readActiveSourceTextColor(): TextColorSelectionState {
    const view = findActiveSourceView();
    if (!view) return undefined;
    const selection = view.state.selection.main;
    if (selection.from === selection.to) return undefined;
    return detectTextColorFormatting(internalDocumentValue(view), {
        from: selection.from,
        to: selection.to,
    });
}

/**
 * 文字色操作の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @returns 条件が成立したかを示す真偽値。
 */
export function clearInlineFormattingWithTextColor(): boolean {
    const view = findActiveSourceView();
    if (!view) return false;
    const source = internalDocumentValue(view);
    const selection = view.state.selection.main;
    const caretOnly = selection.from === selection.to;
    const actionSelection = caretOnly
        ? (
            () => {
                const line = view.state.doc.lineAt(selection.from);
                return { from: line.from, to: line.to };
            })()
        : { from: selection.from, to: selection.to };

    const inlineCleared = clearInlineFormatting(source, actionSelection);
    const colorCleared = applyTextColorFormatting(
        inlineCleared.text,
        inlineCleared.selection,
        undefined,
    );

    if (caretOnly) {
        const changes = computeTextChanges(source, colorCleared.text);
        const caret = mapTextOffset(selection.from, changes, source.length, 1);
        colorCleared.selection = { from: caret, to: caret };
    }
    applyEditorEdit(view, colorCleared);
    return true;
}

/**
 * 表示中のソースエディターから、フォーカス中または可視のCodeMirrorビューを取得する。
 * @returns 対象のエディタービュー。DOM要素に対応するビューがなければundefined。
 */
function findActiveSourceView(): EditorView | undefined {
    const editors = [
        ...document.querySelectorAll<HTMLElement>(".source-editor .cm-editor"),
    ];
    if (!editors.length) return undefined;
    const focused = editors.find(
        (editor) => editor.contains(document.activeElement));
    const visible = editors.find(
        (editor) => editor.getClientRects().length > 0);
    const editor = focused ?? visible ?? editors[0];
    try {
        return EditorView.findFromDOM(editor) ?? undefined;
    } catch {
        return undefined;
    }
}

/**
 * CodeMirror文書をLF区切りの文字列にして返す。
 * @param view - CodeMirror文書本文と選択状態を提供するエディタービュー。
 * @returns エディター内の改行をLFへ正規化した本文。
 */
function internalDocumentValue(view: EditorView): string {
    return view.state.doc.sliceString(0, view.state.doc.length, "\n");
}

/**
 * 文字色操作の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param view - テキスト変更を適用するCodeMirrorエディタービュー。
 * @param edit - 本文置換文字列と、置換後に設定する選択範囲。
 */
function applyEditorEdit(view: EditorView, edit: TextColorEdit): void {
    const source = internalDocumentValue(view);
    const changes = computeTextChanges(source, edit.text);
    const selectionChanged =
        view.state.selection.main.from !== edit.selection.from ||
        view.state.selection.main.to !== edit.selection.to;

    if (!changes.length && !selectionChanged) {
        view.focus();
        return;
    }

    view.dispatch({
        changes: changes.map(
            (change) => ({
                from: change.rangeOffset,
                to: change.rangeOffset + change.rangeLength,
                insert: change.text,
            })),
        selection: EditorSelection.range(edit.selection.from, edit.selection.to),
    });
    view.focus();
}

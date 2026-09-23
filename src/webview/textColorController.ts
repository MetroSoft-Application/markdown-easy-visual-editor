/**
 * @fileoverview 文字色操作のUIと本文変更を接続し、選択範囲と履歴を保ったまま色を適用する。
 */
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { clearInlineFormatting } from "../shared/markdown";
import {
    applyTextColorFormatting,
    detectTextColorFormatting,
    type TextColorEdit,
    type TextColorId,
    type TextColorSelectionState,
} from "../shared/textColor";
import { computeTextChanges, mapTextOffset } from "../shared/textChanges";

/**
 * 文字色操作の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param color - 文字色操作へ渡す入力。
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
 * 文字色操作から必要な値またはリソースを取得する。
 * @returns 文字色操作のread・active・source・text・colorが生成する結果。
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
            /**
             * 要素をline・atへ渡し、文字色操作の結果または副作用を処理する。
             * @returns 文字色操作のコールバックが生成する結果。
             */
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
 * 文字色操作から必要な値またはリソースを取得する。
 * @returns 条件に一致する値。未検出時はundefinedまたはnull。
 */
function findActiveSourceView(): EditorView | undefined {
    const editors = [
        ...document.querySelectorAll<HTMLElement>(".source-editor .cm-editor"),
    ];
    if (!editors.length) return undefined;
    const focused = editors.find(
        /**
         * containsが条件に一致する最初のeditorを取得する。
         * @param editor - editorのcontainsを参照する走査対象。
         * @returns 条件に一致した最初の要素。未検出時はundefined。
         */
        (editor) => editor.contains(document.activeElement));
    const visible = editors.find(
        /**
         * get・client・rectsが条件に一致する最初のeditorを取得する。
         * @param editor - editorのget・client・rectsを参照する走査対象。
         * @returns 条件に一致した最初の要素。未検出時はundefined。
         */
        (editor) => editor.getClientRects().length > 0);
    const editor = focused ?? visible ?? editors[0];
    try {
        return EditorView.findFromDOM(editor) ?? undefined;
    } catch {
        return undefined;
    }
}

/**
 * 文字色操作のinternal・document・valueを処理し、呼び出し側へ結果または副作用を返す。
 * @param view - 文字色操作へ渡す入力。
 * @returns 文字色操作で利用する文字列。
 */
function internalDocumentValue(view: EditorView): string {
    return view.state.doc.sliceString(0, view.state.doc.length, "\n");
}

/**
 * 文字色操作の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param view - 文字色操作へ渡す入力。
 * @param edit - 文字色操作へ渡す入力。
 * @returns 副作用を完了し、値は返さない。
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
            /**
             * 各changeからrange・offsetを取り出して一覧化する。
             * @param change - changeのrange・offsetを参照する走査対象。
             * @returns range・offsetを取り出した変換結果の一覧。
             */
            (change) => ({
                from: change.rangeOffset,
                to: change.rangeOffset + change.rangeLength,
                insert: change.text,
            })),
        selection: EditorSelection.range(edit.selection.from, edit.selection.to),
    });
    view.focus();
}

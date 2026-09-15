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

/** 現在表示中のソースエディター選択へ文字色を適用する。選択が空なら何もしない。 */
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
  const source = view.state.sliceDoc();
  const edit = applyTextColorFormatting(
    source,
    { from: selection.from, to: selection.to },
    color,
  );
  return applyEditorEdit(view, edit);
}

/** 現在の選択範囲の文字色状態を返す。未着色はundefined、複数色はmixed。 */
export function readActiveSourceTextColor(): TextColorSelectionState {
  const view = findActiveSourceView();
  if (!view) return undefined;
  const selection = view.state.selection.main;
  if (selection.from === selection.to) return undefined;
  return detectTextColorFormatting(view.state.sliceDoc(), {
    from: selection.from,
    to: selection.to,
  });
}

/**
 * 既存のインライン書式解除とMVE文字色解除を1回の編集として適用する。
 * 選択が空の場合はSourceEditorの既存仕様と同じく現在行を対象とし、キャレット位置を維持する。
 */
export function clearInlineFormattingWithTextColor(): boolean {
  const view = findActiveSourceView();
  if (!view) return false;
  const source = view.state.sliceDoc();
  const selection = view.state.selection.main;
  const caretOnly = selection.from === selection.to;
  const actionSelection = caretOnly
    ? (() => {
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
  return applyEditorEdit(view, colorCleared);
}

function findActiveSourceView(): EditorView | undefined {
  const editors = [
    ...document.querySelectorAll<HTMLElement>(".source-editor .cm-editor"),
  ];
  if (!editors.length) return undefined;
  const focused = editors.find((editor) => editor.contains(document.activeElement));
  const visible = editors.find((editor) => editor.getClientRects().length > 0);
  const editor = focused ?? visible ?? editors[0];
  try {
    return EditorView.findFromDOM(editor);
  } catch {
    return undefined;
  }
}

function applyEditorEdit(view: EditorView, edit: TextColorEdit): boolean {
  const source = view.state.sliceDoc();
  const changes = computeTextChanges(source, edit.text);
  const selectionChanged =
    view.state.selection.main.from !== edit.selection.from ||
    view.state.selection.main.to !== edit.selection.to;

  if (!changes.length && !selectionChanged) {
    view.focus();
    return false;
  }

  view.dispatch({
    changes: changes.map((change) => ({
      from: change.rangeOffset,
      to: change.rangeOffset + change.rangeLength,
      insert: change.text,
    })),
    selection: EditorSelection.range(edit.selection.from, edit.selection.to),
  });
  view.focus();
  return changes.length > 0;
}

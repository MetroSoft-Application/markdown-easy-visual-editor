/**
 * @file textColorController.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
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
 * 現在表示中のソースエディター選択へ文字色を適用する。選択が空なら何もしない。
 * @param color 処理対象の色です。
 * @returns 判定結果です。
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
 * 現在の選択範囲の文字色状態を返す。未着色はundefined、複数色はmixed。
 * @returns 「readActiveSourceTextColor」が読み取りまたは正規化した結果を返します。
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
 * 既存のインライン書式解除とMVE文字色解除を1回の編集として適用する。
 * 選択が空の場合はSourceEditorの既存仕様と同じく現在行を対象とし、キャレット位置を維持する。
 * @returns 判定結果です。
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
 * 処理結果を生成する処理を実行するコールバックです。
     * @returns DOM検索で得た要素または状態を返します。
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
 * find・active・source・viewを取得または解決します。
 * @returns 「findActiveSourceView」が対象を取得できない場合はundefinedを返します。
 */
function findActiveSourceView(): EditorView | undefined {
  const editors = [
    ...document.querySelectorAll<HTMLElement>(".source-editor .cm-editor"),
  ];
  if (!editors.length) return undefined;
  const focused = editors.find(
  /**
 * 「editor」が検索条件に一致するか判定するコールバックです。
   * @param editor editorとして渡される、このコールバックの入力値です。
   * @returns 条件に一致した要素、または該当しない場合はundefinedを返します。
   */
  (editor) => editor.contains(document.activeElement));
  const visible = editors.find(
  /**
 * 「editor」が検索条件に一致するか判定するコールバックです。
   * @param editor editorとして渡される、このコールバックの入力値です。
   * @returns 条件に一致した要素、または該当しない場合はundefinedを返します。
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
 * CodeMirror位置と1:1で対応するLF区切り文字列を返す。CRLF設定でも内部座標を崩さない。
 * @param view 処理対象のviewです。
 * @returns 「internalDocumentValue」が生成または変換したWebview UIの文字列を返します。
 */
function internalDocumentValue(view: EditorView): string {
  return view.state.doc.sliceString(0, view.state.doc.length, "\n");
}

/**
 * apply・editor・editを処理します。
 * @param view 処理対象のviewです。
 * @param edit 「edit」は、「applyEditorEdit」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「applyEditorEdit」の副作用または状態更新を実行し、値は返しません。
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
 * 「change」を変換し、変換後の要素を返すコールバックです。
     * @param change changeとして渡される、このコールバックの入力値です。
     * @returns 入力要素から生成した変換後の値を返します。
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

/**
 * @file index.tsx
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import "katex/dist/katex.min.css";
import { App, preloadMarkdownWorker } from "./App";
import "./cmMarkdownAutocomplete";
import "./editorTheme.css";
import "./editorThemePolish.css";
import "./previewFullWidth.css";
import "./previewImageResizeControls.css";
import "./previewImageContextMenu.css";
import "./tableEditorOverlay.css";
import { getMessages } from "../shared/messages";
import { installEditorThemeController } from "./editorThemeController";
import { installPreviewImageResizeControls } from "./previewImageResizeControls";
import { installPreviewImageContextMenu } from "./previewImageContextMenu";
import { installPreviewImageClipboardPaste } from "./previewImageClipboardPaste";
import { installSelectedTextSearchTransfer } from "./searchSelectedText";
import { installTableEditorOverlay } from "./tableEditorOverlay";

(globalThis as typeof globalThis & {
/**
 * 「__mveBundleExecutedAt」は、位置・サイズ・件数などを表す数値です。
 */
__mveBundleExecutedAt?: number })
  .__mveBundleExecutedAt = performance.now();
preloadMarkdownWorker();

/**
 * 行番号の左クリック完了後に、その論理行のテキスト全体を選択する。
 * CodeMirrorのmousedown処理は妨げず、本文編集・IME・DOM同期へ干渉しない。
 * @param event ルート要素上のクリックイベント。
 * @returns イベントを処理し、状態更新または副作用だけを実行して値は返しません。
 */
function handleLineNumberClick(event: MouseEvent): void {
  if (event.button !== 0 || !(event.target instanceof Element)) return;
  const gutterElement = event.target.closest<HTMLElement>(
    ".cm-lineNumbers .cm-gutterElement",
  );
  if (!gutterElement) return;
  const editorElement = gutterElement.closest<HTMLElement>(".cm-editor");
  if (!editorElement) return;
  const view = EditorView.findFromDOM(editorElement);
  if (!view) return;
  const lineNumber = Number.parseInt(
    gutterElement.textContent?.trim() ?? "",
    10,
  );
  if (
    !Number.isInteger(lineNumber) ||
    lineNumber < 1 ||
    lineNumber > view.state.doc.lines
  )
    return;
  const line = view.state.doc.line(lineNumber);
  view.dispatch({ selection: EditorSelection.range(line.from, line.to) });
  view.focus();
}

/**
 * テーブルエディターのツールボタンを、1回の物理操作につき1回だけ発火させる。
 * Webview/React境界で同じclickが再送されても、新しいpointerdown/keydownがない限り破棄する。
 * @returns 「installTableEditorToolbarActivationGuard」の副作用または状態更新を実行し、値は返しません。
 */
function installTableEditorToolbarActivationGuard(): () => void {
  let activationSerial = 0;
  let consumedSerial = -1;
  let activationButton: HTMLButtonElement | undefined;


  /**
   * 「toolbarButton」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param target 処理対象の対象です。
   * @returns 「toolbarButton」が対象を取得できない場合はundefinedを返します。
   */
  const toolbarButton = /**
 * 「toolbarButton」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param target 処理対象のDOM要素、エディター、または実行コンテキストです。
 * @returns 「toolbarButton」がWebview UI状態の入力を処理して得た固有の結果を返します。
 */ (
    target: EventTarget | null,
  ): HTMLButtonElement | undefined => {
    if (!(target instanceof Element)) return undefined;
    return (
      target.closest<HTMLButtonElement>(".mve-table-editor-toolbar button") ??
      undefined
    );
  };


  /**
   * 「arm」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param button 「button」は、「arm」がWebview UI状態の処理対象を特定する入力です。
   * @returns 「arm」がWebview UI状態の入力を処理して得た固有の結果を返します。
   */
  const arm = /**
 * 「arm」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param button 「button」は、「arm」がWebview UIで処理する対象を特定する入力です。
 * @returns 「arm」がWebview UI状態の入力を処理して得た固有の結果を返します。
 */ (button: HTMLButtonElement) => {
    activationSerial += 1;
    activationButton = button;
  };


  /**
   * 「onPointerDown」は、イベント入力を受け取り、関連する状態またはUIを更新する処理です。
   * @param event 処理対象のイベントです。
   * @returns 「if」を実行し、値を返しません。
   */
  const onPointerDown = /**
 * 「onPointerDown」は、イベント入力を検証し、関連する状態またはUIを更新します。
 * @param event DOMイベントまたは入力イベントの情報です。
 * @returns 「if」を実行し、値を返しません。
 */ (event: PointerEvent) => {
    if (event.button !== 0) return;
    const button = toolbarButton(event.target);
    if (button && !button.disabled) arm(button);
  };


  /**
   * 「onKeyDown」は、イベント入力を受け取り、関連する状態またはUIを更新する処理です。
   * @param event 処理対象のイベントです。
   * @returns 「if」を実行し、値を返しません。
   */
  const onKeyDown = /**
 * 「onKeyDown」は、イベント入力を検証し、関連する状態またはUIを更新します。
 * @param event DOMイベントまたは入力イベントの情報です。
 * @returns 「if」を実行し、値を返しません。
 */ (event: KeyboardEvent) => {
    if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
    const button = toolbarButton(event.target);
    if (button && !button.disabled) arm(button);
  };


  /**
   * 「onClick」は、イベント入力を受け取り、関連する状態またはUIを更新する処理です。
   * @param event 処理対象のイベントです。
   * @returns 「event」から生成した処理結果を返します。
   */
  const onClick = /**
 * 「onClick」は、イベント入力を検証し、関連する状態またはUIを更新します。
 * @param event DOMイベントまたは入力イベントの情報です。
 * @returns 「event」から生成した処理結果を返します。
 */ (event: MouseEvent) => {
    const button = toolbarButton(event.target);
    if (!button || button.disabled) return;

    // 通常のpointer/key操作は直前にarmされる。支援技術等の単発clickは最初の1回だけ許可する。
    if (activationButton !== button) {
      activationSerial += 1;
      activationButton = button;
    }
    if (consumedSerial === activationSerial) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    consumedSerial = activationSerial;
  };

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("click", onClick, true);
  return /** イベント情報を受け取り、DOMまたは画面状態を更新するコールバックです。 @returns 後片付けまたは登録解除を完了した結果を返します。 */ () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("click", onClick, true);
  };
}

/** 「root」は、対象ファイルまたは実行環境の場所を表す値です。 */
const root = document.getElementById("root");
if (!root) throw new Error(getMessages("en").internal.rootNotFound);
root.addEventListener("click", handleLineNumberClick);
installEditorThemeController();
installPreviewImageResizeControls();
installPreviewImageContextMenu();
installPreviewImageClipboardPaste();
installSelectedTextSearchTransfer();
installTableEditorToolbarActivationGuard();
installTableEditorOverlay();

/** Reactのルート要素へアプリケーション本体をStrictMode付きで描画する。 */
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

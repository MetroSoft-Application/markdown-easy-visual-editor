/**
 * @fileoverview Webview Reactツリーの起動点として、Host API、初期設定、メッセージ購読を初期化する。
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import "katex/dist/katex.min.css";
import { App, preloadMarkdownWorker } from "./components/App";
import "./editor/cmMarkdownAutocomplete";
import "./editor/editorTheme.css";
import "./editor/editorThemePolish.css";
import "./preview/previewFullWidth.css";
import "./preview/previewImageResizeControls.css";
import "./preview/previewImageContextMenu.css";
import "./table-editor/tableEditorOverlay.css";
import { getMessages } from "../shared/messages";
import { installEditorThemeController } from "./editor/editorThemeController";
import { installPreviewImageResizeControls } from "./preview/previewImageResizeControls";
import { installPreviewImageContextMenu } from "./preview/previewImageContextMenu";
import { installPreviewImageClipboardPaste } from "./preview/previewImageClipboardPaste";
import { installSelectedTextSearchTransfer } from "./editor/searchSelectedText";
import { installTableEditorOverlay } from "./table-editor/tableEditorOverlay";

(
  globalThis as typeof globalThis & {
    /**
     * Webviewスクリプトの実行開始時刻。診断ログの遅延計測に使う。
     */
    __mveBundleExecutedAt?: number;
  }
).__mveBundleExecutedAt = performance.now();
preloadMarkdownWorker();

/**
 * indexのイベントまたはメッセージを受け取り、状態を更新する。
 * @param event - CodeMirror行番号gutterのclick event。
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
 * 表編集ツールバーの連続clickを抑止し、pointer開始後の正当なクリックは通すイベントガードを登録する。
 * @returns 登録したイベントリスナーを取り除く関数。
 */
function installTableEditorToolbarActivationGuard(): () => void {
  let activationSerial = 0;
  let consumedSerial = -1;
  let activationButton: HTMLButtonElement | undefined;

  const toolbarButton = /**
   * イベント対象またはその祖先にあるツールバーボタンを探す。
   * @param target - クリック対象またはその子要素。要素内のtoolbar buttonを検索する。
   * @returns 見つかったツールバーボタン。対象外の要素またはボタン外ならundefined。
   */ (target: EventTarget | null): HTMLButtonElement | undefined => {
    if (!(target instanceof Element)) return undefined;
    return (
      target.closest<HTMLButtonElement>(".mve-table-editor-toolbar button") ??
      undefined
    );
  };

  const arm = (button: HTMLButtonElement) => {
    activationSerial += 1;
    activationButton = button;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const button = toolbarButton(event.target);
    if (button && !button.disabled) arm(button);
  };

  const onKeyDown = /**
   * keydownイベントでifを実行する。
   * @param event - EnterまたはSpaceによるtoolbar button操作を記録するkeydown event。
   */ (event: KeyboardEvent) => {
    if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
    const button = toolbarButton(event.target);
    if (button && !button.disabled) arm(button);
  };

  const onClick = (event: MouseEvent) => {
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
  return () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("click", onClick, true);
  };
}

/**
 * indexで一時生成物または検証対象を置くディレクトリ。
 */
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

/**
 * ReactアプリをWebviewのroot要素へマウントする。
 */
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

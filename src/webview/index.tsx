/**
 * @fileoverview Webview Reactツリーの起動点として、Host API、初期設定、メッセージ購読を初期化する。
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

(
  globalThis as typeof globalThis & {
    /**
     * indexの・mve・bundle・executed・atを表す数値。
     */
    __mveBundleExecutedAt?: number;
  }
).__mveBundleExecutedAt = performance.now();
preloadMarkdownWorker();

/**
 * indexのイベントまたはメッセージを受け取り、状態を更新する。
 * @param event - ユーザー操作またはDOMから通知されたイベント。
 * @returns 副作用を完了し、値は返さない。
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
 * indexのinstall・table・editor・toolbar・activation・guardを処理し、呼び出し側へ結果または副作用を返す。
 * @returns indexのinstall・table・editor・toolbar・activation・guardが生成する結果。
 */
function installTableEditorToolbarActivationGuard(): () => void {
  let activationSerial = 0;
  let consumedSerial = -1;
  let activationButton: HTMLButtonElement | undefined;

  const toolbarButton = /**
   * indexのtoolbar・buttonを処理し、呼び出し側へ結果または副作用を返す。
   * @param target - indexへ渡す入力。
   * @returns 副作用を完了し、値は返さない。
   */ (target: EventTarget | null): HTMLButtonElement | undefined => {
    if (!(target instanceof Element)) return undefined;
    return (
      target.closest<HTMLButtonElement>(".mve-table-editor-toolbar button") ??
      undefined
    );
  };

  const arm = /**
   * indexのarmを処理し、呼び出し側へ結果または副作用を返す。
   * @param button - indexへ渡す入力。
   * @returns indexのarmが生成する結果。
   */ (button: HTMLButtonElement) => {
    activationSerial += 1;
    activationButton = button;
  };

  const onPointerDown = /**
   * indexのイベントまたはメッセージを受け取り、状態を更新する。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @returns indexのon・pointer・downが生成する結果。
   */ (event: PointerEvent) => {
    if (event.button !== 0) return;
    const button = toolbarButton(event.target);
    if (button && !button.disabled) arm(button);
  };

  const onKeyDown = /**
   * keydownイベントでifを実行する。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @returns 副作用を完了し、値は返さない。
   */ (event: KeyboardEvent) => {
    if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
    const button = toolbarButton(event.target);
    if (button && !button.disabled) arm(button);
  };

  const onClick = /**
   * clickイベントでtoolbar・buttonを実行する。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @returns 副作用を完了し、値は返さない。
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
  /**
   * イベントでremove・event・listenerを実行する。
   * @returns 副作用を完了し、値は返さない。
   */
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
 * indexで使う値または実行環境を組み立てる。
 * @returns indexで生成または変換した値。
 */
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

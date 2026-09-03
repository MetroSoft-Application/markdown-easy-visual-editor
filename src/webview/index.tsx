import React from 'react';
import { createRoot } from 'react-dom/client';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-sans-jp/700.css';
import '@fontsource/noto-sans-mono/400.css';
import 'katex/dist/katex.min.css';
import { App } from './App';
import './cmMarkdownAutocomplete';
import './editorTheme.css';
import './editorThemePolish.css';
import './previewFullWidth.css';
import './previewImageResizeControls.css';
import './tableEditorOverlay.css';
import { getMessages } from '../shared/messages';
import { installEditorThemeController } from './editorThemeController';
import { installPreviewImageResizeControls } from './previewImageResizeControls';
import { installSelectedTextSearchTransfer } from './searchSelectedText';
import { installTableEditorOverlay } from './tableEditorOverlay';

/**
 * 行番号の左クリック完了後に、その論理行のテキスト全体を選択する。
 * CodeMirrorのmousedown処理は妨げず、本文編集・IME・DOM同期へ干渉しない。
 * @param event ルート要素上のクリックイベント。
 */
function handleLineNumberClick(event: MouseEvent): void {
  if (event.button !== 0 || !(event.target instanceof Element)) return;
  const gutterElement = event.target.closest<HTMLElement>('.cm-lineNumbers .cm-gutterElement');
  if (!gutterElement) return;
  const editorElement = gutterElement.closest<HTMLElement>('.cm-editor');
  if (!editorElement) return;
  const view = EditorView.findFromDOM(editorElement);
  if (!view) return;
  const lineNumber = Number.parseInt(gutterElement.textContent?.trim() ?? '', 10);
  if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > view.state.doc.lines) return;
  const line = view.state.doc.line(lineNumber);
  view.dispatch({ selection: EditorSelection.range(line.from, line.to) });
  view.focus();
}

/**
 * テーブルエディターのツールボタンを、1回の物理操作につき1回だけ発火させる。
 * Webview/React境界で同じclickが再送されても、新しいpointerdown/keydownがない限り破棄する。
 */
function installTableEditorToolbarActivationGuard(): () => void {
  let activationSerial = 0;
  let consumedSerial = -1;
  let activationButton: HTMLButtonElement | undefined;

  const toolbarButton = (target: EventTarget | null): HTMLButtonElement | undefined => {
    if (!(target instanceof Element)) return undefined;
    return target.closest<HTMLButtonElement>('.mve-table-editor-toolbar button') ?? undefined;
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

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
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

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('click', onClick, true);
  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('click', onClick, true);
  };
}

const root = document.getElementById('root');
if (!root) throw new Error(getMessages('en').internal.rootNotFound);
root.addEventListener('click', handleLineNumberClick);
installEditorThemeController();
installPreviewImageResizeControls();
installSelectedTextSearchTransfer();
installTableEditorToolbarActivationGuard();
installTableEditorOverlay();

/** Reactのルート要素へアプリケーション本体をStrictMode付きで描画する。 */
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
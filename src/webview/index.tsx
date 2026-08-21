import React from 'react';
import { createRoot } from 'react-dom/client';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-sans-jp/700.css';
import '@fontsource/noto-sans-mono/400.css';
import 'katex/dist/katex.min.css';
import './editorTheme.css';
import { getMessages } from '../shared/messages';
import { installEditorThemeController } from './editorThemeController';

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

const root = document.getElementById('root');
if (!root) throw new Error(getMessages('en').internal.rootNotFound);
root.addEventListener('click', handleLineNumberClick);
installEditorThemeController();

/**
 * Webview API共有を初期化した後にAppを読み込み、Reactルートへ描画する。
 * App内の既存acquireVsCodeApi呼び出しには共有済みインスタンスが返される。
 */
void import('./App').then(({ App }) => {
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});

import React from 'react';
import { createRoot } from 'react-dom/client';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-sans-jp/700.css';
import '@fontsource/noto-sans-mono/400.css';
import 'katex/dist/katex.min.css';
import { App } from './App';
import { getMessages } from '../shared/messages';

/**
 * 行番号の左クリックで、その論理行のテキスト全体を選択する。
 * 本文内の通常クリックはCodeMirror標準のキャレット操作へ任せる。
 * @param event ドキュメント上のマウスダウンイベント。
 */
function handleLineNumberMouseDown(event: MouseEvent): void {
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
  event.preventDefault();
  event.stopPropagation();
  view.dispatch({ selection: EditorSelection.range(line.from, line.to) });
  view.focus();
}

document.addEventListener('mousedown', handleLineNumberMouseDown, true);

const root = document.getElementById('root');
if (!root) throw new Error(getMessages('en').internal.rootNotFound);

/** Reactのルート要素へアプリケーション本体をStrictMode付きで描画する。 */
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

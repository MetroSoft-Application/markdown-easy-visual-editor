import { EditorState, StateEffect, type Extension } from '@codemirror/state';
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  rectangularSelection
} from '@codemirror/view';

/**
 * 既存のCodeMirrorへ矩形選択拡張を一度だけ追加する。
 * Alt+左ドラッグで1行ごとの複数選択範囲を作り、drawSelectionで副選択範囲も描画する。
 */
function attachRectangularSelection(): void {
  if (typeof document === 'undefined') return;

  const configured = new WeakSet<EditorView>();
  const extension: Extension = [
    EditorState.allowMultipleSelections.of(true),
    drawSelection(),
    rectangularSelection({
      eventFilter: (event) => event.button === 0 && event.altKey
    }),
    crosshairCursor({ key: 'Alt' })
  ];

  const install = () => {
    document.querySelectorAll<HTMLElement>('.source-editor .cm-editor').forEach((element) => {
      const view = EditorView.findFromDOM(element);
      if (!view || configured.has(view)) return;
      configured.add(view);
      view.dispatch({ effects: StateEffect.appendConfig.of(extension) });
    });
  };

  const start = () => {
    install();
    const observer = new MutationObserver(install);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    queueMicrotask(start);
  }
}

attachRectangularSelection();

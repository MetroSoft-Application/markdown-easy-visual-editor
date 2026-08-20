import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { bracketMatching } from '@codemirror/language';
import { StateEffect, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';

function attachExtension(extension: Extension): void {
  const configured = new WeakSet<EditorView>();
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
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else queueMicrotask(start);
}

attachExtension([
  bracketMatching(),
  closeBrackets(),
  keymap.of(closeBracketsKeymap)
]);

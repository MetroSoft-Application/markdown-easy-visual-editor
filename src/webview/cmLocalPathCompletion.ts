import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { StateEffect, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i;
const REMOTE_OR_ANCHOR = /^(?:[a-z][a-z0-9+.-]*:|#)/i;

function collectLocalPaths(source: string): string[] {
  const paths = new Set<string>();
  const markdown = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  for (const match of source.matchAll(markdown)) {
    const candidate = match[1]?.trim();
    if (candidate && !REMOTE_OR_ANCHOR.test(candidate)) paths.add(candidate);
  }
  const html = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  for (const match of source.matchAll(html)) {
    const candidate = match[1]?.trim();
    if (candidate && !REMOTE_OR_ANCHOR.test(candidate)) paths.add(candidate);
  }
  return [...paths].sort((a, b) => a.localeCompare(b));
}

function localPathCompletionSource(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const imageMatch = /!\[[^\]]*\]\(([^)\s]*)$/.exec(before);
  const linkMatch = /(?<!!)\[[^\]]*\]\(([^)\s]*)$/.exec(before);
  const match = imageMatch ?? linkMatch;
  if (!match) return null;

  const typed = match[1] ?? '';
  const source = context.state.sliceDoc();
  const candidates = collectLocalPaths(source)
    .filter((path) => !imageMatch || IMAGE_EXTENSION.test(path));
  const fallbacks = imageMatch
    ? ['assets/', './assets/', '../assets/']
    : ['./', '../', 'assets/'];
  const options: Completion[] = [...new Set([...candidates, ...fallbacks])]
    .filter((path) => path !== typed)
    .map((path) => ({
      label: path,
      type: IMAGE_EXTENSION.test(path) ? 'text' : 'property',
      detail: IMAGE_EXTENSION.test(path) ? 'ローカル画像' : 'ローカルパス',
      apply: path
    }));
  if (!options.length && !context.explicit) return null;
  return {
    from: context.pos - typed.length,
    options,
    validFor: /^[^\s)]*$/
  };
}

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

attachExtension(autocompletion({
  override: [localPathCompletionSource],
  activateOnTyping: true,
  selectOnOpen: true
}));

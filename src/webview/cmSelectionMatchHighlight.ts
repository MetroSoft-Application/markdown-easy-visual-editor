import { StateEffect, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

export interface SelectionMatchRange {
  from: number;
  to: number;
}

const MAX_MATCHES = 5000;

/**
 * 明示選択された文字列と完全に同じ文字列の出現位置を返す。
 * 大文字小文字・空白・改行を一切正規化せず、重なった一致も対象にする。
 * 現在選択している範囲そのものだけは一致表示から除外する。
 */
export function findExactSelectionMatches(
  source: string,
  query: string,
  selectionFrom: number,
  selectionTo: number,
  maxMatches = MAX_MATCHES
): SelectionMatchRange[] {
  if (!query || maxMatches <= 0) return [];

  const matches: SelectionMatchRange[] = [];
  let searchFrom = 0;
  while (searchFrom <= source.length - query.length && matches.length < maxMatches) {
    const found = source.indexOf(query, searchFrom);
    if (found < 0) break;
    const to = found + query.length;
    if (found !== selectionFrom || to !== selectionTo) {
      matches.push({ from: found, to });
    }
    // 1文字だけ進め、"ana" in "banana" のような重なった一致も拾う。
    searchFrom = found + 1;
  }
  return matches;
}

/** 現在の明示選択に対応する一致Decorationを作る。 */
function createSelectionMatchDecorations(view: EditorView): DecorationSet {
  const selection = view.state.selection;
  // 複数選択では「どの文字列を基準にするか」を勝手に決めない。
  if (selection.ranges.length !== 1) return Decoration.none;

  const range = selection.main;
  if (range.empty) return Decoration.none;

  const query = view.state.doc.sliceString(range.from, range.to, '\n');
  const source = view.state.doc.toString();
  const matches = findExactSelectionMatches(source, query, range.from, range.to);
  return Decoration.set(
    matches.map(({ from, to }) => Decoration.mark({ class: 'cm-exact-selection-match' }).range(from, to))
  );
}

const exactSelectionMatchPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = createSelectionMatchDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.selectionSet) {
      this.decorations = createSelectionMatchDecorations(update.view);
    }
  }
}, {
  decorations: (plugin) => plugin.decorations
});

const exactSelectionMatchTheme = EditorView.baseTheme({
  '.cm-exact-selection-match': {
    backgroundColor: 'var(--vscode-editor-selectionHighlightBackground, rgba(173, 214, 255, 0.22))',
    borderRadius: '2px'
  }
});

/** 生成済みCodeMirrorへ一致ハイライト拡張を一度だけ追加する。 */
function attachExtension(extension: Extension): void {
  if (typeof document === 'undefined') return;
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

attachExtension([exactSelectionMatchPlugin, exactSelectionMatchTheme]);

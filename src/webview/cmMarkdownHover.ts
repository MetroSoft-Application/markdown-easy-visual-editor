import { StateEffect, type Extension } from '@codemirror/state';
import { EditorView, hoverTooltip } from '@codemirror/view';

interface MarkdownHoverTarget {
  from: number;
  to: number;
  kind: 'image' | 'link';
  label: string;
  destination: string;
}

function findHoverTarget(view: EditorView, pos: number): MarkdownHoverTarget | undefined {
  const line = view.state.doc.lineAt(pos);
  const relativePos = pos - line.from;
  const pattern = /(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  for (const match of line.text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (relativePos < start || relativePos > end) continue;
    return {
      from: line.from + start,
      to: line.from + end,
      kind: match[1] ? 'image' : 'link',
      label: match[2] || (match[1] ? 'image' : 'link'),
      destination: match[3]
    };
  }
  return undefined;
}

const markdownHover = hoverTooltip((view, pos) => {
  const target = findHoverTarget(view, pos);
  if (!target) return null;
  const isRemote = /^(?:https?|mailto|tel|ftp):/i.test(target.destination);
  const isAnchor = target.destination.startsWith('#');
  const scope = isRemote ? 'remote' : isAnchor ? 'document anchor' : 'local';
  return {
    pos: target.from,
    end: target.to,
    above: true,
    arrow: true,
    create() {
      const dom = document.createElement('div');
      dom.className = 'mve-markdown-hover';
      const title = document.createElement('strong');
      title.textContent = `${target.kind === 'image' ? 'Image' : 'Link'} · ${scope}`;
      const label = document.createElement('div');
      label.className = 'mve-markdown-hover-label';
      label.textContent = target.label;
      const destination = document.createElement('code');
      destination.textContent = target.destination;
      dom.append(title, label, destination);
      return { dom };
    }
  };
}, { hoverTime: 250, hideOnChange: true });

const hoverTheme = EditorView.baseTheme({
  '.mve-markdown-hover': {
    maxWidth: '480px',
    padding: '8px 10px',
    border: '1px solid var(--vscode-editorHoverWidget-border, var(--vscode-widget-border))',
    borderRadius: '4px',
    backgroundColor: 'var(--vscode-editorHoverWidget-background, var(--vscode-editor-background))',
    color: 'var(--vscode-editorHoverWidget-foreground, var(--vscode-editor-foreground))',
    boxShadow: '0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.2))'
  },
  '.mve-markdown-hover-label': {
    marginTop: '4px',
    color: 'var(--vscode-descriptionForeground)'
  },
  '.mve-markdown-hover code': {
    display: 'block',
    marginTop: '6px',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere'
  }
});

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

attachExtension([markdownHover, hoverTheme]);

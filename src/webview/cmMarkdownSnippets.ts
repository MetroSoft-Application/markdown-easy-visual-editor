import {
  autocompletion,
  snippetCompletion,
  type CompletionContext,
  type CompletionResult
} from '@codemirror/autocomplete';
import { StateEffect, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

const snippetOptions = [
  snippetCompletion('| ${1:Column A} | ${2:Column B} |\n| --- | --- |\n| ${3:Value A} | ${4:Value B} |\n${0}', {
    label: '/table',
    detail: 'Markdown table',
    type: 'text'
  }),
  snippetCompletion('```mermaid\ngraph TD\n\t${1:A} --> ${2:B}\n```\n${0}', {
    label: '/mermaid',
    detail: 'Mermaid diagram',
    type: 'text'
  }),
  snippetCompletion('[^${1:id}]: ${2:note}\n${0}', {
    label: '/footnote',
    detail: 'Footnote definition',
    type: 'text'
  }),
  snippetCompletion('<details>\n<summary>${1:Summary}</summary>\n\n${2:Details}\n\n</details>\n${0}', {
    label: '/details',
    detail: 'Details block',
    type: 'text'
  }),
  snippetCompletion('> [!NOTE]\n> ${1:Text}\n${0}', {
    label: '/note',
    detail: 'Alert note',
    type: 'text'
  }),
  snippetCompletion('```${1:language}\n${2:code}\n```\n${0}', {
    label: '/code',
    detail: 'Code block',
    type: 'text'
  }),
  snippetCompletion('[${1:label}](${2:https://example.com})${0}', {
    label: '/link',
    detail: 'Markdown link',
    type: 'text'
  }),
  snippetCompletion('![${1:alt}](${2:assets/image.png})${0}', {
    label: '/image',
    detail: 'Markdown image',
    type: 'text'
  })
] as const;

function snippetSource(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const match = /^\s*(\/[a-z-]*)$/i.exec(before);
  if (!match && !context.explicit) return null;
  const token = match?.[1] ?? '';
  return {
    from: match ? context.pos - token.length : context.pos,
    options: snippetOptions,
    validFor: /^\/[a-z-]*$/i
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
  override: [snippetSource],
  activateOnTyping: true,
  selectOnOpen: true
}));

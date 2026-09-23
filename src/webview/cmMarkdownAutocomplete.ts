/**
 * @fileoverview Webviewのcmmarkdownautocompleteを管理する。Hostとの通信、ユーザー操作、表示状態の契約を保つ。
 */
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { StateEffect, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/**
 * cmmarkdownautocompleteで解析・表示・保存する本文。
 */
const allMarkdownOptions: readonly Completion[] = [
    { label: '# Heading 1', detail: '見出し1', type: 'keyword', apply: '# ' },
    { label: '## Heading 2', detail: '見出し2', type: 'keyword', apply: '## ' },
    { label: '### Heading 3', detail: '見出し3', type: 'keyword', apply: '### ' },
    { label: '- Bullet list', detail: '箇条書き', type: 'keyword', apply: '- ' },
    { label: '- [ ] Task', detail: 'タスクリスト', type: 'keyword', apply: '- [ ] ' },
    { label: '--- Horizontal rule', detail: '水平線', type: 'keyword', apply: '---' },
    { label: '> Blockquote', detail: '引用', type: 'keyword', apply: '> ' },
    { label: '[Link](url)', detail: 'リンク', type: 'text', apply: '[label](https://example.com)' },
    { label: '![Image](path)', detail: '画像', type: 'text', apply: '![alt](assets/image.png)' },
    { label: '`Inline code`', detail: 'インラインコード', type: 'text', apply: '`code`' },
    { label: '``` Code block', detail: 'コードブロック', type: 'text', apply: '```\ncode\n```' },
    { label: '$ Inline math', detail: 'インライン数式', type: 'text', apply: '$x$' },
    { label: '$$ Math block', detail: '数式ブロック', type: 'text', apply: '$$\nx\n$$' },
    { label: '[^id] Footnote', detail: '脚注参照', type: 'text', apply: '[^id]' }
];

/**
 * cmmarkdownautocompleteのoptions・for・triggerを処理し、呼び出し側へ結果または副作用を返す。
 * @param trigger - cmmarkdownautocompleteで受け渡す文字列。
 * @returns cmmarkdownautocompleteに対応する要素の一覧。
 */
function optionsForTrigger(trigger: string): readonly Completion[] {
    if (trigger.startsWith('#')) return allMarkdownOptions.slice(0, 3);
    if (trigger === '-') return allMarkdownOptions.slice(3, 6);
    if (trigger === '>') return [allMarkdownOptions[6]];
    if (trigger === '[') return [allMarkdownOptions[7], allMarkdownOptions[13]];
    if (trigger === '!') return [allMarkdownOptions[8]];
    if (trigger.startsWith('`')) return [allMarkdownOptions[9], allMarkdownOptions[10]];
    if (trigger.startsWith('$')) return [allMarkdownOptions[11], allMarkdownOptions[12]];
    if (trigger === '^') return [allMarkdownOptions[13]];
    return allMarkdownOptions;
}

/**
 * cmmarkdownautocompleteの変更または利用者の操作意図を記録し、後続処理へ渡す。
 * @param context - cmmarkdownautocompleteで扱う文字列または本文。
 * @returns cmmarkdownautocompleteのmarkdown・completion・sourceが生成する結果。
 */
function markdownCompletionSource(context: CompletionContext): CompletionResult | null {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    const match = /(?:^|\s)(#{1,6}|-|>|\[|!|`{1,3}|\${1,2}|\^)$/.exec(before);
    if (!match && !context.explicit) return null;
    const trigger = match?.[1] ?? '';
    return {
        from: match ? context.pos - trigger.length : context.pos,
        options: optionsForTrigger(trigger),
        filter: true
    };
}

/**
 * cmmarkdownautocompleteのattach・extensionを処理し、呼び出し側へ結果または副作用を返す。
 * @param extension - cmmarkdownautocompleteの位置・寸法・件数・時間を表す数値。
 * @returns 副作用を完了し、値は返さない。
 */
function attachExtension(extension: Extension): void {
    const configured = new WeakSet<EditorView>();


    const install = /**
     * cmmarkdownautocompleteのinstallを処理し、呼び出し側へ結果または副作用を返す。
     * @returns cmmarkdownautocompleteのinstallが生成する結果。
     */ () => {
            document.querySelectorAll<HTMLElement>('.source-editor .cm-editor').forEach(
                /**
                 * 要素ごとにfind・from・domを実行する。
                 * @param element - 寸法または属性を読み取るDOM要素。
                 * @returns 副作用を完了し、値は返さない。
                 */
                (element) => {
                    const view = EditorView.findFromDOM(element);
                    if (!view || configured.has(view)) return;
                    configured.add(view);
                    view.dispatch({ effects: StateEffect.appendConfig.of(extension) });
                });
        };


    const start = /**
     * cmmarkdownautocompleteの表示または操作を開始する。
     * @returns cmmarkdownautocompleteのstartが生成する結果。
     */ () => {
            install();
            const observer = new MutationObserver(install);
            observer.observe(document.documentElement, { childList: true, subtree: true });
        };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else queueMicrotask(start);
}

attachExtension(autocompletion({
    override: [markdownCompletionSource],
    activateOnTyping: true,
    selectOnOpen: true
}));

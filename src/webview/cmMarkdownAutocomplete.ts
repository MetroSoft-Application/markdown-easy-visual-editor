/**
 * @file cmMarkdownAutocomplete.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { StateEffect, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/** 「allMarkdownOptions」は、呼び出し先へ渡す設定値の集合です。 */
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
 * 「optionsForTrigger」は、関連する画面または処理の設定と現在状態を保持します。
 * @param trigger 「trigger」は、「optionsForTrigger」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「optionsForTrigger」がWebview UI状態の入力を処理して得た固有の結果を返します。
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
 * 「markdownCompletionSource」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param context 「context」は、「markdownCompletionSource」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「markdownCompletionSource」が生成または整形したWebview UI状態の文字列を返します。
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
 * 「attachExtension」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param extension 「extension」は、「attachExtension」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「attachExtension」の副作用または状態更新を実行し、値は返しません。
 */
function attachExtension(extension: Extension): void {
    const configured = new WeakSet<EditorView>();

    /**
     * 「install」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
     * @returns 「install」がWebview UI状態の入力を処理して得た固有の結果を返します。
     */
    const install = /**
 * 「install」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @returns 「install」がWebview UI状態の入力を処理して得た固有の結果を返します。
 */ () => {
        document.querySelectorAll<HTMLElement>('.source-editor .cm-editor').forEach(
        /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
         * @param element 処理対象の要素です。
         * @returns 「EditorView.findFromDOM」を実行し、値を返しません。
         */
        (element) => {
            const view = EditorView.findFromDOM(element);
            if (!view || configured.has(view)) return;
            configured.add(view);
            view.dispatch({ effects: StateEffect.appendConfig.of(extension) });
        });
    };

    /**
     * startを開始します。
     * @returns 「start」が開始した処理の結果または非同期Promiseを返します。
     */
    const start = /**
 * 「start」は、処理を開始し、必要な実行状態を準備します。
 * @returns 「start」が開始した処理の結果または非同期Promiseを返します。
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

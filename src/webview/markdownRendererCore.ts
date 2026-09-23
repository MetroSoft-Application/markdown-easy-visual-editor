/**
 * @fileoverview Markdownを段階的に解析・変換し、HTML・見出し・画像情報を安定した中間結果へまとめる。
 */
import katex from 'katex';
import { Marked, Renderer, type Token } from 'marked';
import { getOutline, slugify } from '../shared/markdown';
import { getMessages, type Messages, type SupportedLanguage } from '../shared/messages';
import { stripMveTextColorMarkup } from '../shared/textColor';

/**
 * Markdown変換へ渡す設定項目と既定値のデータ形状。
 */
export interface RenderOptions {

    /**
     * Markdown変換のremote・images・enabledを示す状態フラグ。
     */
    remoteImagesEnabled: boolean;

    /**
     * Markdown変換のlanguageに関する状態または設定。
     */
    language?: SupportedLanguage;
}

/**
 * Markdown変換で共有するデータ形状を表すインターフェース。
 */
interface CustomToken {

    /**
     * Markdown変換で対象や分岐を識別する値の型。
     */
    type: string;

    /**
     * Markdown変換で扱うrawの文字列。
     */
    raw: string;

    /**
     * 表示・解析・変換の対象となる本文。
     */
    text: string;

    /**
     * Markdown変換のtokensに関する状態または設定。
     */
    tokens?: Token[];
}

/**
 * Markdown変換で共有するデータ形状を表すインターフェース。
 */
interface FootnoteDefinition {

    /**
     * Markdown変換で扱うidの文字列。
     */
    id: string;

    /**
     * 表示・解析・変換の対象となる本文。
     */
    text: string;

    /**
     * Markdown変換のfromを表す数値。
     */
    from: number;

    /**
     * Markdown変換のtoを表す数値。
     */
    to: number;
}

/**
 * Markdown変換で共有するデータ形状を表すインターフェース。
 */
export interface UnsafeMarkdownBlock {

    /**
     * 表示または出力するHTML本文。
     */
    html: string;

    /**
     * Markdown変換のrequires・sanitizationを切り替えるフラグ。
     */
    requiresSanitization: boolean;
}

/**
 * Markdown変換のcode・highlighterを処理し、呼び出し側へ結果または副作用を返す。
 * @param text - 表示・解析・変換の対象となる本文。
 * @param language - Markdown変換の対象や分岐を識別する値。
 * @returns Markdown変換に対応する要素の一覧。
 */
export type CodeHighlighter = (text: string, language: string) => string | undefined;

/**
 * Markdown変換を表示用の結果へ変換する。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param options - 呼び出し側が指定する処理設定。
 * @param highlightCode - Markdown変換へ渡す入力。
 * @returns Markdown変換に対応する要素の一覧。
 */
export function renderMarkdownUnsafeBlocks(
    markdown: string,
    options: RenderOptions,
    highlightCode?: CodeHighlighter
): UnsafeMarkdownBlock[] {
    // 見出しIDと脚注参照番号を1回の描画中だけ保持し、同名見出しや複数参照を区別する。
    const messages = getMessages(options.language ?? 'ja');
    const renderer = new Renderer();
    const headingIds = new Map<string, number>();
    const footnoteDefinitions = collectFootnoteDefinitions(markdown);
    const footnoteCounts = new Map<string, number>();
    let imageIndex = 0;

    /**
     * Markdown変換で扱う一覧または対応表。
     */
    renderer.heading =
        /**
         * Markdown変換のfunctionを処理し、呼び出し側へ結果または副作用を返す。
         * @param options - 呼び出し側が指定する処理設定。
         * @returns Markdown変換のfunctionが生成する結果。
         */
        function ({ tokens, depth }) {
            const content = this.parser.parseInline(tokens);
            const plain = stripMveTextColorMarkup(
                tokens.map(
                    /**
                     * 各tokenからrawを取り出して一覧化する。
                     * @param token - tokenのrawを参照する走査対象。
                     * @returns rawを取り出した変換結果の一覧。
                     */
                    (token) => token.raw).join('')
            );
            const explicit = /\s+\{#([^}]+)\}\s*$/.exec(plain);
            const base = explicit?.[1] ?? slugify(plain.replace(/\s+\{#[^}]+\}\s*$/, ''));
            const count = headingIds.get(base) ?? 0;
            headingIds.set(base, count + 1);
            const id = count ? `${base}-${count}` : base;
            return `<h${depth} id="${escapeAttribute(id)}">${content.replace(/\s+\{#[^}]+\}(?=(?:<\/span>)*\s*$)/, '')}</h${depth}>`;
        };

    /**
     * Markdown変換で扱う一覧または対応表。
     */
    renderer.link =
        /**
         * Markdown変換のfunctionを処理し、呼び出し側へ結果または副作用を返す。
         * @param options - 呼び出し側が指定する処理設定。
         * @returns Markdown変換のfunctionが生成する結果。
         */
        function ({ href, title, tokens }) {
            const content = this.parser.parseInline(tokens);
            const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : '';
            if (isLocalMarkdownLink(href)) {
                return `<a href="#" data-mve-link="${escapeAttribute(href)}"${titleAttribute}>${content}</a>`;
            }
            return `<a href="${escapeAttribute(href)}"${titleAttribute}>${content}</a>`;
        };

    /**
     * 設定をifへ渡し、Markdown変換の結果または副作用を処理する。
     * @param options - 呼び出し側が指定する処理設定。
     * @returns Markdown変換のコールバックが生成する結果。
     */
    renderer.image =
        /**
         * Markdown変換の入力を検証し、表示または保存に使う形式へ変換する。
         * @param options - 呼び出し側が指定する処理設定。
         * @returns Markdown変換のimageが生成する結果。
         */
        ({ href, title, text }) => {
            const currentImageIndex = imageIndex++;
            if (!options.remoteImagesEnabled && /^https?:/i.test(href)) {
                return `<span class="blocked-image" title="${escapeAttribute(messages.renderer.remoteImageDisabled)}">🖼️ ${escapeHtml(text || href)}</span>`;
            }
            const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : '';
            const resizable = !/^https?:\/\//i.test(href);
            return `<img src="${escapeAttribute(href)}" loading="lazy" decoding="async" data-original-src="${escapeAttribute(href)}" data-mve-image-index="${currentImageIndex}" data-mve-image-kind="markdown" data-mve-image-align="left" data-mve-resizable="${resizable ? 'true' : 'false'}" data-mve-can-reset="false" alt="${escapeAttribute(text)}"${titleAttribute}>`;
        };

    /**
     * 設定をtrimへ渡し、Markdown変換の結果または副作用を処理する。
     * @param options - 呼び出し側が指定する処理設定。
     * @returns Markdown変換のコールバックが生成する結果。
     */
    renderer.code =
        /**
         * Markdown変換のcodeを処理し、呼び出し側へ結果または副作用を返す。
         * @param options - 呼び出し側が指定する処理設定。
         * @returns Markdown変換のcodeが生成する結果。
         */
        ({ text, lang }) => {
            const language = (lang || '').trim().split(/\s+/)[0].toLowerCase();
            if (language === 'mermaid') {
                return `<div class="diagram-block mermaid" data-mermaid-source="${escapeAttribute(encodeURIComponent(text))}">${escapeHtml(text)}</div>`;
            }
            const highlighted = highlightCode?.(text, language) ?? escapeHtml(text);
            return `<figure class="code-figure" data-language="${escapeAttribute(language)}"><figcaption><span>${escapeHtml(language || messages.editor.plainText)}</span><button type="button" data-copy-code="true">${messages.renderer.copy}</button></figcaption><pre><code class="hljs language-${escapeAttribute(language)}">${highlighted}</code></pre></figure>`;
        };

    /**
     * 設定をifへ渡し、Markdown変換の結果または副作用を処理する。
     * @param options - 呼び出し側が指定する処理設定。
     * @returns Markdown変換のコールバックが生成する結果。
     */
    renderer.html =
        /**
         * Markdown変換のhtmlを処理し、呼び出し側へ結果または副作用を返す。
         * @param options - 呼び出し側が指定する処理設定。
         * @returns Markdown変換のhtmlが生成する結果。
         */
        ({ text }) => {
            if (/^<!--\s*pagebreak\s*-->$/i.test(text.trim())) return `<div class="page-break" aria-label="${escapeAttribute(messages.renderer.pageBreak)}"></div>`;
            return decorateHtmlImages(text,
                /**
                 * Markdown変換の前提条件を準備し、回帰条件を検証するテストケース。
                 * @returns テストケースを実行し、値は返さない。
                 */
                () => imageIndex++);
        };

    // 標準Markdownの解析器へ独自記法を登録し、拡張記法も同じトークン処理へ流す。
    const parser = new Marked({ gfm: true, breaks: false, renderer });
    parser.use({
        extensions: [
            inlineDelimited('highlight', /^==(?=\S)([\s\S]*?\S)==/, 'mark'),
            inlineDelimited('inserted', /^\+\+(?=\S)([\s\S]*?\S)\+\+/, 'ins'),
            inlineDelimited('superscript', /^\^(?=\S)([^\n^]*?\S)\^/, 'sup'),
            inlineDelimited('subscript', /^~(?=\S)([^\n~]*?\S)~/, 'sub'),
            mathBlockExtension(messages),
            mathInlineExtension(messages),
            tocExtension(markdown, messages),
            footnoteDefinitionExtension(),
            footnoteReferenceExtension(footnoteDefinitions, footnoteCounts)
        ]
    });

    // トークンを元本文の範囲へ対応付け、プレビュー要素から編集位置へ戻れるようにする。
    const tokens = parser.lexer(markdown);
    const ranges = locateTokenRanges(markdown, tokens);
    const links = (tokens as typeof tokens & {
        /**
         * Markdown変換で扱うlinksの文字列。
         */
        links?: Record<string, unknown>
    }).links;
    // ブロック単位でHTMLを描画して出典範囲属性を付け、脚注セクションを本文末尾へ追加する。
    const blocks = tokens.map(
        /**
         * 各tokenからlistを取り出して一覧化する。
         * @param token - tokenのlistを参照する走査対象。
         * @param index - 配列・行列・文字列の要素位置を示す番号。
         * @returns listを取り出した変換結果の一覧。
         */
        (token, index): UnsafeMarkdownBlock | undefined => {
            const tokenList = Object.assign([token], { links });
            const rendered = String(parser.parser(tokenList));
            if (!rendered.trim()) return undefined;
            const range = ranges[index];
            return {
                html: `<div class="markdown-source-block" data-source-from="${range.from}" data-source-to="${range.to}">${rendered}</div>`,
                // コード/Mermaid本文と属性はrenderer.code内ですべてエスケープ済み。
                requiresSanitization: token.type !== 'code'
            };
        }).filter(
            /**
             * 条件を満たすblockだけを残す。
             * @param block - Markdown変換へ渡す入力。
             * @returns 条件を満たした要素だけを含む一覧。
             */
            (block): block is UnsafeMarkdownBlock => block !== undefined);
    const footnotes = renderFootnoteSection(footnoteDefinitions, messages);
    if (footnotes) blocks.push({ html: footnotes, requiresSanitization: false });
    // 各トップレベルブロックを独立させ、UI側でDOMPurifyを短時間ずつ実行できるようにする。
    return blocks.map(
        /**
         * 各blockからhtmlを取り出して一覧化する。
         * @param block - blockのhtmlを参照する走査対象。
         * @returns htmlを取り出した変換結果の一覧。
         */
        (block) => ({ ...block, html: renderAlerts(block.html, messages) }));
}

/**
 * Markdown変換を表示用の結果へ変換する。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param options - 呼び出し側が指定する処理設定。
 * @param highlightCode - Markdown変換へ渡す入力。
 * @returns Markdown変換で利用する文字列。
 */
export function renderMarkdownUnsafe(
    markdown: string,
    options: RenderOptions,
    highlightCode?: CodeHighlighter
): string {
    return renderMarkdownUnsafeBlocks(markdown, options, highlightCode).map(
        /**
         * 各blockからhtmlを取り出して一覧化する。
         * @param block - blockのhtmlを参照する走査対象。
         * @returns htmlを取り出した変換結果の一覧。
         */
        (block) => block.html).join('');
}

/**
 * Markdown変換の条件を判定する。
 * @param href - リンク操作領域の遷移先URI。
 * @returns 条件が成立したかを示す真偽値。
 */
function isLocalMarkdownLink(href: string): boolean {
    if (!href || href.startsWith('#')) return false;
    if (/^https?:\/\/file\+\.vscode-resource\.vscode-cdn\.net\//i.test(href)) return true;
    if (/^(?:file:|[A-Za-z]:[\\/]|\\\\|\/\/)/i.test(href)) return true;
    return !/^(?:https?|mailto|tel|ftp|data|javascript):/i.test(href);
}

/**
 * Markdown変換のdecorate・html・imagesを処理し、呼び出し側へ結果または副作用を返す。
 * @param html - 表示または出力するHTML本文。
 * @param nextIndex - Markdown変換の位置・寸法・件数・時間を表す数値。
 * @returns Markdown変換で利用する文字列。
 */
function decorateHtmlImages(html: string, nextIndex: () => number): string {
    return html.replace(/<img\b[^>]*>/gi,
        /**
         * Markdown変換の前提条件を準備し、回帰条件を検証するテストケース。
         * @param tag - テスト本体を実行するコールバック。
         * @returns テストケースを実行し、値は返さない。
         */
        (tag) => {
            const source = readHtmlAttribute(tag, 'src') ?? '';
            const index = nextIndex();
            let decorated = upsertHtmlAttribute(tag, 'data-original-src', readHtmlAttribute(tag, 'data-original-src') ?? source);
            decorated = upsertHtmlAttribute(decorated, 'data-mve-image-index', String(index));
            decorated = upsertHtmlAttribute(decorated, 'data-mve-image-kind', 'html');
            decorated = upsertHtmlAttribute(decorated, 'data-mve-image-align', normalizeImageAlignment(readHtmlAttribute(tag, 'align')));
            decorated = upsertHtmlAttribute(decorated, 'data-mve-resizable', /^https?:\/\//i.test(source) ? 'false' : 'true');
            decorated = upsertHtmlAttribute(decorated, 'data-mve-can-reset', hasHtmlAttribute(tag, 'width') ? 'true' : 'false');
            if (!readHtmlAttribute(tag, 'loading')) decorated = upsertHtmlAttribute(decorated, 'loading', 'lazy');
            if (!readHtmlAttribute(tag, 'decoding')) decorated = upsertHtmlAttribute(decorated, 'decoding', 'async');
            return decorated;
        });
}

/**
 * Markdown変換の入力を許可された形式へ整える。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns Markdown変換で生成または変換した値。
 */
function normalizeImageAlignment(value: string | undefined): 'left' | 'center' | 'right' {
    return value === 'center' || value === 'right' ? value : 'left';
}

/**
 * Markdown変換から必要な値またはリソースを取得する。
 * @param tag - Markdown変換で受け渡す文字列。
 * @param name - Markdown変換の対象や分岐を識別する値。
 * @returns 副作用を完了し、値は返さない。
 */
function readHtmlAttribute(tag: string, name: string): string | undefined {
    const pattern = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
    const match = pattern.exec(tag);
    return match?.[1] ?? match?.[2] ?? match?.[3];
}

/**
 * Markdown変換のupsert・html・attributeを処理し、呼び出し側へ結果または副作用を返す。
 * @param tag - Markdown変換で受け渡す文字列。
 * @param name - Markdown変換の対象や分岐を識別する値。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns Markdown変換で利用する文字列。
 */
function upsertHtmlAttribute(tag: string, name: string, value: string): string {
    const pattern = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
    const escaped = escapeAttribute(value);
    if (pattern.test(tag)) return tag.replace(pattern, ` ${name}="${escaped}"`);
    const closing = tag.endsWith('/>') ? '/>' : '>';
    return tag.slice(0, -closing.length) + ` ${name}="${escaped}"` + closing;
}

/**
 * Markdown変換の条件を判定する。
 * @param tag - Markdown変換で受け渡す文字列。
 * @param name - Markdown変換の対象や分岐を識別する値。
 * @returns 条件が成立したかを示す真偽値。
 */
function hasHtmlAttribute(tag: string, name: string): boolean {
    return new RegExp(`\\s${escapeRegExp(name)}\\s*=`, 'i').test(tag);
}

/**
 * Markdown変換の入力を許可された形式へ整える。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns Markdown変換で利用する文字列。
 */
function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Markdown変換のinline・delimitedを処理し、呼び出し側へ結果または副作用を返す。
 * @param name - Markdown変換の対象や分岐を識別する値。
 * @param rule - Markdown変換へ渡す入力。
 * @param tag - Markdown変換で受け渡す文字列。
 * @returns Markdown変換のinline・delimitedが生成する結果。
 */
function inlineDelimited(name: string, rule: RegExp, tag: string): any {
    return {
        name,
        level: 'inline',
        /**
         * Markdown変換の表示または操作を開始する。
         * @param source - 解析・描画・変換の起点となる本文。
         * @returns Markdown変換で利用する文字列。
         */
        start(source: string) {
            const markers: Record<string, string> = { highlight: '==', inserted: '++', superscript: '^', subscript: '~' };
            const found = source.indexOf(markers[name]);
            return found >= 0 ? found : undefined;
        },
        /**
         * Markdown変換の入力を構造化した値へ変換する。
         * @param source - 解析・描画・変換の起点となる本文。
         * @returns Markdown変換のtokenizerが生成する結果。
         */
        tokenizer(source: string) {
            const match = rule.exec(source);
            if (!match) return undefined;
            const token: CustomToken = { type: name, raw: match[0], text: match[1] };
            token.tokens = this.lexer.inlineTokens(token.text);
            return token;
        },
        /**
         * Markdown変換を表示用の結果へ変換する。
         * @param this - Markdown変換へ渡す入力。
         * @param token - Markdown変換で走査または更新する要素。
         * @returns Markdown変換で生成または変換した値。
         */
        renderer(this: {
            /**
             * Markdown変換の入力を構造化した値へ変換する。
             * @param tokens - Markdown変換で走査または更新する要素。
             * @returns Markdown変換で生成または変換した値。
             */
            parser: {
                /**
                 * Markdown変換の入力を構造化した値へ変換する。
                 * @param tokens - Markdown変換で走査または更新する要素。
                 * @returns Markdown変換で生成または変換した値。
                 */
                parseInline: (tokens: Token[]) => string
            }
        }, token: CustomToken) {
            return `<${tag}>${this.parser.parseInline(token.tokens ?? [])}</${tag}>`;
        }
    };
}

/**
 * Markdown変換のmath・block・extensionを処理し、呼び出し側へ結果または副作用を返す。
 * @param messages - Markdown変換で扱う文字列または本文。
 * @returns Markdown変換のmath・block・extensionが生成する結果。
 */
function mathBlockExtension(messages: Messages): any {
    return {
        name: 'mathBlock',
        level: 'block',
        /**
         * Markdown変換の表示または操作を開始する。
         * @param source - 解析・描画・変換の起点となる本文。
         * @returns Markdown変換のstartが生成する結果。
         */
        start(source: string) {
            const found = source.indexOf('$$');
            return found >= 0 ? found : undefined;
        },
        /**
         * Markdown変換の入力を構造化した値へ変換する。
         * @param source - 解析・描画・変換の起点となる本文。
         * @returns Markdown変換のtokenizerが生成する結果。
         */
        tokenizer(source: string) {
            const match = /^\$\$[ \t]*\n?([\s\S]+?)\n?[ \t]*\$\$(?:\n|$)/.exec(source);
            if (!match) return undefined;
            return { type: 'mathBlock', raw: match[0], text: match[1].trim() } as CustomToken;
        },
        /**
         * Markdown変換を表示用の結果へ変換する。
         * @param token - Markdown変換で走査または更新する要素。
         * @returns Markdown変換で生成または変換した値。
         */
        renderer(token: CustomToken) {
            const source = token.text;
            return renderKatex(source, true, messages);
        }
    };
}

/**
 * Markdown変換のmath・inline・extensionを処理し、呼び出し側へ結果または副作用を返す。
 * @param messages - Markdown変換で扱う文字列または本文。
 * @returns Markdown変換のmath・inline・extensionが生成する結果。
 */
function mathInlineExtension(messages: Messages): any {
    return {
        name: 'mathInline',
        level: 'inline',
        /**
         * Markdown変換の表示または操作を開始する。
         * @param source - 解析・描画・変換の起点となる本文。
         * @returns Markdown変換のstartが生成する結果。
         */
        start(source: string) {
            const found = source.indexOf('$');
            return found >= 0 ? found : undefined;
        },
        /**
         * Markdown変換の入力を構造化した値へ変換する。
         * @param source - 解析・描画・変換の起点となる本文。
         * @returns Markdown変換のtokenizerが生成する結果。
         */
        tokenizer(source: string) {
            const match = /^\$(?!\s|\$)([^\n$]*?\S)\$(?!\$)/.exec(source);
            if (!match) return undefined;
            return { type: 'mathInline', raw: match[0], text: match[1] } as CustomToken;
        },
        /**
         * Markdown変換を表示用の結果へ変換する。
         * @param token - Markdown変換で走査または更新する要素。
         * @returns Markdown変換で生成または変換した値。
         */
        renderer(token: CustomToken) {
            return renderKatex(token.text, false, messages);
        }
    };
}

/**
 * Markdown変換のtoc・extensionを処理し、呼び出し側へ結果または副作用を返す。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param messages - Markdown変換で扱う文字列または本文。
 * @returns Markdown変換のtoc・extensionが生成する結果。
 */
function tocExtension(markdown: string, messages: Messages): any {
    return {
        name: 'tableOfContents',
        level: 'block',
        /**
         * Markdown変換の表示または操作を開始する。
         * @param source - 解析・描画・変換の起点となる本文。
         * @returns Markdown変換のstartが生成する結果。
         */
        start(source: string) {
            const match = /^\[toc]\s*$/im.exec(source);
            return match?.index;
        },
        /**
         * Markdown変換の入力を構造化した値へ変換する。
         * @param source - 解析・描画・変換の起点となる本文。
         * @returns Markdown変換のtokenizerが生成する結果。
         */
        tokenizer(source: string) {
            const match = /^\[toc]\s*(?:\r\n|\r|\n|$)/i.exec(source);
            if (!match) return undefined;
            return { type: 'tableOfContents', raw: match[0], text: '' } as CustomToken;
        },
        /**
         * Markdown変換を表示用の結果へ変換する。
         * @returns Markdown変換で生成または変換した値。
         */
        renderer() {
            return buildToc(markdown, messages);
        }
    };
}

/**
 * Markdown変換のfootnote・definition・extensionを処理し、呼び出し側へ結果または副作用を返す。
 * @returns Markdown変換のfootnote・definition・extensionが生成する結果。
 */
function footnoteDefinitionExtension(): any {
    return {
        name: 'footnoteDefinition',
        level: 'block',
        /**
         * Markdown変換の表示または操作を開始する。
         * @param source - 解析・描画・変換の起点となる本文。
         * @returns Markdown変換のstartが生成する結果。
         */
        start(source: string) {
            const match = /^\[\^[^\]]+]\s*:/m.exec(source);
            return match?.index;
        },
        /**
         * Markdown変換の入力を構造化した値へ変換する。
         * @param source - 解析・描画・変換の起点となる本文。
         * @returns Markdown変換のtokenizerが生成する結果。
         */
        tokenizer(source: string) {
            const match = /^\[\^([^\]]+)]\s*:\s*([^\r\n]+)(?:\r\n|\r|\n|$)/.exec(source);
            if (!match) return undefined;
            return { type: 'footnoteDefinition', raw: match[0], text: match[2], id: match[1] };
        },
        /**
         * Markdown変換を表示用の結果へ変換する。
         * @returns Markdown変換で生成または変換した値。
         */
        renderer() {
            return '';
        }
    };
}

/**
 * Markdown変換のfootnote・reference・extensionを処理し、呼び出し側へ結果または副作用を返す。
 * @param definitions - Markdown変換で受け渡す文字列。
 * @param counts - Markdown変換の位置・寸法・件数・時間を表す数値。
 * @returns Markdown変換のfootnote・reference・extensionが生成する結果。
 */
function footnoteReferenceExtension(
    definitions: Map<string, FootnoteDefinition>,
    counts: Map<string, number>
): any {
    return {
        name: 'footnoteReference',
        level: 'inline',
        /**
         * Markdown変換の表示または操作を開始する。
         * @param source - 解析・描画・変換の起点となる本文。
         * @returns Markdown変換で利用する文字列。
         */
        start(source: string) {
            const found = source.indexOf('[^');
            return found >= 0 ? found : undefined;
        },
        /**
         * Markdown変換の入力を構造化した値へ変換する。
         * @param source - 解析・描画・変換の起点となる本文。
         * @returns Markdown変換で利用する文字列。
         */
        tokenizer(source: string) {
            const match = /^\[\^([^\]]+)]/.exec(source);
            if (!match || !definitions.has(match[1])) return undefined;
            return { type: 'footnoteReference', raw: match[0], text: match[1] } as CustomToken;
        },
        /**
         * Markdown変換を表示用の結果へ変換する。
         * @param token - Markdown変換で走査または更新する要素。
         * @returns Markdown変換で利用する文字列。
         */
        renderer(token: CustomToken) {
            const safeId = slugify(token.text);
            const count = (counts.get(token.text) ?? 0) + 1;
            counts.set(token.text, count);
            return `<sup class="footnote-ref"><a href="#fn-${safeId}" id="fnref-${safeId}-${count}">${escapeHtml(token.text)}</a></sup>`;
        }
    };
}

/**
 * Markdown変換を表示用の結果へ変換する。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param displayMode - Markdown変換の対象や分岐を識別する値。
 * @param messages - Markdown変換で扱う文字列または本文。
 * @returns Markdown変換で利用する文字列。
 */
function renderKatex(source: string, displayMode: boolean, messages: Messages): string {
    try {
        const rendered = katex.renderToString(source, { displayMode, throwOnError: true, strict: 'warn' });
        return `<span class="math-node${displayMode ? ' math-block' : ''}" data-math-source="${escapeAttribute(encodeURIComponent(source))}">${rendered}</span>`;
    } catch (error) {
        return `<span class="math-error" data-math-source="${escapeAttribute(encodeURIComponent(source))}" title="${escapeAttribute(messages.renderer.mathError)}: ${escapeAttribute(String(error))}">${escapeHtml(source)}</span>`;
    }
}

/**
 * Markdown変換で使う値または実行環境を組み立てる。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param messages - Markdown変換で扱う文字列または本文。
 * @returns Markdown変換で利用する文字列。
 */
function buildToc(markdown: string, messages: Messages): string {
    const items = getOutline(markdown);
    if (!items.length) return '';
    return `<nav class="table-of-contents" aria-label="${escapeAttribute(messages.renderer.toc)}"><strong>${messages.renderer.toc}</strong><ul>${items
        .map(

            /**
             * 各項目からlevelを取り出して一覧化する。
             * @param item - 項目のlevelを参照する走査対象。
             * @returns levelを取り出した変換結果の一覧。
             */
            (item) =>
                `<li class="toc-level-${item.level}"><a href="#${escapeAttribute(item.id)}">${escapeHtml(item.text)}</a></li>`
        )
        .join('')}</ul></nav>`;
}

/**
 * Markdown変換を表示用の結果へ変換する。
 * @param html - 表示または出力するHTML本文。
 * @param messages - Markdown変換で扱う文字列または本文。
 * @returns Markdown変換で利用する文字列。
 */
function renderAlerts(html: string, messages: Messages): string {
    return html.replace(
        /<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*<br>?(?:\n)?([\s\S]*?)<\/p>\s*<\/blockquote>/gi,

        /**
         * ・matchをto・lower・caseへ渡し、Markdown変換の結果または副作用を処理する。
         * @param _match - Markdown変換へ渡す入力。
         * @param type - 操作領域の種類を示す識別子。
         * @param content - Markdown変換で扱う文字列または本文。
         * @returns Markdown変換で利用する文字列。
         */
        (_match, type: string, content: string) => {
            const label = messages.renderer.alerts[type.toLowerCase() as keyof Messages['renderer']['alerts']] ?? type;
            return `<aside class="markdown-alert alert-${type.toLowerCase()}"><strong>${escapeHtml(label)}</strong><div>${content}</div></aside>`;
        }
    );
}

/**
 * Markdown変換から必要な値またはリソースを取得する。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @returns Markdown変換で利用する文字列。
 */
function collectFootnoteDefinitions(markdown: string): Map<string, FootnoteDefinition> {
    const definitions = new Map<string, FootnoteDefinition>();
    for (const lineMatch of markdown.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
        const rawLine = lineMatch[0];
        if (!rawLine && lineMatch.index === markdown.length) break;
        const line = rawLine.replace(/(?:\r\n|\r|\n)$/, '');
        const match = /^\[\^([^\]]+)]\s*:\s*(.+)$/.exec(line);
        if (!match) continue;
        definitions.set(match[1], {
            id: match[1],
            text: match[2],
            from: lineMatch.index,
            to: lineMatch.index + rawLine.length
        });
    }
    return definitions;
}

/**
 * Markdown変換を表示用の結果へ変換する。
 * @param definitions - Markdown変換で受け渡す文字列。
 * @param messages - Markdown変換で扱う文字列または本文。
 * @returns Markdown変換で利用する文字列。
 */
function renderFootnoteSection(definitions: Map<string, FootnoteDefinition>, messages: Messages): string {
    if (!definitions.size) return '';
    const entries = [...definitions.values()];
    const notes = entries.map(
        /**
         * 各設定をslugifyへ渡し、変換結果を一覧化する。
         * @param options - 呼び出し側が指定する処理設定。
         * @returns 入力要素から生成した変換結果の一覧。
         */
        ({ id, text }) => {
            const safeId = slugify(id);
            return `<li id="fn-${safeId}">${escapeHtml(text)} <a href="#fnref-${safeId}-1" aria-label="${escapeAttribute(messages.renderer.backToText)}">↩</a></li>`;
        }).join('');
    const from = Math.min(...entries.map(
        /**
         * 各エントリからfromを取り出して一覧化する。
         * @param entry - エントリのfromを参照する走査対象。
         * @returns fromを取り出した変換結果の一覧。
         */
        (entry) => entry.from));
    const to = Math.max(...entries.map(
        /**
         * 各エントリからtoを取り出して一覧化する。
         * @param entry - エントリのtoを参照する走査対象。
         * @returns toを取り出した変換結果の一覧。
         */
        (entry) => entry.to));
    return `<section class="footnotes markdown-source-block" data-source-from="${from}" data-source-to="${to}"><hr><ol>${notes}</ol></section>`;
}

/**
 * Markdown変換のlocate・token・rangesを処理し、呼び出し側へ結果または副作用を返す。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param tokens - Markdown変換で走査または更新する要素。
 * @returns Markdown変換に対応する要素の一覧。
 */
function locateTokenRanges(markdown: string, tokens: Token[]): Array<{
    /**
     * Markdown変換のfromを表す数値。
     */
    from: number;
    /**
     * Markdown変換のtoを表す数値。
     */
    to: number
}> {
    const { normalized, originalOffsets } = normalizeWithOriginalOffsets(markdown);
    let cursor = 0;
    return tokens.map(
        /**
         * 各tokenからrawを取り出して一覧化する。
         * @param token - tokenのrawを参照する走査対象。
         * @returns rawを取り出した変換結果の一覧。
         */
        (token) => {
            const raw = normalizeLineEndings(token.raw ?? '');
            const found = normalized.indexOf(raw, cursor);
            const normalizedFrom = found >= 0 ? found : cursor;
            const normalizedTo = Math.min(normalized.length, normalizedFrom + raw.length);
            cursor = normalizedTo;
            return {
                from: originalOffsets[normalizedFrom] ?? markdown.length,
                to: originalOffsets[normalizedTo] ?? markdown.length
            };
        });
}

/**
 * Markdown変換の入力を許可された形式へ整える。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @returns Markdown変換で生成または変換した値。
 */
function normalizeWithOriginalOffsets(markdown: string): {
    /**
     * Markdown変換で扱うnormalizedの文字列。
     */
    normalized: string;
    /**
     * Markdown変換のoriginal・offsetsを表す数値。
     */
    originalOffsets: number[]
} {
    let normalized = '';
    const originalOffsets = [0];
    let offset = 0;
    while (offset < markdown.length) {
        if (markdown[offset] === '\r') {
            offset += markdown[offset + 1] === '\n' ? 2 : 1;
            normalized += '\n';
        } else {
            normalized += markdown[offset];
            offset += 1;
        }
        originalOffsets.push(offset);
    }
    return { normalized, originalOffsets };
}

/**
 * Markdown変換の入力を許可された形式へ整える。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns Markdown変換で利用する文字列。
 */
function normalizeLineEndings(value: string): string {
    return value.replace(/\r\n?|\n/g, '\n');
}

/**
 * Markdown変換の入力を許可された形式へ整える。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns Markdown変換で利用する文字列。
 */
export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g,
        /**
         * Markdown変換のコールバックとしてcharacterを処理する。
         * @param character - Markdown変換へ渡す入力。
         * @returns Markdown変換で利用する文字列。
         */
        (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

/**
 * Markdown変換の入力を許可された形式へ整える。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns Markdown変換で利用する文字列。
 */
function escapeAttribute(value: string): string {
    return escapeHtml(value).replace(/`/g, '&#96;');
}

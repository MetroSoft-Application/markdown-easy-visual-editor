/**
 * @fileoverview Markdownを段階的に解析・変換し、HTML・見出し・画像情報を安定した中間結果へまとめる。
 */
import katex from 'katex';
import { Marked, Renderer, type Token } from 'marked';
import { footnoteDefinitionSyntax, mathBlockSyntax, tableOfContentsSyntax } from '../../shared/markdownBlockSyntax';
import {
    getOutline,
    nextHeadingAnchorId,
    slugify,
    WORKSPACE_SECTION_LINK_TITLE,
    type OutlineItem
} from '../../shared/markdown';
import { getMessages, type Messages, type SupportedLanguage } from '../../shared/messages';

/**
 * Markdown変換へ渡す設定項目と既定値のデータ形状。
 */
export interface RenderOptions {

    /**
     * trueならhttp(s)画像を読み込み、falseなら画像本体の代わりにブロック表示する。
     */
    remoteImagesEnabled: boolean;

    /**
     * メッセージとKaTeXエラー表示に使う言語。省略時は日本語。
     */
    language?: SupportedLanguage;
}

/**
 * 独自Markdownトークンの種別と解析済み内容を表します。
 */
interface CustomToken {

    /**
     * Markdown parserが付けたカスタムトークンの種別名です。
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
     * ネストしたMarkdown inline token。rendererで装飾内の内容を再帰描画する。
     */
    tokens?: Token[];
}

/**
 * 脚注ラベルと脚注として表示する本文を表します。
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
     * トークン範囲の先頭を示すMarkdown本文内UTF-16オフセットです。
     */
    from: number;

    /**
     * トークン範囲の末尾を示すMarkdown本文内UTF-16オフセットです。
     */
    to: number;
}

/**
 * 安全でない要素を除去する対象ブロックの範囲と本文です。
 */
export interface UnsafeMarkdownBlock {

    /**
     * 表示または出力するHTML本文。
     */
    html: string;
    /** 見出しブロックの本文内開始位置。 */
    headingOffset?: number;
    /** 実際に描画した見出しのID。 */
    headingId?: string;

    /**
     * trueならHTML出力をサニタイズする必要がある。Markdown由来の非HTML変換結果ではfalse。
     */
    requiresSanitization: boolean;
}

/**
 * 描画済み見出しのIDをアウトラインへ反映し、Setext見出しでもリンク先を一致させる。
 * @param outline 表示する見出し一覧。
 * @param blocks 描画後の見出しIDを含むMarkdownブロック一覧。
 * @returns 描画済みIDを反映したアウトライン。対応するブロックがない項目は除く。
 */
export function alignOutlineHeadingIds(
    outline: OutlineItem[],
    blocks: UnsafeMarkdownBlock[]
): OutlineItem[] {
    const byOffset = new Map<number, string>();
    for (const block of blocks) {
        if (block.headingOffset !== undefined && block.headingId) {
            byOffset.set(block.headingOffset, block.headingId);
        }
    }
    return outline.flatMap((item) => {
        const id = byOffset.get(item.offset);
        if (!id) return [];
        return [id !== item.id ? { ...item, id } : item];
    });
}

/**
 * fenced code blockの本文を表示用HTMLへ変換する。
 * @param text - 表示・解析・変換の対象となる本文。
 * @param language - 言語判定と表示文言の選択に使うロケールコード。
 * @returns 強調表示したHTML。未対応言語などで変換しない場合はundefined。
 */
export type CodeHighlighter = (text: string, language: string) => string | undefined;

/**
 * Markdownをサニタイズ前の安全なブロックとコード強調HTMLへ変換する。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param options 言語、表示モード、HTML許可設定などの変換オプション。
 * @param highlightCode fenced code blockの本文と言語から強調表示HTMLを作る関数。
 * @returns 強調表示HTMLを含む安全化前ブロックの一覧。
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
    const usedHeadingIds = new Set<string>();
    let renderedHeadingId: string | undefined;
    const footnoteDefinitions = collectFootnoteDefinitions(markdown);
    const footnoteCounts = new Map<string, number>();
    let imageIndex = 0;

    /**
     * Markdown変換で扱う一覧または対応表。
     */
    renderer.heading =
        /**
         * heading IDを重複回避付きで決め、タイトル属性を除いた見出しHTMLを生成する。
         * @param tokens - 見出し文字列を構成するMarked token一覧。
         * @param depth - h1からh6までの見出しレベル。
         * @returns mve見出しIDを付与した見出し要素。
         */
        function ({ tokens, depth }) {
            const content = this.parser.parseInline(tokens);
            const id = nextHeadingAnchorId(tokens.map((token) => token.raw).join(''), headingIds, usedHeadingIds);
            renderedHeadingId = id;
            return `<h${depth} id="${escapeAttribute(id)}" data-mve-heading="true">${content.replace(/\s+\{#[^}]+\}(?=(?:<\/span>)*\s*$)/, '')}</h${depth}>`;
        };

    /**
     * Markdown変換で扱う一覧または対応表。
     */
    renderer.link =
        /**
         * ローカルMarkdownリンクをHost処理用のdata属性へ変換し、外部リンクは通常のhrefで出力する。
         * @param href - リンク先。
         * @param title - Markdownリンクに指定された任意のtitle属性。
         * @param tokens - リンク本文を構成するMarked inline token一覧。
         * @returns ローカル遷移属性または通常のhrefを持つリンク要素。
         */
        function ({ href, title, tokens }) {
            const content = this.parser.parseInline(tokens);
            const workspaceRooted = title === WORKSPACE_SECTION_LINK_TITLE;
            const titleAttribute = title !== null && title !== undefined && !workspaceRooted
                ? ` title="${escapeAttribute(title)}"`
                : '';
            const workspaceRootedAttribute = workspaceRooted ? ' data-mve-workspace-rooted="true"' : '';
            if (isLocalMarkdownLink(href)) {
                return `<a href="#" data-mve-link="${escapeAttribute(href)}"${workspaceRootedAttribute}${titleAttribute}>${content}</a>`;
            }
            return `<a href="${escapeAttribute(href)}"${workspaceRootedAttribute}${titleAttribute}>${content}</a>`;
        };

    /** Markdown imageトークンを表示用またはブロック済み画像HTMLへ変換するrenderer。 */
    renderer.image =
        /**
         * Markdown image tokenの参照、代替テキスト、任意タイトルからHTMLを生成する。
         * @param href - img要素のsrc属性へ出力する画像参照。
         * @param title - 指定された場合にtitle属性へ出力する補足文字列。
         * @param text - img要素のalt属性へ出力する代替テキスト。
         * @returns 画像またはブロック済み画像を表すHTML。
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

    /** Markdown code tokenを言語情報付きのコードHTMLへ変換するrenderer。 */
    renderer.code =
        /**
         * Markdown code tokenの本文と言語から表示用コードHTMLを生成する。
         * @param text - コードブロック本文。
         * @param lang - fence指定から受け取る言語ラベル。
         * @returns 言語表示とコード本文を含むHTML。
         */
        ({ text, lang }) => {
            const language = (lang || '').trim().split(/\s+/)[0].toLowerCase();
            if (language === 'mermaid') {
                return `<div class="diagram-block mermaid" data-mermaid-source="${escapeAttribute(encodeURIComponent(text))}">${escapeHtml(text)}</div>`;
            }
            const highlighted = highlightCode?.(text, language) ?? escapeHtml(text);
            return `<figure class="code-figure" data-language="${escapeAttribute(language)}"><figcaption><span>${escapeHtml(language || messages.editor.plainText)}</span><button type="button" data-copy-code="true">${messages.renderer.copy}</button></figcaption><pre><code class="hljs language-${escapeAttribute(language)}">${highlighted}</code></pre></figure>`;
        };

    /** Markdown内のHTML tokenを表示用ブロックまたは装飾済みHTMLへ変換するrenderer。 */
    renderer.html =
        /**
         * MarkdownのHTML tokenをページ区切りまたは通常HTMLへ変換する。
         * @param text - HTML tokenに含まれる本文。
         * @returns ページ区切りまたは画像情報を付加したHTML。
         */
        ({ text }) => {
            if (/^<!--\s*pagebreak\s*-->$/i.test(text.trim())) return `<div class="page-break" aria-label="${escapeAttribute(messages.renderer.pageBreak)}"></div>`;
            return decorateHtmlImages(text,
                /**
                 * Markdown変換の前提条件を準備し、回帰条件を検証するテストケース。
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
         * @param index - 走査中の配列における0始まりの要素位置。
         * @returns listを取り出した変換結果の一覧。
         */
        (token, index): UnsafeMarkdownBlock | undefined => {
            const tokenList = Object.assign([token], { links });
            renderedHeadingId = undefined;
            const rendered = String(parser.parser(tokenList));
            if (!rendered.trim()) return undefined;
            const range = ranges[index];
            return {
                html: `<div class="markdown-source-block" data-source-from="${range.from}" data-source-to="${range.to}">${rendered}</div>`,
                headingOffset: token.type === 'heading' ? range.from : undefined,
                headingId: token.type === 'heading' ? renderedHeadingId : undefined,
                // コード/Mermaid本文と属性はrenderer.code内ですべてエスケープ済み。
                requiresSanitization: token.type !== 'code'
            };
        }).filter(
            /**
             * 条件を満たすblockだけを残す。
             * @param block - トークンから生成したHTMLブロック。対象外トークンの場合はundefined。

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
 * Markdown本文を変換し、安全なHTML文字列として返す。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param options 言語、表示モード、HTML許可設定などの変換オプション。
 * @param highlightCode fenced code blockの本文と言語から強調表示HTMLを作る関数。
 * @returns 安全化前HTMLへ結合したMarkdown描画結果。
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
 * HTML内の画像要素へ連番のdata属性を付ける。
 * @param html - 表示または出力するHTML本文。
 * @param nextIndex 次の画像インデックスを取得する関数。
 * @returns 画像インデックス属性を付けたHTML。
 */
function decorateHtmlImages(html: string, nextIndex: () => number): string {
    return html.replace(/<img\b[^>]*>/gi,
        /**
         * Markdown変換の前提条件を準備し、回帰条件を検証するテストケース。
         * @param tag - 正規表現に一致したHTMLのimg開始タグ。
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
 * 画像配置をleft、center、rightの有効値へ正規化する。
 * @param value - HTML画像タグから読み取った配置属性値。
 * @returns left、center、rightのいずれか。
 */
function normalizeImageAlignment(value: string | undefined): 'left' | 'center' | 'right' {
    return value === 'center' || value === 'right' ? value : 'left';
}

/**
 * HTMLタグから指定属性の引用符付きまたは引用符なしの値を読み取る。
 * @param tag - HTML属性を読み取る画像要素タグ全体。
 * @param name - 読み取るHTML属性名。
 * @returns 属性値。属性がない場合はundefined。
 */
function readHtmlAttribute(tag: string, name: string): string | undefined {
    const pattern = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
    const match = pattern.exec(tag);
    return match?.[1] ?? match?.[2] ?? match?.[3];
}

/**
 * 指定属性があれば値を置換し、なければ閉じ括弧の直前へ追加する。
 * @param tag - 属性を書き換えるHTML要素タグ全体。
 * @param name - 更新するHTML属性名。
 * @param value - HTML属性へ設定する未エスケープの値。
 * @returns 属性値をHTMLエスケープして反映したタグ文字列。
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
 * @param tag - 属性の有無を検査するHTML要素タグ全体。
 * @param name - 検査するHTML属性名。
 * @returns 条件が成立したかを示す真偽値。
 */
function hasHtmlAttribute(tag: string, name: string): boolean {
    return new RegExp(`\\s${escapeRegExp(name)}\\s*=`, 'i').test(tag);
}

/**
 * 正規表現のメタ文字をリテラルとして扱えるようにエスケープする。
 * @param value - 正規表現へ埋め込む前にメタ文字をエスケープする文字列。

 */
function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 強調・挿入・上付き・下付き記法用のMarked inline extensionを生成する。
 * @param name - Markdown tokenを囲む出力HTML要素名。
 * @param rule - 対象のインライン区切り記法を検出する正規表現。
 * @param tag - tokenizerが認識した本文を囲むHTML要素名。
 * @returns 開始位置検索・token生成・装飾描画を行うextension。
 */
function inlineDelimited(name: string, rule: RegExp, tag: string): any {
    return {
        name,
        level: 'inline',
        /**
         * Markdown変換の表示または操作を開始する。
         * @param source - 解析・描画・変換の起点となる本文。

         */
        start(source: string) {
            const markers: Record<string, string> = { highlight: '==', inserted: '++', superscript: '^', subscript: '~' };
            const found = source.indexOf(markers[name]);
            return found >= 0 ? found : undefined;
        },
        /**
         * カスタム記法に一致した本文からMarked inline tokenを生成する。
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
         * カスタムinline tokenの内容をHTMLへ描画する。
         * @param this - インライン解析を実行するMarked rendererのthisコンテキスト。
         * @param token - Markdown変換で走査または更新する要素。
         * @returns カスタムinline tokenから生成したHTML。
         */
        renderer(this: {
            /** Custom inline tokenをMarkdown HTMLへ変換するMarked parser。 */
            parser: {
                /**
                 * Marked inline token列をHTMLへ変換する。
                 * @param tokens - HTMLへ変換するMarked inline tokenの一覧。
                 * @returns 変換後のHTML文字列。
                 */
                parseInline: (tokens: Token[]) => string
            }
        }, token: CustomToken) {
            return `<${tag}>${this.parser.parseInline(token.tokens ?? [])}</${tag}>`;
        }
    };
}

/**
 * ブロック数式tokenをKaTeXで描画するMarked extensionを作る。
 * @param messages - KaTeX描画失敗時の文言を選ぶローカライズ済みメッセージ。
 * @returns block math syntaxを保持し、KaTeX rendererを追加したextension。
 */
function mathBlockExtension(messages: Messages): any {
    return {
        ...mathBlockSyntax(),
        /**
         * ブロック数式をKaTeXで描画し、失敗時はエラー表示を返す。
         * @param token - Markdown変換で走査または更新する要素。
         * @returns KaTeXの数式HTML、または数式エラーを示すHTML。
         */
        renderer(token: CustomToken) {
            const source = token.text;
            return renderKatex(source, true, messages);
        }
    };
}

/**
 * 単一行の$...$数式を認識してKaTeXで描画するMarked inline extensionを作る。
 * @param messages - KaTeX描画失敗時の文言を選ぶローカライズ済みメッセージ。
 * @returns $区切りを検索し、数式tokenを描画するextension。
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
         * $...$形式のインライン数式をtokenizerで認識する。
         * @param source - 解析・描画・変換の起点となる本文。
         * @returns Markdown変換のtokenizerが生成する結果。
         */
        tokenizer(source: string) {
            const match = /^\$(?!\s|\$)([^\n$]*?\S)\$(?!\$)/.exec(source);
            if (!match) return undefined;
            return { type: 'mathInline', raw: match[0], text: match[1] } as CustomToken;
        },
        /**
         * インライン数式をKaTeXで描画する。
         * @param token - Markdown変換で走査または更新する要素。
         * @returns KaTeXのインライン数式HTML。
         */
        renderer(token: CustomToken) {
            return renderKatex(token.text, false, messages);
        }
    };
}

/**
 * 現在のMarkdownから作った目次を描画するMarked extensionを生成する。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param messages Markdown出力で使う翻訳済みメッセージと書式関数。
 * @returns TOC tokenを目次HTMLへ置き換えるextension。
 */
function tocExtension(markdown: string, messages: Messages): any {
    return {
        ...tableOfContentsSyntax(),
        /**
         * Markdown見出しから目次HTMLを生成するrenderer。
         * @returns Markdown見出しから生成した目次HTML。
         */
        renderer() {
            return buildToc(markdown, messages);
        }
    };
}

/**
 * 別処理で抽出した脚注定義を本文中へ重複表示しないためのMarked extensionを作る。
 * @returns 脚注定義tokenの描画結果を空文字にするextension。
 */
function footnoteDefinitionExtension(): any {
    return {
        ...footnoteDefinitionSyntax(),
        /**
         * 脚注定義本文を通常の描画結果へ出さないrenderer。
         * @returns 空文字列。
         */
        renderer() {
            return '';
        }
    };
}

/**
 * 脚注参照を解析し、各脚注の参照IDを生成する拡張機能を作る。
 * @param definitions Markdown本文中の脚注IDと脚注定義を結ぶ対応表。
 * @param counts 脚注IDごとの参照出現回数を保持するMap。
 * @returns Markdown parserへ登録する脚注参照拡張機能。
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

         */
        start(source: string) {
            const found = source.indexOf('[^');
            return found >= 0 ? found : undefined;
        },
        /**
         * 対応する脚注定義がある[^label]参照をtokenizerで認識する。
         * @param source - 解析・描画・変換の起点となる本文。

         */
        tokenizer(source: string) {
            const match = /^\[\^([^\]]+)]/.exec(source);
            if (!match || !definitions.has(match[1])) return undefined;
            return { type: 'footnoteReference', raw: match[0], text: match[1] } as CustomToken;
        },
        /**
         * 脚注参照tokenを脚注本文へのリンクHTMLへ描画する。
         * @param token - Markdown変換で走査または更新する要素。

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
 * KaTeXで数式をHTMLへ描画し、描画失敗時はエラー要素を返す。
 * @param source - HTMLへ変換するMarkdown本文。
 * @param displayMode - 出力先に応じて適用するMarkdown表示モード。
 * @param messages Markdown出力で使う翻訳済みメッセージと書式関数。

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
 * Markdown見出しを解析して階層付き目次HTMLを生成する。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param messages Markdown出力で使う翻訳済みメッセージと書式関数。

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
 * HTML内のGitHub形式alert blockquoteをalert表示用HTMLへ変換する。
 * @param html - 表示または出力するHTML本文。
 * @param messages Markdown出力で使う翻訳済みメッセージと書式関数。

 */
function renderAlerts(html: string, messages: Messages): string {
    return html.replace(
        /<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*<br>?(?:\n)?([\s\S]*?)<\/p>\s*<\/blockquote>/gi,


        (_match, type: string, content: string) => {
            const label = messages.renderer.alerts[type.toLowerCase() as keyof Messages['renderer']['alerts']] ?? type;
            return `<aside class="markdown-alert alert-${type.toLowerCase()}"><strong>${escapeHtml(label)}</strong><div>${content}</div></aside>`;
        }
    );
}

/**
 * Markdown本文から脚注定義行と元テキスト上の範囲を収集する。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * 脚注IDから定義本文と元テキスト範囲を引けるMap。
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
 * 脚注定義から脚注セクションと本文への戻りリンクを生成する。
 * @param definitions Markdown本文中の脚注IDと脚注定義を結ぶ対応表。
 * @param messages Markdown出力で使う翻訳済みメッセージと書式関数。

 */
function renderFootnoteSection(definitions: Map<string, FootnoteDefinition>, messages: Messages): string {
    if (!definitions.size) return '';
    const entries = [...definitions.values()];
    const notes = entries.map(
        /**
         * 各設定をslugifyへ渡し、変換結果を一覧化する。

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
 * Markdown本文中で各トークンが占める元ソース範囲を特定する。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param tokens - Markdown変換で走査または更新する要素。
 * @returns トークン順の半開オフセット範囲一覧。位置を対応付けられないトークンは含めない。
 */
function locateTokenRanges(markdown: string, tokens: Token[]): Array<{
    /**
     * トークン範囲の先頭を示すMarkdown本文内UTF-16オフセットです。
     */
    from: number;
    /**
     * トークン範囲の末尾を示すMarkdown本文内UTF-16オフセットです。
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
 * 改行コードをLFへ統一し、正規化後の各オフセットに対応する元位置を記録する。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @returns LFへ正規化した本文と、各位置に対応する原文オフセット配列。
 */
function normalizeWithOriginalOffsets(markdown: string): {
    /**
     * Markdown変換で扱うnormalizedの文字列。
     */
    normalized: string;
    /**
     * 正規化Markdownの各文字に対応する原文UTF-16オフセット配列。
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
 * CRLFとCRをLFへ変換して改行コードを統一する。
 * @param value - 改行コードをLFへ統一するMarkdown本文。

 */
function normalizeLineEndings(value: string): string {
    return value.replace(/\r\n?|\n/g, '\n');
}

/**
 * HTML本文・属性値の予約文字をHTML文字参照へ置換する。
 * @param value - HTMLテキストとして出力する前の文字列。
 * @returns 予約文字をescapeしたHTML文字列。
 */
export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g,
        /**

         * @param character - Markdown変換へ渡す入力。

         */
        (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

/**
 * HTML属性値へ埋め込む文字列の予約文字をエスケープする。
 * @param value - HTML属性値として出力する前の文字列。

 */
function escapeAttribute(value: string): string {
    return escapeHtml(value).replace(/`/g, '&#96;');
}

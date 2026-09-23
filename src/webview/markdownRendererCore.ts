/**
 * @file markdownRendererCore.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import katex from 'katex';
import { Marked, Renderer, type Token } from 'marked';
import { getOutline, slugify } from '../shared/markdown';
import { getMessages, type Messages, type SupportedLanguage } from '../shared/messages';
import { stripMveTextColorMarkup } from '../shared/textColor';

/**
 * 「RenderOptions」が満たすデータ契約を定義します。
 */
export interface RenderOptions {

    /**
     * 「remoteImagesEnabled」は、画面の表示モードまたは現在のUI状態を示します。
     */
    remoteImagesEnabled: boolean;

    /**
     * 「language」は、関連処理が共有する構造化データの一項目です。
     */
    language?: SupportedLanguage;
}

/**
 * 「CustomToken」が満たすデータ契約を定義します。
 */
interface CustomToken {

    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: string;

    /**
     * 「raw」は、対象の内容または識別子を表す文字列です。
     */
    raw: string;

    /**
     * 「text」は、画面または通知へ表示する文言を保持します。
     */
    text: string;

    /**
     * 「tokens」は、関連する複数の対象または識別子を保持します。
     */
    tokens?: Token[];
}

/**
 * 「FootnoteDefinition」が満たすデータ契約を定義します。
 */
interface FootnoteDefinition {

    /**
     * 「id」は、対象の識別や処理分岐に使用する値を保持します。
     */
    id: string;

    /**
     * 「text」は、画面または通知へ表示する文言を保持します。
     */
    text: string;

    /**
     * 「from」は、本文または選択範囲の位置・長さを保持します。
     */
    from: number;

    /**
     * 「to」は、本文または選択範囲の位置・長さを保持します。
     */
    to: number;
}

/**
 * 「UnsafeMarkdownBlock」が満たすデータ契約を定義します。
 */
export interface UnsafeMarkdownBlock {

    /**
     * 「html」は、解析・編集・変換の対象となる本文またはデータを保持します。
     */
    html: string;

    /**
     * 「requiresSanitization」は、処理条件または状態を表す真偽値です。
     */
    requiresSanitization: boolean;
}

/**
 * 「CodeHighlighter」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
 * @param text 処理対象の本文です。
 * @param language 表示文言の解決に使用する言語コードまたはロケールです。
 * @returns 「CodeHighlighter」が生成または変換したMarkdownの文字列を返します。
 */
export type CodeHighlighter = (text: string, language: string) => string | undefined;

/**
 * MarkdownをmarkedでHTMLへ変換し、拡張記法を追加してDOMPurifyで無害化する。
 * @param markdown 変換対象のMarkdown本文。
 * @param options リモート画像などの描画設定。
 * @param highlightCode 「highlightCode」は、「renderMarkdownUnsafeBlocks」がMarkdown解析・変換の処理対象を特定する入力です。
 * @returns 無害化済みのプレビューHTML。
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
     * 見出し本文から一意なIDを作り、見出し要素を生成する。
     * @param token markedが解析した見出しトークン。
     * @returns ID付きの見出しHTML。
     */
    renderer.heading =
    /**
 * 「tokens」「depth」を受け取り、Markdown見出しの表示用HTMLを生成するコールバックです。
     * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはtokens、depthです。
     * @returns Markdown見出しの表示用HTMLを返します。
     */
    function ({ tokens, depth }) {
        const content = this.parser.parseInline(tokens);
        const plain = stripMveTextColorMarkup(
            tokens.map(
            /**
 * 「token」を変換し、変換後の要素を返すコールバックです。
             * @param token tokenとして渡される、このコールバックの入力値です。
             * @returns 置換後の文字列を返します。
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
     * ローカルリンクはブラウザが解決できないhrefを持たないようにし、元の参照先をデータ属性へ退避する。
     * クリック時はRenderedMarkdownがこの属性をホストへ渡してVS Codeで開く。
     */
    renderer.link =
    /**
 * 「href」「title」「tokens」を受け取り、Markdownリンクの表示用HTMLを生成するコールバックです。
     * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはhref、title、tokensです。
     * @returns Markdownリンクの表示用HTMLを返します。
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
     * 画像をHTMLへ変換し、リモート画像設定が無効ならブロック表示を返す。
     * @param token markedが解析した画像トークン。
     * @returns 画像要素またはブロック表示用HTML。
     */
    renderer.image =
    /**
 * 「href」「title」「text」を受け取り、Markdown画像の表示用HTMLを生成するコールバックです。
     * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはhref、title、textです。
     * @returns 画像の表示用HTMLを返します。
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
     * コードブロックをMermaid図またはシンタックスハイライト済みHTMLへ変換する。
     * @param token markedが解析したコードトークン。
     * @returns Mermaidコンテナーまたはハイライト済みコードHTML。
     */
    renderer.code =
    /**
 * 「text」「lang」を受け取り、コードまたはMermaidの表示用HTMLを生成するコールバックです。
     * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはtext、langです。
     * @returns コードまたはMermaidの表示用HTMLを返します。
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
     * HTMLトークンを処理し、pagebreakコメントだけを改ページ要素へ変換する。
     * @param token markedが解析したHTMLトークン。
     * @returns 改ページ要素または元のHTML。
     */
    renderer.html =
    /**
 * 「text」を受け取り、Markdown内HTMLを安全な表示用HTMLへ変換するコールバックです。
     * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはtextです。
     * @returns 安全化したHTMLまたは改ページ要素を返します。
     */
    ({ text }) => {
        if (/^<!--\s*pagebreak\s*-->$/i.test(text.trim())) return `<div class="page-break" aria-label="${escapeAttribute(messages.renderer.pageBreak)}"></div>`;
        return decorateHtmlImages(text,
        /**
 * 画像要素へ付与する連番を払い出すコールバックです。
         * @returns 次に割り当てる画像要素の連番を返します。
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
     * 「links」は、関連する複数の対象または識別子を保持します。
     */
    links?: Record<string, unknown> }).links;
    // ブロック単位でHTMLを描画して出典範囲属性を付け、脚注セクションを本文末尾へ追加する。
    const blocks = tokens.map(
    /**
 * 「token」「index」を変換し、変換後の要素を返すコールバックです。
     * @param token tokenとして渡される、このコールバックの入力値です。
     * @param index 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 「token」が対象を取得できない場合はundefinedを返します。
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
 * 「block」が条件に一致するか判定し、残す要素を決めるコールバックです。
     * @param block blockとして渡される、このコールバックの入力値です。
     * @returns 要素を採用するかどうかの真偽値を返します。
     */
    (block): block is UnsafeMarkdownBlock => block !== undefined);
    const footnotes = renderFootnoteSection(footnoteDefinitions, messages);
    if (footnotes) blocks.push({ html: footnotes, requiresSanitization: false });
    // 各トップレベルブロックを独立させ、UI側でDOMPurifyを短時間ずつ実行できるようにする。
    return blocks.map(
    /**
 * 「block」を変換し、変換後の要素を返すコールバックです。
     * @param block blockとして渡される、このコールバックの入力値です。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (block) => ({ ...block, html: renderAlerts(block.html, messages) }));
}

/**
 * render・markdown・unsafeを描画します。
 * @param markdown 解析・編集・変換の対象となる本文または生成済み内容です。
 * @param options 処理経路や表示方法を指定する設定値です。
 * @param highlightCode 「highlightCode」は、「renderMarkdownUnsafe」がMarkdown解析・変換の処理対象を特定する入力です。
 * @returns 「renderMarkdownUnsafe」が生成または変換したMarkdownの文字列を返します。
 */
export function renderMarkdownUnsafe(
    markdown: string,
    options: RenderOptions,
    highlightCode?: CodeHighlighter
): string {
    return renderMarkdownUnsafeBlocks(markdown, options, highlightCode).map(
    /**
 * 「block」を変換し、変換後の要素を返すコールバックです。
     * @param block blockとして渡される、このコールバックの入力値です。
     * @returns 置換後の文字列を返します。
     */
    (block) => block.html).join('');
}

/**
 * リンクかどうかを判定します。
 * @param href 「href」は、「isLocalMarkdownLink」がMarkdown解析・変換の処理対象を特定する入力です。
 * @returns 判定結果です。
 */
function isLocalMarkdownLink(href: string): boolean {
    if (!href || href.startsWith('#')) return false;
    if (/^https?:\/\/file\+\.vscode-resource\.vscode-cdn\.net\//i.test(href)) return true;
    if (/^(?:file:|[A-Za-z]:[\\/]|\\\\|\/\/)/i.test(href)) return true;
    return !/^(?:https?|mailto|tel|ftp|data|javascript):/i.test(href);
}

/**
 * 生HTML内の画像タグへ、プレビュー操作に必要なメタデータを付与します。
 * @param html Markdownから得られたHTML断片です。
 * @param nextIndex 画像インデックスを払い出す関数です。
 * @returns メタデータ付与後のHTML断片です。
 */
function decorateHtmlImages(html: string, nextIndex: () => number): string {
    return html.replace(/<img\b[^>]*>/gi,
    /**
 * 「tag」を受け取り、登録された副作用または結果を生成する処理です。
     * @param tag HTMLまたはテキストから取り出した対象文字列です。
     * @returns 「readHtmlAttribute」を実行し、値を返しません。
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
 * 配置を正規化します。
 * @param value 「normalizeImageAlignment」で検証・変換する入力値です。
 * @returns 「normalizeImageAlignment」が読み取りまたは正規化した結果を返します。
 */
function normalizeImageAlignment(value: string | undefined): 'left' | 'center' | 'right' {
    return value === 'center' || value === 'right' ? value : 'left';
}

/**
 * HTML属性値を読み取ります。
 * @param tag HTMLタグです。
 * @param name 属性名です。
 * @returns 属性値またはundefinedです。
 */
function readHtmlAttribute(tag: string, name: string): string | undefined {
    const pattern = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
    const match = pattern.exec(tag);
    return match?.[1] ?? match?.[2] ?? match?.[3];
}

/**
 * HTML属性を追加または更新します。
 * @param tag HTMLタグです。
 * @param name 属性名です。
 * @param value 属性値です。
 * @returns 属性更新後のHTMLタグです。
 */
function upsertHtmlAttribute(tag: string, name: string, value: string): string {
    const pattern = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
    const escaped = escapeAttribute(value);
    if (pattern.test(tag)) return tag.replace(pattern, ` ${name}="${escaped}"`);
    const closing = tag.endsWith('/>') ? '/>' : '>';
    return tag.slice(0, -closing.length) + ` ${name}="${escaped}"` + closing;
}

/**
 * HTML属性の存在を確認します。
 * @param tag HTMLタグです。
 * @param name 属性名です。
 * @returns 属性があればtrueです。
 */
function hasHtmlAttribute(tag: string, name: string): boolean {
    return new RegExp(`\\s${escapeRegExp(name)}\\s*=`, 'i').test(tag);
}

/**
 * 正規表現に使う文字をエスケープします。
 * @param value 文字列です。
 * @returns エスケープ済み文字列です。
 */
function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 独自のインライン記法をmarked拡張として登録する定義を作る。
 * @param name 拡張トークン名。
 * @param rule 入力先頭へ適用する解析正規表現。
 * @param tag 出力するHTMLタグ名。
 * @returns markedへ登録するインライン拡張定義。
 */
function inlineDelimited(name: string, rule: RegExp, tag: string): any {
    return {
        name,
        level: 'inline',
        /**
         * 入力内で独自記法の開始位置を探す。
         * @param source 解析対象の入力文字列。
         * @returns 記法の開始位置。見つからない場合はundefined。
         */
        start(source: string) {
            const markers: Record<string, string> = { highlight: '==', inserted: '++', superscript: '^', subscript: '~' };
            const found = source.indexOf(markers[name]);
            return found >= 0 ? found : undefined;
        },
        /**
         * 独自記法のトークンを解析し、内部テキストもmarkedへ渡す。
         * @param source 解析対象の入力文字列。
         * @returns 独自記法トークン。対象外の場合はundefined。
         */
        tokenizer(source: string) {
            const match = rule.exec(source);
            if (!match) return undefined;
            const token: CustomToken = { type: name, raw: match[0], text: match[1] };
            token.tokens = this.lexer.inlineTokens(token.text);
            return token;
        },
        /**
         * 独自トークンの内部トークンを再帰的にHTMLへ描画する。
         * @param token 描画対象の独自記法トークン。
         * @returns 指定タグで囲んだHTML。
         */
        renderer(this: {
        /**
         * 「parser」は、関連処理が共有する構造化データの一項目です。
         */
        parser: {
        /**
         * 「parseInline」は、関連処理が共有する構造化データの一項目です。
         */
        parseInline: (tokens: Token[]) => string } }, token: CustomToken) {
            return `<${tag}>${this.parser.parseInline(token.tokens ?? [])}</${tag}>`;
        }
    };
}

/**
 * ブロック数式をKaTeX描画へ渡すmarked拡張を作る。
 * @param messages 「messages」は、「mathBlockExtension」がMarkdown解析・変換の処理対象を特定する入力です。
 * @returns markedへ登録するブロック数式拡張定義。
 */
function mathBlockExtension(messages: Messages): any {
    return {
        name: 'mathBlock',
        level: 'block',
        /**
         * ブロック数式の開始位置を探す。
         * @param source 解析対象の入力文字列。
         * @returns 数式の開始位置。見つからない場合はundefined。
         */
        start(source: string) {
            const found = source.indexOf('$$');
            return found >= 0 ? found : undefined;
        },
        /**
         * 改行を含む$$...$$形式の数式トークンを解析する。
         * @param source 解析対象の入力文字列。
         * @returns 数式トークン。対象外の場合はundefined。
         */
        tokenizer(source: string) {
            const match = /^\$\$[ \t]*\n?([\s\S]+?)\n?[ \t]*\$\$(?:\n|$)/.exec(source);
            if (!match) return undefined;
            return { type: 'mathBlock', raw: match[0], text: match[1].trim() } as CustomToken;
        },
        /**
         * ブロック数式トークンを表示用HTMLへ変換する。
         * @param token 描画対象の数式トークン。
         * @returns KaTeXのブロック表示HTML。
         */
        renderer(token: CustomToken) {
            const source = token.text;
            return renderKatex(source, true, messages);
        }
    };
}

/**
 * インライン数式をKaTeX描画へ渡すmarked拡張を作る。
 * @param messages 「messages」は、「mathInlineExtension」がMarkdown解析・変換の処理対象を特定する入力です。
 * @returns markedへ登録するインライン数式拡張定義。
 */
function mathInlineExtension(messages: Messages): any {
    return {
        name: 'mathInline',
        level: 'inline',
        /**
         * インライン数式の開始位置を探す。
         * @param source 解析対象の入力文字列。
         * @returns 数式の開始位置。見つからない場合はundefined。
         */
        start(source: string) {
            const found = source.indexOf('$');
            return found >= 0 ? found : undefined;
        },
        /**
         * $...$形式のインライン数式トークンを解析する。
         * @param source 解析対象の入力文字列。
         * @returns 数式トークン。対象外の場合はundefined。
         */
        tokenizer(source: string) {
            const match = /^\$(?!\s|\$)([^\n$]*?\S)\$(?!\$)/.exec(source);
            if (!match) return undefined;
            return { type: 'mathInline', raw: match[0], text: match[1] } as CustomToken;
        },
        /**
         * インライン数式トークンを表示用HTMLへ変換する。
         * @param token 描画対象の数式トークン。
         * @returns KaTeXのインライン表示HTML。
         */
        renderer(token: CustomToken) {
            return renderKatex(token.text, false, messages);
        }
    };
}

/**
 * [toc]記法を文書見出しから生成した目次へ置換するmarked拡張を作る。
 * @param markdown 目次の見出しを取得するMarkdown本文。
 * @param messages 「messages」は、「tocExtension」がMarkdown解析・変換の処理対象を特定する入力です。
 * @returns markedへ登録する目次拡張定義。
 */
function tocExtension(markdown: string, messages: Messages): any {
    return {
        name: 'tableOfContents',
        level: 'block',
        /**
         * 文書内の[toc]記法の開始位置を探す。
         * @param source 解析対象の入力文字列。
         * @returns 目次記法の開始位置。見つからない場合はundefined。
         */
        start(source: string) {
            const match = /^\[toc]\s*$/im.exec(source);
            return match?.index;
        },
        /**
         * [toc]記法を目次トークンとして解析する。
         * @param source 解析対象の入力文字列。
         * @returns 目次トークン。対象外の場合はundefined。
         */
        tokenizer(source: string) {
            const match = /^\[toc]\s*(?:\r\n|\r|\n|$)/i.exec(source);
            if (!match) return undefined;
            return { type: 'tableOfContents', raw: match[0], text: '' } as CustomToken;
        },
        /**
         * 目次トークンを文書の見出し一覧からHTMLへ変換する。
         * @returns 文書見出しから生成した目次HTML。
         */
        renderer() {
            return buildToc(markdown, messages);
        }
    };
}

/**
 * 脚注定義を解析し、本文には描画しないmarked拡張を作る。
 * @returns markedへ登録する脚注定義拡張定義。
 */
function footnoteDefinitionExtension(): any {
    return {
        name: 'footnoteDefinition',
        level: 'block',
        /**
         * 脚注定義の開始位置を探す。
         * @param source 解析対象の入力文字列。
         * @returns 脚注定義の開始位置。見つからない場合はundefined。
         */
        start(source: string) {
            const match = /^\[\^[^\]]+]\s*:/m.exec(source);
            return match?.index;
        },
        /**
         * 脚注IDと本文を脚注定義トークンとして解析する。
         * @param source 解析対象の入力文字列。
         * @returns 脚注定義トークン。対象外の場合はundefined。
         */
        tokenizer(source: string) {
            const match = /^\[\^([^\]]+)]\s*:\s*([^\r\n]+)(?:\r\n|\r|\n|$)/.exec(source);
            if (!match) return undefined;
            return { type: 'footnoteDefinition', raw: match[0], text: match[2], id: match[1] };
        },
        /**
         * 脚注定義本体を本文位置では空文字へ変換する。
         * @returns 本文へ追加しないことを示す空文字列。
         */
        renderer() {
            return '';
        }
    };
}

/**
 * 脚注参照を本文リンクへ変換するmarked拡張を作る。
 * @param definitions 脚注IDと定義本文のMap。
 * @param counts 脚注参照回数を保持するMap。
 * @returns markedへ登録する脚注参照拡張定義。
 */
function footnoteReferenceExtension(
    definitions: Map<string, FootnoteDefinition>,
    counts: Map<string, number>
): any {
    return {
        name: 'footnoteReference',
        level: 'inline',
        /**
         * 脚注参照の開始位置を探す。
         * @param source 解析対象の入力文字列。
         * @returns 脚注参照の開始位置。見つからない場合はundefined。
         */
        start(source: string) {
            const found = source.indexOf('[^');
            return found >= 0 ? found : undefined;
        },
        /**
         * 定義済み脚注への参照だけをトークンとして解析する。
         * @param source 解析対象の入力文字列。
         * @returns 脚注参照トークン。未定義または対象外の場合はundefined。
         */
        tokenizer(source: string) {
            const match = /^\[\^([^\]]+)]/.exec(source);
            if (!match || !definitions.has(match[1])) return undefined;
            return { type: 'footnoteReference', raw: match[0], text: match[1] } as CustomToken;
        },
        /**
         * 脚注参照を本文の脚注セクションへのリンクへ変換する。
         * @param token 描画対象の脚注参照トークン。
         * @returns 脚注セクションへ遷移するリンクHTML。
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
 * 数式をKaTeXへ渡し、成功時は数式HTML、失敗時はエラーHTMLを返す。
 * @param source 描画する数式ソース。
 * @param displayMode ブロック表示として描画するかどうか。
 * @param messages 「messages」は、「renderKatex」がMarkdown解析・変換の処理対象を特定する入力です。
 * @returns 数式または数式エラーのHTML。
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
 * Markdown見出しから目次HTMLを生成する。
 * @param markdown 見出しを抽出するMarkdown本文。
 * @param messages 「messages」は、「buildToc」がMarkdown解析・変換の処理対象を特定する入力です。
 * @returns 目次HTML。見出しがない場合は空文字列。
 */
function buildToc(markdown: string, messages: Messages): string {
    const items = getOutline(markdown);
    if (!items.length) return '';
    return `<nav class="table-of-contents" aria-label="${escapeAttribute(messages.renderer.toc)}"><strong>${messages.renderer.toc}</strong><ul>${items
        .map(

            /**
 * 「item」を変換し、変換後の要素を返すコールバックです。
             * @param item 変換または処理の対象となる値です。
             * @returns 置換後の文字列を返します。
             */
            (item) =>
                `<li class="toc-level-${item.level}"><a href="#${escapeAttribute(item.id)}">${escapeHtml(item.text)}</a></li>`
        )
        .join('')}</ul></nav>`;
}

/**
 * blockquote内の警告記法をアラート用のaside要素へ変換する。
 * @param html 警告記法を含む変換済みHTML。
 * @param messages 「messages」は、「renderAlerts」がMarkdown解析・変換の処理対象を特定する入力です。
 * @returns アラート要素へ変換したHTML。
 */
function renderAlerts(html: string, messages: Messages): string {
    return html.replace(
        /<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*<br>?(?:\n)?([\s\S]*?)<\/p>\s*<\/blockquote>/gi,

        /**
 * 「_match」「type」「content」を受け取り、入力文字列を置換して変換する処理です。
         * @param _match _matchとして渡される、このコールバックの入力値です。
         * @param type 処理対象の種別です。
         * @param content 解析・編集・変換の対象となる本文または生成済み内容です。
         * @returns 置換後の文字列を返します。
         */
        (_match, type: string, content: string) => {
            const label = messages.renderer.alerts[type.toLowerCase() as keyof Messages['renderer']['alerts']] ?? type;
            return `<aside class="markdown-alert alert-${type.toLowerCase()}"><strong>${escapeHtml(label)}</strong><div>${content}</div></aside>`;
        }
    );
}

/**
 * Markdown本文から脚注定義を抽出し、IDをキーにしたMapへ格納する。
 * @param markdown 解析対象のMarkdown本文。
 * @returns 脚注IDをキーにした脚注定義Map。
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
 * 脚注定義Mapから本文末尾へ追加する脚注セクションHTMLを生成する。
 * @param definitions 描画する脚注定義Map。
 * @param messages 「messages」は、「renderFootnoteSection」がMarkdown解析・変換の処理対象を特定する入力です。
 * @returns 本文末尾へ追加する脚注セクションHTML。
 */
function renderFootnoteSection(definitions: Map<string, FootnoteDefinition>, messages: Messages): string {
    if (!definitions.size) return '';
    const entries = [...definitions.values()];
    const notes = entries.map(
    /**
 * 「id」「text」を変換し、変換後の要素を返すコールバックです。
     * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはid、textです。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    ({ id, text }) => {
        const safeId = slugify(id);
        return `<li id="fn-${safeId}">${escapeHtml(text)} <a href="#fnref-${safeId}-1" aria-label="${escapeAttribute(messages.renderer.backToText)}">↩</a></li>`;
    }).join('');
    const from = Math.min(...entries.map(
    /**
 * 「entry」を変換し、変換後の要素を返すコールバックです。
     * @param entry entryとして渡される、このコールバックの入力値です。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (entry) => entry.from));
    const to = Math.max(...entries.map(
    /**
 * 「entry」を変換し、変換後の要素を返すコールバックです。
     * @param entry entryとして渡される、このコールバックの入力値です。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (entry) => entry.to));
    return `<section class="footnotes markdown-source-block" data-source-from="${from}" data-source-to="${to}"><hr><ol>${notes}</ol></section>`;
}

/**
 * markedトークンを元Markdown上の開始・終了オフセットへ対応付ける。
 * @param markdown トークンの元となるMarkdown本文。
 * @param tokens 対応付けるmarkedトークン一覧。
 * @returns 各トークンに対応する元本文の範囲一覧。
 */
function locateTokenRanges(markdown: string, tokens: Token[]): Array<{
/**
 * 「from」は、本文または選択範囲の位置・長さを保持します。
 */
from: number;
/**
 * 「to」は、本文または選択範囲の位置・長さを保持します。
 */
to: number }> {
    const { normalized, originalOffsets } = normalizeWithOriginalOffsets(markdown);
    let cursor = 0;
    return tokens.map(
    /**
 * 「token」を変換し、変換後の要素を返すコールバックです。
     * @param token tokenとして渡される、このコールバックの入力値です。
     * @returns 入力要素から生成した変換後の値を返します。
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
 * 改行をLFへ正規化し、正規化文字列から元Markdown位置を引ける配列を作る。
 * @param markdown 正規化対象のMarkdown本文。
 * @returns 正規化本文と元本文オフセットの対応表。
 */
function normalizeWithOriginalOffsets(markdown: string): {
/**
 * 「normalized」は、対象の内容または識別子を表す文字列です。
 */
normalized: string;
/**
 * 「originalOffsets」は、本文または選択範囲の位置・長さを保持します。
 */
originalOffsets: number[] } {
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
 * 文字列内のCRLF・CRをLFへ統一する。
 * @param value 改行を正規化する文字列。
 * @returns LFへ統一した文字列。
 */
function normalizeLineEndings(value: string): string {
    return value.replace(/\r\n?|\n/g, '\n');
}

/**
 * HTML本文へ埋め込む値の特殊文字をエンティティへ変換する。
 * @param value エスケープ対象の文字列。
 * @returns HTMLエンティティへ変換した文字列。
 */
export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g,
    /**
 * 「character」から（value）のオブジェクトを生成して返すコールバックです。
     * @param character HTMLまたはテキストから取り出した対象文字列です。
     * @returns 置換後の文字列を返します。
     */
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

/**
 * HTML属性用にエスケープした値へバッククォートの変換も追加する。
 * @param value エスケープ対象の属性値。
 * @returns 属性へ埋め込めるエスケープ済み文字列。
 */
function escapeAttribute(value: string): string {
    return escapeHtml(value).replace(/`/g, '&#96;');
}

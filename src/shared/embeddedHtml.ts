/**
 * @fileoverview 変換タブで、原文に生HTMLで書かれたブロックを、描画HTMLから同じ意味の変換先の記法へ戻す規則。
 * 実行境界: shared（変換タブの変換から呼ぶ。DOMに依存しない文字列処理だけで実装する）。
 * 呼び出し側（webview/markdown/conversionWithFallback）は、原文が生HTMLの単位だけにこの規則を使う。記法で書かれた単位を
 * HTMLへ変換することはない。描画HTMLには元のソースが属性（`data-mermaid-source`・`data-math-source`）や要素の形
 * （コードの言語、脚注の番号、Textileの配置指定など）として残っているため、その規則の逆をたどって記法へ戻せる。
 * 不変条件: 認識できない形のHTMLはundefinedを返し、呼び出し側は原文の生HTMLのまま残す。記法で表せない一部の要素
 * （`<kbd>`など）は、原文と同じHTMLのタグのまま書く。
 */
import { toTextilePlainText } from './formatConversion';

/** 解析したHTMLの要素。 */
export interface HtmlElement {
    /** 小文字のタグ名。 */
    tag: string;
    /** 属性（小文字の名前→値）。 */
    attrs: Record<string, string>;
    /** 子要素と文字列。 */
    children: HtmlNode[];
}

/** 解析したHTMLの節点。文字列は文字参照を復号した本文。 */
export type HtmlNode = HtmlElement | string;

/** HTMLコメントを表す節点のタグ名。本文は`attrs.text`に入る。 */
const COMMENT_TAG = '#comment';

/** 終了タグを持たない空要素。 */
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/**
 * URIエンコードされた属性値（数式・図のソース）を復号する。利用者が書いた不正な値でも例外を投げず、そのままの値を返す
 * （その場合は記法へ戻した結果がプレビューと一致せず、呼び出し側の描画比較でHTMLのまま残る）。
 * @param value - URIエンコードされた値。
 * @returns 復号した値。復号できなければ元の値。
 */
function safeDecodeURIComponent(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

/**
 * HTMLの文字参照を復号する。
 * @param text - 文字参照を含む文字列。
 * @returns 復号した文字列。
 */
export function decodeHtmlEntities(text: string): string {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, reference: string) => {
        const lower = reference.toLowerCase();
        if (lower in named) return named[lower];
        // 範囲外の番号（不正な参照）は例外にせず、参照のまま残す。
        const code = lower.startsWith('#x') ? Number.parseInt(lower.slice(2), 16) : lower.startsWith('#') ? Number.parseInt(lower.slice(1), 10) : Number.NaN;
        return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    });
}

/**
 * HTML断片を簡易に解析する。描画器・変換器が出力した整形済みのHTMLを対象とし、壊れたHTMLは途中までの木を返す。
 * @param html - HTML断片。
 * @returns 節点の一覧。
 */
export function parseHtml(html: string): HtmlNode[] {
    const root: HtmlElement = { tag: '#root', attrs: {}, children: [] };
    const stack: HtmlElement[] = [root];
    const pattern = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|[^<]+|</g;
    for (const match of html.matchAll(pattern)) {
        const current = stack[stack.length - 1];
        const token = match[0];
        // コメントは表示されないが、Marpの指示（`<!-- fit -->`）のように見出しIDなどへ影響するため節点として残す。
        if (token.startsWith('<!--')) {
            current.children.push({ tag: COMMENT_TAG, attrs: { text: token.slice(4, -3) }, children: [] });
            continue;
        }
        if (match[1]) {
            const name = match[1].toLowerCase();
            const index = stack.map((element) => element.tag).lastIndexOf(name);
            if (index > 0) stack.length = index;
            continue;
        }
        if (match[2]) {
            const element: HtmlElement = { tag: match[2].toLowerCase(), attrs: {}, children: [] };
            for (const attribute of (match[3] ?? '').matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
                element.attrs[attribute[1].toLowerCase()] = decodeHtmlEntities(attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
            }
            current.children.push(element);
            if (!match[4] && !VOID_TAGS.has(element.tag)) stack.push(element);
            continue;
        }
        current.children.push(decodeHtmlEntities(token));
    }
    return root.children;
}

/**
 * 節点の本文（タグを除いた文字列）を返す。
 * @param nodes - 節点の一覧。
 * @returns 連結した本文。
 */
export function textContent(nodes: readonly HtmlNode[]): string {
    return nodes.map((node) => (typeof node === 'string' ? node : node.tag === COMMENT_TAG ? '' : textContent(node.children))).join('');
}

/**
 * 要素がclassを持つか判定する。
 * @param element - 要素。
 * @param name - class名。
 * @returns 持っていればtrue。
 */
function hasClass(element: HtmlElement, name: string): boolean {
    return (element.attrs.class ?? '').split(/\s+/).includes(name);
}

/**
 * 空白だけの文字列節点を除いた要素の子を返す。
 * @param element - 要素。
 * @returns 意味のある子の一覧。
 */
function meaningfulChildren(element: HtmlElement): HtmlNode[] {
    return element.children.filter((child) => typeof child !== 'string' || child.trim() !== '');
}

/**
 * リスト項目の中で、インラインの並びではなく独立した塊として書く要素か判定する。
 * @param element - 要素。
 * @returns ブロックとして書くならtrue。
 */
function isListItemBlock(element: HtmlElement): boolean {
    return ['p', 'ul', 'ol', 'blockquote', 'figure', 'pre', 'table', 'hr', 'nav', 'section', 'aside'].includes(element.tag)
        || /^h[1-6]$/.test(element.tag)
        || (element.tag === 'div' && (hasClass(element, 'mermaid') || hasClass(element, 'page-break')))
        || (element.tag === 'span' && hasClass(element, 'math-block'));
}

/** Markdownの画像記法（`![alt](src "title")`）で表せる属性。 */
const MARKDOWN_IMAGE_ATTRIBUTES = new Set(['src', 'alt', 'title']);

/**
 * 描画器が編集・表示用に付ける属性か判定する。描画し直すと付け直されるため、生HTMLへ書き出さない。
 * @param name - 属性名（小文字）。
 * @returns 描画器の属性ならtrue。
 */
function isRendererAttribute(name: string): boolean {
    return /^data-(?:mve-|source-|original-src$)/.test(name) || name === 'loading' || name === 'decoding';
}

/**
 * 要素の属性を、生HTMLのタグへ書ける形にする。描画器の属性は除き、`src`は描画前の値（data-original-src）を使う。
 * @param element - 要素。
 * @returns 先頭に空白を付けた属性の並び。属性がなければ空文字。
 */
function serializeAttributes(element: HtmlElement): string {
    return Object.entries(element.attrs)
        .filter(([name]) => !isRendererAttribute(name))
        .map(([name, value]) => {
            const actual = name === 'src' ? element.attrs['data-original-src'] ?? value : value;
            return ` ${name}="${actual.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;
        })
        .join('');
}

/**
 * Markdownの本文で記号として解釈される文字を退避する。
 * @param text - 本文。
 * @returns 退避した本文。
 */
function escapeMarkdownText(text: string): string {
    // 記法になり得る記号だけを退避し、文章中の普通の記号はそのまま書く（標準的な書き方へ戻すため）。
    // - `[`・`]`はリンク（`](`・`][`・`]:`）の形があるときだけ記法になる。
    // - `_`は単語の内側では強調にならない。`<`は直後が英字・`/`・`!`のときだけタグになる。
    // - `~`・`^`・`$`は対になって初めて記法になるため、2つ以上あるときだけ退避する。`=`・`+`は2つ続くときだけ記法になる。
    const linkLike = /\]\s*[([:]/.test(text);
    const paired = (character: string): boolean => text.split(character).length > 2;
    return text.replace(/[\\`*_[\]<~^$]|==|\+\+/g, (match, offset: number) => {
        switch (match) {
            case '[': case ']': return linkLike ? `\\${match}` : match;
            case '_': return /[\p{L}\p{N}]/u.test(text[offset - 1] ?? '') && /[\p{L}\p{N}]/u.test(text[offset + 1] ?? '') ? match : `\\${match}`;
            case '<': return /[A-Za-z/!?]/.test(text[offset + 1] ?? '') ? `\\${match}` : match;
            case '~': case '^': case '$': return paired(match) ? `\\${match}` : match;
            default: return `\\${match}`;
        }
    });
}

/**
 * 順変換が書き出したMarkdown由来のインラインHTMLを、Markdownのインライン記法へ戻す。
 * @param nodes - 節点の一覧。
 * @param keepNewlines - 文字の中の改行を改行のまま書く場合はtrue（段落・引用）。既定はfalse（空白にする）。
 * @returns Markdownのインライン記法。認識できない要素を含む場合はundefined。
 */
function inlineToMarkdown(nodes: readonly HtmlNode[], keepNewlines = false): string | undefined {
    let output = '';
    for (const node of nodes) {
        if (typeof node === 'string') {
            // 段落内の改行（ソフト改行）は、段落・引用では改行のまま書ける。見出し・リスト・表のセルでは空白にする。
            output += escapeMarkdownText(keepNewlines ? node.replace(/[ \t]*\n[ \t]*/g, '\n') : node.replace(/\s*\n\s*/g, ' '));
            continue;
        }
        const inner = (): string | undefined => inlineToMarkdown(node.children, keepNewlines);
        let piece: string | undefined;
        switch (node.tag) {
            case 'strong': case 'b': { const value = inner(); piece = value === undefined ? undefined : `**${value}**`; break; }
            case 'em': case 'i': { const value = inner(); piece = value === undefined ? undefined : `*${value}*`; break; }
            case 'del': case 's': { const value = inner(); piece = value === undefined ? undefined : `~~${value}~~`; break; }
            case 'ins': { const value = inner(); piece = value === undefined ? undefined : `++${value}++`; break; }
            case 'mark': { const value = inner(); piece = value === undefined ? undefined : `==${value}==`; break; }
            case 'code': {
                const code = textContent(node.children);
                const fence = code.includes('`') ? '``' : '`';
                const padding = /^`|`$/.test(code) ? ' ' : '';
                piece = `${fence}${padding}${code}${padding}${fence}`;
                break;
            }
            case 'br': piece = '<br>'; break;
            case 'img': {
                // 幅・高さなどMarkdownの画像記法で書けない属性を持つ画像は、Markdownでも書ける生HTMLの<img>で書く。
                if (Object.keys(node.attrs).some((name) => !MARKDOWN_IMAGE_ATTRIBUTES.has(name) && !isRendererAttribute(name))) {
                    piece = `<img${serializeAttributes(node)}>`;
                    break;
                }
                const title = node.attrs.title !== undefined ? ` "${node.attrs.title.replace(/"/g, '\\"')}"` : '';
                piece = `![${node.attrs.alt ?? ''}](${node.attrs['data-original-src'] ?? node.attrs.src ?? ''}${title})`;
                break;
            }
            case 'a': {
                // リンクの表示文字の角括弧は、リンクの終わりと紛れないよう退避する。
                const value = inner()?.replace(/(?<!\\)([[\]])/g, '\\$1');
                if (value === undefined) break;
                const href = node.attrs['data-mve-link'] ?? node.attrs.href ?? '';
                // 表示文字がリンク先そのもののリンクは、自動リンク（`<URL>`）で書く。
                if (!node.attrs.class && node.attrs.title === undefined && Object.keys(node.attrs).every((name) => name === 'href')
                    && textContent(node.children) === href && /^(?:https?:|mailto:)/i.test(href) && !/[\s<>]/.test(href)) {
                    piece = `<${href}>`;
                    break;
                }
                // class付きリンクはMarkdownの記法では書けないが、Markdown文書のプレビューが描画する混在Textileの`"(class). label":url`で書ける。
                if (node.attrs.class) {
                    piece = node.attrs.title === undefined ? `"(${node.attrs.class}). ${value}":${href}` : undefined;
                    break;
                }
                const title = node.attrs['data-mve-workspace-rooted'] === 'true' ? ' "MVE workspace-root link"'
                    : node.attrs.title !== undefined ? ` "${node.attrs.title.replace(/"/g, '\\"')}"` : '';
                piece = `[${value}](${href}${title})`;
                break;
            }
            case COMMENT_TAG: piece = `<!--${node.attrs.text}-->`; break;
            case 'sup':
                if (hasClass(node, 'footnote-ref') || hasClass(node, 'footnote')) {
                    // 表示される番号ではなく、リンク先に残る脚注IDから元の参照を作る。Markdownの参照は#fn-<id>、
                    // Textileの参照（構文の意味が同じ）は#fn<番号>を指す。
                    const link = node.children.find((child): child is HtmlElement => typeof child !== 'string' && child.tag === 'a');
                    const id = /^#fn-?(.+)$/.exec(link?.attrs.href ?? '')?.[1];
                    piece = id === undefined ? undefined : `[^${id}]`;
                } else {
                    const value = inner();
                    piece = value === undefined ? undefined : `^${value}^`;
                }
                break;
            case 'sub': { const value = inner(); piece = value === undefined ? undefined : `~${value}~`; break; }
            case 'kbd': case 'u': case 'small': case 'q': case 'var': case 'samp': case 'dfn': case 'time': case 'abbr': case 'cite': case 'bdi': case 'ruby': case 'rt': case 'rp': {
                // Markdownに記法のないインライン要素は、Markdownでも書ける生HTMLのタグで囲み、中身はMarkdownの記法で書く。
                const value = inner();
                piece = value === undefined ? undefined : `<${node.tag}${serializeAttributes(node)}>${value}</${node.tag}>`;
                break;
            }
            case 'span':
                if ((hasClass(node, 'math-node') || hasClass(node, 'math-error')) && node.attrs['data-math-source'] !== undefined) {
                    // 描画に失敗した数式も、元の数式の文字列（data-math-source）から同じ記法へ戻す。
                    piece = `$${safeDecodeURIComponent(node.attrs['data-math-source'])}$`;
                } else if (hasClass(node, 'caps') && Object.keys(node.attrs).length === 1) {
                    // 大文字の略語にTextileが付ける装飾。Markdown文書のプレビュー（混在Textile）も同じ語へ付ける。
                    piece = escapeMarkdownText(textContent(node.children));
                } else if (node.attrs.class && Object.keys(node.attrs).length === 1) {
                    // class付きspanは、Markdown文書のプレビューが描画する混在Textileの`%(class)text%`で書ける。
                    const value = inner();
                    piece = value === undefined ? undefined : `%(${node.attrs.class})${value}%`;
                }
                break;
            default:
                break;
        }
        if (piece === undefined) return undefined;
        output += piece;
    }
    return output;
}

/**
 * Markdownのプレビューが描画したHTMLのうち、順変換が書き出した形を、Markdownの記法へ戻す。
 * 対象: Mermaid図、コードブロック（見出し帯付き）、数式、タスクリスト、注記、脚注一覧、目次、改ページ、
 * 見出し・段落・引用・リスト・表・水平線と、その中のインライン記法。
 * @param html - 1ブロック分のHTML。
 * @param eol - 生成する複数行の改行コード。
 * @param headingIds - 見出しのIDを明示ID（`{#id}`）として書く場合はtrue。既定はfalse（見出しの文字から自動で付くIDに任せる）。
 * @returns Markdownの記法。認識できない形ならundefined。
 */
export function htmlToMarkdown(html: string, eol: string, headingIds = false): string | undefined {
    return convertBlocks(html, eol, (node) => blockToMarkdown(node, eol, headingIds), (run) => inlineToMarkdown(run)?.trim());
}

/**
 * HTML断片を最上位の節点ごとに記法へ戻して空行で連結する。ブロック要素の外にある文字とインライン要素の並び
 * （Textileの`<notextile>`の本文など、段落で包まれずに表示される文字）は、構文の意味が同じ段落として書く。
 * @param html - HTML断片。
 * @param eol - 改行コード。
 * @param block - ブロック要素1つを記法へ戻す関数。
 * @param paragraph - 文字とインライン要素の並びを段落の記法へ戻す関数。
 * @returns 記法。戻せない節点があればundefined。
 */
function convertBlocks(
    html: string,
    eol: string,
    block: (node: HtmlElement) => string | undefined,
    paragraph: (run: HtmlNode[]) => string | undefined
): string | undefined {
    const nodes = parseHtml(html).filter((node) => typeof node !== 'string' || node.trim() !== '');
    const blocks: string[] = [];
    let run: HtmlNode[] = [];
    /**
     * たまった文字とインライン要素を1つの段落にする。
     * @returns 戻せなければfalse。
     */
    const flush = (): boolean => {
        if (run.length === 0) return true;
        const text = paragraph(run);
        run = [];
        if (!text) return false;
        blocks.push(text);
        return true;
    };
    for (const node of nodes) {
        // 数式ブロック（span.math-block）はspanでも独立したブロックとして表示される。
        if (typeof node === 'string' || (INLINE_TAGS.has(node.tag) && !(node.tag === 'span' && hasClass(node, 'math-block')))) {
            run.push(node);
            continue;
        }
        if (!flush()) return undefined;
        const converted = block(node);
        if (converted === undefined) return undefined;
        blocks.push(converted);
    }
    if (!flush()) return undefined;
    // 規則の一部（表の行・Textileの改行・リスト）はLFで連結するため、最後に文書の改行コードへ揃える（CRLF文書にLFを混ぜない）。
    return blocks.join(eol + eol).replace(/\r\n|\r|\n/g, eol);
}

/** 段落の中に置かれるインライン要素。ブロックの外にあれば、前後の文字と一緒に段落として扱う。 */
const INLINE_TAGS = new Set(['a', 'abbr', 'b', 'br', 'cite', 'code', 'del', 'em', 'i', 'img', 'ins', 'kbd', 'mark', 's', 'small', 'span', 'strong', 'sub', 'sup', 'u']);

/**
 * Markdown由来のブロック要素1つをMarkdownの記法へ戻す。
 * @param node - 要素。
 * @param eol - 改行コード。
 * @param headingIds - 見出しのIDを明示IDとして書く場合はtrue。
 * @returns Markdownの記法。認識できなければundefined。
 */
function blockToMarkdown(node: HtmlElement, eol: string, headingIds: boolean): string | undefined {
    if (node.tag === COMMENT_TAG) return `<!--${node.attrs.text}-->`;
    if (node.tag === 'div' && hasClass(node, 'mermaid') && node.attrs['data-mermaid-source'] !== undefined) {
        return ['```mermaid', ...safeDecodeURIComponent(node.attrs['data-mermaid-source']).split(/\r\n|\r|\n/), '```'].join(eol);
    }
    if (node.tag === 'figure' && hasClass(node, 'code-figure')) {
        const pre = node.children.find((child): child is HtmlElement => typeof child !== 'string' && child.tag === 'pre');
        const code = pre?.children.find((child): child is HtmlElement => typeof child !== 'string' && child.tag === 'code');
        if (!code) return undefined;
        const body = textContent(code.children);
        // 本文の行頭に3つ以上のバッククォートがあるとフェンスが閉じるため、それより長いフェンスにする。
        const longest = Math.max(2, ...[...body.matchAll(/^ {0,3}(`{3,})/gm)].map((match) => match[1].length));
        const fence = '`'.repeat(longest + 1);
        return [`${fence}${node.attrs['data-language'] ?? ''}`, ...body.split(/\r\n|\r|\n/), fence].join(eol);
    }
    // Textileの`bc.`（帯のない<pre><code>）も、構文の意味が同じMarkdownのフェンスへ戻す。言語はcodeまたはpreのclassから読む。
    if (node.tag === 'pre') {
        const children = meaningfulChildren(node);
        const code = children.length === 1 && typeof children[0] !== 'string' && children[0].tag === 'code' ? children[0] : undefined;
        if (!code) return undefined;
        const body = textContent(code.children);
        const longest = Math.max(2, ...[...body.matchAll(/^ {0,3}(`{3,})/gm)].map((match) => match[1].length));
        const fence = '`'.repeat(longest + 1);
        const language = `${code.attrs.class ?? ''} ${node.attrs.class ?? ''}`.split(/\s+/)
            .filter((name) => name && name !== 'hljs')
            .map((name) => name.replace(/^(?:language-|lang-)/, ''))[0] ?? '';
        return [`${fence}${language}`, ...body.split(/\r\n|\r|\n/), fence].join(eol);
    }
    if (node.tag === 'span' && hasClass(node, 'math-block') && node.attrs['data-math-source'] !== undefined) {
        return ['$$', ...safeDecodeURIComponent(node.attrs['data-math-source']).split(/\r\n|\r|\n/), '$$'].join(eol);
    }
    if (node.tag === 'nav' && hasClass(node, 'table-of-contents')) return '[TOC]';
    if (node.tag === 'div' && hasClass(node, 'page-break')) return '<!-- pagebreak -->';
    if (node.tag === 'hr') return '---';
    if (/^h[1-6]$/.test(node.tag)) {
        const text = inlineToMarkdown(node.children);
        if (text === undefined) return undefined;
        const id = headingIds && node.attrs.id ? ` {#${node.attrs.id}}` : '';
        // 改行を含む見出しはATX形式（1行）では書けない。h1・h2はsetext形式（下線）なら複数行のまま書ける。
        if (text.includes('<br>') && !id && (node.tag === 'h1' || node.tag === 'h2')) {
            return [text.split('<br>').map((line) => line.trim()).join(`  ${eol}`), node.tag === 'h1' ? '===' : '---'].join(eol);
        }
        return `${'#'.repeat(Number(node.tag[1]))} ${text}${id}`;
    }
    if (node.tag === 'p' && Object.keys(node.attrs).length === 0) {
        const text = inlineToMarkdown(node.children, true);
        // 改行（<br>）は、行末の空白2つによるハード改行で書く。ソフト改行は文書の改行コードへ揃える。
        return text === undefined ? undefined : text.split('<br>').map((line) => line.trim()).join(`  ${eol}`).replace(/\r?\n/g, eol);
    }
    if (node.tag === 'aside' && hasClass(node, 'markdown-alert')) {
        const kind = /\balert-(\w+)\b/.exec(node.attrs.class ?? '')?.[1];
        const body = node.children.find((child): child is HtmlElement => typeof child !== 'string' && child.tag === 'div');
        const text = body ? inlineToMarkdown(body.children) : undefined;
        if (!kind || text === undefined) return undefined;
        return [`> [!${kind.toUpperCase()}]\\`, ...text.split('<br>').map((line) => `> ${line}`)].join(eol);
    }
    if (node.tag === 'blockquote' && Object.keys(node.attrs).length === 0) {
        const inner = meaningfulChildren(node);
        const parts: string[] = [];
        for (const child of inner) {
            if (typeof child === 'string') return undefined;
            const part = blockToMarkdown(child, eol, headingIds);
            if (part === undefined) return undefined;
            parts.push(part);
        }
        return parts.join(`${eol}${eol}`).split(/\r\n|\r|\n/).map((line) => (line ? `> ${line}` : '>')).join(eol);
    }
    if ((node.tag === 'ul' || node.tag === 'ol') && Object.keys(node.attrs).length === 0) {
        return listToMarkdown(node, eol, '');
    }
    if (node.tag === 'section' && hasClass(node, 'footnotes')) {
        const list = node.children.find((child): child is HtmlElement => typeof child !== 'string' && child.tag === 'ol');
        if (!list) return undefined;
        const definitions: string[] = [];
        for (const item of meaningfulChildren(list)) {
            if (typeof item === 'string' || item.tag !== 'li') return undefined;
            const id = /^fn-(.+)$/.exec(item.attrs.id ?? '')?.[1];
            const content = item.children.filter((child) => typeof child === 'string' || child.tag !== 'a' || !(child.attrs.href ?? '').startsWith('#fnref-'));
            const text = inlineToMarkdown(content);
            if (!id || text === undefined) return undefined;
            definitions.push(`[^${id}]: ${text.trim()}`);
        }
        return definitions.join(eol);
    }
    if (node.tag === 'table') return tableToMarkdown(node);
    return undefined;
}

/**
 * Markdown由来のリストをMarkdownの記法へ戻す（タスクリストを含む）。
 * @param list - ulまたはol要素。
 * @param eol - 改行コード。
 * @param indent - 字下げ。
 * @returns Markdownのリスト。認識できなければundefined。
 */
function listToMarkdown(list: HtmlElement, eol: string, indent: string): string | undefined {
    const items: string[] = [];
    let loose = false;
    let number = Number(list.attrs.start ?? '1');
    for (const item of meaningfulChildren(list)) {
        if (typeof item === 'string' || item.tag !== 'li') return undefined;
        const marker = list.tag === 'ol' ? `${number++}.` : '-';
        const childIndent = indent + ' '.repeat(marker.length + 1);
        let task = '';
        const checkbox = item.children.find((child): child is HtmlElement => typeof child !== 'string' && child.tag === 'input');
        if (checkbox) task = checkbox.attrs.checked !== undefined ? '[x] ' : '[ ] ';
        // 項目の中身を、インラインの並び・段落・入れ子のブロック（リスト・引用・コードなど）の塊に分けて順に書く。
        // 段落（<p>）を含む項目は、項目を空行で区切ったリスト（loose list）として書く。
        const chunks: Array<{ text: string; indented: boolean }> = [];
        let inline: HtmlNode[] = [];
        /**
         * たまったインラインの並びを1つの塊にする。
         * @returns 変換できなければfalse。
         */
        const flushInline = (): boolean => {
            const meaningful = inline.filter((child) => typeof child !== 'string' || child.trim() !== '');
            inline = [];
            if (meaningful.length === 0) return true;
            const text = inlineToMarkdown(meaningful);
            if (text === undefined) return false;
            chunks.push({ text: text.trim(), indented: false });
            return true;
        };
        for (const child of item.children) {
            if (child === checkbox) continue;
            if (typeof child === 'string' || !isListItemBlock(child)) {
                inline.push(child);
                continue;
            }
            if (!flushInline()) return undefined;
            let text: string | undefined;
            if (child.tag === 'ul' || child.tag === 'ol') {
                text = listToMarkdown(child, eol, childIndent);
                if (text === undefined) return undefined;
                chunks.push({ text, indented: true });
                continue;
            }
            if (child.tag === 'p' && Object.keys(child.attrs).length === 0) {
                loose = true;
                text = blockToMarkdown(child, eol, false);
            } else {
                text = blockToMarkdown(child, eol, false);
            }
            if (text === undefined) return undefined;
            chunks.push({ text, indented: false });
        }
        if (!flushInline()) return undefined;
        /**
         * 塊の2行目以降（入れ子のリストは全行が字下げ済み）を項目の字下げに揃える。
         * @param chunk - 塊。
         * @param first - 項目の記号と同じ行に置く最初の塊ならtrue。
         * @returns 字下げした文字列。
         */
        const place = (chunk: { text: string; indented: boolean }, first: boolean): string => (chunk.indented
            ? chunk.text
            : chunk.text.split(/\r\n|\r|\n/).map((line, index) => (line === '' || (first && index === 0) ? line : `${childIndent}${line}`)).join(eol));
        const separator = loose ? eol + eol : eol;
        const head = chunks[0] && !chunks[0].indented ? chunks.shift() : undefined;
        const lines = [`${indent}${marker} ${task}${head ? place(head, true) : ''}`.replace(/ +$/, ''), ...chunks.map((chunk) => place(chunk, false))];
        items.push(lines.join(separator));
    }
    return items.join(loose ? eol + eol : eol);
}

/**
 * 表をGFMの表へ戻す。結合セルなどGFMで表せない表はundefined。
 * @param table - table要素。
 * @returns GFMの表。
 */
function tableToMarkdown(table: HtmlElement): string | undefined {
    const rows: HtmlElement[] = [];
    /**
     * tr要素を集める。
     * @param nodes - 節点。
     */
    const collect = (nodes: readonly HtmlNode[]): void => {
        for (const node of nodes) {
            if (typeof node === 'string') continue;
            if (node.tag === 'tr') rows.push(node);
            else if (['thead', 'tbody', 'tfoot'].includes(node.tag)) collect(node.children);
        }
    };
    collect(table.children);
    if (rows.length === 0) return undefined;
    const cells = rows.map((row) => meaningfulChildren(row).filter((cell): cell is HtmlElement => typeof cell !== 'string'));
    if (cells.some((row) => row.some((cell) => cell.attrs.colspan || cell.attrs.rowspan))) return undefined;
    if (!cells[0].every((cell) => cell.tag === 'th')) return undefined;
    const render = (cell: HtmlElement): string | undefined => inlineToMarkdown(cell.children)?.trim().replace(/\|/g, '\\|');
    const header = cells[0].map(render);
    if (header.some((cell) => cell === undefined)) return undefined;
    const aligns = cells[0].map((cell) => cell.attrs.align ?? /text-align:\s*(\w+)/.exec(cell.attrs.style ?? '')?.[1]);
    const lines = [`| ${header.join(' | ')} |`, `| ${aligns.map((align) => (align === 'center' ? ':---:' : align === 'right' ? '---:' : align === 'left' ? ':---' : '---')).join(' | ')} |`];
    for (const row of cells.slice(1)) {
        const values = row.map(render);
        if (values.some((value) => value === undefined)) return undefined;
        lines.push(`| ${values.join(' | ')} |`);
    }
    return lines.join('\n');
}

/**
 * Textileのプレビューが描画したブロックHTMLのうち、順変換が書き出した形をTextileの記法へ戻す。
 * 対象: 配置、余白、class、ID、言語、styleの付いた段落と見出し、div、定義リスト、脚注、結合セルや属性の付いた表、
 * 引用、リスト、コード（`<pre><code>`・`<pre>`）と、その中のインライン記法。
 * @param html - 1ブロック分のHTML。
 * @param eol - 生成する複数行の改行コード。
 * @param explicit - 見出しのIDと段落の署名（`p.`）を明示して書く場合はtrue。既定はfalse（見出しの自動IDに任せ、
 *   属性のない段落は署名を省く標準の書き方）。
 * @param footnoteIds - 文書全体のMarkdownの脚注ID（定義の順）。Markdownの脚注参照（`sup.footnote-ref`）を、
 *   変換器と同じ番号のTextileの参照（`[n]`）へ戻すために使う。省略時はMarkdownの脚注参照を戻さない。
 * @returns Textileの記法。認識できない形ならundefined。
 */
export function htmlToTextile(html: string, eol: string, explicit = false, footnoteIds: readonly string[] = []): string | undefined {
    const previous = textileFootnoteIds;
    textileFootnoteIds = footnoteIds;
    try {
        return convertBlocks(html, eol, (node) => blockToTextile(node, eol, explicit), (run) => inlineToTextile(run)?.trim());
    } finally {
        textileFootnoteIds = previous;
    }
}

/**
 * 実行中の{@link htmlToTextile}に渡された、文書全体のMarkdownの脚注ID。深いインライン変換へ引数を通さずに参照するため
 * モジュール変数で持ち、変換の終了時に必ず戻す（変換は同期処理で入れ子にならない）。
 */
let textileFootnoteIds: readonly string[] = [];

/**
 * Textileのブロック属性（配置、余白、class、ID、言語、style）を、署名の属性部分へ戻す。
 * @param element - 要素。
 * @param allowAlign - 配置記号を使える要素ならtrue。
 * @returns 属性部分（例: `(cls#id)[ja]{color:red}<`）。表せない属性があればundefined。
 */
function textileAttributes(element: HtmlElement, allowAlign: boolean): string | undefined {
    let classId = '';
    if (element.attrs.class || element.attrs.id) classId = `(${element.attrs.class ?? ''}${element.attrs.id ? `#${element.attrs.id}` : ''})`;
    const lang = element.attrs.lang ? `[${element.attrs.lang}]` : '';
    let align = '';
    let padding = '';
    const rest: string[] = [];
    for (const declaration of (element.attrs.style ?? '').split(';').map((item) => item.trim()).filter(Boolean)) {
        const [name, value] = declaration.split(':').map((item) => item.trim());
        if (allowAlign && name === 'text-align') {
            align = value === 'left' ? '<' : value === 'right' ? '>' : value === 'center' ? '=' : value === 'justify' ? '<>' : '';
            if (!align) return undefined;
        } else if (name === 'padding-left' && /^\d+em$/.test(value)) padding += '('.repeat(Number.parseInt(value, 10));
        else if (name === 'padding-right' && /^\d+em$/.test(value)) padding += ')'.repeat(Number.parseInt(value, 10));
        else rest.push(declaration);
    }
    const others = Object.keys(element.attrs).filter((name) => !['class', 'id', 'lang', 'style'].includes(name));
    if (others.length > 0) return undefined;
    return `${classId}${lang}${rest.length ? `{${rest.join(';')}}` : ''}${padding}${align}`;
}

/**
 * Textile由来のインラインHTMLを、Textileのインライン記法へ戻す。
 * @param nodes - 節点の一覧。
 * @returns Textileのインライン記法。認識できない要素を含む場合はundefined。
 */
function inlineToTextile(nodes: readonly HtmlNode[]): string | undefined {
    let output = '';
    for (const [index, node] of nodes.entries()) {
        /**
         * Textileのリンク・画像リンクのURLは、直後の全角文字（`。`など）まで取り込む。直後が空白・半角の句読点・行末でなければ、
         * URLの終わりを明示する角括弧の書き方（`["label":url]`）にする。
         * @param link - 角括弧なしのリンクの記法。
         * @returns 直後の文字に合わせたリンクの記法。
         */
        const bracketIfNeeded = (link: string): string => {
            const next = nodes[index + 1];
            const following = typeof next === 'string' ? next : next === undefined ? '' : 'x';
            // 空白と、URLの末尾として取り込まれない半角の句読点（`.`・`,`など）の前では、角括弧は要らない。
            return following === '' || /^[\s.,;:!?)]/.test(following) ? link : `[${link}]`;
        };
        if (typeof node === 'string') {
            // 表示された記号（“”・—・…など）は、Textileの文字置換の逆で元の書き方（`"`・`--`・`...`）へ戻す。
            // 戻せない記号は文字置換が働かないよう文字参照にする（どちらもTextileで同じ文字として表示される）。
            output += toTextilePlainText(node.replace(/\s*\n\s*/g, ' '));
            continue;
        }
        const inner = (): string | undefined => inlineToTextile(node.children);
        let piece: string | undefined;
        const wrap = (marker: string, closer = marker): string | undefined => {
            const value = inner();
            return value === undefined ? undefined : `${marker}${value}${closer}`;
        };
        switch (node.tag) {
            case 'strong': piece = wrap('*'); break;
            case 'b': piece = wrap('**'); break;
            case 'em': piece = wrap('_'); break;
            case 'i': piece = wrap('__'); break;
            case 'del': piece = wrap('-'); break;
            case 'ins': piece = wrap('+'); break;
            case 'cite': piece = wrap('??'); break;
            case 'sub': piece = wrap('~'); break;
            case 'code': piece = `@${textContent(node.children)}@`; break;
            case COMMENT_TAG: piece = `<!--${node.attrs.text}-->`; break;
            case 'br': piece = '\n'; break;
            case 'span':
                if (hasClass(node, 'caps') && Object.keys(node.attrs).length === 1) piece = textContent(node.children);
                else if (Object.keys(node.attrs).every((name) => name === 'class')) piece = wrap(node.attrs.class ? `%(${node.attrs.class})` : '%', '%');
                break;
            case 'abbr':
                piece = node.attrs.title !== undefined ? `${textContent(node.children)}(${node.attrs.title})` : undefined;
                break;
            case 'sup':
                if (hasClass(node, 'footnote')) piece = `[${textContent(node.children)}]`;
                else if (hasClass(node, 'footnote-ref')) {
                    // Markdownの脚注参照（構文の意味が同じ）は、文書全体の脚注の順に振ったTextileの番号の参照にする。
                    const link = node.children.find((child): child is HtmlElement => typeof child !== 'string' && child.tag === 'a');
                    const id = /^#fn-(.+)$/.exec(link?.attrs.href ?? '')?.[1];
                    const index = id === undefined ? -1 : textileFootnoteIds.indexOf(id);
                    piece = index < 0 ? undefined : `[${index + 1}]`;
                }
                else piece = wrap('^');
                break;
            case 'img': {
                const alt = node.attrs.alt ? `(${node.attrs.alt})` : '';
                piece = `!${node.attrs['data-original-src'] ?? node.attrs.src ?? ''}${alt}!`;
                break;
            }
            case 'a': {
                const href = node.attrs['data-mve-link'] ?? node.attrs.href ?? '';
                // 画像だけのリンクは、Textileの画像リンク（`!src(alt)!:url`）で書く。
                const only = meaningfulChildren(node);
                if (only.length === 1 && typeof only[0] !== 'string' && only[0].tag === 'img' && Object.keys(node.attrs).every((name) => name === 'href' || name === 'data-mve-link')) {
                    const image = inlineToTextile(only);
                    piece = image === undefined ? undefined : bracketIfNeeded(`${image}:${href}`);
                    break;
                }
                const value = inner();
                if (value === undefined) break;
                const title = node.attrs.title !== undefined ? `(${node.attrs.title})` : '';
                // classは表示文字の前の`(class)`で書く。class以外の属性（id・styleなど）はTextileのリンクでは書けない。
                if (Object.keys(node.attrs).some((name) => !['href', 'data-mve-link', 'title', 'class'].includes(name))) break;
                piece = bracketIfNeeded(`"${node.attrs.class ? `(${node.attrs.class})` : ''}${value}${title}":${href}`);
                break;
            }
            default:
                break;
        }
        if (piece === undefined) return undefined;
        output += piece;
    }
    return output;
}

/**
 * Textile由来のブロック要素1つをTextileの記法へ戻す。
 * @param node - 要素。
 * @param eol - 改行コード。
 * @param explicit - 見出しのIDと段落の署名を明示する場合はtrue。
 * @returns Textileの記法。認識できなければundefined。
 */
function blockToTextile(node: HtmlElement, eol: string, explicit = false): string | undefined {
    /**
     * 規則が作った改行（LF）を文書の改行コードへ揃える。
     * @param text - LFで改行した文字列。
     * @returns 文書の改行コードで改行した文字列。
     */
    const withLines = (text: string): string => text.split('\n').join(eol);
    if (node.tag === COMMENT_TAG) return `<!--${node.attrs.text}-->`;
    // Markdownのコードブロック（見出し帯付きのfigure）は、構文の意味が同じTextileの`bc.`へ戻す。帯は表示上の装飾なので捨てる。
    const figurePre = node.tag === 'figure' && hasClass(node, 'code-figure')
        ? node.children.find((child): child is HtmlElement => typeof child !== 'string' && child.tag === 'pre')
        : undefined;
    const pre = node.tag === 'pre' ? node : figurePre;
    if (pre) {
        const children = meaningfulChildren(pre);
        const code = children.length === 1 && typeof children[0] !== 'string' && children[0].tag === 'code' ? children[0] : undefined;
        const body = textContent(code ? code.children : pre.children);
        const kind = code ? 'bc' : 'pre';
        const language = (node.attrs['data-language'] ?? `${code?.attrs.class ?? ''} ${pre.attrs.class ?? ''}`.split(/\s+/)
            .filter((name) => name && name !== 'hljs')
            .map((name) => name.replace(/^(?:language-|lang-)/, ''))[0] ?? '');
        if (!/^[\w+.-]*$/.test(language)) return undefined;
        const extended = /\n[ \t]*\n/.test(body);
        return withLines(`${kind}${language ? `(${language})` : ''}.${extended ? '.' : ''} ${body}`);
    }
    if (/^h[1-6]$/.test(node.tag) || node.tag === 'p' || node.tag === 'div') {
        if (node.tag === 'p' && hasClass(node, 'footnote') && /^fn\d+$/.test(node.attrs.id ?? '')) {
            // 脚注の本文の先頭にある、参照へ戻るリンク（#fnr…）だけを除く。本文中のリンクは残す。
            const content = node.children.filter((child) => typeof child === 'string' || child.tag !== 'a' || !(child.attrs.href ?? '').startsWith('#fnr'));
            const text = inlineToTextile(content);
            return text === undefined ? undefined : withLines(`${node.attrs.id}. ${text.trim()}`);
        }
        // 見出しのIDは描画器が見出しの文字から自動で付けるため、明示しない書き方では除く。
        const element = !explicit && /^h[1-6]$/.test(node.tag) ? { ...node, attrs: Object.fromEntries(Object.entries(node.attrs).filter(([name]) => name !== 'id')) } : node;
        const attributes = textileAttributes(element, true);
        const text = inlineToTextile(node.children);
        if (attributes === undefined || text === undefined) return undefined;
        // 属性のない段落は、署名（`p.`）を省いた標準の書き方にする。
        if (!explicit && node.tag === 'p' && attributes === '') return withLines(text.trim());
        return withLines(`${node.tag}${attributes}. ${text.trim()}`);
    }
    if (node.tag === 'dl') {
        const lines: string[] = [];
        let term: string | undefined;
        for (const child of meaningfulChildren(node)) {
            if (typeof child === 'string') return undefined;
            const text = inlineToTextile(child.children);
            if (text === undefined) return undefined;
            if (child.tag === 'dt') term = text.trim();
            else if (child.tag === 'dd' && term !== undefined) {
                lines.push(`- ${term} := ${text.trim()}`);
                term = undefined;
            } else return undefined;
        }
        return lines.join(eol);
    }
    if (node.tag === 'table') {
        const lines: string[] = [];
        for (const row of meaningfulChildren(node)) {
            if (typeof row === 'string') return undefined;
            const rows = ['thead', 'tbody', 'tfoot'].includes(row.tag)
                ? meaningfulChildren(row).filter((child): child is HtmlElement => typeof child !== 'string')
                : [row];
            for (const tr of rows) {
                if (tr.tag !== 'tr') return undefined;
                const rowAttributes = textileAttributes(tr, false);
                if (rowAttributes === undefined) return undefined;
                const cells: string[] = [];
                for (const cell of meaningfulChildren(tr)) {
                    if (typeof cell === 'string' || (cell.tag !== 'td' && cell.tag !== 'th')) return undefined;
                    const { colspan, rowspan, ...rest } = cell.attrs;
                    const cellAttributes = textileAttributes({ ...cell, attrs: rest }, true);
                    const text = inlineToTextile(cell.children);
                    if (cellAttributes === undefined || text === undefined) return undefined;
                    const modifiers = `${cell.tag === 'th' ? '_' : ''}${colspan ? `\\${colspan}` : ''}${rowspan ? `/${rowspan}` : ''}${cellAttributes}`;
                    cells.push(`${modifiers ? `${modifiers}. ` : ''}${text.trim()}`);
                }
                lines.push(`${rowAttributes ? `${rowAttributes}. ` : ''}|${cells.join('|')}|`);
            }
        }
        return lines.join(eol);
    }
    if (node.tag === 'blockquote') {
        const paragraphs = meaningfulChildren(node);
        const texts: string[] = [];
        for (const paragraph of paragraphs) {
            if (typeof paragraph === 'string' || paragraph.tag !== 'p') return undefined;
            const text = inlineToTextile(paragraph.children);
            if (text === undefined) return undefined;
            texts.push(text.trim());
        }
        if (texts.length === 1) return withLines(`bq. ${texts[0]}`);
        return withLines(`bq.. ${texts.join('\n\n')}`);
    }
    if (node.tag === 'ul' || node.tag === 'ol') return listToTextile(node, '', eol);
    return undefined;
}

/**
 * Textile由来のリストをTextileの記法へ戻す。
 * @param list - ulまたはol要素。
 * @param prefix - 親の階層の記号。
 * @param eol - 改行コード。
 * @returns Textileのリスト。
 */
function listToTextile(list: HtmlElement, prefix: string, eol: string): string | undefined {
    const marker = prefix + (list.tag === 'ol' ? '#' : '*');
    const lines: string[] = [];
    for (const item of meaningfulChildren(list)) {
        if (typeof item === 'string' || item.tag !== 'li') return undefined;
        const nested = item.children.filter((child): child is HtmlElement => typeof child !== 'string' && (child.tag === 'ul' || child.tag === 'ol'));
        const text = inlineToTextile(item.children.filter((child) => typeof child === 'string' || (child.tag !== 'ul' && child.tag !== 'ol')));
        if (text === undefined) return undefined;
        lines.push(`${marker} ${text.trim()}`);
        for (const child of nested) {
            const sub = listToTextile(child, marker, eol);
            if (sub === undefined) return undefined;
            lines.push(sub);
        }
    }
    return lines.join(eol);
}

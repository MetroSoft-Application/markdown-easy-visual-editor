/**
 * @fileoverview 文書変換の前後で、プレビューが同じ意味の内容を表示しているかを描画結果（サニタイズ前HTML）から判定する。
 * 実行境界: Webview（変換タブの適用前検査）とtest（Node）。DOMに依存しない文字列処理だけで実装する。
 * 入力は同じ描画器（markdownRendererCore）が変換前・変換後の文書から作ったブロック一覧。
 * 目的: 変換の実装の誤り（文字・要素・リンク先などが変わること）を見つけること。構文の意味が同じで、描画器が付ける
 * 表示上の装飾だけが違う場合は同じとみなし、変換器が記法を大きく変えずに同じ意味の記法へ写せるようにする。
 * 不変条件: 次の違いは「違う」と判定する。要素の種類と入れ子、文字、コード内とインライン要素間の空白、
 * 許可リスト（VISIBLE_ATTRIBUTES）にある属性＝リンク先・タイトル・画像の参照/代替文字列/寸法/配置・style・align・
 * colspan/rowspan・リストの開始番号・class・id・lang・dir・旧来の表示属性、図のソース、コードの言語名、ワークスペース基準リンクの印。
 * 許可リストにない属性と、`pre`内の構文強調用`span`は比較しない（変換器はそれらを書き換えないため、現在の変換では差が生じない）。
 * 構文の意味が同じで表示上の装飾だけが違うものとして、次を同じとみなす。
 * - コードブロックの見出し帯（言語名とコピーボタン）の有無と、コード末尾の空行。
 * - 画像のtitle（ツールチップ）。Textileの画像は代替文字列をtitleにも使い、別のtitleを書けない。参照先と代替文字列は比べる。
 * - 見出しのID（明示IDは同じ意味の記法へ写し、Textileのプレビューは本文からIDを決める）。見出しの本文は比べる。
 * - 脚注の表示位置（Markdownは文書末尾、Textileは定義の位置）と番号の書き方。参照の位置、参照が指す脚注、脚注の本文は比べる。
 * - ブロック要素の外や`<details>`・`<div>`の直下にある文字（Textileの`notextile`の本文など）と段落（段落の内外は余白の違いだけ）。
 * - ゆるいリストの項目の段落と、リスト項目の中の2つ目以降の段落と項目の中の改行（Textileの項目は段落を分けられない）。
 * - HTMLの要素ではない`<notextile>`タグと、ブロック要素の直前で閉じられる段落（ブラウザーの解釈と同じ）。
 * - 変換先に描画の記法がないため同じ意味の書き方へ写した要素（{@link canonicalizeMeaning}。タスクリストの印、図・数式のソース、
 *   目次の指定、ページ区切り、強調表示、注記、略語、定義リスト）。図や数式のソース、文字は比べる。
 * このほか同じとみなすのは、次の描画器内部・直列化の違いだけ。
 * - ソース位置対応のラッパー（`markdown-source-block`）と、編集用の属性（`data-mve-*`のうち画像配置とワークスペース基準リンク以外、
 *   `data-source-*`、`loading`・`decoding`など表示に影響しない属性）、構文強調用のclass（`hljs*`・`language-*`）。
 * - 同じ見た目になる別名タグ（`b`と`strong`、`i`と`em`、`thead`/`tbody`の有無、`td`の`align`と`text-align`、
 *   Textileの略語に付く`span.caps`）。
 * - 文字参照と実際の文字、改行コード（CRLFとLF）、HTMLの空白文字（スペース・タブ・改行・改ページ）の並び、
 *   ブロック要素の前後の空白、空の段落、`pre`直後の整形用改行。改ページなしの空白（NBSP）は表示に現れるためまとめない。
 * - 表示されないHTMLコメントと、中身のない要素の閉じタグの有無（`<mspace>`と`<mspace></mspace>`）。
 */

/**
 * 比較用に正規化したブロック。
 */
interface NormalizedBlock {
    /** 正規化したHTML。 */
    html: string;
    /** 元文書でのブロックの開始位置（UTF-16）。取得できない場合はundefined。 */
    sourceFrom?: number;
}

/**
 * 変換前後のプレビュー比較結果。
 */
export interface PreviewComparison {
    /** プレビューの見た目が同じ場合にtrue。 */
    equal: boolean;
    /**
     * 違いが最初に現れた、変換前の文書のブロック開始位置（UTF-16）。
     * 位置を持たないブロックで違いが見つかった場合や、同じ場合はundefined。
     */
    firstDifferenceOffset?: number;
}

/**
 * `pre`要素の中身を、空白を保ったまま比較できる形にする。HTMLは`pre`開始タグ直後の改行1つを表示しないため取り除く。
 * @param inner - `pre`開始タグと終了タグの間のHTML。
 * @returns 比較用の中身。
 */
function normalizePreformatted(inner: string): string {
    return inner
        .replace(/^\s*<code\b[^>]*>/, '<code>')
        .replace(/<\/code>\s*$/, '</code>')
        .replace(/<span\b[^>]*>|<\/span>/g, '')
        .replace(/^(<code>)?\r?\n/, '$1')
        // コード末尾の空行は意味を持たない（Textileの`bc..`は次のブロックとの間の空行も本文に含める）ため、すべて除いて比べる。
        .replace(/(?:[ \t]*\r?\n)+(<\/code>)?$/, '$1')
        .replace(/&#(\d+);/g, (whole, code: string) => String.fromCodePoint(Number(code)))
        .replace(/&quot;/g, '"')
        .replace(/&#x27;|&#39;/g, "'");
}

/**
 * コードブロックの言語名を`pre`・`code`のclassから読む。言語名は構文強調の色を決めるため、classを捨てる前に比較対象へ残す。
 * MarkdownはHTMLの`language-x`、Textileは`x`をclassに持つ。強調表示済みを示す`hljs`は言語名ではない。
 * @param preAttributes - `pre`開始タグの属性部分。
 * @param inner - `pre`の中身（`code`開始タグを含む）。
 * @returns 小文字の言語名。指定がなければ空文字。
 */
function readCodeLanguage(preAttributes: string, inner: string): string {
    const classes = [
        ...(/\bclass="([^"]*)"/.exec(/^\s*<code\b([^>]*)>/.exec(inner)?.[1] ?? '')?.[1] ?? '').split(/\s+/),
        ...(/\bclass="([^"]*)"/.exec(preAttributes)?.[1] ?? '').split(/\s+/)
    ].filter((name) => name && name !== 'hljs');
    const language = classes.map((name) => name.replace(/^(?:language-|lang-)/i, '')).find((name) => name.length > 0);
    return (language ?? '').toLowerCase();
}

/**
 * 見た目に影響する属性。これ以外（data-mve-*・data-source-*・loading・decodingなど描画器内部の属性）は比較から除く。
 * `href`はローカルリンクでは`data-mve-link`に入るため、比較時に`href`へ読み替える。
 */
const VISIBLE_ATTRIBUTES = new Set([
    'href', 'src', 'alt', 'title', 'style', 'align', 'width', 'height', 'border', 'colspan', 'rowspan',
    'start', 'type', 'reversed', 'class', 'data-mve-image-align', 'data-mermaid-source', 'checked', 'disabled', 'open',
    // ページ内リンクの移動先（id）、字形を変え得る言語指定（lang）、文字方向、旧来の表示属性。
    'id', 'lang', 'dir', 'valign', 'bgcolor', 'color', 'face', 'size', 'value',
    // `pre`へ移したコードの言語名（構文強調の色を決める）。
    'data-code-language',
    // ワークスペース基準で解決するリンク（クリック時の移動先が変わる）。
    'data-mve-workspace-rooted',
    // 脚注の参照の印（extractFootnotesが付ける。番号の書き方の違いを除いた参照の位置）。
    'data-footnote-ref'
]);

/**
 * 比較から除く描画器内部のクラス。構文強調・言語クラス（言語名は`pre`で別に比較）と、ソース位置のラッパー。
 */
const INTERNAL_CLASS = /^(?:hljs(?:-.*)?|language-.*|lang-.*|markdown-source-block)$/;

/**
 * 1つの開始タグを、見た目に影響する属性だけを名前順に並べた形へ正規化する。
 * 空要素の閉じ（`<br />`と`<br>`）は区別しない。
 * @param name - 小文字のタグ名。
 * @param attributes - 開始タグの属性部分。
 * @returns 正規化した開始タグ。
 */
function normalizeStartTag(name: string, attributes: string): string {
    const values = new Map<string, string>();
    for (const match of attributes.matchAll(/([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        values.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
    }
    if (name === 'a' && values.has('data-mve-link')) values.set('href', values.get('data-mve-link') ?? '');
    // 画像のtitleは、ポインターを重ねたときのツールチップ（表示上の装飾）。Textileの画像`!src(alt)!`は代替文字列をtitleにも使い、
    // 別のtitleを書く記法がないため、Markdownの`![alt](src "title")`は代替文字列だけを写す。画像の内容（参照先・代替文字列）は比べる。
    if (name === 'img') values.delete('title');
    // 見出しのIDは、Markdownは明示ID（`{#id}`）か本文から、Textileのプレビューは明示ID（`h1(#id).`）によらず本文から決める。
    // 明示IDは同じ意味の記法へ写し、本文は比べるため、見出しのIDは比較から除く。
    if (/^h[1-6]$/.test(name)) values.delete('id');
    // 表と表の行のstyle（Textileの`table{…}.`・`{…}. |…|`）は表の装飾で、Markdownの表に書けないため変換で外す。表の構造とセルの内容は比べる。
    if (name === 'table' || name === 'tr') values.delete('style');
    if ((name === 'td' || name === 'th') && !values.has('align')) {
        const styled = /(?:^|;)\s*text-align\s*:\s*(\w+)/.exec(values.get('style') ?? '')?.[1];
        if (styled) values.set('align', styled);
    }
    if (values.has('style')) {
        // 表のセルの配置は`align`として比べるため、styleからは除く。残りのstyleは宣言を正規化して比べる。
        const declarations = (values.get('style') ?? '').split(';')
            .map((declaration) => declaration.trim().replace(/\s*:\s*/, ':').toLowerCase())
            .filter((declaration) => declaration && !((name === 'td' || name === 'th') && declaration.startsWith('text-align:')));
        if (declarations.length > 0) values.set('style', declarations.sort().join(';'));
        else values.delete('style');
    }
    if (values.has('class')) {
        const classes = (values.get('class') ?? '').split(/\s+/).filter((item) => item && !INTERNAL_CLASS.test(item)).sort();
        if (classes.length > 0) values.set('class', classes.join(' '));
        else values.delete('class');
    }
    const kept = [...values.entries()]
        .filter(([attribute]) => VISIBLE_ATTRIBUTES.has(attribute))
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([attribute, value]) => ` ${attribute}="${value}"`);
    return `<${name}${kept.join('')}>`;
}

/**
 * ブロック要素（前後の空白が表示されない要素）のタグ名。インライン要素の前後の空白は「ある・なし」を区別して比べる。
 */
const BLOCK_TAG = String.raw`(?:p|div|ul|ol|li|dl|dt|dd|table|tr|td|th|blockquote|h[1-6]|pre|hr|br|figure|section|nav|details|summary|aside|footnotes|figcaption|thead|tbody|tfoot|caption|main|article|header|footer)`;

/**
 * 1ブロックの描画HTMLを比較用に正規化する。
 * @param html - 描画器が返したサニタイズ前HTML。
 * @returns 正規化したHTML。
 */
export function normalizePreviewHtml(html: string): string {
    const protectedText: string[] = [];
    /**
     * 空白が見た目そのものである断片（コード）を、空白をまとめる処理から退避する。
     * @param text - 退避する断片。
     * @returns 退避先を示す目印。
     */
    const protect = (text: string): string => {
        protectedText.push(text);
        return `\u0000${protectedText.length - 1}\u0000`;
    };
    return html
        // ブラウザーはHTMLを読むときにCRLF・CRをLFへ揃えるため、改行コードの違いは表示に現れない。
        .replace(/\r\n?/g, '\n')
        // HTMLコメントは表示されない（変換で表示されない原文をコメントへ移しても見た目は変わらない）。
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<div class="markdown-source-block"[^>]*>/g, '')
        // Markdownのコードブロックに描画器が付ける見出し帯（言語名とコピーボタン）は表示上の装飾で、構文の意味は
        // Textileの`bc.`（帯なしの<pre><code>）と同じ。変換の正しさを確かめる比較では、帯を除いて中身と言語だけを比べる。
        .replace(/<figure class="code-figure"[^>]*>\s*(?:<figcaption>[\s\S]*?<\/figcaption>)?\s*(<pre\b[\s\S]*?<\/pre>)\s*<\/figure>/g, '$1')
        .replace(/<pre\b([^>]*)>([\s\S]*?)<\/pre>/g,(whole, preAttributes: string, inner: string) => {
            const language = readCodeLanguage(preAttributes, inner);
            const style = /\bstyle="([^"]*)"/.exec(preAttributes)?.[1];
            return `<pre data-code-language="${language}"${style ? ` style="${style}"` : ''}>${protect(normalizePreformatted(inner))}</pre>`;
        })
        .replace(/<code\b([^>]*)>([\s\S]*?)<\/code>/g, (whole, attributes: string, inner: string) =>
            `${normalizeStartTag('code', attributes)}${protect(inner
                .replace(/&#(\d+);/g, (entity, code: string) => String.fromCodePoint(Number(code)))
                .replace(/&quot;/g, '"')
                .replace(/&#x27;/g, "'"))}</code>`)
        .replace(/<\/?(?:thead|tbody)>/g, '')
        .replace(/<b\b/g, '<strong').replace(/<\/b>/g, '</strong>')
        .replace(/<i\b/g, '<em').replace(/<\/i>/g, '</em>')
        .replace(/<span class="caps">([^<]*)<\/span>/g, '$1')
        .replace(/<([a-zA-Z][\w-]*)\b([^<>]*?)\s*\/?>/g, (whole, name: string, attributes: string) => normalizeStartTag(name.toLowerCase(), attributes))
        // 空の段落は表示されない。下の空要素の規則より先に取り除く。
        .replace(/<p>[ \t\n\r\f]*<\/p>/g, '')
        // 中身のない要素は、閉じタグの有無（`<mspace>`と`<mspace></mspace>`など）が直列化の違いだけで見た目は同じ。
        .replace(/<([a-z][\w-]*)((?: [^<>]*)?)><\/\1>/g, '<$1$2>')
        .replace(/&#(\d+);/g, (whole, code: string) => String.fromCodePoint(Number(code)))
        .replace(/&quot;/g, '"')
        .replace(/[ \t\n\r\f]+/g, ' ')
        // ブロック要素の前後の空白は表示されない。インライン要素の前後の空白は1つの空白として残す。
        .replace(new RegExp(String.raw`[ \t\n\r\f]*(</?${BLOCK_TAG}\b[^>]*>)[ \t\n\r\f]*`, 'g'), '$1')
        .replace(/<p><\/p>/g, '')
        // ゆるいリスト（項目を空行で区切ったMarkdownのリスト）は項目の先頭の段落を<p>で包み、行間を広げるだけで内容は同じ。
        .replace(/<li([^>]*)><p>((?:(?!<\/?p\b)[\s\S])*?)<\/p>/g, '<li$1>$2')
        .replace(/[\s\S]*/, (whole) => flattenListParagraphs(whole))
        // ブロック要素の末尾の改行（Textileの複数段落ブロックの最後の段落が末尾の改行から作る`<br>`）は、次の行を作らず表示されない。
        .replace(/(?:<br>)+(<\/(?:p|li|td|th|dt|dd|h[1-6])>)/g, '$1')
        // 段落・セル・見出しなどの先頭と末尾の空白は表示されない（中身のある要素の開始タグの直後と、閉じタグの直前）。
        // 画像などの空要素の後ろの空白は、前後の要素の間の空白として表示されるため対象にしない。
        .replace(/(<(?:p|li|td|th|dt|dd|h[1-6])\b[^>]*>(?:<(?!\/|img\b|br\b|input\b|hr\b)[a-z][\w-]*\b[^>]*>)*) /g, '$1')
        .replace(/ ((?:<\/[a-z][\w-]*>)*<\/(?:p|li|td|th|dt|dd|h[1-6])>)/g, '$1')
        // String.prototype.trimはNBSPも取り除くため、HTMLの空白文字だけを取り除く。
        .replace(/^[ \t\n\r\f]+|[ \t\n\r\f]+$/g, '')
        // 本文・属性値の`>`は文字参照でも素の文字でも同じに表示される（描画器によって書き方が違う）。
        // タグの区切りと紛れないよう、タグを扱う規則をすべて適用した後で揃える。
        .replace(/&gt;/g, '>')
        .replace(/\u0000(\d+)\u0000/g, (whole, index: string) => protectedText[Number(index)] ?? '');
}

/**
 * リスト項目の直下の段落を、項目の中の改行にそろえる。Textileのリスト項目は段落を分けられないため、変換タブはMarkdownの
 * 項目の中の2つ目以降の段落（画像だけの段落など）を、項目の中の改行に続けて書く（同じ項目の中の別の行という意味は同じ）。
 * @param html - 正規化中のHTML（空白をまとめ、項目の先頭の段落を外した後）。
 * @returns 項目の直下の`<p>`を`<br>`にし、`</p>`を除いたHTML。項目の中の入れ子のリストや引用の中の段落はそのまま。
 */
function flattenListParagraphs(html: string): string {
    const stack: string[] = [];
    return html.replace(/<(\/?)([a-z][\w-]*)\b[^>]*>/g, (tag, closing: string, name: string) => {
        const parent = stack[stack.length - 1];
        if (name === 'p' && (closing ? stack[stack.length - 2] === 'li' && parent === 'p' : parent === 'li')) {
            if (closing) stack.pop();
            else stack.push('p');
            return closing ? '' : '<br>';
        }
        if (/^(?:br|hr|img|input|wbr)$/.test(name)) return tag;
        if (closing) {
            const open = stack.lastIndexOf(name);
            if (open >= 0) stack.length = open;
        } else {
            stack.push(name);
        }
        return tag;
    });
}

/**
 * 本文の位置（UTF-16）を1始まりの行番号へ変換する。CRLF・CR・LFのいずれも1つの改行として数える。
 * @param text - 本文。
 * @param offset - 位置。範囲外は本文の端に丸める。
 * @returns 1始まりの行番号。
 */
export function lineNumberAtOffset(text: string, offset: number): number {
    const head = text.slice(0, Math.max(0, Math.min(offset, text.length)));
    return (head.match(/\r\n|\r|\n/g)?.length ?? 0) + 1;
}

/**
 * ブロックの開始タグから元文書での開始位置を読む。
 * @param html - ブロックの描画HTML。
 * @returns 開始位置。属性がなければundefined。
 */
function readSourceFrom(html: string): number | undefined {
    const value = /data-source-from="(\d+)"/.exec(html)?.[1];
    return value === undefined ? undefined : Number(value);
}

/**
 * ブロック一覧を正規化する。描画器はブロックごとに`markdown-source-block`のラッパーで包むため、
 * ラッパーの閉じタグもブロック末尾の1つだけを取り除く。
 * @param blocks - 描画器が返したブロック一覧。
 * @returns 正規化したブロック一覧。空になったブロックは除く。
 */
function normalizeBlocks(blocks: ReadonlyArray<{ html: string }>): NormalizedBlock[] {
    const footnotes: string[] = [];
    const inners = blocks.map((block) => {
        const wrapped = /^\s*<div class="markdown-source-block"[^>]*>([\s\S]*)<\/div>\s*$/.exec(block.html);
        return canonicalizeMeaning(wrapped ? wrapped[1] : block.html);
    });
    // 参照が指す脚注を比べるため、先に文書全体から脚注の本文を集める（Markdownの脚注一覧は文書末尾にある）。
    const definitions = collectFootnoteDefinitions(inners);
    const normalized = blocks
        .map((block, index) => {
            const html = extractFootnotes(inners[index], footnotes, definitions);
            // 段落の外の文字は、閉じタグが残っている正規化前のHTMLで判定する（正規化は中身のない要素の閉じタグを省くため）。
            return { html: normalizePreviewHtml(wrapBareText(html.replace(/<!--[\s\S]*?-->/g, ''))), sourceFrom: readSourceFrom(block.html) };
        })
        .filter((block) => block.html.length > 0);
    // 脚注の本文は、表示される位置（Markdownは文書末尾、Textileは定義を書いた位置）に関係なく、最後にまとめて順に比べる。
    if (footnotes.length > 0) {
        normalized.push({ html: `<footnotes>${footnotes.map((text) => `<li>${normalizePreviewHtml(text)}</li>`).join('')}</footnotes>`, sourceFrom: undefined });
    }
    return normalized;
}

/**
 * HTMLの特殊文字を文字参照にする（同じ意味の形へ書き換えるときに、元の文字列を本文として置くため）。
 * @param text - 文字列。
 * @returns `&`・`<`・`>`を文字参照にした文字列。
 */
function escapeText(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * URIエンコードされた属性値（図・数式のソース）を復号する。不正な値は例外にせず、そのまま返す。
 * @param value - 属性値。
 * @returns 復号した値。
 */
function decodeSource(value: string): string {
    try {
        return decodeURIComponent(value.replace(/&amp;/g, '&').replace(/&quot;/g, '"'));
    } catch {
        return value;
    }
}

/**
 * 開始タグに一致する要素を、入れ子の同名要素を数えて閉じタグまで含めて置き換える（数式の`<span>`は入れ子の`<span>`を含む）。
 * @param html - HTML。
 * @param opener - 置き換える要素の開始タグに一致する正規表現（gフラグ付き）。
 * @param tag - 要素のタグ名。
 * @param replace - 開始タグの一致と中身から、置き換える文字列を作る関数。
 * @returns 置き換えたHTML。閉じタグが見つからない要素は置き換えない。
 */
function replaceElements(html: string, opener: RegExp, tag: string, replace: (start: RegExpExecArray, inner: string) => string): string {
    let output = '';
    let cursor = 0;
    opener.lastIndex = 0;
    for (let start = opener.exec(html); start; start = opener.exec(html)) {
        const tags = new RegExp(String.raw`<(/?)${tag}\b[^>]*>`, 'g');
        tags.lastIndex = start.index + start[0].length;
        let depth = 1;
        let close: RegExpExecArray | null = null;
        for (let match = tags.exec(html); match; match = tags.exec(html)) {
            depth += match[1] ? -1 : 1;
            if (depth === 0) {
                close = match;
                break;
            }
        }
        if (!close) break;
        output += html.slice(cursor, start.index) + replace(start, html.slice(start.index + start[0].length, close.index));
        cursor = close.index + close[0].length;
        opener.lastIndex = cursor;
    }
    return output + html.slice(cursor);
}

/**
 * 構文の意味が同じで、変換先に描画の記法がないため書き方を変えた要素を、同じ形にそろえる。変換タブは次の要素を、
 * HTMLを使わずに意味を表す記法（または元の記法の文字）へ写すため、表示は違っても変換の誤りではない。
 * - タスクリストのチェックボックス（Markdown）と、項目の文字`[ ]`・`[x]`（Textile）。
 * - Mermaidの図（Markdown）と、言語名mermaidのコードブロック（Textileの`bc(mermaid).`）。図のソースとコードの本文を比べる。
 * - 数式（Markdown）と、ソースの文字（インラインは`$…$`の文字、ブロックは言語名mathのコードブロック）。
 * - 目次（Markdownの`[TOC]`の一覧）と、目次の指定の文字`[TOC]`（Textile）。
 * - ページ区切り（Markdownの`<!-- pagebreak -->`の区切り表示）と、表示されないコメント（Textile）。
 * - 強調表示（Markdownの`==…==`の`<mark>`）と、意味のclass（mark）を付けた範囲（Textileの`%(mark)…%`）。
 * - 注記（Markdownの`> [!NOTE]`と改行で始まる引用の注記の枠）と、`[!NOTE]`と改行で始まる引用（Textile）。
 * - 略語（Textileの`ABC(説明)`）と、略語の書き方の文字（Markdown）。
 * - 定義リスト（Textileの`- 用語 := 定義`）と、同じ書き方の箇条書きの項目（Markdown）。
 * @param html - 1ブロックの描画HTML（ラッパーを除いたもの）。
 * @returns そろえたHTML。
 */
function canonicalizeMeaning(html: string): string {
    let result = html.replace(/<input\b([^>]*)>\s*/g, (whole, attributes: string) => {
        if (!/\btype="checkbox"/.test(attributes)) return whole;
        return /\bchecked\b/.test(attributes) ? '[x] ' : '[ ] ';
    }).replace(/(<li\b[^>]*>\s*)\[X\]/g, '$1[x]');
    result = result.replace(/<div class="diagram-block mermaid" data-mermaid-source="([^"]*)"[^>]*><\/div>/g, (whole, source: string) =>
        `<pre class="mermaid"><code class="mermaid">${escapeText(decodeSource(source))}</code></pre>`);
    result = replaceElements(result, /<span class="math-(?:node|error)( math-block)?" data-math-source="([^"]*)"[^>]*>/g, 'span', (start) => {
        const source = decodeSource(start[2]);
        return start[1] ? `<pre class="math"><code class="math">${escapeText(source)}</code></pre>` : escapeText(`$${source}$`);
    });
    result = replaceElements(result, /<nav class="table-of-contents"[^>]*>/g, 'nav', () => '<p>[TOC]</p>')
        .replace(/<p>\s*\[(?:<span class="caps">)?toc(?:<\/span>)?\]\s*<\/p>/gi, '<p>[TOC]</p>')
        .replace(/<div class="page-break"[^>]*><\/div>/g, '')
        // `<notextile>`はHTMLの要素ではなく、ブラウザーは中身だけを表示する。また段落の中にブロック要素を書くと、ブラウザーは
        // ブロック要素の前で段落を閉じる（中身のない段落は表示されない）。この2つは表示の違いがないため取り除く。
        .replace(/<\/?notextile>/g, '')
        .replace(/<p>\s*(?=<(?:blockquote|div|ul|ol|dl|table|pre|h[1-6])\b)/g, '')
        .replace(/(<\/(?:blockquote|div|ul|ol|dl|table|pre|h[1-6])>)\s*<\/p>/g, '$1')
        .replace(/<mark>/g, '<span class="mark">').replace(/<\/mark>/g, '</span>')
        .replace(/<aside class="markdown-alert alert-(\w+)"><strong>[^<]*<\/strong><div>([\s\S]*?)<\/div><\/aside>/g, (whole, type: string, content: string) =>
            `<blockquote><p>[!${type.toUpperCase()}]<br>${content}</p></blockquote>`)
        .replace(/<(abbr|acronym) title="([^"]*)">(?:<span class="caps">)?([^<]*)(?:<\/span>)?<\/\1>/g, '$3($2)');
    // 用語と定義が1つずつ交互に並ぶ定義リストだけを、`用語 := 定義`の項目の箇条書きにそろえる。
    return result.replace(/<dl>([\s\S]*?)<\/dl>/g, (whole, inner: string) => {
        const pairs = [...inner.matchAll(/<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)];
        if (pairs.length === 0 || inner.replace(/<dt>[\s\S]*?<\/dt>\s*<dd>[\s\S]*?<\/dd>/g, '').trim()) return whole;
        return `<ul>${pairs.map((pair) => `<li>${pair[1]} := ${pair[2]}</li>`).join('')}</ul>`;
    });
}

/**
 * ブロック要素の外にある文字（Textileの`<notextile>`の本文など、段落で包まれずに表示される文字）を段落として扱う。
 * 段落の内外は余白が違うだけで、文書の構造として同じ意味の本文なので、変換の誤りを見つける比較では区別しない。
 * @param html - ブロックのHTML（正規化前。コメントは除いたもの）。
 * @returns 外にある文字を<p>で包んだHTML。
 */
function wrapBareText(html: string): string {
    const blockTag = new RegExp(String.raw`<(\/?)(${BLOCK_TAG})\b[^>]*>`, 'g');
    let output = '';
    const stack: string[] = [];
    let cursor = 0;
    let bare = '';
    /**
     * たまった外の文字を段落として出力へ移す。
     */
    const flush = (): void => {
        if (bare.trim()) output += `<p>${bare.trim()}</p>`;
        else output += bare;
        bare = '';
    };
    /**
     * 現在の位置の文字を段落として扱うか（要素の外か、段落を含められる要素の直下か）を判定する。
     * @returns 段落として扱う場合はtrue。
     */
    const atParagraphLevel = (): boolean => stack.length === 0 || PARAGRAPH_CONTAINER.test(stack[stack.length - 1]);
    for (const match of html.matchAll(blockTag)) {
        const between = html.slice(cursor, match.index);
        if (atParagraphLevel()) bare += between;
        else output += between;
        flush();
        output += match[0];
        const name = match[2].toLowerCase();
        if (!/^(?:hr|br)$/.test(name)) {
            if (!match[1]) stack.push(name);
            else {
                const open = stack.lastIndexOf(name);
                if (open >= 0) stack.length = open;
            }
        }
        cursor = (match.index ?? 0) + match[0].length;
    }
    const rest = html.slice(cursor);
    if (atParagraphLevel()) {
        bare += rest;
        flush();
    } else output += rest;
    return output;
}

/**
 * 直下の文字を段落として扱う要素（段落を含められ、生HTMLの中に文字を直接書けるもの）。
 * Textileの`notextile..`に入れた生HTML（`<details>`など）の中の文字は段落で包まれないが、Markdownは段落にするため。
 */
const PARAGRAPH_CONTAINER = /^(?:details|div|section|aside|article|main|header|footer)$/;

/**
 * ブロックのHTMLから脚注を取り出し、参照を、番号の書き方によらず指す脚注で区別できる印へ置き換える。
 * Markdownの脚注（文書末尾の`<section class="footnotes">`、`[^id]`の参照に表示されるID）と、
 * Textileの脚注（定義の位置の`<p class="footnote">`、番号の参照）は、構文の意味が同じで表示の位置と番号の書き方だけが違う。
 * 変換の誤りを見つける比較ではこの違いを除き、参照の位置、参照が指す脚注、脚注の本文を比べる。
 * @param html - ブロックのHTML。
 * @param footnotes - 取り出した脚注の本文を追加する配列（文書内の順）。
 * @param definitions - 文書全体の脚注の本文（{@link collectFootnoteDefinitions}）。参照の印に、指す脚注の指紋を入れるために使う。
 * @returns 脚注の定義を除き、参照を指す脚注の印にしたHTML。
 */
function extractFootnotes(html: string, footnotes: string[], definitions: ReadonlyMap<string, string>): string {
    /**
     * 参照を、指す脚注の本文の指紋を持つ共通の印にする。番号の書き方の違いは除き、どの脚注を指すかは比べる。
     * @param key - 脚注の識別（`md:<id>`・`textile:<番号>`）。
     * @returns 参照の印。
     */
    const reference = (key: string): string => `<sup data-footnote-ref="${footnoteFingerprint(definitions.get(key) ?? '')}"></sup>`;
    return html
        .replace(/<section class="footnotes[^"]*"[^>]*>([\s\S]*?)<\/section>/g, (whole, inner: string) => {
            for (const item of inner.matchAll(/<li id="fn-[^"]*">([\s\S]*?)<\/li>/g)) {
                footnotes.push(item[1].replace(/<a href="#fnref-[^"]*"[^>]*>[\s\S]*?<\/a>/g, ''));
            }
            return '';
        })
        .replace(/<p class="footnote" id="fn\d+">\s*<a href="#fnr\d+"><sup>\d+<\/sup><\/a>([\s\S]*?)<\/p>/g, (whole, inner: string) => {
            footnotes.push(inner);
            return '';
        })
        .replace(/<sup class="footnote-ref"><a href="#fn-([^"]*)"[^>]*>[^<]*<\/a><\/sup>/g, (whole, id: string) => reference(`md:${id}`))
        .replace(/<sup class="footnote" id="fnr\d+"><a href="#fn(\d+)">\d+<\/a><\/sup>/g, (whole, id: string) => reference(`textile:${id}`));
}

/**
 * 文書全体の脚注の本文を、脚注の識別ごとに集める。Markdownは`<li id="fn-<id>">`、Textileは`<p class="footnote" id="fn<番号>">`。
 * @param htmls - 文書のブロックごとのHTML。
 * @returns 脚注の識別（`md:<id>`・`textile:<番号>`）から、正規化した本文への対応。
 */
function collectFootnoteDefinitions(htmls: readonly string[]): Map<string, string> {
    const definitions = new Map<string, string>();
    for (const html of htmls) {
        for (const section of html.matchAll(/<section class="footnotes[^"]*"[^>]*>([\s\S]*?)<\/section>/g)) {
            for (const item of section[1].matchAll(/<li id="fn-([^"]*)">([\s\S]*?)<\/li>/g)) {
                definitions.set(`md:${item[1]}`, normalizePreviewHtml(item[2].replace(/<a href="#fnref-[^"]*"[^>]*>[\s\S]*?<\/a>/g, '')));
            }
        }
        for (const item of html.matchAll(/<p class="footnote" id="fn(\d+)">\s*<a href="#fnr\d+"><sup>\d+<\/sup><\/a>([\s\S]*?)<\/p>/g)) {
            definitions.set(`textile:${item[1]}`, normalizePreviewHtml(item[2]));
        }
    }
    return definitions;
}

/**
 * 脚注の本文から、参照の印に入れる短い指紋（FNV-1aの32ビット）を作る。
 * @param text - 正規化した脚注の本文。定義がない参照は空文字。
 * @returns 16進数の指紋。
 */
function footnoteFingerprint(text: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16);
}

/**
 * 変換前後の描画ブロックを比べ、プレビューの見た目が同じか判定する。
 * 変換前と変換後ではブロックの区切り方が異なり得るため、正規化したHTMLを連結して比べ、
 * 違う場合は最初の違いを含む変換前のブロック位置を返す。
 * @param before - 変換前の文書の描画ブロック。
 * @param after - 変換後の文書の描画ブロック。
 * @returns 比較結果。
 */
export function comparePreviewBlocks(
    before: ReadonlyArray<{ html: string }>,
    after: ReadonlyArray<{ html: string }>
): PreviewComparison {
    const beforeBlocks = normalizeBlocks(before);
    const beforeHtml = beforeBlocks.map((block) => block.html).join('');
    const afterHtml = normalizeBlocks(after).map((block) => block.html).join('');
    if (beforeHtml === afterHtml) return { equal: true };
    let index = 0;
    while (index < beforeHtml.length && beforeHtml[index] === afterHtml[index]) index += 1;
    let consumed = 0;
    for (const block of beforeBlocks) {
        consumed += block.html.length;
        if (index < consumed) return { equal: false, firstDifferenceOffset: block.sourceFrom };
    }
    return { equal: false, firstDifferenceOffset: beforeBlocks[beforeBlocks.length - 1]?.sourceFrom };
}

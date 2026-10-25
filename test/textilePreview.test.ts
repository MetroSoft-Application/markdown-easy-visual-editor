/**
 * @fileoverview Textile単独・Markdown混在の変換、アウトライン、ローカル参照、サニタイズ境界を検証する。
 */
import { describe, expect, it } from 'vitest';
import {
    collectLocalResourceReferences,
    headingLineForAnchor,
    type OutlineItem
} from '../src/shared/markdown';
import { decodeTextileCodeEntities } from '../src/shared/textileAdapter';
import { highlightCode } from '../src/webview/markdown/codeHighlighter';
import {
    getOutlineForFormat,
    renderMarkdownUnsafeBlocks,
    type CodeHighlighter,
    type MarkdownRenderFormat,
    type RenderOptions,
    type UnsafeMarkdownBlock
} from '../src/webview/markdown/markdownRendererCore';

/** Textileプレビューの自動テストで共有する描画設定。 */
const textilePreviewOptions: Omit<RenderOptions, 'renderFormat'> = {
    remoteImagesEnabled: false,
    language: 'ja'
};

/**
 * サンプル文書を構文ごとに単独検証するための入力と期待値。
 */
interface TextileReviewSample {
    /** 統合サンプル内の収録確認とテスト名に使う元のパターン名。 */
    name: string;
    /** Textile専用またはMarkdown混在の描画形式。 */
    format: MarkdownRenderFormat;
    /** Vitestがsample/のローカル成果物に依存しないGit追跡下の回帰入力。 */
    fallback: string;
    /** 出力HTMLに必ず現れる、利用者から観測可能な構文結果。 */
    expectedFragments?: readonly string[];
    /** 出力HTMLに含めず、記法の境界を守ることを確認する断片。 */
    forbiddenFragments?: readonly string[];
    /** TextileまたはMarkdownの見出しIDをソース順に確認する場合の期待値。 */
    expectedOutlineIds?: readonly string[];
    /** 入力が空白だけで、描画ブロックを生成しない場合に指定する。 */
    expectEmpty?: boolean;
    /** 危険な生HTMLまたはURIを含み、サニタイズ経路が必要な場合に指定する。 */
    requiresSanitization?: boolean;
    /** 外部画像を描画する構文例だけ、プレビュー許可を有効にする。 */
    remoteImagesEnabled?: boolean;
}

/**
 * 公開Textileリファレンスの対象サブセットを、独立したローカル入力へ分けた回帰表。
 */
const textileReviewSamples: readonly TextileReviewSample[] = [
    {
        name: 'headings-all-levels.textile',
        format: 'textile',
        fallback: 'h1. Heading level one\n\nh2. Heading level two\n\nh3. Heading level three\n\nh4. Heading level four\n\nh5. Heading level five\n\nh6. Heading level six',
        expectedFragments: ['<h1 id="heading-level-one"', '<h6 id="heading-level-six"'],
        expectedOutlineIds: ['heading-level-one', 'heading-level-two', 'heading-level-three', 'heading-level-four', 'heading-level-five', 'heading-level-six']
    },
    {
        name: 'headings-duplicate-ids.textile',
        format: 'textile',
        fallback: 'h2. Repeated title\n\nh2. Repeated title\n\nh3. Repeated title',
        expectedFragments: ['id="repeated-title-1"'],
        expectedOutlineIds: ['repeated-title', 'repeated-title-1', 'repeated-title-2']
    },
    {
        name: 'paragraph-blocks.textile',
        format: 'textile',
        fallback: 'This is a default Textile paragraph.\n\np. This paragraph uses the explicit p. signature.\n\nA third paragraph checks blank-line separation and block ordering.',
        expectedFragments: ['default Textile paragraph', 'This paragraph uses the explicit p. signature.', 'A third paragraph']
    },
    {
        name: 'phrases-strong-emphasis.textile',
        format: 'textile',
        fallback: '*strong* and **bold** are separate forms.\n\n_emphasis_ and __italics__ are separate forms.',
        expectedFragments: ['<strong>strong</strong>', '<b>bold</b>', '<em>emphasis</em>', '<i>italics</i>']
    },
    {
        name: 'phrases-insert-delete-cite.textile',
        format: 'textile',
        fallback: '+Inserted text+ and -deleted text- are visible.\n\n??A short citation?? stays inline with ordinary text.',
        expectedFragments: ['<ins>Inserted text</ins>', '<del>deleted text</del>', '<cite>A short citation</cite>']
    },
    {
        name: 'phrases-super-sub-code.textile',
        format: 'textile',
        fallback: 'Water is H~2~O and an exponent is E=mc^2^.\n\nUse @inline code@ for Textile code and keep @H~2~O E=mc^2^@ literal inside code.',
        expectedFragments: ['<sub>2</sub>', '<sup>2</sup>', '<code>inline code</code>', '<code>H~2~O E=mc^2^</code>']
    },
    {
        name: 'ref-shortcut-inside-code.textile',
        format: 'textile',
        fallback: 'The code span @[redcloth]https://redcloth.org@ and @!logo.svg!https://example.com/logo.svg@ keep shortcuts literal.',
        expectedFragments: ['<code>[redcloth]https://redcloth.org</code>', '<code>!logo.svg!https://example.com/logo.svg</code>'],
        forbiddenFragments: ['<a href="https://redcloth.org">', '<a href="https://example.com/logo.svg">']
    },
    {
        name: 'phrases-nested.textile',
        format: 'textile',
        fallback: '_**Combined strong and emphasis**_ keeps nested phrase modifiers.',
        expectedFragments: ['<em>', '<b>', 'Combined strong and emphasis']
    },
    {
        name: 'list-unordered.textile',
        format: 'textile',
        fallback: '* First unordered item\n* Second unordered item\n* Third unordered item',
        expectedFragments: ['<ul>', '<li>First unordered item</li>', '<li>Third unordered item</li>']
    },
    {
        name: 'list-ordered.textile',
        format: 'textile',
        fallback: '# First ordered item\n# Second ordered item\n# Third ordered item',
        expectedFragments: ['<ol>', '<li>First ordered item</li>', '<li>Third ordered item</li>']
    },
    {
        name: 'list-nested.textile',
        format: 'textile',
        fallback: '* Parent item\n** Nested item\n*** Deep nested item\n* Next parent item',
        expectedFragments: ['<ul>', 'Parent item', 'Nested item', 'Deep nested item', 'Next parent item']
    },
    {
        name: 'quote-blocks.textile',
        format: 'textile',
        fallback: 'bq. A single paragraph quotation.\n\nbq. A second quotation checks adjacent quote blocks.',
        expectedFragments: ['<blockquote>', 'single paragraph quotation', 'adjacent quote blocks']
    },
    {
        name: 'preformatted-block.textile',
        format: 'textile',
        fallback: 'pre. leading spaces stay visible\n  second line has indentation\n<literal & markup> ^literal^ ~literal~',
        expectedFragments: ['<pre>', 'leading spaces stay visible', '&lt;literal &amp; markup&gt;', '^literal^ ~literal~']
    },
    {
        name: 'code-block.textile',
        format: 'textile',
        fallback: 'bc. if (ready) {\n  render("Textile source stays code");\n}\n\n<pre>\nif (ready) {\n  render("Textile source stays code");\n}\n</pre>\n\n<pre><code class="csharp">\nusing System;\n\ninternal static class HelloWorld\n{\n    private static void Main()\n    {\n        Console.WriteLine("Hello, world!");\n    }\n}\n</code></pre>',
        expectedFragments: ['<pre>', 'Textile source stays code']
    },
    {
        name: 'links-external.textile',
        format: 'textile',
        fallback: '"Textile reference":https://textile-lang.com/\n\n"Second external link":https://example.com/path?q=one&lang=ja',
        expectedFragments: ['href="https://textile-lang.com/"', 'Textile reference', 'Second external link']
    },
    {
        name: 'links-local.textile',
        format: 'textile',
        fallback: '"Local guide":./guide.html\n\n"Section link":#details',
        expectedFragments: ['data-mve-link="./guide.html"', 'href="#details"']
    },
    {
        name: 'images-local.textile',
        format: 'textile',
        fallback: '!assets/reference-sample.svg(Local sample image)!',
        expectedFragments: ['src="assets/reference-sample.svg"', 'data-mve-image-kind="textile"', 'Local sample image']
    },
    {
        name: 'images-linked.textile',
        format: 'textile',
        fallback: '!assets/reference-sample.svg(Linked sample image)!:https://textile-lang.com/',
        expectedFragments: ['href="https://textile-lang.com/"', 'src="assets/reference-sample.svg"']
    },
    {
        name: 'table-basic.textile',
        format: 'textile',
        fallback: '| First | Second | Third |\n| One | Two | Three |\n| Four | Five | Six |',
        expectedFragments: ['<table>', 'First', 'Three', 'Six']
    },
    {
        name: 'table-header.textile',
        format: 'textile',
        fallback: '|_. Name |_. Format |\n|Textile|Textile|\n|Markdown|Markdown|',
        expectedFragments: ['<table>', '<th>Name </th>', '<th>Format </th>']
    },
    {
        name: 'table-empty-cells.textile',
        format: 'textile',
        fallback: '|Left| |Right|\n|Text|Empty cell|Text|',
        expectedFragments: ['<table>', 'Left', 'Right', 'Empty cell']
    },
    {
        name: 'ref-paragraph-right.textile',
        format: 'textile',
        fallback: 'p>. 右寄せの段落です。',
        expectedFragments: ['<p style="text-align:right">右寄せの段落です。</p>']
    },
    {
        name: 'ref-paragraph-centered.textile',
        format: 'textile',
        fallback: 'p=. 中央寄せの段落です。',
        expectedFragments: ['<p style="text-align:center">中央寄せの段落です。</p>']
    },
    {
        name: 'ref-paragraph-left-indent.textile',
        format: 'textile',
        fallback: 'p(. 左側に1emインデントした段落です。',
        expectedFragments: ['style="padding-left:1em"']
    },
    {
        name: 'ref-paragraph-right-indent.textile',
        format: 'textile',
        fallback: 'p). 右側に1emインデントした段落です。',
        expectedFragments: ['style="padding-right:1em"']
    },
    {
        name: 'ref-div-paragraph.textile',
        format: 'textile',
        fallback: 'div. div要素として描画する段落です。',
        expectedFragments: ['<div>div要素として描画する段落です。</div>']
    },
    {
        name: 'ref-line-breaks.textile',
        format: 'textile',
        fallback: '一行目の文です。\n二行目の文です。',
        expectedFragments: ['一行目の文です。<br />\n二行目の文です。']
    },
    {
        name: 'ref-smart-quotes.textile',
        format: 'textile',
        fallback: '"引用文です"',
        expectedFragments: ['&#8220;引用文です&#8221;']
    },
    {
        name: 'ref-symbol-conversions.textile',
        format: 'textile',
        fallback: '— … 1 x 2 (r) (tm) (c)',
        expectedFragments: ['— …', '&#215;', '&#174;', '&#8482;', '&#169;']
    },
    {
        name: 'ref-abbreviation.textile',
        format: 'textile',
        fallback: 'CTR(Click Through Rate)',
        expectedFragments: ['<abbr title="Click Through Rate"><span class="caps">CTR</span></abbr>']
    },
    {
        name: 'ref-uppercase-caps.textile',
        format: 'textile',
        fallback: 'NOTE',
        expectedFragments: ['<span class="caps">NOTE</span>']
    },
    {
        name: 'ref-blockquote-cite.textile',
        format: 'textile',
        fallback: 'bq.https://notepm.jp/ 引用文です。',
        expectedFragments: ['<blockquote cite="https://notepm.jp/">', '引用文です。']
    },
    {
        name: 'ref-code-paragraph.textile',
        format: 'textile',
        fallback: 'bc. puts "Textile code"',
        expectedFragments: ['<pre><code>puts "Textile code"</code></pre>']
    },
    {
        name: 'ref-code-multiline.textile',
        format: 'textile',
        fallback: 'bc.. # Output "I love Ruby"\n\nsay = "I love Ruby"\n\nputs say\n\n\n# Output "I *LOVE* RUBY"\n\nsay[\'love\'] = "*love*"\n\nputs say.upcase\n\np. ここはTextileに戻ります。',
        expectedFragments: ['<pre><code># Output "I love Ruby"\n\nsay = "I love Ruby"', 'say.upcase</code></pre>', '<p>ここはTextileに戻ります。</p>']
    },
    {
        name: 'ref-code-redmine-class.textile',
        format: 'textile',
        fallback: '<pre><code class="ruby">if (ready && value < limit)\n  puts "highlighted code"\nend</code></pre>',
        expectedFragments: ['<pre><code class="ruby">if (ready &amp;&amp; value &lt; limit)', 'puts "highlighted code"', '</code></pre>']
    },
    {
        name: 'ref-definition-list.textile',
        format: 'textile',
        fallback: '* コーヒー := ホット\n* 紅茶 := ホット&アイス',
        expectedFragments: ['<dl>', '<dt>コーヒー</dt>', '<dd>ホット</dd>', '<dt>紅茶</dt>', '<dd>ホット&amp;アイス</dd>']
    },
    {
        name: 'ref-footnote.textile',
        format: 'textile',
        fallback: '42.7% of all statistics are made up on the spot.[1]\n\nfn1. "Dr. Katz":https://example.com/quote',
        expectedFragments: ['class="footnote" id="fn1"', 'href="#fn1">1</a>', 'Dr. Katz']
    },
    {
        name: 'ref-table-cell-alignment.textile',
        format: 'textile',
        fallback: '|<. 左寄せ|\n|>. 右寄せ|\n|=. 中央寄せ|',
        expectedFragments: ['text-align:left', 'text-align:right', 'text-align:center']
    },
    {
        name: 'ref-table-vertical-alignment.textile',
        format: 'textile',
        fallback: '|/2^. 上揃え|上の行|\n|次の行|\n|/2~. 下揃え|下の行|\n|次の行|',
        expectedFragments: ['vertical-align:top', 'vertical-align:bottom', 'rowspan="2"']
    },
    {
        name: 'ref-table-colspan.textile',
        format: 'textile',
        fallback: '|\\2. 横方向に2セル結合|\n|列1|列2|',
        expectedFragments: ['colspan="2"', '横方向に2セル結合']
    },
    {
        name: 'ref-table-rowspan.textile',
        format: 'textile',
        fallback: '|/2. 縦方向に2セル結合|1行目|\n|2行目|',
        expectedFragments: ['rowspan="2"', '縦方向に2セル結合']
    },
    {
        name: 'ref-table-background.textile',
        format: 'textile',
        fallback: '{background:#f00}. |赤い背景のセル|隣のセル|',
        expectedFragments: ['<tr style="background:#f00">']
    },
    {
        name: 'ref-phrase-html-tags.textile',
        format: 'textile',
        fallback: '**bold tag** and __italic tag__, ??citation??, -deleted-, +inserted+, ~subscript~, ^superscript^.',
        expectedFragments: ['<b>bold tag</b>', '<i>italic tag</i>', '<cite>citation</cite>', '<del>deleted</del>', '<ins>inserted</ins>', '<sub>subscript</sub>', '<sup>superscript</sup>']
    },
    {
        name: 'ref-class-span.textile',
        format: 'textile',
        fallback: '%(myclass)class付きの文字列%',
        expectedFragments: ['<span class="myclass">class付きの文字列</span>']
    },
    {
        name: 'ref-link-bracketed.textile',
        format: 'textile',
        fallback: 'This is a link to a ["Wikipedia article about Textile":https://en.wikipedia.org/wiki/Textile_(markup_language)].',
        expectedFragments: ['href="https://en.wikipedia.org/wiki/Textile_(markup_language)"', 'Wikipedia article about Textile']
    },
    {
        name: 'ref-link-space-boundary.textile',
        format: 'textile',
        fallback: 'サーバに "Redmine":https://redmine.jp/ をインストール。',
        expectedFragments: ['<a href="https://redmine.jp/">Redmine</a>']
    },
    {
        name: 'ref-link-no-space-boundary.textile',
        format: 'textile',
        fallback: 'サーバに"Redmine":https://redmine.jp/をインストール。',
        forbiddenFragments: ['<a href="https://redmine.jp/">']
    },
    {
        name: 'ref-link-shortcut.textile',
        format: 'textile',
        fallback: '[redcloth]https://redcloth.org',
        expectedFragments: ['href="https://redcloth.org"', '>redcloth</a>']
    },
    {
        name: 'ref-link-class.textile',
        format: 'textile',
        fallback: '"(my-class). NotePM":https://notepm.jp/',
        expectedFragments: ['<a class="my-class" href="https://notepm.jp/">NotePM</a>']
    },
    {
        name: 'ref-image-linked.textile',
        format: 'textile',
        fallback: '!https://example.com/logo.svg(NotePM logo)!https://notepm.jp/',
        remoteImagesEnabled: true,
        expectedFragments: ['<a href="https://notepm.jp/">', 'src="https://example.com/logo.svg"', 'alt="NotePM logo"']
    },
    {
        name: 'ref-image-local.textile',
        format: 'textile',
        fallback: '!assets/reference-sample.svg(Local reference sample)!',
        expectedFragments: ['src="assets/reference-sample.svg"', 'data-mve-image-kind="textile"', 'Local reference sample']
    },
    {
        name: 'ref-language.textile',
        format: 'textile',
        fallback: 'p[ja]. ここに日本語の本文があります。',
        expectedFragments: ['<p lang="ja">']
    },
    {
        name: 'ref-class-id.textile',
        format: 'textile',
        fallback: 'p(my-class#myId). クラス名とIDを指定した段落です。',
        expectedFragments: ['<p class="my-class" id="myId">']
    },
    {
        name: 'ref-style.textile',
        format: 'textile',
        fallback: 'p{color:blue;letter-spacing:.5em}. インラインスタイル付きの段落です。',
        expectedFragments: ['style="color:blue;letter-spacing:.5em"']
    },
    {
        name: 'ref-align-left.textile',
        format: 'textile',
        fallback: 'p<. 左寄せです。',
        expectedFragments: ['text-align:left']
    },
    {
        name: 'ref-align-justify.textile',
        format: 'textile',
        fallback: 'p<>. 均等割り付けです。',
        expectedFragments: ['text-align:justify']
    },
    {
        name: 'ref-indent-left-two.textile',
        format: 'textile',
        fallback: 'p((. 左側に2emインデントします。',
        expectedFragments: ['padding-left:2em']
    },
    {
        name: 'ref-indent-right-two.textile',
        format: 'textile',
        fallback: 'p)). 右側に2emインデントします。',
        expectedFragments: ['padding-right:2em']
    },
    {
        name: 'ref-indent-both-one.textile',
        format: 'textile',
        fallback: 'p(). 左右に1emの余白を付けます。',
        expectedFragments: ['padding-left:1em', 'padding-right:1em']
    },
    {
        name: 'ref-indent-both-two.textile',
        format: 'textile',
        fallback: 'p(()). 左右に2emの余白を付けます。',
        expectedFragments: ['padding-left:2em', 'padding-right:2em']
    },
    {
        name: 'ref-notextile-tag.textile',
        format: 'textile',
        fallback: '<notextile>*強調記号*と H~2~O ^2^ をそのまま表示</notextile>',
        expectedFragments: ['*強調記号*'],
        requiresSanitization: true
    },
    {
        name: 'ref-notextile-line.textile',
        format: 'textile',
        fallback: 'notextile. *この記法は適用されません* H~2~O ^2^',
        expectedFragments: ['*この記法は適用されません*']
    },
    {
        name: 'ref-notextile-extended.textile',
        format: 'textile',
        fallback: 'notextile.. *この記法は適用されません* H~2~O ^2^\n\n**こちらも適用されません** H~2~O ^2^\n\np. ここからTextileに戻ります。',
        expectedFragments: ['*この記法は適用されません*', '**こちらも適用されません**', '<p>ここからTextileに戻ります。</p>']
    },
    {
        name: 'ref-raw-html.textile',
        format: 'textile',
        fallback: '<p class="raw-html"><strong>HTML要素</strong>を本文へ直接記述します。</p>',
        expectedFragments: ['<p class="raw-html"><strong><span class="caps">HTML</span>要素</strong>を本文へ直接記述します。</p>'],
        requiresSanitization: true
    },
    {
        name: 'ref-pre-extended.textile',
        format: 'textile',
        fallback: 'pre.. All text uses a fixed-width font.\n\nBlank lines remain inside the preformatted block.\n\np. Textile parsing resumes here.',
        expectedFragments: ['<pre>All text uses a fixed-width font.\n\nBlank lines remain inside the preformatted block.</pre>', '<p>Textile parsing resumes here.</p>']
    },
    {
        name: 'ref-horizontal-rule.textile',
        format: 'textile',
        fallback: '---',
        expectedFragments: ['<hr />']
    },
    {
        name: 'ref-mixed-code-boundary.md',
        format: 'mixed',
        fallback: '# Markdown heading\n\nbc.. # copied *literal* source\n\nline two @literal@\n\np. Textile resumes with +inserted+ text.',
        expectedFragments: ['<h1 id="markdown-heading"', '<pre><code># copied *literal* source\n\nline two @literal@</code></pre>', '<ins>inserted</ins>']
    },
    {
        name: 'ref-mixed-reference-link.md',
        format: 'mixed',
        fallback: 'Textile shortcut [redcloth]https://redcloth.org works beside [Markdown](https://example.com/), "(my-class). Styled link":https://notepm.jp/, and %(myclass)styled text%.',
        expectedFragments: ['href="https://redcloth.org">redcloth</a>', 'href="https://example.com/">Markdown</a>', '<a class="my-class" href="https://notepm.jp/">Styled link</a>', '<span class="myclass">styled text</span>']
    },
    {
        name: 'ref-mixed-linked-image.md',
        format: 'mixed',
        fallback: 'Textile linked image !https://example.com/logo.svg(NotePM logo)!https://notepm.jp/',
        remoteImagesEnabled: true,
        expectedFragments: ['<a href="https://notepm.jp/">', 'src="https://example.com/logo.svg"', 'data-mve-image-kind="textile"', 'data-mve-resizable="false"']
    },
    {
        name: 'mixed-blocks.md',
        format: 'mixed',
        fallback: '# Markdown heading\n\nMarkdown paragraph with **bold** text.\n\nh2. Textile heading\n\np. Textile paragraph with *strong* text.\n\n> Markdown quotation.\n\nbq. Textile quotation.\n\n|Markdown|Table|\n|---|---|\n|GFM|row|\n\n|Textile|Table|\n|Mixed|row|',
        expectedFragments: ['Markdown heading', 'id="textile-heading"', '<strong>bold</strong>', '<blockquote>', 'Markdown', 'Textile']
    },
    {
        name: 'mixed-phrases.md',
        format: 'mixed',
        fallback: 'Markdown **bold**, _emphasis_, and ~~strikethrough~~ remain Markdown.\n\nTextile +inserted+, -deleted-, ??citation??, @code@, ^super^, and ~sub~ remain available.',
        expectedFragments: ['<strong>bold</strong>', '<em>emphasis</em>', '<del>strikethrough</del>', '<ins>inserted</ins>', '<cite>citation</cite>', '<code>code</code>']
    },
    {
        name: 'markdown-priority.md',
        format: 'mixed',
        fallback: '# Markdown heading syntax\n\n**Markdown bold** and *Markdown emphasis*.\n\n[Markdown link](https://example.com/)\n\n- Markdown list item\n\n> Markdown blockquote\n\nMarkdown extensions: ++inserted++ ^superscript^ ~subscript~ ~~deleted~~.\n\nh2. Explicit Textile heading block remains supported.',
        expectedFragments: ['Markdown heading syntax', '<strong>Markdown bold</strong>', '<em>Markdown emphasis</em>', 'href="https://example.com/"', '<li>Markdown list item</li>', 'Explicit Textile heading block']
    },
    {
        name: 'fenced-code-boundary.md',
        format: 'mixed',
        fallback: '```text\nh2. This is a literal code heading\n"literal link":https://example.com/\n@literal code marker@\n+literal insertion+ ??literal citation??\n```',
        expectedFragments: ['h2. This is a literal code heading', 'literal link', '+literal insertion+ ??literal citation??']
    },
    {
        name: 'inline-code-boundary.md',
        format: 'mixed',
        fallback: 'Inline `h2. literal heading`, `+literal insertion+`, and `"literal link":https://example.com/` stay code.',
        expectedFragments: ['<code>h2. literal heading</code>', '<code>+literal insertion+</code>', '<code>&quot;literal link&quot;:https://example.com/</code>']
    },
    {
        name: 'gfm-table-priority.md',
        format: 'mixed',
        fallback: '| Column | Value |\n| ------ | ----- |\n| First  | Markdown |\n| Second | GFM |',
        expectedFragments: ['<table>', '<th data-mve-short-value-candidate="true">Column</th>', '<td>Markdown</td>', '<td data-mve-short-value-candidate="true">GFM</td>']
    },
    {
        name: 'gfm-single-column-table-priority.md',
        format: 'mixed',
        fallback: '| Column |\n| --- |\n| Markdown |',
        expectedFragments: ['<table>', '<th data-mve-short-value-candidate="true">Column</th>', '<td>Markdown</td>'],
        forbiddenFragments: ['---']
    },
    {
        name: 'escaped-markers.md',
        format: 'mixed',
        fallback: 'Escaped markers: \\+literal plus+ and \\-literal dash- remain text.',
        expectedFragments: ['+literal plus+', '-literal dash-']
    },
    {
        name: 'unicode-and-symbols.textile',
        format: 'textile',
        fallback: 'h1. 日本語と Unicode\n\np. 漢字、かな、アクセント付き文字 é、記号 © と全角文字を含む文章です。',
        expectedFragments: ['日本語と Unicode', '漢字、かな', 'é', '©']
    },
    {
        name: 'empty-input.textile',
        format: 'textile',
        fallback: '\n',
        expectEmpty: true
    },
    {
        name: 'malformed-inline.textile',
        format: 'textile',
        fallback: 'p. Unmatched *strong and _emphasis and @code markers.',
        expectedFragments: ['Unmatched', 'strong', 'emphasis']
    },
    {
        name: 'malformed-link.textile',
        format: 'textile',
        fallback: 'p. A link without a target: "unfinished link":',
        expectedFragments: ['link without a target', 'unfinished link']
    },
    {
        name: 'sanitization-raw-html.textile',
        format: 'textile',
        fallback: 'p. <script>window.__textilePatternXss = true;</script>\n\n<img src=x onerror="window.__textilePatternXss = true">',
        expectedFragments: ['<script>', 'onerror='],
        requiresSanitization: true
    },
    {
        name: 'sanitization-uri.textile',
        format: 'textile',
        fallback: '"Unsafe JavaScript target":javascript:alert(1)',
        expectedFragments: ['javascript:alert(1)'],
        requiresSanitization: true
    },
    {
        name: 'blank-lines-and-newline.textile',
        format: 'textile',
        fallback: 'First paragraph.\n\n\nSecond paragraph after repeated blank lines.\n\nFinal paragraph keeps its final newline.\n',
        expectedFragments: ['First paragraph', 'Second paragraph', 'Final paragraph']
    },
    {
        name: 'long-inline-line.md',
        format: 'mixed',
        fallback: 'Textile inline markers at both ends of a long Markdown line: +inserted+ and -deleted-. This sentence is repeated to exercise one-pass candidate detection without creating an unbounded document. This sentence is repeated to exercise one-pass candidate detection without creating an unbounded document. This sentence is repeated to exercise one-pass candidate detection without creating an unbounded document. This sentence is repeated to exercise one-pass candidate detection without creating an unbounded document. This sentence is repeated to exercise one-pass candidate detection without creating an unbounded document.',
        expectedFragments: ['<ins>inserted</ins>', '<del>deleted</del>', 'one-pass candidate detection', 'unbounded document']
    }
];

/**
 * 描画結果ブロックからHTML部分を取り出す。
 * @param block - 未サニタイズ描画ブロック。
 * @returns ブロックHTML。
 */
function getBlockHtml(block: UnsafeMarkdownBlock): string {
    return block.html;
}

/**
 * 描画ブロックが既存DOMPurify経路を通る必要があるかを返す。
 * @param block - 未サニタイズ描画ブロック。
 * @returns サニタイズ対象の場合はtrue。
 */
function requiresSanitization(block: UnsafeMarkdownBlock): boolean {
    return block.requiresSanitization;
}

/**
 * アウトライン項目からアンカーIDを取り出す。
 * @param item - 描画形式別の見出し項目。
 * @returns 見出しのHTMLアンカーID。
 */
function getOutlineItemId(item: OutlineItem): string {
    return item.id;
}

/**
 * 指定ラベルを持つアウトライン項目があるか判定する。
 * @param item - 描画形式別の見出し項目。
 * @returns 指定されたラベルと一致する場合はtrue。
 */
function isFencedHeadingInOutline(item: OutlineItem): boolean {
    return item.text === 'fenced code heading';
}

/** 不正なTextileリンクの変換が例外で停止しないことを検証する処理。 */
function renderMalformedTextileLink(): void {
    renderHtml('p. malformed "link":', 'textile');
}

/**
 * 指定形式のソースを未サニタイズHTMLへ変換する。
 * @param source - 描画対象の元文書。
 * @param renderFormat - Textile、Markdown、または混在Markdownの形式。
 * @param highlighter - 言語クラス付きコードへ使う既存ハイライト関数。
 * @returns ブロック順を保ったサニタイズ前HTML。
 */
function renderHtml(
    source: string,
    renderFormat: MarkdownRenderFormat,
    highlighter?: CodeHighlighter
): string {
    return renderMarkdownUnsafeBlocks(source, { ...textilePreviewOptions, renderFormat }, highlighter)
        .map(getBlockHtml)
        .join('');
}

/** Textile raw HTMLコードの言語クラスがシンタックスハイライトへ反映され、行間が増えないことを検証する。 */
function verifyRawHtmlCodeHighlightAndLineBreaks(): void {
    const source = [
        '<pre><code class="csharp">',
        'using System;',
        '',
        'internal static class HelloWorld',
        '{',
        '    private static void Main()',
        '    {',
        '        Console.WriteLine("Hello, world!");',
        '    }',
        '}',
        '</code></pre>'
    ].join('\n');
    const expectedCode = [
        'using System;',
        '',
        'internal static class HelloWorld',
        '{',
        '    private static void Main()',
        '    {',
        '        Console.WriteLine("Hello, world!");',
        '    }',
        '}'
    ].join('\n');
    const originalSource = source;
    const plainHtml = renderHtml(source, 'textile');
    const highlightedHtml = renderHtml(source, 'textile', highlightCode);
    const highlightedCode = /<pre\b[^>]*><code\b[^>]*>([\s\S]*?)<\/code><\/pre>/i.exec(highlightedHtml)?.[1];
    const plainCode = /<pre\b[^>]*><code\b[^>]*>([\s\S]*?)<\/code><\/pre>/i.exec(plainHtml)?.[1];
    /** Highlight.jsのspanを除いて、HTMLコード要素が保持した文字列を検査する。 */
    const stripHighlightTags = (value: string | undefined) =>
        decodeTextileCodeEntities((value ?? '').replace(/<\/?span\b[^>]*>/gi, ''));

    expect(highlightedHtml).toContain('class="csharp hljs"');
    expect(highlightedHtml).toContain('<span class="hljs-keyword">using</span>');
    expect(highlightedHtml).toMatch(/<span class="hljs-title(?:\s+class_)?">HelloWorld<\/span>/);
    expect(highlightedHtml).not.toContain('<br');
    expect(plainHtml).not.toContain('<br');
    expect(stripHighlightTags(highlightedCode)).toBe(expectedCode);
    expect(stripHighlightTags(plainCode)).toBe(expectedCode);
    expect(source).toBe(originalSource);
}

/** Markdown/Textile混在文書内のraw HTMLコードも、空行と元ソースを保って強調表示する。 */
function verifyMixedRawHtmlCodeHighlightAndLineBreaks(): void {
    const source = [
        'p. A Textile paragraph selects mixed rendering.',
        '',
        '<pre><code class="csharp">',
        'using System;',
        '',
        'internal static class HelloWorld',
        '{',
        '    private static void Main()',
        '    {',
        '        Console.WriteLine("Hello, world!");',
        '    }',
        '}',
        '</code></pre>'
    ].join('\n');
    const expectedCode = [
        'using System;',
        '',
        'internal static class HelloWorld',
        '{',
        '    private static void Main()',
        '    {',
        '        Console.WriteLine("Hello, world!");',
        '    }',
        '}'
    ].join('\n');
    const originalSource = source;
    const html = renderHtml(source, 'mixed', highlightCode);
    const code = /<pre\b[^>]*><code\b[^>]*>([\s\S]*?)<\/code><\/pre>/i.exec(html)?.[1];
    const normalizedCode = decodeTextileCodeEntities((code ?? '').replace(/<\/?span\b[^>]*>/gi, ''));

    expect(html).toContain('<p>A Textile paragraph selects mixed rendering.</p>');
    expect(html).toContain('class="csharp hljs"');
    expect(html).toContain('<span class="hljs-keyword">using</span> System;\n\n<span class="hljs-keyword">internal</span>');
    expect(html).not.toContain('<br');
    expect(normalizedCode).toBe(expectedCode);
    expect(source).toBe(originalSource);
}

/** Textile単独文書で主要なブロック・インライン記法を確認する。 */
function verifyTextileCoreSyntax(): void {
    const source = [
        'h1. Textile preview coverage',
        '',
        'p. A *bold* paragraph, _italic_, and @inline code@.',
        '',
        'bq. A block quotation.',
        '',
        '* First bullet',
        '* Second bullet',
        '** Nested bullet',
        '',
        '# First numbered item',
        '# Second numbered item',
        '',
        'bc. if (unsafe) { <script>literal code</script> }',
        '',
        '|Name|Value|',
        '|Plain|Textile|'
    ].join('\n');
    const html = renderHtml(source, 'textile');

    expect(html).toContain('<h1 id="textile-preview-coverage" data-mve-heading="true">Textile preview coverage</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<code>inline code</code>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<pre>');
    expect(html).toContain('<table>');
}

/** Textileのリンク、画像属性、表参照とアウトラインIDの連携を確認する。 */
function verifyTextileLinksImagesAndOutline(): void {
    const source = [
        'h1. Target heading',
        '',
        '"External reference":https://textile-lang.com/',
        '',
        '!../assets/local-sample.svg(Local image)!',
        '',
        '|Header|Value|',
        '|Textile|Supported|'
    ].join('\n');
    const blocks = renderMarkdownUnsafeBlocks(source, { ...textilePreviewOptions, renderFormat: 'textile' });
    const html = blocks.map(getBlockHtml).join('');
    const outline = getOutlineForFormat(source, 'textile', blocks);

    expect(html).toContain('href="https://textile-lang.com/"');
    expect(html).toContain('src="../assets/local-sample.svg"');
    expect(html).toContain('data-mve-image-kind="textile"');
    expect(html).toContain('<table>');
    expect(outline).toMatchObject([{ text: 'Target heading', id: 'target-heading', line: 1 }]);
    expect(headingLineForAnchor(source, 'target-heading', 'textile')).toBe(1);
    expect(collectLocalResourceReferences(source)).toContainEqual({
        kind: 'image',
        source: '../assets/local-sample.svg',
        line: 5
    });
}

/** Markdown記法を優先し、明示ブロックと競合しないTextile phrase modifierを混在描画する。 */
function verifyMixedMarkdownPriorityAndCodeBoundaries(): void {
    const source = [
        '# Shared',
        '',
        '**Markdown bold** and _Markdown emphasis_.',
        'Markdown extension ++inserted++ and ^superscript^ and ~subscript~ remains Markdown.',
        'Textile phrases +inserted+, -deleted-, ??citation??, ^superscript^, and ~subscript~; GFM ~~strikethrough~~ remains available.',
        '',
        'p. Textile *bold* and "Textile link":https://textile-lang.com/.',
        '',
        'h2. Shared',
        '',
        '|Textile|table|',
        '|Mixed format|preserved|',
        '',
        '| Column | Value |',
        '| ------ | ----- |',
        '| GFM | table |',
        '',
        '```text',
        'h3. fenced code heading',
        '"fenced code link":https://textile-lang.com/',
        '@fenced code marker@',
        '+fenced inserted+ ??fenced citation??',
        '```',
        '',
        'Inline `@Markdown code span@` and `+inline inserted+` remain literal.'
    ].join('\n');
    const blocks = renderMarkdownUnsafeBlocks(source, { ...textilePreviewOptions, renderFormat: 'mixed' });
    const html = blocks.map(getBlockHtml).join('');
    const outline = getOutlineForFormat(source, 'mixed', blocks);

    expect(html).toContain('<strong>Markdown bold</strong>');
    expect(html).toContain('<em>Markdown emphasis</em>');
    expect(html).toContain('Markdown extension <ins>inserted</ins> and <sup>superscript</sup> and <sub>subscript</sub> remains Markdown.');
    expect(html).toContain('<ins>inserted</ins>');
    expect(html).toContain('<del>deleted</del>');
    expect(html).toContain('<cite>citation</cite>');
    expect(html).toContain('<sup>superscript</sup>');
    expect(html).toContain('<sub>subscript</sub>');
    expect(html).toContain('<del>strikethrough</del>');
    expect(html).toContain('<p>Textile <strong>bold</strong> and <a href="https://textile-lang.com/">Textile link</a>.</p>');
    expect((html.match(/<table>/gu) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('h3. fenced code heading');
    expect(html).toContain('&quot;fenced code link&quot;:https://textile-lang.com/');
    expect(html).toContain('+fenced inserted+ ??fenced citation??');
    expect(html).toContain('<code>@Markdown code span@</code>');
    expect(html).toContain('<code>+inline inserted+</code>');
    expect(outline.map(getOutlineItemId)).toEqual(['shared', 'shared-1']);
    expect(headingLineForAnchor(source, 'shared-1', 'mixed')).toBe(9);
    expect(outline.some(isFencedHeadingInOutline)).toBe(false);
}

/** MarkdownのHTML属性、コードフェンス、インラインコードにある記号をTextile候補として誤検知しない。 */
function verifyMixedModeIgnoresMarkdownProtectedRegions(): void {
    const source = [
        '<span data-mve-text-color="red">Markdown text</span>',
        '',
        'Hyphenated words such as one-pass, well-known, and non-empty remain Markdown text.',
        '',
        'Inline `+not-textile+` and `@not-textile@` remain code.',
        '',
        '```text',
        'p. fenced paragraph',
        '"fenced link":https://example.com',
        '@fenced code@',
        '```'
    ].join('\n');

    expect(renderHtml(source, 'mixed')).toBe(renderHtml(source, 'markdown'));
}

/** 空文書、Unicode、不正記法、未変更原文とサニタイズ要否の境界を確認する。 */
function verifyEmptyUnicodeMalformedAndSanitizationCases(): void {
    expect(renderHtml('', 'textile')).toBe('');
    const unicodeSource = 'h1. 日本語と Unicode\n\n+p. 日本語、é、全角記号、@<tag>&@';
    const unicodeHtml = renderHtml(unicodeSource, 'textile');
    expect(unicodeHtml).toContain('日本語と Unicode');
    expect(unicodeHtml).toContain('&lt;tag&gt;&amp;');
    expect(unicodeSource).toBe('h1. 日本語と Unicode\n\n+p. 日本語、é、全角記号、@<tag>&@');

    const malformed = renderHtml('p. unmatched * marker and @ marker', 'textile');
    expect(malformed).toContain('unmatched');
    expect(renderMalformedTextileLink).not.toThrow();

    const unsafeBlocks = renderMarkdownUnsafeBlocks(
        'p. <script>window.__textileXss = true;</script>\n\n"unsafe":javascript:alert(1)',
        { ...textilePreviewOptions, renderFormat: 'textile' }
    );
    expect(unsafeBlocks.length).toBeGreaterThan(0);
    expect(unsafeBlocks.every(requiresSanitization)).toBe(true);
}

/** 統合入力へ収録された個別記法を単独変換し、表示結果を回帰確認する。 */
function verifyReviewSample(sample: TextileReviewSample): void {
    const source = sample.fallback;
    const originalSource = source;
    const blocks = renderMarkdownUnsafeBlocks(source, {
        ...textilePreviewOptions,
        remoteImagesEnabled: sample.remoteImagesEnabled ?? textilePreviewOptions.remoteImagesEnabled,
        renderFormat: sample.format
    });
    const html = blocks.map(getBlockHtml).join('');

    if (sample.expectEmpty) expect(blocks).toHaveLength(0);
    for (const fragment of sample.expectedFragments ?? []) expect(html).toContain(fragment);
    for (const fragment of sample.forbiddenFragments ?? []) expect(html).not.toContain(fragment);
    if (sample.name.startsWith('ref-notextile-')) {
        expect(decodeTextileCodeEntities(html)).toContain('H~2~O ^2^');
        expect(html).not.toContain('<sub>2</sub>');
        expect(html).not.toContain('<sup>2</sup>');
    }
    if (sample.expectedOutlineIds) {
        const outline = getOutlineForFormat(source, sample.format, blocks);
        expect(outline.map(getOutlineItemId)).toEqual(sample.expectedOutlineIds);
    }
    if (sample.requiresSanitization) expect(blocks.some(requiresSanitization)).toBe(true);
    expect(source).toBe(originalSource);
}

/** Textileサンプルを一記法ずつ独立したVitestケースとして登録する。 */
function registerReviewSampleMatrix(): void {
    for (const sample of textileReviewSamples) {
        it(`renders pattern sample ${sample.name}`, () => verifyReviewSample(sample));
    }
}

/** Textileの自動回帰検証をVitestへ登録する。 */
function registerTextilePreviewTests(): void {
    it('renders Textile block, inline, list, quote, code, and table syntax', verifyTextileCoreSyntax);
    it('keeps Textile links, local images, tables, outline IDs, and local-resource references aligned', verifyTextileLinksImagesAndOutline);
    it('highlights language-tagged raw Textile code without inserting extra line breaks', verifyRawHtmlCodeHighlightAndLineBreaks);
    it('highlights language-tagged raw HTML code in mixed Markdown/Textile without inserting extra line breaks', verifyMixedRawHtmlCodeHighlightAndLineBreaks);
    it('prioritizes Markdown and excludes fenced or inline code from Textile tokenization', verifyMixedMarkdownPriorityAndCodeBoundaries);
    it('does not detect Textile syntax inside Markdown HTML, inline code, or fenced code', verifyMixedModeIgnoresMarkdownProtectedRegions);
    it('handles empty, Unicode, malformed, source-preserving, and sanitization-boundary inputs', verifyEmptyUnicodeMalformedAndSanitizationCases);
}

describe('Textile preview', registerTextilePreviewTests);
describe('Textile review samples', registerReviewSampleMatrix);

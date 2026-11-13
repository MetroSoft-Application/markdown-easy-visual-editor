/**
 * @fileoverview 文書全体のTextile↔Markdown変換を検証する。
 * 検証する仕様: 改行コード・末尾改行の保持、コード内の無変換、相当記法のない構文の保持、
 * および「変換後の文書を変換先の形式で描画した結果が変換前の描画と同じ構造になる」こと（プレビューが変化しない）。
 * 回帰リスク: 変換器の記法対応を広げたときに、既存構文の描画一致が崩れること。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    convertDocumentSyntax,
    convertMarkdownToTextile,
    convertTextileToMarkdown
} from '../src/shared/formatConversion';
import {
    renderMarkdownUnsafeBlocks,
    type MarkdownRenderFormat,
    type RenderOptions
} from '../src/webview/markdown/markdownRendererCore';
import { comparePreviewBlocks } from '../src/webview/markdown/previewEquivalence';

/** 描画比較で共有する描画設定。リモート画像は許可してリンク付き画像も比較する。 */
const renderOptions: Omit<RenderOptions, 'renderFormat'> = {
    remoteImagesEnabled: true,
    language: 'ja'
};

/**
 * 文書をその記法に対応するプレビュー形式（Markdownは拡張子由来と同じTextile混在）で描画する。
 * @param source - 描画する原文。
 * @param syntax - 原文の記法。
 * @returns 描画ブロック。
 */
function renderBlocks(source: string, syntax: 'markdown' | 'textile'): Array<{ html: string }> {
    const format: MarkdownRenderFormat = syntax === 'textile' ? 'textile' : 'mixed';
    return renderMarkdownUnsafeBlocks(source, { ...renderOptions, renderFormat: format });
}

/**
 * 変換前後のプレビューを、アプリが変換の適用前に使う比較（previewEquivalence）で比べる。
 * @param source - 変換前の原文。
 * @param converted - 変換後の原文。
 * @param from - 変換前の記法。
 * @returns 見た目が同じならtrue。
 */
function previewEqual(source: string, converted: string, from: 'markdown' | 'textile'): boolean {
    const to = from === 'markdown' ? 'textile' : 'markdown';
    return comparePreviewBlocks(renderBlocks(source, from), renderBlocks(converted, to)).equal;
}

/**
 * 変換前後で報告行がなく、描画結果が一致することを検証する。
 * @param source - 変換前の原文。
 * @param from - 変換前の記法。
 */
function expectPreviewUnchanged(source: string, from: 'markdown' | 'textile'): void {
    const to = from === 'markdown' ? 'textile' : 'markdown';
    const result = convertDocumentSyntax(source, from, to);
    expect(result.unsupportedLines, `converted source:\n${result.text}`).toEqual([]);
    expect(previewEqual(source, result.text, from), `converted source:\n${result.text}`).toBe(true);
}

/**
 * 変換器の報告の安全条件を検証する。報告行がない結果は描画が一致すること（変換器単体の偽陰性がないこと）。
 * アプリは適用前に描画比較も行うため、ここで不一致が見つかっても利用者のプレビューは変わらないが、
 * 変換器の規則と描画器のずれとして検出する。
 * @param source - 変換前の原文。
 * @param from - 変換前の記法。
 * @returns 変換結果の報告行。
 */
function expectSafeConversion(source: string, from: 'markdown' | 'textile'): number[] {
    const to = from === 'markdown' ? 'textile' : 'markdown';
    const result = convertDocumentSyntax(source, from, to);
    if (result.unsupportedLines.length === 0) {
        expect(previewEqual(source, result.text, from), `converted source:\n${result.text}`).toBe(true);
    }
    return result.unsupportedLines;
}


/**
 * Textile→Markdownで描画が変わらないことを確認する構文ごとの入力。
 */
const textileFidelityCases: ReadonlyArray<{ name: string; source: string }> = [
    { name: 'headings', source: 'h1. Heading one\n\nh2. Heading two\n\nh3(#custom-id). With attributes\n\nh2. Heading two\n' },
    { name: 'paragraph phrases', source: 'p. Paragraphs support *bold*, _italic_, +inserted+, -deleted-, ^superscript^, ~subscript~, and @inline code@.\n\n**bold tag** and __italic tag__ and _*nested*_ forms.\n' },
    { name: 'line breaks inside paragraph', source: '一行目の文です。\n二行目の文です。\n\nNext paragraph.\n' },
    { name: 'lists', source: '* First bullet\n* Second bullet\n** Nested bullet\n*** Third-level bullet\n* Back\n\n# First numbered item\n# Second numbered item\n## Nested numbered\n' },
    { name: 'list item with phrases', source: '* item with *strong* and @code@\n* item with "link":https://example.com/\n' },
    { name: 'blockquote', source: 'bq. A Textile block quotation for preview and export.\n\np. After quote.\n' },
    { name: 'multi paragraph blockquote', source: 'bq.. First quoted paragraph.\n\nSecond quoted paragraph.\n\np. Back to normal text.\n' },
    { name: 'code blocks', source: 'bc. if (ready) {\n  render("Textile source stays code");\n}\n\nbc(ruby). puts "hello"\n\npre. leading spaces stay visible\n  second line has indentation\n' },
    { name: 'extended code block', source: 'bc.. # Output "I love Ruby"\n\nsay = "I love Ruby"\n\nputs say\n\np. ここはTextileに戻ります。\n' },
    { name: 'table with header', source: '|_. Name |_. Format |\n|Textile|Textile|\n|Markdown|Markdown|\n' },
    { name: 'table with alignment', source: '|_<. Left |_>. Right |_=. Center |\n|<. a |>. b |=. c |\n|<. d |>. e |=. f |\n' },
    { name: 'links and images', source: '"Textile reference":https://textile-lang.com/ and "Local guide":./guide.html and "Section link":#details\n\n!assets/reference-sample.svg(Local sample image)!\n\n!https://example.com/logo.svg(Linked sample image)!:https://textile-lang.com/\n' },
    { name: 'link inside sentence with punctuation', source: 'See "x":https://example.com/a?b=1&c=2. Next sentence ("Wikipedia":https://en.wikipedia.org/wiki/Textile_(markup_language)).\n' },
    { name: 'explicit paragraph signatures', source: 'This is a default Textile paragraph.\n\np. This paragraph uses the explicit p. signature.\n\nA third paragraph checks blank-line separation and block ordering.\n' },
    { name: 'horizontal rule', source: 'Before rule.\n\n---\n\nAfter rule.\n' },
    { name: 'acronym', source: 'CTR(Click Through Rate) is an acronym.\n' },
    { name: 'raw html pre block', source: '<pre><code class="ruby">if (ready && value < limit)\n  puts "highlighted code"\nend</code></pre>\n\np. after raw block\n' },
    { name: 'inline html', source: 'text with <mark>hl</mark> and <cite>c</cite> and <span class="x">s</span>\n' },
    { name: 'unicode content', source: 'h1. 日本語と Unicode\n\np. Textile supports 日本語、アクセント é、漢字、かな、全角記号。Inline @<tag>& value@ remains escaped code.\n\n"日本語のリンク":https://textile-lang.com/\n' },
    { name: 'crlf document', source: 'h1. Title\r\n\r\n* one\r\n* two\r\n\r\nText *bold*.\r\n' },
];

/**
 * Markdown→Textileで描画が変わらないことを確認する構文ごとの入力。
 */
const markdownFidelityCases: ReadonlyArray<{ name: string; source: string }> = [
    { name: 'headings', source: '# Heading one\n\n## Heading two\n\n### Heading three\n\n## Heading two\n' },
    { name: 'paragraph phrases', source: 'Paragraphs support **bold**, *italic*, _italic too_, ++inserted++, ~~deleted~~, ^superscript^, ~subscript~, and `inline code`.\n\n***nested*** and ==highlight== forms.\n' },
    { name: 'soft and hard breaks', source: 'first line\nsecond line of the same paragraph\n\nhard\\\nbreak here\n' },
    { name: 'lists', source: '- First bullet\n- Second bullet\n  - Nested bullet\n    - Third-level bullet\n- Back\n\n1. First numbered item\n2. Second numbered item\n   1. Nested numbered\n' },
    { name: 'list item with phrases', source: '- item with **strong** and `code`\n- item with [link](https://example.com/)\n' },
    { name: 'blockquote', source: '> A Markdown block quotation for preview and export.\n\nAfter quote.\n' },
    { name: 'multi paragraph blockquote', source: '> First quoted paragraph.\n>\n> Second quoted paragraph.\n\nBack to normal text.\n' },
    { name: 'table', source: '| Name | Format |\n| --- | --- |\n| Textile | Textile |\n| Markdown | Markdown |\n' },
    { name: 'table with alignment', source: '| Left | Right | Center |\n| :--- | ---: | :---: |\n| a | b | c |\n' },
    { name: 'links and images', source: '[Markdown reference](https://commonmark.org/) and [Local guide](./guide.md) and [Section link](#details)\n\n![Local sample image](assets/reference-sample.svg)\n\n[![Linked sample image](https://example.com/logo.svg)](https://textile-lang.com/)\n' },
    { name: 'link followed by japanese text', source: 'サーバに[Redmine](https://redmine.jp/)をインストール。\n' },
    { name: 'bare url autolink', source: 'see https://example.com/path for details.\n' },
    { name: 'horizontal rule', source: 'Before rule.\n\n---\n\nAfter rule.\n\n***\n' },
    { name: 'escaped markdown characters', source: 'Literal \\*stars\\* and \\_underscores\\_ stay literal.\n' },
    { name: 'html block', source: '<div class="note">\n<p>raw <strong>html</strong></p>\n</div>\n\nAfter html.\n' },
    { name: 'setext headings', source: 'Title\n=====\n\nSubtitle\n--------\n\nBody.\n' },
    { name: 'unicode content', source: '# 日本語と Unicode\n\nMarkdown supports 日本語、アクセント é、漢字、かな、全角記号。Inline `<tag>& value` remains escaped code.\n\n[日本語のリンク](https://commonmark.org/)\n' },
    { name: 'crlf document', source: '# Title\r\n\r\n- one\r\n- two\r\n\r\nText **bold**.\r\n' },
];

describe('convertTextileToMarkdown',
    () => {
        for (const { name, source } of textileFidelityCases) {
            it(`keeps the preview unchanged: ${name}`,
                () => {
                    expectPreviewUnchanged(source, 'textile');
                });
        }

        it('keeps line endings and the trailing newline',
            () => {
                expect(convertTextileToMarkdown('h1. A\r\n\r\ntext\r\n')).toBe('# A\r\n\r\ntext\r\n');
                expect(convertTextileToMarkdown('h1. A\n\ntext')).toBe('# A\n\ntext');
                expect(convertTextileToMarkdown('p. A\r\ntext\nmore\r\n')).toBe('A\\\r\ntext\\\nmore\r\n');
                // Textileの見出しは空行まで続くため、続く行は見出し内の改行になる。Markdownの見出しは改行を書けないため、
                // HTMLは使わずに空白でつなぎ、変換できない記法として報告する。
                expect(convertTextileToMarkdown('h1. A\r\ntext\r\n')).toBe('# A text\r\n');
                expect(convertDocumentSyntax('h1. A\r\ntext\r\n', 'textile', 'markdown').unsupportedLines).toEqual([2]);
                expect(convertTextileToMarkdown('')).toBe('');
            });

        it('converts block syntax',
            () => {
                // 見出しのID（`h2(#id).`）は同じ意味のMarkdownの明示ID（`{#id}`）へ写す。
                expect(convertTextileToMarkdown('h2(#id). Title')).toBe('## Title {#id}');
                expect(convertTextileToMarkdown('|_. a |_. b |\n|<. 1 |>. 2 |')).toBe('| a | b |\n| :--- | ---: |\n| 1 | 2 |');
                expect(convertTextileToMarkdown('bq. quote\nmore')).toBe('> quote\\\n> more');
                // Textileのコードは構文の意味が同じMarkdownのフェンスへ写す（見出し帯の有無は表示上の違いだけ）。
                expect(convertTextileToMarkdown('bc(ruby). puts 1\nputs 2')).toBe('```ruby\nputs 1\nputs 2\n```');
                expect(convertTextileToMarkdown('* a\n** b\n# c')).toBe('- a\n  - b\n1. c');
                expect(convertTextileToMarkdown('|_. a |_. b |\n| 1 | 2 |')).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
                expect(convertTextileToMarkdown('ref[1]\n\nfn1. note')).toBe('ref[^1]\n\n[^1]: note');
            });

        it('converts inline syntax',
            () => {
                // 引用元（`??`）とclass付きの範囲（`%`）はMarkdownに記法がないため、Markdown文書のプレビューも同じ要素として描画する
                // Textileの記法のまま書く（HTMLは使わない）。
                expect(convertTextileToMarkdown('*b* _i_ -d- +i+ @c@ ??q?? %(x)s%')).toBe('**b** *i* ~~d~~ ++i++ `c` ??q?? %(x)s%');
                // 角括弧の書き方（境界のない位置の強調・コード）も読む。
                expect(convertTextileToMarkdown('日本語[*太字*]と[@code@]です')).toBe('日本語**太字**と`code`です');
                // Textileの`!src(alt)!`はMarkdownの`![alt](src)`と構文の意味が同じ（代替文字列のツールチップは表示上の違いだけ）。
                expect(convertTextileToMarkdown('"t":https://e.com/ and !i.png(alt)! and !i.png!:https://e.com/')).toBe('[t](https://e.com/) and ![alt](i.png) and [![](i.png)](https://e.com/)');
                expect(convertTextileToMarkdown('["t":https://e.com/]x')).toBe('[t](https://e.com/)x');
            });

        it('leaves code, raw html, and unsupported syntax untouched',
            () => {
                expect(convertTextileToMarkdown('bc. *not bold* "not":link\n')).toBe('```\n*not bold* "not":link\n```\n');
                // Textileプレビューと同じく、タグ直後の整形用改行を取り除き、本文はHTMLテキストとして退避する。
                expect(convertTextileToMarkdown('<pre>\n*raw* <b>\n</pre>\n')).toBe('<pre>*raw* &lt;b&gt;\n</pre>\n');
                expect(convertTextileToMarkdown('|a|b|\n|c|d|\n')).toBe('|a|b|\n|c|d|\n');
                expect(convertTextileToMarkdown('|\\2. span|\n|a|b|\n')).toBe('|\\2. span|\n|a|b|\n');
                expect(convertTextileToMarkdown('- term := definition\n')).toBe('- term := definition\n');
                expect(convertTextileToMarkdown('notextile. *literal*\n')).toBe('\\*literal\\*\n');
                expect(convertTextileToMarkdown('inline @a *b* c@ code')).toBe('inline `a *b* c` code');
            });

        it('does not treat ordinary punctuation as phrase markers',
            () => {
                // ` - `はTextileの文字置換でenダッシュになるため、Markdownにも置換後の文字を書く。
                expect(convertTextileToMarkdown('a - b - c and 2 * 3 * 4 and a_b_c')).toBe('a – b – c and 2 \\* 3 \\* 4 and a_b_c');
                expect(convertTextileToMarkdown('Hello! World!')).toBe('Hello! World!');
            });

        it('converts the bundled Textile sample without throwing and keeps unsupported lines',
            () => {
                const source = readFileSync(path.resolve('sample/textile/core.textile'), 'utf8');
                const converted = convertTextileToMarkdown(source);
                expect(converted).toContain('# Textile preview coverage');
                expect(converted).toContain('- First bullet');
                expect(converted).toContain('|\\2. 横方向に2セル結合|');
                expect(converted.endsWith('\n')).toBe(source.endsWith('\n'));
            });
    });

describe('convertMarkdownToTextile',
    () => {
        for (const { name, source } of markdownFidelityCases) {
            it(`keeps the preview unchanged: ${name}`,
                () => {
                    expectPreviewUnchanged(source, 'markdown');
                });
        }

        it('keeps line endings and the trailing newline',
            () => {
                expect(convertMarkdownToTextile('# A\r\n\r\ntext\r\n')).toBe('h1. A\r\n\r\ntext\r\n');
                expect(convertMarkdownToTextile('# A\n\ntext')).toBe('h1. A\n\ntext');
                expect(convertMarkdownToTextile('')).toBe('');
            });

        it('converts block syntax',
            () => {
                expect(convertMarkdownToTextile('## Title {#id}')).toBe('h2(#id). Title');
                expect(convertMarkdownToTextile('> quote\n> more')).toBe('bq. quote more');
                expect(convertMarkdownToTextile('```ruby\nputs 1\nputs 2\n```')).toBe('bc(ruby). puts 1\nputs 2');
                // 空行を含むコードは複数段落のコードブロック`bc..`にする。
                expect(convertMarkdownToTextile('```\na\n\nb\n```')).toBe('bc.. a\n\nb');
                // `bc..`の後ろにリストなど段落以外のブロックが続く場合は、取り込まれないよう空の段落`p. `を置いて閉じる（HTMLは使わない）。
                expect(convertMarkdownToTextile('```\na\n\nb\n```\n\n- item')).toBe('bc.. a\n\nb\n\np. \n\n* item');
                expect(convertMarkdownToTextile('- a\n  - b\n1. c')).toBe('* a\n** b\n# c');
                expect(convertMarkdownToTextile('| a | b |\n| --- | ---: |\n| 1 | 2 |')).toBe('|_. a|_>. b|\n|1|>. 2|');
                expect(convertMarkdownToTextile('ref[^note]\n\n[^note]: body')).toBe('ref[1]\n\nfn1. body');
                expect(convertMarkdownToTextile('***')).toBe('---');
            });

        it('converts inline syntax',
            () => {
                // 強調表示はTextileに記法がないため、意味のclass（mark）を付けた範囲にする。境界のない位置は角括弧の書き方にする。
                expect(convertMarkdownToTextile('**b** *i* ~~d~~ ++i++ `c` ==h==')).toBe('*b* _i_ -d- +i+ @c@ %(mark)h%');
                expect(convertMarkdownToTextile('日本語の**太字**と`code`です')).toBe('日本語の[*太字*]と[@code@]です');
                // 画像はTextileの画像記法にする。Textileは代替文字列をtitleにも使い、別のtitleを書けないため、titleは代替文字列になる。
                expect(convertMarkdownToTextile('[t](https://e.com/) and ![alt](i.png) and ![alt](i.png "alt") and ![a](i.png "tip") and [![](i.png)](https://e.com/)')).toBe('"t":https://e.com/ and !i.png(alt)! and !i.png(alt)! and !i.png(a)! and !i.png!:https://e.com/');
                expect(convertMarkdownToTextile('[t](https://e.com/)x')).toBe('["t":https://e.com/]x');
            });

        it('writes syntax that Textile cannot draw with the same meaning and never as HTML',
            () => {
                // 図と数式は、Textileに描画の記法がないため、言語名付きのコードブロックとして原文を書く。
                expect(convertMarkdownToTextile('```mermaid\ngraph TD\n  A --> B\n```\n')).toBe('bc(mermaid). graph TD\n  A --> B\n');
                expect(convertMarkdownToTextile('$$\nx^2\n$$\n')).toBe('bc(math). x^2\n');
                // インライン数式は記法として解釈されない範囲に書く（`^`・`~`はTextileのプレビューが上付き・下付きにするため文字参照）。
                expect(convertMarkdownToTextile('inline $x^2$ math')).toBe('inline ==$x&#94;2$== math');
                // タスクリストの印・目次の指定・ページ区切りは、原文の文字（コメント）のまま書く。
                expect(convertMarkdownToTextile('- [ ] todo\n- [x] done\n')).toBe('* [ ] todo\n* [x] done\n');
                expect(convertMarkdownToTextile('[TOC]\n')).toBe('[TOC]\n');
                expect(convertMarkdownToTextile('<!-- pagebreak -->\n')).toBe('<!-- pagebreak -->\n');
                // front matterは表示されないTextileのコメントにする。
                expect(convertMarkdownToTextile('---\nmarp: true\n---\n\n# Slide\n')).toBe('###. ---\nmarp: true\n---\n\nh1. Slide\n');
                expect(convertMarkdownToTextile('`a @b@ c`')).toBe('@a &#64;b&#64; c@');
                for (const source of ['- [ ] todo\n', '```mermaid\nA\n```\n', '$$\nx\n$$\n', '> [!NOTE]\\\n> body\n', '日本語の**太字**\n']) {
                    expect(convertMarkdownToTextile(source), source).not.toMatch(/<[a-z]/i);
                }
            });

        it('keeps Markdown-escaped characters literal in Textile',
            () => {
                // GFMが自動リンクにするメールアドレスは、Textileでもリンクになるようmailto:で書く。
                expect(convertMarkdownToTextile('a@b.com and c@d.org')).toBe('"a@b.com":mailto:a@b.com and "c@d.org":mailto:c@d.org');
                expect(convertMarkdownToTextile('\\# not a heading')).toBe('&#35; not a heading');
                expect(convertMarkdownToTextile('\\*literal\\*')).toBe('&#42;literal&#42;');
            });

        it('keeps quotes, dashes, and other characters that Textile would replace typographically',
            () => {
                expect(convertMarkdownToTextile('"Quote" it\'s 1 x 2 -- a - b... (c)')).toBe('&#34;Quote&#34; it&#39;s 1 &#120; 2 &#45;- a &#45; b&#46;.. &#40;c)');
                expect(convertTextileToMarkdown('"Quote" it\'s 1 x 2 -- a - b... (c)')).toBe('“Quote” it’s 1 × 2 — a – b… ©');
            });
    });

describe('convertDocumentSyntax',
    () => {
        it('returns the source unchanged when the syntax does not change',
            () => {
                expect(convertDocumentSyntax('# a *b*', 'markdown', 'markdown')).toEqual({ text: '# a *b*', unsupportedLines: [] });
                expect(convertDocumentSyntax('h1. a', 'textile', 'textile')).toEqual({ text: 'h1. a', unsupportedLines: [] });
            });

        it('round-trips a simple document',
            () => {
                const markdown = '# Title\n\nText with **bold** and `code`.\n\n- a\n- b\n';
                const textile = convertDocumentSyntax(markdown, 'markdown', 'textile');
                expect(textile.unsupportedLines).toEqual([]);
                expect(convertDocumentSyntax(textile.text, 'textile', 'markdown').text).toBe(markdown);
            });
    });

/**
 * 第三者レビューで見つかった、変換するとプレビューが変わり得るMarkdown入力。
 * 変換器が正しく写せるもの（fixed）と、写せないため行番号を報告して変換を止めるもの（reported）に分ける。
 */
const markdownReviewCases: ReadonlyArray<{ name: string; source: string; expect: 'fixed' | readonly number[] }> = [
    // Markdownのコードブロックは見出し帯が付き、Textileのコードでは同じ見た目にならないため報告する。
    // コードブロックは構文の意味が同じTextileの`bc.`へ写す（見出し帯の有無は表示上の違いだけで、報告しない）。
    { name: 'indented code block', source: 'Para\n\n    code line\n    more <b>\n', expect: 'fixed' },
    { name: 'fenced code', source: '```js\nif (ready) {\n  render("stays code");\n}\n```\n', expect: 'fixed' },
    { name: 'link destination with parentheses', source: '[wiki](https://en.wikipedia.org/wiki/A_(b)) now\n', expect: 'fixed' },
    { name: 'textile heading written in a markdown file', source: 'h1. Textile heading\n\nText.\n', expect: 'fixed' },
    // 項目の中のコードブロックはTextileの項目では表せないため、フェンスの行を報告する。
    { name: 'fenced code inside a list item', source: '- item\n\n  ```js\n  let a = 1;\n  ```\n- next\n', expect: [3, 4, 5] },
    // 項目の中の2つ目の段落は、Textileの項目の中の改行に続けて書く（同じ項目の中の別の行という意味は同じ）。
    { name: 'second paragraph inside a list item', source: '- a\n\n  second para\n- b\n', expect: 'fixed' },
    { name: 'nested blockquote', source: '> outer\n> > inner\n', expect: [1, 2] },
    { name: 'list inside a blockquote', source: '> - a\n> - b\n', expect: [1, 2] },
    // 以下はTextileに描画の記法がないが、HTMLを使わずに同じ意味の書き方（言語名付きのコード・原文の文字・コメント）へ写す。
    // プレビューの比較は、これらを同じ意味として扱う（previewEquivalence）。
    { name: 'callout', source: '> [!NOTE]\n> body\n', expect: 'fixed' },
    { name: 'mermaid fence', source: 'Text.\n\n```mermaid\ngraph TD\n  A --> B\n```\n', expect: 'fixed' },
    { name: 'math block', source: '$$\nx^2\n$$\n', expect: 'fixed' },
    { name: 'inline math', source: 'Energy $E=mc^2$ here.\n', expect: 'fixed' },
    { name: 'unclosed fence', source: '```\ncode\n', expect: 'fixed' },
    { name: 'task list', source: '- [ ] todo\n- [x] done\n', expect: 'fixed' },
    { name: 'page break', source: 'A\n\n<!-- pagebreak -->\n\nB\n', expect: 'fixed' },
    // 脚注は表示の位置と番号の書き方が違うだけで構文の意味が同じなので、Textileの脚注へ写す（報告しない）。
    { name: 'footnote', source: 'ref[^n]\n\n[^n]: note\n', expect: 'fixed' },
];

/**
 * 第三者レビューで見つかった、変換するとプレビューが変わり得るTextile入力。
 */
const textileReviewCases: ReadonlyArray<{ name: string; source: string; expect: 'fixed' | readonly number[] }> = [
    { name: 'numbered text in a paragraph', source: 'p. 1. not list\n', expect: 'fixed' },
    { name: 'markdown-looking literal text', source: 'Literal [x](y) and ~~z~~ and ++w++ text.\n', expect: 'fixed' },
    { name: 'intraword superscript', source: 'E=mc^2^ and H~2~O.\n', expect: 'fixed' },
    { name: 'notextile block with html', source: 'notextile. <b>raw</b>\n', expect: [1] },
    { name: 'raw notextile tag', source: '<notextile>\n*x*\n</notextile>\n', expect: [1, 2, 3] },
    { name: 'unclosed raw pre', source: '<pre>\ncode\n\np. after\n', expect: [1, 2, 3, 4] },
    { name: 'definition list', source: '- term := definition\n', expect: [1] },
    { name: 'footnote', source: 'ref[1]\n\nfn1. note\n', expect: 'fixed' },
];

describe('conversion safety for review findings',
    () => {
        for (const { name, source, expect: expected } of markdownReviewCases) {
            it(`markdown to textile: ${name}`,
                () => {
                    const lines = expectSafeConversion(source, 'markdown');
                    if (expected === 'fixed') expect(lines).toEqual([]);
                    else expect(lines).toEqual(expected);
                });
        }
        for (const { name, source, expect: expected } of textileReviewCases) {
            it(`textile to markdown: ${name}`,
                () => {
                    const lines = expectSafeConversion(source, 'textile');
                    if (expected === 'fixed') expect(lines).toEqual([]);
                    else expect(lines).toEqual(expected);
                });
        }

        it('keeps the preview or reports lines for every bundled sample document',
            () => {
                for (const file of ['sample/textile/core.textile', 'sample/textile/edge-cases.textile']) {
                    expectSafeConversion(readFileSync(path.resolve(file), 'utf8'), 'textile');
                }
                for (const file of ['sample/01-commonmark-gfm.md', 'sample/02-extended-syntax.md', 'sample/04-tables.md', 'sample/07-edge-cases.md', 'sample/textile/mixed.md']) {
                    expectSafeConversion(readFileSync(path.resolve(file), 'utf8'), 'markdown');
                }
            });

        it('keeps the preview of bundled samples after removing the reported lines',
            () => {
                // 報告行を含む文書は比較できないため、報告行を取り除いた残りが変換後も同じ見た目になることを確かめる。
                // 取り除くことで新たな報告が出た場合は数回まで繰り返す。
                const samples: ReadonlyArray<[string, 'markdown' | 'textile']> = [
                    ['sample/textile/core.textile', 'textile'],
                    ['sample/textile/edge-cases.textile', 'textile'],
                    ['sample/01-commonmark-gfm.md', 'markdown'],
                    ['sample/02-extended-syntax.md', 'markdown'],
                    ['sample/06-specification-template.md', 'markdown'],
                    ['sample/07-edge-cases.md', 'markdown'],
                    ['sample/09-large-document.md', 'markdown'],
                ];
                for (const [file, from] of samples) {
                    let source = readFileSync(path.resolve(file), 'utf8').replace(/\r\n/g, '\n');
                    let compared = false;
                    for (let round = 0; round < 5 && !compared; round += 1) {
                        const reported = new Set(expectSafeConversion(source, from));
                        if (reported.size === 0) compared = true;
                        else source = source.split('\n').filter((_, lineIndex) => !reported.has(lineIndex + 1)).join('\n');
                    }
                    expect(compared, file).toBe(true);
                }
            });

        it('converts long paragraphs made of many soft-wrapped lines in linear time',
            () => {
                // 段落内のソフト改行は連結されて1行になるため、閉じない記号を含む行が多数続くと長い1行と同じ負荷になる。
                const markdown = 'line with *a\n'.repeat(30000);
                const textile = '日本語の行です *a\n'.repeat(30000);
                const started = performance.now();
                convertDocumentSyntax(markdown, 'markdown', 'textile');
                convertDocumentSyntax(textile, 'textile', 'markdown');
                expect(performance.now() - started).toBeLessThan(3000);
            });

        it('converts a long line with many unclosed markers in linear time',
            () => {
                const line = '*a '.repeat(14000);
                const started = performance.now();
                convertDocumentSyntax(line, 'textile', 'markdown');
                convertDocumentSyntax(line, 'markdown', 'textile');
                expect(performance.now() - started).toBeLessThan(2000);
            });
    });

/**
 * 2回目の第三者レビューで見つかった偽陰性（報告行がないのにプレビューが変わる）の入力。
 * 変換器で正しく写せるようになったもの（safe）と、変換器が報告するもの（reported）は変換器単体で安全であること、
 * 変換器ではまだ写せないもの（guarded）は、アプリが適用前に行う描画比較で必ず「違う」と判定され、変換が適用されないことを確かめる。
 */
const secondReviewCases: ReadonlyArray<{ source: string; from: 'markdown' | 'textile'; expect: 'safe' | 'reported' | 'guarded' }> = [
    { source: '## 概要\nこのドキュメントは本文です。\n', from: 'markdown', expect: 'safe' },
    { source: 'para\n# h\n', from: 'markdown', expect: 'safe' },
    { source: 'para\n> q\n', from: 'markdown', expect: 'safe' },
    { source: 'arr[0] and items[2]\n', from: 'markdown', expect: 'safe' },
    { source: 'mail a@b.com now\n', from: 'markdown', expect: 'safe' },
    { source: '- a\n\n- b\n', from: 'markdown', expect: 'safe' },
    { source: '項目\n| a | b |\n|---|---|\n| 1 | 2 |\n', from: 'markdown', expect: 'safe' },
    { source: '\`y\`\n', from: 'markdown', expect: 'safe' },
    { source: '# H\n- a\n- b\n## H2\ntext\n> quote\nafter\n', from: 'markdown', expect: 'safe' },
    { source: 'a | b\n--|--\n1 | 2\n', from: 'markdown', expect: 'guarded' },
    { source: '[`c`](u)\n', from: 'markdown', expect: 'guarded' },
    { source: '# [link](u) head\n', from: 'markdown', expect: 'safe' },
    { source: 'para\nh2. head\n', from: 'textile', expect: 'safe' },
    { source: 'arr[1]\n', from: 'textile', expect: 'reported' },
    { source: 'mail a@b.com now\n', from: 'textile', expect: 'safe' },
    { source: '* a\n\n* b\n', from: 'textile', expect: 'safe' },
    { source: '# a\n\n# b\n', from: 'textile', expect: 'safe' },
    { source: 'a\n---\n', from: 'textile', expect: 'safe' },
    { source: 'a\n===\n', from: 'textile', expect: 'safe' },
    { source: '$x$ math\n', from: 'textile', expect: 'safe' },
    { source: 'h2. H\n本文\n', from: 'textile', expect: 'reported' },
    // 行頭が空白のTextileの行は段落で包まれずに表示されるが、本文としての意味は段落と同じ（表示上の余白の違いだけ）。
    { source: ' leading\n', from: 'textile', expect: 'safe' },
    { source: '!{width:10px}a.png!\n', from: 'textile', expect: 'guarded' },
];

describe('conversion safety for second review findings',
    () => {
        for (const { source, from, expect: expected } of secondReviewCases) {
            it(`${from}: ${JSON.stringify(source).slice(0, 50)} is ${expected}`,
                () => {
                    const to = from === 'markdown' ? 'textile' : 'markdown';
                    const result = convertDocumentSyntax(source, from, to);
                    if (expected === 'reported') {
                        expect(result.unsupportedLines.length).toBeGreaterThan(0);
                        return;
                    }
                    expect(result.unsupportedLines).toEqual([]);
                    // safeは描画が一致すること、guardedはアプリの描画比較が不一致を検出して適用しないこと。
                    expect(previewEqual(source, result.text, from), `converted source:\n${result.text}`).toBe(expected === 'safe');
                });
        }
    });

describe('conversion safety for third review findings',
    () => {
        it('reports aligned images and block classes instead of dropping them',
            () => {
                for (const source of ['!>a.png!\n', '!=a.png!\n', 'text !>a.png! more\n', 'p(cls). x\n', 'h3(cls). T\n']) {
                    expect(convertDocumentSyntax(source, 'textile', 'markdown').unsupportedLines, source).toEqual([1]);
                }
                // class付きリンクは、Markdown文書のプレビューがclass付きリンクとして描画するTextileの書き方のまま書く。
                for (const source of ['"(cls). a":https://e.com/\n', '"(cls)a":https://e.com/\n']) {
                    const result = convertDocumentSyntax(source, 'textile', 'markdown');
                    expect(result.unsupportedLines, source).toEqual([]);
                    expect(result.text, source).toBe('"(cls). a":https://e.com/\n');
                }
            });

        it('keeps image titles in both directions',
            () => {
                expectPreviewUnchanged('!a.png(tip)!\n', 'textile');
                expectPreviewUnchanged('![x](a.png "tip")\n', 'markdown');
                expectPreviewUnchanged('![x](a.png)\n', 'markdown');
            });
    });

describe('conversion safety for fourth review findings',
    () => {
        it('reports element IDs, language attributes, and list item attributes that Markdown cannot keep',
            () => {
                for (const source of ['p(#myid). a\n', 'bq(#q). a\n', 'bc(#cid). a\n', 'p[zh]. 直角\n', 'bq[fr]. a\n', '#[fr] b\n', '*(cls) a\n']) {
                    expect(convertDocumentSyntax(source, 'textile', 'markdown').unsupportedLines, source).toEqual([1]);
                }
                // 見出しのIDはプレビューが本文から決め直すため、変換しても見た目は変わらない。
                expectPreviewUnchanged('h2(#custom). Title\n', 'textile');
            });

        it('treats element IDs and language attributes as visible in the preview comparison',
            () => {
                expect(previewEqual('p(#myid). a\n', 'a\n', 'textile')).toBe(false);
                expect(previewEqual('p[zh]. a\n', 'a\n', 'textile')).toBe(false);
            });
    });

describe('conversion safety for the third-party review of the conversion without HTML',
    () => {
        it('writes reference-style images as Textile images',
            () => {
                // 参照形式の画像は、定義の参照先を使ったTextileの画像記法にする（`!`とリンクに分かれない）。
                expect(convertMarkdownToTextile('![i][r2] and ![r2]\n\n[r2]: a.png\n')).toBe('!a.png(i)! and !a.png(r2)!\n\n');
                expectPreviewUnchanged('![i][r2] and ![r2]\n\n[r2]: a.png\n', 'markdown');
            });

        it('keeps the start number of ordered lists in both directions',
            () => {
                expect(convertMarkdownToTextile('3. three\n4. four\n')).toBe('#3 three\n# four\n');
                expect(convertTextileToMarkdown('#3 three\n# four\n')).toBe('3. three\n4. four\n');
                expectPreviewUnchanged('3. three\n4. four\n', 'markdown');
                expectPreviewUnchanged('#3 three\n# four\n', 'textile');
            });

        it('keeps the table structure and drops only table and row styles',
            () => {
                const result = convertDocumentSyntax('|_. h1|_. h2|\n{background:#f00}. |x|y|\n', 'textile', 'markdown');
                expect(result.text).toBe('| h1 | h2 |\n| --- | --- |\n| x | y |\n');
                expect(result.unsupportedLines).toEqual([2]);
                const signature = convertDocumentSyntax('table{border:1px solid}.\n|a|b|\n', 'textile', 'markdown');
                expect(signature.text).toBe('|a|b|\n');
                expect(signature.unsupportedLines).toEqual([1]);
            });

        it('does not add characters that are not in the source for structures that Textile cannot nest',
            () => {
                // 入れ子の引用は`>`を足さずに段落を分け、コードはフェンス・言語名を足さずにコードの行にする。
                expect(convertMarkdownToTextile('> a\n>> b\n')).toBe('bq.. a\n\nb\n');
                expect(convertMarkdownToTextile('> x\n> ```js\n> let a = 1;\n> ```\n')).toBe('bq. x\n@let a = 1;@\n');
                expect(convertMarkdownToTextile('- item\n\n  ```js\n  x @y\n  ```\n- next\n')).toBe('* item\n[@x &#64;y@]\n* next\n');
            });
    });

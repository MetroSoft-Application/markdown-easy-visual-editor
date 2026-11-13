/**
 * @fileoverview 変換タブの適用前検査に使うプレビュー比較（previewEquivalence）を検証する。
 * 検証する仕様: 利用者に見える違い（文字、コードの空白・言語、リンク先、要素の種類）は必ず「違う」と判定し、
 * 描画器内部の違い（ラッパー、data属性、改行コード、文字参照、別名タグ）だけを同じとみなすこと。
 * 回帰リスク: 正規化を緩めすぎて、見た目の変わる変換を通してしまうこと（偽陰性）。
 * 実行境界はtest（Node）。描画器は実物（markdownRendererCore）を使う。
 */
import { describe, expect, it } from 'vitest';
import { renderMarkdownUnsafeBlocks, type MarkdownRenderFormat } from '../src/webview/markdown/markdownRendererCore';
import { comparePreviewBlocks, lineNumberAtOffset, normalizePreviewHtml } from '../src/webview/markdown/previewEquivalence';

/**
 * プレビューと同じ描画器で描画する。
 * @param source - 本文。
 * @param format - 描画形式。
 * @returns 描画ブロック。
 */
function render(source: string, format: MarkdownRenderFormat): Array<{ html: string }> {
    return renderMarkdownUnsafeBlocks(source, { remoteImagesEnabled: true, language: 'ja', renderFormat: format });
}

describe('comparePreviewBlocks',
    () => {
        it('treats renderer-internal differences between Textile and Markdown as equal',
            () => {
                // 見出し・強調・リンク・表・コードで、記法は違っても見た目が同じもの。
                expect(comparePreviewBlocks(
                    render('h1. Title\n\np. *bold* and "link":https://e.com/\n\n|_. A |_. B |\n|1|2|\n\nbc(ruby). puts 1\n', 'textile'),
                    render('# Title\n\n**bold** and [link](https://e.com/)\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n<pre><code class="ruby">puts 1</code></pre>\n', 'mixed')
                ).equal).toBe(true);
            });

        it('treats the code block header bar (language name and copy button) as presentation, not meaning',
            () => {
                // 比較は変換の誤りを見つけるためのもの。構文の意味が同じコードブロックは、見出し帯の有無を違いとしない。
                expect(comparePreviewBlocks(render('bc(ruby). puts 1\n', 'textile'), render('```ruby\nputs 1\n```\n', 'mixed')).equal).toBe(true);
                // 言語・本文の違いは意味の違いとして検出する。
                expect(comparePreviewBlocks(render('bc(ruby). puts 1\n', 'textile'), render('```js\nputs 1\n```\n', 'mixed')).equal).toBe(false);
                expect(comparePreviewBlocks(render('bc(ruby). puts 1\n', 'textile'), render('```ruby\nputs 2\n```\n', 'mixed')).equal).toBe(false);
            });

        it('treats an image tooltip that repeats the alternative text as presentation',
            () => {
                expect(comparePreviewBlocks(render('!a.png(alt)!', 'textile'), render('![alt](a.png)', 'mixed')).equal).toBe(true);
            });

        it('detects visible differences',
            () => {
                // 文字の違い
                expect(comparePreviewBlocks(render('a "quote"', 'mixed'), render('a “quote”', 'mixed')).equal).toBe(false);
                // コードの字下げの違い
                expect(comparePreviewBlocks(render('```\n  a\n```\n', 'mixed'), render('```\na\n```\n', 'mixed')).equal).toBe(false);
                // コードの言語（構文強調の色）の違い
                expect(comparePreviewBlocks(render('```ruby\na\n```\n', 'mixed'), render('```js\na\n```\n', 'mixed')).equal).toBe(false);
                // リンク先の違い
                expect(comparePreviewBlocks(render('[a](https://a/)', 'mixed'), render('[a](https://b/)', 'mixed')).equal).toBe(false);
                // 要素の種類の違い（見出しと段落）
                expect(comparePreviewBlocks(render('# a', 'mixed'), render('a', 'mixed')).equal).toBe(false);
                // <pre>と<pre><code>の違い
                expect(comparePreviewBlocks(render('pre. a\n', 'textile'), render('bc. a\n', 'textile')).equal).toBe(false);
            });

        it('detects differences in visible attributes and inline spacing (third review findings)',
            () => {
                const pairs: ReadonlyArray<[string, MarkdownRenderFormat, string, MarkdownRenderFormat]> = [
                    // 画像の寄せ方（data-mve-image-align・align）
                    ['!>a.png!', 'textile', '![](a.png)', 'mixed'],
                    ['!=a.png!', 'textile', '![](a.png)', 'mixed'],
                    // 画像の代替文字列（画像のtitle＝ツールチップは表示上の装飾として比べない。下の別のテストで確かめる）
                    ['![tip](a.png)', 'mixed', '![x](a.png)', 'mixed'],
                    // 番号付きリストの開始番号
                    ['3. a', 'mixed', '1. a', 'mixed'],
                    // 段落・見出しの配置（style）
                    ['p>. x', 'textile', 'p. x', 'textile'],
                    ['h1>. T', 'textile', 'h1. T', 'textile'],
                    // セル結合（colspan）
                    ['|\\2. a|\n|b|c|', 'textile', '|a|\n|b|c|', 'textile'],
                    // 表の属性
                    ['<table border="1"><tr><td>a</td></tr></table>', 'mixed', '<table><tr><td>a</td></tr></table>', 'mixed'],
                    // 強調タグの属性
                    ['<em style="color:red">a</em>', 'mixed', '*a*', 'mixed'],
                    // リンクのtitle
                    ['[a](u "tip")', 'mixed', '[a](u)', 'mixed'],
                    // インライン要素の間の空白の有無
                    ['**a** *b*', 'mixed', '**a***b*', 'mixed'],
                    // インラインコード内の空白
                    ['`a  b`', 'mixed', '`a b`', 'mixed'],
                    // クラス付きリンク
                    ['"(cls). a":https://e/', 'textile', '"a":https://e/', 'textile'],
                ];
                for (const [left, leftFormat, right, rightFormat] of pairs) {
                    expect(comparePreviewBlocks(render(left, leftFormat), render(right, rightFormat)).equal, `${left} vs ${right}`).toBe(false);
                }
            });

        it('ignores line-ending and character-reference differences that browsers display identically',
            () => {
                expect(normalizePreviewHtml('<pre><code>a\r\nb</code></pre>')).toBe(normalizePreviewHtml('<pre><code>a\nb</code></pre>'));
                expect(normalizePreviewHtml('<p>A &#124; B</p>')).toBe(normalizePreviewHtml('<p>A | B</p>'));
                // 描画器によって本文の`>`を文字参照で書くかどうかが違う（表示は同じ）。
                expect(normalizePreviewHtml('<p>A --&gt; B</p>')).toBe(normalizePreviewHtml('<p>A --> B</p>'));
                expect(normalizePreviewHtml('<p>A &lt; B</p>')).not.toBe(normalizePreviewHtml('<p>A &gt; B</p>'));
            });

        it('reports the source offset of the first differing block',
            () => {
                const source = '# Same\n\nSame text.\n\nDifferent text.\n';
                const comparison = comparePreviewBlocks(render(source, 'mixed'), render('# Same\n\nSame text.\n\nChanged text.\n', 'mixed'));
                expect(comparison.equal).toBe(false);
                expect(lineNumberAtOffset(source, comparison.firstDifferenceOffset ?? -1)).toBe(5);
            });
    });

describe('lineNumberAtOffset',
    () => {
        it('counts CRLF, CR, and LF as one line break each and clamps out-of-range offsets',
            () => {
                expect(lineNumberAtOffset('a\r\nb\rc\nd', 0)).toBe(1);
                expect(lineNumberAtOffset('a\r\nb\rc\nd', 3)).toBe(2);
                expect(lineNumberAtOffset('a\r\nb\rc\nd', 7)).toBe(4);
                expect(lineNumberAtOffset('a\nb', 99)).toBe(2);
                expect(lineNumberAtOffset('a\nb', -5)).toBe(1);
            });
    });

describe('comparePreviewBlocks whitespace handling (sixth review findings)',
    () => {
        it('keeps non-breaking spaces, which are visible, distinct from collapsible whitespace',
            () => {
                expect(comparePreviewBlocks(render('a\u00a0\u00a0\u00a0b', 'mixed'), render('a b', 'mixed')).equal).toBe(false);
                expect(comparePreviewBlocks(render('<p>\u00a0</p>\n\nx', 'mixed'), render('x', 'mixed')).equal).toBe(false);
            });
    });

describe('comparePreviewBlocks meaning equivalences (conversion without HTML)',
    () => {
        // 変換タブはHTMLへ変換せず、変換先に描画の記法がない要素を同じ意味の記法（言語名付きのコード・原文の文字・コメント）へ写す。
        // 比較はそれらを同じ意味として扱い、内容（文字・図や数式のソース・リンク先）が違う場合は違うと判定することを確かめる。
        it.each([
            ['task list', '- [ ] todo\n- [x] done\n', 'mixed', '* [ ] todo\n* [x] done\n', 'textile'],
            ['task list with an uppercase mark', '- [X] done\n', 'mixed', '* [x] done\n', 'textile'],
            ['mermaid diagram', '```mermaid\ngraph TD\n  A-->B\n```\n', 'mixed', 'bc(mermaid). graph TD\n  A-->B\n', 'textile'],
            ['inline math', 'in $x^2$ ok\n', 'mixed', 'in ==$x&#94;2$== ok\n', 'textile'],
            ['display math', '$$\nx^2 + y^2\n$$\n', 'mixed', 'bc(math). x^2 + y^2\n', 'textile'],
            ['table of contents', '[TOC]\n\n# H\n', 'mixed', '[TOC]\n\nh1. H\n', 'textile'],
            ['page break', 'a\n\n<!-- pagebreak -->\n\nb\n', 'mixed', 'a\n\n<!-- pagebreak -->\n\nb\n', 'textile'],
            ['highlight', 'hi ==mark== there\n', 'mixed', 'hi %(mark)mark% there\n', 'textile'],
            ['callout', '> [!NOTE]\\\n> body\n', 'mixed', 'bq. [!NOTE]\nbody\n', 'textile'],
            ['abbreviation', 'ABC(Desc) x\n', 'textile', 'ABC(Desc) x\n', 'mixed'],
            ['definition list', '- term := def\n', 'textile', '- term := def\n', 'mixed'],
            ['image title', '![x](a.png "tip")\n', 'mixed', '!a.png(x)!\n', 'textile'],
            ['heading id', '# 見出し {#custom-id}\n', 'mixed', 'h1(#custom-id). 見出し\n', 'textile'],
            ['loose list', '- a\n\n- b\n', 'mixed', '* a\n* b\n', 'textile'],
            ['second paragraph in a list item', '- a\n\n  second\n- b\n', 'mixed', '* a\nsecond\n* b\n', 'textile'],
        ] as const)('treats %s as the same meaning', (name, left, leftFormat, right, rightFormat) => {
            expect(comparePreviewBlocks(render(left, leftFormat), render(right, rightFormat)).equal, name).toBe(true);
        });

        it.each([
            ['task mark', '- [ ] todo\n', 'mixed', '* [x] todo\n', 'textile'],
            ['mermaid source', '```mermaid\ngraph TD\n  A-->B\n```\n', 'mixed', 'bc(mermaid). graph TD\n  A-->C\n', 'textile'],
            ['math source', 'in $x^2$ ok\n', 'mixed', 'in ==$x&#94;3$== ok\n', 'textile'],
            ['callout type', '> [!NOTE]\\\n> body\n', 'mixed', 'bq. [!TIP]\nbody\n', 'textile'],
            ['abbreviation text', 'ABC(Desc) x\n', 'textile', 'ABC(Other) x\n', 'mixed'],
            ['image alternative text', '![x](a.png "tip")\n', 'mixed', '!a.png(y)!\n', 'textile'],
            ['heading text', '# 見出し {#custom-id}\n', 'mixed', 'h1(#custom-id). 別の見出し\n', 'textile'],
        ] as const)('still detects a different %s', (name, left, leftFormat, right, rightFormat) => {
            expect(comparePreviewBlocks(render(left, leftFormat), render(right, rightFormat)).equal, name).toBe(false);
        });
    });

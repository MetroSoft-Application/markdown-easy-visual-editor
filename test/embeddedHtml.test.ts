/**
 * @fileoverview 変換タブで原文の生HTMLを記法へ戻す規則（shared/embeddedHtml）を検証する。
 * 検証する仕様: 描画HTMLを、属性や要素の形に残った情報だけで同じ意味の記法へ戻せること。
 * 認識できないHTMLはundefinedを返し、呼び出し側が原文の生HTMLのまま残せること。
 * 回帰リスク: 規則の誤りで記法が別の意味になること。
 * 実行境界はtest（Node）。DOMに依存しない文字列処理だけを呼ぶ。
 */
import { describe, expect, it } from 'vitest';
import {
    htmlToMarkdown,
    htmlToTextile,
    parseHtml,
    textContent,
} from '../src/shared/embeddedHtml';

describe('parseHtml',
    () => {
        it('decodes character references in text and attributes and keeps comments out of the text',
            () => {
                const nodes = parseHtml('<p title="a &amp; b">x &lt; y<!-- c --></p>');
                const paragraph = nodes[0];
                expect(typeof paragraph).not.toBe('string');
                if (typeof paragraph === 'string') return;
                expect(paragraph.attrs.title).toBe('a & b');
                expect(textContent(nodes)).toBe('x < y');
            });
    });

describe('htmlToMarkdown',
    () => {
        it('restores blocks from the information that the preview HTML keeps',
            () => {
                expect(htmlToMarkdown('<div class="diagram-block mermaid" data-mermaid-source="graph%20TD%0A%20%20A--%3EB"></div>', '\n'))
                    .toBe('```mermaid\ngraph TD\n  A-->B\n```');
                expect(htmlToMarkdown('<span class="math-node math-block" data-math-source="x%5E2"><span>rendered</span></span>', '\n'))
                    .toBe('$$\nx^2\n$$');
                expect(htmlToMarkdown('<ul><li><input disabled="" type="checkbox"> a</li><li><input checked="" disabled="" type="checkbox"> b</li></ul>', '\n'))
                    .toBe('- [ ] a\n- [x] b');
                expect(htmlToMarkdown('<div class="page-break" aria-label=""></div>', '\n')).toBe('<!-- pagebreak -->');
            });

        it('uses CRLF when the document does',
            () => {
                // 強制改行は行末の空白2つではなく、見えて消えにくい行末のバックスラッシュで書く。
                expect(htmlToMarkdown('<p>a<br>b</p>', '\r\n')).toBe('a\\\r\nb');
                expect(htmlToMarkdown('<h2>a<br>b</h2>', '\r\n')).toBe('a\\\r\nb\r\n---');
                // 段落末尾の<br>は書けないため、文字として表示される`\`を末尾に残さない。
                expect(htmlToMarkdown('<p>a<br></p>', '\n')).toBe('a');
            });

        it('escapes only characters that would become syntax',
            () => {
                expect(htmlToMarkdown('<p>snake_case a * b [note]</p>', '\n')).toBe('snake_case a \\* b [note]');
                expect(htmlToMarkdown('<p><a href="https://e.com/">[x]</a></p>', '\n')).toBe('[\\[x\\]](https://e.com/)');
            });

        it('returns undefined for HTML that it cannot express',
            () => {
                expect(htmlToMarkdown('<details><summary>s</summary>x</details>', '\n')).toBeUndefined();
            });
    });

describe('htmlToTextile',
    () => {
        it('restores Textile block attributes and omits signatures and automatic ids by default',
            () => {
                expect(htmlToTextile('<p style="text-align:right">r</p>', '\n')).toBe('p>. r');
                expect(htmlToTextile('<p>plain</p>', '\n')).toBe('plain');
                expect(htmlToTextile('<p>plain</p>', '\n', true)).toBe('p. plain');
                expect(htmlToTextile('<h2 id="auto">T</h2>', '\n')).toBe('h2. T');
                expect(htmlToTextile('<h2 id="auto">T</h2>', '\n', true)).toBe('h2(#auto). T');
                expect(htmlToTextile('<dl>\n\t<dt>term</dt>\n\t<dd>definition</dd>\n</dl>', '\n')).toBe('- term := definition');
            });

        it('restores image links and class links',
            () => {
                expect(htmlToTextile('<p><a href="https://e.com/"><img src="a.svg" alt="A"></a></p>', '\n')).toBe('!a.svg(A)!:https://e.com/');
                expect(htmlToTextile('<p><a class="c" href="https://e.com/">S</a></p>', '\n')).toBe('"(c)S":https://e.com/');
            });
    });

/**
 * @fileoverview 変換タブの変換（conversionWithFallback）が、実在する文書を変換でき、プレビューを変えず、逆変換で元へ戻ることを検証する。
 * 検証する仕様:
 * - 構文の意味が同じ変換先の記法へ書き換え、HTMLへは変換しないこと（原文にないHTMLを書き出さない）。
 * - 変換前後のプレビュー比較（同じ意味の書き方の違いは同一視）が一致すること。変換先に同じ意味の記法がない構造
 *   （入れ子の引用、リスト項目の中のブロックなど）を含む文書も、変換を止めずに適用し、違いの位置を返すこと。
 * - 変換した文書を逆変換すると、プレビューが同じまま、順変換の規則の逆で元の記法へ戻ること。原文の記録は使わない。
 * - 標準的な書き方の文書は、往復で原文と完全に一致すること。
 * 回帰リスク: 変換が途中で止まること、HTMLが書き出されること、描画の繰り返しが際限なく増えること。
 * 実行境界はtest（Node）。描画は実物の描画器（markdownRendererCore）を同期で呼ぶ。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertDocumentSyntax } from '../src/shared/formatConversion';
import { convertPreservingPreview, type PreviewBlockRenderer } from '../src/webview/markdown/conversionWithFallback';
import { renderMarkdownUnsafeBlocks } from '../src/webview/markdown/markdownRendererCore';
import { comparePreviewBlocks } from '../src/webview/markdown/previewEquivalence';

/**
 * プレビューと同じ描画器で、変換タブと同じ指定（脚注を含むTextile文書も描画単位ごとに描画する）で描画する。
 */
const render: PreviewBlockRenderer = async (text, format) =>
    renderMarkdownUnsafeBlocks(text, { remoteImagesEnabled: true, language: 'ja', renderFormat: format, splitTextileBlocks: true });

/**
 * 文書を拡張子の記法から反対の記法へ変換する。
 * @param file - リポジトリルートからの相対パス。
 * @returns 変換結果。
 */
async function convertFile(file: string): Promise<Awaited<ReturnType<typeof convertPreservingPreview>>> {
    const source = readFileSync(path.resolve(file), 'utf8');
    return file.endsWith('.textile')
        ? convertPreservingPreview(source, 'textile', 'textile', 'markdown', 'mixed', render)
        : convertPreservingPreview(source, 'markdown', 'mixed', 'textile', 'textile', render);
}

describe('convertPreservingPreview',
    () => {
        it.each([
            'CHANGELOG.md',
            'sample/02-extended-syntax.md',
            'sample/03-images.md',
            'sample/04-tables.md',
            'sample/05-code-mermaid.md',
            'sample/06-specification-template.md',
            'sample/08-diagnostics.md',
            'sample/09-large-document.md',
            'sample/README.md',
            'sample/textile/mixed.md',
            'sample/textile/edge-cases.textile',
        ])('converts %s with an unchanged preview', async (file) => {
            const result = await convertFile(file);
            expect(result.equal).toBe(true);
            expect(result.text).not.toBe(readFileSync(path.resolve(file), 'utf8'));
        });

        it('writes blocks that Textile cannot draw as syntax with the same meaning, never as HTML',
            async () => {
                const source = '# Title\n\nText **bold**.\n\n```mermaid\ngraph TD\n  A --> B\n```\n\n- [ ] task\n';
                const result = await convertPreservingPreview(source, 'markdown', 'mixed', 'textile', 'textile', render);
                expect(result.equal).toBe(true);
                expect(result.text).toBe('h1. Title\n\nText *bold*.\n\nbc(mermaid). graph TD\n  A --> B\n\n* [ ] task\n');
                expect(result.text).not.toMatch(/<[a-z]/i);
            });

        it('keeps raw HTML that spans several Markdown blocks as the original HTML',
            async () => {
                // 原文の生HTMLは原文のHTMLのまま（Textileでは空行で分かれないよう`notextile..`に入れて）残す。HTMLへの変換ではない。
                const source = '# T\n\n<details>\n<summary>S</summary>\n\nInside paragraph.\n\n</details>\n\nAfter.\n';
                const { forward, back } = await roundTrip(source, 'markdown');
                expect(forward.equal).toBe(true);
                expect(forward.text).toBe('h1. T\n\nnotextile.. <details>\n<summary>S</summary>\n\nInside paragraph.\n\n</details>\n\np. After.\n');
                expect(back.equal).toBe(true);
                expect(back.text).toBe(source);
            });

        it('converts a Textile document with footnotes, definition lists, and tables without stopping',
            async () => {
                // 脚注を含むTextile文書も、プレビューはブロックごとに描画する（文書全体を1度に描画するとtextile-jsが
                // 定義リストの後ろの表を文字として表示していた）。この文書は、Markdownに同じ意味の記法がない表の行のstyleと、
                // Markdownのプレビューが記法を解釈しない脚注の本文（リンク）を含むため、変換を適用して違いの位置を返す。
                const source = readFileSync(path.resolve('sample/textile/core.textile'), 'utf8');
                const result = await convertFile('sample/textile/core.textile');
                expect(result.cancelled).toBe(false);
                expect(result.text).not.toBe(source);
                expect(result.text).toMatch(/^# Textile preview coverage/);
                expect(result.text).toContain('[^1]: [Dr. Katz](https://example.com/quote)');
                expect(result.equal).toBe(false);
                expect(result.firstDifferenceOffset).toBeDefined();
            });

        it.each([
            ['a nested quote', '> outer\n>\n> > inner\n', 'markdown'],
            ['a code block inside a list item', '1. item\n\n   ```js\n   let a = 1;\n   ```\n2. next\n', 'markdown'],
            ['Markdown inside raw HTML across blank lines', '<div class="card">\n\n### Title\n\n</div>\n', 'markdown'],
            ['a footnote body with a link', 'text[1]\n\nfn1. "link":https://example.com/\n', 'textile'],
        ] as const)('applies the conversion of %s and reports where the preview may change', async (name, source, from) => {
            // 変換先に同じ意味の記法がない構造は、HTMLを使わずに最も近い書き方で変換を適用し（止めない）、違いの位置を返す。
            const to = from === 'markdown' ? 'textile' : 'markdown';
            const result = await convertPreservingPreview(source, from, from === 'markdown' ? 'mixed' : 'textile', to, to === 'markdown' ? 'mixed' : 'textile', render);
            expect(result.cancelled, name).toBe(false);
            expect(result.equal, name).toBe(false);
            expect(result.firstDifferenceOffset, name).toBeDefined();
            expect(result.text, name).not.toBe(source);
            expect((result.text.match(/<[a-z]/gi) ?? []).length, name).toBeLessThanOrEqual((source.match(/<[a-z]/gi) ?? []).length);
        });
    });

describe('convertPreservingPreview data safety (fifth review findings)',
    () => {
        it('keeps remote image URLs when the conversion renders with remote images enabled',
            async () => {
                // 変換タブは、リモート画像を無効にした表示設定でも、変換用の描画では有効にして画像のURLを保つ。
                const source = '> ![r](https://example.com/a.png)\n';
                const result = await convertPreservingPreview(source, 'markdown', 'mixed', 'textile', 'textile', render);
                expect(result.equal).toBe(true);
                expect(result.text).toContain('https://example.com/a.png');
                expect(result.text).not.toContain('blocked-image');
            });

        it('writes Markdown code blocks as Textile code blocks with the same meaning',
            async () => {
                // 見出し帯（言語名とコピーボタン）の有無は表示上の違いだけなので、HTMLではなく`bc.`で書く。
                const result = await convertPreservingPreview('```js\nx\n```\n', 'markdown', 'mixed', 'textile', 'textile', render);
                expect(result.equal).toBe(true);
                expect(result.text).toBe('bc(js). x\n');
            });

        it.each([
            'sample/textile/core.textile',
            'sample/12-performance-stress.md',
            'sample/marp/test-fixtures/pptx-export.md',
        ])('bounds the number of renders for %s', async (file) => {
            // 描画は、文書全体の比較（最大で照合の上限回）と、候補が複数ある単位ごとの比較（単位の前後で2回ずつ）に限られる。
            let renders = 0;
            /** 描画回数を数える描画関数。 */
            const counting: PreviewBlockRenderer = async (text, format) => {
                renders += 1;
                return render(text, format);
            };
            const source = readFileSync(path.resolve(file), 'utf8');
            const blocks = renderMarkdownUnsafeBlocks(source, { remoteImagesEnabled: true, language: 'ja', renderFormat: file.endsWith('.textile') ? 'textile' : 'mixed' }).length;
            const result = file.endsWith('.textile')
                ? await convertPreservingPreview(source, 'textile', 'textile', 'markdown', 'mixed', counting)
                : await convertPreservingPreview(source, 'markdown', 'mixed', 'textile', 'textile', counting);
            expect(result.cancelled).toBe(false);
            expect(renders).toBeLessThanOrEqual(Math.max(blocks, 25) * 3 + 70);
        });

        it('stops only when the caller cancels and reports the cancellation',
            async () => {
                let renders = 0;
                /** 描画回数を数える描画関数。 */
                const counting: PreviewBlockRenderer = async (text, format) => {
                    renders += 1;
                    return render(text, format);
                };
                const source = '# A\n\ntext\n';
                const result = await convertPreservingPreview(source, 'markdown', 'mixed', 'textile', 'textile', counting, () => true);
                expect(result.cancelled).toBe(true);
                expect(result.text).toBe(source);
                // 中止しても、変換前の描画（比較の基準）は1回だけ行う。
                expect(renders).toBe(1);
            });
    });

describe('convertPreservingPreview with remote images disabled (sixth review findings)',
    () => {
        it('lets the caller detect a preview change under the user setting when remote images are disabled',
            async () => {
                // 変換用の描画はリモート画像を有効にして行う。リモート画像を無効にしている利用者向けに、
                // アプリは利用者の設定でも変換前後を描画して比べる。その比較がここで違いを検出することを確かめる。
                const source = '!{width:50px}http://example.com/a.png!\n';
                const result = await convertPreservingPreview(source, 'textile', 'textile', 'markdown', 'mixed', render);
                /** 利用者の設定（リモート画像を無効）で描画する。 */
                const renderDisabled = (text: string, format: 'textile' | 'mixed') =>
                    renderMarkdownUnsafeBlocks(text, { remoteImagesEnabled: false, language: 'ja', renderFormat: format });
                const underUserSetting = comparePreviewBlocks(renderDisabled(source, 'textile'), renderDisabled(result.text, 'mixed'));
                expect(result.equal && underUserSetting.equal).toBe(false);
            });
    });

/**
 * 文書を順変換し、その結果を逆変換する。
 * @param source - 原文。
 * @param from - 原文の記法。
 * @returns 順変換と逆変換の結果。
 */
async function roundTrip(source: string, from: 'markdown' | 'textile'): Promise<{
    forward: Awaited<ReturnType<typeof convertPreservingPreview>>;
    back: Awaited<ReturnType<typeof convertPreservingPreview>>;
}> {
    const to = from === 'markdown' ? 'textile' : 'markdown';
    const fromFormat = from === 'markdown' ? 'mixed' : 'textile';
    const toFormat = to === 'markdown' ? 'mixed' : 'textile';
    const forward = await convertPreservingPreview(source, from, fromFormat, to, toFormat, render);
    const back = await convertPreservingPreview(forward.text, to, toFormat, from, fromFormat, render);
    return { forward, back };
}

/**
 * 文書の中のHTMLのタグとコメントの数を数える（変換が原文にないHTMLを書き出していないことの確認に使う）。
 * @param text - 文書。
 * @returns タグとコメントの数。
 */
function countHtmlTags(text: string): number {
    return (text.match(/<\/?[A-Za-z][\w-]*[\s>/]|<!--/g) ?? []).length;
}

describe('round trip without recording the original (reverse conversion rules)',
    () => {
        it.each([
            'sample/02-extended-syntax.md',
            'sample/03-images.md',
            'sample/05-code-mermaid.md',
            'sample/06-specification-template.md',
            'sample/08-diagnostics.md',
            'sample/10-image-scroll-stress.md',
            'sample/14-svg-drawio-click.md',
            'sample/mermaid/66-marp-mermaid-gallery.md',
            'sample/textile/mixed.md',
            'sample/textile/edge-cases.textile',
        ])('restores %s to its own syntax with the same preview', async (file) => {
            const source = readFileSync(path.resolve(file), 'utf8');
            const { forward, back } = await roundTrip(source, file.endsWith('.textile') ? 'textile' : 'markdown');
            expect(forward.equal).toBe(true);
            expect(back.equal).toBe(true);
            // 順変換も逆変換も、原文にもともとあったHTML以上のHTMLを書き出さない。
            expect(countHtmlTags(forward.text)).toBeLessThanOrEqual(countHtmlTags(source));
            expect(countHtmlTags(back.text)).toBeLessThanOrEqual(countHtmlTags(source));
        });

        /**
         * 引用の中のリストはTextileで表せない（textile-jsは引用の中にリストを描かない）。HTMLへは変換せず、変換は止めずに適用し、
         * プレビューが変わる行を通知する。逆変換では順変換の規則を逆にたどって原文へ戻ること。
         */
        it('converts a list inside a quote without HTML, reports the line, and restores it',
            async () => {
                const source = '# T\n\n> 引用です。\n>\n> - 引用内のリスト\n> - 2項目目\n\n本文\n';
                const { forward, back } = await roundTrip(source, 'markdown');
                expect(forward.cancelled).toBe(false);
                expect(forward.equal).toBe(false);
                expect(forward.firstDifferenceOffset).toBeDefined();
                expect(forward.text).not.toMatch(/<[a-z]/i);
                expect(back.text).toBe(source);
            });

        /**
         * 同梱サンプル（利用者が書き換えることがある）のうち、Textileで表せない構造（引用の中のリストなど）を含むものも、
         * 変換を止めず、原文にないHTMLを書き出さないこと。
         */
        it.each([
            'sample/01-commonmark-gfm.md',
        ])('converts %s without stopping or adding HTML', async (file) => {
            const source = readFileSync(path.resolve(file), 'utf8');
            const { forward, back } = await roundTrip(source, 'markdown');
            expect(forward.cancelled).toBe(false);
            expect(back.cancelled).toBe(false);
            expect(forward.text).not.toBe(source);
            expect(countHtmlTags(forward.text)).toBeLessThanOrEqual(countHtmlTags(source));
            expect(countHtmlTags(back.text)).toBeLessThanOrEqual(countHtmlTags(source));
        });

        it.each([
            ['Mermaid','# T\n\n```mermaid\ngraph TD\n  A-->B\n```\n'],
            ['code fence with language', '```js\nlet a = 1;\n```\n'],
            ['task list', '- [ ] todo\n- [x] done\n'],
            ['display math', '$$\nx^2\n$$\n'],
            ['inline math', 'inline $x^2$ here\n'],
            ['table of contents', '[TOC]\n\n# A\n'],
            ['page break', 'a\n\n<!-- pagebreak -->\n\nb\n'],
            // Textileの脚注は番号だけを受け付けるため、番号のIDが標準の書き方になる（`[^note]`は往復で`[^1]`になる）。
            ['footnote', 'ref[^1]\n\n[^1]: note text\n'],
            ['highlight and insert', 'これは ==mark== と ++ins++ です。\n'],
            ['autolink', 'see <https://example.com/a?b=1>\n'],
            ['hard line break', 'line one\\\nline two\n'],
            ['heading with explicit id', '# 見出し {#custom-id}\n\nbody\n'],
            ['callout', '> [!NOTE]\n> body\n'],
            ['front matter', '---\ntitle: 文書\n---\n\n# 見出し\n'],
            ['comment', 'a\n\n[//]: # "メモ"\n\nb\n'],
            ['emphasis between Japanese characters', '日本語の**太字**と`code`です。\n'],
            ['raw HTML table', '<table><tr><td><img src="a.png" width="120" alt="a"></td></tr></table>\n'],
        ])('restores the standard Markdown %s exactly', async (name, source) => {
            const { forward, back } = await roundTrip(source, 'markdown');
            expect(forward.equal, name).toBe(true);
            expect(back.equal, name).toBe(true);
            expect(back.text, name).toBe(source);
        });

        it('writes a hard line break as a trailing backslash, not two trailing spaces, when converting Textile back to Markdown',
            async () => {
                // 行末の空白2つは見えず、末尾空白の削除で消えて改行が失われるため、元の文書が空白2つでも`\`で書く。
                const { forward, back } = await roundTrip('line one  \nline two\n', 'markdown');
                expect(forward.equal).toBe(true);
                expect(back.equal).toBe(true);
                expect(back.text).toBe('line one\\\nline two\n');
                expect(back.text).not.toMatch(/ {2}\r?\n/);
            });

        it.each([
            ['a plain paragraph', 'line one\nline two\n', 'line one\\\nline two\n'],
            ['CRLF', 'line one\r\nline two\r\n', 'line one\\\r\nline two\r\n'],
            ['a quote', 'bq. 引用の1行目\n引用の2行目\n', '> 引用の1行目\\\n> 引用の2行目\n'],
            // Textileの行末の空白は意味を持たないが、Markdownでは空白2つが強制改行の印になるため、削って`\`だけにする。
            ['trailing spaces in the Textile source', 'line one  \nline two\n', 'line one\\\nline two\n'],
            // 逆変換は生HTMLだけの行に印を付けず行末の空白2つを削るため、改行が消えて描画比較で退けられ、通常の変換の`\`が選ばれる。
            ['trailing spaces after a raw HTML line', '<span>x</span>  \ny\n', '<span>x</span>\\\ny\n'],
        ])('converts a Textile line break in %s to a trailing backslash, never two trailing spaces', async (_name, source, expected) => {
            // 変換タブと同じ経路（逆変換の候補を先に試す）で、素のTextileを変換する。
            const result = await convertPreservingPreview(source, 'textile', 'textile', 'markdown', 'mixed', render);
            expect(result.equal).toBe(true);
            expect(result.text).toBe(expected);
            expect(result.text).not.toMatch(/ {2}\r?\n/);
        });

        it('keeps a Textile line ending with a backslash and a space as a literal backslash followed by a line break',
            async () => {
                // 空白を削ると`foo\\`（エスケープ済みの`\`）になり改行が消えるため、逆変換モードでも空白を残して`\`を付ける。
                const restored = convertDocumentSyntax('foo\\ \nbar\n', 'textile', 'markdown', { restore: true }).text;
                expect(restored).toBe('foo\\ \\\nbar\n');
                const result = await convertPreservingPreview('foo\\ \nbar\n', 'textile', 'textile', 'markdown', 'mixed', render);
                expect(result.equal).toBe(true);
                expect(result.text).not.toMatch(/ {2}\r?\n/);
            });

        it.each([
            ['alignment', 'p>. right aligned\n'],
            ['definition list', '- term := definition\n'],
            ['table with a spanning cell', '|\\2. span|\n|a|b|\n'],
            ['code with a language', 'bc(ruby). puts 1\n'],
            ['footnote', 'text[1]\n\nfn1. note\n'],
            ['code block with a blank line', 'bc(js).. let a = 1;\n\nlet b = 2;\n\np. after\n'],
            ['language attribute', 'p[zh]. 直角\n'],
            ['quotes and dashes', 'He said "hello" -- and left...\n'],
            ['class link', '"(my-class)Styled":https://example.com/\n'],
            ['comment', 'a\n\n###. note\n\nb\n'],
            ['abbreviation', 'ABC(Desc) x\n'],
            ['citation and span', '??cite?? and %(mark)hl% and %(c)x%\n'],
            ['bracketed phrases', '日本語の[*太字*]と[@code@]です。\n'],
            ['preformatted text with a blank line', 'pre.. a\n\nb\n\np. after\n'],
        ])('restores the standard Textile %s exactly', async (name, source) => {
            const { forward, back } = await roundTrip(source, 'textile');
            expect(forward.equal, name).toBe(true);
            expect(back.equal, name).toBe(true);
            expect(back.text, name).toBe(source);
        });

        it('keeps HTML comments as they are and does not keep resolved reference definitions',
            async () => {
                // HTMLコメントはどちらの記法でも表示されないコメントなので、そのまま残り、往復で元に戻る。
                const comment = 'a\n\n<!-- note -->\n\nb\n';
                const commentTrip = await roundTrip(comment, 'markdown');
                expect(commentTrip.forward.text).toContain('<!-- note -->');
                expect(commentTrip.forward.text).not.toContain('mve-hidden');
                expect(commentTrip.back.text).toBe(comment);
                // 参照リンクの定義は、本文のリンクがインラインの記法へ変換されて意味が保たれるため、原文として残さない。
                const reference = 'see [x][r]\n\n[r]: https://example.com/\n';
                const referenceTrip = await roundTrip(reference, 'markdown');
                expect(referenceTrip.forward.equal).toBe(true);
                expect(referenceTrip.forward.text).not.toContain('mve-hidden');
                expect(referenceTrip.back.text).toBe('see [x](https://example.com/)\n');
            });

        it('compares which footnote each reference points to',
            async () => {
                // 参照と脚注の対応を入れ替えた文書は、番号の書き方を除いても意味が違うので「違う」と判定する。
                const markdown = 'A[^x] B[^y]\n\n[^x]: X\n[^y]: Y\n';
                const swapped = 'A[2] B[1]\n\nfn1. X\n\nfn2. Y\n';
                const same = 'A[1] B[2]\n\nfn1. X\n\nfn2. Y\n';
                const renderBlocks = (text: string, format: 'mixed' | 'textile') => renderMarkdownUnsafeBlocks(text, { remoteImagesEnabled: true, language: 'ja', renderFormat: format });
                expect(comparePreviewBlocks(renderBlocks(markdown, 'mixed'), renderBlocks(swapped, 'textile')).equal).toBe(false);
                expect(comparePreviewBlocks(renderBlocks(markdown, 'mixed'), renderBlocks(same, 'textile')).equal).toBe(true);
            });

        it('keeps CRLF line endings in rules that restore tables and lists',
            async () => {
                const source = '| A | B |\r\n| --- | --- |\r\n| 1 | 2 |\r\n\r\n- [ ] task\r\n- [x] done\r\n';
                const { forward, back } = await roundTrip(source, 'markdown');
                expect(forward.text.replace(/\r\n/g, '')).not.toMatch(/\n/);
                expect(back.text.replace(/\r\n/g, '')).not.toMatch(/\n/);
            });
    });

describe('front matter',
    () => {
        it('compares only the content after the front matter so that content changes are still reported',
            async () => {
                // front matterは変換先で表示されないコメントにするため、比較から除く。本文が同じなら一致、違えば行を返す。
                const source = '---\nmarp: true\n---\n\n# Slide\n\ntext\n';
                const forward = await convertPreservingPreview(source, 'markdown', 'mixed', 'textile', 'textile', render);
                expect(forward.equal).toBe(true);
                const back = await convertPreservingPreview(forward.text, 'textile', 'textile', 'markdown', 'mixed', render);
                expect(back.equal).toBe(true);
                expect(back.text).toBe(source);
            });

        it('converts a paragraph that has both a footnote and a reference link to Textile syntax',
            async () => {
                // 脚注参照と参照リンクが同じ段落にあっても、HTMLではなく同じ意味のTextileの記法にする。
                const source = 'A[^a] see [x][r].\n\n[^a]: note\n\n[r]: https://example.com/\n';
                const result = await convertPreservingPreview(source, 'markdown', 'mixed', 'textile', 'textile', render);
                expect(result.equal).toBe(true);
                expect(result.text).not.toMatch(/<[a-z]/i);
                expect(result.text).toContain('A[1] see "x":https://example.com/.');
                expect(result.text).toContain('fn1. note');
            });

        it('keeps front matter as a Textile comment and restores it when converting back',
            async () => {
                const source = '---\nmarp: true\ntheme: gaia\n---\n\n# Slide\n\ntext\n';
                const forward = await convertPreservingPreview(source, 'markdown', 'mixed', 'textile', 'textile', render);
                expect(forward.text.startsWith('###. ---\nmarp: true\ntheme: gaia\n---\n')).toBe(true);
                expect(forward.text).toContain('h1. Slide');
                // front matterはTextileのプレビューに表示されない。
                expect(renderMarkdownUnsafeBlocks(forward.text, { remoteImagesEnabled: true, language: 'ja', renderFormat: 'textile' }).map((block) => block.html).join('').replace(/<!--[\s\S]*?-->/g, '')).not.toContain('marp');
                const back = await convertPreservingPreview(forward.text, 'textile', 'textile', 'markdown', 'mixed', render);
                expect(back.text).toBe(source);
            });
    });

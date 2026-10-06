/**
 * @fileoverview markdownrenderstages・テストの回帰の仕様と回帰条件を検証する。失敗時は期待値と実装差分を示す。
 */
import { describe, expect, it } from 'vitest';
import { highlightCode } from '../src/webview/codeHighlighter';
import { alignOutlineHeadingIds, renderMarkdownUnsafeBlocks } from '../src/webview/markdownRendererCore';
import {
    collectLocalResourceReferences,
    getOutline,
    headingLineForAnchor,
    sectionMarkdownLink,
    workspaceSectionMarkdownLink
} from '../src/shared/markdown';

/**
 * markdownrenderstages・テストの回帰へ渡す設定または境界値。
 */
const options = { remoteImagesEnabled: false, language: 'ja' as const };

/**
 * markdownrenderstages・テストの回帰のcode・bodiesを処理し、呼び出し側へ結果または副作用を返す。
 * @param html - 表示または出力するHTML本文。
 * @returns markdownrenderstages・テストの回帰で利用する文字列。
 */
function codeBodies(html: string): string[] {
    return Array.from(html.matchAll(/<pre><code\b[^>]*>([\s\S]*?)<\/code><\/pre>/g),
        /**
         * markdownrenderstages・テストの回帰のコールバックとしてmatchを処理する。
         * @param match - markdownrenderstages・テストの回帰へ渡す入力。
         * @returns markdownrenderstages・テストの回帰で利用する文字列。
         */
        (match) => match[1]);
}

/**
 * markdownrenderstages・テストの回帰の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param value - ハイライトspanを含むHTML文字列。
 * @returns markdownrenderstages・テストの回帰で利用する文字列。
 */
function removeHighlightMarkup(value: string): string {
    return value.replace(/<\/?span\b[^>]*>/g, '');
}

describe('staged Markdown rendering',
    /**
     * 「staged Markdown rendering」の仕様と回帰条件を検証するテストケース。
     * @returns テストケースを実行し、値は返さない。
     */
    () => {
        it('copies a readable Markdown link within the current document', () => {
            expect(sectionMarkdownLink('拡張構文', '拡張構文')).toBe('[拡張構文](#拡張構文)');
            expect(sectionMarkdownLink('A [B]', 'a(b)')).toBe('[A \\[B\\]](#a%28b%29)');
            expect(sectionMarkdownLink('名前', 'a b%')).toBe('[名前](#a%20b%25)');
            expect(sectionMarkdownLink('名前', 'a&copy;')).toBe('[名前](#a%26copy;)');
            expect(sectionMarkdownLink('A|B', 'a|b')).toBe('[A\\|B](#a%7Cb)');
            const markdown = '# 拡張構文\n\n' + sectionMarkdownLink('拡張構文', '拡張構文');
            const html = renderMarkdownUnsafeBlocks(markdown, options).map((block) => block.html).join('');
            expect(html).toContain('<h1 id="拡張構文" data-mve-heading="true">');
            expect(html).toContain('<a href="#拡張構文">拡張構文</a>');
        });

        it('copies a workspace-rooted link that resolves from another Markdown file', () => {
            const link = workspaceSectionMarkdownLink('拡張構文', '拡張構文', 'guides/extended syntax.md');
            expect(link).toBe('[拡張構文](/guides/extended%20syntax.md#拡張構文 "MVE workspace-root link")');
            const html = renderMarkdownUnsafeBlocks(link, options).map((block) => block.html).join('');
            expect(html).toContain('<a href="#" data-mve-link="/guides/extended%20syntax.md#拡張構文" data-mve-workspace-rooted="true">拡張構文</a>');
            expect(collectLocalResourceReferences(link)).toEqual([
                {
                    kind: 'link',
                    source: '/guides/extended%20syntax.md#拡張構文',
                    workspaceRooted: true,
                    line: 1
                }
            ]);
        });

        it('keeps the copied link label as literal heading text', () => {
            for (const [text, expectedHtml] of [
                ['<em>', '&lt;em&gt;'],
                ['A ` B `', 'A ` B `'],
                ['&copy;', '&amp;copy;'],
                ['A|B', 'A|B'],
                ['*bold*', '*bold*'],
                ['==mark==', '==mark=='],
                ['++insert++', '++insert++'],
                ['^sup^', '^sup^'],
                ['~sub~', '~sub~'],
                ['$math$', '$math$']
            ] as const) {
                const html = renderMarkdownUnsafeBlocks(sectionMarkdownLink(text, 'target'), options)
                    .map((block) => block.html).join('');
                expect(html).toContain(`<a href="#target">${expectedHtml}</a>`);
            }
            const table = '| Cell |\n| --- |\n| ' + sectionMarkdownLink('A|B', 'a|b') + ' |';
            const tableHtml = renderMarkdownUnsafeBlocks(table, options).map((block) => block.html).join('');
            expect(tableHtml).toContain('<a href="#a%7Cb">A|B</a>');
        });

        it('keeps preview heading IDs aligned with outline links for repeated and explicit headings', () => {
            const markdown = '# 概要\n## 詳細\n## 詳細\n## Named {#custom-id}';
            const blocks = renderMarkdownUnsafeBlocks(markdown, options);
            const html = blocks.map((block) => block.html).join('');
            const headingIds = Array.from(html.matchAll(/<h[1-6] id="([^"]+)"/g), (match) => match[1]);
            expect(headingIds).toEqual(alignOutlineHeadingIds(getOutline(markdown), blocks).map((item) => item.id));
        });

        it('resolves a repeated ATX heading after a Setext heading', () => {
            const markdown = 'A\n=\n\n# A\n\n## 123\n## Named {#a.b}';
            const blocks = renderMarkdownUnsafeBlocks(markdown, options);
            const outline = alignOutlineHeadingIds(getOutline(markdown), blocks);
            expect(outline.map((item) => item.id)).toEqual(['a-1', '123', 'a.b']);
            expect(headingLineForAnchor(markdown, 'a-1')).toBe(4);
            expect(headingLineForAnchor(markdown, '123')).toBe(6);
            expect(headingLineForAnchor(markdown, 'a.b')).toBe(7);
        });

        it('assigns unique IDs when generated suffixes collide with heading text or explicit IDs', () => {
            const markdown = '# A\n# A\n# A-1\n# Named {#a-1}\n# A';
            const blocks = renderMarkdownUnsafeBlocks(markdown, options);
            const html = blocks.map((block) => block.html).join('');
            const ids = Array.from(html.matchAll(/<h[1-6] id="([^"]+)"/g), (match) => match[1]);
            expect(ids).toEqual(['a', 'a-1', 'a-1-1', 'a-1-2', 'a-2']);
            expect(alignOutlineHeadingIds(getOutline(markdown), blocks).map((item) => item.id)).toEqual(ids);
            for (const [index, id] of ids.entries()) {
                expect(headingLineForAnchor(markdown, id)).toBe(index + 1);
            }
        });

        it('locates a heading after matching text in code and prose', () => {
            expect(headingLineForAnchor('```md\n# A\n```\n\n# A', 'a')).toBe(5);
            expect(headingLineForAnchor('Text mentions # A here.\n\n# A', 'a')).toBe(3);
            expect(headingLineForAnchor('> # A\n\n# A', 'a-1')).toBe(3);
            expect(headingLineForAnchor('> A\n> ===\n\n# A', 'a-1')).toBe(4);
            expect(headingLineForAnchor('# A\r\n\r\n# A', 'a-1')).toBe(3);
        });

        it('locates nested headings after matching prose and code', () => {
            expect(headingLineForAnchor('> Text mentions # A\n> # A', 'a')).toBe(2);
            expect(headingLineForAnchor('- Text mentions # A\n  # A', 'a')).toBe(2);
            expect(headingLineForAnchor('> ```md\n> # A\n> ```\n> # A', 'a')).toBe(4);
            expect(headingLineForAnchor('- [x] task\n  # A', 'a')).toBe(2);
            expect(headingLineForAnchor('- first\n\n  # A\n\n- second\n  # B', 'b')).toBe(6);
            expect(headingLineForAnchor('> > Intro\n> > # A', 'a')).toBe(2);
        });

        it('ignores headings inside custom block syntax when resolving links', () => {
            for (const [markdown, line] of [
                ['$$\n# A\n$$\n\n# A', 5],
                ['[^x]:\n  # A\n\n# A', 4]
            ] as const) {
                const blocks = renderMarkdownUnsafeBlocks(markdown, options);
                const html = blocks.map((block) => block.html).join('');
                expect(Array.from(html.matchAll(/data-mve-heading="true"/g))).toHaveLength(1);
                expect(alignOutlineHeadingIds(getOutline(markdown), blocks)
                    .map((item) => item.id)).toEqual(['a']);
                expect(headingLineForAnchor(markdown, 'a')).toBe(line);
            }
        });

        it('keeps code text and document structure identical between preliminary and rich rendering',
            /**
             * 「keeps code text and document structure identical between preliminary and rich rendering」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const markdown = [
                    '# Heading',
                    '',
                    '```typescript',
                    'const escaped = "<script>";',
                    '```',
                    '',
                    '```unknown-language',
                    '<tag>& value',
                    '```',
                    '',
                    '```mermaid',
                    'graph TD',
                    '  A --> B',
                    '```',
                ].join('\n');

                const preliminary = renderMarkdownUnsafeBlocks(markdown, options);
                const rich = renderMarkdownUnsafeBlocks(markdown, options, highlightCode);
                const preliminaryHtml = preliminary.map(
                    /**
                     * 各blockからhtmlを取り出して一覧化する。
                     * @param block - blockのhtmlを参照する走査対象。
                     * @returns htmlを取り出した変換結果の一覧。
                     */
                    (block) => block.html).join('');
                const richHtml = rich.map(
                    /**
                     * 各blockからhtmlを取り出して一覧化する。
                     * @param block - blockのhtmlを参照する走査対象。
                     * @returns htmlを取り出した変換結果の一覧。
                     */
                    (block) => block.html).join('');

                expect(rich).toHaveLength(preliminary.length);
                expect(codeBodies(richHtml).map(removeHighlightMarkup)).toEqual(codeBodies(preliminaryHtml));
                expect(richHtml).toContain('class="hljs-keyword">const</span>');
                expect(preliminaryHtml).not.toContain('class="hljs-keyword"');
                expect(richHtml).toContain('&lt;tag&gt;&amp; value');
                expect(richHtml).toContain('class="diagram-block mermaid"');
            });

        it('falls back to escaped plain code for unsupported explicit languages',
            /**
             * 「falls back to escaped plain code for unsupported explicit languages」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const markdown = '```not-a-real-language\n<script>& value\n```';
                const richHtml = renderMarkdownUnsafeBlocks(markdown, options, highlightCode)
                    .map(
                        /**
                         * 各blockからhtmlを取り出して一覧化する。
                         * @param block - blockのhtmlを参照する走査対象。
                         * @returns htmlを取り出した変換結果の一覧。
                         */
                        (block) => block.html)
                    .join('');

                expect(richHtml).toContain('&lt;script&gt;&amp; value');
                expect(richHtml).not.toMatch(/<code[^>]*>\s*<span/);
            });
    });

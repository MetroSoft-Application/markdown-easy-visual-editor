/**
 * @fileoverview markdownrenderstages・テストの回帰の仕様と回帰条件を検証する。失敗時は期待値と実装差分を示す。
 */
import { describe, expect, it } from 'vitest';
import { highlightCode } from '../src/webview/codeHighlighter';
import { renderMarkdownUnsafeBlocks } from '../src/webview/markdownRendererCore';

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
 * @param value - 検証・変換・保存の対象となる値。
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

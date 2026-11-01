/**
 * @fileoverview 軽量Worker（ハイライトなし）とrich Worker（highlight.js）の描画結果の同一性を固定する回帰テスト。
 * 実行境界: Vitest（Node）。Webviewの2段階描画で、コードハイライト関数が一度も呼ばれない文書なら
 * 軽量描画の結果をそのまま最終結果として扱える、という起動高速化の前提（rich パス省略）を全サンプルで検証する。
 * 不変条件: ハイライト関数が undefined を返したときの出力は、ハイライト関数を渡さないときの出力とバイト一致する。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { highlightCode } from '../src/webview/markdown/codeHighlighter';
import {
    getOutlineForFormat,
    renderMarkdownUnsafeBlocks,
    type CodeHighlighter,
    type MarkdownRenderFormat,
    type RenderOptions
} from '../src/webview/markdown/markdownRendererCore';
import { listTrackedSampleDocuments, renderFormatsFor } from './sampleDocuments';

/**
 * 描画結果を比較用の1つの文字列にまとめる。
 * @param markdown - 描画した本文。
 * @param options - 描画設定。
 * @param highlighter - コードハイライト関数。undefinedなら軽量描画。
 * @returns ブロックHTML・ソース範囲・アウトラインを含むJSON文字列。
 */
function renderSnapshot(markdown: string, options: RenderOptions, highlighter?: CodeHighlighter): string {
    const blocks = renderMarkdownUnsafeBlocks(markdown, options, highlighter);
    const outline = getOutlineForFormat(markdown, options.renderFormat ?? 'markdown', blocks);
    return JSON.stringify({ blocks, outline });
}

/**
 * 呼び出しの有無だけを記録し、常に undefined（ハイライト不可）を返すプローブを作る。
 * @returns プローブ関数と、呼び出し回数を返す関数。
 */
function createProbe(): { probe: CodeHighlighter; calls: () => number } {
    let count = 0;
    return {
        probe: () => {
            count += 1;
            return undefined;
        },
        calls: () => count
    };
}

/**
 * 同梱サンプル以外で境界になる最小文書。コードフェンスの有無・種類ごとにプローブ判定が正しいかを確認する。
 */
const edgeCases: Array<{ name: string; markdown: string; format: MarkdownRenderFormat; highlighted: boolean }> = [
    { name: 'no code', markdown: '# Title\n\nText with `inline code`.\n', format: 'markdown', highlighted: false },
    { name: 'mermaid only', markdown: '```mermaid\nflowchart TD\n  A --> B\n```\n', format: 'markdown', highlighted: false },
    { name: 'indented code', markdown: 'Text\n\n    indented code\n', format: 'markdown', highlighted: true },
    { name: 'untagged fence', markdown: '```\nplain\n```\n', format: 'markdown', highlighted: true },
    { name: 'unknown language', markdown: '```not-a-language\nx\n```\n', format: 'markdown', highlighted: true },
    { name: 'tilde fence', markdown: '~~~ts\nconst a = 1;\n~~~\n', format: 'markdown', highlighted: true },
    { name: 'mixed html pre', markdown: '<pre><code class="language-js">let a = 1;</code></pre>\n\nh2. Textile\n', format: 'mixed', highlighted: true },
    { name: 'textile code with language class', markdown: '<pre><code class="ruby">puts 1</code></pre>\n', format: 'textile', highlighted: true },
    { name: 'textile bc without language', markdown: 'bc. puts "Textile code"\n', format: 'textile', highlighted: false },
    { name: 'textile no code', markdown: 'h1. Title\n\np. Text\n', format: 'textile', highlighted: false }
];

describe('staged rendering parity (light vs rich)',
    () => {
        const documents = listTrackedSampleDocuments();

        it('finds the bundled sample documents', () => {
            expect(documents.length).toBeGreaterThanOrEqual(50);
        });

        for (const file of documents) {
            const markdown = readFileSync(file, 'utf8');
            for (const renderFormat of renderFormatsFor(file)) {
                it(`${file} [${renderFormat}]`, () => {
                    const options: RenderOptions = { remoteImagesEnabled: false, language: 'ja', renderFormat };
                    const light = renderSnapshot(markdown, options);
                    const { probe, calls } = createProbe();
                    // プローブが undefined を返す描画は、ハイライト関数なしの描画と完全一致しなければならない。
                    expect(renderSnapshot(markdown, options, probe)).toBe(light);
                    if (calls() === 0) {
                        // プローブが呼ばれない文書では rich 描画も軽量描画と完全一致し、rich パスを省略できる。
                        expect(renderSnapshot(markdown, options, highlightCode)).toBe(light);
                    }
                });
            }
        }

        for (const testCase of edgeCases) {
            it(`detects whether highlighting is needed: ${testCase.name}`, () => {
                const options: RenderOptions = { remoteImagesEnabled: false, language: 'ja', renderFormat: testCase.format };
                const light = renderSnapshot(testCase.markdown, options);
                const { probe, calls } = createProbe();
                expect(renderSnapshot(testCase.markdown, options, probe)).toBe(light);
                expect(calls() > 0).toBe(testCase.highlighted);
                if (!testCase.highlighted) {
                    expect(renderSnapshot(testCase.markdown, options, highlightCode)).toBe(light);
                }
            });
        }
    });

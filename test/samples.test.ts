/**
 * @fileoverview 同梱Markdownサンプルの一覧、分割時の内容保持、画像素材と診断用文書の存在を検証する。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectDiagnostics, getOutline, splitMarkdownBlocks } from '../src/shared/markdown';

/**
 * 同梱Markdownサンプルを読む固定ディレクトリです。
 */
const sampleRoot = path.resolve('sample');
/**
 * 検証対象として選ばれたMarkdownサンプルのパス一覧です。
 */
const sampleFiles = readdirSync(sampleRoot)
    // sample/ は手元の検証用ファイルも置けるため、製品の回帰fixtureだけを対象にする。
    .filter(
        /**
         * 固定名または番号付きのMarkdownサンプルだけを残す。
         * @param name - sampleRoot直下で見つかったエントリ名。
         * @returns 対象に含めるファイルならtrue。
         */
        (name) => /^(?:\d{2}-.+|outline-reorder-undo|README)\.md$/.test(name))
    .map(
        /**
         * サンプル名をsampleRootからの絶対パスに変換する。
         * @param name - 検証対象に選ばれたMarkdownファイル名。
         * @returns sampleRootを基準にしたファイルパス。
         */
        (name) => path.join(sampleRoot, name));

describe('sample Markdown documents',
    () => {
        it('contains the expected regression documents',
            () => {
                expect(sampleFiles.length).toBeGreaterThanOrEqual(8);
            });

        for (const file of sampleFiles) {
            const name = path.basename(file);
            it(`${name} can be split without losing bytes`,
                () => {
                    const markdown = readFileSync(file, 'utf8');
                    expect(splitMarkdownBlocks(markdown).map(
                        /**
                         * 各blockからrawを取り出して一覧化する。
                         * @param block - blockのrawを参照する走査対象。
                         * @returns rawを取り出した変換結果の一覧。
                         */
                        (block) => block.raw).join('')).toBe(markdown);
                    expect(getOutline(markdown).length).toBeGreaterThan(0);
                });
        }

        it('contains a valid local image fixture',
            () => {
                const image = path.join(sampleRoot, 'assets', 'local-sample.svg');
                expect(statSync(image).isFile()).toBe(true);
                expect(readFileSync(image, 'utf8')).toContain('<svg');
            });

        it('contains a dedicated diagnostics verification document',
            () => {
                const markdown = readFileSync(path.join(sampleRoot, '08-diagnostics.md'), 'utf8');
                const codes = new Set(collectDiagnostics(markdown).map(
                    /**
                     * 各項目からコードを取り出して一覧化する。
                     * @param item - 項目のコードを参照する走査対象。
                     * @returns コードを取り出した変換結果の一覧。
                     */
                    (item) => item.code));
                expect(codes).toEqual(new Set([
                    'broken-reference-link',
                    'duplicate-heading',
                    'empty-image-alt',
                    'empty-table-header',
                    'invalid-table-separator',
                    'local-image',
                    'table-column-mismatch',
                    'unclosed-fence'
                ]));
            });
    });

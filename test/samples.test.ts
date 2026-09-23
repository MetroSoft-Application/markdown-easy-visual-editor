/**
 * @fileoverview samples・テストの回帰の仕様と回帰条件を検証する。失敗時は期待値と実装差分を示す。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectDiagnostics, getOutline, splitMarkdownBlocks } from '../src/shared/markdown';

/**
 * samples・テストの回帰で一時生成物または検証対象を置くディレクトリ。
 */
const sampleRoot = path.resolve('sample');
/**
 * samples・テストの回帰で読み書きするリソースの場所。
 */
const sampleFiles = readdirSync(sampleRoot)
    // sample/ は手元の検証用ファイルも置けるため、製品の回帰fixtureだけを対象にする。
    .filter(
        /**
         * 条件を満たすnameだけを残す。
         * @param name - samples・テストの回帰の対象や分岐を識別する値。
         * @returns 条件を満たした要素だけを含む一覧。
         */
        (name) => /^(?:\d{2}-.+|outline-reorder-undo|README)\.md$/.test(name))
    .map(
        /**
         * 各nameをjoinへ渡し、変換結果を一覧化する。
         * @param name - samples・テストの回帰の対象や分岐を識別する値。
         * @returns 入力要素から生成した変換結果の一覧。
         */
        (name) => path.join(sampleRoot, name));

describe('sample Markdown documents',
    /**
     * 「sample Markdown documents」の仕様と回帰条件を検証するテストケース。
     * @returns テストケースを実行し、値は返さない。
     */
    () => {
        it('contains the expected regression documents',
            /**
             * 「contains the expected regression documents」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(sampleFiles.length).toBeGreaterThanOrEqual(8);
            });

        for (const file of sampleFiles) {
            const name = path.basename(file);
            it(`${name} can be split without losing bytes`,
                /**
                 * 「${name} can be split without losing bytes」の仕様と回帰条件を検証するテストケース。
                 * @returns テストケースを実行し、値は返さない。
                 */
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
            /**
             * 「contains a valid local image fixture」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const image = path.join(sampleRoot, 'assets', 'local-sample.svg');
                expect(statSync(image).isFile()).toBe(true);
                expect(readFileSync(image, 'utf8')).toContain('<svg');
            });

        it('contains a dedicated diagnostics verification document',
            /**
             * 「contains a dedicated diagnostics verification document」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
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

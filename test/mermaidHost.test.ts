/**
 * @fileoverview mermaidhost・テストの回帰の仕様と回帰条件を検証する。失敗時は期待値と実装差分を示す。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { closeMermaidRenderer, renderMermaidInBrowser } from '../src/extension/mermaid';

/**
 * mermaidhost・テストの回帰で読み書きするリソースの場所。
 */
const executablePath = findFile(path.resolve('.chromium'), 'chrome-headless-shell.exe');
/**
 * mermaidhost・テストの回帰の位置・寸法・件数・時間を表す数値。
 */
const describeWithBrowser = executablePath ? describe : describe.skip;

describeWithBrowser('別プロセスMermaidレンダラー',
    /**
     * 要素をbefore・allへ渡し、mermaidhost・テストの回帰の結果または副作用を処理する。
     * @returns mermaidhost・テストの回帰のコールバックが生成する結果。
     */
    () => {
        let browser: Browser;

        beforeAll(
            /**
             * mermaidhost・テストの回帰の前提条件を準備し、回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            async () => {
                browser = await chromium.launch({ executablePath, headless: true });
            });

        afterAll(
            /**
             * mermaidhost・テストの回帰の前提条件を準備し、回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            async () => {
                await closeMermaidRenderer();
                await browser.close();
            });

        it('大規模図をSVGと軽量インタラクション情報へ変換する',
            /**
             * 「大規模図をSVGと軽量インタラクション情報へ変換する」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            async () => {
                const markdown = readFileSync(path.resolve('sample/11-performance-stress.md'), 'utf8');
                const source = /```mermaid\s*\n([\s\S]*?)```/.exec(markdown)?.[1];
                expect(source).toBeTruthy();

                const result = await renderMermaidInBrowser(
                    source!,
                    'default',
                    path.resolve('node_modules/mermaid/dist/mermaid.min.js'),

                    /**
                     * 要素を成功結果通知へ渡し、mermaidhost・テストの回帰の結果または副作用を処理する。
                     * @returns mermaidhost・テストの回帰の非同期処理で得られる結果。
                     */
                    () => Promise.resolve(browser)
                );

                expect(result.svg).toContain('<svg');
                expect(result.svg.length).toBeGreaterThan(100_000);
                expect(result.pngBase64).toBeTruthy();
                expect(Buffer.from(result.pngBase64!, 'base64').subarray(0, 8)).toEqual(
                    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
                );
                expect(result.interactions.filter(
                    /**
                     * 種別「text」の項目だけを残す。
                     * @param item - 項目のtypeを参照する走査対象。
                     * @returns 条件を満たした要素だけを含む一覧。
                     */
                    (item) => item.type === 'text').length).toBeGreaterThan(50);
                expect(result.interactions.every(
                    /**
                     * mermaidhost・テストの回帰のコールバックとして項目を処理する。
                     * @param item - mermaidhost・テストの回帰で走査または更新する要素。
                     * @returns mermaidhost・テストの回帰のコールバックが生成する結果。
                     */
                    (item) => item.width > 0 && item.height > 0)).toBe(true);
            }, 30_000);

        it('drops cancelled queued revisions instead of rendering an ever-growing backlog',
            /**
             * 「drops cancelled queued revisions instead of rendering an ever-growing backlog」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            async () => {
                const markdown = readFileSync(path.resolve('sample/11-performance-stress.md'), 'utf8');
                const source = /```mermaid\s*\n([\s\S]*?)```/.exec(markdown)?.[1];
                expect(source).toBeTruthy();
                const runtimePath = path.resolve('node_modules/mermaid/dist/mermaid.min.js');


                const acquireBrowser = /**
     * mermaidhost・テストの回帰のacquire・browserを処理し、呼び出し側へ結果または副作用を返す。
     * @returns mermaidhost・テストの回帰の非同期処理で得られる結果。
     */ () => Promise.resolve(browser);

                const active = renderMermaidInBrowser(
                    source!.replace('A01 request', 'A01 active revision'),
                    'default',
                    runtimePath,
                    acquireBrowser
                );
                const cancelled = Array.from({ length: 16 },
                    /**
                     * ・をabort・controllerへ渡し、mermaidhost・テストの回帰の結果または副作用を処理する。
                     * @param _ - 引数位置を維持するための未使用値。
                     * @param index - 配列・行列・文字列の要素位置を示す番号。
                     * @returns 副作用を完了し、値は返さない。
                     */
                    (_, index) => {
                        const controller = new AbortController();
                        const result = renderMermaidInBrowser(
                            source!.replace('A01 request', `A01 cancelled revision ${index}`),
                            'default',
                            runtimePath,
                            acquireBrowser,
                            controller.signal
                        );
                        controller.abort();
                        return result;
                    });

                const cancelledResults = await Promise.allSettled(cancelled);
                expect(cancelledResults.every(
                    /**
                     * resultをtestへ渡し、mermaidhost・テストの回帰の結果または副作用を処理する。
                     * @param result - mermaidhost・テストの回帰へ渡す入力。
                     * @returns 副作用を完了し、値は返さない。
                     */
                    (result) => (
                        result.status === 'rejected' && /cancel/i.test(String(result.reason))
                    ))).toBe(true);
                await active;

                const startedAt = performance.now();
                const final = await renderMermaidInBrowser(
                    'flowchart LR\n  A[latest] --> B[rendered]',
                    'default',
                    runtimePath,
                    acquireBrowser
                );
                expect(final.svg).toContain('latest');
                expect(performance.now() - startedAt).toBeLessThan(2_000);
            }, 30_000);
    });

/**
 * 指定した名前のファイルを検証用ディレクトリから再帰的に探す。
 * @param root - mermaidhost・テストの回帰で受け渡す文字列。
 * @param name - mermaidhost・テストの回帰の対象や分岐を識別する値。
 * @returns 条件に一致する値。未検出時はundefinedまたはnull。
 */
function findFile(root: string, name: string): string | undefined {
    if (!existsSync(root)) return undefined;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const candidate = path.join(root, entry.name);
        if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return candidate;
        if (entry.isDirectory()) {
            const nested = findFile(candidate, name);
            if (nested) return nested;
        }
    }
    return undefined;
}

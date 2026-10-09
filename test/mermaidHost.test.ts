/**
 * @fileoverview Extension Host側のMermaid描画キュー、キャンセル、大規模図の変換とブラウザー資源解放を検証する。
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
 * Chromium実行ファイルがある場合に使うテストスイート関数です。
 */
const describeWithBrowser = executablePath ? describe : describe.skip;

describeWithBrowser('別プロセスMermaidレンダラー',

    () => {
        let browser: Browser;

        beforeAll(
            /**
             * mermaidhost・テストの回帰の前提条件を準備し、回帰条件を検証するテストケース。
             */
            async () => {
                browser = await chromium.launch({ executablePath, headless: true });
            });

        afterAll(
            /**
             * mermaidhost・テストの回帰の前提条件を準備し、回帰条件を検証するテストケース。
             */
            async () => {
                await closeMermaidRenderer();
                await browser.close();
            });

        it('大規模図をSVGと軽量インタラクション情報へ変換する',
            async () => {
                const markdown = readFileSync(path.resolve('sample/11-performance-stress.md'), 'utf8');
                const source = /```mermaid\s*\n([\s\S]*?)```/.exec(markdown)?.[1];
                expect(source).toBeTruthy();

                const result = await renderMermaidInBrowser(
                    source!,
                    'default',
                    path.resolve('node_modules/mermaid/dist/mermaid.min.js'),

                    /**
                     * @returns テスト用のPlaywright Browserを解決するPromise。
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

                     */
                    (item) => item.type === 'text').length).toBeGreaterThan(50);
                expect(result.interactions.every(
                    /**

                     * @param item - mermaidhost・テストの回帰で走査または更新する要素。
                     */
                    (item) => item.width > 0 && item.height > 0)).toBe(true);
            }, 30_000);

        it('drops cancelled queued revisions instead of rendering an ever-growing backlog',
            async () => {
                const markdown = readFileSync(path.resolve('sample/11-performance-stress.md'), 'utf8');
                const source = /```mermaid\s*\n([\s\S]*?)```/.exec(markdown)?.[1];
                expect(source).toBeTruthy();
                const runtimePath = path.resolve('node_modules/mermaid/dist/mermaid.min.js');


                const acquireBrowser = /**
     * @returns テスト用のPlaywright Browserを解決するPromise。
     */ () => Promise.resolve(browser);

                const active = renderMermaidInBrowser(
                    source!.replace('A01 request', 'A01 active revision'),
                    'default',
                    runtimePath,
                    acquireBrowser
                );
                const cancelled = Array.from({ length: 16 },

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
                     * @param result - mermaidhost・テストの回帰へ渡す入力。
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
 * @param root - ファイルを再帰検索する起点ディレクトリ。
 * @param name - 起点ディレクトリ以下から探すファイル名。大文字小文字は区別しません。
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

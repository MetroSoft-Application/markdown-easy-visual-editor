/**
 * @file mermaidHost.test.ts
 * 実行境界: テスト実行環境。
 * 責務: 現行実装の仕様と回帰条件を検証する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テスト用のモック、ブラウザー、ファイルを必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { closeMermaidRenderer, renderMermaidInBrowser } from '../src/extension/mermaid';

/** 「executablePath」は、対象ファイルまたは実行環境の場所を表す値です。 */
const executablePath = findFile(path.resolve('.chromium'), 'chrome-headless-shell.exe');
/** 「describeWithBrowser」は、ブラウザー処理の共有状態または実行設定です。 */
const describeWithBrowser = executablePath ? describe : describe.skip;

describeWithBrowser('別プロセスMermaidレンダラー',
/**
 * 登録された副作用または結果を生成する処理を実行するコールバックです。
 * @returns 「beforeAll」を実行し、値を返しません。
 */
() => {
  let browser: Browser;

  beforeAll(
  /**
   * 「async」として関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @returns 「chromium.launch」を実行し、値を返しません。
   */
  async () => {
    browser = await chromium.launch({ executablePath, headless: true });
  });

  afterAll(
  /**
   * 「async」として関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @returns 「closeMermaidRenderer」を実行し、値を返しません。
   */
  async () => {
    await closeMermaidRenderer();
    await browser.close();
  });

  it('大規模図をSVGと軽量インタラクション情報へ変換する',
  /**
   * 「async」として関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
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
 * テスト「大規模図をSVGと軽量インタラクション情報へ変換する」の前提条件を設定し、期待結果を検証するコールバックです。
       * @returns テストの前提条件と期待結果を検証し、値を返しません。
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
 * 「item」が条件に一致するか判定し、残す要素を決めるコールバックです。
     * @param item 条件判定の対象となる要素です。
     * @returns 要素を採用するかどうかの真偽値を返します。
     */
    (item) => item.type === 'text').length).toBeGreaterThan(50);
    expect(result.interactions.every(
    /**
 * 「item」が条件を満たすか判定し、全要素の適合結果を返すコールバックです。
     * @param item 条件判定の対象となる要素です。
     * @returns 要素を採用するかどうかの真偽値を返します。
     */
    (item) => item.width > 0 && item.height > 0)).toBe(true);
  }, 30_000);

  it('drops cancelled queued revisions instead of rendering an ever-growing backlog',
  /**
   * 「async」として関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @returns 置換後の文字列を返します。
   */
  async () => {
    const markdown = readFileSync(path.resolve('sample/11-performance-stress.md'), 'utf8');
    const source = /```mermaid\s*\n([\s\S]*?)```/.exec(markdown)?.[1];
    expect(source).toBeTruthy();
    const runtimePath = path.resolve('node_modules/mermaid/dist/mermaid.min.js');

    /**
     * ブラウザーを取得または解決します。
     * @returns 「acquireBrowser」がMermaid描画の入力を処理して得た固有の結果を返します。
     */
    const acquireBrowser = /**
 * 「acquireBrowser」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @returns 「acquireBrowser」がMermaid描画の入力を処理して得た固有の結果を返します。
 */ () => Promise.resolve(browser);

    const active = renderMermaidInBrowser(
      source!.replace('A01 request', 'A01 active revision'),
      'default',
      runtimePath,
      acquireBrowser
    );
    const cancelled = Array.from({ length: 16 },
    /**
 * 「_」「index」を受け取り、入力文字列を置換して変換する処理です。
     * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
     * @param index 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 置換後の文字列を返します。
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
 * 「result」が条件を満たすか判定し、全要素の適合結果を返すコールバックです。
     * @param result 処理対象の結果です。
     * @returns 条件判定の結果を示す真偽値を返します。
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
 * ファイルを取得または解決します。
 * @param root 処理対象のルートです。
 * @param name 対象を識別する名前で、表示または処理分岐に使用します。
 * @returns 「findFile」が生成または変換したMermaidの文字列を返します。
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

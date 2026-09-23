/**
 * @file exportHtml.test.ts
 * 実行境界: テスト実行環境。
 * 責務: 現行実装の仕様と回帰条件を検証する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テスト用のモック、ブラウザー、ファイルを必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { describe, expect, it } from 'vitest';
import { prepareExportHtml } from '../src/shared/exportHtml';

describe('prepareExportHtml',
/**
 * テスト「prepareExportHtml」の前提条件を設定し、期待結果を検証するコールバックです。
 * @returns テストの前提条件と期待結果を検証し、値を返しません。
 */
() => {
  it('expands deferred Mermaid markup and keeps vector SVG in exported HTML',
  /**
 * テスト「expands deferred Mermaid markup and keeps vector SVG in exported HTML」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const svg = '<svg viewBox="0 0 10 10"><text>diagram</text></svg>';
    const html = `<div class="mermaid-block" data-mve-export-svg="${encodeURIComponent(svg)}"></div>`;

    const result = prepareExportHtml(html);

    expect(result).toContain(svg);
    expect(result).not.toContain('data-mve-export-svg');
  });

  it('forces lazy preview images to load in export documents',
  /**
 * テスト「forces lazy preview images to load in export documents」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(prepareExportHtml('<img src="a.png" loading="lazy"><img loading=\'lazy\' src="b.png">'))
      .toBe('<img src="a.png" loading="eager"><img loading="eager" src="b.png">');
  });

  it('does not leak malformed deferred SVG payloads into output',
  /**
 * テスト「does not leak malformed deferred SVG payloads into output」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const result = prepareExportHtml('<div class="mermaid-block" data-mve-export-svg="%E0%A4%A"></div>');

    expect(result).toBe('<div class="mermaid-block"></div>');
  });
});

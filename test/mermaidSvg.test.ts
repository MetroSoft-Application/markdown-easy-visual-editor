/**
 * @file mermaidSvg.test.ts
 * 実行境界: テスト実行環境。
 * 責務: 現行実装の仕様と回帰条件を検証する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テスト用のモック、ブラウザー、ファイルを必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { describe, expect, it } from 'vitest';
import { namespaceMermaidSvg } from '../src/shared/mermaidSvg';

describe('namespaceMermaidSvg',
/**
 * テスト「namespaceMermaidSvg」の前提条件を設定し、期待結果を検証するコールバックです。
 * @returns テストの前提条件と期待結果を検証し、値を返しません。
 */
() => {
  it('SVG内のIDと全参照を出現単位で名前空間化する',
  /**
 * テスト「SVG内のIDと全参照を出現単位で名前空間化する」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const svg = `<svg id="root" aria-labelledby="title description">
      <title id="title">図</title><desc id="description">説明</desc>
      <style>#node { clip-path: url(#clip); }</style>
      <defs><clipPath id="clip"></clipPath><marker id="arrow"></marker></defs>
      <g id="node" marker-end="url(#arrow)"><a href="#node"><path /></a></g>
    </svg>`;
    const first = namespaceMermaidSvg(svg, 'first');
    const second = namespaceMermaidSvg(svg, 'second');

    expect(first).toContain('id="first-root"');
    expect(first).toContain('aria-labelledby="first-title first-description"');
    expect(first).toContain('url(#first-clip)');
    expect(first).toContain('href="#first-node"');
    expect(first).not.toContain('id="second-root"');
    expect(second).toContain('id="second-root"');
  });
});

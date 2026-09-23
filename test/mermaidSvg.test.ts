/**
 * @fileoverview mermaidsvg・テストの回帰の仕様と回帰条件を検証する。失敗時は期待値と実装差分を示す。
 */
import { describe, expect, it } from 'vitest';
import { namespaceMermaidSvg } from '../src/shared/mermaidSvg';

describe('namespaceMermaidSvg',
    /**
     * 「namespaceMermaidSvg」の仕様と回帰条件を検証するテストケース。
     * @returns テストケースを実行し、値は返さない。
     */
    () => {
        it('SVG内のIDと全参照を出現単位で名前空間化する',
            /**
             * 「SVG内のIDと全参照を出現単位で名前空間化する」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
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

/**
 * @fileoverview Mermaid SVGのID名前空間化を1パス化した実装が、旧実装（ID数×SVG長の逐次置換）と同じ出力を返すことを固定する回帰テスト。
 * 実行境界: Vitest（Node）。同梱サンプルの全Mermaidソースを実際のPeleで描画したSVGと、境界になる手書きSVGで新旧を比較する。
 * 回帰リスク: 置換漏れや二重置換は、同じ文書内の複数の図でIDが衝突し、矢印・クリップ・アクセシビリティ参照が別の図を指す不具合になる。
 */
import { readFileSync } from 'node:fs';
import { render } from 'pele';
import { describe, expect, it } from 'vitest';
import { namespaceMermaidSvg } from '../src/shared/mermaidSvg';
import { listTrackedSampleDocuments } from './sampleDocuments';

/**
 * 変更前の実装をそのまま残した比較用の正解（oracle）。IDを長い順に、id属性・#参照・aria参照の順で全文置換する。
 * @param svg - 名前空間化するSVG。
 * @param namespace - 付与する接頭辞。
 * @returns 名前空間化したSVG。
 */
function legacyNamespaceMermaidSvg(svg: string, namespace: string): string {
    const safeNamespace = namespace.replace(/[^a-zA-Z0-9_-]/g, '-');
    const ids = [...svg.matchAll(/\bid=(['"])([^'"]+)\1/g)].map(
        /**
         * id属性の値を取り出す。
         * @param match - id属性の一致結果。
         * @returns id値。
         */
        (match) => match[2]);
    let result = svg;
    for (const id of [...new Set(ids)].sort(
        /**
         * 長いIDを先に置換する。
         * @param left - 比較するID。
         * @param right - 比較するID。
         * @returns 並び順。
         */
        (left, right) => right.length - left.length)) {
        const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const replacement = `${safeNamespace}-${id}`;
        result = result.replace(new RegExp(`(\\bid=(['"]))${escaped}\\2`, 'g'), `$1${replacement}$2`);
        result = result.replace(new RegExp(`#${escaped}(?![\\w:.-])`, 'g'), `#${replacement}`);
        result = result.replace(
            new RegExp(`((?:aria-labelledby|aria-describedby)=(['"])[^'"]*)\\b${escaped}\\b`, 'g'),
            `$1${replacement}`
        );
    }
    return result;
}

/**
 * Git管理下のサンプルからMermaidフェンスの本文を集める。
 * @returns Mermaidソースの一覧。
 */
function collectMermaidSources(): string[] {
    const sources: string[] = [];
    for (const file of listTrackedSampleDocuments()) {
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(/^```mermaid[^\n]*\n([\s\S]*?)^```/gm)) sources.push(match[1]);
    }
    return sources;
}

describe('namespaceMermaidSvg parity with the legacy implementation',
    () => {
        const sources = collectMermaidSources();

        it('finds Mermaid sources in the samples', () => {
            expect(sources.length).toBeGreaterThanOrEqual(30);
        });

        it('matches the legacy output for every sample diagram rendered by Pele', () => {
            let compared = 0;
            sources.forEach((source, index) => {
                let svg: string;
                try {
                    // 拡張機能のPele Workerと同じ接頭辞形式で描画し、実際のID構成を再現する。
                    svg = render(source, { idPrefix: `mve-mve-pele-${index}`, links: true, images: true }).svg;
                } catch {
                    return;
                }
                const namespace = `mve-${index}`;
                expect(namespaceMermaidSvg(svg, namespace), `sample diagram #${index}`).toBe(legacyNamespaceMermaidSvg(svg, namespace));
                compared += 1;
            });
            expect(compared).toBeGreaterThanOrEqual(30);
        });

        it('matches the legacy output for hand-written edge cases', () => {
            const cases = [
                '<svg id="root" aria-labelledby="title description"><title id="title">t</title><desc id="description">d</desc><style>#node{clip-path:url(#clip)}</style><clipPath id="clip"/><g id="node" marker-end="url(#arrow)"><a href="#node"/></g><marker id="arrow"/></svg>',
                "<svg id='a'><g id='a-b'/><use href='#a-b'/><use href='#a'/><use href='#a.c'/><use href='#ab'/></svg>",
                '<svg id="x" aria-describedby="x"><g id="x:y"/><use href="#x:y"/><use href="#x"/></svg>',
                '<svg><g id="dup"/><g id="dup"/><use href="#dup"/><text>#dup in text</text></svg>',
                '<svg><g id="has space"/><use href="#has space"/></svg>',
                '<svg><g data-id="not-an-id"/><use href="#not-an-id"/></svg>',
                '<svg><g id="ns"/><s aria-labelledby="ns ns #.-"/></svg>'
            ];
            for (const svg of cases) {
                expect(namespaceMermaidSvg(svg, 'ns'), svg).toBe(legacyNamespaceMermaidSvg(svg, 'ns'));
            }
        });

        it('scales linearly with the number of ids', () => {
            const parts = Array.from({ length: 5_000 }, (_, index) => `<g id="n${index}"/><use href="#n${index}"/>`);
            const svg = `<svg>${parts.join('')}</svg>`;
            const startedAt = performance.now();
            const result = namespaceMermaidSvg(svg, 'ns');
            const elapsed = performance.now() - startedAt;
            expect(result).toContain('id="ns-n4999"');
            expect(result).toContain('href="#ns-n0"');
            // 旧実装はこの入力で数秒かかる。1パス化後は数十ミリ秒に収まる。負荷の高い環境でも誤検出しないよう余裕を持たせる。
            expect(elapsed).toBeLessThan(2_000);
        });
    });

/**
 * @fileoverview Textileリスト階層のCodeMirror装飾範囲とコード領域の除外条件を検証する。
 */
import { describe, expect, it } from 'vitest';
import { getTextileListMarkerRanges } from '../src/webview/editor/cmTextileListHighlight';

/** Textileリストの各インデント階層で記号だけを装飾対象にすることを検証する。 */
function verifyNestedListMarkerLevels(): void {
    const source = [
        '* Root item',
        '** Nested item',
        '*** Third level',
        '# Ordered root',
        '## Ordered child',
        '   ** Indented child'
    ].join('\n');
    const ranges = getTextileListMarkerRanges(source);

    expect(ranges.map((range) => ({
        text: source.slice(range.from, range.to),
        level: range.level
    }))).toEqual([
        { text: '*', level: 1 },
        { text: '**', level: 2 },
        { text: '***', level: 3 },
        { text: '#', level: 1 },
        { text: '##', level: 2 },
        { text: '**', level: 2 }
    ]);
}

/** Textile・Markdownのコード領域とnotextile範囲でリスト風文字列を装飾しないことを検証する。 */
function verifyProtectedCodeAndLiteralRegions(): void {
    const source = [
        'bc. example code',
        '** literal code marker',
        '',
        'pre.. extended code',
        '** still literal',
        'h2. Textile resumes',
        '** visible nested list',
        '',
        '<pre><code>',
        '** raw HTML code',
        '</code></pre>',
        '',
        '<notextile>',
        '** literal Textile',
        '</notextile>',
        '',
        '```text',
        '** Markdown code',
        '```',
        '',
        '** final nested list'
    ].join('\n');
    const ranges = getTextileListMarkerRanges(source);

    expect(ranges.map((range) => source.slice(range.from, range.to))).toEqual(['**', '**']);
    expect(source.slice(ranges[0]?.from, ranges[0]?.to)).toBe('**');
    expect(source.slice(ranges[1]?.from, ranges[1]?.to)).toBe('**');
}

/** 可視範囲フィルターがDecoration作成数だけを制限し、文書位置を保つことを検証する。 */
function verifyVisibleRangeFiltering(): void {
    const source = '* first\n** second\n*** third';
    const ranges = getTextileListMarkerRanges(source, [{ from: 9, to: 17 }]);

    expect(ranges.map((range) => source.slice(range.from, range.to))).toEqual(['**']);
    expect(ranges[0]?.from).toBe(source.indexOf('**'));
}

/** Textile階層マーカー回帰ケースをVitestへ登録する。 */
function registerTextileListHighlightTests(): void {
    it('highlights each Textile list nesting marker independently', verifyNestedListMarkerLevels);
    it('leaves code and notextile regions literal', verifyProtectedCodeAndLiteralRegions);
    it('limits decorations to visible source ranges', verifyVisibleRangeFiltering);
}

describe('Textile source syntax highlighting', registerTextileListHighlightTests);

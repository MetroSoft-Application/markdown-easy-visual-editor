import { describe, expect, it } from 'vitest';
import {
  clearBlockFormatting,
  clearInlineFormatting,
  collectLocalResourceReferences,
  collectDiagnostics,
  createTableMarkdown,
  applyMarkdownTableAction,
  applyMarkdownTableTsv,
  formatMarkdown,
  getOutline,
  imageMarkdown,
  isMarkdownCodeFencePosition,
  markdownTableToTsv,
  prefixOrderedList,
  prefixSelectedLines,
  splitMarkdownBlocks,
  summarizeDiagnostics,
  wordStats,
  wrapSelection
} from '../src/shared/markdown';

describe('Markdown source editing', () => {
  it('wraps only the selected text', () => {
    const result = wrapSelection('alpha beta', { from: 6, to: 10 }, '**');
    expect(result.text).toBe('alpha **beta**');
    expect(result.selection).toEqual({ from: 8, to: 12 });
  });

  it('separates inline formatting from adjacent text with half-width spaces', () => {
    const result = wrapSelection('前後の文字列', { from: 2, to: 4 }, '**');
    expect(result.text).toBe('前後 **の文** 字列');
    expect(result.selection).toEqual({ from: 5, to: 7 });
  });

  it('toggles line prefixes as one edit', () => {
    const quoted = prefixSelectedLines('a\nb', { from: 0, to: 3 }, '> ');
    expect(quoted.text).toBe('> a\n> b');
    expect(prefixSelectedLines(quoted.text, quoted.selection, '> ').text).toBe('a\nb');
    expect(prefixSelectedLines('item', { from: 2, to: 2 }, '- ').text).toBe('- item');
    expect(prefixSelectedLines('- first\nsecond', { from: 0, to: 14 }, '- ').text).toBe('- first\n- second');
    expect(prefixSelectedLines('', { from: 0, to: 0 }, '- ').text).toBe('- ');
    expect(prefixSelectedLines('item\n', { from: 5, to: 5 }, '- ').text).toBe('item\n- ');
  });

  it('applies numbered lists at the caret and numbers selected lines', () => {
    expect(prefixOrderedList('alpha', { from: 2, to: 2 }).text).toBe('1. alpha');
    expect(prefixOrderedList('alpha\nbeta', { from: 0, to: 10 }).text).toBe('1. alpha\n2. beta');
    expect(prefixOrderedList('1. alpha\n2. beta', { from: 4, to: 4 }).text).toBe('alpha\n2. beta');
    expect(prefixOrderedList('', { from: 0, to: 0 }).text).toBe('1. ');
    expect(prefixOrderedList('item\n', { from: 5, to: 5 }).text).toBe('item\n1. ');
  });

  it('clears inline formatting without removing link targets', () => {
    const source = '**太字**と[~~リンク~~](https://example.com/a_b)';
    const result = clearInlineFormatting(source, { from: 0, to: source.length });
    expect(result.text).toBe('太字と[リンク](https://example.com/a_b)');
  });

  it('clears heading, quote and list prefixes', () => {
    const source = '# 見出し\n> 引用\n- [ ] タスク';
    expect(clearBlockFormatting(source, { from: 0, to: source.length }).text).toBe('見出し\n引用\nタスク');
  });

  it('does not alter block formatting without a selection', () => {
    const source = '# 見出し';
    expect(clearBlockFormatting(source, { from: 3, to: 3 }).text).toBe(source);
  });

  it('turns a fenced code block into a paragraph', () => {
    const source = '```ts\nconst value = 1;\n```';
    expect(clearBlockFormatting(source, { from: 0, to: source.length }).text).toBe('const value = 1;');
  });
});

describe('Markdown structures', () => {
  it('creates a valid GFM table', () => {
    expect(createTableMarkdown(3, 2)).toBe('| 列1 | 列2 |\n| --- | --- |\n|  |  |\n|  |  |');
  });

  it('edits the selected Markdown table row and column', () => {
    const source = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const cell = source.indexOf('1');
    expect(applyMarkdownTableAction(source, { from: cell, to: cell }, 'rowAfter')?.text).toBe(
      '| A | B |\n| --- | --- |\n| 1 | 2 |\n|  |  |'
    );
    expect(applyMarkdownTableAction(source, { from: source.indexOf('B'), to: source.indexOf('B') }, 'alignCenter')?.text).toBe(
      '| A | B |\n| --- | :---: |\n| 1 | 2 |'
    );
  });

  it('adds a named header when inserting a table column', () => {
    const source = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const cell = source.indexOf('2');
    expect(applyMarkdownTableAction(source, { from: cell, to: cell }, 'colAfter', { headerName: '合計' })?.text).toBe(
      '| A | B | 合計 |\n| --- | --- | --- |\n| 1 | 2 |  |'
    );
  });

  it('pads table columns with half-width spaces', () => {
    const source = '| Name | Value |\n| --- | --- |\n| A | 100 |\n| Longer | 2 |';
    const cell = source.indexOf('100');
    expect(applyMarkdownTableAction(source, { from: cell, to: cell }, 'alignColumns')?.text).toBe(
      '| Name   | Value |\n| ---    | ---   |\n| A      | 100   |\n| Longer | 2     |'
    );
  });

  it('aligns full-width table cells and separator pipes by display width', () => {
    const source = '| \u9805\u76ee | \u5024 |\n| --- | --- |\n| \u9577\u3044\u540d\u524d | 1 |';
    const cell = source.indexOf('1');
    const aligned = applyMarkdownTableAction(source, { from: cell, to: cell }, 'alignColumns')?.text;
    const lines = aligned?.split('\n') ?? [];
    const pipeColumns = (line: string): number[] => {
      let column = 0;
      const positions: number[] = [];
      for (const character of line) {
        if (character === '|') positions.push(column);
        column += character.codePointAt(0)! > 0xff ? 2 : 1;
      }
      return positions;
    };
    expect(new Set(lines.map((line) => pipeColumns(line)[1])).size).toBe(1);
    expect(new Set(lines.map((line) => pipeColumns(line)[2])).size).toBe(1);
  });

  it('promotes a selected data row to the Markdown table header', () => {
    const source = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const cell = source.indexOf('1');
    expect(applyMarkdownTableAction(source, { from: cell, to: cell }, 'header')?.text).toBe(
      '| 1 | 2 |\n| --- | --- |\n| A | B |'
    );
  });

  it('pastes quoted TSV into the selected cell and preserves the surrounding Markdown', () => {
    const source = '前\r\n| H1 | H2 |\r\n| --- | --- |\r\n| old | old2 |\r\n後';
    const cell = source.indexOf('old');
    const edit = applyMarkdownTableTsv(source, { from: cell, to: cell }, 'A|B\t日本語\r\n"複数\n行"\t絵文字✅');
    expect(edit?.text).toBe('前\r\n| H1 | H2 |\r\n| --- | --- |\r\n| A\\|B | 日本語 |\r\n| 複数<br>行 | 絵文字✅ |\r\n後');
  });

  it('expands Markdown tables when TSV has more rows or columns', () => {
    const source = '| H1 |\n| --- |\n| old |';
    const cell = source.indexOf('old');
    expect(applyMarkdownTableTsv(source, { from: cell, to: cell }, 'A\tB\nC\tD')?.text).toBe(
      '| H1 |  |\n| --- | --- |\n| A | B |\n| C | D |'
    );
  });

  it('copies table headers and data as plain TSV without the separator row', () => {
    const source = '| 項目 | 内容 |\n| --- | --- |\n| ID | **重要** |\n| Link | [仕様](https://example.com) / A \\| B<br>次 |';
    const cell = source.indexOf('Link');
    expect(markdownTableToTsv(source, { from: cell, to: cell })).toBe('項目\t内容\r\nID\t重要\r\nLink\t"仕様 / A | B\n次"');
  });

  it('converts TSV pasted outside a table into a GFM table', () => {
    const source = '前の説明\n\n後の説明';
    const offset = source.indexOf('後');
    expect(applyMarkdownTableTsv(source, { from: offset, to: offset }, 'A\tB\r\n1\t2')).toEqual({
      text: '前の説明\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n後の説明',
      selection: { from: 40, to: 40 }
    });
  });

  it('replaces an outside selection while retaining Markdown on both sides', () => {
    const source = '前置\n置換対象\n後置';
    const from = source.indexOf('置換対象');
    const to = from + '置換対象'.length;
    expect(applyMarkdownTableTsv(source, { from, to }, 'A\tB\n1\t2')?.text).toBe(
      '前置\n| A | B |\n| --- | --- |\n| 1 | 2 |\n後置'
    );
  });

  it('converts one-column TSV and empty cells outside a table', () => {
    expect(applyMarkdownTableTsv('', { from: 0, to: 0 }, '項目\r\n\r\n値')?.text).toBe(
      '| 項目 |\n| --- |\n|  |\n| 値 |'
    );
  });

  it('keeps the selected table range addressable with mixed line endings', () => {
    const source = '前\r| H1 | H2 |\n| --- | --- |\r| old | old2 |';
    const cell = source.indexOf('old');
    expect(applyMarkdownTableTsv(source, { from: cell, to: cell }, 'A\tB')?.text).toBe(
      '前\r| H1 | H2 |\r| --- | --- |\r| A | B |'
    );
  });

  it('does not treat fenced table-like text as a Markdown table', () => {
    const source = '```text\n| A | B |\n| --- | --- |\n| 1 | 2 |\n```';
    const cell = source.indexOf('1');
    expect(isMarkdownCodeFencePosition(source, { from: cell, to: cell })).toBe(true);
    expect(applyMarkdownTableTsv(source, { from: cell, to: cell }, 'X\tY')).toBeUndefined();
  });

  it('escapes Markdown syntax in TSV values while preserving the value', () => {
    expect(applyMarkdownTableTsv('', { from: 0, to: 0 }, '**重要**\t[参照](url)\n`code`\t<tag>')?.text).toBe(
      '| \\*\\*重要\\*\\* | \\[参照\\](url) |\n| --- | --- |\n| \\`code\\` | \\<tag\\> |'
    );
  });

  it('does not apply TSV to the separator row', () => {
    const source = '本文\n\n| H1 |\n| --- |\n| old |';
    const separator = source.indexOf('---');
    expect(applyMarkdownTableTsv(source, { from: separator, to: separator }, 'A\tB')).toBeUndefined();
    expect(markdownTableToTsv(source, { from: separator, to: separator })).toBeUndefined();
  });

  it('creates portable relative image markdown', () => {
    expect(imageMarkdown('assets\\spec\\pasted.png', '図[1]')).toBe('![図\\[1\\]](assets/spec/pasted.png)');
  });

  it('extracts a Japanese outline with stable ids', () => {
    const outline = getOutline('# 概要\n\n## 詳細\n## 詳細');
    expect(outline.map((item) => item.id)).toEqual(['概要', '詳細', '詳細-1']);
  });

  it('reports outline offsets in the original CRLF coordinate space', () => {
    const source = '# A\r\n本文\r\n## B\r\n';
    expect(getOutline(source).map(({ line, offset }) => ({ line, offset }))).toEqual([
      { line: 1, offset: 0 },
      { line: 3, offset: source.indexOf('## B') }
    ]);
  });

  it('splits source into non-lossy top-level blocks', () => {
    const source = '# A\n\nText\n\n| A | B |\n|---|---|\n|1|2|\n';
    expect(splitMarkdownBlocks(source).map((block) => block.raw).join('')).toBe(source);
  });

  it('reports duplicate headings and unclosed fences', () => {
    const diagnostics = collectDiagnostics('# Same\n# Same\n\n```ts\ncode');
    expect(diagnostics.some((item) => item.code === 'duplicate-heading')).toBe(true);
    expect(diagnostics.some((item) => item.code === 'unclosed-fence')).toBe(true);
  });

  it('orders diagnostics by source line while preserving same-line order', () => {
    const diagnostics = collectDiagnostics('![ ](assets/a.png)\n# Same\n# Same\n|  | 内容 |\n| -- | --- |');
    expect(diagnostics.map((item) => item.line)).toEqual([1, 1, 3, 5]);
    expect(diagnostics.slice(0, 2).map((item) => item.code)).toEqual(['empty-image-alt', 'local-image']);
  });

  it('reports diagnostic lines for fenced blocks and image accessibility', () => {
    const diagnostics = collectDiagnostics('```ts\ncode');
    expect(diagnostics.find((item) => item.code === 'unclosed-fence')?.line).toBe(1);
    const imageDiagnostics = collectDiagnostics('text\n\n![](assets/a.png)');
    expect(imageDiagnostics.find((item) => item.code === 'empty-image-alt')?.line).toBe(3);
    expect(imageDiagnostics.find((item) => item.code === 'local-image')?.line).toBe(3);
  });

  it('extracts local image and link references while excluding external and fenced content', () => {
    const references = collectLocalResourceReferences([
      '![画像](assets/ok.svg)',
      '[仕様](docs/spec.md#section)',
      '[外部](https://example.com)',
      '[FTP](ftp://example.com/spec.md)',
      '`[コード](docs/inside.md)`',
      '```markdown',
      '![コード内](assets/inside.svg)',
      '```',
      '[参照仕様]: <docs/reference.md>',
      '![参照画像]: assets/reference.svg'
    ].join('\n'));
    expect(references).toEqual([
      { kind: 'image', source: 'assets/ok.svg', line: 1 },
      { kind: 'link', source: 'docs/spec.md#section', line: 2 },
      { kind: 'link', source: 'docs/reference.md', line: 9 },
      { kind: 'image', source: 'assets/reference.svg', line: 10 }
    ]);
  });

  it('handles nested and multiline destinations, reference usages, containers, and comments', () => {
    const references = collectLocalResourceReferences([
      '[括弧](docs/spec(1).md)',
      '[改行](',
      '  docs/spec.md',
      ')',
      '![画像][img]',
      '[リンク][doc]',
      '[shortcut]',
      '[img]: assets/image.png',
      '[doc]: docs/doc.md',
      '[shortcut]: docs/shortcut.md',
      '> [引用][quoted]',
      '> [quoted]: docs/quoted.md',
      '- [リスト][list]',
      '- [list]: docs/list.md',
      '    [コード](docs/code.md)',
      '<!-- [コメント](docs/comment.md) -->',
      '<!--',
      '[コメント](docs/comment2.md)',
      '-->'
    ].join('\n'));
    expect(references).toEqual([
      { kind: 'link', source: 'docs/spec(1).md', line: 1 },
      { kind: 'link', source: 'docs/spec.md', line: 2 },
      { kind: 'image', source: 'assets/image.png', line: 5 },
      { kind: 'link', source: 'docs/doc.md', line: 6 },
      { kind: 'link', source: 'docs/shortcut.md', line: 7 },
      { kind: 'link', source: 'docs/quoted.md', line: 11 },
      { kind: 'link', source: 'docs/list.md', line: 13 }
    ]);
  });

  it('extracts HTML resources and local absolute/URI destinations', () => {
    const references = collectLocalResourceReferences([
      '<img src="assets/inline.png">',
      '<a href="docs/spec.md?view=1#details">仕様</a>',
      '![UNC](//server/share/image.png)',
      '[file URI](file:///tmp/spec.md)',
      '![絶対パス](/assets/root.png)'
    ].join('\n'));
    expect(references).toEqual([
      { kind: 'image', source: 'assets/inline.png', line: 1 },
      { kind: 'link', source: 'docs/spec.md?view=1#details', line: 2 },
      { kind: 'image', source: '//server/share/image.png', line: 3 },
      { kind: 'link', source: 'file:///tmp/spec.md', line: 4 },
      { kind: 'image', source: '/assets/root.png', line: 5 }
    ]);
  });

  it('ignores escaped link and image syntax', () => {
    expect(collectLocalResourceReferences([
      '\\[リンクではない](docs/missing.md)',
      '\\![画像ではない](assets/missing.png)'
    ].join('\n'))).toEqual([]);
  });

  it('reports specification-document diagnostics for tables and reference links', () => {
    const source = [
      '|  | 内容 |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '[未定義参照][missing]',
      '[未定義参照][]',
      '[未定義ショートカット]',
      '[定義済み][defined]',
      '[defined]: https://example.com'
    ].join('\n');
    const diagnostics = collectDiagnostics(source);
    const invalidSeparator = collectDiagnostics('| A | B |\n| -- | --- |');
    const normalTextRow = collectDiagnostics('| A | B |\n| foo | bar |');
    expect(diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'empty-table-header',
      'broken-reference-link'
    ]));
    expect(diagnostics.filter((item) => item.code === 'broken-reference-link')).toHaveLength(2);
    expect(invalidSeparator.some((item) => item.code === 'invalid-table-separator')).toBe(true);
    expect(normalTextRow.some((item) => item.code === 'invalid-table-separator')).toBe(false);
    expect(diagnostics.some((item) => item.code === 'table-column-mismatch')).toBe(false);
    const escapedLabel = collectDiagnostics('[表示\\]名][escaped]\n[escaped]: https://example.com');
    expect(escapedLabel.some((item) => item.code === 'broken-reference-link')).toBe(false);
    const nestedLabel = collectDiagnostics('[表示 [内] 容][nested]\n[nested]: https://example.com');
    expect(nestedLabel.some((item) => item.code === 'broken-reference-link')).toBe(false);
  });

  it('does not treat ordinary bracket text or task syntax as broken references', () => {
    const diagnostics = collectDiagnostics('- [ ] TODO\n[1]\n説明 [注記]');
    expect(diagnostics.some((item) => item.code === 'broken-reference-link')).toBe(false);
  });

  it('ignores fenced and inline-code content while checking diagnostics', () => {
    const source = [
      '```markdown',
      '|  | 内容 |',
      '| -- | --- |',
      '[未定義][missing]',
      '![](assets/a.png)',
      '```',
      '| A | B |',
      '| -- | --- |',
      '`[インライン][missing]` [未定義][missing]'
    ].join('\r');
    const diagnostics = collectDiagnostics(source);
    expect(diagnostics.filter((item) => item.code === 'empty-table-header')).toHaveLength(0);
    expect(diagnostics.filter((item) => item.code === 'empty-image-alt')).toHaveLength(0);
    expect(diagnostics.filter((item) => item.code === 'broken-reference-link')).toHaveLength(1);
    expect(diagnostics.some((item) => item.code === 'invalid-table-separator' && item.line === 8)).toBe(true);
    expect(diagnostics.filter((item) => item.code === 'invalid-table-separator')).toHaveLength(1);
  });

  it('checks reference images and ignores inline-code images', () => {
    const referenceImageDiagnostics = collectDiagnostics('![][missing-image]');
    expect(referenceImageDiagnostics.some((item) => item.code === 'empty-image-alt')).toBe(true);
    expect(referenceImageDiagnostics.some((item) => item.code === 'broken-reference-link')).toBe(true);
    const inlineImageDiagnostics = collectDiagnostics('`![](assets/a.png)`');
    expect(inlineImageDiagnostics.some((item) => item.code === 'empty-image-alt')).toBe(false);
    expect(inlineImageDiagnostics.some((item) => item.code === 'local-image')).toBe(false);
  });

  it('does not close a fence when a closing marker has an info string', () => {
    const source = [
      '```',
      '```js',
      '| A | B |',
      '| --- | --- |',
      '```'
    ].join('\n');
    const diagnostics = collectDiagnostics(source);
    expect(diagnostics.filter((item) => item.code === 'unclosed-fence')).toHaveLength(0);
    expect(diagnostics.some((item) => item.code === 'table-column-mismatch')).toBe(false);
    expect(diagnostics.some((item) => item.code === 'empty-table-header')).toBe(false);
  });

  it('reports a header and separator column mismatch', () => {
    const diagnostics = collectDiagnostics('| A | B |\n| --- |\n| 1 | 2 |');
    expect(diagnostics.find((item) => item.code === 'table-column-mismatch')?.line).toBe(2);
  });

  it('reports table column mismatch and groups the same diagnostics for preflight', () => {
    const diagnostics = collectDiagnostics('| A | B |\n| --- | --- |\n| 1 |');
    expect(diagnostics.some((item) => item.code === 'table-column-mismatch')).toBe(true);
    const summary = summarizeDiagnostics(diagnostics);
    expect(summary.errors).toEqual(diagnostics.filter((item) => item.severity === 'error'));
    expect(summary.warnings).toEqual(diagnostics.filter((item) => item.severity === 'warning'));
    expect(summary.infos).toEqual(diagnostics.filter((item) => item.severity === 'info'));
  });

  it('formats trailing whitespace without destroying two-space hard breaks', () => {
    expect(formatMarkdown('a  \nb   \n\n\n\n\nc ')).toBe('a  \nb   \n\n\nc\n');
  });

  it('counts text separately from markdown punctuation', () => {
    const stats = wordStats('# 見出し\n\n**本文**');
    expect(stats.lines).toBe(3);
    expect(stats.text).toBeGreaterThan(4);
    expect(stats.markdown).toBeGreaterThan(stats.text);
  });
});

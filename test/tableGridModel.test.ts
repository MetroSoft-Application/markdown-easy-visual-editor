import { describe, expect, it } from 'vitest';
import {
  parseTableGridTsv,
  pasteTableGrid,
  readTableGridAt,
  serializeTableGrid
} from '../src/webview/tableGridModel';

describe('tableGridModel', () => {
  it('reads the table around the current offset and preserves raw Markdown cells', () => {
    const source = [
      '# title',
      '',
      '| Name | Value |',
      '| :--- | ---: |',
      '| **foo** | `a|b` |',
      '| bar | baz |',
      '',
      'after'
    ].join('\n');
    const model = readTableGridAt(source, source.indexOf('bar'));
    expect(model).toBeDefined();
    expect(model?.rows).toEqual([
      ['Name', 'Value'],
      ['**foo**', '`a|b`'],
      ['bar', 'baz']
    ]);
    expect(model?.alignments).toEqual(['left', 'right']);
  });

  it('serializes a model without discarding inline Markdown', () => {
    const source = '| A | B |\n| --- | :---: |\n| **x** | y |';
    const model = readTableGridAt(source, source.indexOf('**x**'))!;
    model.rows[1][1] = '[link](https://example.com)';
    expect(serializeTableGrid(model)).toBe([
      '| A | B |',
      '| --- | :---: |',
      '| **x** | [link](https://example.com) |'
    ].join('\n'));
  });

  it('escapes a newly typed pipe so it does not create an extra column', () => {
    const source = '| A |\n| --- |\n| x |';
    const model = readTableGridAt(source, source.indexOf('x'))!;
    model.rows[1][0] = 'a|b';
    expect(serializeTableGrid(model)).toContain('| a\\|b |');
  });

  it('parses quoted TSV including embedded newlines', () => {
    expect(parseTableGridTsv('a\t"b\nb"\r\nc\td')).toEqual([
      ['a', 'b\nb'],
      ['c', 'd']
    ]);
  });

  it('pastes TSV from the active cell and expands rows and columns', () => {
    const source = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const model = readTableGridAt(source, source.indexOf('1'))!;
    const next = pasteTableGrid(model, 1, 1, [['x', 'y'], ['z', 'w']]);
    expect(next.rows).toEqual([
      ['A', 'B', ''],
      ['1', 'x', 'y'],
      ['', 'z', 'w']
    ]);
    expect(next.alignments).toHaveLength(3);
  });
});

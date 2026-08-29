import { describe, expect, it } from 'vitest';
import {
  applyMarkdownTableAction,
  applyMarkdownTableTsv,
  markdownTableToTsv
} from '../src/shared/markdown';
import {
  prepareTableEditorApply,
  readTableEditorDraft,
  renderTableEditorDraft
} from '../src/webview/tableEditorModel';

describe('table editor model', () => {
  it('reads the active table and preserves CRLF plus alignment markers', () => {
    const source = [
      'before',
      '| 左寄せ | 中央寄せ | 右寄せ |',
      '| :--- | :---: | ---: |',
      '| 左 | 中央 | 100 |',
      '| 日本語 | ✅ | 12,345 |',
      'after'
    ].join('\r\n');
    const offset = source.indexOf('日本語') + 1;
    const draft = readTableEditorDraft(source, offset);

    expect(draft).toBeDefined();
    expect(draft?.sourceText).toBe(source);
    expect(draft?.eol).toBe('\r\n');
    expect(draft?.rows).toEqual([
      ['左寄せ', '中央寄せ', '右寄せ'],
      ['左', '中央', '100'],
      ['日本語', '✅', '12,345']
    ]);
    expect(draft?.alignments).toEqual(['left', 'center', 'right']);
    expect(draft?.activeRow).toBe(2);
    expect(draft?.activeColumn).toBe(0);

    const rendered = renderTableEditorDraft(draft!);
    expect(rendered.text).toContain('| :--- | :---: | ---: |');
    expect(rendered.text.split('\r\n')).toHaveLength(4);
    expect(rendered.text.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('keeps escaped pipes inside a single cell and escapes newly typed pipes', () => {
    const source = '| A | B |\n| --- | --- |\n| a\\|b | c |';
    const draft = readTableEditorDraft(source, source.indexOf('a\\|b') + 2)!;

    expect(draft.rows[1]).toEqual(['a\\|b', 'c']);
    expect(renderTableEditorDraft(draft).text).toContain('| a\\|b | c |');

    draft.rows[1][0] = 'left | right';
    expect(renderTableEditorDraft(draft).text).toContain('| left \\| right | c |');

    const evenEscaped = '| A | B |\n| --- | --- |\n| a\\\\|b | c |';
    expect(readTableEditorDraft(evenEscaped, evenEscaped.indexOf('a'))?.rows[1]).toEqual(['a\\\\', 'b', 'c']);
  });

  it('supports indented tables and rows without outer pipes', () => {
    const source = '  A | B\n  --- | ---\n  1 | 2';
    const draft = readTableEditorDraft(source, source.indexOf('2'));

    expect(draft?.indent).toBe('  ');
    expect(draft?.rows).toEqual([['A', 'B'], ['1', '2']]);
    expect(renderTableEditorDraft(draft!).text).toBe('  | A | B |\n  | --- | --- |\n  | 1 | 2 |');
  });

  it('rejects fenced table-like text', () => {
    const backtick = '```text\n| A | B |\n| --- | --- |\n| 1 | 2 |\n```';
    const tilde = '~~~text\n| A | B |\n| --- | --- |\n| 1 | 2 |\n~~~';

    expect(readTableEditorDraft(backtick, backtick.indexOf('1'))).toBeUndefined();
    expect(readTableEditorDraft(tilde, tilde.indexOf('1'))).toBeUndefined();
  });

  it('rejects a non-table row and a missing separator row', () => {
    expect(readTableEditorDraft('plain text', 2)).toBeUndefined();
    expect(readTableEditorDraft('| A | B |\n| not a separator |\n| 1 | 2 |', 4)).toBeUndefined();
  });

  it('normalizes ragged rows to the widest table column count', () => {
    const source = '| A | B |\n| --- | --- | --- |\n| 1 | 2 | 3 |';
    const draft = readTableEditorDraft(source, source.indexOf('2'))!;

    expect(draft.rows).toEqual([['A', 'B', ''], ['1', '2', '3']]);
    expect(draft.alignments).toEqual(['none', 'none', 'none']);
    expect(renderTableEditorDraft(draft).text).toContain('| A | B |  |');
  });

  it('returns a no-op for an untouched draft and a single replacement for an edit', () => {
    const source = 'before\n| A | B |\n| --- | --- |\n| 1 | 2 |\nafter';
    const draft = readTableEditorDraft(source, source.indexOf('1'))!;

    expect(prepareTableEditorApply(draft, source)).toEqual({ kind: 'noop' });

    draft.rows[1][0] = 'changed';
    const result = prepareTableEditorApply(draft, source);
    expect(result.kind).toBe('changed');
    if (result.kind === 'changed') {
      expect(result.text).toBe('| A | B |\n| --- | --- |\n| changed | 2 |');
      expect(result.caretOffset).toBe('| A | B |\n| --- | --- |\n| '.length);
    }
  });

  it('rejects applying a draft after any external document change', () => {
    const source = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const draft = readTableEditorDraft(source, source.indexOf('1'))!;
    draft.rows[1][0] = 'changed';

    expect(prepareTableEditorApply(draft, `${source}\n外部変更`)).toEqual({ kind: 'stale' });
  });

  it('uses the shared table actions and TSV rules used by the ribbon', () => {
    const source = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const draft = readTableEditorDraft(source, source.indexOf('1'))!;
    const rendered = renderTableEditorDraft(draft);
    const rowEdit = applyMarkdownTableAction(
      rendered.text,
      { from: rendered.caretOffset, to: rendered.caretOffset },
      'rowAfter'
    );
    const rowDraft = readTableEditorDraft(rowEdit!.text, rowEdit!.selection.from)!;
    expect(rowDraft.rows).toEqual([['A', 'B'], ['1', '2'], ['', '']]);

    const tsvEdit = applyMarkdownTableTsv(
      rendered.text,
      { from: rendered.caretOffset, to: rendered.caretOffset },
      'A|B\t日本語\r\n複数\n行\t✅'
    );
    expect(tsvEdit?.text).toContain('| A\\|B | 日本語 |');
    expect(markdownTableToTsv(tsvEdit!.text, tsvEdit!.selection)).toContain('A|B\t日本語');
  });
});

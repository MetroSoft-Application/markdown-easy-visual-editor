import { describe, expect, it } from 'vitest';
import { readTableEditorDraft, renderTableEditorDraft } from '../src/webview/tableEditorModel';

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

  it('keeps escaped pipes inside a single cell', () => {
    const source = '| A | B |\n| --- | --- |\n| a\\|b | c |';
    const draft = readTableEditorDraft(source, source.indexOf('a\\|b') + 2);

    expect(draft?.rows[1]).toEqual(['a\\|b', 'c']);
    expect(renderTableEditorDraft(draft!).text).toContain('| a\\|b | c |');
  });

  it('returns undefined outside a Markdown table', () => {
    const source = 'plain text\n\n| A | B |\n| --- | --- |\n| 1 | 2 |';
    expect(readTableEditorDraft(source, 2)).toBeUndefined();
  });
});

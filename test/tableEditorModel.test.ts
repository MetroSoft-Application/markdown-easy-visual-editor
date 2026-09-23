/**
 * @file tableEditorModel.test.ts
 * 実行境界: テスト実行環境。
 * 責務: 現行実装の仕様と回帰条件を検証する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テスト用のモック、ブラウザー、ファイルを必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { describe, expect, it } from 'vitest';
import {
  applyMarkdownTableAction,
  applyMarkdownTableTsv,
  markdownTableToTsv
} from '../src/shared/markdown';
import {
  prepareTableEditorApply,
  readTableEditorDraft,
  renderTableEditorDraft,
  tableEditorCellDisplayOffsetFromStored,
  tableEditorCellDisplayValue,
  tableEditorCellStoredOffsetFromDisplay,
  tableEditorCellStoredValue,
  deleteTableEditorLineBreakBeforeDisplayOffset,
  insertTableEditorLineBreak
} from '../src/webview/tableEditorModel';

describe('table editor model',
/**
 * テスト「table editor model」の前提条件を設定し、期待結果を検証するコールバックです。
 * @returns テストの前提条件と期待結果を検証し、値を返しません。
 */
() => {
  it('reads the active table and preserves CRLF plus alignment markers',
  /**
 * テスト「reads the active table and preserves CRLF plus alignment markers」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns 置換後の文字列を返します。
   */
  () => {
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

  it('keeps escaped pipes inside a single cell and escapes newly typed pipes',
  /**
 * テスト「keeps escaped pipes inside a single cell and escapes newly typed pipes」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const source = '| A | B |\n| --- | --- |\n| a\\|b | c |';
    const draft = readTableEditorDraft(source, source.indexOf('a\\|b') + 2)!;

    expect(draft.rows[1]).toEqual(['a\\|b', 'c']);
    expect(renderTableEditorDraft(draft).text).toContain('| a\\|b | c |');

    draft.rows[1][0] = 'left | right';
    expect(renderTableEditorDraft(draft).text).toContain('| left \\| right | c |');

    const evenEscaped = '| A | B |\n| --- | --- |\n| a\\\\|b | c |';
    expect(readTableEditorDraft(evenEscaped, evenEscaped.indexOf('a'))?.rows[1]).toEqual(['a\\\\', 'b', 'c']);
  });

  it('supports indented tables and rows without outer pipes',
  /**
 * テスト「supports indented tables and rows without outer pipes」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const source = '  A | B\n  --- | ---\n  1 | 2';
    const draft = readTableEditorDraft(source, source.indexOf('2'));

    expect(draft?.indent).toBe('  ');
    expect(draft?.rows).toEqual([['A', 'B'], ['1', '2']]);
    expect(renderTableEditorDraft(draft!).text).toBe('  | A | B |\n  | --- | --- |\n  | 1 | 2 |');
  });

  it('rejects fenced table-like text',
  /**
 * テスト「rejects fenced table-like text」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const backtick = '```text\n| A | B |\n| --- | --- |\n| 1 | 2 |\n```';
    const tilde = '~~~text\n| A | B |\n| --- | --- |\n| 1 | 2 |\n~~~';

    expect(readTableEditorDraft(backtick, backtick.indexOf('1'))).toBeUndefined();
    expect(readTableEditorDraft(tilde, tilde.indexOf('1'))).toBeUndefined();
  });

  it('rejects a non-table row and a missing separator row',
  /**
 * テスト「rejects a non-table row and a missing separator row」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(readTableEditorDraft('plain text', 2)).toBeUndefined();
    expect(readTableEditorDraft('| A | B |\n| not a separator |\n| 1 | 2 |', 4)).toBeUndefined();
  });

  it('normalizes ragged rows to the widest table column count',
  /**
 * テスト「normalizes ragged rows to the widest table column count」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const source = '| A | B |\n| --- | --- | --- |\n| 1 | 2 | 3 |';
    const draft = readTableEditorDraft(source, source.indexOf('2'))!;

    expect(draft.rows).toEqual([['A', 'B', ''], ['1', '2', '3']]);
    expect(draft.alignments).toEqual(['none', 'none', 'none']);
    expect(renderTableEditorDraft(draft).text).toContain('| A | B |  |');
  });

  it('returns a no-op for an untouched draft and a single replacement for an edit',
  /**
 * テスト「returns a no-op for an untouched draft and a single replacement for an edit」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
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

  it('inserts a Markdown line break at the cell selection without adding a table row',
  /**
 * テスト「inserts a Markdown line break at the cell selection without adding a table row」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(insertTableEditorLineBreak('beforeafter', 6, 6)).toEqual({ value: 'before<br>after', caretOffset: 10 });
    expect(insertTableEditorLineBreak('beforeafter', 0, 6)).toEqual({ value: '<br>after', caretOffset: 4 });
    expect(insertTableEditorLineBreak('beforeafter', 6, 6).value).not.toContain('\n');
  });

  it('maps stored Markdown breaks to visual cell offsets',
  /**
 * テスト「maps stored Markdown breaks to visual cell offsets」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const stored = 'before<br>after';
    const display = tableEditorCellDisplayValue(stored);
    expect(display).toBe('before<br>\nafter');
    expect(tableEditorCellStoredValue(display)).toBe(stored);
    expect(tableEditorCellStoredValue('before<br>\n\nafter')).toBe('before<br><br>after');
    // Deleting only the visible token leaves its display-only newline in the
    // textarea; that newline must not recreate another stored <br>.
    expect(tableEditorCellStoredValue('before\nafter', stored)).toBe('beforeafter');
    expect(tableEditorCellStoredValue('before<br>\nafter', stored)).toBe(stored);
    expect(tableEditorCellStoredValue('before<br>\n\nafter', stored)).toBe('before<br><br>after');
    expect(tableEditorCellStoredValue('alpha<br\nbeta', 'alpha<br>beta')).toBe('alphabeta');
    expect(tableEditorCellStoredValue('alphabr>\nbeta', 'alpha<br>beta')).toBe('alphabeta');
    expect(tableEditorCellStoredOffsetFromDisplay(stored, 11)).toBe(10);
    expect(tableEditorCellDisplayOffsetFromStored(stored, 10)).toBe(11);

    expect(deleteTableEditorLineBreakBeforeDisplayOffset(stored, 11)).toEqual({
      value: 'beforeafter',
      caretOffset: 6,
    });
  });

  it('round-trips multiple visual breaks and preserves the caret boundary',
  /**
 * テスト「round-trips multiple visual breaks and preserves the caret boundary」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const stored = 'before<br>after<br>end';
    const display = tableEditorCellDisplayValue(stored);
    expect(display).toBe('before<br>\nafter<br>\nend');
    expect(tableEditorCellStoredValue(display)).toBe(stored);
    expect(tableEditorCellDisplayValue(stored)).toBe(display);

    const generatedBreaks = [...display.matchAll(/<br>\n/g)].map(
    /**
 * 「match」を変換し、変換後の要素を返すコールバックです。
     * @param match matchとして渡される、このコールバックの入力値です。
     * @returns 置換後の文字列を返します。
     */
    (match) => match.index! + 4);
    for (let offset = 0; offset <= display.length; offset += 1) {
      const storedOffset = tableEditorCellStoredOffsetFromDisplay(stored, offset);
      const roundTrip = tableEditorCellDisplayOffsetFromStored(stored, storedOffset);
      if (!generatedBreaks.includes(offset)) expect(roundTrip).toBe(offset);
    }

    const breakBoundary = tableEditorCellStoredOffsetFromDisplay(stored, 6);
    const edit = insertTableEditorLineBreak(stored, breakBoundary, breakBoundary);
    expect(edit.value).toBe('before<br><br>after<br>end');
    expect(tableEditorCellDisplayOffsetFromStored(edit.value, edit.caretOffset)).toBe(11);

    const singleBreakDisplayAfterDelete = display.replace('<br>', '');
    expect(tableEditorCellStoredValue(singleBreakDisplayAfterDelete, stored)).toBe('beforeafter<br>end');
  });

  it('rejects applying a draft after any external document change',
  /**
 * テスト「rejects applying a draft after any external document change」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const source = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const draft = readTableEditorDraft(source, source.indexOf('1'))!;
    draft.rows[1][0] = 'changed';

    expect(prepareTableEditorApply(draft, `${source}\n外部変更`)).toEqual({ kind: 'stale' });
  });

  it('uses the shared table actions and TSV rules used by the ribbon',
  /**
 * テスト「uses the shared table actions and TSV rules used by the ribbon」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
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

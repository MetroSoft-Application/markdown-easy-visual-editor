/**
 * @fileoverview tableeditormodel・テストの回帰の仕様と回帰条件を検証する。失敗時は期待値と実装差分を示す。
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
    insertTableEditorLineBreak,
    remapTableEditorSortState,
    sortTableEditorRows
} from '../src/webview/tableEditorModel';

describe('table editor model',
    /**
     * 「table editor model」の仕様と回帰条件を検証するテストケース。
     * @returns テストケースを実行し、値は返さない。
     */
    () => {
        it('reads the active table and preserves CRLF plus alignment markers',
            /**
             * 「reads the active table and preserves CRLF plus alignment markers」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
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
             * 「keeps escaped pipes inside a single cell and escapes newly typed pipes」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
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
             * 「supports indented tables and rows without outer pipes」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
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
             * 「rejects fenced table-like text」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const backtick = '```text\n| A | B |\n| --- | --- |\n| 1 | 2 |\n```';
                const tilde = '~~~text\n| A | B |\n| --- | --- |\n| 1 | 2 |\n~~~';

                expect(readTableEditorDraft(backtick, backtick.indexOf('1'))).toBeUndefined();
                expect(readTableEditorDraft(tilde, tilde.indexOf('1'))).toBeUndefined();
            });

        it('rejects a non-table row and a missing separator row',
            /**
             * 「rejects a non-table row and a missing separator row」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(readTableEditorDraft('plain text', 2)).toBeUndefined();
                expect(readTableEditorDraft('| A | B |\n| not a separator |\n| 1 | 2 |', 4)).toBeUndefined();
            });

        it('normalizes ragged rows to the widest table column count',
            /**
             * 「normalizes ragged rows to the widest table column count」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
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
             * 「returns a no-op for an untouched draft and a single replacement for an edit」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
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
             * 「inserts a Markdown line break at the cell selection without adding a table row」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(insertTableEditorLineBreak('beforeafter', 6, 6)).toEqual({ value: 'before<br>after', caretOffset: 10 });
                expect(insertTableEditorLineBreak('beforeafter', 0, 6)).toEqual({ value: '<br>after', caretOffset: 4 });
                expect(insertTableEditorLineBreak('beforeafter', 6, 6).value).not.toContain('\n');
            });

        it('maps stored Markdown breaks to visual cell offsets',
            /**
             * 「maps stored Markdown breaks to visual cell offsets」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
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
             * 「round-trips multiple visual breaks and preserves the caret boundary」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const stored = 'before<br>after<br>end';
                const display = tableEditorCellDisplayValue(stored);
                expect(display).toBe('before<br>\nafter<br>\nend');
                expect(tableEditorCellStoredValue(display)).toBe(stored);
                expect(tableEditorCellDisplayValue(stored)).toBe(display);

                const generatedBreaks = [...display.matchAll(/<br>\n/g)].map(
                    /**
                     * 各matchから位置を取り出して一覧化する。
                     * @param match - matchの位置を参照する走査対象。
                     * @returns 位置を取り出した変換結果の一覧。
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
             * 「rejects applying a draft after any external document change」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const source = '| A | B |\n| --- | --- |\n| 1 | 2 |';
                const draft = readTableEditorDraft(source, source.indexOf('1'))!;
                draft.rows[1][0] = 'changed';

                expect(prepareTableEditorApply(draft, `${source}\n外部変更`)).toEqual({ kind: 'stale' });
            });

        it('sorts numeric columns, preserves blank placement, and keeps whole rows stable',
            /**
             * 数値列を昇順・降順に並べ替え、空欄と行データの対応を検証する。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const rows = [
                    ['Name', 'Value', 'Id'],
                    ['ten', '10', 'row-ten'],
                    ['two', '2', 'row-two'],
                    ['fraction', '.5', 'row-fraction'],
                    ['one', '1.', 'row-one'],
                    ['one-exp', '1e0', 'row-one-exp'],
                    ['scientific', '1e2', 'row-scientific'],
                    ['blank', '   ', 'row-blank'],
                    ['negative', '-1', 'row-negative'],
                ];

                const ascending = sortTableEditorRows(rows, 1, 'ascending', 'en');
                expect(ascending.rows.map((row) => row[1])).toEqual([
                    'Value', '-1', '.5', '1.', '1e0', '2', '10', '1e2', '   ',
                ]);
                expect(ascending.rows.map((row) => row[2])).toEqual([
                    'Id', 'row-negative', 'row-fraction', 'row-one', 'row-one-exp', 'row-two',
                    'row-ten', 'row-scientific', 'row-blank',
                ]);

                const descending = sortTableEditorRows(rows, 1, 'descending', 'en');
                expect(descending.rows.map((row) => row[1])).toEqual([
                    'Value', '1e2', '10', '2', '1.', '1e0', '.5', '-1', '   ',
                ]);
                expect(descending.rows[0]).toEqual(rows[0]);
                expect(rows[1]).toEqual(['ten', '10', 'row-ten']);
            });

        it('uses natural string order when a column mixes text and numbers',
            /**
             * 数値以外が混在する列をロケール対応の自然順で比較する。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const rows = [
                    ['Item', 'Id'],
                    ['item10', 'first'],
                    ['item2', 'second'],
                    ['item2', 'third'],
                    ['label', 'text'],
                    [' ', 'blank'],
                ];

                const ascending = sortTableEditorRows(rows, 0, 'ascending', 'en');
                expect(ascending.rows.map((row) => row[1])).toEqual([
                    'Id', 'second', 'third', 'first', 'text', 'blank',
                ]);

                const descending = sortTableEditorRows(rows, 0, 'descending', 'en');
                expect(descending.rows.map((row) => row[1])).toEqual([
                    'Id', 'text', 'first', 'second', 'third', 'blank',
                ]);
            });

        it('uses natural order instead of parsing comma-separated values as numbers',
            /**
             * カンマを含む値を数値として解釈せず自然順で比較する。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const rows = [['Value'], ['2'], ['1,000']];

                const sorted = sortTableEditorRows(rows, 0, 'ascending', 'en');
                expect(sorted.rows.map((row) => row[0])).toEqual(['Value', '1,000', '2']);
            });

        it('remaps the active sort column when columns move, insert, or delete',
            /**
             * 列構成変更後もソート状態が同じ列データを参照することを検証する。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const state = { column: 2, direction: 'ascending' as const };
                expect(remapTableEditorSortState(state, { kind: 'move', from: 1, to: 3 }))
                    .toEqual({ column: 1, direction: 'ascending' });
                expect(remapTableEditorSortState(state, { kind: 'insert', index: 1, count: 2 }))
                    .toEqual({ column: 4, direction: 'ascending' });
                expect(remapTableEditorSortState(state, { kind: 'delete', index: 1, count: 1 }))
                    .toEqual({ column: 1, direction: 'ascending' });
                expect(remapTableEditorSortState(state, { kind: 'delete', index: 2, count: 1 }))
                    .toBeNull();
            });

        it('uses the shared table actions and TSV rules used by the ribbon',
            /**
             * 「uses the shared table actions and TSV rules used by the ribbon」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
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

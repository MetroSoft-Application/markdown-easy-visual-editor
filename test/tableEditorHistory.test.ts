/**
 * @fileoverview 表編集Undo/Redoでデータ、レイアウト、選択状態を復元し、履歴上限と分岐時のRedo破棄を検証する。
 */
import { describe, expect, it } from 'vitest';
import {
    createTableEditorHistory,
    recordTableEditorHistory,
    redoTableEditorHistory,
    undoTableEditorHistory,
    type TableEditorHistorySnapshot,
} from '../src/webview/table-editor/tableEditorHistory';

/**
 * 指定セル値と選択位置を持つ履歴スナップショットを作成する。
 * @param value - 履歴スナップショットのデータセルへ格納する文字列。
 * @param row - 選択状態へ設定する行番号。
 * @param column - 選択状態へ設定する列番号。
 * @returns 指定データと選択状態を含むスナップショット。
 */
function snapshot(value: string, row = 0, column = 0): TableEditorHistorySnapshot {
    return {
        rows: [['Header'], [value]],
        alignments: ['none'],
        activeRow: row,
        activeColumn: column,
        sortState: null,
        rowHeights: [undefined, 34],
        columnWidths: [160],
        gridSelection: {
            anchorRow: row,
            anchorColumn: column,
            focusRow: row,
            focusColumn: column,
        },
        selectionKind: 'cells',
    };
}

describe('table editor draft history',
    () => {
        it('undoes and redoes draft mutations without sharing mutable arrays',
            () => {
                const history = createTableEditorHistory();
                const before = snapshot('before');
                before.sortState = { column: 0, direction: 'ascending' };
                recordTableEditorHistory(history, before);
                before.sortState.direction = 'descending';

                const undone = undoTableEditorHistory(history, snapshot('after'));
                expect(undone?.rows[1][0]).toBe('before');
                expect(undone?.sortState).toEqual({ column: 0, direction: 'ascending' });

                if (!undone) throw new Error('missing undo snapshot');
                undone.rows[1][0] = 'mutated outside history';
                undone.gridSelection.anchorRow = 1;
                undone.sortState!.direction = 'descending';
                const redone = redoTableEditorHistory(history, undone);
                expect(redone?.rows[1][0]).toBe('after');
                expect(redone?.gridSelection.anchorRow).toBe(0);
                expect(history.undo.at(-1)?.gridSelection.anchorRow).toBe(1);
                expect(history.undo.at(-1)?.sortState).toEqual({ column: 0, direction: 'descending' });
            });

        it('restores layout and selection state with the table data',
            () => {
                const history = createTableEditorHistory();
                const before = snapshot('before', 1, 0);
                before.rowHeights[1] = 88;
                before.columnWidths[0] = 240;
                before.gridSelection = {
                    anchorRow: 1,
                    anchorColumn: 0,
                    focusRow: 1,
                    focusColumn: 0,
                };
                before.selectionKind = 'row';
                recordTableEditorHistory(history, before);

                const undone = undoTableEditorHistory(history, snapshot('after'));
                expect(undone).toMatchObject({
                    rowHeights: [undefined, 88],
                    columnWidths: [240],
                    selectionKind: 'row',
                    gridSelection: before.gridSelection,
                });
            });

        it('clears redo when a new edit starts after undo',
            () => {
                const history = createTableEditorHistory();
                recordTableEditorHistory(history, snapshot('a'));
                const previous = undoTableEditorHistory(history, snapshot('b'));
                expect(previous?.rows[1][0]).toBe('a');
                expect(history.redo).toHaveLength(1);

                recordTableEditorHistory(history, snapshot('new branch'));
                expect(history.redo).toHaveLength(0);
            });

        it('caps retained undo entries',
            () => {
                const history = createTableEditorHistory();
                recordTableEditorHistory(history, snapshot('a'), 2);
                recordTableEditorHistory(history, snapshot('b'), 2);
                recordTableEditorHistory(history, snapshot('c'), 2);

                expect(history.undo.map(
                    /**
                     * 各エントリからrowsを取り出して一覧化する。
                     * @param entry - エントリのrowsを参照する走査対象。
                     * @returns rowsを取り出した変換結果の一覧。
                     */
                    (entry) => entry.rows[1][0])).toEqual(['b', 'c']);
            });
    });

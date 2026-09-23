/**
 * @fileoverview 表編集履歴・テストの回帰の仕様と回帰条件を検証する。失敗時は期待値と実装差分を示す。
 */
import { describe, expect, it } from 'vitest';
import {
    createTableEditorHistory,
    recordTableEditorHistory,
    redoTableEditorHistory,
    undoTableEditorHistory,
    type TableEditorHistorySnapshot,
} from '../src/webview/tableEditorHistory';

/**
 * 表編集履歴・テストの回帰のsnapshotを処理し、呼び出し側へ結果または副作用を返す。
 * @param value - 検証・変換・保存の対象となる値。
 * @param row - 表編集履歴・テストの回帰で走査または更新する要素。
 * @param column - 表編集履歴・テストの回帰で走査または更新する要素。
 * @returns 表編集履歴・テストの回帰のsnapshotが生成する結果。
 */
function snapshot(value: string, row = 0, column = 0): TableEditorHistorySnapshot {
    return {
        rows: [['Header'], [value]],
        alignments: ['none'],
        activeRow: row,
        activeColumn: column,
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
    /**
     * 「table editor draft history」の仕様と回帰条件を検証するテストケース。
     * @returns テストケースを実行し、値は返さない。
     */
    () => {
        it('undoes and redoes draft mutations without sharing mutable arrays',
            /**
             * 「undoes and redoes draft mutations without sharing mutable arrays」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const history = createTableEditorHistory();
                const before = snapshot('before');
                recordTableEditorHistory(history, before);

                const undone = undoTableEditorHistory(history, snapshot('after'));
                expect(undone?.rows[1][0]).toBe('before');

                if (!undone) throw new Error('missing undo snapshot');
                undone.rows[1][0] = 'mutated outside history';
                undone.gridSelection.anchorRow = 1;
                const redone = redoTableEditorHistory(history, undone);
                expect(redone?.rows[1][0]).toBe('after');
                expect(redone?.gridSelection.anchorRow).toBe(0);
                expect(history.undo.at(-1)?.gridSelection.anchorRow).toBe(1);
            });

        it('restores layout and selection state with the table data',
            /**
             * 「restores layout and selection state with the table data」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
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
            /**
             * 「clears redo when a new edit starts after undo」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
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
            /**
             * 「caps retained undo entries」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
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

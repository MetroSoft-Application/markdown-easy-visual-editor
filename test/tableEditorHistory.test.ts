/**
 * @file tableEditorHistory.test.ts
 * 実行境界: テスト実行環境。
 * 責務: 現行実装の仕様と回帰条件を検証する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テスト用のモック、ブラウザー、ファイルを必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
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
 * 「snapshot」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param value 「snapshot」で検証・変換する入力値です。
 * @param row 本文、表、配列内の対象位置を示すインデックスです。
 * @param column 本文、表、配列内の対象位置を示すインデックスです。
 * @returns 「snapshot」が表編集状態の入力を処理して得た固有の結果を返します。
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
 * テスト「table editor draft history」の前提条件を設定し、期待結果を検証するコールバックです。
 * @returns テストの前提条件と期待結果を検証し、値を返しません。
 */
() => {
  it('undoes and redoes draft mutations without sharing mutable arrays',
  /**
 * テスト「undoes and redoes draft mutations without sharing mutable arrays」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
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
 * テスト「restores layout and selection state with the table data」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
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
 * テスト「clears redo when a new edit starts after undo」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
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
 * テスト「caps retained undo entries」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const history = createTableEditorHistory();
    recordTableEditorHistory(history, snapshot('a'), 2);
    recordTableEditorHistory(history, snapshot('b'), 2);
    recordTableEditorHistory(history, snapshot('c'), 2);

    expect(history.undo.map(
    /**
 * 「entry」を変換し、変換後の要素を返すコールバックです。
     * @param entry entryとして渡される、このコールバックの入力値です。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (entry) => entry.rows[1][0])).toEqual(['b', 'c']);
  });
});

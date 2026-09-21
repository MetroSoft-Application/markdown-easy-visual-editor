import { describe, expect, it } from 'vitest';
import {
  createTableEditorHistory,
  recordTableEditorHistory,
  redoTableEditorHistory,
  undoTableEditorHistory,
  type TableEditorHistorySnapshot,
} from '../src/webview/tableEditorHistory';

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

describe('table editor draft history', () => {
  it('undoes and redoes draft mutations without sharing mutable arrays', () => {
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

  it('restores layout and selection state with the table data', () => {
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

  it('clears redo when a new edit starts after undo', () => {
    const history = createTableEditorHistory();
    recordTableEditorHistory(history, snapshot('a'));
    const previous = undoTableEditorHistory(history, snapshot('b'));
    expect(previous?.rows[1][0]).toBe('a');
    expect(history.redo).toHaveLength(1);

    recordTableEditorHistory(history, snapshot('new branch'));
    expect(history.redo).toHaveLength(0);
  });

  it('caps retained undo entries', () => {
    const history = createTableEditorHistory();
    recordTableEditorHistory(history, snapshot('a'), 2);
    recordTableEditorHistory(history, snapshot('b'), 2);
    recordTableEditorHistory(history, snapshot('c'), 2);

    expect(history.undo.map((entry) => entry.rows[1][0])).toEqual(['b', 'c']);
  });
});

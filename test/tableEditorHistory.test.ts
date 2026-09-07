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
    const redone = redoTableEditorHistory(history, undone);
    expect(redone?.rows[1][0]).toBe('after');
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

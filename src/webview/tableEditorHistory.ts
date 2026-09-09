import type { TableEditorAlignment } from './tableEditorModel';

export interface TableEditorHistorySnapshot {
  rows: string[][];
  alignments: TableEditorAlignment[];
  activeRow: number;
  activeColumn: number;
}

export interface TableEditorHistoryState {
  undo: TableEditorHistorySnapshot[];
  redo: TableEditorHistorySnapshot[];
}

/** Table editor draft history is deliberately separate from CodeMirror history. */
export function createTableEditorHistory(): TableEditorHistoryState {
  return { undo: [], redo: [] };
}

/** Snapshot mutable table arrays before storing them in history. */
export function cloneTableEditorHistorySnapshot(
  snapshot: TableEditorHistorySnapshot,
): TableEditorHistorySnapshot {
  return {
    rows: snapshot.rows.map((row) => row.slice()),
    alignments: snapshot.alignments.slice(),
    activeRow: snapshot.activeRow,
    activeColumn: snapshot.activeColumn,
  };
}

/** Record one user-visible draft mutation and invalidate the redo branch. */
export function recordTableEditorHistory(
  state: TableEditorHistoryState,
  current: TableEditorHistorySnapshot,
  limit = 200,
): void {
  state.undo.push(cloneTableEditorHistorySnapshot(current));
  const overflow = state.undo.length - Math.max(1, limit);
  if (overflow > 0) state.undo.splice(0, overflow);
  state.redo.length = 0;
}

/** Restore the snapshot immediately before the current draft. */
export function undoTableEditorHistory(
  state: TableEditorHistoryState,
  current: TableEditorHistorySnapshot,
): TableEditorHistorySnapshot | undefined {
  const previous = state.undo.pop();
  if (!previous) return undefined;
  state.redo.push(cloneTableEditorHistorySnapshot(current));
  return cloneTableEditorHistorySnapshot(previous);
}

/** Restore the snapshot most recently removed by undo. */
export function redoTableEditorHistory(
  state: TableEditorHistoryState,
  current: TableEditorHistorySnapshot,
): TableEditorHistorySnapshot | undefined {
  const next = state.redo.pop();
  if (!next) return undefined;
  state.undo.push(cloneTableEditorHistorySnapshot(current));
  return cloneTableEditorHistorySnapshot(next);
}

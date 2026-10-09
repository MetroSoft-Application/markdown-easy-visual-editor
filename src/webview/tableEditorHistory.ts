/**
 * @fileoverview 表編集ドラフトの変更履歴を保持し、上限付きUndo/Redoと新規編集時のRedo破棄を行う。
 */
import type { TableEditorAlignment, TableEditorSortState } from './tableEditorModel';
import type { TableGridRange } from '../shared/tableGrid';

/**
 * 表編集履歴の現在状態または履歴を保持するデータ形状。
 */
export interface TableEditorHistorySnapshot {

    /**
     * 表編集履歴で扱うrowsの一覧。
     */
    rows: string[][];

    /**
     * 履歴時点で各列に適用されていた配置設定。
     */
    alignments: TableEditorAlignment[];

    /**
     * 履歴snapshotで選択中の行の0始まりインデックス。
     */
    activeRow: number;

    /**
     * 履歴snapshotで選択中の列の0始まりインデックス。
     */
    activeColumn: number;

    /**
     * 表編集履歴のソート列と方向。
     */
    sortState: TableEditorSortState | null;

    /**
     * 各表行に対応する行高の一覧。未計測の行はundefined。
     */
    rowHeights: Array<number | undefined>;

    /**
     * 各表列に対応する列幅の一覧。
     */
    columnWidths: number[];

    /**
     * 履歴時点で選択されていたセル範囲。
     */
    gridSelection: TableGridRange;

    /**
     * 履歴時点の選択単位。セル範囲、行、列、表全体のいずれか。
     */
    selectionKind: 'cells' | 'row' | 'column' | 'all';
}

/**
 * 表編集履歴の現在状態または履歴を保持するデータ形状。
 */
export interface TableEditorHistoryState {

    /**
     * Undoで復元できる編集状態。末尾が次に復元される状態。
     */
    undo: TableEditorHistorySnapshot[];

    /**
     * Redoで復元できる編集状態。末尾が次に復元される状態。
     */
    redo: TableEditorHistorySnapshot[];
}

/**
 * Undo/Redoの保存先として使える空の履歴を作成する。
 * @returns Undo/Redo状態の配列が空の履歴。
 */
export function createTableEditorHistory(): TableEditorHistoryState {
    return { undo: [], redo: [] };
}

/**
 * スナップショットを複製し、可変配列と選択範囲を現在状態から切り離す。
 * @param snapshot - 複製する表編集状態スナップショット。
 * @returns 配列と選択範囲を複製したスナップショット。
 */
export function cloneTableEditorHistorySnapshot(
    snapshot: TableEditorHistorySnapshot,
): TableEditorHistorySnapshot {
    return {
        rows: snapshot.rows.map(
            (row) => row.slice()),
        alignments: snapshot.alignments.slice(),
        activeRow: snapshot.activeRow,
        activeColumn: snapshot.activeColumn,
        sortState: snapshot.sortState ? { ...snapshot.sortState } : null,
        rowHeights: snapshot.rowHeights.slice(),
        columnWidths: snapshot.columnWidths.slice(),
        gridSelection: { ...snapshot.gridSelection },
        selectionKind: snapshot.selectionKind,
    };
}

/**
 * 現在状態をUndo履歴に追加し、上限より古い状態とRedo履歴を破棄する。
 * @param state - 現在の編集・表示状態。
 * @param current - 新しい操作前の現在状態。undoへ追加してredoを消去する。
 * @param limit - Undoに保持する最大スナップショット数。1未満でも最低1件を保持する。
 */
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

/**
 * 直前のUndo状態を復元し、現在状態をRedo履歴へ追加する。
 * @param state - 現在の編集・表示状態。
 * @param current - undo適用前の現在状態。redo履歴へ退避する。
 * @returns 復元後の表編集状態。Undo履歴が空の場合はundefined。
 */
export function undoTableEditorHistory(
    state: TableEditorHistoryState,
    current: TableEditorHistorySnapshot,
): TableEditorHistorySnapshot | undefined {
    const previous = state.undo.pop();
    if (!previous) return undefined;
    state.redo.push(cloneTableEditorHistorySnapshot(current));
    return cloneTableEditorHistorySnapshot(previous);
}

/**
 * 次のRedo状態を復元し、現在状態をUndo履歴へ追加する。
 * @param state - 現在の編集・表示状態。
 * @param current - redo適用前の現在状態。undo履歴へ退避する。
 * @returns 復元後の表編集状態。Redo履歴が空の場合はundefined。
 */
export function redoTableEditorHistory(
    state: TableEditorHistoryState,
    current: TableEditorHistorySnapshot,
): TableEditorHistorySnapshot | undefined {
    const next = state.redo.pop();
    if (!next) return undefined;
    state.undo.push(cloneTableEditorHistorySnapshot(current));
    return cloneTableEditorHistorySnapshot(next);
}

/**
 * @fileoverview Webviewの表編集履歴を管理する。Hostとの通信、ユーザー操作、表示状態の契約を保つ。
 */
import type { TableEditorAlignment } from './tableEditorModel';
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
     * 表編集履歴のalignmentsに関する状態または設定。
     */
    alignments: TableEditorAlignment[];

    /**
     * 表編集履歴の状態を示すフラグ。
     */
    activeRow: number;

    /**
     * 表編集履歴の状態を示すフラグ。
     */
    activeColumn: number;

    /**
     * 表編集履歴のrow・heightsを表す数値。
     */
    rowHeights: Array<number | undefined>;

    /**
     * 表編集履歴のcolumn・widthsを表す数値。
     */
    columnWidths: number[];

    /**
     * 表編集履歴のgrid・selectionに関する状態または設定。
     */
    gridSelection: TableGridRange;

    /**
     * 表編集履歴のselection・kindに関する状態または設定。
     */
    selectionKind: 'cells' | 'row' | 'column' | 'all';
}

/**
 * 表編集履歴の現在状態または履歴を保持するデータ形状。
 */
export interface TableEditorHistoryState {

    /**
     * 表編集履歴のundoに関する状態または設定。
     */
    undo: TableEditorHistorySnapshot[];

    /**
     * 表編集履歴のredoに関する状態または設定。
     */
    redo: TableEditorHistorySnapshot[];
}

/**
 * 表編集履歴で使う値または実行環境を組み立てる。
 * @returns 表編集履歴で生成または変換した値。
 */
export function createTableEditorHistory(): TableEditorHistoryState {
    return { undo: [], redo: [] };
}

/**
 * 表編集履歴の入力または状態を走査・複製する。
 * @param snapshot - 表編集履歴へ渡す入力。
 * @returns 表編集履歴のclone・table・editor・history・snapshotが生成する結果。
 */
export function cloneTableEditorHistorySnapshot(
    snapshot: TableEditorHistorySnapshot,
): TableEditorHistorySnapshot {
    return {
        rows: snapshot.rows.map(
            /**
             * 各行からsliceを取り出して一覧化する。
             * @param row - 行のsliceを参照する走査対象。
             * @returns sliceを取り出した変換結果の一覧。
             */
            (row) => row.slice()),
        alignments: snapshot.alignments.slice(),
        activeRow: snapshot.activeRow,
        activeColumn: snapshot.activeColumn,
        rowHeights: snapshot.rowHeights.slice(),
        columnWidths: snapshot.columnWidths.slice(),
        gridSelection: { ...snapshot.gridSelection },
        selectionKind: snapshot.selectionKind,
    };
}

/**
 * 表編集履歴のrecord・table・editor・historyを処理し、呼び出し側へ結果または副作用を返す。
 * @param state - 現在の編集・表示状態。
 * @param current - 表編集履歴へ渡す入力。
 * @param limit - 表編集履歴へ渡す設定または境界値。
 * @returns 副作用を完了し、値は返さない。
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
 * 表編集履歴のundo・table・editor・historyを処理し、呼び出し側へ結果または副作用を返す。
 * @param state - 現在の編集・表示状態。
 * @param current - 表編集履歴へ渡す入力。
 * @returns 副作用を完了し、値は返さない。
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
 * 表編集履歴のredo・table・editor・historyを処理し、呼び出し側へ結果または副作用を返す。
 * @param state - 現在の編集・表示状態。
 * @param current - 表編集履歴へ渡す入力。
 * @returns 副作用を完了し、値は返さない。
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

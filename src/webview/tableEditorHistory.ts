/**
 * @file tableEditorHistory.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import type { TableEditorAlignment } from './tableEditorModel';
import type { TableGridRange } from '../shared/tableGrid';

/**
 * 「TableEditorHistorySnapshot」が満たすデータ契約を定義します。
 */
export interface TableEditorHistorySnapshot {

  /**
   * 「rows」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  rows: string[][];

  /**
   * 「alignments」は、関連する複数の対象または識別子を保持します。
   */
  alignments: TableEditorAlignment[];

  /**
   * 「activeRow」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  activeRow: number;

  /**
   * 「activeColumn」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  activeColumn: number;

  /**
   * 「rowHeights」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  rowHeights: Array<number | undefined>;

  /**
   * 「columnWidths」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  columnWidths: number[];

  /**
   * 「gridSelection」は、関連処理が共有する構造化データの一項目です。
   */
  gridSelection: TableGridRange;

  /**
   * 「selectionKind」は、対象の識別や処理分岐に使用する値を保持します。
   */
  selectionKind: 'cells' | 'row' | 'column' | 'all';
}

/**
 * 「TableEditorHistoryState」が満たすデータ契約を定義します。
 */
export interface TableEditorHistoryState {

  /**
   * 「undo」は、関連する複数の対象または識別子を保持します。
   */
  undo: TableEditorHistorySnapshot[];

  /**
   * 「redo」は、関連する複数の対象または識別子を保持します。
   */
  redo: TableEditorHistorySnapshot[];
}

/**
 * 履歴を作成または組み立てます。
 * @returns 「createTableEditorHistory」が生成したデータまたはオブジェクトを返します。
 */
export function createTableEditorHistory(): TableEditorHistoryState {
  return { undo: [], redo: [] };
}

/**
 * clone・table・editor・history・snapshotを作成または組み立てます。
 * @param snapshot 「snapshot」は、「cloneTableEditorHistorySnapshot」が表編集状態の処理対象を特定する入力です。
 * @returns 「cloneTableEditorHistorySnapshot」が表編集状態の入力を処理して得た固有の結果を返します。
 */
export function cloneTableEditorHistorySnapshot(
  snapshot: TableEditorHistorySnapshot,
): TableEditorHistorySnapshot {
  return {
    rows: snapshot.rows.map(
    /**
 * 「row」を変換し、変換後の要素を返すコールバックです。
     * @param row 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 入力要素から生成した変換後の値を返します。
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
 * 履歴を更新または保存します。
 * @param state 処理対象の状態です。
 * @param current 「current」は、「recordTableEditorHistory」が表編集状態の処理対象を特定する入力です。
 * @param limit 処理対象の件数または上限を表す数値です。
 * @returns 「recordTableEditorHistory」の副作用または状態更新を実行し、値は返しません。
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
 * 「undoTableEditorHistory」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param state 処理対象の状態です。
 * @param current 「current」は、「undoTableEditorHistory」が表編集状態の処理対象を特定する入力です。
 * @returns 「undoTableEditorHistory」が対象を取得できない場合はundefinedを返します。
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
 * 「redoTableEditorHistory」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param state 処理対象の状態です。
 * @param current 「current」は、「redoTableEditorHistory」が表編集状態の処理対象を特定する入力です。
 * @returns 「redoTableEditorHistory」が対象を取得できない場合はundefinedを返します。
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

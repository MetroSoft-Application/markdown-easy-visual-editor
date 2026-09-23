/**
 * @fileoverview 表編集オーバーレイを描画し、セル編集、選択、行列操作、ドラッグを処理する。
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  applyMarkdownTableAction,
  applyMarkdownTableTsv,
  markdownTableToTsv,
  type MarkdownTableAction,
} from "../shared/markdown";
import { getMessages, type Messages } from "../shared/messages";
import {
  clearTableGridRange,
  duplicateTableGridColumns,
  duplicateTableGridRows,
  moveTableGridColumn,
  moveTableGridItem,
  moveTableGridRow,
  normalizeTableGridRange,
  tableGridColumnLabel,
  tableGridRangeCellCount,
  tableGridRangeContains,
  type NormalizedTableGridRange,
  type TableGridRange,
} from "../shared/tableGrid";
import {
  createTableEditorHistory,
  recordTableEditorHistory,
  redoTableEditorHistory,
  undoTableEditorHistory,
  type TableEditorHistorySnapshot,
} from "./tableEditorHistory";
import {
  readTableEditorDraft,
  insertTableEditorLineBreak,
  deleteTableEditorLineBreakBeforeDisplayOffset,
  prepareTableEditorApply,
  renderTableEditorDraft,
  tableEditorCellDisplayOffsetFromStored,
  tableEditorCellDisplayValue,
  tableEditorCellStoredOffsetFromDisplay,
  tableEditorCellStoredValue,
  type TableEditorAlignment,
  type TableEditorDraft,
} from "./tableEditorModel";
import {
  calculateAutoFitColumnWidth,
  calculateAutoFitRowHeight,
  TABLE_EDITOR_MAX_AUTO_COLUMN_WIDTH,
  TABLE_EDITOR_MIN_COLUMN_WIDTH,
  TABLE_EDITOR_MIN_ROW_HEIGHT,
} from "../shared/tableEditorSizing";

/**
 * 表編集オーバーレイのopen・eventに関する状態または設定。
 */
const OPEN_EVENT = "mve-open-table-editor";

/**
 * 表編集で許可する行数の上限。
 */
const MAX_ROWS = 50;

/**
 * 表編集で許可する列数の上限。
 */
const MAX_COLUMNS = 20;

/**
 * 表編集列幅の下限。
 */
const MIN_COLUMN_WIDTH = TABLE_EDITOR_MIN_COLUMN_WIDTH;

/**
 * 自動調整で採用する列幅の上限。
 */
const MAX_AUTO_COLUMN_WIDTH = TABLE_EDITOR_MAX_AUTO_COLUMN_WIDTH;

/**
 * 表編集で列幅が未測定のときに使う値。
 */
const DEFAULT_COLUMN_WIDTH = 160;

/**
 * 表編集オーバーレイの位置・寸法・件数・時間を表す数値。
 */
const ROW_HEADER_WIDTH = 42;

/**
 * 編集面に許可する幅の下限。
 */
const MIN_EDITOR_WIDTH = 560;

/**
 * 編集面に許可する高さの下限。
 */
const MIN_EDITOR_HEIGHT = 320;

/**
 * 編集面の幅が未指定のときに使う値。
 */
const DEFAULT_EDITOR_WIDTH = 960;

/**
 * 編集面の高さが未指定のときに使う値。
 */
const DEFAULT_EDITOR_HEIGHT = 680;

/**
 * 表編集行高の下限。
 */
const MIN_ROW_HEIGHT = TABLE_EDITOR_MIN_ROW_HEIGHT;

/**
 * 表編集オーバーレイに許可する下限値。
 */
const MIN_TEXTAREA_HEIGHT = 34;

/**
 * 行高自動計算に加える上下の余白。
 */
const AUTO_FIT_ROW_VERTICAL_BUFFER = 4;
/**
 * 表編集オーバーレイで一時生成物または検証対象を置くディレクトリ。
 */
let overlayRoot: Root | undefined;
/**
 * 表編集オーバーレイのoverlay・hostに関する状態または設定。
 */
let overlayHost: HTMLDivElement | undefined;

/**
 * 表編集オーバーレイで扱う値の種類と境界を表す型。
 */
type CellSelection = {
  /**
   * 表編集オーバーレイのfromを表す数値。
   */
  from: number;
  /**
   * 表編集オーバーレイのtoを表す数値。
   */
  to: number;
};
/**
 * 表編集オーバーレイの現在状態または履歴を保持するデータ形状。
 */
type ColumnResizeState = {
  /**
   * 表編集オーバーレイの位置・寸法・件数・時間を表す数値。
   */
  column: number;

  /**
   * 表編集オーバーレイのstart・xを表す数値。
   */
  startX: number;

  /**
   * 表編集オーバーレイの位置・寸法・件数・時間を表す数値。
   */
  startWidth: number;

  /**
   * 表編集オーバーレイのmovedを切り替えるフラグ。
   */
  moved: boolean;
};
/**
 * 表編集オーバーレイの現在状態または履歴を保持するデータ形状。
 */
type RowResizeState = {
  /**
   * 表編集オーバーレイの位置・寸法・件数・時間を表す数値。
   */
  row: number;

  /**
   * 表編集オーバーレイのpointer・idを表す数値。
   */
  pointerId: number;

  /**
   * 表編集オーバーレイのstart・yを表す数値。
   */
  startY: number;

  /**
   * 表編集オーバーレイの位置・寸法・件数・時間を表す数値。
   */
  startHeight: number;

  /**
   * 表編集オーバーレイのmovedを切り替えるフラグ。
   */
  moved: boolean;
};
/**
 * 表編集オーバーレイで扱う値の種類と境界を表す型。
 */
type EditorSize = {
  /**
   * 表示領域または列の幅。
   */
  width: number;
  /**
   * 表示領域または行の高さ。
   */
  height: number;
};
/**
 * 表編集オーバーレイの現在状態または履歴を保持するデータ形状。
 */
type EditorDragState = {
  /**
   * 表編集オーバーレイのpointer・idを表す数値。
   */
  pointerId: number;

  /**
   * 表編集オーバーレイのstart・xを表す数値。
   */
  startX: number;

  /**
   * 表編集オーバーレイのstart・yを表す数値。
   */
  startY: number;

  /**
   * 親領域の左端を基準にした相対位置または比較値。
   */
  left: number;

  /**
   * 親領域の上端を基準にした相対位置または比較値。
   */
  top: number;

  /**
   * 表示領域または列の幅。
   */
  width: number;

  /**
   * 表示領域または行の高さ。
   */
  height: number;
};
/**
 * 表編集オーバーレイの現在状態または履歴を保持するデータ形状。
 */
type EditorResizeState = {
  /**
   * 表編集オーバーレイのpointer・idを表す数値。
   */
  pointerId: number;

  /**
   * 表編集オーバーレイのstart・xを表す数値。
   */
  startX: number;

  /**
   * 表編集オーバーレイのstart・yを表す数値。
   */
  startY: number;

  /**
   * 表編集オーバーレイの位置・寸法・件数・時間を表す数値。
   */
  startWidth: number;

  /**
   * 表編集オーバーレイの位置・寸法・件数・時間を表す数値。
   */
  startHeight: number;

  /**
   * 親領域の左端を基準にした相対位置または比較値。
   */
  left: number;

  /**
   * 親領域の上端を基準にした相対位置または比較値。
   */
  top: number;
};
/**
 * 表編集オーバーレイで対象や分岐を識別する値の型。
 */
type GridSelectionKind = "cells" | "row" | "column" | "all";
/**
 * 表編集オーバーレイの現在状態または履歴を保持するデータ形状。
 */
type GridDragState = {
  /**
   * メッセージ、項目、または処理の種類を識別する値。
   */
  kind: "row" | "column";
  /**
   * 解析・描画・変換の起点となる本文。
   */
  source: number;
};
/**
 * 表編集オーバーレイで扱う値の種類と境界を表す型。
 */
type GridDropTarget = {
  /**
   * メッセージ、項目、または処理の種類を識別する値。
   */
  kind: "row" | "column";
  /**
   * 配列・行列・文字列の要素位置を示す番号。
   */
  index: number;
};
/**
 * 表編集オーバーレイで扱う値の種類と境界を表す型。
 */
type TableEditorPolishText = {
  /**
   * 表編集オーバーレイで扱うmodifiedの文字列。
   */
  modified: string;

  /**
   * 表編集オーバーレイで扱うdiscardの文字列。
   */
  discard: string;

  /**
   * 表編集オーバーレイで扱うselectionの文字列。
   */
  selection: string;

  /**
   * 表編集オーバーレイで扱うcellsの文字列。
   */
  cells: string;

  /**
   * 表編集オーバーレイで扱うselect・allの文字列。
   */
  selectAll: string;

  /**
   * 表編集オーバーレイの位置・寸法・件数・時間を表す数値。
   */
  dragRow: string;

  /**
   * 表編集オーバーレイの位置・寸法・件数・時間を表す数値。
   */
  dragColumn: string;
};

/**
 * 表編集オーバーレイで解析・表示・保存する本文。
 */
const TABLE_EDITOR_POLISH_TEXT: Record<string, TableEditorPolishText> = {
  ja: {
    modified: "未適用の変更",
    discard: "未適用の変更を破棄しますか？",
    selection: "選択",
    cells: "セル",
    selectAll: "すべてのセルを選択",
    dragRow: "行をドラッグして並べ替え",
    dragColumn: "列をドラッグして並べ替え",
  },
  en: {
    modified: "Unapplied changes",
    discard: "Discard unapplied changes?",
    selection: "Selection",
    cells: "cells",
    selectAll: "Select all cells",
    dragRow: "Drag to reorder row",
    dragColumn: "Drag to reorder column",
  },
  "zh-cn": {
    modified: "有未应用的更改",
    discard: "要放弃未应用的更改吗？",
    selection: "选择",
    cells: "个单元格",
    selectAll: "选择所有单元格",
    dragRow: "拖动以重新排列行",
    dragColumn: "拖动以重新排列列",
  },
  ko: {
    modified: "적용되지 않은 변경 사항",
    discard: "적용되지 않은 변경 사항을 버리시겠습니까?",
    selection: "선택",
    cells: "셀",
    selectAll: "모든 셀 선택",
    dragRow: "드래그하여 행 순서 변경",
    dragColumn: "드래그하여 열 순서 변경",
  },
  fr: {
    modified: "Modifications non appliquées",
    discard: "Abandonner les modifications non appliquées ?",
    selection: "Sélection",
    cells: "cellules",
    selectAll: "Sélectionner toutes les cellules",
    dragRow: "Faire glisser pour réordonner la ligne",
    dragColumn: "Faire glisser pour réordonner la colonne",
  },
  de: {
    modified: "Nicht angewendete Änderungen",
    discard: "Nicht angewendete Änderungen verwerfen?",
    selection: "Auswahl",
    cells: "Zellen",
    selectAll: "Alle Zellen auswählen",
    dragRow: "Ziehen, um Zeile neu anzuordnen",
    dragColumn: "Ziehen, um Spalte neu anzuordnen",
  },
  es: {
    modified: "Cambios sin aplicar",
    discard: "¿Descartar los cambios sin aplicar?",
    selection: "Selección",
    cells: "celdas",
    selectAll: "Seleccionar todas las celdas",
    dragRow: "Arrastrar para reordenar la fila",
    dragColumn: "Arrastrar para reordenar la columna",
  },
};

/**
 * 表編集オーバーレイのcell・keyを処理し、呼び出し側へ結果または副作用を返す。
 * @param row - 表編集オーバーレイで走査または更新する要素。
 * @param column - 表編集オーバーレイで走査または更新する要素。
 * @returns 表編集オーバーレイで利用する文字列。
 */
function cellKey(row: number, column: number): string {
  return `${row}:${column}`;
}

/**
 * 表編集オーバーレイの入力を構造化した値へ変換する。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns 表編集オーバーレイで生成または変換した値。
 */
function parseTableCellAddress(value: string | undefined):
  | {
      /**
       * 表編集オーバーレイの位置・寸法・件数・時間を表す数値。
       */
      row: number;
      /**
       * 表編集オーバーレイの位置・寸法・件数・時間を表す数値。
       */
      column: number;
    }
  | undefined {
  const match = /^(\d+):(\d+)$/.exec(value ?? "");
  if (!match) return undefined;
  return { row: Number(match[1]), column: Number(match[2]) };
}

/**
 * 表編集オーバーレイのrow・textarea・styleを処理し、呼び出し側へ結果または副作用を返す。
 * @param rowHeight - 表編集オーバーレイで走査または更新する要素。
 * @returns 副作用を完了し、値は返さない。
 */
function rowTextareaStyle(
  rowHeight: number | undefined,
): React.CSSProperties | undefined {
  if (rowHeight === undefined) return undefined;
  const cellHeight = Math.max(MIN_TEXTAREA_HEIGHT, rowHeight - 2);
  return { height: `${cellHeight}px`, minHeight: `${cellHeight}px` };
}

/**
 * 表編集オーバーレイのtable・editor・polish・textを処理し、呼び出し側へ結果または副作用を返す。
 * @param language - 表編集オーバーレイの対象や分岐を識別する値。
 * @returns 表編集オーバーレイのtable・editor・polish・textが生成する結果。
 */
function tableEditorPolishText(language: string): TableEditorPolishText {
  const normalized = language.trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "zh" || normalized.startsWith("zh-cn")) {
    return TABLE_EDITOR_POLISH_TEXT["zh-cn"];
  }
  const primary = normalized.split("-")[0];
  return TABLE_EDITOR_POLISH_TEXT[primary] ?? TABLE_EDITOR_POLISH_TEXT.en;
}

/**
 * 表編集オーバーレイのinstall・table・editor・overlayを処理し、呼び出し側へ結果または副作用を返す。
 * @returns 表編集オーバーレイのinstall・table・editor・overlayが生成する結果。
 */
export function installTableEditorOverlay(): () => void {
  const open = /**
   * 表編集オーバーレイの表示または操作を開始する。
   * @returns 副作用を完了し、値は返さない。
   */ () => openTableEditor();
  window.addEventListener(OPEN_EVENT, open);
  /**
   * イベントでremove・event・listenerを実行する。
   * @returns 副作用を完了し、値は返さない。
   */
  return () => {
    window.removeEventListener(OPEN_EVENT, open);
    closeOverlay();
  };
}

/**
 * 表編集オーバーレイから必要な値またはリソースを取得する。
 * @returns 条件に一致する値。未検出時はundefinedまたはnull。
 */
function findEditorView(): EditorView | undefined {
  const editor = document.querySelector<HTMLElement>(
    ".source-editor .cm-editor",
  );
  return editor ? (EditorView.findFromDOM(editor) ?? undefined) : undefined;
}

/**
 * 表編集オーバーレイの表示または操作を開始する。
 * @returns 副作用を完了し、値は返さない。
 */
function openTableEditor(): void {
  const messages = getMessages(document.documentElement.lang);
  const view = findEditorView();
  if (!view) {
    showOverlayToast(messages.app.tableEditor.sourceEditorRequired);
    return;
  }
  const source = view.state.doc.toString();
  const draft = readTableEditorDraft(source, view.state.selection.main.head);
  if (!draft) {
    showOverlayToast(messages.app.tableEditor.tableRequired);
    return;
  }
  closeOverlay();
  overlayHost = document.createElement("div");
  overlayHost.className = "mve-table-editor-root";
  document.body.appendChild(overlayHost);
  overlayRoot = createRoot(overlayHost);
  overlayRoot.render(
    <TableEditorOverlay
      view={view}
      initial={draft}
      messages={messages}
      onClose={closeOverlay}
    />,
  );
}

/**
 * 表編集オーバーレイの処理またはリソースを終了し、後続利用可能な状態へ戻す。
 * @returns 副作用を完了し、値は返さない。
 */
function closeOverlay(): void {
  overlayRoot?.unmount();
  overlayRoot = undefined;
  overlayHost?.remove();
  overlayHost = undefined;
}

/**
 * 表編集オーバーレイの表示または操作を開始する。
 * @param message - HostとWebviewの間で受け渡すメッセージ。
 * @returns 副作用を完了し、値は返さない。
 */
function showOverlayToast(message: string): void {
  const toast = document.createElement("div");
  toast.className = "mve-table-editor-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(
    /**
     * 指定時間の経過後に後続処理を実行する。
     * @returns 副作用を完了し、値は返さない。
     */
    () => toast.remove(),
    2400,
  );
}

/**
 * 表編集オーバーレイのtable・editor・overlayを処理し、呼び出し側へ結果または副作用を返す。
 * @param options - 呼び出し側が指定する処理設定。
 * @returns 表編集オーバーレイのtable・editor・overlayが生成する結果。
 */
function TableEditorOverlay({
  view,
  initial,
  messages,
  onClose,
}: {
  /**
   * 表編集オーバーレイのviewに関する状態または設定。
   */
  view: EditorView;

  /**
   * 表編集オーバーレイのinitialに関する状態または設定。
   */
  initial: TableEditorDraft;

  /**
   * 表編集オーバーレイで扱うmessagesの一覧。
   */
  messages: Messages;
  /**
   * 表編集オーバーレイのイベントまたはメッセージを受け取り、状態を更新する。
   * @returns 表編集オーバーレイのon・closeが生成する結果。
   */
  onClose: () => void;
}): React.JSX.Element {
  const [rows, setRows] = useState(
    /**
     * 要素をmapへ渡し、表編集オーバーレイの結果または副作用を処理する。
     * @returns 表編集オーバーレイのコールバックが生成する結果。
     */
    () =>
      initial.rows.map(
        /**
         * 各行からsliceを取り出して一覧化する。
         * @param row - 行のsliceを参照する走査対象。
         * @returns sliceを取り出した変換結果の一覧。
         */
        (row) => row.slice(),
      ),
  );
  const [alignments, setAlignments] = useState<TableEditorAlignment[]>(
    /**
     * 要素をsliceへ渡し、表編集オーバーレイの結果または副作用を処理する。
     * @returns 表編集オーバーレイのコールバックが生成する結果。
     */
    () => initial.alignments.slice(),
  );
  const [activeRow, setActiveRow] = useState(initial.activeRow);
  const [activeColumn, setActiveColumn] = useState(initial.activeColumn);
  const [gridSelection, setGridSelection] = useState<TableGridRange>(
    /**
     * 表編集オーバーレイのコールバックとして要素を処理する。
     * @returns 表編集オーバーレイのコールバックが生成する結果。
     */
    () => ({
      anchorRow: initial.activeRow,
      anchorColumn: initial.activeColumn,
      focusRow: initial.activeRow,
      focusColumn: initial.activeColumn,
    }),
  );
  const [selectionKind, setSelectionKind] =
    useState<GridSelectionKind>("cells");
  const [dragTarget, setDragTarget] = useState<GridDropTarget>();
  const [status, setStatus] = useState("");
  const [historyRevision, setHistoryRevision] = useState(0);
  const [editorSize, setEditorSize] = useState<EditorSize>({
    width: DEFAULT_EDITOR_WIDTH,
    height: DEFAULT_EDITOR_HEIGHT,
  });
  const [editorPosition, setEditorPosition] = useState<{
    /**
     * 親領域の左端を基準にした相対位置または比較値。
     */
    left: number;

    /**
     * 親領域の上端を基準にした相対位置または比較値。
     */
    top: number;
  }>();
  const [rowHeights, setRowHeights] = useState<Array<number | undefined>>(
    /**
     * 要素をfromへ渡し、表編集オーバーレイの結果または副作用を処理する。
     * @returns 表編集オーバーレイに対応する要素の一覧。
     */
    () =>
      Array.from(
        { length: initial.rows.length },
        /**
         * 表編集オーバーレイのコールバックとして要素を処理する。
         * @returns 副作用を完了し、値は返さない。
         */
        () => undefined,
      ),
  );
  const initialColumnCount = Math.max(
    1,
    initial.alignments.length,
    ...initial.rows.map(
      /**
       * 各行からlengthを取り出して一覧化する。
       * @param row - 行のlengthを参照する走査対象。
       * @returns lengthを取り出した変換結果の一覧。
       */
      (row) => row.length,
    ),
  );
  const [columnWidths, setColumnWidths] = useState<number[]>(
    /**
     * 要素をfromへ渡し、表編集オーバーレイの結果または副作用を処理する。
     * @returns 表編集オーバーレイに対応する要素の一覧。
     */
    () =>
      Array.from(
        { length: initialColumnCount },
        /**
         * 表編集オーバーレイのコールバックとして要素を処理する。
         * @returns 表編集オーバーレイのコールバックが生成する結果。
         */
        () => DEFAULT_COLUMN_WIDTH,
      ),
  );
  const overlayRef = useRef<HTMLDivElement>(null);
  const cellSelectionRef = useRef(new Map<string, CellSelection>());
  const columnResizeRef = useRef<ColumnResizeState | undefined>(undefined);
  const rowResizeRef = useRef<RowResizeState | undefined>(undefined);
  const editorDragRef = useRef<EditorDragState | undefined>(undefined);
  const editorResizeRef = useRef<EditorResizeState | undefined>(undefined);
  const selectionDragRef = useRef<
    | {
        /**
         * 表編集オーバーレイの位置・寸法・件数・時間を表す数値。
         */
        row: number;
        /**
         * 表編集オーバーレイの位置・寸法・件数・時間を表す数値。
         */
        column: number;
      }
    | undefined
  >(undefined);
  const gridDragRef = useRef<GridDragState | undefined>(undefined);
  const historyRef = useRef(createTableEditorHistory());
  const initialRenderedTextRef = useRef(renderTableEditorDraft(initial).text);
  const polishText = tableEditorPolishText(document.documentElement.lang);
  const columnCount = Math.max(
    1,
    alignments.length,
    ...rows.map(
      /**
       * 各行からlengthを取り出して一覧化する。
       * @param row - 行のlengthを参照する走査対象。
       * @returns lengthを取り出した変換結果の一覧。
       */
      (row) => row.length,
    ),
  );
  const normalizedSelection = normalizeTableGridRange(
    gridSelection,
    rows.length,
    columnCount,
  );
  const selectedCellCount = tableGridRangeCellCount(normalizedSelection);
  const hasGridRange = selectedCellCount > 1 || selectionKind !== "cells";
  const selectedColumns = Array.from(
    {
      length: normalizedSelection.toColumn - normalizedSelection.fromColumn + 1,
    },

    /**
     * 表編集オーバーレイのコールバックとして・を処理する。
     * @param _ - 引数位置を維持するための未使用値。
     * @param index - 配列・行列・文字列の要素位置を示す番号。
     * @returns 表編集オーバーレイのコールバックが生成する結果。
     */
    (_, index) => normalizedSelection.fromColumn + index,
  );
  const selectedAlignmentValues = selectedColumns.map(
    /**
     * selected・columnsの各要素を変換して一覧化する。
     * @param column - 表編集オーバーレイで走査または更新する要素。
     * @returns 入力要素から生成した変換結果の一覧。
     */
    (column) => alignments[column] ?? "none",
  );
  const currentAlignment = selectedAlignmentValues.every(
    /**
     * 表編集オーバーレイのコールバックとして値を処理する。
     * @param value - 検証・変換・保存の対象となる値。
     * @returns 表編集オーバーレイのコールバックが生成する結果。
     */
    (value) => value === selectedAlignmentValues[0],
  )
    ? selectedAlignmentValues[0]
    : undefined;
  const gridWidth =
    ROW_HEADER_WIDTH +
    Array.from(
      { length: columnCount },

      /**
       * 表編集オーバーレイのコールバックとして・を処理する。
       * @param _ - 引数位置を維持するための未使用値。
       * @param index - 配列・行列・文字列の要素位置を示す番号。
       * @returns 表編集オーバーレイのコールバックが生成する結果。
       */
      (_, index) => columnWidths[index] ?? DEFAULT_COLUMN_WIDTH,
    ).reduce(
      /**
       * 要素を順に加算して累積値を求める。
       * @param total - 累積値へ加算する要素。
       * @param width - 累積値へ加算する要素。
       * @returns 要素を集約した累積値。
       */
      (total, width) => total + width,
      0,
    );
  const cellCountLabel = `${rows.length} × ${columnCount}`;
  const currentRenderedText = renderTableEditorDraft(currentDraft()).text;
  const isDirty = currentRenderedText !== initialRenderedTextRef.current;
  const canUndo = historyRef.current.undo.length > 0;
  const canRedo = historyRef.current.redo.length > 0;
  const selectionSummary = createSelectionSummary();
  void historyRevision;
  const editorStyle: React.CSSProperties | undefined = editorPosition
    ? {
        width: `${editorSize.width}px`,
        height: `${editorSize.height}px`,
        position: "fixed",
        left: `${editorPosition.left}px`,
        top: `${editorPosition.top}px`,
        transform: "none",
      }
    : undefined;

  useEffect(
    /**
     * 依存状態の変化に応じて購読を更新し、解除処理を返す。
     * @returns 表編集オーバーレイのコールバックが生成する結果。
     */
    () => {
      const frame = requestAnimationFrame(
        /**
         * 次の描画フレームで表示更新を実行する。
         * @returns 表編集オーバーレイのコールバックが生成する結果。
         */
        () => focusCell(activeRow, activeColumn, false),
      );
      /**
       * 表編集オーバーレイのreturnを処理し、呼び出し側へ結果または副作用を返す。
       * @returns 表編集オーバーレイのreturnが生成する結果。
       */
      return () => cancelAnimationFrame(frame);
    },
    [],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns 表編集オーバーレイのコールバックが生成する結果。
     */
    () => {
      const onKeyDown = /**
       * keydownイベントでto・lower・caseを実行する。
       * @param event - ユーザー操作またはDOMから通知されたイベント。
       * @returns 副作用を完了し、値は返さない。
       */ (event: KeyboardEvent) => {
        const accelerator = event.ctrlKey || event.metaKey;
        const key = event.key.toLowerCase();
        const insideGrid =
          event.target instanceof Element &&
          Boolean(event.target.closest(".mve-table-editor-grid"));
        if (accelerator && key === "c" && insideGrid && hasGridRange) {
          event.preventDefault();
          event.stopImmediatePropagation();
          void copyTsv(true);
          return;
        }
        if (accelerator && key === "z") {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (event.shiftKey) redoDraft();
          else undoDraft();
          return;
        }
        if (accelerator && key === "y") {
          event.preventDefault();
          event.stopImmediatePropagation();
          redoDraft();
          return;
        }
        if (
          insideGrid &&
          hasGridRange &&
          !accelerator &&
          (event.key === "Delete" || event.key === "Backspace")
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          clearSelectedCells();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          requestClose();
        } else if (accelerator && event.key === "Enter") {
          event.preventDefault();
          event.stopImmediatePropagation();
          apply();
        }
      };
      window.addEventListener("keydown", onKeyDown, true);
      /**
       * UIイベントを表示または編集状態へ反映する。
       * @returns 副作用を完了し、値は返さない。
       */
      return () => window.removeEventListener("keydown", onKeyDown, true);
    },
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns 表編集オーバーレイのコールバックが生成する結果。
     */
    () => {
      const onMouseMove = /**
       * 表編集オーバーレイのイベントまたはメッセージを受け取り、状態を更新する。
       * @param event - ユーザー操作またはDOMから通知されたイベント。
       * @returns 表編集オーバーレイのon・mouse・moveが生成する結果。
       */ (event: MouseEvent) => {
        const resize = columnResizeRef.current;
        if (!resize) return;
        if (event.clientX !== resize.startX) resize.moved = true;
        const width = Math.max(
          MIN_COLUMN_WIDTH,
          Math.round(resize.startWidth + event.clientX - resize.startX),
        );
        setColumnWidths(
          /**
           * previousをifへ渡し、表編集オーバーレイの結果または副作用を処理する。
           * @param previous - 表編集オーバーレイへ渡す入力。
           * @returns 表編集オーバーレイのコールバックが生成する結果。
           */
          (previous) => {
            if (previous[resize.column] === width) return previous;
            const next = previous.slice();
            while (next.length <= resize.column)
              next.push(DEFAULT_COLUMN_WIDTH);
            next[resize.column] = width;
            return next;
          },
        );
      };

      const onMouseUp = /**
       * 表編集オーバーレイのイベントまたはメッセージを受け取り、状態を更新する。
       * @returns 表編集オーバーレイのon・mouse・upが生成する結果。
       */ () => {
        columnResizeRef.current = undefined;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
      /**
       * イベントでremove・event・listenerを実行する。
       * @returns 副作用を完了し、値は返さない。
       */
      return () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
    },
    [],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns 表編集オーバーレイのコールバックが生成する結果。
     */
    () => {
      const onPointerMove = /**
       * 表編集オーバーレイのイベントまたはメッセージを受け取り、状態を更新する。
       * @param event - ユーザー操作またはDOMから通知されたイベント。
       * @returns 表編集オーバーレイのon・pointer・moveが生成する結果。
       */ (event: PointerEvent) => {
        const editorResize = editorResizeRef.current;
        if (editorResize && event.pointerId === editorResize.pointerId) {
          const maxWidth = Math.max(
            1,
            window.innerWidth - editorResize.left - 16,
          );
          const maxHeight = Math.max(
            1,
            window.innerHeight - editorResize.top - 16,
          );
          const minWidth = Math.min(MIN_EDITOR_WIDTH, maxWidth);
          const minHeight = Math.min(MIN_EDITOR_HEIGHT, maxHeight);
          const width = Math.min(
            maxWidth,
            Math.max(
              minWidth,
              editorResize.startWidth + event.clientX - editorResize.startX,
            ),
          );
          const height = Math.min(
            maxHeight,
            Math.max(
              minHeight,
              editorResize.startHeight + event.clientY - editorResize.startY,
            ),
          );
          setEditorSize(
            /**
             * 表編集オーバーレイのコールバックとしてpreviousを処理する。
             * @param previous - 表編集オーバーレイへ渡す入力。
             * @returns 表編集オーバーレイのコールバックが生成する結果。
             */
            (previous) =>
              previous.width === width && previous.height === height
                ? previous
                : { width, height },
          );
          return;
        }
        const editorDrag = editorDragRef.current;
        if (editorDrag && event.pointerId === editorDrag.pointerId) {
          const maxLeft = Math.max(
            16,
            window.innerWidth - editorDrag.width - 16,
          );
          const maxTop = Math.max(
            16,
            window.innerHeight - editorDrag.height - 16,
          );
          const left = Math.min(
            maxLeft,
            Math.max(16, editorDrag.left + event.clientX - editorDrag.startX),
          );
          const top = Math.min(
            maxTop,
            Math.max(16, editorDrag.top + event.clientY - editorDrag.startY),
          );
          setEditorPosition(
            /**
             * 表編集オーバーレイのコールバックとしてpreviousを処理する。
             * @param previous - 表編集オーバーレイへ渡す入力。
             * @returns 表編集オーバーレイのコールバックが生成する結果。
             */
            (previous) =>
              previous?.left === left && previous.top === top
                ? previous
                : { left, top },
          );
          return;
        }
        const rowResize = rowResizeRef.current;
        if (!rowResize || event.pointerId !== rowResize.pointerId) return;
        if (event.clientY !== rowResize.startY) rowResize.moved = true;
        const height = Math.max(
          MIN_ROW_HEIGHT,
          Math.round(rowResize.startHeight + event.clientY - rowResize.startY),
        );
        setRowHeights(
          /**
           * previousをifへ渡し、表編集オーバーレイの結果または副作用を処理する。
           * @param previous - 表編集オーバーレイへ渡す入力。
           * @returns 表編集オーバーレイのコールバックが生成する結果。
           */
          (previous) => {
            if (previous[rowResize.row] === height) return previous;
            const next = previous.slice();
            while (next.length <= rowResize.row) next.push(undefined);
            next[rowResize.row] = height;
            return next;
          },
        );
      };

      const onPointerUp = /**
       * 表編集オーバーレイのイベントまたはメッセージを受け取り、状態を更新する。
       * @param event - ユーザー操作またはDOMから通知されたイベント。
       * @returns 表編集オーバーレイのon・pointer・upが生成する結果。
       */ (event: PointerEvent) => {
        selectionDragRef.current = undefined;
        if (editorResizeRef.current?.pointerId === event.pointerId) {
          editorResizeRef.current = undefined;
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
        }
        if (editorDragRef.current?.pointerId === event.pointerId) {
          editorDragRef.current = undefined;
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
        }
        if (rowResizeRef.current?.pointerId === event.pointerId) {
          rowResizeRef.current = undefined;
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
        }
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
      /**
       * イベントでremove・event・listenerを実行する。
       * @returns 副作用を完了し、値は返さない。
       */
      return () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
        selectionDragRef.current = undefined;
        editorResizeRef.current = undefined;
        editorDragRef.current = undefined;
        rowResizeRef.current = undefined;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
    },
    [],
  );

  const tsv = useMemo(
    /**
     * 要素をrender・table・editor・draftへ渡し、表編集オーバーレイの結果または副作用を処理する。
     * @returns 表編集オーバーレイのコールバックが生成する結果。
     */
    () => {
      const rendered = renderTableEditorDraft(currentDraft());
      return (
        markdownTableToTsv(rendered.text, {
          from: rendered.caretOffset,
          to: rendered.caretOffset,
        }) ?? ""
      );
    },
    [rows, alignments, activeRow, activeColumn],
  );

  /**
   * 表編集オーバーレイのcurrent・draftを処理し、呼び出し側へ結果または副作用を返す。
   * @returns 表編集オーバーレイのcurrent・draftが生成する結果。
   */
  function currentDraft(): TableEditorDraft {
    return {
      ...initial,
      rows,
      alignments: Array.from(
        { length: columnCount },

        /**
         * 表編集オーバーレイのコールバックとして・を処理する。
         * @param _ - 引数位置を維持するための未使用値。
         * @param index - 配列・行列・文字列の要素位置を示す番号。
         * @returns 表編集オーバーレイのコールバックが生成する結果。
         */
        (_, index) => alignments[index] ?? "none",
      ),
      activeRow,
      activeColumn,
    };
  }

  /**
   * 表編集の現在の行列状態を履歴保存用スナップショットへ複製する。
   * @returns 表編集の履歴へ保存する現在状態のスナップショット。
   */
  function currentHistorySnapshot(): TableEditorHistorySnapshot {
    return {
      rows: rows.map(
        /**
         * 各行からsliceを取り出して一覧化する。
         * @param row - 行のsliceを参照する走査対象。
         * @returns sliceを取り出した変換結果の一覧。
         */
        (row) => row.slice(),
      ),
      alignments: Array.from(
        { length: columnCount },

        /**
         * 表編集オーバーレイのコールバックとして・を処理する。
         * @param _ - 引数位置を維持するための未使用値。
         * @param index - 配列・行列・文字列の要素位置を示す番号。
         * @returns 副作用を完了し、値は返さない。
         */
        (_, index) => alignments[index] ?? "none",
      ),
      activeRow,
      activeColumn,
      rowHeights: rowHeights.slice(),
      columnWidths: Array.from(
        { length: columnCount },

        /**
         * 表編集オーバーレイのコールバックとして・を処理する。
         * @param _ - 引数位置を維持するための未使用値。
         * @param index - 配列・行列・文字列の要素位置を示す番号。
         * @returns 副作用を完了し、値は返さない。
         */
        (_, index) => columnWidths[index] ?? DEFAULT_COLUMN_WIDTH,
      ),
      gridSelection: { ...gridSelection },
      selectionKind,
    };
  }

  /**
   * 表編集オーバーレイのrecord・historyを処理し、呼び出し側へ結果または副作用を返す。
   * @returns 副作用を完了し、値は返さない。
   */
  function recordHistory(): void {
    recordTableEditorHistory(historyRef.current, currentHistorySnapshot());
    setHistoryRevision(
      /**
       * 表編集オーバーレイのコールバックとして値を処理する。
       * @param value - 検証・変換・保存の対象となる値。
       * @returns 副作用を完了し、値は返さない。
       */
      (value) => value + 1,
    );
  }

  /**
   * 表編集オーバーレイのundo・draftを処理し、呼び出し側へ結果または副作用を返す。
   * @returns 副作用を完了し、値は返さない。
   */
  function undoDraft(): void {
    const previous = undoTableEditorHistory(
      historyRef.current,
      currentHistorySnapshot(),
    );
    if (!previous) return;
    restoreHistorySnapshot(previous);
    setHistoryRevision(
      /**
       * 表編集オーバーレイのコールバックとして値を処理する。
       * @param value - 検証・変換・保存の対象となる値。
       * @returns 副作用を完了し、値は返さない。
       */
      (value) => value + 1,
    );
  }

  /**
   * 表編集オーバーレイのredo・draftを処理し、呼び出し側へ結果または副作用を返す。
   * @returns 副作用を完了し、値は返さない。
   */
  function redoDraft(): void {
    const next = redoTableEditorHistory(
      historyRef.current,
      currentHistorySnapshot(),
    );
    if (!next) return;
    restoreHistorySnapshot(next);
    setHistoryRevision(
      /**
       * 表編集オーバーレイのコールバックとして値を処理する。
       * @param value - 検証・変換・保存の対象となる値。
       * @returns 副作用を完了し、値は返さない。
       */
      (value) => value + 1,
    );
  }

  /**
   * 表編集オーバーレイの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param snapshot - 表編集オーバーレイへ渡す入力。
   * @returns 副作用を完了し、値は返さない。
   */
  function restoreHistorySnapshot(snapshot: TableEditorHistorySnapshot): void {
    const nextRows = snapshot.rows.map(
      /**
       * 各行からsliceを取り出して一覧化する。
       * @param row - 行のsliceを参照する走査対象。
       * @returns sliceを取り出した変換結果の一覧。
       */
      (row) => row.slice(),
    );
    const nextColumns = Math.max(
      1,
      snapshot.alignments.length,
      ...nextRows.map(
        /**
         * 各行からlengthを取り出して一覧化する。
         * @param row - 行のlengthを参照する走査対象。
         * @returns lengthを取り出した変換結果の一覧。
         */
        (row) => row.length,
      ),
    );
    const safeActiveRow = Math.max(
      0,
      Math.min(nextRows.length - 1, snapshot.activeRow),
    );
    const safeActiveColumn = Math.max(
      0,
      Math.min(nextColumns - 1, snapshot.activeColumn),
    );

    const clampRow = /**
     * 表編集オーバーレイの寸法、容量、位置、または計測値を求める。
     * @param row - 表編集オーバーレイで走査または更新する要素。
     * @returns 表編集オーバーレイで利用する数値。
     */ (row: number): number =>
      Math.max(0, Math.min(nextRows.length - 1, row));

    const clampColumn = /**
     * 表編集オーバーレイの寸法、容量、位置、または計測値を求める。
     * @param column - 表編集オーバーレイで走査または更新する要素。
     * @returns 表編集オーバーレイで利用する数値。
     */ (column: number): number =>
      Math.max(0, Math.min(nextColumns - 1, column));
    setRows(nextRows);
    setAlignments(
      Array.from(
        { length: nextColumns },

        /**
         * 表編集オーバーレイのコールバックとして・を処理する。
         * @param _ - 引数位置を維持するための未使用値。
         * @param index - 配列・行列・文字列の要素位置を示す番号。
         * @returns 表編集オーバーレイのコールバックが生成する結果。
         */
        (_, index) => snapshot.alignments[index] ?? "none",
      ),
    );
    setColumnWidths(
      Array.from(
        { length: nextColumns },

        /**
         * 表編集オーバーレイのコールバックとして・を処理する。
         * @param _ - 引数位置を維持するための未使用値。
         * @param index - 配列・行列・文字列の要素位置を示す番号。
         * @returns 副作用を完了し、値は返さない。
         */
        (_, index) => snapshot.columnWidths[index] ?? DEFAULT_COLUMN_WIDTH,
      ),
    );
    setRowHeights(
      Array.from(
        { length: nextRows.length },

        /**
         * 表編集オーバーレイのコールバックとして・を処理する。
         * @param _ - 引数位置を維持するための未使用値。
         * @param index - 配列・行列・文字列の要素位置を示す番号。
         * @returns 副作用を完了し、値は返さない。
         */
        (_, index) => snapshot.rowHeights[index],
      ),
    );
    setActiveRow(safeActiveRow);
    setActiveColumn(safeActiveColumn);
    setGridSelection({
      anchorRow: clampRow(snapshot.gridSelection.anchorRow),
      anchorColumn: clampColumn(snapshot.gridSelection.anchorColumn),
      focusRow: clampRow(snapshot.gridSelection.focusRow),
      focusColumn: clampColumn(snapshot.gridSelection.focusColumn),
    });
    setSelectionKind(snapshot.selectionKind);
    cellSelectionRef.current.clear();
    setStatus("");
  }

  /**
   * 表編集オーバーレイのsingle・cell・selectionを処理し、呼び出し側へ結果または副作用を返す。
   * @param row - 表編集オーバーレイで走査または更新する要素。
   * @param column - 表編集オーバーレイで走査または更新する要素。
   * @returns 副作用を完了し、値は返さない。
   */
  function singleCellSelection(row: number, column: number): void {
    setGridSelection({
      anchorRow: row,
      anchorColumn: column,
      focusRow: row,
      focusColumn: column,
    });
    setSelectionKind("cells");
  }

  /**
   * 表編集オーバーレイの表示または操作を開始する。
   * @param row - 表編集オーバーレイで走査または更新する要素。
   * @param column - 表編集オーバーレイで走査または更新する要素。
   * @param select - 表編集オーバーレイへ渡す入力。
   * @param rowCount - 表編集オーバーレイで走査または更新する要素。
   * @param columns - 表編集オーバーレイで走査または更新する要素。
   * @returns 副作用を完了し、値は返さない。
   */
  function focusCell(
    row: number,
    column: number,
    select = true,
    rowCount = rows.length,
    columns = columnCount,
  ): void {
    const safeRow = Math.max(0, Math.min(row, rowCount - 1));
    const safeColumn = Math.max(0, Math.min(column, columns - 1));
    setActiveRow(safeRow);
    setActiveColumn(safeColumn);
    singleCellSelection(safeRow, safeColumn);
    requestAnimationFrame(
      /**
       * 次の描画フレームで表示更新を実行する。
       * @returns 副作用を完了し、値は返さない。
       */
      () => {
        const element = overlayRef.current?.querySelector<HTMLTextAreaElement>(
          `[data-table-cell="${safeRow}:${safeColumn}"]`,
        );
        element?.focus();
        if (select && element) {
          element.select();
          cellSelectionRef.current.set(cellKey(safeRow, safeColumn), {
            from: 0,
            to: element.value.length,
          });
        }
      },
    );
  }

  /**
   * 表編集オーバーレイの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param next - 表編集オーバーレイの位置・寸法・件数・時間を表す数値。
   * @param captureHistory - 表編集オーバーレイの位置・寸法・件数・時間を表す数値。
   * @returns 副作用を完了し、値は返さない。
   */
  function replaceDraft(next: TableEditorDraft, captureHistory = true): void {
    const nextRows = next.rows.map(
      /**
       * 各行からsliceを取り出して一覧化する。
       * @param row - 行のsliceを参照する走査対象。
       * @returns sliceを取り出した変換結果の一覧。
       */
      (row) => row.slice(),
    );
    const nextColumns = Math.max(
      1,
      next.alignments.length,
      ...nextRows.map(
        /**
         * 各行からlengthを取り出して一覧化する。
         * @param row - 行のlengthを参照する走査対象。
         * @returns lengthを取り出した変換結果の一覧。
         */
        (row) => row.length,
      ),
    );
    if (nextRows.length > MAX_ROWS || nextColumns > MAX_COLUMNS) {
      setStatus(messages.app.tableEditor.rowColumnLimit(MAX_ROWS, MAX_COLUMNS));
      return;
    }
    const normalizedNext: TableEditorDraft = {
      ...next,
      rows: nextRows,
      alignments: Array.from(
        { length: nextColumns },

        /**
         * 表編集オーバーレイのコールバックとして・を処理する。
         * @param _ - 引数位置を維持するための未使用値。
         * @param index - 配列・行列・文字列の要素位置を示す番号。
         * @returns 表編集オーバーレイのコールバックが生成する結果。
         */
        (_, index) => next.alignments[index] ?? "none",
      ),
    };
    if (
      captureHistory &&
      renderTableEditorDraft(normalizedNext).text !== currentRenderedText
    ) {
      recordHistory();
    }
    setRows(normalizedNext.rows);
    setAlignments(normalizedNext.alignments);
    setColumnWidths(
      /**
       * previousをfromへ渡し、表編集オーバーレイの結果または副作用を処理する。
       * @param previous - 表編集オーバーレイへ渡す入力。
       * @returns 副作用を完了し、値は返さない。
       */
      (previous) =>
        Array.from(
          { length: nextColumns },

          /**
           * 表編集オーバーレイのコールバックとして・を処理する。
           * @param _ - 引数位置を維持するための未使用値。
           * @param index - 配列・行列・文字列の要素位置を示す番号。
           * @returns 副作用を完了し、値は返さない。
           */
          (_, index) => previous[index] ?? DEFAULT_COLUMN_WIDTH,
        ),
    );
    setRowHeights(
      /**
       * previousをfromへ渡し、表編集オーバーレイの結果または副作用を処理する。
       * @param previous - 表編集オーバーレイへ渡す入力。
       * @returns 副作用を完了し、値は返さない。
       */
      (previous) =>
        Array.from(
          { length: nextRows.length },
          /**
           * 表編集オーバーレイのコールバックとして・を処理する。
           * @param _ - 引数位置を維持するための未使用値。
           * @param index - 配列・行列・文字列の要素位置を示す番号。
           * @returns 副作用を完了し、値は返さない。
           */
          (_, index) => previous[index],
        ),
    );
    cellSelectionRef.current.clear();
    setActiveRow(next.activeRow);
    setActiveColumn(next.activeColumn);
    setStatus("");
    focusCell(
      next.activeRow,
      next.activeColumn,
      true,
      nextRows.length,
      nextColumns,
    );
  }

  /**
   * 表編集オーバーレイの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param row - 表編集オーバーレイで走査または更新する要素。
   * @param column - 表編集オーバーレイで走査または更新する要素。
   * @param value - 検証・変換・保存の対象となる値。
   * @returns 副作用を完了し、値は返さない。
   */
  function updateCell(row: number, column: number, value: string): void {
    const normalized = tableEditorCellStoredValue(
      value,
      rows[row]?.[column] ?? "",
    );
    if ((rows[row]?.[column] ?? "") === normalized) return;
    recordHistory();
    setRows(
      /**
       * previousをmapへ渡し、表編集オーバーレイの結果または副作用を処理する。
       * @param previous - 表編集オーバーレイへ渡す入力。
       * @returns 副作用を完了し、値は返さない。
       */
      (previous) =>
        previous.map(
          /**
           * 各currentをifへ渡し、変換結果を一覧化する。
           * @param current - 表編集オーバーレイへ渡す入力。
           * @param rowIndex - 表編集オーバーレイで走査または更新する要素。
           * @returns 入力要素から生成した変換結果の一覧。
           */
          (current, rowIndex) => {
            if (rowIndex !== row) return current;
            const next = Array.from(
              { length: columnCount },

              /**
               * 表編集オーバーレイのコールバックとして・を処理する。
               * @param _ - 引数位置を維持するための未使用値。
               * @param index - 配列・行列・文字列の要素位置を示す番号。
               * @returns 副作用を完了し、値は返さない。
               */
              (_, index) => current[index] ?? "",
            );
            next[column] = normalized;
            return next;
          },
        ),
    );
  }

  /**
   * 表編集オーバーレイのremember・cell・selectionを処理し、呼び出し側へ結果または副作用を返す。
   * @param row - 表編集オーバーレイで走査または更新する要素。
   * @param column - 表編集オーバーレイで走査または更新する要素。
   * @param element - 寸法または属性を読み取るDOM要素。
   * @returns 副作用を完了し、値は返さない。
   */
  function rememberCellSelection(
    row: number,
    column: number,
    element: HTMLTextAreaElement,
  ): void {
    setActiveRow(row);
    setActiveColumn(column);
    if (!selectionDragRef.current) singleCellSelection(row, column);
    cellSelectionRef.current.set(cellKey(row, column), {
      from: element.selectionStart,
      to: element.selectionEnd,
    });
  }

  /**
   * 表編集オーバーレイの表示または操作を開始する。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @param row - 表編集オーバーレイで走査または更新する要素。
   * @param column - 表編集オーバーレイで走査または更新する要素。
   * @returns 副作用を完了し、値は返さない。
   */
  function beginCellSelection(
    event: React.PointerEvent<HTMLTableCellElement>,
    row: number,
    column: number,
  ): void {
    if (event.button !== 0) return;
    if (
      event.target instanceof Element &&
      event.target.closest(".mve-table-editor-column-resizer")
    ) {
      return;
    }
    setActiveRow(row);
    setActiveColumn(column);
    setSelectionKind("cells");
    if (event.shiftKey) {
      event.preventDefault();
      selectionDragRef.current = undefined;
      setGridSelection(
        /**
         * 表編集オーバーレイのコールバックとしてpreviousを処理する。
         * @param previous - 表編集オーバーレイへ渡す入力。
         * @returns 副作用を完了し、値は返さない。
         */
        (previous) => ({
          ...previous,
          focusRow: row,
          focusColumn: column,
        }),
      );
      return;
    }
    selectionDragRef.current = { row, column };
    singleCellSelection(row, column);
  }

  /**
   * 表編集オーバーレイのextend・cell・selectionを処理し、呼び出し側へ結果または副作用を返す。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @param row - 表編集オーバーレイで走査または更新する要素。
   * @param column - 表編集オーバーレイで走査または更新する要素。
   * @returns 副作用を完了し、値は返さない。
   */
  function extendCellSelection(
    event: React.PointerEvent<HTMLTableCellElement>,
    row: number,
    column: number,
  ): void {
    const anchor = selectionDragRef.current;
    if (!anchor || (event.buttons & 1) === 0) return;
    setSelectionKind("cells");
    setGridSelection({
      anchorRow: anchor.row,
      anchorColumn: anchor.column,
      focusRow: row,
      focusColumn: column,
    });
    setActiveRow(row);
    setActiveColumn(column);
  }

  /**
   * 表編集オーバーレイのselect・rowを処理し、呼び出し側へ結果または副作用を返す。
   * @param row - 表編集オーバーレイで走査または更新する要素。
   * @returns 副作用を完了し、値は返さない。
   */
  function selectRow(row: number): void {
    setActiveRow(row);
    setActiveColumn(Math.min(activeColumn, columnCount - 1));
    setGridSelection({
      anchorRow: row,
      focusRow: row,
      anchorColumn: 0,
      focusColumn: columnCount - 1,
    });
    setSelectionKind("row");
  }

  /**
   * 表編集オーバーレイのselect・columnを処理し、呼び出し側へ結果または副作用を返す。
   * @param column - 表編集オーバーレイで走査または更新する要素。
   * @returns 副作用を完了し、値は返さない。
   */
  function selectColumn(column: number): void {
    setActiveColumn(column);
    setActiveRow(Math.min(activeRow, rows.length - 1));
    setGridSelection({
      anchorRow: 0,
      focusRow: rows.length - 1,
      anchorColumn: column,
      focusColumn: column,
    });
    setSelectionKind("column");
  }

  /**
   * 表編集オーバーレイのselect・all・cellsを処理し、呼び出し側へ結果または副作用を返す。
   * @returns 副作用を完了し、値は返さない。
   */
  function selectAllCells(): void {
    setActiveRow(0);
    setActiveColumn(0);
    setGridSelection({
      anchorRow: 0,
      focusRow: rows.length - 1,
      anchorColumn: 0,
      focusColumn: columnCount - 1,
    });
    setSelectionKind("all");
  }

  /**
   * 表編集オーバーレイの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @returns 副作用を完了し、値は返さない。
   */
  function clearSelectedCells(): void {
    let changed = false;
    for (
      let row = normalizedSelection.fromRow;
      row <= normalizedSelection.toRow && !changed;
      row += 1
    ) {
      for (
        let column = normalizedSelection.fromColumn;
        column <= normalizedSelection.toColumn;
        column += 1
      ) {
        if ((rows[row]?.[column] ?? "") !== "") {
          changed = true;
          break;
        }
      }
    }
    if (!changed) return;
    recordHistory();
    setRows(clearTableGridRange(rows, normalizedSelection));
    cellSelectionRef.current.clear();
    setStatus("");
  }

  /**
   * 表編集オーバーレイの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param row - 表編集オーバーレイで走査または更新する要素。
   * @param column - 表編集オーバーレイで走査または更新する要素。
   * @returns 副作用を完了し、値は返さない。
   */
  function insertLineBreak(row = activeRow, column = activeColumn): void {
    const value = rows[row]?.[column] ?? "";
    const displayValue = tableEditorCellDisplayValue(value);
    const selection = cellSelectionRef.current.get(cellKey(row, column));
    const edit = insertTableEditorLineBreak(
      value,
      tableEditorCellStoredOffsetFromDisplay(
        value,
        selection?.from ?? displayValue.length,
      ),
      tableEditorCellStoredOffsetFromDisplay(
        value,
        selection?.to ?? displayValue.length,
      ),
    );
    recordHistory();
    const key = cellKey(row, column);
    setRows(
      /**
       * previousをmapへ渡し、表編集オーバーレイの結果または副作用を処理する。
       * @param previous - 表編集オーバーレイへ渡す入力。
       * @returns 表編集オーバーレイのコールバックが生成する結果。
       */
      (previous) =>
        previous.map(
          /**
           * 各currentをifへ渡し、変換結果を一覧化する。
           * @param current - 表編集オーバーレイへ渡す入力。
           * @param rowIndex - 表編集オーバーレイで走査または更新する要素。
           * @returns 入力要素から生成した変換結果の一覧。
           */
          (current, rowIndex) => {
            if (rowIndex !== row) return current;
            const next = Array.from(
              { length: columnCount },

              /**
               * 表編集オーバーレイのコールバックとして・を処理する。
               * @param _ - 引数位置を維持するための未使用値。
               * @param index - 配列・行列・文字列の要素位置を示す番号。
               * @returns 条件が成立したかを示す真偽値。
               */
              (_, index) => current[index] ?? "",
            );
            next[column] = edit.value;
            return next;
          },
        ),
    );
    setActiveRow(row);
    setActiveColumn(column);
    singleCellSelection(row, column);
    const displayCaretOffset = tableEditorCellDisplayOffsetFromStored(
      edit.value,
      edit.caretOffset,
    );
    cellSelectionRef.current.set(key, {
      from: displayCaretOffset,
      to: displayCaretOffset,
    });
    requestAnimationFrame(
      /**
       * 次の描画フレームで表示更新を実行する。
       * @returns 条件が成立したかを示す真偽値。
       */
      () => {
        const element = overlayRef.current?.querySelector<HTMLTextAreaElement>(
          `[data-table-cell="${key}"]`,
        );
        element?.focus();
        element?.setSelectionRange(displayCaretOffset, displayCaretOffset);
        autoFitRow(row);
      },
    );
  }

  /**
   * 表編集オーバーレイの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param row - 表編集オーバーレイで走査または更新する要素。
   * @param column - 表編集オーバーレイで走査または更新する要素。
   * @param displayOffset - 表編集オーバーレイの位置・寸法・件数・時間を表す数値。
   * @returns 条件が成立したかを示す真偽値。
   */
  function deleteLineBreakBeforeDisplayOffset(
    row: number,
    column: number,
    displayOffset: number,
  ): boolean {
    const value = rows[row]?.[column] ?? "";
    const edit = deleteTableEditorLineBreakBeforeDisplayOffset(
      value,
      displayOffset,
    );
    if (!edit) return false;

    recordHistory();
    setRows(
      /**
       * previousをmapへ渡し、表編集オーバーレイの結果または副作用を処理する。
       * @param previous - 表編集オーバーレイへ渡す入力。
       * @returns 表編集オーバーレイのコールバックが生成する結果。
       */
      (previous) =>
        previous.map(
          /**
           * 各currentをifへ渡し、変換結果を一覧化する。
           * @param current - 表編集オーバーレイへ渡す入力。
           * @param rowIndex - 表編集オーバーレイで走査または更新する要素。
           * @returns 入力要素から生成した変換結果の一覧。
           */
          (current, rowIndex) => {
            if (rowIndex !== row) return current;
            const next = Array.from(
              { length: columnCount },

              /**
               * 表編集オーバーレイのコールバックとして・を処理する。
               * @param _ - 引数位置を維持するための未使用値。
               * @param index - 配列・行列・文字列の要素位置を示す番号。
               * @returns 副作用を完了し、値は返さない。
               */
              (_, index) => current[index] ?? "",
            );
            next[column] = edit.value;
            return next;
          },
        ),
    );
    const key = cellKey(row, column);
    setActiveRow(row);
    setActiveColumn(column);
    singleCellSelection(row, column);
    cellSelectionRef.current.set(key, {
      from: edit.caretOffset,
      to: edit.caretOffset,
    });
    requestAnimationFrame(
      /**
       * 次の描画フレームで表示更新を実行する。
       * @returns 副作用を完了し、値は返さない。
       */
      () => {
        const element = overlayRef.current?.querySelector<HTMLTextAreaElement>(
          `[data-table-cell="${key}"]`,
        );
        element?.focus();
        element?.setSelectionRange(edit.caretOffset, edit.caretOffset);
        autoFitRow(row);
      },
    );
    return true;
  }

  /**
   * 表編集オーバーレイの表示または操作を開始する。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @param column - 表編集オーバーレイで走査または更新する要素。
   * @returns 副作用を完了し、値は返さない。
   */
  function startColumnResize(
    event: React.MouseEvent<HTMLDivElement>,
    column: number,
  ): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    columnResizeRef.current = {
      column,
      startX: event.clientX,
      startWidth: columnWidths[column] ?? DEFAULT_COLUMN_WIDTH,
      moved: false,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  /**
   * 表編集オーバーレイのauto・fit・columnを処理し、呼び出し側へ結果または副作用を返す。
   * @param column - 表編集オーバーレイで走査または更新する要素。
   * @returns 副作用を完了し、値は返さない。
   */
  function autoFitColumn(column: number): void {
    const editor = overlayRef.current;
    if (!editor) return;
    const cells = Array.from(
      editor.querySelectorAll<HTMLTextAreaElement>("textarea[data-table-cell]"),
    ).filter(
      /**
       * datasetの条件を満たすセルだけを残す。
       * @param cell - セルのdatasetを参照する走査対象。
       * @returns 条件を満たした要素だけを含む一覧。
       */
      (cell) =>
        parseTableCellAddress(cell.dataset.tableCell)?.column === column,
    );
    const sample = cells[0];
    if (!sample) return;

    const style = getComputedStyle(sample);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const letterSpacing = Number.parseFloat(style.letterSpacing) || 0;

    const measure = /**
     * 表編集オーバーレイの寸法、容量、位置、または計測値を求める。
     * @param value - 検証・変換・保存の対象となる値。
     * @returns 表編集オーバーレイで利用する数値。
     */ (value: string): number => {
      if (!context) return Array.from(value).length * 8;
      context.font = [
        style.fontStyle,
        style.fontVariant,
        style.fontWeight,
        style.fontSize,
        style.fontFamily,
      ].join(" ");
      return (
        context.measureText(value).width +
        Math.max(0, Array.from(value).length - 1) * letterSpacing
      );
    };
    const horizontalChrome =
      (Number.parseFloat(style.paddingLeft) || 0) +
      (Number.parseFloat(style.paddingRight) || 0) +
      8;
    const width = calculateAutoFitColumnWidth(
      cells.map(
        /**
         * 各セルから値を取り出して一覧化する。
         * @param cell - セルの値を参照する走査対象。
         * @returns 値を取り出した変換結果の一覧。
         */
        (cell) => cell.value,
      ),
      measure,
      horizontalChrome,
      MIN_COLUMN_WIDTH,
      MAX_AUTO_COLUMN_WIDTH,
    );
    setColumnWidths(
      /**
       * previousをsliceへ渡し、表編集オーバーレイの結果または副作用を処理する。
       * @param previous - 表編集オーバーレイへ渡す入力。
       * @returns 副作用を完了し、値は返さない。
       */
      (previous) => {
        const next = previous.slice();
        while (next.length <= column) next.push(DEFAULT_COLUMN_WIDTH);
        if (next[column] === width) return previous;
        next[column] = width;
        return next;
      },
    );
  }

  /**
   * 表編集オーバーレイのauto・fit・column・on・mouse・upを処理し、呼び出し側へ結果または副作用を返す。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @param column - 表編集オーバーレイで走査または更新する要素。
   * @returns 副作用を完了し、値は返さない。
   */
  function autoFitColumnOnMouseUp(
    event: React.MouseEvent<HTMLDivElement>,
    column: number,
  ): void {
    const resize = columnResizeRef.current;
    if (!resize || resize.column !== column || resize.moved) return;
    event.preventDefault();
    event.stopPropagation();
    autoFitColumn(column);
  }

  /**
   * 表編集オーバーレイのresize・column・by・keyboardを処理し、呼び出し側へ結果または副作用を返す。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @param column - 表編集オーバーレイで走査または更新する要素。
   * @returns 副作用を完了し、値は返さない。
   */
  function resizeColumnByKeyboard(
    event: React.KeyboardEvent<HTMLDivElement>,
    column: number,
  ): void {
    const delta =
      event.key === "ArrowLeft" ? -12 : event.key === "ArrowRight" ? 12 : 0;
    if (!delta) return;
    event.preventDefault();
    setColumnWidths(
      /**
       * previousをsliceへ渡し、表編集オーバーレイの結果または副作用を処理する。
       * @param previous - 表編集オーバーレイへ渡す入力。
       * @returns 副作用を完了し、値は返さない。
       */
      (previous) => {
        const next = previous.slice();
        while (next.length <= column) next.push(DEFAULT_COLUMN_WIDTH);
        next[column] = Math.max(MIN_COLUMN_WIDTH, next[column] + delta);
        return next;
      },
    );
  }

  /**
   * 表編集オーバーレイの表示または操作を開始する。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @param row - 表編集オーバーレイで走査または更新する要素。
   * @returns 副作用を完了し、値は返さない。
   */
  function startRowResize(
    event: React.PointerEvent<HTMLDivElement>,
    row: number,
  ): void {
    if (event.button !== 0) return;
    const rowElement = event.currentTarget.closest("tr");
    if (!rowElement) return;
    event.preventDefault();
    event.stopPropagation();
    rowResizeRef.current = {
      row,
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight:
        rowHeights[row] ??
        Math.round(rowElement.getBoundingClientRect().height),
      moved: false,
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  /**
   * 表編集オーバーレイのauto・fit・rowを処理し、呼び出し側へ結果または副作用を返す。
   * @param row - 表編集オーバーレイで走査または更新する要素。
   * @returns 副作用を完了し、値は返さない。
   */
  function autoFitRow(row: number): void {
    const editor = overlayRef.current;
    if (!editor) return;
    const cells = Array.from(
      editor.querySelectorAll<HTMLTextAreaElement>("textarea[data-table-cell]"),
    ).filter(
      /**
       * datasetの条件を満たすセルだけを残す。
       * @param cell - セルのdatasetを参照する走査対象。
       * @returns 条件を満たした要素だけを含む一覧。
       */
      (cell) => parseTableCellAddress(cell.dataset.tableCell)?.row === row,
    );
    if (!cells.length) return;

    const heights = cells.map(
      /**
       * 各セルからclone・nodeを取り出して一覧化する。
       * @param cell - セルのclone・nodeを参照する走査対象。
       * @returns clone・nodeを取り出した変換結果の一覧。
       */
      (cell) => {
        const clone = cell.cloneNode(false) as HTMLTextAreaElement;
        const width = Math.max(1, cell.getBoundingClientRect().width);
        clone.value = cell.value;
        clone.style.position = "fixed";
        clone.style.left = "-10000px";
        clone.style.top = "0";
        clone.style.width = `${width}px`;
        clone.style.height = "auto";
        clone.style.minHeight = "0";
        clone.style.maxHeight = "none";
        clone.style.overflow = "hidden";
        clone.style.visibility = "hidden";
        clone.style.pointerEvents = "none";
        document.body.appendChild(clone);
        const height = Math.max(clone.scrollHeight, cell.scrollHeight);
        clone.remove();
        return height + AUTO_FIT_ROW_VERTICAL_BUFFER;
      },
    );
    const height = calculateAutoFitRowHeight(heights);
    setRowHeights(
      /**
       * previousをsliceへ渡し、表編集オーバーレイの結果または副作用を処理する。
       * @param previous - 表編集オーバーレイへ渡す入力。
       * @returns 副作用を完了し、値は返さない。
       */
      (previous) => {
        const next = previous.slice();
        while (next.length <= row) next.push(undefined);
        if (next[row] === height) return previous;
        next[row] = height;
        return next;
      },
    );
  }

  /**
   * 表編集オーバーレイのauto・fit・row・on・pointer・upを処理し、呼び出し側へ結果または副作用を返す。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @param row - 表編集オーバーレイで走査または更新する要素。
   * @returns 副作用を完了し、値は返さない。
   */
  function autoFitRowOnPointerUp(
    event: React.PointerEvent<HTMLDivElement>,
    row: number,
  ): void {
    const resize = rowResizeRef.current;
    if (
      !resize ||
      resize.row !== row ||
      resize.pointerId !== event.pointerId ||
      resize.moved ||
      event.type === "pointercancel"
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    autoFitRow(row);
  }

  /**
   * 表編集オーバーレイのresize・row・by・keyboardを処理し、呼び出し側へ結果または副作用を返す。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @param row - 表編集オーバーレイで走査または更新する要素。
   * @returns 副作用を完了し、値は返さない。
   */
  function resizeRowByKeyboard(
    event: React.KeyboardEvent<HTMLDivElement>,
    row: number,
  ): void {
    const delta =
      event.key === "ArrowUp" ? -12 : event.key === "ArrowDown" ? 12 : 0;
    if (!delta) return;
    const rowElement = event.currentTarget.closest("tr");
    if (!rowElement) return;
    event.preventDefault();
    const height = Math.max(
      MIN_ROW_HEIGHT,
      (rowHeights[row] ??
        Math.round(rowElement.getBoundingClientRect().height)) + delta,
    );
    setRowHeights(
      /**
       * previousをsliceへ渡し、表編集オーバーレイの結果または副作用を処理する。
       * @param previous - 表編集オーバーレイへ渡す入力。
       * @returns 副作用を完了し、値は返さない。
       */
      (previous) => {
        const next = previous.slice();
        while (next.length <= row) next.push(undefined);
        next[row] = height;
        return next;
      },
    );
  }

  /**
   * 表編集オーバーレイの表示または操作を開始する。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @returns 副作用を完了し、値は返さない。
   */
  function startEditorDrag(event: React.PointerEvent<HTMLElement>): void {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button"))
      return;
    const element = overlayRef.current;
    if (!element) return;
    event.preventDefault();
    const bounds = element.getBoundingClientRect();
    setEditorPosition({ left: bounds.left, top: bounds.top });
    setEditorSize({ width: bounds.width, height: bounds.height });
    editorDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
    };
    document.body.style.cursor = "move";
    document.body.style.userSelect = "none";
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  /**
   * 表編集オーバーレイの表示または操作を開始する。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @returns 副作用を完了し、値は返さない。
   */
  function startEditorResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    const element = overlayRef.current;
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = element.getBoundingClientRect();
    setEditorPosition({ left: bounds.left, top: bounds.top });
    setEditorSize({ width: bounds.width, height: bounds.height });
    editorResizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: bounds.width,
      startHeight: bounds.height,
      left: bounds.left,
      top: bounds.top,
    };
    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  /**
   * 表編集オーバーレイのresize・editor・by・keyboardを処理し、呼び出し側へ結果または副作用を返す。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @returns 副作用を完了し、値は返さない。
   */
  function resizeEditorByKeyboard(
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void {
    const widthDelta =
      event.key === "ArrowLeft" ? -12 : event.key === "ArrowRight" ? 12 : 0;
    const heightDelta =
      event.key === "ArrowUp" ? -12 : event.key === "ArrowDown" ? 12 : 0;
    if (!widthDelta && !heightDelta) return;
    const element = overlayRef.current;
    if (!element) return;
    event.preventDefault();
    const bounds = element.getBoundingClientRect();
    const position = editorPosition ?? { left: bounds.left, top: bounds.top };
    const maxWidth = Math.max(1, window.innerWidth - position.left - 16);
    const maxHeight = Math.max(1, window.innerHeight - position.top - 16);
    const minWidth = Math.min(MIN_EDITOR_WIDTH, maxWidth);
    const minHeight = Math.min(MIN_EDITOR_HEIGHT, maxHeight);
    setEditorPosition(position);
    setEditorSize({
      width: Math.min(maxWidth, Math.max(minWidth, bounds.width + widthDelta)),
      height: Math.min(
        maxHeight,
        Math.max(minHeight, bounds.height + heightDelta),
      ),
    });
  }

  /**
   * 表編集オーバーレイの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param action - 表編集オーバーレイへ渡す入力。
   * @returns 副作用を完了し、値は返さない。
   */
  function applySharedTableAction(action: MarkdownTableAction): void {
    const rendered = renderTableEditorDraft(currentDraft());
    const edit = applyMarkdownTableAction(
      rendered.text,
      { from: rendered.caretOffset, to: rendered.caretOffset },
      action,
    );
    if (!edit) return;
    const next = readTableEditorDraft(edit.text, edit.selection.from);
    if (next) replaceDraft(next);
  }

  /**
   * 表編集オーバーレイの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param action - 表編集オーバーレイへ渡す入力。
   * @returns 副作用を完了し、値は返さない。
   */
  function applySharedAlignmentAction(
    action: "alignLeft" | "alignCenter" | "alignRight",
  ): void {
    let working = currentDraft();
    for (const column of selectedColumns) {
      const positioned: TableEditorDraft = {
        ...working,
        activeRow: Math.min(activeRow, working.rows.length - 1),
        activeColumn: column,
      };
      const rendered = renderTableEditorDraft(positioned);
      const edit = applyMarkdownTableAction(
        rendered.text,
        { from: rendered.caretOffset, to: rendered.caretOffset },
        action,
      );
      if (!edit) return;
      const next = readTableEditorDraft(edit.text, edit.selection.from);
      if (!next) return;
      working = next;
    }
    working.activeRow = Math.min(activeRow, working.rows.length - 1);
    working.activeColumn = Math.min(
      activeColumn,
      working.alignments.length - 1,
    );
    if (renderTableEditorDraft(working).text === currentRenderedText) return;
    recordHistory();
    setRows(
      working.rows.map(
        /**
         * 各行からsliceを取り出して一覧化する。
         * @param row - 行のsliceを参照する走査対象。
         * @returns sliceを取り出した変換結果の一覧。
         */
        (row) => row.slice(),
      ),
    );
    setAlignments(working.alignments.slice());
    setActiveRow(working.activeRow);
    setActiveColumn(working.activeColumn);
    cellSelectionRef.current.clear();
    setStatus("");
  }

  /**
   * 表編集オーバーレイの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @returns 副作用を完了し、値は返さない。
   */
  function clearAlignment(): void {
    if (
      selectedColumns.every(
        /**
         * 表編集オーバーレイのコールバックとして列を処理する。
         * @param column - 表編集オーバーレイで走査または更新する要素。
         * @returns 副作用を完了し、値は返さない。
         */
        (column) => (alignments[column] ?? "none") === "none",
      )
    ) {
      return;
    }
    recordHistory();
    const selected = new Set(selectedColumns);
    setAlignments(
      /**
       * previousをfromへ渡し、表編集オーバーレイの結果または副作用を処理する。
       * @param previous - 表編集オーバーレイへ渡す入力。
       * @returns 副作用を完了し、値は返さない。
       */
      (previous) =>
        Array.from(
          { length: columnCount },
          /**
           * ・をhasへ渡し、表編集オーバーレイの結果または副作用を処理する。
           * @param _ - 引数位置を維持するための未使用値。
           * @param index - 配列・行列・文字列の要素位置を示す番号。
           * @returns 副作用を完了し、値は返さない。
           */
          (_, index) =>
            selected.has(index) ? "none" : (previous[index] ?? "none"),
        ),
    );
  }

  /**
   * 表編集オーバーレイの要素を規則に従って並べ替える。
   * @param direction - 表編集オーバーレイへ渡す入力。
   * @returns 副作用を完了し、値は返さない。
   */
  function moveCell(direction: 1 | -1): void {
    const flat = activeRow * columnCount + activeColumn + direction;
    const wrapped =
      (flat + rows.length * columnCount) % (rows.length * columnCount);
    focusCell(Math.floor(wrapped / columnCount), wrapped % columnCount);
  }

  /**
   * 表編集オーバーレイの要素を規則に従って並べ替える。
   * @param direction - 表編集オーバーレイへ渡す入力。
   * @returns 副作用を完了し、値は返さない。
   */
  function moveVertical(direction: 1 | -1): void {
    focusCell(
      Math.max(0, Math.min(rows.length - 1, activeRow + direction)),
      activeColumn,
    );
  }

  /**
   * 表編集オーバーレイの要素を規則に従って並べ替える。
   * @param source - 解析・描画・変換の起点となる本文。
   * @param target - 表編集オーバーレイで扱う数値。
   * @returns 副作用を完了し、値は返さない。
   */
  function moveRow(source: number, target: number): void {
    const safeTarget = Math.max(1, Math.min(rows.length - 1, target));
    if (source <= 0 || source >= rows.length || source === safeTarget) return;
    recordHistory();
    setRows(moveTableGridRow(rows, source, safeTarget));
    setRowHeights(
      /**
       * previousをmove・table・grid・itemへ渡し、表編集オーバーレイの結果または副作用を処理する。
       * @param previous - 表編集オーバーレイへ渡す入力。
       * @returns 副作用を完了し、値は返さない。
       */
      (previous) => moveTableGridItem(previous, source, safeTarget),
    );
    setActiveRow(safeTarget);
    setGridSelection({
      anchorRow: safeTarget,
      focusRow: safeTarget,
      anchorColumn: 0,
      focusColumn: columnCount - 1,
    });
    setSelectionKind("row");
    cellSelectionRef.current.clear();
    setStatus("");
  }

  /**
   * 表編集オーバーレイの要素を規則に従って並べ替える。
   * @param source - 解析・描画・変換の起点となる本文。
   * @param target - 表編集オーバーレイで扱う数値。
   * @returns 副作用を完了し、値は返さない。
   */
  function moveColumn(source: number, target: number): void {
    const safeTarget = Math.max(0, Math.min(columnCount - 1, target));
    if (source < 0 || source >= columnCount || source === safeTarget) return;
    const moved = moveTableGridColumn(rows, alignments, source, safeTarget);
    recordHistory();
    setRows(moved.rows);
    setAlignments(moved.alignments as TableEditorAlignment[]);
    setColumnWidths(
      /**
       * previousをmove・table・grid・itemへ渡し、表編集オーバーレイの結果または副作用を処理する。
       * @param previous - 表編集オーバーレイへ渡す入力。
       * @returns 副作用を完了し、値は返さない。
       */
      (previous) => moveTableGridItem(previous, source, safeTarget),
    );
    setActiveColumn(safeTarget);
    setGridSelection({
      anchorRow: 0,
      focusRow: rows.length - 1,
      anchorColumn: safeTarget,
      focusColumn: safeTarget,
    });
    setSelectionKind("column");
    cellSelectionRef.current.clear();
    setStatus("");
  }

  /**
   * 表編集オーバーレイのduplicate・selected・rowsを処理し、呼び出し側へ結果または副作用を返す。
   * @returns 副作用を完了し、値は返さない。
   */
  function duplicateSelectedRows(): void {
    const fromRow = normalizedSelection.fromRow;
    const toRow = normalizedSelection.toRow;
    if (fromRow === 0) return;
    const copyCount = toRow - fromRow + 1;
    if (rows.length + copyCount > MAX_ROWS) {
      setStatus(messages.app.tableEditor.rowColumnLimit(MAX_ROWS, MAX_COLUMNS));
      return;
    }
    recordHistory();
    const nextRows = duplicateTableGridRows(rows, fromRow, toRow);
    const sourceHeights = rowHeights.slice(fromRow, toRow + 1);
    const insertAt = Math.max(1, toRow + 1);
    const nextHeights = rowHeights.slice();
    nextHeights.splice(insertAt, 0, ...sourceHeights);
    const selectedColumn = Math.min(activeColumn, columnCount - 1);
    setRows(nextRows);
    setRowHeights(
      Array.from(
        { length: nextRows.length },
        /**
         * 表編集オーバーレイのコールバックとして・を処理する。
         * @param _ - 引数位置を維持するための未使用値。
         * @param index - 配列・行列・文字列の要素位置を示す番号。
         * @returns 副作用を完了し、値は返さない。
         */
        (_, index) => nextHeights[index],
      ),
    );
    setActiveRow(insertAt);
    setActiveColumn(selectedColumn);
    setGridSelection({
      anchorRow: insertAt,
      focusRow: insertAt + copyCount - 1,
      anchorColumn: 0,
      focusColumn: columnCount - 1,
    });
    setSelectionKind("row");
    cellSelectionRef.current.clear();
    setStatus("");
  }

  /**
   * 表編集オーバーレイのduplicate・selected・columnsを処理し、呼び出し側へ結果または副作用を返す。
   * @returns 副作用を完了し、値は返さない。
   */
  function duplicateSelectedColumns(): void {
    const fromColumn = normalizedSelection.fromColumn;
    const toColumn = normalizedSelection.toColumn;
    const copyCount = toColumn - fromColumn + 1;
    if (columnCount + copyCount > MAX_COLUMNS) {
      setStatus(messages.app.tableEditor.rowColumnLimit(MAX_ROWS, MAX_COLUMNS));
      return;
    }
    recordHistory();
    const duplicated = duplicateTableGridColumns(
      rows,
      alignments,
      fromColumn,
      toColumn,
    );
    const insertAt = toColumn + 1;
    const nextWidths = Array.from(
      { length: columnCount },

      /**
       * 表編集オーバーレイのコールバックとして・を処理する。
       * @param _ - 引数位置を維持するための未使用値。
       * @param index - 配列・行列・文字列の要素位置を示す番号。
       * @returns 副作用を完了し、値は返さない。
       */
      (_, index) => columnWidths[index] ?? DEFAULT_COLUMN_WIDTH,
    );
    nextWidths.splice(
      insertAt,
      0,
      ...nextWidths.slice(fromColumn, toColumn + 1),
    );
    const selectedRow = Math.min(activeRow, rows.length - 1);
    setRows(duplicated.rows);
    setAlignments(duplicated.alignments as TableEditorAlignment[]);
    setColumnWidths(nextWidths);
    setActiveRow(selectedRow);
    setActiveColumn(insertAt);
    setGridSelection({
      anchorRow: 0,
      focusRow: rows.length - 1,
      anchorColumn: insertAt,
      focusColumn: insertAt + copyCount - 1,
    });
    setSelectionKind("column");
    cellSelectionRef.current.clear();
    setStatus("");
  }

  /**
   * 表編集オーバーレイの表示または操作を開始する。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @param row - 表編集オーバーレイで走査または更新する要素。
   * @returns 副作用を完了し、値は返さない。
   */
  function startRowDrag(
    event: React.DragEvent<HTMLElement>,
    row: number,
  ): void {
    if (row <= 0) return;
    selectRow(row);
    gridDragRef.current = { kind: "row", source: row };
    setDragTarget({ kind: "row", index: row });
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `mve-table-row:${row}`);
  }

  /**
   * 表編集オーバーレイの表示または操作を開始する。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @param column - 表編集オーバーレイで走査または更新する要素。
   * @returns 副作用を完了し、値は返さない。
   */
  function startColumnDrag(
    event: React.DragEvent<HTMLElement>,
    column: number,
  ): void {
    selectColumn(column);
    gridDragRef.current = { kind: "column", source: column };
    setDragTarget({ kind: "column", index: column });
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `mve-table-column:${column}`);
  }

  /**
   * 表編集オーバーレイの条件を判定する。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @param row - 表編集オーバーレイで走査または更新する要素。
   * @returns 副作用を完了し、値は返さない。
   */
  function allowRowDrop(event: React.DragEvent, row: number): void {
    if (row <= 0 || gridDragRef.current?.kind !== "row") return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragTarget(
      /**
       * 表編集オーバーレイのコールバックとしてpreviousを処理する。
       * @param previous - 表編集オーバーレイへ渡す入力。
       * @returns 副作用を完了し、値は返さない。
       */
      (previous) =>
        previous?.kind === "row" && previous.index === row
          ? previous
          : { kind: "row", index: row },
    );
  }

  /**
   * 表編集オーバーレイの条件を判定する。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @param column - 表編集オーバーレイで走査または更新する要素。
   * @returns 副作用を完了し、値は返さない。
   */
  function allowColumnDrop(event: React.DragEvent, column: number): void {
    if (gridDragRef.current?.kind !== "column") return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragTarget(
      /**
       * 表編集オーバーレイのコールバックとしてpreviousを処理する。
       * @param previous - 表編集オーバーレイへ渡す入力。
       * @returns 副作用を完了し、値は返さない。
       */
      (previous) =>
        previous?.kind === "column" && previous.index === column
          ? previous
          : { kind: "column", index: column },
    );
  }

  /**
   * 表編集オーバーレイのdrop・rowを処理し、呼び出し側へ結果または副作用を返す。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @param row - 表編集オーバーレイで走査または更新する要素。
   * @returns 副作用を完了し、値は返さない。
   */
  function dropRow(event: React.DragEvent, row: number): void {
    const drag = gridDragRef.current;
    if (drag?.kind !== "row" || row <= 0) return;
    event.preventDefault();
    moveRow(drag.source, row);
    endGridDrag();
  }

  /**
   * 表編集オーバーレイのdrop・columnを処理し、呼び出し側へ結果または副作用を返す。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @param column - 表編集オーバーレイで走査または更新する要素。
   * @returns 副作用を完了し、値は返さない。
   */
  function dropColumn(event: React.DragEvent, column: number): void {
    const drag = gridDragRef.current;
    if (drag?.kind !== "column") return;
    event.preventDefault();
    moveColumn(drag.source, column);
    endGridDrag();
  }

  /**
   * 表編集オーバーレイのend・grid・dragを処理し、呼び出し側へ結果または副作用を返す。
   * @returns 副作用を完了し、値は返さない。
   */
  function endGridDrag(): void {
    gridDragRef.current = undefined;
    setDragTarget(undefined);
  }

  /**
   * 表編集オーバーレイのイベントまたはメッセージを受け取り、状態を更新する。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @param row - 表編集オーバーレイで走査または更新する要素。
   * @returns 副作用を完了し、値は返さない。
   */
  function handleRowDragKey(
    event: React.KeyboardEvent<HTMLElement>,
    row: number,
  ): void {
    if (!event.altKey) return;
    const target =
      event.key === "ArrowUp"
        ? row - 1
        : event.key === "ArrowDown"
          ? row + 1
          : row;
    if (target === row || target <= 0 || target >= rows.length) return;
    event.preventDefault();
    moveRow(row, target);
  }

  /**
   * 表編集オーバーレイのイベントまたはメッセージを受け取り、状態を更新する。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @param column - 表編集オーバーレイで走査または更新する要素。
   * @returns 副作用を完了し、値は返さない。
   */
  function handleColumnDragKey(
    event: React.KeyboardEvent<HTMLElement>,
    column: number,
  ): void {
    if (!event.altKey) return;
    const target =
      event.key === "ArrowLeft"
        ? column - 1
        : event.key === "ArrowRight"
          ? column + 1
          : column;
    if (target === column || target < 0 || target >= columnCount) return;
    event.preventDefault();
    moveColumn(column, target);
  }

  /**
   * 表編集オーバーレイのpaste・tsvを処理し、呼び出し側へ結果または副作用を返す。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @returns 副作用を完了し、値は返さない。
   */
  function pasteTsv(event: React.ClipboardEvent<HTMLTextAreaElement>): void {
    const value = event.clipboardData.getData("text/plain");
    if (!/[\t\r\n]/.test(value)) return;
    const targetRow = hasGridRange ? normalizedSelection.fromRow : activeRow;
    const targetColumn = hasGridRange
      ? normalizedSelection.fromColumn
      : activeColumn;
    const rendered = renderTableEditorDraft({
      ...currentDraft(),
      activeRow: targetRow,
      activeColumn: targetColumn,
    });
    const edit = applyMarkdownTableTsv(
      rendered.text,
      { from: rendered.caretOffset, to: rendered.caretOffset },
      value,
    );
    if (!edit) return;
    const next = readTableEditorDraft(edit.text, edit.selection.from);
    if (!next) return;
    event.preventDefault();
    replaceDraft(next);
  }

  /**
   * 表編集オーバーレイのtsv・for・rangeを処理し、呼び出し側へ結果または副作用を返す。
   * @param range - 表編集オーバーレイへ渡す入力。
   * @returns 表編集オーバーレイで利用する文字列。
   */
  function tsvForRange(range: NormalizedTableGridRange): string {
    const selectedRows = rows.slice(range.fromRow, range.toRow + 1).map(
      /**
       * 各行からsliceを取り出して一覧化する。
       * @param row - 行のsliceを参照する走査対象。
       * @returns sliceを取り出した変換結果の一覧。
       */
      (row) => row.slice(range.fromColumn, range.toColumn + 1),
    );
    const selectedAlignments = alignments.slice(
      range.fromColumn,
      range.toColumn + 1,
    );
    const rendered = renderTableEditorDraft({
      ...initial,
      rows: selectedRows,
      alignments: selectedAlignments,
      activeRow: 0,
      activeColumn: 0,
    });
    return (
      markdownTableToTsv(rendered.text, {
        from: rendered.caretOffset,
        to: rendered.caretOffset,
      }) ?? ""
    );
  }

  /**
   * 表編集オーバーレイのselected・tsvを処理し、呼び出し側へ結果または副作用を返す。
   * @returns 表編集オーバーレイで利用する文字列。
   */
  function selectedTsv(): string {
    return tsvForRange(normalizedSelection);
  }

  /**
   * 表編集オーバーレイの入力または状態を走査・複製する。
   * @param forceSelection - 表編集オーバーレイへ渡す入力。
   * @returns 副作用を完了し、値は返さない。
   */
  async function copyTsv(forceSelection = false): Promise<void> {
    try {
      await writeClipboardText(
        forceSelection || hasGridRange ? selectedTsv() : tsv,
        messages.app.errors.clipboardUnavailable,
      );
      setStatus(messages.app.tableEditor.copied);
      window.setTimeout(
        /**
         * 指定時間の経過後に後続処理を実行する。
         * @returns 副作用を完了し、値は返さない。
         */
        () => setStatus(""),
        1200,
      );
    } catch (copyError) {
      setStatus(
        copyError instanceof Error ? copyError.message : String(copyError),
      );
    }
  }

  /**
   * 表編集オーバーレイのrow・is・selectedを処理し、呼び出し側へ結果または副作用を返す。
   * @param row - 表編集オーバーレイで走査または更新する要素。
   * @returns 条件が成立したかを示す真偽値。
   */
  function rowIsSelected(row: number): boolean {
    return (
      normalizedSelection.fromColumn === 0 &&
      normalizedSelection.toColumn === columnCount - 1 &&
      row >= normalizedSelection.fromRow &&
      row <= normalizedSelection.toRow
    );
  }

  /**
   * 表編集オーバーレイのcolumn・is・selectedを処理し、呼び出し側へ結果または副作用を返す。
   * @param column - 表編集オーバーレイで走査または更新する要素。
   * @returns 条件が成立したかを示す真偽値。
   */
  function columnIsSelected(column: number): boolean {
    return (
      normalizedSelection.fromRow === 0 &&
      normalizedSelection.toRow === rows.length - 1 &&
      column >= normalizedSelection.fromColumn &&
      column <= normalizedSelection.toColumn
    );
  }

  /**
   * 表編集オーバーレイで使う値または実行環境を組み立てる。
   * @returns 表編集オーバーレイで利用する文字列。
   */
  function createSelectionSummary(): string {
    const from = cellAddress(
      normalizedSelection.fromRow,
      normalizedSelection.fromColumn,
    );
    const to = cellAddress(
      normalizedSelection.toRow,
      normalizedSelection.toColumn,
    );
    const range = from === to ? from : `${from}–${to}`;
    return `${polishText.selection}: ${range} / ${selectedCellCount} ${polishText.cells}`;
  }

  /**
   * 表編集オーバーレイのcell・addressを処理し、呼び出し側へ結果または副作用を返す。
   * @param row - 表編集オーバーレイで走査または更新する要素。
   * @param column - 表編集オーバーレイで走査または更新する要素。
   * @returns 表編集オーバーレイで利用する文字列。
   */
  function cellAddress(row: number, column: number): string {
    return `${tableGridColumnLabel(column)}:${row === 0 ? "H" : row}`;
  }

  /**
   * 表編集オーバーレイの処理またはリソースを終了し、後続利用可能な状態へ戻す。
   * @returns 副作用を完了し、値は返さない。
   */
  function closeAndRestoreFocus(): void {
    onClose();
    requestAnimationFrame(
      /**
       * 次の描画フレームで表示更新を実行する。
       * @returns 副作用を完了し、値は返さない。
       */
      () => view.focus(),
    );
  }

  /**
   * 表編集オーバーレイの変更または要求をHost・Webview間へ通知する。
   * @returns 副作用を完了し、値は返さない。
   */
  function requestClose(): void {
    if (isDirty && !window.confirm(polishText.discard)) return;
    closeAndRestoreFocus();
  }

  /**
   * 表編集オーバーレイの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @returns 副作用を完了し、値は返さない。
   */
  function apply(): void {
    if (!view.dom.isConnected) {
      setStatus(messages.app.tableEditor.sourceEditorClosed);
      return;
    }
    const current = view.state.doc.toString();
    const prepared = prepareTableEditorApply(currentDraft(), current);
    if (prepared.kind === "stale") {
      setStatus(messages.app.tableEditor.documentChanged);
      return;
    }
    if (prepared.kind === "noop") {
      closeAndRestoreFocus();
      return;
    }
    const changeSet = view.state.changes({
      from: initial.from,
      to: initial.to,
      insert: toEditorInsertion(view.state, prepared.text),
    });
    const snapshot =
      view.scrollDOM.clientHeight > 0
        ? view.scrollSnapshot().map(changeSet)
        : undefined;
    view.dispatch({
      changes: changeSet,
      selection: EditorSelection.cursor(initial.from + prepared.caretOffset),
      effects: snapshot,
    });
    closeAndRestoreFocus();
  }

  return (
    <div
      ref={overlayRef}
      className="mve-table-editor"
      role="dialog"
      aria-modal="true"
      aria-label={messages.app.tableEditor.title}
      style={editorStyle}
    >
      <header
        className="mve-table-editor-header"
        onPointerDown={startEditorDrag}
      >
        <strong>{messages.app.tableEditor.title}</strong>
        <span>{cellCountLabel}</span>
        {isDirty && (
          <span
            className="mve-table-editor-dirty"
            title={polishText.modified}
            aria-label={polishText.modified}
          >
            ● {polishText.modified}
          </span>
        )}
        <button
          type="button"
          className="mve-table-editor-close"
          title={messages.app.tableEditor.close}
          aria-label={messages.app.tableEditor.close}
          onClick={requestClose}
        >
          ×
        </button>
      </header>
      <div className="mve-table-editor-toolbar" role="toolbar">
        <ToolbarGroup label={messages.ribbon.groups.history}>
          <button
            type="button"
            title={`${messages.ribbon.labels.undo} (Ctrl+Z)`}
            onClick={undoDraft}
            disabled={!canUndo}
          >
            {messages.ribbon.labels.undo}
          </button>
          <button
            type="button"
            title={`${messages.ribbon.labels.redo} (Ctrl+Y / Ctrl+Shift+Z)`}
            onClick={redoDraft}
            disabled={!canRedo}
          >
            {messages.ribbon.labels.redo}
          </button>
        </ToolbarGroup>
        <ToolbarGroup label={messages.ribbon.groups.rows}>
          <button
            type="button"
            onClick={
              /**
               * clickイベントでapply・shared・table・actionを実行する。
               * @returns 副作用を完了し、値は返さない。
               */
              () => applySharedTableAction("rowAfter")
            }
            disabled={rows.length >= MAX_ROWS}
          >
            {messages.app.tableEditor.addRow}
          </button>
          <button
            type="button"
            onClick={
              /**
               * clickイベントでapply・shared・table・actionを実行する。
               * @returns 副作用を完了し、値は返さない。
               */
              () => applySharedTableAction("deleteRow")
            }
            disabled={activeRow === 0 || rows.length <= 1}
          >
            {messages.app.tableEditor.deleteRow}
          </button>
          <button
            type="button"
            onClick={duplicateSelectedRows}
            disabled={
              normalizedSelection.fromRow === 0 ||
              rows.length +
                normalizedSelection.toRow -
                normalizedSelection.fromRow +
                1 >
                MAX_ROWS
            }
          >
            {messages.app.tableEditor.copyRow}
          </button>
        </ToolbarGroup>
        <ToolbarGroup label={messages.ribbon.groups.columns}>
          <button
            type="button"
            onClick={
              /**
               * clickイベントでapply・shared・table・actionを実行する。
               * @returns 副作用を完了し、値は返さない。
               */
              () => applySharedTableAction("colAfter")
            }
            disabled={columnCount >= MAX_COLUMNS}
          >
            {messages.app.tableEditor.addColumn}
          </button>
          <button
            type="button"
            onClick={
              /**
               * clickイベントでapply・shared・table・actionを実行する。
               * @returns 副作用を完了し、値は返さない。
               */
              () => applySharedTableAction("deleteColumn")
            }
            disabled={columnCount <= 1}
          >
            {messages.app.tableEditor.deleteColumn}
          </button>
          <button
            type="button"
            onClick={duplicateSelectedColumns}
            disabled={
              columnCount +
                normalizedSelection.toColumn -
                normalizedSelection.fromColumn +
                1 >
              MAX_COLUMNS
            }
          >
            {messages.app.tableEditor.copyColumn}
          </button>
        </ToolbarGroup>
        <ToolbarGroup label={messages.ribbon.groups.alignment}>
          <ToolbarToggle
            label={messages.app.tableEditor.alignLeft}
            active={currentAlignment === "left"}
            onClick={
              /**
               * clickイベントでapply・shared・alignment・actionを実行する。
               * @returns 副作用を完了し、値は返さない。
               */
              () => applySharedAlignmentAction("alignLeft")
            }
          />
          <ToolbarToggle
            label={messages.app.tableEditor.alignCenter}
            active={currentAlignment === "center"}
            onClick={
              /**
               * clickイベントでapply・shared・alignment・actionを実行する。
               * @returns 副作用を完了し、値は返さない。
               */
              () => applySharedAlignmentAction("alignCenter")
            }
          />
          <ToolbarToggle
            label={messages.app.tableEditor.alignRight}
            active={currentAlignment === "right"}
            onClick={
              /**
               * clickイベントでapply・shared・alignment・actionを実行する。
               * @returns 副作用を完了し、値は返さない。
               */
              () => applySharedAlignmentAction("alignRight")
            }
          />
          <ToolbarToggle
            label={messages.app.tableEditor.clearAlignment}
            active={currentAlignment === "none"}
            onClick={clearAlignment}
          />
        </ToolbarGroup>
        <ToolbarGroup label={messages.ribbon.groups.excel} last>
          <button
            type="button"
            onClick={
              /**
               * clickイベントでcopy・tsvを実行する。
               * @returns 副作用を完了し、値は返さない。
               */
              () => void copyTsv()
            }
          >
            {messages.app.tableEditor.copyTsv}
          </button>
          <button
            type="button"
            title={`${messages.ribbon.labels.cellBreak} (Alt+Enter)`}
            aria-keyshortcuts="Alt+Enter"
            onClick={
              /**
               * clickイベントでinsert・line・breakを実行する。
               * @returns 副作用を完了し、値は返さない。
               */
              () => insertLineBreak()
            }
            disabled={hasGridRange}
          >
            {messages.ribbon.labels.cellBreak}
          </button>
        </ToolbarGroup>
      </div>
      <div className="mve-table-editor-grid-wrap">
        <table
          className="mve-table-editor-grid"
          style={{ width: `${gridWidth}px`, minWidth: "100%" }}
        >
          <colgroup>
            <col style={{ width: `${ROW_HEADER_WIDTH}px` }} />
            {Array.from(
              { length: columnCount },
              /**
               * 表編集オーバーレイのコールバックとして・を処理する。
               * @param _ - 引数位置を維持するための未使用値。
               * @param columnIndex - 表編集オーバーレイで走査または更新する要素。
               * @returns 表編集オーバーレイのコールバックが生成する結果。
               */
              (_, columnIndex) => (
                <col
                  key={columnIndex}
                  style={{
                    width: `${columnWidths[columnIndex] ?? DEFAULT_COLUMN_WIDTH}px`,
                  }}
                />
              ),
            )}
          </colgroup>
          <thead>
            <tr className="mve-table-editor-column-selector-row">
              <th
                className="mve-table-editor-corner"
                scope="col"
                tabIndex={0}
                title={polishText.selectAll}
                aria-label={polishText.selectAll}
                aria-selected={selectionKind === "all"}
                data-selected={selectionKind === "all" ? "true" : "false"}
                onClick={selectAllCells}
                onKeyDown={
                  /**
                   * keydownイベントでifを実行する。
                   * @param event - ユーザー操作またはDOMから通知されたイベント。
                   * @returns 副作用を完了し、値は返さない。
                   */
                  (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectAllCells();
                    }
                  }
                }
              >
                ◢
              </th>
              {Array.from(
                { length: columnCount },
                /**
                 * ・をcolumn・is・selectedへ渡し、表編集オーバーレイの結果または副作用を処理する。
                 * @param _ - 引数位置を維持するための未使用値。
                 * @param columnIndex - 表編集オーバーレイで走査または更新する要素。
                 * @returns 表編集オーバーレイのコールバックが生成する結果。
                 */
                (_, columnIndex) => (
                  <th
                    key={columnIndex}
                    className="mve-table-editor-column-selector"
                    scope="col"
                    tabIndex={0}
                    aria-selected={columnIsSelected(columnIndex)}
                    data-selected={
                      columnIsSelected(columnIndex) ? "true" : "false"
                    }
                    data-drop-target={
                      dragTarget?.kind === "column" &&
                      dragTarget.index === columnIndex
                        ? "true"
                        : "false"
                    }
                    onClick={
                      /**
                       * clickイベントでselect・columnを実行する。
                       * @returns 副作用を完了し、値は返さない。
                       */
                      () => selectColumn(columnIndex)
                    }
                    onKeyDown={
                      /**
                       * keydownイベントでifを実行する。
                       * @param event - ユーザー操作またはDOMから通知されたイベント。
                       * @returns 副作用を完了し、値は返さない。
                       */
                      (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectColumn(columnIndex);
                        }
                      }
                    }
                    onDragOver={
                      /**
                       * イベントをallow・column・dropへ渡し、表編集オーバーレイの結果または副作用を処理する。
                       * @param event - ユーザー操作またはDOMから通知されたイベント。
                       * @returns 表編集オーバーレイのコールバックが生成する結果。
                       */
                      (event) => allowColumnDrop(event, columnIndex)
                    }
                    onDrop={
                      /**
                       * dropイベントでdrop・columnを実行する。
                       * @param event - ユーザー操作またはDOMから通知されたイベント。
                       * @returns 副作用を完了し、値は返さない。
                       */
                      (event) => dropColumn(event, columnIndex)
                    }
                  >
                    <span>{tableGridColumnLabel(columnIndex)}</span>
                    <span
                      className="mve-table-editor-axis-drag-handle"
                      role="button"
                      tabIndex={0}
                      draggable
                      title={polishText.dragColumn}
                      aria-label={`${polishText.dragColumn} ${tableGridColumnLabel(columnIndex)}`}
                      onPointerDown={
                        /**
                         * イベントをstop・propagationへ渡し、表編集オーバーレイの結果または副作用を処理する。
                         * @param event - ユーザー操作またはDOMから通知されたイベント。
                         * @returns 表編集オーバーレイのコールバックが生成する結果。
                         */
                        (event) => event.stopPropagation()
                      }
                      onClick={
                        /**
                         * clickイベントでstop・propagationを実行する。
                         * @param event - ユーザー操作またはDOMから通知されたイベント。
                         * @returns 副作用を完了し、値は返さない。
                         */
                        (event) => event.stopPropagation()
                      }
                      onDragStart={
                        /**
                         * イベントをstart・column・dragへ渡し、表編集オーバーレイの結果または副作用を処理する。
                         * @param event - ユーザー操作またはDOMから通知されたイベント。
                         * @returns 表編集オーバーレイのコールバックが生成する結果。
                         */
                        (event) => startColumnDrag(event, columnIndex)
                      }
                      onDragEnd={endGridDrag}
                      onKeyDown={
                        /**
                         * keydownイベントでhandle・column・drag・keyを実行する。
                         * @param event - ユーザー操作またはDOMから通知されたイベント。
                         * @returns 副作用を完了し、値は返さない。
                         */
                        (event) => handleColumnDragKey(event, columnIndex)
                      }
                    >
                      ⋮⋮
                    </span>
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map(
              /**
               * 各行からindexを取り出して一覧化する。
               * @param row - 行のindexを参照する走査対象。
               * @param rowIndex - 表編集オーバーレイで走査または更新する要素。
               * @returns indexを取り出した変換結果の一覧。
               */
              (row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className={
                    rowIndex === 0 ? "mve-table-editor-header-row" : ""
                  }
                  data-drop-target={
                    dragTarget?.kind === "row" && dragTarget.index === rowIndex
                      ? "true"
                      : "false"
                  }
                  onDragOver={
                    /**
                     * イベントをallow・row・dropへ渡し、表編集オーバーレイの結果または副作用を処理する。
                     * @param event - ユーザー操作またはDOMから通知されたイベント。
                     * @returns 表編集オーバーレイのコールバックが生成する結果。
                     */
                    (event) => allowRowDrop(event, rowIndex)
                  }
                  onDrop={
                    /**
                     * dropイベントでdrop・rowを実行する。
                     * @param event - ユーザー操作またはDOMから通知されたイベント。
                     * @returns 副作用を完了し、値は返さない。
                     */
                    (event) => dropRow(event, rowIndex)
                  }
                >
                  <th
                    className="mve-table-editor-row-selector"
                    scope="row"
                    tabIndex={0}
                    aria-selected={rowIsSelected(rowIndex)}
                    data-selected={rowIsSelected(rowIndex) ? "true" : "false"}
                    onClick={
                      /**
                       * clickイベントでselect・rowを実行する。
                       * @returns 副作用を完了し、値は返さない。
                       */
                      () => selectRow(rowIndex)
                    }
                    onKeyDown={
                      /**
                       * keydownイベントでifを実行する。
                       * @param event - ユーザー操作またはDOMから通知されたイベント。
                       * @returns 副作用を完了し、値は返さない。
                       */
                      (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectRow(rowIndex);
                        }
                      }
                    }
                  >
                    <span>{rowIndex === 0 ? "H" : rowIndex}</span>
                    {rowIndex > 0 && (
                      <span
                        className="mve-table-editor-axis-drag-handle"
                        role="button"
                        tabIndex={0}
                        draggable
                        title={polishText.dragRow}
                        aria-label={`${polishText.dragRow} ${rowIndex}`}
                        onPointerDown={
                          /**
                           * イベントをstop・propagationへ渡し、表編集オーバーレイの結果または副作用を処理する。
                           * @param event - ユーザー操作またはDOMから通知されたイベント。
                           * @returns 表編集オーバーレイのコールバックが生成する結果。
                           */
                          (event) => event.stopPropagation()
                        }
                        onClick={
                          /**
                           * clickイベントでstop・propagationを実行する。
                           * @param event - ユーザー操作またはDOMから通知されたイベント。
                           * @returns 副作用を完了し、値は返さない。
                           */
                          (event) => event.stopPropagation()
                        }
                        onDragStart={
                          /**
                           * イベントをstart・row・dragへ渡し、表編集オーバーレイの結果または副作用を処理する。
                           * @param event - ユーザー操作またはDOMから通知されたイベント。
                           * @returns 表編集オーバーレイのコールバックが生成する結果。
                           */
                          (event) => startRowDrag(event, rowIndex)
                        }
                        onDragEnd={endGridDrag}
                        onKeyDown={
                          /**
                           * keydownイベントでhandle・row・drag・keyを実行する。
                           * @param event - ユーザー操作またはDOMから通知されたイベント。
                           * @returns 副作用を完了し、値は返さない。
                           */
                          (event) => handleRowDragKey(event, rowIndex)
                        }
                      >
                        ⋮
                      </span>
                    )}
                    <div
                      className="mve-table-editor-row-resizer"
                      role="separator"
                      tabIndex={0}
                      aria-orientation="horizontal"
                      aria-label={`${messages.app.tableEditor.resizeRow} ${rowIndex + 1}`}
                      aria-valuemin={MIN_ROW_HEIGHT}
                      aria-valuenow={rowHeights[rowIndex] ?? MIN_ROW_HEIGHT}
                      title={messages.app.tableEditor.resizeRow}
                      onPointerDown={
                        /**
                         * イベントをstart・row・resizeへ渡し、表編集オーバーレイの結果または副作用を処理する。
                         * @param event - ユーザー操作またはDOMから通知されたイベント。
                         * @returns 表編集オーバーレイのコールバックが生成する結果。
                         */
                        (event) => startRowResize(event, rowIndex)
                      }
                      onPointerUp={
                        /**
                         * イベントをauto・fit・row・on・pointer・upへ渡し、表編集オーバーレイの結果または副作用を処理する。
                         * @param event - ユーザー操作またはDOMから通知されたイベント。
                         * @returns 表編集オーバーレイのコールバックが生成する結果。
                         */
                        (event) => autoFitRowOnPointerUp(event, rowIndex)
                      }
                      onKeyDown={
                        /**
                         * keydownイベントでresize・row・by・keyboardを実行する。
                         * @param event - ユーザー操作またはDOMから通知されたイベント。
                         * @returns 副作用を完了し、値は返さない。
                         */
                        (event) => resizeRowByKeyboard(event, rowIndex)
                      }
                    />
                  </th>
                  {Array.from(
                    { length: columnCount },
                    /**
                     * ・をtable・grid・range・containsへ渡し、表編集オーバーレイの結果または副作用を処理する。
                     * @param _ - 引数位置を維持するための未使用値。
                     * @param columnIndex - 表編集オーバーレイで走査または更新する要素。
                     * @returns 表編集オーバーレイのコールバックが生成する結果。
                     */
                    (_, columnIndex) => {
                      const alignment = alignments[columnIndex] ?? "none";
                      const active =
                        rowIndex === activeRow && columnIndex === activeColumn;
                      const selected = tableGridRangeContains(
                        normalizedSelection,
                        rowIndex,
                        columnIndex,
                      );
                      return (
                        <td
                          key={columnIndex}
                          data-alignment={alignment}
                          data-active={active ? "true" : "false"}
                          data-selected={selected ? "true" : "false"}
                          onPointerDown={
                            /**
                             * イベントをbegin・cell・selectionへ渡し、表編集オーバーレイの結果または副作用を処理する。
                             * @param event - ユーザー操作またはDOMから通知されたイベント。
                             * @returns 表編集オーバーレイのコールバックが生成する結果。
                             */
                            (event) =>
                              beginCellSelection(event, rowIndex, columnIndex)
                          }
                          onPointerEnter={
                            /**
                             * イベントをextend・cell・selectionへ渡し、表編集オーバーレイの結果または副作用を処理する。
                             * @param event - ユーザー操作またはDOMから通知されたイベント。
                             * @returns 表編集オーバーレイのコールバックが生成する結果。
                             */
                            (event) =>
                              extendCellSelection(event, rowIndex, columnIndex)
                          }
                        >
                          <textarea
                            rows={1}
                            spellCheck={false}
                            value={tableEditorCellDisplayValue(
                              row[columnIndex] ?? "",
                            )}
                            style={rowTextareaStyle(rowHeights[rowIndex])}
                            data-table-cell={`${rowIndex}:${columnIndex}`}
                            onFocus={
                              /**
                               * イベントをremember・cell・selectionへ渡し、表編集オーバーレイの結果または副作用を処理する。
                               * @param event - ユーザー操作またはDOMから通知されたイベント。
                               * @returns 表編集オーバーレイのコールバックが生成する結果。
                               */
                              (event) =>
                                rememberCellSelection(
                                  rowIndex,
                                  columnIndex,
                                  event.currentTarget,
                                )
                            }
                            onSelect={
                              /**
                               * イベントを状態設定へ渡し、表編集オーバーレイの結果または副作用を処理する。
                               * @param event - ユーザー操作またはDOMから通知されたイベント。
                               * @returns 表編集オーバーレイのコールバックが生成する結果。
                               */
                              (event) =>
                                cellSelectionRef.current.set(
                                  cellKey(rowIndex, columnIndex),
                                  {
                                    from: event.currentTarget.selectionStart,
                                    to: event.currentTarget.selectionEnd,
                                  },
                                )
                            }
                            onChange={
                              /**
                               * changeイベントでupdate・cellを実行する。
                               * @param event - ユーザー操作またはDOMから通知されたイベント。
                               * @returns 副作用を完了し、値は返さない。
                               */
                              (event) => {
                                updateCell(
                                  rowIndex,
                                  columnIndex,
                                  event.target.value,
                                );
                                cellSelectionRef.current.set(
                                  cellKey(rowIndex, columnIndex),
                                  {
                                    from: event.currentTarget.selectionStart,
                                    to: event.currentTarget.selectionEnd,
                                  },
                                );
                              }
                            }
                            onPaste={pasteTsv}
                            onKeyDown={
                              /**
                               * keydownイベントでifを実行する。
                               * @param event - ユーザー操作またはDOMから通知されたイベント。
                               * @returns 副作用を完了し、値は返さない。
                               */
                              (event) => {
                                if (
                                  event.key === "Backspace" &&
                                  !event.altKey &&
                                  !event.ctrlKey &&
                                  !event.metaKey &&
                                  event.currentTarget.selectionStart ===
                                    event.currentTarget.selectionEnd &&
                                  deleteLineBreakBeforeDisplayOffset(
                                    rowIndex,
                                    columnIndex,
                                    event.currentTarget.selectionStart,
                                  )
                                ) {
                                  event.preventDefault();
                                } else if (
                                  event.key === "Enter" &&
                                  event.altKey &&
                                  !event.ctrlKey &&
                                  !event.metaKey
                                ) {
                                  event.preventDefault();
                                  insertLineBreak(rowIndex, columnIndex);
                                } else if (event.key === "Tab") {
                                  event.preventDefault();
                                  moveCell(event.shiftKey ? -1 : 1);
                                } else if (
                                  event.key === "Enter" &&
                                  !event.ctrlKey &&
                                  !event.metaKey
                                ) {
                                  event.preventDefault();
                                  moveVertical(event.shiftKey ? -1 : 1);
                                }
                              }
                            }
                          />
                          {rowIndex === 0 && (
                            <div
                              className="mve-table-editor-column-resizer"
                              role="separator"
                              tabIndex={0}
                              aria-orientation="vertical"
                              aria-label={`${messages.app.tableEditor.resizeColumn} ${columnIndex + 1}`}
                              aria-valuemin={MIN_COLUMN_WIDTH}
                              aria-valuenow={Math.round(
                                columnWidths[columnIndex] ??
                                  DEFAULT_COLUMN_WIDTH,
                              )}
                              title={messages.app.tableEditor.resizeColumn}
                              onMouseDown={
                                /**
                                 * イベントをstart・column・resizeへ渡し、表編集オーバーレイの結果または副作用を処理する。
                                 * @param event - ユーザー操作またはDOMから通知されたイベント。
                                 * @returns 表編集オーバーレイのコールバックが生成する結果。
                                 */
                                (event) => startColumnResize(event, columnIndex)
                              }
                              onMouseUp={
                                /**
                                 * イベントをauto・fit・column・on・mouse・upへ渡し、表編集オーバーレイの結果または副作用を処理する。
                                 * @param event - ユーザー操作またはDOMから通知されたイベント。
                                 * @returns 表編集オーバーレイのコールバックが生成する結果。
                                 */
                                (event) =>
                                  autoFitColumnOnMouseUp(event, columnIndex)
                              }
                              onKeyDown={
                                /**
                                 * keydownイベントでresize・column・by・keyboardを実行する。
                                 * @param event - ユーザー操作またはDOMから通知されたイベント。
                                 * @returns 副作用を完了し、値は返さない。
                                 */
                                (event) =>
                                  resizeColumnByKeyboard(event, columnIndex)
                              }
                            />
                          )}
                        </td>
                      );
                    },
                  )}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      <footer className="mve-table-editor-footer">
        <span
          className={
            status
              ? "mve-table-editor-status visible"
              : "mve-table-editor-status"
          }
          title={status || selectionSummary}
        >
          {status ||
            `${selectionSummary} · ${messages.app.tableEditor.navigationHint}`}
        </span>
        <div className="mve-table-editor-actions">
          <button type="button" onClick={requestClose}>
            {messages.app.tableEditor.cancel}
          </button>
          <button type="button" className="primary" onClick={apply}>
            {messages.app.tableEditor.apply}
          </button>
        </div>
      </footer>
      <div
        className="mve-table-editor-resizer"
        role="separator"
        tabIndex={0}
        aria-orientation="horizontal"
        aria-label={messages.app.tableEditor.resizeEditor}
        aria-valuetext={`${Math.round(editorSize.width)} × ${Math.round(editorSize.height)}`}
        title={messages.app.tableEditor.resizeEditor}
        onPointerDown={startEditorResize}
        onKeyDown={resizeEditorByKeyboard}
      />
    </div>
  );
}

/**
 * イベントでreturnを実行する。
 * @param options - ユーザー操作またはDOMから通知されたイベント。
 * @returns 副作用を完了し、値は返さない。
 */
function ToolbarGroup({
  label,
  children,
  last = false,
}: {
  /**
   * 画面または検証結果に表示する説明文。
   */
  label: string;

  /**
   * 表編集オーバーレイのchildrenに関する状態または設定。
   */
  children: React.ReactNode;

  /**
   * 表編集オーバーレイのlastを切り替えるフラグ。
   */
  last?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={`mve-table-editor-toolbar-group${last ? " last" : ""}`}
      role="group"
      aria-label={label}
    >
      <span className="mve-table-editor-toolbar-label">{label}</span>
      <div className="mve-table-editor-toolbar-controls">{children}</div>
    </div>
  );
}

/**
 * 表編集オーバーレイのtoolbar・toggleを処理し、呼び出し側へ結果または副作用を返す。
 * @param options - 呼び出し側が指定する処理設定。
 * @returns 表編集オーバーレイのtoolbar・toggleが生成する結果。
 */
function ToolbarToggle({
  label,
  active,
  onClick,
}: {
  /**
   * 画面または検証結果に表示する説明文。
   */
  label: string;

  /**
   * 表編集オーバーレイの状態を示すフラグ。
   */
  active: boolean;
  /**
   * 表編集オーバーレイのイベントまたはメッセージを受け取り、状態を更新する。
   * @returns 表編集オーバーレイのon・clickが生成する結果。
   */
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={active ? "active" : ""}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/**
 * UIイベントを受け取り、必要な処理を実行する。
 * @param text - ユーザー操作またはDOMから通知されたイベント。
 * @param unavailableMessage - ユーザー操作またはDOMから通知されたイベント。
 * @returns 副作用を完了し、値は返さない。
 */
async function writeClipboardText(
  text: string,
  unavailableMessage: string,
): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error(unavailableMessage);
}

/**
 * 表編集オーバーレイのto・editor・insertionを処理し、呼び出し側へ結果または副作用を返す。
 * @param state - 現在の編集・表示状態。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns 表編集オーバーレイで利用する文字列。
 */
function toEditorInsertion(state: EditorState, value: string): string {
  const separator = state.facet(EditorState.lineSeparator) ?? "\n";
  return value.replace(/\r\n?|\n/g, "\n").replace(/\n/g, separator);
}

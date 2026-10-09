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
import { getMessages, resolveLanguage, type Messages } from "../shared/messages";
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
  remapTableEditorSortState,
  renderTableEditorDraft,
  sortTableEditorRows,
  tableEditorCellDisplayOffsetFromStored,
  tableEditorCellDisplayValue,
  tableEditorCellStoredOffsetFromDisplay,
  tableEditorCellStoredValue,
  type TableEditorAlignment,
  type TableEditorDraft,
  type TableEditorSortDirection,
  type TableEditorSortState,
} from "./tableEditorModel";
import {
  calculateAutoFitColumnWidth,
  calculateAutoFitRowHeight,
  TABLE_EDITOR_MAX_AUTO_COLUMN_WIDTH,
  TABLE_EDITOR_MIN_COLUMN_WIDTH,
  TABLE_EDITOR_MIN_ROW_HEIGHT,
} from "../shared/tableEditorSizing";

/**
 * 表編集オーバーレイを開く要求を通知するカスタムイベント名。
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
 * 行見出し列に確保する幅をCSSピクセル単位で指定します。
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
const DEFAULT_EDITOR_WIDTH = 1080;

/**
 * 編集面の高さが未指定のときに使う値。
 */
const DEFAULT_EDITOR_HEIGHT = 760;

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
 * 行高ハンドルのクリックとドラッグを区別する移動量。
 */
const ROW_RESIZE_CLICK_MOVEMENT_THRESHOLD = 3;
/**
 * 表編集オーバーレイで一時生成物または検証対象を置くディレクトリ。
 */
let overlayRoot: Root | undefined;
/**
 * Reactの表編集ルートをマウントしているDOM要素。
 */
let overlayHost: HTMLDivElement | undefined;

/**
 * 表編集オーバーレイで扱う値の種類と境界を表す型。
 */
type CellSelection = {
  /**
   * 選択範囲内の先頭セルを示す0始まりのセル番号です。
   */
  from: number;
  /**
   * 選択範囲内の末尾セルを示す0始まりのセル番号です。
   */
  to: number;
};
/**
 * 表編集オーバーレイの現在状態または履歴を保持するデータ形状。
 */
type ColumnResizeState = {
  /**
   * リサイズ対象列の0始まりの列番号です。
   */
  column: number;

  /** リサイズ開始時のポインターX座標。 */
  startX: number;

  /**
   * 列幅変更を始めた時点の幅をCSSピクセル単位で記録します。
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
   * リサイズ対象行の0始まりの行番号です。
   */
  row: number;

  /** 行リサイズを開始したポインターを識別するID。 */
  pointerId: number;

  /** 行リサイズ開始時のポインターY座標。 */
  startY: number;

  /**
   * 行高変更を始めた時点の高さをCSSピクセル単位で記録します。
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
  /** オーバーレイ操作を開始したポインターを識別するID。 */
  pointerId: number;

  /** ドラッグまたはリサイズ開始時のポインターX座標。 */
  startX: number;

  /** ドラッグまたはリサイズ開始時のポインターY座標。 */
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
   * ドラッグを開始したポインターのID。
   */
  pointerId: number;

  /**
   * ドラッグ開始点の画面X座標。
   */
  startX: number;

  /**
   * ドラッグ開始点の画面Y座標。
   */
  startY: number;

  /**
   * 列幅変更を開始したときの幅をCSSピクセル単位で記録します。
   */
  startWidth: number;

  /**
   * 行高変更を開始したときの高さをCSSピクセル単位で記録します。
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
 * グリッド選択対象がセル、行、列、全体のどれかを示します。
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
   * 選択中の表が元Markdown本文内で始まるUTF-16オフセット。
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
 * 行と列の組を、セル選択状態のMapで使う一意なキーにする。
 * @param row - セル操作の対象となる表行インデックス。
 * @param column - セル操作の対象となる表列インデックス。
 * @returns 行番号と列番号をコロンで連結したセルキー。
 */
function cellKey(row: number, column: number): string {
  return `${row}:${column}`;
}

/**
 * 行:列形式のセルアドレスを行番号と列番号へ解析する。
 * @param value - 行番号と列番号をコロンで区切ったセルアドレス文字列。未指定時はundefined。
 * @returns セルの行番号と列番号。形式が異なる場合はundefined。
 */
function parseTableCellAddress(value: string | undefined):
  | {
      /**
       * セル範囲の始点を示す0始まりの行番号です。
       */
      row: number;
      /**
       * セル範囲の始点を示す0始まりの列番号です。
       */
      column: number;
    }
  | undefined {
  const match = /^(\d+):(\d+)$/.exec(value ?? "");
  if (!match) return undefined;
  return { row: Number(match[1]), column: Number(match[2]) };
}

/**
 * 行高に合わせたセルtextareaの高さと垂直位置を計算する。
 * @param rowHeight - textareaを収める行の高さ（CSS px）。
 * @returns 高さを適用できる行ではCSSスタイル、行高が無効な場合はundefined。
 */
function rowTextareaStyle(
  rowHeight: number | undefined,
): React.CSSProperties | undefined {
  if (rowHeight === undefined) return undefined;
  const cellHeight = Math.max(MIN_TEXTAREA_HEIGHT, rowHeight - 2);
  return { height: `${cellHeight}px`, minHeight: `${cellHeight}px` };
}

/**
 * 表編集を開くイベントを登録し、呼び出し側へ解除関数を返す。
 * @returns イベントリスナーを解除して、開いている表編集オーバーレイを閉じる関数。
 */
export function installTableEditorOverlay(): () => void {
  const open = /**
   * 表編集オーバーレイの表示または操作を開始する。
   */ () => openTableEditor();
  window.addEventListener(OPEN_EVENT, open);
  /** 登録したイベントを解除し、オーバーレイのDOMと状態を破棄する。 */
  return () => {
    window.removeEventListener(OPEN_EVENT, open);
    closeOverlay();
  };
}

/**
 * ソースエディターのDOMからCodeMirrorのviewを検索する。
 * @returns エディターが見つかった場合はそのview、未表示の場合はundefined。
 */
function findEditorView(): EditorView | undefined {
  const editor = document.querySelector<HTMLElement>(
    ".source-editor .cm-editor",
  );
  return editor ? (EditorView.findFromDOM(editor) ?? undefined) : undefined;
}

/**
 * 表編集オーバーレイの表示または操作を開始する。
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
 */
function showOverlayToast(message: string): void {
  const toast = document.createElement("div");
  toast.className = "mve-table-editor-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(
    /**
     * 指定時間の経過後に後続処理を実行する。
     */
    () => toast.remove(),
    2400,
  );
}

/**
 * 表編集オーバーレイを表示し、表ドラフトの編集状態と操作を管理する。
 * @param props - 表編集オーバーレイに渡す依存値と初期ドラフト。
 * @param props.view - 表の元本文を読み取り、適用時に変更を反映するCodeMirror EditorView。
 * @param props.initial - 読み取り済みの表ドラフト。元本文の範囲と内容、セル値、配置、編集開始セルを含む。
 * @param props.messages - 表編集UIのラベル、説明、通知に使う翻訳済みメッセージ。
 * @param props.onClose - 表編集オーバーレイを閉じる親コンポーネントの処理。
 * @returns 表編集オーバーレイのReact要素。
 */
function TableEditorOverlay(props: {
  /**
    * 表編集開始元であり、編集結果の反映先となるCodeMirrorエディター。
   */
  view: EditorView;

  /**
    * 編集開始位置から読み取った表ドラフト。元本文の範囲と内容、セル値、配置、開始セルを含む。
   */
  initial: TableEditorDraft;

  /**
    * 表編集UIのラベル、説明、通知に表示する翻訳済みメッセージ。
   */
  messages: Messages;
  /**
    * 表編集オーバーレイを閉じる親コンポーネントの処理。
   */
  onClose: () => void;
}): React.JSX.Element {
  const { view, initial, messages, onClose } = props;
  const [rows, setRows] = useState(

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

    () => initial.alignments.slice(),
  );
  const [activeRow, setActiveRow] = useState(initial.activeRow);
  const [activeColumn, setActiveColumn] = useState(initial.activeColumn);
  const [sortState, setSortState] = useState<TableEditorSortState | null>(null);
  const [gridSelection, setGridSelection] = useState<TableGridRange>(
    /**
     * 初期アクティブセルを選択範囲の両端に設定する。
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
     * @returns 各表行の高さを未指定にした初期配列。
     */
    () =>
      Array.from(
        { length: initial.rows.length },
        /**
         * 初期列幅を既定値でそろえる。
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
     * @returns 各列へ既定幅を設定した初期配列。
     */
    () =>
      Array.from(
        { length: initialColumnCount },
        /**
         * 各行に高さ未指定の状態を設定する。
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
         * セル範囲の終点を示す0始まりの行番号です。
         */
        row: number;
        /**
         * セル範囲の終点を示す0始まりの列番号です。
         */
        column: number;
      }
    | undefined
  >(undefined);
  const gridDragRef = useRef<GridDragState | undefined>(undefined);
  const historyRef = useRef(createTableEditorHistory());
  const initialRenderedTextRef = useRef(renderTableEditorDraft(initial).text);
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


    (_, index) => normalizedSelection.fromColumn + index,
  );
  const selectedAlignmentValues = selectedColumns.map(
    (column) => alignments[column] ?? "none",
  );
  const currentAlignment = selectedAlignmentValues.every(
    /**

     * @param value - 現在の列配置と選択中配置候補。
     */
    (value) => value === selectedAlignmentValues[0],
  )
    ? selectedAlignmentValues[0]
    : undefined;
  const gridWidth =
    ROW_HEADER_WIDTH +
    Array.from(
      { length: columnCount },


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
     */
    () => {
      const frame = requestAnimationFrame(
        /**
         * 次の描画フレームで表示更新を実行する。
         */
        () => focusCell(activeRow, activeColumn, false),
      );
       /** フォーカス予約のアニメーションフレームを解除する。 */
       return () => cancelAnimationFrame(frame);
    },
    [],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     */
    () => {
       const onKeyDown = /**
        * グリッド内のコピー、Undo/Redo、消去、適用、閉じる操作を処理する。
       * @param event - セルTSVコピー、undo/redo、消去、適用、閉じるショートカットを処理するkeydown event。
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
       */
      return () => window.removeEventListener("keydown", onKeyDown, true);
    },
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     */
    () => {
       const onMouseMove = /**
        * 列リサイズ中のポインター位置から対象列の幅を更新する。
        * @param event - 列リサイズ中のmousemove位置を列幅へ反映するevent。
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
           * @param previous - リサイズ前の列幅一覧。対象列を更新し、不足列に既定幅を補う基準値。
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
        * 列リサイズ状態とドラッグ中に変更したbodyスタイルを初期化する。
       */ () => {
        columnResizeRef.current = undefined;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
      /** リサイズ終了後にwindowの監視を解除し、bodyの操作制限を戻す。 */
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
     */
    () => {
       const onPointerMove = /**
        * ポインター操作に応じてオーバーレイの位置、寸法、行高を更新する。
        * @param event - 表エディターの移動・サイズ変更または行リサイズ中のpointer位置を反映するevent。
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

             * @param previous - ドラッグ前の表エディター幅と高さ。新寸法と比較する状態。
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

             * @param previous - 移動前の表エディター左上座標。新しい座標と比較する状態。
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
        if (
          Math.abs(event.clientY - rowResize.startY) >
          ROW_RESIZE_CLICK_MOVEMENT_THRESHOLD
        ) {
          rowResize.moved = true;
        }
        const height = Math.max(
          MIN_ROW_HEIGHT,
          Math.round(rowResize.startHeight + event.clientY - rowResize.startY),
        );
        setRowHeights(
          /**
           * @param previous - リサイズ前の行高一覧。対象行を更新し、不足位置に項目を補う基準値。
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

      const onPointerUp = (event: PointerEvent) => {
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
      /** ポインター操作終了後にwindowの監視とドラッグ状態を解除する。 */
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
   * 現在のセル値、列幅、行高を履歴へ保存できるdraft形式にまとめる。
   * @returns undo/redo履歴へ渡す表編集draft。
   */
  function currentDraft(): TableEditorDraft {
    return {
      ...initial,
      rows,
      alignments: Array.from(
        { length: columnCount },


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


        (_, index) => alignments[index] ?? "none",
      ),
      activeRow,
      activeColumn,
      sortState: sortState ? { ...sortState } : null,
      rowHeights: rowHeights.slice(),
      columnWidths: Array.from(
        { length: columnCount },


        (_, index) => columnWidths[index] ?? DEFAULT_COLUMN_WIDTH,
      ),
      gridSelection: { ...gridSelection },
      selectionKind,
    };
  }

  /** 現在のdraftと選択状態を履歴へ記録する。 */
  function recordHistory(): void {
    recordTableEditorHistory(historyRef.current, currentHistorySnapshot());
    setHistoryRevision(
      /**
       * 表編集履歴の更新番号を加算する。
       * @param value - 加算前の表編集履歴の更新番号。
       */
      (value) => value + 1,
    );
  }

  /** 履歴を一段戻し、復元したdraftと選択状態を画面へ反映する。 */
  function undoDraft(): void {
    const previous = undoTableEditorHistory(
      historyRef.current,
      currentHistorySnapshot(),
    );
    if (!previous) return;
    restoreHistorySnapshot(previous);
      setHistoryRevision(
        /**
         * 表編集履歴の更新番号を加算する。
         * @param value - 加算前の表編集履歴の更新番号。
       */
      (value) => value + 1,
    );
  }

  /** 履歴を一段進め、復元したdraftと選択状態を画面へ反映する。 */
  function redoDraft(): void {
    const next = redoTableEditorHistory(
      historyRef.current,
      currentHistorySnapshot(),
    );
    if (!next) return;
    restoreHistorySnapshot(next);
      setHistoryRevision(
        /**
         * 表編集履歴の更新番号を加算する。
         * @param value - 加算前の表編集履歴の更新番号。
       */
      (value) => value + 1,
    );
  }

  /**
   * 表編集オーバーレイの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param snapshot - 復元する表編集履歴。セル、配置、選択、ソート、行高、列幅を含む。
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
      * 復元するアクティブ行を表の範囲内に収める。
      * @param row - 行数の範囲内へ丸めるアクティブ行インデックス。

     */ (row: number): number =>
      Math.max(0, Math.min(nextRows.length - 1, row));

    const clampColumn = /**
      * 復元するアクティブ列を表の範囲内に収める。
      * @param column - 列数の範囲内へ丸めるアクティブ列インデックス。

     */ (column: number): number =>
      Math.max(0, Math.min(nextColumns - 1, column));
    setRows(nextRows);
    setAlignments(
      Array.from(
        { length: nextColumns },


        (_, index) => snapshot.alignments[index] ?? "none",
      ),
    );
    setColumnWidths(
      Array.from(
        { length: nextColumns },


        (_, index) => snapshot.columnWidths[index] ?? DEFAULT_COLUMN_WIDTH,
      ),
    );
    setRowHeights(
      Array.from(
        { length: nextRows.length },


        (_, index) => snapshot.rowHeights[index],
      ),
    );
    setActiveRow(safeActiveRow);
    setActiveColumn(safeActiveColumn);
    setSortState(snapshot.sortState ? { ...snapshot.sortState } : null);
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
   * 指定セルだけを選択し、選択範囲の開始位置と終了位置を同じセルにする。
   * @param row - セル操作の対象となる表行インデックス。
   * @param column - セル操作の対象となる表列インデックス。
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
   * @param row - セル操作の対象となる表行インデックス。
   * @param column - セル操作の対象となる表列インデックス。
   * @param select - focus時に入力欄の値全体を選択する場合true。
   * @param rowCount - 有効行indexを制限する現在の表行数。
   * @param columns - 有効列indexを制限する現在の表列数。
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
   * 表ドラフトを画面へ反映し、必要に応じて置換前の状態をundo履歴へ保存する。
   * @param next 画面へ反映する次の表編集ドラフト。
   * @param captureHistory 置換前のドラフトをundo履歴へ追加する場合はtrue。
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
       * @param previous - 変更前の列幅一覧。新しい列数に合わせて調整し、既存位置の幅を保つ基準値。
       */
      (previous) =>
        Array.from(
          { length: nextColumns },


          (_, index) => previous[index] ?? DEFAULT_COLUMN_WIDTH,
        ),
    );
    setRowHeights(
      /**
       * @param previous - 変更前の行高一覧。新しい行数に合わせて調整し、既存位置の高さを保つ基準値。
       */
      (previous) =>
        Array.from(
          { length: nextRows.length },

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
    * @param row - 編集するセルを含む表行のインデックス。
    * @param column - 編集するセルの列インデックス。
    * @param value - セル入力欄から受け取った表示文字列。
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
       * @param previous - 更新前の表セル行列。対象行のセル値を置き換える基準値。
       */
      (previous) =>
        previous.map(
          /**
           * 各currentをifへ渡し、変換結果を一覧化する。
           * @param current - 走査中の表行にあるセル文字列一覧。対象行なら複製してセル変更を反映する。
           * @param rowIndex - 走査中の表行インデックス。

           */
          (current, rowIndex) => {
            if (rowIndex !== row) return current;
            const next = Array.from(
              { length: columnCount },


              (_, index) => current[index] ?? "",
            );
            next[column] = normalized;
            return next;
          },
        ),
    );
  }

  /**
   * 指定セルのテキスト選択範囲を保存し、アクティブセルを更新する。
   * @param row - 選択位置を記録する表行インデックス。
   * @param column - 選択位置を記録する表列インデックス。
   * @param element - 寸法または属性を読み取るDOM要素。
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
   * @param event - pointerdownによる表セル選択開始event。
   * @param row - セル操作の対象となる表行インデックス。
   * @param column - セル操作の対象となる表列インデックス。
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

         * @param previous - Shiftクリック前の表セル選択範囲。アンカーを保ちフォーカスセルを移す基準値。
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
   * ドラッグの起点を保ったまま、指定セルまで選択範囲を広げる。
   * @param event - セル範囲ドラッグ中に選択終端を更新するpointer event。
   * @param row - セル操作の対象となる表行インデックス。
   * @param column - セル操作の対象となる表列インデックス。
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
   * 指定行のすべての列を選択範囲にする。
   * @param row - セル操作の対象となる表行インデックス。
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
   * 指定列のすべての行を選択範囲にする。
   * @param column - セル操作の対象となる表列インデックス。
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

  /** 表全体を選択範囲にし、フォーカスを左上セルへ移す。 */
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
   * @param row - セル操作の対象となる表行インデックス。
   * @param column - セル操作の対象となる表列インデックス。
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
       * @param previous - 編集前の表セル行列。対象行のセル値を更新する基準値。
       */
      (previous) =>
        previous.map(
          /**
           * 各currentをifへ渡し、変換結果を一覧化する。
           * @param current - 走査中の表行にあるセル文字列一覧。対象行なら複製してセル変更を反映する。
           * @param rowIndex - 走査中の表行インデックス。

           */
          (current, rowIndex) => {
            if (rowIndex !== row) return current;
            const next = Array.from(
              { length: columnCount },


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
   * @param row - セル操作の対象となる表行インデックス。
   * @param column - セル操作の対象となる表列インデックス。
   * @param displayOffset - 削除キー操作後のセル表示文字列内caretオフセット。
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
       * @param previous - 編集前の表セル行列。対象行の変更後セル値を反映する基準値。
       */
      (previous) =>
        previous.map(
          /**
           * 各currentをifへ渡し、変換結果を一覧化する。
           * @param current - 走査中の表行にあるセル文字列一覧。対象行なら複製してセル変更を反映する。
           * @param rowIndex - 走査中の表行インデックス。

           */
          (current, rowIndex) => {
            if (rowIndex !== row) return current;
            const next = Array.from(
              { length: columnCount },


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
   * @param event - 列リサイズハンドルのmousedown event。
   * @param column - セル操作の対象となる表列インデックス。
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
   * 各セルの表示幅を測り、指定列に必要な幅を設定する。
   * @param column - セル操作の対象となる表列インデックス。
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
      * @param value - Canvasで幅を測定するセル表示文字列。

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
       * @param previous - 自動調整前の列幅一覧。計測した対象列の幅を反映し、他列を保つ基準値。
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
   * 列幅がドラッグで変わらなかった場合に列内容へ自動フィットする。
   * @param event - ドラッグされなかった列リサイズハンドルのmouseup event。
   * @param column - セル操作の対象となる表列インデックス。
   */
  function autoFitColumnOnMouseUp(
    event: React.MouseEvent<HTMLDivElement>,
    column: number,
  ): void {
    const resize = columnResizeRef.current;
    if (!resize || resize.column !== column || resize.moved) return;
    event.preventDefault();
    autoFitColumn(column);
  }

  /**
   * 列リサイズハンドルの左右矢印キーで列幅を調整する。
   * @param event - 列リサイズハンドルの矢印キーによる幅調整keydown event。
   * @param column - セル操作の対象となる表列インデックス。
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
       * @param previous - キーボード調整前の列幅一覧。対象列の幅を増減する基準値。
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
   * @param event - pointer captureで行リサイズを始めるpointerdown event。
   * @param row - セル操作の対象となる表行インデックス。
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
   * セル内の折り返し表示を測り、指定行に必要な高さを設定する。
   * @param row - セル操作の対象となる表行インデックス。
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

       */
      (cell) => parseTableCellAddress(cell.dataset.tableCell)?.row === row,
    );
    if (!cells.length) return;

    const heights = cells.map(
       (cell) => {
        const clone = cell.cloneNode(false) as HTMLTextAreaElement;
        const parent = cell.parentElement;
        if (!parent) return MIN_ROW_HEIGHT;
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
        parent.appendChild(clone);
        const height = clone.scrollHeight;
        clone.remove();
        return height + AUTO_FIT_ROW_VERTICAL_BUFFER;
      },
    );
    const height = calculateAutoFitRowHeight(heights);
    setRowHeights(
      /**
       * @param previous - 自動調整前の行高一覧。計測した対象行の高さを反映する基準値。
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
   * 行高がドラッグで変わらなかった場合にセル内容へ自動フィットする。
   * @param event - 行リサイズ終了時にauto-fitを判定するpointerup event。
   * @param row - セル操作の対象となる表行インデックス。
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
    autoFitRow(row);
  }

  /**
   * 行リサイズハンドルの上下矢印キーで行高を調整する。
   * @param event - 行リサイズハンドルの矢印キーによる高さ調整keydown event。
   * @param row - セル操作の対象となる表行インデックス。
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
       * @param previous - キーボード調整前の行高一覧。対象行の高さを増減する基準値。
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
   * @param event - 表エディタータイトル部からoverlay移動を始めるpointerdown event。
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
   * @param event - 表エディターresize handleからoverlayサイズ変更を始めるpointerdown event。
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
   * 矢印キーでオーバーレイの幅または高さを調整する。
   * @param event - 矢印キーによるoverlay幅・高さの調整keydown event。
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
   * @param action - 選択中の表へ再適用する共有Markdown行・列操作。
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
    if (!next) return;

    const nextColumnCount = Math.max(
      1,
      next.alignments.length,
      ...next.rows.map((row) => row.length),
    );
    if (next.rows.length > MAX_ROWS || nextColumnCount > MAX_COLUMNS) {
      replaceDraft(next);
      return;
    }

    replaceDraft(next);
    if (action === "colBefore") {
      setSortState((current) =>
        remapTableEditorSortState(current, {
          kind: "insert",
          index: activeColumn,
          count: 1,
        }),
      );
    } else if (action === "colAfter") {
      setSortState((current) =>
        remapTableEditorSortState(current, {
          kind: "insert",
          index: activeColumn + 1,
          count: 1,
        }),
      );
    } else if (action === "deleteColumn") {
      setSortState((current) =>
        remapTableEditorSortState(current, {
          kind: "delete",
          index: activeColumn,
          count: 1,
        }),
      );
    }
  }

  /**
   * 表編集オーバーレイの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param action - 選択列へ適用する左・中央・右揃え操作。
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
   */
  function clearAlignment(): void {
    if (
      selectedColumns.every(
        /**

         * @param column - セル操作の対象となる表列インデックス。
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
       * @param previous - 変更前の列配置一覧。選択列をnoneにし、他列を保つ基準値。
       */
      (previous) =>
        Array.from(
          { length: columnCount },

          (_, index) =>
            selected.has(index) ? "none" : (previous[index] ?? "none"),
        ),
    );
  }

  /**
   * 表編集オーバーレイの要素を規則に従って並べ替える。
   * @param direction - 現在のセル選択から前後へ移動する符号付きセル数。
   */
  function moveCell(direction: 1 | -1): void {
    const flat = activeRow * columnCount + activeColumn + direction;
    const wrapped =
      (flat + rows.length * columnCount) % (rows.length * columnCount);
    focusCell(Math.floor(wrapped / columnCount), wrapped % columnCount);
  }

  /**
    * 現在のセルから上下の行へフォーカスを移す。
    * @param direction - 下へ移動する場合は1、上へ移動する場合は-1。
   */
  function moveVertical(direction: 1 | -1): void {
    focusCell(
      Math.max(0, Math.min(rows.length - 1, activeRow + direction)),
      activeColumn,
    );
  }

  /**
    * 指定したデータ行を別の行位置へ移動する。
   * @param source - 移動元の行インデックス。
   * @param target - 移動先の行インデックス。
   */
  function moveRow(source: number, target: number): void {
    const safeTarget = Math.max(1, Math.min(rows.length - 1, target));
    if (source <= 0 || source >= rows.length || source === safeTarget) return;
    recordHistory();
    setRows(moveTableGridRow(rows, source, safeTarget));
    setRowHeights(
      /**
       * @param previous - 変更前の行高一覧。行移動元と移動先に合わせて並べ替える対象。
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
   * 指定列を基準に全データ行を並べ替える。
   * @param column - ソート対象の列番号。
   */
  function sortRowsByColumn(column: number): void {
    if (rows.length <= 2 || column < 0 || column >= columnCount) return;

    const direction: TableEditorSortDirection =
      sortState?.column === column && sortState.direction === "ascending"
        ? "descending"
        : "ascending";
    const sorted = sortTableEditorRows(
      rows,
      column,
      direction,
      resolveLanguage(document.documentElement.lang),
    );

    recordHistory();
    setRows(sorted.rows);
    setRowHeights(sorted.sourceRowIndexes.map((index) => rowHeights[index]));
    setSortState({ column, direction });
    selectColumn(column);
    cellSelectionRef.current.clear();
    setStatus("");
  }

  /**
   * 次に実行する列ソート操作のラベルを取得する。
   * @param column - ソート対象の列番号。
   * @returns ボタンとツールチップで使うローカライズ済みラベル。
   */
  function sortButtonLabel(column: number): string {
    const currentDirection =
      sortState?.column === column ? sortState.direction : undefined;
    const nextDirection =
      currentDirection === "ascending" ? "descending" : "ascending";
    const directionLabel =
      nextDirection === "ascending"
        ? messages.app.tableEditor.sortAscending
        : messages.app.tableEditor.sortDescending;
    return `${directionLabel} ${tableGridColumnLabel(column)}`;
  }

  /**
    * 指定した列を別の列位置へ移動する。
   * @param source - 移動元の列インデックス。
   * @param target - 移動先の列インデックス。
   */
  function moveColumn(source: number, target: number): void {
    const safeTarget = Math.max(0, Math.min(columnCount - 1, target));
    if (source < 0 || source >= columnCount || source === safeTarget) return;
    const moved = moveTableGridColumn(rows, alignments, source, safeTarget);
    recordHistory();
    setSortState((current) =>
      remapTableEditorSortState(current, {
        kind: "move",
        from: source,
        to: safeTarget,
      }),
    );
    setRows(moved.rows);
    setAlignments(moved.alignments as TableEditorAlignment[]);
    setColumnWidths(
      /**
       * @param previous - 変更前の列幅一覧。列移動元と移動先に合わせて並べ替える対象。
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

  /** 選択したデータ行を複製し、表ヘッダーより後ろへ挿入する。 */
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

  /** 選択列を複製し、元の列範囲の直後へ挿入する。 */
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


      (_, index) => columnWidths[index] ?? DEFAULT_COLUMN_WIDTH,
    );
    nextWidths.splice(
      insertAt,
      0,
      ...nextWidths.slice(fromColumn, toColumn + 1),
    );
    setSortState((current) =>
      remapTableEditorSortState(current, {
        kind: "insert",
        index: insertAt,
        count: copyCount,
      }),
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
   * @param event - 見出し行以外の表データ行dragを開始するevent。
   * @param row - セル操作の対象となる表行インデックス。
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
   * @param event - 表列dragを開始するevent。
   * @param column - セル操作の対象となる表列インデックス。
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
   * @param event - 表行dragの有効なdrop先を許可するdragover event。
   * @param row - セル操作の対象となる表行インデックス。
   */
  function allowRowDrop(event: React.DragEvent, row: number): void {
    if (row <= 0 || gridDragRef.current?.kind !== "row") return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragTarget(
      /**

       * @param previous - 行ドラッグ中のdrop対象。新しい対象行と比較して更新する状態。
       */
      (previous) =>
        previous?.kind === "row" && previous.index === row
          ? previous
          : { kind: "row", index: row },
    );
  }

  /**
   * 表編集オーバーレイの条件を判定する。
   * @param event - 表列dragの有効なdrop先を許可するdragover event。
   * @param column - セル操作の対象となる表列インデックス。
   */
  function allowColumnDrop(event: React.DragEvent, column: number): void {
    if (gridDragRef.current?.kind !== "column") return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragTarget(
      /**

       * @param previous - 列ドラッグ中のdrop対象。新しい対象列と比較して更新する状態。
       */
      (previous) =>
        previous?.kind === "column" && previous.index === column
          ? previous
          : { kind: "column", index: column },
    );
  }

  /**
   * ドラッグ中のデータ行を指定位置へ移動し、選択状態を保つ。
   * @param event - ドラッグ中の表行を指定位置へ移動するdrop event。
   * @param row - セル操作の対象となる表行インデックス。
   */
  function dropRow(event: React.DragEvent, row: number): void {
    const drag = gridDragRef.current;
    if (drag?.kind !== "row" || row <= 0) return;
    event.preventDefault();
    moveRow(drag.source, row);
    endGridDrag();
  }

  /**
   * ドラッグ中の列を指定位置へ移動し、列に紐づく幅と配置を保つ。
   * @param event - ドラッグ中の表列を指定位置へ移動するdrop event。
   * @param column - セル操作の対象となる表列インデックス。
   */
  function dropColumn(event: React.DragEvent, column: number): void {
    const drag = gridDragRef.current;
    if (drag?.kind !== "column") return;
    event.preventDefault();
    moveColumn(drag.source, column);
    endGridDrag();
  }

  /** 行・列のドラッグ先表示とドラッグ状態を解除する。 */
  function endGridDrag(): void {
    gridDragRef.current = undefined;
    setDragTarget(undefined);
  }

  /**
   * 表編集オーバーレイのイベントまたはメッセージを受け取り、状態を更新する。
   * @param event - Alt+上下矢印による行移動を処理するkeydown event。
   * @param row - セル操作の対象となる表行インデックス。
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
   * @param event - Alt+左右矢印による列移動を処理するkeydown event。
   * @param column - セル操作の対象となる表列インデックス。
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
   * タブまたは改行を含むクリップボード内容を選択範囲へ表として貼り付ける。
   * @param event - セルtextareaへのTSV貼り付けを処理するclipboard event。
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
   * 指定セル範囲をTSV形式へ直列化する。
   * @param range - TSVコピーする正規化済み表セル範囲。開始・終了行と列を含む。

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
   * 現在のセル選択範囲をTSV文字列にする。

   */
  function selectedTsv(): string {
    return tsvForRange(normalizedSelection);
  }

  /**
   * 表編集オーバーレイの入力または状態を走査・複製する。
   * @param forceSelection - グリッド範囲がなくても選択中のセル・行・列をコピーする場合true。
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
   * 指定行が全列を含む現在の選択範囲に入っているかを判定する。
   * @param row - セル操作の対象となる表行インデックス。
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
   * 指定列が全行を含む現在の選択範囲に入っているかを判定する。
   * @param column - セル操作の対象となる表列インデックス。
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
   * 選択セルまたはセル範囲の位置と件数を示すサマリー文字列を作る。

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
    return `${messages.app.tableEditor.selection}: ${range} / ${selectedCellCount} ${messages.app.tableEditor.cells}`;
  }

  /**
   * 行と列の番号を、選択範囲表示に使う表アドレスへ変換する。
   * @param row - セル操作の対象となる表行インデックス。
   * @param column - セル操作の対象となる表列インデックス。

   */
  function cellAddress(row: number, column: number): string {
    return `${tableGridColumnLabel(column)}:${row === 0 ? "H" : row}`;
  }

  /**
   * 表編集オーバーレイの処理またはリソースを終了し、後続利用可能な状態へ戻す。
   */
  function closeAndRestoreFocus(): void {
    onClose();
    requestAnimationFrame(
      /**
       * 次の描画フレームで表示更新を実行する。
       */
      () => view.focus(),
    );
  }

  /**
   * 未保存変更を確認し、破棄が許可された場合に表編集を閉じる。
   */
  function requestClose(): void {
    if (isDirty && !window.confirm(messages.app.tableEditor.discard)) return;
    closeAndRestoreFocus();
  }

  /**
   * 表編集オーバーレイの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
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
            title={messages.app.tableEditor.modified}
            aria-label={messages.app.tableEditor.modified}
          >
            ● {messages.app.tableEditor.modified}
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

              () => applySharedTableAction("rowAfter")
            }
            disabled={rows.length >= MAX_ROWS}
          >
            {messages.app.tableEditor.addRow}
          </button>
          <button
            type="button"
            onClick={

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
          <button
            type="button"
            className="mve-table-editor-move-button"
            title={messages.app.tableEditor.moveRowUp}
            aria-label={messages.app.tableEditor.moveRowUp}
            onClick={() => moveRow(activeRow, activeRow - 1)}
            disabled={activeRow <= 1}
          >
            ↑
          </button>
          <button
            type="button"
            className="mve-table-editor-move-button"
            title={messages.app.tableEditor.moveRowDown}
            aria-label={messages.app.tableEditor.moveRowDown}
            onClick={() => moveRow(activeRow, activeRow + 1)}
            disabled={activeRow <= 0 || activeRow >= rows.length - 1}
          >
            ↓
          </button>
        </ToolbarGroup>
        <ToolbarGroup label={messages.ribbon.groups.columns}>
          <button
            type="button"
            onClick={

              () => applySharedTableAction("colAfter")
            }
            disabled={columnCount >= MAX_COLUMNS}
          >
            {messages.app.tableEditor.addColumn}
          </button>
          <button
            type="button"
            onClick={

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
          <button
            type="button"
            className="mve-table-editor-move-button"
            title={messages.app.tableEditor.moveColumnLeft}
            aria-label={messages.app.tableEditor.moveColumnLeft}
            onClick={() => moveColumn(activeColumn, activeColumn - 1)}
            disabled={activeColumn <= 0}
          >
            ←
          </button>
          <button
            type="button"
            className="mve-table-editor-move-button"
            title={messages.app.tableEditor.moveColumnRight}
            aria-label={messages.app.tableEditor.moveColumnRight}
            onClick={() => moveColumn(activeColumn, activeColumn + 1)}
            disabled={activeColumn >= columnCount - 1}
          >
            →
          </button>
        </ToolbarGroup>
        <ToolbarGroup label={messages.ribbon.groups.alignment}>
          <ToolbarToggle
            label={messages.app.tableEditor.alignLeft}
            active={currentAlignment === "left"}
            onClick={

              () => applySharedAlignmentAction("alignLeft")
            }
          />
          <ToolbarToggle
            label={messages.app.tableEditor.alignCenter}
            active={currentAlignment === "center"}
            onClick={

              () => applySharedAlignmentAction("alignCenter")
            }
          />
          <ToolbarToggle
            label={messages.app.tableEditor.alignRight}
            active={currentAlignment === "right"}
            onClick={

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
              /** 選択セルをクリップボードへTSV形式でコピーする。 */
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
              /** 選択範囲がない場合、アクティブセルへ強制改行を挿入する。 */
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
                title={messages.app.tableEditor.selectAll}
                aria-label={messages.app.tableEditor.selectAll}
                aria-selected={selectionKind === "all"}
                data-selected={selectionKind === "all" ? "true" : "false"}
                onClick={selectAllCells}
                onKeyDown={
                  /**
                   * keydownイベントでifを実行する。
                   * @param event - header cellのkeyboard操作で全セルを選択するevent。
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

                (_, columnIndex) => (
                  <th
                    key={columnIndex}
                    className="mve-table-editor-column-selector"
                    scope="col"
                    tabIndex={0}
                    aria-sort={
                      sortState?.column === columnIndex
                        ? sortState.direction
                        : undefined
                    }
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
                      /** 列見出しを押したとき、その列全体を選択する。 */
                      () => selectColumn(columnIndex)
                    }
                    onKeyDown={
                      /**
                       * keydownイベントでifを実行する。
                       * @param event - column selectorをkeyboard操作して列を選択するevent。
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
                       * @param event - 列dragのdrop先を許可するdragover event。
                       */
                      (event) => allowColumnDrop(event, columnIndex)
                    }
                    onDrop={
                      /**
                       * 列ドラッグをこの列の位置で確定する。
                       * @param event - ドラッグ中の列移動を確定するdrop event。
                       */
                      (event) => dropColumn(event, columnIndex)
                    }
                  >
                    <span>{tableGridColumnLabel(columnIndex)}</span>
                    <button
                      type="button"
                      className="mve-table-editor-sort-button"
                      data-column={columnIndex}
                      title={sortButtonLabel(columnIndex)}
                      aria-label={sortButtonLabel(columnIndex)}
                      disabled={rows.length <= 2}
                      onClick={(event) => {
                        event.stopPropagation();
                        sortRowsByColumn(columnIndex);
                      }}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <span aria-hidden="true">
                        {sortState?.column === columnIndex
                          ? sortState.direction === "ascending"
                            ? "↑"
                            : "↓"
                          : "↕"}
                      </span>
                    </button>
                    <span
                      className="mve-table-editor-axis-drag-handle"
                      role="button"
                      tabIndex={0}
                      draggable
                      title={messages.app.tableEditor.dragColumn}
                      aria-label={`${messages.app.tableEditor.dragColumn} ${tableGridColumnLabel(columnIndex)}`}
                      onPointerDown={
                        /**
                         * @param event - 列drag handle上のpointerdown伝播を止めるevent。
                         */
                        (event) => event.stopPropagation()
                      }
                      onClick={
                       /**
                        * ドラッグ用ハンドルの操作で行・列選択を誤発火させない。
                         * @param event - 列drag handle上のmousedown伝播を止めるevent。
                         */
                        (event) => event.stopPropagation()
                      }
                      onDragStart={
                        /**
                         * @param event - 列drag handleから列dragを開始するevent。
                         */
                        (event) => startColumnDrag(event, columnIndex)
                      }
                      onDragEnd={endGridDrag}
                      onKeyDown={
                        /**
                         * @param event - Alt+左右矢印による列移動を処理するkeydown event。
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
               * 表行ごとのReact要素を生成する。
               * @param row - 表示する行のセル文字列一覧。
               * @param rowIndex - 表の行インデックス。0はヘッダー行。
               * @returns 表行のReact要素。
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
                     * @param event - 行dragのdrop先を許可するdragover event。
                     */
                    (event) => allowRowDrop(event, rowIndex)
                  }
                  onDrop={
                    /**
                     * 行ドラッグをこの行の位置で確定する。
                     * @param event - ドラッグ中の行移動を確定するdrop event。
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
                      /** 行見出しを押したとき、その行全体を選択する。 */
                      () => selectRow(rowIndex)
                    }
                    onKeyDown={
                      /**
                       * keydownイベントでifを実行する。
                       * @param event - 行selectorをkeyboard操作して行を選択するevent。
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
                        title={messages.app.tableEditor.dragRow}
                        aria-label={`${messages.app.tableEditor.dragRow} ${rowIndex}`}
                        onPointerDown={
                          /**
                           * @param event - 行drag handle上のpointerdown伝播を止めるevent。
                           */
                          (event) => event.stopPropagation()
                        }
                        onClick={
                          /**
                           * ドラッグ用ハンドルの操作で行選択を誤発火させない。
                           * @param event - 行drag handle上のmousedown伝播を止めるevent。
                           */
                          (event) => event.stopPropagation()
                        }
                        onDragStart={
                          /**
                           * @param event - 行drag handleから行dragを開始するevent。
                           */
                          (event) => startRowDrag(event, rowIndex)
                        }
                        onDragEnd={endGridDrag}
                        onKeyDown={
                          /**
                           * @param event - Alt+上下矢印による行移動を処理するkeydown event。
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
                         * @param event - 行resize handleのpointerdownで行高さ調整を始めるevent。
                         */
                        (event) => startRowResize(event, rowIndex)
                      }
                      onPointerUp={
                        /**
                         * @param event - 行リサイズ終了時にauto-fitを判定するpointerup event。
                         */
                        (event) => autoFitRowOnPointerUp(event, rowIndex)
                      }
                      onKeyDown={
                        /**
                         * @param event - 矢印キーによる行高さ調整keydown event。
                         */
                        (event) => resizeRowByKeyboard(event, rowIndex)
                      }
                    />
                  </th>
                  {Array.from(
                    { length: columnCount },

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
                             * @param event - pointerdownで表セル選択を開始するevent。
                             */
                            (event) =>
                              beginCellSelection(event, rowIndex, columnIndex)
                          }
                          onPointerEnter={
                            /**
                             * @param event - セル範囲ドラッグ中に選択終端を更新するpointer event。
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
                               * @param event - focus時にセルtextareaの選択範囲を記録するevent。
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
                               * @param event - select時にセルtextareaの選択範囲を保存するevent。
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
                               * セル本文を更新し、選択範囲を維持する。
                               * @param event - セル値変更後のcaret範囲を保存するchange event。
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
                               * @param event - Backspace、Alt+Enter、Tab、Enterをセル編集規則へ振り分けるkeydown event。
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
                                 * @param event - 列resize handleのpointerdownで列幅調整を始めるevent。
                                 */
                                (event) => startColumnResize(event, columnIndex)
                              }
                              onMouseUp={
                                /**
                                 * @param event - 列リサイズ終了時のmouseupでauto-fitを判定するevent。
                                 */
                                (event) =>
                                  autoFitColumnOnMouseUp(event, columnIndex)
                              }
                              onKeyDown={
                                /**
                                 * @param event - 矢印キーによる列幅調整keydown event。
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
 * 表編集ツールバーのラベルと操作項目をグループ化する。
 * @param label - グループの表示名とアクセシブルな名前。
 * @param children - グループ内に表示する操作項目。
 * @param last - 最後のグループとして末尾用のスタイルを適用する場合はtrue。
 * @returns ツールバーグループのReact要素。
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

  /** グループ内に並べるボタンや入力コントロール。 */
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
 * 押下状態を表示する表編集ツールバーの切り替えボタンを作成する。
 * @param label - ボタンに表示する文言。
 * @param active - ボタンが有効状態かどうか。見た目とaria-pressedに反映する。
 * @param onClick - ボタン押下時に実行する処理。
 * @returns 切り替えボタンのReact要素。
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
  /** ボタンが押されたときに呼び出す処理。 */
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
 * クリップボードAPIまたは選択テキストを使って文字列をコピーする。
 * @param text クリップボードへ書き込むテキスト。
 * @param unavailableMessage コピーできない場合に表示するエラーメッセージ。
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
 * 改行を挿入先CodeMirror文書の改行形式へ揃える。
 * @param state - 挿入先CodeMirror文書の改行形式を持つEditorState。
 * @param value - エディターの改行形式へ変換して挿入する本文。
 * @returns 行区切りを挿入先文書に合わせた本文。
 */
function toEditorInsertion(state: EditorState, value: string): string {
  const separator = state.facet(EditorState.lineSeparator) ?? "\n";
  return value.replace(/\r\n?|\n/g, "\n").replace(/\n/g, separator);
}

/**
 * @file tableEditorOverlay.tsx
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
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

/** 「OPEN_EVENT」は、DOM操作またはメッセージ連携で使用する識別子です。 */
/** Webviewからテーブルエディターを開く要求を受けるDOMイベント名。 */
const OPEN_EVENT = "mve-open-table-editor";
/** 「MAX_ROWS」は、入力・表示・資源の上限または下限を表す値です。 */
/** 編集できるテーブル行数の上限。大きすぎるモーダルによる操作性低下を防ぐ。 */
const MAX_ROWS = 50;
/** 「MAX_COLUMNS」は、入力・表示・資源の上限または下限を表す値です。 */
/** 編集できるテーブル列数の上限。 */
const MAX_COLUMNS = 20;
/** 「MIN_COLUMN_WIDTH」は、入力・表示・資源の上限または下限を表す値です。 */
/** 列リサイズで許可する最小幅。共有設定の下限をオーバーレイにも適用する。 */
const MIN_COLUMN_WIDTH = TABLE_EDITOR_MIN_COLUMN_WIDTH;
/** 「MAX_AUTO_COLUMN_WIDTH」は、入力・表示・資源の上限または下限を表す値です。 */
/** 自動幅計算で許可する最大列幅。長いセルだけで画面が過度に広がるのを防ぐ。 */
const MAX_AUTO_COLUMN_WIDTH = TABLE_EDITOR_MAX_AUTO_COLUMN_WIDTH;
/** 「DEFAULT_COLUMN_WIDTH」は、関連する処理間で共有する設定値または状態です。 */
/** 明示的な列幅がない場合の初期幅。 */
const DEFAULT_COLUMN_WIDTH = 160;
/** 「ROW_HEADER_WIDTH」は、関連する処理間で共有する設定値または状態です。 */
/** 行見出し列の固定幅。 */
const ROW_HEADER_WIDTH = 42;
/** 「MIN_EDITOR_WIDTH」は、入力・表示・資源の上限または下限を表す値です。 */
/** モーダルを縮小したときの最小幅。 */
const MIN_EDITOR_WIDTH = 560;
/** 「MIN_EDITOR_HEIGHT」は、入力・表示・資源の上限または下限を表す値です。 */
/** モーダルを縮小したときの最小高さ。 */
const MIN_EDITOR_HEIGHT = 320;
/** 「DEFAULT_EDITOR_WIDTH」は、関連する処理間で共有する設定値または状態です。 */
/** テーブルエディターの初期幅。 */
const DEFAULT_EDITOR_WIDTH = 960;
/** 「DEFAULT_EDITOR_HEIGHT」は、関連する処理間で共有する設定値または状態です。 */
/** テーブルエディターの初期高さ。 */
const DEFAULT_EDITOR_HEIGHT = 680;
/** 「MIN_ROW_HEIGHT」は、入力・表示・資源の上限または下限を表す値です。 */
/** 行リサイズで許可する最小高さ。共有設定の下限をオーバーレイにも適用する。 */
const MIN_ROW_HEIGHT = TABLE_EDITOR_MIN_ROW_HEIGHT;
/** 「MIN_TEXTAREA_HEIGHT」は、入力・表示・資源の上限または下限を表す値です。 */
/** セル入力欄の最小高さ。空セルでも編集位置を視認できるようにする。 */
const MIN_TEXTAREA_HEIGHT = 34;
/** 「AUTO_FIT_ROW_VERTICAL_BUFFER」は、関連する処理間で共有する設定値または状態です。 */
/** 自動行高へ加える上下余白。入力文字列と境界が密着しないようにする。 */
const AUTO_FIT_ROW_VERTICAL_BUFFER = 4;
/** 「overlayRoot」は、対象ファイルまたは実行環境の場所を表す値です。 */
let overlayRoot: Root | undefined;
/** 「overlayHost」は、DOMまたは実行環境を保持する共有参照です。 */
let overlayHost: HTMLDivElement | undefined;

/**
 * 「CellSelection」として扱う値の型を定義します。
 */
type CellSelection = {
/**
 * 「from」は、本文または選択範囲の位置・長さを保持します。
 */
from: number;
/**
 * 「to」は、本文または選択範囲の位置・長さを保持します。
 */
to: number };
/**
 * 「ColumnResizeState」として扱う値の型を定義します。
 */
type ColumnResizeState = {

  /**
   * 「column」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  column: number;

  /**
   * 「startX」は、位置・サイズ・件数などを表す数値です。
   */
  startX: number;

  /**
   * 「startWidth」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  startWidth: number;

  /**
   * 「moved」は、処理条件または状態を表す真偽値です。
   */
  moved: boolean;
};
/**
 * 「RowResizeState」として扱う値の型を定義します。
 */
type RowResizeState = {

  /**
   * 「row」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  row: number;

  /**
   * 「pointerId」は、対象の識別や処理分岐に使用する値を保持します。
   */
  pointerId: number;

  /**
   * 「startY」は、位置・サイズ・件数などを表す数値です。
   */
  startY: number;

  /**
   * 「startHeight」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  startHeight: number;

  /**
   * 「moved」は、処理条件または状態を表す真偽値です。
   */
  moved: boolean;
};
/**
 * 「EditorSize」として扱う値の型を定義します。
 */
type EditorSize = {
/**
 * 「width」は、対象の位置、サイズ、件数、または範囲を保持します。
 */
width: number;
/**
 * 「height」は、対象の位置、サイズ、件数、または範囲を保持します。
 */
height: number };
/**
 * 「EditorDragState」として扱う値の型を定義します。
 */
type EditorDragState = {

  /**
   * 「pointerId」は、対象の識別や処理分岐に使用する値を保持します。
   */
  pointerId: number;

  /**
   * 「startX」は、位置・サイズ・件数などを表す数値です。
   */
  startX: number;

  /**
   * 「startY」は、位置・サイズ・件数などを表す数値です。
   */
  startY: number;

  /**
   * 「left」は、位置・サイズ・件数などを表す数値です。
   */
  left: number;

  /**
   * 「top」は、位置・サイズ・件数などを表す数値です。
   */
  top: number;

  /**
   * 「width」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  width: number;

  /**
   * 「height」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  height: number;
};
/**
 * 「EditorResizeState」として扱う値の型を定義します。
 */
type EditorResizeState = {

  /**
   * 「pointerId」は、対象の識別や処理分岐に使用する値を保持します。
   */
  pointerId: number;

  /**
   * 「startX」は、位置・サイズ・件数などを表す数値です。
   */
  startX: number;

  /**
   * 「startY」は、位置・サイズ・件数などを表す数値です。
   */
  startY: number;

  /**
   * 「startWidth」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  startWidth: number;

  /**
   * 「startHeight」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  startHeight: number;

  /**
   * 「left」は、位置・サイズ・件数などを表す数値です。
   */
  left: number;

  /**
   * 「top」は、位置・サイズ・件数などを表す数値です。
   */
  top: number;
};
/**
 * 「GridSelectionKind」として扱う値の型を定義します。
 */
type GridSelectionKind = "cells" | "row" | "column" | "all";
/**
 * 「GridDragState」として扱う値の型を定義します。
 */
type GridDragState = {
/**
 * 「kind」は、対象の識別や処理分岐に使用する値を保持します。
 */
kind: "row" | "column";
/**
 * 「source」は、読み込みまたは出力対象を示すパス・URL・内容を保持します。
 */
source: number };
/**
 * 「GridDropTarget」として扱う値の型を定義します。
 */
type GridDropTarget = {
/**
 * 「kind」は、対象の識別や処理分岐に使用する値を保持します。
 */
kind: "row" | "column";
/**
 * 「index」は、対象の位置、サイズ、件数、または範囲を保持します。
 */
index: number };
/**
 * 「TableEditorPolishText」として扱う値の型を定義します。
 */
type TableEditorPolishText = {

  /**
   * 「modified」は、対象の内容または識別子を表す文字列です。
   */
  modified: string;

  /**
   * 「discard」は、対象の内容または識別子を表す文字列です。
   */
  discard: string;

  /**
   * 「selection」は、対象の内容または識別子を表す文字列です。
   */
  selection: string;

  /**
   * 「cells」は、対象の内容または識別子を表す文字列です。
   */
  cells: string;

  /**
   * 「selectAll」は、対象の内容または識別子を表す文字列です。
   */
  selectAll: string;

  /**
   * 「dragRow」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  dragRow: string;

  /**
   * 「dragColumn」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  dragColumn: string;
};

/** 「TABLE_EDITOR_POLISH_TEXT」は、関連する処理間で共有する設定値または状態です。 */
/** テーブルエディターの補助説明文を言語別に保持し、セル操作の意味をUIへ表示するカタログ。 */
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
 * 「cellKey」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param row 本文、表、配列内の対象位置を示すインデックスです。
 * @param column 本文、表、配列内の対象位置を示すインデックスです。
 * @returns 「cellKey」が生成または変換した表編集の文字列を返します。
 */
function cellKey(row: number, column: number): string {
  return `${row}:${column}`;
}

/**
 * parse・table・cell・addressを解析または復元します。
 * @param value 「parseTableCellAddress」で検証・変換する入力値です。
 * @returns 計算結果の数値です。
 */
function parseTableCellAddress(
  value: string | undefined,
): {
/**
 * 「row」は、対象の位置、サイズ、件数、または範囲を保持します。
 */
row: number;
/**
 * 「column」は、対象の位置、サイズ、件数、または範囲を保持します。
 */
column: number } | undefined {
  const match = /^(\d+):(\d+)$/.exec(value ?? "");
  if (!match) return undefined;
  return { row: Number(match[1]), column: Number(match[2]) };
}

/**
 * 「rowTextareaStyle」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param rowHeight 処理対象の高さです。
 * @returns 「rowTextareaStyle」が対象を取得できない場合はundefinedを返します。
 */
function rowTextareaStyle(
  rowHeight: number | undefined,
): React.CSSProperties | undefined {
  if (rowHeight === undefined) return undefined;
  const cellHeight = Math.max(MIN_TEXTAREA_HEIGHT, rowHeight - 2);
  return { height: `${cellHeight}px`, minHeight: `${cellHeight}px` };
}

/**
 * 「tableEditorPolishText」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param language 表示文言の解決に使用する言語コードまたはロケールです。
 * @returns 「tableEditorPolishText」が生成または整形した表編集状態の文字列を返します。
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
 * 専用テーブルエディターをWebviewへ登録する。起動UIはReactのRibbon本体が担当する。
 * @returns 「installTableEditorOverlay」の副作用または状態更新を実行し、値は返しません。
 */
export function installTableEditorOverlay(): () => void {

  /**
   * openを開始します。
   * @returns 「open」が表編集状態の入力を処理して得た固有の結果を返します。
   */
  const open = /**
 * 「open」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @returns 「open」が表編集状態の入力を処理して得た固有の結果を返します。
 */ () => openTableEditor();
  window.addEventListener(OPEN_EVENT, open);
  return /** イベント情報を受け取り、DOMまたは画面状態を更新するコールバックです。 @returns 後片付けまたは登録解除を完了した結果を返します。 */ () => {
    window.removeEventListener(OPEN_EVENT, open);
    closeOverlay();
  };
}

/**
 * find・editor・viewを取得または解決します。
 * @returns 「findEditorView」が対象を取得できない場合はundefinedを返します。
 */
function findEditorView(): EditorView | undefined {
  const editor = document.querySelector<HTMLElement>(
    ".source-editor .cm-editor",
  );
  return editor ? (EditorView.findFromDOM(editor) ?? undefined) : undefined;
}

/**
 * エディターを開始します。
 * @returns 「openTableEditor」の副作用または状態更新を実行し、値は返しません。
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
 * close・overlayを解除または削除します。
 * @returns 購読解除、タイマー解除、またはリソース破棄を実行して値は返しません。
 */
function closeOverlay(): void {
  overlayRoot?.unmount();
  overlayRoot = undefined;
  overlayHost?.remove();
  overlayHost = undefined;
}

/**
 * 「showOverlayToast」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param message 処理対象のメッセージです。
 * @returns 「showOverlayToast」の副作用または状態更新を実行し、値は返しません。
 */
function showOverlayToast(message: string): void {
  const toast = document.createElement("div");
  toast.className = "mve-table-editor-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(
  /**
 * 指定時間の経過後に遅延処理を実行するコールバックです。
   * @returns 「toast.remove」を実行し、値を返しません。
   */
  () => toast.remove(), 2400);
}

/**
 * 「TableEditorOverlay」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param props 「props」は、「TableEditorOverlay」が表編集状態の処理対象を特定する入力です。
 * @returns 「TableEditorOverlay」が表編集状態の入力を処理して得た固有の結果を返します。
 */
function TableEditorOverlay({
  view,
  initial,
  messages,
  onClose,
}: {

  /**
   * 「view」は、画面の表示モードまたは現在のUI状態を示します。
   */
  view: EditorView;

  /**
   * 「initial」は、関連処理が共有する構造化データの一項目です。
   */
  initial: TableEditorDraft;

  /**
   * 「messages」は、画面または通知へ表示する文言を保持します。
   */
  messages: Messages;
  /**
   * 「onClose」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @returns イベントを処理し、状態更新または副作用だけを実行して値は返しません。
   */
  onClose: () => void;
}): React.JSX.Element {
  const [rows, setRows] = useState(
  /**
 * Reactの初期状態またはメモ化値を遅延計算するコールバックです。
   * @returns Reactが保持する初期状態またはメモ化値を返します。
   */
  () =>
    initial.rows.map(
    /**
 * 「row」を変換し、変換後の要素を返すコールバックです。
     * @param row 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (row) => row.slice()),
  );
  const [alignments, setAlignments] = useState<TableEditorAlignment[]>(
  /**
 * 登録された副作用または結果を生成する処理を実行するコールバックです。
   * @returns 「initial.alignments.slice」の呼び出し結果を返します。
   */
  () =>
    initial.alignments.slice(),
  );
  const [activeRow, setActiveRow] = useState(initial.activeRow);
  const [activeColumn, setActiveColumn] = useState(initial.activeColumn);
  const [gridSelection, setGridSelection] = useState<TableGridRange>(
  /**
 * （anchorRow、anchorColumn、focusRow、focusColumn、width）を持つオブジェクトを初期化して返すコールバックです。
   * @returns 初期化したオブジェクト（anchorRow、anchorColumn、focusRow、focusColumn、width）を返します。
   */
  () => ({
    anchorRow: initial.activeRow,
    anchorColumn: initial.activeColumn,
    focusRow: initial.activeRow,
    focusColumn: initial.activeColumn,
  }));
  const [selectionKind, setSelectionKind] = useState<GridSelectionKind>("cells");
  const [dragTarget, setDragTarget] = useState<GridDropTarget>();
  const [status, setStatus] = useState("");
  const [historyRevision, setHistoryRevision] = useState(0);
  const [editorSize, setEditorSize] = useState<EditorSize>({
    width: DEFAULT_EDITOR_WIDTH,
    height: DEFAULT_EDITOR_HEIGHT,
  });
  const [editorPosition, setEditorPosition] = useState<{

    /**
     * 「left」は、位置・サイズ・件数などを表す数値です。
     */
    left: number;

    /**
     * 「top」は、位置・サイズ・件数などを表す数値です。
     */
    top: number;
  }>();
  const [rowHeights, setRowHeights] = useState<Array<number | undefined>>(
  /**
 * 登録された副作用または結果を生成する処理を実行するコールバックです。
   * @returns 「Array.from」の呼び出し結果を返します。
   */
  () =>
    Array.from({ length: initial.rows.length },
    /**
 * 登録された処理から配列要素を生成するコールバックです。
     * @returns 配列要素または初期値を返します。
     */
    () => undefined),
  );
  const initialColumnCount = Math.max(
    1,
    initial.alignments.length,
    ...initial.rows.map(
    /**
 * 「row」を変換し、変換後の要素を返すコールバックです。
     * @param row 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (row) => row.length),
  );
  const [columnWidths, setColumnWidths] = useState<number[]>(
  /**
 * 登録された副作用または結果を生成する処理を実行するコールバックです。
   * @returns 「Array.from」の呼び出し結果を返します。
   */
  () =>
    Array.from({ length: initialColumnCount },
    /**
 * 登録された処理から配列要素を生成するコールバックです。
     * @returns 配列要素または初期値を返します。
     */
    () => DEFAULT_COLUMN_WIDTH),
  );
  const overlayRef = useRef<HTMLDivElement>(null);
  const cellSelectionRef = useRef(new Map<string, CellSelection>());
  const columnResizeRef = useRef<ColumnResizeState | undefined>(undefined);
  const rowResizeRef = useRef<RowResizeState | undefined>(undefined);
  const editorDragRef = useRef<EditorDragState | undefined>(undefined);
  const editorResizeRef = useRef<EditorResizeState | undefined>(undefined);
  const selectionDragRef = useRef<
    {
    /**
     * 「row」は、対象の位置、サイズ、件数、または範囲を保持します。
     */
    row: number;
    /**
     * 「column」は、対象の位置、サイズ、件数、または範囲を保持します。
     */
    column: number } | undefined
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
 * 「row」を変換し、変換後の要素を返すコールバックです。
     * @param row 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (row) => row.length),
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
      length:
        normalizedSelection.toColumn - normalizedSelection.fromColumn + 1,
    },

    /**
 * 「_」「index」から配列要素を生成するコールバックです。
     * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
     * @param index 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 「_」「index」から生成した処理結果を返します。
     */
    (_, index) => normalizedSelection.fromColumn + index,
  );
  const selectedAlignmentValues = selectedColumns.map(

    /**
 * 「column」を変換し、変換後の要素を返すコールバックです。
     * @param column 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (column) => alignments[column] ?? "none",
  );
  const currentAlignment = selectedAlignmentValues.every(

    /**
 * 「value」が条件を満たすか判定し、全要素の適合結果を返すコールバックです。
     * @param value 「value」で検証・変換する入力値です。
     * @returns 条件判定の結果を示す真偽値を返します。
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
 * 「_」「index」から配列要素を生成するコールバックです。
       * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
       * @param index 本文、表、配列内の対象位置を示すインデックスです。
       * @returns 「_」「index」から生成した処理結果を返します。
       */
      (_, index) => columnWidths[index] ?? DEFAULT_COLUMN_WIDTH,
    ).reduce(
    /**
     * 累積値と入力を「total」「width」を受け取り、集約結果を更新するコールバックです。
     * @param total totalとして渡される、このコールバックの入力値です。
     * @param width 処理対象の幅です。
     * @returns 更新後の累積値を返します。
     */
    (total, width) => total + width, 0);
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
 * Reactの初期状態またはメモ化値を遅延計算するコールバックです。
   * @returns Reactが保持する初期状態またはメモ化値を返します。
   */
  () => {
    const frame = requestAnimationFrame(
    /**
 * 次の描画フレームでUI更新処理を実行するコールバックです。
     * @returns 「focusCell」の呼び出し結果を返します。
     */
    () =>
      focusCell(activeRow, activeColumn, false),
    );
    return /** 遅延処理の予約を受け、タイマーまたはアニメーションフレームを解除するコールバックです。 @returns 後片付けまたは登録解除を完了した結果を返します。 */ () => cancelAnimationFrame(frame);
  }, []);

  useEffect(
  /**
 * Reactの初期状態またはメモ化値を遅延計算するコールバックです。
   * @returns Reactが保持する初期状態またはメモ化値を返します。
   */
  () => {

    /**
     * 「onKeyDown」は、イベント入力を受け取り、関連する状態またはUIを更新する処理です。
     * @param event 処理対象のイベントです。
     * @returns 「event.key.toLowerCase」を実行し、値を返しません。
     */
    const onKeyDown = /**
 * 「onKeyDown」は、イベント入力を検証し、関連する状態またはUIを更新します。
 * @param event DOMイベントまたは入力イベントの情報です。
 * @returns 「event.key.toLowerCase」を実行し、値を返しません。
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
    return /** イベント情報を受け取り、DOMまたは画面状態を更新するコールバックです。 @returns 後片付けまたは登録解除を完了した結果を返します。 */ () => window.removeEventListener("keydown", onKeyDown, true);
  });

  useEffect(
  /**
   * イベント情報を受け取り、DOMまたは画面状態を更新するコールバックです。
   * @returns Reactが保持する初期状態またはメモ化値を返します。
   */
  () => {

    /**
     * 「onMouseMove」は、イベント入力を受け取り、関連する状態またはUIを更新する処理です。
     * @param event 処理対象のイベントです。
     * @returns 「event」から生成した処理結果を返します。
     */
    const onMouseMove = /**
 * 「onMouseMove」は、イベント入力を検証し、関連する状態またはUIを更新します。
 * @param event DOMイベントまたは入力イベントの情報です。
 * @returns 「event」から生成した処理結果を返します。
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
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
       * @param previous previousとして渡される、このコールバックの入力値です。
       * @returns 「previous」から生成した処理結果を返します。
       */
      (previous) => {
        if (previous[resize.column] === width) return previous;
        const next = previous.slice();
        while (next.length <= resize.column) next.push(DEFAULT_COLUMN_WIDTH);
        next[resize.column] = width;
        return next;
      });
    };

    /**
     * 「onMouseUp」は、イベント入力を受け取り、関連する状態またはUIを更新する処理です。
     * @returns 「window.addEventListener」の呼び出し結果を返します。
     */
    const onMouseUp = /**
 * 「onMouseUp」は、イベント入力を検証し、関連する状態またはUIを更新します。
 * @returns 「window.addEventListener」の呼び出し結果を返します。
 */ () => {
      columnResizeRef.current = undefined;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return /** イベント情報を受け取り、DOMまたは画面状態を更新するコールバックです。 @returns 後片付けまたは登録解除を完了した結果を返します。 */ () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  useEffect(
  /**
 * Reactの初期状態またはメモ化値を遅延計算するコールバックです。
   * @returns Reactが保持する初期状態またはメモ化値を返します。
   */
  () => {

    /**
     * 「onPointerMove」は、イベント入力を受け取り、関連する状態またはUIを更新する処理です。
     * @param event 処理対象のイベントです。
     * @returns 「if」を実行し、値を返しません。
     */
    const onPointerMove = /**
 * 「onPointerMove」は、イベント入力を検証し、関連する状態またはUIを更新します。
 * @param event DOMイベントまたは入力イベントの情報です。
 * @returns 「if」を実行し、値を返しません。
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
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
         * @param previous previousとして渡される、このコールバックの入力値です。
         * @returns 「previous」から生成した処理結果を返します。
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
        const maxLeft = Math.max(16, window.innerWidth - editorDrag.width - 16);
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
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
         * @param previous previousとして渡される、このコールバックの入力値です。
         * @returns 「previous」から生成した処理結果を返します。
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
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
       * @param previous previousとして渡される、このコールバックの入力値です。
       * @returns 「previous」から生成した処理結果を返します。
       */
      (previous) => {
        if (previous[rowResize.row] === height) return previous;
        const next = previous.slice();
        while (next.length <= rowResize.row) next.push(undefined);
        next[rowResize.row] = height;
        return next;
      });
    };

    /**
     * 「onPointerUp」は、イベント入力を受け取り、関連する状態またはUIを更新する処理です。
     * @param event 処理対象のイベントです。
     * @returns 「if」を実行し、値を返しません。
     */
    const onPointerUp = /**
 * 「onPointerUp」は、イベント入力を検証し、関連する状態またはUIを更新します。
 * @param event DOMイベントまたは入力イベントの情報です。
 * @returns 「event」から生成した処理結果を返します。
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
    return /** イベント情報を受け取り、DOMまたは画面状態を更新するコールバックです。 @returns 後片付けまたは登録解除を完了した結果を返します。 */ () => {
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
  }, []);

  const tsv = useMemo(
  /**
   * 依存状態から再利用可能な派生値を計算するコールバックです。
   * @returns 依存状態から計算した派生値を返します。
   */
  () => {
    const rendered = renderTableEditorDraft(currentDraft());
    return (
      markdownTableToTsv(rendered.text, {
        from: rendered.caretOffset,
        to: rendered.caretOffset,
      }) ?? ""
    );
  }, [rows, alignments, activeRow, activeColumn]);

  /**
   * 「currentDraft」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @returns 「currentDraft」が表編集状態の入力を処理して得た固有の結果を返します。
   */
  function currentDraft(): TableEditorDraft {
    return {
      ...initial,
      rows,
      alignments: Array.from(
        { length: columnCount },

        /**
 * 「_」「index」を受け取り、処理結果を生成する処理です。
         * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
         * @param index 本文、表、配列内の対象位置を示すインデックスです。
         * @returns 「_」「index」から生成した処理結果を返します。
         */
        (_, index) => alignments[index] ?? "none",
      ),
      activeRow,
      activeColumn,
    };
  }

  /**
   * 「currentHistorySnapshot」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @returns 「currentHistorySnapshot」が表編集状態の入力を処理して得た固有の結果を返します。
   */
  function currentHistorySnapshot(): TableEditorHistorySnapshot {
    return {
      rows: rows.map(
      /**
 * 「row」を変換し、変換後の要素を返すコールバックです。
       * @param row 本文、表、配列内の対象位置を示すインデックスです。
       * @returns 入力要素から生成した変換後の値を返します。
       */
      (row) => row.slice()),
      alignments: Array.from(
        { length: columnCount },

        /**
 * 「_」「index」から配列要素を生成するコールバックです。
         * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
         * @param index 本文、表、配列内の対象位置を示すインデックスです。
         * @returns 「_」「index」から生成した処理結果を返します。
         */
        (_, index) => alignments[index] ?? "none",
      ),
      activeRow,
      activeColumn,
      rowHeights: rowHeights.slice(),
      columnWidths: Array.from(
        { length: columnCount },

        /**
 * 「_」「index」を受け取り、処理結果を生成する処理です。
         * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
         * @param index 本文、表、配列内の対象位置を示すインデックスです。
         * @returns 「_」「index」から生成した処理結果を返します。
         */
        (_, index) => columnWidths[index] ?? DEFAULT_COLUMN_WIDTH,
      ),
      gridSelection: { ...gridSelection },
      selectionKind,
    };
  }

  /**
   * 履歴を更新または保存します。
   * @returns 「recordHistory」の副作用または状態更新を実行し、値は返しません。
   */
  function recordHistory(): void {
    recordTableEditorHistory(historyRef.current, currentHistorySnapshot());
    setHistoryRevision(
    /**
 * 「value」を受け取り、処理結果を生成する処理です。
     * @param value 「value」で検証・変換する入力値です。
     * @returns 「value」から生成した処理結果を返します。
     */
    (value) => value + 1);
  }

  /**
   * 「undoDraft」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @returns 「undoDraft」の副作用または状態更新を実行し、値は返しません。
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
 * 「value」を受け取り、処理結果を生成する処理です。
     * @param value 「value」で検証・変換する入力値です。
     * @returns 「value」から生成した処理結果を返します。
     */
    (value) => value + 1);
  }

  /**
   * 「redoDraft」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @returns 「redoDraft」の副作用または状態更新を実行し、値は返しません。
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
 * 「value」を受け取り、登録された副作用または結果を生成する処理です。
     * @param value 「value」で検証・変換する入力値です。
     * @returns 「value」から生成した処理結果を返します。
     */
    (value) => value + 1);
  }

  /**
   * 「restoreHistorySnapshot」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param snapshot 「snapshot」は、「restoreHistorySnapshot」が表編集状態の処理対象を特定する入力です。
   * @returns 「restoreHistorySnapshot」の副作用または状態更新を実行し、値は返しません。
   */
  function restoreHistorySnapshot(snapshot: TableEditorHistorySnapshot): void {
    const nextRows = snapshot.rows.map(
    /**
 * 「row」を変換し、変換後の要素を返すコールバックです。
     * @param row 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (row) => row.slice());
    const nextColumns = Math.max(
      1,
      snapshot.alignments.length,
      ...nextRows.map(
      /**
 * 「row」を変換し、変換後の要素を返すコールバックです。
       * @param row 本文、表、配列内の対象位置を示すインデックスです。
       * @returns 入力要素から生成した変換後の値を返します。
       */
      (row) => row.length),
    );
    const safeActiveRow = Math.max(
      0,
      Math.min(nextRows.length - 1, snapshot.activeRow),
    );
    const safeActiveColumn = Math.max(
      0,
      Math.min(nextColumns - 1, snapshot.activeColumn),
    );

    /**
     * 行を正規化します。
     * @param row 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 計算結果の数値です。
     */
    const clampRow = /**
 * 「clampRow」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param row 処理対象を特定する位置、範囲、または数量です。
 * @returns 「clampRow」が表編集状態の入力を処理して得た固有の結果を返します。
 */ (row: number): number =>
      Math.max(0, Math.min(nextRows.length - 1, row));

    /**
     * 列を正規化します。
     * @param column 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 計算結果の数値です。
     */
    const clampColumn = /**
 * 「clampColumn」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param column 処理対象を特定する位置、範囲、または数量です。
 * @returns 「clampColumn」が表編集状態の入力を処理して得た固有の結果を返します。
 */ (column: number): number =>
      Math.max(0, Math.min(nextColumns - 1, column));
    setRows(nextRows);
    setAlignments(
      Array.from(
        { length: nextColumns },

        /**
 * 「_」「index」から配列要素を生成するコールバックです。
         * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
         * @param index 本文、表、配列内の対象位置を示すインデックスです。
         * @returns 「_」「index」から生成した処理結果を返します。
         */
        (_, index) => snapshot.alignments[index] ?? "none",
      ),
    );
    setColumnWidths(
      Array.from(
        { length: nextColumns },

        /**
 * 「_」「index」から配列要素を生成するコールバックです。
         * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
         * @param index 本文、表、配列内の対象位置を示すインデックスです。
         * @returns 「_」「index」から生成した処理結果を返します。
         */
        (_, index) => snapshot.columnWidths[index] ?? DEFAULT_COLUMN_WIDTH,
      ),
    );
    setRowHeights(
      Array.from(
        { length: nextRows.length },

        /**
 * 「_」「index」から配列要素を生成するコールバックです。
         * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
         * @param index 本文、表、配列内の対象位置を示すインデックスです。
         * @returns 「_」「index」から生成した処理結果を返します。
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
   * 「singleCellSelection」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param row 本文、表、配列内の対象位置を示すインデックスです。
   * @param column 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 「singleCellSelection」の副作用または状態更新を実行し、値は返しません。
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
   * 「focusCell」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param row 本文、表、配列内の対象位置を示すインデックスです。
   * @param column 本文、表、配列内の対象位置を示すインデックスです。
   * @param select 「select」は、「focusCell」が表編集状態の処理対象を特定する入力です。
   * @param rowCount 「rowCount」は、「focusCell」が表編集で処理する対象を特定する入力です。
   * @param columns 「columns」は、「focusCell」が表編集で処理する対象を特定する入力です。
   * @returns 「focusCell」の副作用または状態更新を実行し、値は返しません。
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
 * 次の描画フレームでUI更新処理を実行するコールバックです。
     * @returns 「focus」を実行し、値を返しません。
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
    });
  }

  /**
   * 「replaceDraft」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param next 「next」は、「replaceDraft」が表編集状態の処理対象を特定する入力です。
   * @param captureHistory 「captureHistory」は、「replaceDraft」が表編集状態の処理対象を特定する入力です。
   * @returns 「replaceDraft」の副作用または状態更新を実行し、値は返しません。
   */
  function replaceDraft(next: TableEditorDraft, captureHistory = true): void {
    const nextRows = next.rows.map(
    /**
 * 「row」を変換し、変換後の要素を返すコールバックです。
     * @param row 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (row) => row.slice());
    const nextColumns = Math.max(
      1,
      next.alignments.length,
      ...nextRows.map(
      /**
 * 「row」を変換し、変換後の要素を返すコールバックです。
       * @param row 本文、表、配列内の対象位置を示すインデックスです。
       * @returns 入力要素から生成した変換後の値を返します。
       */
      (row) => row.length),
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
 * 「_」「index」から配列要素を生成するコールバックです。
         * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
         * @param index 本文、表、配列内の対象位置を示すインデックスです。
         * @returns 「_」「index」から生成した処理結果を返します。
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
 * 「previous」を受け取り、登録された副作用または結果を生成する処理です。
     * @param previous previousとして渡される、このコールバックの入力値です。
     * @returns 「previous」から生成した処理結果を返します。
     */
    (previous) =>
      Array.from(
        { length: nextColumns },

        /**
 * 「_」「index」から配列要素を生成するコールバックです。
         * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
         * @param index 本文、表、配列内の対象位置を示すインデックスです。
         * @returns 「_」「index」から生成した処理結果を返します。
         */
        (_, index) => previous[index] ?? DEFAULT_COLUMN_WIDTH,
      ),
    );
    setRowHeights(
    /**
 * 「previous」を受け取り、登録された副作用または結果を生成する処理です。
     * @param previous previousとして渡される、このコールバックの入力値です。
     * @returns 「previous」から生成した処理結果を返します。
     */
    (previous) =>
      Array.from({ length: nextRows.length },
      /**
 * 「_」「index」から配列要素を生成するコールバックです。
       * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
       * @param index 本文、表、配列内の対象位置を示すインデックスです。
       * @returns 「_」「index」から生成した処理結果を返します。
       */
      (_, index) => previous[index]),
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
   * セルを更新または保存します。
   * @param row 本文、表、配列内の対象位置を示すインデックスです。
   * @param column 本文、表、配列内の対象位置を示すインデックスです。
   * @param value 「updateCell」で検証・変換する入力値です。
   * @returns 「updateCell」の副作用または状態更新を実行し、値は返しません。
   */
  function updateCell(row: number, column: number, value: string): void {
    const normalized = tableEditorCellStoredValue(value, rows[row]?.[column] ?? '');
    if ((rows[row]?.[column] ?? "") === normalized) return;
    recordHistory();
    setRows(
    /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
     * @param previous previousとして渡される、このコールバックの入力値です。
     * @returns 「previous」から生成した処理結果を返します。
     */
    (previous) =>
      previous.map(
      /**
 * 「current」「rowIndex」を変換し、変換後の要素を返すコールバックです。
       * @param current currentとして渡される、このコールバックの入力値です。
       * @param rowIndex 「rowIndex」は、「current」が表編集で処理する対象を特定する入力です。
       * @returns 入力要素から生成した変換後の値を返します。
       */
      (current, rowIndex) => {
        if (rowIndex !== row) return current;
        const next = Array.from(
          { length: columnCount },

          /**
 * 「_」「index」を受け取り、処理結果を生成する処理です。
           * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
           * @param index 本文、表、配列内の対象位置を示すインデックスです。
           * @returns 「_」「index」から生成した処理結果を返します。
           */
          (_, index) => current[index] ?? "",
        );
        next[column] = normalized;
        return next;
      }),
    );
  }

  /**
   * 選択を更新または保存します。
   * @param row 本文、表、配列内の対象位置を示すインデックスです。
   * @param column 本文、表、配列内の対象位置を示すインデックスです。
   * @param element 処理対象の要素です。
   * @returns 「rememberCellSelection」の副作用または状態更新を実行し、値は返しません。
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
   * 選択を開始します。
   * @param event 処理対象のイベントです。
   * @param row 本文、表、配列内の対象位置を示すインデックスです。
   * @param column 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 「beginCellSelection」の副作用または状態更新を実行し、値は返しません。
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
 * 「previous」から（focusRow、focusColumn、event、row、column）のオブジェクトを生成して返すコールバックです。
       * @param previous previousとして渡される、このコールバックの入力値です。
       * @returns 初期化したオブジェクト（focusRow、focusColumn、event、row、column）を返します。
       */
      (previous) => ({
        ...previous,
        focusRow: row,
        focusColumn: column,
      }));
      return;
    }
    selectionDragRef.current = { row, column };
    singleCellSelection(row, column);
  }

  /**
   * 「extendCellSelection」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param event 処理対象のイベントです。
   * @param row 本文、表、配列内の対象位置を示すインデックスです。
   * @param column 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 「extendCellSelection」の副作用または状態更新を実行し、値は返しません。
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
   * 「selectRow」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param row 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 「selectRow」の副作用または状態更新を実行し、値は返しません。
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
   * 「selectColumn」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param column 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 「selectColumn」の副作用または状態更新を実行し、値は返しません。
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
   * 「selectAllCells」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @returns 「selectAllCells」の副作用または状態更新を実行し、値は返しません。
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
   * clear・selected・cellsを解除または削除します。
   * @returns 「clearSelectedCells」の副作用または状態更新を実行し、値は返しません。
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
   * 「insertLineBreak」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param row 本文、表、配列内の対象位置を示すインデックスです。
   * @param column 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 「insertLineBreak」の副作用または状態更新を実行し、値は返しません。
   */
  function insertLineBreak(
    row = activeRow,
    column = activeColumn,
  ): void {
    const value = rows[row]?.[column] ?? "";
    const displayValue = tableEditorCellDisplayValue(value);
    const selection = cellSelectionRef.current.get(
      cellKey(row, column),
    );
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
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
     * @param previous previousとして渡される、このコールバックの入力値です。
     * @returns 「previous」から生成した処理結果を返します。
     */
    (previous) =>
      previous.map(
      /**
 * 「current」「rowIndex」を変換し、変換後の要素を返すコールバックです。
       * @param current currentとして渡される、このコールバックの入力値です。
       * @param rowIndex 「rowIndex」は、「current」が表編集で処理する対象を特定する入力です。
       * @returns 入力要素から生成した変換後の値を返します。
       */
      (current, rowIndex) => {
        if (rowIndex !== row) return current;
        const next = Array.from(
          { length: columnCount },

          /**
 * 「_」「index」を受け取り、処理結果を生成する処理です。
           * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
           * @param index 本文、表、配列内の対象位置を示すインデックスです。
           * @returns 配列要素または初期値を返します。
           */
          (_, index) => current[index] ?? "",
        );
        next[column] = edit.value;
        return next;
      }),
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
 * 次の描画フレームでUI更新処理を実行するコールバックです。
     * @returns 「focus」の呼び出し結果を返します。
     */
    () => {
      const element = overlayRef.current?.querySelector<HTMLTextAreaElement>(
        `[data-table-cell="${key}"]`,
      );
      element?.focus();
      element?.setSelectionRange(displayCaretOffset, displayCaretOffset);
      autoFitRow(row);
    });
  }

  /**
   * delete・line・break・before・display・offsetを解除または削除します。
   * @param row 本文、表、配列内の対象位置を示すインデックスです。
   * @param column 本文、表、配列内の対象位置を示すインデックスです。
   * @param displayOffset 本文または選択範囲を示すゼロ基準の位置です。範囲の開始・終了や写像の基準になります。
   * @returns 判定結果です。
   */
  function deleteLineBreakBeforeDisplayOffset(
    row: number,
    column: number,
    displayOffset: number,
  ): boolean {
    const value = rows[row]?.[column] ?? "";
    const edit = deleteTableEditorLineBreakBeforeDisplayOffset(value, displayOffset);
    if (!edit) return false;

    recordHistory();
    setRows(
    /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
     * @param previous previousとして渡される、このコールバックの入力値です。
     * @returns 「previous」から生成した処理結果を返します。
     */
    (previous) =>
      previous.map(
      /**
 * 「current」「rowIndex」を変換し、変換後の要素を返すコールバックです。
       * @param current currentとして渡される、このコールバックの入力値です。
       * @param rowIndex 「rowIndex」は、「current」が表編集で処理する対象を特定する入力です。
       * @returns 入力要素から生成した変換後の値を返します。
       */
      (current, rowIndex) => {
        if (rowIndex !== row) return current;
        const next = Array.from(
          { length: columnCount },

          /**
 * 「_」「index」を受け取り、処理結果を生成する処理です。
           * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
           * @param index 本文、表、配列内の対象位置を示すインデックスです。
           * @returns 配列要素または初期値を返します。
           */
          (_, index) => current[index] ?? "",
        );
        next[column] = edit.value;
        return next;
      }),
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
 * 次の描画フレームでUI更新処理を実行するコールバックです。
     * @returns 「focus」の呼び出し結果を返します。
     */
    () => {
      const element = overlayRef.current?.querySelector<HTMLTextAreaElement>(
        `[data-table-cell="${key}"]`,
      );
      element?.focus();
      element?.setSelectionRange(edit.caretOffset, edit.caretOffset);
      autoFitRow(row);
    });
    return true;
  }

  /**
   * start・column・resizeを開始します。
   * @param event 処理対象のイベントです。
   * @param column 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 「startColumnResize」の副作用または状態更新を実行し、値は返しません。
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
   * 「autoFitColumn」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param column 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 「autoFitColumn」の副作用または状態更新を実行し、値は返しません。
   */
  function autoFitColumn(column: number): void {
    const editor = overlayRef.current;
    if (!editor) return;
    const cells = Array.from(
      editor.querySelectorAll<HTMLTextAreaElement>(
        "textarea[data-table-cell]",
      ),
    ).filter(

      /**
 * 「cell」が条件に一致するか判定し、残す要素を決めるコールバックです。
       * @param cell 処理対象のセルです。
       * @returns 要素を採用するかどうかの真偽値を返します。
       */
      (cell) => parseTableCellAddress(cell.dataset.tableCell)?.column === column,
    );
    const sample = cells[0];
    if (!sample) return;

    const style = getComputedStyle(sample);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const letterSpacing = Number.parseFloat(style.letterSpacing) || 0;

    /**
     * measureを計算します。
     * @param value 「measure」で検証・変換する入力値です。
     * @returns 計算結果の数値です。
     */
    const measure = /**
 * 「measure」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param value 「measure」で検証・変換する入力値です。
 * @returns 「measure」が表編集状態の入力を処理して得た固有の結果を返します。
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
 * 「cell」を変換し、変換後の要素を返すコールバックです。
       * @param cell 処理対象のセルです。
       * @returns 入力要素から生成した変換後の値を返します。
       */
      (cell) => cell.value),
      measure,
      horizontalChrome,
      MIN_COLUMN_WIDTH,
      MAX_AUTO_COLUMN_WIDTH,
    );
    setColumnWidths(
    /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
     * @param previous previousとして渡される、このコールバックの入力値です。
     * @returns 「previous」から生成した処理結果を返します。
     */
    (previous) => {
      const next = previous.slice();
      while (next.length <= column) next.push(DEFAULT_COLUMN_WIDTH);
      if (next[column] === width) return previous;
      next[column] = width;
      return next;
    });
  }

  /**
   * 「autoFitColumnOnMouseUp」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param event 処理対象のイベントです。
   * @param column 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 「autoFitColumnOnMouseUp」の副作用または状態更新を実行し、値は返しません。
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
   * resize・column・by・keyboardを移動または調整します。
   * @param event 処理対象のイベントです。
   * @param column 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 「resizeColumnByKeyboard」の副作用または状態更新を実行し、値は返しません。
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
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
     * @param previous previousとして渡される、このコールバックの入力値です。
     * @returns 「previous」から生成した処理結果を返します。
     */
    (previous) => {
      const next = previous.slice();
      while (next.length <= column) next.push(DEFAULT_COLUMN_WIDTH);
      next[column] = Math.max(MIN_COLUMN_WIDTH, next[column] + delta);
      return next;
    });
  }

  /**
   * start・row・resizeを開始します。
   * @param event 処理対象のイベントです。
   * @param row 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 「startRowResize」の副作用または状態更新を実行し、値は返しません。
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
   * 「autoFitRow」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param row 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 「autoFitRow」の副作用または状態更新を実行し、値は返しません。
   */
  function autoFitRow(row: number): void {
    const editor = overlayRef.current;
    if (!editor) return;
    const cells = Array.from(
      editor.querySelectorAll<HTMLTextAreaElement>(
        "textarea[data-table-cell]",
      ),
    ).filter(

      /**
 * 「cell」が条件に一致するか判定し、残す要素を決めるコールバックです。
       * @param cell 処理対象のセルです。
       * @returns 要素を採用するかどうかの真偽値を返します。
       */
      (cell) => parseTableCellAddress(cell.dataset.tableCell)?.row === row,
    );
    if (!cells.length) return;

    const heights = cells.map(
    /**
 * 「cell」を変換し、変換後の要素を返すコールバックです。
     * @param cell 処理対象のセルです。
     * @returns 入力要素から生成した変換後の値を返します。
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
    });
    const height = calculateAutoFitRowHeight(heights);
    setRowHeights(
    /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
     * @param previous previousとして渡される、このコールバックの入力値です。
     * @returns 「previous」から生成した処理結果を返します。
     */
    (previous) => {
      const next = previous.slice();
      while (next.length <= row) next.push(undefined);
      if (next[row] === height) return previous;
      next[row] = height;
      return next;
    });
  }

  /**
   * 「autoFitRowOnPointerUp」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param event 処理対象のイベントです。
   * @param row 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 「autoFitRowOnPointerUp」の副作用または状態更新を実行し、値は返しません。
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
   * resize・row・by・keyboardを移動または調整します。
   * @param event 処理対象のイベントです。
   * @param row 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 「resizeRowByKeyboard」の副作用または状態更新を実行し、値は返しません。
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
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
     * @param previous previousとして渡される、このコールバックの入力値です。
     * @returns 「previous」から生成した処理結果を返します。
     */
    (previous) => {
      const next = previous.slice();
      while (next.length <= row) next.push(undefined);
      next[row] = height;
      return next;
    });
  }

  /**
   * start・editor・dragを開始します。
   * @param event 処理対象のイベントです。
   * @returns 「startEditorDrag」の副作用または状態更新を実行し、値は返しません。
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
   * start・editor・resizeを開始します。
   * @param event 処理対象のイベントです。
   * @returns 「startEditorResize」の副作用または状態更新を実行し、値は返しません。
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
   * resize・editor・by・keyboardを移動または調整します。
   * @param event 処理対象のイベントです。
   * @returns 「resizeEditorByKeyboard」の副作用または状態更新を実行し、値は返しません。
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
   * リボンと同じapplyMarkdownTableActionをdraft表へ適用する。
   * @param action 「action」は、「applySharedTableAction」が表編集状態の処理対象を特定する入力です。
   * @returns 「applySharedTableAction」の副作用または状態更新を実行し、値は返しません。
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
   * 選択範囲が複数列なら、既存の共通配置操作を列ごとに適用する。
   * @param action 「action」は、「applySharedAlignmentAction」が表編集状態の処理対象を特定する入力です。
   * @returns 「applySharedAlignmentAction」の副作用または状態更新を実行し、値は返しません。
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
    working.activeColumn = Math.min(activeColumn, working.alignments.length - 1);
    if (renderTableEditorDraft(working).text === currentRenderedText) return;
    recordHistory();
    setRows(working.rows.map(
    /**
 * 「row」を変換し、変換後の要素を返すコールバックです。
     * @param row 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (row) => row.slice()));
    setAlignments(working.alignments.slice());
    setActiveRow(working.activeRow);
    setActiveColumn(working.activeColumn);
    cellSelectionRef.current.clear();
    setStatus("");
  }

  /**
   * 配置を解除または削除します。
   * @returns 「clearAlignment」の副作用または状態更新を実行し、値は返しません。
   */
  function clearAlignment(): void {
    if (selectedColumns.every(
    /**
 * 「column」が条件を満たすか判定し、全要素の適合結果を返すコールバックです。
     * @param column 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 条件判定の結果を示す真偽値を返します。
     */
    (column) => (alignments[column] ?? "none") === "none")) {
      return;
    }
    recordHistory();
    const selected = new Set(selectedColumns);
    setAlignments(
    /**
 * 「previous」を受け取り、登録された副作用または結果を生成する処理です。
     * @param previous previousとして渡される、このコールバックの入力値です。
     * @returns 「previous」から生成した処理結果を返します。
     */
    (previous) =>
      Array.from({ length: columnCount },
      /**
 * 「_」「index」から配列要素を生成するコールバックです。
       * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
       * @param index 本文、表、配列内の対象位置を示すインデックスです。
       * @returns 「_」「index」から生成した処理結果を返します。
       */
      (_, index) =>
        selected.has(index) ? "none" : (previous[index] ?? "none"),
      ),
    );
  }

  /**
   * セルを移動または調整します。
   * @param direction 「direction」は、「moveCell」が表編集状態の処理対象を特定する入力です。
   * @returns 「moveCell」の副作用または状態更新を実行し、値は返しません。
   */
  function moveCell(direction: 1 | -1): void {
    const flat = activeRow * columnCount + activeColumn + direction;
    const wrapped =
      (flat + rows.length * columnCount) % (rows.length * columnCount);
    focusCell(Math.floor(wrapped / columnCount), wrapped % columnCount);
  }

  /**
   * move・verticalを移動または調整します。
   * @param direction 「direction」は、「moveVertical」が表編集状態の処理対象を特定する入力です。
   * @returns 「moveVertical」の副作用または状態更新を実行し、値は返しません。
   */
  function moveVertical(direction: 1 | -1): void {
    focusCell(
      Math.max(0, Math.min(rows.length - 1, activeRow + direction)),
      activeColumn,
    );
  }

  /**
   * 行を移動または調整します。
   * @param source 処理対象のソースです。
   * @param target 処理対象の対象です。
   * @returns 「moveRow」の副作用または状態更新を実行し、値は返しません。
   */
  function moveRow(source: number, target: number): void {
    const safeTarget = Math.max(1, Math.min(rows.length - 1, target));
    if (source <= 0 || source >= rows.length || source === safeTarget) return;
    recordHistory();
    setRows(moveTableGridRow(rows, source, safeTarget));
    setRowHeights(
    /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
     * @param previous previousとして渡される、このコールバックの入力値です。
     * @returns 「previous」から生成した処理結果を返します。
     */
    (previous) =>
      moveTableGridItem(previous, source, safeTarget),
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
   * 列を移動または調整します。
   * @param source 処理対象のソースです。
   * @param target 処理対象の対象です。
   * @returns 「moveColumn」の副作用または状態更新を実行し、値は返しません。
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
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
     * @param previous previousとして渡される、このコールバックの入力値です。
     * @returns 「previous」から生成した処理結果を返します。
     */
    (previous) =>
      moveTableGridItem(previous, source, safeTarget),
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
   * 行を作成または組み立てます。
   * @returns 「duplicateSelectedRows」の副作用または状態更新を実行し、値は返しません。
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
      Array.from({ length: nextRows.length },
      /**
 * 「_」「index」を受け取り、処理結果を生成する処理です。
       * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
       * @param index 本文、表、配列内の対象位置を示すインデックスです。
       * @returns 「_」「index」から生成した処理結果を返します。
       */
      (_, index) => nextHeights[index]),
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
   * 列を作成または組み立てます。
   * @returns 「duplicateSelectedColumns」の副作用または状態更新を実行し、値は返しません。
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
 * 「_」「index」を受け取り、処理結果を生成する処理です。
       * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
       * @param index 本文、表、配列内の対象位置を示すインデックスです。
       * @returns 「_」「index」から生成した処理結果を返します。
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
   * start・row・dragを開始します。
   * @param event 処理対象のイベントです。
   * @param row 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 「startRowDrag」の副作用または状態更新を実行し、値は返しません。
   */
  function startRowDrag(event: React.DragEvent<HTMLElement>, row: number): void {
    if (row <= 0) return;
    selectRow(row);
    gridDragRef.current = { kind: "row", source: row };
    setDragTarget({ kind: "row", index: row });
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `mve-table-row:${row}`);
  }

  /**
   * start・column・dragを開始します。
   * @param event 処理対象のイベントです。
   * @param column 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 「startColumnDrag」の副作用または状態更新を実行し、値は返しません。
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
   * 「allowRowDrop」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param event 処理対象のイベントです。
   * @param row 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 「allowRowDrop」の副作用または状態更新を実行し、値は返しません。
   */
  function allowRowDrop(event: React.DragEvent, row: number): void {
    if (row <= 0 || gridDragRef.current?.kind !== "row") return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragTarget(
    /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
     * @param previous previousとして渡される、このコールバックの入力値です。
     * @returns 「allowColumnDrop」を実行し、値を返しません。
     */
    (previous) =>
      previous?.kind === "row" && previous.index === row
        ? previous
        : { kind: "row", index: row },
    );
  }

  /**
   * 「allowColumnDrop」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param event 処理対象のイベントです。
   * @param column 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 「allowColumnDrop」の副作用または状態更新を実行し、値は返しません。
   */
  function allowColumnDrop(event: React.DragEvent, column: number): void {
    if (gridDragRef.current?.kind !== "column") return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragTarget(
    /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
     * @param previous previousとして渡される、このコールバックの入力値です。
     * @returns 「dropRow」を実行し、値を返しません。
     */
    (previous) =>
      previous?.kind === "column" && previous.index === column
        ? previous
        : { kind: "column", index: column },
    );
  }

  /**
   * 「dropRow」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param event 処理対象のイベントです。
   * @param row 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 「dropRow」の副作用または状態更新を実行し、値は返しません。
   */
  function dropRow(event: React.DragEvent, row: number): void {
    const drag = gridDragRef.current;
    if (drag?.kind !== "row" || row <= 0) return;
    event.preventDefault();
    moveRow(drag.source, row);
    endGridDrag();
  }

  /**
   * 「dropColumn」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param event 処理対象のイベントです。
   * @param column 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 「dropColumn」の副作用または状態更新を実行し、値は返しません。
   */
  function dropColumn(event: React.DragEvent, column: number): void {
    const drag = gridDragRef.current;
    if (drag?.kind !== "column") return;
    event.preventDefault();
    moveColumn(drag.source, column);
    endGridDrag();
  }

  /**
   * 「endGridDrag」は、処理を終了し、保持していたリソースまたは状態を整理します。
   * @returns 「endGridDrag」の副作用または状態更新を実行し、値は返しません。
   */
  function endGridDrag(): void {
    gridDragRef.current = undefined;
    setDragTarget(undefined);
  }

  /**
   * キーを処理します。
   * @param event 処理対象のイベントです。
   * @param row 本文、表、配列内の対象位置を示すインデックスです。
   * @returns イベントを処理し、状態更新または副作用だけを実行して値は返しません。
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
   * キーを処理します。
   * @param event 処理対象のイベントです。
   * @param column 本文、表、配列内の対象位置を示すインデックスです。
   * @returns イベントを処理し、状態更新または副作用だけを実行して値は返しません。
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
   * Excel等のTSV貼り付けもリボン/本文貼り付けと同じapplyMarkdownTableTsvへ渡す。
   * @param event 処理対象のイベントです。
   * @returns 「pasteTsv」の副作用または状態更新を実行し、値は返しません。
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
   * 「tsvForRange」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param range 処理対象の範囲です。
   * @returns 「tsvForRange」が生成または変換した表編集の文字列を返します。
   */
  function tsvForRange(range: NormalizedTableGridRange): string {
    const selectedRows = rows
      .slice(range.fromRow, range.toRow + 1)
      .map(
      /**
 * 「row」を変換し、変換後の要素を返すコールバックです。
       * @param row 本文、表、配列内の対象位置を示すインデックスです。
       * @returns 入力要素から生成した変換後の値を返します。
       */
      (row) => row.slice(range.fromColumn, range.toColumn + 1));
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
   * 「selectedTsv」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @returns 「selectedTsv」が生成または変換した表編集の文字列を返します。
   */
  function selectedTsv(): string {
    return tsvForRange(normalizedSelection);
  }

  /**
   * TSVコピーは単一セル選択時の従来動作を保ち、範囲選択時だけ選択範囲をコピーする。
   * @param forceSelection 「forceSelection」は、「copyTsv」が表編集状態の処理対象を特定する入力です。
   * @returns 非同期処理の完了を表すPromiseです。
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
 * 指定時間の経過後に遅延処理を実行するコールバックです。
       * @returns 「setStatus」を実行し、値を返しません。
       */
      () => setStatus(""), 1200);
    } catch (copyError) {
      setStatus(
        copyError instanceof Error ? copyError.message : String(copyError),
      );
    }
  }

  /**
   * 「rowIsSelected」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param row 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 判定結果です。
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
   * 「columnIsSelected」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param column 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 判定結果です。
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
   * create・selection・summaryを作成または組み立てます。
   * @returns 「createSelectionSummary」が生成または変換した表編集の文字列を返します。
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
   * 「cellAddress」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param row 本文、表、配列内の対象位置を示すインデックスです。
   * @param column 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 「cellAddress」が生成または変換した表編集の文字列を返します。
   */
  function cellAddress(row: number, column: number): string {
    return `${tableGridColumnLabel(column)}:${row === 0 ? "H" : row}`;
  }

  /**
   * close・and・restore・focusを解除または削除します。
   * @returns 購読解除、タイマー解除、またはリソース破棄を実行して値は返しません。
   */
  function closeAndRestoreFocus(): void {
    onClose();
    requestAnimationFrame(
    /**
 * 次の描画フレームでUI更新処理を実行するコールバックです。
     * @returns 「view.focus」を実行し、値を返しません。
     */
    () => view.focus());
  }

  /**
   * 「requestClose」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @returns 「requestClose」の副作用または状態更新を実行し、値は返しません。
   */
  function requestClose(): void {
    if (isDirty && !window.confirm(polishText.discard)) return;
    closeAndRestoreFocus();
  }

  /**
   * ドラフトをCodeMirrorへ1トランザクションで適用する。
   * SourceEditorの通常更新リスナーが受信するため、以降はリボン編集と同じApp/host同期経路を通る。
   * @returns 「apply」の副作用または状態更新を実行し、値は返しません。
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
 * 受け取った入力または現在の状態を検証し、呼び出し元へ必要な処理結果を返すコールバックです。
             * @returns 「applySharedTableAction」の呼び出し結果を返します。
             */
            () => applySharedTableAction("rowAfter")}
            disabled={rows.length >= MAX_ROWS}
          >
            {messages.app.tableEditor.addRow}
          </button>
          <button
            type="button"
            onClick={
            /**
 * 受け取った入力または現在の状態を検証し、呼び出し元へ必要な処理結果を返すコールバックです。
             * @returns 「applySharedTableAction」の呼び出し結果を返します。
             */
            () => applySharedTableAction("deleteRow")}
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
 * 登録された副作用または結果を生成する処理を実行するコールバックです。
             * @returns 「applySharedTableAction」の呼び出し結果を返します。
             */
            () => applySharedTableAction("colAfter")}
            disabled={columnCount >= MAX_COLUMNS}
          >
            {messages.app.tableEditor.addColumn}
          </button>
          <button
            type="button"
            onClick={
            /**
 * 受け取った入力または現在の状態を検証し、呼び出し元へ必要な処理結果を返すコールバックです。
             * @returns 「applySharedTableAction」の呼び出し結果を返します。
             */
            () => applySharedTableAction("deleteColumn")}
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
 * 受け取った入力または現在の状態を検証し、呼び出し元へ必要な処理結果を返すコールバックです。
             * @returns 「applySharedAlignmentAction」の呼び出し結果を返します。
             */
            () => applySharedAlignmentAction("alignLeft")}
          />
          <ToolbarToggle
            label={messages.app.tableEditor.alignCenter}
            active={currentAlignment === "center"}
            onClick={
            /**
 * 受け取った入力または現在の状態を検証し、呼び出し元へ必要な処理結果を返すコールバックです。
             * @returns 「applySharedAlignmentAction」の呼び出し結果を返します。
             */
            () => applySharedAlignmentAction("alignCenter")}
          />
          <ToolbarToggle
            label={messages.app.tableEditor.alignRight}
            active={currentAlignment === "right"}
            onClick={
            /**
 * 受け取った入力または現在の状態を検証し、呼び出し元へ必要な処理結果を返すコールバックです。
             * @returns 「applySharedAlignmentAction」の呼び出し結果を返します。
             */
            () => applySharedAlignmentAction("alignRight")}
          />
          <ToolbarToggle
            label={messages.app.tableEditor.clearAlignment}
            active={currentAlignment === "none"}
            onClick={clearAlignment}
          />
        </ToolbarGroup>
        <ToolbarGroup label={messages.ribbon.groups.excel} last>
          <button type="button" onClick={
          /**
 * 登録された副作用または結果を生成する処理を実行するコールバックです。
           * @returns 「copyTsv」の呼び出し結果を返します。
           */
          () => void copyTsv()}>
            {messages.app.tableEditor.copyTsv}
          </button>
          <button
            type="button"
            title={`${messages.ribbon.labels.cellBreak} (Alt+Enter)`}
            aria-keyshortcuts="Alt+Enter"
            onClick={
            /**
 * 登録された副作用または結果を生成する処理を実行するコールバックです。
             * @returns 「insertLineBreak」の呼び出し結果を返します。
             */
            () => insertLineBreak()}
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
            {Array.from({ length: columnCount },
            /**
 * 「_」「columnIndex」から配列要素を生成するコールバックです。
             * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
             * @param columnIndex 「columnIndex」は、「_」が表編集で処理する対象を特定する入力です。
             * @returns 「_」「columnIndex」から生成した処理結果を返します。
             */
            (_, columnIndex) => (
              <col
                key={columnIndex}
                style={{
                  width: `${columnWidths[columnIndex] ?? DEFAULT_COLUMN_WIDTH}px`,
                }}
              />
            ))}
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
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
                 * @param event 処理対象のイベントです。
                 * @returns 「if」を実行し、値を返しません。
                 */
                (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    selectAllCells();
                  }
                }}
              >
                ◢
              </th>
              {Array.from({ length: columnCount },
              /**
 * 「_」「columnIndex」から配列要素を生成するコールバックです。
               * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
               * @param columnIndex 「columnIndex」は、「_」が表編集で処理する対象を特定する入力です。
               * @returns 「_」「columnIndex」から生成した処理結果を返します。
               */
              (_, columnIndex) => (
                <th
                  key={columnIndex}
                  className="mve-table-editor-column-selector"
                  scope="col"
                  tabIndex={0}
                  aria-selected={columnIsSelected(columnIndex)}
                  data-selected={columnIsSelected(columnIndex) ? "true" : "false"}
                  data-drop-target={
                    dragTarget?.kind === "column" &&
                    dragTarget.index === columnIndex
                      ? "true"
                      : "false"
                  }
                  onClick={
                  /**
 * 受け取った入力または現在の状態を検証し、呼び出し元へ必要な処理結果を返すコールバックです。
                   * @returns 「selectColumn」を実行し、値を返しません。
                   */
                  () => selectColumn(columnIndex)}
                  onKeyDown={
                  /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
                   * @param event 処理対象のイベントです。
                   * @returns 「if」を実行し、値を返しません。
                   */
                  (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectColumn(columnIndex);
                    }
                  }}
                  onDragOver={
                  /**
 * 「event」を受け取り、登録された副作用または結果を生成する処理です。
                   * @param event 処理対象のイベントです。
                   * @returns 「event」から生成した処理結果を返します。
                   */
                  (event) => allowColumnDrop(event, columnIndex)}
                  onDrop={
                  /**
 * 「event」を受け取り、登録された副作用または結果を生成する処理です。
                   * @param event 処理対象のイベントです。
                   * @returns 「dropColumn」を実行し、値を返しません。
                   */
                  (event) => dropColumn(event, columnIndex)}
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
 * 「event」を受け取り、登録された副作用または結果を生成する処理です。
                     * @param event 処理対象のイベントです。
                     * @returns 「event.stopPropagation」を実行し、値を返しません。
                     */
                    (event) => event.stopPropagation()}
                    onClick={
                    /**
 * 「event」を受け取り、登録された副作用または結果を生成する処理です。
                     * @param event 処理対象のイベントです。
                     * @returns 「event.stopPropagation」を実行し、値を返しません。
                     */
                    (event) => event.stopPropagation()}
                    onDragStart={
                    /**
 * 「event」を受け取り、登録された副作用または結果を生成する処理です。
                     * @param event 処理対象のイベントです。
                     * @returns 「event」から生成した処理結果を返します。
                     */
                    (event) =>
                      startColumnDrag(event, columnIndex)
                    }
                    onDragEnd={endGridDrag}
                    onKeyDown={
                    /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
                     * @param event 処理対象のイベントです。
                     * @returns 「event」から生成した処理結果を返します。
                     */
                    (event) =>
                      handleColumnDragKey(event, columnIndex)
                    }
                  >
                    ⋮⋮
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(
            /**
 * 「row」「rowIndex」を変換し、変換後の要素を返すコールバックです。
             * @param row 本文、表、配列内の対象位置を示すインデックスです。
             * @param rowIndex 「rowIndex」は、「row」が表編集で処理する対象を特定する入力です。
             * @returns 入力要素から生成した変換後の値を返します。
             */
            (row, rowIndex) => (
              <tr
                key={rowIndex}
                className={rowIndex === 0 ? "mve-table-editor-header-row" : ""}
                data-drop-target={
                  dragTarget?.kind === "row" && dragTarget.index === rowIndex
                    ? "true"
                    : "false"
                }
                onDragOver={
                /**
 * 「event」を受け取り、登録された副作用または結果を生成する処理です。
                 * @param event 処理対象のイベントです。
                 * @returns 「event」から生成した処理結果を返します。
                 */
                (event) => allowRowDrop(event, rowIndex)}
                onDrop={
                /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
                 * @param event 処理対象のイベントです。
                 * @returns 「dropRow」を実行し、値を返しません。
                 */
                (event) => dropRow(event, rowIndex)}
              >
                <th
                  className="mve-table-editor-row-selector"
                  scope="row"
                  tabIndex={0}
                  aria-selected={rowIsSelected(rowIndex)}
                  data-selected={rowIsSelected(rowIndex) ? "true" : "false"}
                  onClick={
                  /**
 * 受け取った入力または現在の状態を検証し、呼び出し元へ必要な処理結果を返すコールバックです。
                   * @returns 「selectRow」を実行し、値を返しません。
                   */
                  () => selectRow(rowIndex)}
                  onKeyDown={
                  /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
                   * @param event 処理対象のイベントです。
                   * @returns 「if」を実行し、値を返しません。
                   */
                  (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectRow(rowIndex);
                    }
                  }}
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
 * 「event」を受け取り、登録された副作用または結果を生成する処理です。
                       * @param event 処理対象のイベントです。
                       * @returns 「event.stopPropagation」を実行し、値を返しません。
                       */
                      (event) => event.stopPropagation()}
                      onClick={
                      /**
 * 「event」を受け取り、登録された副作用または結果を生成する処理です。
                       * @param event 処理対象のイベントです。
                       * @returns 「event.stopPropagation」を実行し、値を返しません。
                       */
                      (event) => event.stopPropagation()}
                      onDragStart={
                      /**
 * 「event」を受け取り、登録された副作用または結果を生成する処理です。
                       * @param event 処理対象のイベントです。
                       * @returns 「event」から生成した処理結果を返します。
                       */
                      (event) => startRowDrag(event, rowIndex)}
                      onDragEnd={endGridDrag}
                      onKeyDown={
                      /**
 * 「event」を受け取り、登録された副作用または結果を生成する処理です。
                       * @param event 処理対象のイベントです。
                       * @returns 「event」から生成した処理結果を返します。
                       */
                      (event) => handleRowDragKey(event, rowIndex)}
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
 * 「event」を受け取り、登録された副作用または結果を生成する処理です。
                     * @param event 処理対象のイベントです。
                     * @returns 「event」から生成した処理結果を返します。
                     */
                    (event) => startRowResize(event, rowIndex)}
                    onPointerUp={
                    /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
                     * @param event 処理対象のイベントです。
                     * @returns 「event」から生成した処理結果を返します。
                     */
                    (event) => autoFitRowOnPointerUp(event, rowIndex)}
                    onKeyDown={
                    /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
                     * @param event 処理対象のイベントです。
                     * @returns 「event」から生成した処理結果を返します。
                     */
                    (event) => resizeRowByKeyboard(event, rowIndex)}
                  />
                </th>
                {Array.from({ length: columnCount },
                /**
 * 「_」「columnIndex」から配列要素を生成するコールバックです。
                 * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
                 * @param columnIndex 「columnIndex」は、「_」が表編集で処理する対象を特定する入力です。
                 * @returns 「_」「columnIndex」から生成した処理結果を返します。
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
 * 「event」を受け取り、登録された副作用または結果を生成する処理です。
                       * @param event 処理対象のイベントです。
                       * @returns 「event」から生成した処理結果を返します。
                       */
                      (event) =>
                        beginCellSelection(event, rowIndex, columnIndex)
                      }
                      onPointerEnter={
                      /**
 * 「event」を受け取り、登録された副作用または結果を生成する処理です。
                       * @param event 処理対象のイベントです。
                       * @returns 「event」から生成した処理結果を返します。
                       */
                      (event) =>
                        extendCellSelection(event, rowIndex, columnIndex)
                      }
                    >
                      <textarea
                        rows={1}
                        spellCheck={false}
                        value={tableEditorCellDisplayValue(row[columnIndex] ?? "")}
                        style={rowTextareaStyle(rowHeights[rowIndex])}
                        data-table-cell={`${rowIndex}:${columnIndex}`}
                        onFocus={
                        /**
 * 「event」を受け取り、登録された副作用または結果を生成する処理です。
                         * @param event 処理対象のイベントです。
                         * @returns 「event」から生成した処理結果を返します。
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
 * 「event」を受け取り、登録された副作用または結果を生成する処理です。
                         * @param event 処理対象のイベントです。
                         * @returns 「event」から生成した処理結果を返します。
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
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
                         * @param event 処理対象のイベントです。
                         * @returns 「updateCell」を実行し、値を返しません。
                         */
                        (event) => {
                          updateCell(rowIndex, columnIndex, event.target.value);
                          cellSelectionRef.current.set(
                            cellKey(rowIndex, columnIndex),
                            {
                              from: event.currentTarget.selectionStart,
                              to: event.currentTarget.selectionEnd,
                            },
                          );
                        }}
                        onPaste={pasteTsv}
                        onKeyDown={
                        /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
                         * @param event 処理対象のイベントです。
                         * @returns 「if」を実行し、値を返しません。
                         */
                        (event) => {
                          if (
                            event.key === "Backspace" &&
                            !event.altKey &&
                            !event.ctrlKey &&
                            !event.metaKey &&
                            event.currentTarget.selectionStart === event.currentTarget.selectionEnd &&
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
                        }}
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
                            columnWidths[columnIndex] ?? DEFAULT_COLUMN_WIDTH,
                          )}
                          title={messages.app.tableEditor.resizeColumn}
                          onMouseDown={
                          /**
 * 「event」を受け取り、登録された副作用または結果を生成する処理です。
                           * @param event 処理対象のイベントです。
                           * @returns 「event」から生成した処理結果を返します。
                           */
                          (event) =>
                            startColumnResize(event, columnIndex)
                          }
                          onMouseUp={
                          /**
 * 「event」を受け取り、登録された副作用または結果を生成する処理です。
                           * @param event 処理対象のイベントです。
                           * @returns 「event」から生成した処理結果を返します。
                           */
                          (event) =>
                            autoFitColumnOnMouseUp(event, columnIndex)
                          }
                          onKeyDown={
                          /**
 * 「event」を受け取り、登録された副作用または結果を生成する処理です。
                           * @param event 処理対象のイベントです。
                           * @returns 「event」から生成した処理結果を返します。
                           */
                          (event) =>
                            resizeColumnByKeyboard(event, columnIndex)
                          }
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
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
          {status || `${selectionSummary} · ${messages.app.tableEditor.navigationHint}`}
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
 * 「ToolbarGroup」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param props 「props」は、「ToolbarGroup」が表編集状態の処理対象を特定する入力です。
 * @returns 「ToolbarGroup」が表編集状態の入力を処理して得た固有の結果を返します。
 */
function ToolbarGroup({
  label,
  children,
  last = false,
}: {

  /**
   * 「label」は、画面または通知へ表示する文言を保持します。
   */
  label: string;

  /**
   * 「children」は、コンポーネントが表示する子要素を保持します。
   */
  children: React.ReactNode;

  /**
   * 「last」は、処理条件または状態を表す真偽値です。
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
 * 「ToolbarToggle」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param props 「props」は、「ToolbarToggle」が表編集状態の処理対象を特定する入力です。
 * @returns 「ToolbarToggle」が表編集状態の入力を処理して得た固有の結果を返します。
 */
function ToolbarToggle({
  label,
  active,
  onClick,
}: {

  /**
   * 「label」は、画面または通知へ表示する文言を保持します。
   */
  label: string;

  /**
   * 「active」は、画面の表示モードまたは現在のUI状態を示します。
   */
  active: boolean;
  /**
   * 「onClick」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @returns イベントを処理し、状態更新または副作用だけを実行して値は返しません。
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
 * 本文を更新または保存します。
 * @param text 処理対象の本文です。
 * @param unavailableMessage 処理対象のメッセージです。
 * @returns 非同期処理の完了を表すPromiseです。
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
 * CodeMirrorの内部文書へ挿入する改行を、現在の外部文書形式へ揃える。
 * @param state 処理対象の状態です。
 * @param value 「toEditorInsertion」で検証・変換する入力値です。
 * @returns 「toEditorInsertion」が生成または変換した表編集の文字列を返します。
 */
function toEditorInsertion(state: EditorState, value: string): string {
  const separator = state.facet(EditorState.lineSeparator) ?? "\n";
  return value.replace(/\r\n?|\n/g, "\n").replace(/\n/g, separator);
}

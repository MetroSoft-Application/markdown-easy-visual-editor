import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  applyMarkdownTableAction,
  applyMarkdownTableTsv,
  markdownTableToTsv,
  type MarkdownTableAction
} from '../shared/markdown';
import { getMessages, type Messages } from '../shared/messages';
import {
  readTableEditorDraft,
  insertTableEditorLineBreak,
  prepareTableEditorApply,
  renderTableEditorDraft,
  type TableEditorAlignment,
  type TableEditorDraft
} from './tableEditorModel';

const OPEN_EVENT = 'mve-open-table-editor';
const MAX_ROWS = 50;
const MAX_COLUMNS = 20;
const MIN_COLUMN_WIDTH = 96;
const DEFAULT_COLUMN_WIDTH = 160;
const ROW_HEADER_WIDTH = 42;
const MIN_EDITOR_WIDTH = 560;
const MIN_EDITOR_HEIGHT = 320;
const DEFAULT_EDITOR_WIDTH = 860;
const DEFAULT_EDITOR_HEIGHT = 600;
const MIN_ROW_HEIGHT = 36;
const MIN_TEXTAREA_HEIGHT = 34;
let overlayRoot: Root | undefined;
let overlayHost: HTMLDivElement | undefined;

type CellSelection = { from: number; to: number };
type ColumnResizeState = { column: number; startX: number; startWidth: number };
type RowResizeState = { row: number; pointerId: number; startY: number; startHeight: number };
type EditorSize = { width: number; height: number };
type EditorDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  left: number;
  top: number;
  width: number;
  height: number;
};
type EditorResizeState = {
  pointerId: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  left: number;
  top: number;
};

function cellKey(row: number, column: number): string {
  return `${row}:${column}`;
}

function rowTextareaStyle(rowHeight: number | undefined): React.CSSProperties | undefined {
  if (rowHeight === undefined) return undefined;
  const cellHeight = Math.max(MIN_TEXTAREA_HEIGHT, rowHeight - 2);
  return { height: `${cellHeight}px`, minHeight: `${cellHeight}px` };
}

/** 専用テーブルエディターをWebviewへ登録する。起動UIはReactのRibbon本体が担当する。 */
export function installTableEditorOverlay(): () => void {
  const open = () => openTableEditor();
  window.addEventListener(OPEN_EVENT, open);
  return () => {
    window.removeEventListener(OPEN_EVENT, open);
    closeOverlay();
  };
}

function findEditorView(): EditorView | undefined {
  const editor = document.querySelector<HTMLElement>('.source-editor .cm-editor');
  return editor ? EditorView.findFromDOM(editor) ?? undefined : undefined;
}

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
  overlayHost = document.createElement('div');
  overlayHost.className = 'mve-table-editor-root';
  document.body.appendChild(overlayHost);
  overlayRoot = createRoot(overlayHost);
  overlayRoot.render(<TableEditorOverlay view={view} initial={draft} messages={messages} onClose={closeOverlay} />);
}

function closeOverlay(): void {
  overlayRoot?.unmount();
  overlayRoot = undefined;
  overlayHost?.remove();
  overlayHost = undefined;
}

function showOverlayToast(message: string): void {
  const toast = document.createElement('div');
  toast.className = 'mve-table-editor-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2400);
}

function TableEditorOverlay({ view, initial, messages, onClose }: {
  view: EditorView;
  initial: TableEditorDraft;
  messages: Messages;
  onClose: () => void;
}): React.JSX.Element {
  const [rows, setRows] = useState(() => initial.rows.map((row) => row.slice()));
  const [alignments, setAlignments] = useState<TableEditorAlignment[]>(() => initial.alignments.slice());
  const [activeRow, setActiveRow] = useState(initial.activeRow);
  const [activeColumn, setActiveColumn] = useState(initial.activeColumn);
  const [status, setStatus] = useState('');
  const [editorSize, setEditorSize] = useState<EditorSize>({ width: DEFAULT_EDITOR_WIDTH, height: DEFAULT_EDITOR_HEIGHT });
  const [editorPosition, setEditorPosition] = useState<{ left: number; top: number }>();
  const [rowHeights, setRowHeights] = useState<Array<number | undefined>>(() => Array.from({ length: initial.rows.length }, () => undefined));
  const initialColumnCount = Math.max(1, initial.alignments.length, ...initial.rows.map((row) => row.length));
  const [columnWidths, setColumnWidths] = useState<number[]>(() => Array.from({ length: initialColumnCount }, () => DEFAULT_COLUMN_WIDTH));
  const overlayRef = useRef<HTMLDivElement>(null);
  const cellSelectionRef = useRef(new Map<string, CellSelection>());
  const columnResizeRef = useRef<ColumnResizeState | undefined>(undefined);
  const rowResizeRef = useRef<RowResizeState | undefined>(undefined);
  const editorDragRef = useRef<EditorDragState | undefined>(undefined);
  const editorResizeRef = useRef<EditorResizeState | undefined>(undefined);
  const columnCount = Math.max(1, alignments.length, ...rows.map((row) => row.length));
  const gridWidth = ROW_HEADER_WIDTH + Array.from({ length: columnCount }, (_, index) => columnWidths[index] ?? DEFAULT_COLUMN_WIDTH)
    .reduce((total, width) => total + width, 0);
  const cellCountLabel = `${rows.length} × ${columnCount}`;
  const currentAlignment = alignments[Math.min(activeColumn, alignments.length - 1)] ?? 'none';
  const editorStyle: React.CSSProperties | undefined = editorPosition ? {
    width: `${editorSize.width}px`,
    height: `${editorSize.height}px`,
    position: 'fixed',
    left: `${editorPosition.left}px`,
    top: `${editorPosition.top}px`,
    transform: 'none'
  } : undefined;

  useEffect(() => {
    const frame = requestAnimationFrame(() => focusCell(activeRow, activeColumn, false));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        requestAnimationFrame(() => view.focus());
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        apply();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  });

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const resize = columnResizeRef.current;
      if (!resize) return;
      const width = Math.max(MIN_COLUMN_WIDTH, Math.round(resize.startWidth + event.clientX - resize.startX));
      setColumnWidths((previous) => {
        if (previous[resize.column] === width) return previous;
        const next = previous.slice();
        while (next.length <= resize.column) next.push(DEFAULT_COLUMN_WIDTH);
        next[resize.column] = width;
        return next;
      });
    };
    const onMouseUp = () => {
      columnResizeRef.current = undefined;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const editorResize = editorResizeRef.current;
      if (editorResize && event.pointerId === editorResize.pointerId) {
        const maxWidth = Math.max(1, window.innerWidth - editorResize.left - 16);
        const maxHeight = Math.max(1, window.innerHeight - editorResize.top - 16);
        const minWidth = Math.min(MIN_EDITOR_WIDTH, maxWidth);
        const minHeight = Math.min(MIN_EDITOR_HEIGHT, maxHeight);
        const width = Math.min(maxWidth, Math.max(minWidth, editorResize.startWidth + event.clientX - editorResize.startX));
        const height = Math.min(maxHeight, Math.max(minHeight, editorResize.startHeight + event.clientY - editorResize.startY));
        setEditorSize((previous) => (
          previous.width === width && previous.height === height ? previous : { width, height }
        ));
        return;
      }
      const editorDrag = editorDragRef.current;
      if (editorDrag && event.pointerId === editorDrag.pointerId) {
        const maxLeft = Math.max(16, window.innerWidth - editorDrag.width - 16);
        const maxTop = Math.max(16, window.innerHeight - editorDrag.height - 16);
        const left = Math.min(maxLeft, Math.max(16, editorDrag.left + event.clientX - editorDrag.startX));
        const top = Math.min(maxTop, Math.max(16, editorDrag.top + event.clientY - editorDrag.startY));
        setEditorPosition((previous) => (
          previous?.left === left && previous.top === top ? previous : { left, top }
        ));
        return;
      }
      const rowResize = rowResizeRef.current;
      if (!rowResize || event.pointerId !== rowResize.pointerId) return;
      const height = Math.max(MIN_ROW_HEIGHT, Math.round(rowResize.startHeight + event.clientY - rowResize.startY));
      setRowHeights((previous) => {
        if (previous[rowResize.row] === height) return previous;
        const next = previous.slice();
        while (next.length <= rowResize.row) next.push(undefined);
        next[rowResize.row] = height;
        return next;
      });
    };
    const onPointerUp = (event: PointerEvent) => {
      if (editorResizeRef.current?.pointerId === event.pointerId) {
        editorResizeRef.current = undefined;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      if (editorDragRef.current?.pointerId === event.pointerId) {
        editorDragRef.current = undefined;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      if (rowResizeRef.current?.pointerId === event.pointerId) {
        rowResizeRef.current = undefined;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      editorResizeRef.current = undefined;
      editorDragRef.current = undefined;
      rowResizeRef.current = undefined;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  const tsv = useMemo(() => {
    const rendered = renderTableEditorDraft(currentDraft());
    return markdownTableToTsv(rendered.text, {
      from: rendered.caretOffset,
      to: rendered.caretOffset
    }) ?? '';
  }, [rows, alignments, activeRow, activeColumn]);

  function currentDraft(): TableEditorDraft {
    return {
      ...initial,
      rows,
      alignments: Array.from({ length: columnCount }, (_, index) => alignments[index] ?? 'none'),
      activeRow,
      activeColumn
    };
  }

  function focusCell(
    row: number,
    column: number,
    select = true,
    rowCount = rows.length,
    columns = columnCount
  ): void {
    const safeRow = Math.max(0, Math.min(row, rowCount - 1));
    const safeColumn = Math.max(0, Math.min(column, columns - 1));
    setActiveRow(safeRow);
    setActiveColumn(safeColumn);
    requestAnimationFrame(() => {
      const element = overlayRef.current?.querySelector<HTMLTextAreaElement>(`[data-table-cell="${safeRow}:${safeColumn}"]`);
      element?.focus();
      if (select && element) {
        element.select();
        cellSelectionRef.current.set(cellKey(safeRow, safeColumn), { from: 0, to: element.value.length });
      }
    });
  }

  function replaceDraft(next: TableEditorDraft): void {
    const nextRows = next.rows.map((row) => row.slice());
    const nextColumns = Math.max(1, next.alignments.length, ...nextRows.map((row) => row.length));
    if (nextRows.length > MAX_ROWS || nextColumns > MAX_COLUMNS) {
      setStatus(messages.app.tableEditor.rowColumnLimit(MAX_ROWS, MAX_COLUMNS));
      return;
    }
    setRows(nextRows);
    setAlignments(Array.from({ length: nextColumns }, (_, index) => next.alignments[index] ?? 'none'));
    setColumnWidths((previous) => Array.from({ length: nextColumns }, (_, index) => previous[index] ?? DEFAULT_COLUMN_WIDTH));
    setRowHeights((previous) => Array.from({ length: nextRows.length }, (_, index) => previous[index]));
    cellSelectionRef.current.clear();
    setActiveRow(next.activeRow);
    setActiveColumn(next.activeColumn);
    setStatus('');
    focusCell(next.activeRow, next.activeColumn, true, nextRows.length, nextColumns);
  }

  function updateCell(row: number, column: number, value: string): void {
    setRows((previous) => previous.map((current, rowIndex) => {
      if (rowIndex !== row) return current;
      const next = Array.from({ length: columnCount }, (_, index) => current[index] ?? '');
      next[column] = value.replace(/\r\n|\r|\n/g, '<br>');
      return next;
    }));
  }

  function rememberCellSelection(row: number, column: number, element: HTMLTextAreaElement): void {
    setActiveRow(row);
    setActiveColumn(column);
    cellSelectionRef.current.set(cellKey(row, column), {
      from: element.selectionStart,
      to: element.selectionEnd
    });
  }

  function insertLineBreak(): void {
    const value = rows[activeRow]?.[activeColumn] ?? '';
    const selection = cellSelectionRef.current.get(cellKey(activeRow, activeColumn));
    const edit = insertTableEditorLineBreak(value, selection?.from ?? value.length, selection?.to ?? value.length);
    const key = cellKey(activeRow, activeColumn);
    setRows((previous) => previous.map((current, rowIndex) => {
      if (rowIndex !== activeRow) return current;
      const next = Array.from({ length: columnCount }, (_, index) => current[index] ?? '');
      next[activeColumn] = edit.value;
      return next;
    }));
    cellSelectionRef.current.set(key, { from: edit.caretOffset, to: edit.caretOffset });
    requestAnimationFrame(() => {
      const element = overlayRef.current?.querySelector<HTMLTextAreaElement>(`[data-table-cell="${key}"]`);
      element?.focus();
      element?.setSelectionRange(edit.caretOffset, edit.caretOffset);
    });
  }

  function startColumnResize(event: React.MouseEvent<HTMLDivElement>, column: number): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    columnResizeRef.current = {
      column,
      startX: event.clientX,
      startWidth: columnWidths[column] ?? DEFAULT_COLUMN_WIDTH
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function resizeColumnByKeyboard(event: React.KeyboardEvent<HTMLDivElement>, column: number): void {
    const delta = event.key === 'ArrowLeft' ? -12 : event.key === 'ArrowRight' ? 12 : 0;
    if (!delta) return;
    event.preventDefault();
    setColumnWidths((previous) => {
      const next = previous.slice();
      while (next.length <= column) next.push(DEFAULT_COLUMN_WIDTH);
      next[column] = Math.max(MIN_COLUMN_WIDTH, next[column] + delta);
      return next;
    });
  }

  function startRowResize(event: React.PointerEvent<HTMLDivElement>, row: number): void {
    if (event.button !== 0) return;
    const rowElement = event.currentTarget.closest('tr');
    if (!rowElement) return;
    event.preventDefault();
    event.stopPropagation();
    rowResizeRef.current = {
      row,
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: rowHeights[row] ?? Math.round(rowElement.getBoundingClientRect().height)
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function resizeRowByKeyboard(event: React.KeyboardEvent<HTMLDivElement>, row: number): void {
    const delta = event.key === 'ArrowUp' ? -12 : event.key === 'ArrowDown' ? 12 : 0;
    if (!delta) return;
    const rowElement = event.currentTarget.closest('tr');
    if (!rowElement) return;
    event.preventDefault();
    const height = Math.max(
      MIN_ROW_HEIGHT,
      (rowHeights[row] ?? Math.round(rowElement.getBoundingClientRect().height)) + delta
    );
    setRowHeights((previous) => {
      const next = previous.slice();
      while (next.length <= row) next.push(undefined);
      next[row] = height;
      return next;
    });
  }

  function startEditorDrag(event: React.PointerEvent<HTMLElement>): void {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest('button')) return;
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
      height: bounds.height
    };
    document.body.style.cursor = 'move';
    document.body.style.userSelect = 'none';
    event.currentTarget.setPointerCapture(event.pointerId);
  }

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
      top: bounds.top
    };
    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function resizeEditorByKeyboard(event: React.KeyboardEvent<HTMLDivElement>): void {
    const widthDelta = event.key === 'ArrowLeft' ? -12 : event.key === 'ArrowRight' ? 12 : 0;
    const heightDelta = event.key === 'ArrowUp' ? -12 : event.key === 'ArrowDown' ? 12 : 0;
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
      height: Math.min(maxHeight, Math.max(minHeight, bounds.height + heightDelta))
    });
  }

  /** リボンと同じapplyMarkdownTableActionをdraft表へ適用する。 */
  function applySharedTableAction(action: MarkdownTableAction): void {
    const rendered = renderTableEditorDraft(currentDraft());
    const edit = applyMarkdownTableAction(
      rendered.text,
      { from: rendered.caretOffset, to: rendered.caretOffset },
      action
    );
    if (!edit) return;
    const next = readTableEditorDraft(edit.text, edit.selection.from);
    if (next) replaceDraft(next);
  }

  function clearAlignment(): void {
    setAlignments((previous) => Array.from({ length: columnCount }, (_, index) => (
      index === activeColumn ? 'none' : previous[index] ?? 'none'
    )));
  }

  function moveCell(direction: 1 | -1): void {
    const flat = activeRow * columnCount + activeColumn + direction;
    const wrapped = (flat + rows.length * columnCount) % (rows.length * columnCount);
    focusCell(Math.floor(wrapped / columnCount), wrapped % columnCount);
  }

  function moveVertical(direction: 1 | -1): void {
    focusCell(Math.max(0, Math.min(rows.length - 1, activeRow + direction)), activeColumn);
  }

  /** Excel等のTSV貼り付けもリボン/本文貼り付けと同じapplyMarkdownTableTsvへ渡す。 */
  function pasteTsv(event: React.ClipboardEvent<HTMLTextAreaElement>): void {
    const value = event.clipboardData.getData('text/plain');
    if (!/[\t\r\n]/.test(value)) return;
    const rendered = renderTableEditorDraft(currentDraft());
    const edit = applyMarkdownTableTsv(
      rendered.text,
      { from: rendered.caretOffset, to: rendered.caretOffset },
      value
    );
    if (!edit) return;
    const next = readTableEditorDraft(edit.text, edit.selection.from);
    if (!next) return;
    event.preventDefault();
    replaceDraft(next);
  }

  /** TSVコピーも既存のmarkdownTableToTsvを利用し、リボンと同じ変換規則にする。 */
  async function copyTsv(): Promise<void> {
    try {
      await writeClipboardText(tsv, messages.app.errors.clipboardUnavailable);
      setStatus(messages.app.tableEditor.copied);
      window.setTimeout(() => setStatus(''), 1200);
    } catch (copyError) {
      setStatus(copyError instanceof Error ? copyError.message : String(copyError));
    }
  }

  /**
   * ドラフトをCodeMirrorへ1トランザクションで適用する。
   * SourceEditorの通常更新リスナーが受信するため、以降はリボン編集と同じApp/host同期経路を通る。
   */
  function apply(): void {
    if (!view.dom.isConnected) {
      setStatus(messages.app.tableEditor.sourceEditorClosed);
      return;
    }
    const current = view.state.doc.toString();
    const prepared = prepareTableEditorApply(currentDraft(), current);
    // 表の一部だけでなく本文全体を比較し、外部変更後の古い範囲への適用を防ぐ。
    if (prepared.kind === 'stale') {
      setStatus(messages.app.tableEditor.documentChanged);
      return;
    }
    // 変更なしでdispatchしない。無意味なCodeMirror変更通知と同期処理を発生させない。
    if (prepared.kind === 'noop') {
      onClose();
      requestAnimationFrame(() => view.focus());
      return;
    }
    const changeSet = view.state.changes({
      from: initial.from,
      to: initial.to,
      insert: toEditorInsertion(view.state, prepared.text)
    });
    const snapshot = view.scrollDOM.clientHeight > 0 ? view.scrollSnapshot().map(changeSet) : undefined;
    view.dispatch({
      changes: changeSet,
      selection: EditorSelection.cursor(initial.from + prepared.caretOffset),
      effects: snapshot
    });
    onClose();
    requestAnimationFrame(() => view.focus());
  }

  return (
    <div ref={overlayRef} className="mve-table-editor" role="dialog" aria-modal="true" aria-label={messages.app.tableEditor.title} style={editorStyle}>
      <header className="mve-table-editor-header" onPointerDown={startEditorDrag}>
        <strong>{messages.app.tableEditor.title}</strong>
        <span>{cellCountLabel}</span>
        <button type="button" className="mve-table-editor-close" title={messages.app.tableEditor.close} aria-label={messages.app.tableEditor.close} onClick={() => { onClose(); requestAnimationFrame(() => view.focus()); }}>×</button>
      </header>
      <div className="mve-table-editor-toolbar" role="toolbar">
        <button type="button" onClick={() => applySharedTableAction('rowAfter')} disabled={rows.length >= MAX_ROWS}>{messages.app.tableEditor.addRow}</button>
        <button type="button" onClick={() => applySharedTableAction('deleteRow')} disabled={activeRow === 0 || rows.length <= 1}>{messages.app.tableEditor.deleteRow}</button>
        <span className="mve-table-editor-separator" />
        <button type="button" onClick={() => applySharedTableAction('colAfter')} disabled={columnCount >= MAX_COLUMNS}>{messages.app.tableEditor.addColumn}</button>
        <button type="button" onClick={() => applySharedTableAction('deleteColumn')} disabled={columnCount <= 1}>{messages.app.tableEditor.deleteColumn}</button>
        <span className="mve-table-editor-separator" />
        <ToolbarToggle label={messages.app.tableEditor.alignLeft} active={currentAlignment === 'left'} onClick={() => applySharedTableAction('alignLeft')} />
        <ToolbarToggle label={messages.app.tableEditor.alignCenter} active={currentAlignment === 'center'} onClick={() => applySharedTableAction('alignCenter')} />
        <ToolbarToggle label={messages.app.tableEditor.alignRight} active={currentAlignment === 'right'} onClick={() => applySharedTableAction('alignRight')} />
        <ToolbarToggle label={messages.app.tableEditor.clearAlignment} active={currentAlignment === 'none'} onClick={clearAlignment} />
        <span className="mve-table-editor-separator" />
        <button type="button" onClick={() => void copyTsv()}>{messages.app.tableEditor.copyTsv}</button>
        <button type="button" title={messages.ribbon.labels.cellBreak} onClick={insertLineBreak}>{messages.ribbon.labels.cellBreak}</button>
      </div>
      <div className="mve-table-editor-grid-wrap">
        <table className="mve-table-editor-grid" style={{ width: `${gridWidth}px`, minWidth: '100%' }}>
          <colgroup>
            <col style={{ width: `${ROW_HEADER_WIDTH}px` }} />
            {Array.from({ length: columnCount }, (_, columnIndex) => (
              <col key={columnIndex} style={{ width: `${columnWidths[columnIndex] ?? DEFAULT_COLUMN_WIDTH}px` }} />
            ))}
          </colgroup>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className={rowIndex === 0 ? 'mve-table-editor-header-row' : ''}>
                <th scope="row" onClick={() => focusCell(rowIndex, 0)}>
                  {rowIndex === 0 ? 'H' : rowIndex}
                  <div
                    className="mve-table-editor-row-resizer"
                    role="separator"
                    tabIndex={0}
                    aria-orientation="horizontal"
                    aria-label={`${messages.app.tableEditor.resizeRow} ${rowIndex + 1}`}
                    aria-valuemin={MIN_ROW_HEIGHT}
                    aria-valuenow={rowHeights[rowIndex] ?? MIN_ROW_HEIGHT}
                    title={messages.app.tableEditor.resizeRow}
                    onPointerDown={(event) => startRowResize(event, rowIndex)}
                    onKeyDown={(event) => resizeRowByKeyboard(event, rowIndex)}
                    onClick={(event) => event.stopPropagation()}
                  />
                </th>
                {Array.from({ length: columnCount }, (_, columnIndex) => {
                  const alignment = alignments[columnIndex] ?? 'none';
                  const active = rowIndex === activeRow && columnIndex === activeColumn;
                  return (
                    <td key={columnIndex} data-alignment={alignment} data-active={active ? 'true' : 'false'}>
                      <textarea
                        rows={1}
                        spellCheck={false}
                        value={row[columnIndex] ?? ''}
                        style={rowTextareaStyle(rowHeights[rowIndex])}
                        data-table-cell={`${rowIndex}:${columnIndex}`}
                        onFocus={(event) => rememberCellSelection(rowIndex, columnIndex, event.currentTarget)}
                        onSelect={(event) => rememberCellSelection(rowIndex, columnIndex, event.currentTarget)}
                        onChange={(event) => {
                          updateCell(rowIndex, columnIndex, event.target.value);
                          rememberCellSelection(rowIndex, columnIndex, event.currentTarget);
                        }}
                        onPaste={pasteTsv}
                        onKeyDown={(event) => {
                          if (event.key === 'Tab') {
                            event.preventDefault();
                            moveCell(event.shiftKey ? -1 : 1);
                          } else if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
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
                          aria-valuenow={Math.round(columnWidths[columnIndex] ?? DEFAULT_COLUMN_WIDTH)}
                          title={messages.app.tableEditor.resizeColumn}
                          onMouseDown={(event) => startColumnResize(event, columnIndex)}
                          onKeyDown={(event) => resizeColumnByKeyboard(event, columnIndex)}
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
        <span className={status ? 'mve-table-editor-status visible' : 'mve-table-editor-status'}>{status || messages.app.tableEditor.navigationHint}</span>
        <div className="mve-table-editor-actions">
          <button type="button" onClick={() => { onClose(); requestAnimationFrame(() => view.focus()); }}>{messages.app.tableEditor.cancel}</button>
          <button type="button" className="primary" onClick={apply}>{messages.app.tableEditor.apply}</button>
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

function ToolbarToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): React.JSX.Element {
  return <button type="button" className={active ? 'active' : ''} aria-pressed={active} onClick={onClick}>{label}</button>;
}

async function writeClipboardText(text: string, unavailableMessage: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error(unavailableMessage);
}

/** CodeMirrorの内部文書へ挿入する改行を、現在の外部文書形式へ揃える。 */
function toEditorInsertion(state: EditorState, value: string): string {
  const separator = state.facet(EditorState.lineSeparator) ?? '\n';
  return value.replace(/\r\n?|\n/g, '\n').replace(/\n/g, separator);
}

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
  prepareTableEditorApply,
  renderTableEditorDraft,
  type TableEditorAlignment,
  type TableEditorDraft
} from './tableEditorModel';

const OPEN_EVENT = 'mve-open-table-editor';
const MAX_ROWS = 50;
const MAX_COLUMNS = 20;
let overlayRoot: Root | undefined;
let overlayHost: HTMLDivElement | undefined;

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
  const overlayRef = useRef<HTMLDivElement>(null);
  const columnCount = Math.max(1, alignments.length, ...rows.map((row) => row.length));
  const cellCountLabel = `${rows.length} × ${columnCount}`;
  const currentAlignment = alignments[Math.min(activeColumn, alignments.length - 1)] ?? 'none';

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
      if (select) element?.select();
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
    <div ref={overlayRef} className="mve-table-editor" role="dialog" aria-modal="true" aria-label={messages.app.tableEditor.title}>
      <header className="mve-table-editor-header">
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
      </div>
      <div className="mve-table-editor-grid-wrap">
        <table className="mve-table-editor-grid">
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className={rowIndex === 0 ? 'mve-table-editor-header-row' : ''}>
                <th scope="row" onClick={() => focusCell(rowIndex, 0)}>{rowIndex === 0 ? 'H' : rowIndex}</th>
                {Array.from({ length: columnCount }, (_, columnIndex) => {
                  const alignment = alignments[columnIndex] ?? 'none';
                  const active = rowIndex === activeRow && columnIndex === activeColumn;
                  return (
                    <td key={columnIndex} data-alignment={alignment} data-active={active ? 'true' : 'false'}>
                      <textarea
                        rows={1}
                        spellCheck={false}
                        value={row[columnIndex] ?? ''}
                        data-table-cell={`${rowIndex}:${columnIndex}`}
                        onFocus={() => { setActiveRow(rowIndex); setActiveColumn(columnIndex); }}
                        onChange={(event) => updateCell(rowIndex, columnIndex, event.target.value)}
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

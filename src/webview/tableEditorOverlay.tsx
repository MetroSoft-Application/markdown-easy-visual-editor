import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  escapeTableEditorPlainCell,
  parseTableEditorTsv,
  readTableEditorDraft,
  renderTableEditorDraft,
  tableEditorCellToPlainText,
  type TableEditorAlignment,
  type TableEditorDraft
} from './tableEditorModel';

const OPEN_EVENT = 'mve-open-table-editor';
const MAX_ROWS = 50;
const MAX_COLUMNS = 20;
let overlayRoot: Root | undefined;
let overlayHost: HTMLDivElement | undefined;
let ribbonObserver: MutationObserver | undefined;

/** 専用テーブルエディターとリボン起動ボタンをWebviewへ登録する。 */
export function installTableEditorOverlay(): () => void {
  const open = () => openTableEditor();
  window.addEventListener(OPEN_EVENT, open);
  const root = document.getElementById('root');
  if (root) {
    ribbonObserver = new MutationObserver(() => ensureRibbonLauncher());
    ribbonObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected'] });
    queueMicrotask(ensureRibbonLauncher);
  }
  return () => {
    window.removeEventListener(OPEN_EVENT, open);
    ribbonObserver?.disconnect();
    ribbonObserver = undefined;
    closeOverlay();
  };
}

/** 表タブのTSVグループへ、専用エディターを開くボタンを追加する。 */
function ensureRibbonLauncher(): void {
  const tabs = Array.from(document.querySelectorAll<HTMLElement>('.ribbon-tabs [role="tab"]'));
  if (tabs[2]?.getAttribute('aria-selected') !== 'true') return;
  const content = document.querySelector<HTMLElement>('.ribbon-content');
  if (!content || content.querySelector('.mve-table-editor-launch')) return;
  const groups = Array.from(content.querySelectorAll<HTMLElement>('.ribbon-group'));
  const controls = groups.at(-1)?.querySelector<HTMLElement>('.ribbon-controls');
  if (!controls) return;
  const japanese = document.documentElement.lang.toLowerCase().startsWith('ja');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ribbon-tool mve-table-editor-launch';
  button.title = japanese ? '現在のMarkdown表を専用UIで編集' : 'Edit the current Markdown table';
  const label = document.createElement('span');
  label.textContent = japanese ? '表を編集' : 'Edit table';
  button.appendChild(label);
  button.addEventListener('click', () => window.dispatchEvent(new Event(OPEN_EVENT)));
  controls.prepend(button);
}

function findEditorView(): EditorView | undefined {
  const editor = document.querySelector<HTMLElement>('.source-editor .cm-editor');
  return editor ? EditorView.findFromDOM(editor) ?? undefined : undefined;
}

function openTableEditor(): void {
  const japanese = document.documentElement.lang.toLowerCase().startsWith('ja');
  const view = findEditorView();
  if (!view) {
    showOverlayToast(japanese ? 'ソースエディターを表示してください。' : 'Show the source editor first.');
    return;
  }
  const source = view.state.doc.toString();
  const draft = readTableEditorDraft(source, view.state.selection.main.head);
  if (!draft) {
    showOverlayToast(japanese ? '表内のセルへカーソルを置いてください。' : 'Place the caret inside a Markdown table.');
    return;
  }
  closeOverlay();
  overlayHost = document.createElement('div');
  overlayHost.className = 'mve-table-editor-root';
  document.body.appendChild(overlayHost);
  overlayRoot = createRoot(overlayHost);
  overlayRoot.render(<TableEditorOverlay view={view} initial={draft} onClose={closeOverlay} />);
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

function TableEditorOverlay({ view, initial, onClose }: {
  view: EditorView;
  initial: TableEditorDraft;
  onClose: () => void;
}): React.JSX.Element {
  const [rows, setRows] = useState(() => initial.rows.map((row) => row.slice()));
  const [alignments, setAlignments] = useState<TableEditorAlignment[]>(() => initial.alignments.slice());
  const [activeRow, setActiveRow] = useState(initial.activeRow);
  const [activeColumn, setActiveColumn] = useState(initial.activeColumn);
  const [error, setError] = useState('');
  const overlayRef = useRef<HTMLDivElement>(null);
  const japanese = document.documentElement.lang.toLowerCase().startsWith('ja');
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

  const tsv = useMemo(
    () => rows.map((row) => row.map(tableEditorCellToPlainText).join('\t')).join('\r\n'),
    [rows]
  );

  function focusCell(row: number, column: number, select = true): void {
    const safeRow = Math.max(0, Math.min(row, rows.length - 1));
    const safeColumn = Math.max(0, Math.min(column, columnCount - 1));
    setActiveRow(safeRow);
    setActiveColumn(safeColumn);
    requestAnimationFrame(() => {
      const element = overlayRef.current?.querySelector<HTMLTextAreaElement>(`[data-table-cell="${safeRow}:${safeColumn}"]`);
      element?.focus();
      if (select) element?.select();
    });
  }

  function updateCell(row: number, column: number, value: string): void {
    setRows((previous) => previous.map((current, rowIndex) => {
      if (rowIndex !== row) return current;
      const next = Array.from({ length: columnCount }, (_, index) => current[index] ?? '');
      next[column] = value.replace(/\r\n|\r|\n/g, '<br>');
      return next;
    }));
  }

  function addRow(): void {
    if (rows.length >= MAX_ROWS) return;
    const insertAt = activeRow === 0 ? 1 : activeRow + 1;
    setRows((previous) => {
      const next = previous.map((row) => Array.from({ length: columnCount }, (_, index) => row[index] ?? ''));
      next.splice(insertAt, 0, Array.from({ length: columnCount }, () => ''));
      return next;
    });
    focusCell(insertAt, activeColumn);
  }

  function deleteRow(): void {
    if (activeRow === 0 || rows.length <= 2) return;
    const nextRow = Math.max(1, activeRow - 1);
    setRows((previous) => previous.filter((_row, index) => index !== activeRow));
    focusCell(nextRow, activeColumn);
  }

  function addColumn(): void {
    if (columnCount >= MAX_COLUMNS) return;
    const insertAt = activeColumn + 1;
    setRows((previous) => previous.map((row, rowIndex) => {
      const next = Array.from({ length: columnCount }, (_, index) => row[index] ?? '');
      next.splice(insertAt, 0, rowIndex === 0 ? `${japanese ? '列' : 'Column'}${insertAt + 1}` : '');
      return next;
    }));
    setAlignments((previous) => {
      const next = Array.from({ length: columnCount }, (_, index) => previous[index] ?? 'none');
      next.splice(insertAt, 0, 'none');
      return next;
    });
    focusCell(activeRow, insertAt);
  }

  function deleteColumn(): void {
    if (columnCount <= 1) return;
    const nextColumn = Math.max(0, activeColumn - 1);
    setRows((previous) => previous.map((row) => row.filter((_cell, index) => index !== activeColumn)));
    setAlignments((previous) => previous.filter((_alignment, index) => index !== activeColumn));
    focusCell(activeRow, nextColumn);
  }

  function setAlignment(alignment: TableEditorAlignment): void {
    setAlignments((previous) => Array.from({ length: columnCount }, (_, index) => (
      index === activeColumn ? alignment : previous[index] ?? 'none'
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

  function pasteTsv(event: React.ClipboardEvent<HTMLTextAreaElement>): void {
    const value = event.clipboardData.getData('text/plain');
    if (!/[\t\r\n]/.test(value)) return;
    const pasted = parseTableEditorTsv(value);
    if (!pasted.length) return;
    event.preventDefault();
    const requiredRows = Math.min(MAX_ROWS, Math.max(rows.length, activeRow + pasted.length));
    const pastedColumns = Math.max(1, ...pasted.map((row) => row.length));
    const requiredColumns = Math.min(MAX_COLUMNS, Math.max(columnCount, activeColumn + pastedColumns));
    setRows((previous) => {
      const next = Array.from({ length: requiredRows }, (_, rowIndex) =>
        Array.from({ length: requiredColumns }, (_, columnIndex) => previous[rowIndex]?.[columnIndex] ?? '')
      );
      for (let rowOffset = 0; rowOffset < pasted.length && activeRow + rowOffset < requiredRows; rowOffset += 1) {
        for (let columnOffset = 0; columnOffset < pasted[rowOffset].length && activeColumn + columnOffset < requiredColumns; columnOffset += 1) {
          next[activeRow + rowOffset][activeColumn + columnOffset] = escapeTableEditorPlainCell(pasted[rowOffset][columnOffset]);
        }
      }
      return next;
    });
    setAlignments((previous) => Array.from({ length: requiredColumns }, (_, index) => previous[index] ?? 'none'));
  }

  async function copyTsv(): Promise<void> {
    try {
      await writeClipboardText(tsv);
      setError(japanese ? 'TSVをコピーしました。' : 'TSV copied.');
      window.setTimeout(() => setError(''), 1200);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : String(copyError));
    }
  }

  function apply(): void {
    if (!view.dom.isConnected) {
      setError(japanese ? 'ソースエディターが閉じられました。' : 'The source editor is no longer available.');
      return;
    }
    const current = view.state.doc.toString();
    if (current.slice(initial.from, initial.to) !== initial.originalText) {
      setError(japanese ? '編集中に元の表が変更されました。閉じて開き直してください。' : 'The table changed while this editor was open. Reopen it before applying.');
      return;
    }
    const draft: TableEditorDraft = {
      ...initial,
      rows,
      alignments: Array.from({ length: columnCount }, (_, index) => alignments[index] ?? 'none'),
      activeRow,
      activeColumn
    };
    const rendered = renderTableEditorDraft(draft);
    const changeSet = view.state.changes({ from: initial.from, to: initial.to, insert: rendered.text });
    const snapshot = view.scrollDOM.clientHeight > 0 ? view.scrollSnapshot().map(changeSet) : undefined;
    view.dispatch({
      changes: changeSet,
      selection: EditorSelection.cursor(initial.from + rendered.caretOffset),
      effects: snapshot
    });
    onClose();
    requestAnimationFrame(() => view.focus());
  }

  return (
    <div ref={overlayRef} className="mve-table-editor" role="dialog" aria-modal="true" aria-label={japanese ? '表を編集' : 'Edit table'}>
      <header className="mve-table-editor-header">
        <strong>{japanese ? '表を編集' : 'Edit table'}</strong>
        <span>{cellCountLabel}</span>
        <button type="button" className="mve-table-editor-close" title={japanese ? '閉じる' : 'Close'} onClick={() => { onClose(); requestAnimationFrame(() => view.focus()); }}>×</button>
      </header>
      <div className="mve-table-editor-toolbar" role="toolbar">
        <button type="button" onClick={addRow} disabled={rows.length >= MAX_ROWS}>＋{japanese ? '行' : 'Row'}</button>
        <button type="button" onClick={deleteRow} disabled={activeRow === 0 || rows.length <= 2}>{japanese ? '行削除' : 'Delete row'}</button>
        <span className="mve-table-editor-separator" />
        <button type="button" onClick={addColumn} disabled={columnCount >= MAX_COLUMNS}>＋{japanese ? '列' : 'Column'}</button>
        <button type="button" onClick={deleteColumn} disabled={columnCount <= 1}>{japanese ? '列削除' : 'Delete column'}</button>
        <span className="mve-table-editor-separator" />
        <ToolbarToggle label={japanese ? '左' : 'Left'} active={currentAlignment === 'left'} onClick={() => setAlignment('left')} />
        <ToolbarToggle label={japanese ? '中央' : 'Center'} active={currentAlignment === 'center'} onClick={() => setAlignment('center')} />
        <ToolbarToggle label={japanese ? '右' : 'Right'} active={currentAlignment === 'right'} onClick={() => setAlignment('right')} />
        <ToolbarToggle label={japanese ? '解除' : 'None'} active={currentAlignment === 'none'} onClick={() => setAlignment('none')} />
        <span className="mve-table-editor-separator" />
        <button type="button" onClick={() => void copyTsv()}>{japanese ? 'TSVコピー' : 'Copy TSV'}</button>
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
        <span className={error ? 'mve-table-editor-status visible' : 'mve-table-editor-status'}>{error || (japanese ? 'Tab: 次のセル / Shift+Tab: 前のセル / Enter: 下のセル / Ctrl+Enter: 適用' : 'Tab: next / Shift+Tab: previous / Enter: below / Ctrl+Enter: apply')}</span>
        <div className="mve-table-editor-actions">
          <button type="button" onClick={() => { onClose(); requestAnimationFrame(() => view.focus()); }}>{japanese ? 'キャンセル' : 'Cancel'}</button>
          <button type="button" className="primary" onClick={apply}>{japanese ? '適用' : 'Apply'}</button>
        </div>
      </footer>
    </div>
  );
}

function ToolbarToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): React.JSX.Element {
  return <button type="button" className={active ? 'active' : ''} aria-pressed={active} onClick={onClick}>{label}</button>;
}

async function writeClipboardText(text: string): Promise<void> {
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
  if (!copied) throw new Error('Clipboard is not available.');
}

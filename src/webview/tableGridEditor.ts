import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  cloneTableGrid,
  parseTableGridTsv,
  pasteTableGrid,
  readTableGridAt,
  serializeTableGrid,
  tableGridCellOffset,
  type TableGridAlignment,
  type TableGridModel
} from './tableGridModel';

let installed = false;
let launcher: HTMLButtonElement | undefined;
let overlay: HTMLElement | undefined;

interface ActiveCell {
  row: number;
  column: number;
}

/**
 * 表内カーソル時だけ表示するランチャーと、Excel風の専用表編集オーバーレイを初期化する。
 */
export function installTableGridEditor(): void {
  if (installed) return;
  installed = true;

  const start = (): void => {
    launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = 'mve-table-grid-launcher';
    launcher.textContent = isJapanese() ? '表を編集' : 'Edit table';
    launcher.title = isJapanese() ? 'カーソル位置のMarkdown表を専用エディターで開く' : 'Open the Markdown table at the cursor';
    launcher.hidden = true;
    launcher.addEventListener('click', openTableGridEditor);
    document.body.appendChild(launcher);

    const schedule = (): void => queueMicrotask(updateLauncher);
    document.addEventListener('mouseup', schedule, true);
    document.addEventListener('keyup', schedule, true);
    document.addEventListener('focusin', schedule, true);
    window.addEventListener('resize', schedule);
    window.addEventListener('mve-preview-input-settled', schedule);
    updateLauncher();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else queueMicrotask(start);
}

function updateLauncher(): void {
  if (!launcher || overlay) return;
  const view = findVisibleEditorView();
  if (!view) {
    launcher.hidden = true;
    return;
  }
  const model = readTableGridAt(view.state.doc.toString(), view.state.selection.main.head);
  launcher.hidden = !model;
}

function openTableGridEditor(): void {
  if (overlay) return;
  const view = findVisibleEditorView();
  if (!view) return;
  const source = view.state.doc.toString();
  const model = readTableGridAt(source, view.state.selection.main.head);
  if (!model) return;

  let draft = cloneTableGrid(model);
  let active: ActiveCell = locateActiveCell(view, model);

  const root = document.createElement('div');
  root.className = 'mve-table-grid-overlay';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', isJapanese() ? '表を編集' : 'Edit table');
  root.innerHTML = `
    <section class="mve-table-grid-dialog">
      <header class="mve-table-grid-header">
        <div>
          <strong>${isJapanese() ? '表を編集' : 'Edit table'}</strong>
          <span class="mve-table-grid-size"></span>
        </div>
        <button type="button" data-action="cancel" aria-label="${isJapanese() ? '閉じる' : 'Close'}">×</button>
      </header>
      <div class="mve-table-grid-toolbar" role="toolbar"></div>
      <div class="mve-table-grid-scroll">
        <table class="mve-table-grid-table"><tbody></tbody></table>
      </div>
      <footer class="mve-table-grid-footer">
        <span>${isJapanese() ? 'Tab: 次のセル / Shift+Tab: 前のセル / Enter: 下のセル / Ctrl+Enter: 適用' : 'Tab: next / Shift+Tab: previous / Enter: down / Ctrl+Enter: apply'}</span>
        <div>
          <button type="button" data-action="cancel">${isJapanese() ? 'キャンセル' : 'Cancel'}</button>
          <button type="button" class="primary" data-action="apply">${isJapanese() ? '適用' : 'Apply'}</button>
        </div>
      </footer>
    </section>`;

  overlay = root;
  document.body.appendChild(root);
  launcher!.hidden = true;

  const toolbar = root.querySelector<HTMLElement>('.mve-table-grid-toolbar')!;
  toolbar.append(
    toolbarButton(isJapanese() ? '+ 行' : '+ Row', 'row-add'),
    toolbarButton(isJapanese() ? '行削除' : 'Delete row', 'row-delete'),
    toolbarButton(isJapanese() ? '+ 列' : '+ Column', 'col-add'),
    toolbarButton(isJapanese() ? '列削除' : 'Delete column', 'col-delete'),
    toolbarSeparator(),
    toolbarButton(isJapanese() ? '左' : 'Left', 'align-left'),
    toolbarButton(isJapanese() ? '中央' : 'Center', 'align-center'),
    toolbarButton(isJapanese() ? '右' : 'Right', 'align-right'),
    toolbarButton(isJapanese() ? '解除' : 'Default', 'align-none'),
    toolbarSeparator(),
    toolbarButton(isJapanese() ? 'TSVコピー' : 'Copy TSV', 'copy-tsv')
  );

  const render = (focusCell = false): void => {
    normalizeDraft(draft);
    const size = root.querySelector<HTMLElement>('.mve-table-grid-size');
    if (size) size.textContent = `${draft.rows.length} × ${draft.alignments.length}`;
    const tbody = root.querySelector<HTMLTableSectionElement>('tbody')!;
    tbody.replaceChildren();

    draft.rows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      tr.dataset.row = String(rowIndex);
      const rowHead = document.createElement('th');
      rowHead.scope = 'row';
      rowHead.textContent = rowIndex === 0 ? 'H' : String(rowIndex);
      tr.appendChild(rowHead);
      row.forEach((value, columnIndex) => {
        const td = document.createElement('td');
        const input = document.createElement('textarea');
        input.rows = 1;
        input.value = value;
        input.dataset.row = String(rowIndex);
        input.dataset.column = String(columnIndex);
        input.setAttribute('aria-label', `${rowIndex === 0 ? (isJapanese() ? '見出し' : 'Header') : (isJapanese() ? '行' : 'Row') + ` ${rowIndex}`} / ${isJapanese() ? '列' : 'Column'} ${columnIndex + 1}`);
        if (rowIndex === 0) input.classList.add('header-cell');
        if (rowIndex === active.row && columnIndex === active.column) input.classList.add('active-cell');
        input.addEventListener('focus', () => {
          active = { row: rowIndex, column: columnIndex };
          refreshToolbarState(root, draft, active);
        });
        input.addEventListener('input', () => {
          draft.rows[rowIndex][columnIndex] = input.value;
        });
        input.addEventListener('keydown', (event) => handleCellKeyDown(event, root, draft, active, (next) => {
          active = next;
          focusGridCell(root, next);
        }, apply));
        input.addEventListener('paste', (event) => {
          const text = event.clipboardData?.getData('text/plain') ?? '';
          if (!text.includes('\t') && !/[\r\n]/.test(text)) return;
          const pasted = parseTableGridTsv(text);
          if (!pasted.length) return;
          event.preventDefault();
          syncGridInputs(root, draft);
          draft = pasteTableGrid(draft, rowIndex, columnIndex, pasted);
          active = { row: rowIndex, column: columnIndex };
          render(true);
        });
        td.appendChild(input);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    refreshToolbarState(root, draft, active);
    if (focusCell) focusGridCell(root, active);
  };

  const apply = (): void => {
    syncGridInputs(root, draft);
    normalizeDraft(draft);
    const replacement = serializeTableGrid(draft);
    const cellOffset = tableGridCellOffset(draft, active.row, active.column);
    const anchor = draft.from + Math.min(replacement.length, cellOffset);
    view.dispatch({
      changes: { from: draft.from, to: draft.to, insert: replacement },
      selection: EditorSelection.cursor(anchor),
      scrollIntoView: true
    });
    closeOverlay(view);
  };

  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-action]') : null;
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'cancel') {
      closeOverlay(view);
      return;
    }
    if (action === 'apply') {
      apply();
      return;
    }
    syncGridInputs(root, draft);
    if (action === 'row-add') {
      const columns = draft.alignments.length;
      const insertAt = Math.max(1, active.row + 1);
      draft.rows.splice(insertAt, 0, Array.from({ length: columns }, () => ''));
      active = { row: insertAt, column: active.column };
      render(true);
    } else if (action === 'row-delete') {
      if (active.row > 0 && draft.rows.length > 1) {
        draft.rows.splice(active.row, 1);
        active = { row: Math.min(active.row, draft.rows.length - 1), column: active.column };
        render(true);
      }
    } else if (action === 'col-add') {
      const insertAt = active.column + 1;
      draft.rows.forEach((row) => row.splice(insertAt, 0, ''));
      draft.alignments.splice(insertAt, 0, 'none');
      active = { row: active.row, column: insertAt };
      render(true);
    } else if (action === 'col-delete') {
      if (draft.alignments.length > 1) {
        draft.rows.forEach((row) => row.splice(active.column, 1));
        draft.alignments.splice(active.column, 1);
        active = { row: active.row, column: Math.min(active.column, draft.alignments.length - 1) };
        render(true);
      }
    } else if (action?.startsWith('align-')) {
      const alignment = action.slice('align-'.length) as TableGridAlignment;
      draft.alignments[active.column] = alignment;
      refreshToolbarState(root, draft, active);
    } else if (action === 'copy-tsv') {
      void copyAsTsv(draft);
    }
  });

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeOverlay(view);
    } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      apply();
    }
  });

  render(true);
}

function handleCellKeyDown(
  event: KeyboardEvent,
  root: HTMLElement,
  model: TableGridModel,
  active: ActiveCell,
  move: (cell: ActiveCell) => void,
  apply: () => void
): void {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    apply();
    return;
  }
  if (event.key === 'Tab') {
    event.preventDefault();
    syncGridInputs(root, model);
    const columnCount = model.alignments.length;
    const flat = active.row * columnCount + active.column + (event.shiftKey ? -1 : 1);
    const max = model.rows.length * columnCount - 1;
    const bounded = Math.max(0, Math.min(max, flat));
    move({ row: Math.floor(bounded / columnCount), column: bounded % columnCount });
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    const row = Math.min(model.rows.length - 1, active.row + 1);
    move({ row, column: active.column });
  }
}

function syncGridInputs(root: HTMLElement, model: TableGridModel): void {
  root.querySelectorAll<HTMLTextAreaElement>('textarea[data-row][data-column]').forEach((input) => {
    const row = Number(input.dataset.row);
    const column = Number(input.dataset.column);
    if (!Number.isInteger(row) || !Number.isInteger(column) || !model.rows[row]) return;
    model.rows[row][column] = input.value;
  });
}

function normalizeDraft(model: TableGridModel): void {
  if (!model.rows.length) model.rows.push(['']);
  const columns = Math.max(1, model.alignments.length, ...model.rows.map((row) => row.length));
  while (model.alignments.length < columns) model.alignments.push('none');
  if (model.alignments.length > columns) model.alignments.length = columns;
  model.rows.forEach((row) => {
    while (row.length < columns) row.push('');
    if (row.length > columns) row.length = columns;
  });
}

function refreshToolbarState(root: HTMLElement, model: TableGridModel, active: ActiveCell): void {
  root.querySelectorAll<HTMLButtonElement>('[data-action^="align-"]').forEach((button) => {
    button.classList.toggle('active', button.dataset.action === `align-${model.alignments[active.column] ?? 'none'}`);
  });
  const rowDelete = root.querySelector<HTMLButtonElement>('[data-action="row-delete"]');
  if (rowDelete) rowDelete.disabled = active.row === 0 || model.rows.length <= 1;
  const colDelete = root.querySelector<HTMLButtonElement>('[data-action="col-delete"]');
  if (colDelete) colDelete.disabled = model.alignments.length <= 1;
}

function focusGridCell(root: HTMLElement, cell: ActiveCell): void {
  const input = root.querySelector<HTMLTextAreaElement>(`textarea[data-row="${cell.row}"][data-column="${cell.column}"]`);
  if (!input) return;
  input.focus();
  input.select();
}

function closeOverlay(view: EditorView): void {
  overlay?.remove();
  overlay = undefined;
  view.focus();
  queueMicrotask(updateLauncher);
}

function toolbarButton(label: string, action: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.dataset.action = action;
  return button;
}

function toolbarSeparator(): HTMLSpanElement {
  const separator = document.createElement('span');
  separator.className = 'mve-table-grid-toolbar-separator';
  separator.setAttribute('aria-hidden', 'true');
  return separator;
}

function locateActiveCell(view: EditorView, model: TableGridModel): ActiveCell {
  const source = view.state.doc.toString();
  const before = source.slice(model.from, Math.max(model.from, Math.min(model.to, view.state.selection.main.head)));
  const lines = before.split(/\r\n|\r|\n/);
  const physicalRow = Math.max(0, lines.length - 1);
  const row = physicalRow <= 1 ? 0 : Math.min(model.rows.length - 1, physicalRow - 1);
  const line = lines.at(-1) ?? '';
  const column = Math.max(0, Math.min(model.alignments.length - 1, countTableSeparatorsBefore(line, line.length)));
  return { row, column };
}

function countTableSeparatorsBefore(line: string, offset: number): number {
  let count = 0;
  let escaped = false;
  for (let index = 0; index < Math.min(line.length, offset); index += 1) {
    const char = line[index];
    if (char === '\\' && !escaped) {
      escaped = true;
      continue;
    }
    if (char === '|' && !escaped) count += 1;
    escaped = false;
  }
  return line.trimStart().startsWith('|') ? Math.max(0, count - 1) : count;
}

async function copyAsTsv(model: TableGridModel): Promise<void> {
  const tsv = model.rows
    .map((row) => row.map(encodeTsvCell).join('\t'))
    .join('\r\n');
  try {
    await navigator.clipboard.writeText(tsv);
  } catch {
    // Clipboard権限がない環境では何もしない。編集内容自体には影響させない。
  }
}

function encodeTsvCell(value: string): string {
  const plain = value.replace(/<br\s*\/?\s*>/gi, '\n');
  return /[\t\r\n"]/.test(plain) ? `"${plain.replace(/"/g, '""')}"` : plain;
}

function findVisibleEditorView(): EditorView | undefined {
  const element = Array.from(document.querySelectorAll<HTMLElement>('.source-editor .cm-editor'))
    .find((candidate) => candidate.getClientRects().length > 0);
  return element ? EditorView.findFromDOM(element) ?? undefined : undefined;
}

function isJapanese(): boolean {
  return document.documentElement.lang.toLowerCase().startsWith('ja');
}

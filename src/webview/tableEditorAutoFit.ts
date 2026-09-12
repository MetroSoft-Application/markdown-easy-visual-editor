const MIN_COLUMN_WIDTH = 96;
const MAX_AUTO_COLUMN_WIDTH = 720;
const MIN_ROW_HEIGHT = 36;
const COLUMN_RESIZER_SELECTOR = ".mve-table-editor-column-resizer";
const ROW_RESIZER_SELECTOR = ".mve-table-editor-row-resizer";
const TABLE_EDITOR_SELECTOR = ".mve-table-editor";
const TOOLBAR_SELECTOR = ".mve-table-editor-toolbar";
const AUTO_FIT_GROUP_CLASS = "mve-table-editor-autofit-group";

type AutoFitText = {
  group: string;
  columns: string;
  rows: string;
  all: string;
  columnHint: string;
  rowHint: string;
};

const AUTO_FIT_TEXT: Record<string, AutoFitText> = {
  ja: {
    group: "サイズ",
    columns: "列幅を自動調整",
    rows: "行高をリセット",
    all: "すべて自動調整",
    columnHint: "選択中の列を内容に合わせます。列境界のダブルクリックでも実行できます",
    rowHint: "選択中の行の高さを既定値へ戻します。行境界のダブルクリックでも実行できます",
  },
  en: {
    group: "Size",
    columns: "Auto-fit columns",
    rows: "Reset row height",
    all: "Auto-fit all",
    columnHint: "Fit selected columns to their contents. You can also double-click a column boundary",
    rowHint: "Reset selected rows to the default height. You can also double-click a row boundary",
  },
  "zh-cn": {
    group: "大小",
    columns: "自动调整列宽",
    rows: "重置行高",
    all: "全部自动调整",
    columnHint: "根据内容调整所选列的宽度。也可以双击列边界",
    rowHint: "将所选行恢复为默认高度。也可以双击行边界",
  },
  ko: {
    group: "크기",
    columns: "열 너비 자동 맞춤",
    rows: "행 높이 재설정",
    all: "모두 자동 맞춤",
    columnHint: "선택한 열의 너비를 내용에 맞춥니다. 열 경계를 두 번 클릭해도 됩니다",
    rowHint: "선택한 행을 기본 높이로 되돌립니다. 행 경계를 두 번 클릭해도 됩니다",
  },
  fr: {
    group: "Taille",
    columns: "Ajuster les colonnes",
    rows: "Réinitialiser la hauteur",
    all: "Tout ajuster",
    columnHint: "Ajuste les colonnes sélectionnées au contenu. Un double-clic sur une bordure de colonne fonctionne aussi",
    rowHint: "Rétablit la hauteur par défaut des lignes sélectionnées. Un double-clic sur une bordure de ligne fonctionne aussi",
  },
  de: {
    group: "Größe",
    columns: "Spalten automatisch anpassen",
    rows: "Zeilenhöhe zurücksetzen",
    all: "Alles automatisch anpassen",
    columnHint: "Passt die ausgewählten Spalten an den Inhalt an. Ein Doppelklick auf eine Spaltengrenze funktioniert ebenfalls",
    rowHint: "Setzt die ausgewählten Zeilen auf die Standardhöhe zurück. Ein Doppelklick auf eine Zeilengrenze funktioniert ebenfalls",
  },
  es: {
    group: "Tamaño",
    columns: "Autoajustar columnas",
    rows: "Restablecer altura",
    all: "Autoajustar todo",
    columnHint: "Ajusta las columnas seleccionadas al contenido. También puede hacer doble clic en el borde de una columna",
    rowHint: "Restablece las filas seleccionadas a la altura predeterminada. También puede hacer doble clic en el borde de una fila",
  },
};

/** テキスト群と計測関数から、表エディターの自動列幅を決定する。 */
export function calculateAutoFitColumnWidth(
  values: readonly string[],
  measureText: (value: string) => number,
  horizontalChrome = 24,
  minimum = MIN_COLUMN_WIDTH,
  maximum = MAX_AUTO_COLUMN_WIDTH,
): number {
  let widest = 0;
  for (const value of values) {
    const lines = value.split(/\r\n|\r|\n/);
    for (const line of lines) widest = Math.max(widest, measureText(line));
  }
  return Math.max(minimum, Math.min(maximum, Math.ceil(widest + horizontalChrome)));
}

/** 現在行高を既定値へ戻すために必要な12px刻みの操作回数を返す。 */
export function rowResetStepCount(
  current: number,
  minimum = MIN_ROW_HEIGHT,
  step = 12,
): number {
  if (!Number.isFinite(current) || current <= minimum) return 0;
  return Math.ceil((current - minimum) / step);
}

/**
 * 専用表エディターへ表示サイズの補助操作を追加する。
 * Markdownは変更せず、既存の列/行リサイズイベントを通してReact stateだけを更新する。
 */
export function installTableEditorAutoFit(): () => void {
  const observer = new MutationObserver(() => ensureAutoFitControls());
  observer.observe(document.body, { childList: true, subtree: true });

  const onDoubleClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;
    const editor = event.target.closest<HTMLElement>(TABLE_EDITOR_SELECTOR);
    if (!editor) return;

    const columnResizer = event.target.closest<HTMLElement>(COLUMN_RESIZER_SELECTOR);
    if (columnResizer) {
      const resizers = Array.from(
        editor.querySelectorAll<HTMLElement>(COLUMN_RESIZER_SELECTOR),
      );
      const column = resizers.indexOf(columnResizer);
      if (column >= 0) {
        event.preventDefault();
        event.stopPropagation();
        autoFitColumns(editor, [column]);
      }
      return;
    }

    const rowResizer = event.target.closest<HTMLElement>(ROW_RESIZER_SELECTOR);
    if (rowResizer) {
      const resizers = Array.from(
        editor.querySelectorAll<HTMLElement>(ROW_RESIZER_SELECTOR),
      );
      const row = resizers.indexOf(rowResizer);
      if (row >= 0) {
        event.preventDefault();
        event.stopPropagation();
        void resetRows(editor, [row]);
      }
    }
  };

  document.addEventListener("dblclick", onDoubleClick, true);
  ensureAutoFitControls();

  return () => {
    observer.disconnect();
    document.removeEventListener("dblclick", onDoubleClick, true);
    document.querySelectorAll(`.${AUTO_FIT_GROUP_CLASS}`).forEach((node) => node.remove());
  };
}

function ensureAutoFitControls(): void {
  document.querySelectorAll<HTMLElement>(TOOLBAR_SELECTOR).forEach((toolbar) => {
    if (toolbar.querySelector(`.${AUTO_FIT_GROUP_CLASS}`)) return;
    const editor = toolbar.closest<HTMLElement>(TABLE_EDITOR_SELECTOR);
    if (!editor) return;

    const text = autoFitText(document.documentElement.lang);
    const group = document.createElement("div");
    group.className = `mve-table-editor-toolbar-group ${AUTO_FIT_GROUP_CLASS}`;
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", text.group);

    const label = document.createElement("span");
    label.className = "mve-table-editor-toolbar-label";
    label.textContent = text.group;

    const controls = document.createElement("div");
    controls.className = "mve-table-editor-toolbar-controls";
    controls.append(
      createButton(text.columns, text.columnHint, () => {
        autoFitColumns(editor, selectedColumns(editor));
      }),
      createButton(text.rows, text.rowHint, () => {
        void resetRows(editor, selectedRows(editor));
      }),
      createButton(text.all, `${text.columnHint} / ${text.rowHint}`, () => {
        autoFitColumns(editor, allColumnIndexes(editor));
        requestAnimationFrame(() => {
          void resetRows(editor, allRowIndexes(editor));
        });
      }),
    );

    group.append(label, controls);
    toolbar.appendChild(group);
  });
}

function createButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.title = title;
  button.addEventListener("click", onClick);
  return button;
}

function selectedColumns(editor: HTMLElement): number[] {
  const selected = new Set<number>();
  editor
    .querySelectorAll<HTMLTextAreaElement>('td[data-selected="true"] textarea[data-table-cell]')
    .forEach((textarea) => {
      const cell = parseCellAddress(textarea.dataset.tableCell);
      if (cell) selected.add(cell.column);
    });
  if (!selected.size) {
    const active = editor.querySelector<HTMLTextAreaElement>(
      'td[data-active="true"] textarea[data-table-cell]',
    );
    const cell = parseCellAddress(active?.dataset.tableCell);
    if (cell) selected.add(cell.column);
  }
  return selected.size ? [...selected].sort((a, b) => a - b) : allColumnIndexes(editor);
}

function selectedRows(editor: HTMLElement): number[] {
  const selected = new Set<number>();
  editor
    .querySelectorAll<HTMLTextAreaElement>('td[data-selected="true"] textarea[data-table-cell]')
    .forEach((textarea) => {
      const cell = parseCellAddress(textarea.dataset.tableCell);
      if (cell) selected.add(cell.row);
    });
  if (!selected.size) {
    const active = editor.querySelector<HTMLTextAreaElement>(
      'td[data-active="true"] textarea[data-table-cell]',
    );
    const cell = parseCellAddress(active?.dataset.tableCell);
    if (cell) selected.add(cell.row);
  }
  return selected.size ? [...selected].sort((a, b) => a - b) : allRowIndexes(editor);
}

function allColumnIndexes(editor: HTMLElement): number[] {
  return Array.from(
    { length: editor.querySelectorAll(COLUMN_RESIZER_SELECTOR).length },
    (_, index) => index,
  );
}

function allRowIndexes(editor: HTMLElement): number[] {
  return Array.from(
    { length: editor.querySelectorAll(ROW_RESIZER_SELECTOR).length },
    (_, index) => index,
  );
}

function autoFitColumns(editor: HTMLElement, columns: readonly number[]): void {
  const resizers = Array.from(
    editor.querySelectorAll<HTMLElement>(COLUMN_RESIZER_SELECTOR),
  );
  for (const column of columns) {
    const resizer = resizers[column];
    if (!resizer) continue;
    const cells = Array.from(
      editor.querySelectorAll<HTMLTextAreaElement>("textarea[data-table-cell]"),
    ).filter((textarea) => parseCellAddress(textarea.dataset.tableCell)?.column === column);
    if (!cells.length) continue;

    const target = measuredColumnWidth(cells);
    const current = numericAttribute(resizer, "aria-valuenow", MIN_COLUMN_WIDTH);
    if (Math.abs(target - current) < 1) continue;
    resizeColumnThroughExistingHandler(resizer, target - current);
  }
}

function measuredColumnWidth(cells: readonly HTMLTextAreaElement[]): number {
  const sample = cells[0];
  const style = getComputedStyle(sample);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const letterSpacing = Number.parseFloat(style.letterSpacing) || 0;
  const measure = (value: string): number => {
    if (!context) return Array.from(value).length * 8;
    context.font = `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const base = context.measureText(value).width;
    return base + Math.max(0, Array.from(value).length - 1) * letterSpacing;
  };
  const horizontalChrome =
    (Number.parseFloat(style.paddingLeft) || 0) +
    (Number.parseFloat(style.paddingRight) || 0) +
    8;
  return calculateAutoFitColumnWidth(
    cells.map((cell) => cell.value),
    measure,
    horizontalChrome,
  );
}

function resizeColumnThroughExistingHandler(
  resizer: HTMLElement,
  delta: number,
): void {
  resizer.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      clientX: 0,
    }),
  );
  window.dispatchEvent(
    new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      buttons: 1,
      clientX: delta,
    }),
  );
  window.dispatchEvent(
    new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: delta,
    }),
  );
}

async function resetRows(editor: HTMLElement, rows: readonly number[]): Promise<void> {
  const wanted = new Set(rows);
  for (let guard = 0; guard < 128; guard += 1) {
    const resizers = Array.from(
      editor.querySelectorAll<HTMLElement>(ROW_RESIZER_SELECTOR),
    );
    let changed = false;
    for (let row = 0; row < resizers.length; row += 1) {
      if (!wanted.has(row)) continue;
      const resizer = resizers[row];
      const current = numericAttribute(resizer, "aria-valuenow", MIN_ROW_HEIGHT);
      if (rowResetStepCount(current) === 0) continue;
      resizer.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "ArrowUp",
        }),
      );
      changed = true;
    }
    if (!changed) return;
    await nextFrame();
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function parseCellAddress(value: string | undefined): { row: number; column: number } | undefined {
  const match = /^(\d+):(\d+)$/.exec(value ?? "");
  if (!match) return undefined;
  return { row: Number(match[1]), column: Number(match[2]) };
}

function numericAttribute(element: Element, name: string, fallback: number): number {
  const value = Number(element.getAttribute(name));
  return Number.isFinite(value) ? value : fallback;
}

function autoFitText(language: string): AutoFitText {
  const normalized = language.trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "zh" || normalized.startsWith("zh-cn")) {
    return AUTO_FIT_TEXT["zh-cn"];
  }
  return AUTO_FIT_TEXT[normalized.split("-")[0]] ?? AUTO_FIT_TEXT.en;
}

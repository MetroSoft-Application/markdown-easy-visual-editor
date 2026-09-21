
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EditorTheme } from "../shared/protocol";
import {
  normalizeFontFamily,
  prependDefaultFontFamily,
} from "../shared/fontFamily";
import {
  TEXT_COLOR_HEX,
  TEXT_COLOR_IDS,
} from "../shared/textColor";
import {
  setPreviewImageResizeControlsVisible,
} from "./previewImageResizeControls";
import {
  applyTextColorToActiveSource,
  clearInlineFormattingWithTextColor,
  readActiveSourceTextColor,
} from "./textColorController";
import { sharedVsCodeApi } from "./vscodeApi";
import type {
  RibbonControlFieldDefinition,
  RibbonItemDefinition,
} from "./ribbonDefinitionTypes";
import type { RibbonItemId } from "./ribbonIds";
import type {
  RibbonButtonState,
  RibbonButtonImplementation,
  RibbonControlImplementation,
  RibbonImplementationContext,
  RibbonItemImplementation,
  RibbonHeaderImplementationId,
  TableAction,
} from "./ribbonTypes";

const button = (
  onClick: RibbonButtonImplementation["onClick"],
  options: Omit<RibbonButtonImplementation, "kind" | "onClick"> = {},
): RibbonButtonImplementation => ({
  kind: "button",
  onClick,
  ...options,
});

const control = (
  render: RibbonControlImplementation["render"],
): RibbonControlImplementation => ({
  kind: "control",
  render,
});

const editDisabled = (state: RibbonButtonState): boolean => state.readOnly;

const activeMark = (mark: string) => (state: RibbonButtonState) =>
  Boolean(state.activeMarks[mark]);

export const RIBBON_IMPLEMENTATIONS: Record<
  RibbonItemId,
  RibbonItemImplementation
> = {
  undo: button(
    ({ onCommand }) => onCommand({ type: "historyCommand", command: "undo" }),
  ),
  redo: button(
    ({ onCommand }) => onCommand({ type: "historyCommand", command: "redo" }),
  ),
  style: control((context, definition, resolveLabel) => (
    <label className="ribbon-select-label">
      {resolveLabel(definition.label)}
      <select
        disabled={context.readOnly}
        defaultValue="0"
        onChange={(event) =>
          context.onCommand({
            type: "heading",
            level: Number(event.target.value),
          })
        }
      >
        {(definition.options?.choices ?? []).map((choice) => (
          <option key={choice.value} value={choice.value}>
            {resolveLabel(choice.label)}
          </option>
        ))}
      </select>
    </label>
  )),
  quote: button(
    ({ onCommand }) => onCommand({ type: "sourceAction", action: "quote" }),
    { disabled: editDisabled },
  ),
  bulletList: button(
    ({ onCommand }) =>
      onCommand({ type: "sourceAction", action: "bulletList" }),
    { disabled: editDisabled },
  ),
  orderedList: button(
    ({ onCommand }) =>
      onCommand({ type: "sourceAction", action: "orderedList" }),
    { disabled: editDisabled },
  ),
  taskList: button(
    ({ onCommand }) => onCommand({ type: "sourceAction", action: "taskList" }),
    { disabled: editDisabled },
  ),
  indent: button(
    ({ onCommand }) => onCommand({ type: "sourceAction", action: "indent" }),
    { disabled: editDisabled },
  ),
  outdent: button(
    ({ onCommand }) => onCommand({ type: "sourceAction", action: "outdent" }),
    { disabled: editDisabled },
  ),
  bold: button(
    ({ onCommand }) => onCommand({ type: "sourceAction", action: "bold" }),
    { disabled: editDisabled, active: activeMark("bold") },
  ),
  italic: button(
    ({ onCommand }) => onCommand({ type: "sourceAction", action: "italic" }),
    { disabled: editDisabled, active: activeMark("italic") },
  ),
  strike: button(
    ({ onCommand }) => onCommand({ type: "sourceAction", action: "strike" }),
    { disabled: editDisabled, active: activeMark("strike") },
  ),
  underline: button(
    ({ onCommand }) =>
      onCommand({ type: "sourceAction", action: "underline" }),
    { disabled: editDisabled, active: activeMark("underline") },
  ),
  highlight: button(
    ({ onCommand }) =>
      onCommand({ type: "sourceAction", action: "highlight" }),
    { disabled: editDisabled, active: activeMark("highlight") },
  ),
  code: button(
    ({ onCommand }) =>
      onCommand({ type: "sourceAction", action: "inlineCode" }),
    { disabled: editDisabled, active: activeMark("inlineCode") },
  ),
  superscript: button(
    ({ onCommand }) => onCommand({ type: "sourceAction", action: "sup" }),
    { disabled: editDisabled },
  ),
  subscript: button(
    ({ onCommand }) => onCommand({ type: "sourceAction", action: "sub" }),
    { disabled: editDisabled },
  ),
  textColor: control((context, definition, resolveLabel) => (
    <label className="ribbon-select-label">
      {context.textColorText.label}
      <select
        className="mve-text-color-select"
        value={context.textColorChoice}
        disabled={context.readOnly}
        onFocus={() =>
          context.setTextColorChoice(readActiveSourceTextColor() ?? "default")
        }
        onChange={(event) => {
          const value = event.target.value as typeof context.textColorChoice;
          if (value === "mixed") return;
          applyTextColorToActiveSource(
            value === "default" ? undefined : value,
          );
          context.setTextColorChoice(value);
        }}
        style={
          context.textColorChoice !== "default" &&
          context.textColorChoice !== "mixed"
            ? { color: TEXT_COLOR_HEX[context.textColorChoice] }
            : undefined
        }
      >
        <option value="mixed" disabled>
          {context.textColorText.mixed}
        </option>
        <option value="default">{context.textColorText.defaultColor}</option>
        {TEXT_COLOR_IDS.map((color) => (
          <option
            key={color}
            value={color}
            style={{ color: TEXT_COLOR_HEX[color] }}
          >
            {`● ${context.textColorText.colors[color]}`}
          </option>
        ))}
      </select>
    </label>
  )),
  clearInline: button(
    ({ onCommand }) => {
      if (!clearInlineFormattingWithTextColor()) {
        onCommand({ type: "sourceAction", action: "clearInline" });
      }
    },
    { disabled: editDisabled },
  ),
  clearBlock: button(
    ({ onCommand }) =>
      onCommand({ type: "sourceAction", action: "clearBlock" }),
    { disabled: editDisabled },
  ),
  link: button(
    ({ onCommand }) => onCommand({ type: "link" }),
    { disabled: editDisabled },
  ),
  image: button(
    ({ onCommand }) => onCommand({ type: "image" }),
    { disabled: editDisabled },
  ),
  tableSize: control((context, definition, resolveLabel) => {
    const rows = getControlField(definition, "rows");
    const columns = getControlField(definition, "columns");
    return (
      <>
        <label>
          {resolveLabel(rows.label)}
          <input
            type="number"
            min={rows.min}
            max={rows.max}
            disabled={context.readOnly}
            value={context.tableRows}
            onChange={(event) =>
              context.setTableRows(
                clampNumber(event.target.value, rows.min ?? 0, rows.max ?? 50),
              )
            }
          />
        </label>
        <label>
          {resolveLabel(columns.label)}
          <input
            type="number"
            min={columns.min}
            max={columns.max}
            disabled={context.readOnly}
            value={context.tableColumns}
            onChange={(event) =>
              context.setTableColumns(
                clampNumber(
                  event.target.value,
                  columns.min ?? 0,
                  columns.max ?? 50,
                ),
              )
            }
          />
        </label>
      </>
    );
  }),
  insertTable: button(
    ({ onCommand, tableRows, tableColumns }) =>
      onCommand({ type: "tableInsert", rows: tableRows, columns: tableColumns }),
    { disabled: editDisabled },
  ),
  horizontalRule: button(
    ({ onCommand }) =>
      onCommand({ type: "sourceAction", action: "horizontalRule" }),
    { disabled: editDisabled },
  ),
  hardBreak: button(
    ({ onCommand }) =>
      onCommand({ type: "sourceAction", action: "hardBreak" }),
    { disabled: editDisabled },
  ),
  codeLanguage: control((context, definition, resolveLabel) => (
    <label className="ribbon-select-label">
      {resolveLabel(definition.label)}
      <select
        value={context.codeLanguage}
        disabled={context.readOnly}
        onChange={(event) => context.setCodeLanguage(event.target.value)}
      >
        {context.messages.ribbon.codeLanguages.map((language) => (
          <option key={language.value} value={language.value}>
            {language.label}
          </option>
        ))}
      </select>
    </label>
  )),
  codeBlock: button(
    ({ onCommand, codeLanguage }) =>
      onCommand({ type: "codeBlock", language: codeLanguage }),
    { disabled: editDisabled },
  ),
  mermaid: button(
    ({ onCommand, messages }) =>
      onCommand({ type: "insert", value: messages.ribbon.snippets.mermaid }),
    { disabled: editDisabled },
  ),
  math: button(
    ({ onCommand }) =>
      onCommand({ type: "insert", value: "\n$$\nE = mc^2\n$$\n" }),
    { disabled: editDisabled },
  ),
  footnote: button(
    ({ onCommand, messages }) =>
      onCommand({ type: "insert", value: messages.ribbon.snippets.footnote }),
    { disabled: editDisabled },
  ),
  toc: button(
    ({ onCommand }) => onCommand({ type: "insert", value: "\n[toc]\n" }),
    { disabled: editDisabled },
  ),
  pageBreak: button(
    ({ onCommand }) =>
      onCommand({ type: "insert", value: "\n<!-- pagebreak -->\n" }),
    { disabled: editDisabled },
  ),
  note: button(
    ({ onCommand, messages }) =>
      onCommand({ type: "insert", value: messages.ribbon.snippets.note }),
    { disabled: editDisabled },
  ),
  warning: button(
    ({ onCommand, messages }) =>
      onCommand({ type: "insert", value: messages.ribbon.snippets.warning }),
    { disabled: editDisabled },
  ),
  emoji: control((context, definition, resolveLabel) => (
    <label className="ribbon-select-label">
      {resolveLabel(definition.label)}
      <select
        value={context.emoji}
        disabled={context.readOnly}
        onChange={(event) => context.setEmoji(event.target.value)}
      >
        {(definition.options?.values ?? []).map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </label>
  )),
  insertEmoji: button(
    ({ onCommand, emoji }) => onCommand({ type: "insert", value: emoji }),
    { disabled: editDisabled },
  ),
  rowBefore: tableButton("rowBefore"),
  rowAfter: tableButton("rowAfter"),
  deleteRow: tableButton("deleteRow"),
  colBefore: tableButton("colBefore"),
  colAfter: tableButton("colAfter"),
  deleteColumn: tableButton("deleteColumn"),
  tableHeader: control((context, definition, resolveLabel) => {
    const field = getControlField(definition, "header");
    return (
      <label className="ribbon-select-label">
        {resolveLabel(definition.label)}
        <input
          disabled={context.readOnly}
          value={context.headerName}
          placeholder={field.placeholder ? resolveLabel(field.placeholder) : undefined}
          onChange={(event) => context.setHeaderName(event.target.value)}
        />
      </label>
    );
  }),
  alignLeft: tableButton("alignLeft"),
  alignCenter: tableButton("alignCenter"),
  alignRight: tableButton("alignRight"),
  alignColumns: tableButton("alignColumns"),
  cellBreak: button(
    ({ onCommand }) =>
      onCommand({ type: "sourceAction", action: "cellBreak" }),
    { disabled: editDisabled },
  ),
  openTableEditor: button(
    () => window.dispatchEvent(new Event("mve-open-table-editor")),
    { disabled: editDisabled },
  ),
  copyTsv: button(
    ({ onCommand }) => onCommand({ type: "copyTableTsv" }),
    {
      disabled: (state) =>
        state.mode === "preview" ||
        (state.mode === "split" && state.splitView === "preview"),
    },
  ),
  openSource: button(
    ({ onCommand }) => onCommand({ type: "openSource" }),
  ),
  outline: button(
    ({ onCommand }) => onCommand({ type: "toggleOutline" }),
    { active: (state) => state.outlineVisible },
  ),
  scrollSync: button(
    ({ onCommand }) => onCommand({ type: "toggleScrollSync" }),
    { active: (state) => state.scrollSyncEnabled },
  ),
  zoomHint: control((_context, definition, resolveLabel) => (
    <span className="ribbon-hint">{resolveLabel(definition.label)}</span>
  )),
  imageResize: button(
    ({ imageResizeControlsVisible }) =>
      setPreviewImageResizeControlsVisible(!imageResizeControlsVisible),
    { active: (state) => state.imageResizeControlsVisible },
  ),
  editorTheme: control((context, definition, resolveLabel) => (
    <label className="ribbon-select-label">
      {resolveLabel(definition.label)}
      <select
        className="mve-editor-theme-select"
        defaultValue={
          (document.documentElement.dataset.editorTheme as
            | EditorTheme
            | undefined) ?? "dark"
        }
        onChange={(event) => {
          const theme = event.target.value as EditorTheme;
          document.documentElement.dataset.editorTheme = theme;
          document.documentElement.style.colorScheme = theme;
          sharedVsCodeApi.postMessage({ type: "setEditorTheme", theme });
        }}
      >
        {(definition.options?.choices ?? []).map((choice) => (
          <option key={choice.value} value={choice.value}>
            {resolveLabel(choice.label)}
          </option>
        ))}
      </select>
    </label>
  )),
  openPrintSettings: button(
    ({ onCommand }) => onCommand({ type: "openPrintSettings" }),
  ),
  printPreview: button(
    ({ onCommand }) => onCommand({ type: "togglePrintPreview" }),
  ),
  exportPdf: button(
    ({ onCommand }) => onCommand({ type: "exportPdf" }),
  ),
  embedImages: htmlOption("embedImages"),
  convertLinkedMarkdown: htmlOption("convertLinkedMarkdown"),
  saveWithoutDialog: htmlOption("saveWithoutDialog"),
  exportHtml: button(
    ({ onCommand, htmlOptions }) =>
      onCommand({ type: "exportHtml", options: htmlOptions }),
  ),
  preflight: button(
    ({ onCommand }) => onCommand({ type: "runPreflightCheck" }),
  ),
  imageDirectory: control((context, definition, resolveLabel) => {
    const field = getControlField(definition, "directory");
    return (
      <>
        <form
          className="ribbon-setting-form"
          onSubmit={(event) => {
            event.preventDefault();
            saveImageDirectory(context);
          }}
        >
          <label>
            <span>{resolveLabel(field.label)}</span>
            <input
              value={context.imageDirectoryDraft}
              placeholder={field.placeholder ? resolveLabel(field.placeholder) : undefined}
              spellCheck={false}
              onChange={(event) => context.setImageDirectoryDraft(event.target.value)}
              onBlur={() => saveImageDirectory(context)}
            />
          </label>
        </form>
        {definition.options?.hint && (
          <span className="ribbon-setting-hint">
            {resolveLabel(definition.options.hint)}
          </span>
        )}
      </>
    );
  }),
  fontSettings: control((context, definition, resolveLabel) => {
    const editorField = getControlField(definition, "editor");
    const previewField = getControlField(definition, "preview");
    const fontOptions = prependDefaultFontFamily(context.installedFonts);
    const save = () => saveFontFamilies(context);
    const status = context.fontListLoading
      ? context.messages.ribbon.settings.fontFamilyLoading
      : context.fontListAvailable
        ? context.messages.ribbon.settings.fontFamilyCount(context.installedFonts.length)
        : context.messages.ribbon.settings.fontFamilyUnavailable;
    return (
      <>
        <form
          className="ribbon-setting-form"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <label>
            <span>{resolveLabel(editorField.label)}</span>
            <FontFamilyCombobox
              id="mve-editor-font-family"
              label={resolveLabel(editorField.label)}
              value={context.editorFontFamilyDraft}
              options={fontOptions}
              placeholder={editorField.placeholder ? resolveLabel(editorField.placeholder) : undefined}
              onChange={context.setEditorFontFamilyDraft}
              onCommit={(value) => saveFontFamily(context, "editor", value)}
            />
          </label>
          <label>
            <span>{resolveLabel(previewField.label)}</span>
            <FontFamilyCombobox
              id="mve-preview-font-family"
              label={resolveLabel(previewField.label)}
              value={context.previewFontFamilyDraft}
              options={fontOptions}
              placeholder={previewField.placeholder ? resolveLabel(previewField.placeholder) : undefined}
              onChange={context.setPreviewFontFamilyDraft}
              onCommit={(value) => saveFontFamily(context, "preview", value)}
            />
          </label>
        </form>
        <span className="ribbon-setting-hint">
          {definition.options?.hint ? resolveLabel(definition.options.hint) : ""} {status}
        </span>
      </>
    );
  }),
  shortcuts: button(
    ({ onCommand }) => onCommand({ type: "showShortcuts" }),
  ),
  features: button(
    ({ onCommand }) => onCommand({ type: "showFeatures" }),
  ),
};

interface FontFamilyComboboxProps {
  id: string;
  label: string;
  placeholder?: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
}

interface FontFamilyMenuPosition {
  left: number;
  top: number;
  width: number;
}

function FontFamilyCombobox({
  id,
  label,
  placeholder,
  value,
  options,
  onChange,
  onCommit,
}: FontFamilyComboboxProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuPosition, setMenuPosition] = useState<FontFamilyMenuPosition | null>(null);
  const valueBeforeOpenRef = useRef(value);
  const listId = `${id}-listbox`;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter((font) => font.toLocaleLowerCase().includes(normalizedQuery))
    : options;

  useEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return;
    }

    const updateMenuPosition = () => {
      const input = inputRef.current;
      if (!input) return;
      const bounds = input.getBoundingClientRect();
      setMenuPosition({
        left: bounds.left,
        top: bounds.bottom,
        width: bounds.width,
      });
    };

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open]);

  const openMenu = () => {
    valueBeforeOpenRef.current = value;
    setQuery("");
    setActiveIndex(-1);
    setOpen(true);
  };

  const selectOption = (font: string) => {
    onChange(font);
    onCommit(font);
    valueBeforeOpenRef.current = font;
    setQuery("");
    setActiveIndex(-1);
    setOpen(false);
  };

  const handleBlur = () => {
    window.setTimeout(() => {
      setOpen(false);
      setQuery("");
      setActiveIndex(-1);
      valueBeforeOpenRef.current = value;
      onCommit(value);
    }, 0);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      setActiveIndex((current) =>
        filteredOptions.length === 0
          ? -1
          : Math.min(current < 0 ? 0 : current + 1, filteredOptions.length - 1),
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      setActiveIndex((current) =>
        filteredOptions.length === 0
          ? -1
          : Math.max(current < 0 ? filteredOptions.length - 1 : current - 1, 0),
      );
      return;
    }
    if (event.key === "Enter") {
      if (open && activeIndex >= 0 && filteredOptions[activeIndex]) {
        event.preventDefault();
        selectOption(filteredOptions[activeIndex]);
      } else {
        event.preventDefault();
        setOpen(false);
        valueBeforeOpenRef.current = value;
        onCommit(value);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onChange(valueBeforeOpenRef.current);
      setOpen(false);
      setQuery("");
      setActiveIndex(-1);
    }
  };

  const menu = open && menuPosition
    ? (
      <div
        id={listId}
        className="mve-font-combobox-list"
        role="listbox"
        aria-label={label}
        style={{
          left: menuPosition.left,
          top: menuPosition.top,
          width: menuPosition.width,
        }}
      >
        {filteredOptions.map((font, index) => (
          <div
            key={font}
            id={`${listId}-${index}`}
            className="mve-font-combobox-option"
            role="option"
            aria-selected={font === value}
            data-active={index === activeIndex ? "true" : undefined}
            onMouseDown={(event) => {
              event.preventDefault();
              selectOption(font);
            }}
          >
            {font}
          </div>
        ))}
      </div>
    )
    : null;

  return (
    <>
      <div className="mve-font-combobox">
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-label={label}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          aria-expanded={open}
          aria-activedescendant={
            open && activeIndex >= 0 && filteredOptions[activeIndex]
              ? `${listId}-${activeIndex}`
              : undefined
          }
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          onFocus={openMenu}
          onClick={() => {
            if (!open) openMenu();
          }}
          onChange={(event) => {
            const nextValue = event.target.value;
            setQuery(nextValue);
            setActiveIndex(-1);
            setOpen(true);
            onChange(nextValue);
          }}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
        />
      </div>
      {menu ? createPortal(menu, document.body) : null}
    </>
  );
}

export const RIBBON_HEADER_IMPLEMENTATIONS: Record<
  RibbonHeaderImplementationId,
  RibbonButtonImplementation
> = {
  search: button(({ onCommand }) => onCommand({ type: "find" })),
  splitView: viewModeButton("both"),
  textOnly: viewModeButton("text"),
  previewOnly: viewModeButton("preview"),
  collapse: button(({ collapsed, setCollapsed }) => setCollapsed(!collapsed)),
};

function viewModeButton(
  view: "both" | "text" | "preview",
): RibbonButtonImplementation {
  return button(
    ({ onCommand }) => onCommand({ type: "splitView", view }),
    { active: (state) => state.mode === "split" && state.splitView === view },
  );
}

function tableButton(
  action: Exclude<TableAction, "insert">,
): RibbonButtonImplementation {
  return button(
    ({ onCommand, headerName }) =>
      onCommand({
        type: "table",
        action,
        headerName:
          action === "colBefore" || action === "colAfter"
            ? headerName
            : undefined,
      }),
    { disabled: editDisabled },
  );
}

function htmlOption(
  option: "embedImages" | "convertLinkedMarkdown" | "saveWithoutDialog",
): RibbonControlImplementation {
  return control((context, definition, resolveLabel) => {
    return (
      <label className="ribbon-checkbox">
        <input
          type="checkbox"
          checked={context.htmlOptions[option]}
          onChange={(event) =>
            context.onHtmlOptionsChange({
              ...context.htmlOptions,
              [option]: event.target.checked,
            })
          }
        />
        <span>{resolveLabel(definition.label)}</span>
      </label>
    );
  });
}

function getControlField(
  definition: RibbonItemDefinition,
  id: string,
): RibbonControlFieldDefinition {
  const field = definition.options?.fields?.find(
    (candidate) => candidate.id === id,
  );
  if (!field) {
    throw new Error(`Ribbon control field is missing: ${id}`);
  }
  return field;
}

function saveImageDirectory(context: RibbonImplementationContext): void {
  const directory = context.imageDirectoryDraft.trim();
  if (!directory || directory === context.imageDirectory) return;
  context.onCommand({ type: "setImageDirectory", directory });
}

function saveFontFamilies(context: RibbonImplementationContext): void {
  const editorFontFamily = normalizeFontFamily(context.editorFontFamilyDraft);
  const previewFontFamily = normalizeFontFamily(context.previewFontFamilyDraft);
  saveFontFamilyValues(context, editorFontFamily, previewFontFamily);
}

function saveFontFamily(
  context: RibbonImplementationContext,
  field: "editor" | "preview",
  value: string,
): void {
  const editorFontFamily = field === "editor"
    ? normalizeFontFamily(value)
    : normalizeFontFamily(context.editorFontFamilyDraft);
  const previewFontFamily = field === "preview"
    ? normalizeFontFamily(value)
    : normalizeFontFamily(context.previewFontFamilyDraft);
  saveFontFamilyValues(context, editorFontFamily, previewFontFamily);
}

function saveFontFamilyValues(
  context: RibbonImplementationContext,
  editorFontFamily: string,
  previewFontFamily: string,
): void {
  if (
    editorFontFamily === context.editorFontFamily &&
    previewFontFamily === context.previewFontFamily
  ) return;
  context.onCommand({ type: "setFontFamilies", editorFontFamily, previewFontFamily });
}

function clampNumber(value: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
    : minimum;
}

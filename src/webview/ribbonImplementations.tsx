
import React from "react";
import type { EditorTheme } from "../shared/protocol";
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
  shortcuts: button(
    ({ onCommand }) => onCommand({ type: "showShortcuts" }),
  ),
  features: button(
    ({ onCommand }) => onCommand({ type: "showFeatures" }),
  ),
};

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

function clampNumber(value: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
    : minimum;
}

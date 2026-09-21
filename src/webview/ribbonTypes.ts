
import type React from "react";
import type { EditorMode, HtmlExportOptions } from "../shared/protocol";
import type { MarkdownTableAction } from "../shared/markdown";
import type { Messages } from "../shared/messages";
import type { TextColorId } from "../shared/textColor";
import type { SourceAction } from "./SourceEditor";
import type {
  RibbonItemDefinition,
  RibbonLabelSpec,
} from "./ribbonDefinitionTypes";
import type { RibbonHeaderItemId } from "./ribbonIds";

export type TableAction = "insert" | MarkdownTableAction;
export type RibbonHeaderImplementationId = RibbonHeaderItemId;

export type RibbonCommand =
  | { type: "sourceAction"; action: SourceAction }
  | { type: "historyCommand"; command: "undo" | "redo" }
  | { type: "heading"; level: number }
  | { type: "insert"; value: string }
  | { type: "link" }
  | { type: "image" }
  | { type: "copyTableTsv" }
  | { type: "table"; action: TableAction; headerName?: string }
  | { type: "tableInsert"; rows: number; columns: number }
  | { type: "codeBlock"; language: string }
  | { type: "splitView"; view: "both" | "text" | "preview" }
  | {
      type:
        | "toggleOutline"
        | "toggleScrollSync"
        | "toggleInspector"
        | "togglePrintPreview"
        | "openPrintSettings";
    }
  | { type: "runPreflightCheck" }
  | { type: "showShortcuts" | "showFeatures" }
  | { type: "openSource" | "exportPdf" | "find" }
  | { type: "setImageDirectory"; directory: string }
  | {
      type: "setFontFamilies";
      editorFontFamily: string;
      previewFontFamily: string;
    }
  | { type: "exportHtml"; options: HtmlExportOptions };

export interface TextColorUiText {
  label: string;
  defaultColor: string;
  mixed: string;
  colors: Record<TextColorId, string>;
}

export type TextColorChoice = TextColorId | "default" | "mixed";

export interface RibbonButtonState {
  mode: EditorMode;
  readOnly: boolean;
  activeMarks: Record<string, boolean>;
  outlineVisible: boolean;
  scrollSyncEnabled: boolean;
  splitView: "both" | "text" | "preview";
  imageResizeControlsVisible: boolean;
}

export interface RibbonImplementationContext extends RibbonButtonState {
  messages: Messages;
  japanese: boolean;
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
  textColorText: TextColorUiText;
  htmlOptions: HtmlExportOptions;
  imageDirectory: string;
  editorFontFamily: string;
  previewFontFamily: string;
  onHtmlOptionsChange: (options: HtmlExportOptions) => void;
  onCommand: (command: RibbonCommand) => void;
  tableRows: number;
  setTableRows: (value: number) => void;
  tableColumns: number;
  setTableColumns: (value: number) => void;
  codeLanguage: string;
  setCodeLanguage: (value: string) => void;
  emoji: string;
  setEmoji: (value: string) => void;
  headerName: string;
  setHeaderName: (value: string) => void;
  textColorChoice: TextColorChoice;
  setTextColorChoice: (value: TextColorChoice) => void;
  imageDirectoryDraft: string;
  setImageDirectoryDraft: (value: string) => void;
  editorFontFamilyDraft: string;
  setEditorFontFamilyDraft: (value: string) => void;
  previewFontFamilyDraft: string;
  setPreviewFontFamilyDraft: (value: string) => void;
}

export interface RibbonButtonImplementation {
  readonly kind: "button";
  readonly active?: (state: RibbonButtonState) => boolean;
  readonly disabled?: (state: RibbonButtonState) => boolean;
  readonly onClick: (context: RibbonImplementationContext) => void;
}

export interface RibbonControlImplementation {
  readonly kind: "control";
  readonly render: (
    context: RibbonImplementationContext,
    definition: RibbonItemDefinition,
    resolveLabel: (spec: RibbonLabelSpec) => string,
  ) => React.JSX.Element;
}

export type RibbonItemImplementation =
  | RibbonButtonImplementation
  | RibbonControlImplementation;

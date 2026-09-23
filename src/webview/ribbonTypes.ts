/**
 * @file ribbonTypes.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */

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

/**
 * 「TableAction」として扱う値の型を定義します。
 */
export type TableAction = "insert" | MarkdownTableAction;
/**
 * 「RibbonHeaderImplementationId」として扱う値の型を定義します。
 */
export type RibbonHeaderImplementationId = RibbonHeaderItemId;

/**
 * 「RibbonCommand」として扱う値の型を定義します。
 */
export type RibbonCommand =
  | {
  /**
   * 「type」は、対象の識別や処理分岐に使用する値を保持します。
   */
  type: "sourceAction";
  /**
   * 「action」は、関連処理が共有する構造化データの一項目です。
   */
  action: SourceAction }
  | {
  /**
   * 「type」は、対象の識別や処理分岐に使用する値を保持します。
   */
  type: "historyCommand";
  /**
   * 「command」は、関連処理が共有する構造化データの一項目です。
   */
  command: "undo" | "redo" }
  | {
  /**
   * 「type」は、対象の識別や処理分岐に使用する値を保持します。
   */
  type: "heading";
  /**
   * 「level」は、位置・サイズ・件数などを表す数値です。
   */
  level: number }
  | {
  /**
   * 「type」は、対象の識別や処理分岐に使用する値を保持します。
   */
  type: "insert";
  /**
   * 「value」は、対象の内容または識別子を表す文字列です。
   */
  value: string }
  | {
  /**
   * 「type」は、対象の識別や処理分岐に使用する値を保持します。
   */
  type: "link" }
  | {
  /**
   * 「type」は、対象の識別や処理分岐に使用する値を保持します。
   */
  type: "image" }
  | {
  /**
   * 「type」は、対象の識別や処理分岐に使用する値を保持します。
   */
  type: "copyTableTsv" }
  | {
  /**
   * 「type」は、対象の識別や処理分岐に使用する値を保持します。
   */
  type: "table";
  /**
   * 「action」は、関連処理が共有する構造化データの一項目です。
   */
  action: TableAction;
  /**
   * 「headerName」は、対象の識別や処理分岐に使用する値を保持します。
   */
  headerName?: string }
  | {
  /**
   * 「type」は、対象の識別や処理分岐に使用する値を保持します。
   */
  type: "tableInsert";
  /**
   * 「rows」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  rows: number;
  /**
   * 「columns」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  columns: number }
  | {
  /**
   * 「type」は、対象の識別や処理分岐に使用する値を保持します。
   */
  type: "codeBlock";
  /**
   * 「language」は、対象の内容または識別子を表す文字列です。
   */
  language: string }
  | {
  /**
   * 「type」は、対象の識別や処理分岐に使用する値を保持します。
   */
  type: "splitView";
  /**
   * 「view」は、画面の表示モードまたは現在のUI状態を示します。
   */
  view: "both" | "text" | "preview" }
  | {

      /**
       * 「type」は、対象の識別や処理分岐に使用する値を保持します。
       */
      type:
        | "toggleOutline"
        | "toggleScrollSync"
        | "toggleInspector"
        | "togglePrintPreview"
        | "openPrintSettings";
    }
  | {
  /**
   * 「type」は、対象の識別や処理分岐に使用する値を保持します。
   */
  type: "runPreflightCheck" }
  | {
  /**
   * 「type」は、対象の識別や処理分岐に使用する値を保持します。
   */
  type: "showShortcuts" | "showFeatures" }
  | {
  /**
   * 「type」は、対象の識別や処理分岐に使用する値を保持します。
   */
  type: "openSource" | "exportPdf" | "find" }
  | {
  /**
   * 「type」は、対象の識別や処理分岐に使用する値を保持します。
   */
  type: "setImageDirectory";
  /**
   * 「directory」は、対象の内容または識別子を表す文字列です。
   */
  directory: string }
  | {

      /**
       * 「type」は、対象の識別や処理分岐に使用する値を保持します。
       */
      type: "setFontFamilies";

      /**
       * 「editorFontFamily」は、表示テーマまたはスタイル設定を保持します。
       */
      editorFontFamily: string;

      /**
       * 「previewFontFamily」は、表示テーマまたはスタイル設定を保持します。
       */
      previewFontFamily: string;
    }
  | {
  /**
   * 「type」は、対象の識別や処理分岐に使用する値を保持します。
   */
  type: "exportHtml";
  /**
   * 「options」は、利用側が共有する設定または現在状態を保持します。
   */
  options: HtmlExportOptions };

/**
 * 「TextColorUiText」が満たすデータ契約を定義します。
 */
export interface TextColorUiText {

  /**
   * 「label」は、画面または通知へ表示する文言を保持します。
   */
  label: string;

  /**
   * 「defaultColor」は、表示テーマまたはスタイル設定を保持します。
   */
  defaultColor: string;

  /**
   * 「mixed」は、対象の内容または識別子を表す文字列です。
   */
  mixed: string;

  /**
   * 「colors」は、表示テーマまたはスタイル設定を保持します。
   */
  colors: Record<TextColorId, string>;
}

/**
 * 「TextColorChoice」として扱う値の型を定義します。
 */
export type TextColorChoice = TextColorId | "default" | "mixed";

/**
 * 「RibbonButtonState」が満たすデータ契約を定義します。
 */
export interface RibbonButtonState {

  /**
   * 「mode」は、画面の表示モードまたは現在のUI状態を示します。
   */
  mode: EditorMode;

  /**
   * 「readOnly」は、処理条件または状態を表す真偽値です。
   */
  readOnly: boolean;

  /**
   * 「activeMarks」は、画面の表示モードまたは現在のUI状態を示します。
   */
  activeMarks: Record<string, boolean>;

  /**
   * 「outlineVisible」は、画面の表示モードまたは現在のUI状態を示します。
   */
  outlineVisible: boolean;

  /**
   * 「scrollSyncEnabled」は、画面の表示モードまたは現在のUI状態を示します。
   */
  scrollSyncEnabled: boolean;

  /**
   * 「splitView」は、関連処理が共有する構造化データの一項目です。
   */
  splitView: "both" | "text" | "preview";

  /**
   * 「imageResizeControlsVisible」は、画面の表示モードまたは現在のUI状態を示します。
   */
  imageResizeControlsVisible: boolean;
}

/**
 * 「RibbonImplementationContext」が満たすデータ契約を定義します。
 */
export interface RibbonImplementationContext extends RibbonButtonState {

  /**
   * 「messages」は、画面または通知へ表示する文言を保持します。
   */
  messages: Messages;

  /**
   * 「japanese」は、処理条件または状態を表す真偽値です。
   */
  japanese: boolean;

  /**
   * 「collapsed」は、処理条件または状態を表す真偽値です。
   */
  collapsed: boolean;
  /**
   * 「setCollapsed」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @param value 「setCollapsed」で検証・変換する入力値です。
   * @returns 「setCollapsed」の副作用または状態更新を実行し、値は返しません。
   */
  setCollapsed: (value: boolean) => void;

  /**
   * 「textColorText」は、画面または通知へ表示する文言を保持します。
   */
  textColorText: TextColorUiText;

  /**
   * 「htmlOptions」は、利用側が共有する設定または現在状態を保持します。
   */
  htmlOptions: HtmlExportOptions;

  /**
   * 「imageDirectory」は、対象の内容または識別子を表す文字列です。
   */
  imageDirectory: string;

  /**
   * 「editorFontFamily」は、表示テーマまたはスタイル設定を保持します。
   */
  editorFontFamily: string;

  /**
   * 「previewFontFamily」は、表示テーマまたはスタイル設定を保持します。
   */
  previewFontFamily: string;
  /**
   * 「onHtmlOptionsChange」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @param options 処理経路や表示方法を指定する設定値です。
   * @returns イベントを処理し、状態更新または副作用だけを実行して値は返しません。
   */
  onHtmlOptionsChange: (options: HtmlExportOptions) => void;
  /**
   * 「onCommand」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @param command 「command」は、「onCommand」がWebview UI状態の処理対象を特定する入力です。
   * @returns イベントを処理し、状態更新または副作用だけを実行して値は返しません。
   */
  onCommand: (command: RibbonCommand) => void;

  /**
   * 「tableRows」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  tableRows: number;
  /**
   * 「setTableRows」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @param value 「setTableRows」で検証・変換する入力値です。
   * @returns 「setTableRows」の副作用または状態更新を実行し、値は返しません。
   */
  setTableRows: (value: number) => void;

  /**
   * 「tableColumns」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  tableColumns: number;
  /**
   * 「setTableColumns」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @param value 「setTableColumns」で検証・変換する入力値です。
   * @returns 「setTableColumns」の副作用または状態更新を実行し、値は返しません。
   */
  setTableColumns: (value: number) => void;

  /**
   * 「codeLanguage」は、対象の内容または識別子を表す文字列です。
   */
  codeLanguage: string;
  /**
   * 「setCodeLanguage」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @param value 「setCodeLanguage」で検証・変換する入力値です。
   * @returns 「setCodeLanguage」の副作用または状態更新を実行し、値は返しません。
   */
  setCodeLanguage: (value: string) => void;

  /**
   * 「emoji」は、対象の内容または識別子を表す文字列です。
   */
  emoji: string;
  /**
   * 「setEmoji」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @param value 「setEmoji」で検証・変換する入力値です。
   * @returns 「setEmoji」の副作用または状態更新を実行し、値は返しません。
   */
  setEmoji: (value: string) => void;

  /**
   * 「headerName」は、対象の識別や処理分岐に使用する値を保持します。
   */
  headerName: string;
  /**
   * 「setHeaderName」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @param value 「setHeaderName」で検証・変換する入力値です。
   * @returns 「setHeaderName」の副作用または状態更新を実行し、値は返しません。
   */
  setHeaderName: (value: string) => void;

  /**
   * 「textColorChoice」は、画面または通知へ表示する文言を保持します。
   */
  textColorChoice: TextColorChoice;
  /**
   * 「setTextColorChoice」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @param value 「setTextColorChoice」で検証・変換する入力値です。
   * @returns 「setTextColorChoice」の副作用または状態更新を実行し、値は返しません。
   */
  setTextColorChoice: (value: TextColorChoice) => void;

  /**
   * 「imageDirectoryDraft」は、対象の内容または識別子を表す文字列です。
   */
  imageDirectoryDraft: string;
  /**
   * 「setImageDirectoryDraft」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @param value 「setImageDirectoryDraft」で検証・変換する入力値です。
   * @returns 「setImageDirectoryDraft」の副作用または状態更新を実行し、値は返しません。
   */
  setImageDirectoryDraft: (value: string) => void;

  /**
   * 「editorFontFamilyDraft」は、表示テーマまたはスタイル設定を保持します。
   */
  editorFontFamilyDraft: string;
  /**
   * 「setEditorFontFamilyDraft」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @param value 「setEditorFontFamilyDraft」で検証・変換する入力値です。
   * @returns 「setEditorFontFamilyDraft」の副作用または状態更新を実行し、値は返しません。
   */
  setEditorFontFamilyDraft: (value: string) => void;

  /**
   * 「previewFontFamilyDraft」は、表示テーマまたはスタイル設定を保持します。
   */
  previewFontFamilyDraft: string;
  /**
   * 「setPreviewFontFamilyDraft」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @param value 「setPreviewFontFamilyDraft」で検証・変換する入力値です。
   * @returns 「setPreviewFontFamilyDraft」の副作用または状態更新を実行し、値は返しません。
   */
  setPreviewFontFamilyDraft: (value: string) => void;
}

/**
 * 「RibbonButtonImplementation」が満たすデータ契約を定義します。
 */
export interface RibbonButtonImplementation {

  /**
   * 「kind」は、対象の識別や処理分岐に使用する値を保持します。
   */
  readonly kind: "button";
  /**
   * 呼び出し側が入力を渡し、宣言された戻り値型で結果を受け取る契約です。
   * @param state 処理対象の状態です。
   * @returns 判定結果です。
   */
  readonly active?: (state: RibbonButtonState) => boolean;
  /**
   * 呼び出し側が入力を渡し、宣言された戻り値型で結果を受け取る契約です。
   * @param state 処理対象の状態です。
   * @returns 判定結果です。
   */
  readonly disabled?: (state: RibbonButtonState) => boolean;
  /**
   * 呼び出し側が入力を渡し、宣言された戻り値型で結果を受け取る契約です。
   * @param context 「context」は、「onClick」がWebview UI状態の処理対象を特定する入力です。
   * @returns 状態更新または副作用を実行し、値は返しません。
   */
  readonly onClick: (context: RibbonImplementationContext) => void;
}

/**
 * 「RibbonControlImplementation」が満たすデータ契約を定義します。
 */
export interface RibbonControlImplementation {

  /**
   * 「kind」は、対象の識別や処理分岐に使用する値を保持します。
   */
  readonly kind: "control";
  /**
   * 呼び出し側が入力を渡し、宣言された戻り値型で結果を受け取る契約です。
   * @param context 「context」は、「render」がWebview UI状態の処理対象を特定する入力です。
   * @param definition 「definition」は、「render」がWebview UI状態の処理対象を特定する入力です。
   * @param resolveLabel 「resolveLabel」は、「render」がWebview UI状態の処理対象を特定する入力です。
   * @returns 「render」が生成したWebview UI状態のデータを返します。
   */
  readonly render: (
    context: RibbonImplementationContext,
    definition: RibbonItemDefinition,
    resolveLabel: (spec: RibbonLabelSpec) => string,
  ) => React.JSX.Element;
}

/**
 * 「RibbonItemImplementation」として扱う値の型を定義します。
 */
export type RibbonItemImplementation =
  | RibbonButtonImplementation
  | RibbonControlImplementation;

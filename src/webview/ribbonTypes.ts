/**
 * @fileoverview リボンの項目、表示状態、コマンド通知に共有する型を定義する。
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
 * リボン型で扱う値の種類と境界を表す型。
 */
export type TableAction = "insert" | MarkdownTableAction;
/**
 * リボン型で対象や分岐を識別する値の型。
 */
export type RibbonHeaderImplementationId = RibbonHeaderItemId;

/**
 * リボン型で扱う値の種類と境界を表す型。
 */
export type RibbonCommand =
    | {
        /**
         * リボン型で対象や分岐を識別する値の型。
         */
        type: "sourceAction";
        /**
         * リボン型のactionに関する状態または設定。
         */
        action: SourceAction
    }
    | {
        /**
         * リボン型で対象や分岐を識別する値の型。
         */
        type: "historyCommand";
        /**
         * リボン型のcommandに関する状態または設定。
         */
        command: "undo" | "redo"
    }
    | {
        /**
         * リボン型で対象や分岐を識別する値の型。
         */
        type: "heading";
        /**
         * リボン型のlevelを表す数値。
         */
        level: number
    }
    | {
        /**
         * リボン型で対象や分岐を識別する値の型。
         */
        type: "insert";
        /**
         * 検証・変換・保存の対象となる値。
         */
        value: string
    }
    | {
        /**
         * リボン型で対象や分岐を識別する値の型。
         */
        type: "link"
    }
    | {
        /**
         * リボン型で対象や分岐を識別する値の型。
         */
        type: "image"
    }
    | {
        /**
         * リボン型で対象や分岐を識別する値の型。
         */
        type: "copyTableTsv"
    }
    | {
        /**
         * リボン型で対象や分岐を識別する値の型。
         */
        type: "table";
        /**
         * リボン型のactionに関する状態または設定。
         */
        action: TableAction;
        /**
         * リボン型で扱うheader・nameの文字列。
         */
        headerName?: string
    }
    | {
        /**
         * リボン型で対象や分岐を識別する値の型。
         */
        type: "tableInsert";
        /**
         * リボン型で扱うrowsの一覧。
         */
        rows: number;
        /**
         * リボン型で扱うcolumnsの一覧。
         */
        columns: number
    }
    | {
        /**
         * リボン型で対象や分岐を識別する値の型。
         */
        type: "codeBlock";
        /**
         * リボン型で扱うlanguageの文字列。
         */
        language: string
    }
    | {
        /**
         * リボン型で対象や分岐を識別する値の型。
         */
        type: "splitView";
        /**
         * リボン型のviewに関する状態または設定。
         */
        view: "both" | "text" | "preview"
    }
    | {

        /**
         * リボン型で対象や分岐を識別する値の型。
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
         * リボン型で対象や分岐を識別する値の型。
         */
        type: "runPreflightCheck"
    }
    | {
        /**
         * リボン型で対象や分岐を識別する値の型。
         */
        type: "showShortcuts" | "showFeatures"
    }
    | {
        /**
         * リボン型で対象や分岐を識別する値の型。
         */
        type: "openSource" | "exportPdf" | "find"
    }
    | {
        /**
         * リボン型で対象や分岐を識別する値の型。
         */
        type: "setImageDirectory";
        /**
         * リボン型で読み書きするリソースの場所。
         */
        directory: string
    }
    | {

        /**
         * リボン型で対象や分岐を識別する値の型。
         */
        type: "setFontFamilies";

        /**
         * リボン型で共有するフォント設定または移行状態。
         */
        editorFontFamily: string;

        /**
         * リボン型で共有するフォント設定または移行状態。
         */
        previewFontFamily: string;
    }
    | {
        /**
         * リボン型で対象や分岐を識別する値の型。
         */
        type: "exportHtml";
        /**
         * 呼び出し側が指定する処理設定。
         */
        options: HtmlExportOptions
    };

/**
 * 文字色UIの文言を共有メッセージから参照する型。
 */
export type TextColorUiText = Messages["app"]["textColor"];

/**
 * リボン型で扱う値の種類と境界を表す型。
 */
export type TextColorChoice = TextColorId | "default" | "mixed";

/**
 * リボン型の現在状態または履歴を保持するデータ形状。
 */
export interface RibbonButtonState {

    /**
     * 編集面とプレビューの表示構成。
     */
    mode: EditorMode;

    /**
     * 編集操作を許可しない状態。
     */
    readOnly: boolean;

    /**
     * 選択範囲で有効なMarkdown書式の対応表。
     */
    activeMarks: Record<string, boolean>;

    /**
     * リボン型のoutline・visibleを示す状態フラグ。
     */
    outlineVisible: boolean;

    /**
     * 本文とプレビューのスクロール同期を有効にする設定。
     */
    scrollSyncEnabled: boolean;

    /**
     * リボン型のsplit・viewに関する状態または設定。
     */
    splitView: "both" | "text" | "preview";

    /**
     * リボン型のimage・resize・controls・visibleを示す状態フラグ。
     */
    imageResizeControlsVisible: boolean;
}

/**
 * リボン型で共有するデータ形状を表すインターフェース。
 */
export interface RibbonImplementationContext extends RibbonButtonState {

    /**
     * リボン型で扱うmessagesの一覧。
     */
    messages: Messages;

    /**
     * リボン型の状態を示すフラグ。
     */
    collapsed: boolean;
    /**
     * リボン型の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param value - 検証・変換・保存の対象となる値。
     * @returns 副作用を完了し、値は返さない。
     */
    setCollapsed: (value: boolean) => void;

    /**
     * リボン型で解析・表示・保存する本文。
     */
    textColorText: TextColorUiText;

    /**
     * リボン型へ渡す設定または境界値。
     */
    htmlOptions: HtmlExportOptions;

    /**
     * リボン型で読み書きするリソースの場所。
     */
    imageDirectory: string;

    /**
     * リボン型で共有するフォント設定または移行状態。
     */
    editorFontFamily: string;

    /**
     * リボン型で共有するフォント設定または移行状態。
     */
    previewFontFamily: string;
    /**
     * リボン型のイベントまたはメッセージを受け取り、状態を更新する。
     * @param options - 呼び出し側が指定する処理設定。
     * @returns 副作用を完了し、値は返さない。
     */
    onHtmlOptionsChange: (options: HtmlExportOptions) => void;
    /**
     * リボン型のイベントまたはメッセージを受け取り、状態を更新する。
     * @param command - リボン型へ渡す入力。
     * @returns 副作用を完了し、値は返さない。
     */
    onCommand: (command: RibbonCommand) => void;

    /**
     * リボン型で扱うtable・rowsの一覧。
     */
    tableRows: number;
    /**
     * リボン型の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param value - 検証・変換・保存の対象となる値。
     * @returns 副作用を完了し、値は返さない。
     */
    setTableRows: (value: number) => void;

    /**
     * リボン型で扱うtable・columnsの一覧。
     */
    tableColumns: number;
    /**
     * リボン型の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param value - 検証・変換・保存の対象となる値。
     * @returns 副作用を完了し、値は返さない。
     */
    setTableColumns: (value: number) => void;

    /**
     * リボン型で扱うcode・languageの文字列。
     */
    codeLanguage: string;
    /**
     * リボン型の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param value - 検証・変換・保存の対象となる値。
     * @returns 副作用を完了し、値は返さない。
     */
    setCodeLanguage: (value: string) => void;

    /**
     * リボン型で扱うemojiの文字列。
     */
    emoji: string;
    /**
     * リボン型の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param value - 検証・変換・保存の対象となる値。
     * @returns 副作用を完了し、値は返さない。
     */
    setEmoji: (value: string) => void;

    /**
     * リボン型で扱うheader・nameの文字列。
     */
    headerName: string;
    /**
     * リボン型の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param value - 検証・変換・保存の対象となる値。
     * @returns 副作用を完了し、値は返さない。
     */
    setHeaderName: (value: string) => void;

    /**
     * リボン型のtext・color・choiceに関する状態または設定。
     */
    textColorChoice: TextColorChoice;
    /**
     * リボン型の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param value - 検証・変換・保存の対象となる値。
     * @returns 副作用を完了し、値は返さない。
     */
    setTextColorChoice: (value: TextColorChoice) => void;

    /**
     * リボン型で扱うimage・directory・draftの文字列。
     */
    imageDirectoryDraft: string;
    /**
     * リボン型の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param value - 検証・変換・保存の対象となる値。
     * @returns 副作用を完了し、値は返さない。
     */
    setImageDirectoryDraft: (value: string) => void;

    /**
     * リボン型で共有するフォント設定または移行状態。
     */
    editorFontFamilyDraft: string;
    /**
     * リボン型の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param value - 検証・変換・保存の対象となる値。
     * @returns 副作用を完了し、値は返さない。
     */
    setEditorFontFamilyDraft: (value: string) => void;

    /**
     * リボン型で共有するフォント設定または移行状態。
     */
    previewFontFamilyDraft: string;
    /**
     * リボン型の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param value - 検証・変換・保存の対象となる値。
     * @returns 副作用を完了し、値は返さない。
     */
    setPreviewFontFamilyDraft: (value: string) => void;
}

/**
 * リボン型で共有するデータ形状を表すインターフェース。
 */
export interface RibbonButtonImplementation {

    /**
     * メッセージ、項目、または処理の種類を識別する値。
     */
    readonly kind: "button";
    /**
     * リボン型の状態を示すフラグ。
     */
    readonly active?: (state: RibbonButtonState) => boolean;
    /**
     * リボン型の状態を示すフラグ。
     */
    readonly disabled?: (state: RibbonButtonState) => boolean;
    /**
     * ボタン操作をHostまたは編集面へ通知する関数。
     */
    readonly onClick: (context: RibbonImplementationContext) => void;
}

/**
 * リボン型で共有するデータ形状を表すインターフェース。
 */
export interface RibbonControlImplementation {

    /**
     * メッセージ、項目、または処理の種類を識別する値。
     */
    readonly kind: "control";
    /**
     * リボン項目の表示要素を生成する関数。
     */
    readonly render: (
        context: RibbonImplementationContext,
        definition: RibbonItemDefinition,
        resolveLabel: (spec: RibbonLabelSpec) => string,
    ) => React.JSX.Element;
}

/**
 * リボン型で扱う値の種類と境界を表す型。
 */
export type RibbonItemImplementation =
    | RibbonButtonImplementation
    | RibbonControlImplementation;

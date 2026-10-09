/**
 * @fileoverview リボンの項目、表示状態、コマンド通知に共有する型を定義する。
 */
import type React from "react";
import type { EditorMode, HtmlExportOptions } from "../../shared/protocol";
import type { MarkdownTableAction } from "../../shared/markdown";
import type { Messages } from "../../shared/messages";
import type { TextColorId } from "../../shared/textColor";
import type { SourceAction } from "../editor/SourceEditor";
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
 * リボンヘッダー項目に対応する実装を選ぶ識別子型です。
 */
export type RibbonHeaderImplementationId = RibbonHeaderItemId;

/**
 * リボン型で扱う値の種類と境界を表す型。
 */
export type RibbonCommand =
    | {
        /**
         * ソース本文の編集操作を実行するコマンドです。
         */
        type: "sourceAction";
        /**
         * リンク・画像・書式などのソース編集操作。
         */
        action: SourceAction
    }
    | {
        /**
         * UndoまたはRedoを実行する履歴コマンドです。
         */
        type: "historyCommand";
        /**
         * Hostから本文を戻すundo、またはredoの履歴操作。
         */
        command: "undo" | "redo"
    }
    | {
        /**
         * 指定したレベルの見出しを挿入するコマンドです。
         */
        type: "heading";
        /**
         * 挿入する見出しレベルを示す1から6までの整数です。
         */
        level: number
    }
    | {
        /**
         * 指定したMarkdown文字列を挿入するコマンドです。
         */
        type: "insert";
        /**
         * エディターへ挿入するMarkdown本文。
         */
        value: string
    }
    | {
        /**
         * リンクの追加または編集を起動するコマンドです。
         */
        type: "link"
    }
    | {
        /**
         * 画像の挿入を起動するコマンドです。
         */
        type: "image"
    }
    | {
        /**
         * 選択中の表範囲をTSVとしてコピーするコマンドです。
         */
        type: "copyTableTsv"
    }
    | {
        /**
         * 表編集画面の表示または表操作を選ぶコマンドです。
         */
        type: "table";
        /**
         * 表へ適用する挿入・行列操作。
         */
        action: TableAction;
        /**
         * 表挿入時のヘッダー行へ入れる任意の見出し名。
         */
        headerName?: string
    }
    | {
        /**
         * 指定した行数・列数のMarkdown表を挿入するコマンドです。
         */
        type: "tableInsert";
        /**
         * 挿入するMarkdown表の行数。
         */
        rows: number;
        /**
         * 挿入するMarkdown表の列数。
         */
        columns: number
    }
    | {
        /**
         * コードブロックを挿入するコマンドです。
         */
        type: "codeBlock";
        /**
         * リボン型で扱うlanguageの文字列。
         */
        language: string
    }
    | {
        /**
         * 編集面とプレビューの表示モードを切り替えるコマンドです。
         */
        type: "splitView";
        /**
         * 編集とプレビューの表示状態。両方、テキストのみ、プレビューのみ。
         */
        view: "both" | "text" | "preview"
    }
    | {

        /**
         * 目次、スクロール同期、画像リサイズ操作の表示状態を切り替えるコマンドです。
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
         * 事前検査を実行するコマンドです。
         */
        type: "runPreflightCheck"
    }
    | {
        /**
         * ショートカットまたは機能一覧を表示するコマンドです。
         */
        type: "showShortcuts" | "showFeatures"
    }
    | {
        /**
         * ソースへの移動、PDF出力、検索のいずれかを実行するコマンドです。
         */
        type: "openSource" | "exportPdf" | "find"
    }
    | {
        /**
         * 画像保存先ルールを変更するコマンドです。
         */
        type: "setImageDirectory";
        /**
         * リボン型で読み書きするリソースの場所。
         */
        directory: string
    }
    | {

        /**
         * 編集面とプレビューのフォントを変更するコマンドです。
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
         * HTML出力を開始するコマンドです。
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
     * アウトラインパネルを現在表示している場合にtrue。
     */
    outlineVisible: boolean;

    /**
     * 本文とプレビューのスクロール同期を有効にする設定。
     */
    scrollSyncEnabled: boolean;

    /**
     * 分割表示の構成。両ペイン、テキストのみ、プレビューのみのいずれか。
     */
    splitView: "both" | "text" | "preview";

    /**
     * プレビュー内画像のサイズ操作UIが表示された場合にtrue。
     */
    imageResizeControlsVisible: boolean;
}

/**
 * リボン実装が参照する設定値、状態、更新関数です。
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
     * @param value - リボンを折りたたむ場合はtrue、展開する場合はfalse。
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

    /** PDF出力時に保存先ダイアログを省略する設定。 */
    pdfSaveWithoutDialog: boolean;

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
     */
    onHtmlOptionsChange: (options: HtmlExportOptions) => void;

    /**
     * PDFの保存先ダイアログ設定を変更し、設定を保持する所有者へ通知する。
     * @param enabled 保存時にダイアログを省略するかどうか。
     */
    onPdfSaveWithoutDialogChange: (enabled: boolean) => void;
    /**
     * リボン型のイベントまたはメッセージを受け取り、状態を更新する。
     * @param command - 実行するリボンコマンドとその引数。
     */
    onCommand: (command: RibbonCommand) => void;

    /**
     * tableInsertコマンドへ渡す表の行数。
     */
    tableRows: number;
    /**
     * リボン型の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param value - 表挿入UIへ設定する行数。
     */
    setTableRows: (value: number) => void;

    /**
     * tableInsertコマンドへ渡す表の列数。
     */
    tableColumns: number;
    /**
     * リボン型の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param value - 表挿入UIへ設定する列数。
     */
    setTableColumns: (value: number) => void;

    /**
     * コードブロックへ設定する言語識別子。
     */
    codeLanguage: string;
    /**
     * リボン型の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param value - コードブロックへ設定する言語識別子。
     */
    setCodeLanguage: (value: string) => void;

    /**
     * リボン型で扱うemojiの文字列。
     */
    emoji: string;
    /**
     * リボン型の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param value - Markdownへ挿入する絵文字。
     */
    setEmoji: (value: string) => void;

    /**
     * 表のヘッダー名入力欄に現在入力されている値。
     */
    headerName: string;
    /**
     * リボン型の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param value - 表へ挿入するヘッダー名。
     */
    setHeaderName: (value: string) => void;

    /**
     * リボンで選択中の文字色プリセット。
     */
    textColorChoice: TextColorChoice;
    /**
     * リボン型の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param value - 選択する文字色プリセット。
     */
    setTextColorChoice: (value: TextColorChoice) => void;

    /**
     * 画像保存先ルール入力欄の編集中ドラフト。
     */
    imageDirectoryDraft: string;
    /**
     * リボン型の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param value - 画像保存先ルールの編集中ドラフト。
     */
    setImageDirectoryDraft: (value: string) => void;

    /**
     * リボン型で共有するフォント設定または移行状態。
     */
    editorFontFamilyDraft: string;
    /**
     * リボン型の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param value - 編集面へ適用するフォント名の編集中ドラフト。
     */
    setEditorFontFamilyDraft: (value: string) => void;

    /**
     * リボン型で共有するフォント設定または移行状態。
     */
    previewFontFamilyDraft: string;
    /**
     * リボン型の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param value - プレビューへ適用するフォント名の編集中ドラフト。
     */
    setPreviewFontFamilyDraft: (value: string) => void;
}

/**
 * リボンのボタンを描画し、操作を通知する実装関数です。
 */
export interface RibbonButtonImplementation {

    /**
     * メッセージ、項目、または処理の種類を識別する値。
     */
    readonly kind: "button";
    /**
     * ボタン状態からactive表示を判定するpredicate。
     */
    readonly active?: (state: RibbonButtonState) => boolean;
    /**
     * ボタン状態からdisabled表示を判定するpredicate。
     */
    readonly disabled?: (state: RibbonButtonState) => boolean;
    /**
     * ボタン操作をHostまたは編集面へ通知する関数。
     */
    readonly onClick: (context: RibbonImplementationContext) => void;
}

/**
 * リボンの入力コントロールを描画する実装関数です。
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

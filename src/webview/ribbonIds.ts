/**
 * @fileoverview Webviewのリボン項目IDを管理する。Hostとの通信、ユーザー操作、表示状態の契約を保つ。
 */
/**
 * リボン項目IDで対象や分岐を識別する値の型。
 */
export type RibbonTabId =
    | "home"
    | "insert"
    | "table"
    | "view"
    | "export"
    | "settings"
    | "help";

/**
 * リボン項目IDで対象や分岐を識別する値の型。
 */
export type RibbonGroupId =
    | "history"
    | "paragraph"
    | "textFormat"
    | "clear"
    | "basic"
    | "block"
    | "assist"
    | "rows"
    | "columns"
    | "alignment"
    | "excel"
    | "pane"
    | "preview"
    | "theme"
    | "pdf"
    | "html"
    | "inspection"
    | "images"
    | "fonts"
    | "help";

/**
 * リボン項目IDで対象や分岐を識別する値の型。
 */
export type RibbonItemId =
    | "undo"
    | "redo"
    | "style"
    | "quote"
    | "bulletList"
    | "orderedList"
    | "taskList"
    | "indent"
    | "outdent"
    | "bold"
    | "italic"
    | "strike"
    | "underline"
    | "highlight"
    | "code"
    | "superscript"
    | "subscript"
    | "textColor"
    | "clearInline"
    | "clearBlock"
    | "link"
    | "image"
    | "tableSize"
    | "insertTable"
    | "horizontalRule"
    | "hardBreak"
    | "codeLanguage"
    | "codeBlock"
    | "mermaid"
    | "math"
    | "footnote"
    | "toc"
    | "pageBreak"
    | "note"
    | "warning"
    | "emoji"
    | "insertEmoji"
    | "rowBefore"
    | "rowAfter"
    | "deleteRow"
    | "colBefore"
    | "colAfter"
    | "deleteColumn"
    | "tableHeader"
    | "alignLeft"
    | "alignCenter"
    | "alignRight"
    | "alignColumns"
    | "cellBreak"
    | "openTableEditor"
    | "copyTsv"
    | "openSource"
    | "outline"
    | "scrollSync"
    | "zoomHint"
    | "imageResize"
    | "editorTheme"
    | "openPrintSettings"
    | "printPreview"
    | "exportPdf"
    | "embedImages"
    | "convertLinkedMarkdown"
    | "saveWithoutDialog"
    | "exportHtml"
    | "preflight"
    | "imageDirectory"
    | "fontSettings"
    | "shortcuts"
    | "features";

/**
 * リボン項目IDで対象や分岐を識別する値の型。
 */
export type RibbonHeaderButtonId =
    | "search"
    | "splitView"
    | "textOnly"
    | "previewOnly";

/**
 * リボン項目IDで対象や分岐を識別する値の型。
 */
export type RibbonHeaderItemId = RibbonHeaderButtonId | "collapse";

/**
 * リボン項目IDで対象や分岐を識別する値の型。
 */
export type RibbonContainerId = "tableInsertForm";

/**
 * リボン項目IDで対象や分岐を識別する値の型。
 */
export type RibbonHeaderGroupId = "viewModes";

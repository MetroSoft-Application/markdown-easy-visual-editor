/**
 * @fileoverview リボンタブ、グループ、項目を識別する安定したIDと対応関係を定義する。
 */
/**
 * リボンのタブを識別するIDの文字列型です。
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
 * タブ内のリボングループを識別するIDの文字列型です。
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
 * リボン上のボタンや入力項目を識別するIDの文字列型です。
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
    | "outline"
    | "scrollSync"
    | "imageResize"
    | "editorTheme"
    | "openPrintSettings"
    | "printPreview"
    | "savePdfWithoutDialog"
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
 * リボンヘッダーに表示するボタンを識別するIDの文字列型です。
 */
export type RibbonHeaderButtonId =
    | "search"
    | "splitView"
    | "textOnly"
    | "previewOnly"
    | "openSource";

/**
 * リボンヘッダー項目を識別するIDの文字列型です。
 */
export type RibbonHeaderItemId = RibbonHeaderButtonId | "collapse";

/**
 * リボン内のコンテナーを識別するIDの文字列型です。
 */
export type RibbonContainerId = "tableInsertForm";

/**
 * リボンヘッダーのグループを識別するIDの文字列型です。
 */
export type RibbonHeaderGroupId = "viewModes";

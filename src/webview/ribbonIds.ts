/**
 * @file ribbonIds.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */

/**
 * 「RibbonTabId」として扱う値の型を定義します。
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
 * 「RibbonGroupId」として扱う値の型を定義します。
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
 * 「RibbonItemId」として扱う値の型を定義します。
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
 * 「RibbonHeaderButtonId」として扱う値の型を定義します。
 */
export type RibbonHeaderButtonId =
  | "search"
  | "splitView"
  | "textOnly"
  | "previewOnly";

/**
 * 「RibbonHeaderItemId」として扱う値の型を定義します。
 */
export type RibbonHeaderItemId = RibbonHeaderButtonId | "collapse";

/**
 * 「RibbonContainerId」として扱う値の型を定義します。
 */
export type RibbonContainerId = "tableInsertForm";

/**
 * 「RibbonHeaderGroupId」として扱う値の型を定義します。
 */
export type RibbonHeaderGroupId = "viewModes";

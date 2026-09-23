/**
 * @file ribbonLayout.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */

import type { RibbonLayoutDefinition } from "./ribbonLayoutTypes";

/** 「RIBBON_LAYOUT」は、機能間で参照する対応表または定義です。 */
/** リボンのタブ、グループ、表示順を定義するレイアウト契約。 */
export const RIBBON_LAYOUT: RibbonLayoutDefinition = {
  tabs: [
    {
      id: "home",
      groups: [
        {
          id: "history",
          itemIds: ["undo", "redo"],
        },
        {
          id: "paragraph",
          itemIds: [
            "style",
            "quote",
            "bulletList",
            "orderedList",
            "taskList",
            "indent",
            "outdent",
          ],
        },
        {
          id: "textFormat",
          itemIds: [
            "bold",
            "italic",
            "strike",
            "underline",
            "highlight",
            "code",
            "superscript",
            "subscript",
            "textColor",
          ],
        },
        {
          id: "clear",
          itemIds: ["clearInline", "clearBlock"],
        },
      ],
    },
    {
      id: "insert",
      groups: [
        {
          id: "basic",
          itemIds: [
            "link",
            "image",
            "tableSize",
            "insertTable",
            "horizontalRule",
            "hardBreak",
          ],
        },
        {
          id: "block",
          itemIds: [
            "codeLanguage",
            "codeBlock",
            "mermaid",
            "math",
            "footnote",
            "toc",
            "pageBreak",
          ],
        },
        {
          id: "assist",
          itemIds: ["note", "warning", "emoji", "insertEmoji"],
        },
      ],
    },
    {
      id: "table",
      groups: [
        {
          id: "rows",
          itemIds: ["rowBefore", "rowAfter", "deleteRow"],
        },
        {
          id: "columns",
          itemIds: [
            "colBefore",
            "colAfter",
            "deleteColumn",
            "tableHeader",
          ],
        },
        {
          id: "alignment",
          itemIds: [
            "alignLeft",
            "alignCenter",
            "alignRight",
            "alignColumns",
            "cellBreak",
          ],
        },
        {
          id: "excel",
          itemIds: ["openTableEditor", "copyTsv"],
        },
      ],
    },
    {
      id: "view",
      groups: [
        {
          id: "pane",
          itemIds: ["openSource", "outline", "scrollSync", "zoomHint"],
        },
        {
          id: "preview",
          itemIds: ["imageResize"],
        },
        {
          id: "theme",
          itemIds: ["editorTheme"],
        },
      ],
    },
    {
      id: "export",
      groups: [
        {
          id: "pdf",
          itemIds: ["openPrintSettings", "printPreview", "exportPdf"],
        },
        {
          id: "html",
          itemIds: [
            "embedImages",
            "convertLinkedMarkdown",
            "saveWithoutDialog",
            "exportHtml",
          ],
        },
        {
          id: "inspection",
          itemIds: ["preflight"],
        },
      ],
    },
    {
      id: "settings",
      groups: [
        {
          id: "images",
          itemIds: ["imageDirectory"],
        },
        {
          id: "fonts",
          itemIds: ["fontSettings"],
        },
      ],
    },
    {
      id: "help",
      groups: [
        {
          id: "help",
          itemIds: ["shortcuts", "features"],
        },
      ],
    },
  ],

  header: {
    itemIds: ["search", "splitView", "textOnly", "previewOnly", "collapse"],
  },
};


import type { RibbonLayoutDefinition } from "./ribbonLayoutTypes";

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

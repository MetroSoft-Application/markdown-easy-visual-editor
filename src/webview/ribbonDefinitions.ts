
import type {
  RibbonControlChoiceDefinition,
  RibbonDefinitions,
} from "./ribbonDefinitionTypes";

const headingChoices: readonly RibbonControlChoiceDefinition[] = [
  {
    value: "0",
    label: { kind: "message", path: "ribbon.labels.body" },
  },
  {
    value: "1",
    label: {
      kind: "messageWithNumber",
      path: "ribbon.labels.heading",
      value: 1,
    },
  },
  {
    value: "2",
    label: {
      kind: "messageWithNumber",
      path: "ribbon.labels.heading",
      value: 2,
    },
  },
  {
    value: "3",
    label: {
      kind: "messageWithNumber",
      path: "ribbon.labels.heading",
      value: 3,
    },
  },
  {
    value: "4",
    label: {
      kind: "messageWithNumber",
      path: "ribbon.labels.heading",
      value: 4,
    },
  },
  {
    value: "5",
    label: {
      kind: "messageWithNumber",
      path: "ribbon.labels.heading",
      value: 5,
    },
  },
  {
    value: "6",
    label: {
      kind: "messageWithNumber",
      path: "ribbon.labels.heading",
      value: 6,
    },
  },
];

const documentEmojiValues = [
  "\u{1F4D8}",
  "\u{1F4DA}",
  "\u{1F4D6}",
  "\u{1F4DD}",
  "\u{270F}\u{FE0F}",
  "\u{1F4CC}",
  "\u{1F516}",
  "\u{1F50D}",
  "\u{1F9ED}",
  "\u{1F4A1}",
  "\u{2139}\u{FE0F}",
  "\u{2705}",
  "\u{26A0}\u{FE0F}",
  "\u{274C}",
  "\u{26D4}",
  "\u{1F527}",
  "\u{2699}\u{FE0F}",
  "\u{1F4CB}",
  "\u{1F517}",
  "\u{1F5BC}\u{FE0F}",
  "\u{1F4CA}",
  "\u{1F4C8}",
  "\u{1F4D0}",
  "\u{1F9EA}",
];

export const RIBBON_DEFINITIONS: RibbonDefinitions = {
  tabs: {
    home: { kind: "message", path: "ribbon.tabs.home" },
    insert: { kind: "message", path: "ribbon.tabs.insert" },
    table: { kind: "message", path: "ribbon.tabs.table" },
    view: { kind: "message", path: "ribbon.tabs.view" },
    export: { kind: "message", path: "ribbon.tabs.export" },
    settings: { kind: "message", path: "ribbon.tabs.settings" },
    help: { kind: "message", path: "ribbon.tabs.help" },
  },

  groups: {
    history: { label: { kind: "message", path: "ribbon.groups.history" } },
    paragraph: { label: { kind: "message", path: "ribbon.groups.paragraph" } },
    textFormat: { label: { kind: "message", path: "ribbon.groups.textFormat" } },
    clear: { label: { kind: "message", path: "ribbon.groups.clear" } },
    basic: { label: { kind: "message", path: "ribbon.groups.basic" } },
    block: { label: { kind: "message", path: "ribbon.groups.block" } },
    assist: { label: { kind: "message", path: "ribbon.groups.assist" } },
    rows: { label: { kind: "message", path: "ribbon.groups.rows" } },
    columns: { label: { kind: "message", path: "ribbon.groups.columns" } },
    alignment: {
      label: { kind: "message", path: "ribbon.groups.alignment" },
    },
    excel: { label: { kind: "message", path: "ribbon.groups.excel" } },
    pane: { label: { kind: "message", path: "ribbon.groups.pane" } },
    preview: {
      label: { kind: "localized", japanese: "プレビュー", english: "Preview" },
    },
    theme: {
      label: { kind: "localized", japanese: "テーマ", english: "Theme" },
    },
    pdf: { label: { kind: "message", path: "ribbon.groups.pdf" } },
    html: { label: { kind: "message", path: "ribbon.groups.html" } },
    inspection: {
      label: { kind: "message", path: "ribbon.groups.inspection" },
    },
    images: {
      label: { kind: "message", path: "ribbon.settings.images" },
      className: "ribbon-settings-group",
    },
    help: { label: { kind: "message", path: "ribbon.groups.help" } },
  },

  items: {
    undo: {
      label: { kind: "message", path: "ribbon.labels.undo" },
      options: { shortcut: "Ctrl+Z" },
    },
    redo: {
      label: { kind: "message", path: "ribbon.labels.redo" },
      options: { shortcut: "Ctrl+Y" },
    },
    style: {
      label: { kind: "message", path: "ribbon.labels.style" },
      options: { choices: headingChoices },
    },
    quote: {
      label: { kind: "message", path: "ribbon.labels.quote" },
    },
    bulletList: {
      label: { kind: "message", path: "ribbon.labels.bulletList" },
    },
    orderedList: {
      label: { kind: "message", path: "ribbon.labels.orderedList" },
    },
    taskList: {
      label: { kind: "message", path: "ribbon.labels.taskList" },
    },
    indent: {
      label: { kind: "message", path: "ribbon.labels.indent" },
    },
    outdent: {
      label: { kind: "message", path: "ribbon.labels.outdent" },
    },
    bold: {
      label: { kind: "message", path: "ribbon.labels.bold" },
    },
    italic: {
      label: { kind: "message", path: "ribbon.labels.italic" },
    },
    strike: {
      label: { kind: "message", path: "ribbon.labels.strike" },
    },
    underline: {
      label: { kind: "message", path: "ribbon.labels.underline" },
    },
    highlight: {
      label: { kind: "message", path: "ribbon.labels.highlight" },
    },
    code: {
      label: { kind: "message", path: "ribbon.labels.code" },
    },
    superscript: {
      label: { kind: "message", path: "ribbon.labels.superscript" },
    },
    subscript: {
      label: { kind: "message", path: "ribbon.labels.subscript" },
    },
    textColor: {
      label: {
        kind: "localized",
        japanese: "テキスト色",
        english: "Text color",
      },
    },
    clearInline: {
      label: { kind: "message", path: "ribbon.labels.clearInline" },
    },
    clearBlock: {
      label: { kind: "message", path: "ribbon.labels.clearBlock" },
    },
    link: {
      label: { kind: "message", path: "ribbon.labels.link" },
    },
    image: {
      label: { kind: "message", path: "ribbon.labels.image" },
      options: { shortcut: "Ctrl+V" },
    },
    tableSize: {
      label: { kind: "message", path: "ribbon.labels.tableSize" },
      container: "tableInsertForm",
      options: {
        fields: [
          {
            id: "rows",
            label: { kind: "message", path: "ribbon.labels.rows" },
            min: 2,
            max: 50,
          },
          {
            id: "columns",
            label: { kind: "message", path: "ribbon.labels.columns" },
            min: 1,
            max: 20,
          },
        ],
      },
    },
    insertTable: {
      label: { kind: "message", path: "ribbon.labels.insertTable" },
      container: "tableInsertForm",
    },
    horizontalRule: {
      label: { kind: "message", path: "ribbon.labels.horizontalRule" },
    },
    hardBreak: {
      label: { kind: "message", path: "ribbon.labels.hardBreak" },
    },
    codeLanguage: {
      label: { kind: "message", path: "ribbon.labels.language" },
    },
    codeBlock: {
      label: { kind: "message", path: "ribbon.labels.codeBlock" },
    },
    mermaid: {
      label: { kind: "message", path: "app.inspector.mermaid" },
    },
    math: {
      label: { kind: "message", path: "ribbon.labels.math" },
    },
    footnote: {
      label: { kind: "message", path: "ribbon.labels.footnote" },
    },
    toc: {
      label: { kind: "message", path: "ribbon.labels.toc" },
    },
    pageBreak: {
      label: { kind: "message", path: "ribbon.labels.pageBreak" },
    },
    note: {
      label: { kind: "message", path: "renderer.alerts.note" },
    },
    warning: {
      label: { kind: "message", path: "renderer.alerts.warning" },
    },
    emoji: {
      label: { kind: "message", path: "ribbon.labels.emoji" },
      options: { values: documentEmojiValues },
    },
    insertEmoji: {
      label: { kind: "message", path: "ribbon.labels.insertEmoji" },
    },
    rowBefore: {
      label: { kind: "message", path: "ribbon.labels.addBefore" },
    },
    rowAfter: {
      label: { kind: "message", path: "ribbon.labels.addAfter" },
    },
    deleteRow: {
      label: { kind: "message", path: "ribbon.labels.deleteRow" },
    },
    colBefore: {
      label: { kind: "message", path: "ribbon.labels.addLeft" },
    },
    colAfter: {
      label: { kind: "message", path: "ribbon.labels.addRight" },
    },
    deleteColumn: {
      label: { kind: "message", path: "ribbon.labels.deleteColumn" },
    },
    tableHeader: {
      label: { kind: "message", path: "ribbon.labels.header" },
      options: {
        fields: [
          {
            id: "header",
            label: { kind: "message", path: "ribbon.labels.header" },
            placeholder: {
              kind: "message",
              path: "ribbon.labels.headerPlaceholder",
            },
          },
        ],
      },
    },
    alignLeft: {
      label: { kind: "message", path: "ribbon.labels.alignLeft" },
    },
    alignCenter: {
      label: { kind: "message", path: "ribbon.labels.alignCenter" },
    },
    alignRight: {
      label: { kind: "message", path: "ribbon.labels.alignRight" },
    },
    alignColumns: {
      label: { kind: "message", path: "ribbon.labels.alignColumns" },
    },
    cellBreak: {
      label: { kind: "message", path: "ribbon.labels.cellBreak" },
      options: { shortcut: "Alt+Enter" },
    },
    openTableEditor: {
      label: { kind: "message", path: "app.tableEditor.title" },
    },
    copyTsv: {
      label: { kind: "message", path: "ribbon.labels.copyTsv" },
    },
    openSource: {
      label: { kind: "message", path: "ribbon.source" },
      options: {
        title: { kind: "message", path: "ribbon.sourceTitle" },
      },
    },
    outline: {
      label: { kind: "message", path: "ribbon.outline" },
      options: {
        title: { kind: "message", path: "ribbon.outlineTitle" },
      },
    },
    scrollSync: {
      label: { kind: "message", path: "ribbon.scrollSync" },
      options: {
        title: { kind: "message", path: "ribbon.scrollSyncTitle" },
      },
    },
    zoomHint: {
      label: { kind: "message", path: "ribbon.hintZoom" },
    },
    imageResize: {
      label: {
        kind: "localized",
        japanese: "画像リサイズ",
        english: "Image resize",
      },
      options: {
        title: {
          kind: "localized",
          japanese: "プレビュー画像のリサイズ操作を表示または非表示にします",
          english: "Show or hide image resize controls in the preview",
        },
      },
    },
    editorTheme: {
      label: { kind: "localized", japanese: "エディター", english: "Editor" },
      options: {
        choices: [
          {
            value: "light",
            label: { kind: "localized", japanese: "ライト", english: "Light" },
          },
          {
            value: "dark",
            label: { kind: "localized", japanese: "ダーク", english: "Dark" },
          },
        ],
      },
    },
    openPrintSettings: {
      label: { kind: "message", path: "app.printSettings" },
    },
    printPreview: {
      label: { kind: "message", path: "ribbon.labels.printPreview" },
    },
    exportPdf: {
      label: { kind: "message", path: "ribbon.labels.exportPdf" },
    },
    embedImages: {
      label: { kind: "message", path: "ribbon.labels.embedImages" },
    },
    convertLinkedMarkdown: {
      label: {
        kind: "message",
        path: "ribbon.labels.convertLinkedMarkdown",
      },
    },
    saveWithoutDialog: {
      label: { kind: "message", path: "ribbon.labels.saveWithoutDialog" },
    },
    exportHtml: {
      label: { kind: "message", path: "ribbon.labels.exportHtml" },
    },
    preflight: {
      label: { kind: "message", path: "ribbon.labels.preflight" },
    },
    imageDirectory: {
      label: { kind: "message", path: "ribbon.settings.imageDirectory" },
      options: {
        fields: [
          {
            id: "directory",
            label: {
              kind: "message",
              path: "ribbon.settings.imageDirectory",
            },
            placeholder: {
              kind: "message",
              path: "ribbon.settings.imageDirectoryPlaceholder",
            },
          },
        ],
        hint: {
          kind: "message",
          path: "ribbon.settings.imageDirectoryHint",
        },
      },
    },
    shortcuts: {
      label: { kind: "message", path: "ribbon.labels.shortcuts" },
    },
    features: {
      label: { kind: "message", path: "ribbon.labels.features" },
    },
  },

  containers: {
    tableInsertForm: {
      className: "ribbon-form",
      ariaLabel: { kind: "message", path: "ribbon.labels.tableSize" },
    },
  },

  headerItems: {
    search: {
      label: { kind: "message", path: "ribbon.search" },
      options: {
        variant: "source",
        title: { kind: "message", path: "ribbon.search" },
      },
    },
    splitView: {
      label: { kind: "message", path: "ribbon.split" },
      options: { variant: "source" },
      group: "viewModes",
    },
    textOnly: {
      label: { kind: "message", path: "ribbon.textOnly" },
      options: { variant: "source" },
      group: "viewModes",
    },
    previewOnly: {
      label: { kind: "message", path: "ribbon.previewOnly" },
      options: { variant: "source" },
      group: "viewModes",
    },
    collapse: {
      label: { kind: "message", path: "ribbon.collapse" },
      expandedLabel: { kind: "message", path: "ribbon.collapse" },
      collapsedLabel: { kind: "message", path: "ribbon.expand" },
      options: { variant: "header" },
    },
  },

  headerGroups: {
    viewModes: {
      className: "ribbon-view-controls",
      ariaLabel: { kind: "message", path: "ribbon.groups.pane" },
    },
  },

  tabListLabel: { kind: "message", path: "ribbon.label" },
};

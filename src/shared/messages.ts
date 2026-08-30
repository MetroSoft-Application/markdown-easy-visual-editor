/**
 * UIとユーザー向けメッセージの型・組み立て処理。
 * 文言本体は同階層の locales.json に置き、このファイルには埋め込まない。
 */
import localeCatalog from './locales.json';

export const SUPPORTED_LANGUAGES = ['ja', 'en', 'zh-cn', 'ko', 'fr', 'de', 'es'] as const;
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];
export type LanguageSetting = 'auto' | SupportedLanguage;

export interface Messages {
  ribbon: {
    tabs: { home: string; insert: string; table: string; view: string; export: string; help: string };
    label: string;
    source: string;
    sourceTitle: string;
    outline: string;
    outlineTitle: string;
    search: string;
    split: string;
    textOnly: string;
    previewOnly: string;
    pin: string;
    unpin: string;
    collapse: string;
    expand: string;
    groups: {
      history: string;
      paragraph: string;
      textFormat: string;
      clear: string;
      basic: string;
      block: string;
      assist: string;
      rows: string;
      columns: string;
      alignment: string;
      excel: string;
      pane: string;
      pdf: string;
      html: string;
      inspection: string;
      help: string;
    };
    labels: {
      undo: string;
      redo: string;
      style: string;
      body: string;
      heading: (level: number) => string;
      quote: string;
      bulletList: string;
      orderedList: string;
      taskList: string;
      indent: string;
      outdent: string;
      bold: string;
      italic: string;
      strike: string;
      underline: string;
      highlight: string;
      code: string;
      superscript: string;
      subscript: string;
      clearInline: string;
      clearBlock: string;
      clearAll: string;
      unlink: string;
      link: string;
      image: string;
      tableSize: string;
      rows: string;
      columns: string;
      insertTable: string;
      horizontalRule: string;
      hardBreak: string;
      language: string;
      codeBlock: string;
      math: string;
      footnote: string;
      toc: string;
      pageBreak: string;
      emoji: string;
      insertEmoji: string;
      addBefore: string;
      addAfter: string;
      addLeft: string;
      addRight: string;
      deleteRow: string;
      toggleHeader: string;
      deleteColumn: string;
      alignLeft: string;
      alignCenter: string;
      alignRight: string;
      alignColumns: string;
      cellBreak: string;
      copyTsv: string;
      printPreview: string;
      exportPdf: string;
      exportHtml: string;
      embedImages: string;
      convertLinkedMarkdown: string;
      saveWithoutDialog: string;
      preflight: string;
      shortcuts: string;
      features: string;
      markdownSupport: string;
      about: string;
      header: string;
      headerPlaceholder: string;
    };
    featureDescriptions: {
      undo: string;
      redo: string;
      bold: string;
      italic: string;
      clearInline: string;
      clearBlock: string;
      link: string;
      image: string;
      insertTable: string;
      codeBlock: string;
      math: string;
      footnote: string;
      toc: string;
      addBefore: string;
      deleteRow: string;
      deleteColumn: string;
      alignLeft: string;
      alignCenter: string;
      alignRight: string;
      copyTsv: string;
      outline: string;
      search: string;
      split: string;
      textOnly: string;
      previewOnly: string;
      printPreview: string;
      exportPdf: string;
      preflight: string;
    };
    hintZoom: string;
    codeLanguages: ReadonlyArray<{ value: string; label: string }>;
    snippets: { mermaid: string; footnote: string; note: string; warning: string };
  };
  app: {
    startup: string;
    outline: string;
    hideOutline: string;
    showOutline: string;
    outlineWidth: string;
    noHeadings: string;
    searchAndReplace: string;
    searchText: string;
    replacementText: string;
    replacement: string;
    previousMatch: string;
    nextMatch: string;
    replaceAll: string;
    close: string;
    splitBoundary: string;
    selectionFormatting: string;
    diagnosticsTitle: string;
    diagnosticHelp: string;
    noProblems: string;
    severity: { error: string; warning: string; info: string };
    line: (line: number) => string;
    printSettings: string;
    printSettingsHelp: string;
    paper: string;
    orientation: string;
    portrait: string;
    landscape: string;
    header: string;
    footer: string;
    margins: string;
    top: string;
    right: string;
    bottom: string;
    left: string;
    withoutDialog: string;
    status: {
      modeSplit: string;
      modePreview: string;
      lines: (count: number) => string;
      textCharacters: (count: number) => string;
      markdownCharacters: (count: number) => string;
      zoom: (percent: number) => string;
      syncing: string;
      synced: string;
    };
    inspector: { mermaid: string; math: string; image: string; alt: string; reference: string; openFile: string; apply: string };
    link: { title: string; url: string; urlPlaceholder: string; text: string; textHint: string; cancel: string; insert: string };
    tableEditor: {
      title: string;
      close: string;
      addRow: string;
      deleteRow: string;
      addColumn: string;
      deleteColumn: string;
      alignLeft: string;
      alignCenter: string;
      alignRight: string;
      clearAlignment: string;
      copyTsv: string;
      cancel: string;
      apply: string;
      navigationHint: string;
      sourceEditorRequired: string;
      tableRequired: string;
      rowColumnLimit: (rows: number, columns: number) => string;
      copied: string;
      sourceEditorClosed: string;
      documentChanged: string;
      resizeColumn: string;
    };
    help: {
      shortcuts: string;
      markdown: string;
      about: string;
      shortcutImage: string;
      shortcutTableBreak: string;
      markdownIntro: string;
      markdownFeatures: string;
      aboutIntro: string;
      aboutFeatures: string;
    };
    toast: {
      imagesSaved: (count: number) => string;
      pdfResourceWarnings: (count: number, detail: string) => string;
      preflightSummary: (errors: number, warnings: number, infos: number) => string;
      imageSaveFailed: (detail: string) => string;
      pdfExportFailed: (detail: string) => string;
      resourceCheckFailed: (detail: string, duringPdf: boolean) => string;
      operationFailed: (detail: string) => string;
      pdfExported: (path: string) => string;
      htmlExported: (path: string, count: number) => string;
      htmlExportFailed: (detail: string) => string;
      tableCellRequired: string;
      cannotPasteTsv: string;
      tableCopied: string;
      cannotCopyTsv: (detail?: string) => string;
      workspaceTrustRequired: string;
      pdfStartedWithDiagnostics: (count: number, detail: string) => string;
      pdfFallbackToMarkdown: (detail?: string) => string;
    };
    errors: {
      ackMismatch: string;
      pendingOperationChain: (opId: string) => string;
      clipboardUnavailable: string;
      bmpConversion: string;
      imageSize: (maxSizeMb: number) => string;
    };
  };
  renderer: {
    remoteImageDisabled: string;
    copy: string;
    copied: string;
    pageBreak: string;
    toc: string;
    backToText: string;
    mathError: string;
    mermaidError: string;
    alerts: { note: string; tip: string; important: string; warning: string; caution: string };
  };
  diagnostics: {
    unclosedFence: (marker: string) => string;
    duplicateHeading: (id: string) => string;
    invalidTableSeparator: string;
    emptyImageAlt: string;
    localImageCheck: (source: string) => string;
    emptyTableHeader: string;
    tableColumnMismatch: (header: number, separator: number, kind: 'separator' | 'body') => string;
    missingReference: (label: string) => string;
    localResource: (kind: 'image' | 'link', missing: boolean, source: string, detail: string) => string;
  };
  host: {
    pdfTrustRequired: string;
    pdfProgress: string;
    pdfExported: (path: string) => string;
    htmlTrustRequired: string;
    htmlProgress: string;
    htmlExported: (path: string) => string;
    htmlRenderTimeout: string;
    open: string;
    saveCanceled: string;
    imageDocumentMustBeSaved: string;
    unsupportedImage: (mime: string) => string;
    invalidImageDirectory: string;
    pdfBrowserUnavailable: string;
    errorPrefix: string;
    clientIdMismatch: string;
  };
  editor: { placeholder: string; codePlaceholder: string; defaultLinkLabel: string; defaultImageAlt: string; plainText: string };
  internal: { concurrentEditsOverlap: string; rootNotFound: string };
}

type RawCatalog = Record<string, unknown>;
type RawLocales = Record<SupportedLanguage, RawCatalog>;
type Values = Record<string, string | number>;

const rawLocales = localeCatalog as RawLocales;

function normalizeLanguage(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/_/g, '-');
}

function languageFromLocale(value: string | undefined): SupportedLanguage | undefined {
  const normalized = normalizeLanguage(value);
  if (!normalized) return undefined;
  if (normalized === 'zh' || normalized.startsWith('zh-cn')) return 'zh-cn';
  const primary = normalized.split('-')[0];
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(primary) ? primary as SupportedLanguage : undefined;
}

export function resolveLanguage(setting: string | undefined, vscodeLanguage?: string): SupportedLanguage {
  const normalized = normalizeLanguage(setting);
  if (normalized && normalized !== 'auto') return languageFromLocale(normalized) ?? 'en';
  return languageFromLocale(vscodeLanguage) ?? 'en';
}

function resolveCatalog(language: SupportedLanguage): RawCatalog {
  return rawLocales[language];
}

function read(catalog: RawCatalog, key: string): string {
  let value: unknown = catalog;
  for (const segment of key.split('.')) {
    if (!value || typeof value !== 'object') return '';
    value = (value as Record<string, unknown>)[segment];
  }
  return typeof value === 'string' ? value : '';
}

function interpolate(template: string, values: Values = {}): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, key: string) => (
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  ));
}

function createMessages(language: SupportedLanguage): Messages {
  const raw = resolveCatalog(language) as Record<string, any>;
  const text = (key: string, values?: Values): string => interpolate(read(raw, key), values);
  return {
    ribbon: {
      tabs: raw.ribbon.tabs,
      label: raw.ribbon.label,
      source: raw.ribbon.source,
      sourceTitle: raw.ribbon.sourceTitle,
      outline: raw.ribbon.outline,
      outlineTitle: raw.ribbon.outlineTitle,
      search: raw.ribbon.search,
      split: raw.ribbon.split,
      textOnly: raw.ribbon.textOnly,
      previewOnly: raw.ribbon.previewOnly,
      pin: raw.ribbon.pin,
      unpin: raw.ribbon.unpin,
      collapse: raw.ribbon.collapse,
      expand: raw.ribbon.expand,
      groups: raw.ribbon.groups,
      labels: {
        ...raw.ribbon.labels,
        heading: (level: number) => text('ribbon.labels.heading', { level }),
        exportHtml: raw.ribbon.labels.exportHtml,
        embedImages: raw.ribbon.labels.embedImages,
        convertLinkedMarkdown: raw.ribbon.labels.convertLinkedMarkdown,
        saveWithoutDialog: raw.ribbon.labels.saveWithoutDialog
      },
      featureDescriptions: raw.ribbon.labels.featureDescriptions,
      hintZoom: raw.ribbon.hintZoom,
      codeLanguages: raw.ribbon.codeLanguages,
      snippets: raw.ribbon.snippets
    },
    app: {
      startup: raw.app.startup,
      outline: raw.app.outline,
      hideOutline: raw.app.hideOutline,
      showOutline: raw.app.showOutline,
      outlineWidth: raw.app.outlineWidth,
      noHeadings: raw.app.noHeadings,
      searchAndReplace: raw.app.searchAndReplace,
      searchText: raw.app.searchText,
      replacementText: raw.app.replacementText,
      replacement: raw.app.replacement,
      previousMatch: raw.app.previousMatch,
      nextMatch: raw.app.nextMatch,
      replaceAll: raw.app.replaceAll,
      close: raw.app.close,
      splitBoundary: raw.app.splitBoundary,
      selectionFormatting: raw.app.selectionFormatting,
      diagnosticsTitle: raw.app.diagnosticsTitle,
      diagnosticHelp: raw.app.diagnosticHelp,
      noProblems: raw.app.noProblems,
      severity: raw.app.severity,
      line: (line: number) => text('app.line', { line }),
      printSettings: raw.app.printSettings,
      printSettingsHelp: raw.app.printSettingsHelp,
      paper: raw.app.paper,
      orientation: raw.app.orientation,
      portrait: raw.app.portrait,
      landscape: raw.app.landscape,
      header: raw.app.header,
      footer: raw.app.footer,
      margins: raw.app.margins,
      top: raw.app.top,
      right: raw.app.right,
      bottom: raw.app.bottom,
      left: raw.app.left,
      withoutDialog: raw.app.withoutDialog,
      status: {
        modeSplit: raw.app.status.modeSplit,
        modePreview: raw.app.status.modePreview,
        lines: (count: number) => text('app.status.lines', { count }),
        textCharacters: (count: number) => text('app.status.textCharacters', { count }),
        markdownCharacters: (count: number) => text('app.status.markdownCharacters', { count }),
        zoom: (percent: number) => text('app.status.zoom', { percent }),
        syncing: raw.app.status.syncing,
        synced: raw.app.status.synced
      },
      inspector: raw.app.inspector,
      link: raw.app.link,
      tableEditor: {
        title: raw.app.tableEditor.title,
        close: raw.app.tableEditor.close,
        addRow: raw.app.tableEditor.addRow,
        deleteRow: raw.app.tableEditor.deleteRow,
        addColumn: raw.app.tableEditor.addColumn,
        deleteColumn: raw.app.tableEditor.deleteColumn,
        alignLeft: raw.app.tableEditor.alignLeft,
        alignCenter: raw.app.tableEditor.alignCenter,
        alignRight: raw.app.tableEditor.alignRight,
        clearAlignment: raw.app.tableEditor.clearAlignment,
        copyTsv: raw.app.tableEditor.copyTsv,
        cancel: raw.app.tableEditor.cancel,
        apply: raw.app.tableEditor.apply,
        navigationHint: raw.app.tableEditor.navigationHint,
        sourceEditorRequired: raw.app.tableEditor.sourceEditorRequired,
        tableRequired: raw.app.tableEditor.tableRequired,
        rowColumnLimit: (rows: number, columns: number) => text('app.tableEditor.rowColumnLimit', { rows, columns }),
        copied: raw.app.tableEditor.copied,
        sourceEditorClosed: raw.app.tableEditor.sourceEditorClosed,
        documentChanged: raw.app.tableEditor.documentChanged,
        resizeColumn: raw.app.tableEditor.resizeColumn
      },
      help: raw.app.help,
      toast: {
        imagesSaved: (count: number) => text('app.toast.imagesSaved', { count }),
        pdfResourceWarnings: (count: number, detail: string) => text('app.toast.pdfResourceWarnings', { count, detail }),
        preflightSummary: (errors: number, warnings: number, infos: number) => text('app.toast.preflightSummary', { errors, warnings, infos }),
        imageSaveFailed: (detail: string) => text('app.toast.imageSaveFailed', { detail }),
        pdfExportFailed: (detail: string) => text('app.toast.pdfExportFailed', { detail }),
        resourceCheckFailed: (detail: string, duringPdf: boolean) => text('app.toast.resourceCheckFailed', { prefix: duringPdf ? `${raw.host.pdfProgress} ` : '', detail }),
        operationFailed: (detail: string) => text('app.toast.operationFailed', { detail }),
        pdfExported: (path: string) => text('app.toast.pdfExported', { path }),
        htmlExported: (path: string, count: number) => text('app.toast.htmlExported', { path, count }),
        htmlExportFailed: (detail: string) => text('app.toast.htmlExportFailed', { detail }),
        tableCellRequired: raw.app.toast.tableCellRequired,
        cannotPasteTsv: raw.app.toast.cannotPasteTsv,
        tableCopied: raw.app.toast.tableCopied,
        cannotCopyTsv: (detail?: string) => detail ? text('app.toast.cannotCopyTsv', { detail }) : raw.app.toast.cannotCopyTsvEmpty,
        workspaceTrustRequired: raw.app.toast.workspaceTrustRequired,
        pdfStartedWithDiagnostics: (count: number, detail: string) => text('app.toast.pdfStartedWithDiagnostics', { count, detail }),
        pdfFallbackToMarkdown: (detail?: string) => text('app.toast.pdfFallbackToMarkdown', { prefix: detail ? `${detail} ` : '' })
      },
      errors: {
        ackMismatch: raw.app.errors.ackMismatch,
        pendingOperationChain: (opId: string) => text('app.errors.pendingOperationChain', { opId }),
        clipboardUnavailable: raw.app.errors.clipboardUnavailable,
        bmpConversion: raw.app.errors.bmpConversion,
        imageSize: (maxSizeMb: number) => text('app.errors.imageSize', { maxSizeMb })
      }
    },
    renderer: raw.renderer,
    diagnostics: {
      unclosedFence: (marker: string) => text('diagnostics.unclosedFence', { marker }),
      duplicateHeading: (id: string) => text('diagnostics.duplicateHeading', { id }),
      invalidTableSeparator: raw.diagnostics.invalidTableSeparator,
      emptyImageAlt: raw.diagnostics.emptyImageAlt,
      localImageCheck: (source: string) => text('diagnostics.localImageCheck', { source }),
      emptyTableHeader: raw.diagnostics.emptyTableHeader,
      tableColumnMismatch: (header: number, count: number, kind: 'separator' | 'body') => text('diagnostics.tableColumnMismatch', { header, count, kind: raw.diagnostics.tableKind[kind] }),
      missingReference: (label: string) => text('diagnostics.missingReference', { label }),
      localResource: (kind: 'image' | 'link', missing: boolean, source: string, detail: string) => {
        const suffix = kind === 'image' ? (missing ? 'imageMissing' : 'imageCheckFailed') : (missing ? 'linkMissing' : 'linkCheckFailed');
        return text(`diagnostics.localResource.${suffix}`, { source, detail });
      }
    },
    host: {
      pdfTrustRequired: raw.host.pdfTrustRequired,
      pdfProgress: raw.host.pdfProgress,
      pdfExported: (path: string) => text('host.pdfExported', { path }),
      htmlTrustRequired: raw.host.htmlTrustRequired,
      htmlProgress: raw.host.htmlProgress,
      htmlExported: (path: string) => text('host.htmlExported', { path }),
      htmlRenderTimeout: raw.host.htmlRenderTimeout,
      open: raw.host.open,
      saveCanceled: raw.host.saveCanceled,
      imageDocumentMustBeSaved: raw.host.imageDocumentMustBeSaved,
      unsupportedImage: (mime: string) => text('host.unsupportedImage', { mime }),
      invalidImageDirectory: raw.host.invalidImageDirectory,
      pdfBrowserUnavailable: raw.host.pdfBrowserUnavailable,
      errorPrefix: raw.host.errorPrefix,
      clientIdMismatch: raw.host.clientIdMismatch
    },
    editor: raw.editor,
    internal: raw.internal
  };
}

export function getMessages(language: SupportedLanguage | string | undefined, vscodeLanguage?: string): Messages {
  return MESSAGE_CATALOG[resolveLanguage(language, vscodeLanguage)];
}

export const MESSAGE_CATALOG: Record<SupportedLanguage, Messages> = Object.fromEntries(
  SUPPORTED_LANGUAGES.map((language) => [language, createMessages(language)])
) as Record<SupportedLanguage, Messages>;

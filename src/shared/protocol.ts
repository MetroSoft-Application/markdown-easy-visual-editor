import type { Diagnostic } from './markdown';
import { DEFAULT_FONT_FAMILY_STACK, type FontFamilySettings } from './fontFamily';
import type { SupportedLanguage } from './messages';

export type EditorMode = 'split' | 'preview';
export type ViewMode = 'both' | 'text' | 'preview';
export type EditorTheme = 'light' | 'dark';

/** PDFで選択できる用紙。A判はPlaywright標準、B4/B5はJIS寸法で明示指定する。 */
export const PDF_PAPER_FORMATS = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B4', 'B5'] as const;
export type PdfPaperFormat = typeof PDF_PAPER_FORMATS[number];

export interface ImagePayload {
    name?: string;
    mime: string;
    base64: string;
}

export interface PdfOptions {
    /** 用紙サイズ。Letterは採用せず、日本で一般的なA判・B判を使用する。 */
    format: PdfPaperFormat;
    orientation: 'portrait' | 'landscape';
    margins: { top: number; right: number; bottom: number; left: number };
    header: string;
    footer: string;
    /** 印刷本文へ適用するCSSフォントファミリー。未指定時は標準フォントへフォールバックする。 */
    fontFamily?: string;
    /** 本文のフォントサイズ。単位はポイントで、6〜48ptへ正規化される。 */
    bodyFontSize?: number;
    /** H1〜H6のフォントサイズ。単位はポイントで、各値は6〜72ptへ正規化される。 */
    headingFontSizes?: { h1: number; h2: number; h3: number; h4: number; h5: number; h6: number };
    /** pre要素とcode要素のフォントサイズ。単位はポイントで、6〜36ptへ正規化される。 */
    codeFontSize?: number;
    /** 本文の行高。単位を持たない倍率で、0.8〜3へ正規化される。 */
    lineHeight?: number;
    /** 段落の下側余白。単位はポイントで、0〜48ptへ正規化される。 */
    paragraphSpacing?: number;
    saveWithoutDialog: boolean;
}

/**
 * すべての印刷用タイポグラフィ設定が補完・範囲検証済みになったPDF設定。
 * Webviewの入力値や過去バージョンの保存値をそのまま使わず、PDF生成前にこの型へ変換する。
 */
export type NormalizedPdfOptions = Omit<PdfOptions, 'fontFamily' | 'bodyFontSize' | 'headingFontSizes' | 'codeFontSize' | 'lineHeight' | 'paragraphSpacing'> & {
    fontFamily: string;
    bodyFontSize: number;
    headingFontSizes: { h1: number; h2: number; h3: number; h4: number; h5: number; h6: number };
    codeFontSize: number;
    lineHeight: number;
    paragraphSpacing: number;
};

export interface HtmlExportOptions {
    embedImages: boolean;
    convertLinkedMarkdown: boolean;
    saveWithoutDialog: boolean;
}

/** PDF出力UIとExplorer起点の出力で共有する初期値。全Markdown文書共通の標準印刷設定でもある。 */
export const DEFAULT_PDF_OPTIONS: NormalizedPdfOptions = {
    format: 'A4',
    orientation: 'portrait',
    margins: { top: 15, right: 15, bottom: 15, left: 15 },
    header: '',
    footer: '{page}/{pages}',
    fontFamily: DEFAULT_FONT_FAMILY_STACK,
    bodyFontSize: 11,
    headingFontSizes: { h1: 24, h2: 20, h3: 16, h4: 14, h5: 12, h6: 11 },
    codeFontSize: 9,
    lineHeight: 1.6,
    paragraphSpacing: 6,
    saveWithoutDialog: true
};

/**
 * 永続化済みまたは過去バージョンのPDF設定を、現在の安全な設定へ正規化する。
 * @param value globalState、Webviewメッセージ、旧形式の設定など、検証前の値。
 * @returns 欠落値を標準値で補完し、数値を許容範囲へ収めたPDF設定。
 */
export function normalizePdfOptions(value: unknown): NormalizedPdfOptions {
    const candidate = value && typeof value === 'object' ? value as Partial<PdfOptions> : {};
    const margins = (candidate.margins && typeof candidate.margins === 'object'
        ? candidate.margins
        : {}) as Partial<PdfOptions['margins']>;
    const headings = (candidate.headingFontSizes && typeof candidate.headingFontSizes === 'object'
        ? candidate.headingFontSizes
        : {}) as Partial<NonNullable<PdfOptions['headingFontSizes']>>;
    /** 数値化できない値を標準値へ戻し、指定範囲に収める。 */
    const numberInRange = (input: unknown, fallback: number, min: number, max: number): number => {
        const parsed = typeof input === 'number' ? input : Number(input);
        return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
    };
    /** 余白のように整数で扱う設定を、範囲検証後に丸める。 */
    const integerInRange = (input: unknown, fallback: number, min: number, max: number): number =>
        Math.round(numberInRange(input, fallback, min, max));
    const format = typeof candidate.format === 'string' && (PDF_PAPER_FORMATS as readonly string[]).includes(candidate.format)
        ? candidate.format as PdfPaperFormat
        : 'A4';
    const orientation = candidate.orientation === 'landscape' ? 'landscape' : 'portrait';
    return {
        format,
        orientation,
        margins: {
            top: integerInRange(margins.top, DEFAULT_PDF_OPTIONS.margins.top, 0, 50),
            right: integerInRange(margins.right, DEFAULT_PDF_OPTIONS.margins.right, 0, 50),
            bottom: integerInRange(margins.bottom, DEFAULT_PDF_OPTIONS.margins.bottom, 0, 50),
            left: integerInRange(margins.left, DEFAULT_PDF_OPTIONS.margins.left, 0, 50)
        },
        header: typeof candidate.header === 'string' ? candidate.header : DEFAULT_PDF_OPTIONS.header,
        footer: typeof candidate.footer === 'string' ? candidate.footer : DEFAULT_PDF_OPTIONS.footer,
        fontFamily: typeof candidate.fontFamily === 'string' && candidate.fontFamily.trim()
            ? candidate.fontFamily.trim()
            : DEFAULT_PDF_OPTIONS.fontFamily,
        bodyFontSize: numberInRange(candidate.bodyFontSize, DEFAULT_PDF_OPTIONS.bodyFontSize, 6, 48),
        headingFontSizes: {
            h1: numberInRange(headings.h1, DEFAULT_PDF_OPTIONS.headingFontSizes.h1, 6, 72),
            h2: numberInRange(headings.h2, DEFAULT_PDF_OPTIONS.headingFontSizes.h2, 6, 72),
            h3: numberInRange(headings.h3, DEFAULT_PDF_OPTIONS.headingFontSizes.h3, 6, 72),
            h4: numberInRange(headings.h4, DEFAULT_PDF_OPTIONS.headingFontSizes.h4, 6, 72),
            h5: numberInRange(headings.h5, DEFAULT_PDF_OPTIONS.headingFontSizes.h5, 6, 72),
            h6: numberInRange(headings.h6, DEFAULT_PDF_OPTIONS.headingFontSizes.h6, 6, 72)
        },
        codeFontSize: numberInRange(candidate.codeFontSize, DEFAULT_PDF_OPTIONS.codeFontSize, 6, 36),
        lineHeight: numberInRange(candidate.lineHeight, DEFAULT_PDF_OPTIONS.lineHeight, 0.8, 3),
        paragraphSpacing: numberInRange(candidate.paragraphSpacing, DEFAULT_PDF_OPTIONS.paragraphSpacing, 0, 48),
        saveWithoutDialog: typeof candidate.saveWithoutDialog === 'boolean'
            ? candidate.saveWithoutDialog
            : DEFAULT_PDF_OPTIONS.saveWithoutDialog
    };
}

/** HTML出力UIとExplorer起点の出力で共有する初期値。 */
export const DEFAULT_HTML_EXPORT_OPTIONS: HtmlExportOptions = {
    embedImages: false,
    convertLinkedMarkdown: false,
    saveWithoutDialog: true
};

export interface WebviewSettings extends FontFamilySettings {
    language: SupportedLanguage;
    imageDirectory: string;
    maxPasteSizeMb: number;
    remoteImagesEnabled: boolean;
    mermaidTheme: 'auto' | 'default' | 'dark' | 'neutral';
    /** MermaidをWebviewとは別のブラウザプロセスで描画できるか。 */
    mermaidHostRendering?: boolean;
    editorTheme?: EditorTheme;
    viewMode?: ViewMode;
    /** すべての文書で共有するアウトラインの表示状態。 */
    outlineVisible?: boolean;
    /** 分割表示でテキストとプレビューのスクロール位置を相互に同期するか。 */
    scrollSyncEnabled?: boolean;
    /** プレビュー画像のリサイズ・配置操作UIを表示するか。未設定時は表示する。 */
    previewImageResizeControlsVisible?: boolean;
    /** PDF印刷設定。文書をまたいで共有するグローバル設定。 */
    pdfOptions?: PdfOptions;
    workspaceTrusted: boolean;
    /** 開発用の実 VS Code 起動計測を有効にする。 */
    startupProbe?: boolean;
}

/**
 * WebviewとExtension Host間の本文差分。
 * `rangeOffset` / `rangeLength` / `text` はすべてLF正規化済み本文を基準とし、
 * VS Code文書の物理EOL（LF/CRLF）はExtension Host境界でのみ変換する。
 */
export interface TextChange {
    rangeOffset: number;
    rangeLength: number;
    text: string;
}

export interface MermaidInteraction {
    type: 'text' | 'link';
    text: string;
    href?: string;
    left: number;
    top: number;
    width: number;
    height: number;
}

export type HostToWebviewMessage =
    | {
        type: 'init';
        /** LF正規化済み本文。 */
        text: string;
        version: number;
        uri: string;
        settings: WebviewSettings;
    }
    | { type: 'editAck'; clientId: string; opId: string; baseVersion: number; version: number; changes: TextChange[] }
    | { type: 'externalChanges'; baseVersion: number; version: number; changes: TextChange[]; clientId?: string; opId?: string }
    | {
        type: 'resyncRequired';
        clientId: string;
        opId?: string;
        operationApplied?: boolean;
        /** LF正規化済み本文。 */
        text: string;
        version: number;
        reason: string;
    }
    | { type: 'settingsChanged'; settings: WebviewSettings }
    | { type: 'installedFonts'; fonts: string[]; available: boolean }
    | { type: 'imagesSaved'; requestId: string; paths: string[] }
    | { type: 'localResourcesChecked'; requestId: string; diagnostics: Diagnostic[] }
    | { type: 'operationFailed'; requestId?: string; message: string }
    | { type: 'pdfExported'; requestId: string; path: string }
    | { type: 'htmlExported'; requestId: string; paths: string[] }
    | {
        type: 'renderHtmlDocuments';
        requestId: string;
        documents: Array<{ id: string; markdown: string }>;
    }
    | { type: 'pdfPreviewReady'; requestId: string; pdfBase64: string }
    | {
        type: 'mermaidRendered';
        requestId: string;
        svg?: string;
        pngBase64?: string;
        interactions?: MermaidInteraction[];
        ariaLabel?: string;
        error?: string;
        rendererUnavailable?: boolean;
    }
    | { type: 'hostCommand'; command: 'insertImage' | 'exportPdf' | 'exportHtml' | 'undo' | 'redo' };

export type WebviewToHostMessage =
    | { type: 'ready'; clientId: string }
    | { type: 'initialized'; clientId: string }
    | {
        type: 'startupReady';
        clientId: string;
        markdownLength: number;
        metrics?: Record<string, number>;
    }
    | { type: 'startupMermaidReady'; clientId: string }
    | { type: 'localChanges'; clientId: string; opId: string; baseVersion: number; changes: TextChange[] }
    | { type: 'historyCommand'; clientId: string; command: 'undo' | 'redo' }
    | { type: 'saveImages'; requestId: string; images: ImagePayload[]; imageDirectory: string }
    | { type: 'pickImage'; requestId: string; imageDirectory: string }
    | { type: 'checkLocalResources'; requestId: string; markdown: string }
    | { type: 'requestInstalledFonts' }
    | { type: 'setEditorTheme'; theme: EditorTheme }
    | { type: 'setImageDirectory'; directory: string }
    | { type: 'setFontFamilies'; editorFontFamily: string; previewFontFamily: string }
    | { type: 'setViewMode'; viewMode: ViewMode }
    | { type: 'setOutlineVisible'; visible: boolean }
    | { type: 'setScrollSyncEnabled'; enabled: boolean }
    | { type: 'setPreviewImageResizeControlsVisible'; visible: boolean }
    | { type: 'setPdfOptions'; options: PdfOptions }
    | {
        type: 'exportPdf';
        requestId: string;
        html: string;
        css: string;
        options: PdfOptions;
    }
    | {
        type: 'exportHtml';
        requestId: string;
        markdown: string;
        html: string;
        css: string;
        options: HtmlExportOptions;
    }
    | {
        type: 'htmlDocumentsRendered';
        requestId: string;
        documents: Array<{ id: string; html: string }>;
    }
    | {
        type: 'renderPdfPreview';
        requestId: string;
        html: string;
        css: string;
        options: PdfOptions;
    }
    | {
        type: 'renderMermaid';
        requestId: string;
        source: string;
        theme: 'default' | 'dark' | 'neutral';
    }
    | { type: 'cancelMermaidRender'; requestId: string }
    | { type: 'openSource' }
    | { type: 'openResource'; href: string }
    | { type: 'requestResync'; clientId: string; opId?: string; version: number; reason: string };

export interface VsCodeApi<State = unknown> {
    postMessage(message: WebviewToHostMessage): void;
    getState(): State | undefined;
    setState(newState: State): void;
}

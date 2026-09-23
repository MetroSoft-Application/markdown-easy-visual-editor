/**
 * @fileoverview HostとWebviewが送受信するメッセージ、設定、ペイロードの型・既定値・正規化規則を定義する。
 */
import type { Diagnostic } from './markdown';
import { DEFAULT_FONT_FAMILY_STACK, type FontFamilySettings } from './fontFamily';
import type { SupportedLanguage } from './messages';

/**
 * 本文編集とプレビューの表示構成を表す値。
 */
export type EditorMode = 'split' | 'preview';
/**
 * 本文ペインとプレビューペインの表示状態を表す値。
 */
export type ViewMode = 'both' | 'text' | 'preview';
/**
 * 編集画面に適用するライト・ダークテーマを表す値。
 */
export type EditorTheme = 'light' | 'dark';

/**
 * PDF設定で選択できる用紙サイズの一覧。
 */
export const PDF_PAPER_FORMATS = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B4', 'B5'] as const;
/**
 * PDF設定で選択できる用紙サイズのリテラル型。
 */
export type PdfPaperFormat = typeof PDF_PAPER_FORMATS[number];

/**
 * 画像保存で受け渡す名前、MIMEタイプ、Base64本文の組。
 */
export interface ImagePayload {

    /**
     * 画像の元ファイル名または表示名。
     */
    name?: string;

    /**
     * 画像データのMIMEタイプ。
     */
    mime: string;

    /**
     * 画像本文をBase64で表したデータ。
     */
    base64: string;
}

/**
 * PDF生成に使う用紙、向き、余白、本文スタイルの設定。
 */
export interface PdfOptions {
    /**
     * PDFで選択する用紙サイズ。
     */
    format: PdfPaperFormat;

    /**
     * PDFの用紙方向。
     */
    orientation: 'portrait' | 'landscape';

    /**
     * PDFの上下左右余白。
     */
    margins: {
        /**
         * PDF本文領域の上余白。
         */
        top: number;
        /**
         * PDF本文領域の右余白。
         */
        right: number;
        /**
         * PDF本文領域の下余白。
         */
        bottom: number;
        /**
         * PDF本文領域の左余白。
         */
        left: number
    };

    /**
     * PDFヘッダーに挿入する文字列。
     */
    header: string;

    /**
     * PDFフッターに挿入する文字列。
     */
    footer: string;
    /**
     * PDF本文に適用するフォント指定。
     */
    fontFamily?: string;
    /**
     * PDF本文の文字サイズ。
     */
    bodyFontSize?: number;
    /**
     * PDF見出しごとの文字サイズ設定。
     */
    headingFontSizes?: {
        /**
         * PDF見出し1の文字サイズ。
         */
        h1: number;
        /**
         * PDF見出し2の文字サイズ。
         */
        h2: number;
        /**
         * PDF見出し3の文字サイズ。
         */
        h3: number;
        /**
         * PDF見出し4の文字サイズ。
         */
        h4: number;
        /**
         * PDF見出し5の文字サイズ。
         */
        h5: number;
        /**
         * PDF見出し6の文字サイズ。
         */
        h6: number
    };
    /**
     * PDFコードブロックの文字サイズ。
     */
    codeFontSize?: number;
    /**
     * PDF本文の行間倍率。
     */
    lineHeight?: number;
    /**
     * PDF段落間の間隔。
     */
    paragraphSpacing?: number;

    /**
     * 出力を保存ダイアログなしで確定する設定。
     */
    saveWithoutDialog: boolean;
}

/**
 * 共有プロトコルへ渡す設定項目と既定値のデータ形状。
 */
export type NormalizedPdfOptions = Omit<PdfOptions, 'fontFamily' | 'bodyFontSize' | 'headingFontSizes' | 'codeFontSize' | 'lineHeight' | 'paragraphSpacing'> & {

    /**
     * PDF本文に適用するフォント指定。
     */
    fontFamily: string;

    /**
     * PDF本文の文字サイズ。
     */
    bodyFontSize: number;

    /**
     * PDF見出しごとの文字サイズ設定。
     */
    headingFontSizes: {
        /**
         * PDF見出し1の文字サイズ。
         */
        h1: number;
        /**
         * PDF見出し2の文字サイズ。
         */
        h2: number;
        /**
         * PDF見出し3の文字サイズ。
         */
        h3: number;
        /**
         * PDF見出し4の文字サイズ。
         */
        h4: number;
        /**
         * PDF見出し5の文字サイズ。
         */
        h5: number;
        /**
         * PDF見出し6の文字サイズ。
         */
        h6: number
    };

    /**
     * PDFコードブロックの文字サイズ。
     */
    codeFontSize: number;

    /**
     * PDF本文の行間倍率。
     */
    lineHeight: number;

    /**
     * PDF段落間の間隔。
     */
    paragraphSpacing: number;
};

/**
 * 共有プロトコルへ渡す設定項目と既定値のデータ形状。
 */
export interface HtmlExportOptions {

    /**
     * PDF見出しembedImagesの文字サイズ。
     */
    embedImages: boolean;

    /**
     * PDF見出しconvertLinkedMarkdownの文字サイズ。
     */
    convertLinkedMarkdown: boolean;

    /**
     * 出力を保存ダイアログなしで確定する設定。
     */
    saveWithoutDialog: boolean;
}

/**
 * 共有プロトコルへ渡す設定項目と既定値のデータ形状。
 */
export type HtmlExportSettings = Pick<HtmlExportOptions, 'embedImages' | 'convertLinkedMarkdown' | 'saveWithoutDialog'>;

/**
 * PDF設定が未指定のときに使う用紙、余白、文字組みの既定値。
 */
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
 * PDF設定を許可値へ正規化し、範囲外の寸法や余白を境界値へ収める。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns 共有プロトコルで生成または変換した値。
 */
export function normalizePdfOptions(value: unknown): NormalizedPdfOptions {
    const candidate = value && typeof value === 'object' ? value as Partial<PdfOptions> : {};
    const margins = (candidate.margins && typeof candidate.margins === 'object'
        ? candidate.margins
        : {}) as Partial<PdfOptions['margins']>;
    const headings = (candidate.headingFontSizes && typeof candidate.headingFontSizes === 'object'
        ? candidate.headingFontSizes
        : {}) as Partial<NonNullable<PdfOptions['headingFontSizes']>>;

    const numberInRange = /**
     * 共有プロトコルのnumber・in・rangeを処理し、呼び出し側へ結果または副作用を返す。
     * @param input - 共有プロトコルへ渡す入力。
     * @param fallback - 共有プロトコルで扱う数値。
     * @param min - 入力または寸法に許可する下限値。
     * @param max - 入力または寸法に許可する上限値。
     * @returns 共有プロトコルで利用する数値。
     */ (input: unknown, fallback: number, min: number, max: number): number => {
            const parsed = typeof input === 'number' ? input : Number(input);
            return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
        };

    const integerInRange = /**
     * 共有プロトコルのinteger・in・rangeを処理し、呼び出し側へ結果または副作用を返す。
     * @param input - 共有プロトコルへ渡す入力。
     * @param fallback - 共有プロトコルで扱う数値。
     * @param min - 入力または寸法に許可する下限値。
     * @param max - 入力または寸法に許可する上限値。
     * @returns 共有プロトコルで利用する数値。
     */ (input: unknown, fallback: number, min: number, max: number): number =>
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

/**
 * HTML出力の永続設定がないときに使う既定値。
 */
export const DEFAULT_HTML_EXPORT_SETTINGS: HtmlExportSettings = {
    embedImages: false,
    convertLinkedMarkdown: false,
    saveWithoutDialog: true
};

/**
 * HTML出力設定が未指定のときに使う既定値。
 */
export const DEFAULT_HTML_EXPORT_OPTIONS: HtmlExportOptions = {
    ...DEFAULT_HTML_EXPORT_SETTINGS
};

/**
 * HTML出力設定を許可値へ正規化し、未指定項目へ既定値を補う。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns 共有プロトコルで生成または変換した値。
 */
export function normalizeHtmlExportSettings(value: unknown): HtmlExportSettings {
    const candidate = value && typeof value === 'object'
        ? value as Partial<HtmlExportSettings>
        : {};
    return {
        embedImages: typeof candidate.embedImages === 'boolean'
            ? candidate.embedImages
            : DEFAULT_HTML_EXPORT_SETTINGS.embedImages,
        convertLinkedMarkdown: typeof candidate.convertLinkedMarkdown === 'boolean'
            ? candidate.convertLinkedMarkdown
            : DEFAULT_HTML_EXPORT_SETTINGS.convertLinkedMarkdown,
        saveWithoutDialog: typeof candidate.saveWithoutDialog === 'boolean'
            ? candidate.saveWithoutDialog
            : DEFAULT_HTML_EXPORT_SETTINGS.saveWithoutDialog
    };
}

/**
 * 共有プロトコルのmerge・html・export・optionsを処理し、呼び出し側へ結果または副作用を返す。
 * @param current - 共有プロトコルへ渡す入力。
 * @param next - 共有プロトコルの位置・寸法・件数・時間を表す数値。
 * @returns 共有プロトコルのmerge・html・export・optionsが生成する結果。
 */
export function mergeHtmlExportOptions(
    current: HtmlExportOptions,
    next: HtmlExportSettings | HtmlExportOptions
): HtmlExportOptions {
    return {
        ...current,
        ...normalizeHtmlExportSettings(next)
    };
}

/**
 * 共有プロトコルへ渡す設定項目と既定値のデータ形状。
 */
export interface WebviewSettings extends FontFamilySettings {

    /**
     * PDF見出しlanguageの文字サイズ。
     */
    language: SupportedLanguage;

    /**
     * PDF見出しimageDirectoryの文字サイズ。
     */
    imageDirectory: string;

    /**
     * PDF見出しmaxPasteSizeMbの文字サイズ。
     */
    maxPasteSizeMb: number;

    /**
     * PDF見出しremoteImagesEnabledの文字サイズ。
     */
    remoteImagesEnabled: boolean;

    /**
     * PDF見出しmermaidThemeの文字サイズ。
     */
    mermaidTheme: 'auto' | 'default' | 'dark' | 'neutral';
    /**
     * PDF見出しmermaidHostRenderingの文字サイズ。
     */
    mermaidHostRendering?: boolean;

    /**
     * PDF見出しeditorThemeの文字サイズ。
     */
    editorTheme?: EditorTheme;

    /**
     * PDF見出しviewModeの文字サイズ。
     */
    viewMode?: ViewMode;
    /**
     * PDF見出しoutlineVisibleの文字サイズ。
     */
    outlineVisible?: boolean;
    /**
     * PDF見出しscrollSyncEnabledの文字サイズ。
     */
    scrollSyncEnabled?: boolean;
    /**
     * PDF見出しpreviewImageResizeControlsVisibleの文字サイズ。
     */
    previewImageResizeControlsVisible?: boolean;
    /**
     * PDF見出しpdfOptionsの文字サイズ。
     */
    pdfOptions?: PdfOptions;
    /**
     * PDF見出しtmlOptionsの文字サイズ。
     */
    htmlOptions: HtmlExportSettings;

    /**
     * 共有プロトコルのworkspace・trustedを制御する同期設定。
     */
    workspaceTrusted: boolean;
    /**
     * 共有プロトコルのstartup・probeを制御する同期設定。
     */
    startupProbe?: boolean;
}

/**
 * 共有プロトコルで共有するデータ形状を表すインターフェース。
 */
export interface TextChange {

    /**
     * 共有プロトコルの位置・寸法・件数・時間を表す数値。
     */
    rangeOffset: number;

    /**
     * 共有プロトコルの位置・寸法・件数・時間を表す数値。
     */
    rangeLength: number;

    /**
     * 共有プロトコルで受け渡すtextの文字列。
     */
    text: string;
}

/**
 * 図中の文字・リンク領域と正規化座標を表すデータ。
 */
export interface MermaidInteraction {

    /**
     * 共有プロトコルで対象や分岐を識別する値の型。
     */
    type: 'text' | 'link';

    /**
     * 共有プロトコルで受け渡すtextの文字列。
     */
    text: string;

    /**
     * 共有プロトコルで受け渡すhrefの文字列。
     */
    href?: string;

    /**
     * 親領域の左端を基準にした相対位置または比較値。
     */
    left: number;

    /**
     * 親領域の上端を基準にした相対位置または比較値。
     */
    top: number;

    /**
     * 表示領域または列の幅。
     */
    width: number;

    /**
     * 表示領域または行の高さ。
     */
    height: number;
}

/**
 * 共有プロトコルで送受信するメッセージまたは要求のデータ形状。
 */
export type HostToWebviewMessage =
    | {

        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'init';
        /**
         * 共有プロトコルで受け渡すtextの文字列。
         */
        text: string;

        /**
         * 共有プロトコルのversionを表す数値。
         */
        version: number;

        /**
         * 共有プロトコルで受け渡すuriの文字列。
         */
        uri: string;

        /**
         * 共有プロトコルへ渡す設定または境界値。
         */
        settings: WebviewSettings;
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'editAck';
        /**
         * 共有プロトコルで受け渡すclient・idの文字列。
         */
        clientId: string;
        /**
         * 共有プロトコルで受け渡すop・idの文字列。
         */
        opId: string;
        /**
         * 共有プロトコルのbase・versionを表す数値。
         */
        baseVersion: number;
        /**
         * 共有プロトコルのversionを表す数値。
         */
        version: number;
        /**
         * 本文へ適用する変更範囲の一覧。
         */
        changes: TextChange[]
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'externalChanges';
        /**
         * 共有プロトコルのbase・versionを表す数値。
         */
        baseVersion: number;
        /**
         * 共有プロトコルのversionを表す数値。
         */
        version: number;
        /**
         * 本文へ適用する変更範囲の一覧。
         */
        changes: TextChange[];
        /**
         * 共有プロトコルで受け渡すclient・idの文字列。
         */
        clientId?: string;
        /**
         * 共有プロトコルで受け渡すop・idの文字列。
         */
        opId?: string
    }
    | {

        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'resyncRequired';

        /**
         * 共有プロトコルで受け渡すclient・idの文字列。
         */
        clientId: string;

        /**
         * 共有プロトコルで受け渡すop・idの文字列。
         */
        opId?: string;

        /**
         * 共有プロトコルのoperation・appliedを制御する同期設定。
         */
        operationApplied?: boolean;
        /**
         * 共有プロトコルで受け渡すtextの文字列。
         */
        text: string;

        /**
         * 共有プロトコルのversionを表す数値。
         */
        version: number;

        /**
         * 共有プロトコルで受け渡すreasonの文字列。
         */
        reason: string;
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'settingsChanged';
        /**
         * 共有プロトコルへ渡す設定または境界値。
         */
        settings: WebviewSettings
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'imagesSaved';
        /**
         * 共有プロトコルで受け渡すrequest・idの文字列。
         */
        requestId: string;
        /**
         * 共有プロトコルで受け渡すpathsの文字列。
         */
        paths: string[]
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'localResourcesChecked';
        /**
         * 共有プロトコルで受け渡すrequest・idの文字列。
         */
        requestId: string;
        /**
         * 共有プロトコルのdiagnosticsに関する状態または設定。
         */
        diagnostics: Diagnostic[]
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'operationFailed';
        /**
         * 共有プロトコルで受け渡すrequest・idの文字列。
         */
        requestId?: string;
        /**
         * 共有プロトコルで受け渡すmessageの文字列。
         */
        message: string
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'pdfExported';
        /**
         * 共有プロトコルで受け渡すrequest・idの文字列。
         */
        requestId: string;
        /**
         * 共有プロトコルで受け渡すpathの文字列。
         */
        path: string
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'htmlExported';
        /**
         * 共有プロトコルで受け渡すrequest・idの文字列。
         */
        requestId: string;
        /**
         * 共有プロトコルで受け渡すpathsの文字列。
         */
        paths: string[]
    }
    | {

        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'renderHtmlDocuments';

        /**
         * 共有プロトコルで受け渡すrequest・idの文字列。
         */
        requestId: string;

        /**
         * 文書URIと開いている文書オブジェクトの対応表。
         */
        documents: Array<{
            /**
             * 共有プロトコルで受け渡すidの文字列。
             */
            id: string;
            /**
             * 共有プロトコルで受け渡すmarkdownの文字列。
             */
            markdown: string
        }>;
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'pdfPreviewReady';
        /**
         * 共有プロトコルで受け渡すrequest・idの文字列。
         */
        requestId: string;
        /**
         * 共有プロトコルで受け渡すpdf・base64の文字列。
         */
        pdfBase64: string
    }
    | {

        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'mermaidRendered';

        /**
         * 共有プロトコルで受け渡すrequest・idの文字列。
         */
        requestId: string;

        /**
         * 共有プロトコルで受け渡すsvgの文字列。
         */
        svg?: string;

        /**
         * 共有プロトコルで受け渡すpng・base64の文字列。
         */
        pngBase64?: string;

        /**
         * 図中の文字・リンク操作領域の一覧。
         */
        interactions?: MermaidInteraction[];

        /**
         * 共有プロトコルで受け渡すaria・labelの文字列。
         */
        ariaLabel?: string;

        /**
         * 共有プロトコルで受け渡すerrorの文字列。
         */
        error?: string;

        /**
         * 共有プロトコルのrenderer・unavailableを制御する同期設定。
         */
        rendererUnavailable?: boolean;
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'hostCommand';
        /**
         * 共有プロトコルのcommandに関する状態または設定。
         */
        command: 'insertImage' | 'exportPdf' | 'exportHtml' | 'undo' | 'redo'
    };

/**
 * 共有プロトコルで送受信するメッセージまたは要求のデータ形状。
 */
export type WebviewToHostMessage =
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'ready';
        /**
         * 共有プロトコルで受け渡すclient・idの文字列。
         */
        clientId: string
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'initialized';
        /**
         * 共有プロトコルで受け渡すclient・idの文字列。
         */
        clientId: string
    }
    | {

        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'startupReady';

        /**
         * 共有プロトコルで受け渡すclient・idの文字列。
         */
        clientId: string;

        /**
         * 共有プロトコルの位置・寸法・件数・時間を表す数値。
         */
        markdownLength: number;

        /**
         * 共有プロトコルで受け渡すmetricsの文字列。
         */
        metrics?: Record<string, number>;
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'startupMermaidReady';
        /**
         * 共有プロトコルで受け渡すclient・idの文字列。
         */
        clientId: string
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'localChanges';
        /**
         * 共有プロトコルで受け渡すclient・idの文字列。
         */
        clientId: string;
        /**
         * 共有プロトコルで受け渡すop・idの文字列。
         */
        opId: string;
        /**
         * 共有プロトコルのbase・versionを表す数値。
         */
        baseVersion: number;
        /**
         * 本文へ適用する変更範囲の一覧。
         */
        changes: TextChange[]
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'historyCommand';
        /**
         * 共有プロトコルで受け渡すclient・idの文字列。
         */
        clientId: string;
        /**
         * 共有プロトコルのcommandに関する状態または設定。
         */
        command: 'undo' | 'redo'
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'saveImages';
        /**
         * 共有プロトコルで受け渡すrequest・idの文字列。
         */
        requestId: string;
        /**
         * 共有プロトコルで扱うimagesの一覧。
         */
        images: ImagePayload[];
        /**
         * 共有プロトコルで受け渡すimage・directoryの文字列。
         */
        imageDirectory: string
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'pickImage';
        /**
         * 共有プロトコルで受け渡すrequest・idの文字列。
         */
        requestId: string;
        /**
         * 共有プロトコルで受け渡すimage・directoryの文字列。
         */
        imageDirectory: string
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'checkLocalResources';
        /**
         * 共有プロトコルで受け渡すrequest・idの文字列。
         */
        requestId: string;
        /**
         * 共有プロトコルで受け渡すmarkdownの文字列。
         */
        markdown: string
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'setEditorTheme';
        /**
         * 描画や表示に適用する配色テーマ。
         */
        theme: EditorTheme
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'setImageDirectory';
        /**
         * 共有プロトコルで受け渡すdirectoryの文字列。
         */
        directory: string
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'setFontFamilies';
        /**
         * 共有プロトコルで受け渡すeditor・font・familyの文字列。
         */
        editorFontFamily: string;
        /**
         * 共有プロトコルで受け渡すpreview・font・familyの文字列。
         */
        previewFontFamily: string
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'setViewMode';
        /**
         * 共有プロトコルのview・modeに関する状態または設定。
         */
        viewMode: ViewMode
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'setOutlineVisible';
        /**
         * 共有プロトコルのvisibleを有効または表示する設定。
         */
        visible: boolean
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'setScrollSyncEnabled';
        /**
         * 共有プロトコルのenabledを有効または表示する設定。
         */
        enabled: boolean
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'setPreviewImageResizeControlsVisible';
        /**
         * 共有プロトコルのvisibleを有効または表示する設定。
         */
        visible: boolean
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'setPdfOptions';
        /**
         * 呼び出し側が指定する処理設定。
         */
        options: PdfOptions
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'setHtmlOptions';
        /**
         * 呼び出し側が指定する処理設定。
         */
        options: HtmlExportSettings
    }
    | {

        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'exportPdf';

        /**
         * 共有プロトコルで受け渡すrequest・idの文字列。
         */
        requestId: string;

        /**
         * 共有プロトコルで受け渡すhtmlの文字列。
         */
        html: string;

        /**
         * 共有プロトコルで受け渡すcssの文字列。
         */
        css: string;

        /**
         * 呼び出し側が指定する処理設定。
         */
        options: PdfOptions;
    }
    | {

        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'exportHtml';

        /**
         * 共有プロトコルで受け渡すrequest・idの文字列。
         */
        requestId: string;

        /**
         * 共有プロトコルで受け渡すmarkdownの文字列。
         */
        markdown: string;

        /**
         * 共有プロトコルで受け渡すhtmlの文字列。
         */
        html: string;

        /**
         * 共有プロトコルで受け渡すcssの文字列。
         */
        css: string;

        /**
         * 呼び出し側が指定する処理設定。
         */
        options: HtmlExportOptions;
    }
    | {

        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'htmlDocumentsRendered';

        /**
         * 共有プロトコルで受け渡すrequest・idの文字列。
         */
        requestId: string;

        /**
         * 文書URIと開いている文書オブジェクトの対応表。
         */
        documents: Array<{
            /**
             * 共有プロトコルで受け渡すidの文字列。
             */
            id: string;
            /**
             * 共有プロトコルで受け渡すhtmlの文字列。
             */
            html: string
        }>;
    }
    | {

        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'renderPdfPreview';

        /**
         * 共有プロトコルで受け渡すrequest・idの文字列。
         */
        requestId: string;

        /**
         * 共有プロトコルで受け渡すhtmlの文字列。
         */
        html: string;

        /**
         * 共有プロトコルで受け渡すcssの文字列。
         */
        css: string;

        /**
         * 呼び出し側が指定する処理設定。
         */
        options: PdfOptions;
    }
    | {

        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'renderMermaid';

        /**
         * 共有プロトコルで受け渡すrequest・idの文字列。
         */
        requestId: string;

        /**
         * 共有プロトコルで受け渡すsourceの文字列。
         */
        source: string;

        /**
         * 描画や表示に適用する配色テーマ。
         */
        theme: 'default' | 'dark' | 'neutral';
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'cancelMermaidRender';
        /**
         * 共有プロトコルで受け渡すrequest・idの文字列。
         */
        requestId: string
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'openSource'
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'openResource';
        /**
         * 共有プロトコルで受け渡すhrefの文字列。
         */
        href: string
    }
    | {
        /**
         * 共有プロトコルで対象や分岐を識別する値の型。
         */
        type: 'requestResync';
        /**
         * 共有プロトコルで受け渡すclient・idの文字列。
         */
        clientId: string;
        /**
         * 共有プロトコルで受け渡すop・idの文字列。
         */
        opId?: string;
        /**
         * 共有プロトコルのversionを表す数値。
         */
        version: number;
        /**
         * 共有プロトコルで受け渡すreasonの文字列。
         */
        reason: string
    };

/**
 * 共有プロトコルで共有するデータ形状を表すインターフェース。
 */
export interface VsCodeApi<State = unknown> {
    /**
     * 共有プロトコルの変更または要求をHost・Webview間へ通知する。
     * @param message - HostとWebviewの間で受け渡すメッセージ。
     * @returns 共有プロトコルのpost・messageが生成する結果。
     */
    postMessage(message: WebviewToHostMessage): void;
    /**
     * 共有プロトコルから必要な値またはリソースを取得する。
     * @returns 共有プロトコルのget・stateが生成する結果。
     */
    getState(): State | undefined;
    /**
     * 共有プロトコルの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param newState - 共有プロトコルへ渡す入力。
     * @returns 副作用を完了し、値は返さない。
     */
    setState(newState: State): void;
}

/**
 * @file protocol.ts
 * 実行境界: Extension HostとWebviewの共有層。
 * 責務: 両実行境界で共有する値、プロトコル、変換を扱う。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: 呼び出し元から渡された値を変換し、外部状態を直接変更しない。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import type { Diagnostic } from './markdown';
import { DEFAULT_FONT_FAMILY_STACK, type FontFamilySettings } from './fontFamily';
import type { SupportedLanguage } from './messages';

/**
 * 「EditorMode」として扱う値の型を定義します。
 */
export type EditorMode = 'split' | 'preview';
/**
 * 「ViewMode」として扱う値の型を定義します。
 */
export type ViewMode = 'both' | 'text' | 'preview';
/**
 * 「EditorTheme」として扱う値の型を定義します。
 */
export type EditorTheme = 'light' | 'dark';

/** PDFで選択できる用紙。A判はPlaywright標準、B4/B5はJIS寸法で明示指定する。 */
export const PDF_PAPER_FORMATS = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B4', 'B5'] as const;
/**
 * 「PdfPaperFormat」として扱う値の型を定義します。
 */
export type PdfPaperFormat = typeof PDF_PAPER_FORMATS[number];

/**
 * 「ImagePayload」が満たすデータ契約を定義します。
 */
export interface ImagePayload {

    /**
     * 「name」は、対象の識別や処理分岐に使用する値を保持します。
     */
    name?: string;

    /**
     * 「mime」は、対象の内容または識別子を表す文字列です。
     */
    mime: string;

    /**
     * 「base64」は、対象の内容または識別子を表す文字列です。
     */
    base64: string;
}

/**
 * 「PdfOptions」が満たすデータ契約を定義します。
 */
export interface PdfOptions {
    /**
     * 用紙サイズ。Letterは採用せず、日本で一般的なA判・B判を使用する。
     */
    format: PdfPaperFormat;

    /**
     * 「orientation」は、Host/Webview間で共有するメッセージまたは設定状態を保持します。
     */
    orientation: 'portrait' | 'landscape';

    /**
     * 「margins」は、Host/Webview間で共有するメッセージまたは設定状態を保持します。
     */
    margins: {
    /**
     * 「top」は、位置・サイズ・件数などを表す数値です。
     */
    top: number;
    /**
     * 「right」は、位置・サイズ・件数などを表す数値です。
     */
    right: number;
    /**
     * 「bottom」は、位置・サイズ・件数などを表す数値です。
     */
    bottom: number;
    /**
     * 「left」は、位置・サイズ・件数などを表す数値です。
     */
    left: number };

    /**
     * 「header」は、対象の内容または識別子を表す文字列です。
     */
    header: string;

    /**
     * 「footer」は、対象の内容または識別子を表す文字列です。
     */
    footer: string;
    /**
     * 印刷本文へ適用するCSSフォントファミリー。未指定時は標準フォントへフォールバックする。
     */
    fontFamily?: string;
    /**
     * 本文のフォントサイズ。単位はポイントで、6〜48ptへ正規化される。
     */
    bodyFontSize?: number;
    /**
     * H1〜H6のフォントサイズ。単位はポイントで、各値は6〜72ptへ正規化される。
     */
    headingFontSizes?: {
    /**
     * 「h1」は、位置・サイズ・件数などを表す数値です。
     */
    h1: number;
    /**
     * 「h2」は、位置・サイズ・件数などを表す数値です。
     */
    h2: number;
    /**
     * 「h3」は、位置・サイズ・件数などを表す数値です。
     */
    h3: number;
    /**
     * 「h4」は、位置・サイズ・件数などを表す数値です。
     */
    h4: number;
    /**
     * 「h5」は、位置・サイズ・件数などを表す数値です。
     */
    h5: number;
    /**
     * 「h6」は、位置・サイズ・件数などを表す数値です。
     */
    h6: number };
    /**
     * pre要素とcode要素のフォントサイズ。単位はポイントで、6〜36ptへ正規化される。
     */
    codeFontSize?: number;
    /**
     * 本文の行高。単位を持たない倍率で、0.8〜3へ正規化される。
     */
    lineHeight?: number;
    /**
     * 段落の下側余白。単位はポイントで、0〜48ptへ正規化される。
     */
    paragraphSpacing?: number;

    /**
     * 「saveWithoutDialog」は、処理条件または状態を表す真偽値です。
     */
    saveWithoutDialog: boolean;
}

/**
 * すべての印刷用タイポグラフィ設定が補完・範囲検証済みになったPDF設定。
 * Webviewの入力値や過去バージョンの保存値をそのまま使わず、PDF生成前にこの型へ変換する。
 */
export type NormalizedPdfOptions = Omit<PdfOptions, 'fontFamily' | 'bodyFontSize' | 'headingFontSizes' | 'codeFontSize' | 'lineHeight' | 'paragraphSpacing'> & {

    /**
     * 「fontFamily」は、表示テーマまたはスタイル設定を保持します。
     */
    fontFamily: string;

    /**
     * 「bodyFontSize」は、画面または通知へ表示する文言を保持します。
     */
    bodyFontSize: number;

    /**
     * 「headingFontSizes」は、表示テーマまたはスタイル設定を保持します。
     */
    headingFontSizes: {
    /**
     * 「h1」は、位置・サイズ・件数などを表す数値です。
     */
    h1: number;
    /**
     * 「h2」は、位置・サイズ・件数などを表す数値です。
     */
    h2: number;
    /**
     * 「h3」は、位置・サイズ・件数などを表す数値です。
     */
    h3: number;
    /**
     * 「h4」は、位置・サイズ・件数などを表す数値です。
     */
    h4: number;
    /**
     * 「h5」は、位置・サイズ・件数などを表す数値です。
     */
    h5: number;
    /**
     * 「h6」は、位置・サイズ・件数などを表す数値です。
     */
    h6: number };

    /**
     * 「codeFontSize」は、表示テーマまたはスタイル設定を保持します。
     */
    codeFontSize: number;

    /**
     * 「lineHeight」は、対象の位置、サイズ、件数、または範囲を保持します。
     */
    lineHeight: number;

    /**
     * 「paragraphSpacing」は、位置・サイズ・件数などを表す数値です。
     */
    paragraphSpacing: number;
};

/**
 * 「HtmlExportOptions」が満たすデータ契約を定義します。
 */
export interface HtmlExportOptions {

    /**
     * 「embedImages」は、処理条件または状態を表す真偽値です。
     */
    embedImages: boolean;

    /**
     * 「convertLinkedMarkdown」は、処理条件または状態を表す真偽値です。
     */
    convertLinkedMarkdown: boolean;

    /**
     * 「saveWithoutDialog」は、処理条件または状態を表す真偽値です。
     */
    saveWithoutDialog: boolean;
}

/**
 * HTML出力で文書をまたいで共有するグローバル設定。
 */
export type HtmlExportSettings = Pick<HtmlExportOptions, 'embedImages' | 'convertLinkedMarkdown' | 'saveWithoutDialog'>;

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
    /**
     * 数値化できない値を標準値へ戻し、指定範囲に収める。
     * @param input 「input」は、「numberInRange」がHost/Webview共有プロトコルの処理対象を特定する入力です。
     * @param fallback 「fallback」は、「numberInRange」がHost/Webview共有プロトコルの処理対象を特定する入力です。
     * @param min 「min」は、「numberInRange」がHost/Webview共有プロトコルの処理対象を特定する入力です。
     * @param max 「max」は、「numberInRange」がHost/Webview共有プロトコルの処理対象を特定する入力です。
     * @returns 計算結果の数値です。
     */
    const numberInRange = /**
 * 「numberInRange」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param input 「input」は、「numberInRange」がHost/Webview共有プロトコルで処理する対象を特定する入力です。
 * @param fallback 「fallback」は、「numberInRange」がHost/Webview共有プロトコルで処理する対象を特定する入力です。
 * @param min 「min」は、「numberInRange」がHost/Webview共有プロトコルで処理する対象を特定する入力です。
 * @param max 「max」は、「numberInRange」がHost/Webview共有プロトコルで処理する対象を特定する入力です。
 * @returns 「numberInRange」がHost/Webview共有プロトコルの入力を処理して得た固有の結果を返します。
 */ (input: unknown, fallback: number, min: number, max: number): number => {
        const parsed = typeof input === 'number' ? input : Number(input);
        return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
    };
    /**
     * 余白のように整数で扱う設定を、範囲検証後に丸める。
     * @param input 「input」は、「integerInRange」がHost/Webview共有プロトコルの処理対象を特定する入力です。
     * @param fallback 「fallback」は、「integerInRange」がHost/Webview共有プロトコルの処理対象を特定する入力です。
     * @param min 「min」は、「integerInRange」がHost/Webview共有プロトコルの処理対象を特定する入力です。
     * @param max 「max」は、「integerInRange」がHost/Webview共有プロトコルの処理対象を特定する入力です。
     * @returns 計算結果の数値です。
     */
    const integerInRange = /**
 * 「integerInRange」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param input 「input」は、「integerInRange」がHost/Webview共有プロトコルで処理する対象を特定する入力です。
 * @param fallback 「fallback」は、「integerInRange」がHost/Webview共有プロトコルで処理する対象を特定する入力です。
 * @param min 「min」は、「integerInRange」がHost/Webview共有プロトコルで処理する対象を特定する入力です。
 * @param max 「max」は、「integerInRange」がHost/Webview共有プロトコルで処理する対象を特定する入力です。
 * @returns 「integerInRange」がHost/Webview共有プロトコルの入力を処理して得た固有の結果を返します。
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

/** HTML出力UIとExplorer起点の出力で共有するグローバル設定の初期値。 */
export const DEFAULT_HTML_EXPORT_SETTINGS: HtmlExportSettings = {
    embedImages: false,
    convertLinkedMarkdown: false,
    saveWithoutDialog: true
};

/** HTML出力要求へ渡す初期値。 */
export const DEFAULT_HTML_EXPORT_OPTIONS: HtmlExportOptions = {
    ...DEFAULT_HTML_EXPORT_SETTINGS
};

/**
 * 永続化値やWebviewメッセージをHTML出力のグローバル設定へ正規化する。
 * @param value 「normalizeHtmlExportSettings」で検証・変換する入力値です。
 * @returns 「normalizeHtmlExportSettings」が読み取りまたは正規化した結果を返します。
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
 * グローバルHTML設定を出力要求へ反映する。
 * @param current 「current」は、「mergeHtmlExportOptions」がHost/Webview共有プロトコルの処理対象を特定する入力です。
 * @param next 「next」は、「mergeHtmlExportOptions」がHost/Webview共有プロトコルの処理対象を特定する入力です。
 * @returns 「mergeHtmlExportOptions」が生成または整形したHost/Webview共有プロトコルの文字列を返します。
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
 * 「WebviewSettings」が満たすデータ契約を定義します。
 */
export interface WebviewSettings extends FontFamilySettings {

    /**
     * 「language」は、Host/Webview間で共有するメッセージまたは設定状態を保持します。
     */
    language: SupportedLanguage;

    /**
     * 「imageDirectory」は、対象の内容または識別子を表す文字列です。
     */
    imageDirectory: string;

    /**
     * 「maxPasteSizeMb」は、件数・容量・上限などの数値を保持します。
     */
    maxPasteSizeMb: number;

    /**
     * 「remoteImagesEnabled」は、画面の表示モードまたは現在のUI状態を示します。
     */
    remoteImagesEnabled: boolean;

    /**
     * 「mermaidTheme」は、表示テーマまたはスタイル設定を保持します。
     */
    mermaidTheme: 'auto' | 'default' | 'dark' | 'neutral';
    /**
     * MermaidをWebviewとは別のブラウザプロセスで描画できるか。
     */
    mermaidHostRendering?: boolean;

    /**
     * 「editorTheme」は、表示テーマまたはスタイル設定を保持します。
     */
    editorTheme?: EditorTheme;

    /**
     * 「viewMode」は、Host/Webview間で共有するメッセージまたは設定状態を保持します。
     */
    viewMode?: ViewMode;
    /**
     * すべての文書で共有するアウトラインの表示状態。
     */
    outlineVisible?: boolean;
    /**
     * 分割表示でテキストとプレビューのスクロール位置を相互に同期するか。
     */
    scrollSyncEnabled?: boolean;
    /**
     * プレビュー画像のリサイズ・配置操作UIを表示するか。未設定時は表示する。
     */
    previewImageResizeControlsVisible?: boolean;
    /**
     * PDF印刷設定。文書をまたいで共有するグローバル設定。
     */
    pdfOptions?: PdfOptions;
    /**
     * HTML出力設定。文書をまたいで共有するグローバル設定。
     */
    htmlOptions: HtmlExportSettings;

    /**
     * 「workspaceTrusted」は、処理条件または状態を表す真偽値です。
     */
    workspaceTrusted: boolean;
    /**
     * 開発用の実 VS Code 起動計測を有効にする。
     */
    startupProbe?: boolean;
}

/**
 * WebviewとExtension Host間の本文差分。
 * `rangeOffset` / `rangeLength` / `text` はすべてLF正規化済み本文を基準とし、
 * VS Code文書の物理EOL（LF/CRLF）はExtension Host境界でのみ変換する。
 */
export interface TextChange {

    /**
     * 「rangeOffset」は、本文または選択範囲の位置・長さを保持します。
     */
    rangeOffset: number;

    /**
     * 「rangeLength」は、本文または選択範囲の位置・長さを保持します。
     */
    rangeLength: number;

    /**
     * 「text」は、画面または通知へ表示する文言を保持します。
     */
    text: string;
}

/**
 * 「MermaidInteraction」が満たすデータ契約を定義します。
 */
export interface MermaidInteraction {

    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'text' | 'link';

    /**
     * 「text」は、画面または通知へ表示する文言を保持します。
     */
    text: string;

    /**
     * 「href」は、対象の内容または識別子を表す文字列です。
     */
    href?: string;

    /**
     * 「left」は、位置・サイズ・件数などを表す数値です。
     */
    left: number;

    /**
     * 「top」は、位置・サイズ・件数などを表す数値です。
     */
    top: number;

    /**
     * 「width」は、対象の位置、サイズ、件数、または範囲を保持します。
     */
    width: number;

    /**
     * 「height」は、対象の位置、サイズ、件数、または範囲を保持します。
     */
    height: number;
}

/**
 * 「HostToWebviewMessage」として扱う値の型を定義します。
 */
export type HostToWebviewMessage =
    | {

        /**
         * 「type」は、対象の識別や処理分岐に使用する値を保持します。
         */
        type: 'init';
        /**
         * LF正規化済み本文。
         */
        text: string;

        /**
         * 「version」は、位置・サイズ・件数などを表す数値です。
         */
        version: number;

        /**
         * 「uri」は、対象の内容または識別子を表す文字列です。
         */
        uri: string;

        /**
         * 「settings」は、利用側が共有する設定または現在状態を保持します。
         */
        settings: WebviewSettings;
    }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'editAck';
    /**
     * 「clientId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    clientId: string;
    /**
     * 「opId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    opId: string;
    /**
     * 「baseVersion」は、位置・サイズ・件数などを表す数値です。
     */
    baseVersion: number;
    /**
     * 「version」は、位置・サイズ・件数などを表す数値です。
     */
    version: number;
    /**
     * 「changes」は、関連する複数の対象または識別子を保持します。
     */
    changes: TextChange[] }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'externalChanges';
    /**
     * 「baseVersion」は、位置・サイズ・件数などを表す数値です。
     */
    baseVersion: number;
    /**
     * 「version」は、位置・サイズ・件数などを表す数値です。
     */
    version: number;
    /**
     * 「changes」は、関連する複数の対象または識別子を保持します。
     */
    changes: TextChange[];
    /**
     * 「clientId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    clientId?: string;
    /**
     * 「opId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    opId?: string }
    | {

        /**
         * 「type」は、対象の識別や処理分岐に使用する値を保持します。
         */
        type: 'resyncRequired';

        /**
         * 「clientId」は、対象の識別や処理分岐に使用する値を保持します。
         */
        clientId: string;

        /**
         * 「opId」は、対象の識別や処理分岐に使用する値を保持します。
         */
        opId?: string;

        /**
         * 「operationApplied」は、表示領域のサイズまたは倍率を保持します。
         */
        operationApplied?: boolean;
        /**
         * LF正規化済み本文。
         */
        text: string;

        /**
         * 「version」は、位置・サイズ・件数などを表す数値です。
         */
        version: number;

        /**
         * 「reason」は、対象の内容または識別子を表す文字列です。
         */
        reason: string;
    }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'settingsChanged';
    /**
     * 「settings」は、利用側が共有する設定または現在状態を保持します。
     */
    settings: WebviewSettings }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'imagesSaved';
    /**
     * 「requestId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    requestId: string;
    /**
     * 「paths」は、読み込みまたは出力対象を示すパス・URL・内容を保持します。
     */
    paths: string[] }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'localResourcesChecked';
    /**
     * 「requestId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    requestId: string;
    /**
     * 「diagnostics」は、関連する複数の対象または識別子を保持します。
     */
    diagnostics: Diagnostic[] }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'operationFailed';
    /**
     * 「requestId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    requestId?: string;
    /**
     * 「message」は、画面または通知へ表示する文言を保持します。
     */
    message: string }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'pdfExported';
    /**
     * 「requestId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    requestId: string;
    /**
     * 「path」は、読み込みまたは出力対象を示すパス・URL・内容を保持します。
     */
    path: string }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'htmlExported';
    /**
     * 「requestId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    requestId: string;
    /**
     * 「paths」は、読み込みまたは出力対象を示すパス・URL・内容を保持します。
     */
    paths: string[] }
    | {

        /**
         * 「type」は、対象の識別や処理分岐に使用する値を保持します。
         */
        type: 'renderHtmlDocuments';

        /**
         * 「requestId」は、対象の識別や処理分岐に使用する値を保持します。
         */
        requestId: string;

        /**
         * 「documents」は、Host/Webview間で共有するメッセージまたは設定状態を保持します。
         */
        documents: Array<{
        /**
         * 「id」は、対象の識別や処理分岐に使用する値を保持します。
         */
        id: string;
        /**
         * 「markdown」は、解析・編集・変換の対象となる本文またはデータを保持します。
         */
        markdown: string }>;
    }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'pdfPreviewReady';
    /**
     * 「requestId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    requestId: string;
    /**
     * 「pdfBase64」は、対象の内容または識別子を表す文字列です。
     */
    pdfBase64: string }
    | {

        /**
         * 「type」は、対象の識別や処理分岐に使用する値を保持します。
         */
        type: 'mermaidRendered';

        /**
         * 「requestId」は、対象の識別や処理分岐に使用する値を保持します。
         */
        requestId: string;

        /**
         * 「svg」は、対象の内容または識別子を表す文字列です。
         */
        svg?: string;

        /**
         * 「pngBase64」は、対象の内容または識別子を表す文字列です。
         */
        pngBase64?: string;

        /**
         * 「interactions」は、関連する複数の対象または識別子を保持します。
         */
        interactions?: MermaidInteraction[];

        /**
         * 「ariaLabel」は、画面または通知へ表示する文言を保持します。
         */
        ariaLabel?: string;

        /**
         * 「error」は、対象の内容または識別子を表す文字列です。
         */
        error?: string;

        /**
         * 「rendererUnavailable」は、処理条件または状態を表す真偽値です。
         */
        rendererUnavailable?: boolean;
    }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'hostCommand';
    /**
     * 「command」は、Host/Webview間で共有するメッセージまたは設定状態を保持します。
     */
    command: 'insertImage' | 'exportPdf' | 'exportHtml' | 'undo' | 'redo' };

/**
 * 「WebviewToHostMessage」として扱う値の型を定義します。
 */
export type WebviewToHostMessage =
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'ready';
    /**
     * 「clientId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    clientId: string }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'initialized';
    /**
     * 「clientId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    clientId: string }
    | {

        /**
         * 「type」は、対象の識別や処理分岐に使用する値を保持します。
         */
        type: 'startupReady';

        /**
         * 「clientId」は、対象の識別や処理分岐に使用する値を保持します。
         */
        clientId: string;

        /**
         * 「markdownLength」は、本文または選択範囲の位置・長さを保持します。
         */
        markdownLength: number;

        /**
         * 「metrics」は、関連する複数の対象または識別子を保持します。
         */
        metrics?: Record<string, number>;
    }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'startupMermaidReady';
    /**
     * 「clientId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    clientId: string }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'localChanges';
    /**
     * 「clientId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    clientId: string;
    /**
     * 「opId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    opId: string;
    /**
     * 「baseVersion」は、位置・サイズ・件数などを表す数値です。
     */
    baseVersion: number;
    /**
     * 「changes」は、関連する複数の対象または識別子を保持します。
     */
    changes: TextChange[] }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'historyCommand';
    /**
     * 「clientId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    clientId: string;
    /**
     * 「command」は、Host/Webview間で共有するメッセージまたは設定状態を保持します。
     */
    command: 'undo' | 'redo' }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'saveImages';
    /**
     * 「requestId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    requestId: string;
    /**
     * 「images」は、関連する複数の対象または識別子を保持します。
     */
    images: ImagePayload[];
    /**
     * 「imageDirectory」は、対象の内容または識別子を表す文字列です。
     */
    imageDirectory: string }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'pickImage';
    /**
     * 「requestId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    requestId: string;
    /**
     * 「imageDirectory」は、対象の内容または識別子を表す文字列です。
     */
    imageDirectory: string }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'checkLocalResources';
    /**
     * 「requestId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    requestId: string;
    /**
     * 「markdown」は、解析・編集・変換の対象となる本文またはデータを保持します。
     */
    markdown: string }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'setEditorTheme';
    /**
     * 「theme」は、表示テーマまたはスタイル設定を保持します。
     */
    theme: EditorTheme }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'setImageDirectory';
    /**
     * 「directory」は、対象の内容または識別子を表す文字列です。
     */
    directory: string }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'setFontFamilies';
    /**
     * 「editorFontFamily」は、表示テーマまたはスタイル設定を保持します。
     */
    editorFontFamily: string;
    /**
     * 「previewFontFamily」は、表示テーマまたはスタイル設定を保持します。
     */
    previewFontFamily: string }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'setViewMode';
    /**
     * 「viewMode」は、Host/Webview間で共有するメッセージまたは設定状態を保持します。
     */
    viewMode: ViewMode }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'setOutlineVisible';
    /**
     * 「visible」は、画面の表示モードまたは現在のUI状態を示します。
     */
    visible: boolean }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'setScrollSyncEnabled';
    /**
     * 「enabled」は、画面の表示モードまたは現在のUI状態を示します。
     */
    enabled: boolean }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'setPreviewImageResizeControlsVisible';
    /**
     * 「visible」は、画面の表示モードまたは現在のUI状態を示します。
     */
    visible: boolean }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'setPdfOptions';
    /**
     * 「options」は、利用側が共有する設定または現在状態を保持します。
     */
    options: PdfOptions }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'setHtmlOptions';
    /**
     * 「options」は、利用側が共有する設定または現在状態を保持します。
     */
    options: HtmlExportSettings }
    | {

        /**
         * 「type」は、対象の識別や処理分岐に使用する値を保持します。
         */
        type: 'exportPdf';

        /**
         * 「requestId」は、対象の識別や処理分岐に使用する値を保持します。
         */
        requestId: string;

        /**
         * 「html」は、解析・編集・変換の対象となる本文またはデータを保持します。
         */
        html: string;

        /**
         * 「css」は、対象の内容または識別子を表す文字列です。
         */
        css: string;

        /**
         * 「options」は、利用側が共有する設定または現在状態を保持します。
         */
        options: PdfOptions;
    }
    | {

        /**
         * 「type」は、対象の識別や処理分岐に使用する値を保持します。
         */
        type: 'exportHtml';

        /**
         * 「requestId」は、対象の識別や処理分岐に使用する値を保持します。
         */
        requestId: string;

        /**
         * 「markdown」は、解析・編集・変換の対象となる本文またはデータを保持します。
         */
        markdown: string;

        /**
         * 「html」は、解析・編集・変換の対象となる本文またはデータを保持します。
         */
        html: string;

        /**
         * 「css」は、対象の内容または識別子を表す文字列です。
         */
        css: string;

        /**
         * 「options」は、利用側が共有する設定または現在状態を保持します。
         */
        options: HtmlExportOptions;
    }
    | {

        /**
         * 「type」は、対象の識別や処理分岐に使用する値を保持します。
         */
        type: 'htmlDocumentsRendered';

        /**
         * 「requestId」は、対象の識別や処理分岐に使用する値を保持します。
         */
        requestId: string;

        /**
         * 「documents」は、Host/Webview間で共有するメッセージまたは設定状態を保持します。
         */
        documents: Array<{
        /**
         * 「id」は、対象の識別や処理分岐に使用する値を保持します。
         */
        id: string;
        /**
         * 「html」は、解析・編集・変換の対象となる本文またはデータを保持します。
         */
        html: string }>;
    }
    | {

        /**
         * 「type」は、対象の識別や処理分岐に使用する値を保持します。
         */
        type: 'renderPdfPreview';

        /**
         * 「requestId」は、対象の識別や処理分岐に使用する値を保持します。
         */
        requestId: string;

        /**
         * 「html」は、解析・編集・変換の対象となる本文またはデータを保持します。
         */
        html: string;

        /**
         * 「css」は、対象の内容または識別子を表す文字列です。
         */
        css: string;

        /**
         * 「options」は、利用側が共有する設定または現在状態を保持します。
         */
        options: PdfOptions;
    }
    | {

        /**
         * 「type」は、対象の識別や処理分岐に使用する値を保持します。
         */
        type: 'renderMermaid';

        /**
         * 「requestId」は、対象の識別や処理分岐に使用する値を保持します。
         */
        requestId: string;

        /**
         * 「source」は、読み込みまたは出力対象を示すパス・URL・内容を保持します。
         */
        source: string;

        /**
         * 「theme」は、表示テーマまたはスタイル設定を保持します。
         */
        theme: 'default' | 'dark' | 'neutral';
    }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'cancelMermaidRender';
    /**
     * 「requestId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    requestId: string }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'openSource' }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'openResource';
    /**
     * 「href」は、対象の内容または識別子を表す文字列です。
     */
    href: string }
    | {
    /**
     * 「type」は、対象の識別や処理分岐に使用する値を保持します。
     */
    type: 'requestResync';
    /**
     * 「clientId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    clientId: string;
    /**
     * 「opId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    opId?: string;
    /**
     * 「version」は、位置・サイズ・件数などを表す数値です。
     */
    version: number;
    /**
     * 「reason」は、対象の内容または識別子を表す文字列です。
     */
    reason: string };

/**
 * 「VsCodeApi」が満たすデータ契約を定義します。
 */
export interface VsCodeApi<State = unknown> {
    /**
     * HostとWebviewの間へメッセージを送信する呼び出し契約です。
     * @param message 処理対象のメッセージです。
     * @returns 状態更新または副作用を実行し、値は返しません。
     */
    postMessage(message: WebviewToHostMessage): void;
    /**
     * Hostから保存済み状態を読み取る呼び出し契約です。
     * @returns 処理が対象を取得できない場合はundefinedを返します。
     */
    getState(): State | undefined;
    /**
     * Hostへ現在状態を保存する呼び出し契約です。
     * @param newState 処理対象の状態です。
     * @returns 状態更新または副作用を実行し、値は返しません。
     */
    setState(newState: State): void;
}

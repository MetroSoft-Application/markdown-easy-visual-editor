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
 * 印刷プレビュー、PDF出力、HTML出力の本文に適用する検索・置換ルール。PDFではヘッダーとフッターにも適用する。
 */
export interface TextReplacementRule {
    /**
     * 正規表現として扱う検索文字列。空欄は無効で、全一致を置換するためのフラグは内部で付与する。
     */
    pattern: string;
    /**
     * 一致箇所へ挿入する文字列。空文字なら一致箇所を削除し、$記号も展開せずそのまま挿入する。
     */
    replacement: string;
}

/**
 * PDF生成に使う用紙、向き、余白、本文スタイル、文字列置換の設定。
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
     * 印刷プレビュー、PDF出力、HTML出力の本文に上から順に適用する文字列置換ルール。PDFではヘッダーとフッターにも適用する。
     */
    textReplacements: TextReplacementRule[];
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
    textReplacements: [],
    saveWithoutDialog: true
};

/**
 * PDF設定候補を既定値へ補完し、数値を出力で許可する範囲へ収める。
 * @param value - 用紙、余白、文字組版などを含むPDF設定候補。
 * @returns 用紙と向きの有効値、余白0〜50mm、本文6〜48pt、見出し6〜72pt、コード6〜36pt、行間0.8〜3、段落間隔0〜48ptへ収めた設定。形式不正の置換ルールは除き、正規表現の妥当性は別途検証する。
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
     * 数値候補を有限値へ変換し、指定範囲内に収める。
     * @param input - 数値または数値文字列として変換する設定値候補。
     * @param fallback - inputを有限数へ変換できない場合に返す既定値。
     * @param min - 正規化後に許可する最小値。
     * @param max - 正規化後に許可する最大値。
     * @returns 範囲内へ補正した値。不正値や有限値にできない候補にはfallbackを返す。
     */ (input: unknown, fallback: number, min: number, max: number): number => {
            const parsed = typeof input === 'number' ? input : Number(input);
            return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
        };

    const integerInRange = /**
     * 範囲内へ補正した数値を整数へ丸める。
     * @param input - 数値または数値文字列として変換する設定値候補。
     * @param fallback - inputを有限数へ変換できない場合に返す既定値。
     * @param min - 正規化後に許可する最小値。
     * @param max - 正規化後に許可する最大値。
     * @returns numberInRangeで補正した値を最も近い整数へ丸めた結果。
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
        textReplacements: Array.isArray(candidate.textReplacements)
            ? candidate.textReplacements.flatMap(
                /**
                 * 保存値の各要素から、文字列で構成された置換ルールだけを復元する。
                 * @param value VS Code設定または旧保存値に含まれる要素。
                 * @returns 型を満たす場合は正規化したルール1件、それ以外は空配列。
                */
                (value) => {
                    if (!value || typeof value !== 'object') return [];
                    const rule = value as Partial<TextReplacementRule>;
                    return typeof rule.pattern === 'string' && typeof rule.replacement === 'string'
                        ? [{ pattern: rule.pattern, replacement: rule.replacement }]
                        : [];
                }
            )
            : [],
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
 * 置換ルールのパターンが空でなく、正規表現としてコンパイルできるか検証する。
 * @param pattern 設定された正規表現パターン。
 * @returns PDFとHTMLの出力へ適用できるパターンの場合はtrue。
 */
export function isTextReplacementPatternValid(pattern: string): boolean {
    if (!pattern) return false;
    try {
        new RegExp(pattern, 'g');
        return true;
    } catch {
        return false;
    }
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
 * @param value - HTML出力用の見出し、画像、表などの設定候補。
 * @returns 不正値を除き、既定値を補ったHTML出力設定。
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
 * 現在のHTML出力設定へ指定値を重ね、未指定項目は既定値に正規化する。
 * @param current - 更新後も保持する現在のHTML出力設定。
 * @param next 現在のHTML出力設定へマージする新しい設定値。
 * @returns すべての出力項目が補完されたHTML出力設定。
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
 * Webviewでワークスペース内リソースを許可するかを示す信頼状態。
     */
    workspaceTrusted: boolean;
    /**
 * 起動性能計測用の要求を送るかどうかを示す任意フラグ。
     */
    startupProbe?: boolean;
}

/**
 * 本文置換1件の開始オフセット、削除する長さ、挿入文字列を表します。
 */
export interface TextChange {

    /**
     * 文書本文の先頭から置換範囲が始まるUTF-16オフセットです。
     */
    rangeOffset: number;

    /**
     * 置換対象から削除するUTF-16コード単位数です。
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
     * 操作対象を示し、'text'なら文字列選択、'link'ならリンク領域です。
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
         * Webviewへ初期化状態を渡すメッセージです。
         */
        type: 'init';
        /**
         * 共有プロトコルで受け渡すtextの文字列。
         */
        text: string;

        /**
         * 拡張機能とWebview間で使用するメッセージ形式のバージョンです。
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
    | { type: 'sectionLinkCopied' }
    | { type: 'workspaceSectionLinkUnavailable' }
    | {
        /**
         * 本文編集の適用結果を返すメッセージです。
         */
        type: 'editAck';
        /**
 * Webviewクライアントを識別し、編集要求と応答を対応づけるID。
         */
        clientId: string;
        /**
 * 編集操作を識別し、再送された変更の二重適用を防ぐID。
         */
        opId: string;
        /**
 * 変更を作成した時点で基準にした文書版。Hostとの不一致時は再同期する。
         */
        baseVersion: number;
        /**
 * メッセージが参照する文書版番号。
         */
        version: number;
        /**
         * 本文へ適用する変更範囲の一覧。
         */
        changes: TextChange[]
    }
    | {
        /**
         * 外部で変更された本文差分をWebviewへ通知するメッセージです。
         */
        type: 'externalChanges';
        /**
         * 変更を作成した時点で基準にした文書版。不一致時はHostが再同期する。
         */
        baseVersion: number;
        /**
         * 変更が適用される本文の現在のバージョン番号です。
         */
        version: number;
        /**
         * 本文へ適用する変更範囲の一覧。
         */
        changes: TextChange[];
        /**
         * Webviewクライアントを識別し、編集要求と応答を対応づけるID。
         */
        clientId?: string;
        /**
         * 編集操作を識別し、再送された変更の二重適用を防ぐID。
         */
        opId?: string
    }
    | {

        /**
         * 本文状態の再同期をWebviewへ要求するメッセージです。
         */
        type: 'resyncRequired';

        /**
         * Webviewクライアントを識別し、編集要求と応答を対応づけるID。
         */
        clientId: string;

        /**
         * 編集操作を識別し、再送された変更の二重適用を防ぐID。
         */
        opId?: string;

        /**
 * Hostがこの操作をすでに文書へ適用したかを示す任意フラグ。
         */
        operationApplied?: boolean;
        /**
         * 共有プロトコルで受け渡すtextの文字列。
         */
        text: string;

        /**
         * 送受信するメッセージ形式のバージョンです。
         */
        version: number;

        /**
         * 共有プロトコルで受け渡すreasonの文字列。
         */
        reason: string;
    }
    | {
        /**
         * 更新後の設定をWebviewへ通知するメッセージです。
         */
        type: 'settingsChanged';
        /**
         * 共有プロトコルへ渡す設定または境界値。
         */
        settings: WebviewSettings
    }
    | {
        /**
         * 画像保存結果を要求元へ返すメッセージです。
         */
        type: 'imagesSaved';
        /**
 * 非同期要求と対応する応答を照合するID。
         */
        requestId: string;
        /**
         * 共有プロトコルで受け渡すpathsの文字列。
         */
        paths: string[]
    }
    | {
        /**
         * ローカル参照検査の診断結果を返すメッセージです。
         */
        type: 'localResourcesChecked';
        /**
         * 非同期要求と対応する応答を照合するID。
         */
        requestId: string;
        /**
 * Markdown解析で検出した診断の一覧。
         */
        diagnostics: Diagnostic[]
    }
    | {
        /**
         * 要求された操作の失敗情報を返すメッセージです。
         */
        type: 'operationFailed';
        /**
         * 非同期要求と対応する応答を照合するID。
         */
        requestId?: string;
        /**
         * 共有プロトコルで受け渡すmessageの文字列。
         */
        message: string
    }
    | {
        /**
         * PDF出力の完了または失敗を返すメッセージです。
         */
        type: 'pdfExported';
        /**
         * 非同期要求と対応する応答を照合するID。
         */
        requestId: string;
        /**
         * 共有プロトコルで受け渡すpathの文字列。
         */
        path: string
    }
    | {
        /**
         * HTML出力の完了または失敗を返すメッセージです。
         */
        type: 'htmlExported';
        /**
         * 非同期要求と対応する応答を照合するID。
         */
        requestId: string;
        /**
         * 共有プロトコルで受け渡すpathsの文字列。
         */
        paths: string[]
    }
    | {

        /**
         * 関連HTML文書の描画を要求するメッセージです。
         */
        type: 'renderHtmlDocuments';

        /**
         * 非同期要求と対応する応答を照合するID。
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
        /** 出力本文へ適用する置換ルール。 */
        textReplacements: TextReplacementRule[];
    }
    | {
        /**
         * PDFプレビューの読み込み完了を通知するメッセージです。
         */
        type: 'pdfPreviewReady';
        /**
         * 非同期要求と対応する応答を照合するID。
         */
        requestId: string;
        /**
 * PDFファイル全体をBase64で符号化したデータ。
         */
        pdfBase64: string
    }
    | {

        /**
         * Mermaid図の描画結果を返すメッセージです。
         */
        type: 'mermaidRendered';

        /**
         * 非同期要求と対応する応答を照合するID。
         */
        requestId: string;

        /**
         * 共有プロトコルで受け渡すsvgの文字列。
         */
        svg?: string;

        /**
 * プレビュー用PNGをBase64で符号化したデータ。
         */
        pngBase64?: string;

        /**
         * 図中の文字・リンク操作領域の一覧。
         */
        interactions?: MermaidInteraction[];

        /**
 * Webviewへ表示するコントロールのアクセシブル名。
         */
        ariaLabel?: string;

        /**
         * 共有プロトコルで受け渡すerrorの文字列。
         */
        error?: string;

        /**
 * Mermaid描画環境を利用できず、Host側処理へ切り替えたことを示すフラグ。
         */
        rendererUnavailable?: boolean;
    }
    | {
        /**
         * Webviewから拡張機能ホストへ操作を要求するメッセージです。
         */
        type: 'hostCommand';
        /**
 * Hostで実行する挿入、出力、Undo/Redo操作の種別。
        */
        command: 'insertImage' | 'exportPdf' | 'exportHtml' | 'undo' | 'redo'
    }
    | {
        type: 'hostCommand';
        command: 'navigateToOffset';
        offset: number;
    };

/**
 * 共有プロトコルで送受信するメッセージまたは要求のデータ形状。
 */
export type WebviewToHostMessage =
    | {
        /**
         * Webviewのクライアント登録完了を通知するメッセージです。
         */
        type: 'ready';
        /**
         * Webviewクライアントを識別し、編集要求と応答を対応づけるID。
         */
        clientId: string
    }
    | {
        /**
         * Webviewの初期化完了を通知するメッセージです。
         */
        type: 'initialized';
        /**
         * Webviewクライアントを識別し、編集要求と応答を対応づけるID。
         */
        clientId: string
    }
    | {

        /**
         * Webviewの初期表示準備完了を通知するメッセージです。
         */
        type: 'startupReady';

        /**
         * Webviewクライアントを識別し、編集要求と応答を対応づけるID。
         */
        clientId: string;

        /**
         * 同期するMarkdown本文のUTF-16コード単位数です。
         */
        markdownLength: number;

        /**
         * 共有プロトコルで受け渡すmetricsの文字列。
         */
        metrics?: Record<string, number>;
    }
    | {
        /**
         * Mermaid描画環境の起動完了を通知するメッセージです。
         */
        type: 'startupMermaidReady';
        /**
         * Webviewクライアントを識別し、編集要求と応答を対応づけるID。
         */
        clientId: string
    }
    | {
        /**
         * Webviewで編集した本文差分をホストへ送るメッセージです。
         */
        type: 'localChanges';
        /**
         * Webviewクライアントを識別し、編集要求と応答を対応づけるID。
         */
        clientId: string;
        /**
         * 編集操作を識別し、再送された変更の二重適用を防ぐID。
         */
        opId: string;
        /**
         * 変更を作成した時点で基準にした文書版。不一致時はHostが再同期する。
         */
        baseVersion: number;
        /**
         * 本文へ適用する変更範囲の一覧。
         */
        changes: TextChange[]
    }
    | {
        /**
         * UndoまたはRedoの実行をホストへ要求するメッセージです。
         */
        type: 'historyCommand';
        /**
         * Webviewクライアントを識別し、編集要求と応答を対応づけるID。
         */
        clientId: string;
        /**
         * 実行するHostコマンドの種別を示す識別子。
         */
        command: 'undo' | 'redo'
    }
    | {
        /**
         * 貼り付け画像の保存をホストへ要求するメッセージです。
         */
        type: 'saveImages';
        /**
         * 非同期要求と対応する応答を照合するID。
         */
        requestId: string;
        /**
         * 共有プロトコルで扱うimagesの一覧。
         */
        images: ImagePayload[];
        /**
 * 画像を保存するワークスペース内の相対ディレクトリ。
         */
        imageDirectory: string
    }
    | {
        /**
         * 画像選択と文書への保存をホストへ要求するメッセージです。
         */
        type: 'pickImage';
        /**
         * 非同期要求と対応する応答を照合するID。
         */
        requestId: string;
        /**
         * 画像を保存するワークスペース内の相対ディレクトリ。
         */
        imageDirectory: string
    }
    | {
        /**
         * 本文中のローカル参照検査をホストへ要求するメッセージです。
         */
        type: 'checkLocalResources';
        /**
         * 非同期要求と対応する応答を照合するID。
         */
        requestId: string;
        /**
         * 共有プロトコルで受け渡すmarkdownの文字列。
         */
        markdown: string
    }
    | {
        /**
         * エディターの配色テーマ変更をホストへ要求するメッセージです。
         */
        type: 'setEditorTheme';
        /**
         * 描画や表示に適用する配色テーマ。
         */
        theme: EditorTheme
    }
    | {
        /**
         * 画像保存先ルールの変更をホストへ要求するメッセージです。
         */
        type: 'setImageDirectory';
        /**
         * 共有プロトコルで受け渡すdirectoryの文字列。
         */
        directory: string
    }
    | {
        /**
         * 編集面とプレビューのフォント設定変更を送るメッセージです。
         */
        type: 'setFontFamilies';
        /**
 * ソースエディターに適用するフォントファミリー設定。
         */
        editorFontFamily: string;
        /**
 * Markdownプレビューに適用するフォントファミリー設定。
         */
        previewFontFamily: string
    }
    | {
        /**
         * 編集面とプレビューの表示モード変更を送るメッセージです。
         */
        type: 'setViewMode';
        /**
 * Webviewで復元する編集・プレビューの表示モード。
         */
        viewMode: ViewMode
    }
    | {
        /**
         * 目次ペインの表示切替を送るメッセージです。
         */
        type: 'setOutlineVisible';
        /**
         * 共有プロトコルのvisibleを有効または表示する設定。
         */
        visible: boolean
    }
    | { type: 'copySectionLink'; scope: 'document' | 'workspace'; id: string; text: string }
    | {
        /** HostへCopilot Chatに渡す現在のソース選択範囲を通知するメッセージ種別。 */
        type: 'copilotSelectionContext';
        /**
         * 選択時点のLF正規化済み本文に対する範囲。折りたたんだ選択では省略する。
         */
        selection?: {
            /** 選択範囲の開始UTF-16オフセット。 */
            from: number;
            /** 選択範囲の終了UTF-16オフセット。 */
            to: number;
        };
        /** 本文更新後に選択範囲を無効化するための選択時本文指紋。 */
        sourceFingerprint?: string;
    }
    | {
        /**
         * スクロール同期の有効状態を送るメッセージです。
         */
        type: 'setScrollSyncEnabled';
        /**
         * 共有プロトコルのenabledを有効または表示する設定。
         */
        enabled: boolean
    }
    | {
        /**
         * プレビュー画像のリサイズ操作表示を切り替えるメッセージです。
         */
        type: 'setPreviewImageResizeControlsVisible';
        /**
         * 共有プロトコルのvisibleを有効または表示する設定。
         */
        visible: boolean
    }
    | {
        /**
         * PDF出力設定の変更をホストへ送るメッセージです。
         */
        type: 'setPdfOptions';
        /**
         * 呼び出し側が指定する処理設定。
         */
        options: PdfOptions
    }
    | {
        /**
         * HTML出力設定の変更をホストへ送るメッセージです。
         */
        type: 'setHtmlOptions';
        /**
         * 呼び出し側が指定する処理設定。
         */
        options: HtmlExportSettings
    }
    | {

        /**
         * 現在の本文のPDF出力をホストへ要求するメッセージです。
         */
        type: 'exportPdf';

        /**
         * 非同期要求と対応する応答を照合するID。
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
         * 現在の本文のHTML出力をホストへ要求するメッセージです。
         */
        type: 'exportHtml';

        /**
         * 非同期要求と対応する応答を照合するID。
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

        /**
         * HTML出力対象の本文へ上から順に適用する置換ルール。
         */
        textReplacements: TextReplacementRule[];
    }
    | {

        /**
         * 関連文書を含むHTML描画結果を返すメッセージです。
         */
        type: 'htmlDocumentsRendered';

        /**
         * 非同期要求と対応する応答を照合するID。
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
        /** レンダリングに失敗した場合にHostへ返す説明。 */
        error?: string;
    }
    | {

        /**
         * PDFプレビューの生成をホストへ要求するメッセージです。
         */
        type: 'renderPdfPreview';

        /**
         * 非同期要求と対応する応答を照合するID。
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
         * Mermaid図の描画をホストへ要求するメッセージです。
         */
        type: 'renderMermaid';

        /**
         * 非同期要求と対応する応答を照合するID。
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
         * 実行中のMermaid描画のキャンセルを要求するメッセージです。
         */
        type: 'cancelMermaidRender';
        /**
         * 非同期要求と対応する応答を照合するID。
         */
        requestId: string
    }
    | {
        /**
         * 指定位置のソース本文を開くようホストへ要求するメッセージです。
         */
        type: 'openSource'
    }
    | {
        /**
         * 参照先リソースを開くようホストへ要求するメッセージです。
         */
        type: 'openResource';
        /**
         * 共有プロトコルで受け渡すhrefの文字列。
         */
        href: string;
        /** 専用title印を持つワークスペース基準リンクかを示す。 */
        workspaceRooted?: boolean
    }
    | {
        /**
         * ホストから現在の本文を再同期するよう要求するメッセージです。
         */
        type: 'requestResync';
        /**
         * Webviewクライアントを識別し、編集要求と応答を対応づけるID。
         */
        clientId: string;
        /**
         * 編集操作を識別し、再送された変更の二重適用を防ぐID。
         */
        opId?: string;
        /**
         * 応答の対象となる操作時点の文書バージョンです。
         */
        version: number;
        /**
         * 共有プロトコルで受け渡すreasonの文字列。
         */
        reason: string
    };

/**
 * Webviewから状態の取得・保存と拡張機能へのメッセージ送信を行うAPIです。
 */
export interface VsCodeApi<State = unknown> {
    /**
 * Extension Hostへ型付きメッセージを送信する。
     * @param message - HostとWebviewの間で受け渡すメッセージ。
     */
    postMessage(message: WebviewToHostMessage): void;
    /**
 * VS CodeがWebview用に保存した状態を読み取る。
 * @returns 保存状態。初回起動など保存値がない場合はundefined。
     */
    getState(): State | undefined;
    /**
     * 共有プロトコルの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param newState - 永続化するVS Code Webviewの共有状態。
     */
    setState(newState: State): void;
}

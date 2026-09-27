/**
 * @fileoverview Custom Editorの起動、文書保存、HostとWebviewの同期、編集コマンドを束ねる。VS Code APIが外部境界となる。
 */
import * as vscode from 'vscode';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import {
    DEFAULT_HTML_EXPORT_SETTINGS,
    DEFAULT_PDF_OPTIONS,
    normalizeHtmlExportSettings,
    normalizePdfOptions,
    type HostToWebviewMessage,
    type ImagePayload,
    type HtmlExportSettings,
    type NormalizedPdfOptions,
    type ViewMode,
    type WebviewSettings,
    type WebviewToHostMessage
} from '../shared/protocol';
import {
    DEFAULT_FONT_FAMILY_SETTINGS,
    normalizeFontFamily,
    normalizeFontFamilySettings,
    type FontFamilySettings
} from '../shared/fontFamily';
import { resolveImageDirectoryRule } from '../shared/imageDirectory';
import { collectLocalResourceReferences, sortDiagnostics, type Diagnostic } from '../shared/markdown';
import { applyTextChanges, computeTextChanges, mapTextChanges, validateTextChanges, type TextChange } from '../shared/textChanges';
import {
    canonicalizeContentChanges,
    materializeCanonicalChanges,
    toCanonicalText
} from '../shared/canonicalText';
import { getMessages, resolveLanguage, type Messages } from '../shared/messages';
import { acquirePdfBrowser, closePdfBrowser, exportPdf, renderPdf } from './pdf';
import {
    closeMermaidRenderer,
    MermaidRendererUnavailableError,
    renderMermaidInBrowser
} from './mermaid';
import { namespaceMermaidSvg } from '../shared/mermaidSvg';
import {
    prepareHtmlExport,
    writePreparedHtml,
    type HtmlRenderedDocument
} from './html';
import { decodeLocalResourceSource, isMissingResourceError } from './resourceCheck';
import { classifyResourceLink } from './resourceLink';


/**
 * VS CodeがCustom Editorを識別するビュー種別。
 */
const VIEW_TYPE = 'markdownEasyVisualEditor.editor';

/**
 * globalStateで表示モードを保存するキー。
 */
const VIEW_MODE_STATE_KEY = 'markdownEasyVisualEditor.viewMode';

/**
 * globalStateで目次表示状態を保存するキー。
 */
const OUTLINE_VISIBLE_STATE_KEY = 'markdownEasyVisualEditor.outlineVisible';

/**
 * スクロール同期設定を保存するキー。
 */
const SCROLL_SYNC_STATE_KEY = 'markdownEasyVisualEditor.scrollSyncEnabled';

/**
 * 画像リサイズUIの状態を保存するキー。
 */
const PREVIEW_IMAGE_RESIZE_CONTROLS_STATE_KEY = 'markdownEasyVisualEditor.previewImageResizeControlsVisible';

/**
 * globalStateでPDF設定を保存するキー。
 */
const PDF_OPTIONS_STATE_KEY = 'markdownEasyVisualEditor.pdfOptions';

/**
 * globalStateでフォント設定を保存するキー。
 */
const FONT_FAMILY_STATE_KEY = 'markdownEasyVisualEditor.fontFamilies';

/**
 * globalStateでHTML出力設定を保存するキー。
 */
const HTML_OPTIONS_STATE_KEY = 'markdownEasyVisualEditor.htmlOptions';

/** 旧globalState形式の設定移行を一度だけ実行したか記録するキー。 */
const GLOBAL_SETTINGS_MIGRATION_STATE_KEY = 'markdownEasyVisualEditor.globalSettingsMigrated';

/** VS CodeのmarkdownEasyVisualEditor設定へ保存するキーを一元管理する。 */
const GLOBAL_CONFIGURATION_KEYS = {
    viewMode: 'editor.viewMode',
    outlineVisible: 'editor.outlineVisible',
    scrollSyncEnabled: 'editor.scrollSyncEnabled',
    previewImageResizeControlsVisible: 'preview.imageResizeControlsVisible',
    editorFontFamily: 'fonts.editorFamily',
    previewFontFamily: 'fonts.previewFamily',
    pdf: {
        format: 'pdf.format',
        orientation: 'pdf.orientation',
        marginTop: 'pdf.margins.top',
        marginRight: 'pdf.margins.right',
        marginBottom: 'pdf.margins.bottom',
        marginLeft: 'pdf.margins.left',
        header: 'pdf.header',
        footer: 'pdf.footer',
        bodyFontSize: 'pdf.bodyFontSize',
        headingFontSizeH1: 'pdf.headingFontSizes.h1',
        headingFontSizeH2: 'pdf.headingFontSizes.h2',
        headingFontSizeH3: 'pdf.headingFontSizes.h3',
        headingFontSizeH4: 'pdf.headingFontSizes.h4',
        headingFontSizeH5: 'pdf.headingFontSizes.h5',
        headingFontSizeH6: 'pdf.headingFontSizes.h6',
        codeFontSize: 'pdf.codeFontSize',
        lineHeight: 'pdf.lineHeight',
        paragraphSpacing: 'pdf.paragraphSpacing',
        saveWithoutDialog: 'pdf.saveWithoutDialog'
    },
    html: {
        embedImages: 'html.embedImages',
        convertLinkedMarkdown: 'html.convertLinkedMarkdown',
        saveWithoutDialog: 'html.saveWithoutDialog'
    }
} as const;

/**
 * 拡張機能を出力または保存できる文字列へ整える。
 * @param value - Webviewへ埋め込むためJSON化する設定または初期化データ。
 * @returns 拡張機能で利用する文字列。
 */
function serializeInlineJson(value: unknown): string {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

/**
 * 拡張機能で共有するデータ形状を表すインターフェース。
 */
interface PendingHostOperation {

    /**
     * 拡張機能のpanelに関する状態または設定。
     */
    panel: vscode.WebviewPanel;

    /**
     * 通信相手または編集状態を識別するID。
     */
    clientId: string;

    /**
     * 拡張機能で扱うop・idの文字列。
     */
    opId: string;

    /**
     * 拡張機能のapplied・base・versionを表す数値。
     */
    appliedBaseVersion: number;
    /**
     * 拡張機能で解析・表示・保存する本文。
     */
    baseText: string;
    /**
     * 拡張機能で解析・表示・保存する本文。
     */
    expectedText: string;

    /**
     * 本文へ適用する変更範囲の一覧。
     */
    changes: TextChange[];
}

/**
 * 拡張機能の現在状態または履歴を保持するデータ形状。
 */
interface ChangeHistoryEntry {

    /**
     * 拡張機能のbase・versionを表す数値。
     */
    baseVersion: number;

    /**
     * 拡張機能のversionを表す数値。
     */
    version: number;
    /**
     * 拡張機能の位置・寸法・件数・時間を表す数値。
     */
    baseLength: number;
    /**
     * 本文へ適用する変更範囲の一覧。
     */
    changes: TextChange[];

    /**
     * 通信相手または編集状態を識別するID。
     */
    clientId?: string;

    /**
     * 拡張機能で扱うop・idの文字列。
     */
    opId?: string;
}

/**
 * 拡張機能で扱う値の種類と境界を表す型。
 */
type ExportCommand = 'exportPdf' | 'exportHtml';

/**
 * Webviewのready完了または失敗を通知するコールバックを保持する。
 */
interface PanelReadyWaiter {
    /**
     * 拡張機能から必要な値またはリソースを取得する。
     * @param panel - ready状態になったWebviewPanelを待機側へ返す。
     * @returns 副作用を完了し、値は返さない。
     */
    resolve: (panel: vscode.WebviewPanel) => void;
    /**
     * 拡張機能のrejectを処理し、呼び出し側へ結果または副作用を返す。
     * @param error - 処理に失敗した理由または例外。
     * @returns 副作用を完了し、値は返さない。
     */
    reject: (error: Error) => void;
}

/**
 * 拡張機能で共有するデータ形状を表すインターフェース。
 */
interface StartupTiming {

    /**
     * VS Codeまたはブラウザーが扱うリソースURI。
     */
    uri: string;

    /**
     * 拡張機能の位置・寸法・件数・時間を表す数値。
     */
    documentLength: number;

    /**
     * 拡張機能のresolve・started・atを表す数値。
     */
    resolveStartedAt: number;

    /**
     * 拡張機能のwebview・ready・msを表す数値。
     */
    webviewReadyMs?: number;

    /**
     * 拡張機能初期化開始から完了までの経過時間（ミリ秒）。未計測ならundefined。
     */
    initializedMs?: number;

    /**
     * 拡張機能のpreview・ready・msを表す数値。
     */
    previewReadyMs?: number;

    /**
     * 拡張機能のfirst・mermaid・requested・msを表す数値。
     */
    firstMermaidRequestedMs?: number;

    /**
     * 拡張機能のfirst・mermaid・ready・msを表す数値。
     */
    firstMermaidReadyMs?: number;

    /**
     * 拡張機能で扱うwebview・metricsの文字列。
     */
    webviewMetrics?: Record<string, number>;
}

/**
 * カスタムエディターと拡張機能コマンドをVS Codeへ登録する。
 * @param context - VS Codeが拡張機能へ渡すExtensionContext。購読の登録や拡張リソース参照に使う。
 * @returns 副作用を完了し、値は返さない。
 */
export function activate(context: vscode.ExtensionContext): void {
    // カスタムエディターと拡張機能の各コマンドをVS Codeへ登録する。
    const startupBenchmarkEnabled = process.env.MVE_STARTUP_BENCHMARK === '1';
    const provider = new MarkdownEasyVisualEditorProvider(context, startupBenchmarkEnabled);
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
            supportsMultipleEditorsPerDocument: true,
            webviewOptions: { retainContextWhenHidden: true }
        }),
        vscode.commands.registerCommand('markdownEasyVisualEditor.openVisual',
            /**
             * uriをifへ渡し、拡張機能の結果または副作用を処理する。
             * @param uri - VS Codeコマンドから渡された対象文書URI。未指定ならアクティブ文書を使う。
             * @returns 拡張機能のコールバックが生成する結果。
             */
            async (uri?: vscode.Uri) => {
                const resource = uri ?? vscode.window.activeTextEditor?.document.uri;
                if (resource) await vscode.commands.executeCommand('vscode.openWith', resource, VIEW_TYPE);
            }),
        vscode.commands.registerCommand('markdownEasyVisualEditor.openSource',
            /**
             * 要素をopen・sourceへ渡し、拡張機能の結果または副作用を処理する。
             * @returns 拡張機能のコールバックが生成する結果。
             */
            () => provider.openSource()),
        vscode.commands.registerCommand('markdownEasyVisualEditor.insertImage',
            /**
             * 要素をsend・commandへ渡し、拡張機能の結果または副作用を処理する。
             * @returns 拡張機能のコールバックが生成する結果。
             */
            () => provider.sendCommand('insertImage')),
        vscode.commands.registerCommand('markdownEasyVisualEditor.exportPdf',
            /**
             * uriをexport・from・uriへ渡し、拡張機能の結果または副作用を処理する。
             * @param uri - 出力対象Markdown文書のURI。未指定時はアクティブWebviewへ転送する。
             * @returns 拡張機能のコールバックが生成する結果。
             */
            (uri?: vscode.Uri) => provider.exportFromUri('exportPdf', uri)),
        vscode.commands.registerCommand('markdownEasyVisualEditor.exportHtml',
            /**
             * uriをexport・from・uriへ渡し、拡張機能の結果または副作用を処理する。
             * @param uri - 出力対象Markdown文書のURI。未指定時はアクティブWebviewへ転送する。
             * @returns 副作用を完了し、値は返さない。
             */
            (uri?: vscode.Uri) => provider.exportFromUri('exportHtml', uri)),
        vscode.commands.registerCommand('markdownEasyVisualEditor.undo',
            /**
             * 要素をexecute・history・commandへ渡し、拡張機能の結果または副作用を処理する。
             * @returns 副作用を完了し、値は返さない。
             */
            () => provider.executeHistoryCommand('undo')),
        vscode.commands.registerCommand('markdownEasyVisualEditor.redo',
            /**
             * 要素をexecute・history・commandへ渡し、拡張機能の結果または副作用を処理する。
             * @returns 副作用を完了し、値は返さない。
             */
            () => provider.executeHistoryCommand('redo')),
    );
    if (startupBenchmarkEnabled) {
        context.subscriptions.push(vscode.commands.registerCommand(
            'markdownEasyVisualEditor._getStartupTiming',

            /**
             * uriをget・startup・timingへ渡し、拡張機能の結果または副作用を処理する。
             * @param uri - 計測対象文書のURIまたはURI文字列。省略時は最新の計測値を返す。
             * @returns 副作用を完了し、値は返さない。
             */
            (uri?: vscode.Uri | string) => provider.getStartupTiming(uri)
        ));
    }
}

/**
 * 拡張機能のdeactivateを処理し、呼び出し側へ結果または副作用を返す。
 * @returns 副作用を完了し、値は返さない。
 */
export async function deactivate(): Promise<void> {
    await closeMermaidRenderer();
    await closePdfBrowser();
}

/**
 * 拡張機能の状態と操作をまとめるクラス。
 */
export class MarkdownEasyVisualEditorProvider implements vscode.CustomTextEditorProvider {

    /**
     * 文書ごとに開いているWebviewパネルの対応表。
     */
    private readonly panels = new Map<string, Set<vscode.WebviewPanel>>();

    /**
     * 文書URIと開いている文書オブジェクトの対応表。
     */
    private readonly documents = new Map<string, vscode.TextDocument>();
    /**
     * 文書URIごとの正規化済み本文。
     */
    private readonly canonicalDocumentTexts = new Map<string, string>();

    /**
     * クライアントごとの未完了Host操作。
     */
    private readonly activeOperations = new Map<string, PendingHostOperation>();

    /**
     * 文書ごとの最新Host操作キー。
     */
    private readonly activeOperationKeysByDocument = new Map<string, string>();

    /**
     * クライアントごとのUndo/Redo用変更履歴。
     */
    private readonly changeHistory = new Map<string, ChangeHistoryEntry[]>();

    /**
     * 文書ごとの編集処理を直列化するPromise。
     */
    private readonly editChains = new Map<string, Promise<void>>();

    /**
     * 拡張機能のpdf・preview・generationsに関する状態または設定。
     */
    private readonly pdfPreviewGenerations = new WeakMap<vscode.WebviewPanel, number>();

    /**
     * 拡張機能のpdf・preview・abort・controllersに関する状態または設定。
     */
    private readonly pdfPreviewAbortControllers = new WeakMap<vscode.WebviewPanel, AbortController>();

    /**
     * 拡張機能のpdf・preview・chainsに関する状態または設定。
     */
    private readonly pdfPreviewChains = new WeakMap<vscode.WebviewPanel, Promise<void>>();

    /**
     * 拡張機能のmermaid・render・controllersに関する状態または設定。
     */
    private readonly mermaidRenderControllers = new Map<string, {

        /**
         * 拡張機能のpanelに関する状態または設定。
         */
        panel: vscode.WebviewPanel;

        /**
         * 拡張機能のcontrollerに関する状態または設定。
         */
        controller: AbortController;
    }>();

    /**
     * HTML描画要求IDをキーに、完了通知・拒否通知・timeoutを保持するMap。
     */
    private readonly pendingHtmlRenderRequests = new Map<string, {
        /**
         * 拡張機能から必要な値またはリソースを取得する。
         * @param documents - HTMLへ変換するリンク先文書のIDとMarkdown本文の一覧。
         * @returns 副作用を完了し、値は返さない。
         */
        resolve: (documents: HtmlRenderedDocument[]) => void;
        /**
         * 拡張機能のrejectを処理し、呼び出し側へ結果または副作用を返す。
         * @param error - 処理に失敗した理由または例外。
         * @returns 副作用を完了し、値は返さない。
         */
        reject: (error: Error) => void;

        /**
         * 拡張機能の遅延処理を管理するタイマー。
         */
        timer: ReturnType<typeof setTimeout>;
    }>();

    /**
     * 拡張機能のpanel・ready・waitersに関する状態または設定。
     */
    private readonly panelReadyWaiters = new Map<string, Set<PanelReadyWaiter>>();

    /**
     * 拡張機能のopening・documentsを識別し、現在の状態を追跡する対応表。
     */
    private readonly openingDocuments = new Map<string, Promise<void>>();

    /**
     * WebviewパネルとクライアントIDの対応表。
     */
    private readonly panelClientIds = new WeakMap<vscode.WebviewPanel, string>();

    /**
     * 初期化済みWebviewパネルの集合。
     */
    private readonly panelInitialized = new WeakSet<vscode.WebviewPanel>();

    /**
     * Webviewパネルごとの起動計測値。
     */
    private readonly panelStartupTimings = new WeakMap<vscode.WebviewPanel, StartupTiming>();

    /**
     * 文書ごとの起動計測値。
     */
    private readonly startupTimings = new Map<string, StartupTiming>();

    /** 移行・設定画面・HTML/PDF出力からのglobal設定書き込みを順序どおり実行するPromise。 */
    private globalSettingsUpdateChain: Promise<void> = Promise.resolve();

    /**
     * 旧globalState設定からVS Code設定への移行処理を共有するPromise。
     */
    private readonly globalSettingsMigration: Promise<void>;

    /**
     * 拡張機能自身の複数設定更新中に設定変更通知が中間状態を送らないようにするカウンター。
     */
    private globalConfigurationUpdateDepth = 0;

    /**
     * 現在選択中のWebviewPanel。未選択ならundefined。
     */
    private activePanel?: vscode.WebviewPanel;

    /**
     * 現在選択中のTextDocument。未選択ならundefined。
     */
    private activeDocument?: vscode.TextDocument;

    /**
     * VS Code連携と起動時計測の状態を初期化する。
     * @param context - 購読の登録や拡張リソース参照に使うVS CodeのExtensionContext。
     * @param startupBenchmarkEnabled - 起動計測を記録するかどうかを示すフラグ。
     * @returns 初期化したインスタンス。
     */
    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly startupBenchmarkEnabled = false
    ) {
        // 文書変更・設定変更・ワークスペース信頼変更を監視し、Webviewへ状態を反映する。
        context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(
                /**
                 * VS Codeから受け取った文書変更を各Webviewへ反映する。
                 * @param event - 変更されたTextDocumentと、その文書への変更内容を含むVS Code通知。
                 * @returns 副作用を完了し、値は返さない。
                 */
                (event) => this.onDocumentChanged(event)),
            vscode.workspace.onDidChangeConfiguration(
                /**
                 * 外部設定の変更だけを即時通知し、拡張機能内の複数キー更新は完了後に一度通知する。
                 * @param event - 変更対象の設定を照会できるVS CodeのConfigurationChangeEvent。
                 * @returns 副作用を完了し、値は返さない。
                 */
                (event) => {
                    if (event.affectsConfiguration('markdownEasyVisualEditor') &&
                        this.globalConfigurationUpdateDepth === 0) {
                        this.broadcastSettings();
                    }
                }),
            vscode.workspace.onDidGrantWorkspaceTrust(
                /**
                 * 要素をbroadcast・settingsへ渡し、拡張機能の結果または副作用を処理する。
                 * @returns 副作用を完了し、値は返さない。
                 */
                () => this.broadcastSettings())
        );
        this.globalSettingsMigration = this.migrateLegacyGlobalSettings().catch(
            /**
             * 移行失敗を記録し、旧値の互換読み込みを維持したままHostの起動を続ける。
             * @param error - 設定移行中に発生した例外。
             */
            (error: unknown) => {
                console.error('Failed to migrate Markdown Easy Visual Editor settings.', error);
            });
    }

    /**
     * 拡張機能から必要な値またはリソースを取得する。
     * @param document - このcustom editorで開くMarkdown文書。
     * @param webviewPanel - この文書を表示するWebviewPanel。
     * @returns 副作用を完了し、値は返さない。
     */
    async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        // 旧globalState設定の移行完了後に初期設定を送信し、新設定との競合を防ぐ。
        await this.globalSettingsMigration;
        // 文書とWebviewパネルを登録し、HTML・メッセージ受信・破棄時の後処理を設定する。
        const key = document.uri.toString();
        if (this.startupBenchmarkEnabled) {
            const timing: StartupTiming = {
                uri: key,
                documentLength: document.getText().length,
                resolveStartedAt: Date.now()
            };
            this.panelStartupTimings.set(webviewPanel, timing);
            this.startupTimings.set(key, timing);
        }
        this.documents.set(key, document);
        // 空文書でもTextDocument.eolとは無関係に、同期本文の座標系をLFへ固定する。
        if (!this.canonicalDocumentTexts.has(key)) {
            this.canonicalDocumentTexts.set(key, toCanonicalText(document.getText()));
        }
        const group = this.panels.get(key) ?? new Set<vscode.WebviewPanel>();
        group.add(webviewPanel);
        this.panels.set(key, group);
        this.activePanel = webviewPanel;
        this.activeDocument = document;

        const workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map(
            /**
             * 各folderからuriを取り出して一覧化する。
             * @param folder - WebviewのlocalResourceRootsへ加えるワークスペースフォルダー。
             * @returns uriを取り出した変換結果の一覧。
             */
            (folder) => folder.uri);
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri, vscode.Uri.joinPath(document.uri, '..'), ...workspaceRoots]
        };
        webviewPanel.webview.html = this.getWebviewHtml(webviewPanel.webview, document);

        // Webviewからのメッセージを対象文書とパネルに紐付けて処理する。
        const messageDisposable = webviewPanel.webview.onDidReceiveMessage(
            /**
             * メッセージをhandle・messageへ渡し、拡張機能の結果または副作用を処理する。
             * @param message - HostとWebviewの間で受け渡すメッセージ。
             * @returns 拡張機能のコールバックが生成する結果。
             */
            (message: WebviewToHostMessage) =>
                this.handleMessage(document, webviewPanel, message)
        );
        webviewPanel.onDidChangeViewState(
            /**
             * パネルがアクティブになった通知に合わせて、現在の文書とパネルを更新する。
             * @param event - 対象WebviewPanelと表示状態を含むVS Codeの状態変更通知。
             * @returns 拡張機能のコールバックが生成する結果。
             */
            (event) => {
                if (event.webviewPanel.active) {
                    this.activePanel = webviewPanel;
                    this.activeDocument = document;
                }
            });
        webviewPanel.onDidDispose(
            /**
             * 要素をgetへ渡し、拡張機能の結果または副作用を処理する。
             * @returns 拡張機能のコールバックが生成する結果。
             */
            () => {
                // パネル破棄時に登録情報・履歴・保留中の操作を文書単位で片付ける。
                this.pdfPreviewAbortControllers.get(webviewPanel)?.abort();
                for (const [requestId, pending] of this.mermaidRenderControllers) {
                    if (pending.panel !== webviewPanel) continue;
                    pending.controller.abort();
                    this.mermaidRenderControllers.delete(requestId);
                }
                messageDisposable.dispose();
                group.delete(webviewPanel);
                if (!group.size) {
                    this.panels.delete(key);
                    this.documents.delete(key);
                    this.canonicalDocumentTexts.delete(key);
                    this.changeHistory.delete(key);
                    this.rejectPanelReady(key);
                    const operationKey = this.activeOperationKeysByDocument.get(key);
                    if (operationKey) this.activeOperations.delete(operationKey);
                    this.activeOperationKeysByDocument.delete(key);
                }
                if (this.activePanel === webviewPanel) {
                    this.activePanel = undefined;
                    this.activeDocument = undefined;
                }
            });
    }

    /**
     * 拡張機能から必要な値またはリソースを取得する。
     * @param uri - 計測対象文書のURIまたはURI文字列。省略時は最新の計測値を返す。
     * @returns 条件に一致する値。未検出時はundefinedまたはnull。
     */
    getStartupTiming(uri?: vscode.Uri | string): Omit<StartupTiming, 'resolveStartedAt'> | undefined {
        const key = typeof uri === 'string' ? uri : uri?.toString();
        const timing = key ? this.startupTimings.get(key) : [...this.startupTimings.values()].at(-1);
        if (!timing) return undefined;
        const { resolveStartedAt: _resolveStartedAt, ...result } = timing;
        return result;
    }

    /**
     * 拡張機能の表示または操作を開始する。
     * @returns 副作用を完了し、値は返さない。
     */
    async openSource(): Promise<void> {
        // 現在アクティブな文書を通常のテキストエディターで隣接表示する。
        if (!this.activeDocument) return;
        await vscode.commands.executeCommand(
            'vscode.openWith',
            this.activeDocument.uri,
            'default',
            vscode.ViewColumn.Beside
        );
    }

    /**
     * 拡張機能の変更または要求をHost・Webview間へ通知する。
     * @param command - アクティブWebviewへ送信するHostコマンド。
     * @returns 副作用を完了し、値は返さない。
     */
    sendCommand(command: 'insertImage' | ExportCommand): void {
        // アクティブなWebviewへホストコマンドを送る。
        if (!this.activePanel) return;
        this.post(this.activePanel, { type: 'hostCommand', command });
    }

    /**
     * 拡張機能のexport・from・uriを処理し、呼び出し側へ結果または副作用を返す。
     * @param command - Webviewへ転送するPDFまたはHTMLの出力コマンド。
     * @param uri - 出力対象Markdown文書のURI。未指定時はアクティブWebviewへ転送する。
     * @returns 副作用を完了し、値は返さない。
     */
    async exportFromUri(command: ExportCommand, uri?: vscode.Uri): Promise<void> {
        if (!uri) {
            this.sendCommand(command);
            return;
        }
        if (uri.scheme !== 'file' || !isMarkdownDocumentPath(uri.fsPath)) return;

        try {
            const panel = await this.ensureReadyPanel(uri);
            // ここでは変換処理を実行しない。UIと同じhostCommandを同じWebviewへ渡す。
            this.post(panel, { type: 'hostCommand', command });
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`${this.getMessages().host.errorPrefix}: ${detail}`);
        }
    }

    /**
     * 拡張機能のensure・ready・panelを処理し、呼び出し側へ結果または副作用を返す。
     * @param documentUri - ready状態のWebviewPanelを検索・待機する対象文書のURI。
     * @returns 拡張機能の非同期処理で得られる結果。
     */
    private async ensureReadyPanel(documentUri: vscode.Uri): Promise<vscode.WebviewPanel> {
        const readyPanel = this.findReadyPanel(documentUri);
        if (readyPanel) return readyPanel;

        const key = documentUri.toString();
        if (!this.panels.has(key)) {
            let opening = this.openingDocuments.get(key);
            if (!opening) {
                opening = Promise.resolve(
                    vscode.commands.executeCommand('vscode.openWith', documentUri, VIEW_TYPE)
                ).then(
                    /**
                     * 拡張機能のコールバックとして要素を処理する。
                     * @returns 副作用を完了し、値は返さない。
                     */
                    () => undefined).finally(
                        /**
                         * 要素をifへ渡し、拡張機能の結果または副作用を処理する。
                         * @returns 副作用を完了し、値は返さない。
                         */
                        () => {
                            if (this.openingDocuments.get(key) === opening) this.openingDocuments.delete(key);
                        });
                this.openingDocuments.set(key, opening);
            }
            await opening;
        }
        return this.waitForReadyPanel(documentUri);
    }

    /**
     * 拡張機能から必要な値またはリソースを取得する。
     * @param documentUri - ready状態のWebviewPanelを検索・待機する対象文書のURI。
     * @returns 条件に一致する値。未検出時はundefinedまたはnull。
     */
    private findReadyPanel(documentUri: vscode.Uri): vscode.WebviewPanel | undefined {
        const panels = this.panels.get(documentUri.toString());
        return panels ? [...panels].find(
            /**
             * initializedが条件に一致する最初のpanelを取得する。
             * @param panel - 初期化済みとして登録されているか確認するWebviewPanel。
             * @returns 条件に一致した最初の要素。未検出時はundefined。
             */
            (panel) => this.panelInitialized.has(panel)) : undefined;
    }

    /**
     * 拡張機能が指定条件を満たすまで待機する。
     * @param documentUri - ready状態のWebviewPanelを検索・待機する対象文書のURI。
     * @returns 拡張機能の非同期処理で得られる結果。
     */
    private waitForReadyPanel(documentUri: vscode.Uri): Promise<vscode.WebviewPanel> {
        const readyPanel = this.findReadyPanel(documentUri);
        if (readyPanel) return Promise.resolve(readyPanel);

        const key = documentUri.toString();
        return new Promise(
            /**
             * 遅延処理の完了または失敗を待機側へ通知する。
             * @param resolve - Promiseの成功を通知する関数。
             * @param reject - Promiseの失敗を通知する関数。
             * @returns 非同期処理の完了値。
             */
            (resolve, reject) => {
                const waiters = this.panelReadyWaiters.get(key) ?? new Set<PanelReadyWaiter>();
                const timer = setTimeout(
                    /**
                     * 指定時間の経過後に後続処理を実行する。
                     * @returns 副作用を完了し、値は返さない。
                     */
                    () => {
                        waiters.delete(waiter);
                        if (!waiters.size) this.panelReadyWaiters.delete(key);
                        reject(new Error('Markdown Easy Visual Editorの準備がタイムアウトしました。'));
                    }, 30_000);
                const waiter: PanelReadyWaiter = {


                    resolve: /**
                     * 拡張機能から必要な値またはリソースを取得する。
                     * @param panel - ready状態になり、待機側へ返すWebviewPanel。
                     * @returns 副作用を完了し、値は返さない。
                     */ (panel) => {
                            clearTimeout(timer);
                            waiters.delete(waiter);
                            if (!waiters.size) this.panelReadyWaiters.delete(key);
                            resolve(panel);
                        },


                    reject: /**
                     * 拡張機能のrejectを処理し、呼び出し側へ結果または副作用を返す。
                     * @param error - 処理に失敗した理由または例外。
                     * @returns 副作用を完了し、値は返さない。
                     */ (error) => {
                            clearTimeout(timer);
                            waiters.delete(waiter);
                            if (!waiters.size) this.panelReadyWaiters.delete(key);
                            reject(error);
                        }
                };
                waiters.add(waiter);
                this.panelReadyWaiters.set(key, waiters);
            });
    }

    /**
     * 拡張機能から必要な値またはリソースを取得する。
     * @param documentKey - 文書URI文字列をキーにしたready待機者集合を検索するキー。
     * @param panel - ready状態になり、待機側へ返すWebviewPanel。
     * @returns 副作用を完了し、値は返さない。
     */
    private resolvePanelReady(documentKey: string, panel: vscode.WebviewPanel): void {
        const waiters = this.panelReadyWaiters.get(documentKey);
        if (!waiters) return;
        this.panelReadyWaiters.delete(documentKey);
        waiters.forEach(
            /**
             * waiterごとに成功結果通知を実行する。
             * @param waiter - waiterの成功結果通知を参照する走査対象。
             * @returns 副作用を完了し、値は返さない。
             */
            (waiter) => waiter.resolve(panel));
    }

    /**
     * 拡張機能のreject・panel・readyを処理し、呼び出し側へ結果または副作用を返す。
     * @param documentKey - 文書URI文字列をキーにしたready待機者集合を検索するキー。
     * @returns 副作用を完了し、値は返さない。
     */
    private rejectPanelReady(documentKey: string): void {
        const waiters = this.panelReadyWaiters.get(documentKey);
        if (!waiters) return;
        this.panelReadyWaiters.delete(documentKey);
        const error = new Error('Markdown Easy Visual EditorのWebviewが閉じられました。');
        waiters.forEach(
            /**
             * waiterごとに失敗通知を実行する。
             * @param waiter - waiterの失敗通知を参照する走査対象。
             * @returns 副作用を完了し、値は返さない。
             */
            (waiter) => waiter.reject(error));
    }

    /**
     * 拡張機能の処理順序と完了状態を管理する。
     * @param command - アクティブWebviewへ送るundoまたはredoコマンド。
     * @returns 副作用を完了し、値は返さない。
     */
    executeHistoryCommand(command: 'undo' | 'redo'): void {
        // アクティブなパネルが有効な場合だけUndoまたはRedoをWebviewへ送る。
        const panel = this.activePanel;
        if (!panel || !panel.active) return;
        this.post(panel, { type: 'hostCommand', command });
    }

    /**
     * HostまたはWebviewから届いたメッセージを検証し、対応する状態更新へ振り分ける。
     * @param document - メッセージを適用する対象TextDocument。
     * @param panel - このメッセージを送信したWebviewPanel。
     * @param message - HostとWebviewの間で受け渡すメッセージ。
     * @returns 副作用を完了し、値は返さない。
     * @throws 要求の処理や外部リソース操作に失敗した場合。
     */
    private async handleMessage(
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel,
        message: WebviewToHostMessage
    ): Promise<void> {
        hostDebug('[MVE host] message', {
            type: message.type,
            document: document.uri.toString(),
            clientId: 'clientId' in message ? message.clientId : undefined,
            opId: 'opId' in message ? message.opId : undefined,
            baseVersion: 'baseVersion' in message ? message.baseVersion : undefined
        });
        // Webviewから受け取った種別ごとの要求を文書操作やファイル操作へ振り分ける。
        try {
            switch (message.type) {
                case 'ready':
                    // 初期接続したWebviewへクライアントID・本文・バージョン・設定を返す。
                    this.panelClientIds.set(panel, message.clientId);
                    this.markStartup(panel, 'webviewReadyMs');
                    this.panelInitialized.delete(panel);
                    this.post(panel, {
                        type: 'init',
                        text: this.canonicalText(document),
                        version: document.version,
                        uri: document.uri.toString(),
                        settings: this.getSettings(document)
                    });
                    return;
                case 'initialized':
                    if (this.panelClientIds.get(panel) !== message.clientId) return;
                    this.panelInitialized.add(panel);
                    this.markStartup(panel, 'initializedMs');
                    this.resolvePanelReady(document.uri.toString(), panel);
                    return;
                case 'startupReady':
                    if (this.panelClientIds.get(panel) !== message.clientId) return;
                    if (message.metrics) {
                        const timing = this.panelStartupTimings.get(panel);
                        if (timing) timing.webviewMetrics = message.metrics;
                    }
                    this.markStartup(panel, 'previewReadyMs');
                    return;
                case 'startupMermaidReady':
                    if (this.panelClientIds.get(panel) !== message.clientId) return;
                    this.markStartup(panel, 'firstMermaidReadyMs');
                    return;
                case 'localChanges':
                    await this.queueWebviewEdit(document, panel, message);
                    return;
                case 'historyCommand': {
                    await this.queueHistoryCommand(document, panel, message);
                    return;
                }
                case 'saveImages': {
                    const paths = await this.saveImages(document, message.images, message.imageDirectory);
                    this.post(panel, { type: 'imagesSaved', requestId: message.requestId, paths });
                    return;
                }
                case 'pickImage': {
                    const paths = await this.pickAndSaveImages(document, message.imageDirectory);
                    this.post(panel, { type: 'imagesSaved', requestId: message.requestId, paths });
                    return;
                }
                case 'checkLocalResources': {
                    const diagnostics = await this.checkLocalResources(document, message.markdown);
                    this.post(panel, { type: 'localResourcesChecked', requestId: message.requestId, diagnostics });
                    return;
                }
                case 'renderMermaid': {
                    this.markStartup(panel, 'firstMermaidRequestedMs');
                    const previous = this.mermaidRenderControllers.get(message.requestId);
                    previous?.controller.abort();
                    const controller = new AbortController();
                    this.mermaidRenderControllers.set(message.requestId, { panel, controller });
                    try {
                        const rendered = await renderMermaidInBrowser(
                            message.source,
                            message.theme,
                            vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'mermaid.min.js').fsPath,

                            /**
                             * 要素をacquire・pdf・browserへ渡し、拡張機能の結果または副作用を処理する。
                             * @returns 拡張機能のコールバックが生成する結果。
                             */
                            () => acquirePdfBrowser(this.getLanguage()),
                            controller.signal
                        );
                        if (controller.signal.aborted) return;
                        this.post(panel, {
                            type: 'mermaidRendered',
                            requestId: message.requestId,
                            svg: namespaceMermaidSvg(rendered.svg, `mve-${message.requestId}`),
                            pngBase64: rendered.pngBase64,
                            interactions: rendered.interactions,
                            ariaLabel: rendered.ariaLabel
                        });
                    } catch (error) {
                        if (controller.signal.aborted) return;
                        this.post(panel, {
                            type: 'mermaidRendered',
                            requestId: message.requestId,
                            error: error instanceof Error ? error.message : String(error),
                            rendererUnavailable: error instanceof MermaidRendererUnavailableError
                        });
                    } finally {
                        if (this.mermaidRenderControllers.get(message.requestId)?.controller === controller) {
                            this.mermaidRenderControllers.delete(message.requestId);
                        }
                    }
                    return;
                }
                case 'cancelMermaidRender': {
                    const pending = this.mermaidRenderControllers.get(message.requestId);
                    if (pending?.panel === panel) {
                        pending.controller.abort();
                        this.mermaidRenderControllers.delete(message.requestId);
                    }
                    return;
                }
                case 'setEditorTheme': {
                    const config = vscode.workspace.getConfiguration('markdownEasyVisualEditor');
                    await config.update('editor.theme', message.theme, vscode.ConfigurationTarget.Global);
                    this.broadcastSettings();
                    return;
                }
                case 'setImageDirectory': {
                    const normalized = resolveImageDirectoryRule(message.directory, 'document');
                    if (!normalized) throw new Error(this.getMessages().host.invalidImageDirectory);
                    const config = vscode.workspace.getConfiguration('markdownEasyVisualEditor', document.uri);
                    const inspected = config.inspect<string>('images.directory');
                    const target = inspected?.workspaceFolderValue !== undefined
                        ? vscode.ConfigurationTarget.WorkspaceFolder
                        : inspected?.workspaceValue !== undefined
                            ? vscode.ConfigurationTarget.Workspace
                            : vscode.ConfigurationTarget.Global;
                    await config.update('images.directory', message.directory.trim(), target);
                    this.broadcastSettings();
                    return;
                }
                case 'setFontFamilies': {
                    const fontSettings: FontFamilySettings = {
                        editorFontFamily: normalizeFontFamily(message.editorFontFamily),
                        previewFontFamily: normalizeFontFamily(message.previewFontFamily)
                    };
                    await this.updateGlobalConfiguration([
                        [GLOBAL_CONFIGURATION_KEYS.editorFontFamily, fontSettings.editorFontFamily],
                        [GLOBAL_CONFIGURATION_KEYS.previewFontFamily, fontSettings.previewFontFamily]
                    ]);
                    this.broadcastSettings();
                    return;
                }
                case 'setViewMode':
                    await this.updateGlobalConfiguration([[GLOBAL_CONFIGURATION_KEYS.viewMode, message.viewMode]]);
                    this.broadcastSettings();
                    return;
                case 'setOutlineVisible':
                    await this.updateGlobalConfiguration([[GLOBAL_CONFIGURATION_KEYS.outlineVisible, message.visible]]);
                    this.broadcastSettings();
                    return;
                case 'setScrollSyncEnabled':
                    await this.updateGlobalConfiguration([[GLOBAL_CONFIGURATION_KEYS.scrollSyncEnabled, message.enabled]]);
                    this.broadcastSettings();
                    return;
                case 'setPreviewImageResizeControlsVisible':
                    await this.updateGlobalConfiguration([
                        [GLOBAL_CONFIGURATION_KEYS.previewImageResizeControlsVisible, message.visible]
                    ]);
                    this.broadcastSettings();
                    return;
                case 'setPdfOptions':
                    // Webviewからの入力値を正規化して保存し、開いている全Webviewへ同じ設定を通知する。
                    {
                        const fontSettings = this.getFontSettings();
                        const options = normalizePdfOptions(message.options);
                        options.fontFamily = fontSettings.previewFontFamily || DEFAULT_PDF_OPTIONS.fontFamily;
                        await this.updateGlobalConfiguration(pdfConfigurationEntries(options));
                    }
                    this.broadcastSettings();
                    return;
                case 'setHtmlOptions':
                    {
                        const options = normalizeHtmlExportSettings(message.options);
                        await this.updateGlobalConfiguration([
                            [GLOBAL_CONFIGURATION_KEYS.html.embedImages, options.embedImages],
                            [GLOBAL_CONFIGURATION_KEYS.html.convertLinkedMarkdown, options.convertLinkedMarkdown],
                            [GLOBAL_CONFIGURATION_KEYS.html.saveWithoutDialog, options.saveWithoutDialog]
                        ]);
                        this.broadcastSettings();
                    }
                    return;
                case 'openSource':
                    this.activeDocument = document;
                    await this.openSource();
                    return;
                case 'openResource':
                    await this.openResource(document, message.href);
                    return;
                case 'htmlDocumentsRendered': {
                    const pending = this.pendingHtmlRenderRequests.get(message.requestId);
                    if (!pending) return;
                    clearTimeout(pending.timer);
                    this.pendingHtmlRenderRequests.delete(message.requestId);
                    pending.resolve(message.documents);
                    return;
                }
                case 'requestResync': {
                    // 直前までの編集連鎖を待ってから、最新本文と操作適用状態を返す。
                    const documentKey = document.uri.toString();
                    await (this.editChains.get(documentKey) ?? Promise.resolve()).catch(
                        /**
                         * 拡張機能のコールバックとして要素を処理する。
                         * @returns 副作用を完了し、値は返さない。
                         */
                        () => undefined);
                    this.post(panel, {
                        type: 'resyncRequired',
                        clientId: message.clientId,
                        opId: message.opId,
                        operationApplied: message.opId
                            ? this.wasOperationApplied(documentKey, message.clientId, message.opId)
                            : undefined,
                        text: this.canonicalText(document),
                        version: document.version,
                        reason: message.reason
                    });
                    return;
                }
                case 'exportPdf': {
                    // 信頼済みワークスペースでHTMLと設定をPDF出力へ渡す。
                    if (!vscode.workspace.isTrusted) {
                        throw new Error(this.getMessages().host.pdfTrustRequired);
                    }
                    const target = await vscode.window.withProgress(
                        { location: vscode.ProgressLocation.Notification, title: this.getMessages().host.pdfProgress, cancellable: false },

                        /**
                         * 要素をexport・pdfへ渡し、拡張機能の結果または副作用を処理する。
                         * @returns 拡張機能のコールバックが生成する結果。
                         */
                        () =>
                            exportPdf({
                                html: message.html,
                                css: message.css,
                                options: message.options,
                                documentUri: document.uri,
                                language: this.getLanguage()
                            })
                    );
                    if (target) {
                        this.post(panel, { type: 'pdfExported', requestId: message.requestId, path: target.fsPath });
                        const messages = this.getMessages();
                        void vscode.window.showInformationMessage(messages.host.pdfExported(target.fsPath), messages.host.open).then(
                            /**
                             * choiceをifへ渡し、拡張機能の結果または副作用を処理する。
                             * @param choice - PDF出力後に選択されたOpenアクション。未選択時はundefined。
                             * @returns 拡張機能のコールバックが生成する結果。
                             */
                            (choice) => {
                                if (choice === messages.host.open) void vscode.env.openExternal(target);
                            });
                    } else {
                        this.post(panel, {
                            type: 'operationFailed',
                            requestId: message.requestId,
                            message: this.getMessages().host.saveCanceled
                        });
                    }
                    return;
                }
                case 'exportHtml': {
                    if (!vscode.workspace.isTrusted) {
                        throw new Error(this.getMessages().host.htmlTrustRequired);
                    }
                    const result = await vscode.window.withProgress(
                        { location: vscode.ProgressLocation.Notification, title: this.getMessages().host.htmlProgress, cancellable: false },

                        /**
                         * 要素をget・languageへ渡し、拡張機能の結果または副作用を処理する。
                         * @returns 拡張機能のコールバックが生成する結果。
                         */
                        async () => {
                            const request = {
                                markdown: message.markdown,
                                html: message.html,
                                css: message.css,
                                options: message.options,
                                documentUri: document.uri,
                                language: this.getLanguage(),
                                fontFamily: this.getFontSettings().previewFontFamily || DEFAULT_PDF_OPTIONS.fontFamily
                            };
                            const preparation = await prepareHtmlExport(request);
                            if (!preparation) return undefined;
                            const linkedDocuments = message.options.convertLinkedMarkdown
                                ? preparation.documents.slice(1).map(
                                    /**
                                     * 各項目からsource・pathを取り出して一覧化する。
                                     * @param item - リンク先Markdownのソースパスと本文を含むHtmlDocument。
                                     * @returns source・pathを取り出した変換結果の一覧。
                                     */
                                    (item) => ({ id: item.sourcePath, markdown: item.markdown }))
                                : [];
                            const renderedDocuments = linkedDocuments.length
                                ? await this.requestHtmlDocumentRender(panel, message.requestId, linkedDocuments)
                                : [];
                            return writePreparedHtml(request, preparation, renderedDocuments);
                        }
                    );
                    if (result) {
                        this.post(panel, {
                            type: 'htmlExported',
                            requestId: message.requestId,
                            paths: result.paths.map(
                                /**
                                 * 各項目からfs・pathを取り出して一覧化する。
                                 * @param item - HTML出力先のファイルURI。fsPathを結果通知へ含める。
                                 * @returns fs・pathを取り出した変換結果の一覧。
                                 */
                                (item) => item.fsPath)
                        });
                        void vscode.window.showInformationMessage(this.getMessages().host.htmlExported(result.target.fsPath));
                    } else {
                        this.post(panel, {
                            type: 'operationFailed',
                            requestId: message.requestId,
                            message: this.getMessages().host.saveCanceled
                        });
                    }
                    return;
                }
                case 'renderPdfPreview': {
                    if (!vscode.workspace.isTrusted) {
                        throw new Error(this.getMessages().host.pdfTrustRequired);
                    }
                    const generation = (this.pdfPreviewGenerations.get(panel) ?? 0) + 1;
                    this.pdfPreviewGenerations.set(panel, generation);
                    this.pdfPreviewAbortControllers.get(panel)?.abort();
                    const controller = new AbortController();
                    this.pdfPreviewAbortControllers.set(panel, controller);
                    const previous = this.pdfPreviewChains.get(panel);


                    const isPanelActive = /**
                     * 拡張機能の条件を判定する。
                     * @returns 条件が成立したかを示す真偽値。
                     */ (): boolean => panel.active;
                    const previewPromise = (
                        /**
                         * 要素をifへ渡し、拡張機能の結果または副作用を処理する。
                         * @returns 拡張機能のコールバックが生成する結果。
                         */
                        async () => {
                            if (previous) await previous.catch(
                                /**
                                 * 拡張機能のコールバックとして要素を処理する。
                                 * @returns 副作用を完了し、値は返さない。
                                 */
                                () => undefined);
                            if (this.pdfPreviewGenerations.get(panel) !== generation || !isPanelActive()) return;
                            console.info(`[Markdown Easy Visual Editor] PDF preview queued request started: ${message.requestId}`);
                            try {
                                const pdf = await renderPdf({
                                    html: message.html,
                                    css: message.css,
                                    options: message.options,
                                    documentUri: document.uri,
                                    language: this.getLanguage(),
                                    purpose: 'preview',
                                    signal: controller.signal
                                });
                                if (this.pdfPreviewGenerations.get(panel) !== generation || !isPanelActive()) return;
                                this.post(panel, {
                                    type: 'pdfPreviewReady',
                                    requestId: message.requestId,
                                    pdfBase64: pdf.toString('base64')
                                });
                            } catch (error) {
                                if (!controller.signal.aborted) throw error;
                            } finally {
                                if (this.pdfPreviewAbortControllers.get(panel) === controller) this.pdfPreviewAbortControllers.delete(panel);
                            }
                        })();
                    this.pdfPreviewChains.set(panel, previewPromise);
                    await previewPromise;
                    return;
                }
            }
        } catch (error) {
            // 編集要求は再同期へ、それ以外の要求は失敗通知へ変換する。
            if (message.type === 'localChanges') {
                const documentKey = document.uri.toString();
                const operationKey = operationIdentity(message.clientId, message.opId);
                this.activeOperations.delete(operationKey);
                if (this.activeOperationKeysByDocument.get(documentKey) === operationKey) {
                    this.activeOperationKeysByDocument.delete(documentKey);
                }
                this.sendResync(panel, document, message.clientId, message.opId, error instanceof Error ? error.message : String(error));
                return;
            }
            if (message.type === 'historyCommand') {
                console.warn('[Markdown Easy Visual Editor] History command was not executed.', error);
                return;
            }
            const requestId = 'requestId' in message ? message.requestId : undefined;
            const text = error instanceof Error ? error.message : String(error);
            this.post(panel, { type: 'operationFailed', requestId, message: text });
            void vscode.window.showErrorMessage(`${this.getMessages().host.errorPrefix}: ${text}`);
        }
    }

    /**
     * 拡張機能の変更または利用者の操作意図を記録し、後続処理へ渡す。
     * @param document - 編集またはUndo/Redo対象のTextDocument。
     * @param panel - 編集またはUndo/Redo要求元のWebviewPanel。
     * @param message - HostとWebviewの間で受け渡すメッセージ。
     * @returns 副作用を完了し、値は返さない。
     */
    private async queueWebviewEdit(
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel,
        message: Extract<WebviewToHostMessage, {
            /**
             * 拡張機能で対象や分岐を識別する値の型。
             */
            type: 'localChanges'
        }>
    ): Promise<void> {
        // 同一文書のWebview編集を前の編集完了後に直列実行する。
        const key = document.uri.toString();
        const previous = this.editChains.get(key) ?? Promise.resolve();
        const current = previous
            .catch(
                /**
                 * 拡張機能のコールバックとして要素を処理する。
                 * @returns 副作用を完了し、値は返さない。
                 */
                () => undefined)
            .then(
                /**
                 * 要素をapply・webview・editへ渡し、拡張機能の結果または副作用を処理する。
                 * @returns 副作用を完了し、値は返さない。
                 */
                () => this.applyWebviewEdit(document, panel, message));
        this.editChains.set(key, current);
        try {
            await current;
        } finally {
            if (this.editChains.get(key) === current) this.editChains.delete(key);
        }
    }

    /**
     * 拡張機能の変更または利用者の操作意図を記録し、後続処理へ渡す。
     * @param document - 編集またはUndo/Redo対象のTextDocument。
     * @param panel - 編集またはUndo/Redo要求元のWebviewPanel。
     * @param message - HostとWebviewの間で受け渡すメッセージ。
     * @returns 副作用を完了し、値は返さない。
     */
    private async queueHistoryCommand(
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel,
        message: Extract<WebviewToHostMessage, {
            /**
             * 拡張機能で対象や分岐を識別する値の型。
             */
            type: 'historyCommand'
        }>
    ): Promise<void> {
        // Undo/Redo要求を同一文書の編集キューへ追加し、アクティブなパネルだけで実行する。
        const key = document.uri.toString();
        const previous = this.editChains.get(key) ?? Promise.resolve();
        const current = previous
            .then(
                /**
                 * 要素をgetへ渡し、拡張機能の結果または副作用を処理する。
                 * @returns 副作用を完了し、値は返さない。
                 */
                async () => {
                    const registeredClientId = this.panelClientIds.get(panel);
                    if (registeredClientId && registeredClientId !== message.clientId) {
                        throw new Error(this.getMessages().host.clientIdMismatch);
                    }
                    if (!panel.active || this.activePanel !== panel || this.activeDocument !== document) return;
                    this.activePanel = panel;
                    this.activeDocument = document;
                    await vscode.commands.executeCommand(message.command);
                });
        this.editChains.set(key, current);
        try {
            await current;
        } finally {
            if (this.editChains.get(key) === current) this.editChains.delete(key);
        }
    }

    /**
     * 拡張機能の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param document - 編集またはUndo/Redo対象のTextDocument。
     * @param panel - 編集またはUndo/Redo要求元のWebviewPanel。
     * @param message - HostとWebviewの間で受け渡すメッセージ。
     * @returns 副作用を完了し、値は返さない。
     * @throws クライアント不一致または差分範囲が不正な場合。
     */
    private async applyWebviewEdit(
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel,
        message: Extract<WebviewToHostMessage, {
            /**
             * 拡張機能で対象や分岐を識別する値の型。
             */
            type: 'localChanges'
        }>
    ): Promise<void> {
        hostDebug('[MVE host] localChanges received', {
            document: document.uri.toString(),
            clientId: message.clientId,
            opId: message.opId,
            baseVersion: message.baseVersion,
            documentVersion: document.version,
            changeCount: message.changes.length,
            changes: message.changes.slice(0, 8)
        });
        // Webviewの差分を履歴へ照合し、必要なら最新位置へ写像してWorkspaceEditを適用する。
        const key = document.uri.toString();
        const registeredClientId = this.panelClientIds.get(panel);
        if (registeredClientId && registeredClientId !== message.clientId) {
            throw new Error(this.getMessages().host.clientIdMismatch);
        }
        const previousApplication = (this.changeHistory.get(key) ?? []).find(
            /**
             * client・idが条件に一致する最初のエントリを取得する。
             * @param entry - 同じWebview clientIdと操作IDの適用記録かを調べる変更履歴。
             * @returns 条件に一致した最初の要素。未検出時はundefined。
             */
            (entry) => (
                entry.clientId === message.clientId && entry.opId === message.opId
            ));
        if (previousApplication) {
            // 同じ操作IDの再送には保存済みACKを返し、WorkspaceEditを二重適用しない。
            this.post(panel, {
                type: 'editAck',
                clientId: message.clientId,
                opId: message.opId,
                baseVersion: previousApplication.baseVersion,
                version: previousApplication.version,
                changes: previousApplication.changes
            });
            return;
        }

        const currentCanonicalText = this.canonicalText(document);
        const knownCanonicalText = this.canonicalDocumentTexts.get(key);
        if (knownCanonicalText !== undefined && knownCanonicalText !== currentCanonicalText) {
            this.sendResync(panel, document, message.clientId, message.opId, '文書変更通知より先に本文差分を検出したため再同期します。');
            return;
        }
        let changes = message.changes;
        let baseLength = currentCanonicalText.length;
        if (message.baseVersion !== document.version) {
            // 古いバージョンからの差分は履歴を順に適用して現在の本文位置へ写像する。
            const history = this.historySince(key, message.baseVersion, document.version);
            if (!history) {
                this.sendResync(panel, document, message.clientId, message.opId, '差分履歴が不足しているため再同期します。');
                return;
            }
            baseLength = history[0]?.baseLength ?? baseLength;
            validateTextChanges(changes, baseLength);
            for (const entry of history) {
                const before = message.clientId.localeCompare(entry.clientId ?? 'host') < 0;
                changes = mapTextChanges(changes, entry.changes, entry.baseLength, before);
            }
            baseLength = currentCanonicalText.length;
        }
        validateTextChanges(changes, baseLength);
        const baseText = currentCanonicalText;
        // 変更後に期待する本文を計算し、実質的に変更がない要求はACKだけ返す。
        const expected = applyTextChanges(baseText, changes);
        if (expected === baseText) {
            this.post(panel, {
                type: 'editAck',
                clientId: message.clientId,
                opId: message.opId,
                baseVersion: document.version,
                version: document.version,
                changes: []
            });
            return;
        }
        const operationKey = operationIdentity(message.clientId, message.opId);
        this.activeOperations.set(operationKey, {
            panel,
            clientId: message.clientId,
            opId: message.opId,
            appliedBaseVersion: document.version,
            baseText,
            expectedText: expected,
            changes
        });
        this.activeOperationKeysByDocument.set(key, operationKey);
        // 適用中の操作を記録し、後続の文書変更通知で自分の書き込みと判定できるようにする。
        const applied = await applyChangeBatch(document, baseText, changes);
        hostDebug('[MVE host] localChanges apply result', {
            document: document.uri.toString(),
            opId: message.opId,
            applied,
            changeCount: changes.length,
            documentVersion: document.version
        });
        if (!applied) {
            this.activeOperations.delete(operationKey);
            if (this.activeOperationKeysByDocument.get(key) === operationKey) this.activeOperationKeysByDocument.delete(key);
            this.sendResync(panel, document, message.clientId, message.opId, 'WorkspaceEditが差分を適用できませんでした。');
            return;
        }
        // 文書変更通知が届くまで1tick待ち、適用済み操作の判定情報を保持する。
        await new Promise<void>(
            /**
             * 遅延処理の完了または失敗を待機側へ通知する。
             * @param resolve - Promiseの成功を通知する関数。
             * @returns 非同期処理の完了値。
             */
            (resolve) => setTimeout(resolve, 0));
        const active = this.activeOperations.get(operationKey);
        if (active?.opId === message.opId) {
            this.activeOperations.delete(operationKey);
            if (this.activeOperationKeysByDocument.get(key) === operationKey) this.activeOperationKeysByDocument.delete(key);
            if (this.canonicalText(document) !== active.expectedText) {
                this.sendResync(panel, document, message.clientId, message.opId, '適用後の文書が期待値と一致しません。');
            } else {
                this.post(panel, {
                    type: 'editAck',
                    clientId: message.clientId,
                    opId: message.opId,
                    baseVersion: active.appliedBaseVersion,
                    version: document.version,
                    changes: active.changes
                });
            }
        }
    }

    /**
     * VS Codeから受け取った文書変更を履歴と各Webviewの状態へ反映する。
     * @param event - 変更された文書と変更範囲を含むVS CodeのTextDocumentChangeEvent。
     * @returns 副作用を完了し、値は返さない。
     */
    private onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
        // VS Codeの変更通知を履歴へ保存し、操作元にはACK、他のパネルには外部変更を通知する。
        const key = event.document.uri.toString();
        const panels = this.panels.get(key);
        if (!panels) return;
        const operationKey = this.activeOperationKeysByDocument.get(key);
        const active = operationKey ? this.activeOperations.get(operationKey) : undefined;
        const nextCanonicalText = toCanonicalText(event.document.getText());
        const previousCanonicalText = this.canonicalDocumentTexts.get(key);
        if (previousCanonicalText === undefined) {
            // パネル登録中は本来到達しない。履歴の基準を捏造せず、現在スナップショットを正として再同期する。
            this.canonicalDocumentTexts.set(key, nextCanonicalText);
            for (const panel of panels) {
                const clientId = this.panelClientIds.get(panel);
                if (clientId) this.sendResync(panel, event.document, clientId, undefined, '同期基準本文を再構築しました。');
            }
            return;
        }

        let changes: TextChange[];
        if (previousCanonicalText === nextCanonicalText) {
            // EOLだけの変更は同期本文上ではno-op。ただしversion遷移は履歴へ残す。
            changes = [];
        } else {
            try {
                changes = canonicalizeContentChanges(previousCanonicalText, event.contentChanges);
                if (applyTextChanges(previousCanonicalText, changes) !== nextCanonicalText) {
                    changes = computeTextChanges(previousCanonicalText, nextCanonicalText);
                }
            } catch (error) {
                console.warn('[Markdown Easy Visual Editor] 文書変更をLF座標へ変換できないため全文差分へフォールバックします。', error);
                changes = computeTextChanges(previousCanonicalText, nextCanonicalText);
            }
        }
        this.canonicalDocumentTexts.set(key, nextCanonicalText);
        hostDebug('[MVE host] document changed', {
            document: key,
            version: event.document.version,
            changeCount: changes.length,
            changes: changes.slice(0, 8),
            activeOpId: active?.opId
        });
        const baseVersion = event.document.version - 1;
        const baseLength = previousCanonicalText.length;
        const matchesActiveOperation = Boolean(
            active
            && baseVersion === active.appliedBaseVersion
            // 変更配列の形ではなく、同じ基準版から期待本文へ到達したかで自分の操作を判定する。
            && nextCanonicalText === active.expectedText
        );
        const entry: ChangeHistoryEntry = {
            baseVersion,
            version: event.document.version,
            baseLength,
            changes,
            clientId: matchesActiveOperation ? active?.clientId : undefined,
            opId: matchesActiveOperation ? active?.opId : undefined
        };
        const history = this.changeHistory.get(key) ?? [];
        history.push(entry);
        if (history.length > 200) history.splice(0, history.length - 200);
        this.changeHistory.set(key, history);
        for (const panel of panels) {
            // 自分の操作が期待値と一致しない場合は、重複適用を避けて後段の再同期へ任せる。
            if (active && panel === active.panel && !matchesActiveOperation) continue;
            if (matchesActiveOperation && active && panel === active.panel) {
                this.post(panel, {
                    type: 'editAck',
                    clientId: active.clientId,
                    opId: active.opId,
                    baseVersion,
                    version: event.document.version,
                    changes
                });
            } else {
                this.post(panel, {
                    type: 'externalChanges',
                    baseVersion,
                    version: event.document.version,
                    changes,
                    clientId: matchesActiveOperation ? active?.clientId : undefined,
                    opId: matchesActiveOperation ? active?.opId : undefined
                });
            }
        }
        if (active) {
            if (operationKey) this.activeOperations.delete(operationKey);
            this.activeOperationKeysByDocument.delete(key);
            if (!matchesActiveOperation) {
                this.sendResync(
                    active.panel,
                    event.document,
                    active.clientId,
                    active.opId,
                    'Webview差分の適用中に別の文書変更を検出したため再同期します。'
                );
            }
        }
    }

    /**
     * 拡張機能のhistory・sinceを処理し、呼び出し側へ結果または副作用を返す。
     * @param key - 文書URI文字列。変更履歴Mapの検索キーとして使う。
     * @param fromVersion - 履歴を開始する文書バージョン。
     * @param toVersion - 履歴を終える文書バージョン。
     * @returns 副作用を完了し、値は返さない。
     */
    private historySince(key: string, fromVersion: number, toVersion: number): ChangeHistoryEntry[] | undefined {
        // 指定されたバージョン範囲を連続して埋める履歴だけを抽出し、欠落時は再同期を要求できるようにする。
        const entries = (this.changeHistory.get(key) ?? [])
            .filter(
                /**
                 * base・versionの条件を満たすエントリだけを残す。
                 * @param entry - 指定バージョン範囲に重なる変更履歴エントリー。
                 * @returns 条件を満たした要素だけを含む一覧。
                 */
                (entry) => entry.baseVersion >= fromVersion && entry.version <= toVersion)
            .sort(
                /**
                 * 2つの値を比較して並び順を決める。
                 * @param left - baseVersionを比較する左側の変更履歴エントリー。
                 * @param right - baseVersionを比較する右側の変更履歴エントリー。
                 * @returns 2つの要素の順序を示す数値。
                 */
                (left, right) => left.baseVersion - right.baseVersion);
        let version = fromVersion;
        for (const entry of entries) {
            if (entry.baseVersion !== version) return undefined;
            version = entry.version;
        }
        return version === toVersion ? entries : undefined;
    }

    /**
     * 拡張機能のwas・operation・appliedを処理し、呼び出し側へ結果または副作用を返す。
     * @param key - 文書URI文字列。変更履歴Mapの検索キーとして使う。
     * @param clientId - Webviewクライアント登録を識別するID。
     * @param opId - Webviewが編集要求ごとに付与した操作ID。
     * @returns 指定クライアントの操作IDが変更履歴に記録されているか。
     */
    private wasOperationApplied(key: string, clientId: string, opId: string): boolean {
        // 履歴からクライアントIDと操作IDが一致する適用済み操作を検索する。
        return (this.changeHistory.get(key) ?? []).some(
            /**
             * 拡張機能のコールバックとしてエントリを処理する。
             * @param entry - 指定clientIdと操作IDが適用済みかを判定する変更履歴エントリー。
             * @returns 副作用を完了し、値は返さない。
             */
            (entry) => (
                entry.clientId === clientId && entry.opId === opId
            ));
    }

    /**
     * 拡張機能の変更または要求をHost・Webview間へ通知する。
     * @param panel - 再同期要求を送るWebviewPanel。
     * @param document - 再同期対象のTextDocument。
     * @param clientId - Webviewクライアント登録を識別するID。
     * @param opId - Webviewが編集要求ごとに付与した省略可能な操作ID。
     * @param reason - Webviewへ再同期を求める理由の説明文。
     * @returns 副作用を完了し、値は返さない。
     */
    private sendResync(
        panel: vscode.WebviewPanel,
        document: vscode.TextDocument,
        clientId: string,
        opId: string | undefined,
        reason: string
    ): void {
        // 最新本文・バージョン・操作適用状態をパネルへ送り、クライアントを再同期させる。
        this.post(panel, {
            type: 'resyncRequired',
            clientId,
            opId,
            operationApplied: opId ? this.wasOperationApplied(document.uri.toString(), clientId, opId) : undefined,
            text: this.canonicalText(document),
            version: document.version,
            reason
        });
    }

    /**
     * 拡張機能の条件を判定する。
     * @param document - LF正規化した本文を取得するTextDocument。
     * @returns 文書の改行をLFに統一した本文。
     */
    private canonicalText(document: vscode.TextDocument): string {
        return toCanonicalText(document.getText());
    }

    /**
     * 拡張機能の値を保存先または共有状態へ書き出す。
     * @param document - 貼付画像の参照先となるMarkdown文書。
     * @param images - 文書へ保存する画像ペイロードの一覧。
     * @param imageDirectory - 文書フォルダーを基準に展開する画像保存先ルール。
     * @returns 拡張機能で利用する文字列。
     * @throws 未保存文書、サイズ超過、未対応形式、または保存失敗の場合。
     */
    private async saveImages(
        document: vscode.TextDocument,
        images: ImagePayload[],
        imageDirectory = this.getSettings(document).imageDirectory
    ): Promise<string[]> {
        // 画像を設定された保存先へ書き込み、Markdownから参照する相対パスを返す。
        const messages = this.getMessages();
        if (document.uri.scheme === 'untitled') throw new Error(messages.host.imageDocumentMustBeSaved);
        if (!images.length) return [];
        const settings = this.getSettings(document);
        const maxBytes = settings.maxPasteSizeMb * 1024 * 1024;
        const assetDirectory = await this.ensureAssetDirectory(document, imageDirectory);
        const results: string[] = [];

        for (const image of images) {
            // Base64をバイト列へ戻し、サイズ・形式・SVGの安全性を確認して保存する。
            let bytes = Buffer.from(image.base64, 'base64');
            if (bytes.byteLength > maxBytes) {
                throw new Error(messages.app.errors.imageSize(settings.maxPasteSizeMb));
            }
            const extension = extensionForMime(image.mime) ?? imageExtensionFromName(image.name, image.mime);
            if (!extension) throw new Error(messages.host.unsupportedImage(image.mime));
            if (extension === 'svg') bytes = Buffer.from(sanitizeSvg(bytes.toString('utf8')), 'utf8');
            const timestamp = compactTimestamp(new Date());
            const name = `pasted-${timestamp}-${randomBytes(3).toString('hex')}.${extension}`;
            const target = vscode.Uri.joinPath(assetDirectory, name);
            await vscode.workspace.fs.writeFile(target, bytes);
            results.push(relativeUriPath(document.uri, target));
        }
        return results;
    }

    /**
     * 拡張機能のpick・and・save・imagesを処理し、呼び出し側へ結果または副作用を返す。
     * @param document - 画像ファイルを保存する対象Markdown文書。
     * @param imageDirectory - 文書フォルダーを基準に展開する画像保存先ルール。
     * @returns 拡張機能で利用する文字列。
     */
    private async pickAndSaveImages(document: vscode.TextDocument, imageDirectory: string): Promise<string[]> {
        // ファイル選択ダイアログで画像を選び、保存処理が受け取れるペイロードへ変換する。
        const selected = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'apng', 'ico', 'heic', 'heif', 'jxl', 'tif', 'tiff'] },
            openLabel: this.getMessages().ribbon.labels.image
        });
        if (!selected?.length) return [];
        const payloads: ImagePayload[] = [];
        for (const uri of selected) {
            // 選択ファイルを読み込み、ファイル名・MIMEタイプ・Base64本文をまとめる。
            const bytes = await vscode.workspace.fs.readFile(uri);
            payloads.push({
                name: path.basename(uri.fsPath),
                mime: mimeForFile(uri.path),
                base64: Buffer.from(bytes).toString('base64')
            });
        }
        return this.saveImages(document, payloads, imageDirectory);
    }

    /**
     * 拡張機能のensure・asset・directoryを処理し、呼び出し側へ結果または副作用を返す。
     * @param document - 画像保存先を解決する対象文書。
     * @param imageDirectory - 文書フォルダーを基準に展開する画像保存先ルール。
     * @returns 拡張機能の非同期処理で得られる結果。
     * @throws 絶対パスや親ディレクトリを含む安全でない設定の場合。
     */
    private async ensureAssetDirectory(document: vscode.TextDocument, imageDirectory: string): Promise<vscode.Uri> {
        // 設定値のプレースホルダーを展開し、安全な相対パスの画像保存先を作成する。
        const normalized = resolveImageDirectoryRule(
            imageDirectory,
            path.basename(document.uri.fsPath, path.extname(document.uri.fsPath))
        );
        if (!normalized) {
            throw new Error(this.getMessages().host.invalidImageDirectory);
        }
        const target = normalized === '.'
            ? vscode.Uri.joinPath(document.uri, '..')
            : vscode.Uri.joinPath(document.uri, '..', ...normalized.split('/'));
        await vscode.workspace.fs.createDirectory(target);
        return target;
    }

    /**
     * 拡張機能の表示または操作を開始する。
     * @param document - リンク参照を解決して開く基準Markdown文書。
     * @param href - Markdown内のリンク先文字列。相対参照、ファイルパス、file URI、Webview URL、外部URLを受け取る。
     * @returns 副作用を完了し、値は返さない。
     */
    private async openResource(document: vscode.TextDocument, href: string): Promise<void> {
        const target = classifyResourceLink(href);
        if (target.kind === 'invalidLocalWebview') return;
        if (target.kind === 'localWebview') {
            await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(target.path));
            return;
        }
        if (target.kind === 'external') {
            await vscode.env.openExternal(vscode.Uri.parse(target.href));
            return;
        }
        if (target.kind === 'absoluteFile') {
            const uri = resolveLocalResourceUri(document.uri, decodeLocalResourceSource(target.href));
            if (uri) await vscode.commands.executeCommand('vscode.open', uri);
            return;
        }
        const uri = resolveLocalResourceUri(document.uri, decodeLocalResourceSource(target.href));
        if (uri) await vscode.commands.executeCommand('vscode.open', uri);
    }

    /**
     * 拡張機能の入力と不変条件を検証し、違反時に失敗を通知する。
     * @param document - ローカルリソース診断を行うTextDocument。
     * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
     * @returns 条件が成立したかを示す真偽値。
     */
    private async checkLocalResources(document: vscode.TextDocument, markdown: string): Promise<Diagnostic[]> {
        const references = collectLocalResourceReferences(markdown);
        const diagnostics = await Promise.all(references.map(
            /**
             * 各referenceからsourceを取り出して一覧化する。
             * @param reference - 診断対象のsourceと種別を持つローカルリソース参照。
             * @returns sourceを取り出した変換結果の一覧。
             */
            async (reference): Promise<Diagnostic | undefined> => {
                const target = resolveLocalResourceUri(document.uri, reference.source);
                if (!target) return undefined;
                try {
                    await vscode.workspace.fs.stat(target);
                    return undefined;
                } catch (error) {
                    const detail = error instanceof Error ? ` (${error.message})` : '';
                    const missing = isMissingResourceError(error);
                    return {
                        severity: missing ? 'warning' : 'error',
                        code: missing
                            ? reference.kind === 'image' ? 'missing-local-image' : 'missing-local-link'
                            : 'local-resource-check-failed',
                        line: reference.line,
                        source: reference.source,
                        message: this.getMessages().diagnostics.localResource(reference.kind, missing, reference.source, detail)
                    };
                }
            }));
        return sortDiagnostics(diagnostics.filter(
            /**
             * 条件を満たす項目だけを残す。
             * @param item - リソース検査が返した診断。undefinedでなければ一覧に残す。
             * @returns 条件を満たした要素だけを含む一覧。
             */
            (item): item is Diagnostic => item !== undefined));
    }

    /**
     * VS Code設定とワークスペース信頼状態をWebviewへ渡す設定にまとめる。
     * 文書URIは文書スコープの設定参照に使い、アプリ全体の表示・出力設定はglobal値を使う。
     * @param document 設定の文書スコープを決める文書。省略時はglobalの値を参照する。
     * @returns Webviewの初期化・設定更新に使う設定一式。
     */
    private getSettings(document?: vscode.TextDocument): WebviewSettings {
        // VS Code設定とワークスペース信頼状態をWebview用の設定オブジェクトへまとめる。
        const config = vscode.workspace.getConfiguration('markdownEasyVisualEditor', document?.uri);
        return {
            ...this.getFontSettings(config),
            language: this.getLanguage(),
            imageDirectory: config.get('images.directory', 'assets/${documentBasename}'),
            maxPasteSizeMb: config.get('images.maxPasteSizeMb', 20),
            remoteImagesEnabled: config.get('remoteImages.enabled', false),
            mermaidTheme: config.get('mermaid.theme', 'auto'),
            mermaidHostRendering: true,
            editorTheme: config.get<WebviewSettings['editorTheme']>('editor.theme', 'dark'),
            viewMode: normalizeViewMode(this.getGlobalSetting(
                config,
                GLOBAL_CONFIGURATION_KEYS.viewMode,
                this.context.globalState.get<unknown>(VIEW_MODE_STATE_KEY),
                'both'
            )),
            outlineVisible: this.getGlobalSetting(
                config,
                GLOBAL_CONFIGURATION_KEYS.outlineVisible,
                this.context.globalState.get<boolean>(OUTLINE_VISIBLE_STATE_KEY),
                true
            ),
            scrollSyncEnabled: this.getGlobalSetting(
                config,
                GLOBAL_CONFIGURATION_KEYS.scrollSyncEnabled,
                this.context.globalState.get<boolean>(SCROLL_SYNC_STATE_KEY),
                true
            ),
            previewImageResizeControlsVisible: this.getGlobalSetting(
                config,
                GLOBAL_CONFIGURATION_KEYS.previewImageResizeControlsVisible,
                this.context.globalState.get<boolean>(PREVIEW_IMAGE_RESIZE_CONTROLS_STATE_KEY),
                true
            ),
            pdfOptions: this.getPdfOptions(config),
            htmlOptions: this.getHtmlOptions(config),
            workspaceTrusted: vscode.workspace.isTrusted,
            startupProbe: this.startupBenchmarkEnabled || undefined
        };
    }

    /**
     * global設定、移行中の旧値、既定値を優先順に解決し、PDF設定を正規化する。
     * @param config PDF設定を読むmarkdownEasyVisualEditor構成。省略時はglobal構成を使う。
     * @returns 数値・余白・用紙値を正規化し、プレビュー用フォントを同期したPDF設定。
     */
    private getPdfOptions(
        config = vscode.workspace.getConfiguration('markdownEasyVisualEditor')
    ): NormalizedPdfOptions {
        const legacy = this.getLegacyPdfOptions();
        const read = /**
         * global値、旧保存値、既定値の順に設定値を読み取る。
         * @param key - VS Code設定のキー。
         * @param legacyValue - global設定にない場合に使う旧保存値。
         * @param defaultValue - global設定と旧保存値の両方がない場合に使う既定値。
         * @returns 優先規則で選択した設定値。
         */ <T>(key: string, legacyValue: T | undefined, defaultValue: T): T =>
            this.getGlobalSetting(config, key, legacyValue, defaultValue);
        const options = normalizePdfOptions({
            format: read(GLOBAL_CONFIGURATION_KEYS.pdf.format, legacy?.format, DEFAULT_PDF_OPTIONS.format),
            orientation: read(GLOBAL_CONFIGURATION_KEYS.pdf.orientation, legacy?.orientation, DEFAULT_PDF_OPTIONS.orientation),
            margins: {
                top: read(GLOBAL_CONFIGURATION_KEYS.pdf.marginTop, legacy?.margins.top, DEFAULT_PDF_OPTIONS.margins.top),
                right: read(GLOBAL_CONFIGURATION_KEYS.pdf.marginRight, legacy?.margins.right, DEFAULT_PDF_OPTIONS.margins.right),
                bottom: read(GLOBAL_CONFIGURATION_KEYS.pdf.marginBottom, legacy?.margins.bottom, DEFAULT_PDF_OPTIONS.margins.bottom),
                left: read(GLOBAL_CONFIGURATION_KEYS.pdf.marginLeft, legacy?.margins.left, DEFAULT_PDF_OPTIONS.margins.left)
            },
            header: read(GLOBAL_CONFIGURATION_KEYS.pdf.header, legacy?.header, DEFAULT_PDF_OPTIONS.header),
            footer: read(GLOBAL_CONFIGURATION_KEYS.pdf.footer, legacy?.footer, DEFAULT_PDF_OPTIONS.footer),
            bodyFontSize: read(GLOBAL_CONFIGURATION_KEYS.pdf.bodyFontSize, legacy?.bodyFontSize, DEFAULT_PDF_OPTIONS.bodyFontSize),
            headingFontSizes: {
                h1: read(GLOBAL_CONFIGURATION_KEYS.pdf.headingFontSizeH1, legacy?.headingFontSizes.h1, DEFAULT_PDF_OPTIONS.headingFontSizes.h1),
                h2: read(GLOBAL_CONFIGURATION_KEYS.pdf.headingFontSizeH2, legacy?.headingFontSizes.h2, DEFAULT_PDF_OPTIONS.headingFontSizes.h2),
                h3: read(GLOBAL_CONFIGURATION_KEYS.pdf.headingFontSizeH3, legacy?.headingFontSizes.h3, DEFAULT_PDF_OPTIONS.headingFontSizes.h3),
                h4: read(GLOBAL_CONFIGURATION_KEYS.pdf.headingFontSizeH4, legacy?.headingFontSizes.h4, DEFAULT_PDF_OPTIONS.headingFontSizes.h4),
                h5: read(GLOBAL_CONFIGURATION_KEYS.pdf.headingFontSizeH5, legacy?.headingFontSizes.h5, DEFAULT_PDF_OPTIONS.headingFontSizes.h5),
                h6: read(GLOBAL_CONFIGURATION_KEYS.pdf.headingFontSizeH6, legacy?.headingFontSizes.h6, DEFAULT_PDF_OPTIONS.headingFontSizes.h6)
            },
            codeFontSize: read(GLOBAL_CONFIGURATION_KEYS.pdf.codeFontSize, legacy?.codeFontSize, DEFAULT_PDF_OPTIONS.codeFontSize),
            lineHeight: read(GLOBAL_CONFIGURATION_KEYS.pdf.lineHeight, legacy?.lineHeight, DEFAULT_PDF_OPTIONS.lineHeight),
            paragraphSpacing: read(GLOBAL_CONFIGURATION_KEYS.pdf.paragraphSpacing, legacy?.paragraphSpacing, DEFAULT_PDF_OPTIONS.paragraphSpacing),
            saveWithoutDialog: read(GLOBAL_CONFIGURATION_KEYS.pdf.saveWithoutDialog, legacy?.saveWithoutDialog, DEFAULT_PDF_OPTIONS.saveWithoutDialog)
        });
        const fontSettings = this.getFontSettings(config);
        return {
            ...options,
            fontFamily: fontSettings.previewFontFamily || DEFAULT_PDF_OPTIONS.fontFamily
        };
    }

    /**
     * global設定、移行中の旧値、既定値からHTML出力オプションを組み立てる。
     * @param config HTML出力設定を読むmarkdownEasyVisualEditor構成。省略時はglobal構成を使う。
     * @returns 画像埋め込み・リンク変換・保存ダイアログのHTML出力設定。
     */
    private getHtmlOptions(
        config = vscode.workspace.getConfiguration('markdownEasyVisualEditor')
    ): HtmlExportSettings {
        const legacyValue = this.context.globalState.get<unknown>(HTML_OPTIONS_STATE_KEY);
        const legacy = legacyValue === undefined ? undefined : normalizeHtmlExportSettings(legacyValue);
        return {
            embedImages: this.getGlobalSetting(
                config,
                GLOBAL_CONFIGURATION_KEYS.html.embedImages,
                legacy?.embedImages,
                DEFAULT_HTML_EXPORT_SETTINGS.embedImages
            ),
            convertLinkedMarkdown: this.getGlobalSetting(
                config,
                GLOBAL_CONFIGURATION_KEYS.html.convertLinkedMarkdown,
                legacy?.convertLinkedMarkdown,
                DEFAULT_HTML_EXPORT_SETTINGS.convertLinkedMarkdown
            ),
            saveWithoutDialog: this.getGlobalSetting(
                config,
                GLOBAL_CONFIGURATION_KEYS.html.saveWithoutDialog,
                legacy?.saveWithoutDialog,
                DEFAULT_HTML_EXPORT_SETTINGS.saveWithoutDialog
            )
        };
    }

    /**
     * 旧globalState設定をVS Code設定へ移し、既存のユーザー設定は上書きしない。
     * 移行済み印は全設定の保存が成功した後にだけ記録し、失敗時は次回起動で再試行する。
     */
    private async migrateLegacyGlobalSettings(): Promise<void> {
        if (this.context.globalState.get<boolean>(GLOBAL_SETTINGS_MIGRATION_STATE_KEY, false)) return;

        const config = vscode.workspace.getConfiguration('markdownEasyVisualEditor');
        const updates: Array<[string, unknown]> = [];
        const add = /**
         * 旧値があり、新しいglobal値が未設定の場合だけ移行対象へ追加する。
         * @param key - 移行先のVS Code設定キー。
         * @param value - 旧globalStateから読み取った設定値。
         */ (key: string, value: unknown): void => {
            if (value !== undefined && config.inspect(key)?.globalValue === undefined) {
                updates.push([key, value]);
            }
        };
        const asRecord = /**
         * 旧保存値のオブジェクトだけを安全に各設定へ展開する。
         * @param value - globalStateから読み取った未知の保存値。
         * @returns nullと配列以外のobjectならRecordとして扱った値、それ以外ならundefined。
         */ (value: unknown): Record<string, unknown> | undefined =>
            value !== null && typeof value === 'object' && !Array.isArray(value)
                ? value as Record<string, unknown>
                : undefined;

        const viewMode = this.context.globalState.get<unknown>(VIEW_MODE_STATE_KEY);
        if (viewMode !== undefined) add(GLOBAL_CONFIGURATION_KEYS.viewMode, normalizeViewMode(viewMode));
        const outlineVisible = this.context.globalState.get<boolean>(OUTLINE_VISIBLE_STATE_KEY);
        if (outlineVisible !== undefined) add(GLOBAL_CONFIGURATION_KEYS.outlineVisible, outlineVisible);
        const scrollSyncEnabled = this.context.globalState.get<boolean>(SCROLL_SYNC_STATE_KEY);
        if (scrollSyncEnabled !== undefined) add(GLOBAL_CONFIGURATION_KEYS.scrollSyncEnabled, scrollSyncEnabled);
        const resizeControlsVisible = this.context.globalState.get<boolean>(PREVIEW_IMAGE_RESIZE_CONTROLS_STATE_KEY);
        if (resizeControlsVisible !== undefined) {
            add(GLOBAL_CONFIGURATION_KEYS.previewImageResizeControlsVisible, resizeControlsVisible);
        }

        const legacyFontSettings = normalizeFontFamilySettings(
            this.context.globalState.get<unknown>(FONT_FAMILY_STATE_KEY)
        );
        if (legacyFontSettings) {
            add(GLOBAL_CONFIGURATION_KEYS.editorFontFamily, legacyFontSettings.editorFontFamily);
            add(GLOBAL_CONFIGURATION_KEYS.previewFontFamily, legacyFontSettings.previewFontFamily);
        }

        const legacyPdfRecord = asRecord(this.context.globalState.get<unknown>(PDF_OPTIONS_STATE_KEY));
        if (legacyPdfRecord) {
            const legacyPdf = normalizePdfOptions(legacyPdfRecord);
            if ('format' in legacyPdfRecord) add(GLOBAL_CONFIGURATION_KEYS.pdf.format, legacyPdf.format);
            if ('orientation' in legacyPdfRecord) add(GLOBAL_CONFIGURATION_KEYS.pdf.orientation, legacyPdf.orientation);
            const margins = asRecord(legacyPdfRecord.margins);
            if (margins && 'top' in margins) add(GLOBAL_CONFIGURATION_KEYS.pdf.marginTop, legacyPdf.margins.top);
            if (margins && 'right' in margins) add(GLOBAL_CONFIGURATION_KEYS.pdf.marginRight, legacyPdf.margins.right);
            if (margins && 'bottom' in margins) add(GLOBAL_CONFIGURATION_KEYS.pdf.marginBottom, legacyPdf.margins.bottom);
            if (margins && 'left' in margins) add(GLOBAL_CONFIGURATION_KEYS.pdf.marginLeft, legacyPdf.margins.left);
            if ('header' in legacyPdfRecord) add(GLOBAL_CONFIGURATION_KEYS.pdf.header, legacyPdf.header);
            if ('footer' in legacyPdfRecord) add(GLOBAL_CONFIGURATION_KEYS.pdf.footer, legacyPdf.footer);
            if ('bodyFontSize' in legacyPdfRecord) add(GLOBAL_CONFIGURATION_KEYS.pdf.bodyFontSize, legacyPdf.bodyFontSize);
            const headingFontSizes = asRecord(legacyPdfRecord.headingFontSizes);
            if (headingFontSizes && 'h1' in headingFontSizes) add(GLOBAL_CONFIGURATION_KEYS.pdf.headingFontSizeH1, legacyPdf.headingFontSizes.h1);
            if (headingFontSizes && 'h2' in headingFontSizes) add(GLOBAL_CONFIGURATION_KEYS.pdf.headingFontSizeH2, legacyPdf.headingFontSizes.h2);
            if (headingFontSizes && 'h3' in headingFontSizes) add(GLOBAL_CONFIGURATION_KEYS.pdf.headingFontSizeH3, legacyPdf.headingFontSizes.h3);
            if (headingFontSizes && 'h4' in headingFontSizes) add(GLOBAL_CONFIGURATION_KEYS.pdf.headingFontSizeH4, legacyPdf.headingFontSizes.h4);
            if (headingFontSizes && 'h5' in headingFontSizes) add(GLOBAL_CONFIGURATION_KEYS.pdf.headingFontSizeH5, legacyPdf.headingFontSizes.h5);
            if (headingFontSizes && 'h6' in headingFontSizes) add(GLOBAL_CONFIGURATION_KEYS.pdf.headingFontSizeH6, legacyPdf.headingFontSizes.h6);
            if ('codeFontSize' in legacyPdfRecord) add(GLOBAL_CONFIGURATION_KEYS.pdf.codeFontSize, legacyPdf.codeFontSize);
            if ('lineHeight' in legacyPdfRecord) add(GLOBAL_CONFIGURATION_KEYS.pdf.lineHeight, legacyPdf.lineHeight);
            if ('paragraphSpacing' in legacyPdfRecord) add(GLOBAL_CONFIGURATION_KEYS.pdf.paragraphSpacing, legacyPdf.paragraphSpacing);
            if ('saveWithoutDialog' in legacyPdfRecord) {
                add(GLOBAL_CONFIGURATION_KEYS.pdf.saveWithoutDialog, legacyPdf.saveWithoutDialog);
            }

            if (!legacyFontSettings && 'fontFamily' in legacyPdfRecord) {
                const legacyFontFamily = normalizeFontFamily(legacyPdf.fontFamily);
                const defaultFontFamily = normalizeFontFamily(DEFAULT_PDF_OPTIONS.fontFamily);
                if (legacyFontFamily && legacyFontFamily !== defaultFontFamily) {
                    add(GLOBAL_CONFIGURATION_KEYS.previewFontFamily, legacyFontFamily);
                }
            }
        }

        const legacyHtmlRecord = asRecord(this.context.globalState.get<unknown>(HTML_OPTIONS_STATE_KEY));
        if (legacyHtmlRecord) {
            const legacyHtml = normalizeHtmlExportSettings(legacyHtmlRecord);
            if ('embedImages' in legacyHtmlRecord) add(GLOBAL_CONFIGURATION_KEYS.html.embedImages, legacyHtml.embedImages);
            if ('convertLinkedMarkdown' in legacyHtmlRecord) {
                add(GLOBAL_CONFIGURATION_KEYS.html.convertLinkedMarkdown, legacyHtml.convertLinkedMarkdown);
            }
            if ('saveWithoutDialog' in legacyHtmlRecord) {
                add(GLOBAL_CONFIGURATION_KEYS.html.saveWithoutDialog, legacyHtml.saveWithoutDialog);
            }
        }

        await this.updateGlobalConfiguration(updates, true);
        await this.context.globalState.update(GLOBAL_SETTINGS_MIGRATION_STATE_KEY, true);
    }

    /**
     * global設定を優先し、移行中の旧フォント設定と既定値を使ってフォントを解決する。
     * @param config フォント設定を読むmarkdownEasyVisualEditor構成。省略時はglobal構成を使う。
     * @returns ソースエディターとプレビューで使う正規化済みフォント名。
     */
    private getFontSettings(
        config = vscode.workspace.getConfiguration('markdownEasyVisualEditor')
    ): FontFamilySettings {
        const stored = normalizeFontFamilySettings(
            this.context.globalState.get<unknown>(FONT_FAMILY_STATE_KEY)
        );
        const legacyPdf = this.getLegacyPdfOptions();
        const legacyFontFamily = normalizeFontFamily(legacyPdf?.fontFamily);
        const defaultFontFamily = normalizeFontFamily(DEFAULT_PDF_OPTIONS.fontFamily);
        const legacy = stored ?? {
            ...DEFAULT_FONT_FAMILY_SETTINGS,
            previewFontFamily: legacyFontFamily && legacyFontFamily !== defaultFontFamily
                ? legacyFontFamily
                : DEFAULT_FONT_FAMILY_SETTINGS.previewFontFamily
        };
        return {
            editorFontFamily: normalizeFontFamily(this.getGlobalSetting(
                config,
                GLOBAL_CONFIGURATION_KEYS.editorFontFamily,
                legacy.editorFontFamily,
                DEFAULT_FONT_FAMILY_SETTINGS.editorFontFamily
            )),
            previewFontFamily: normalizeFontFamily(this.getGlobalSetting(
                config,
                GLOBAL_CONFIGURATION_KEYS.previewFontFamily,
                legacy.previewFontFamily,
                DEFAULT_FONT_FAMILY_SETTINGS.previewFontFamily
            ))
        };
    }

    /** 移行完了前だけ旧PDF設定を読み、設定画面を初期化する間の互換表示に使う。 */
    private getLegacyPdfOptions(): NormalizedPdfOptions | undefined {
        if (this.context.globalState.get<boolean>(GLOBAL_SETTINGS_MIGRATION_STATE_KEY, false)) return undefined;
        const legacy = this.context.globalState.get<unknown>(PDF_OPTIONS_STATE_KEY);
        return legacy === undefined ? undefined : normalizePdfOptions(legacy);
    }

    /**
     * 明示されたglobal値、移行前の旧値、構成既定値の順で設定を解決する。
     * 旧値を先に使うことで、非同期移行中にも既存設定が一時的に既定値へ戻るのを防ぐ。
     * @param config 対象キーのglobal値と構成既定値を参照する設定。
     * @param key markdownEasyVisualEditor内のドット区切り設定キー。
     * @param legacyValue 移行前のglobalStateに保存されていた値。未保存ならundefined。
     * @param defaultValue 新旧の保存値がない場合に使う既定値。
     * @returns global値、移行前の値、既定値の順で選んだ設定値。
     */
    private getGlobalSetting<T>(
        config: vscode.WorkspaceConfiguration,
        key: string,
        legacyValue: T | undefined,
        defaultValue: T
    ): T {
        const configuredValue = config.inspect<T>(key)?.globalValue;
        if (configuredValue !== undefined) return configuredValue;
        if (!this.context.globalState.get<boolean>(GLOBAL_SETTINGS_MIGRATION_STATE_KEY, false) &&
            legacyValue !== undefined) {
            return legacyValue;
        }
        return config.get<T>(key, defaultValue);
    }

    /**
     * 設定群の書き込みをExtension Host内で直列化し、中間状態の通知を抑える。
     * 失敗した要求は呼び出し元へ返し、内部キューは後続要求を受け取れる状態へ戻す。
     * @param entries 保存する構成キーと値。配列順を維持して更新する。
     * @param onlyIfGlobalValueIsUnset trueの場合、既存のglobal値があるキーは維持する。
     * @returns 要求したすべての書き込みが完了したPromise。書き込み失敗時はrejectする。
     */
    private updateGlobalConfiguration(
        entries: ReadonlyArray<readonly [string, unknown]>,
        onlyIfGlobalValueIsUnset = false
    ): Promise<void> {
        const update = this.globalSettingsUpdateChain.then(
            /** 一連の書き込みを排他実行し、設定変更イベントの中間通知を抑える。 */
            async () => {
                const config = vscode.workspace.getConfiguration('markdownEasyVisualEditor');
                this.globalConfigurationUpdateDepth += 1;
                let writeAttempted = false;
                let updateFailed = false;
                try {
                    for (const [key, value] of entries) {
                        if (onlyIfGlobalValueIsUnset && config.inspect(key)?.globalValue !== undefined) continue;
                        writeAttempted = true;
                        await config.update(key, value, vscode.ConfigurationTarget.Global);
                    }
                } catch (error) {
                    updateFailed = true;
                    throw error;
                } finally {
                    this.globalConfigurationUpdateDepth -= 1;
                    if (updateFailed && writeAttempted) {
                        try {
                            this.broadcastSettings();
                        } catch (broadcastError) {
                            console.error('Failed to broadcast partially updated Markdown Easy Visual Editor settings.', broadcastError);
                        }
                    }
                }
            });
        this.globalSettingsUpdateChain = update.catch(
            /** 要求元には失敗を返しつつ、内部キューを後続更新に再利用できる状態へ戻す。 */
            () => undefined);
        return update;
    }

    /**
     * 拡張機能の変更または利用者の操作意図を記録し、後続処理へ渡す。
     * @param panel - 起動時間を計測しているWebviewPanel。
     * @param field - 記録する起動計測項目名。
     * @returns 副作用を完了し、値は返さない。
     */
    private markStartup(
        panel: vscode.WebviewPanel,
        field: 'webviewReadyMs' | 'initializedMs' | 'previewReadyMs' | 'firstMermaidRequestedMs' | 'firstMermaidReadyMs'
    ): void {
        const timing = this.panelStartupTimings.get(panel);
        if (!timing || timing[field] !== undefined) return;
        timing[field] = Date.now() - timing.resolveStartedAt;
        if (field === 'previewReadyMs' || field === 'firstMermaidReadyMs') {
            console.info(`[MVE startup] ${JSON.stringify(this.getStartupTiming(timing.uri))}`);
        }
    }

    /**
     * 拡張機能から必要な値またはリソースを取得する。
     * @returns 拡張機能のget・languageが生成する結果。
     */
    private getLanguage() {
        const config = vscode.workspace.getConfiguration('markdownEasyVisualEditor');
        return resolveLanguage(config.get<string>('language', 'auto'), vscode.env.language);
    }

    /**
     * 選択した言語のローカライズ辞書を読み込み、未登録キーをフォールバックで補う。
     * @returns 拡張機能のget・messagesが生成する結果。
     */
    private getMessages(): Messages {
        return getMessages(this.getLanguage());
    }

    /**
     * 拡張機能の変更または要求をHost・Webview間へ通知する。
     * @param panel - HTML描画要求を送り、描画結果を受け取るWebviewPanel。
     * @param requestId - 要求と応答を対応付ける識別子。
     * @param documents - Webviewで描画するリンク先の識別子とMarkdown本文の一覧。
     * @returns 拡張機能に対応する要素の一覧。
     */
    private requestHtmlDocumentRender(
        panel: vscode.WebviewPanel,
        requestId: string,
        documents: Array<{
            /**
             * 拡張機能で扱うidの文字列。
             */
            id: string;
            /** リンク先Markdown本文。 */
            markdown: string
        }>
    ): Promise<HtmlRenderedDocument[]> {
        return new Promise(
            /**
             * 遅延処理の完了または失敗を待機側へ通知する。
             * @param resolve - Promiseの成功を通知する関数。
             * @param reject - Promiseの失敗を通知する関数。
             * @returns 非同期処理の完了値。
             */
            (resolve, reject) => {
                const timer = setTimeout(
                    /**
                     * 指定時間の経過後に後続処理を実行する。
                     * @returns 副作用を完了し、値は返さない。
                     */
                    () => {
                        this.pendingHtmlRenderRequests.delete(requestId);
                        reject(new Error(this.getMessages().host.htmlRenderTimeout));
                    }, 120_000);
                this.pendingHtmlRenderRequests.set(requestId, { resolve, reject, timer });
                this.post(panel, { type: 'renderHtmlDocuments', requestId, documents });
            });
    }

    /**
     * 拡張機能のbroadcast・settingsを処理し、呼び出し側へ結果または副作用を返す。
     * @returns 副作用を完了し、値は返さない。
     */
    private broadcastSettings(): void {
        // 登録されているすべてのパネルへ現在の設定を通知する。
        for (const [key, panels] of this.panels) {
            const settings = this.getSettings(this.documents.get(key));
            for (const panel of panels) {
                this.post(panel, {
                    type: 'settingsChanged',
                    settings
                });
            }
        }
    }

    /**
     * 拡張機能から必要な値またはリソースを取得する。
     * @param webview - リソースURIとCSPを使ってHTMLを生成するWebview。
     * @param document - 初期設定と本文をHTMLに含める対象TextDocument。
     * @returns 拡張機能で利用する文字列。
     */
    private getWebviewHtml(webview: vscode.Webview, document: vscode.TextDocument): string {
        // Webviewで読み込むリソースURIとCSP nonceを作り、安全なHTMLシェルを生成する。
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'));
        const markdownWorkerUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'markdown-worker.js'));
        const markdownRichWorkerUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'markdown-rich-worker.js'));
        const markdownFallbackUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'markdown-fallback.js'));
        const exportFontsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'export-fonts.css'));
        const mermaidUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'mermaid.min.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'styles.css'));
        const bundledStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.css'));
        const baseUri = webview.asWebviewUri(vscode.Uri.joinPath(document.uri, '..'));
        const nonce = randomUUID().replace(/-/g, '');
        const settings = this.getSettings(document);
        const allowRemote = settings.remoteImagesEnabled ? ' https: http:' : '';
        const canonicalText = this.canonicalText(document);
        // 巨大文書をHTML内で複製すると逆にパース・メモリ負荷が増えるため、
        // 通常サイズだけを即時起動し、それ以上は従来のinitメッセージへ戻す。
        const bootstrap = canonicalText.length <= 2 * 1024 * 1024
            ? serializeInlineJson({
                text: canonicalText,
                version: document.version,
                uri: document.uri.toString(),
                settings
            })
            : 'undefined';
        return `<!doctype html>
      <html lang="${this.getLanguage()}">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <base href="${baseUri.toString()}/">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:${allowRemote}; font-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}'; worker-src blob: data:; connect-src ${webview.cspSource} blob:;">
          <link rel="stylesheet" href="${styleUri}">
          <link rel="stylesheet" href="${bundledStyleUri}">
          <title>Markdown Easy Visual Editor</title>
          <script nonce="${nonce}">globalThis.__mveBootstrap=${bootstrap};</script>
        </head>
        <body data-mve-markdown-worker-uri="${markdownWorkerUri.toString()}" data-mve-markdown-rich-worker-uri="${markdownRichWorkerUri.toString()}" data-mve-markdown-fallback-uri="${markdownFallbackUri.toString()}" data-mve-export-fonts-uri="${exportFontsUri.toString()}" data-mve-mermaid-uri="${mermaidUri.toString()}">
          <div id="root"></div>
          <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
      </html>`;
    }

    /**
     * 拡張機能の変更または要求をHost・Webview間へ通知する。
     * @param panel - Hostメッセージの宛先WebviewPanel。
     * @param message - HostとWebviewの間で受け渡すメッセージ。
     * @returns 副作用を完了し、値は返さない。
     */
    private post(panel: vscode.WebviewPanel, message: HostToWebviewMessage): void {
        // Webviewへメッセージを非同期送信する。
        void panel.webview.postMessage(message);
    }
}

/**
 * デバッグが有効な場合に診断情報をコンソールへ記録する。
 * @param message - ログ行の見出しとなる文字列。
 * @param details - ログへ追加する構造化診断データ。
 * @returns 副作用を完了し、値は返さない。
 */
function hostDebug(message: string, details: Record<string, unknown>): void {
    if (process.env.MVE_DEBUG === '1') console.info(message, details);
}

/**
 * 基準本文と現在の文書が一致することを確認してから差分をWorkspaceEditとして適用する。
 * @param document - canonical本文への変更を適用するTextDocument。
 * @param canonicalBaseText 差分計算時点の改行を正規化した本文。
 * @param changes - 本文へ適用する変更範囲の一覧。
 * @returns 条件が成立したかを示す真偽値。
 */
async function applyChangeBatch(
    document: vscode.TextDocument,
    canonicalBaseText: string,
    changes: readonly TextChange[]
): Promise<boolean> {
    // LF同期座標の差分を、現在のVS Code文書EOLを保ったWorkspaceEditへ変換する。
    validateTextChanges(changes, canonicalBaseText.length);
    const currentCanonicalText = toCanonicalText(document.getText());
    if (currentCanonicalText !== canonicalBaseText) {
        throw new Error('Document changed before canonical edit application.');
    }
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const edit = new vscode.WorkspaceEdit();
    for (const change of materializeCanonicalChanges(canonicalBaseText, changes, eol)) {
        edit.replace(
            document.uri,
            new vscode.Range(
                new vscode.Position(change.range.start.line, change.range.start.character),
                new vscode.Position(change.range.end.line, change.range.end.character)
            ),
            change.text
        );
    }
    return vscode.workspace.applyEdit(edit);
}

/**
 * 拡張機能のoperation・identityを処理し、呼び出し側へ結果または副作用を返す。
 * @param clientId - Webviewクライアント登録を識別するID。
 * @param opId - Webview編集要求の操作ID。
 * @returns 拡張機能で利用する文字列。
 */
function operationIdentity(clientId: string, opId: string): string {
    // クライアントIDと操作IDを衝突しない1つのキーへ連結する。
    return `${clientId}\u0000${opId}`;
}

/**
 * 拡張機能の条件を判定する。
 * @param filePath - Markdown拡張子かを判定するファイルパス。
 * @returns 条件が成立したかを示す真偽値。
 */
function isMarkdownDocumentPath(filePath: string): boolean {
    return /\.(?:md|markdown)$/i.test(filePath);
}

/**
 * 拡張機能の入力を許可された形式へ整える。
 * @param value - VS Code設定、旧保存値または既定値から得た表示モード候補。'text'と'preview'以外は'both'へ正規化する。
 * @returns 拡張機能で生成または変換した値。
 */
function normalizeViewMode(value: unknown): ViewMode {
    return value === 'text' || value === 'preview' ? value : 'both';
}

/**
 * 正規化済みPDF設定を順序を保ったVS Code構成キーと保存値の組へ展開する。
 * @param options global構成へ保存する正規化済みPDF設定。
 * @returns VS Codeのglobal構成更新に渡すキーと値の組。
 */
function pdfConfigurationEntries(options: NormalizedPdfOptions): Array<[string, unknown]> {
    return [
        [GLOBAL_CONFIGURATION_KEYS.pdf.format, options.format],
        [GLOBAL_CONFIGURATION_KEYS.pdf.orientation, options.orientation],
        [GLOBAL_CONFIGURATION_KEYS.pdf.marginTop, options.margins.top],
        [GLOBAL_CONFIGURATION_KEYS.pdf.marginRight, options.margins.right],
        [GLOBAL_CONFIGURATION_KEYS.pdf.marginBottom, options.margins.bottom],
        [GLOBAL_CONFIGURATION_KEYS.pdf.marginLeft, options.margins.left],
        [GLOBAL_CONFIGURATION_KEYS.pdf.header, options.header],
        [GLOBAL_CONFIGURATION_KEYS.pdf.footer, options.footer],
        [GLOBAL_CONFIGURATION_KEYS.pdf.bodyFontSize, options.bodyFontSize],
        [GLOBAL_CONFIGURATION_KEYS.pdf.headingFontSizeH1, options.headingFontSizes.h1],
        [GLOBAL_CONFIGURATION_KEYS.pdf.headingFontSizeH2, options.headingFontSizes.h2],
        [GLOBAL_CONFIGURATION_KEYS.pdf.headingFontSizeH3, options.headingFontSizes.h3],
        [GLOBAL_CONFIGURATION_KEYS.pdf.headingFontSizeH4, options.headingFontSizes.h4],
        [GLOBAL_CONFIGURATION_KEYS.pdf.headingFontSizeH5, options.headingFontSizes.h5],
        [GLOBAL_CONFIGURATION_KEYS.pdf.headingFontSizeH6, options.headingFontSizes.h6],
        [GLOBAL_CONFIGURATION_KEYS.pdf.codeFontSize, options.codeFontSize],
        [GLOBAL_CONFIGURATION_KEYS.pdf.lineHeight, options.lineHeight],
        [GLOBAL_CONFIGURATION_KEYS.pdf.paragraphSpacing, options.paragraphSpacing],
        [GLOBAL_CONFIGURATION_KEYS.pdf.saveWithoutDialog, options.saveWithoutDialog]
    ];
}

/**
 * 拡張機能のextension・for・mimeを処理し、呼び出し側へ結果または副作用を返す。
 * @param mime - 画像または出力データのMIMEタイプ。
 * @returns MIMEタイプに対応する安全なファイル拡張子。未対応タイプではundefined。
 */
function extensionForMime(mime: string): string | undefined {
    // MIMEタイプを画像ファイルの拡張子へ変換し、未対応形式はundefinedを返す。
    return (
        {
            'image/png': 'png',
            'image/apng': 'apng',
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/gif': 'gif',
            'image/webp': 'webp',
            'image/svg+xml': 'svg',
            'image/bmp': 'bmp',
            'image/x-ms-bmp': 'bmp',
            'image/avif': 'avif',
            'image/x-icon': 'ico',
            'image/vnd.microsoft.icon': 'ico',
            'image/heic': 'heic',
            'image/heif': 'heif',
            'image/jxl': 'jxl',
            'image/tiff': 'tiff'
        } as Record<string, string>
    )[mime.toLowerCase()];
}


/**
 * 保存を許可する画像拡張子の集合。
 */
const SAFE_IMAGE_EXTENSIONS = new Set([
    'png', 'apng', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif',
    'ico', 'heic', 'heif', 'jxl', 'tif', 'tiff'
]);

/**
 * 拡張機能の入力を検証し、表示または保存に使う形式へ変換する。
 * @param name - 画像ペイロードの元ファイル名。
 * @param mime - 画像または出力データのMIMEタイプ。
 * @returns MIMEタイプが画像で、ファイル名の拡張子が許可される場合はその拡張子。それ以外はundefined。
 */
function imageExtensionFromName(name: string | undefined, mime: string): string | undefined {
    if (!mime.toLowerCase().startsWith('image/') || !name) return undefined;
    const extension = path.extname(name).slice(1).toLowerCase();
    return SAFE_IMAGE_EXTENSIONS.has(extension) ? extension : undefined;
}

/**
 * 拡張機能のmime・for・fileを処理し、呼び出し側へ結果または副作用を返す。
 * @param filePath - 拡張子から画像MIMEタイプを判定するファイルパス。
 * @returns 拡張機能で利用する文字列。
 */
function mimeForFile(filePath: string): string {
    // ファイル拡張子を画像MIMEタイプへ変換し、未対応形式は汎用タイプにする。
    const extension = path.extname(filePath).toLowerCase();
    return (
        {
            '.png': 'image/png',
            '.apng': 'image/apng',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
            '.bmp': 'image/bmp',
            '.avif': 'image/avif',
            '.ico': 'image/x-icon',
            '.heic': 'image/heic',
            '.heif': 'image/heif',
            '.jxl': 'image/jxl',
            '.tif': 'image/tiff',
            '.tiff': 'image/tiff'
        } as Record<string, string>
    )[extension] ?? 'application/octet-stream';
}

/**
 * 拡張機能のrelative・uri・pathを処理し、呼び出し側へ結果または副作用を返す。
 * @param documentUri - 相対パスの基準となるMarkdown文書URI。
 * @param target - Markdown文書からの相対パスを作る保存先URI。
 * @returns 拡張機能で利用する文字列。
 */
function relativeUriPath(documentUri: vscode.Uri, target: vscode.Uri): string {
    // 保存先URIをMarkdown文書からの相対パスへ変換し、仮想URIにも対応する。
    if (documentUri.scheme === 'file' && target.scheme === 'file') {
        return path.relative(path.dirname(documentUri.fsPath), target.fsPath).replace(/\\/g, '/');
    }
    const base = documentUri.path.slice(0, documentUri.path.lastIndexOf('/') + 1);
    return target.path.startsWith(base) ? target.path.slice(base.length) : target.path;
}

/**
 * Markdown内のローカルリソース参照を、文書位置に基づくVS Code URIへ解決する。
 * @param documentUri - 相対参照の基準となるMarkdown文書のURI。
 * @param source - Markdownから取り出した画像などのローカルURIまたはファイルパス。
 * @returns 条件に一致する値。未検出時はundefinedまたはnull。
 */
function resolveLocalResourceUri(documentUri: vscode.Uri, source: string): vscode.Uri | undefined {
    const clean = decodeLocalResourceSource(source);
    if (/^file:/i.test(clean)) return vscode.Uri.parse(clean);
    if (/^[A-Za-z]:[\\/]/.test(clean) && documentUri.scheme === 'file') {
        return vscode.Uri.file(clean.replace(/\\/g, path.sep));
    }
    if (/^\//.test(clean) && !/^\/\//.test(clean) && documentUri.scheme === 'file') {
        return vscode.Uri.file(clean);
    }
    if (/^(?:\\\\|\/\/)/.test(clean) && documentUri.scheme === 'file') {
        return vscode.Uri.file(clean.replace(/[\\/]/g, path.sep));
    }
    if (!clean || /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(clean)) return undefined;
    const segments = clean.replace(/\\/g, '/').split('/').filter(Boolean);
    return segments.length ? vscode.Uri.joinPath(documentUri, '..', ...segments) : undefined;
}

/**
 * 拡張機能のcompact・timestampを処理し、呼び出し側へ結果または副作用を返す。
 * @param date - 画像ファイル名へ含める日時。
 * @returns 拡張機能で利用する文字列。
 */
function compactTimestamp(date: Date): string {
    // 日付と時刻をファイル名に使える連続した文字列へ変換する。
    const parts = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
        '-',
        String(date.getHours()).padStart(2, '0'),
        String(date.getMinutes()).padStart(2, '0'),
        String(date.getSeconds()).padStart(2, '0')
    ];
    return parts.join('');
}

/**
 * 拡張機能の入力を許可された形式へ整える。
 * @param value - 危険な要素や属性を除去するSVGマークアップ文字列。
 * @returns 拡張機能で利用する文字列。
 */
function sanitizeSvg(value: string): string {
    // SVGからスクリプト・イベント属性・危険なURLスキームを除去する。
    return value
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
        .replace(/(?:javascript|data:text\/html):/gi, '');
}

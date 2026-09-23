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

/**
 * 拡張機能を出力または保存できる文字列へ整える。
 * @param value - 検証・変換・保存の対象となる値。
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
 * 拡張機能のpanel・ready・waiterを処理し、呼び出し側へ結果または副作用を返す。
 * @param panel - 拡張機能へ渡す入力。
 * @returns 副作用を完了し、値は返さない。
 */
interface PanelReadyWaiter {
    /**
     * 拡張機能から必要な値またはリソースを取得する。
     * @param panel - 拡張機能へ渡す入力。
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
     * 拡張機能のinitialized・msを示す状態フラグ。
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
 * 拡張機能のactivateを処理し、呼び出し側へ結果または副作用を返す。
 * @param context - 拡張機能で扱う文字列または本文。
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
             * @param uri - VS Codeまたはブラウザーが扱うリソースURI。
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
             * @param uri - VS Codeまたはブラウザーが扱うリソースURI。
             * @returns 拡張機能のコールバックが生成する結果。
             */
            (uri?: vscode.Uri) => provider.exportFromUri('exportPdf', uri)),
        vscode.commands.registerCommand('markdownEasyVisualEditor.exportHtml',
            /**
             * uriをexport・from・uriへ渡し、拡張機能の結果または副作用を処理する。
             * @param uri - VS Codeまたはブラウザーが扱うリソースURI。
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
             * @param uri - VS Codeまたはブラウザーが扱うリソースURI。
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
     * 拡張機能の状態を示すフラグ。
     */
    private readonly pendingHtmlRenderRequests = new Map<string, {
        /**
         * 拡張機能から必要な値またはリソースを取得する。
         * @param documents - 文書URIと開いている文書オブジェクトの対応表。
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

    /**
     * HTML出力設定の更新を直列化するPromise。
     */
    private htmlOptionsUpdateChain: Promise<void> = Promise.resolve();

    /**
     * 旧フォント設定の移行処理を共有するPromise。
     */
    private readonly legacyFontMigration: Promise<void>;

    /**
     * 拡張機能の状態を示すフラグ。
     */
    private activePanel?: vscode.WebviewPanel;

    /**
     * 拡張機能の状態を示すフラグ。
     */
    private activeDocument?: vscode.TextDocument;

    /**
     * 拡張機能で使う値または実行環境を組み立てる。
     * @param context - 拡張機能で扱う文字列または本文。
     * @param startupBenchmarkEnabled - 拡張機能へ渡す入力。
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
                 * イベントをon・document・changedへ渡し、拡張機能の結果または副作用を処理する。
                 * @param event - ユーザー操作またはDOMから通知されたイベント。
                 * @returns 副作用を完了し、値は返さない。
                 */
                (event) => this.onDocumentChanged(event)),
            vscode.workspace.onDidChangeConfiguration(
                /**
                 * イベントをifへ渡し、拡張機能の結果または副作用を処理する。
                 * @param event - ユーザー操作またはDOMから通知されたイベント。
                 * @returns 副作用を完了し、値は返さない。
                 */
                (event) => {
                    if (event.affectsConfiguration('markdownEasyVisualEditor')) this.broadcastSettings();
                }),
            vscode.workspace.onDidGrantWorkspaceTrust(
                /**
                 * 要素をbroadcast・settingsへ渡し、拡張機能の結果または副作用を処理する。
                 * @returns 副作用を完了し、値は返さない。
                 */
                () => this.broadcastSettings())
        );
        this.legacyFontMigration = this.migrateLegacyFontFamily().catch(
            /**
             * 拡張機能のコールバックとして要素を処理する。
             * @returns 副作用を完了し、値は返さない。
             */
            () => undefined);
    }

    /**
     * 拡張機能から必要な値またはリソースを取得する。
     * @param document - 拡張機能へ渡す入力。
     * @param webviewPanel - 拡張機能へ渡す入力。
     * @returns 副作用を完了し、値は返さない。
     */
    async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        // 旧PDFフォント設定の移行完了後に初期設定を送信し、新設定との競合を防ぐ。
        await this.legacyFontMigration;
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
             * @param folder - folderのuriを参照する走査対象。
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
             * イベントをifへ渡し、拡張機能の結果または副作用を処理する。
             * @param event - ユーザー操作またはDOMから通知されたイベント。
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
     * @param uri - VS Codeまたはブラウザーが扱うリソースURI。
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
     * @param command - 拡張機能へ渡す入力。
     * @returns 副作用を完了し、値は返さない。
     */
    sendCommand(command: 'insertImage' | ExportCommand): void {
        // アクティブなWebviewへホストコマンドを送る。
        if (!this.activePanel) return;
        this.post(this.activePanel, { type: 'hostCommand', command });
    }

    /**
     * 拡張機能のexport・from・uriを処理し、呼び出し側へ結果または副作用を返す。
     * @param command - 拡張機能へ渡す入力。
     * @param uri - VS Codeまたはブラウザーが扱うリソースURI。
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
     * @param documentUri - 拡張機能で読み書きするリソースの場所。
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
     * @param documentUri - 拡張機能で読み書きするリソースの場所。
     * @returns 条件に一致する値。未検出時はundefinedまたはnull。
     */
    private findReadyPanel(documentUri: vscode.Uri): vscode.WebviewPanel | undefined {
        const panels = this.panels.get(documentUri.toString());
        return panels ? [...panels].find(
            /**
             * initializedが条件に一致する最初のpanelを取得する。
             * @param panel - panelのinitializedを参照する走査対象。
             * @returns 条件に一致した最初の要素。未検出時はundefined。
             */
            (panel) => this.panelInitialized.has(panel)) : undefined;
    }

    /**
     * 拡張機能が指定条件を満たすまで待機する。
     * @param documentUri - 拡張機能で読み書きするリソースの場所。
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
                     * @param panel - 拡張機能へ渡す入力。
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
     * @param documentKey - 拡張機能の対象や分岐を識別する値。
     * @param panel - 拡張機能へ渡す入力。
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
     * @param documentKey - 拡張機能の対象や分岐を識別する値。
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
     * @param command - 拡張機能へ渡す入力。
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
     * @param document - 拡張機能へ渡す入力。
     * @param panel - 拡張機能へ渡す入力。
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
                    await this.context.globalState.update(FONT_FAMILY_STATE_KEY, fontSettings);
                    const pdfOptions = normalizePdfOptions(
                        this.context.globalState.get<unknown>(PDF_OPTIONS_STATE_KEY, DEFAULT_PDF_OPTIONS)
                    );
                    await this.context.globalState.update(PDF_OPTIONS_STATE_KEY, {
                        ...pdfOptions,
                        fontFamily: fontSettings.previewFontFamily || DEFAULT_PDF_OPTIONS.fontFamily
                    });
                    this.broadcastSettings();
                    return;
                }
                case 'setViewMode':
                    await this.context.globalState.update(VIEW_MODE_STATE_KEY, message.viewMode);
                    this.broadcastSettings();
                    return;
                case 'setOutlineVisible':
                    await this.context.globalState.update(OUTLINE_VISIBLE_STATE_KEY, message.visible);
                    this.broadcastSettings();
                    return;
                case 'setScrollSyncEnabled':
                    await this.context.globalState.update(SCROLL_SYNC_STATE_KEY, message.enabled);
                    this.broadcastSettings();
                    return;
                case 'setPreviewImageResizeControlsVisible':
                    await this.context.globalState.update(PREVIEW_IMAGE_RESIZE_CONTROLS_STATE_KEY, message.visible);
                    this.broadcastSettings();
                    return;
                case 'setPdfOptions':
                    // Webviewからの入力値を正規化して保存し、開いている全Webviewへ同じ設定を通知する。
                    {
                        const fontSettings = this.getFontSettings();
                        const options = normalizePdfOptions(message.options);
                        await this.context.globalState.update(PDF_OPTIONS_STATE_KEY, {
                            ...options,
                            fontFamily: fontSettings.previewFontFamily || DEFAULT_PDF_OPTIONS.fontFamily
                        });
                    }
                    this.broadcastSettings();
                    return;
                case 'setHtmlOptions':
                    {
                        const options = normalizeHtmlExportSettings(message.options);
                        const update = this.htmlOptionsUpdateChain.then(
                            /**
                             * 要素を状態更新へ渡し、拡張機能の結果または副作用を処理する。
                             * @returns 拡張機能のコールバックが生成する結果。
                             */
                            async () => {
                                await this.context.globalState.update(HTML_OPTIONS_STATE_KEY, options);
                                this.broadcastSettings();
                            });
                        this.htmlOptionsUpdateChain = update.catch(
                            /**
                             * 拡張機能のコールバックとして要素を処理する。
                             * @returns 副作用を完了し、値は返さない。
                             */
                            () => undefined);
                        await update;
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
                             * @param choice - 拡張機能へ渡す入力。
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
                                     * @param item - 項目のsource・pathを参照する走査対象。
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
                                 * @param item - 項目のfs・pathを参照する走査対象。
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
     * @param document - 拡張機能へ渡す入力。
     * @param panel - 拡張機能へ渡す入力。
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
     * @param document - 拡張機能へ渡す入力。
     * @param panel - 拡張機能へ渡す入力。
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
     * @param document - 拡張機能へ渡す入力。
     * @param panel - 拡張機能へ渡す入力。
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
             * @param entry - エントリのclient・idを参照する走査対象。
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
     * 拡張機能のイベントまたはメッセージを受け取り、状態を更新する。
     * @param event - ユーザー操作またはDOMから通知されたイベント。
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
     * @param key - 拡張機能の対象や分岐を識別する値。
     * @param fromVersion - 拡張機能で扱う数値。
     * @param toVersion - 拡張機能で扱う数値。
     * @returns 副作用を完了し、値は返さない。
     */
    private historySince(key: string, fromVersion: number, toVersion: number): ChangeHistoryEntry[] | undefined {
        // 指定されたバージョン範囲を連続して埋める履歴だけを抽出し、欠落時は再同期を要求できるようにする。
        const entries = (this.changeHistory.get(key) ?? [])
            .filter(
                /**
                 * base・versionの条件を満たすエントリだけを残す。
                 * @param entry - エントリのbase・versionを参照する走査対象。
                 * @returns 条件を満たした要素だけを含む一覧。
                 */
                (entry) => entry.baseVersion >= fromVersion && entry.version <= toVersion)
            .sort(
                /**
                 * 2つの値を比較して並び順を決める。
                 * @param left - 比較対象の左側の値。
                 * @param right - 比較対象の右側の値。
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
     * @param key - 拡張機能の対象や分岐を識別する値。
     * @param clientId - 通信相手または編集状態を識別するID。
     * @param opId - 拡張機能の対象や分岐を識別する値。
     * @returns 条件が成立したかを示す真偽値。
     */
    private wasOperationApplied(key: string, clientId: string, opId: string): boolean {
        // 履歴からクライアントIDと操作IDが一致する適用済み操作を検索する。
        return (this.changeHistory.get(key) ?? []).some(
            /**
             * 拡張機能のコールバックとしてエントリを処理する。
             * @param entry - 拡張機能で走査または更新する要素。
             * @returns 副作用を完了し、値は返さない。
             */
            (entry) => (
                entry.clientId === clientId && entry.opId === opId
            ));
    }

    /**
     * 拡張機能の変更または要求をHost・Webview間へ通知する。
     * @param panel - 拡張機能へ渡す入力。
     * @param document - 拡張機能へ渡す入力。
     * @param clientId - 通信相手または編集状態を識別するID。
     * @param opId - 拡張機能の対象や分岐を識別する値。
     * @param reason - 処理を中断または失敗させた理由。
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
     * @param document - 拡張機能へ渡す入力。
     * @returns 条件が成立したかを示す真偽値。
     */
    private canonicalText(document: vscode.TextDocument): string {
        return toCanonicalText(document.getText());
    }

    /**
     * 拡張機能の値を保存先または共有状態へ書き出す。
     * @param document - 拡張機能へ渡す入力。
     * @param images - 拡張機能へ渡す要素の一覧。
     * @param imageDirectory - 拡張機能で読み書きするリソースの場所。
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
     * @param document - 拡張機能へ渡す入力。
     * @param imageDirectory - 拡張機能で読み書きするリソースの場所。
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
     * @param document - 拡張機能へ渡す入力。
     * @param imageDirectory - 拡張機能で読み書きするリソースの場所。
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
     * @param document - 拡張機能へ渡す入力。
     * @param href - リンク操作領域の遷移先URI。
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
     * @param document - 拡張機能へ渡す入力。
     * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
     * @returns 条件が成立したかを示す真偽値。
     */
    private async checkLocalResources(document: vscode.TextDocument, markdown: string): Promise<Diagnostic[]> {
        const references = collectLocalResourceReferences(markdown);
        const diagnostics = await Promise.all(references.map(
            /**
             * 各referenceからsourceを取り出して一覧化する。
             * @param reference - referenceのsourceを参照する走査対象。
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
             * @param item - 走査中の要素。
             * @returns 条件を満たした要素だけを含む一覧。
             */
            (item): item is Diagnostic => item !== undefined));
    }

    /**
     * 拡張機能から必要な値またはリソースを取得する。
     * @param document - 拡張機能へ渡す入力。
     * @returns 拡張機能のget・settingsが生成する結果。
     */
    private getSettings(document?: vscode.TextDocument): WebviewSettings {
        // VS Code設定とワークスペース信頼状態をWebview用の設定オブジェクトへまとめる。
        const config = vscode.workspace.getConfiguration('markdownEasyVisualEditor', document?.uri);
        return {
            ...this.getFontSettings(),
            language: this.getLanguage(),
            imageDirectory: config.get('images.directory', 'assets/${documentBasename}'),
            maxPasteSizeMb: config.get('images.maxPasteSizeMb', 20),
            remoteImagesEnabled: config.get('remoteImages.enabled', false),
            mermaidTheme: config.get('mermaid.theme', 'auto'),
            mermaidHostRendering: true,
            editorTheme: config.get<WebviewSettings['editorTheme']>('editor.theme', 'dark'),
            viewMode: normalizeViewMode(this.context.globalState.get<unknown>(VIEW_MODE_STATE_KEY)),
            outlineVisible: this.context.globalState.get<boolean>(OUTLINE_VISIBLE_STATE_KEY, true),
            scrollSyncEnabled: this.context.globalState.get<boolean>(SCROLL_SYNC_STATE_KEY, true),
            previewImageResizeControlsVisible: this.context.globalState.get<boolean>(PREVIEW_IMAGE_RESIZE_CONTROLS_STATE_KEY, true),
            pdfOptions: this.getPdfOptions(),
            htmlOptions: this.getHtmlOptions(),
            workspaceTrusted: vscode.workspace.isTrusted,
            startupProbe: this.startupBenchmarkEnabled || undefined
        };
    }

    /**
     * 拡張機能から必要な値またはリソースを取得する。
     * @returns 拡張機能のget・pdf・optionsが生成する結果。
     */
    private getPdfOptions(): NormalizedPdfOptions {
        const options = normalizePdfOptions(
            this.context.globalState.get<unknown>(PDF_OPTIONS_STATE_KEY, DEFAULT_PDF_OPTIONS)
        );
        const fontSettings = this.getFontSettings();
        return {
            ...options,
            fontFamily: fontSettings.previewFontFamily || DEFAULT_PDF_OPTIONS.fontFamily
        };
    }

    /**
     * 拡張機能から必要な値またはリソースを取得する。
     * @returns 拡張機能のget・html・optionsが生成する結果。
     */
    private getHtmlOptions(): HtmlExportSettings {
        return normalizeHtmlExportSettings(
            this.context.globalState.get<unknown>(HTML_OPTIONS_STATE_KEY, DEFAULT_HTML_EXPORT_SETTINGS)
        );
    }

    /**
     * 拡張機能のmigrate・legacy・font・familyを処理し、呼び出し側へ結果または副作用を返す。
     * @returns 副作用を完了し、値は返さない。
     */
    private async migrateLegacyFontFamily(): Promise<void> {
        if (normalizeFontFamilySettings(this.context.globalState.get<unknown>(FONT_FAMILY_STATE_KEY))) return;
        const legacy = normalizePdfOptions(
            this.context.globalState.get<unknown>(PDF_OPTIONS_STATE_KEY, DEFAULT_PDF_OPTIONS)
        );
        const legacyFontFamily = normalizeFontFamily(legacy.fontFamily);
        const defaultFontFamily = normalizeFontFamily(DEFAULT_PDF_OPTIONS.fontFamily);
        if (!legacyFontFamily || legacyFontFamily === defaultFontFamily) return;
        await this.context.globalState.update(FONT_FAMILY_STATE_KEY, {
            ...DEFAULT_FONT_FAMILY_SETTINGS,
            previewFontFamily: legacyFontFamily
        });
    }

    /**
     * 拡張機能から必要な値またはリソースを取得する。
     * @returns 拡張機能のget・font・settingsが生成する結果。
     */
    private getFontSettings(): FontFamilySettings {
        const stored = normalizeFontFamilySettings(
            this.context.globalState.get<unknown>(FONT_FAMILY_STATE_KEY)
        );
        if (stored) return stored;

        const legacy = normalizePdfOptions(
            this.context.globalState.get<unknown>(PDF_OPTIONS_STATE_KEY, DEFAULT_PDF_OPTIONS)
        );
        const legacyFontFamily = normalizeFontFamily(legacy.fontFamily);
        const defaultFontFamily = normalizeFontFamily(DEFAULT_PDF_OPTIONS.fontFamily);
        if (legacyFontFamily && legacyFontFamily !== defaultFontFamily) {
            return {
                ...DEFAULT_FONT_FAMILY_SETTINGS,
                previewFontFamily: legacyFontFamily
            };
        }
        return { ...DEFAULT_FONT_FAMILY_SETTINGS };
    }

    /**
     * 拡張機能の変更または利用者の操作意図を記録し、後続処理へ渡す。
     * @param panel - 拡張機能へ渡す入力。
     * @param field - 拡張機能へ渡す入力。
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
     * @param panel - 拡張機能へ渡す入力。
     * @param requestId - 要求と応答を対応付ける識別子。
     * @param documents - 文書URIと開いている文書オブジェクトの対応表。
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
            /**
             * 拡張機能の変更または利用者の操作意図を記録し、後続処理へ渡す。
             * @param resolve - Promiseの成功を通知する関数。
             * @param reject - Promiseの失敗を通知する関数。
             * @returns 拡張機能に対応する要素の一覧。
             */
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
     * @param webview - 拡張機能へ渡す入力。
     * @param document - 拡張機能へ渡す入力。
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
     * @param panel - 拡張機能へ渡す入力。
     * @param message - HostとWebviewの間で受け渡すメッセージ。
     * @returns 副作用を完了し、値は返さない。
     */
    private post(panel: vscode.WebviewPanel, message: HostToWebviewMessage): void {
        // Webviewへメッセージを非同期送信する。
        void panel.webview.postMessage(message);
    }
}

/**
 * 拡張機能のhost・debugを処理し、呼び出し側へ結果または副作用を返す。
 * @param message - HostとWebviewの間で受け渡すメッセージ。
 * @param details - 拡張機能で受け渡す文字列。
 * @returns 副作用を完了し、値は返さない。
 */
function hostDebug(message: string, details: Record<string, unknown>): void {
    if (process.env.MVE_DEBUG === '1') console.info(message, details);
}

/**
 * 拡張機能の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param document - 拡張機能へ渡す入力。
 * @param canonicalBaseText - 拡張機能で扱う文字列または本文。
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
 * @param clientId - 通信相手または編集状態を識別するID。
 * @param opId - 拡張機能の対象や分岐を識別する値。
 * @returns 拡張機能で利用する文字列。
 */
function operationIdentity(clientId: string, opId: string): string {
    // クライアントIDと操作IDを衝突しない1つのキーへ連結する。
    return `${clientId}\u0000${opId}`;
}

/**
 * 拡張機能の条件を判定する。
 * @param filePath - 読み書きするファイルのパス。
 * @returns 条件が成立したかを示す真偽値。
 */
function isMarkdownDocumentPath(filePath: string): boolean {
    return /\.(?:md|markdown)$/i.test(filePath);
}

/**
 * 拡張機能の入力を許可された形式へ整える。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns 拡張機能で生成または変換した値。
 */
function normalizeViewMode(value: unknown): ViewMode {
    return value === 'text' || value === 'preview' ? value : 'both';
}

/**
 * 拡張機能のextension・for・mimeを処理し、呼び出し側へ結果または副作用を返す。
 * @param mime - 画像または出力データのMIMEタイプ。
 * @returns 副作用を完了し、値は返さない。
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
 * @param name - 拡張機能の対象や分岐を識別する値。
 * @param mime - 画像または出力データのMIMEタイプ。
 * @returns 副作用を完了し、値は返さない。
 */
function imageExtensionFromName(name: string | undefined, mime: string): string | undefined {
    if (!mime.toLowerCase().startsWith('image/') || !name) return undefined;
    const extension = path.extname(name).slice(1).toLowerCase();
    return SAFE_IMAGE_EXTENSIONS.has(extension) ? extension : undefined;
}

/**
 * 拡張機能のmime・for・fileを処理し、呼び出し側へ結果または副作用を返す。
 * @param filePath - 読み書きするファイルのパス。
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
 * @param documentUri - 拡張機能で読み書きするリソースの場所。
 * @param target - 拡張機能へ渡す入力。
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
 * 拡張機能から必要な値またはリソースを取得する。
 * @param documentUri - 拡張機能で読み書きするリソースの場所。
 * @param source - 解析・描画・変換の起点となる本文。
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
 * @param date - 拡張機能へ渡す入力。
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
 * @param value - 検証・変換・保存の対象となる値。
 * @returns 拡張機能で利用する文字列。
 */
function sanitizeSvg(value: string): string {
    // SVGからスクリプト・イベント属性・危険なURLスキームを除去する。
    return value
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
        .replace(/(?:javascript|data:text\/html):/gi, '');
}

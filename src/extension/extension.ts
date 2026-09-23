/**
 * @file extension.ts
 * 実行境界: Extension Host。
 * 責務: VS Code文書、Webview、外部リソースを連携する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: 文書、ファイル、Webview、ブラウザーなどの外部状態を必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
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

/** 「VIEW_TYPE」は、DOM操作またはメッセージ連携で使用する識別子です。 */
/** MarkdownエディターWebviewを識別するCustomEditorのビュー種別。 */
const VIEW_TYPE = 'markdownEasyVisualEditor.editor';
/** 「VIEW_MODE_STATE_KEY」は、関連する処理間で共有する設定値または状態です。 */
/** 表示モードをglobalStateへ保存するためのキー。 */
const VIEW_MODE_STATE_KEY = 'markdownEasyVisualEditor.viewMode';
/** 「OUTLINE_VISIBLE_STATE_KEY」は、関連する処理間で共有する設定値または状態です。 */
/** アウトライン表示状態をglobalStateへ保存するためのキー。 */
const OUTLINE_VISIBLE_STATE_KEY = 'markdownEasyVisualEditor.outlineVisible';
/** 「SCROLL_SYNC_STATE_KEY」は、関連する処理間で共有する設定値または状態です。 */
/** エディターとプレビュー間のスクロール同期状態を保存するためのキー。 */
const SCROLL_SYNC_STATE_KEY = 'markdownEasyVisualEditor.scrollSyncEnabled';
/** 「PREVIEW_IMAGE_RESIZE_CONTROLS_STATE_KEY」は、関連する処理間で共有する設定値または状態です。 */
/** プレビュー画像のリサイズ操作部品の表示状態を保存するためのキー。 */
const PREVIEW_IMAGE_RESIZE_CONTROLS_STATE_KEY = 'markdownEasyVisualEditor.previewImageResizeControlsVisible';
/** 文書やWebviewに依存せず、PDF印刷設定を全Markdown文書で共有するglobalStateのキー。 */
/** PDF出力設定を全Markdown文書で共有するglobalStateのキー。 */
const PDF_OPTIONS_STATE_KEY = 'markdownEasyVisualEditor.pdfOptions';
/** 「FONT_FAMILY_STATE_KEY」は、関連する処理間で共有する設定値または状態です。 */
/** フォントファミリー設定を全Markdown文書で共有するglobalStateのキー。 */
const FONT_FAMILY_STATE_KEY = 'markdownEasyVisualEditor.fontFamilies';
/** 「HTML_OPTIONS_STATE_KEY」は、呼び出し先へ渡す設定値の集合です。 */
/** HTML出力設定を全Markdown文書で共有するglobalStateのキー。 */
const HTML_OPTIONS_STATE_KEY = 'markdownEasyVisualEditor.htmlOptions';

/**
 * JSONをnonce付きインラインscriptへ安全に埋め込める文字列へ変換する。
 * @param value 「serializeInlineJson」で検証・変換する入力値です。
 * @returns 「serializeInlineJson」が生成または変換したExtension Hostの文字列を返します。
 */
function serializeInlineJson(value: unknown): string {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

/**
 * 「PendingHostOperation」が満たすデータ契約を定義します。
 */
interface PendingHostOperation {

    /**
     * 「panel」は、関連処理が共有する構造化データの一項目です。
     */
    panel: vscode.WebviewPanel;

    /**
     * 「clientId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    clientId: string;

    /**
     * 「opId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    opId: string;

    /**
     * 「appliedBaseVersion」は、位置・サイズ・件数などを表す数値です。
     */
    appliedBaseVersion: number;
    /**
     * Webview同期座標系のLF正規化済み本文。
     */
    baseText: string;
    /**
     * Webview同期座標系のLF正規化済み期待本文。
     */
    expectedText: string;

    /**
     * 「changes」は、関連する複数の対象または識別子を保持します。
     */
    changes: TextChange[];
}

/**
 * 「ChangeHistoryEntry」が満たすデータ契約を定義します。
 */
interface ChangeHistoryEntry {

    /**
     * 「baseVersion」は、位置・サイズ・件数などを表す数値です。
     */
    baseVersion: number;

    /**
     * 「version」は、位置・サイズ・件数などを表す数値です。
     */
    version: number;
    /**
     * LF正規化済み本文の長さ。
     */
    baseLength: number;
    /**
     * LF正規化済み本文を基準とする変更。
     */
    changes: TextChange[];

    /**
     * 「clientId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    clientId?: string;

    /**
     * 「opId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    opId?: string;
}

/**
 * 「ExportCommand」として扱う値の型を定義します。
 */
type ExportCommand = 'exportPdf' | 'exportHtml';

/**
 * 「PanelReadyWaiter」が満たすデータ契約を定義します。
 */
interface PanelReadyWaiter {
    /**
     * 「resolve」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
     * @param panel 「panel」は、「resolve」がExtension Host処理の処理対象を特定する入力です。
     * @returns 「resolve」の副作用または状態更新を実行し、値は返しません。
     */
    resolve: (panel: vscode.WebviewPanel) => void;
    /**
     * 「reject」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
     * @param error 発生したエラーです。
     * @returns 「reject」の副作用または状態更新を実行し、値は返しません。
     */
    reject: (error: Error) => void;
}

/**
 * 「StartupTiming」が満たすデータ契約を定義します。
 */
interface StartupTiming {

    /**
     * 「uri」は、対象の内容または識別子を表す文字列です。
     */
    uri: string;

    /**
     * 「documentLength」は、本文または選択範囲の位置・長さを保持します。
     */
    documentLength: number;

    /**
     * 「resolveStartedAt」は、位置・サイズ・件数などを表す数値です。
     */
    resolveStartedAt: number;

    /**
     * 「webviewReadyMs」は、位置・サイズ・件数などを表す数値です。
     */
    webviewReadyMs?: number;

    /**
     * 「initializedMs」は、位置・サイズ・件数などを表す数値です。
     */
    initializedMs?: number;

    /**
     * 「previewReadyMs」は、位置・サイズ・件数などを表す数値です。
     */
    previewReadyMs?: number;

    /**
     * 「firstMermaidRequestedMs」は、位置・サイズ・件数などを表す数値です。
     */
    firstMermaidRequestedMs?: number;

    /**
     * 「firstMermaidReadyMs」は、位置・サイズ・件数などを表す数値です。
     */
    firstMermaidReadyMs?: number;

    /**
     * 「webviewMetrics」は、関連する複数の対象または識別子を保持します。
     */
    webviewMetrics?: Record<string, number>;
}

/**
 * カスタムエディターとMarkdown Easy Visual EditorのコマンドをVS Codeへ登録する。
 * @param context 拡張機能のサブスクリプションとURIを保持するVS Codeコンテキスト。
 * @returns 登録処理の完了後は何も返さない。
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
         * 「async」として「uri」を受け取り、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
         * @param uri 「uri」は、「async」がExtension Host処理の処理対象を特定する入力です。
         * @returns 「if」を実行し、値を返しません。
         */
        async (uri?: vscode.Uri) => {
            const resource = uri ?? vscode.window.activeTextEditor?.document.uri;
            if (resource) await vscode.commands.executeCommand('vscode.openWith', resource, VIEW_TYPE);
        }),
        vscode.commands.registerCommand('markdownEasyVisualEditor.openSource',
        /**
 * 登録された副作用または結果を生成する処理を実行するコールバックです。
         * @returns 「provider.openSource」を実行し、値を返しません。
         */
        () => provider.openSource()),
        vscode.commands.registerCommand('markdownEasyVisualEditor.insertImage',
        /**
 * 登録された副作用または結果を生成する処理を実行するコールバックです。
         * @returns 「provider.sendCommand」を実行し、値を返しません。
         */
        () => provider.sendCommand('insertImage')),
        vscode.commands.registerCommand('markdownEasyVisualEditor.exportPdf',
        /**
 * 「uri」を受け取り、登録された副作用または結果を生成する処理です。
         * @param uri 処理対象文書またはリソースを示すURIです。
         * @returns 「provider.exportFromUri」を実行し、値を返しません。
         */
        (uri?: vscode.Uri) => provider.exportFromUri('exportPdf', uri)),
        vscode.commands.registerCommand('markdownEasyVisualEditor.exportHtml',
        /**
 * 「uri」を受け取り、登録された副作用または結果を生成する処理です。
         * @param uri 処理対象文書またはリソースを示すURIです。
         * @returns 「provider.exportFromUri」を実行し、値を返しません。
         */
        (uri?: vscode.Uri) => provider.exportFromUri('exportHtml', uri)),
        vscode.commands.registerCommand('markdownEasyVisualEditor.undo',
        /**
 * 登録された副作用または結果を生成する処理を実行するコールバックです。
         * @returns 「provider.executeHistoryCommand」を実行し、値を返しません。
         */
        () => provider.executeHistoryCommand('undo')),
        vscode.commands.registerCommand('markdownEasyVisualEditor.redo',
        /**
 * 登録された副作用または結果を生成する処理を実行するコールバックです。
         * @returns 「provider.executeHistoryCommand」を実行し、値を返しません。
         */
        () => provider.executeHistoryCommand('redo')),
    );
    if (startupBenchmarkEnabled) {
        context.subscriptions.push(vscode.commands.registerCommand(
            'markdownEasyVisualEditor._getStartupTiming',

            /**
 * 「uri」を受け取り、登録された副作用または結果を生成する処理です。
             * @param uri 処理対象文書またはリソースを示すURIです。
             * @returns 「uri」から生成した処理結果を返します。
             */
            (uri?: vscode.Uri | string) => provider.getStartupTiming(uri)
        ));
    }
}

/**
 * activateで登録したサブスクリプションの破棄をVS Codeへ任せる。
 * @returns 共有PDFブラウザの終了完了を待つPromise。
 */
export async function deactivate(): Promise<void> {
    await closeMermaidRenderer();
    await closePdfBrowser();
}

/**
 * 「MarkdownEasyVisualEditorProvider」クラスの状態とライフサイクルを定義します。
 */
export class MarkdownEasyVisualEditorProvider implements vscode.CustomTextEditorProvider {

    /**
     * 「panels」は、関連処理が共有する構造化データの一項目です。
     */
    private readonly panels = new Map<string, Set<vscode.WebviewPanel>>();

    /**
     * 「documents」は、関連処理が共有する構造化データの一項目です。
     */
    private readonly documents = new Map<string, vscode.TextDocument>();
    /**
     * 文書versionごとの同期基準。物理EOLではなく常にLFで保持する。
     */
    private readonly canonicalDocumentTexts = new Map<string, string>();

    /**
     * 「activeOperations」は、表示領域のサイズまたは倍率を保持します。
     */
    private readonly activeOperations = new Map<string, PendingHostOperation>();

    /**
     * 「activeOperationKeysByDocument」は、表示領域のサイズまたは倍率を保持します。
     */
    private readonly activeOperationKeysByDocument = new Map<string, string>();

    /**
     * 「changeHistory」は、関連処理が共有する構造化データの一項目です。
     */
    private readonly changeHistory = new Map<string, ChangeHistoryEntry[]>();

    /**
     * 「editChains」は、関連処理が共有する構造化データの一項目です。
     */
    private readonly editChains = new Map<string, Promise<void>>();

    /**
     * 「pdfPreviewGenerations」は、表示領域のサイズまたは倍率を保持します。
     */
    private readonly pdfPreviewGenerations = new WeakMap<vscode.WebviewPanel, number>();

    /**
     * 「pdfPreviewAbortControllers」は、非同期処理またはリソースのライフサイクルを管理します。
     */
    private readonly pdfPreviewAbortControllers = new WeakMap<vscode.WebviewPanel, AbortController>();

    /**
     * 「pdfPreviewChains」は、関連処理が共有する構造化データの一項目です。
     */
    private readonly pdfPreviewChains = new WeakMap<vscode.WebviewPanel, Promise<void>>();

    /**
     * 「mermaidRenderControllers」は、非同期処理またはリソースのライフサイクルを管理します。
     */
    private readonly mermaidRenderControllers = new Map<string, {

        /**
         * 「panel」は、関連処理が共有する構造化データの一項目です。
         */
        panel: vscode.WebviewPanel;

        /**
         * 「controller」は、非同期処理またはリソースのライフサイクルを管理します。
         */
        controller: AbortController;
    }>();

    /**
     * 「pendingHtmlRenderRequests」は、関連処理が共有する構造化データの一項目です。
     */
    private readonly pendingHtmlRenderRequests = new Map<string, {
        /**
         * 「resolve」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
         * @param documents 「documents」は、「resolve」がExtension Host処理の処理対象を特定する入力です。
         * @returns 「resolve」の副作用または状態更新を実行し、値は返しません。
         */
        resolve: (documents: HtmlRenderedDocument[]) => void;
        /**
         * 「reject」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
         * @param error 発生したエラーです。
         * @returns 「reject」の副作用または状態更新を実行し、値は返しません。
         */
        reject: (error: Error) => void;

        /**
         * 「timer」は、関連処理が共有する構造化データの一項目です。
         */
        timer: ReturnType<typeof setTimeout>;
    }>();

    /**
     * 「panelReadyWaiters」は、関連処理が共有する構造化データの一項目です。
     */
    private readonly panelReadyWaiters = new Map<string, Set<PanelReadyWaiter>>();

    /**
     * 「openingDocuments」は、関連処理が共有する構造化データの一項目です。
     */
    private readonly openingDocuments = new Map<string, Promise<void>>();

    /**
     * 「panelClientIds」は、関連処理が共有する構造化データの一項目です。
     */
    private readonly panelClientIds = new WeakMap<vscode.WebviewPanel, string>();

    /**
     * 「panelInitialized」は、関連処理が共有する構造化データの一項目です。
     */
    private readonly panelInitialized = new WeakSet<vscode.WebviewPanel>();

    /**
     * 「panelStartupTimings」は、処理時間や対象数などの計測結果を保持します。
     */
    private readonly panelStartupTimings = new WeakMap<vscode.WebviewPanel, StartupTiming>();

    /**
     * 「startupTimings」は、処理時間や対象数などの計測結果を保持します。
     */
    private readonly startupTimings = new Map<string, StartupTiming>();

    /**
     * 「htmlOptionsUpdateChain」は、利用側が共有する設定または現在状態を保持します。
     */
    private htmlOptionsUpdateChain: Promise<void> = Promise.resolve();

    /**
     * 「legacyFontMigration」は、表示領域のサイズまたは倍率を保持します。
     */
    private readonly legacyFontMigration: Promise<void>;

    /**
     * 「activePanel」は、画面の表示モードまたは現在のUI状態を示します。
     */
    private activePanel?: vscode.WebviewPanel;

    /**
     * 「activeDocument」は、画面の表示モードまたは現在のUI状態を示します。
     */
    private activeDocument?: vscode.TextDocument;

    /**
     * 文書変更・設定変更・信頼状態変更の監視を登録する。
     * @param context 拡張機能のサブスクリプションを登録するコンテキスト。
     * @param startupBenchmarkEnabled 「startupBenchmarkEnabled」は、「constructor」がExtension Host処理の処理対象を特定する入力です。
     * @returns 「constructor」がExtension Host処理の入力を処理して得た固有の結果を返します。
     */
    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly startupBenchmarkEnabled = false
    ) {
        // 文書変更・設定変更・ワークスペース信頼変更を監視し、Webviewへ状態を反映する。
        context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(
            /**
 * 「event」を受け取り、イベントに応じた状態更新または委譲処理を実行するコールバックです。
             * @param event 処理対象のイベントです。
             * @returns イベントに応じた状態更新または委譲処理を実行し、値を返しません。
             */
            (event) => this.onDocumentChanged(event)),
            vscode.workspace.onDidChangeConfiguration(
            /**
 * 「event」を受け取り、イベントに応じた状態更新または委譲処理を実行するコールバックです。
             * @param event 処理対象のイベントです。
             * @returns イベントに応じた状態更新または委譲処理を実行し、値を返しません。
             */
            (event) => {
                if (event.affectsConfiguration('markdownEasyVisualEditor')) this.broadcastSettings();
            }),
            vscode.workspace.onDidGrantWorkspaceTrust(
            /**
 * 非同期処理の失敗理由を受け取り、回復処理または代替値を生成するコールバックです。
             * @returns イベントに応じた状態更新または委譲処理を実行し、値を返しません。
             */
            () => this.broadcastSettings())
        );
        this.legacyFontMigration = this.migrateLegacyFontFamily().catch(
        /**
         * Promiseの失敗理由を受け取り、エラー表示またはフォールバックを実行するコールバックです。
         * @returns エラー処理またはフォールバックの結果を返します。
         */
        () => undefined);
    }

    /**
     * 文書に対応するWebviewパネルを初期化し、メッセージとライフサイクルを接続する。
     * @param document 表示対象のMarkdown文書。
     * @param webviewPanel 初期化するカスタムエディターのWebviewパネル。
     * @returns Webviewの初期化が完了するPromise。
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
 * 「folder」を変換し、変換後の要素を返すコールバックです。
         * @param folder folderとして渡される、このコールバックの入力値です。
         * @returns 入力要素から生成した変換後の値を返します。
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
 * 「message」を受け取り、イベントに応じた状態更新または委譲処理を実行するコールバックです。
         * @param message 処理対象のメッセージです。
         * @returns イベントに応じた状態更新または委譲処理を実行し、値を返しません。
         */
        (message: WebviewToHostMessage) =>
            this.handleMessage(document, webviewPanel, message)
        );
        webviewPanel.onDidChangeViewState(
        /**
 * 「event」を受け取り、イベントに応じた状態更新または委譲処理を実行するコールバックです。
         * @param event 処理対象のイベントです。
         * @returns イベントに応じた状態更新または委譲処理を実行し、値を返しません。
         */
        (event) => {
            if (event.webviewPanel.active) {
                this.activePanel = webviewPanel;
                this.activeDocument = document;
            }
        });
        webviewPanel.onDidDispose(
        /**
 * 登録された処理を受け取り、イベントに応じた状態更新または委譲処理を実行するコールバックです。
         * @returns イベントに応じた状態更新または委譲処理を実行し、値を返しません。
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
     * 開発用の実 VS Code起動ベンチマークへ、記録済み時刻を返す。
     * @param uri 「uri」は、「getStartupTiming」がExtension Host処理の処理対象を特定する入力です。
     * @returns 処理が対象を取得できない場合はundefinedを返します。
     */
    getStartupTiming(uri?: vscode.Uri | string): Omit<StartupTiming, 'resolveStartedAt'> | undefined {
        const key = typeof uri === 'string' ? uri : uri?.toString();
        const timing = key ? this.startupTimings.get(key) : [...this.startupTimings.values()].at(-1);
        if (!timing) return undefined;
        const { resolveStartedAt: _resolveStartedAt, ...result } = timing;
        return result;
    }

    /**
     * 現在アクティブなMarkdown文書を通常のソースエディターで開く。
     * @returns ソースエディターの表示が完了するPromise。
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
     * アクティブなWebviewへ画像挿入またはPDF出力のコマンドを送る。
     * @param command Webviewへ送るホストコマンド。
     * @returns 何も返さない。
     */
    sendCommand(command: 'insertImage' | ExportCommand): void {
        // アクティブなWebviewへホストコマンドを送る。
        if (!this.activePanel) return;
        this.post(this.activePanel, { type: 'hostCommand', command });
    }

    /**
     * Explorerから受け取ったMarkdown URIを既存のWebview出力経路へ合流させる。
     * @param command 処理対象を特定するcommandの入力値です。
     * @param uri 読み込みまたは出力するリソースの場所です。
     * @returns 非同期処理の完了を表すPromiseです。
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
     * 「ensureReadyPanel」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
     * @param documentUri 「documentUri」は、「ensureReadyPanel」がExtension Host処理の処理対象を特定する入力です。
     * @returns 非同期処理の完了を表すPromiseです。
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
                 * Promiseの解決値を受け取り、後続の表示または状態更新へ渡すコールバックです。
                 * @returns 解決値を処理した結果を返します。
                 */
                () => undefined).finally(
                /**
                 * Promiseの解決値を受け取り、後続の表示または状態更新へ渡すコールバックです。
                 * @returns 解決値を処理した結果を返します。
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
     * パネルを取得または解決します。
     * @param documentUri 処理対象を特定するdocumentUriの入力値です。
     * @returns 処理が対象を取得できない場合はundefinedを返します。
     */
    private findReadyPanel(documentUri: vscode.Uri): vscode.WebviewPanel | undefined {
        const panels = this.panels.get(documentUri.toString());
        return panels ? [...panels].find(
        /**
 * 「panel」が検索条件に一致するか判定するコールバックです。
         * @param panel panelとして渡される、このコールバックの入力値です。
         * @returns 条件に一致した要素、または該当しない場合はundefinedを返します。
         */
        (panel) => this.panelInitialized.has(panel)) : undefined;
    }

    /**
     * パネルを待機します。
     * @param documentUri 処理対象を特定するdocumentUriの入力値です。
     * @returns 非同期処理の完了を表すPromiseです。
     */
    private waitForReadyPanel(documentUri: vscode.Uri): Promise<vscode.WebviewPanel> {
        const readyPanel = this.findReadyPanel(documentUri);
        if (readyPanel) return Promise.resolve(readyPanel);

        const key = documentUri.toString();
        return new Promise(
        /**
 * Promiseの完了または失敗を通知し、非同期処理の状態を確定するコールバックです。
         * @param resolve Promiseの完了または失敗を通知する関数です。
         * @param reject Promiseの完了または失敗を通知する関数です。
         * @returns 「this.panelReadyWaiters.get」を実行し、値を返しません。
         */
        (resolve, reject) => {
            const waiters = this.panelReadyWaiters.get(key) ?? new Set<PanelReadyWaiter>();
            const timer = setTimeout(
            /**
 * 指定時間の経過後に遅延処理を実行するコールバックです。
             * @returns 「waiters.delete」を実行し、値を返しません。
             */
            () => {
                waiters.delete(waiter);
                if (!waiters.size) this.panelReadyWaiters.delete(key);
                reject(new Error('Markdown Easy Visual Editorの準備がタイムアウトしました。'));
            }, 30_000);
            const waiter: PanelReadyWaiter = {

                /**
                 * resolveを取得または解決します。
                 * @param panel 「panel」は、「resolve」がExtension Host処理の処理対象を特定する入力です。
                 * @returns 「resolve」がExtension Host処理の入力を処理して得た固有の結果を返します。
                 */
                resolve: /**
 * 「resolve」は、非同期処理の完了状態を通知します。
 * @param panel 「panel」は、「resolve」がExtension Hostで処理する対象を特定する入力です。
 * @returns 非同期処理の完了または失敗を通知します。
 */ (panel) => {
                    clearTimeout(timer);
                    waiters.delete(waiter);
                    if (!waiters.size) this.panelReadyWaiters.delete(key);
                    resolve(panel);
                },

                /**
                 * 「reject」は、非同期処理の完了状態を通知します。
                 * @param error 発生したエラーです。
                 * @returns 「reject」の非同期処理が完了した結果をPromiseで返します。
                 */
                reject: /**
 * 「reject」は、非同期処理の完了状態を通知します。
 * @param error 発生したエラーの情報です。
 * @returns 非同期処理の完了または失敗を通知します。
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
     * resolve・panel・readyを取得または解決します。
     * @param documentKey 処理対象を特定するdocumentKeyの入力値です。
     * @param panel 処理対象を特定するpanelの入力値です。
     * @returns 状態更新または副作用を実行し、値は返しません。
     */
    private resolvePanelReady(documentKey: string, panel: vscode.WebviewPanel): void {
        const waiters = this.panelReadyWaiters.get(documentKey);
        if (!waiters) return;
        this.panelReadyWaiters.delete(documentKey);
        waiters.forEach(
        /**
 * 「waiter」を受け取り、処理結果を生成する処理です。
         * @param waiter waiterとして渡される、このコールバックの入力値です。
         * @returns 「waiter」から生成した処理結果を返します。
         */
        (waiter) => waiter.resolve(panel));
    }

    /**
     * 「rejectPanelReady」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
     * @param documentKey 「documentKey」は、「rejectPanelReady」がExtension Hostで処理する対象を特定する入力です。
     * @returns 「rejectPanelReady」の副作用または状態更新を実行し、値は返しません。
     */
    private rejectPanelReady(documentKey: string): void {
        const waiters = this.panelReadyWaiters.get(documentKey);
        if (!waiters) return;
        this.panelReadyWaiters.delete(documentKey);
        const error = new Error('Markdown Easy Visual EditorのWebviewが閉じられました。');
        waiters.forEach(
        /**
 * 「waiter」を受け取り、処理結果を生成する処理です。
         * @param waiter waiterとして渡される、このコールバックの入力値です。
         * @returns 「waiter」から生成した処理結果を返します。
         */
        (waiter) => waiter.reject(error));
    }

    /**
     * アクティブなWebviewへUndoまたはRedoの履歴コマンドを送る。
     * @param command 実行する履歴コマンド。
     * @returns 何も返さない。
     */
    executeHistoryCommand(command: 'undo' | 'redo'): void {
        // アクティブなパネルが有効な場合だけUndoまたはRedoをWebviewへ送る。
        const panel = this.activePanel;
        if (!panel || !panel.active) return;
        this.post(panel, { type: 'hostCommand', command });
    }

    /**
     * Webviewから受信したメッセージを文書編集・画像・PDF・再同期処理へ振り分ける。
     * @param document メッセージに対応するMarkdown文書。
     * @param panel メッセージを送受信するWebviewパネル。
     * @param message Webviewから受信したメッセージ。
     * @returns メッセージ処理が完了するPromise。
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
 * 処理結果を生成する処理を実行するコールバックです。
                             * @returns 「acquirePdfBrowser」の呼び出し結果を返します。
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
                         * 「async」として関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
                         * @returns 解決値を処理した結果を返します。
                         */
                        async () => {
                            await this.context.globalState.update(HTML_OPTIONS_STATE_KEY, options);
                            this.broadcastSettings();
                        });
                        this.htmlOptionsUpdateChain = update.catch(
                        /**
                         * Promiseの解決値を受け取り、後続の表示または状態更新へ渡すコールバックです。
                         * @returns 解決値を処理した結果を返します。
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
                     * Promiseの失敗理由を受け取り、エラー表示またはフォールバックを実行するコールバックです。
                     * @returns エラー処理またはフォールバックの結果を返します。
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
 * 登録された副作用または結果を生成する処理を実行するコールバックです。
                         * @returns 「exportPdf」の呼び出し結果を返します。
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
 * 非同期処理の完了値を受け取り、次の処理へ渡す結果を生成するコールバックです。
                         * @param choice choiceとして渡される、このコールバックの入力値です。
                         * @returns 解決値を処理した結果を返します。
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
                         * 「async」として関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
                         * @returns 「this.getLanguage」の呼び出し結果を返します。
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
 * 「item」を変換し、変換後の要素を返すコールバックです。
                                 * @param item 変換または処理の対象となる値です。
                                 * @returns 入力要素から生成した変換後の値を返します。
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
 * 「item」を変換し、変換後の要素を返すコールバックです。
                             * @param item 変換または処理の対象となる値です。
                             * @returns 入力要素から生成した変換後の値を返します。
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

                    /**
                     * is・panel・activeかどうかを判定します。
                     * @returns 判定結果です。
                     */
                    const isPanelActive = /**
 * 「isPanelActive」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @returns 条件を満たすかどうかを示す真偽値を返します。
 */ (): boolean => panel.active;
                    const previewPromise = (
                    /**
                     * 「async」として関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
                     * @returns 「if」を実行し、値を返しません。
                     */
                    async () => {
                        if (previous) await previous.catch(
                        /**
                         * Promiseの失敗理由を受け取り、エラー表示またはフォールバックを実行するコールバックです。
                         * @returns エラー処理またはフォールバックの結果を返します。
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
     * 同一文書へのWebview編集を既存の編集チェーンへ追加して順番に実行する。
     * @param document 編集対象の文書。
     * @param panel 編集を送信したWebviewパネル。
     * @param message Webviewから受信したローカル差分メッセージ。
     * @returns 編集処理が完了するPromise。
     */
    private async queueWebviewEdit(
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel,
        message: Extract<WebviewToHostMessage, {
        /**
         * 「type」は、対象の識別や処理分岐に使用する値を保持します。
         */
        type: 'localChanges' }>
    ): Promise<void> {
        // 同一文書のWebview編集を前の編集完了後に直列実行する。
        const key = document.uri.toString();
        const previous = this.editChains.get(key) ?? Promise.resolve();
        const current = previous
            .catch(
            /**
             * Promiseの失敗理由を受け取り、エラー表示またはフォールバックを実行するコールバックです。
             * @returns エラー処理またはフォールバックの結果を返します。
             */
            () => undefined)
            .then(
            /**
             * Promiseの解決値を受け取り、後続の表示または状態更新へ渡すコールバックです。
             * @returns 解決値を処理した結果を返します。
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
     * 履歴操作を文書編集チェーンへ追加し、対象パネルがアクティブな場合に実行する。
     * @param document 操作対象の文書。
     * @param panel 履歴操作を要求したWebviewパネル。
     * @param message UndoまたはRedoを表すメッセージ。
     * @returns 履歴コマンドの実行が完了するPromise。
     */
    private async queueHistoryCommand(
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel,
        message: Extract<WebviewToHostMessage, {
        /**
         * 「type」は、対象の識別や処理分岐に使用する値を保持します。
         */
        type: 'historyCommand' }>
    ): Promise<void> {
        // Undo/Redo要求を同一文書の編集キューへ追加し、アクティブなパネルだけで実行する。
        const key = document.uri.toString();
        const previous = this.editChains.get(key) ?? Promise.resolve();
        const current = previous
            .then(
            /**
             * 「async」として関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
             * @returns 解決値を処理した結果を返します。
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
     * Webviewの差分を現在の文書バージョンへ合わせ、WorkspaceEditとして適用する。
     * @param document 差分を適用する文書。
     * @param panel 差分を送信したWebviewパネル。
     * @param message クライアントID・基準版・差分を含むメッセージ。
     * @returns 差分適用処理が完了するPromise。
     * @throws クライアント不一致または差分範囲が不正な場合。
     */
    private async applyWebviewEdit(
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel,
        message: Extract<WebviewToHostMessage, {
        /**
         * 「type」は、対象の識別や処理分岐に使用する値を保持します。
         */
        type: 'localChanges' }>
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
 * 「entry」が検索条件に一致するか判定するコールバックです。
         * @param entry entryとして渡される、このコールバックの入力値です。
         * @returns 条件に一致した要素、または該当しない場合はundefinedを返します。
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
         * 予約されたタイミングで「resolve」を受け取り、遅延処理を実行するコールバックです。
         * @param resolve Promiseの完了または失敗を通知する関数です。
         * @returns 「setTimeout」を実行し、値を返しません。
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
     * 文書変更を履歴へ保存し、変更元へACK、他のパネルへ外部変更を通知する。
     * @param event VS Codeが通知した文書変更イベント。
     * @returns 何も返さない。
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
     * 指定バージョン間を連続してつなぐ差分履歴を返し、欠落があればundefinedを返す。
     * @param key 文書URIを表す履歴キー。
     * @param fromVersion 履歴の開始バージョン。
     * @param toVersion 履歴の終了バージョン。
     * @returns 連続した変更履歴。履歴が不足している場合はundefined。
     */
    private historySince(key: string, fromVersion: number, toVersion: number): ChangeHistoryEntry[] | undefined {
        // 指定されたバージョン範囲を連続して埋める履歴だけを抽出し、欠落時は再同期を要求できるようにする。
        const entries = (this.changeHistory.get(key) ?? [])
            .filter(
            /**
 * 「entry」が条件に一致するか判定し、残す要素を決めるコールバックです。
             * @param entry entryとして渡される、このコールバックの入力値です。
             * @returns 要素を採用するかどうかの真偽値を返します。
             */
            (entry) => entry.baseVersion >= fromVersion && entry.version <= toVersion)
            .sort(
            /**
 * 「left」「right」を比較し、並び順を示す数値を返すコールバックです。
             * @param left 比較対象の左側の値です。
             * @param right 比較対象の右側の値です。
             * @returns 要素を採用するかどうかの真偽値を返します。
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
     * 指定されたクライアントと操作IDが履歴へ適用済みかを判定する。
     * @param key 文書URIを表す履歴キー。
     * @param clientId 操作元WebviewのクライアントID。
     * @param opId 判定対象の操作ID。
     * @returns 指定操作が履歴へ記録済みならtrue。
     */
    private wasOperationApplied(key: string, clientId: string, opId: string): boolean {
        // 履歴からクライアントIDと操作IDが一致する適用済み操作を検索する。
        return (this.changeHistory.get(key) ?? []).some(
        /**
 * 「entry」が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
         * @param entry entryとして渡される、このコールバックの入力値です。
         * @returns 条件判定の結果を示す真偽値を返します。
         */
        (entry) => (
            entry.clientId === clientId && entry.opId === opId
        ));
    }

    /**
     * 現在の本文とバージョンをWebviewへ送り、クライアントの状態を再同期させる。
     * @param panel 再同期通知を送るWebviewパネル。
     * @param document 最新状態を読み取る文書。
     * @param clientId 再同期対象のクライアントID。
     * @param opId 再同期対象の操作ID。
     * @param reason 再同期が必要になった理由。
     * @returns 何も返さない。
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
     * 現在のVS Code文書を同期プロトコルのLF座標系へ変換する。スナップショット更新は変更イベントだけが行う。
     * @param document 処理対象の文書です。
     * @returns 処理が生成または変換したExtension Hostの文字列を返します。
     */
    private canonicalText(document: vscode.TextDocument): string {
        return toCanonicalText(document.getText());
    }

    /**
     * 受信した画像を設定されたアセットディレクトリへ保存し、相対パスを返す。
     * @param document 画像を参照するMarkdown文書。
     * @param images Base64形式で受信した画像一覧。
     * @param imageDirectory 読み込みまたは出力するリソースの場所を示します。
     * @returns 保存した画像の相対パス一覧。
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
     * 画像ファイルを選択ダイアログで受け取り、文書用アセットとして保存する。
     * @param document 画像を参照するMarkdown文書。
     * @param imageDirectory 読み込みまたは出力するリソースの場所を示します。
     * @returns 保存した画像の相対パス一覧を解決するPromise。
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
     * 設定された画像保存先を検証して作成し、そのURIを返す。
     * @param document 画像保存先の基準となるMarkdown文書。
     * @param imageDirectory 読み込みまたは出力するリソースの場所を示します。
     * @returns 作成または確認したアセットディレクトリのURI。
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
     * 外部URLまたは文書基準の相対リソースを適切なVS Codeの開き方へ渡す。
     * @param document 相対リソースの基準となるMarkdown文書。
     * @param href 開く外部URLまたは相対パス。
     * @returns リソースを開く処理が完了するPromise。
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
     * Markdownから参照されたローカル画像・リンクの実在を確認する。
     * @param document 処理対象の文書です。
     * @param markdown 解析・編集・変換の対象となる本文または生成済み内容です。
     * @returns 非同期処理の完了を表すPromiseです。
     */
    private async checkLocalResources(document: vscode.TextDocument, markdown: string): Promise<Diagnostic[]> {
        const references = collectLocalResourceReferences(markdown);
        const diagnostics = await Promise.all(references.map(
        /**
 * 「reference」を変換し、変換後の要素を返すコールバックです。
         * @param reference referenceとして渡される、このコールバックの入力値です。
         * @returns 非同期処理の完了を表すPromiseです。
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
 * 「item」が条件に一致するか判定し、残す要素を決めるコールバックです。
         * @param item 条件判定の対象となる要素です。
         * @returns 要素を採用するかどうかの真偽値を返します。
         */
        (item): item is Diagnostic => item !== undefined));
    }

    /**
     * VS Codeの設定値とワークスペース信頼状態からWebview設定を作る。
     * @param document 処理対象の文書です。
     * @returns Webviewへ送信する設定値。
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
     * PDF印刷設定を文書に依存しない拡張機能グローバル状態から取得する。
     * 旧バージョンの保存値や手動編集された不正値も、Webviewへ渡す前に正規化する。
     * @returns 全Markdown文書に適用する検証済みPDF印刷設定。
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
     * HTML出力のグローバル設定を読み取り、旧形式や不正値を標準値へ正規化する。
     * @returns 処理がExtension Host処理の入力を処理して得た固有の結果を返します。
     */
    private getHtmlOptions(): HtmlExportSettings {
        return normalizeHtmlExportSettings(
            this.context.globalState.get<unknown>(HTML_OPTIONS_STATE_KEY, DEFAULT_HTML_EXPORT_SETTINGS)
        );
    }

    /**
     * 新しいフォント設定を優先し、旧PDF設定だけが残る環境では一度だけ移行する。
     * @returns 非同期処理の完了を表すPromiseです。
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
     * 永続化されたフォント設定を読み取り、旧PDF設定を移行元として扱う。
     * @returns 処理がExtension Host処理の入力を処理して得た固有の結果を返します。
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
     * mark・startupを更新または保存します。
     * @param panel 処理対象を特定するpanelの入力値です。
     * @param field 処理対象を特定するfieldの入力値です。
     * @returns 状態更新または副作用を実行し、値は返しません。
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
     * 言語を取得または解決します。
     * @returns 処理がExtension Host処理の入力を処理して得た固有の結果を返します。
     */
    private getLanguage() {
        const config = vscode.workspace.getConfiguration('markdownEasyVisualEditor');
        return resolveLanguage(config.get<string>('language', 'auto'), vscode.env.language);
    }

    /**
     * get・messagesを取得または解決します。
     * @returns 処理がExtension Host処理の入力を処理して得た固有の結果を返します。
     */
    private getMessages(): Messages {
        return getMessages(this.getLanguage());
    }

    /**
     * 再帰HTML出力用の子MarkdownをWebviewで描画し、SVG化済みHTMLを受け取る。
     * @param panel 処理対象を特定するpanelの入力値です。
     * @param requestId 処理対象を特定するrequestIdの入力値です。
     * @param documents 処理対象を特定するdocumentsの入力値です。
     * @returns 非同期処理の完了を表すPromiseです。
     */
    private requestHtmlDocumentRender(
        panel: vscode.WebviewPanel,
        requestId: string,
        documents: Array<{
        /**
         * 「id」は、対象の識別や処理分岐に使用する値を保持します。
         */
        id: string;
        /**
         * 「markdown」は、解析・編集・変換の対象となる本文またはデータを保持します。
         */
        markdown: string }>
    ): Promise<HtmlRenderedDocument[]> {
        return new Promise(
        /**
 * Promiseの完了または失敗を通知し、非同期処理の状態を確定するコールバックです。
         * @param resolve Promiseの完了または失敗を通知する関数です。
         * @param reject Promiseの完了または失敗を通知する関数です。
         * @returns 「setTimeout」を実行し、値を返しません。
         */
        (resolve, reject) => {
            const timer = setTimeout(
            /**
 * 指定時間の経過後に遅延処理を実行するコールバックです。
             * @returns 「this.pendingHtmlRenderRequests.delete」を実行し、値を返しません。
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
     * 登録済みのすべてのWebviewパネルへ現在の設定を通知する。
     * @returns 何も返さない。
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
     * WebviewのCSP・リソースURI・ルート要素を含むHTMLシェルを生成する。
     * @param webview リソースURIとCSP情報を提供するWebview。
     * @param document ローカルリソースの基準となる文書。
     * @returns Webviewへ設定するHTML文字列。
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
     * 指定したWebviewパネルへホストからのメッセージを送信する。
     * @param panel メッセージ送信先のWebviewパネル。
     * @param message Webviewへ送信するメッセージ。
     * @returns 何も返さない。
     */
    private post(panel: vscode.WebviewPanel, message: HostToWebviewMessage): void {
        // Webviewへメッセージを非同期送信する。
        void panel.webview.postMessage(message);
    }
}

/**
 * デバッグ設定が有効な場合だけ、Extension Host側の診断情報をコンソールへ出力する。
 * 通常実行時のログ量を増やさず、再現調査時にはメッセージと構造化された詳細を同じ記録として確認できるようにする。
 * @param message 診断対象の事象を表すメッセージ。
 * @param details 事象に付随する文書・操作・状態などの構造化情報。
 * @returns ログ出力を完了したことを表すvoid。
 */
function hostDebug(message: string, details: Record<string, unknown>): void {
    if (process.env.MVE_DEBUG === '1') console.info(message, details);
}

/**
 * apply・change・batchを処理します。
 * @param document 処理対象の文書です。
 * @param canonicalBaseText 処理対象の本文です。
 * @param changes 「changes」は、「applyChangeBatch」がExtension Host処理の処理対象を特定する入力です。
 * @returns 非同期処理の完了を表すPromiseです。
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
 * クライアントIDと操作IDから、操作履歴で使用する一意キーを作る。
 * @param clientId 操作元WebviewのクライアントID。
 * @param opId 操作ID。
 * @returns 操作を一意に識別する文字列。
 */
function operationIdentity(clientId: string, opId: string): string {
    // クライアントIDと操作IDを衝突しない1つのキーへ連結する。
    return `${clientId}\u0000${opId}`;
}

/**
 * パスかどうかを判定します。
 * @param filePath 「filePath」は、「isMarkdownDocumentPath」がExtension Hostで処理する対象を特定する入力です。
 * @returns 判定結果です。
 */
function isMarkdownDocumentPath(filePath: string): boolean {
    return /\.(?:md|markdown)$/i.test(filePath);
}

/**
 * 永続化された表示モードを安全な3状態へ正規化する。
 * @param value 「normalizeViewMode」で検証・変換する入力値です。
 * @returns 「normalizeViewMode」が読み取りまたは正規化した結果を返します。
 */
function normalizeViewMode(value: unknown): ViewMode {
    return value === 'text' || value === 'preview' ? value : 'both';
}

/**
 * 画像MIMEタイプを保存用ファイル拡張子へ変換する。
 * @param mime 変換対象のMIMEタイプ。
 * @returns 対応する拡張子。未対応の場合はundefined。
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

/** 「SAFE_IMAGE_EXTENSIONS」は、関連する処理間で共有する設定値または状態です。 */
/**
 * MIMEタイプだけでは判定できない画像を保存するときに許可する拡張子。
 * 入力名から拡張子を補う場合もこの固定集合だけを通し、任意のファイル名を画像として扱わない。
 */
const SAFE_IMAGE_EXTENSIONS = new Set([
    'png', 'apng', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif',
    'ico', 'heic', 'heif', 'jxl', 'tif', 'tiff'
]);

/**
 * MIME表にないimage/*でも、コピー元の安全な画像拡張子を保持する。
 * @param name 対象を識別する名前で、表示または処理分岐に使用します。
 * @param mime 「mime」は、「imageExtensionFromName」がExtension Host処理の処理対象を特定する入力です。
 * @returns 「imageExtensionFromName」が生成または変換したExtension Hostの文字列を返します。
 */
function imageExtensionFromName(name: string | undefined, mime: string): string | undefined {
    if (!mime.toLowerCase().startsWith('image/') || !name) return undefined;
    const extension = path.extname(name).slice(1).toLowerCase();
    return SAFE_IMAGE_EXTENSIONS.has(extension) ? extension : undefined;
}

/**
 * 画像ファイルの拡張子をMIMEタイプへ変換する。
 * @param filePath 拡張子を調べるファイルパス。
 * @returns 対応するMIMEタイプ。未対応の場合はapplication/octet-stream。
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
 * 保存先URIをMarkdown文書から参照する相対パスへ変換する。
 * @param documentUri 基準となるMarkdown文書のURI。
 * @param target 画像保存先のURI。
 * @returns Markdownから参照する相対パスまたは対象パス。
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
 * Markdown文書を基準にローカル参照先のURIを解決する。
 * @param documentUri 「documentUri」は、「resolveLocalResourceUri」がExtension Host処理の処理対象を特定する入力です。
 * @param source 処理対象のソースです。
 * @returns 「resolveLocalResourceUri」が対象を取得できない場合はundefinedを返します。
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
 * Dateを貼り付け画像名へ埋め込める年月日と時刻の文字列へ変換する。
 * @param date 変換対象の日時。
 * @returns 区切りを含まない年月日と時刻の文字列。
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
 * SVG文字列から実行可能なスクリプト・イベント属性・危険なURLを除去する。
 * @param value 無害化するSVG文字列。
 * @returns 危険な要素を除去したSVG文字列。
 */
function sanitizeSvg(value: string): string {
    // SVGからスクリプト・イベント属性・危険なURLスキームを除去する。
    return value
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
        .replace(/(?:javascript|data:text\/html):/gi, '');
}

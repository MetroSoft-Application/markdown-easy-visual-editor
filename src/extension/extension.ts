import * as vscode from 'vscode';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import type {
    HostToWebviewMessage,
    ImagePayload,
    ViewMode,
    WebviewSettings,
    WebviewToHostMessage
} from '../shared/protocol';
import { collectLocalResourceReferences, sortDiagnostics, type Diagnostic } from '../shared/markdown';
import { applyTextChanges, computeTextChanges, mapTextChanges, validateTextChanges, type TextChange } from '../shared/textChanges';
import {
    canonicalPositionAt,
    canonicalizeContentChanges,
    fromCanonicalText,
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

const VIEW_TYPE = 'markdownEasyVisualEditor.editor';
const VIEW_MODE_STATE_KEY = 'markdownEasyVisualEditor.viewMode';
const PREVIEW_IMAGE_RESIZE_CONTROLS_STATE_KEY = 'markdownEasyVisualEditor.previewImageResizeControlsVisible';

interface PendingHostOperation {
    panel: vscode.WebviewPanel;
    clientId: string;
    opId: string;
    appliedBaseVersion: number;
    /** Webview同期座標系のLF正規化済み本文。 */
    baseText: string;
    /** Webview同期座標系のLF正規化済み期待本文。 */
    expectedText: string;
    changes: TextChange[];
}

interface ChangeHistoryEntry {
    baseVersion: number;
    version: number;
    /** LF正規化済み本文の長さ。 */
    baseLength: number;
    /** LF正規化済み本文を基準とする変更。 */
    changes: TextChange[];
    clientId?: string;
    opId?: string;
}

type ExportCommand = 'exportPdf' | 'exportHtml';

interface PanelReadyWaiter {
    resolve: (panel: vscode.WebviewPanel) => void;
    reject: (error: Error) => void;
}

/**
 * カスタムエディターとMarkdown Easy Visual EditorのコマンドをVS Codeへ登録する。
 * @param context 拡張機能のサブスクリプションとURIを保持するVS Codeコンテキスト。
 * @returns 登録処理の完了後は何も返さない。
 */
export function activate(context: vscode.ExtensionContext): void {
    const provider = new MarkdownEasyVisualEditorProvider(context);
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
            supportsMultipleEditorsPerDocument: true,
            webviewOptions: { retainContextWhenHidden: true }
        }),
        vscode.commands.registerCommand('markdownEasyVisualEditor.openVisual', async (uri?: vscode.Uri) => {
            const resource = uri ?? vscode.window.activeTextEditor?.document.uri;
            if (resource) await vscode.commands.executeCommand('vscode.openWith', resource, VIEW_TYPE);
        }),
        vscode.commands.registerCommand('markdownEasyVisualEditor.openSource', () => provider.openSource()),
        vscode.commands.registerCommand('markdownEasyVisualEditor.insertImage', () => provider.sendCommand('insertImage')),
        vscode.commands.registerCommand('markdownEasyVisualEditor.exportPdf', (uri?: vscode.Uri) => provider.exportFromUri('exportPdf', uri)),
        vscode.commands.registerCommand('markdownEasyVisualEditor.exportHtml', (uri?: vscode.Uri) => provider.exportFromUri('exportHtml', uri)),
        vscode.commands.registerCommand('markdownEasyVisualEditor.undo', () => provider.executeHistoryCommand('undo')),
        vscode.commands.registerCommand('markdownEasyVisualEditor.redo', () => provider.executeHistoryCommand('redo')),
    );
}

/** activateで登録したサブスクリプションの破棄をVS Codeへ任せる。 */
export async function deactivate(): Promise<void> {
    await closeMermaidRenderer();
    await closePdfBrowser();
}

class MarkdownEasyVisualEditorProvider implements vscode.CustomTextEditorProvider {
    private readonly panels = new Map<string, Set<vscode.WebviewPanel>>();
    private readonly documents = new Map<string, vscode.TextDocument>();
    /** 文書versionごとの同期基準。物理EOLではなく常にLFで保持する。 */
    private readonly canonicalDocumentTexts = new Map<string, string>();
    private readonly activeOperations = new Map<string, PendingHostOperation>();
    private readonly activeOperationKeysByDocument = new Map<string, string>();
    private readonly changeHistory = new Map<string, ChangeHistoryEntry[]>();
    private readonly editChains = new Map<string, Promise<void>>();
    private readonly pdfPreviewGenerations = new WeakMap<vscode.WebviewPanel, number>();
    private readonly pdfPreviewAbortControllers = new WeakMap<vscode.WebviewPanel, AbortController>();
    private readonly pdfPreviewChains = new WeakMap<vscode.WebviewPanel, Promise<void>>();
    private readonly mermaidRenderControllers = new Map<string, {
        panel: vscode.WebviewPanel;
        controller: AbortController;
    }>();
    private readonly pendingHtmlRenderRequests = new Map<string, {
        resolve: (documents: HtmlRenderedDocument[]) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
    }>();
    private readonly panelReadyWaiters = new Map<string, Set<PanelReadyWaiter>>();
    private readonly openingDocuments = new Map<string, Promise<void>>();
    private readonly panelClientIds = new WeakMap<vscode.WebviewPanel, string>();
    private readonly panelInitialized = new WeakSet<vscode.WebviewPanel>();
    private activePanel?: vscode.WebviewPanel;
    private activeDocument?: vscode.TextDocument;

    constructor(private readonly context: vscode.ExtensionContext) {
        context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument((event) => this.onDocumentChanged(event)),
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration('markdownEasyVisualEditor')) this.broadcastSettings();
            }),
            vscode.workspace.onDidGrantWorkspaceTrust(() => this.broadcastSettings())
        );
    }

    async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        const key = document.uri.toString();
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

        const workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri);
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri, vscode.Uri.joinPath(document.uri, '..'), ...workspaceRoots]
        };
        webviewPanel.webview.html = this.getWebviewHtml(webviewPanel.webview, document);

        const messageDisposable = webviewPanel.webview.onDidReceiveMessage((message: WebviewToHostMessage) =>
            this.handleMessage(document, webviewPanel, message)
        );
        webviewPanel.onDidChangeViewState((event) => {
            if (event.webviewPanel.active) {
                this.activePanel = webviewPanel;
                this.activeDocument = document;
            }
        });
        webviewPanel.onDidDispose(() => {
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

    async openSource(): Promise<void> {
        if (!this.activeDocument) return;
        await vscode.commands.executeCommand(
            'vscode.openWith',
            this.activeDocument.uri,
            'default',
            vscode.ViewColumn.Beside
        );
    }

    sendCommand(command: 'insertImage' | ExportCommand): void {
        if (!this.activePanel) return;
        this.post(this.activePanel, { type: 'hostCommand', command });
    }

    async exportFromUri(command: ExportCommand, uri?: vscode.Uri): Promise<void> {
        if (!uri) {
            this.sendCommand(command);
            return;
        }
        if (uri.scheme !== 'file' || !isMarkdownDocumentPath(uri.fsPath)) return;

        try {
            const panel = await this.ensureReadyPanel(uri);
            this.post(panel, { type: 'hostCommand', command });
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`${this.getMessages().host.errorPrefix}: ${detail}`);
        }
    }

    private async ensureReadyPanel(documentUri: vscode.Uri): Promise<vscode.WebviewPanel> {
        const readyPanel = this.findReadyPanel(documentUri);
        if (readyPanel) return readyPanel;

        const key = documentUri.toString();
        if (!this.panels.has(key)) {
            let opening = this.openingDocuments.get(key);
            if (!opening) {
                opening = Promise.resolve(
                    vscode.commands.executeCommand('vscode.openWith', documentUri, VIEW_TYPE)
                ).then(() => undefined).finally(() => {
                    if (this.openingDocuments.get(key) === opening) this.openingDocuments.delete(key);
                });
                this.openingDocuments.set(key, opening);
            }
            await opening;
        }
        return this.waitForReadyPanel(documentUri);
    }

    private findReadyPanel(documentUri: vscode.Uri): vscode.WebviewPanel | undefined {
        const panels = this.panels.get(documentUri.toString());
        return panels ? [...panels].find((panel) => this.panelInitialized.has(panel)) : undefined;
    }

    private waitForReadyPanel(documentUri: vscode.Uri): Promise<vscode.WebviewPanel> {
        const readyPanel = this.findReadyPanel(documentUri);
        if (readyPanel) return Promise.resolve(readyPanel);

        const key = documentUri.toString();
        return new Promise((resolve, reject) => {
            const waiters = this.panelReadyWaiters.get(key) ?? new Set<PanelReadyWaiter>();
            const timer = setTimeout(() => {
                waiters.delete(waiter);
                if (!waiters.size) this.panelReadyWaiters.delete(key);
                reject(new Error('Markdown Easy Visual Editorの準備がタイムアウトしました。'));
            }, 30_000);
            const waiter: PanelReadyWaiter = {
                resolve: (panel) => {
                    clearTimeout(timer);
                    waiters.delete(waiter);
                    if (!waiters.size) this.panelReadyWaiters.delete(key);
                    resolve(panel);
                },
                reject: (error) => {
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

    private resolvePanelReady(documentKey: string, panel: vscode.WebviewPanel): void {
        const waiters = this.panelReadyWaiters.get(documentKey);
        if (!waiters) return;
        this.panelReadyWaiters.delete(documentKey);
        waiters.forEach((waiter) => waiter.resolve(panel));
    }

    private rejectPanelReady(documentKey: string): void {
        const waiters = this.panelReadyWaiters.get(documentKey);
        if (!waiters) return;
        this.panelReadyWaiters.delete(documentKey);
        const error = new Error('Markdown Easy Visual EditorのWebviewが閉じられました。');
        waiters.forEach((waiter) => waiter.reject(error));
    }

    executeHistoryCommand(command: 'undo' | 'redo'): void {
        const panel = this.activePanel;
        if (!panel || !panel.active) return;
        this.post(panel, { type: 'hostCommand', command });
    }

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
        try {
            switch (message.type) {
                case 'ready':
                    this.panelClientIds.set(panel, message.clientId);
                    this.panelInitialized.delete(panel);
                    this.post(panel, {
                        type: 'init',
                        text: this.canonicalText(document),
                        version: document.version,
                        uri: document.uri.toString(),
                        settings: this.getSettings()
                    });
                    return;
                case 'initialized':
                    if (this.panelClientIds.get(panel) !== message.clientId) return;
                    this.panelInitialized.add(panel);
                    this.resolvePanelReady(document.uri.toString(), panel);
                    return;
                case 'localChanges':
                    await this.queueWebviewEdit(document, panel, message);
                    return;
                case 'historyCommand':
                    await this.queueHistoryCommand(document, panel, message);
                    return;
                case 'saveImages': {
                    const paths = await this.saveImages(document, message.images);
                    this.post(panel, { type: 'imagesSaved', requestId: message.requestId, paths });
                    return;
                }
                case 'pickImage': {
                    const paths = await this.pickAndSaveImages(document);
                    this.post(panel, { type: 'imagesSaved', requestId: message.requestId, paths });
                    return;
                }
                case 'checkLocalResources': {
                    const diagnostics = await this.checkLocalResources(document, message.markdown);
                    this.post(panel, { type: 'localResourcesChecked', requestId: message.requestId, diagnostics });
                    return;
                }
                case 'renderMermaid': {
                    const previous = this.mermaidRenderControllers.get(message.requestId);
                    previous?.controller.abort();
                    const controller = new AbortController();
                    this.mermaidRenderControllers.set(message.requestId, { panel, controller });
                    try {
                        const rendered = await renderMermaidInBrowser(
                            message.source,
                            message.theme,
                            vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'mermaid.min.js').fsPath,
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
                case 'setViewMode':
                    await this.context.globalState.update(VIEW_MODE_STATE_KEY, message.viewMode);
                    this.broadcastSettings();
                    return;
                case 'setPreviewImageResizeControlsVisible':
                    await this.context.globalState.update(PREVIEW_IMAGE_RESIZE_CONTROLS_STATE_KEY, message.visible);
                    this.broadcastSettings();
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
                    const documentKey = document.uri.toString();
                    await (this.editChains.get(documentKey) ?? Promise.resolve()).catch(() => undefined);
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
                    if (!vscode.workspace.isTrusted) throw new Error(this.getMessages().host.pdfTrustRequired);
                    const target = await vscode.window.withProgress(
                        { location: vscode.ProgressLocation.Notification, title: this.getMessages().host.pdfProgress, cancellable: false },
                        () => exportPdf({
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
                        void vscode.window.showInformationMessage(messages.host.pdfExported(target.fsPath), messages.host.open).then((choice) => {
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
                    if (!vscode.workspace.isTrusted) throw new Error(this.getMessages().host.htmlTrustRequired);
                    const result = await vscode.window.withProgress(
                        { location: vscode.ProgressLocation.Notification, title: this.getMessages().host.htmlProgress, cancellable: false },
                        async () => {
                            const request = {
                                markdown: message.markdown,
                                html: message.html,
                                css: message.css,
                                options: message.options,
                                documentUri: document.uri,
                                language: this.getLanguage()
                            };
                            const preparation = await prepareHtmlExport(request);
                            if (!preparation) return undefined;
                            const linkedDocuments = message.options.convertLinkedMarkdown
                                ? preparation.documents.slice(1).map((item) => ({ id: item.sourcePath, markdown: item.markdown }))
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
                            paths: result.paths.map((item) => item.fsPath)
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
                    if (!vscode.workspace.isTrusted) throw new Error(this.getMessages().host.pdfTrustRequired);
                    const generation = (this.pdfPreviewGenerations.get(panel) ?? 0) + 1;
                    this.pdfPreviewGenerations.set(panel, generation);
                    this.pdfPreviewAbortControllers.get(panel)?.abort();
                    const controller = new AbortController();
                    this.pdfPreviewAbortControllers.set(panel, controller);
                    const previous = this.pdfPreviewChains.get(panel);
                    const isPanelActive = (): boolean => panel.active;
                    const previewPromise = (async () => {
                        if (previous) await previous.catch(() => undefined);
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

    private async queueWebviewEdit(
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel,
        message: Extract<WebviewToHostMessage, { type: 'localChanges' }>
    ): Promise<void> {
        const key = document.uri.toString();
        const previous = this.editChains.get(key) ?? Promise.resolve();
        const current = previous
            .catch(() => undefined)
            .then(() => this.applyWebviewEdit(document, panel, message));
        this.editChains.set(key, current);
        try {
            await current;
        } finally {
            if (this.editChains.get(key) === current) this.editChains.delete(key);
        }
    }

    private async queueHistoryCommand(
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel,
        message: Extract<WebviewToHostMessage, { type: 'historyCommand' }>
    ): Promise<void> {
        const key = document.uri.toString();
        const previous = this.editChains.get(key) ?? Promise.resolve();
        const current = previous.then(async () => {
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

    private async applyWebviewEdit(
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel,
        message: Extract<WebviewToHostMessage, { type: 'localChanges' }>
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
        const key = document.uri.toString();
        const registeredClientId = this.panelClientIds.get(panel);
        if (registeredClientId && registeredClientId !== message.clientId) {
            throw new Error(this.getMessages().host.clientIdMismatch);
        }
        const previousApplication = (this.changeHistory.get(key) ?? []).find((entry) => (
            entry.clientId === message.clientId && entry.opId === message.opId
        ));
        if (previousApplication) {
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
        let changes = message.changes;
        let baseLength = currentCanonicalText.length;
        if (message.baseVersion !== document.version) {
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
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
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

    private onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
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

    private historySince(key: string, fromVersion: number, toVersion: number): ChangeHistoryEntry[] | undefined {
        const entries = (this.changeHistory.get(key) ?? [])
            .filter((entry) => entry.baseVersion >= fromVersion && entry.version <= toVersion)
            .sort((left, right) => left.baseVersion - right.baseVersion);
        let version = fromVersion;
        for (const entry of entries) {
            if (entry.baseVersion !== version) return undefined;
            version = entry.version;
        }
        return version === toVersion ? entries : undefined;
    }

    private wasOperationApplied(key: string, clientId: string, opId: string): boolean {
        return (this.changeHistory.get(key) ?? []).some((entry) => (
            entry.clientId === clientId && entry.opId === opId
        ));
    }

    private sendResync(
        panel: vscode.WebviewPanel,
        document: vscode.TextDocument,
        clientId: string,
        opId: string | undefined,
        reason: string
    ): void {
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

    /** 現在のVS Code文書を同期プロトコルのLF座標系へ変換し、文書スナップショットも更新する。 */
    private canonicalText(document: vscode.TextDocument): string {
        const key = document.uri.toString();
        const current = toCanonicalText(document.getText());
        this.canonicalDocumentTexts.set(key, current);
        return current;
    }

    private async saveImages(document: vscode.TextDocument, images: ImagePayload[]): Promise<string[]> {
        const messages = this.getMessages();
        if (document.uri.scheme === 'untitled') throw new Error(messages.host.imageDocumentMustBeSaved);
        if (!images.length) return [];
        const settings = this.getSettings();
        const maxBytes = settings.maxPasteSizeMb * 1024 * 1024;
        const assetDirectory = await this.ensureAssetDirectory(document);
        const results: string[] = [];

        for (const image of images) {
            let bytes = Buffer.from(image.base64, 'base64');
            if (bytes.byteLength > maxBytes) {
                throw new Error(messages.app.errors.imageSize(settings.maxPasteSizeMb));
            }
            const extension = extensionForMime(image.mime);
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

    private async pickAndSaveImages(document: vscode.TextDocument): Promise<string[]> {
        const selected = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
            openLabel: this.getMessages().ribbon.labels.image
        });
        if (!selected?.length) return [];
        const payloads: ImagePayload[] = [];
        for (const uri of selected) {
            const bytes = await vscode.workspace.fs.readFile(uri);
            payloads.push({
                name: path.basename(uri.fsPath),
                mime: mimeForFile(uri.path),
                base64: Buffer.from(bytes).toString('base64')
            });
        }
        return this.saveImages(document, payloads);
    }

    private async ensureAssetDirectory(document: vscode.TextDocument): Promise<vscode.Uri> {
        const configured = this.getSettings().imageDirectory.replace(
            /\$\{documentBasename\}/g,
            path.basename(document.uri.fsPath, path.extname(document.uri.fsPath))
        );
        const normalized = configured.replace(/\\/g, '/').replace(/^\.\//, '');
        if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
            throw new Error(this.getMessages().host.invalidImageDirectory);
        }
        const target = vscode.Uri.joinPath(document.uri, '..', ...normalized.split('/').filter(Boolean));
        await vscode.workspace.fs.createDirectory(target);
        return target;
    }

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

    private async checkLocalResources(document: vscode.TextDocument, markdown: string): Promise<Diagnostic[]> {
        const references = collectLocalResourceReferences(markdown);
        const diagnostics = await Promise.all(references.map(async (reference): Promise<Diagnostic | undefined> => {
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
        return sortDiagnostics(diagnostics.filter((item): item is Diagnostic => item !== undefined));
    }

    private getSettings(): WebviewSettings {
        const config = vscode.workspace.getConfiguration('markdownEasyVisualEditor');
        return {
            language: this.getLanguage(),
            imageDirectory: config.get('images.directory', 'assets/${documentBasename}'),
            maxPasteSizeMb: config.get('images.maxPasteSizeMb', 20),
            remoteImagesEnabled: config.get('remoteImages.enabled', false),
            mermaidTheme: config.get('mermaid.theme', 'auto'),
            mermaidHostRendering: true,
            editorTheme: config.get<WebviewSettings['editorTheme']>('editor.theme', 'dark'),
            viewMode: normalizeViewMode(this.context.globalState.get<unknown>(VIEW_MODE_STATE_KEY)),
            previewImageResizeControlsVisible: this.context.globalState.get<boolean>(PREVIEW_IMAGE_RESIZE_CONTROLS_STATE_KEY, true),
            workspaceTrusted: vscode.workspace.isTrusted
        };
    }

    private getLanguage() {
        const config = vscode.workspace.getConfiguration('markdownEasyVisualEditor');
        return resolveLanguage(config.get<string>('language', 'auto'), vscode.env.language);
    }

    private getMessages(): Messages {
        return getMessages(this.getLanguage());
    }

    private requestHtmlDocumentRender(
        panel: vscode.WebviewPanel,
        requestId: string,
        documents: Array<{ id: string; markdown: string }>
    ): Promise<HtmlRenderedDocument[]> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingHtmlRenderRequests.delete(requestId);
                reject(new Error(this.getMessages().host.htmlRenderTimeout));
            }, 120_000);
            this.pendingHtmlRenderRequests.set(requestId, { resolve, reject, timer });
            this.post(panel, { type: 'renderHtmlDocuments', requestId, documents });
        });
    }

    private broadcastSettings(): void {
        for (const panels of this.panels.values()) {
            for (const panel of panels) {
                this.post(panel, {
                    type: 'settingsChanged',
                    settings: this.getSettings()
                });
            }
        }
    }

    private getWebviewHtml(webview: vscode.Webview, document: vscode.TextDocument): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'));
        const markdownWorkerUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'markdown-worker.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'styles.css'));
        const bundledStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.css'));
        const baseUri = webview.asWebviewUri(vscode.Uri.joinPath(document.uri, '..'));
        const nonce = randomUUID().replace(/-/g, '');
        const allowRemote = this.getSettings().remoteImagesEnabled ? ' https: http:' : '';
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
        </head>
        <body data-mve-markdown-worker-uri="${markdownWorkerUri.toString()}">
          <div id="root"></div>
          <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
      </html>`;
    }

    private post(panel: vscode.WebviewPanel, message: HostToWebviewMessage): void {
        void panel.webview.postMessage(message);
    }
}

function hostDebug(message: string, details: Record<string, unknown>): void {
    if (process.env.MVE_DEBUG === '1') console.info(message, details);
}

/**
 * LF同期座標の変更を、現在のVS Code文書EOLを保ったWorkspaceEditへ変換する。
 */
async function applyChangeBatch(
    document: vscode.TextDocument,
    canonicalBaseText: string,
    changes: readonly TextChange[]
): Promise<boolean> {
    validateTextChanges(changes, canonicalBaseText.length);
    const currentCanonicalText = toCanonicalText(document.getText());
    if (currentCanonicalText !== canonicalBaseText) {
        throw new Error('Document changed before canonical edit application.');
    }
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const edit = new vscode.WorkspaceEdit();
    for (const change of changes) {
        const start = canonicalPositionAt(canonicalBaseText, change.rangeOffset);
        const end = canonicalPositionAt(
            canonicalBaseText,
            change.rangeOffset + change.rangeLength
        );
        edit.replace(
            document.uri,
            new vscode.Range(
                new vscode.Position(start.line, start.character),
                new vscode.Position(end.line, end.character)
            ),
            fromCanonicalText(change.text, eol)
        );
    }
    return vscode.workspace.applyEdit(edit);
}

function operationIdentity(clientId: string, opId: string): string {
    return `${clientId}\u0000${opId}`;
}

function isMarkdownDocumentPath(filePath: string): boolean {
    return /\.(?:md|markdown)$/i.test(filePath);
}

function normalizeViewMode(value: unknown): ViewMode {
    return value === 'text' || value === 'preview' ? value : 'both';
}

function extensionForMime(mime: string): string | undefined {
    return (
        {
            'image/png': 'png',
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/gif': 'gif',
            'image/webp': 'webp',
            'image/svg+xml': 'svg'
        } as Record<string, string>
    )[mime.toLowerCase()];
}

function mimeForFile(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();
    return (
        {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
            '.bmp': 'image/bmp'
        } as Record<string, string>
    )[extension] ?? 'application/octet-stream';
}

function relativeUriPath(documentUri: vscode.Uri, target: vscode.Uri): string {
    if (documentUri.scheme === 'file' && target.scheme === 'file') {
        return path.relative(path.dirname(documentUri.fsPath), target.fsPath).replace(/\\/g, '/');
    }
    const base = documentUri.path.slice(0, documentUri.path.lastIndexOf('/') + 1);
    return target.path.startsWith(base) ? target.path.slice(base.length) : target.path;
}

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

function compactTimestamp(date: Date): string {
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

function sanitizeSvg(value: string): string {
    return value
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
        .replace(/(?:javascript|data:text\/html):/gi, '');
}

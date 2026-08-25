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
import { applyTextChanges, mapTextChanges, validateTextChanges, type TextChange } from '../shared/textChanges';
import { getMessages, resolveLanguage, type Messages } from '../shared/messages';
import { closePdfBrowser, exportPdf, renderPdf } from './pdf';
import {
  prepareHtmlExport,
  writePreparedHtml,
  type HtmlRenderedDocument
} from './html';
import { decodeLocalResourceSource, isMissingResourceError } from './resourceCheck';
import { classifyResourceLink } from './resourceLink';

const VIEW_TYPE = 'markdownEasyVisualEditor.editor';
const VIEW_MODE_STATE_KEY = 'markdownEasyVisualEditor.viewMode';

interface PendingHostOperation {
  panel: vscode.WebviewPanel;
  clientId: string;
  opId: string;
  appliedBaseVersion: number;
  baseText: string;
  expectedText: string;
  changes: TextChange[];
}

interface ChangeHistoryEntry {
  baseVersion: number;
  version: number;
  baseLength: number;
  changes: TextChange[];
  clientId?: string;
  opId?: string;
}

/**
 * カスタムエディターとMarkdown Easy Visual EditorのコマンドをVS Codeへ登録する。
 * @param context 拡張機能のサブスクリプションとURIを保持するVS Codeコンテキスト。
 * @returns 登録処理の完了後は何も返さない。
 */
export function activate(context: vscode.ExtensionContext): void {
  // カスタムエディターと拡張機能の各コマンドをVS Codeへ登録する。
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
    vscode.commands.registerCommand('markdownEasyVisualEditor.exportPdf', () => provider.sendCommand('exportPdf')),
    vscode.commands.registerCommand('markdownEasyVisualEditor.undo', () => provider.executeHistoryCommand('undo')),
    vscode.commands.registerCommand('markdownEasyVisualEditor.redo', () => provider.executeHistoryCommand('redo')),
  );
}

/**
 * activateで登録したサブスクリプションの破棄をVS Codeへ任せる。
 * @returns 共有PDFブラウザの終了完了を待つPromise。
 */
export async function deactivate(): Promise<void> {
  await closePdfBrowser();
}

class MarkdownEasyVisualEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly panels = new Map<string, Set<vscode.WebviewPanel>>();
  private readonly documents = new Map<string, vscode.TextDocument>();
  private readonly activeOperations = new Map<string, PendingHostOperation>();
  private readonly activeOperationKeysByDocument = new Map<string, string>();
  private readonly changeHistory = new Map<string, ChangeHistoryEntry[]>();
  private readonly editChains = new Map<string, Promise<void>>();
  private readonly pdfPreviewGenerations = new WeakMap<vscode.WebviewPanel, number>();
  private readonly pdfPreviewAbortControllers = new WeakMap<vscode.WebviewPanel, AbortController>();
  private readonly pdfPreviewChains = new WeakMap<vscode.WebviewPanel, Promise<void>>();
  private readonly pendingHtmlRenderRequests = new Map<string, {
    resolve: (documents: HtmlRenderedDocument[]) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private readonly panelClientIds = new WeakMap<vscode.WebviewPanel, string>();
  private activePanel?: vscode.WebviewPanel;
  private activeDocument?: vscode.TextDocument;

  /**
   * 文書変更・設定変更・信頼状態変更の監視を登録する。
   * @param context 拡張機能のサブスクリプションを登録するコンテキスト。
   */
  constructor(private readonly context: vscode.ExtensionContext) {
    // 文書変更・設定変更・ワークスペース信頼変更を監視し、Webviewへ状態を反映する。
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((event) => this.onDocumentChanged(event)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('markdownEasyVisualEditor')) this.broadcastSettings();
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.broadcastSettings())
    );
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
    // 文書とWebviewパネルを登録し、HTML・メッセージ受信・破棄時の後処理を設定する。
    const key = document.uri.toString();
    this.documents.set(key, document);
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

    // Webviewからのメッセージを対象文書とパネルに紐付けて処理する。
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
      // パネル破棄時に登録情報・履歴・保留中の操作を文書単位で片付ける。
      this.pdfPreviewAbortControllers.get(webviewPanel)?.abort();
      messageDisposable.dispose();
      group.delete(webviewPanel);
      if (!group.size) {
        this.panels.delete(key);
        this.documents.delete(key);
        this.changeHistory.delete(key);
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
  sendCommand(command: 'insertImage' | 'exportPdf'): void {
    // アクティブなWebviewへホストコマンドを送る。
    if (!this.activePanel) return;
    this.post(this.activePanel, { type: 'hostCommand', command });
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
    console.info('[MVE host] message', {
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
          this.post(panel, {
            type: 'init',
            text: document.getText(),
            version: document.version,
            uri: document.uri.toString(),
            settings: this.getSettings()
          });
          return;
        case 'localChanges':
          await this.queueWebviewEdit(document, panel, message);
          return;
        case 'historyCommand': {
          await this.queueHistoryCommand(document, panel, message);
          return;
        }
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
          await (this.editChains.get(documentKey) ?? Promise.resolve()).catch(() => undefined);
          this.post(panel, {
            type: 'resyncRequired',
            clientId: message.clientId,
            opId: message.opId,
            operationApplied: message.opId
              ? this.wasOperationApplied(documentKey, message.clientId, message.opId)
              : undefined,
            text: document.getText(),
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
          if (!vscode.workspace.isTrusted) {
            throw new Error(this.getMessages().host.htmlTrustRequired);
          }
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
          if (!vscode.workspace.isTrusted) {
            throw new Error(this.getMessages().host.pdfTrustRequired);
          }
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
    message: Extract<WebviewToHostMessage, { type: 'localChanges' }>
  ): Promise<void> {
    // 同一文書のWebview編集を前の編集完了後に直列実行する。
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
    message: Extract<WebviewToHostMessage, { type: 'historyCommand' }>
  ): Promise<void> {
    // Undo/Redo要求を同一文書の編集キューへ追加し、アクティブなパネルだけで実行する。
    const key = document.uri.toString();
    const previous = this.editChains.get(key) ?? Promise.resolve();
    const current = previous
      .then(async () => {
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
    message: Extract<WebviewToHostMessage, { type: 'localChanges' }>
  ): Promise<void> {
    console.info('[MVE host] localChanges received', {
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
    const previousApplication = (this.changeHistory.get(key) ?? []).find((entry) => (
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
    let changes = message.changes;
    let baseLength = document.getText().length;
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
      baseLength = document.getText().length;
    }
    validateTextChanges(changes, baseLength);
    const baseText = document.getText();
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
    const applied = await applyChangeBatch(document, changes);
    console.info('[MVE host] localChanges apply result', {
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
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const active = this.activeOperations.get(operationKey);
    if (active?.opId === message.opId) {
      this.activeOperations.delete(operationKey);
      if (this.activeOperationKeysByDocument.get(key) === operationKey) this.activeOperationKeysByDocument.delete(key);
      if (document.getText() !== active.expectedText) {
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
    const changes = event.contentChanges.map((change) => ({
      rangeOffset: change.rangeOffset,
      rangeLength: change.rangeLength,
      text: change.text
    }));
    console.info('[MVE host] document changed', {
      document: key,
      version: event.document.version,
      changeCount: changes.length,
      changes: changes.slice(0, 8),
      activeOpId: active?.opId
    });
    if (!changes.length) {
      console.info('[MVE host] document changed ignored (no content changes)', {
        document: key,
        version: event.document.version,
        activeOpId: active?.opId
      });
      return;
    }
    const baseVersion = event.document.version - 1;
    const baseLength = event.document.getText().length
      - changes.reduce((total, change) => total + change.text.length - change.rangeLength, 0);
    const matchesActiveOperation = Boolean(
      active
      && baseVersion === active.appliedBaseVersion
      // 変更配列の形ではなく、同じ基準版から期待本文へ到達したかで自分の操作を判定する。
      && event.document.getText() === active.expectedText
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
      .filter((entry) => entry.baseVersion >= fromVersion && entry.version <= toVersion)
      .sort((left, right) => left.baseVersion - right.baseVersion);
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
    return (this.changeHistory.get(key) ?? []).some((entry) => (
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
    // 最新本文・バージョン・操作適用状態をパネルへ送り、Webviewを再同期させる。
    this.post(panel, {
      type: 'resyncRequired',
      clientId,
      opId,
      operationApplied: opId ? this.wasOperationApplied(document.uri.toString(), clientId, opId) : undefined,
      text: document.getText(),
      version: document.version,
      reason
    });
  }

  /**
   * 受信した画像を設定されたアセットディレクトリへ保存し、相対パスを返す。
   * @param document 画像を参照するMarkdown文書。
   * @param images Base64形式で受信した画像一覧。
   * @returns 保存した画像の相対パス一覧。
   * @throws 未保存文書、サイズ超過、未対応形式、または保存失敗の場合。
   */
  private async saveImages(document: vscode.TextDocument, images: ImagePayload[]): Promise<string[]> {
    // 画像を設定された保存先へ書き込み、Markdownから参照する相対パスを返す。
    const messages = this.getMessages();
    if (document.uri.scheme === 'untitled') throw new Error(messages.host.imageDocumentMustBeSaved);
    if (!images.length) return [];
    const settings = this.getSettings();
    const maxBytes = settings.maxPasteSizeMb * 1024 * 1024;
    const assetDirectory = await this.ensureAssetDirectory(document);
    const results: string[] = [];

    for (const image of images) {
      // Base64をバイト列へ戻し、サイズ・形式・SVGの安全性を確認して保存する。
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

  /**
   * 画像ファイルを選択ダイアログで受け取り、文書用アセットとして保存する。
   * @param document 画像を参照するMarkdown文書。
   * @returns 保存した画像の相対パス一覧を解決するPromise。
   */
  private async pickAndSaveImages(document: vscode.TextDocument): Promise<string[]> {
    // ファイル選択ダイアログで画像を選び、保存処理が受け取れるペイロードへ変換する。
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
      // 選択ファイルを読み込み、ファイル名・MIMEタイプ・Base64本文をまとめる。
      const bytes = await vscode.workspace.fs.readFile(uri);
      payloads.push({
        name: path.basename(uri.fsPath),
        mime: mimeForFile(uri.path),
        base64: Buffer.from(bytes).toString('base64')
      });
    }
    return this.saveImages(document, payloads);
  }

  /**
   * 設定された画像保存先を検証して作成し、そのURIを返す。
   * @param document 画像保存先の基準となるMarkdown文書。
   * @returns 作成または確認したアセットディレクトリのURI。
   * @throws 絶対パスや親ディレクトリを含む安全でない設定の場合。
   */
  private async ensureAssetDirectory(document: vscode.TextDocument): Promise<vscode.Uri> {
    // 設定値のプレースホルダーを展開し、安全な相対パスの画像保存先を作成する。
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

  /** Markdownから参照されたローカル画像・リンクの実在を確認する。 */
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

  /**
   * VS Codeの設定値とワークスペース信頼状態からWebview設定を作る。
   * @returns Webviewへ送信する設定値。
   */
  private getSettings(): WebviewSettings {
    // VS Code設定とワークスペース信頼状態をWebview用の設定オブジェクトへまとめる。
    const config = vscode.workspace.getConfiguration('markdownEasyVisualEditor');
    return {
      language: this.getLanguage(),
      imageDirectory: config.get('images.directory', 'assets/${documentBasename}'),
      maxPasteSizeMb: config.get('images.maxPasteSizeMb', 20),
      remoteImagesEnabled: config.get('remoteImages.enabled', false),
      mermaidTheme: config.get('mermaid.theme', 'auto'),
      editorTheme: config.get<WebviewSettings['editorTheme']>('editor.theme', 'dark'),
      viewMode: normalizeViewMode(this.context.globalState.get<unknown>(VIEW_MODE_STATE_KEY)),
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

  /** 再帰HTML出力用の子MarkdownをWebviewで描画し、SVG化済みHTMLを受け取る。 */
  private requestHtmlDocumentRender(
    panel: vscode.WebviewPanel,
    requestId: string,
    documents: Array<{ id: string; markdown: string }>
  ): Promise<HtmlRenderedDocument[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingHtmlRenderRequests.delete(requestId);
        reject(new Error(this.getMessages().host.htmlRenderTimeout));
      }, 30_000);
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
    for (const panels of this.panels.values()) {
      for (const panel of panels) {
        this.post(panel, {
          type: 'settingsChanged',
          settings: this.getSettings()
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
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:${allowRemote}; font-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}'; worker-src ${webview.cspSource} blob:; connect-src 'none';">
          <link rel="stylesheet" href="${styleUri}">
          <link rel="stylesheet" href="${bundledStyleUri}">
          <title>Markdown Easy Visual Editor</title>
        </head>
        <body>
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
 * テキスト変更一覧をVS CodeのWorkspaceEditへ変換して適用する。
 * @param document 変更を適用する文書。
 * @param changes 適用するテキスト変更一覧。
 * @returns VS Codeが変更を受け付けた場合はtrue。
 * @throws 変更範囲が文書に対して不正な場合。
 */
async function applyChangeBatch(document: vscode.TextDocument, changes: readonly TextChange[]): Promise<boolean> {
  // 差分をVS CodeのWorkspaceEditへ変換し、文書へ一括適用する。
  validateTextChanges(changes, document.getText().length);
  const edit = new vscode.WorkspaceEdit();
  for (const change of changes) {
    edit.replace(
      document.uri,
      new vscode.Range(
        document.positionAt(change.rangeOffset),
        document.positionAt(change.rangeOffset + change.rangeLength)
      ),
      change.text
    );
  }
  return vscode.workspace.applyEdit(edit);
}

/**
 * クライアントIDと操作IDから、操作履歴で使用する一意キーを作る。
 * @param clientId 操作元のクライアントID。
 * @param opId 操作ID。
 * @returns 操作を一意に識別する文字列。
 */
function operationIdentity(clientId: string, opId: string): string {
  // クライアントIDと操作IDを衝突しない1つのキーへ連結する。
  return `${clientId}\u0000${opId}`;
}

/** 永続化された表示モードを安全な3状態へ正規化する。 */
function normalizeViewMode(value: unknown): ViewMode {
  return value === 'text' || value === 'preview' ? value : 'both';
}

/**
 * 画像MIMEタイプを保存用ファイル拡張子へ変換する。
 * @param mime 変換対象のMIMEタイプ。
 * @returns 対応する拡張子。未対応の場合はundefined。
 */
function extensionForMime(mime: string): string | undefined {
  // MIMEタイプを画像ファイルの拡張子へ変換する。
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
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp'
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

/** Markdown文書を基準にローカル参照先のURIを解決する。 */
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

/**
 * @fileoverview Extension HostがHTML出力設定を読み込み、Webviewへ通知し、更新値を保存する経路を検証する。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Extension Hostのモックと同じ状態を参照するVS Code API群を生成する。
 */
const vscodeMock = vi.hoisted(

    () => {
        const state = new Map<string, unknown>();
        const configurationValues = new Map<string, unknown>();
        /** VS Code URIのパス・フラグメント操作を再現するテスト用オブジェクトを作る。 */
        const createUri = (scheme: string, uriPath: string, fragment = '') => ({
            scheme,
            path: uriPath,
            fsPath: uriPath,
            authority: '',
            query: '',
            fragment,
            toString() {
                return `${scheme}://${uriPath}${fragment ? `#${encodeURIComponent(fragment)}` : ''}`;
            },
            with(change: { path?: string; fragment?: string }) {
                return createUri(scheme, change.path ?? uriPath, change.fragment ?? fragment);
            },
        });
        const workspaceFolder = { uri: createUri('file', '/workspace/root') };

        /** globalState.updateの既定動作。旧形式の値と移行済み印を保持する。 */
        const defaultUpdate = /**
   * VS CodeのglobalState.updateを模倣し、値をテスト用ストアへ保存する。
   * @param key - 保存する設定キー。
   * @param value - 設定へ保存する値。
   */ async (key: string, value: unknown): Promise<void> => {
                state.set(key, value);
            };
        /** VS Code設定APIのglobal値を保持し、設定の読み書きを再現する。 */
        const configuration = {
            get: vi.fn(

                (key: string, fallback: unknown) =>
                    configurationValues.has(key) ? configurationValues.get(key) : fallback),
            inspect: vi.fn(

                (key: string) => configurationValues.has(key)
                    ? { globalValue: configurationValues.get(key) }
                    : undefined),
            update: vi.fn(
                /** global対象への設定書き込みをテスト用の設定ストアへ反映する。 */
                async (key: string, value: unknown, _target: unknown) => {
                    configurationValues.set(key, value);
                }),
        };
        const globalState = {
            get: vi.fn(
                /**
                 * @param key - globalStateモックから値を取得する設定キー。
                 * @param fallback - キーが未登録の場合に返す値。
                 */
                (key: string, fallback?: unknown) => state.has(key) ? state.get(key) : fallback),
            update: vi.fn(defaultUpdate),
        };
        const event = vi.fn(

            () => ({ dispose: vi.fn() }));
        return {
            state,
            configurationValues,
            workspaceFolder,
            getWorkspaceFolder: vi.fn(() => undefined),
            asRelativePath: vi.fn(() => 'guides/extended syntax.md'),
            openTextDocument: vi.fn(async (_uri: unknown) => ({
                getText: () => '# 拡張構文',
                offsetAt: () => 0
            })),
            joinPath: vi.fn((base: any, ...segments: string[]) => ({
                ...createUri(
                    base.scheme,
                    [base.path.replace(/\/$/, ''), ...segments].join('/').replace(/\/+/g, '/'),
                ),
            })),
            file: vi.fn((filePath: string) => createUri('file', filePath)),
            showTextDocument: vi.fn(async () => undefined),
            executeCommand: vi.fn(async (_command: string, ..._args: unknown[]) => undefined),
            activeTextEditor: undefined as any,
            activeTab: undefined as any,
            configuration,
            defaultUpdate,
            globalState,
            event,
            clipboardWriteText: vi.fn(async (_value: string) => undefined),
            showInformationMessage: vi.fn(async (..._args: any[]): Promise<any> => undefined),
            withProgress: vi.fn(async (_options: unknown, task: () => Promise<unknown>) => task()),
            openExternal: vi.fn(async (_uri: unknown) => true),
            getConfiguration: vi.fn(
                /**
                 * 呼び出し元にテスト用設定オブジェクトを返す。
                 */
                () => configuration),
        };
    });

vi.mock('vscode',
    /**
     * 拡張機能が読む設定とコマンドを持つVS Code APIスタブを作成する。
     */
    () => ({
        workspace: {
            onDidChangeTextDocument: vscodeMock.event,
            onDidChangeConfiguration: vscodeMock.event,
            onDidGrantWorkspaceTrust: vscodeMock.event,
            getConfiguration: vscodeMock.getConfiguration,
            getWorkspaceFolder: vscodeMock.getWorkspaceFolder,
            asRelativePath: vscodeMock.asRelativePath,
            openTextDocument: vscodeMock.openTextDocument,
            isTrusted: true,
        },
        Uri: { joinPath: vscodeMock.joinPath, file: vscodeMock.file },
        Position: class Position { constructor(public line: number, public character: number) {} },
        Range: class Range { constructor(public start: unknown, public end: unknown) {} },
        ConfigurationTarget: { Global: 'global' },
        window: {
            showErrorMessage: vi.fn(),
            showInformationMessage: vscodeMock.showInformationMessage,
            withProgress: vscodeMock.withProgress,
            showTextDocument: vscodeMock.showTextDocument,
            get activeTextEditor() { return vscodeMock.activeTextEditor; },
            tabGroups: { activeTabGroup: { get activeTab() { return vscodeMock.activeTab; } } },
        },
        commands: { executeCommand: vscodeMock.executeCommand },
        Selection: class Selection {
            readonly start: any;
            readonly end: any;
            constructor(public anchor: any, public active: any) {
                this.start = anchor;
                this.end = active;
            }
        },
        TextEditorRevealType: { InCenter: 0 },
        ProgressLocation: { Notification: 'notification' },
        env: {
            language: 'en',
            clipboard: { writeText: vscodeMock.clipboardWriteText },
            openExternal: vscodeMock.openExternal,
        },
    }));

const htmlExportMock = vi.hoisted(() => ({
    prepareHtmlExport: vi.fn(async (..._args: any[]): Promise<any> => ({ documents: [] })),
    writePreparedHtml: vi.fn(async (..._args: any[]): Promise<any> => undefined),
}));

vi.mock('../src/extension/html', () => htmlExportMock);

const htmlPreviewMock = vi.hoisted(() => ({ openHtmlPreview: vi.fn(async () => undefined) }));
vi.mock('../src/extension/htmlPreview', () => htmlPreviewMock);

import { MarkdownEasyVisualEditorProvider } from '../src/extension/extension';
import type { HtmlExportSettings } from '../src/shared/protocol';

/**
 * globalStateでHTML出力設定を保存するキー。
 */
const HTML_OPTIONS_STATE_KEY = 'markdownEasyVisualEditor.htmlOptions';

/**
 * HTML設定のHost処理が参照するVS Code拡張contextを作る。
 * @returns HTML設定の保存とVS Code APIを模擬するcontext。
 */
function createContext(): any {
    return {
        subscriptions: [],
        globalState: vscodeMock.globalState,
        extensionUri: {},
    };
}

/**
 * 指定URIとHTML設定を持つVS Code文書のテストdoubleを作る。
 * @param uri - VS Codeまたはブラウザーが扱うリソースURI。
 * @returns 指定URIとHTML設定を持つ文書のテストdouble。
 */
function createDocument(uri = 'file:///workspace/main.md'): any {
    return {
        uri: {
            scheme: 'file',
            fsPath: uri.replace(/^file:\/\//, ''),


            toString: () => uri,
        },
        version: 1,


        getText: () => '',
    };
}

/**
 * テスト用のWebviewパネルを生成し、指定文書と拡張プロバイダーへ関連付ける。
 * @param provider - テスト用Webviewパネルを登録するExtension Provider。
 * @param document - Webviewパネルへ関連付けるテスト用Markdown文書。
 * @returns プロバイダーへ追加したWebviewパネル。
 */
function addPanel(provider: MarkdownEasyVisualEditorProvider, document: any): any {
    return addPanels(provider, document, 1)[0];
}

/**
 * 指定数のWebviewパネルを生成し、テスト文書と拡張プロバイダーへ関連付ける。
 * @param provider - 内部mapへテスト用パネルと文書を登録するExtension Provider。
 * @param document - パネル登録と文書ID生成に使うテスト用Markdown文書。
 * @param count - 生成して登録するWebviewパネル数。
 * @returns プロバイダーへ追加したパネル一覧。
 */
function addPanels(provider: MarkdownEasyVisualEditorProvider, document: any, count: number): any[] {
    const panels = Array.from({ length: count },

        () => ({ webview: { postMessage: vi.fn() } }));
    const instance = provider as any;
    const key = document.uri.toString();
    instance.panels.set(key, new Set(panels));
    instance.documents.set(key, document);
    return panels;
}

/**
 * HTML出力設定の更新要求を、指定したWebviewパネルからExtension Hostへ送る。
 * @param provider 設定要求を処理するExtension Host側のプロバイダー。
 * @param document 更新先設定の文書スコープを決めるテスト用Markdown文書。
 * @param panel 要求元となり、結果メッセージを受け取るWebviewパネル。
 * @param options 画像埋め込み、Markdownリンク変換、保存ダイアログの各設定値。
 */
async function setHtmlOptions(
    provider: MarkdownEasyVisualEditorProvider,
    document: any,
    panel: any,
    options: HtmlExportSettings,
): Promise<void> {
    await (provider as any).handleMessage(document, panel, {
        type: 'setHtmlOptions',
        options,
    });
}

afterEach(
    /**
     * HTML設定Host・テストの回帰の前提条件を準備し、回帰条件を検証するテストケース。
     */
    () => {
        vscodeMock.state.clear();
        vscodeMock.configurationValues.clear();
        vscodeMock.globalState.get.mockClear();
        vscodeMock.globalState.update.mockReset();
        vscodeMock.globalState.update.mockImplementation(vscodeMock.defaultUpdate);
        vscodeMock.getConfiguration.mockClear();
        vscodeMock.getWorkspaceFolder.mockReset();
        vscodeMock.getWorkspaceFolder.mockReturnValue(undefined);
        vscodeMock.asRelativePath.mockReset();
        vscodeMock.asRelativePath.mockReturnValue('guides/extended syntax.md');
        vscodeMock.openTextDocument.mockReset();
        vscodeMock.openTextDocument.mockImplementation(async (_uri: unknown) => ({
            getText: () => '# 拡張構文',
            offsetAt: () => 0
        }));
        vscodeMock.joinPath.mockClear();
        vscodeMock.file.mockClear();
        vscodeMock.showTextDocument.mockClear();
        vscodeMock.executeCommand.mockClear();
        htmlPreviewMock.openHtmlPreview.mockClear();
        vscodeMock.activeTextEditor = undefined;
        vscodeMock.activeTab = undefined;
        vscodeMock.clipboardWriteText.mockClear();
        vscodeMock.showInformationMessage.mockReset();
        vscodeMock.showInformationMessage.mockResolvedValue(undefined);
        vscodeMock.withProgress.mockReset();
        vscodeMock.withProgress.mockImplementation(async (_options: unknown, task: () => Promise<unknown>) => task());
        vscodeMock.openExternal.mockReset();
        vscodeMock.openExternal.mockResolvedValue(true);
        htmlExportMock.prepareHtmlExport.mockReset();
        htmlExportMock.prepareHtmlExport.mockResolvedValue({ documents: [] });
        htmlExportMock.writePreparedHtml.mockReset();
        htmlExportMock.writePreparedHtml.mockResolvedValue(undefined);
        vscodeMock.configuration.get.mockClear();
        vscodeMock.configuration.inspect.mockClear();
        vscodeMock.configuration.update.mockReset();
        vscodeMock.configuration.update.mockImplementation(
            /** 各テストを初期化し、標準のglobal設定保存動作へ戻す。 */
            async (key: string, value: unknown) => {
                vscodeMock.configurationValues.set(key, value);
            });
    });

describe('HTML export completion action in the extension host', () => {
    it('opens exported HTML in the dedicated preview', async () => {
        const provider = new MarkdownEasyVisualEditorProvider(createContext());
        const document = createDocument('file:///workspace/root/source.md');
        const panel = addPanel(provider, document);
        const target = vscodeMock.file('/workspace/root/out/source.html');
        htmlExportMock.prepareHtmlExport.mockResolvedValue({ documents: [] });
        htmlExportMock.writePreparedHtml.mockResolvedValue({ target, paths: [target] });
        vscodeMock.showInformationMessage.mockImplementation(async (_message, openAction) => openAction);

        await (provider as any).handleMessage(document, panel, {
            type: 'exportHtml',
            requestId: 'html-open-test',
            markdown: '# Section',
            html: '<h1 id="section">Section</h1>',
            css: '',
            options: {
                embedImages: false,
                convertLinkedMarkdown: false,
                saveWithoutDialog: true,
            },
        });

        expect(vscodeMock.showInformationMessage).toHaveBeenCalledOnce();
        expect(vscodeMock.showInformationMessage.mock.calls[0]).toHaveLength(2);
        expect(target.scheme).toBe('file');
        await vi.waitFor(() => expect(htmlPreviewMock.openHtmlPreview).toHaveBeenCalledWith(target));
        expect(vscodeMock.openExternal).not.toHaveBeenCalled();
    });

    it('does not open the exported file when the notification is dismissed', async () => {
        const provider = new MarkdownEasyVisualEditorProvider(createContext());
        const document = createDocument('file:///workspace/root/source.md');
        const panel = addPanel(provider, document);
        const target = vscodeMock.file('/workspace/root/out/source.html');
        htmlExportMock.prepareHtmlExport.mockResolvedValue({ documents: [] });
        htmlExportMock.writePreparedHtml.mockResolvedValue({ target, paths: [target] });
        vscodeMock.showInformationMessage.mockResolvedValue(undefined);

        await (provider as any).handleMessage(document, panel, {
            type: 'exportHtml',
            requestId: 'html-dismiss-test',
            markdown: '# Section',
            html: '<h1 id="section">Section</h1>',
            css: '',
            options: {
                embedImages: false,
                convertLinkedMarkdown: false,
                saveWithoutDialog: true,
            },
        });

        await Promise.resolve();
        expect(vscodeMock.openExternal).not.toHaveBeenCalled();
    });
});

describe('section link clipboard in the extension host', () => {
    it('writes a Markdown fragment link and acknowledges the copy', async () => {
        const provider = new MarkdownEasyVisualEditorProvider(createContext());
        const document = createDocument('file:///workspace/拡張構文.md');
        const panel = addPanel(provider, document);

        await (provider as any).handleMessage(document, panel, {
            type: 'copySectionLink',
            scope: 'document',
            id: '拡張構文',
            text: '拡張構文',
        });

        expect(vscodeMock.clipboardWriteText).toHaveBeenCalledOnce();
        expect(vscodeMock.clipboardWriteText).toHaveBeenCalledWith('[拡張構文](#拡張構文)');
        expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: 'sectionLinkCopied' });
    });

    it('writes a workspace-rooted Markdown path from the document workspace folder', async () => {
        const provider = new MarkdownEasyVisualEditorProvider(createContext());
        const document = createDocument('file:///workspace/guides/extended%20syntax.md');
        const panel = addPanel(provider, document);
        vscodeMock.getWorkspaceFolder.mockReturnValue(vscodeMock.workspaceFolder as any);

        await (provider as any).handleMessage(document, panel, {
            type: 'copySectionLink',
            scope: 'workspace',
            id: '拡張構文',
            text: '拡張構文',
        });

        expect(vscodeMock.asRelativePath).toHaveBeenCalledWith(document.uri, false);
        expect(vscodeMock.clipboardWriteText).toHaveBeenCalledWith('[拡張構文](/guides/extended%20syntax.md#拡張構文 "MVE workspace-root link")');
        expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: 'sectionLinkCopied' });
    });

    it('does not copy a workspace link when the document has no workspace folder', async () => {
        const provider = new MarkdownEasyVisualEditorProvider(createContext());
        const document = createDocument('file:///outside/guide.md');
        const panel = addPanel(provider, document);

        await (provider as any).handleMessage(document, panel, {
            type: 'copySectionLink',
            scope: 'workspace',
            id: '拡張構文',
            text: '拡張構文',
        });

        expect(vscodeMock.clipboardWriteText).not.toHaveBeenCalled();
        expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: 'workspaceSectionLinkUnavailable' });
    });

    it('opens a workspace-rooted section link in the default editor at its heading', async () => {
        const provider = new MarkdownEasyVisualEditorProvider(createContext());
        const destinationDocument = createDocument('file:///workspace/root/notes/other.md');
        destinationDocument.uri.path = '/workspace/root/notes/other.md';
        vscodeMock.getWorkspaceFolder.mockReturnValue(vscodeMock.workspaceFolder as any);
        let activeEditor: any;
        vscodeMock.executeCommand.mockImplementationOnce(async (...args: unknown[]) => {
            const openedUri = args[1];
            activeEditor = {
                document: { uri: openedUri },
                selection: undefined,
                revealRange: vi.fn(),
            };
            vscodeMock.activeTextEditor = activeEditor;
        });

        await (provider as any).openResource(destinationDocument, '/guides/extended%20syntax.md#拡張構文', true);

        expect(vscodeMock.joinPath).toHaveBeenCalledWith(
            vscodeMock.workspaceFolder.uri,
            'guides',
            'extended syntax.md',
        );
        expect(vscodeMock.openTextDocument).toHaveBeenCalledOnce();
        expect((vscodeMock.openTextDocument.mock.calls[0][0] as any).path).toBe('/workspace/root/guides/extended syntax.md');
        expect(vscodeMock.executeCommand).toHaveBeenCalledOnce();
        const [command, openedUri, options] = vscodeMock.executeCommand.mock.calls[0];
        expect(command).toBe('vscode.open');
        expect((openedUri as any).path).toBe('/workspace/root/guides/extended syntax.md');
        expect((openedUri as any).fragment).toBe('');
        expect(options).toBeUndefined();
        expect(activeEditor.selection.start.line).toBe(0);
        expect(activeEditor.revealRange).toHaveBeenCalledOnce();
        expect(vscodeMock.showTextDocument).not.toHaveBeenCalled();
    });

    it('sends the LF-normalized heading offset to the active custom editor after it becomes ready', async () => {
        const provider = new MarkdownEasyVisualEditorProvider(createContext());
        const destinationDocument = createDocument('file:///workspace/root/guides/extended%20syntax.md');
        destinationDocument.uri.path = '/workspace/root/guides/extended syntax.md';
        vscodeMock.configurationValues.set('editorAssociations', {
            '*.md': 'markdownEasyVisualEditor.editor'
        });
        const backgroundPanel = { active: false, webview: { postMessage: vi.fn(async () => true) } };
        const activePanel = { active: true, webview: { postMessage: vi.fn(async () => true) } };
        const targetText = '# A\r\ntext\r\n# B';
        vscodeMock.openTextDocument.mockResolvedValue({
            getText: () => targetText,
            offsetAt: () => 11,
        } as any);
        vscodeMock.executeCommand.mockImplementationOnce(async (...args: unknown[]) => {
            const openedUri = args[1] as any;
            vscodeMock.activeTab = {
                input: { viewType: 'markdownEasyVisualEditor.editor', uri: openedUri }
            };
            (provider as any).panels.set(openedUri.toString(), new Set([backgroundPanel, activePanel]));
            (provider as any).panelInitialized.add(backgroundPanel);
            setTimeout(() => {
                (provider as any).panelInitialized.add(activePanel);
                (provider as any).resolvePanelReady(openedUri.toString(), activePanel);
            }, 0);
        });
        vscodeMock.getWorkspaceFolder.mockReturnValue(vscodeMock.workspaceFolder as any);

        await (provider as any).openResource(destinationDocument, '/guides/extended%20syntax.md#b', true);

        expect(activePanel.webview.postMessage).toHaveBeenCalledWith({
            type: 'hostCommand',
            command: 'navigateToOffset',
            offset: 9,
        });
        expect(backgroundPanel.webview.postMessage).not.toHaveBeenCalled();
        expect(vscodeMock.activeTextEditor).toBeUndefined();
    });

    it('opens a heading link through the selected custom editor with its fragment', async () => {
        const provider = new MarkdownEasyVisualEditorProvider(createContext());
        const destinationDocument = createDocument('file:///workspace/root/guides/extended%20syntax.md');
        destinationDocument.uri.path = '/workspace/root/guides/extended syntax.md';
        vscodeMock.configurationValues.set('editorAssociations', {
            '*.md': 'vscode.markdown.preview.editor'
        });
        vscodeMock.executeCommand.mockImplementationOnce(async (...args: unknown[]) => {
            const openedUri = args[1] as any;
            vscodeMock.activeTab = {
                input: { viewType: 'vscode.markdown.preview.editor', uri: openedUri }
            };
        });
        vscodeMock.getWorkspaceFolder.mockReturnValue(vscodeMock.workspaceFolder as any);

        await (provider as any).openResource(destinationDocument, '/guides/extended%20syntax.md#拡張構文', true);

        const [command, openedUri] = vscodeMock.executeCommand.mock.calls[0];
        expect(command).toBe('vscode.open');
        expect((openedUri as any).fragment).toBe('拡張構文');
        expect(vscodeMock.activeTextEditor).toBeUndefined();
    });

    it('uses the most specific matching editor association', async () => {
        const provider = new MarkdownEasyVisualEditorProvider(createContext());
        const destinationDocument = createDocument('file:///workspace/root/guides/extended%20syntax.md');
        destinationDocument.uri.path = '/workspace/root/guides/extended syntax.md';
        vscodeMock.configurationValues.set('editorAssociations', {
            '*.md': 'markdownEasyVisualEditor.editor',
            '**/guides/*.md': 'vscode.markdown.preview.editor'
        });
        vscodeMock.executeCommand.mockImplementationOnce(async (...args: unknown[]) => {
            const openedUri = args[1] as any;
            vscodeMock.activeTab = {
                input: { viewType: 'vscode.markdown.preview.editor', uri: openedUri }
            };
        });
        vscodeMock.getWorkspaceFolder.mockReturnValue(vscodeMock.workspaceFolder as any);

        await (provider as any).openResource(destinationDocument, '/guides/extended%20syntax.md#拡張構文', true);

        const [, openedUri] = vscodeMock.executeCommand.mock.calls[0];
        expect((openedUri as any).fragment).toBe('拡張構文');
    });

    it('does not treat double stars inside a path segment as a globstar', async () => {
        const provider = new MarkdownEasyVisualEditorProvider(createContext());
        const destinationDocument = createDocument('file:///workspace/root/foo/baz/bar.md');
        destinationDocument.uri.path = '/workspace/root/foo/baz/bar.md';
        vscodeMock.configurationValues.set('editorAssociations', {
            '*.md': 'vscode.markdown.preview.editor',
            '**/foo**/bar.md': 'markdownEasyVisualEditor.editor'
        });
        vscodeMock.executeCommand.mockImplementationOnce(async (...args: unknown[]) => {
            const openedUri = args[1] as any;
            vscodeMock.activeTab = {
                input: { viewType: 'vscode.markdown.preview.editor', uri: openedUri }
            };
        });
        vscodeMock.getWorkspaceFolder.mockReturnValue(vscodeMock.workspaceFolder as any);

        await (provider as any).openResource(destinationDocument, '/foo/baz/bar.md#section', true);

        const [, openedUri] = vscodeMock.executeCommand.mock.calls[0];
        expect((openedUri as any).fragment).toBe('section');
    });

    it('matches editor association patterns without case sensitivity', async () => {
        const provider = new MarkdownEasyVisualEditorProvider(createContext());
        const destinationDocument = createDocument('file:///workspace/root/guide.md');
        destinationDocument.uri.path = '/workspace/root/guide.md';
        vscodeMock.configurationValues.set('editorAssociations', {
            '*.MD': 'markdownEasyVisualEditor.editor'
        });
        vscodeMock.openTextDocument.mockResolvedValue({
            getText: () => '# Found',
            offsetAt: () => 0
        } as any);
        vscodeMock.executeCommand.mockImplementationOnce(async (...args: unknown[]) => {
            const openedUri = args[1] as any;
            vscodeMock.activeTab = {
                input: { viewType: 'markdownEasyVisualEditor.editor', uri: openedUri }
            };
        });
        vscodeMock.getWorkspaceFolder.mockReturnValue(vscodeMock.workspaceFolder as any);

        await (provider as any).openResource(destinationDocument, '/guide.md#missing', true);

        const [, openedUri] = vscodeMock.executeCommand.mock.calls[0];
        expect((openedUri as any).fragment).toBe('');
    });

    it('preserves existing POSIX absolute links without the workspace marker', async () => {
        const provider = new MarkdownEasyVisualEditorProvider(createContext());
        const document = createDocument('file:///workspace/root/notes/source.md');

        await (provider as any).openResource(document, '/tmp/guide.md#拡張構文');

        expect(vscodeMock.file).toHaveBeenCalledWith('/tmp/guide.md');
        expect((vscodeMock.openTextDocument.mock.calls[0][0] as any).path).toBe('/tmp/guide.md');
        expect(vscodeMock.executeCommand).toHaveBeenCalledWith(
            'vscode.open',
            expect.objectContaining({ path: '/tmp/guide.md' }),
        );
    });

    it('rejects workspace paths that escape their folder and decodes path segments once', async () => {
        const provider = new MarkdownEasyVisualEditorProvider(createContext());
        const document = createDocument('file:///workspace/root/notes/source.md');
        document.uri.path = '/workspace/root/notes/source.md';
        vscodeMock.getWorkspaceFolder.mockReturnValue(vscodeMock.workspaceFolder as any);

        await (provider as any).openResource(document, '/../../outside.md#拡張構文', true);
        await (provider as any).openResource(document, '/%2e%2e/%2e%2e/outside.md#拡張構文', true);
        expect(vscodeMock.openTextDocument).not.toHaveBeenCalled();
        expect(vscodeMock.file).not.toHaveBeenCalled();

        await (provider as any).openResource(document, '/guides/a%23b.md#拡張構文', true);
        await (provider as any).openResource(document, '/guides/100%2520.md#拡張構文', true);
        await (provider as any).openResource(document, '/guides/%252e%252e.md#拡張構文', true);

        expect(vscodeMock.joinPath.mock.calls.map((call: any[]) => call.slice(1))).toEqual([
            ['guides', 'a#b.md'],
            ['guides', '100%20.md'],
            ['guides', '%2e%2e.md'],
        ]);
        expect(vscodeMock.openTextDocument.mock.calls.map((call: any[]) => call[0].path)).toEqual([
            '/workspace/root/guides/a#b.md',
            '/workspace/root/guides/100%20.md',
            '/workspace/root/guides/%2e%2e.md',
        ]);
    });
});

describe('HTML export global settings in the extension host',
    () => {
        it('persists, broadcasts, and reloads all three global choices',
            async () => {
                const provider = new MarkdownEasyVisualEditorProvider(createContext());
                await (provider as any).globalSettingsMigration;
                const document = createDocument();
                const panel = addPanel(provider, document);

                await setHtmlOptions(provider, document, panel, {
                    embedImages: true,
                    convertLinkedMarkdown: true,
                    saveWithoutDialog: false,
                });

                expect(vscodeMock.configurationValues.get('html.embedImages')).toBe(true);
                expect(vscodeMock.configurationValues.get('html.convertLinkedMarkdown')).toBe(true);
                expect(vscodeMock.configurationValues.get('html.saveWithoutDialog')).toBe(false);
                const notification = panel.webview.postMessage.mock.calls.at(-1)?.[0];
                expect(notification.settings.htmlOptions).toEqual({
                    embedImages: true,
                    convertLinkedMarkdown: true,
                    saveWithoutDialog: false,
                });

                const nextProvider = new MarkdownEasyVisualEditorProvider(createContext());
                const nextSettings = (nextProvider as any).getSettings(createDocument('file:///workspace/other.md'));
                expect(nextSettings.htmlOptions).toEqual({
                    embedImages: true,
                    convertLinkedMarkdown: true,
                    saveWithoutDialog: false,
                });
            });

        it('migrates legacy values without replacing explicit global settings',
            /** 旧設定の移行で明示済みglobal値を維持し、未設定項目だけ補うことを検証する。 */
            async () => {
                vscodeMock.state.set(HTML_OPTIONS_STATE_KEY, {
                    embedImages: true,
                    convertLinkedMarkdown: true,
                    saveWithoutDialog: false,
                });
                vscodeMock.configurationValues.set('html.embedImages', false);

                const provider = new MarkdownEasyVisualEditorProvider(createContext());
                await (provider as any).globalSettingsMigration;

                expect(vscodeMock.configurationValues.get('html.embedImages')).toBe(false);
                expect(vscodeMock.configurationValues.get('html.convertLinkedMarkdown')).toBe(true);
                expect(vscodeMock.configurationValues.get('html.saveWithoutDialog')).toBe(false);
                expect(vscodeMock.state.get('markdownEasyVisualEditor.globalSettingsMigrated')).toBe(true);
            });

        it('serializes concurrent updates and leaves the last update visible everywhere',
            async () => {
                const provider = new MarkdownEasyVisualEditorProvider(createContext());
                await (provider as any).globalSettingsMigration;
                const document = createDocument();
                const panels = addPanels(provider, document, 2);
                const panel = panels[0];
                const releases: Array<() => void> = [];
                const started: Array<[string, unknown]> = [];
                /** 各global設定書き込みを保留し、要求順に解放できるよう記録する。 */
                const delayConfigurationUpdate = (key: string, value: unknown) =>
                    new Promise<void>(

                        (resolve) => {
                            started.push([key, value]);
                            releases.push(

                                () => {
                                    vscodeMock.configurationValues.set(key, value);
                                    resolve();
                                });
                        });
                vscodeMock.configuration.update.mockImplementation(delayConfigurationUpdate);
                /** 指定件数のglobal設定書き込みが開始するまで非同期キューを待つ。 */
                const waitForStartedUpdates = async (count: number): Promise<void> => {
                    await vi.waitFor(

                        () => expect(started).toHaveLength(count));
                };

                const first = setHtmlOptions(provider, document, panel, {
                    embedImages: true,
                    convertLinkedMarkdown: false,
                    saveWithoutDialog: true,
                });
                await waitForStartedUpdates(1);
                const second = setHtmlOptions(provider, document, panel, {
                    embedImages: false,
                    convertLinkedMarkdown: true,
                    saveWithoutDialog: false,
                });
                expect(started).toEqual([['html.embedImages', true]]);
                releases.shift()?.();
                await waitForStartedUpdates(2);
                expect(started[1]).toEqual(['html.convertLinkedMarkdown', false]);
                releases.shift()?.();
                await waitForStartedUpdates(3);
                expect(started[2]).toEqual(['html.saveWithoutDialog', true]);
                releases.shift()?.();
                await waitForStartedUpdates(4);
                expect(started[3]).toEqual(['html.embedImages', false]);
                releases.shift()?.();
                await waitForStartedUpdates(5);
                expect(started[4]).toEqual(['html.convertLinkedMarkdown', true]);
                releases.shift()?.();
                await waitForStartedUpdates(6);
                expect(started[5]).toEqual(['html.saveWithoutDialog', false]);
                releases.shift()?.();
                await Promise.all([first, second]);

                expect(vscodeMock.configurationValues.get('html.embedImages')).toBe(false);
                expect(vscodeMock.configurationValues.get('html.convertLinkedMarkdown')).toBe(true);
                expect(vscodeMock.configurationValues.get('html.saveWithoutDialog')).toBe(false);
                const notifications = panel.webview.postMessage.mock.calls.map(
                    /**
                     * postMessage呼び出しの引数からHostメッセージだけを取り出す。
                     * @param message - postMessageに渡された引数配列の先頭要素。
                     * @returns 呼び出し順のHostメッセージ一覧。
                     */
                    ([message]: any[]) => message);
                expect(notifications.at(-1).settings.htmlOptions).toEqual({
                    embedImages: false,
                    convertLinkedMarkdown: true,
                    saveWithoutDialog: false,
                });
                for (const currentPanel of panels) {
                    expect(currentPanel.webview.postMessage).toHaveBeenCalled();
                    const lastNotification = currentPanel.webview.postMessage.mock.calls.at(-1)?.[0];
                    expect(lastNotification.settings.htmlOptions).toEqual({
                        embedImages: false,
                        convertLinkedMarkdown: true,
                        saveWithoutDialog: false,
                    });
                }
            });

        it('broadcasts partial settings after a write fails and continues the update queue',
            /** 部分書き込みの失敗通知と、その後の設定更新継続を検証する。 */
            async () => {
                const provider = new MarkdownEasyVisualEditorProvider(createContext());
                await (provider as any).globalSettingsMigration;
                const document = createDocument();
                const panels = addPanels(provider, document, 2);
                let rejectLinkedMarkdownWrite = true;
                const attempted: Array<[string, unknown]> = [];
                vscodeMock.configuration.update.mockImplementation(async (key: string, value: unknown) => {
                    attempted.push([key, value]);
                    if (key === 'html.convertLinkedMarkdown' && rejectLinkedMarkdownWrite) {
                        rejectLinkedMarkdownWrite = false;
                        throw new Error('linked Markdown setting write failed');
                    }
                    vscodeMock.configurationValues.set(key, value);
                });

                await setHtmlOptions(provider, document, panels[0], {
                    embedImages: true,
                    convertLinkedMarkdown: true,
                    saveWithoutDialog: false,
                });

                expect(attempted).toEqual([
                    ['html.embedImages', true],
                    ['html.convertLinkedMarkdown', true],
                ]);
                expect(vscodeMock.configurationValues.get('html.embedImages')).toBe(true);
                expect(vscodeMock.configurationValues.has('html.convertLinkedMarkdown')).toBe(false);
                const partialSettings = (provider as any).getSettings(document).htmlOptions;
                for (const panel of panels) {
                    const messages = panel.webview.postMessage.mock.calls.map(([message]: any[]) => message);
                    const lastSettingsChange = messages.filter((message: any) => message.type === 'settingsChanged').at(-1);
                    expect(lastSettingsChange.settings.htmlOptions).toEqual(partialSettings);
                }
                expect(panels[0].webview.postMessage.mock.calls.some(
                    ([message]: any[]) => message.type === 'operationFailed'
                        && message.message === 'linked Markdown setting write failed',
                )).toBe(true);

                await setHtmlOptions(provider, document, panels[0], {
                    embedImages: false,
                    convertLinkedMarkdown: true,
                    saveWithoutDialog: true,
                });

                expect(vscodeMock.configurationValues.get('html.embedImages')).toBe(false);
                expect(vscodeMock.configurationValues.get('html.convertLinkedMarkdown')).toBe(true);
                expect(vscodeMock.configurationValues.get('html.saveWithoutDialog')).toBe(true);
                const finalSettings = (provider as any).getSettings(document).htmlOptions;
                for (const panel of panels) {
                    const messages = panel.webview.postMessage.mock.calls.map(([message]: any[]) => message);
                    const lastSettingsChange = messages.filter((message: any) => message.type === 'settingsChanged').at(-1);
                    expect(lastSettingsChange.settings.htmlOptions).toEqual(finalSettings);
                }
            });
    });

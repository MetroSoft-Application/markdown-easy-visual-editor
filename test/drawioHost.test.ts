/**
 * @fileoverview Extension Hostのdraw.io SVG作成要求と、プレビューリンクからdraw.io編集画面を開く経路を検証する。
 *
 * 実行境界はtest（Vitest + VS Code APIモック）。Webviewとの往復メッセージ、未保存文書・同名ファイル・
 * 仮想ファイルシステムの失敗経路、draw.io拡張機能の有無による開き方の分岐を、実ファイルを書かずに確認する。
 */
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Extension Hostが参照するVS Code APIのモックと、テストごとに切り替える状態をまとめて生成する。
 */
const vscodeMock = vi.hoisted(
    /** VS Code APIモックの共有状態を作る。 */
    () => {
        /**
         * VS Code URIのうち拡張機能が使うプロパティだけを再現する。
         * @param scheme - URIスキーム。
         * @param uriPath - POSIX形式のパス。
         * @returns テスト用URI。
         */
        const createUri = (scheme: string, uriPath: string): any => ({
            scheme,
            path: uriPath,
            fsPath: uriPath,
            authority: '',
            query: '',
            fragment: '',
            toString: () => `${scheme}://${uriPath}`,
            with: (change: { path?: string }) => createUri(scheme, change.path ?? uriPath),
        });
        /** 登録されたFileSystemWatcherの変更・作成リスナー。テストから外部保存を模擬して呼び出す。 */
        const watcherListeners = {
            change: [] as Array<(uri: any) => void>,
            create: [] as Array<(uri: any) => void>,
        };
        /** 登録されたonDidSaveTextDocumentのリスナー。テストからVS Code上の保存を模擬する。 */
        const saveListeners: Array<(document: any) => void> = [];
        return {
            createUri,
            joinPath: vi.fn(
                /**
                 * `..` を含む区間を正規化して連結する。
                 * @param base - 基準URI。
                 * @param segments - 連結するパス区間。
                 */
                (base: any, ...segments: string[]) =>
                    createUri(base.scheme, path.posix.join(base.path, ...segments))),
            createDirectory: vi.fn(async (_uri: unknown) => undefined),
            stat: vi.fn(async (_uri: unknown): Promise<unknown> => {
                throw Object.assign(new Error('not found'), { code: 'FileNotFound' });
            }),
            writeFile: vi.fn(async (_uri: unknown, _bytes: Uint8Array) => undefined),
            executeCommand: vi.fn(async (_command: string, ..._args: unknown[]) => undefined),
            showInformationMessage: vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined),
            showErrorMessage: vi.fn(async (..._args: unknown[]) => undefined),
            getExtension: vi.fn((_id: string): unknown => undefined),
            watcherListeners,
            saveListeners,
            createFileSystemWatcher: vi.fn(
                /**
                 * 変更・作成リスナーを記録するFileSystemWatcherを返す。
                 * @param _glob - 監視対象のglob。
                 */
                (_glob: string) => ({
                    dispose: vi.fn(),
                    onDidChange: (listener: (uri: any) => void) => {
                        watcherListeners.change.push(listener);
                        return { dispose: vi.fn() };
                    },
                    onDidCreate: (listener: (uri: any) => void) => {
                        watcherListeners.create.push(listener);
                        return { dispose: vi.fn() };
                    },
                })),
            onDidSaveTextDocument: vi.fn(
                /** @param listener - 保存通知を受けるリスナー。 */
                (listener: (document: any) => void) => {
                    saveListeners.push(listener);
                    return { dispose: vi.fn() };
                }),
            event: vi.fn(() => ({ dispose: vi.fn() })),
            configuration: {
                get: vi.fn((_key: string, fallback: unknown) => fallback),
                inspect: vi.fn(() => undefined),
                update: vi.fn(async () => undefined),
            },
        };
    });

vi.mock('vscode',
    /** draw.io経路が使うVS Code APIだけを持つスタブを返す。 */
    () => ({
        workspace: {
            onDidChangeTextDocument: vscodeMock.event,
            onDidChangeConfiguration: vscodeMock.event,
            onDidGrantWorkspaceTrust: vscodeMock.event,
            getConfiguration: () => vscodeMock.configuration,
            getWorkspaceFolder: () => undefined,
            createFileSystemWatcher: vscodeMock.createFileSystemWatcher,
            onDidSaveTextDocument: vscodeMock.onDidSaveTextDocument,
            isTrusted: true,
            fs: {
                createDirectory: vscodeMock.createDirectory,
                stat: vscodeMock.stat,
                writeFile: vscodeMock.writeFile,
            },
        },
        Uri: {
            joinPath: vscodeMock.joinPath,
            file: (filePath: string) => vscodeMock.createUri('file', filePath),
            parse: (value: string) => vscodeMock.createUri('file', value.replace(/^file:\/\//, '')),
        },
        ConfigurationTarget: { Global: 'global' },
        window: {
            showErrorMessage: vscodeMock.showErrorMessage,
            showInformationMessage: vscodeMock.showInformationMessage,
            tabGroups: { activeTabGroup: { activeTab: undefined } },
        },
        commands: { executeCommand: vscodeMock.executeCommand },
        extensions: { getExtension: vscodeMock.getExtension },
        env: { language: 'en' },
    }));

/** 実ファイルへ書かずに、排他作成の成功・失敗を切り替える。 */
const drawioFileMock = vi.hoisted(() => ({
    writeDrawioSvgExclusive: vi.fn(async (_filePath: string, _contents: string) => undefined),
}));
vi.mock('../src/extension/drawioFile', () => drawioFileMock);

import { MarkdownEasyVisualEditorProvider } from '../src/extension/extension';
import { DRAWIO_EXTENSION_ID, DRAWIO_SVG_EDITOR_VIEW_TYPE } from '../src/extension/drawioEditor';
import { getMessages } from '../src/shared/messages';

/** VS Codeの表示言語モックに対応する英語の文言。 */
const messages = getMessages('en');

/**
 * Providerが購読登録に使うExtension Contextの最小構成を作る。
 * @returns subscriptionsとglobalStateを持つcontext。
 */
function createContext(): any {
    return {
        subscriptions: [],
        globalState: { get: vi.fn((_key: string, fallback?: unknown) => fallback), update: vi.fn() },
        extensionUri: {},
    };
}

/**
 * 指定スキームとパスのMarkdown文書を作る。
 * @param scheme - 文書URIのスキーム。未保存文書はuntitled。
 * @param documentPath - 文書のPOSIXパス。
 * @returns Providerへ渡すTextDocumentのテストdouble。
 */
function createDocument(scheme: string, documentPath: string): any {
    return { uri: vscodeMock.createUri(scheme, documentPath), version: 1, getText: () => '' };
}

/**
 * ProviderとWebviewパネルを用意し、draw.io作成要求を送る。
 * @param document - 要求元のMarkdown文書。
 * @param imageDirectory - Webviewの画像保存先設定。
 * @returns 応答を受け取ったパネルのpostMessageモック。
 */
async function requestDrawioSvg(document: any, imageDirectory = 'images'): Promise<ReturnType<typeof vi.fn>> {
    const provider = new MarkdownEasyVisualEditorProvider(createContext());
    const panel = { webview: { postMessage: vi.fn() } };
    await (provider as any).handleMessage(document, panel, {
        type: 'createDrawioSvg',
        requestId: 'drawio-request',
        imageDirectory,
    });
    return panel.webview.postMessage;
}

afterEach(
    /** テスト間でモックの呼出履歴と差し替えた実装を戻す。 */
    () => {
        vi.clearAllMocks();
        drawioFileMock.writeDrawioSvgExclusive.mockImplementation(async () => undefined);
        vscodeMock.getExtension.mockImplementation(() => undefined);
        vscodeMock.showInformationMessage.mockImplementation(async () => undefined);
        vscodeMock.stat.mockImplementation(async () => {
            throw Object.assign(new Error('not found'), { code: 'FileNotFound' });
        });
    });

describe('draw.io SVG creation in the extension host', () => {
    /** ファイル名の秒単位タイムスタンプを固定するための日時（ローカル時刻 2026-11-04 09:05:07）。 */
    const FIXED_NOW = new Date(2026, 10, 4, 9, 5, 7);

    beforeEach(
        /** Dateだけを固定し、Promiseやタイマーの動作は実時間のまま保つ。 */
        () => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(FIXED_NOW);
        });

    afterEach(
        /** 他のテストへ固定日時を持ち越さない。 */
        () => {
            vi.useRealTimers();
        });

    /** 成功時だけWebviewへ相対パスを返し、ファイル名は貼付画像と同じ秒単位のタイムスタンプにする。 */
    it('creates a timestamp-named SVG next to the document and returns a Markdown-safe relative path', async () => {
        const document = createDocument('file', '/workspace/docs/guide.md');
        const postMessage = await requestDrawioSvg(document, 'my images');

        expect(drawioFileMock.writeDrawioSvgExclusive).toHaveBeenCalledOnce();
        const [filePath, contents] = drawioFileMock.writeDrawioSvgExclusive.mock.calls[0];
        expect(filePath).toBe('/workspace/docs/my images/diagram-20261104-090507.drawio.svg');
        expect(contents).toContain('content="&lt;mxfile');
        expect(postMessage).toHaveBeenCalledOnce();
        expect(postMessage).toHaveBeenCalledWith({
            type: 'drawioSvgCreated',
            requestId: 'drawio-request',
            path: 'my%20images/diagram-20261104-090507.drawio.svg',
        });
    });

    /** 未保存文書では相対パスの基準がないため、書込みせず要求IDつきで失敗を返す。 */
    it('rejects untitled documents without writing a file', async () => {
        const postMessage = await requestDrawioSvg(createDocument('untitled', 'Untitled-1'));

        expect(drawioFileMock.writeDrawioSvgExclusive).not.toHaveBeenCalled();
        expect(postMessage).toHaveBeenCalledWith({
            type: 'operationFailed',
            requestId: 'drawio-request',
            message: messages.host.imageDocumentMustBeSaved,
        });
    });

    /** 同じ秒に作成済みの図があれば上書きせず、連番付きの名前で作成する。 */
    it('adds a sequence number when a diagram with the same timestamp already exists', async () => {
        drawioFileMock.writeDrawioSvgExclusive.mockRejectedValueOnce(
            Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' }),
        );
        const postMessage = await requestDrawioSvg(createDocument('file', '/workspace/docs/guide.md'));

        expect(drawioFileMock.writeDrawioSvgExclusive.mock.calls.map(([filePath]) => filePath)).toEqual([
            '/workspace/docs/images/diagram-20261104-090507.drawio.svg',
            '/workspace/docs/images/diagram-20261104-090507-2.drawio.svg',
        ]);
        expect(postMessage).toHaveBeenCalledWith({
            type: 'drawioSvgCreated',
            requestId: 'drawio-request',
            path: 'images/diagram-20261104-090507-2.drawio.svg',
        });
    });

    /** 連番の上限まで衝突した場合も既存ファイルを上書きせず、ローカライズ済みエラーを返す。 */
    it('reports a localized error when every candidate name already exists', async () => {
        drawioFileMock.writeDrawioSvgExclusive.mockRejectedValue(
            Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' }),
        );
        const postMessage = await requestDrawioSvg(createDocument('file', '/workspace/docs/guide.md'));

        expect(drawioFileMock.writeDrawioSvgExclusive).toHaveBeenCalledTimes(100);
        expect(postMessage).toHaveBeenCalledWith({
            type: 'operationFailed',
            requestId: 'drawio-request',
            message: messages.host.drawioFileExists,
        });
        expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'drawioSvgCreated' }));
    });

    /** 衝突以外の書込み失敗は連番で再試行せず、原因のエラーをそのまま返す。 */
    it('does not retry on write errors other than an existing file', async () => {
        drawioFileMock.writeDrawioSvgExclusive.mockRejectedValue(
            Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }),
        );
        const postMessage = await requestDrawioSvg(createDocument('file', '/workspace/docs/guide.md'));

        expect(drawioFileMock.writeDrawioSvgExclusive).toHaveBeenCalledOnce();
        expect(postMessage).toHaveBeenCalledWith({
            type: 'operationFailed',
            requestId: 'drawio-request',
            message: 'EACCES: permission denied',
        });
    });

    /** 排他作成がない仮想ファイルシステムでも、既存ファイルを検出したら次の名前で作成する。 */
    it('skips an existing name on a virtual file system without overwriting it', async () => {
        vscodeMock.stat.mockResolvedValueOnce({ type: 1 });
        const postMessage = await requestDrawioSvg(createDocument('vscode-vfs', '/repo/docs/guide.md'));

        expect(vscodeMock.writeFile).toHaveBeenCalledOnce();
        expect((vscodeMock.writeFile.mock.calls[0][0] as any).path)
            .toBe('/repo/docs/images/diagram-20261104-090507-2.drawio.svg');
        expect(drawioFileMock.writeDrawioSvgExclusive).not.toHaveBeenCalled();
        expect(postMessage).toHaveBeenCalledWith({
            type: 'drawioSvgCreated',
            requestId: 'drawio-request',
            path: 'images/diagram-20261104-090507-2.drawio.svg',
        });
    });
});

describe('opening draw.io SVG links from the preview', () => {
    /**
     * プレビューのリンクと同じopenResource経路で文書相対パスを開く。
     * @param href - Markdown上のリンク先。
     */
    async function openFromPreview(href: string): Promise<void> {
        const provider = new MarkdownEasyVisualEditorProvider(createContext());
        await (provider as any).openResource(createDocument('file', '/workspace/docs/guide.md'), href);
    }

    /** 拡張機能がある場合は関連付けに依存せずdraw.ioエディターを明示指定する。 */
    it('opens .drawio.svg with the draw.io editor when the extension is installed', async () => {
        vscodeMock.getExtension.mockImplementation((id: string) => (id === DRAWIO_EXTENSION_ID ? {} : undefined));

        await openFromPreview('my%20images/%E5%9B%B3.drawio.svg');

        expect(vscodeMock.executeCommand).toHaveBeenCalledOnce();
        const [command, uri, viewType] = vscodeMock.executeCommand.mock.calls[0];
        expect(command).toBe('vscode.openWith');
        expect((uri as any).path).toBe('/workspace/docs/my images/図.drawio.svg');
        expect(viewType).toBe(DRAWIO_SVG_EDITOR_VIEW_TYPE);
        expect(vscodeMock.showInformationMessage).not.toHaveBeenCalled();
    });

    /** `.dio.svg` もdraw.io拡張機能の対象拡張子として扱う。 */
    it('treats .dio.svg as a draw.io diagram', async () => {
        vscodeMock.getExtension.mockImplementation(() => ({}));

        await openFromPreview('./diagram.dio.svg');

        expect(vscodeMock.executeCommand).toHaveBeenCalledWith(
            'vscode.openWith', expect.objectContaining({ path: '/workspace/docs/diagram.dio.svg' }), DRAWIO_SVG_EDITOR_VIEW_TYPE,
        );
    });

    /** 拡張機能がない場合も操作を無反応にせず、既定エディターで開いて導入を案内する。 */
    it('falls back to the default editor and offers the extension when it is missing', async () => {
        vscodeMock.showInformationMessage.mockImplementation(async (_message, action) => action);

        await openFromPreview('images/diagram.drawio.svg');
        await vi.waitFor(() => expect(vscodeMock.executeCommand).toHaveBeenCalledTimes(2));

        expect(vscodeMock.showInformationMessage).toHaveBeenCalledWith(
            messages.host.drawioExtensionMissing,
            messages.host.drawioShowExtension,
        );
        expect(vscodeMock.executeCommand).toHaveBeenCalledWith(
            'vscode.open', expect.objectContaining({ path: '/workspace/docs/images/diagram.drawio.svg' }),
        );
        expect(vscodeMock.executeCommand).toHaveBeenCalledWith('workbench.extensions.search', DRAWIO_EXTENSION_ID);
    });

    /** 通常のSVGは従来どおり既定のエディターで開き、draw.ioへ振り分けない。 */
    it('keeps opening ordinary SVG files with vscode.open', async () => {
        vscodeMock.getExtension.mockImplementation(() => ({}));

        await openFromPreview('images/plain.svg');

        expect(vscodeMock.executeCommand).toHaveBeenCalledOnce();
        expect(vscodeMock.executeCommand.mock.calls[0][0]).toBe('vscode.open');
        expect(vscodeMock.getExtension).not.toHaveBeenCalled();
    });
});

describe('refreshing previews after a draw.io diagram is saved', () => {
    /**
     * 監視を登録したProviderと、2文書分のWebviewパネルを用意する。
     * パネルごとにasWebviewUriの結果が異なることを再現し、各パネル用のURIで通知されることを確認できるようにする。
     * @returns Providerと2つのパネル。
     */
    function setUpPanels(): { provider: any; panels: any[] } {
        vscodeMock.watcherListeners.change.length = 0;
        vscodeMock.watcherListeners.create.length = 0;
        vscodeMock.saveListeners.length = 0;
        const provider = new MarkdownEasyVisualEditorProvider(createContext()) as any;
        provider.ensureDrawioChangeWatcher();
        const panels = ['panel-a', 'panel-b'].map((name) => ({
            webview: {
                postMessage: vi.fn(),
                asWebviewUri: vi.fn((uri: any) => ({ toString: () => `https://${name}.test${uri.path}` })),
            },
        }));
        provider.panels.set('file:///workspace/a.md', new Set([panels[0]]));
        provider.panels.set('file:///workspace/b.md', new Set([panels[1]]));
        return { provider, panels };
    }

    /** 監視は最初のエディター表示時に一度だけ登録し、パネルを開くたびに増えない。 */
    it('registers the draw.io watcher only once', () => {
        const { provider } = setUpPanels();
        provider.ensureDrawioChangeWatcher();
        expect(vscodeMock.createFileSystemWatcher).toHaveBeenCalledOnce();
        expect(vscodeMock.createFileSystemWatcher).toHaveBeenCalledWith('**/*.{drawio.svg,dio.svg}');
        expect(vscodeMock.saveListeners).toHaveLength(1);
    });

    /** 外部保存（ファイル監視）を検知したら、全パネルへそれぞれのWebview URIで再読込を通知する。 */
    it('notifies every panel with its own webview URI when the file changes', () => {
        const { panels } = setUpPanels();
        vscodeMock.watcherListeners.change[0](vscodeMock.createUri('file', '/workspace/images/a.drawio.svg'));

        expect(panels[0].webview.postMessage).toHaveBeenCalledWith({
            type: 'localResourceChanged',
            resource: 'https://panel-a.test/workspace/images/a.drawio.svg',
        });
        expect(panels[1].webview.postMessage).toHaveBeenCalledWith({
            type: 'localResourceChanged',
            resource: 'https://panel-b.test/workspace/images/a.drawio.svg',
        });
    });

    /** draw.io拡張機能での保存（TextDocumentの保存）でも通知し、Markdownなど他の保存では通知しない。 */
    it('notifies on draw.io document saves and ignores other saves', () => {
        const { panels } = setUpPanels();
        vscodeMock.saveListeners[0]({ uri: vscodeMock.createUri('file', '/outside/diagram.dio.svg') });
        vscodeMock.saveListeners[0]({ uri: vscodeMock.createUri('file', '/workspace/a.md') });
        vscodeMock.saveListeners[0]({ uri: vscodeMock.createUri('file', '/workspace/plain.svg') });

        expect(panels[0].webview.postMessage).toHaveBeenCalledOnce();
        expect(panels[0].webview.postMessage).toHaveBeenCalledWith({
            type: 'localResourceChanged',
            resource: 'https://panel-a.test/outside/diagram.dio.svg',
        });
    });
});

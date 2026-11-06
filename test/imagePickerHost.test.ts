/**
 * @fileoverview リボンの「挿入 > 画像」でファイル選択した画像を、Extension Hostがどう挿入するかを検証する。
 *
 * 実行境界はtest（Vitest + VS Code APIモック）。プレビューで表示できる場所（文書フォルダー配下・
 * ワークスペースフォルダー配下）にある既存画像はコピーせず相対参照し、それ以外だけを画像保存先へ
 * コピーすることを、実ファイルを読み書きせずに確認する。回帰リスクは、選んだだけの既存画像が
 * 保存先へ複製されてファイルが増えること、選択順と挿入順のずれ、保存しないのに「保存しました」と伝えること。
 */
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** 画像選択経路が使うVS Code APIのモックと、テストごとに切り替える状態。 */
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
        });
        return {
            createUri,
            /** テストごとに設定するワークスペースフォルダー。 */
            workspace: { workspaceFolders: undefined as Array<{ uri: any }> | undefined },
            showOpenDialog: vi.fn(async (_options: unknown): Promise<any[] | undefined> => undefined),
            readFile: vi.fn(async (_uri: unknown) => new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
            writeFile: vi.fn(async (_uri: unknown, _bytes: Uint8Array) => undefined),
            createDirectory: vi.fn(async (_uri: unknown) => undefined),
            event: vi.fn(() => ({ dispose: vi.fn() })),
            configuration: {
                get: vi.fn((_key: string, fallback: unknown) => fallback),
                inspect: vi.fn(() => undefined),
                update: vi.fn(async () => undefined),
            },
        };
    });

vi.mock('vscode',
    /** 画像選択と保存の経路が使うVS Code APIだけを持つスタブを返す。 */
    () => ({
        workspace: {
            onDidChangeTextDocument: vscodeMock.event,
            onDidChangeConfiguration: vscodeMock.event,
            onDidGrantWorkspaceTrust: vscodeMock.event,
            onDidSaveTextDocument: vscodeMock.event,
            createFileSystemWatcher: () => ({
                dispose: vi.fn(),
                onDidChange: vscodeMock.event,
                onDidCreate: vscodeMock.event,
            }),
            getConfiguration: () => vscodeMock.configuration,
            getWorkspaceFolder: () => undefined,
            get workspaceFolders() {
                return vscodeMock.workspace.workspaceFolders;
            },
            isTrusted: true,
            fs: {
                readFile: vscodeMock.readFile,
                writeFile: vscodeMock.writeFile,
                createDirectory: vscodeMock.createDirectory,
            },
        },
        Uri: {
            joinPath: (base: any, ...segments: string[]) =>
                vscodeMock.createUri(base.scheme, path.posix.join(base.path, ...segments)),
            file: (filePath: string) => vscodeMock.createUri('file', filePath),
            parse: (value: string) => vscodeMock.createUri('file', value.replace(/^file:\/\//, '')),
        },
        ConfigurationTarget: { Global: 'global' },
        window: {
            showOpenDialog: vscodeMock.showOpenDialog,
            showErrorMessage: vi.fn(async () => undefined),
            showInformationMessage: vi.fn(async () => undefined),
            tabGroups: { activeTabGroup: { activeTab: undefined } },
        },
        commands: { executeCommand: vi.fn(async () => undefined) },
        extensions: { getExtension: () => undefined },
        env: { language: 'en' },
    }));

import { MarkdownEasyVisualEditorProvider } from '../src/extension/extension';
import { getMessages } from '../src/shared/messages';

/**
 * ProviderとWebviewパネルを用意し、画像選択要求を送る。
 * @param documentPath - 要求元Markdown文書のPOSIXパス。
 * @param selected - ファイル選択ダイアログが返す画像のパス。
 * @param scheme - 文書URIのスキーム。未保存文書はuntitled。
 * @returns Webviewへ送られたメッセージ。
 */
async function pickImages(documentPath: string, selected: string[], scheme = 'file'): Promise<unknown> {
    vscodeMock.showOpenDialog.mockResolvedValueOnce(selected.map((item) => vscodeMock.createUri('file', item)));
    const provider = new MarkdownEasyVisualEditorProvider({
        subscriptions: [],
        globalState: { get: vi.fn((_key: string, fallback?: unknown) => fallback), update: vi.fn() },
        extensionUri: {},
    } as any);
    const panel = { webview: { postMessage: vi.fn() } };
    const document = { uri: vscodeMock.createUri(scheme, documentPath), version: 1, getText: () => '' };
    await (provider as any).handleMessage(document, panel, {
        type: 'pickImage',
        requestId: 'pick-request',
        imageDirectory: 'assets/${documentBasename}',
    });
    expect(panel.webview.postMessage).toHaveBeenCalledOnce();
    return panel.webview.postMessage.mock.calls[0][0];
}

/** 書き込まれたファイルのパス一覧。 */
const writtenPaths = () => vscodeMock.writeFile.mock.calls.map(([uri]) => (uri as any).path as string);

afterEach(
    /** テスト間でモックの呼出履歴とワークスペース構成を戻す。 */
    () => {
        vi.clearAllMocks();
        vscodeMock.workspace.workspaceFolders = undefined;
    });

describe('image picker in the extension host', () => {
    /** ワークスペース内の既存画像は複製せず、文書からの相対パスで参照する。 */
    it('references existing workspace images without copying them', async () => {
        vscodeMock.workspace.workspaceFolders = [{ uri: vscodeMock.createUri('file', '/ws') }];
        const response = await pickImages('/ws/docs/guide.md', ['/ws/docs/pic.png', '/ws/images/my logo (1).png']);

        expect(vscodeMock.readFile).not.toHaveBeenCalled();
        expect(vscodeMock.writeFile).not.toHaveBeenCalled();
        expect(vscodeMock.createDirectory).not.toHaveBeenCalled();
        expect(response).toEqual({
            type: 'imagesSaved',
            requestId: 'pick-request',
            paths: ['pic.png', '../images/my%20logo%20%281%29.png'],
            savedCount: 0,
        });
    });

    /** ワークスペースを開いていなくても、文書フォルダー配下はプレビューで表示できるため参照する。 */
    it('references images under the document folder when no workspace is open', async () => {
        const response = await pickImages('/notes/guide.md', ['/notes/img/a.png']);

        expect(vscodeMock.writeFile).not.toHaveBeenCalled();
        expect(response).toMatchObject({ paths: ['img/a.png'], savedCount: 0 });
    });

    /** プレビューで表示できない場所の画像だけを保存先へコピーし、選択順どおりに返す。 */
    it('copies only images outside the previewable folders and keeps the selection order', async () => {
        vscodeMock.workspace.workspaceFolders = [{ uri: vscodeMock.createUri('file', '/ws') }];
        const response = await pickImages('/ws/docs/guide.md', [
            '/home/user/Pictures/outside.png',
            '/ws/docs/inside.png',
            '/ws-other/sibling.png',
        ]) as { paths: string[]; savedCount: number };

        expect(vscodeMock.readFile.mock.calls.map(([uri]) => (uri as any).path)).toEqual([
            '/home/user/Pictures/outside.png',
            '/ws-other/sibling.png',
        ]);
        expect(writtenPaths()).toHaveLength(2);
        for (const written of writtenPaths()) expect(written).toMatch(/^\/ws\/docs\/assets\/guide\/pasted-/);
        expect(response.savedCount).toBe(2);
        expect(response.paths[0]).toMatch(/^assets\/guide\/pasted-.*\.png$/);
        expect(response.paths[1]).toBe('inside.png');
        expect(response.paths[2]).toMatch(/^assets\/guide\/pasted-.*\.png$/);
        expect(response.paths[2]).not.toBe(response.paths[0]);
    });

    /** キャンセル（何も選ばずに閉じる）時は何も挿入せず、保存もしない。 */
    it('returns nothing when the dialog is cancelled', async () => {
        const response = await pickImages('/ws/docs/guide.md', []);

        expect(vscodeMock.writeFile).not.toHaveBeenCalled();
        expect(response).toEqual({ type: 'imagesSaved', requestId: 'pick-request', paths: [], savedCount: 0 });
    });

    /** 未保存文書には相対パスの基準がないため、参照もコピーもせず従来どおりのエラーを返す。 */
    it('rejects untitled documents without referencing or copying', async () => {
        const response = await pickImages('Untitled-1', ['/ws/docs/pic.png'], 'untitled');

        expect(vscodeMock.readFile).not.toHaveBeenCalled();
        expect(vscodeMock.writeFile).not.toHaveBeenCalled();
        expect(response).toEqual({
            type: 'operationFailed',
            requestId: 'pick-request',
            message: getMessages('en').host.imageDocumentMustBeSaved,
        });
    });
});

/**
 * @fileoverview HTML設定Host・テストの回帰の仕様と回帰条件を検証する。失敗時は期待値と実装差分を示す。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * HTML設定Host・テストの回帰のvscode・mockをキーで再利用する対応表。
 */
const vscodeMock = vi.hoisted(
    /**
     * 要素をasyncへ渡し、HTML設定Host・テストの回帰の結果または副作用を処理する。
     * @returns 副作用を完了し、値は返さない。
     */
    () => {
        const state = new Map<string, unknown>();
        const configurationValues = new Map<string, unknown>();

        /** globalState.updateの既定動作。旧形式の値と移行済み印を保持する。 */
        const defaultUpdate = /**
   * HTML設定Host・テストの回帰のdefault・updateを処理し、呼び出し側へ結果または副作用を返す。
   * @param key - globalStateモックから値を取得する設定キー。
    * @param value - 設定モックへ保存する設定値。
   * @returns 副作用を完了し、値は返さない。
   */ async (key: string, value: unknown): Promise<void> => {
                state.set(key, value);
            };
        /** VS Code設定APIのglobal値を保持し、設定の読み書きを再現する。 */
        const configuration = {
            get: vi.fn(
                /** 保存済みglobal値がなければVS Code構成の既定値を返す。 */
                (key: string, fallback: unknown) =>
                    configurationValues.has(key) ? configurationValues.get(key) : fallback),
            inspect: vi.fn(
                /** 明示的なglobal値の有無を、VS Codeのinspect結果と同じ形で返す。 */
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
                 * keyをhasへ渡し、HTML設定Host・テストの回帰の結果または副作用を処理する。
                 * @param key - globalStateモックから値を取得する設定キー。
                 * @param fallback - キーが未登録の場合に返す値。
                 * @returns HTML設定Host・テストの回帰のコールバックが生成する結果。
                 */
                (key: string, fallback?: unknown) => state.has(key) ? state.get(key) : fallback),
            update: vi.fn(defaultUpdate),
        };
        const event = vi.fn(
            /**
             * 要素をfnへ渡し、HTML設定Host・テストの回帰の結果または副作用を処理する。
             * @returns HTML設定Host・テストの回帰のコールバックが生成する結果。
             */
            () => ({ dispose: vi.fn() }));
        return {
            state,
            configurationValues,
            configuration,
            defaultUpdate,
            globalState,
            event,
            clipboardWriteText: vi.fn(async (_value: string) => undefined),
            getConfiguration: vi.fn(
                /**
                 * HTML設定Host・テストの回帰のコールバックとして要素を処理する。
                 * @returns HTML設定Host・テストの回帰のコールバックが生成する結果。
                 */
                () => configuration),
        };
    });

vi.mock('vscode',
    /**
     * HTML設定Host・テストの回帰のコールバックとして要素を処理する。
     * @returns HTML設定Host・テストの回帰のコールバックが生成する結果。
     */
    () => ({
        workspace: {
            onDidChangeTextDocument: vscodeMock.event,
            onDidChangeConfiguration: vscodeMock.event,
            onDidGrantWorkspaceTrust: vscodeMock.event,
            getConfiguration: vscodeMock.getConfiguration,
            isTrusted: true,
        },
        ConfigurationTarget: { Global: 'global' },
        window: { showErrorMessage: vi.fn() },
        env: { language: 'en', clipboard: { writeText: vscodeMock.clipboardWriteText } },
    }));

import { MarkdownEasyVisualEditorProvider } from '../src/extension/extension';
import type { HtmlExportSettings } from '../src/shared/protocol';

/**
 * globalStateでHTML出力設定を保存するキー。
 */
const HTML_OPTIONS_STATE_KEY = 'markdownEasyVisualEditor.htmlOptions';

/**
 * HTML設定Host・テストの回帰で使う値または実行環境を組み立てる。
 * @returns HTML設定Host・テストの回帰で生成または変換した値。
 */
function createContext(): any {
    return {
        subscriptions: [],
        globalState: vscodeMock.globalState,
        extensionUri: {},
    };
}

/**
 * HTML設定Host・テストの回帰で使う値または実行環境を組み立てる。
 * @param uri - VS Codeまたはブラウザーが扱うリソースURI。
 * @returns HTML設定Host・テストの回帰で生成または変換した値。
 */
function createDocument(uri = 'file:///workspace/main.md'): any {
    return {
        uri: {
            scheme: 'file',
            fsPath: uri.replace(/^file:\/\//, ''),


            toString: /**
       * HTML設定Host・テストの回帰のto・stringを処理し、呼び出し側へ結果または副作用を返す。
       * @returns HTML設定Host・テストの回帰のto・stringが生成する結果。
       */ () => uri,
        },
        version: 1,


        getText: /**
     * HTML設定Host・テストの回帰から必要な値またはリソースを取得する。
     * @returns HTML設定Host・テストの回帰のget・textが生成する結果。
     */ () => '',
    };
}

/**
 * HTML設定Host・テストの回帰のadd・panelを処理し、呼び出し側へ結果または副作用を返す。
 * @param provider - テスト用Webviewパネルを登録するExtension Provider。
 * @param document - Webviewパネルへ関連付けるテスト用Markdown文書。
 * @returns HTML設定Host・テストの回帰のadd・panelが生成する結果。
 */
function addPanel(provider: MarkdownEasyVisualEditorProvider, document: any): any {
    return addPanels(provider, document, 1)[0];
}

/**
 * HTML設定Host・テストの回帰のadd・panelsを処理し、呼び出し側へ結果または副作用を返す。
 * @param provider - 内部mapへテスト用パネルと文書を登録するExtension Provider。
 * @param document - パネル登録と文書ID生成に使うテスト用Markdown文書。
 * @param count - モックするWebview panelの件数。
 * @returns HTML設定Host・テストの回帰に対応する要素の一覧。
 */
function addPanels(provider: MarkdownEasyVisualEditorProvider, document: any, count: number): any[] {
    const panels = Array.from({ length: count },
        /**
         * 要素をfnへ渡し、HTML設定Host・テストの回帰の結果または副作用を処理する。
         * @returns 副作用を完了し、値は返さない。
         */
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
 * @returns 副作用を完了し、値は返さない。
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
     * @returns テストケースを実行し、値は返さない。
     */
    () => {
        vscodeMock.state.clear();
        vscodeMock.configurationValues.clear();
        vscodeMock.globalState.get.mockClear();
        vscodeMock.globalState.update.mockReset();
        vscodeMock.globalState.update.mockImplementation(vscodeMock.defaultUpdate);
        vscodeMock.getConfiguration.mockClear();
        vscodeMock.clipboardWriteText.mockClear();
        vscodeMock.configuration.get.mockClear();
        vscodeMock.configuration.inspect.mockClear();
        vscodeMock.configuration.update.mockReset();
        vscodeMock.configuration.update.mockImplementation(
            /** 各テストを初期化し、標準のglobal設定保存動作へ戻す。 */
            async (key: string, value: unknown) => {
                vscodeMock.configurationValues.set(key, value);
            });
    });

describe('section link clipboard in the extension host', () => {
    it('writes a Markdown fragment link and acknowledges the copy', async () => {
        const provider = new MarkdownEasyVisualEditorProvider(createContext());
        const document = createDocument('file:///workspace/拡張構文.md');
        const panel = addPanel(provider, document);

        await (provider as any).handleMessage(document, panel, {
            type: 'copySectionLink',
            id: '拡張構文',
            text: '拡張構文',
        });

        expect(vscodeMock.clipboardWriteText).toHaveBeenCalledOnce();
        expect(vscodeMock.clipboardWriteText).toHaveBeenCalledWith('[拡張構文](#拡張構文)');
        expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: 'sectionLinkCopied' });
    });
});

describe('HTML export global settings in the extension host',
    /**
     * 「HTML export global settings in the extension host」の仕様と回帰条件を検証するテストケース。
     * @returns テストケースを実行し、値は返さない。
     */
    () => {
        it('persists, broadcasts, and reloads all three global choices',
            /**
             * 「persists, broadcasts, and reloads all three global choices」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
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
            /**
             * 「serializes concurrent updates and leaves the last update visible everywhere」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
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
                        /** 設定の反映後に、直列書き込みを待つテストへ完了を通知する。 */
                        (resolve) => {
                            started.push([key, value]);
                            releases.push(
                                /** 保留中の設定値を反映して、次の直列書き込みを進める。 */
                                () => {
                                    vscodeMock.configurationValues.set(key, value);
                                    resolve();
                                });
                        });
                vscodeMock.configuration.update.mockImplementation(delayConfigurationUpdate);
                /** 指定件数のglobal設定書き込みが開始するまで非同期キューを待つ。 */
                const waitForStartedUpdates = async (count: number): Promise<void> => {
                    await vi.waitFor(
                        /** 書き込み開始数が指定件数と一致するまで待ち、過不足も失敗にする。 */
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

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


        const defaultUpdate = /**
   * HTML設定Host・テストの回帰のdefault・updateを処理し、呼び出し側へ結果または副作用を返す。
   * @param key - HTML設定Host・テストの回帰の対象や分岐を識別する値。
   * @param value - 検証・変換・保存の対象となる値。
   * @returns 副作用を完了し、値は返さない。
   */ async (key: string, value: unknown): Promise<void> => {
                state.set(key, value);
            };
        const globalState = {
            get: vi.fn(
                /**
                 * keyをhasへ渡し、HTML設定Host・テストの回帰の結果または副作用を処理する。
                 * @param key - HTML設定Host・テストの回帰の対象や分岐を識別する値。
                 * @param fallback - HTML設定Host・テストの回帰へ渡す入力。
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
            defaultUpdate,
            globalState,
            event,
            getConfiguration: vi.fn(
                /**
                 * HTML設定Host・テストの回帰のコールバックとして要素を処理する。
                 * @returns HTML設定Host・テストの回帰のコールバックが生成する結果。
                 */
                () => ({


                    get: /**
       * HTML設定Host・テストの回帰から必要な値またはリソースを取得する。
       * @param _key - HTML設定Host・テストの回帰の対象や分岐を識別する値。
       * @param fallback - HTML設定Host・テストの回帰へ渡す入力。
       * @returns HTML設定Host・テストの回帰のgetが生成する結果。
       */ (_key: string, fallback: unknown) => fallback,
                })),
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
        env: { language: 'en' },
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
 * @param provider - HTML設定Host・テストの回帰の対象や分岐を識別する値。
 * @param document - HTML設定Host・テストの回帰へ渡す入力。
 * @returns HTML設定Host・テストの回帰のadd・panelが生成する結果。
 */
function addPanel(provider: MarkdownEasyVisualEditorProvider, document: any): any {
    return addPanels(provider, document, 1)[0];
}

/**
 * HTML設定Host・テストの回帰のadd・panelsを処理し、呼び出し側へ結果または副作用を返す。
 * @param provider - HTML設定Host・テストの回帰の対象や分岐を識別する値。
 * @param document - HTML設定Host・テストの回帰へ渡す入力。
 * @param count - HTML設定Host・テストの回帰の位置・寸法・件数・時間を表す数値。
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
 * HTML設定Host・テストの回帰の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param provider - HTML設定Host・テストの回帰の対象や分岐を識別する値。
 * @param document - HTML設定Host・テストの回帰へ渡す入力。
 * @param panel - HTML設定Host・テストの回帰へ渡す入力。
 * @param options - 呼び出し側が指定する処理設定。
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
        vscodeMock.globalState.get.mockClear();
        vscodeMock.globalState.update.mockReset();
        vscodeMock.globalState.update.mockImplementation(vscodeMock.defaultUpdate);
        vscodeMock.getConfiguration.mockClear();
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
                const document = createDocument();
                const panel = addPanel(provider, document);

                await setHtmlOptions(provider, document, panel, {
                    embedImages: true,
                    convertLinkedMarkdown: true,
                    saveWithoutDialog: false,
                });

                expect(vscodeMock.state.get(HTML_OPTIONS_STATE_KEY)).toEqual({
                    embedImages: true,
                    convertLinkedMarkdown: true,
                    saveWithoutDialog: false,
                });
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

        it('serializes concurrent updates and leaves the last update visible everywhere',
            /**
             * 「serializes concurrent updates and leaves the last update visible everywhere」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            async () => {
                const provider = new MarkdownEasyVisualEditorProvider(createContext());
                const document = createDocument();
                const panels = addPanels(provider, document, 2);
                const panel = panels[0];
                const releases: Array<() => void> = [];
                const started: unknown[] = [];
                vscodeMock.globalState.update.mockImplementation(
                    /**
                     * keyを一覧追加へ渡し、HTML設定Host・テストの回帰の結果または副作用を処理する。
                     * @param key - HTML設定Host・テストの回帰の対象や分岐を識別する値。
                     * @param value - 検証・変換・保存の対象となる値。
                     * @returns 副作用を完了し、値は返さない。
                     */
                    (key: string, value: unknown) => new Promise<void>(
                        /**
                         * 非同期処理の成功結果を待機側へ通知する。
                         * @param resolve - Promiseの成功を通知する関数。
                         * @returns 非同期処理の完了値。
                         */
                        (resolve) => {
                            started.push(value);
                            releases.push(
                                /**
                                 * 要素を状態設定へ渡し、HTML設定Host・テストの回帰の結果または副作用を処理する。
                                 * @returns HTML設定Host・テストの回帰のコールバックが生成する結果。
                                 */
                                () => {
                                    vscodeMock.state.set(key, value);
                                    resolve();
                                });
                        }));

                const first = setHtmlOptions(provider, document, panel, {
                    embedImages: true,
                    convertLinkedMarkdown: false,
                    saveWithoutDialog: true,
                });
                await new Promise<void>(
                    /**
                     * 遅延処理の完了または失敗を待機側へ通知する。
                     * @param resolve - Promiseの成功を通知する関数。
                     * @returns 非同期処理の完了値。
                     */
                    (resolve) => setTimeout(resolve, 0));
                const second = setHtmlOptions(provider, document, panel, {
                    embedImages: false,
                    convertLinkedMarkdown: true,
                    saveWithoutDialog: false,
                });
                await new Promise<void>(
                    /**
                     * 遅延処理の完了または失敗を待機側へ通知する。
                     * @param resolve - Promiseの成功を通知する関数。
                     * @returns 非同期処理の完了値。
                     */
                    (resolve) => setTimeout(resolve, 0));

                expect(started).toHaveLength(1);
                releases.shift()?.();
                await new Promise<void>(
                    /**
                     * 遅延処理の完了または失敗を待機側へ通知する。
                     * @param resolve - Promiseの成功を通知する関数。
                     * @returns 非同期処理の完了値。
                     */
                    (resolve) => setTimeout(resolve, 0));
                expect(started).toHaveLength(2);
                releases.shift()?.();
                await Promise.all([first, second]);

                expect(vscodeMock.state.get(HTML_OPTIONS_STATE_KEY)).toEqual({
                    embedImages: false,
                    convertLinkedMarkdown: true,
                    saveWithoutDialog: false,
                });
                const notifications = panel.webview.postMessage.mock.calls.map(
                    /**
                     * panel.webview.post・message.mock.callsの各要素を変換して一覧化する。
                     * @param options - 呼び出し側が指定する処理設定。
                     * @returns 入力要素から生成した変換結果の一覧。
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
    });

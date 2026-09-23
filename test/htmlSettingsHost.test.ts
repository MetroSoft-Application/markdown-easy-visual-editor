/**
 * @file htmlSettingsHost.test.ts
 * 実行境界: テスト実行環境。
 * 責務: 現行実装の仕様と回帰条件を検証する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テスト用のモック、ブラウザー、ファイルを必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

/** 「vscodeMock」は、関連する処理間で共有する設定値または状態です。 */
const vscodeMock = vi.hoisted(
/**
 * テスト対象が利用するAPIまたは依存モジュールのモックを生成するコールバックです。
 * @returns 「async」を実行し、値を返しません。
 */
() => {
  const state = new Map<string, unknown>();

  /**
   * 「defaultUpdate」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param key メッセージまたは設定表から値を取得する識別キーです。
   * @param value 「defaultUpdate」で検証・変換する入力値です。
   * @returns 非同期処理の完了を表すPromiseです。
   */
  const defaultUpdate = /**
 * 「defaultUpdate」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param key メッセージまたは設定表から値を取得する識別キーです。
 * @param value 「defaultUpdate」で検証・変換する入力値です。
 * @returns 「defaultUpdate」がHTML出力の入力を処理して得た固有の結果を返します。
 */ async (key: string, value: unknown): Promise<void> => {
    state.set(key, value);
  };
  const globalState = {
    get: vi.fn(
    /**
 * 「key」「fallback」を受け取り、処理結果を生成する処理です。
     * @param key メッセージまたは設定表から値を取得する識別キーです。
     * @param fallback fallbackとして渡される、このコールバックの入力値です。
     * @returns 「key」「fallback」から生成した処理結果を返します。
     */
    (key: string, fallback?: unknown) => state.has(key) ? state.get(key) : fallback),
    update: vi.fn(defaultUpdate),
  };
  const event = vi.fn(
  /**
 * （dispose、getConfiguration、get、_key、fallback）を持つオブジェクトを初期化して返すコールバックです。
   * @returns 初期化したオブジェクト（dispose、getConfiguration、get、_key、fallback）を返します。
   */
  () => ({ dispose: vi.fn() }));
  return {
    state,
    defaultUpdate,
    globalState,
    event,
    getConfiguration: vi.fn(
    /**
 * （get、_key、fallback、workspace、onDidChangeTextDocument）を持つオブジェクトを初期化して返すコールバックです。
     * @returns 初期化したオブジェクト（get、_key、fallback、workspace、onDidChangeTextDocument）を返します。
     */
    () => ({

      /**
       * getを取得または解決します。
       * @param _key 処理対象を特定する_keyの入力値です。
       * @param fallback 「fallback」は、「get」がHTML出力の処理対象を特定する入力です。
       * @returns 「get」が読み取りまたは正規化した結果を返します。
       */
      get: /**
 * 「get」は、要求された状態、値、または対象を読み取ります。
 * @param _key 「_key」は、「get」がHTMLで処理する対象を特定する入力です。
 * @param fallback 「fallback」は、「get」がHTMLで処理する対象を特定する入力です。
 * @returns 「get」が読み取りまたは正規化した結果を返します。
 */ (_key: string, fallback: unknown) => fallback,
    })),
  };
});

vi.mock('vscode',
/**
 * 登録された処理を受け取り、イベントに応じた状態更新または委譲処理を実行するコールバックです。
 * @returns 初期化したオブジェクト（workspace、onDidChangeTextDocument、onDidChangeConfiguration、onDidGrantWorkspaceTrust、getConfiguration）を返します。
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

/** 「HTML_OPTIONS_STATE_KEY」は、呼び出し先へ渡す設定値の集合です。 */
const HTML_OPTIONS_STATE_KEY = 'markdownEasyVisualEditor.htmlOptions';

/**
 * create・contextを作成または組み立てます。
 * @returns 「createContext」が生成したデータまたはオブジェクトを返します。
 */
function createContext(): any {
  return {
    subscriptions: [],
    globalState: vscodeMock.globalState,
    extensionUri: {},
  };
}

/**
 * 文書を作成または組み立てます。
 * @param uri 「uri」は、「createDocument」がHTML出力の処理対象を特定する入力です。
 * @returns 「createDocument」が生成したデータまたはオブジェクトを返します。
 */
function createDocument(uri = 'file:///workspace/main.md'): any {
  return {
    uri: {
      scheme: 'file',
      fsPath: uri.replace(/^file:\/\//, ''),

      /**
       * 「toString」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
       * @returns 「toString」が生成または整形したHTML出力の文字列を返します。
       */
      toString: /**
 * 「toString」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @returns 「toString」が生成または整形したHTML出力の文字列を返します。
 */ () => uri,
    },
    version: 1,

    /**
     * 本文を取得または解決します。
     * @returns 「getText」が読み取りまたは正規化した結果を返します。
     */
    getText: /**
 * 「getText」は、要求された状態、値、または対象を読み取ります。
 * @returns 「getText」が読み取りまたは正規化した結果を返します。
 */ () => '',
  };
}

/**
 * 「addPanel」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param provider 「provider」は、「addPanel」がHTML出力の処理対象を特定する入力です。
 * @param document 処理対象の文書です。
 * @returns 「addPanel」がHTML出力の入力を処理して得た固有の結果を返します。
 */
function addPanel(provider: MarkdownEasyVisualEditorProvider, document: any): any {
  return addPanels(provider, document, 1)[0];
}

/**
 * 「addPanels」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param provider 「provider」は、「addPanels」がHTML出力の処理対象を特定する入力です。
 * @param document 処理対象の文書です。
 * @param count 処理対象の件数、容量、または上限を表す数値です。
 * @returns 「addPanels」がHTML出力の入力を処理して得た固有の結果を返します。
 */
function addPanels(provider: MarkdownEasyVisualEditorProvider, document: any, count: number): any[] {
  const panels = Array.from({ length: count },
  /**
 * 登録された処理から配列要素を生成するコールバックです。
   * @returns 配列要素または初期値を返します。
   */
  () => ({ webview: { postMessage: vi.fn() } }));
  const instance = provider as any;
  const key = document.uri.toString();
  instance.panels.set(key, new Set(panels));
  instance.documents.set(key, document);
  return panels;
}

/**
 * 設定を更新または保存します。
 * @param provider 「provider」は、「setHtmlOptions」がHTML出力の処理対象を特定する入力です。
 * @param document 処理対象の文書です。
 * @param panel 「panel」は、「setHtmlOptions」がHTML出力の処理対象を特定する入力です。
 * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはpanel、optionsです。
 * @returns 非同期処理の完了を表すPromiseです。
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
 * 登録された副作用または結果を生成する処理を実行するコールバックです。
 * @returns 「vscodeMock.state.clear」を実行し、値を返しません。
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
 * テスト「HTML export global settings in the extension host」の前提条件を設定し、期待結果を検証するコールバックです。
 * @returns テストの前提条件と期待結果を検証し、値を返しません。
 */
() => {
  it('persists, broadcasts, and reloads all three global choices',
  /**
   * 「async」として関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
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
   * 「async」として関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
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
 * テスト「serializes concurrent updates and leaves the last update visible everywhere」の前提条件を設定し、期待結果を検証するコールバックです。
     * @param key メッセージまたは設定表から値を取得する識別キーです。
     * @param value 「key」で検証・変換する入力値です。
     * @returns テストの前提条件と期待結果を検証し、値を返しません。
     */
    (key: string, value: unknown) => new Promise<void>(
    /**
 * テスト「serializes concurrent updates and leaves the last update visible everywhere」の前提条件を設定し、期待結果を検証するコールバックです。
     * @param resolve Promiseの完了または失敗を通知する関数です。
     * @returns テストの前提条件と期待結果を検証し、値を返しません。
     */
    (resolve) => {
      started.push(value);
      releases.push(
      /**
 * 登録された副作用または結果を生成する処理を実行するコールバックです。
       * @returns 「vscodeMock.state.set」を実行し、値を返しません。
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
     * 予約されたタイミングで「resolve」を受け取り、遅延処理を実行するコールバックです。
     * @param resolve Promiseの完了または失敗を通知する関数です。
     * @returns 「setTimeout」を実行し、値を返しません。
     */
    (resolve) => setTimeout(resolve, 0));
    const second = setHtmlOptions(provider, document, panel, {
      embedImages: false,
      convertLinkedMarkdown: true,
      saveWithoutDialog: false,
    });
    await new Promise<void>(
    /**
     * 予約されたタイミングで「resolve」を受け取り、遅延処理を実行するコールバックです。
     * @param resolve Promiseの完了または失敗を通知する関数です。
     * @returns 「setTimeout」を実行し、値を返しません。
     */
    (resolve) => setTimeout(resolve, 0));

    expect(started).toHaveLength(1);
    releases.shift()?.();
    await new Promise<void>(
    /**
     * 予約されたタイミングで「resolve」を受け取り、遅延処理を実行するコールバックです。
     * @param resolve Promiseの完了または失敗を通知する関数です。
     * @returns 「setTimeout」を実行し、値を返しません。
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
 * 「message」を変換し、変換後の要素を返すコールバックです。
     * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはmessageです。
     * @returns 入力要素から生成した変換後の値を返します。
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

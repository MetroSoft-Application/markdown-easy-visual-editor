import { afterEach, describe, expect, it, vi } from 'vitest';

const vscodeMock = vi.hoisted(() => {
  const state = new Map<string, unknown>();
  const defaultUpdate = async (key: string, value: unknown): Promise<void> => {
    state.set(key, value);
  };
  const globalState = {
    get: vi.fn((key: string, fallback?: unknown) => state.has(key) ? state.get(key) : fallback),
    update: vi.fn(defaultUpdate),
  };
  const event = vi.fn(() => ({ dispose: vi.fn() }));
  return {
    state,
    defaultUpdate,
    globalState,
    event,
    getConfiguration: vi.fn(() => ({
      get: (_key: string, fallback: unknown) => fallback,
    })),
  };
});

vi.mock('vscode', () => ({
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

const HTML_OPTIONS_STATE_KEY = 'markdownEasyVisualEditor.htmlOptions';

function createContext(): any {
  return {
    subscriptions: [],
    globalState: vscodeMock.globalState,
    extensionUri: {},
  };
}

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

function addPanel(provider: MarkdownEasyVisualEditorProvider, document: any): any {
  return addPanels(provider, document, 1)[0];
}

function addPanels(provider: MarkdownEasyVisualEditorProvider, document: any, count: number): any[] {
  const panels = Array.from({ length: count }, () => ({ webview: { postMessage: vi.fn() } }));
  const instance = provider as any;
  const key = document.uri.toString();
  instance.panels.set(key, new Set(panels));
  instance.documents.set(key, document);
  return panels;
}

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

afterEach(() => {
  vscodeMock.state.clear();
  vscodeMock.globalState.get.mockClear();
  vscodeMock.globalState.update.mockReset();
  vscodeMock.globalState.update.mockImplementation(vscodeMock.defaultUpdate);
  vscodeMock.getConfiguration.mockClear();
});

describe('HTML export global settings in the extension host', () => {
  it('persists, broadcasts, and reloads all three global choices', async () => {
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

  it('serializes concurrent updates and leaves the last update visible everywhere', async () => {
    const provider = new MarkdownEasyVisualEditorProvider(createContext());
    const document = createDocument();
    const panels = addPanels(provider, document, 2);
    const panel = panels[0];
    const releases: Array<() => void> = [];
    const started: unknown[] = [];
    vscodeMock.globalState.update.mockImplementation((key: string, value: unknown) => new Promise<void>((resolve) => {
      started.push(value);
      releases.push(() => {
        vscodeMock.state.set(key, value);
        resolve();
      });
    }));

    const first = setHtmlOptions(provider, document, panel, {
      embedImages: true,
      convertLinkedMarkdown: false,
      saveWithoutDialog: true,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const second = setHtmlOptions(provider, document, panel, {
      embedImages: false,
      convertLinkedMarkdown: true,
      saveWithoutDialog: false,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(started).toHaveLength(1);
    releases.shift()?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(started).toHaveLength(2);
    releases.shift()?.();
    await Promise.all([first, second]);

    expect(vscodeMock.state.get(HTML_OPTIONS_STATE_KEY)).toEqual({
      embedImages: false,
      convertLinkedMarkdown: true,
      saveWithoutDialog: false,
    });
    const notifications = panel.webview.postMessage.mock.calls.map(([message]: any[]) => message);
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

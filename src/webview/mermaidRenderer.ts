import mermaid from 'mermaid';
import { createClientId } from './id';
import { getMessages, type SupportedLanguage } from '../shared/messages';
import type { HostToWebviewMessage, MermaidInteraction } from '../shared/protocol';
import { sharedVsCodeApi } from './vscodeApi';

export type MermaidTheme = 'default' | 'dark' | 'neutral';

interface InlineRenderTask {
  source: string;
  theme: MermaidTheme;
  signal?: AbortSignal;
  started: boolean;
  settled: boolean;
  cancelled: boolean;
  resolve: (result: MermaidRenderResult) => void;
  reject: (error: unknown) => void;
  removeAbortListener: () => void;
}
const inlineRenderQueue: InlineRenderTask[] = [];
let activeInlineRender: InlineRenderTask | undefined;
const HOST_RENDER_TIMEOUT_MS = 35_000;
export interface MermaidRenderResult {
  svg: string;
  pngBase64?: string;
  interactions: MermaidInteraction[];
  ariaLabel: string;
  external: boolean;
}
const hostRequests = new Map<string, {
  resolve: (result: MermaidRenderResult) => void;
  reject: (error: Error) => void;
  timer: number;
  removeAbortListener: () => void;
}>();

class MermaidRenderCancelledError extends Error {
  constructor() {
    super('Mermaid rendering was cancelled.');
    this.name = 'MermaidRenderCancelledError';
  }
}

export class MermaidHostRenderError extends Error {
  constructor(message: string, readonly unavailable: boolean) {
    super(message);
    this.name = 'MermaidHostRenderError';
  }
}

/**
 * Mermaidソースを指定テーマでSVGへ変換し、共有設定を壊さないよう直列実行する。
 * @param source Mermaid記法のソース。
 * @param theme Mermaidへ適用するテーマ。
 * @returns 生成されたSVG文字列を解決するPromise。
 * @throws Mermaidの構文解析または描画に失敗した場合。
 */
export function renderMermaidSvg(
  source: string,
  theme: MermaidTheme,
  signal?: AbortSignal,
  useHostRenderer = false,
  allowInlineFallback = true
): Promise<MermaidRenderResult> {
  if (useHostRenderer) {
    return requestHostRender(source, theme, signal)
      .catch((error) => {
        if (!(error instanceof MermaidHostRenderError) || !error.unavailable || !allowInlineFallback) throw error;
        return renderMermaidInline(source, theme, signal);
      });
  }
  return renderMermaidInline(source, theme, signal);
}

/** ホストから返ったMermaid描画結果を、対応する要求へ配送する。 */
export function acceptMermaidRenderResult(
  message: Extract<HostToWebviewMessage, { type: 'mermaidRendered' }>
): void {
  const pending = hostRequests.get(message.requestId);
  if (!pending) return;
  hostRequests.delete(message.requestId);
  window.clearTimeout(pending.timer);
  pending.removeAbortListener();
  if (message.svg !== undefined) {
    pending.resolve({
      svg: message.svg,
      pngBase64: message.pngBase64,
      interactions: message.interactions ?? [],
      ariaLabel: message.ariaLabel ?? '',
      external: true
    });
  } else {
    pending.reject(new MermaidHostRenderError(
      message.error ?? 'Mermaid rendering failed.',
      message.rendererUnavailable === true
    ));
  }
}

function requestHostRender(
  source: string,
  theme: MermaidTheme,
  signal?: AbortSignal
): Promise<MermaidRenderResult> {
  const requestId = createClientId();
  return new Promise<MermaidRenderResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new MermaidRenderCancelledError());
      return;
    }
    const onAbort = () => {
      const pending = hostRequests.get(requestId);
      if (!pending) return;
      hostRequests.delete(requestId);
      window.clearTimeout(pending.timer);
      pending.removeAbortListener();
      sharedVsCodeApi.postMessage({ type: 'cancelMermaidRender', requestId });
      reject(new MermaidRenderCancelledError());
    };
    const timer = window.setTimeout(() => {
      hostRequests.delete(requestId);
      signal?.removeEventListener('abort', onAbort);
      sharedVsCodeApi.postMessage({ type: 'cancelMermaidRender', requestId });
      reject(new MermaidHostRenderError('Mermaid host rendering timed out.', true));
    }, HOST_RENDER_TIMEOUT_MS);
    hostRequests.set(requestId, {
      timer,
      resolve: (svg) => {
        if (signal?.aborted) reject(new MermaidRenderCancelledError());
        else resolve(svg);
      },
      reject,
      removeAbortListener: () => signal?.removeEventListener('abort', onAbort)
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    sharedVsCodeApi.postMessage({ type: 'renderMermaid', requestId, source, theme });
  });
}

function renderMermaidInline(
  source: string,
  theme: MermaidTheme,
  signal?: AbortSignal
): Promise<MermaidRenderResult> {
  if (signal?.aborted) return Promise.reject(new MermaidRenderCancelledError());
  let task!: InlineRenderTask;
  const result = new Promise<MermaidRenderResult>((resolve, reject) => {
    const onAbort = () => cancelInlineRender(task);
    task = {
      source,
      theme,
      signal,
      started: false,
      settled: false,
      cancelled: false,
      resolve,
      reject,
      removeAbortListener: () => signal?.removeEventListener('abort', onAbort)
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  inlineRenderQueue.push(task);
  void drainInlineRenderQueue();
  return result;
}

async function drainInlineRenderQueue(): Promise<void> {
  if (activeInlineRender) return;
  while (inlineRenderQueue.length) {
    const task = inlineRenderQueue.shift();
    if (!task || task.settled) continue;
    if (task.cancelled || task.signal?.aborted) {
      settleInlineRender(task, undefined, new MermaidRenderCancelledError());
      continue;
    }
    activeInlineRender = task;
    task.started = true;
    try {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: task.theme,
        suppressErrorRendering: true
      });
      await mermaid.parse(task.source);
      if (task.cancelled || task.signal?.aborted) throw new MermaidRenderCancelledError();
      const { svg } = await mermaid.render(`mve-mermaid-${createClientId()}`, task.source);
      if (task.cancelled || task.signal?.aborted) throw new MermaidRenderCancelledError();
      settleInlineRender(task, { svg, interactions: [], ariaLabel: '', external: false });
    } catch (error) {
      settleInlineRender(task, undefined, error);
    } finally {
      if (activeInlineRender === task) activeInlineRender = undefined;
    }
  }
}

function cancelInlineRender(task: InlineRenderTask): void {
  if (task.cancelled || task.settled) return;
  task.cancelled = true;
  if (!task.started) {
    const index = inlineRenderQueue.indexOf(task);
    if (index >= 0) inlineRenderQueue.splice(index, 1);
  }
  settleInlineRender(task, undefined, new MermaidRenderCancelledError());
}

function settleInlineRender(task: InlineRenderTask, result?: MermaidRenderResult, error?: unknown): void {
  if (task.settled) return;
  task.settled = true;
  task.removeAbortListener();
  if (error !== undefined) task.reject(error);
  else if (result !== undefined) task.resolve(result);
}

/**
 * Mermaidの例外を行・列情報付きの画面表示用エラーメッセージへ変換する。
 * @param error Mermaidから受け取った例外または任意のエラー値。
 * @returns 画面表示用に整形したエラーメッセージ。
 */
export function mermaidErrorMessage(error: unknown, language: SupportedLanguage = 'ja'): string {
  // Mermaidのエラー文字列から行・列情報を抽出し、画面表示用の文面に整える。
  const message = error instanceof Error ? error.message : String(error);
  const location = /(?:line\s+(\d+))(?:[^\d]+(?:col(?:umn)?\s*)?(\d+))?/i.exec(message);
  const messages = getMessages(language);
  const prefix = location
    ? `${messages.renderer.mermaidError} (${messages.app.line(Number(location[1]))}${location[2] ? `, ${location[2]}` : ''})`
    : messages.renderer.mermaidError;
  return `${prefix}\n${message}`;
}

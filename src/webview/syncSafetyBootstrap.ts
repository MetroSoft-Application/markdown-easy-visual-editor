import type {
  HostToWebviewMessage,
  VsCodeApi,
  WebviewToHostMessage
} from '../shared/protocol';
import { SyncSafetyGuard } from './syncSafety';

interface AcquireScope {
  acquireVsCodeApi: <State = unknown>() => VsCodeApi<State>;
}

const scope = globalThis as typeof globalThis & AcquireScope;
const nativeAcquireVsCodeApi = scope.acquireVsCodeApi;
const syncGuard = new SyncSafetyGuard();
let guardedApi: VsCodeApi<unknown> | undefined;
let rawApi: VsCodeApi<unknown> | undefined;
let emergencyReloadScheduled = false;

/**
 * VS Code API取得をAppより先に包み、すべてのlocalChangesへ安全ゲートを強制する。
 * vscodeApi.tsはこのラッパーから取得した同じインスタンスを全Webview機能へ共有する。
 */
scope.acquireVsCodeApi = <State = unknown>(): VsCodeApi<State> => {
  if (guardedApi) return guardedApi as VsCodeApi<State>;
  rawApi = nativeAcquireVsCodeApi<unknown>();
  guardedApi = {
    postMessage(message: WebviewToHostMessage): void {
      const decision = syncGuard.handleOutbound(message);
      if (decision.kind === 'forward') {
        rawApi?.postMessage(message);
        return;
      }
      const state = syncGuard.snapshot();
      console.error('[Markdown Easy Visual Editor] 自動書き込みを安全ガードで停止しました。', {
        reason: decision.reason,
        type: message.type,
        opId: message.type === 'localChanges' ? message.opId : undefined,
        state
      });
      if (document.body) document.body.dataset.mveSyncGuard = 'blocked';
      // 遮断した操作はHostへ一切適用せず、authoritative snapshotだけを直接要求する。
      // AppにはlocalChangesを送ったように見えているため、opId付き再同期で必ず待機を解除する。
      rawApi?.postMessage(decision.recovery);

      if (state.blockedWriteStreak >= 2 && !emergencyReloadScheduled) {
        // Hostへの書き込みを止めてもWebview内部でプログラム変更が発生し続けるケースに備え、
        // 2回目でJS実行コンテキスト自体を破棄する。再生成後はHostの確定本文からinitされる。
        emergencyReloadScheduled = true;
        if (document.body) document.body.dataset.mveSyncGuard = 'reloading';
        window.setTimeout(() => window.location.reload(), 0);
      }
    },
    getState: () => rawApi?.getState(),
    setState: (state) => rawApi?.setState(state)
  };
  return guardedApi as VsCodeApi<State>;
};

const redistributedEvents = new WeakSet<MessageEvent>();

/** Host通知をAppより先に検査し、危険な再送指示だけ安全側へ正規化する。 */
function handleHostMessageCapture(event: MessageEvent): void {
  if (redistributedEvents.has(event) || !isHostMessage(event.data)) return;
  if (event.data.type === 'imagesSaved' && event.data.paths.length > 0) {
    // 画像選択/貼り付けは保存完了後に文書挿入されるため、非同期結果を元のユーザー意図として継承する。
    noteMutationIntent('images-saved');
  }
  const decision = syncGuard.handleInbound(event.data);
  if (decision.kind === 'drop') {
    event.stopImmediatePropagation();
    console.warn('[Markdown Easy Visual Editor] 古い同期通知を破棄しました。', decision.reason);
    return;
  }
  if (decision.message === event.data) return;

  // 原イベントをAppへ渡さず、安全化した同値イベントだけを次のmicrotaskで配信する。
  event.stopImmediatePropagation();
  const redistributed = new MessageEvent('message', { data: decision.message });
  redistributedEvents.add(redistributed);
  queueMicrotask(() => window.dispatchEvent(redistributed));
}

window.addEventListener('message', handleHostMessageCapture, true);

interface RecentHistoryKey {
  command: 'undo' | 'redo';
  target: EventTarget | null;
  at: number;
}

let recentHistoryKey: RecentHistoryKey | undefined;
let compositionDepth = 0;
let pendingHistoryAfterComposition: { command: 'undo' | 'redo'; target: EventTarget | null } | undefined;

/** Ctrl/Cmd+Z/YをAppの単一履歴経路へ寄せるため、SourceEditor上のキー入力を記録する。 */
function handleKeyDownCapture(event: KeyboardEvent): void {
  if (!event.isTrusted) return;
  const target = event.target instanceof Element ? event.target : undefined;
  if (target?.closest('.mve-table-editor')
    && (event.ctrlKey || event.metaKey)
    && !event.altKey
    && event.key === 'Enter') {
    noteMutationIntent('table-editor-apply-key');
    return;
  }
  if (target?.closest('.app form')
    && !event.ctrlKey
    && !event.metaKey
    && !event.altKey
    && event.key === 'Enter') {
    // リンクダイアログ等、Enter submitでMarkdownへ反映される経路を認可する。
    noteMutationIntent('form-submit-key');
  }
  if (!isInsideSourceEditor(event.target)) return;

  const history = historyCommandForKey(event);
  if (history) {
    // Appが通常のkeydownを処理する。isComposing中はAppが意図的に無視するため記録しない。
    if (!event.isComposing) recentHistoryKey = { command: history, target: event.target, at: performance.now() };
    return;
  }

  if (event.isComposing) return;
  const directMutation = (!event.ctrlKey && !event.metaKey && !event.altKey && (
    event.key.length === 1
    || event.key === 'Backspace'
    || event.key === 'Delete'
    || event.key === 'Enter'
    || event.key === 'Tab'
  )) || (event.altKey && !event.ctrlKey && !event.metaKey && event.key === 'Enter');
  if (directMutation) noteMutationIntent(`keydown:${event.key}`);
}

/**
 * browser/CodeMirrorがhistoryUndo/historyRedoをbeforeinputとして発火した場合も、
 * SourceEditorの既存ブロック処理で消える前にAppのrequestHistoryCommandへ戻す。
 */
function handleBeforeInputCapture(event: InputEvent): void {
  if (!event.isTrusted || !isInsideSourceEditor(event.target)) return;
  if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
    event.preventDefault();
    event.stopImmediatePropagation();
    const command = event.inputType === 'historyUndo' ? 'undo' : 'redo';
    const recent = recentHistoryKey;
    recentHistoryKey = undefined;
    if (recent
      && recent.command === command
      && performance.now() - recent.at < 250
      && sameHistoryTarget(recent.target, event.target)) {
      // 直前のkeydownをAppが既に処理している。beforeinput側では二重実行しない。
      return;
    }
    if (compositionDepth > 0 || event.isComposing) {
      pendingHistoryAfterComposition = { command, target: event.target };
      return;
    }
    dispatchHistoryKey(event.target, command);
    return;
  }

  if (event.inputType.startsWith('insert') || event.inputType.startsWith('delete')) {
    noteMutationIntent(`beforeinput:${event.inputType}`);
  }
}

function handlePasteCapture(event: ClipboardEvent): void {
  if (event.isTrusted && isInsideAppOrTableEditor(event.target)) noteMutationIntent('paste');
}

function handleDropCapture(event: DragEvent): void {
  if (event.isTrusted && isInsideAppOrTableEditor(event.target)) noteMutationIntent('drop');
}

function handleClickCapture(event: MouseEvent): void {
  if (!event.isTrusted || !(event.target instanceof Element)) return;
  if (event.target.closest('.app button, .mve-table-editor button, .cm-tooltip-autocomplete')) {
    noteMutationIntent('interactive-click');
  }
}

function handlePointerDownCapture(event: PointerEvent): void {
  if (!event.isTrusted || event.button !== 0 || !(event.target instanceof Element)) return;
  if (event.target.closest('.mve-image-handle')) noteMutationIntent('image-resize');
}

function handleCompositionStart(): void {
  compositionDepth += 1;
}

function handleCompositionEnd(event: CompositionEvent): void {
  compositionDepth = Math.max(0, compositionDepth - 1);
  if (compositionDepth > 0 || !pendingHistoryAfterComposition) return;
  const pending = pendingHistoryAfterComposition;
  pendingHistoryAfterComposition = undefined;
  const target = pending.target ?? event.target;
  window.setTimeout(() => dispatchHistoryKey(target, pending.command), 0);
}

document.addEventListener('keydown', handleKeyDownCapture, true);
document.addEventListener('beforeinput', handleBeforeInputCapture, true);
document.addEventListener('paste', handlePasteCapture, true);
document.addEventListener('drop', handleDropCapture, true);
document.addEventListener('click', handleClickCapture, true);
document.addEventListener('pointerdown', handlePointerDownCapture, true);
document.addEventListener('compositionstart', handleCompositionStart, true);
document.addEventListener('compositionend', handleCompositionEnd, true);

function noteMutationIntent(reason: string): void {
  syncGuard.noteMutationIntent(reason);
  if (document.body?.dataset.mveSyncGuard === 'blocked') delete document.body.dataset.mveSyncGuard;
}

function historyCommandForKey(event: KeyboardEvent): 'undo' | 'redo' | undefined {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return undefined;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !event.shiftKey) return 'redo';
  return undefined;
}

/** Appの既存document keydownへ履歴操作を再投入し、flush/同期順序を迂回しない。 */
function dispatchHistoryKey(target: EventTarget | null, command: 'undo' | 'redo'): void {
  const dispatchTarget = target instanceof Node && target.isConnected ? target : document.querySelector('.cm-content');
  if (!(dispatchTarget instanceof EventTarget)) return;
  dispatchTarget.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'z',
    code: 'KeyZ',
    ctrlKey: true,
    shiftKey: command === 'redo',
    bubbles: true,
    cancelable: true,
    composed: true
  }));
}

function sameHistoryTarget(left: EventTarget | null, right: EventTarget | null): boolean {
  if (left === right) return true;
  return left instanceof Node && right instanceof Node
    && (left.contains(right) || right.contains(left));
}

function isInsideSourceEditor(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('.cm-content'));
}

function isInsideAppOrTableEditor(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('.app, .mve-table-editor'));
}

function isHostMessage(value: unknown): value is HostToWebviewMessage {
  return Boolean(value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string');
}

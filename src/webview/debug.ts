export interface MveDebugEntry {
  seq: number;
  at: number;
  event: string;
  details: Record<string, unknown>;
}

interface MveDebugWindow extends Window {
  __mveDebugEnabled?: boolean;
  __mveDebugLog?: MveDebugEntry[];
  __mveDebugDump?: () => string;
  __mveDebugClear?: () => void;
}

let sequence = 0;
const startedAt = typeof performance === 'undefined' ? Date.now() : performance.now();

function now(): number {
  return typeof performance === 'undefined' ? Date.now() - startedAt : performance.now() - startedAt;
}

export function isMveDebugEnabled(): boolean {
  return typeof window !== 'undefined'
    && (window as MveDebugWindow).__mveDebugEnabled === true;
}

export function mveDebug(event: string, details: Record<string, unknown> = {}): void {
  if (!isMveDebugEnabled()) return;
  const target = window as MveDebugWindow;
  // 詳細ログは入力イベントごとに発生するため、本番では既定で無効にする。
  // DevToolsで `window.__mveDebugEnabled = true` を設定すれば診断用に再度有効化できる。

  const entry: MveDebugEntry = {
    seq: ++sequence,
    at: Math.round(now() * 100) / 100,
    event,
    details
  };
  const log = target.__mveDebugLog ?? [];
  log.push(entry);
  if (log.length > 500) log.splice(0, log.length - 500);
  target.__mveDebugLog = log;
  target.__mveDebugDump = () => JSON.stringify(target.__mveDebugLog ?? [], null, 2);
  target.__mveDebugClear = () => { target.__mveDebugLog = []; };
  console.info(`[MVE ${entry.seq}] ${event}`, details);
}

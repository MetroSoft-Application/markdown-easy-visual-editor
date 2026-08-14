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

export function mveDebug(event: string, details: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;
  const target = window as MveDebugWindow;
  if (target.__mveDebugEnabled === false) return;
  if (target.__mveDebugEnabled === undefined) target.__mveDebugEnabled = true;

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

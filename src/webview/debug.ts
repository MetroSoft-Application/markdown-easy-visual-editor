/**
 * @fileoverview Webviewのdebugを管理する。Hostとの通信、ユーザー操作、表示状態の契約を保つ。
 */
/**
 * debugで共有するデータ形状を表すインターフェース。
 */
export interface MveDebugEntry {

    /**
     * debugのseqを表す数値。
     */
    seq: number;

    /**
     * debugのatを表す数値。
     */
    at: number;

    /**
     * ユーザー操作またはDOMから通知されたイベント。
     */
    event: string;

    /**
     * debugで扱うdetailsの文字列。
     */
    details: Record<string, unknown>;
}

/**
 * debugで共有するデータ形状を表すインターフェース。
 */
interface MveDebugWindow extends Window {

    /**
     * debugの・mve・debug・enabledを示す状態フラグ。
     */
    __mveDebugEnabled?: boolean;

    /**
     * debugの・mve・debug・logに関する状態または設定。
     */
    __mveDebugLog?: MveDebugEntry[];
    /**
     * debugの・mve・debug・dumpを処理し、呼び出し側へ結果または副作用を返す。
     * @returns debugで利用する数値。
     */
    __mveDebugDump?: () => string;
    /**
     * debugの・mve・debug・clearを処理し、呼び出し側へ結果または副作用を返す。
     * @returns debugで利用する数値。
     */
    __mveDebugClear?: () => void;
}

/**
 * debugのsequenceに関する状態または設定。
 */
let sequence = 0;
/**
 * debugのstarted・atに関する状態または設定。
 */
const startedAt = typeof performance === 'undefined' ? Date.now() : performance.now();

/**
 * debugのnowを処理し、呼び出し側へ結果または副作用を返す。
 * @returns debugで利用する数値。
 */
function now(): number {
    return typeof performance === 'undefined' ? Date.now() - startedAt : performance.now() - startedAt;
}

/**
 * debugの条件を判定する。
 * @returns 条件が成立したかを示す真偽値。
 */
export function isMveDebugEnabled(): boolean {
    return typeof window !== 'undefined'
        && (window as MveDebugWindow).__mveDebugEnabled === true;
}

/**
 * debugのmve・debugを処理し、呼び出し側へ結果または副作用を返す。
 * @param event - ユーザー操作またはDOMから通知されたイベント。
 * @param details - debugで受け渡す文字列。
 * @returns 副作用を完了し、値は返さない。
 */
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
    target.__mveDebugDump =
        /**
         * debugの・mve・debug・dumpを処理し、呼び出し側へ結果または副作用を返す。
         * @returns debugで利用する文字列。
         */
        () => JSON.stringify(target.__mveDebugLog ?? [], null, 2);
    target.__mveDebugClear =
        /**
         * debugの・mve・debug・clearを処理し、呼び出し側へ結果または副作用を返す。
         * @returns debugの・mve・debug・clearが生成する結果。
         */
        () => { target.__mveDebugLog = []; };
    console.info(`[MVE ${entry.seq}] ${event}`, details);
}

/**
 * @fileoverview Webviewの診断イベントを時刻付きで記録し、必要に応じてJSON出力または消去できるデバッグAPIを提供する。
 */
/**
 * デバッグログ1件の通し番号、経過時間、イベント名、詳細データを保持する。
 */
export interface MveDebugEntry {

    /**
     * ログ追加順の通し番号。
     */
    seq: number;

    /**
     * デバッグ開始からイベント記録までの経過ミリ秒。
     */
    at: number;

    /**
     * ユーザー操作またはDOMから通知されたイベント。
     */
    event: string;

    /**
     * イベントに付随する構造化データ。
     */
    details: Record<string, unknown>;
}

/**
 * windowに公開するデバッグ用フラグ、ログ、操作関数の型。
 */
interface MveDebugWindow extends Window {

    /**
     * 詳細ログを記録するかを制御するフラグ。
     */
    __mveDebugEnabled?: boolean;

    /**
     * 最新500件までの診断ログ。
     */
    __mveDebugLog?: MveDebugEntry[];
    /**
     * 診断ログを整形済みJSON文字列で返す関数。
     */
    __mveDebugDump?: () => string;
    /**
     * 診断ログを空にする関数。
     */
    __mveDebugClear?: () => void;
}

/**
 * 次に記録するログ行へ割り当てる通し番号。
 */
let sequence = 0;
/**
 * 経過時間を測る起点。
 */
const startedAt = typeof performance === 'undefined' ? Date.now() : performance.now();

/**
 * 診断開始からの経過時間をミリ秒で返す。
 * @returns performance.nowを基準にした経過ミリ秒。performanceが使えない場合はDate.now基準。
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
 * デバッグが有効な場合に、イベント名と構造化情報を診断ログへ記録する。
 * @param event ログ行を識別するイベント名。
 * @param details ログへ添える構造化診断データ。
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
        () => JSON.stringify(target.__mveDebugLog ?? [], null, 2);
    target.__mveDebugClear =
        () => { target.__mveDebugLog = []; };
    console.info(`[MVE ${entry.seq}] ${event}`, details);
}

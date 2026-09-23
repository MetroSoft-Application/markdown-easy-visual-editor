/**
 * @file debug.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
/**
 * 「MveDebugEntry」が満たすデータ契約を定義します。
 */
export interface MveDebugEntry {

    /**
     * 「seq」は、位置・サイズ・件数などを表す数値です。
     */
    seq: number;

    /**
     * 「at」は、位置・サイズ・件数などを表す数値です。
     */
    at: number;

    /**
     * 「event」は、対象の内容または識別子を表す文字列です。
     */
    event: string;

    /**
     * 「details」は、関連する複数の対象または識別子を保持します。
     */
    details: Record<string, unknown>;
}

/**
 * 「MveDebugWindow」が満たすデータ契約を定義します。
 */
interface MveDebugWindow extends Window {

    /**
     * 「__mveDebugEnabled」は、画面の表示モードまたは現在のUI状態を示します。
     */
    __mveDebugEnabled?: boolean;

    /**
     * 「__mveDebugLog」は、関連する複数の対象または識別子を保持します。
     */
    __mveDebugLog?: MveDebugEntry[];
    /**
     * 呼び出し側が入力を渡し、宣言された戻り値型で結果を受け取る契約です。
     * @returns 処理が生成または変換したWebview UIの文字列を返します。
     */
    __mveDebugDump?: () => string;
    /**
     * 呼び出し側が入力を渡し、宣言された戻り値型で結果を受け取る契約です。
     * @returns 状態更新または副作用を実行し、値は返しません。
     */
    __mveDebugClear?: () => void;
}

/** 「sequence」は、関連する処理間で共有する設定値または状態です。 */
let sequence = 0;
/** 「startedAt」は、関連する処理間で共有する設定値または状態です。 */
const startedAt = typeof performance === 'undefined' ? Date.now() : performance.now();

/**
 * 「now」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @returns 計算結果の数値です。
 */
function now(): number {
    return typeof performance === 'undefined' ? Date.now() - startedAt : performance.now() - startedAt;
}

/**
 * is・mve・debug・enabledかどうかを判定します。
 * @returns 判定結果です。
 */
export function isMveDebugEnabled(): boolean {
    return typeof window !== 'undefined'
        && (window as MveDebugWindow).__mveDebugEnabled === true;
}

/**
 * 「mveDebug」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param event 処理対象のイベントです。
 * @param details 「details」は、「mveDebug」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「mveDebug」の副作用または状態更新を実行し、値は返しません。
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
 * 検証対象のJSONペイロードを生成する処理を実行するコールバックです。
     * @returns 「JSON.stringify」の呼び出し結果を返します。
     */
    () => JSON.stringify(target.__mveDebugLog ?? [], null, 2);
    target.__mveDebugClear =
    /**
 * 登録された副作用または結果を生成する処理を実行するコールバックです。
     * @returns 「console.info」を実行し、値を返しません。
     */
    () => { target.__mveDebugLog = []; };
    console.info(`[MVE ${entry.seq}] ${event}`, details);
}

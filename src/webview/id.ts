/**
 * @file id.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
/**
 * Webviewインスタンスを識別するための一意なクライアントIDを生成する。
 * @returns 暗号学的UUIDまたは乱数と時刻から作ったクライアントID。
 */
export function createClientId(): string {
    // 利用可能なら暗号学的UUIDを使い、使えない環境では乱数バイトからIDを生成する。
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (typeof globalThis.crypto?.getRandomValues === 'function') globalThis.crypto.getRandomValues(bytes);
    // Web Cryptoがない場合は、各バイトへMath.randomの値を割り当てる。
    else for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
    // 時刻由来の接頭辞と16進化したバイト列を連結してクライアントIDにする。
    return `${Date.now().toString(36)}-${Array.from(bytes,
    /**
 * 「value」から配列要素を生成するコールバックです。
     * @param value 「value」で検証・変換する入力値です。
     * @returns 「value」から生成した処理結果を返します。
     */
    (value) => value.toString(16).padStart(2, '0')).join('')}`;
}

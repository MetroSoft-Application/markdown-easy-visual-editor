/**
 * @fileoverview Web Cryptoが使える環境ではUUIDを、使えない環境では時刻と乱数バイトを使ってWebviewのクライアントIDを生成する。
 */
/**
 * 暗号学的UUIDを優先し、UUID APIがない環境ではランダムバイトを16進化したIDを返す。
 * @returns UUIDまたは16バイトのランダム値を16進化したID。
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
         * 各乱数バイトを2桁の16進文字列へ変換する。
         * @param value - 16バイトID配列から取り出した0〜255の値。
         * @returns 先頭を0で補って2桁にした16進文字列。
         */
        (value) => value.toString(16).padStart(2, '0')).join('')}`;
}

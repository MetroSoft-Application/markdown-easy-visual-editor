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
  return `${Date.now().toString(36)}-${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
}

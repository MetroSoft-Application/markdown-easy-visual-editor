/**
 * @fileoverview 例外を利用者向け通知・ログに載せる文字列へ変換する、Extension Host と Webview で共通の関数。
 * 例外の種類に関わらず必ず文字列を返し、変換自体は例外を投げない。
 */

/**
 * 例外を説明文へ変換する。
 * @param error - catch で受け取った値。Error 以外（文字列・オブジェクトなど）も受け付ける。
 * @returns Error なら message、それ以外は String() で変換した文字列。String() が失敗する値は `[object Object]` 形式の型名。
 */
export function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    try {
        return String(error);
    } catch {
        // プロトタイプを持たないオブジェクトなどは文字列化できないため、型名だけを返して通知を続ける。
        return Object.prototype.toString.call(error);
    }
}

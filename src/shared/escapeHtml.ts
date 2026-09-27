/**
 * @fileoverview HTMLへ埋め込む文字列をエスケープし、属性値と本文での意図しない解釈を防ぐ。
 */
/**
 * escapehtmlの入力を許可された形式へ整える。
 * @param value - HTML本文または属性値へ挿入する前にエスケープする文字列。
 * @returns escapehtmlで利用する文字列。
 */
export function escapeHtml(value: string): string {
    return value.replace(
        /[&<>"']/g,

        /**
         * escapehtmlのコールバックとしてcharacterを処理する。
         * @param character - HTMLエスケープ表でエンティティへ置換する1文字。
         * @returns escapehtmlのコールバックが生成する結果。
         */
        (character) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[character]!,
    );
}

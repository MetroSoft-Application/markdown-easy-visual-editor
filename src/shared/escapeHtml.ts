/**
 * @fileoverview HTMLへ埋め込む文字列をエスケープし、属性値と本文での意図しない解釈を防ぐ。
 */
/**
 * escapehtmlの入力を許可された形式へ整える。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns escapehtmlで利用する文字列。
 */
export function escapeHtml(value: string): string {
    return value.replace(
        /[&<>"']/g,

        /**
         * escapehtmlのコールバックとしてcharacterを処理する。
         * @param character - escapehtmlへ渡す入力。
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

/**
 * @fileoverview Markdownプレビューを保存可能なHTMLへまとめ、設定値とリソース参照を出力へ反映する。
 */
/**
 * exporthtmlで使う値または実行環境を組み立てる。
 * @param html - 表示または出力するHTML本文。
 * @returns exporthtmlで利用する文字列。
 */
export function prepareExportHtml(html: string): string {
    const eagerImages = html.replace(/\sloading=(['"])lazy\1/gi, ' loading="eager"');
    return eagerImages.replace(
        /<div([^>]*?)\sdata-mve-export-svg="([^"]+)"([^>]*)><\/div>/gi,

        /**
         * ・matchをdecode・uricomponentへ渡し、exporthtmlの結果または副作用を処理する。
         * @param _match - exporthtmlへ渡す入力。
         * @param before - exporthtmlで受け渡す文字列。
         * @param encoded - exporthtmlで受け渡す文字列。
         * @param after - exporthtmlで受け渡す文字列。
         * @returns exporthtmlのコールバックが生成する結果。
         */
        (_match, before: string, encoded: string, after: string) => {
            try {
                return `<div${before}${after}>${decodeURIComponent(encoded)}</div>`;
            } catch {
                return `<div${before}${after}></div>`;
            }
        }
    );
}

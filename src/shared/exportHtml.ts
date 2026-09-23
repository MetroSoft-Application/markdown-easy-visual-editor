/**
 * @file exportHtml.ts
 * 実行境界: Extension HostとWebviewの共有層。
 * 責務: 両実行境界で共有する値、プロトコル、変換を扱う。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: 呼び出し元から渡された値を変換し、外部状態を直接変更しない。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
/**
 * HTMLを作成または組み立てます。
 * @param html 解析・編集・変換の対象となる本文または生成済み内容です。
 * @returns 「prepareExportHtml」が生成または変換した関連処理の文字列を返します。
 */
export function prepareExportHtml(html: string): string {
    const eagerImages = html.replace(/\sloading=(['"])lazy\1/gi, ' loading="eager"');
    return eagerImages.replace(
        /<div([^>]*?)\sdata-mve-export-svg="([^"]+)"([^>]*)><\/div>/gi,

        /**
 * 「_match」「before」「encoded」「after」を受け取り、処理結果を生成する処理です。
         * @param _match _matchとして渡される、このコールバックの入力値です。
         * @param before beforeとして渡される、このコールバックの入力値です。
         * @param encoded encodedとして渡される、このコールバックの入力値です。
         * @param after afterとして渡される、このコールバックの入力値です。
         * @returns 「_match」「before」「encoded」「after」から生成した処理結果を返します。
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

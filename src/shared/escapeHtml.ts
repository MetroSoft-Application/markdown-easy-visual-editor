/**
 * @file escapeHtml.ts
 * 実行境界: Extension HostとWebviewの共有層。
 * 責務: 両実行境界で共有する値、プロトコル、変換を扱う。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: 呼び出し元から渡された値を変換し、外部状態を直接変更しない。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
/**
 * HTML の本文へ挿入する文字列をエンティティへ変換する。
 * @param value 「escapeHtml」で検証・変換する入力値です。
 * @returns 「escapeHtml」が生成または変換した関連処理の文字列を返します。
 */
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,

    /**
 * 「character」からのオブジェクトを生成して返すコールバックです。
     * @param character HTMLまたはテキストから取り出した対象文字列です。
     * @returns 初期化したオブジェクトを返します。
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

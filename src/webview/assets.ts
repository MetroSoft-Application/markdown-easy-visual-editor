/**
 * @file assets.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
/**
 * Webview から配信されるビルド成果物の URL を解決する。
 * VS Code 上では Host が明示した URL を優先し、ブラウザテストでは
 * webview.js と同じディレクトリをフォールバックとして使う。
 * @param fileName 「fileName」は、「webviewAssetUrl」がWebview UI状態の処理対象を特定する入力です。
 * @param configuredUrl 「configuredUrl」は、「webviewAssetUrl」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「webviewAssetUrl」が生成または変換したWebview UIの文字列を返します。
 */
export function webviewAssetUrl(
  fileName: string,
  configuredUrl?: string,
): string {
  if (configuredUrl) return configuredUrl;
  const script = Array.from(document.scripts).find(
  /**
 * 「candidate」が検索条件に一致するか判定するコールバックです。
   * @param candidate candidateとして渡される、このコールバックの入力値です。
   * @returns 条件を満たすかどうかを示す真偽値を返します。
   */
  (candidate) =>
    /(?:^|\/)webview\.js(?:[?#]|$)/.test(candidate.src),
  );
  return new URL(fileName, script?.src || document.baseURI).toString();
}

/**
 * 遅延ロードする classic script に、Webview 本体と同じ CSP nonce を付ける。
 * @returns 「webviewScriptNonce」が生成または変換したWebview UIの文字列を返します。
 */
export function webviewScriptNonce(): string | undefined {
  const script = Array.from(document.scripts).find(
  /**
 * 「candidate」が検索条件に一致するか判定するコールバックです。
   * @param candidate candidateとして渡される、このコールバックの入力値です。
   * @returns 条件を満たすかどうかを示す真偽値を返します。
   */
  (candidate) =>
    /(?:^|\/)webview\.js(?:[?#]|$)/.test(candidate.src),
  );
  return script?.nonce || undefined;
}

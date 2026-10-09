/**
 * @fileoverview Webviewと出力HTMLが参照するローカルのスクリプト、スタイル、フォント資産のURIを構築する。
 */
/**
 * 設定済みURLまたはWebviewスクリプトの位置を基準に、資産URLを構築する。
 * @param fileName - URLへ追加する資産ファイル名。
 * @param configuredUrl - 明示設定されたURL。指定された場合はその値を返す。
 * @returns 資産ファイルの絶対URL。
 */
export function webviewAssetUrl(
    fileName: string,
    configuredUrl?: string,
): string {
    if (configuredUrl) return configuredUrl;
    const script = Array.from(document.scripts).find(
        /**
         * srcが条件に一致する最初のcandidateを取得する。
         * @param candidate - candidateのsrcを参照する走査対象。
         * @returns 条件に一致した最初の要素。未検出時はundefined。
         */
        (candidate) =>
            /(?:^|\/)webview\.js(?:[?#]|$)/.test(candidate.src),
    );
    return new URL(fileName, script?.src || document.baseURI).toString();
}

/**
 * 初期HTMLに埋め込まれたCSP nonceを取得する。
 * @returns meta要素のnonce値。nonceが見つからない場合はundefined。
 */
export function webviewScriptNonce(): string | undefined {
    const script = Array.from(document.scripts).find(
        /**
         * srcが条件に一致する最初のcandidateを取得する。
         * @param candidate - candidateのsrcを参照する走査対象。
         * @returns 条件に一致した最初の要素。未検出時はundefined。
         */
        (candidate) =>
            /(?:^|\/)webview\.js(?:[?#]|$)/.test(candidate.src),
    );
    return script?.nonce || undefined;
}

/**
 * @fileoverview Webviewのassetsを管理する。Hostとの通信、ユーザー操作、表示状態の契約を保つ。
 */
/**
 * assetsのwebview・asset・urlを処理し、呼び出し側へ結果または副作用を返す。
 * @param fileName - assetsで読み書きするリソースの場所。
 * @param configuredUrl - assetsへ渡す設定または境界値。
 * @returns assetsで利用する文字列。
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
 * assetsのwebview・script・nonceを処理し、呼び出し側へ結果または副作用を返す。
 * @returns 副作用を完了し、値は返さない。
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

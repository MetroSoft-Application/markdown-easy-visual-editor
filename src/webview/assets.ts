/**
 * Webview から配信されるビルド成果物の URL を解決する。
 * VS Code 上では Host が明示した URL を優先し、ブラウザテストでは
 * webview.js と同じディレクトリをフォールバックとして使う。
 */
export function webviewAssetUrl(
  fileName: string,
  configuredUrl?: string,
): string {
  if (configuredUrl) return configuredUrl;
  const script = Array.from(document.scripts).find((candidate) =>
    /(?:^|\/)webview\.js(?:[?#]|$)/.test(candidate.src),
  );
  return new URL(fileName, script?.src || document.baseURI).toString();
}

/** 遅延ロードする classic script に、Webview 本体と同じ CSP nonce を付ける。 */
export function webviewScriptNonce(): string | undefined {
  const script = Array.from(document.scripts).find((candidate) =>
    /(?:^|\/)webview\.js(?:[?#]|$)/.test(candidate.src),
  );
  return script?.nonce || undefined;
}

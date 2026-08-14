const WEBVIEW_RESOURCE_HOST = 'file+.vscode-resource.vscode-cdn.net';

export type ResourceLinkTarget =
  | { kind: 'localWebview'; path: string }
  | { kind: 'invalidLocalWebview' }
  | { kind: 'external'; href: string }
  | { kind: 'absoluteFile'; href: string }
  | { kind: 'relative'; href: string };

/** リンクを、ブラウザで開く外部URLとVS Codeで開くローカル参照に分類する。 */
export function classifyResourceLink(href: string): ResourceLinkTarget {
  const localWebviewPath = resolveWebviewResourcePath(href);
  if (localWebviewPath) return { kind: 'localWebview', path: localWebviewPath };
  if (isWebviewResourceUrl(href)) return { kind: 'invalidLocalWebview' };
  if (/^https?:/i.test(href)) return { kind: 'external', href };
  if (/^file:/i.test(href) || /^[A-Za-z]:[\\/]/.test(href) || /^\\\\/.test(href)) {
    return { kind: 'absoluteFile', href };
  }
  return { kind: 'relative', href };
}

function isWebviewResourceUrl(href: string): boolean {
  try {
    const url = new URL(href);
    return url.protocol === 'https:' && url.hostname === WEBVIEW_RESOURCE_HOST;
  } catch {
    return false;
  }
}

/** Webview が生成したローカルリソース URL を、VS Code で開くファイルパスへ戻す。 */
export function resolveWebviewResourcePath(href: string): string | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }

  if (url.protocol !== 'https:' || url.hostname !== WEBVIEW_RESOURCE_HOST) {
    return undefined;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return undefined;
  }

  if (!pathname) return undefined;

  // Windows のドライブレターを URL の先頭スラッシュから戻す。
  return pathname.replace(/^\/([A-Za-z]:[\\/])/, '$1');
}

/**
 * @file resourceLink.ts
 * 実行境界: Extension Host。
 * 責務: VS Code文書、Webview、外部リソースを連携する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: 文書、ファイル、Webview、ブラウザーなどの外部状態を必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
/** VS Code Webviewが安全なローカル資源として公開するURLのホスト名。許可判定を一箇所に固定する。 */
const WEBVIEW_RESOURCE_HOST = 'file+.vscode-resource.vscode-cdn.net';

/**
 * 「ResourceLinkTarget」として扱う値の型を定義します。
 */
export type ResourceLinkTarget =
    | {
    /**
     * 「kind」は、対象の識別や処理分岐に使用する値を保持します。
     */
    kind: 'localWebview';
    /**
     * 「path」は、読み込みまたは出力対象を示すパス・URL・内容を保持します。
     */
    path: string }
    | {
    /**
     * 「kind」は、対象の識別や処理分岐に使用する値を保持します。
     */
    kind: 'invalidLocalWebview' }
    | {
    /**
     * 「kind」は、対象の識別や処理分岐に使用する値を保持します。
     */
    kind: 'external';
    /**
     * 「href」は、対象の内容または識別子を表す文字列です。
     */
    href: string }
    | {
    /**
     * 「kind」は、対象の識別や処理分岐に使用する値を保持します。
     */
    kind: 'absoluteFile';
    /**
     * 「href」は、対象の内容または識別子を表す文字列です。
     */
    href: string }
    | {
    /**
     * 「kind」は、対象の識別や処理分岐に使用する値を保持します。
     */
    kind: 'relative';
    /**
     * 「href」は、対象の内容または識別子を表す文字列です。
     */
    href: string };

/**
 * リンクを、ブラウザで開く外部URLとVS Codeで開くローカル参照に分類する。
 * @param href 「href」は、「classifyResourceLink」がExtension Host処理の処理対象を特定する入力です。
 * @returns 「classifyResourceLink」がExtension Host処理の入力を処理して得た固有の結果を返します。
 */
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

/**
 * URLかどうかを判定します。
 * @param href 「href」は、「isWebviewResourceUrl」がExtension Host処理の処理対象を特定する入力です。
 * @returns 判定結果です。
 */
function isWebviewResourceUrl(href: string): boolean {
    try {
        const url = new URL(href);
        return url.protocol === 'https:' && url.hostname === WEBVIEW_RESOURCE_HOST;
    } catch {
        return false;
    }
}

/**
 * Webview が生成したローカルリソース URL を、VS Code で開くファイルパスへ戻す。
 * @param href 「href」は、「resolveWebviewResourcePath」がExtension Host処理の処理対象を特定する入力です。
 * @returns 「resolveWebviewResourcePath」が生成または変換したExtension Hostの文字列を返します。
 */
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

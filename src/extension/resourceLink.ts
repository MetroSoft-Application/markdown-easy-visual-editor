/**
 * @fileoverview ローカルリソースをWebviewから参照できるURIへ変換し、ワークスペース外の参照を拒否する。
 */
/**
 * Webviewからローカルリソースを参照するためのURIホスト。
 */
const WEBVIEW_RESOURCE_HOST = 'file+.vscode-resource.vscode-cdn.net';

/**
 * resourcelinkで扱う値の種類と境界を表す型。
 */
export type ResourceLinkTarget =
    | {
        /**
         * メッセージ、項目、または処理の種類を識別する値。
         */
        kind: 'localWebview';
        /**
         * 読み書きするファイルまたはリソースの場所。
         */
        path: string
    }
    | {
        /**
         * メッセージ、項目、または処理の種類を識別する値。
         */
        kind: 'invalidLocalWebview'
    }
    | {
        /**
         * メッセージ、項目、または処理の種類を識別する値。
         */
        kind: 'external';
        /**
         * リンク操作領域の遷移先URI。
         */
        href: string
    }
    | {
        /**
         * メッセージ、項目、または処理の種類を識別する値。
         */
        kind: 'absoluteFile';
        /**
         * リンク操作領域の遷移先URI。
         */
        href: string
    }
    | {
        /**
         * メッセージ、項目、または処理の種類を識別する値。
         */
        kind: 'relative';
        /**
         * リンク操作領域の遷移先URI。
         */
        href: string
    };

/**
 * resourcelinkのclassify・resource・linkを処理し、呼び出し側へ結果または副作用を返す。
 * @param href - リンク操作領域の遷移先URI。
 * @returns resourcelinkのclassify・resource・linkが生成する結果。
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
 * resourcelinkの条件を判定する。
 * @param href - リンク操作領域の遷移先URI。
 * @returns 条件が成立したかを示す真偽値。
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
 * resourcelinkから必要な値またはリソースを取得する。
 * @param href - リンク操作領域の遷移先URI。
 * @returns 条件に一致する値。未検出時はundefinedまたはnull。
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

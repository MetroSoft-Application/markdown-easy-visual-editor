/**
 * @fileoverview Extension Hostで出力済みHTMLを専用Webviewに表示し、HTML内リンクを処理する。
 * HTMLとリンク先はワークスペースFSから読み込み、初期フォルダー外やHTML以外への移動を拒否する。
 * 読み込み失敗時はパネルを破棄し、表示中のページに対する失敗は現在の内容を維持する。
 */
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

/** プレビュー内リンクからExtension Hostへ通知する遷移種別とhref。 */
type PreviewMessage = { type: 'navigate' | 'external'; href: string };

/**
 * 出力済みHTMLを専用Webviewで開き、初期フォルダー内のHTMLリンク遷移を処理する。
 * @param target 表示するHTMLファイルのURI。
 */
export async function openHtmlPreview(target: vscode.Uri): Promise<void> {
    const root = vscode.workspace.getWorkspaceFolder(target)?.uri
        ?? vscode.Uri.file(path.dirname(target.fsPath));
    const resourceRoots = [root, ...(vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? [])];
    const panel = vscode.window.createWebviewPanel(
        'markdownEasyVisualEditor.htmlPreview',
        path.basename(target.fsPath),
        vscode.ViewColumn.Active,
        { enableScripts: true, localResourceRoots: resourceRoots }
    );
    let current = target;

    /** HTMLをFSから読み、表示位置・タイトルを更新してフラグメント指定を含めWebviewへ設定する。失敗は呼び出し側へ返す。 */
    const display = async (uri: vscode.Uri, fragment = ''): Promise<void> => {
        const bytes = await vscode.workspace.fs.readFile(uri);
        current = uri;
        panel.title = path.basename(uri.fsPath);
        panel.webview.html = preparePreviewHtml(Buffer.from(bytes).toString('utf8'), panel.webview, uri, fragment);
    };

    panel.webview.onDidReceiveMessage((message: PreviewMessage) => {
        // リンク種別とパス境界を検証し、外部URLまたはルート内のHTMLだけを開く。
        void (async () => {
            if (!message || typeof message.href !== 'string') return;
            if (message.type === 'external') {
                await vscode.env.openExternal(vscode.Uri.parse(message.href));
                return;
            }
            if (message.type !== 'navigate') return;
            const hashIndex = message.href.indexOf('#');
            const rawPath = hashIndex < 0 ? message.href : message.href.slice(0, hashIndex);
            const queryIndex = rawPath.indexOf('?');
            const rawFilePath = queryIndex < 0 ? rawPath : rawPath.slice(0, queryIndex);
            const fragment = hashIndex < 0 ? '' : message.href.slice(hashIndex + 1);
            if (rawFilePath && /^[a-z][a-z\d+.-]*:/iu.test(rawFilePath)) return;
            let nextPath = current.fsPath;
            if (rawFilePath) {
                let decodedPath: string;
                try {
                    decodedPath = decodeURIComponent(rawFilePath);
                } catch {
                    return;
                }
                nextPath = path.resolve(path.dirname(current.fsPath), decodedPath);
            }
            if (!isWithin(root.fsPath, nextPath) || !/\.html?$/iu.test(nextPath)) return;
            try {
                await display(vscode.Uri.file(nextPath), fragment);
            } catch {
                // リンク先が存在しない場合は現在のページを維持する。
            }
        })();
    });

    try {
        await display(target);
    } catch (error) {
        panel.dispose();
        throw error;
    }
}

/**
 * CSP、ローカル参照用base URI、リンク通知処理をHTMLへ追加する。
 * @param html 出力されたHTML本文。
 * @param webview CSPとローカルリソースURIの生成に使うWebview。
 * @param uri 表示中HTMLのURI。隣接リソースの基準ディレクトリを決める。
 * @param fragment 初期表示でスクロールするURLフラグメント。
 * @returns CSPとリンク処理を組み込んだHTML。head/bodyがない断片は必要な要素で包む。
 */
export function preparePreviewHtml(html: string, webview: vscode.Webview, uri: vscode.Uri, fragment = ''): string {
    const nonce = randomBytes(16).toString('hex');
    const baseUri = webview.asWebviewUri(vscode.Uri.file(path.dirname(uri.fsPath))).toString().replace(/\/?$/u, '/');
    const csp = `default-src 'none'; object-src 'none'; form-action 'none'; base-uri ${webview.cspSource}; `
        + `img-src ${webview.cspSource} data: blob: http: https:; `
        + `font-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; `
        + `script-src 'nonce-${nonce}'`;
    const head = `<base href="${escapeAttribute(baseUri)}"><meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">`;
    const safeFragment = JSON.stringify(fragment).replace(/</gu, '\\u003c');
    const script = `<script nonce="${nonce}">(() => {
        const vscode = acquireVsCodeApi();
        const reveal = (hash) => {
            try { document.getElementById(decodeURIComponent(hash))?.scrollIntoView(); } catch { /* Ignore invalid fragments. */ }
        };
        document.addEventListener('click', (event) => {
            const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
            if (!anchor) return;
            const href = anchor.getAttribute('href');
            if (!href) return;
            event.preventDefault();
            if (href.startsWith('#')) { reveal(href.slice(1)); return; }
            const externalHref = href.startsWith('//') ? 'https:' + href : href;
            vscode.postMessage({ type: /^(?:https?:|mailto:|tel:)/i.test(externalHref) ? 'external' : 'navigate', href: externalHref });
        }, true);
        const fragment = ${safeFragment};
        if (fragment) requestAnimationFrame(() => reveal(fragment));
    })();</script>`;
    let preparedHtml = html;
    const headOpenPattern = /<head\b[^>]*>/iu;
    const htmlOpenPattern = /<html\b[^>]*>/iu;
    if (headOpenPattern.test(preparedHtml)) {
        preparedHtml = preparedHtml.replace(headOpenPattern, (match) => match + head);
    } else if (htmlOpenPattern.test(preparedHtml)) {
        preparedHtml = preparedHtml.replace(htmlOpenPattern, (match) => `${match}<head>${head}</head>`);
    } else {
        const doctypePattern = /^\s*<!doctype\b[^>]*>/iu;
        const doctype = doctypePattern.exec(preparedHtml)?.[0] ?? '';
        preparedHtml = `${doctype}<html><head>${head}</head><body>${preparedHtml.slice(doctype.length)}</body></html>`;
    }
    if (/<\/body\s*>/iu.test(preparedHtml)) {
        return preparedHtml.replace(/<\/body\s*>/iu, (match) => script + match);
    }
    if (/<\/html\s*>/iu.test(preparedHtml)) {
        return preparedHtml.replace(/<\/html\s*>/iu, (match) => script + match);
    }
    return preparedHtml + script;
}

/** 相対パスが親へ抜けず、絶対パスにもならない場合だけルート内と判定する。 */
function isWithin(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** 二重引用符で囲むHTML属性に挿入する値のアンパサンド、引用符、山括弧をエスケープする。 */
function escapeAttribute(value: string): string {
    return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;');
}

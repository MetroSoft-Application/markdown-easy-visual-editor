/**
 * @fileoverview リンク先補完とリンク自動更新が共有する、ワークスペース内ファイルの扱い（Extension Host）。
 * 大文字小文字の区別、候補・書き換えから除くフォルダー、サイズ上限付きの本文読込みを一か所で定める。
 * 副作用はファイルの読み取りだけで、書き込みはしない。
 */
import * as vscode from 'vscode';

/** 本文を読む文書の最大サイズ。巨大ファイルの読込みで補完やリンク更新が止まらないようにする。 */
export const MAX_WORKSPACE_TEXT_BYTES = 5 * 1024 * 1024;

/** 依存パッケージとバージョン管理の内部は、リンク先の候補にも書き換え対象にもしない。 */
const EXCLUDED_SEGMENT_PATTERN = /(?:^|\/)(?:node_modules|\.git)(?:\/|$)/u;

/**
 * URI のファイルシステムが大文字小文字を区別しないとみなすか判定する。
 * ローカルの file スキームだけを Windows・macOS の既定（区別しない）に合わせ、
 * Remote-SSH・WSL などリモートのファイルシステムは区別するものとして扱う。
 * @param uri - 判定するURI。
 * @returns 区別しないとみなす場合はtrue。
 */
export function pathIgnoreCase(uri: vscode.Uri): boolean {
    return uri.scheme === 'file' && (process.platform === 'win32' || process.platform === 'darwin');
}

/**
 * パスが除外フォルダー（node_modules・.git）の中にあるか判定する。
 * @param value - `/` 区切りのパス（絶対・相対のどちらでもよい）。
 * @returns 除外フォルダーの中ならtrue。
 */
export function isExcludedWorkspacePath(value: string): boolean {
    return EXCLUDED_SEGMENT_PATTERN.test(value);
}

/**
 * 文書の本文を読む。開いている文書は未保存の内容を優先する。
 * @param uri - 読む文書。
 * @returns UTF-8 として復号した本文。存在しない、読めない、サイズ上限を超える場合はundefined。
 */
export async function readWorkspaceText(uri: vscode.Uri): Promise<string | undefined> {
    const key = uri.toString();
    const open = vscode.workspace.textDocuments.find(
        /**
         * 同じURIの開いている文書か判定する。
         * @param document - 開いている文書。
         * @returns 同じURIならtrue。
         */
        (document) => document.uri.toString() === key);
    if (open) return open.getText();
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > MAX_WORKSPACE_TEXT_BYTES) return undefined;
        return new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
    } catch {
        // 読めないファイル（削除済み・権限なし）は候補・書き換えの対象外にする。
        return undefined;
    }
}

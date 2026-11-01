/**
 * @fileoverview Vitestから実Chromiumを起動するテストのために、導入済みのヘッドレス実行ファイルを探すテスト補助。
 * `npm run pdf:install-browser`が.chromium/へ導入したChromiumだけを対象にし、ファイルを変更しない。
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * 導入済みChromiumのヘッドレス実行ファイルを再帰的に探す。
 * @param root - Chromiumの導入先ディレクトリ。既定はリポジトリの.chromium/。
 * @returns 実行ファイルの絶対パス。導入先がない、または見つからない場合はundefined。
 */
export function findChromium(root = path.resolve('.chromium')): string | undefined {
    if (!existsSync(root)) return undefined;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const file = path.join(root, entry.name);
        if (entry.isFile() && entry.name === 'chrome-headless-shell.exe') return file;
        if (entry.isDirectory()) {
            const found = findChromium(file);
            if (found) return found;
        }
    }
    return undefined;
}

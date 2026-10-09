/**
 * @fileoverview 画像ディレクトリ設定を検証し、文書位置から相対参照と保存先を解決する。
 */
/**
 * 画像保存先規則から絶対パス、未知の置換子、親ディレクトリ参照を除き、利用可能な相対規則へ正規化する。
 * @param value - 画像保存先として正規化するユーザー指定のディレクトリ規則。
 * @returns 利用できる相対規則。不正な入力または空の規則はundefined。
 */
export function normalizeImageDirectoryRule(value: string): string | undefined {
    const trimmed = value.trim();
    if (!trimmed || trimmed.includes('\0') || /[\u0000-\u001f]/.test(trimmed)) return undefined;
    if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(trimmed)) return undefined;

    const forwardSlash = trimmed.replace(/\\/g, '/');
    if (forwardSlash.startsWith('/') || /^\$\{(?!documentBasename\})/.test(forwardSlash)) return undefined;
    if (/\$\{(?!documentBasename\})[^}]*\}/.test(forwardSlash)) return undefined;

    const segments = forwardSlash.split('/').filter(
        /**
         * 条件を満たすsegmentだけを残す。
         * @param segment - 画像保存先規則を分割したパス要素（空文字と`.`を除外）。

         */
        (segment) => segment !== '' && segment !== '.');
    if (segments.some(
        /**
         * 親ディレクトリへ遡るパス要素が含まれるかを調べる。
         * @param segment - 親ディレクトリへ遡る`..`パス要素かを検査する文字列。
         * @returns `..`セグメントの場合はtrue。
         */
        (segment) => segment === '..')) return undefined;
    if (!segments.length) return forwardSlash.replace(/\/+$/g, '') === '.' ? '.' : undefined;
    return segments.join('/');
}

/**
 * 画像保存先規則を正規化し、文書名プレースホルダーを実名へ置き換える。
 * @param value - 文書名置換を含む画像保存先ディレクトリ規則。
 * @param documentBasename - 画像保存先規則の`${documentBasename}`へ挿入する文書名。
 * @returns 正規化して置換した相対パス。規則が空または無効ならundefined。
 */
export function resolveImageDirectoryRule(value: string, documentBasename: string): string | undefined {
    const normalized = normalizeImageDirectoryRule(value);
    if (!normalized) return undefined;
    return normalized.replace(/\$\{documentBasename\}/g, documentBasename);
}

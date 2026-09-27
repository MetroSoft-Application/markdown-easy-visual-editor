/**
 * @fileoverview 画像ディレクトリ設定を検証し、文書位置から相対参照と保存先を解決する。
 */
/**
 * imagedirectoryの入力を許可された形式へ整える。
 * @param value - 画像保存先として正規化するユーザー指定のディレクトリ規則。
 * @returns 副作用を完了し、値は返さない。
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
         * @returns 条件を満たした要素だけを含む一覧。
         */
        (segment) => segment !== '' && segment !== '.');
    if (segments.some(
        /**
         * imagedirectoryのコールバックとしてsegmentを処理する。
         * @param segment - 親ディレクトリへ遡る`..`パス要素かを検査する文字列。
         * @returns 副作用を完了し、値は返さない。
         */
        (segment) => segment === '..')) return undefined;
    if (!segments.length) return forwardSlash.replace(/\/+$/g, '') === '.' ? '.' : undefined;
    return segments.join('/');
}

/**
 * imagedirectoryから必要な値またはリソースを取得する。
 * @param value - 文書名置換を含む画像保存先ディレクトリ規則。
 * @param documentBasename - 画像保存先規則の`${documentBasename}`へ挿入する文書名。
 * @returns 条件に一致する値。未検出時はundefinedまたはnull。
 */
export function resolveImageDirectoryRule(value: string, documentBasename: string): string | undefined {
    const normalized = normalizeImageDirectoryRule(value);
    if (!normalized) return undefined;
    return normalized.replace(/\$\{documentBasename\}/g, documentBasename);
}

/**
 * @fileoverview 画像ディレクトリ設定を検証し、文書位置から相対参照と保存先を解決する。
 */
/**
 * imagedirectoryの入力を許可された形式へ整える。
 * @param value - 検証・変換・保存の対象となる値。
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
         * @param segment - imagedirectoryへ渡す入力。
         * @returns 条件を満たした要素だけを含む一覧。
         */
        (segment) => segment !== '' && segment !== '.');
    if (segments.some(
        /**
         * imagedirectoryのコールバックとしてsegmentを処理する。
         * @param segment - imagedirectoryへ渡す入力。
         * @returns 副作用を完了し、値は返さない。
         */
        (segment) => segment === '..')) return undefined;
    if (!segments.length) return forwardSlash.replace(/\/+$/g, '') === '.' ? '.' : undefined;
    return segments.join('/');
}

/**
 * imagedirectoryから必要な値またはリソースを取得する。
 * @param value - 検証・変換・保存の対象となる値。
 * @param documentBasename - imagedirectoryの対象や分岐を識別する値。
 * @returns 条件に一致する値。未検出時はundefinedまたはnull。
 */
export function resolveImageDirectoryRule(value: string, documentBasename: string): string | undefined {
    const normalized = normalizeImageDirectoryRule(value);
    if (!normalized) return undefined;
    return normalized.replace(/\$\{documentBasename\}/g, documentBasename);
}

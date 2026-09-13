/**
 * 画像保存先ルールを、Markdown文書からの安全な相対パスへ正規化する。
 * `.` はMarkdown文書と同じフォルダーを表す。
 */
export function normalizeImageDirectoryRule(value: string): string | undefined {
    const trimmed = value.trim();
    if (!trimmed || trimmed.includes('\0') || /[\u0000-\u001f]/.test(trimmed)) return undefined;
    if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(trimmed)) return undefined;

    const forwardSlash = trimmed.replace(/\\/g, '/');
    if (forwardSlash.startsWith('/') || /^\$\{(?!documentBasename\})/.test(forwardSlash)) return undefined;
    if (/\$\{(?!documentBasename\})[^}]*\}/.test(forwardSlash)) return undefined;

    const segments = forwardSlash.split('/').filter((segment) => segment !== '' && segment !== '.');
    if (segments.some((segment) => segment === '..')) return undefined;
    if (!segments.length) return forwardSlash.replace(/\/+$/g, '') === '.' ? '.' : undefined;
    return segments.join('/');
}

/** 画像保存先ルール内の文書名プレースホルダーを展開する。 */
export function resolveImageDirectoryRule(value: string, documentBasename: string): string | undefined {
    const normalized = normalizeImageDirectoryRule(value);
    if (!normalized) return undefined;
    return normalized.replace(/\$\{documentBasename\}/g, documentBasename);
}

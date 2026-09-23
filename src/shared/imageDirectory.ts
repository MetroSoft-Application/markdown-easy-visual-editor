/**
 * @file imageDirectory.ts
 * 実行境界: Extension HostとWebviewの共有層。
 * 責務: 両実行境界で共有する値、プロトコル、変換を扱う。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: 呼び出し元から渡された値を変換し、外部状態を直接変更しない。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
/**
 * 画像保存先ルールを、Markdown文書からの安全な相対パスへ正規化する。
 * `.` はMarkdown文書と同じフォルダーを表す。
 * @param value 「normalizeImageDirectoryRule」で検証・変換する入力値です。
 * @returns 「normalizeImageDirectoryRule」が生成または変換した画像の文字列を返します。
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
 * 「segment」が条件に一致するか判定し、残す要素を決めるコールバックです。
     * @param segment segmentとして渡される、このコールバックの入力値です。
     * @returns 要素を採用するかどうかの真偽値を返します。
     */
    (segment) => segment !== '' && segment !== '.');
    if (segments.some(
    /**
 * 「segment」が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
     * @param segment segmentとして渡される、このコールバックの入力値です。
     * @returns 要素を採用するかどうかの真偽値を返します。
     */
    (segment) => segment === '..')) return undefined;
    if (!segments.length) return forwardSlash.replace(/\/+$/g, '') === '.' ? '.' : undefined;
    return segments.join('/');
}

/**
 * 画像保存先ルール内の文書名プレースホルダーを展開する。
 * @param value 「resolveImageDirectoryRule」で検証・変換する入力値です。
 * @param documentBasename 「documentBasename」は、「resolveImageDirectoryRule」が画像表示・保存の処理対象を特定する入力です。
 * @returns 「resolveImageDirectoryRule」が生成または変換した画像の文字列を返します。
 */
export function resolveImageDirectoryRule(value: string, documentBasename: string): string | undefined {
    const normalized = normalizeImageDirectoryRule(value);
    if (!normalized) return undefined;
    return normalized.replace(/\$\{documentBasename\}/g, documentBasename);
}

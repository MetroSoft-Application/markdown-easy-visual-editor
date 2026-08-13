/** ローカル参照からフラグメント・クエリ・URLエンコードを取り除く。 */
export function decodeLocalResourceSource(source: string): string {
  const withoutAnchor = source.split('#', 1)[0].trim();
  const queryStart = withoutAnchor.indexOf('?');
  const withoutQuery = queryStart >= 0 ? withoutAnchor.slice(0, queryStart) : withoutAnchor;
  try {
    return decodeURIComponent(withoutQuery);
  } catch {
    return withoutQuery;
  }
}

/** ファイルが存在しないエラーか、検査自体に失敗したエラーかを判定する。 */
export function isMissingResourceError(error: unknown): boolean {
  const errorCode = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : '';
  return errorCode === 'FileNotFound'
    || errorCode === 'ENOENT'
    || (error instanceof Error && /not found|enoent/i.test(error.message));
}

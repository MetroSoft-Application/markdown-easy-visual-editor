/**
 * @file resourceCheck.ts
 * 実行境界: Extension Host。
 * 責務: VS Code文書、Webview、外部リソースを連携する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: 文書、ファイル、Webview、ブラウザーなどの外部状態を必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
/**
 * ローカル参照からフラグメント・クエリ・URLエンコードを取り除く。
 * @param source 処理対象のソースです。
 * @returns 「decodeLocalResourceSource」が生成または変換したExtension Hostの文字列を返します。
 */
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

/**
 * ファイルが存在しないエラーか、検査自体に失敗したエラーかを判定する。
 * @param error 発生したエラーです。
 * @returns 判定結果です。
 */
export function isMissingResourceError(error: unknown): boolean {
    const errorCode = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : '';
    return errorCode === 'FileNotFound'
        || errorCode === 'ENOENT'
        || (error instanceof Error && /not found|enoent/i.test(error.message));
}

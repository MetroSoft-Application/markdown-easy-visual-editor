/**
 * @file mermaidSvg.ts
 * 実行境界: Extension HostとWebviewの共有層。
 * 責務: 両実行境界で共有する値、プロトコル、変換を扱う。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: 呼び出し元から渡された値を変換し、外部状態を直接変更しない。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
/**
 * キャッシュ済みSVGを複数回インライン挿入しても参照IDが衝突しないよう名前空間化する。
 * id本体、URL参照、href、CSS IDセレクター、ARIAの空白区切り参照を同時に更新する。
 * @param svg 「svg」は、「namespaceMermaidSvg」がMermaid描画の処理対象を特定する入力です。
 * @param namespace 「namespace」は、「namespaceMermaidSvg」がMermaid描画の処理対象を特定する入力です。
 * @returns 「namespaceMermaidSvg」が生成または変換したMermaidの文字列を返します。
 */
export function namespaceMermaidSvg(svg: string, namespace: string): string {
    const safeNamespace = namespace.replace(/[^a-zA-Z0-9_-]/g, '-');
    const ids = [...svg.matchAll(/\bid=(['"])([^'"]+)\1/g)].map(
    /**
 * 「match」を変換し、変換後の要素を返すコールバックです。
     * @param match matchとして渡される、このコールバックの入力値です。
     * @returns 置換後の文字列を返します。
     */
    (match) => match[2]);
    let result = svg;
    for (const id of [...new Set(ids)].sort(
    /**
 * 「left」「right」を比較し、並び順を示す数値を返すコールバックです。
     * @param left 比較対象の左側の値です。
     * @param right 比較対象の右側の値です。
     * @returns 置換後の文字列を返します。
     */
    (left, right) => right.length - left.length)) {
        const escaped = escapeRegExp(id);
        const replacement = `${safeNamespace}-${id}`;
        result = result.replace(new RegExp(`(\\bid=(['"]))${escaped}\\2`, 'g'), `$1${replacement}$2`);
        result = result.replace(new RegExp(`#${escaped}(?![\\w:.-])`, 'g'), `#${replacement}`);
        result = result.replace(
            new RegExp(`((?:aria-labelledby|aria-describedby)=(['"])[^'"]*)\\b${escaped}\\b`, 'g'),
            `$1${replacement}`
        );
    }
    return result;
}

/**
 * escape・reg・expを安全な形式へ変換します。
 * @param value 「escapeRegExp」で検証・変換する入力値です。
 * @returns 「escapeRegExp」が生成または変換したMermaidの文字列を返します。
 */
function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @fileoverview Mermaidが生成したSVGを検証し、画像領域・リンク領域・アクセシビリティ情報を抽出する。
 */
/**
 * mermaidsvgのnamespace・mermaid・svgを処理し、呼び出し側へ結果または副作用を返す。
 * @param svg - Mermaidが生成したSVG本文。
 * @param namespace - mermaidsvgの対象や分岐を識別する値。
 * @returns mermaidsvgで利用する文字列。
 */
export function namespaceMermaidSvg(svg: string, namespace: string): string {
    const safeNamespace = namespace.replace(/[^a-zA-Z0-9_-]/g, '-');
    const ids = [...svg.matchAll(/\bid=(['"])([^'"]+)\1/g)].map(
        /**
         * 各matchを変換して一覧化する。
         * @param match - mermaidsvgへ渡す入力。
         * @returns 入力要素から生成した変換結果の一覧。
         */
        (match) => match[2]);
    let result = svg;
    for (const id of [...new Set(ids)].sort(
        /**
         * 2つの値を比較して並び順を決める。
         * @param left - 比較対象の左側の値。
         * @param right - 比較対象の右側の値。
         * @returns 2つの要素の順序を示す数値。
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
 * mermaidsvgの入力を許可された形式へ整える。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns mermaidsvgで利用する文字列。
 */
function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

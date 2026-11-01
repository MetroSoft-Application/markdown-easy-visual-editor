/**
 * @fileoverview Mermaidが生成したSVGを検証し、画像領域・リンク領域・アクセシビリティ情報を抽出する。
 */
/**
 * Mermaid SVG内のIDと参照先へ固有の接頭辞を付け、同一文書内のID重複を防ぐ。
 * @param svg - Mermaidが生成したSVG本文。
 * @param namespace - 生成するSVG IDへ付ける固有の接頭辞。
 * @returns ID参照とARIA参照も接頭辞に合わせて更新したSVG。
 */
export function namespaceMermaidSvg(svg: string, namespace: string): string {
    const safeNamespace = namespace.replace(/[^a-zA-Z0-9_-]/g, '-');
    const ids = new Set([...svg.matchAll(/\bid=(['"])([^'"]+)\1/g)].map(
        /**
         * id属性の値を取り出す（data-id なども旧実装と同じく対象に含む）。
         * @param match - SVGのid属性に一致した正規表現結果。match[2]がid値。
         * @returns id値。
         */
        (match) => match[2]));
    if (!ids.size) return svg;
    // #参照の1パス置換は、IDが [\w:.-] だけで構成される場合に「#ID の直後が [\w:.-] でない」という旧実装の条件と一致する。
    // それ以外の文字を含むIDがある場合と、aria属性値に # を含む場合（旧実装ではIDごとに #参照とaria置換が交互に効く）は、
    // 旧実装の逐次置換で同じ結果を保つ。どちらもPeleの出力には現れない。
    if (/(?:aria-labelledby|aria-describedby)=(['"])[^'"]*#/.test(svg) || [...ids].some(
        /**
         * 1パス置換で扱えない文字を含むIDかを判定する。
         * @param id - 判定するID。
         * @returns 扱えない場合はtrue。
         */
        (id) => !/^[\w:.-]+$/.test(id))) {
        return namespaceMermaidSvgSequentially(svg, safeNamespace, ids);
    }
    // id属性と#参照は、ID数に依存せずSVG全体を1回ずつ走査して置換する（巨大な図でもExtension Hostを長く止めない）。
    let result = svg.replace(/\bid=(['"])([^'"]+)\1/g,
        /**
         * 名前空間化の対象IDだけ接頭辞を付ける。
         * @param match - 一致したid属性全体。
         * @param quote - 属性値の引用符。
         * @param id - 属性値。
         * @returns 置換後のid属性。
         */
        (match: string, quote: string, id: string) => ids.has(id) ? `id=${quote}${safeNamespace}-${id}${quote}` : match);
    result = result.replace(/#([\w:.-]+)/g,
        /**
         * 直後に [\w:.-] が続かない #ID だけを置換する（正規表現の最長一致で直後の条件を満たす）。
         * @param match - 一致した#参照全体。
         * @param id - #の後ろの識別子。
         * @returns 置換後の#参照。
         */
        (match: string, id: string) => ids.has(id) ? `#${safeNamespace}-${id}` : match);
    // aria参照は1つのSVGに数個しかないため、属性値の中だけで旧実装と同じ規則（長いIDから順に、各属性で最後の出現を置換）を適用する。
    // 属性値に # を含まないことは上で確認済みのため、#参照の置換と順序が入れ替わっても結果は変わらない。
    const sortedIds = sortByLengthDescending(ids);
    return result.replace(/((?:aria-labelledby|aria-describedby)=(['"]))([^'"]*)/g,
        /**
         * aria属性値のID参照へ接頭辞を付ける。
         * @param _match - 一致した属性全体。
         * @param prefix - 属性名と開き引用符。
         * @param _quote - 開き引用符。
         * @param value - 属性値。
         * @returns 置換後の属性。
         */
        (_match: string, prefix: string, _quote: string, value: string) => {
            let updated = value;
            for (const id of sortedIds) {
                if (!updated.includes(id)) continue;
                updated = updated.replace(new RegExp(`^([\\s\\S]*)\\b${escapeRegExp(id)}\\b`), `$1${safeNamespace}-${id}`);
            }
            return prefix + updated;
        });
}

/**
 * IDを長い順に並べる。同じ長さはSVG内の出現順を保つ。
 * @param ids - 並べるID。
 * @returns 長い順のID一覧。
 */
function sortByLengthDescending(ids: Set<string>): string[] {
    return [...ids].sort(
        /**
         * 2つの値を比較して並び順を決める。
         * @param left - 比較対象の左側の値。
         * @param right - 比較対象の右側の値。
         * @returns 2つの要素の順序を示す数値。
         */
        (left, right) => right.length - left.length);
}

/**
 * IDごとにSVG全体を置換する従来の方式。1パス置換で扱えない文字を含むIDがある場合だけ使う（計算量はID数×SVG長）。
 * @param svg - 名前空間化するSVG。
 * @param safeNamespace - 正規化済みの接頭辞。
 * @param ids - SVG内のID。
 * @returns 名前空間化したSVG。
 */
function namespaceMermaidSvgSequentially(svg: string, safeNamespace: string, ids: Set<string>): string {
    let result = svg;
    for (const id of [...ids].sort(
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
 * 正規表現のメタ文字をリテラルとして扱えるようにエスケープする。
 * @param value - 正規表現へ埋め込むためにエスケープする文字列。

 */
function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

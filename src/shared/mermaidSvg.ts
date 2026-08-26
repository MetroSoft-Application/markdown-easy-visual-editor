/**
 * キャッシュ済みSVGを複数回インライン挿入しても参照IDが衝突しないよう名前空間化する。
 * id本体、URL参照、href、CSS IDセレクター、ARIAの空白区切り参照を同時に更新する。
 */
export function namespaceMermaidSvg(svg: string, namespace: string): string {
  const safeNamespace = namespace.replace(/[^a-zA-Z0-9_-]/g, '-');
  const ids = [...svg.matchAll(/\bid=(['"])([^'"]+)\1/g)].map((match) => match[2]);
  let result = svg;
  for (const id of [...new Set(ids)].sort((left, right) => right.length - left.length)) {
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

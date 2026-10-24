/**
 * @fileoverview HTML/PDF出力用のMermaid SVGをDOMへ適用し、巨大SVGの遅延格納属性が旧描画結果を残さないようにする。
 */

/** 80KB未満はインライン化し、それ以上は属性へ格納して大きなSVGの二重DOM挿入を避ける境界。 */
const MERMAID_EXPORT_SVG_INLINE_LIMIT = 80_000;

/**
 * 出力用Mermaid SVGをインライン化または遅延格納し、以前のSVG属性を置き換える。
 * @param node - Mermaid出力DOMブロック。
 * @param svg - 現在の文字サイズとテーマで完成したSVG文字列。
 * @param external - Host側レンダラーがSVGを別リソースとして返した場合true。
 * @returns DOMへインラインSVGを設定した場合true。巨大SVGを属性へ保管した場合false。
 */
export function applyMermaidExportMarkup(
  node: HTMLElement,
  svg: string,
  external: boolean,
): boolean {
  if (external && svg.length >= MERMAID_EXPORT_SVG_INLINE_LIMIT) {
    node.replaceChildren();
    node.dataset.mveExportSvg = encodeURIComponent(svg);
    return false;
  }

  // DOM差分が保持した旧サイズの属性は、インライン出力が確定した時点で破棄する。
  delete node.dataset.mveExportSvg;
  node.innerHTML = svg;
  return true;
}

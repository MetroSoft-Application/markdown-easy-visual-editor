/**
 * @fileoverview クリップボードのプレーンテキストをSVG文書として安全に受け入れられる形へ検証する。
 */

/**
 * クリップボード文字列が単一のSVG文書なら前後空白を除いた本文を返す。
 *
 * XML宣言、先頭コメント、SVG用DOCTYPEは許可するが、SVGの前後に別のHTMLや
 * 任意テキストが混在する場合は画像ファイルとして保存しない。
 * @param value - クリップボードから取得したプレーンテキスト。
 * @returns 保存候補となるSVG文字列。不正またはSVG以外ならundefined。
 */
export function normalizeSvgClipboardText(value: string): string | undefined {
  const trimmed = value.replace(/^\uFEFF/, "").trim();
  if (!trimmed || trimmed.includes("\0")) return undefined;

  let body = trimmed;
  const xml = /^<\?xml\b[\s\S]*?\?>\s*/i.exec(body);
  if (xml) body = body.slice(xml[0].length);

  // XML宣言後のコメントはSVG生成ツールが付与することがあるため許可する。
  for (;;) {
    const comment = /^<!--[\s\S]*?-->\s*/.exec(body);
    if (!comment) break;
    body = body.slice(comment[0].length);
  }

  const doctype = /^<!DOCTYPE\s+svg\b[\s\S]*?>\s*/i.exec(body);
  if (doctype) body = body.slice(doctype[0].length);

  body = body.trim();
  if (!/^<svg(?:\s|>)/i.test(body)) return undefined;

  // 通常のSVG文書と空の自己終了SVGの両方を受け入れる。
  if (/^<svg(?:\s|>)[\s\S]*<\/svg\s*>$/i.test(body)) return trimmed;
  if (/^<svg\b[^>]*\/\>$/i.test(body)) return trimmed;
  return undefined;
}

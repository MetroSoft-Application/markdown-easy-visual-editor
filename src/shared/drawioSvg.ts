/**
 * @fileoverview draw.ioで再編集可能な最小の図を、単独で表示できるSVGとして生成する。
 *
 * draw.ioの*.drawio.svgはルートsvg要素のcontent属性にmxfile XMLを
 * XML属性エスケープして保持する。表示用の図形とmxGraphModelを同じ座標で定義する。
 */

/** 新規図の標準ファイル拡張子。 */
export const DRAWIO_SVG_EXTENSION = ".drawio.svg";

/** Markdown画像の代替テキスト。 */
export const DRAWIO_IMAGE_ALT = "draw.io";

/** 編集可能なdraw.ioモデル。content属性へ書き込む前のXML形式。 */
const DRAWIO_MODEL = [
  '<mxfile host="app.diagrams.net" compressed="false">',
  '<diagram id="mve-diagram" name="Page-1">',
  '<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" ',
  'tooltips="1" connect="1" arrows="1" fold="1" page="1" ',
  'pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">',
  '<root>',
  '<mxCell id="0"/>',
  '<mxCell id="1" parent="0"/>',
  '<mxCell id="2" value="draw.io" ',
  'style="rounded=1;arcSize=12;whiteSpace=wrap;html=0;align=center;verticalAlign=middle;',
  'fillColor=#e8f0fe;strokeColor=#1a73e8;fontColor=#174ea6;fontSize=20;" ',
  'vertex="1" parent="1">',
  '<mxGeometry x="40" y="40" width="240" height="80" as="geometry"/>',
  '</mxCell>',
  '</root>',
  '</mxGraphModel>',
  '</diagram>',
  '</mxfile>',
].join("");

/**
 * XMLをSVG属性値へ埋め込めるようにエスケープする。
 * @param value - mxfile XML。
 * @returns XML属性として安全な文字列。
 */
function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * 描画と編集用データを両方持つ、外部リソース不要のダミーSVGを生成する。
 * @returns XMLとして妥当で、draw.ioの図データを含むSVG文書。
 */
export function createDrawioPlaceholderSvg(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"',
    ' viewBox="0 0 320 160" role="img" aria-label="draw.io"',
    ` content="${escapeXmlAttribute(DRAWIO_MODEL)}">`,
    '<title>draw.io</title>',
    '<rect x="0.5" y="0.5" width="319" height="159" fill="#fff" stroke="#d0d7de"/>',
    '<rect x="40" y="40" width="240" height="80" rx="12"',
    ' fill="#e8f0fe" stroke="#1a73e8" stroke-width="2"/>',
    '<text x="160" y="87" text-anchor="middle" font-family="Arial, sans-serif"',
    ' font-size="20" fill="#174ea6">draw.io</text>',
    '</svg>',
    '',
  ].join("\n");
}

/**
 * 文書フォルダーを基準とするパスの各区間をMarkdown URL向けにエンコードする。
 * 空白、#、?、日本語を含む画像保存先を壊さず、相対階層は維持する。
 * @param relativePath - 保存先までの相対パス。
 * @returns Markdown画像記法で使用できる相対URL。
 */
export function encodeDrawioRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").split("/").map((segment) =>
    segment === "." || segment === ".." ? segment : encodeURIComponent(segment)
  ).join("/");
}

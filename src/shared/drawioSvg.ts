/**
 * @fileoverview draw.ioで再編集可能な最小の図を、単独で表示できるSVGとして生成する。
 *
 * draw.ioの*.drawio.svgはルートsvg要素のcontent属性にmxfile XMLを
 * XML属性エスケープして保持する。表示用の図形とmxGraphModelを同じ座標で定義する。
 * 実行境界はshared（Extension HostとWebviewの両方）で、ファイルI/OやDOMには触れない。
 * 新規SVGの生成、Markdownへ挿入するリンク付き画像記法、draw.io参照の判定を担う。
 */

/** 新規図の標準ファイル拡張子。 */
export const DRAWIO_SVG_EXTENSION = ".drawio.svg";

/** Markdown画像の代替テキスト。Markdownの角括弧と衝突しない固定値のため追加のエスケープは不要。 */
export const DRAWIO_IMAGE_ALT = "draw.io";

/**
 * 編集可能なdraw.ioモデル。content属性へ書き込む前のXML形式。
 * 本文中で目立たないよう、小さめの淡いグレーの角丸四角形1つだけを置く。
 * 図形の寸法・色は下の表示用SVGと一致させる（初回保存前の見た目とdraw.io上の見た目をそろえる）。
 * 位置だけはdraw.ioの編集画面で用紙の端に貼り付かないよう (40, 40) に置く。
 * draw.ioは保存時に図形の範囲でSVGを切り出すため、この余白は保存後の画像には含まれない。
 */
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
  'style="rounded=1;arcSize=10;whiteSpace=wrap;html=0;align=center;verticalAlign=middle;',
  'fillColor=#fafafa;strokeColor=#c8c8c8;fontColor=#8a8a8a;fontSize=12;" ',
  'vertex="1" parent="1">',
  '<mxGeometry x="40" y="40" width="160" height="48" as="geometry"/>',
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
 * 本文の流れを妨げない控えめな見た目（161×49px、淡いグレーの枠と文字）にする。
 * 線幅1pxが画素境界でにじまないよう、図形を0.5pxずらして描く。
 * @returns XMLとして妥当で、draw.ioの図データを含むSVG文書。
 */
export function createDrawioPlaceholderSvg(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="161" height="49"',
    ' viewBox="-0.5 -0.5 161 49" role="img" aria-label="draw.io"',
    ` content="${escapeXmlAttribute(DRAWIO_MODEL)}">`,
    '<title>draw.io</title>',
    '<rect x="0" y="0" width="160" height="48" rx="4.8"',
    ' fill="#fafafa" stroke="#c8c8c8" stroke-width="1"/>',
    '<text x="80" y="28" text-anchor="middle" font-family="Arial, sans-serif"',
    ' font-size="12" fill="#8a8a8a">draw.io</text>',
    '</svg>',
    '',
  ].join("\n");
}

/**
 * Markdownのリンク先を途中で終わらせる、またはURLとして別解釈される文字。
 * 空白類（全角空白を含む）、`%`、`#`、`?`、括弧、山括弧、角括弧、バックスラッシュ、制御文字が対象。
 * 日本語などの非ASCII文字は既存の画像挿入と同じく読みやすさを優先して生のまま残す。
 */
const MARKDOWN_UNSAFE_PATH_CHARACTER = /[\s%#?()<>[\]\\\u0000-\u001f\u007f]/gu;

/**
 * 1文字をUTF-8バイト列の%エスケープへ変換する。
 * encodeURIComponentは括弧を変換しないため、Markdown記法と衝突する文字も確実に変換する。
 * @param character - エスケープ対象の1文字。
 * @returns `%XX` を連結した文字列。
 */
function percentEncodeCharacter(character: string): string {
  return Array.from(new TextEncoder().encode(character), (byte) =>
    `%${byte.toString(16).toUpperCase().padStart(2, "0")}`
  ).join("");
}

/**
 * 文書フォルダーを基準とするパスの各区間をMarkdownのリンク先として安全な形へ整える。
 * Windows区切りは `/` に統一し、`.` と `..` は階層指定として維持する。
 * Markdownを壊す文字だけを%エスケープし、日本語は生のまま残す。
 * プレビューとHostは `decodeURIComponent` で元のパスへ戻すため、`%` 自体も必ずエスケープする。
 * @param relativePath - 保存先までの相対パス。
 * @returns Markdown画像記法とリンク記法の両方で使用できる相対URL。
 */
export function encodeDrawioRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").split("/").map((segment) =>
    segment === "." || segment === ".."
      ? segment
      : segment.replace(MARKDOWN_UNSAFE_PATH_CHARACTER, percentEncodeCharacter)
  ).join("/");
}

/**
 * draw.io拡張機能が編集対象として扱うSVGファイル名の判定式。
 * hediet.vscode-drawio の `*.drawio.svg` と `*.dio.svg` に合わせる。
 */
const DRAWIO_SVG_REFERENCE = /\.(?:drawio|dio)\.svg$/i;

/**
 * Markdownのリンク先、またはURIのパスがdraw.ioで編集可能なSVGかを判定する。
 * クエリとフラグメントは無視し、%エスケープされた拡張子も復号して判定する。
 * 不正な%エスケープは復号せずにそのまま判定し、例外を送出しない。
 * @param reference - Markdownのhref、画像src、またはURIのパス。
 * @returns `.drawio.svg` または `.dio.svg` で終わる場合はtrue。
 */
export function isDrawioSvgReference(reference: string): boolean {
  const withoutFragment = reference.split("#", 1)[0];
  const pathPart = withoutFragment.split("?", 1)[0].trim();
  let decoded = pathPart;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    // 不正な%エスケープを含む参照も、元の文字列のまま拡張子を判定する。
  }
  return DRAWIO_SVG_REFERENCE.test(decoded);
}

/**
 * プレビューには画像を表示し、クリック時はdraw.io編集を開くリンク付き画像記法を作る。
 * 画像とリンクに同じ相対パスを使うため、GitHubなど他のMarkdown表示でもSVG自体へ遷移できる。
 * @param markdownPath - {@link encodeDrawioRelativePath} でエンコード済みの相対パス。
 * @returns `[![draw.io](path)](path)` 形式のMarkdown。
 */
export function drawioImageMarkdown(markdownPath: string): string {
  return `[![${DRAWIO_IMAGE_ALT}](${markdownPath})](${markdownPath})`;
}

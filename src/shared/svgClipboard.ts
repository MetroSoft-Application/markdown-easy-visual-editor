/**
 * @fileoverview クリップボードのプレーンテキストをSVG文書として安全に受け入れられる形へ検証する。
 * あわせて、貼り付けやファイルから受け取ったSVG文字列がdraw.ioの編集モデルを持つかを判定する。
 *
 * 実行境界はshared。文字列だけを扱い、ファイルI/OやDOMには触れない。
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

/**
 * content属性の値がmxfileの開始タグで始まることの判定式。
 * XML直列化は `<` を `&lt;` 等へエスケープするが、HTML直列化（outerHTML）はそのまま残すため両方を受け入れる。
 * `mxfileX` のような別名の要素は対象にしない。
 */
const DRAWIO_MXFILE_START = /^\s*(?:<|&lt;|&#0*60;|&#[xX]0*3[cC];)mxfile(?:[\s/>]|&gt;|&#)/;

/** {@link findDrawioModelRange} が返す、文字列内の半開区間。 */
export interface SvgValueRange {
  /** 値の先頭位置。引用符は含まない。 */
  start: number;
  /** 値の終端の次の位置。閉じ引用符の位置と一致する。 */
  end: number;
}

/**
 * 属性の区切りとなるXML空白かを判定する。
 * @param character - 判定する1文字。文字列の範囲外ではundefined。
 * @returns 空白、タブ、改行、復帰のいずれかならtrue。
 */
function isSvgSpace(character: string | undefined): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\r";
}

/** XMLの空白文字クラス。`\s` はNBSPなどHTMLとXMLが空白と扱わない文字も含むため使わない。 */
const SVG_SPACE = "[ \\t\\r\\n]";

/** `<` と `>` を含まない引用文字列。どちらかを含むと、HTMLとXMLで構文の終端の解釈が分かれ得る。 */
const SVG_SAFE_LITERAL = `(?:"[^"<>]*"|'[^'<>]*')`;

/**
 * モデルを保護してよい文書の先頭部分（XML宣言、コメント、外部IDだけのDOCTYPE）の1要素。
 * XMLとHTMLの字句解釈が必ず一致する形だけを許可する。次の形は解釈が分かれるため受け入れない。
 * - 内部サブセット付きのDOCTYPE: 実体値の中の文字列を、HTMLはタグとして読む。
 * - `<` や `>` を含むコメント: `<!-->` や `--!>` はHTMLでだけコメントを閉じる。
 * - `>` を含むXML宣言: HTMLは最初の `>` で閉じる。
 * - UTF-8以外のencoding: ブラウザーが別の文字として復号し、ここで読んだ引用符の位置と一致しなくなる。
 * XML宣言は仕様上の3属性を固定の値でだけ許可する。任意の値を許すと、値に書いた文字列をブラウザーがencoding指定と誤認する。
 * 属性の繰り返しも無制限にすると、巨大な入力で正規表現のスタックが溢れる。
 */
const SVG_SAFE_PROLOG_ITEM = new RegExp(
  `${SVG_SPACE}*(?:` +
    `<\\?xml(?:${SVG_SPACE}+version${SVG_SPACE}*=${SVG_SPACE}*(?:"1\\.[0-9]+"|'1\\.[0-9]+'))?` +
    `(?:${SVG_SPACE}+encoding${SVG_SPACE}*=${SVG_SPACE}*(?:"[uU][tT][fF]-8"|'[uU][tT][fF]-8'))?` +
    `(?:${SVG_SPACE}+standalone${SVG_SPACE}*=${SVG_SPACE}*(?:"(?:yes|no)"|'(?:yes|no)'))?${SVG_SPACE}*\\?>` +
    "|<!--[^<>]*-->" +
    `|<!DOCTYPE${SVG_SPACE}+svg(?:${SVG_SPACE}+(?:PUBLIC${SVG_SPACE}+${SVG_SAFE_LITERAL}${SVG_SPACE}+${SVG_SAFE_LITERAL}` +
    `|SYSTEM${SVG_SPACE}+${SVG_SAFE_LITERAL}))?${SVG_SPACE}*>` +
    ")",
  "y",
);

/** XMLの属性名として許可する形。空の名前や `=` 始まりなど、HTMLと解釈が分かれる名前を除外する。 */
const SVG_ATTRIBUTE_NAME = /^[A-Za-z_:][\w:.-]*$/;

/**
 * 許可リストの先頭部分を読み飛ばす。
 * @param svg - SVG候補の文字列。
 * @returns ルート要素の候補が始まる位置。許可しない内容があれば、その位置で止まるためルートとして認識されない。
 */
function skipSafeSvgProlog(svg: string): number {
  let index = 0;
  for (;;) {
    SVG_SAFE_PROLOG_ITEM.lastIndex = index;
    if (!SVG_SAFE_PROLOG_ITEM.test(svg)) break;
    index = SVG_SAFE_PROLOG_ITEM.lastIndex;
  }
  while (isSvgSpace(svg[index])) index++;
  return index;
}

/**
 * draw.ioの編集モデルを保持するルートsvg要素のcontent属性値の範囲を探す。
 *
 * draw.ioのSVGはルートのcontent属性にmxfile XMLを保持するため、その有無でdraw.io SVGと判断する。
 * 本文中の文字列、他の属性値の内側、ネストしたsvg要素のcontent属性は対象にしない。
 *
 * 返した範囲は呼び出し元でサニタイズの対象から外されるため、誤読するとサニタイズの迂回になる。
 * そこでルートの開始からcontent属性までを許可リストで読み、XMLとHTMLのどちらでも同じ範囲が引用された属性値になる文書に限って認める。
 * content属性より前に許可する属性は「空白、XML名、`=`、引用された値」の並びだけで、引用符なしの値、値なしの属性、
 * 空白なしで続く属性は認めない。draw.ioの出力はこの形に収まり、外れた文書は通常のSVGとして全体をサニタイズできる。
 * content属性より後ろは検査しない。範囲の位置は後ろの内容に左右されず、後ろは呼び出し元がサニタイズするため。
 * この関数はSVG全体の妥当性を検証しないので、閉じタグの欠落や後続の文字列があっても範囲を返す。
 *
 * クリップボードやファイルの内容は細工された文字列も入り得てExtension Hostで同期実行されるため、属性は正規表現で読まず
 * 入力長に比例する時間で走査する。巨大な入力でも停止や例外を起こさない。
 * @param svg - SVG候補の文字列。未検証でよい。先頭のBOMは呼び出し元で除去する（BOMがあると認識しない）。
 * @returns モデルの値の範囲。draw.io SVGでない場合や許可しない構文を含む場合はundefined。
 */
export function findDrawioModelRange(svg: string): SvgValueRange | undefined {
  let index = skipSafeSvgProlog(svg);
  if (!svg.startsWith("<svg", index)) return undefined;
  index += 4;

  for (;;) {
    if (!isSvgSpace(svg[index])) return undefined;
    while (isSvgSpace(svg[index])) index++;

    const nameStart = index;
    while (index < svg.length && !isSvgSpace(svg[index]) && !"=/>".includes(svg[index])) index++;
    const name = svg.slice(nameStart, index);
    if (!SVG_ATTRIBUTE_NAME.test(name)) return undefined;

    while (isSvgSpace(svg[index])) index++;
    if (svg[index] !== "=") return undefined;
    index++;
    while (isSvgSpace(svg[index])) index++;

    const quote = svg[index];
    if (quote !== '"' && quote !== "'") return undefined;
    const end = svg.indexOf(quote, index + 1);
    if (end < 0) return undefined;
    if (name === "content") {
      return DRAWIO_MXFILE_START.test(svg.slice(index + 1, end)) ? { start: index + 1, end } : undefined;
    }
    index = end + 1;
  }
}

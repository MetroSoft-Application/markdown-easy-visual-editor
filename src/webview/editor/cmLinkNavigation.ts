/**
 * @fileoverview 本文エディター上のリンクをCtrl+クリック（macOSはCmd+クリック）で開き、操作方法をツールチップで示す。
 *
 * 実行境界はWebview（CodeMirror）。リンクの判定だけを行い、開く処理は呼出元へ委ねる
 * （プレビューのリンクと同じHostのopenResource経路を使い、draw.io振り分けやワークスペース境界を共有するため）。
 * 何をリンクとみなすかは、プレビューで実際にリンクになるものに合わせる。
 * - Markdown文書（混在形式）: Markdownのインライン・画像・参照・自動リンク、参照定義、HTMLのhref/src属性、
 *   素のhttp(s) URL（GFMと同じ終端規則）、Textileの `"文字":URL` と `!画像!http(s)://リンク先`。
 * - Textile単独の文書: textile-jsと同じく `"文字":URL`、`["文字":URL]`、`!画像!`、`!画像!:リンク先` とHTMLの属性だけ。
 *   Markdown記法と素のURLはプレビューでリンクにならないため対象外にする。
 * コード（インライン・ブロック、Textileの @code@）とコメントの中、脚注参照 `[^1]` は対象外にする。
 * 修飾キーなしのクリックや、リンク外での修飾キー付きクリックは従来どおりCodeMirrorへ渡す。
 * 判定はホバー・クリック時に指している行だけで行い、入力ごとの全文走査はしない。
 * 例外として、定義のない角括弧（参照リンクの候補）の上では参照定義を探すため、構文木と本文を全文走査する。
 */
import { syntaxTree } from "@codemirror/language";
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  hoverTooltip,
  type DecorationSet,
} from "@codemirror/view";
import { WORKSPACE_SECTION_LINK_TITLE } from "../../shared/markdown";
import { findHtmlUrlAttributeRanges } from "./cmHtmlUrlHighlight";

/**
 * リンク判定の規則。`textile` はTextile単独の文書、`markdown` はMarkdownとTextileの混在形式の文書。
 * MarkdownRenderFormatの `textile` 以外はすべて `markdown` として扱う。
 */
export type EditorLinkFormat = "markdown" | "textile";

/** 本文エディター上で開けるリンク1件。 */
export interface EditorLinkTarget {
  /**
   * 修飾キー付きクリックとツールチップの対象になる本文範囲の開始オフセット。
   * CodeMirror内部の文書オフセットで、Hostとやり取りする外部オフセットではない（改行コードの換算をしていない）。
   */
  from: number;
  /** 同じ範囲の終了オフセット（この位置の文字は含まない）。fromと同じくCodeMirror内部のオフセット。 */
  to: number;
  /** 開くリンク先。本文に書かれたとおりの文字列（山括弧は除き、メールアドレスの自動リンクは mailto: を付ける）。 */
  href: string;
  /** ワークスペース基準リンクの印（{@link WORKSPACE_SECTION_LINK_TITLE}）を持つ場合はtrue。 */
  workspaceRooted: boolean;
}

/** 本文エディターのリンク操作に必要な、呼出元から渡す処理と文言。 */
export interface EditorLinkNavigationOptions {
  /**
   * 修飾キー付きクリックでリンクを開く。
   * @param link - クリックされたリンク。
   */
  open: (link: EditorLinkTarget) => void;
  /**
   * ツールチップの1行目に表示する、現在の表示言語の操作説明。
   * 表示言語の切替に追従するため、表示のたびに呼び出す。
   * @param mac - macOSならtrue（Cmd+クリック）。
   * @returns 「リンク先を開く (Ctrl + クリック)」などの文言。
   */
  label: (mac: boolean) => string;
  /**
   * 現在の文書のリンク判定規則。文書形式の切替に追従するため、判定のたびに呼び出す。
   * @returns Textile単独の文書なら `textile`、それ以外は `markdown`。
   */
  format: () => EditorLinkFormat;
}

/** リンクとして扱わない、コードとコメントの構文ノード名。 */
const NON_LINK_NODES = new Set([
  "InlineCode",
  "CodeText",
  "FencedCode",
  "CodeBlock",
  "Comment",
  "CommentBlock",
]);

/** リンク先を持つMarkdownの構文ノード名。 */
const LINK_NODES = new Set(["Link", "Image", "Autolink", "LinkReference"]);

/** リンクとして開くHTML属性。srcsetなど複数URLを持つ属性は1つのリンク先に決められないため除外する。 */
const HTML_LINK_ATTRIBUTES = new Set(["href", "src", "xlink:href"]);

/**
 * 本文中の素のhttp(s) URL。プレビュー（GFMの自動リンク）と同じく空白・山括弧・引用符で終わる。
 * 末尾の句読点と閉じ括弧は文の一部として後で除く。
 */
const BARE_URL = /https?:\/\/[^\s<>"'`]+/gi;

/** Textileのインラインコード `@code@`。この中の記号はリンクとして扱わない。 */
const TEXTILE_CODE = /@[^@\r\n]+@/g;

/**
 * Markdown文書の中のTextileリンク `"文字":URL`。1番目のグループがリンク先。
 * プレビューのレンダラー（markdownRendererCore の mveTextileLink）と同じ式にする。
 */
const TEXTILE_MIXED_LINK = /"(?:\([^)]+\)\.\s*)?[^"\r\n]+":([^\s<>]+)/g;

/** Textile単独の文書のリンク `"文字":URL`。textile-jsと同じく `["文字":URL]` の閉じ角括弧でも終わる。 */
const TEXTILE_ONLY_LINK = /"[^"\r\n]+":([^\s<>\]]+)/g;

/**
 * Markdown文書の中のTextile画像 `!画像(代替)!` とリンク付き画像 `!画像!http(s)://リンク先`。
 * 1番目のグループが画像、2番目がリンク先。プレビューのレンダラー（mveTextileImage）と同じ式にする。
 */
const TEXTILE_MIXED_IMAGE = /!(?!\[)([^!\s()]+)(?:\([^)]*\))?!(https?:\/\/[^\s]+)?/gi;

/** Textile単独の文書の画像 `!画像(代替)!` とリンク付き画像 `!画像!:リンク先`（textile-jsと同じ）。 */
const TEXTILE_ONLY_IMAGE = /!(?!\[)([^!\s()]+)(?:\([^)]*\))?!(?::([^\s<>\]]+))?/g;

/** 実行環境がmacOSか。macOSではCmd、それ以外ではCtrlを修飾キーにする（VS Codeのリンク操作と同じ）。 */
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * マウスイベントがリンクを開く修飾キー付きかを判定する。
 * @param event - 判定するマウスイベント。
 * @returns macOSはCmd、それ以外はCtrlが押されていればtrue。
 */
function hasOpenModifier(event: MouseEvent | KeyboardEvent): boolean {
  return IS_MAC ? event.metaKey : event.ctrlKey;
}

/**
 * 参照ラベルをCommonMarkの規則に近い形で比較用に正規化する（大文字小文字と連続空白を無視）。
 * @param label - 角括弧を含むか含まない参照ラベル。
 * @returns 比較用の文字列。
 */
function normalizeLabel(label: string): string {
  return label.replace(/^\[|\]$/g, "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * 参照定義 `[label]: url "title"` を文書から探す。
 * まず解析済みの構文木から探し、なければ本文を行単位で走査して探す。
 * 背景解析は表示範囲の先までしか進まないため、大きな文書の文末の定義は構文木にまだないことがある。
 * 解析を待つと結果が処理速度に左右されるので、待たずに行の走査で補う
 * （約1MBの文書で、未定義のラベル上の判定全体が中央値約7ms・最大約22ms。7回計測）。
 * @param state - 現在の文書状態。
 * @param label - 正規化済みの参照ラベル。
 * @returns 見つかった定義のURLとタイトル。なければundefined。
 */
function findReferenceDefinition(
  state: EditorState,
  label: string,
): { href: string; title: string } | undefined {
  return findParsedReferenceDefinition(state, label) ?? scanReferenceDefinition(state, label);
}

/**
 * 1行で書かれた参照定義 `[label]: url "title"`（行頭の空白は3つまで）。
 * 1番目のグループがラベル、2番目がリンク先、3〜5番目がタイトル（二重引用符・一重引用符・括弧）。
 * 複数行にまたがる定義は対象外で、その場合は構文木で見つかったときだけ解決する。
 */
const REFERENCE_DEFINITION_LINE = /^ {0,3}\[([^\]\n]+)\]:[ \t]*(<[^>\n]*>|\S+)(?:[ \t]+(?:"([^"\n]*)"|'([^'\n]*)'|\(([^)\n]*)\)))?[ \t]*$/;

/** フェンスで囲まれたコードブロックの開始・終了行（行頭の空白は3つまで）。 */
const CODE_FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * 本文を行単位で走査して参照定義を探す。フェンスで囲まれたコードの中の行は除く。
 * @param state - 現在の文書状態。
 * @param label - 正規化済みの参照ラベル。
 * @returns 見つかった定義のURLとタイトル。なければundefined。
 */
function scanReferenceDefinition(
  state: EditorState,
  label: string,
): { href: string; title: string } | undefined {
  let fence: string | undefined;
  for (const text of state.doc.iterLines()) {
    const fenceMatch = CODE_FENCE_LINE.exec(text);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence) continue;
    const match = REFERENCE_DEFINITION_LINE.exec(text);
    if (match && normalizeLabel(match[1]) === label) {
      return { href: stripAngleBrackets(match[2]), title: match[3] ?? match[4] ?? match[5] ?? "" };
    }
  }
  return undefined;
}

/**
 * 解析済みの構文木から参照定義を探す。
 * @param state - 現在の文書状態。
 * @param label - 正規化済みの参照ラベル。
 * @returns 見つかった定義のURLとタイトル。なければundefined。
 */
function findParsedReferenceDefinition(
  state: EditorState,
  label: string,
): { href: string; title: string } | undefined {
  let found: { href: string; title: string } | undefined;
  syntaxTree(state).iterate({
    /**
     * LinkReferenceのラベルを比較し、最初に一致した定義を記録する。
     * @param node - 走査中の構文ノード。
     * @returns 一致後は子ノードの走査を省略するためfalse。
     */
    enter(node) {
      if (found) return false;
      if (node.name !== "LinkReference") return undefined;
      const labelNode = node.node.getChild("LinkLabel");
      const url = node.node.getChild("URL");
      if (labelNode && url && normalizeLabel(state.sliceDoc(labelNode.from, labelNode.to)) === label) {
        const title = node.node.getChild("LinkTitle");
        found = {
          href: stripAngleBrackets(state.sliceDoc(url.from, url.to)),
          title: title ? state.sliceDoc(title.from + 1, title.to - 1) : "",
        };
      }
      return false;
    },
  });
  return found;
}

/**
 * `<url>` 形式のリンク先から山括弧を除く。
 * @param href - Markdownに書かれたリンク先。
 * @returns 山括弧を除いたリンク先。
 */
function stripAngleBrackets(href: string): string {
  return href.startsWith("<") && href.endsWith(">") ? href.slice(1, -1) : href;
}

/**
 * Markdownのリンク・画像・自動リンク・参照定義の構文ノードから、リンク先とタイトルを取り出す。
 * インラインのURLがなければ参照リンクとみなし、参照定義を探す（`[text][id]`、`[text][]`、`[text]`）。
 * 脚注 `[^1]` と脚注定義はプレビューでは脚注として描画されるため、リンクとして扱わない。
 * @param state - 現在の文書状態。
 * @param node - LINK_NODESに含まれる構文ノード。
 * @returns リンク先とタイトル。脚注、または定義が見つからない参照リンクはundefined。
 */
function readMarkdownLink(
  state: EditorState,
  node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>,
): { href: string; title: string } | undefined {
  const firstLabel = node.getChild("LinkLabel");
  if (firstLabel && /^\[\^/.test(state.sliceDoc(firstLabel.from, firstLabel.to))) return undefined;
  const url = node.getChild("URL");
  if (url) {
    const title = node.getChild("LinkTitle");
    let href = stripAngleBrackets(state.sliceDoc(url.from, url.to));
    // CommonMarkの自動リンクでスキームのないメールアドレスは、プレビューと同じくmailto:として開く。
    if (node.name === "Autolink" && !/^[a-z][a-z0-9+.-]*:/i.test(href) && href.includes("@")) {
      href = `mailto:${href}`;
    }
    return {
      href,
      title: title ? state.sliceDoc(title.from + 1, title.to - 1) : "",
    };
  }
  if (node.name !== "Link" && node.name !== "Image") return undefined;
  const marks = node.getChildren("LinkMark");
  const textStart = marks[0]?.to ?? node.from;
  const textEnd = marks[1]?.from ?? node.to;
  if (state.sliceDoc(textStart, textStart + 1) === "^") return undefined;
  const labels = node.getChildren("LinkLabel");
  const explicitLabel = labels.length ? state.sliceDoc(labels[0].from, labels[0].to) : "";
  if (explicitLabel && normalizeLabel(explicitLabel)) {
    return findReferenceDefinition(state, normalizeLabel(explicitLabel));
  }
  // `[text][]` と `[text]` は本文のテキスト自体を参照ラベルにする。
  return findReferenceDefinition(state, normalizeLabel(state.sliceDoc(textStart, textEnd)));
}

/**
 * 素のURLの末尾から、GFMの自動リンクと同じく文の一部とみなす文字を除く。
 * 句読点・強調記号・引用符は除き、閉じ括弧は対応する開き括弧がURL内にない場合だけ除く（`Foo_(bar)` は残す）。
 * @param url - 正規表現で切り出したURL候補。
 * @returns リンク先として使うURL。
 */
function trimBareUrl(url: string): string {
  let result = url;
  for (;;) {
    const last = result.at(-1);
    if (last && ".,;:!?*_~'\"".includes(last)) {
      result = result.slice(0, -1);
      continue;
    }
    if (last === ")" && countOf(result, "(") < countOf(result, ")")) {
      result = result.slice(0, -1);
      continue;
    }
    return result;
  }
}

/**
 * 文字列中の指定文字の出現数を数える。
 * @param text - 対象の文字列。
 * @param character - 数える1文字。
 * @returns 出現数。
 */
function countOf(text: string, character: string): number {
  let count = 0;
  for (const current of text) if (current === character) count += 1;
  return count;
}

/**
 * 行の中から、指定位置を含むTextileのリンクまたは画像を探す。
 * - `"文字":URL`（Textile単独では `["文字":URL]` の閉じ角括弧でも終わる）。末尾の `.,;!?` はリンクに含めない。
 * - 画像 `!画像!`。リンク付き画像は、Textile単独では `!画像!:リンク先`、混在形式では `!画像!http(s)://リンク先`。
 *   画像のパス部分を指していれば画像を、それ以外の部分ならリンク先（なければ画像）を開く。
 * `@code@` の中はリンクとして扱わない。
 * @param lineText - 行の本文。
 * @param lineFrom - 行の先頭の文書オフセット。
 * @param position - 判定する文字の位置。
 * @param format - リンク判定の規則。
 * @returns リンク。なければundefined。
 */
function findTextileLinkAt(
  lineText: string,
  lineFrom: number,
  position: number,
  format: EditorLinkFormat,
): EditorLinkTarget | undefined {
  const column = position - lineFrom;
  for (const code of lineText.matchAll(TEXTILE_CODE)) {
    const start = code.index ?? 0;
    if (start <= column && column < start + code[0].length) return undefined;
  }
  const linkPattern = format === "textile" ? TEXTILE_ONLY_LINK : TEXTILE_MIXED_LINK;
  for (const match of lineText.matchAll(linkPattern)) {
    const start = match.index ?? 0;
    const destinationStart = start + match[0].length - match[1].length;
    const href = match[1].replace(/[.,;!?]+$/u, "");
    const end = destinationStart + href.length;
    if (href && start <= column && column < end) {
      return { from: lineFrom + start, to: lineFrom + end, href, workspaceRooted: false };
    }
  }
  const imagePattern = format === "textile" ? TEXTILE_ONLY_IMAGE : TEXTILE_MIXED_IMAGE;
  for (const match of lineText.matchAll(imagePattern)) {
    const start = match.index ?? 0;
    const target = match[2]?.replace(/[.,;!?]+$/u, "");
    const end = target ? start + match[0].length - match[2].length + target.length : start + match[0].length;
    if (column < start || end <= column) continue;
    const sourceStart = start + 1;
    const onSource = sourceStart <= column && column < sourceStart + match[1].length;
    return {
      from: lineFrom + start,
      to: lineFrom + end,
      href: !onSource && target ? target : match[1],
      workspaceRooted: false,
    };
  }
  return undefined;
}

/**
 * 指定した文字位置にあるリンクを探す。最も内側のリンクを優先する（`[![図](a)](b)` の画像部分はa）。
 * @param state - 現在の文書状態。
 * @param position - 判定する文字の位置（この位置から始まる1文字）。
 * @param format - リンク判定の規則。既定はMarkdown（混在形式）。
 * @returns リンク。リンクでない、またはコード・コメント・脚注の中ならundefined。
 */
export function findEditorLinkAt(
  state: EditorState,
  position: number,
  format: EditorLinkFormat = "markdown",
): EditorLinkTarget | undefined {
  if (position < 0 || position >= state.doc.length) return undefined;
  const line = state.doc.lineAt(position);
  if (format === "markdown") {
    const tree = syntaxTree(state);
    for (let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(position, 1); node; node = node.parent) {
      if (NON_LINK_NODES.has(node.name)) return undefined;
      if (!LINK_NODES.has(node.name)) continue;
      const link = readMarkdownLink(state, node);
      if (!link || !link.href) break;
      return {
        from: node.from,
        to: node.to,
        href: link.href,
        workspaceRooted: link.title === WORKSPACE_SECTION_LINK_TITLE,
      };
    }
  }
  const attribute = findHtmlUrlAttributeRanges(state, line.from, line.to).find(
    /**
     * リンクとして開くHTML属性で、位置を含むものを選ぶ。
     * @param range - 行内のHTML URL属性値の範囲。
     * @returns 対象の属性ならtrue。
     */
    (range) => HTML_LINK_ATTRIBUTES.has(range.attribute) && range.from <= position && position < range.to,
  );
  if (attribute) {
    return {
      from: attribute.from,
      to: attribute.to,
      href: state.sliceDoc(attribute.from, attribute.to).trim(),
      workspaceRooted: false,
    };
  }
  const textile = findTextileLinkAt(line.text, line.from, position, format);
  if (textile || format === "textile") return textile;
  for (const match of line.text.matchAll(BARE_URL)) {
    const href = trimBareUrl(match[0]);
    const from = line.from + (match.index ?? 0);
    if (from <= position && position < from + href.length) {
      return { from, to: from + href.length, href, workspaceRooted: false };
    }
  }
  return undefined;
}

/**
 * マウス座標の下にある文字の位置を求める。行末より右など、文字の上でない座標ではundefined。
 * @param view - 対象のエディター。
 * @param event - 座標を持つマウスイベント。
 * @returns 座標の下の文字の位置。
 */
function characterAtPointer(view: EditorView, event: MouseEvent): number | undefined {
  const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (position === null) return undefined;
  const coords = view.coordsAtPos(position);
  // 座標が位置の左側なら直前の文字、右側ならその位置の文字を指している。
  const character = coords && event.clientX < coords.left ? position - 1 : position;
  const line = view.state.doc.lineAt(position);
  return character >= line.from && character < line.to ? character : undefined;
}

/** 修飾キーを押しながら指しているリンクの範囲を更新する効果。nullで解除する。 */
const setActiveLink = StateEffect.define<{ from: number; to: number } | null>();

/** 修飾キー付きで指しているリンクに付ける下線とポインターのカーソル。 */
const activeLinkMark = Decoration.mark({ class: "cm-mve-link-active" });

/** 修飾キーを押しながら指しているリンクの装飾。文書の変更に合わせて位置を移す。 */
const activeLinkField = StateField.define<DecorationSet>({
  /** 初期状態は装飾なし。 */
  create: () => Decoration.none,
  /**
   * 文書変更で位置を移し、効果があれば装飾を差し替える。
   * @param value - 現在の装飾。
   * @param transaction - 適用中のトランザクション。
   * @returns 更新後の装飾。
   */
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setActiveLink)) continue;
      next = effect.value && effect.value.from < effect.value.to
        ? Decoration.set([activeLinkMark.range(effect.value.from, effect.value.to)])
        : Decoration.none;
    }
    return next;
  },
  /**
   * フィールドの装飾をエディターの表示へ渡す。
   * @param field - このStateField。
   * @returns 装飾を提供する拡張。
   */
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * 修飾キーの状態とマウス位置から、下線を付けるリンクを更新する。変化がなければ何もしない。
 * @param view - 対象のエディター。
 * @param link - 修飾キー付きで指しているリンク。なければundefined。
 */
function updateActiveLink(view: EditorView, link: EditorLinkTarget | undefined): void {
  const current = view.state.field(activeLinkField);
  let currentRange: { from: number; to: number } | undefined;
  current.between(
    0,
    view.state.doc.length,
    /**
     * 装飾は最大1件なので、最初の範囲を記録して走査を終える。
     * @param from - 装飾の開始位置。
     * @param to - 装飾の終了位置。
     * @returns 走査を止めるためfalse。
     */
    (from, to) => {
      currentRange = { from, to };
      return false;
    },
  );
  if (currentRange?.from === link?.from && currentRange?.to === link?.to) return;
  view.dispatch({ effects: setActiveLink.of(link ? { from: link.from, to: link.to } : null) });
}

/**
 * リンクのCtrl+クリック（macOSはCmd+クリック）とツールチップを有効にするCodeMirror拡張を作る。
 * @param options - リンクを開く処理、ツールチップの文言、文書形式。
 * @returns エディターへ追加する拡張。
 */
export function editorLinkNavigationExtension(options: EditorLinkNavigationOptions): Extension {
  /** 直近のマウス位置。修飾キーだけを押した・離したときに下線を更新するために保持する。 */
  let lastPointer: MouseEvent | undefined;
  return [
    activeLinkField,
    hoverTooltip(
      /**
       * マウスを止めた位置がリンクなら、操作方法とリンク先のツールチップを出す。
       * @param view - 対象のエディター。
       * @param position - マウス位置に最も近い文書位置。
       * @param side - 位置の左右どちらの文字を指しているか（-1は左）。
       * @returns ツールチップ。リンクでなければnull。
       */
      (view, position, side) => {
        const link = findEditorLinkAt(view.state, side < 0 ? position - 1 : position, options.format());
        if (!link) return null;
        return {
          pos: link.from,
          end: link.to,
          above: true,
          /**
           * ツールチップのDOMを作る。文言はtextContentで入れ、リンク先は長くても1行で省略表示する。
           * @returns ツールチップのDOM。
           */
          create: () => {
            const dom = document.createElement("div");
            dom.className = "cm-mve-link-tooltip";
            const action = document.createElement("div");
            action.className = "cm-mve-link-tooltip-action";
            action.textContent = options.label(IS_MAC);
            const target = document.createElement("div");
            target.className = "cm-mve-link-tooltip-target";
            target.textContent = link.href;
            dom.append(action, target);
            return { dom };
          },
        };
      },
      // 本文が変わるとリンク先も変わり得るため、編集されたらツールチップを閉じる。
      { hoverTime: 300, hideOnChange: true },
    ),
    EditorView.domEventHandlers({
      /**
       * 修飾キー付きの左クリックがリンク上なら、選択の変更（複数カーソルの追加）を止めてリンクを開く。
       * @param event - マウス押下イベント。
       * @param view - 対象のエディター。
       * @returns リンクを開いた場合はtrue（CodeMirror既定の処理を止める）。
       */
      mousedown(event, view) {
        if (event.button !== 0 || !hasOpenModifier(event)) return false;
        const character = characterAtPointer(view, event);
        const link = character === undefined ? undefined : findEditorLinkAt(view.state, character, options.format());
        if (!link) return false;
        event.preventDefault();
        // ダブルクリックの2回目で同じリンクを再び開かない（外部URLや別タブが二重に開くのを防ぐ）。
        if (event.detail > 1) return true;
        updateActiveLink(view, undefined);
        options.open(link);
        return true;
      },
      /**
       * 修飾キーを押しながら動かしている間、指しているリンクに下線を付ける。
       * @param event - マウス移動イベント。
       * @param view - 対象のエディター。
       * @returns 既定処理は止めないためfalse。
       */
      mousemove(event, view) {
        lastPointer = event;
        const character = hasOpenModifier(event) ? characterAtPointer(view, event) : undefined;
        updateActiveLink(view, character === undefined ? undefined : findEditorLinkAt(view.state, character, options.format()));
        return false;
      },
      /**
       * マウスがエディターから出たら下線を消す。
       * @param _event - マウス離脱イベント。
       * @param view - 対象のエディター。
       * @returns 既定処理は止めないためfalse。
       */
      mouseleave(_event, view) {
        lastPointer = undefined;
        updateActiveLink(view, undefined);
        return false;
      },
      /**
       * 修飾キーを押した時点で、マウスの下のリンクに下線を付ける。
       * @param event - キー押下イベント。
       * @param view - 対象のエディター。
       * @returns 既定処理は止めないためfalse。
       */
      keydown(event, view) {
        if (!lastPointer || !hasOpenModifier(event)) return false;
        const character = characterAtPointer(view, lastPointer);
        updateActiveLink(view, character === undefined ? undefined : findEditorLinkAt(view.state, character, options.format()));
        return false;
      },
      /**
       * 修飾キーを離したら下線を消す。
       * @param event - キー解放イベント。
       * @param view - 対象のエディター。
       * @returns 既定処理は止めないためfalse。
       */
      keyup(event, view) {
        if (!hasOpenModifier(event)) updateActiveLink(view, undefined);
        return false;
      },
    }),
  ];
}

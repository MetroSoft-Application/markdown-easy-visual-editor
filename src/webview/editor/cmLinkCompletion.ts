/**
 * @fileoverview 本文エディター（CodeMirror）で、Markdown のリンク先パスと見出しアンカーを補完する。
 * 実行境界は Webview。ファイル一覧と他文書の見出しは Host へ要求し、同じ文書の見出しは編集中の本文から直接作る。
 * Host との通信手段は SourceEditor が Facet で渡す。Facet がない（Host がない）エディターでは何もしない。
 * 見出し ID はプレビューの描画・セクションリンクのコピーと同じ規則（getOutlineForFormatSource）で作り、
 * リンクへ挿入するときもセクションリンクのコピーと同じエンコードを使う。
 * コード（インライン・ブロック）とコメントの中、Textile 単独の文書では補完しない。
 */
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { Facet, type EditorState } from "@codemirror/state";
import { detectLinkCompletionContext } from "../../shared/linkPaths";
import { encodeMarkdownLinkFragment, getOutlineForFormatSource } from "../../shared/markdown";
import type { LinkCompletionFile, LinkCompletionHeading } from "../../shared/protocol";
import type { MarkdownRenderFormat } from "../markdown/markdownRendererCore";

/** リンク先補完が Host と通信するための処理。 */
export interface LinkCompletionHost {
  /**
   * 文書からリンクできるファイルの候補を Host へ要求する。
   * @returns 候補一覧。取得できない（タイムアウト・失敗）場合はundefined。
   */
  requestFiles: () => Promise<LinkCompletionFile[] | undefined>;
  /**
   * 指定した文書の見出しを Host へ要求する。
   * @param path - 本文に書かれたとおりのリンク先パス（`#` より前）。
   * @returns 見出し一覧。取得できない場合はundefined。
   */
  requestHeadings: (path: string) => Promise<LinkCompletionHeading[] | undefined>;
  /**
   * 現在の文書の描画形式を返す。
   * @returns Textile 単独なら textile。補完はその場合だけ無効にする。
   */
  format: () => MarkdownRenderFormat;
}

/** SourceEditor から Host 通信手段を渡す Facet。複数指定された場合は最初の1つを使う。 */
export const linkCompletionHostFacet = Facet.define<LinkCompletionHost, LinkCompletionHost | undefined>({
  /**
   * 最初に指定された通信手段を使う。
   * @param values - 指定された通信手段の一覧。
   * @returns 最初の通信手段。指定がなければundefined。
   */
  combine: (values) => values[0],
});

/** コードとして扱い、補完を出さない構文木ノード名。 */
const CODE_NODE_NAMES = new Set(["InlineCode", "FencedCode", "CodeBlock", "CodeText", "Comment", "CommentBlock"]);

/** パス入力中に、追加入力を同じ候補一覧の絞り込みで扱える文字。区切りや空白が来たら補完を閉じる。 */
const PATH_VALID_FOR = /^[^\s()<>#?"']*$/u;

/** アンカー入力中に、同じ候補一覧の絞り込みで扱える文字。 */
const ANCHOR_VALID_FOR = /^[^\s()<>#"']*$/u;

/**
 * カーソル位置がコードまたはコメントの中か判定する。
 * @param state - エディターの状態。
 * @param pos - 判定する位置。
 * @returns コード・コメントの中ならtrue。
 */
function isInsideCode(state: EditorState, pos: number): boolean {
  for (let node: { name: string; parent: unknown } | null = syntaxTree(state).resolveInner(pos, -1);
    node;
    node = node.parent as typeof node) {
    if (CODE_NODE_NAMES.has(node.name)) return true;
  }
  return false;
}

/**
 * 種類に応じた CodeMirror の候補アイコン種別と並び順の補正値を返す。
 * @param kind - 候補ファイルの種類。
 * @returns アイコン種別と boost 値。
 */
function fileCompletionStyle(kind: LinkCompletionFile["kind"]): Pick<Completion, "type" | "boost"> {
  if (kind === "markdown") return { type: "text", boost: 2 };
  if (kind === "image") return { type: "variable", boost: 1 };
  return { type: "constant", boost: 0 };
}

/**
 * Markdown のリンク先（パスまたは見出しアンカー）を補完する CodeMirror の補完ソース。
 * Facet で Host 通信手段が渡されていないエディターでは常にnullを返す。
 * @param context - カーソル位置と文書状態を含む補完コンテキスト。
 * @returns 補完候補。リンク先の入力中でない、コード内、候補がない、要求が中断された場合はnull。
 */
export async function linkCompletionSource(context: CompletionContext): Promise<CompletionResult | null> {
  const host = context.state.facet(linkCompletionHostFacet);
  if (!host || host.format() === "textile") return null;
  const line = context.state.doc.lineAt(context.pos);
  const detected = detectLinkCompletionContext(line.text.slice(0, context.pos - line.from));
  if (!detected || isInsideCode(context.state, context.pos)) return null;

  if (detected.kind === "path") {
    // `./` で書き始めた場合は接頭辞を残し、その後ろを文書からの相対パス候補で補完する。
    const keepDotPrefix = detected.query.startsWith("./");
    const from = line.from + detected.from + (keepDotPrefix ? 2 : 0);
    const files = await host.requestFiles();
    if (context.aborted || !files?.length) return null;
    return {
      from,
      options: files
        .filter(
          /**
           * `./` の後ろでは、親フォルダーをたどる候補を除く。
           * @param file - 候補ファイル。
           * @returns 残す候補ならtrue。
           */
          (file) => !keepDotPrefix || !file.path.startsWith("../"))
        .map(
          /**
           * 候補ファイルを CodeMirror の候補へ変換する。
           * @param file - 候補ファイル。
           * @returns 補完候補。
           */
          (file) => ({ label: file.path, ...fileCompletionStyle(file.kind) })),
      validFor: PATH_VALID_FOR,
    };
  }

  const from = line.from + detected.from;
  const headings = detected.path
    ? await host.requestHeadings(detected.path)
    : getOutlineForFormatSource(context.state.doc.toString(), host.format() === "markdown" ? "markdown" : "mixed");
  if (context.aborted || !headings?.length) return null;
  return {
    from,
    options: headings.map(
      /**
       * 見出しを CodeMirror の候補へ変換する。挿入する文字列はセクションリンクのコピーと同じエンコードにする。
       * @param heading - 見出し。
       * @returns 補完候補。
       */
      (heading) => ({
        // 入力した文字で絞り込めるよう、表示はエンコード前のIDにし、挿入だけエンコードする。
        label: heading.id,
        apply: encodeMarkdownLinkFragment(heading.id),
        detail: `${"#".repeat(heading.level)} ${heading.text}`,
        type: "property",
      })),
    validFor: ANCHOR_VALID_FOR,
  };
}

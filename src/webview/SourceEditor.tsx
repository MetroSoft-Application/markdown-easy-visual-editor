/**
 * @fileoverview CodeMirrorの本文編集面を管理し、選択・入力・Undo/RedoをHostとのプロトコルへ変換する。
 */
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import {
  HighlightStyle,
  LanguageDescription,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  lineNumbers,
  placeholder as placeholderExtension,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import {
  clearBlockFormatting,
  clearInlineFormatting,
  indentSelectedLines,
  mapLineSelection,
  prefixOrderedList,
  prefixSelectedLines,
  wrapSelection,
  type SourceEdit,
  type TextSelection,
} from "../shared/markdown";
import {
  computeTextChanges,
  mapTextOffset,
  type TextChange,
} from "../shared/textChanges";
import { getScrollRatio } from "../shared/scroll";
import type { Messages } from "../shared/messages";
import { isMveDebugEnabled, mveDebug } from "./debug";
import { exactSelectionMatchExtension } from "./cmSelectionMatchHighlight";
import { htmlUrlAttributeHighlightExtension } from "./cmHtmlUrlHighlight";

/**
 * 本文編集面で扱う値の種類と境界を表す型。
 */
export type SourceAction =
  | "bold"
  | "italic"
  | "strike"
  | "highlight"
  | "underline"
  | "sup"
  | "sub"
  | "inlineCode"
  | "quote"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "indent"
  | "outdent"
  | "codeBlock"
  | "horizontalRule"
  | "hardBreak"
  | "cellBreak"
  | "clearInline"
  | "clearBlock"
  | "clearAll"
  | "unlink";

/**
 * 本文編集面の位置・寸法・件数・時間を表す数値。
 */
const CARET_PRESERVING_LINE_ACTIONS = new Set<SourceAction>([
  "quote",
  "bulletList",
  "orderedList",
  "taskList",
  "indent",
  "outdent",
  "clearInline",
  "clearBlock",
  "clearAll",
]);

/**
 * 本文編集面で共有するデータ形状を表すインターフェース。
 */
export interface TextEditorHandle {
  /**
   * 本文編集面の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
   * @param inline 挿入するMarkdown内容をインライン形式として扱う場合はtrue。
   * @returns なし。エディター文書を直接更新する。
   */
  insert(markdown: string, inline?: boolean): void;
  /**
   * 本文編集面の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
    * @param edit - 編集後の本文と適用後の選択範囲。
   * @returns 副作用を完了し、値は返さない。
   */
  applyEdit(edit: SourceEdit): void;
  /**
   * 本文編集面のactionを処理し、呼び出し側へ結果または副作用を返す。
    * @param action - 適用する装飾、リスト、ブロック挿入などの操作種別。
   * @returns 本文編集面のactionが生成する結果。
   */
  action(action: SourceAction): void;
  /**
   * 本文編集面のcode・blockを処理し、呼び出し側へ結果または副作用を返す。
    * @param language - 挿入するコードブロックの言語識別子。
   * @returns 副作用を完了し、値は返さない。
   */
  codeBlock(language?: string): void;
  /**
   * 本文編集面のheadingを処理し、呼び出し側へ結果または副作用を返す。
    * @param level - 挿入する見出しのレベル（1から6）。
   * @returns 副作用を完了し、値は返さない。
   */
  heading(level: number): void;
  /**
   * 本文編集面のlinkを処理し、呼び出し側へ結果または副作用を返す。
   * @param href - リンク操作領域の遷移先URI。
   * @param label - 画面または検証結果に表示する説明文。
   * @returns 副作用を完了し、値は返さない。
   */
  link(href: string, label?: string): void;
  /**
   * 本文編集面から必要な値またはリソースを取得する。
   * @returns 条件に一致する値。未検出時はundefinedまたはnull。
   */
  getSelection(): TextSelection;
  /**
   * 本文編集面の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
    * @param selection - 本文上の開始・終了オフセットで指定する選択範囲。
   * @returns 副作用を完了し、値は返さない。
   */
  setSelection(selection: TextSelection): void;
  /**
   * 本文編集面の表示または操作を開始する。
    * @param selection - 表示位置へ移動する本文上の選択範囲。
   * @returns 副作用を完了し、値は返さない。
   */
  revealRange(selection: TextSelection): void;
  /**
   * 本文編集面から必要な値またはリソースを取得する。
   * @returns 条件に一致する値。未検出時はundefinedまたはnull。
   */
  getViewport(): EditorViewportAnchor | undefined;
  /**
   * 本文編集面の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
    * @param anchor - 本文編集面で復元する可視位置アンカー。
   * @returns 副作用を完了し、値は返さない。
   */
  restoreViewport(anchor: EditorViewportAnchor): void;
  /**
   * 保存した縦スクロール位置の比率へ本文編集面を戻す。
   * @param ratio - 復元先として正規化された縦スクロール位置（0から1）。
   * @returns 副作用を完了し、値は返さない。
   */
  restoreScrollRatio(ratio: number): void;
}

/**
 * 本文編集面で共有するデータ形状を表すインターフェース。
 */
export interface EditorViewportAnchor {
  /**
   * 本文編集面の位置・寸法・件数・時間を表す数値。
   */
  offset: number;

  /**
   * 本文編集面の位置・寸法・件数・時間を表す数値。
   */
  topOffset: number;

  /**
   * 本文編集面の位置・寸法・件数・時間を表す数値。
   */
  endOffset?: number;
  /**
   * 本文編集面のscroll・ratioを表す数値。
   */
  scrollRatio?: number;
}

/**
 * 外部変更を同期するための進行中トランザクション。
 */
const externalSyncTransaction = Annotation.define<boolean>();

/**
 * 本文編集面で解析・表示・保存する本文。
 */
const sourceCodeLanguages = [
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["javascript", "js", "jsx"],
    support: javascript({ jsx: true }),
  }),
  LanguageDescription.of({
    name: "TypeScript",
    alias: ["typescript", "ts", "tsx"],
    support: javascript({ typescript: true, jsx: true }),
  }),
  LanguageDescription.of({
    name: "HTML",
    alias: ["html", "xhtml"],
    support: html(),
  }),
  LanguageDescription.of({
    name: "CSS",
    alias: ["css"],
    support: css(),
  }),
  LanguageDescription.of({
    name: "Python",
    alias: ["python", "py"],
    support: python(),
  }),
  LanguageDescription.of({
    name: "Java",
    alias: ["java"],
    support: java(),
  }),
  LanguageDescription.of({
    name: "C++",
    alias: ["cpp", "c++"],
    support: cpp(),
  }),
  LanguageDescription.of({
    name: "Go",
    alias: ["go", "golang"],
    support: go(),
  }),
  LanguageDescription.of({
    name: "Rust",
    alias: ["rust", "rs"],
    support: rust(),
  }),
  LanguageDescription.of({
    name: "SQL",
    alias: ["sql"],
    support: sql(),
  }),
  LanguageDescription.of({
    name: "JSON",
    alias: ["json"],
    support: json(),
  }),
  LanguageDescription.of({
    name: "YAML",
    alias: ["yaml", "yml"],
    support: yaml(),
  }),
] as const;

/**
 * 本文編集面のvscode・syntax・highlight・styleに関する状態または設定。
 */
const vscodeSyntaxHighlightStyle = HighlightStyle.define([
  { tag: tags.meta, color: "var(--vscode-descriptionForeground)" },
  { tag: tags.heading, color: "var(--mve-syntax-link)", fontWeight: "600" },
  {
    tag: tags.quote,
    color: "var(--vscode-textBlockQuote-foreground, var(--vscode-foreground))",
  },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  {
    tag: tags.link,
    color: "var(--mve-syntax-link)",
    textDecoration: "underline",
  },
  { tag: tags.url, color: "var(--mve-syntax-link)" },
  // Markdown内の生HTMLもタグ・属性・値を明示的に区別する。
<<<<<<< HEAD
  { tag: tags.tagName, color: "var(--mve-syntax-tag-name)" },
  { tag: tags.attributeName, color: "var(--mve-syntax-attribute-name)" },
  { tag: tags.attributeValue, color: "var(--mve-syntax-string)" },
  { tag: tags.processingInstruction, color: "var(--mve-syntax-instruction)" },
=======
  { tag: tags.tagName, color: "var(--mve-syntax-html-tag, #569cd6)" },
  { tag: tags.attributeName, color: "var(--mve-syntax-html-attribute, #9cdcfe)" },
  { tag: tags.attributeValue, color: "var(--mve-syntax-html-value, #ce9178)" },
  { tag: tags.processingInstruction, color: "#d7ba7d" },
>>>>>>> c7f724e40846520258e7554bbe539f971c855d39
  {
    tag: tags.monospace,
    color: "var(--mve-syntax-string)",
    backgroundColor:
      "var(--vscode-textCodeBlock-background, var(--vscode-editor-inactiveSelectionBackground))",
    fontFamily:
      "var(--mve-editor-font-family, var(--vscode-editor-font-family, monospace))",
  },
  { tag: tags.escape, color: "var(--mve-syntax-string)" },
  { tag: tags.character, color: "var(--mve-syntax-number)" },
  {
    tag: [tags.keyword, tags.operator],
    color: "var(--mve-syntax-keyword)",
  },
  {
    tag: [tags.atom, tags.bool, tags.contentSeparator],
    color: "var(--mve-syntax-constant)",
  },
  { tag: tags.number, color: "var(--mve-syntax-number)" },
  { tag: tags.labelName, color: "var(--mve-syntax-label)" },
  {
    tag: [tags.string, tags.special(tags.string)],
    color: "var(--mve-syntax-string)",
  },
  { tag: [tags.literal, tags.inserted], color: "var(--mve-syntax-number)" },
  { tag: tags.deleted, color: "var(--mve-syntax-deleted)" },
  { tag: tags.regexp, color: "var(--mve-syntax-regexp)" },
  {
    tag: tags.comment,
    color: "var(--vscode-descriptionForeground)",
    fontStyle: "italic",
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace],
    color: "var(--mve-syntax-type)",
  },
  {
    tag: [tags.definition(tags.variableName), tags.local(tags.variableName)],
    color: "var(--mve-syntax-constant)",
  },
  {
    tag: [tags.special(tags.variableName), tags.macroName],
    color: "var(--mve-syntax-keyword)",
  },
  {
    tag: tags.definition(tags.propertyName),
    color: "var(--mve-syntax-type)",
  },
  {
    tag: [
      tags.variableName,
      tags.propertyName,
      tags.function(tags.variableName),
    ],
    color: "var(--vscode-editor-foreground)",
  },
  { tag: tags.invalid, color: "var(--vscode-errorForeground)" },
  {
    tag: [
      tags.punctuation,
      tags.paren,
      tags.brace,
      tags.squareBracket,
      tags.separator,
    ],
    color: "var(--mve-syntax-punctuation)",
  },
]);

/**
 * 本文編集面で共有するデータ形状を表すインターフェース。
 */
interface SearchHighlightData {
  /**
   * 本文編集面のhitsに関する状態または設定。
   */
  hits: readonly TextSelection[];

  /**
   * 検索一致装飾の基準となる現在のCodeMirror選択範囲。
   */
  active?: TextSelection;
}

/**
 * 本文編集面の現在状態または履歴を保持するデータ形状。
 */
interface SearchHighlightState extends SearchHighlightData {
  /**
   * 本文編集面のdecorationsに関する状態または設定。
   */
  decorations: DecorationSet;
}

/**
 * 本文編集面で扱う一覧または対応表。
 */
const setSearchHighlights = StateEffect.define<SearchHighlightData>();

/**
 * 本文編集面のsearch・highlight・fieldに関する状態または設定。
 */
const searchHighlightField = StateField.define<SearchHighlightState>({
  create: /**
   * 本文編集面で使う値または実行環境を組み立てる。
   * @returns 本文編集面で生成または変換した値。
   */ () => ({ hits: [], decorations: Decoration.none }),
  /**
   * 本文編集面の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param value - 前回の検索一致範囲とデコレーション。
   * @param transaction - 検索effectと文書変更を含むCodeMirrorトランザクション。
   * @returns 本文編集面のupdateが生成する結果。
   */
  update(value, transaction) {
    let next = value;
    for (const effect of transaction.effects) {
      if (effect.is(setSearchHighlights)) {
        next = {
          ...effect.value,
          decorations: createSearchDecorations(transaction.state, effect.value),
        };
      }
    }
    if (transaction.docChanged && next === value)
      return { hits: [], decorations: Decoration.none };
    return next;
  },

  provide: /**
   * 本文編集面のprovideを処理し、呼び出し側へ結果または副作用を返す。
    * @param field - 検索ハイライト状態とデコレーションを保持するStateField。
   * @returns 本文編集面のprovideが生成する結果。
   */ (field) =>
    EditorView.decorations.from(
      field,
      /**
             * 検索一致の装飾を保持する状態からDecorationsを取り出す。
             * @param value - 検索一致の装飾セットを保持する状態。
             * @returns エディターへ適用する検索一致の装飾セット。
       */
      (value) => value.decorations,
    ),
});

/**
 * 本文編集面で使う値または実行環境を組み立てる。
 * @param state - 現在の編集・表示状態。
 * @param data - 検索一致範囲と現在選択中の一致を含むハイライトデータ。
 * @returns 本文編集面で生成または変換した値。
 */
function createSearchDecorations(
  state: EditorState,
  data: SearchHighlightData,
): DecorationSet {
  const activeKey = data.active ? `${data.active.from}:${data.active.to}` : "";
  const source = state.sliceDoc();
  const ranges = data.hits
    .map(
      /**
       * 検索一致範囲の外部オフセットを本文編集面の座標へ変換する。
       * @param hit - 検索一致のfromを参照する走査対象。
       * @returns fromを取り出した変換結果の一覧。
       */
      (hit) => {
        const from = externalOffsetToEditorValue(source, hit.from);
        const to = externalOffsetToEditorValue(source, hit.to);
        if (to <= from) return undefined;
        const active = `${hit.from}:${hit.to}` === activeKey;
        return Decoration.mark({
          class: active
            ? "cm-search-match cm-search-match-active"
            : "cm-search-match",
        }).range(from, to);
      },
    )
    .filter(
      /**
       * 未定義または無効な範囲を除外する。
       * @param range - 有効性を判定する範囲。
       * @returns 条件を満たした要素だけを含む一覧。
       */
      (range): range is Range<Decoration> => Boolean(range),
    );
  return Decoration.set(ranges);
}

/**
 * 本文編集面のvisible・space・decorationsを処理し、呼び出し側へ結果または副作用を返す。
 * @param view - 文書と可視範囲を参照して空白装飾を作るCodeMirrorビュー。
 * @returns 本文編集面のvisible・space・decorationsが生成する結果。
 */
function visibleSpaceDecorations(view: EditorView): DecorationSet {
  const ranges = [] as Array<{
    /**
     * 本文編集面のfromを表す数値。
     */
    from: number;
    /**
     * 本文編集面のtoを表す数値。
     */
    to: number;
  }>;
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to, "\n");
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === " ") {
        ranges.push({ from: from + index, to: from + index + 1 });
      }
    }
  }
  return Decoration.set(
    ranges.map(
      /**
       * 各設定をmarkへ渡し、変換結果を一覧化する。
       * @returns 入力要素から生成した変換結果の一覧。
       */
      ({ from, to }) =>
        Decoration.mark({ class: "cm-visible-space" }).range(from, to),
    ),
  );
}

/**
 * 本文編集面の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param decorations - 文書変更前の可視空白装飾セット。
 * @param update - 可視範囲・文書変更・新しい文書状態を含むCodeMirror更新通知。
 * @returns 本文編集面のupdate・visible・space・decorationsが生成する結果。
 */
function updateVisibleSpaceDecorations(
  decorations: DecorationSet,
  update: ViewUpdate,
): DecorationSet {
  if (update.viewportChanged) return visibleSpaceDecorations(update.view);
  let next = decorations.map(update.changes);
  update.changes.iterChangedRanges(
    /**
     * ・from・aをifへ渡し、本文編集面の結果または副作用を処理する。
      * @param _fromA - 変更前文書で置換される範囲の開始位置。
      * @param _toA - 変更前文書で置換される範囲の終了位置。
      * @param fromB - 変更後文書で置換された範囲の開始位置。
      * @param toB - 変更後文書で置換された範囲の終了位置。
     * @returns 本文編集面のコールバックが生成する結果。
     */
    (_fromA, _toA, fromB, toB) => {
      const additions: Range<Decoration>[] = [];
      if (toB > fromB) {
        for (const visible of update.view.visibleRanges) {
          const scanFrom = Math.max(fromB, visible.from);
          const scanTo = Math.min(toB, visible.to);
          if (scanTo <= scanFrom) continue;
          const text = update.state.doc.sliceString(scanFrom, scanTo, "\n");
          for (let index = 0; index < text.length; index += 1) {
            if (text[index] === " ") {
              additions.push(
                Decoration.mark({ class: "cm-visible-space" }).range(
                  scanFrom + index,
                  scanFrom + index + 1,
                ),
              );
            }
          }
        }
        // 置換前の空白装飾が変更後の文字へ写像されても残らないよう、変更範囲だけ入れ替える。
        next = next.update({
          filterFrom: fromB,
          filterTo: toB,

          filter: /**
           * 本文編集面のfilterを処理し、呼び出し側へ結果または副作用を返す。
           * @returns 副作用を完了し、値は返さない。
           */ () => false,
          add: additions,
          sort: true,
        });
      }
    },
  );
  return next;
}

/**
 * 本文編集面の条件を示すフラグ。
 */
const visibleSpaces: Extension = ViewPlugin.fromClass(
  class {
    /**
     * 本文編集面のdecorationsに関する状態または設定。
     */
    decorations: DecorationSet;

    /**
     * 本文編集面で使う値または実行環境を組み立てる。
     * @param view - 初期空白装飾を計算するCodeMirrorビュー。
     * @returns 初期化したインスタンス。
     */
    constructor(view: EditorView) {
      this.decorations = visibleSpaceDecorations(view);
    }

    /**
     * 本文編集面の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param update - 文書または表示範囲の変更を知らせるCodeMirror更新通知。
     * @returns 副作用を完了し、値は返さない。
     */
    update(update: ViewUpdate): void {
      if (update.docChanged) {
        this.decorations = updateVisibleSpaceDecorations(
          this.decorations,
          update,
        );
      } else if (update.viewportChanged) {
        this.decorations = visibleSpaceDecorations(update.view);
      }
    }
  },
  {
    decorations: /**
     * 本文編集面のdecorationsを処理し、呼び出し側へ結果または副作用を返す。
     * @param value - 検索一致範囲とデコレーションを持つ現在の状態。
     * @returns 本文編集面のdecorationsが生成する結果。
     */ (value) => value.decorations,
  },
);

/**
 * 本文編集面で共有するデータ形状を表すインターフェース。
 */
interface Props {
  /**
   * 本文編集面で扱うmessagesの一覧。
   */
  messages: Messages;

  /**
   * CodeMirrorへ表示して編集するMarkdown本文。
   */
  value: string;

  /**
   * 本文編集面のinitial・selectionに関する状態または設定。
   */
  initialSelection?: TextSelection;

  /**
   * 本文編集面のsearch・hitsに関する状態または設定。
   */
  searchHits?: readonly TextSelection[];

  /**
   * 検索結果一覧で現在選択中のTextSelection。
   */
  activeSearchHit?: TextSelection;
  /**
   * 本文編集面のイベントまたはメッセージを受け取り、状態を更新する。
    * @param beforeValue - 編集前のMarkdown本文。
    * @param value - 編集後のMarkdown本文。
    * @param changes - 編集前本文に対する変更範囲と挿入文字列の一覧。
    * @param isCompositionCommit - IME変換を確定した変更ならtrue。
   * @returns 副作用を完了し、値は返さない。
   */
  onChange: (
    beforeValue: string,
    value: string,
    changes: TextChange[],
    isCompositionCommit?: boolean,
  ) => void;
  /**
   * 本文編集面のイベントまたはメッセージを受け取り、状態を更新する。
   * @returns 副作用を完了し、値は返さない。
   */
  onInputActivity?: () => void;
  /**
   * 本文編集面のイベントまたはメッセージを受け取り、状態を更新する。
   * @returns 副作用を完了し、値は返さない。
   */
  onSettled?: () => void;
  /**
   * 本文編集面のイベントまたはメッセージを受け取り、状態を更新する。
    * @param selection - 本文上の開始・終了オフセットで表す選択範囲。
   * @returns 副作用を完了し、値は返さない。
   */
  onSelectionChange?: (selection: TextSelection) => void;

  /**
   * 本文編集面で扱うclass・nameの文字列。
   */
  className?: string;

  /**
   * 入力欄に値がないときに表示する案内文。
   */
  placeholder?: string;
  /**
   * 本文編集面のイベントまたはメッセージを受け取り、状態を更新する。
    * @param anchor - 本文エディターで取得した可視位置アンカー。
    * @param userInitiated - スクロールがユーザー操作で始まった場合はtrue。
   * @returns 副作用を完了し、値は返さない。
   */
  onViewportChange?: (
    anchor: EditorViewportAnchor,
    userInitiated: boolean,
  ) => void;
  /**
   * 本文編集面のイベントまたはメッセージを受け取り、状態を更新する。
   * @returns 副作用を完了し、値は返さない。
   */
  onUserScrollIntent?: () => void;
}

/**
 * 本文編集面で解析・表示・保存する本文。
 */
const SourceEditorView = forwardRef<TextEditorHandle, Props>(
  /**
   * CodeMirrorを使った本文編集面を表示し、入力と選択をHostへ通知するコンポーネント。
   * @param messages - エディター内で表示するローカライズ済み文言。
   * @param value - エディターに表示するMarkdown本文。
   * @param initialSelection - エディター初期表示時に選択する本文範囲。
   * @param searchHits - 本文内で強調する検索一致範囲の一覧。
   * @param activeSearchHit - 現在選択中の検索一致範囲。
   * @param onChange - 本文変更と、その変更範囲およびIME確定状態を親へ通知する処理。
   * @param onInputActivity - 本文入力が発生したことを親へ通知する処理。
   * @param onSettled - 入力後の確定処理を親へ通知する処理。
   * @param onSelectionChange - 選択範囲の変更を親へ通知する処理。
   * @param className - エディーター要素に追加するCSSクラス名。
   * @param placeholder - 本文が空のときに表示する案内文。
   * @param onViewportChange - エディターの表示位置とユーザー操作状態を親へ通知する処理。
   * @param onUserScrollIntent - ユーザー起点のスクロールを親へ通知する処理。
   * @param ref - 親からエディターの公開メソッドを呼び出すRef。
   * @returns 本文編集面のsource・editorが生成する結果。
   */
  function SourceEditor(
    {
      messages,
      value,
      initialSelection,
      searchHits = [],
      activeSearchHit,
      onChange,
      onInputActivity,
      onSettled,
      onSelectionChange,
      className = "",
      placeholder = messages.editor.placeholder,
      onViewportChange,
      onUserScrollIntent,
    },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | undefined>(undefined);
    const suppressRef = useRef(false);
    const onChangeRef = useRef(onChange);
    const inputActivityRef = useRef(onInputActivity);
    const onSettledRef = useRef(onSettled);
    const selectionRef = useRef(onSelectionChange);
    const viewportRef = useRef(onViewportChange);
    const viewportIntentRef = useRef(onUserScrollIntent);
    const userScrollPendingRef = useRef(false);
    const pointerScrollActiveRef = useRef(false);
    const touchScrollActiveRef = useRef(false);
    const programmaticScrollPendingRef = useRef(false);
    const viewportRestoreGenerationRef = useRef(0);
    const viewportRestoreAnchorRef = useRef<EditorViewportAnchor | undefined>(
      undefined,
    );
    const viewportRestoreActiveRef = useRef(false);
    const compositionActiveRef = useRef(false);
    const compositionSessionRef = useRef<
      | {
          /**
           * 本文編集面で扱うbefore・valueの文字列。
           */
          beforeValue: string;

          /**
           * 本文編集面のfromを表す数値。
           */
          from: number;

          /**
           * 本文編集面のtoを表す数値。
           */
          to: number;

          /**
           * 本文編集面のchangedを切り替えるフラグ。
           */
          changed: boolean;
        }
      | undefined
    >(undefined);
    const compositionHandoffRef = useRef<
      | {
          /**
           * 本文編集面で扱うbefore・valueの文字列。
           */
          beforeValue: string;

          /**
           * 本文編集面で扱うdeferred・valueの文字列。
           */
          deferredValue?: string;
        }
      | undefined
    >(undefined);
    const lineSeparatorCompartmentRef = useRef(new Compartment());
    const lastSynchronizedValueRef = useRef(value);
    const deferredValueRef = useRef<string | undefined>(undefined);
    const compositionEndTimerRef = useRef<number | undefined>(undefined);
    const inputSettledTimerRef = useRef<number | undefined>(undefined);
    const [compositionNonce, setCompositionNonce] = useState(0);
    onChangeRef.current = onChange;
    inputActivityRef.current = onInputActivity;
    onSettledRef.current = onSettled;
    selectionRef.current = onSelectionChange;
    viewportRef.current = onViewportChange;
    viewportIntentRef.current = onUserScrollIntent;

    useEffect(
      /**
       * 依存状態の変化に応じて表示または購読を更新する。
       * @returns 副作用を完了し、値は返さない。
       */
      () => {
        if (!hostRef.current) return;
        let selectionFrame = 0;
        let pendingSelection: TextSelection | undefined;

        const publishSelection = /**
         * 選択範囲を一時保存し、次の描画フレームで親へ通知する。
         * @param nextSelection 次の描画フレームで通知する選択範囲。
         * @returns 副作用を完了し、値は返さない。
         */ (nextSelection: TextSelection) => {
          pendingSelection = nextSelection;
          if (selectionFrame) return;
          selectionFrame = window.requestAnimationFrame(
            /**
             * 次の描画フレームで表示更新を実行する。
             * @returns 副作用を完了し、値は返さない。
             */
            () => {
              selectionFrame = 0;
              const selection = pendingSelection;
              pendingSelection = undefined;
              if (selection) selectionRef.current?.(selection);
            },
          );
        };
        const state = EditorState.create({
          doc: value,
          selection: initialSelection
            ? EditorSelection.range(
                externalOffsetToEditorValue(value, initialSelection.from),
                externalOffsetToEditorValue(value, initialSelection.to),
              )
            : undefined,
          extensions: [
            lineSeparatorCompartmentRef.current.of(
              EditorState.lineSeparator.of(detectLineSeparator(value)),
            ),
            lineNumbers(),
            markdownLanguage({ codeLanguages: sourceCodeLanguages }),
            // 標準スタイルは濃い青を含むため使わず、明るいテーマ配色を1つだけ適用する。
            syntaxHighlighting(vscodeSyntaxHighlightStyle),
            htmlUrlAttributeHighlightExtension,
            visibleSpaces,
            exactSelectionMatchExtension,
            searchHighlightField,
            placeholderExtension(placeholder),
            keymap.of([...defaultKeymap, indentWithTab]),
            EditorView.lineWrapping,
            EditorView.updateListener.of(
              /**
               * 状態更新をsomeへ渡し、本文編集面の結果または副作用を処理する。
                * @param update - 文書・選択・トランザクション・変更範囲を含むCodeMirror更新通知。
               * @returns 本文編集面のコールバックが生成する結果。
               */
              (update) => {
                const isExternalSync = update.transactions.some(
                  /**
                   * transactionをannotationへ渡し、本文編集面の結果または副作用を処理する。
                    * @param transaction - 外部同期annotationの有無を調べるトランザクション。
                   * @returns 本文編集面のコールバックが生成する結果。
                   */
                  (transaction) =>
                    transaction.annotation(externalSyncTransaction) === true,
                );
                const isUserDocumentChange =
                  update.docChanged && !suppressRef.current && !isExternalSync;
                const compositionSession = compositionSessionRef.current;

                // 変換途中の文書変更はCodeMirrorの内部だけで即時に反映する。
                // 候補の更新ごとに親・ホストへ送ると差分の再配置が割り込み、確定文字列の
                // 順序やキャレットを壊す。開始本文から確定本文への単一差分だけを送る。
                if (
                  compositionActiveRef.current &&
                  isUserDocumentChange &&
                  compositionSession
                ) {
                  compositionSessionRef.current = {
                    ...compositionSession,
                    from: update.changes.mapPos(compositionSession.from, -1),
                    to: update.changes.mapPos(compositionSession.to, 1),
                    changed: true,
                  };
                  inputActivityRef.current?.();
                  if (inputSettledTimerRef.current !== undefined) {
                    window.clearTimeout(inputSettledTimerRef.current);
                    inputSettledTimerRef.current = undefined;
                  }
                  viewportRestoreAnchorRef.current = undefined;
                  viewportRestoreGenerationRef.current += 1;
                  if (hostRef.current)
                    hostRef.current.dataset.documentLength = String(
                      externalDocumentLength(update.state),
                    );
                }

                // 変換中の選択通知も親の再描画・装飾更新の入口になるため、確定時まで隔離する。
                if (update.selectionSet && !compositionActiveRef.current) {
                  const main = update.state.selection.main;
                  publishSelectionData(hostRef.current, update.state);
                  publishSelection({
                    from: editorOffsetToExternal(update.state, main.from),
                    to: editorOffsetToExternal(update.state, main.to),
                  });
                }

                if (isUserDocumentChange && !compositionActiveRef.current) {
                  inputActivityRef.current?.();
                  if (inputSettledTimerRef.current !== undefined)
                    window.clearTimeout(inputSettledTimerRef.current);
                  inputSettledTimerRef.current = window.setTimeout(
                    /**
                     * 指定時間の経過後に後続処理を実行する。
                     * @returns 副作用を完了し、値は返さない。
                     */
                    () => {
                      inputSettledTimerRef.current = undefined;
                      onSettledRef.current?.();
                    },
                    220,
                  );
                  viewportRestoreAnchorRef.current = undefined;
                  viewportRestoreGenerationRef.current += 1;
                  let changes: TextChange[] = [];
                  update.changes.iterChanges(
                    /**
                     * from・aを一覧追加へ渡し、本文編集面の結果または副作用を処理する。
                      * @param fromA - 変更前文書で置換される範囲の開始位置。
                      * @param toA - 変更前文書で置換される範囲の終了位置。
                      * @param _fromB - 変更後文書で挿入範囲の開始位置。
                      * @param _toB - 変更後文書で挿入範囲の終了位置。
                      * @param inserted - 変更範囲へ挿入されたCodeMirrorテキスト。
                     * @returns 本文編集面のコールバックが生成する結果。
                     */
                    (fromA, toA, _fromB, _toB, inserted) => {
                      changes.push({
                        rangeOffset: editorOffsetToExternal(
                          update.startState,
                          fromA,
                        ),
                        rangeLength: update.startState.sliceDoc(fromA, toA)
                          .length,
                        text: inserted.sliceString(
                          0,
                          inserted.length,
                          update.state.facet(EditorState.lineSeparator) ?? "\n",
                        ),
                      });
                    },
                  );
                  if (isMveDebugEnabled()) {
                    mveDebug("source.doc-changed", {
                      changeCount: changes.length,
                      changes: changes.slice(0, 8),
                      nextLength: externalDocumentLength(update.state),
                      selection: update.state.selection.main
                        ? {
                            from: editorOffsetToExternal(
                              update.state,
                              update.state.selection.main.from,
                            ),
                            to: editorOffsetToExternal(
                              update.state,
                              update.state.selection.main.to,
                            ),
                          }
                        : undefined,
                    });
                  }
                  const nextValue = externalDocumentValue(update.state);
                  const beforeValue = externalDocumentValue(update.startState);
                  if (hostRef.current)
                    hostRef.current.dataset.documentLength = String(
                      nextValue.length,
                    );
                  onChangeRef.current(beforeValue, nextValue, changes);
                }
              },
            ),
            EditorView.theme({
              "&": {
                height: "100%",
                color: "var(--vscode-editor-foreground)",
                backgroundColor: "transparent",
                fontFamily:
                  "var(--mve-editor-font-family, var(--vscode-editor-font-family, monospace))",
              },
              ".cm-content": {
                caretColor: "var(--vscode-editorCursor-foreground)",
                padding: "18px 24px 42px",
                fontFamily:
                  "var(--mve-editor-font-family, var(--vscode-editor-font-family, monospace))",
              },
              ".cm-gutters": {
                backgroundColor: "var(--vscode-editor-background)",
                color: "var(--vscode-editorLineNumber-foreground)",
                border: "none",
              },
              ".cm-activeLine": {
                backgroundColor: "var(--vscode-editor-lineHighlightBackground)",
              },
              ".cm-activeLineGutter": {
                backgroundColor: "var(--vscode-editor-lineHighlightBackground)",
              },
              "&.cm-focused": { outline: "none" },
              ".cm-selectionBackground, ::selection": {
                backgroundColor:
                  "var(--vscode-editor-selectionBackground) !important",
              },
            }),
          ],
        });
        const view = new EditorView({ state, parent: hostRef.current });
        hostRef.current.dataset.documentLength = String(
          view.state.sliceDoc().length,
        );
        // スクロール・履歴・IMEの各DOMイベントを購読し、レイアウト変化を検知する。

        const markUserScrollIntent = /**
         * 本文編集面の変更または利用者の操作意図を記録し、後続処理へ渡す。
         * @returns 本文編集面のmark・user・scroll・intentが生成する結果。
         */ () => {
          viewportRestoreGenerationRef.current += 1;
          viewportRestoreAnchorRef.current = undefined;
          viewportRestoreActiveRef.current = false;
          programmaticScrollPendingRef.current = false;
          userScrollPendingRef.current = true;
          viewportIntentRef.current?.();
        };

        const beginPointerScroll = /**
         * 本文編集面の表示または操作を開始する。
         * @returns 本文編集面のbegin・pointer・scrollが生成する結果。
         */ () => {
          markUserScrollIntent();
          pointerScrollActiveRef.current = true;
        };

        const endPointerScroll = /**
         * 本文編集面のend・pointer・scrollを処理し、呼び出し側へ結果または副作用を返す。
         * @returns 本文編集面のend・pointer・scrollが生成する結果。
         */ () => {
          pointerScrollActiveRef.current = false;
        };

        const beginTouchScroll = /**
         * 本文編集面の表示または操作を開始する。
         * @returns 本文編集面のbegin・touch・scrollが生成する結果。
         */ () => {
          markUserScrollIntent();
          touchScrollActiveRef.current = true;
        };

        const endTouchScroll = /**
         * 本文編集面のend・touch・scrollを処理し、呼び出し側へ結果または副作用を返す。
         * @returns 本文編集面のend・touch・scrollが生成する結果。
         */ () => {
          touchScrollActiveRef.current = false;
        };

        const scheduleInputSettled = /**
         * 本文編集面の処理順序と完了状態を管理する。
         * @returns 本文編集面のschedule・input・settledが生成する結果。
         */ () => {
          inputActivityRef.current?.();
          if (inputSettledTimerRef.current !== undefined)
            window.clearTimeout(inputSettledTimerRef.current);
          inputSettledTimerRef.current = window.setTimeout(
            /**
             * 指定時間の経過後に後続処理を実行する。
             * @returns 副作用を完了し、値は返さない。
             */
            () => {
              inputSettledTimerRef.current = undefined;
              onSettledRef.current?.();
            },
            220,
          );
        };

        const settleComposition = /**
         * 本文編集面の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
         * @returns 本文編集面のsettle・compositionが生成する結果。
         */ () => {
          if (!compositionActiveRef.current) return;
          if (compositionEndTimerRef.current !== undefined)
            window.clearTimeout(compositionEndTimerRef.current);
          compositionEndTimerRef.current = undefined;
          const compositionSession = compositionSessionRef.current;
          compositionSessionRef.current = undefined;
          const main = view.state.selection.main;
          const strandedAtStart = Boolean(
            compositionSession &&
            compositionSession.changed &&
            compositionSession.to > compositionSession.from &&
            main.empty &&
            main.head === compositionSession.from,
          );
          const selection = strandedAtStart
            ? view.state.selection.replaceRange(
                EditorSelection.cursor(compositionSession!.to),
              )
            : view.state.selection;
          // 同じ選択でも明示的に確定し、ブラウザーDOMのcaretとCodeMirror状態を再結合する。
          view.dispatch({ selection });
          const committedValue = externalDocumentValue(view.state);
          const hasCommittedChange = Boolean(
            compositionSession?.changed &&
            committedValue !== compositionSession.beforeValue,
          );
          if (hasCommittedChange && compositionSession) {
            // 変換中に届いた親valueは確定前のスナップショットなので、確定直後に本文へ
            // 書き戻さない。Appがこの操作を再配置した最終本文だけを受け入れる。
            compositionHandoffRef.current = {
              beforeValue: compositionSession.beforeValue,
              deferredValue: deferredValueRef.current,
            };
            scheduleInputSettled();
            viewportRestoreAnchorRef.current = undefined;
            viewportRestoreGenerationRef.current += 1;
            if (hostRef.current)
              hostRef.current.dataset.documentLength = String(
                committedValue.length,
              );
            const changes = computeTextChanges(
              compositionSession.beforeValue,
              committedValue,
            );
            if (isMveDebugEnabled()) {
              mveDebug("source.composition-commit", {
                changeCount: changes.length,
                changes: changes.slice(0, 8),
                nextLength: committedValue.length,
              });
            }
            compositionActiveRef.current = false;
            onChangeRef.current(
              compositionSession.beforeValue,
              committedValue,
              changes,
              true,
            );
          } else {
            compositionActiveRef.current = false;
          }
          publishSelectionData(hostRef.current, view.state);
          const settled = view.state.selection.main;
          publishSelection({
            from: editorOffsetToExternal(view.state, settled.from),
            to: editorOffsetToExternal(view.state, settled.to),
          });
          setCompositionNonce(
            /**
             * 本文編集面のコールバックとして値を処理する。
     * @param value - 検索一致範囲とデコレーションを持つ現在の状態。
             * @returns 本文編集面のコールバックが生成する結果。
             */
            (value) => value + 1,
          );
        };

        const beginComposition = /**
         * 本文編集面の表示または操作を開始する。
         * @returns 本文編集面のbegin・compositionが生成する結果。
         */ () => {
          // 直前のcompositionendと次の入力開始が連続した場合も、前回分を失わず先に確定する。
          if (compositionEndTimerRef.current !== undefined) settleComposition();
          if (compositionActiveRef.current) return;
          const selection = view.state.selection.main;
          compositionActiveRef.current = true;
          compositionSessionRef.current = {
            beforeValue: externalDocumentValue(view.state),
            from: selection.from,
            to: selection.to,
            changed: false,
          };
        };

        const endComposition = /**
         * 本文編集面のend・compositionを処理し、呼び出し側へ結果または副作用を返す。
         * @returns 本文編集面のend・compositionが生成する結果。
         */ () => {
          if (compositionEndTimerRef.current !== undefined)
            window.clearTimeout(compositionEndTimerRef.current);
          compositionEndTimerRef.current = window.setTimeout(
            /**
             * 指定時間の経過後に後続処理を実行する。
             * @returns 副作用を完了し、値は返さない。
             */
            () => {
              settleComposition();
            },
            0,
          );
        };

        const settleBeforeNextKey = /**
         * 本文編集面の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
         * @param event - 確定待ちIME compositionを次の非合成keydown前に確定するkeyboard event。
         * @returns 副作用を完了し、値は返さない。
         */ (event: KeyboardEvent) => {
          if (compositionEndTimerRef.current === undefined || event.isComposing)
            return;
          settleComposition();
        };

        const publishViewport = /**
         * 本文編集面のpublish・viewportを処理し、呼び出し側へ結果または副作用を返す。
         * @param anchor - 復元後に上位へ通知する可視位置アンカー。
         * @returns 本文編集面のpublish・viewportが生成する結果。
         */ (anchor: EditorViewportAnchor) =>
          publishViewportData(hostRef.current, anchor);
        let scrollFrame = 0;
        let pendingUserScroll = false;

        const handleScroll = /**
         * ユーザー起点のスクロールを識別し、反対側の表示位置へ同期する。
         * @returns 副作用を完了し、値は返さない。
         */ () => {
          const programmatic = programmaticScrollPendingRef.current;
          // CodeMirrorの差分写像・復元は複数の遅延scrollイベントを発生させる。
          // 1件目では解除せず、wheel/pointer/touch/keyboardの明示入力時だけ
          // markUserScrollIntentで解除して逆方向同期を防ぐ。
          const userInitiated =
            !programmatic && !viewportRestoreActiveRef.current;
          pendingUserScroll ||= userInitiated;
          userScrollPendingRef.current = false;
          if (scrollFrame) return;
          scrollFrame = window.requestAnimationFrame(
            /**
             * 次の描画フレームで表示更新を実行する。
             * @returns 本文編集面のコールバックが生成する結果。
             */
            () => {
              const startedAt = performance.now();
              scrollFrame = 0;
              const notifyAsUserScroll = pendingUserScroll;
              pendingUserScroll = false;
              const anchor = readViewport(view);
              if (!anchor) return;
              publishViewport(anchor);
              if (notifyAsUserScroll)
                viewportRestoreAnchorRef.current = { ...anchor };
              viewportRef.current?.(anchor, notifyAsUserScroll);
              performance.clearMeasures("mve-source-scroll-sync");
              performance.measure("mve-source-scroll-sync", {
                start: startedAt,
                end: performance.now(),
              });
            },
          );
        };
        view.scrollDOM.addEventListener("scroll", handleScroll, {
          passive: true,
        });
        view.scrollDOM.addEventListener("wheel", markUserScrollIntent, {
          passive: true,
        });
        view.scrollDOM.addEventListener("pointerdown", beginPointerScroll, {
          passive: true,
        });
        view.scrollDOM.addEventListener("touchstart", beginTouchScroll, {
          passive: true,
        });
        view.scrollDOM.addEventListener("keydown", markUserScrollIntent);
        view.contentDOM.addEventListener("keydown", settleBeforeNextKey, true);
        view.contentDOM.addEventListener("compositionstart", beginComposition);
        view.contentDOM.addEventListener("compositionend", endComposition);
        window.addEventListener("pointerup", endPointerScroll);
        window.addEventListener("pointercancel", endPointerScroll);
        window.addEventListener("touchend", endTouchScroll);
        window.addEventListener("touchcancel", endTouchScroll);
        const resizeObserver = new ResizeObserver(
          /**
           * 要素をifへ渡し、本文編集面の結果または副作用を処理する。
           * @returns 本文編集面のコールバックが生成する結果。
           */
          () => {
            // レイアウトサイズ変更後に保存済み表示位置を復元し、復元対象がなければ現在位置を再通知する。
            const restoreAnchor = viewportRestoreAnchorRef.current;
            if (restoreAnchor) {
              const generation = ++viewportRestoreGenerationRef.current;
              restoreViewportUntilSettled(
                view,
                restoreAnchor,
                hostRef.current,
                programmaticScrollPendingRef,

                /**
                 * 本文編集面のコールバックとして要素を処理する。
                 * @returns 本文編集面のコールバックが生成する結果。
                 */
                () => viewportRestoreGenerationRef.current === generation,

                /**
                 * 本文編集面のコールバックとしてrestoredを処理する。
                  * @param restored - 復元処理が確定した本文編集面の可視位置アンカー。
                 * @returns 本文編集面のコールバックが生成する結果。
                 */
                (restored) => viewportRef.current?.(restored, false),

                /**
                 * 本文編集面のコールバックとして要素を処理する。
                 * @returns 本文編集面のコールバックが生成する結果。
                 */
                () => {
                  viewportRestoreActiveRef.current = false;
                },
              );
              return;
            }
            view.requestMeasure({
              read: /**
               * 本文編集面から必要な値またはリソースを取得する。
               * @returns 本文編集面のreadが生成する結果。
               */ () => readViewport(view),

              write: /**
               * 本文編集面の値を保存先または共有状態へ書き出す。
                * @param anchor - read段階で計測した可視位置アンカー。未計測時はundefined。
               * @returns 副作用を完了し、値は返さない。
               */ (anchor) => {
                if (anchor) publishViewport(anchor);
              },
            });
          },
        );
        resizeObserver.observe(view.scrollDOM);
        viewRef.current = view;
        publishSelectionData(hostRef.current, view.state);
        view.requestMeasure({
          read: /**
           * 本文編集面から必要な値またはリソースを取得する。
           * @returns 本文編集面のreadが生成する結果。
           */ () => readViewport(view),

          write: /**
           * 本文編集面の値を保存先または共有状態へ書き出す。
           * @param anchor - 初回計測で得た可視位置アンカー。未計測時はundefined。
           * @returns 副作用を完了し、値は返さない。
           */ (anchor) => {
            if (anchor) publishViewport(anchor);
          },
        });
        /**
         * 本文編集面のreturnを処理し、呼び出し側へ結果または副作用を返す。
         * @returns 本文編集面のreturnが生成する結果。
         */
        return () => {
          // 入力settledタイマーを破棄する前に親へ完了通知し、ビュー切替直前の入力で
          // bodyの入力中フラグやプレビュー待機処理が残留しないようにする。
          onSettledRef.current?.();
          // アンマウント時にすべてのイベント購読・Observer・CodeMirrorビューを破棄する。
          view.scrollDOM.removeEventListener("scroll", handleScroll);
          view.scrollDOM.removeEventListener("wheel", markUserScrollIntent);
          view.scrollDOM.removeEventListener("pointerdown", beginPointerScroll);
          view.scrollDOM.removeEventListener("touchstart", beginTouchScroll);
          view.scrollDOM.removeEventListener("keydown", markUserScrollIntent);
          view.contentDOM.removeEventListener(
            "keydown",
            settleBeforeNextKey,
            true,
          );
          view.contentDOM.removeEventListener(
            "compositionstart",
            beginComposition,
          );
          view.contentDOM.removeEventListener("compositionend", endComposition);
          if (compositionEndTimerRef.current !== undefined)
            window.clearTimeout(compositionEndTimerRef.current);
          compositionActiveRef.current = false;
          compositionSessionRef.current = undefined;
          compositionHandoffRef.current = undefined;
          window.removeEventListener("pointerup", endPointerScroll);
          window.removeEventListener("pointercancel", endPointerScroll);
          window.removeEventListener("touchend", endTouchScroll);
          window.removeEventListener("touchcancel", endTouchScroll);
          if (inputSettledTimerRef.current !== undefined)
            window.clearTimeout(inputSettledTimerRef.current);
          resizeObserver.disconnect();
          if (selectionFrame) window.cancelAnimationFrame(selectionFrame);
          if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
          view.destroy();
          viewRef.current = undefined;
        };
      },
      [],
    );

    useEffect(
      /**
       * 依存状態の変化に応じて表示または購読を更新する。
       * @returns 本文編集面のコールバックが生成する結果。
       */
      () => {
        // 親から本文が変わったとき、IME入力中でなければ外部同期トランザクションとして反映する。
        const view = viewRef.current;
        if (!view) return;
        if (compositionActiveRef.current) {
          deferredValueRef.current = value;
          return;
        }
        const shouldSynchronize = value !== lastSynchronizedValueRef.current;
        lastSynchronizedValueRef.current = value;
        const currentValue = externalDocumentValue(view.state);
        const compositionHandoff = compositionHandoffRef.current;
        if (compositionHandoff) {
          // Appが確定操作を再配置した本文を返した時だけ、変換中に保留した外部変更を
          // CodeMirrorへ反映する。確定前の親スナップショットを優先して巻き戻してはいけない。
          if (currentValue === value) {
            compositionHandoffRef.current = undefined;
            deferredValueRef.current = undefined;
            return;
          }
          if (
            value === compositionHandoff.beforeValue ||
            value === compositionHandoff.deferredValue
          )
            return;
          compositionHandoffRef.current = undefined;
        }
        deferredValueRef.current = undefined;
        if (!shouldSynchronize) return;
        if (currentValue === value) return;
        // CodeMirror内部は改行を1文字で保持する。外部文書の改行形式を変更する場合も、
        // 内部LFオフセットで差分を作ってからlineSeparatorを同一トランザクションで切り替える。
        const currentEditorValue = view.state.doc.sliceString(
          0,
          view.state.doc.length,
          "\n",
        );
        const nextEditorValue = normalizeLineEndings(value);
        const changes = computeTextChanges(currentEditorValue, nextEditorValue);
        const editorChanges = changes.map(
          /**
           * 各changeからrange・offsetを取り出して一覧化する。
           * @param change - changeのrange・offsetを参照する走査対象。
           * @returns range・offsetを取り出した変換結果の一覧。
           */
          (change) => ({
            from: change.rangeOffset,
            to: change.rangeOffset + change.rangeLength,
            insert: toEditorInsertion(view.state, change.text),
          }),
        );
        const changeSet = view.state.changes(editorChanges);
        const snapshot =
          view.scrollDOM.clientHeight > 0
            ? view.scrollSnapshot().map(changeSet)
            : undefined;
        const nextLineSeparator = detectLineSeparator(value);
        const lineSeparatorEffect =
          lineSeparatorCompartmentRef.current.reconfigure(
            EditorState.lineSeparator.of(nextLineSeparator),
          );
        // 本文差分にはCodeMirror標準のscrollSnapshot写像を使う。リサイズ用の古い
        // アンカーを残すとResizeObserverが変更前オフセットへ二重復元してしまう。
        viewportRestoreGenerationRef.current += 1;
        viewportRestoreAnchorRef.current = undefined;
        viewportRestoreActiveRef.current = false;
        if (snapshot) programmaticScrollPendingRef.current = true;
        suppressRef.current = true;
        view.dispatch({
          changes: changeSet,
          effects: snapshot
            ? [snapshot, lineSeparatorEffect]
            : [lineSeparatorEffect],
          annotations: [externalSyncTransaction.of(true)],
        });
        suppressRef.current = false;
        if (hostRef.current) {
          const synchronizedValue = externalDocumentValue(view.state);
          hostRef.current.dataset.documentLength = String(
            synchronizedValue.length,
          );
          if (synchronizedValue !== value) {
            hostRef.current.dataset.documentMismatch = JSON.stringify(
              computeTextChanges(value, synchronizedValue),
            );
          } else {
            delete hostRef.current.dataset.documentMismatch;
          }
        }
        view.requestMeasure({
          read: /**
           * 本文編集面から必要な値またはリソースを取得する。
           * @returns 本文編集面のreadが生成する結果。
           */ () => readViewport(view),

          write: /**
           * 本文編集面の値を保存先または共有状態へ書き出す。
           * @param anchor - 更新後に計測した可視位置アンカー。未計測時はundefined。
           * @returns 副作用を完了し、値は返さない。
           */ (anchor) => {
            if (anchor) publishViewportData(hostRef.current, anchor);
          },
        });
        const currentSelection = view.state.selection.main;
        selectionRef.current?.({
          from: editorOffsetToExternal(view.state, currentSelection.from),
          to: editorOffsetToExternal(view.state, currentSelection.to),
        });
        publishSelectionData(hostRef.current, view.state);
      },
      [value, compositionNonce],
    );

    useEffect(
      /**
       * 依存状態の変化に応じて表示または購読を更新する。
       * @returns 本文編集面のコールバックが生成する結果。
       */
      () => {
        // composition中は編集DOMへ装飾トランザクションを割り込ませず、確定後に最新結果だけを反映する。
        const view = viewRef.current;
        if (!view || compositionActiveRef.current) return;
        view.dispatch({
          effects: setSearchHighlights.of({
            hits: searchHits,
            active: activeSearchHit,
          }),
        });
      },
      [searchHits, activeSearchHit, compositionNonce],
    );

    useImperativeHandle(
      ref,
      /**
       * 要素をreplace・selectionへ渡し、本文編集面の結果または副作用を処理する。
       * @returns 本文編集面のコールバックが生成する結果。
       */
      () => ({
        insert: /**
         * 本文編集面の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
         * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
         * @returns 本文編集面のinsertが生成する結果。
         */ (markdown) => replaceSelection(markdown),

        applyEdit: /**
         * 本文編集面の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
         * @param edit - 編集後の本文と適用後の選択範囲。
         * @returns 本文編集面のapply・editが生成する結果。
         */ (edit) => applyEdit(edit),

        action: /**
         * 本文編集面のactionを処理し、呼び出し側へ結果または副作用を返す。
         * @param action - 適用する装飾、リスト、ブロック挿入などの操作種別。
         * @returns 本文編集面のactionが生成する結果。
         */ (action) => applyAction(action),

        codeBlock: /**
         * 本文編集面のcode・blockを処理し、呼び出し側へ結果または副作用を返す。
         * @param language - 本文編集面の対象や分岐を識別する値。
         * @returns 本文編集面のcode・blockが生成する結果。
         */ (language = "") => applyCodeBlock(language),

        heading: /**
         * 本文編集面のheadingを処理し、呼び出し側へ結果または副作用を返す。
         * @param level - 挿入する見出しのレベル（1から6）。
         * @returns 本文編集面のheadingが生成する結果。
         */ (level) => applyHeading(level),

        link: /**
         * 本文編集面のlinkを処理し、呼び出し側へ結果または副作用を返す。
         * @param href - リンク操作領域の遷移先URI。
         * @param label - 画面または検証結果に表示する説明文。
         * @returns 本文編集面のlinkが生成する結果。
         */ (href, label = messages.editor.defaultLinkLabel) => {
          const view = viewRef.current;
          if (!view) return;
          const main = view.state.selection.main;
          const selection = {
            from: editorOffsetToExternal(view.state, main.from),
            to: editorOffsetToExternal(view.state, main.to),
          };
          const source = view.state.sliceDoc();
          const selected = source.slice(selection.from, selection.to) || label;
          applyEdit(
            wrapSelection(source, selection, "[", `](${href})`, selected),
          );
        },

        getSelection: /**
         * 本文編集面から必要な値またはリソースを取得する。
         * @returns 本文編集面のget・selectionが生成する結果。
         */ () => {
          const view = viewRef.current;
          const main = view?.state.selection.main;
          return view && main
            ? {
                from: editorOffsetToExternal(view.state, main.from),
                to: editorOffsetToExternal(view.state, main.to),
              }
            : { from: 0, to: 0 };
        },

        setSelection: /**
         * 本文編集面の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
         * @param selection - 本文上の開始・終了オフセットで指定する選択範囲。
         * @returns 副作用を完了し、値は返さない。
         */ (selection) => {
          const view = viewRef.current;
          if (!view) return;
          view.dispatch({
            selection: EditorSelection.range(
              externalOffsetToEditor(view.state, selection.from),
              externalOffsetToEditor(view.state, selection.to),
            ),
          });
        },

        revealRange: /**
         * 本文編集面の表示または操作を開始する。
         * @param selection - 表示位置へ移動する本文上の選択範囲。
         * @returns 副作用を完了し、値は返さない。
         */ (selection) => {
          const view = viewRef.current;
          if (!view) return;
          viewportRestoreAnchorRef.current = undefined;
          viewportRestoreActiveRef.current = false;
          viewportRestoreGenerationRef.current += 1;
          const from = externalOffsetToEditor(view.state, selection.from);
          const to = externalOffsetToEditor(view.state, selection.to);
          programmaticScrollPendingRef.current = true;
          view.dispatch({
            effects: EditorView.scrollIntoView(
              EditorSelection.range(from, to),
              {
                y: "center",
              },
            ),
          });
        },

        getViewport: /**
         * 本文編集面から必要な値またはリソースを取得する。
         * @returns 条件に一致する値。未検出時はundefinedまたはnull。
         */ () => {
          const view = viewRef.current;
          return view ? readViewport(view) : undefined;
        },

        restoreViewport: /**
         * 本文編集面の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
         * @param anchor - 本文編集面で復元する可視位置アンカー。
         * @returns 本文編集面のrestore・viewportが生成する結果。
         */ (anchor) => {
          const view = viewRef.current;
          if (!view || view.scrollDOM.clientHeight === 0) return;
          viewportRestoreAnchorRef.current = { ...anchor };
          viewportRestoreActiveRef.current = true;
          const generation = ++viewportRestoreGenerationRef.current;
          restoreViewportUntilSettled(
            view,
            anchor,
            hostRef.current,
            programmaticScrollPendingRef,

            /**
             * 本文編集面のコールバックとして要素を処理する。
             * @returns 本文編集面のコールバックが生成する結果。
             */
            () => viewportRestoreGenerationRef.current === generation,

            /**
             * 本文編集面のコールバックとしてrestoredを処理する。
             * @param restored - 復元処理が確定した本文編集面の可視位置アンカー。
             * @returns 本文編集面のコールバックが生成する結果。
             */
            (restored) => viewportRef.current?.(restored, false),

            /**
             * 本文編集面のコールバックとして要素を処理する。
             * @returns 本文編集面のコールバックが生成する結果。
             */
            () => {
              viewportRestoreActiveRef.current = false;
            },
          );
        },

        restoreScrollRatio: /**
         * 本文編集面の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
         * @param ratio - 復元先として正規化された縦スクロール位置（0から1）。
         * @returns 本文編集面のrestore・scroll・ratioが生成する結果。
         */ (ratio) => {
          const view = viewRef.current;
          if (
            !view ||
            view.scrollDOM.clientHeight === 0 ||
            !Number.isFinite(ratio)
          )
            return;
          viewportRestoreActiveRef.current = true;
          const generation = ++viewportRestoreGenerationRef.current;
          const maxScrollTop = Math.max(
            0,
            view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight,
          );
          const nextScrollTop = Math.min(1, Math.max(0, ratio)) * maxScrollTop;
          programmaticScrollPendingRef.current =
            Math.abs(view.scrollDOM.scrollTop - nextScrollTop) > 0.5;
          view.scrollDOM.scrollTop = nextScrollTop;
          const anchor = readViewport(view);
          if (!anchor) {
            viewportRestoreActiveRef.current = false;
            return;
          }
          anchor.scrollRatio = Math.min(1, Math.max(0, ratio));
          viewportRestoreAnchorRef.current = { ...anchor };
          restoreViewportUntilSettled(
            view,
            anchor,
            hostRef.current,
            programmaticScrollPendingRef,

            /**
             * 本文編集面のコールバックとして要素を処理する。
             * @returns 副作用を完了し、値は返さない。
             */
            () => viewportRestoreGenerationRef.current === generation,

            /**
             * 本文編集面のコールバックとしてrestoredを処理する。
             * @param restored - 比率に基づく復元後に確定した可視位置アンカー。
             * @returns 副作用を完了し、値は返さない。
             */
            (restored) => viewportRef.current?.(restored, false),

            /**
             * 本文編集面のコールバックとして要素を処理する。
             * @returns 副作用を完了し、値は返さない。
             */
            () => {
              viewportRestoreActiveRef.current = false;
            },
          );
        },
      }),
    );

    /**
     * 本文編集面の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
     * @returns 副作用を完了し、値は返さない。
     */
    function replaceSelection(markdown: string): void {
      const view = viewRef.current;
      if (!view) return;
      const selection = view.state.selection.main;
      const normalized = normalizeLineEndings(markdown);
      view.dispatch({
        changes: {
          from: selection.from,
          to: selection.to,
          insert: toEditorInsertion(view.state, markdown),
        },
        selection: EditorSelection.cursor(selection.from + normalized.length),
      });
    }

    /**
     * 本文編集面の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param language - 本文編集面の対象や分岐を識別する値。
     * @returns 副作用を完了し、値は返さない。
     */
    function applyCodeBlock(language = ""): void {
      const view = viewRef.current;
      if (!view) return;
      const source = view.state.sliceDoc();
      const main = view.state.selection.main;
      const selection = {
        from: editorOffsetToExternal(view.state, main.from),
        to: editorOffsetToExternal(view.state, main.to),
      };
      const safeLanguage = language.trim().replace(/[^a-zA-Z0-9_+#.-]/g, "");
      applyEdit(
        wrapSelection(
          source,
          selection,
          `\`\`\`${safeLanguage}\n`,
          "\n```",
          messages.editor.codePlaceholder,
        ),
      );
    }

    /**
     * 本文編集面の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param action - 適用する装飾、リスト、ブロック挿入などの操作種別。
     * @returns 副作用を完了し、値は返さない。
     */
    function applyAction(action: SourceAction): void {
      const view = viewRef.current;
      if (!view) return;
      const source = view.state.sliceDoc();
      const main = view.state.selection.main;
      const selection = {
        from: editorOffsetToExternal(view.state, main.from),
        to: editorOffsetToExternal(view.state, main.to),
      };
      mveDebug("source.action", {
        action,
        selection,
        sourceLength: source.length,
      });
      let edit: SourceEdit | undefined;
      // 操作種別に応じて装飾・リスト・ブロック編集の共通関数を選択する。
      switch (action) {
        case "bold":
          edit = wrapSelection(source, selection, "**");
          break;
        case "italic":
          edit = wrapSelection(source, selection, "*");
          break;
        case "strike":
          edit = wrapSelection(source, selection, "~~");
          break;
        case "highlight":
          edit = wrapSelection(source, selection, "==");
          break;
        case "underline":
          edit = wrapSelection(source, selection, "++");
          break;
        case "sup":
          edit = wrapSelection(source, selection, "^");
          break;
        case "sub":
          edit = wrapSelection(source, selection, "~");
          break;
        case "inlineCode":
          edit = wrapSelection(source, selection, "`");
          break;
        case "quote":
          edit = prefixSelectedLines(source, selection, "> ");
          break;
        case "bulletList":
          edit = prefixSelectedLines(source, selection, "- ");
          break;
        case "orderedList":
          edit = prefixOrderedList(source, selection);
          break;
        case "taskList":
          edit = prefixSelectedLines(source, selection, "- [ ] ");
          break;
        case "indent":
          edit = indentSelectedLines(source, selection);
          break;
        case "outdent": {
          const target =
            selection.from === selection.to
              ? currentLineSelection(source, selection.from)
              : selection;
          const from = Math.min(target.from, target.to);
          const to = Math.max(target.from, target.to);
          const original = source.slice(from, to);
          const selected = original.replace(/^ {1,2}/gm, "");
          edit = {
            text: source.slice(0, from) + selected + source.slice(to),
            selection:
              selection.from === selection.to
                ? {
                    from: selection.from + selected.length - original.length,
                    to: selection.from + selected.length - original.length,
                  }
                : mapLineSelection(original, selected, from, selection),
          };
          break;
        }
        case "codeBlock":
          applyCodeBlock();
          return;
        case "horizontalRule":
          replaceSelection("\n\n---\n\n");
          return;
        case "hardBreak":
          replaceSelection("\\\n");
          return;
        case "cellBreak":
          replaceSelection("<br>");
          return;
        case "clearInline":
          edit = clearInlineFormatting(
            source,
            selection.from === selection.to
              ? currentLineSelection(source, selection.from)
              : selection,
          );
          break;
        case "clearBlock":
          edit = clearBlockFormatting(
            source,
            selection.from === selection.to
              ? currentLineSelection(source, selection.from)
              : selection,
          );
          break;
        case "clearAll": {
          // ブロック記号を先に除去し、その結果へインライン記号の除去を重ねる。
          const actionSelection =
            selection.from === selection.to
              ? currentLineSelection(source, selection.from)
              : selection;
          const blockCleared = clearBlockFormatting(source, actionSelection);
          edit = clearInlineFormatting(
            blockCleared.text,
            blockCleared.selection,
          );
          break;
        }
        case "unlink": {
          // カーソルがリンク内にある場合はリンク全体を表示文字列へ置き換える。
          const actionSelection =
            selection.from === selection.to
              ? linkSelectionAt(source, selection.from)
              : selection;
          if (!actionSelection) return;
          const selected = source.slice(
            actionSelection.from,
            actionSelection.to,
          );
          const replacement = selected.replace(/\[([^\]]+)]\([^)]+\)/g, "$1");
          edit = {
            text:
              source.slice(0, actionSelection.from) +
              replacement +
              source.slice(actionSelection.to),
            selection: {
              from: actionSelection.from,
              to: actionSelection.from + replacement.length,
            },
          };
          break;
        }
      }
      // 編集結果が生成された操作だけをCodeMirrorへ反映する。
      if (
        edit &&
        selection.from === selection.to &&
        CARET_PRESERVING_LINE_ACTIONS.has(action)
      ) {
        const changes = computeTextChanges(source, edit.text);
        const caret = mapTextOffset(selection.from, changes, source.length, 1);
        edit = { ...edit, selection: { from: caret, to: caret } };
        mveDebug("source.caret-normalized", {
          action,
          from: selection.from,
          to: caret,
        });
      }
      if (edit) applyEdit(edit);
    }

    /**
     * 本文編集面の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param level - 見出しに設定する#の数。0の場合は見出し記号を除去する。
     * @returns 副作用を完了し、値は返さない。
     */
    function applyHeading(level: number): void {
      const view = viewRef.current;
      if (!view) return;
      const selection = view.state.selection.main;
      const line = view.state.doc.lineAt(selection.from);
      const prefix = level > 0 ? `${"#".repeat(level)} ` : "";
      const changed = prefix + line.text.replace(/^(#{1,6})\s+/, "");
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: changed },
        selection: EditorSelection.cursor(
          line.from +
            Math.min(
              changed.length,
              selection.from - line.from + prefix.length,
            ),
        ),
      });
    }

    /**
     * 本文編集面の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param edit - 編集後の本文と適用後の選択範囲。
     * @returns 副作用を完了し、値は返さない。
     */
    function applyEdit(edit: SourceEdit): void {
      const view = viewRef.current;
      if (!view) return;
      // 共通編集結果を外部オフセットの差分へ変換し、CodeMirror内部の位置へ写像する。
      const changes = computeTextChanges(view.state.sliceDoc(), edit.text);
      mveDebug("source.apply-edit", {
        beforeLength: view.state.sliceDoc().length,
        afterLength: edit.text.length,
        changeCount: changes.length,
        changes: changes.slice(0, 8),
        selection: edit.selection,
      });
      const editorChanges = changes.map(
        /**
         * 各changeからrange・offsetを取り出して一覧化する。
         * @param change - changeのrange・offsetを参照する走査対象。
         * @returns range・offsetを取り出した変換結果の一覧。
         */
        (change) => ({
          from: externalOffsetToEditor(view.state, change.rangeOffset),
          to: externalOffsetToEditor(
            view.state,
            change.rangeOffset + change.rangeLength,
          ),
          insert: toEditorInsertion(view.state, change.text),
        }),
      );
      const changeSet = view.state.changes(editorChanges);
      const snapshot =
        view.scrollDOM.clientHeight > 0
          ? view.scrollSnapshot().map(changeSet)
          : undefined;
      if (snapshot) programmaticScrollPendingRef.current = true;
      view.dispatch({
        changes: changeSet,
        selection: EditorSelection.range(
          externalOffsetToEditorValue(edit.text, edit.selection.from),
          externalOffsetToEditorValue(edit.text, edit.selection.to),
        ),
        effects: snapshot,
      });
    }

    return <div ref={hostRef} className={`source-editor ${className}`} />;
  },
);

// 選択・スクロール中は親コンポーネントが頻繁に更新される。CodeMirror本体は
// value/searchの変更がない限り再描画不要なので、イベントコールバックの同一性に
// 依存せずエディターのサブツリーを再利用する。

/**
 * 本文編集面で解析・表示・保存する本文。
 */
export const SourceEditor = React.memo(
  SourceEditorView,

  /**
    * 前回と次回のpropsを比較し、エディターを再描画するか判定する。
    * @param previous - 前回レンダーで使った本文エディターProps。
    * @param next - 再描画の必要性を判定する新しい本文エディターProps。
   * @returns 本文編集面のコールバックが生成する結果。
   */
  (previous, next) =>
    previous.value === next.value &&
    previous.messages === next.messages &&
    previous.placeholder === next.placeholder &&
    previous.className === next.className &&
    previous.searchHits === next.searchHits &&
    previous.activeSearchHit === next.activeSearchHit &&
    previous.onChange === next.onChange &&
    previous.onInputActivity === next.onInputActivity &&
    previous.onSettled === next.onSettled &&
    previous.onSelectionChange === next.onSelectionChange &&
    previous.onViewportChange === next.onViewportChange &&
    previous.onUserScrollIntent === next.onUserScrollIntent,
);

/**
 * 本文編集面のcurrent・line・selectionを処理し、呼び出し側へ結果または副作用を返す。
 * @param source - 現在行の範囲を求めるMarkdown本文。
 * @param offset - 現在行を判定する本文文字オフセット。
 * @returns 本文編集面のcurrent・line・selectionが生成する結果。
 */
function currentLineSelection(source: string, offset: number): TextSelection {
  const safeOffset = Math.max(0, Math.min(offset, source.length));
  const from = source.lastIndexOf("\n", Math.max(0, safeOffset - 1)) + 1;
  const lineBreak = source.indexOf("\n", safeOffset);
  const to = lineBreak < 0 ? source.length : lineBreak;
  return { from, to };
}

/**
 * 本文編集面のlink・selection・atを処理し、呼び出し側へ結果または副作用を返す。
 * @param source - Markdownリンクの範囲を検索する本文。
 * @param offset - キャレット位置の本文文字オフセット。
 * @returns 副作用を完了し、値は返さない。
 */
function linkSelectionAt(
  source: string,
  offset: number,
): TextSelection | undefined {
  const linkPattern = /\[[^\]\r\n]+\]\([^\)\r\n]+\)/g;
  for (const match of source.matchAll(linkPattern)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (from <= offset && offset <= to) return { from, to };
  }
  return undefined;
}

/**
 * 本文編集面のdetect・line・separatorを処理し、呼び出し側へ結果または副作用を返す。
 * @param value - 改行コードを検出する本文。
 * @returns 本文編集面で利用する文字列。
 */
function detectLineSeparator(value: string): string {
  return value.includes("\r\n") ? "\r\n" : value.includes("\r") ? "\r" : "\n";
}

/**
 * 本文編集面のpublish・viewport・dataを処理し、呼び出し側へ結果または副作用を返す。
 * @param host - 可視位置データを書き込むエディターのホスト要素。未マウント時はnull。
 * @param anchor - ホスト要素へ保存する本文編集面の可視位置アンカー。
 * @returns 副作用を完了し、値は返さない。
 */
function publishViewportData(
  host: HTMLElement | null,
  anchor: EditorViewportAnchor,
): void {
  if (!host) return;
  host.dataset.viewportOffset = String(anchor.offset);
  host.dataset.viewportTopOffset = String(anchor.topOffset);
  if (anchor.endOffset !== undefined)
    host.dataset.viewportEndOffset = String(anchor.endOffset);
}

/**
 * 本文編集面のpublish・selection・dataを処理し、呼び出し側へ結果または副作用を返す。
 * @param host - 選択位置データを書き込むエディターのホスト要素。未マウント時はnull。
 * @param state - 現在の編集・表示状態。
 * @returns 副作用を完了し、値は返さない。
 */
function publishSelectionData(
  host: HTMLElement | null,
  state: EditorState,
): void {
  if (!host) return;
  const selection = state.selection.main;
  host.dataset.selectionFrom = String(
    editorOffsetToExternal(state, selection.from),
  );
  host.dataset.selectionTo = String(
    editorOffsetToExternal(state, selection.to),
  );
}

/**
 * 本文編集面の入力を許可された形式へ整える。
 * @param value - LFへ正規化する本文。
 * @returns 本文編集面で利用する文字列。
 */
function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?|\n/g, "\n");
}

/**
 * 本文編集面のto・editor・insertionを処理し、呼び出し側へ結果または副作用を返す。
 * @param state - 現在の編集・表示状態。
 * @param value - CodeMirrorへ挿入する本文。
 * @returns 本文編集面で利用する文字列。
 */
function toEditorInsertion(state: EditorState, value: string): string {
  const separator = state.facet(EditorState.lineSeparator) ?? "\n";
  return normalizeLineEndings(value).replace(/\n/g, separator);
}

/**
 * 本文編集面のexternal・document・lengthを処理し、呼び出し側へ結果または副作用を返す。
 * @param state - 現在の編集・表示状態。
 * @returns 本文編集面で利用する数値。
 */
function externalDocumentLength(state: EditorState): number {
  const separatorLength = (state.facet(EditorState.lineSeparator) ?? "\n")
    .length;
  return (
    state.doc.length + (state.doc.lines - 1) * Math.max(0, separatorLength - 1)
  );
}

/**
 * 本文編集面のexternal・document・valueを処理し、呼び出し側へ結果または副作用を返す。
 * @param state - 現在の編集・表示状態。
 * @returns 本文編集面で利用する文字列。
 */
function externalDocumentValue(state: EditorState): string {
  return state.doc.sliceString(
    0,
    state.doc.length,
    state.facet(EditorState.lineSeparator) ?? "\n",
  );
}

/**
 * 本文編集面のeditor・offset・to・externalを処理し、呼び出し側へ結果または副作用を返す。
 * @param state - 現在の編集・表示状態。
 * @param offset - CodeMirror本文内の文字オフセット。
 * @returns 本文編集面で利用する数値。
 */
function editorOffsetToExternal(state: EditorState, offset: number): number {
  const safeOffset = Math.max(0, Math.min(offset, state.doc.length));
  const separatorLength = (state.facet(EditorState.lineSeparator) ?? "\n")
    .length;
  if (separatorLength <= 1 || safeOffset === 0) return safeOffset;
  const line = state.doc.lineAt(safeOffset);
  return safeOffset + (line.number - 1) * (separatorLength - 1);
}

/**
 * 本文編集面のexternal・offset・to・editorを処理し、呼び出し側へ結果または副作用を返す。
 * @param state - 現在の編集・表示状態。
 * @param offset - 改行を含む本文での外部文字オフセット。
 * @returns 本文編集面で利用する数値。
 */
function externalOffsetToEditor(state: EditorState, offset: number): number {
  const separatorLength = (state.facet(EditorState.lineSeparator) ?? "\n")
    .length;
  if (separatorLength <= 1)
    return Math.max(0, Math.min(offset, state.doc.length));
  const externalLength =
    state.doc.length + (state.doc.lines - 1) * (separatorLength - 1);
  const target = Math.max(0, Math.min(offset, externalLength));
  let low = 0;
  let high = state.doc.length;
  // CRLFの2文字目など内部位置を持たない外部オフセットは、次行先頭へ写像する。
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const line = state.doc.lineAt(middle);
    const external = middle + (line.number - 1) * (separatorLength - 1);
    if (external < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * 本文編集面のexternal・offset・to・editor・valueを処理し、呼び出し側へ結果または副作用を返す。
 * @param value - LF正規化前のMarkdown本文。
 * @param offset - 元本文内の文字オフセット。
 * @returns 本文編集面で利用する数値。
 */
function externalOffsetToEditorValue(value: string, offset: number): number {
  const safeOffset = Math.max(0, Math.min(offset, value.length));
  return normalizeLineEndings(value.slice(0, safeOffset)).length;
}

/**
 * 本文編集面から必要な値またはリソースを取得する。
 * @param view - スクロール位置と可視行を読み取るCodeMirrorビュー。
 * @returns 副作用を完了し、値は返さない。
 */
function readViewport(view: EditorView): EditorViewportAnchor | undefined {
  if (view.scrollDOM.clientHeight === 0) return undefined;
  const scrollTop = view.scrollDOM.scrollTop;
  const block = view.lineBlockAtHeight(scrollTop);
  // lineBlockAtHeightは、ブロックWidgetや行内ブロックの境界ではfrom === toを返すことがある。
  // endOffsetは「先頭ブロックの終端」ではなく実際の可視領域下端として公開し、
  // 復元対象が同じ先頭行の途中にある場合も可視範囲内と正しく判定できるようにする。
  const viewportBottom = Math.max(
    scrollTop,
    scrollTop + view.scrollDOM.clientHeight - 1,
  );
  const bottomBlock = view.lineBlockAtHeight(viewportBottom);
  return {
    offset: editorOffsetToExternal(view.state, block.from),
    topOffset: block.top - scrollTop,
    endOffset: editorOffsetToExternal(
      view.state,
      Math.max(block.to, bottomBlock.to),
    ),
    scrollRatio: getScrollRatio(
      scrollTop,
      view.scrollDOM.scrollHeight,
      view.scrollDOM.clientHeight,
    ),
  };
}

/**
 * 保存したエディター位置を復元し、レイアウトが安定するまで再試行する。
 * @param view スクロール位置を復元するCodeMirrorビュー。
 * @param anchor 復元する縦スクロール位置とアンカー情報。
 * @param host エディターを含むホスト要素。DOM接続状態を確認する。
 * @param programmaticScrollPendingRef プログラムによるスクロール復元が進行中かを示すRef。
 * @param isCurrent 復元要求が現在も有効かを判定する関数。
 * @param onRestored 復元完了時にアンカーを通知するコールバック。
 * @param onSettled 復元試行の終了時に呼び出すコールバック。
 * @param attempt 現在の復元試行回数。
 * @returns 副作用を完了し、値は返さない。
 */
function restoreViewportUntilSettled(
  view: EditorView,
  anchor: EditorViewportAnchor,
  host: HTMLElement | null,
  programmaticScrollPendingRef: React.MutableRefObject<boolean>,
  isCurrent: () => boolean,
  onRestored: (anchor: EditorViewportAnchor) => void,
  onSettled: () => void,
  attempt = 0,
): void {
  if (!isCurrent()) return;
  window.requestAnimationFrame(
    /**
     * 次の描画フレームで表示更新を実行する。
     * @returns 本文編集面のコールバックが生成する結果。
     */
    () => {
      if (!isCurrent()) return;
      const offset = externalOffsetToEditor(view.state, anchor.offset);
      const block = view.lineBlockAt(offset);
      const nextScrollTop =
        anchor.scrollRatio !== undefined
          ? Math.min(1, Math.max(0, anchor.scrollRatio)) *
            Math.max(
              0,
              view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight,
            )
          : Math.max(0, block.top - anchor.topOffset);
      programmaticScrollPendingRef.current =
        Math.abs(view.scrollDOM.scrollTop - nextScrollTop) > 0.5;
      view.scrollDOM.scrollTop = nextScrollTop;
      const restored = readViewport(view);
      if (restored) {
        publishViewportData(host, restored);
        onRestored(restored);
      }
      const settled =
        anchor.scrollRatio !== undefined
          ? restored?.scrollRatio === anchor.scrollRatio
          : Boolean(
              restored &&
              anchor.offset >= restored.offset &&
              anchor.offset <= (restored.endOffset ?? restored.offset) &&
              Math.abs(restored.topOffset - anchor.topOffset) <= 1,
            );
      if (restored && (attempt < 8 || (!settled && attempt < 16))) {
        restoreViewportUntilSettled(
          view,
          anchor,
          host,
          programmaticScrollPendingRef,
          isCurrent,
          onRestored,
          onSettled,
          attempt + 1,
        );
      } else {
        onSettled();
      }
    },
  );
}

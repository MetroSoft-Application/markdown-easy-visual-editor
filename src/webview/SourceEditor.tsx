/**
 * @file SourceEditor.tsx
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
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

/**
 * 「SourceAction」として扱う値の型を定義します。
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

/** 「CARET_PRESERVING_LINE_ACTIONS」は、関連する処理間で共有する設定値または状態です。 */
/** 行単位の書式操作でカーソル位置を維持するアクション集合。選択範囲の再計算を共通化する。 */
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
 * 「TextEditorHandle」が満たすデータ契約を定義します。
 */
export interface TextEditorHandle {
  /**
   * 「insert」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @param markdown 解析・編集・変換の対象となる本文または生成済み内容です。
   * @param inline 「inline」は、「insert」がWebview UI状態の処理対象を特定する入力です。
   * @returns 「insert」の副作用または状態更新を実行し、値は返しません。
   */
  insert(markdown: string, inline?: boolean): void;
  /**
   * 「applyEdit」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @param edit 「edit」は、「applyEdit」がWebview UI状態の処理対象を特定する入力です。
   * @returns 「applyEdit」の副作用または状態更新を実行し、値は返しません。
   */
  applyEdit(edit: SourceEdit): void;
  /**
   * 「action」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @param action 「action」は、「action」がWebview UI状態の処理対象を特定する入力です。
   * @returns 「action」の副作用または状態更新を実行し、値は返しません。
   */
  action(action: SourceAction): void;
  /**
   * 「codeBlock」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @param language 表示文言の解決に使用する言語コードまたはロケールです。
   * @returns 「codeBlock」の副作用または状態更新を実行し、値は返しません。
   */
  codeBlock(language?: string): void;
  /**
   * 「heading」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @param level 「level」は、「heading」がWebview UI状態の処理対象を特定する入力です。
   * @returns 「heading」の副作用または状態更新を実行し、値は返しません。
   */
  heading(level: number): void;
  /**
   * 「link」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @param href 「href」は、「link」がWebview UI状態の処理対象を特定する入力です。
   * @param label 「label」は、「link」がWebview UI状態の処理対象を特定する入力です。
   * @returns 「link」の副作用または状態更新を実行し、値は返しません。
   */
  link(href: string, label?: string): void;
  /**
   * 「getSelection」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @returns 「getSelection」が読み取りまたは正規化した結果を返します。
   */
  getSelection(): TextSelection;
  /**
   * 「setSelection」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @param selection 「selection」は、「setSelection」がWebview UI状態の処理対象を特定する入力です。
   * @returns 「setSelection」の副作用または状態更新を実行し、値は返しません。
   */
  setSelection(selection: TextSelection): void;
  /**
   * 「revealRange」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @param selection 「selection」は、「revealRange」がWebview UI状態の処理対象を特定する入力です。
   * @returns 「revealRange」の副作用または状態更新を実行し、値は返しません。
   */
  revealRange(selection: TextSelection): void;
  /**
   * 「getViewport」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @returns 「getViewport」が対象を取得できない場合はundefinedを返します。
   */
  getViewport(): EditorViewportAnchor | undefined;
  /**
   * 「restoreViewport」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @param anchor 「anchor」は、「restoreViewport」がWebview UI状態の処理対象を特定する入力です。
   * @returns 「restoreViewport」の副作用または状態更新を実行し、値は返しません。
   */
  restoreViewport(anchor: EditorViewportAnchor): void;
  /**
   * 「restoreScrollRatio」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @param ratio 表示領域のサイズまたは倍率で、画面レイアウト計算に使用します。
   * @returns 「restoreScrollRatio」の副作用または状態更新を実行し、値は返しません。
   */
  restoreScrollRatio(ratio: number): void;
}

/**
 * 「EditorViewportAnchor」が満たすデータ契約を定義します。
 */
export interface EditorViewportAnchor {

  /**
   * 「offset」は、本文または選択範囲の位置・長さを保持します。
   */
  offset: number;

  /**
   * 「topOffset」は、本文または選択範囲の位置・長さを保持します。
   */
  topOffset: number;

  /**
   * 「endOffset」は、本文または選択範囲の位置・長さを保持します。
   */
  endOffset?: number;
  /**
   * エディター全体の最大スクロール量に対する現在位置。
   */
  scrollRatio?: number;
}

/** 外部同期トランザクションをユーザー編集と区別するためのCodeMirrorアノテーション。 */
/** Hostからの同期編集をユーザー入力と区別するCodeMirror注釈。カーソル復元の分岐に使う。 */
const externalSyncTransaction = Annotation.define<boolean>();

/** フェンス付きコードブロック内で利用するCodeMirror言語を定義する。 */
/** フェンス付きコードブロックで遅延ロードするCodeMirror言語サポートの一覧。 */
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

/** Markdownとフェンス内コードをVS Codeテーマに合わせて読みやすく表示する。 */
/** MarkdownとコードフェンスをVS Codeテーマの色へ対応付けるハイライト定義。 */
const vscodeSyntaxHighlightStyle = HighlightStyle.define([
  { tag: tags.meta, color: "var(--vscode-descriptionForeground)" },
  { tag: tags.heading, color: "#4ec9b0", fontWeight: "600" },
  {
    tag: tags.quote,
    color: "var(--vscode-textBlockQuote-foreground, var(--vscode-foreground))",
  },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  {
    tag: tags.link,
    color: "#4ec9b0",
    textDecoration: "underline",
  },
  { tag: tags.url, color: "#4ec9b0" },
  { tag: tags.processingInstruction, color: "#d7ba7d" },
  {
    tag: tags.monospace,
    color: "#ce9178",
    backgroundColor:
      "var(--vscode-textCodeBlock-background, var(--vscode-editor-inactiveSelectionBackground))",
    fontFamily:
      "var(--mve-editor-font-family, var(--vscode-editor-font-family, monospace))",
  },
  { tag: tags.escape, color: "#ce9178" },
  { tag: tags.character, color: "#b5cea8" },
  {
    tag: [tags.keyword, tags.operator],
    color: "#c586c0",
  },
  {
    tag: [tags.atom, tags.bool, tags.contentSeparator],
    color: "#dcdcaa",
  },
  { tag: tags.number, color: "#b5cea8" },
  { tag: tags.labelName, color: "#d7ba7d" },
  {
    tag: [tags.string, tags.special(tags.string)],
    color: "#ce9178",
  },
  { tag: [tags.literal, tags.inserted], color: "#b5cea8" },
  { tag: tags.deleted, color: "#f48771" },
  { tag: tags.regexp, color: "#d16969" },
  {
    tag: tags.comment,
    color: "var(--vscode-descriptionForeground)",
    fontStyle: "italic",
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace],
    color: "#155e4f",
  },
  {
    tag: [tags.definition(tags.variableName), tags.local(tags.variableName)],
    color: "#dcdcaa",
  },
  {
    tag: [tags.special(tags.variableName), tags.macroName],
    color: "#c586c0",
  },
  {
    tag: tags.definition(tags.propertyName),
    color: "#155e4f",
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
    color: "#d4d4d4",
  },
]);

/**
 * 「SearchHighlightData」が満たすデータ契約を定義します。
 */
interface SearchHighlightData {

  /**
   * 「hits」は、関連する複数の対象または識別子を保持します。
   */
  hits: readonly TextSelection[];

  /**
   * 「active」は、画面の表示モードまたは現在のUI状態を示します。
   */
  active?: TextSelection;
}

/**
 * 「SearchHighlightState」が満たすデータ契約を定義します。
 */
interface SearchHighlightState extends SearchHighlightData {

  /**
   * 「decorations」は、表示領域のサイズまたは倍率を保持します。
   */
  decorations: DecorationSet;
}

/** 「setSearchHighlights」は、関連する処理間で共有する設定値または状態です。 */
/** 検索ヒットの範囲をCodeMirror状態へ適用するエフェクト。 */
const setSearchHighlights = StateEffect.define<SearchHighlightData>();
/** 「searchHighlightField」は、関連する処理間で共有する設定値または状態です。 */
/** 検索ヒットと装飾を編集トランザクションに追従させる状態フィールド。 */
const searchHighlightField = StateField.define<SearchHighlightState>({

  /**
   * createを作成または組み立てます。
   * @returns 「create」が生成したデータまたはオブジェクトを返します。
   */
  create: /**
 * 「create」は、必要な初期状態または出力データを生成します。
 * @returns 「create」が生成したデータまたはオブジェクトを返します。
 */ () => ({ hits: [], decorations: Decoration.none }),
  /**
   * updateを更新または保存します。
   * @param value 処理で検証・変換する入力値です。
   * @param transaction 「transaction」は、「update」がWebview UI状態の処理対象を特定する入力です。
   * @returns 「value」「transaction」から生成した処理結果を返します。
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

  /**
   * 「provide」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param field 「field」は、「provide」がWebview UI状態の処理対象を特定する入力です。
   * @returns 「provide」がWebview UI状態の入力を処理して得た固有の結果を返します。
   */
  provide: /**
 * 「provide」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param field 「field」は、「provide」がWebview UIで処理する対象を特定する入力です。
 * @returns 「provide」がWebview UI状態の入力を処理して得た固有の結果を返します。
 */ (field) =>
    EditorView.decorations.from(field,
    /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
     * @param value 「value」で検証・変換する入力値です。
     * @returns 「value」から生成した処理結果を返します。
     */
    (value) => value.decorations),
});

/**
 * 検索ヒットをCodeMirrorの装飾範囲へ変換する。
 * @param state 現在のエディター状態。
 * @param data 検索ヒットとアクティブなヒット。
 * @returns 検索ヒットへ適用する装飾集合。
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
 * 「hit」を変換し、変換後の要素を返すコールバックです。
     * @param hit hitとして渡される、このコールバックの入力値です。
     * @returns 入力要素から生成した変換後の値を返します。
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
    })
    .filter(
    /**
 * 「range」が条件に一致するか判定し、残す要素を決めるコールバックです。
     * @param range 処理対象の範囲です。
     * @returns 要素を採用するかどうかの真偽値を返します。
     */
    (range): range is Range<Decoration> => Boolean(range));
  return Decoration.set(ranges);
}

/**
 * 表示中の範囲にある半角スペースへ可視化用の装飾を付ける。
 * @param view 装飾対象のCodeMirrorビュー。
 * @returns 半角スペースへ適用する装飾集合。
 */
function visibleSpaceDecorations(view: EditorView): DecorationSet {
  const ranges = [] as Array<{
  /**
   * 「from」は、本文または選択範囲の位置・長さを保持します。
   */
  from: number;
  /**
   * 「to」は、本文または選択範囲の位置・長さを保持します。
   */
  to: number }>;
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
 * 「from」「to」を変換し、変換後の要素を返すコールバックです。
     * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはfrom、toです。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    ({ from, to }) =>
      Decoration.mark({ class: "cm-visible-space" }).range(from, to),
    ),
  );
}

/**
 * 文書差分を既存の空白装飾へ写像し、変更された範囲内の空白だけを再作成する。
 * @param decorations 変更前の空白装飾。
 * @param update CodeMirrorの表示更新。
 * @returns 変更後の空白装飾。
 */
function updateVisibleSpaceDecorations(
  decorations: DecorationSet,
  update: ViewUpdate,
): DecorationSet {
  if (update.viewportChanged) return visibleSpaceDecorations(update.view);
  let next = decorations.map(update.changes);
  update.changes.iterChangedRanges(
  /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
   * @param _fromA _fromAとして渡される、このコールバックの入力値です。
   * @param _toA _toAとして渡される、このコールバックの入力値です。
   * @param fromB fromBとして渡される、このコールバックの入力値です。
   * @param toB toBとして渡される、このコールバックの入力値です。
   * @returns 「if」を実行し、値を返しません。
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

        /**
         * 「filter」は、後続処理へ渡す対象を判定します。
         * @returns 条件を満たすかどうかを示す真偽値を返します。
         */
        filter: /**
 * 「filter」は、後続処理へ渡す対象を判定します。
 * @returns 対象を保持または採用するかどうかを示す真偽値を返します。
 */ () => false,
        add: additions,
        sort: true,
      });
    }
  });
  return next;
}

/** 「visibleSpaces」は、関連する処理間で共有する設定値または状態です。 */
/** 空白文字の可視化装飾をエディターへ接続するCodeMirror拡張。 */
const visibleSpaces: Extension = ViewPlugin.fromClass(
  class {

    /**
     * 「decorations」は、表示領域のサイズまたは倍率を保持します。
     */
    decorations: DecorationSet;

    /**
     * 表示中のスペース装飾を初期化する。
     * @param view 処理対象のviewです。
     * @returns 「constructor」がWebview UI状態の入力を処理して得た固有の結果を返します。
     */
    constructor(view: EditorView) {
      this.decorations = visibleSpaceDecorations(view);
    }

    /**
     * 文書または表示範囲の変更時にスペース装飾を再計算する。
     * @param update 「update」は、「update」がWebview UI状態の処理対象を特定する入力です。
     * @returns 状態更新または副作用を実行し、値は返しません。
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
  /**
   * 「decorations」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param value 「decorations」で検証・変換する入力値です。
   * @returns 「decorations」がWebview UI状態の入力を処理して得た固有の結果を返します。
   */
  decorations: /**
 * 「decorations」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param value 「decorations」で検証・変換する入力値です。
 * @returns 「decorations」がWebview UI状態の入力を処理して得た固有の結果を返します。
 */ (value) => value.decorations },
);

/**
 * 「Props」が満たすデータ契約を定義します。
 */
interface Props {

  /**
   * 「messages」は、画面または通知へ表示する文言を保持します。
   */
  messages: Messages;

  /**
   * 「value」は、対象の内容または識別子を表す文字列です。
   */
  value: string;

  /**
   * 「initialSelection」は、関連処理が共有する構造化データの一項目です。
   */
  initialSelection?: TextSelection;

  /**
   * 「searchHits」は、関連する複数の対象または識別子を保持します。
   */
  searchHits?: readonly TextSelection[];

  /**
   * 「activeSearchHit」は、画面の表示モードまたは現在のUI状態を示します。
   */
  activeSearchHit?: TextSelection;
  /**
   * `isCompositionCommit` はIME確定時にまとめて通知した操作であることを示す。
   * @param beforeValue 処理対象を特定するbeforeValueの入力値です。
   * @param value 処理で検証・変換する入力値です。
   * @param changes 「changes」は、「onChange」がWebview UI状態の処理対象を特定する入力です。
   * @param isCompositionCommit 「isCompositionCommit」は、「onChange」がWebview UI状態の処理対象を特定する入力です。
   * @returns 状態更新または副作用を実行し、値は返しません。
   */
  onChange: (
    beforeValue: string,
    value: string,
    changes: TextChange[],
    isCompositionCommit?: boolean,
  ) => void;
  /**
   * 呼び出し側が入力を渡し、宣言された戻り値型で結果を受け取る契約です。
   * @returns 状態更新または副作用を実行し、値は返しません。
   */
  onInputActivity?: () => void;
  /**
   * 呼び出し側が入力を渡し、宣言された戻り値型で結果を受け取る契約です。
   * @returns 状態更新または副作用を実行し、値は返しません。
   */
  onSettled?: () => void;
  /**
   * 呼び出し側が入力を渡し、宣言された戻り値型で結果を受け取る契約です。
   * @param selection 処理対象を特定するselectionの入力値です。
   * @returns 状態更新または副作用を実行し、値は返しません。
   */
  onSelectionChange?: (selection: TextSelection) => void;

  /**
   * 「className」は、対象の識別や処理分岐に使用する値を保持します。
   */
  className?: string;

  /**
   * 「placeholder」は、対象の内容または識別子を表す文字列です。
   */
  placeholder?: string;
  /**
   * 呼び出し側が入力を渡し、宣言された戻り値型で結果を受け取る契約です。
   * @param anchor 処理対象を特定するanchorの入力値です。
   * @param userInitiated 処理対象を特定するuserInitiatedの入力値です。
   * @returns 状態更新または副作用を実行し、値は返しません。
   */
  onViewportChange?: (
    anchor: EditorViewportAnchor,
    userInitiated: boolean,
  ) => void;
  /**
   * 呼び出し側が入力を渡し、宣言された戻り値型で結果を受け取る契約です。
   * @returns 状態更新または副作用を実行し、値は返しません。
   */
  onUserScrollIntent?: () => void;
}

/**
 * CodeMirrorをMarkdownソースエディターとして初期化し、編集・選択・表示位置を親へ通知する。
 * @param props エディター本文、選択、検索結果、各種イベントコールバック。
 * @param ref 親から命令型操作を呼び出すための参照。
 * @returns CodeMirrorを格納するエディター要素。
 */
/** CodeMirror本体を生成し、親refへ編集・選択・スクロール操作を公開するReactコンポーネント。 */
const SourceEditorView = forwardRef<TextEditorHandle, Props>(

  /**
   * 「SourceEditor」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param props 「props」は、「SourceEditor」がWebview UI状態の処理対象を特定する入力です。
   * @param ref 「ref」は、「SourceEditor」がWebview UI状態の処理対象を特定する入力です。
   * @returns 「SourceEditor」がWebview UI状態の入力を処理して得た固有の結果を返します。
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
           * 変換開始時点の外部文書。preedit差分は必ずこの本文を基準に確定する。
           */
          beforeValue: string;

          /**
           * 「from」は、本文または選択範囲の位置・長さを保持します。
           */
          from: number;

          /**
           * 「to」は、本文または選択範囲の位置・長さを保持します。
           */
          to: number;

          /**
           * 「changed」は、処理条件または状態を表す真偽値です。
           */
          changed: boolean;
        }
      | undefined
    >(undefined);
    const compositionHandoffRef = useRef<
      | {
          /**
           * 確定直後にReactから届き得る、確定前の古い本文は再適用しない。
           */
          beforeValue: string;

          /**
           * 「deferredValue」は、対象の内容または識別子を表す文字列です。
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
 * Reactの初期状態またはメモ化値を遅延計算するコールバックです。
     * @returns Reactが保持する初期状態またはメモ化値を返します。
     */
    () => {
      if (!hostRef.current) return;
      let selectionFrame = 0;
      let pendingSelection: TextSelection | undefined;

      /**
       * 「publishSelection」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
       * @param nextSelection 「nextSelection」は、「publishSelection」がWebview UI状態の処理対象を特定する入力です。
       * @returns 「publishSelection」がWebview UI状態の入力を処理して得た固有の結果を返します。
       */
      const publishSelection = /**
 * 「publishSelection」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param nextSelection 「nextSelection」は、「publishSelection」がWebview UIで処理する対象を特定する入力です。
 * @returns 「publishSelection」がWebview UI状態の入力を処理して得た固有の結果を返します。
 */ (nextSelection: TextSelection) => {
        pendingSelection = nextSelection;
        if (selectionFrame) return;
        selectionFrame = window.requestAnimationFrame(
        /**
 * 次の描画フレームでUI更新処理を実行するコールバックです。
         * @returns 「if」を実行し、値を返しません。
         */
        () => {
          selectionFrame = 0;
          const selection = pendingSelection;
          pendingSelection = undefined;
          if (selection) selectionRef.current?.(selection);
        });
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
          visibleSpaces,
          exactSelectionMatchExtension,
          searchHighlightField,
          placeholderExtension(placeholder),
          keymap.of([...defaultKeymap, indentWithTab]),
          EditorView.lineWrapping,
          EditorView.updateListener.of(
          /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
           * @param update updateとして渡される、このコールバックの入力値です。
           * @returns 「update.transactions.some」を実行し、値を返しません。
           */
          (update) => {
            const isExternalSync = update.transactions.some(

              /**
 * 「transaction」が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
               * @param transaction transactionとして渡される、このコールバックの入力値です。
               * @returns 条件判定の結果を示す真偽値を返します。
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
 * 指定時間の経過後に遅延処理を実行するコールバックです。
               * @returns 「update.changes.iterChanges」を実行し、値を返しません。
               */
              () => {
                inputSettledTimerRef.current = undefined;
                onSettledRef.current?.();
              }, 220);
              viewportRestoreAnchorRef.current = undefined;
              viewportRestoreGenerationRef.current += 1;
              let changes: TextChange[] = [];
              update.changes.iterChanges(

                /**
 * 指定時間の経過後に遅延処理を実行するコールバックです。
                 * @param fromA fromAとして渡される、このコールバックの入力値です。
                 * @param toA toAとして渡される、このコールバックの入力値です。
                 * @param _fromB _fromBとして渡される、このコールバックの入力値です。
                 * @param _toB _toBとして渡される、このコールバックの入力値です。
                 * @param inserted insertedとして渡される、このコールバックの入力値です。
                 * @returns 「changes.push」を実行し、値を返しません。
                 */
                (fromA, toA, _fromB, _toB, inserted) => {
                  changes.push({
                    rangeOffset: editorOffsetToExternal(
                      update.startState,
                      fromA,
                    ),
                    rangeLength: update.startState.sliceDoc(fromA, toA).length,
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
          }),
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
      /**
       * ユーザーがスクロールを開始したことを記録し、保存位置を無効化する。
       * @returns 「markUserScrollIntent」がWebview UI状態の入力を処理して得た固有の結果を返します。
       */
      const markUserScrollIntent = /**
 * 「markUserScrollIntent」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @returns 「markUserScrollIntent」がWebview UI状態の入力を処理して得た固有の結果を返します。
 */ () => {
        viewportRestoreGenerationRef.current += 1;
        viewportRestoreAnchorRef.current = undefined;
        viewportRestoreActiveRef.current = false;
        programmaticScrollPendingRef.current = false;
        userScrollPendingRef.current = true;
        viewportIntentRef.current?.();
      };
      /**
       * ポインタースクロールを開始し、ユーザー操作として記録する。
       * @returns 「beginPointerScroll」が開始した処理の結果または非同期Promiseを返します。
       */
      const beginPointerScroll = /**
 * 「beginPointerScroll」は、処理を開始し、必要な実行状態を準備します。
 * @returns 「beginPointerScroll」が開始した処理の結果または非同期Promiseを返します。
 */ () => {
        markUserScrollIntent();
        pointerScrollActiveRef.current = true;
      };
      /**
       * ポインタースクロールの開始状態を解除する。
       * @returns 購読解除、タイマー解除、リソース破棄などの後片付けを実行し、値は返しません。
       */
      const endPointerScroll = /**
 * 「endPointerScroll」は、処理を終了し、保持していたリソースまたは状態を整理します。
 * @returns 購読解除、タイマー解除、リソース破棄などの後片付けを実行し、値は返しません。
 */ () => {
        pointerScrollActiveRef.current = false;
      };
      /**
       * タッチスクロールを開始し、ユーザー操作として記録する。
       * @returns 「beginTouchScroll」が開始した処理の結果または非同期Promiseを返します。
       */
      const beginTouchScroll = /**
 * 「beginTouchScroll」は、処理を開始し、必要な実行状態を準備します。
 * @returns 「beginTouchScroll」が開始した処理の結果または非同期Promiseを返します。
 */ () => {
        markUserScrollIntent();
        touchScrollActiveRef.current = true;
      };
      /**
       * タッチスクロールの開始状態を解除する。
       * @returns 購読解除、タイマー解除、リソース破棄などの後片付けを実行し、値は返しません。
       */
      const endTouchScroll = /**
 * 「endTouchScroll」は、処理を終了し、保持していたリソースまたは状態を整理します。
 * @returns 購読解除、タイマー解除、リソース破棄などの後片付けを実行し、値は返しません。
 */ () => {
        touchScrollActiveRef.current = false;
      };
      /**
       * 確定したユーザー入力だけにsettled通知を予約する。
       * @returns 「scheduleInputSettled」がWebview UI状態の入力を処理して得た固有の結果を返します。
       */
      const scheduleInputSettled = /**
 * 「scheduleInputSettled」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @returns 「scheduleInputSettled」がWebview UI状態の入力を処理して得た固有の結果を返します。
 */ () => {
        inputActivityRef.current?.();
        if (inputSettledTimerRef.current !== undefined)
          window.clearTimeout(inputSettledTimerRef.current);
        inputSettledTimerRef.current = window.setTimeout(
        /**
 * 指定時間の経過後に遅延処理を実行するコールバックです。
         * @returns 「if」を実行し、値を返しません。
         */
        () => {
          inputSettledTimerRef.current = undefined;
          onSettledRef.current?.();
        }, 220);
      };
      /**
       * CodeMirrorがcompositionend直後のMutationRecordを反映してから、変換セッション全体を
       * 開始本文からの一つの操作として親へ渡す。preeditは同期しない。
       * @returns 「if」を実行し、値を返しません。
       */
      const settleComposition = /**
 * 「settleComposition」は、入力を検証して対象の状態または内容へ適用します。
 * @returns 「if」を実行し、値を返しません。
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
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
         * @param value 「value」で検証・変換する入力値です。
         * @returns 「value」から生成した処理結果を返します。
         */
        (value) => value + 1);
      };
      /**
       * IME変換を1つの原子トランザクションとして開始する。
       * @returns 「beginComposition」が開始した処理の結果または非同期Promiseを返します。
       */
      const beginComposition = /**
 * 「beginComposition」は、処理を開始し、必要な実行状態を準備します。
 * @returns 「beginComposition」が開始した処理の結果または非同期Promiseを返します。
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
      /**
       * IMEの変換終了後、ブラウザーの保留DOM変更と同じタスクでは外部同期を再開しない。
       * @returns 購読解除、タイマー解除、リソース破棄などの後片付けを実行し、値は返しません。
       */
      const endComposition = /**
 * 「endComposition」は、処理を終了し、保持していたリソースまたは状態を整理します。
 * @returns 購読解除、タイマー解除、リソース破棄などの後片付けを実行し、値は返しません。
 */ () => {
        if (compositionEndTimerRef.current !== undefined)
          window.clearTimeout(compositionEndTimerRef.current);
        compositionEndTimerRef.current = window.setTimeout(
        /**
 * 指定時間の経過後に遅延処理を実行するコールバックです。
         * @returns 「settleComposition」を実行し、値を返しません。
         */
        () => {
          settleComposition();
        }, 0);
      };
      /**
       * 次の物理入力がタイマーより先に来た場合、CodeMirrorのキーハンドラーより先に確定位置を直す。
       * @param event 処理対象のイベントです。
       * @returns 「if」を実行し、値を返しません。
       */
      const settleBeforeNextKey = /**
 * 「settleBeforeNextKey」は、入力を検証して対象の状態または内容へ適用します。
 * @param event DOMイベントまたは入力イベントの情報です。
 * @returns 「if」を実行し、値を返しません。
 */ (event: KeyboardEvent) => {
        if (compositionEndTimerRef.current === undefined || event.isComposing)
          return;
        settleComposition();
      };
      /**
       * 現在の表示アンカーをDOMデータ属性へ出力する。
       * @param anchor 出力する表示アンカー。
       * @returns 「publishViewport」がWebview UI状態の入力を処理して得た固有の結果を返します。
       */
      const publishViewport = /**
 * 「publishViewport」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param anchor 「anchor」は、「publishViewport」がWebview UIで処理する対象を特定する入力です。
 * @returns 「publishViewport」がWebview UI状態の入力を処理して得た固有の結果を返します。
 */ (anchor: EditorViewportAnchor) =>
        publishViewportData(hostRef.current, anchor);
      let scrollFrame = 0;
      let pendingUserScroll = false;
      /**
       * スクロール位置を読み取り、ユーザー操作かプログラム操作かを親へ通知する。
       * @returns 「if」を実行し、値を返しません。
       */
      const handleScroll = /**
 * 「handleScroll」は、イベント入力を検証し、関連する状態またはUIを更新します。
 * @returns 「if」を実行し、値を返しません。
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
 * 次の描画フレームでUI更新処理を実行するコールバックです。
         * @returns 「performance.now」を実行し、値を返しません。
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
        });
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
       * イベント情報を受け取り、DOMまたは画面状態を更新するコールバックです。
       * @returns 「if」を実行し、値を返しません。
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
 * 受け取った入力または現在の状態を検証し、呼び出し元へ必要な処理結果を返すコールバックです。
             * @returns 「view.requestMeasure」の呼び出し結果を返します。
             */
            () => viewportRestoreGenerationRef.current === generation,

            /**
 * 「restored」を受け取り、処理結果を生成する処理です。
             * @param restored restoredとして渡される、このコールバックの入力値です。
             * @returns 「restored」から生成した処理結果を返します。
             */
            (restored) => viewportRef.current?.(restored, false),

            /**
 * 処理結果を生成する処理を実行するコールバックです。
             * @returns 「view.requestMeasure」を実行し、値を返しません。
             */
            () => {
              viewportRestoreActiveRef.current = false;
            },
          );
          return;
        }
        view.requestMeasure({

          /**
           * readを取得または解決します。
           * @returns 「read」が読み取りまたは正規化した結果を返します。
           */
          read: /**
 * 「read」は、要求された状態、値、または対象を読み取ります。
 * @returns 「read」が読み取りまたは正規化した結果を返します。
 */ () => readViewport(view),

          /**
           * writeを更新または保存します。
           * @param anchor 「anchor」は、「write」がWebview UI状態の処理対象を特定する入力です。
           * @returns 「if」を実行し、値を返しません。
           */
          write: /**
 * 「write」は、入力を検証して対象の状態または内容へ適用します。
 * @param anchor 「anchor」は、「write」がWebview UIで処理する対象を特定する入力です。
 * @returns 「if」を実行し、値を返しません。
 */ (anchor) => {
            if (anchor) publishViewport(anchor);
          },
        });
      });
      resizeObserver.observe(view.scrollDOM);
      viewRef.current = view;
      publishSelectionData(hostRef.current, view.state);
      view.requestMeasure({

        /**
         * readを取得または解決します。
         * @returns 「read」が読み取りまたは正規化した結果を返します。
         */
        read: /**
 * 「read」は、要求された状態、値、または対象を読み取ります。
 * @returns 「read」が読み取りまたは正規化した結果を返します。
 */ () => readViewport(view),

        /**
         * writeを更新または保存します。
         * @param anchor 「anchor」は、「write」がWebview UI状態の処理対象を特定する入力です。
         * @returns 「anchor」から生成した処理結果を返します。
         */
        write: /**
 * 「write」は、入力を検証して対象の状態または内容へ適用します。
 * @param anchor 「anchor」は、「write」がWebview UIで処理する対象を特定する入力です。
 * @returns 「anchor」から生成した処理結果を返します。
 */ (anchor) => {
          if (anchor) publishViewport(anchor);
        },
      });
      return /** IME入力確定後に予約したsettled通知を解除し、親状態への残留通知を防ぎます。 @returns タイマーと完了通知を整理し、値は返しません。 */ () => {
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
    }, []);

    useEffect(
    /**
 * Reactの初期状態またはメモ化値を遅延計算するコールバックです。
     * @returns Reactが保持する初期状態またはメモ化値を返します。
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
 * 「change」を変換し、変換後の要素を返すコールバックです。
       * @param change changeとして渡される、このコールバックの入力値です。
       * @returns 入力要素から生成した変換後の値を返します。
       */
      (change) => ({
        from: change.rangeOffset,
        to: change.rangeOffset + change.rangeLength,
        insert: toEditorInsertion(view.state, change.text),
      }));
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

        /**
         * readを取得または解決します。
         * @returns 「read」が読み取りまたは正規化した結果を返します。
         */
        read: /**
 * 「read」は、要求された状態、値、または対象を読み取ります。
 * @returns 「read」が読み取りまたは正規化した結果を返します。
 */ () => readViewport(view),

        /**
         * writeを更新または保存します。
         * @param anchor 「anchor」は、「write」がWebview UI状態の処理対象を特定する入力です。
         * @returns 「if」を実行し、値を返しません。
         */
        write: /**
 * 「write」は、入力を検証して対象の状態または内容へ適用します。
 * @param anchor 「anchor」は、「write」がWebview UIで処理する対象を特定する入力です。
 * @returns 「if」を実行し、値を返しません。
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
    }, [value, compositionNonce]);

    useEffect(
    /**
 * Reactの初期状態またはメモ化値を遅延計算するコールバックです。
     * @returns Reactが保持する初期状態またはメモ化値を返します。
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
    }, [searchHits, activeSearchHit, compositionNonce]);

    useImperativeHandle(ref,
    /**
 * （insert、applyEdit、action）を持つオブジェクトを初期化して返すコールバックです。
     * @returns 初期化したオブジェクト（insert、applyEdit、action）を返します。
     */
    () => ({
      /**
       * 選択範囲をMarkdown文字列で置換する。
       * @param markdown 解析・編集・変換の対象となる本文または生成済み内容です。
       * @returns 「insert」がWebview UI状態の入力を処理して得た固有の結果を返します。
       */
      insert: /**
 * 「insert」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param markdown 「markdown」は、「insert」がWebview UIで処理する対象を特定する入力です。
 * @returns 「insert」がWebview UI状態の入力を処理して得た固有の結果を返します。
 */ (markdown) => replaceSelection(markdown),
      /**
       * 共通編集結果をCodeMirrorへ適用する。
       * @param edit 「edit」は、「applyEdit」がWebview UI状態の処理対象を特定する入力です。
       * @returns 「edit」から生成した処理結果を返します。
       */
      applyEdit: /**
 * 「applyEdit」は、入力を検証して対象の状態または内容へ適用します。
 * @param edit 「edit」は、「applyEdit」がWebview UIで処理する対象を特定する入力です。
 * @returns 「edit」から生成した処理結果を返します。
 */ (edit) => applyEdit(edit),
      /**
       * 指定されたソース編集操作を実行する。
       * @param action 「action」は、「action」がWebview UI状態の処理対象を特定する入力です。
       * @returns 「action」がWebview UI状態の入力を処理して得た固有の結果を返します。
       */
      action: /**
 * 「action」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param action 必要なタイミングで実行するコールバックまたは処理関数です。
 * @returns 「action」がWebview UI状態の入力を処理して得た固有の結果を返します。
 */ (action) => applyAction(action),
      /**
       * 選択範囲をコードブロックで囲む。
       * @param language 表示文言の解決に使用する言語コードまたはロケールです。
       * @returns 「codeBlock」がWebview UI状態の入力を処理して得た固有の結果を返します。
       */
      codeBlock: /**
 * 「codeBlock」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param language 表示文言の解決に使用する言語コードまたはロケールです。
 * @returns 「codeBlock」がWebview UI状態の入力を処理して得た固有の結果を返します。
 */ (language = "") => applyCodeBlock(language),
      /**
       * 現在行の見出しレベルを変更する。
       * @param level 「level」は、「heading」がWebview UI状態の処理対象を特定する入力です。
       * @returns 「heading」がWebview UI状態の入力を処理して得た固有の結果を返します。
       */
      heading: /**
 * 「heading」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param level 処理対象を特定する位置、範囲、または数量です。
 * @returns 「heading」がWebview UI状態の入力を処理して得た固有の結果を返します。
 */ (level) => applyHeading(level),
      /**
       * 現在の選択範囲を指定URLのMarkdownリンクへ変換する。
       * @param href 「href」は、「link」がWebview UI状態の処理対象を特定する入力です。
       * @param label 「label」は、「link」がWebview UI状態の処理対象を特定する入力です。
       * @returns 「link」がWebview UI状態の入力を処理して得た固有の結果を返します。
       */
      link: /**
 * 「link」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param href 「href」は、「link」がWebview UIで処理する対象を特定する入力です。
 * @param label 「label」は、「link」がWebview UIで処理する対象を特定する入力です。
 * @returns 「link」がWebview UI状態の入力を処理して得た固有の結果を返します。
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
      /**
       * 外部本文オフセットで現在の選択範囲を返す。
       * @returns 「getSelection」が読み取りまたは正規化した結果を返します。
       */
      getSelection: /**
 * 「getSelection」は、要求された状態、値、または対象を読み取ります。
 * @returns 「getSelection」が読み取りまたは正規化した結果を返します。
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
      /**
       * 外部本文オフセットでCodeMirrorの選択範囲を設定する。
       * @param selection 「selection」は、「setSelection」がWebview UI状態の処理対象を特定する入力です。
       * @returns 「if」を実行し、値を返しません。
       */
      setSelection: /**
 * 「setSelection」は、入力を検証して対象の状態または内容へ適用します。
 * @param selection 「selection」は、「setSelection」がWebview UIで処理する対象を特定する入力です。
 * @returns 「if」を実行し、値を返しません。
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
      /**
       * 指定選択範囲を表示領域中央へスクロールする。
       * @param selection 「selection」は、「revealRange」がWebview UI状態の処理対象を特定する入力です。
       * @returns 「revealRange」がWebview UI状態の入力を処理して得た固有の結果を返します。
       */
      revealRange: /**
 * 「revealRange」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param selection 「selection」は、「revealRange」がWebview UIで処理する対象を特定する入力です。
 * @returns 「revealRange」がWebview UI状態の入力を処理して得た固有の結果を返します。
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
          effects: EditorView.scrollIntoView(EditorSelection.range(from, to), {
            y: "center",
          }),
        });
      },
      /**
       * 現在の表示アンカーを取得する。
       * @returns 「getViewport」が読み取りまたは正規化した結果を返します。
       */
      getViewport: /**
 * 「getViewport」は、要求された状態、値、または対象を読み取ります。
 * @returns 「getViewport」が読み取りまたは正規化した結果を返します。
 */ () => {
        const view = viewRef.current;
        return view ? readViewport(view) : undefined;
      },
      /**
       * 指定された表示アンカーへスクロール位置を復元する。
       * @param anchor 「anchor」は、「restoreViewport」がWebview UI状態の処理対象を特定する入力です。
       * @returns 「restoreViewport」がWebview UI状態の入力を処理して得た固有の結果を返します。
       */
      restoreViewport: /**
 * 「restoreViewport」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param anchor 「anchor」は、「restoreViewport」がWebview UIで処理する対象を特定する入力です。
 * @returns 「restoreViewport」がWebview UI状態の入力を処理して得た固有の結果を返します。
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
 * 受け取った入力または現在の状態を検証し、呼び出し元へ必要な処理結果を返すコールバックです。
           * @returns 条件判定または変換の結果を返します。
           */
          () => viewportRestoreGenerationRef.current === generation,

          /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
           * @param restored restoredとして渡される、このコールバックの入力値です。
           * @returns 「restored」から生成した処理結果を返します。
           */
          (restored) => viewportRef.current?.(restored, false),

          /**
 * 受け取った入力または現在の状態を検証し、呼び出し元へ必要な処理結果を返すコールバックです。
           * @returns 「if」を実行し、値を返しません。
           */
          () => {
            viewportRestoreActiveRef.current = false;
          },
        );
      },
      /**
       * 指定された全体スクロール比率へ移動する。
       * @param ratio 表示領域のサイズまたは倍率で、画面レイアウト計算に使用します。
       * @returns 「restoreScrollRatio」がWebview UI状態の入力を処理して得た固有の結果を返します。
       */
      restoreScrollRatio: /**
 * 「restoreScrollRatio」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param ratio 「ratio」は、「restoreScrollRatio」がWebview UIで処理する対象を特定する入力です。
 * @returns 「restoreScrollRatio」がWebview UI状態の入力を処理して得た固有の結果を返します。
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
 * 受け取った入力または現在の状態を検証し、呼び出し元へ必要な処理結果を返すコールバックです。
           * @returns 「replaceSelection」の呼び出し結果を返します。
           */
          () => viewportRestoreGenerationRef.current === generation,

          /**
 * 「restored」を受け取り、処理結果を生成する処理です。
           * @param restored restoredとして渡される、このコールバックの入力値です。
           * @returns 「restored」から生成した処理結果を返します。
           */
          (restored) => viewportRef.current?.(restored, false),

          /**
 * 処理結果を生成する処理を実行するコールバックです。
           * @returns 「replaceSelection」を実行し、値を返しません。
           */
          () => {
            viewportRestoreActiveRef.current = false;
          },
        );
      },
    }));

    /**
     * 現在の選択範囲を指定されたMarkdown文字列で置換する。
     * @param markdown 挿入するMarkdown文字列。
     * @returns 何も返さない。
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
     * 現在の選択範囲を指定言語の fenced code block で囲む。
     * @param language コードブロックへ記載する言語名。
     * @returns 何も返さない。
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
     * 指定されたソース編集操作を現在の選択範囲へ適用する。
     * @param action 実行するMarkdown編集操作。
     * @returns 何も返さない。
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
     * 現在行の見出しレベルを指定値へ変更する。
     * @param level 設定する見出しレベル。0は本文を表す。
     * @returns 何も返さない。
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
     * 共通編集結果をCodeMirrorの変更へ変換し、選択範囲と表示位置を維持して適用する。
     * @param edit 置換後本文と外部オフセットの選択範囲。
     * @returns 何も返さない。
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
 * 「change」を変換し、変換後の要素を返すコールバックです。
       * @param change changeとして渡される、このコールバックの入力値です。
       * @returns 入力要素から生成した変換後の値を返します。
       */
      (change) => ({
        from: externalOffsetToEditor(view.state, change.rangeOffset),
        to: externalOffsetToEditor(
          view.state,
          change.rangeOffset + change.rangeLength,
        ),
        insert: toEditorInsertion(view.state, change.text),
      }));
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
/** 「SourceEditor」は、関連する処理間で共有する設定値または状態です。 */
/** CodeMirrorの編集ビューを公開するコンポーネント。入力・選択・スクロール操作を親へ橋渡しする。 */
export const SourceEditor = React.memo(
  SourceEditorView,

  /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
   * @param previous previousとして渡される、このコールバックの入力値です。
   * @param next nextとして渡される、このコールバックの入力値です。
   * @returns 「previous」「next」から生成した処理結果を返します。
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
 * 本文オフセットを含む1行の選択範囲を求める。
 * @param source 対象のMarkdown本文。
 * @param offset 行を調べる本文オフセット。
 * @returns 行頭から改行直前までの選択範囲。
 */
function currentLineSelection(source: string, offset: number): TextSelection {
  const safeOffset = Math.max(0, Math.min(offset, source.length));
  const from = source.lastIndexOf("\n", Math.max(0, safeOffset - 1)) + 1;
  const lineBreak = source.indexOf("\n", safeOffset);
  const to = lineBreak < 0 ? source.length : lineBreak;
  return { from, to };
}

/**
 * 本文オフセットを含むMarkdownリンク全体の選択範囲を探す。
 * @param source 対象のMarkdown本文。
 * @param offset リンク内か確認する本文オフセット。
 * @returns 見つかったリンク範囲。リンク外ならundefined。
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
 * 本文で使用されている改行文字を検出する。
 * @param value 改行形式を調べる本文。
 * @returns CRLF、CR、LFのいずれか。
 */
function detectLineSeparator(value: string): string {
  return value.includes("\r\n") ? "\r\n" : value.includes("\r") ? "\r" : "\n";
}

/**
 * 表示アンカーをエディターDOMのdata属性へ書き込む。
 * @param host エディターのホスト要素。
 * @param anchor 保存する表示アンカー。
 * @returns 何も返さない。
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
 * CodeMirrorの選択範囲を外部オフセットへ変換してDOMのdata属性へ書き込む。
 * @param host エディターのホスト要素。
 * @param state 選択範囲を含むCodeMirror状態。
 * @returns 何も返さない。
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
 * CRLFとCRをLFへ変換して改行形式を統一する。
 * @param value 正規化する文字列。
 * @returns LFへ統一した文字列。
 */
function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?|\n/g, "\n");
}

/**
 * 外部文字列をCodeMirror状態が使用する改行形式へ変換する。
 * @param state 改行形式を取得するCodeMirror状態。
 * @param value 挿入する外部文字列。
 * @returns CodeMirrorへ挿入する文字列。
 */
function toEditorInsertion(state: EditorState, value: string): string {
  const separator = state.facet(EditorState.lineSeparator) ?? "\n";
  return normalizeLineEndings(value).replace(/\n/g, separator);
}

/**
 * 「externalDocumentLength」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param state 処理対象の状態です。
 * @returns 計算結果の数値です。
 */
function externalDocumentLength(state: EditorState): number {
  const separatorLength = (state.facet(EditorState.lineSeparator) ?? "\n")
    .length;
  return (
    state.doc.length + (state.doc.lines - 1) * Math.max(0, separatorLength - 1)
  );
}

/**
 * CodeMirrorの現在値を、ホスト文書と同じ改行形式の全文スナップショットへ変換する。
 * @param state 処理対象の状態です。
 * @returns 「externalDocumentValue」が生成または変換したWebview UIの文字列を返します。
 */
function externalDocumentValue(state: EditorState): string {
  return state.doc.sliceString(
    0,
    state.doc.length,
    state.facet(EditorState.lineSeparator) ?? "\n",
  );
}

/**
 * CodeMirror内部オフセットを外部本文の改行を含むオフセットへ変換する。
 * @param state オフセット変換対象のCodeMirror状態。
 * @param offset CodeMirror内部オフセット。
 * @returns 外部本文上のオフセット。
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
 * 外部本文のオフセットをCodeMirror内部の改行正規化済みオフセットへ変換する。
 * @param state 変換対象のCodeMirror状態。
 * @param offset 外部本文上のオフセット。
 * @returns CodeMirror内部オフセット。
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
 * 任意の外部本文のオフセットをCodeMirror形式のオフセットへ変換する。
 * @param value 外部本文。
 * @param offset 外部本文上のオフセット。
 * @returns 改行をLFへ正規化した本文上のオフセット。
 */
function externalOffsetToEditorValue(value: string, offset: number): number {
  const safeOffset = Math.max(0, Math.min(offset, value.length));
  return normalizeLineEndings(value.slice(0, safeOffset)).length;
}

/**
 * CodeMirrorのスクロール位置から、表示中ブロックの外部本文アンカーを読む。
 * @param view 表示位置を取得するCodeMirrorビュー。
 * @returns 現在の表示アンカー。ビューが非表示ならundefined。
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
 * レイアウトが安定するまで表示アンカーへのスクロール復元をフレーム単位で繰り返す。
 * @param view 復元対象のCodeMirrorビュー。
 * @param anchor 復元する外部本文アンカー。
 * @param host 表示アンカーを公開するホスト要素。
 * @param programmaticScrollPendingRef プログラムスクロール中かを保持する参照。
 * @param isCurrent 現在の復元要求かを判定する関数。
 * @param onRestored 復元位置が計算できたときの通知関数。
 * @param onSettled 復元処理が完了したときの通知関数。
 * @param attempt 現在の再試行回数。
 * @returns 何も返さない。復元はrequestAnimationFrameで非同期に行う。
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
 * 次の描画フレームでUI更新処理を実行するコールバックです。
   * @returns 「if」を実行し、値を返しません。
   */
  () => {
    if (!isCurrent()) return;
    const offset = externalOffsetToEditor(view.state, anchor.offset);
    const block = view.lineBlockAt(offset);
    const nextScrollTop = anchor.scrollRatio !== undefined
      ? Math.min(1, Math.max(0, anchor.scrollRatio)) * Math.max(
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
    const settled = anchor.scrollRatio !== undefined
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
  });
}

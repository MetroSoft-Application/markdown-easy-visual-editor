/**
 * @fileoverview Markdown本文に埋め込まれたHTMLのURL属性を、構文木を使って追加強調する。
 */
import { html } from "@codemirror/lang-html";
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

/**
 * Markdown本文へ埋め込むHTML断片用の言語設定。
 *
 * Markdownでは断片HTMLを許容するため閉じタグ一致を強制せず、
 * XML風の自己終了タグも画像記法などで扱えるようにする。
 */
export const markdownHtmlLanguageSupport = html({
  matchClosingTags: false,
  selfClosingTags: true,
  autoCloseTags: false,
});

/** URLやローカルリソース参照として扱うHTML属性名。 */
const HTML_URL_ATTRIBUTE_NAMES = new Set([
  "href",
  "src",
  "srcset",
  "poster",
  "action",
  "formaction",
  "cite",
  "xlink:href",
]);

export interface HtmlUrlAttributeRange {
  from: number;
  to: number;
  attribute: string;
}

/**
 * 1つのMarkdown HTMLTag/HTMLBlockをHTMLとして解析し、URL属性値を抽出する。
 */
function collectUrlRangesFromHtmlNode(
  state: EditorState,
  nodeFrom: number,
  nodeTo: number,
): HtmlUrlAttributeRange[] {
  const source = state.doc.sliceString(nodeFrom, nodeTo);
  const tree = markdownHtmlLanguageSupport.language.parser.parse(source);
  const ranges: HtmlUrlAttributeRange[] = [];

  tree.iterate({
    enter(reference) {
      if (reference.name !== "Attribute") return;

      const attributeNode = reference.node;
      const nameNode = attributeNode.getChild("AttributeName");
      const valueNode =
        attributeNode.getChild("AttributeValue") ??
        attributeNode.getChild("UnquotedAttributeValue");
      if (!nameNode || !valueNode) return false;

      const attribute = source.slice(nameNode.from, nameNode.to).toLowerCase();
      if (!HTML_URL_ATTRIBUTE_NAMES.has(attribute)) return false;

      let valueFrom = valueNode.from;
      let valueTo = valueNode.to;
      if (valueTo - valueFrom >= 2) {
        const opening = source.slice(valueFrom, valueFrom + 1);
        const closing = source.slice(valueTo - 1, valueTo);
        if ((opening === '"' || opening === "'") && closing === opening) {
          valueFrom += 1;
          valueTo -= 1;
        }
      }
      if (valueTo <= valueFrom) return false;

      ranges.push({
        from: nodeFrom + valueFrom,
        to: nodeFrom + valueTo,
        attribute,
      });
      return false;
    },
  });

  return ranges;
}

/**
 * Markdown構文木から生HTMLのURL属性値だけを抽出する。
 *
 * 外側のMarkdown構文木でHTMLTag/HTMLBlockを先に確定するため、
 * インラインコードやコードフェンス内のHTMLコードは対象にならない。
 */
export function collectHtmlUrlAttributeRanges(
  state: EditorState,
  from = 0,
  to = state.doc.length,
): HtmlUrlAttributeRange[] {
  const safeFrom = Math.max(0, from);
  const safeTo = Math.min(state.doc.length, to);
  const ranges: HtmlUrlAttributeRange[] = [];
  const seen = new Set<string>();

  syntaxTree(state).iterate({
    from: safeFrom,
    to: safeTo,
    enter(reference) {
      if (reference.name !== "HTMLTag" && reference.name !== "HTMLBlock") {
        return;
      }

      for (const range of collectUrlRangesFromHtmlNode(
        state,
        reference.from,
        reference.to,
      )) {
        if (range.to <= safeFrom || range.from >= safeTo) continue;
        const key = `${range.from}:${range.to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        ranges.push(range);
      }

      // HTMLTag/HTMLBlockの内側は専用HTMLパーサーで処理済み。
      return false;
    },
  });

  return ranges;
}

/** 現在の可視範囲だけへURL属性の追加装飾を作成する。 */
function createHtmlUrlAttributeDecorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const seen = new Set<string>();

  for (const visible of view.visibleRanges) {
    for (const range of collectHtmlUrlAttributeRanges(
      view.state,
      visible.from,
      visible.to,
    )) {
      const key = `${range.from}:${range.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ranges.push(
        Decoration.mark({ class: "cm-html-url-attribute-value" }).range(
          range.from,
          range.to,
        ),
      );
    }
  }

  return Decoration.set(ranges, true);
}

/**
 * HTMLのsrc/href等を、通常の属性値色に加えてリンクとして視認できるよう装飾する。
 */
export const htmlUrlAttributeHighlightExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = createHtmlUrlAttributeDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = createHtmlUrlAttributeDecorations(update.view);
      }
    }
  },
  {
    decorations: (value) => value.decorations,
  },
);

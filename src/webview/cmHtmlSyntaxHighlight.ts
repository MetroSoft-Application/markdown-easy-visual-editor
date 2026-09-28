/**
 * @fileoverview Markdown本文に埋め込まれたHTMLのURL属性を、構文木を使って追加強調する。
 */
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

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
 * Markdown/HTMLの構文木からURL属性値だけを抽出する。
 *
 * HTMLとして解析されたAttributeノードだけを見るため、コードフェンスやインラインコードに
 * 記述された `<img src="...">` は対象にならない。
 */
export function collectHtmlUrlAttributeRanges(
  state: EditorState,
  from = 0,
  to = state.doc.length,
): HtmlUrlAttributeRange[] {
  const ranges: HtmlUrlAttributeRange[] = [];
  const seen = new Set<string>();

  syntaxTree(state).iterate({
    from: Math.max(0, from),
    to: Math.min(state.doc.length, to),
    enter(reference) {
      if (reference.name !== "Attribute") return;

      const attributeNode = reference.node;
      const nameNode = attributeNode.getChild("AttributeName");
      const valueNode =
        attributeNode.getChild("AttributeValue") ??
        attributeNode.getChild("UnquotedAttributeValue");
      if (!nameNode || !valueNode) return false;

      const attribute = state.doc
        .sliceString(nameNode.from, nameNode.to)
        .toLowerCase();
      if (!HTML_URL_ATTRIBUTE_NAMES.has(attribute)) return false;

      let valueFrom = valueNode.from;
      let valueTo = valueNode.to;
      if (valueTo - valueFrom >= 2) {
        const opening = state.doc.sliceString(valueFrom, valueFrom + 1);
        const closing = state.doc.sliceString(valueTo - 1, valueTo);
        if ((opening === '"' || opening === "'") && closing === opening) {
          valueFrom += 1;
          valueTo -= 1;
        }
      }
      if (valueTo <= valueFrom) return false;

      const key = `${valueFrom}:${valueTo}`;
      if (!seen.has(key)) {
        seen.add(key);
        ranges.push({ from: valueFrom, to: valueTo, attribute });
      }
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

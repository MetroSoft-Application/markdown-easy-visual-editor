/**
 * @fileoverview Markdown内HTMLのURL属性強調が構文境界を越えて誤適用されないことを検証する。
 */
import { EditorState } from "@codemirror/state";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { LanguageDescription } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import {
  collectHtmlUrlAttributeRanges,
  markdownHtmlLanguageSupport,
} from "../src/webview/cmHtmlSyntaxHighlight";

const htmlCodeLanguages = [
  LanguageDescription.of({
    name: "HTML",
    alias: ["html", "xhtml"],
    support: html(),
  }),
];

function createMarkdownState(source: string): EditorState {
  return EditorState.create({
    doc: source,
    extensions: [
      markdown({
        codeLanguages: htmlCodeLanguages,
        htmlTagLanguage: markdownHtmlLanguageSupport,
      }),
    ],
  });
}

function highlightedValues(source: string) {
  return collectHtmlUrlAttributeRanges(createMarkdownState(source)).map((range) => ({
    attribute: range.attribute,
    value: source.slice(range.from, range.to),
  }));
}

describe("collectHtmlUrlAttributeRanges", () => {
  it("collects href and image src values from embedded HTML", () => {
    const source =
      '<a href="./document.md"><img src="./assets/photo.webp" alt="写真"></a>';

    expect(highlightedValues(source)).toEqual([
      { attribute: "href", value: "./document.md" },
      { attribute: "src", value: "./assets/photo.webp" },
    ]);
  });

  it("supports multiline, uppercase, srcset, and self-closing image HTML", () => {
    const source = [
      "<img",
      '  SRC="../images/photo.webp"',
      '  srcset="./small.webp 1x, ./large.webp 2x"',
      '  alt="sample"',
      "/>",
    ].join("\n");

    expect(highlightedValues(source)).toEqual([
      { attribute: "src", value: "../images/photo.webp" },
      {
        attribute: "srcset",
        value: "./small.webp 1x, ./large.webp 2x",
      },
    ]);
  });

  it("supports unquoted URL attribute values", () => {
    const source = "<img src=assets/image.png alt=sample>";

    expect(highlightedValues(source)).toEqual([
      { attribute: "src", value: "assets/image.png" },
    ]);
  });

  it("does not treat ordinary HTML attribute values as URLs", () => {
    const source =
      '<img class="hero" alt="src=not-a-link" width="320" src="./real.png">';

    expect(highlightedValues(source)).toEqual([
      { attribute: "src", value: "./real.png" },
    ]);
  });

  it("does not highlight HTML examples inside inline code or fenced code", () => {
    const source = [
      '`<img src="./inline.png">`',
      "",
      "~~~html",
      '<img src="./fenced.png">',
      "~~~",
      "",
      '<img src="./real.png">',
    ].join("\n");

    expect(highlightedValues(source)).toEqual([
      { attribute: "src", value: "./real.png" },
    ]);
  });

  it("collects link-like attributes used by media and forms", () => {
    const source = [
      '<video poster="./poster.png">',
      '  <source src="./movie.mp4">',
      "</video>",
      '<form action="./submit"><button formaction="./quick">送信</button></form>',
      '<blockquote cite="https://example.com/source">引用</blockquote>',
    ].join("\n");

    expect(highlightedValues(source)).toEqual([
      { attribute: "poster", value: "./poster.png" },
      { attribute: "src", value: "./movie.mp4" },
      { attribute: "action", value: "./submit" },
      { attribute: "formaction", value: "./quick" },
      { attribute: "cite", value: "https://example.com/source" },
    ]);
  });
});

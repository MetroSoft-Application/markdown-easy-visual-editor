/**
 * @fileoverview Marp Coreを使ってスライドHTML、テーマCSS、Markdownソース範囲を生成する。
 */
import Marp from "@marp-team/marp-core";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const marpHighlightLanguages = {
  bash,
  css,
  go,
  java,
  javascript,
  json,
  markdown,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
};

for (const [name, language] of Object.entries(marpHighlightLanguages)) {
  hljs.registerLanguage(name, language);
}

/**
 * Marpの各スライドとMarkdown本文の対応範囲。
 */
export interface MarpSlideSourceRange {
  /** 1始まりのスライド番号。 */
  index: number;
  /** 対応するMarkdown開始行。 */
  startLine: number;
  /** 対応するMarkdown終了行。 */
  endLine: number;
  /** 対応するMarkdown開始オフセット。 */
  startOffset: number;
  /** 対応するMarkdown終了オフセット。 */
  endOffset: number;
  /** スライド内の最初の見出しテキスト。 */
  heading?: string;
}

/**
 * Marp Coreの描画結果。
 */
export interface MarpRenderResult {
  /** スライドごとのHTML。 */
  slides: string[];
  /** テーマとdirectiveを反映したCSS。 */
  css: string;
  /** Markdown本文と各スライドの対応範囲。 */
  sourceRanges: MarpSlideSourceRange[];
  /** Marp Core内の描画所要時間。 */
  renderDurationMs: number;
}

interface MappedToken {
  type?: string;
  map?: [number, number] | null;
  children?: MappedToken[] | null;
  content?: string;
}

/**
 * Marp Core内部のslide token mappingを読み出すためのMarp派生クラス。
 */
class SourceMappedMarp extends Marp {
  /**
   * 直前の描画でMarp Coreが保持したslide tokenを返す。
   * @returns スライドごとのMarp token一覧。
   */
  getMappedSlideTokens(): MappedToken[][] {
    return (this.lastSlideTokens ?? []) as MappedToken[][];
  }
}

/**
 * Marp Core v4でMarkdownをスライドごとに描画し、ソース対応表を生成する。
 * @param markdown - Marp形式のMarkdown本文。
 * @param katexFontPath - KaTeXフォントを同梱資産から読むための末尾スラッシュ付きURI。
 * @returns スライドHTML、テーマCSS、ソース範囲を含む描画結果。
 */
export function renderMarpMarkdown(
  markdown: string,
  katexFontPath: string,
): MarpRenderResult {
  const startedAt = performance.now();
  const marp = new SourceMappedMarp({
    // Keep Unicode emoji as text so the preview works without Marp Core's remote Twemoji CDN.
    emoji: { unicode: false, shortcode: false },
    math: { lib: "katex", katexFontPath },
    minifyCSS: true,
    script: false,
    markdown: {
      highlight: (code: string, language: string) =>
        language && hljs.getLanguage(language)
          ? hljs.highlight(code, { language, ignoreIllegals: true }).value
          : "",
    },
  });
  const rendered = marp.render(markdown, { htmlAsArray: true });
  const sourceRanges = mapSlideRanges(
    markdown,
    marp.getMappedSlideTokens(),
  );
  return {
    slides: rendered.html,
    css: removeExternalCssImports(rendered.css),
    sourceRanges,
    renderDurationMs: performance.now() - startedAt,
  };
}

/**
 * MarpテーマCSSから外部HTTP(S)の@importを除去し、ネットワーク不要にする。
 * @param css - Marp Coreが生成したテーマCSS。
 * @returns 外部CSS importを除いたテーマCSS。
 */
function removeExternalCssImports(css: string): string {
  return css.replace(
    /@import\s+(?:url\(\s*)?["']?https?:\/\/[^"')\s]+["']?\s*\)?\s*;?/gi,
    "",
  );
}

/**
 * Marp Coreのtoken行範囲をMarkdown本文の行・文字オフセットへ変換する。
 * @param markdown - 元のMarkdown本文。
 * @param slideTokens - Marp Coreのスライドごとのtoken一覧。
 * @returns スライド番号とMarkdown本文の開始・終了位置の対応表。
 */
function mapSlideRanges(
  markdown: string,
  slideTokens: MappedToken[][],
): MarpSlideSourceRange[] {
  const lineOffsets = [0];
  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown.charCodeAt(index) === 10) lineOffsets.push(index + 1);
  }
  return slideTokens.map((tokens, index) => {
    const maps = tokens
      .filter((token) => token.type !== "front_matter")
      .flatMap((token) => (token.map ? [token.map] : []));
    const startLineIndex = maps.length
      ? Math.min(...maps.map(([start]) => start))
      : 0;
    const endLineIndex = maps.length
      ? Math.max(...maps.map(([, end]) => end))
      : Math.min(startLineIndex + 1, lineOffsets.length);
    const startOffset = lineOffsets[Math.min(startLineIndex, lineOffsets.length - 1)] ?? 0;
    const endOffset = lineOffsets[Math.min(endLineIndex, lineOffsets.length)] ?? markdown.length;
    const heading = findSlideHeading(markdown, startLineIndex, endLineIndex);
    return {
      index: index + 1,
      startLine: startLineIndex + 1,
      endLine: Math.max(startLineIndex + 1, endLineIndex),
      startOffset,
      endOffset: Math.max(startOffset, endOffset),
      ...(heading ? { heading } : {}),
    };
  });
}

/**
 * 指定範囲内にある最初のATX見出しを取得する。
 * @param markdown - 元のMarkdown本文。
 * @param startLine - 0始まりの開始行。
 * @param endLine - 0始まりの終端行。
 * @returns 見出し記法を除いた先頭の見出し、または未検出時のundefined。
 */
function findSlideHeading(
  markdown: string,
  startLine: number,
  endLine: number,
): string | undefined {
  const lines = markdown.split(/\r?\n/);
  for (let index = startLine; index < Math.min(endLine, lines.length); index += 1) {
    const match = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(lines[index] ?? "");
    if (match) return match[1];
  }
  return undefined;
}

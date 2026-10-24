/**
 * @fileoverview Marpの各スライドを、PDFで個別ページとして扱えるHTMLへまとめる。
 */
import { normalizeMermaidFontSize, type WebviewSettings } from "../../shared/protocol";

/** Marpの描画済みスライドを含むPDF出力データ。 */
export interface MarpPdfExportContent {
  html: string;
  css: string;
  slideCount: number;
}

/**
 * PDFへ渡すMarp描画結果が現在の本文・設定に対応しているかを調べる入力。
 */
export interface MarpPdfExportReadinessInput {
  /** 現在PDF出力で要求されているMarkdown本文。 */
  requestedMarkdown: string;
  /** iframeがレイアウトを受理したMarkdown本文。 */
  layoutMarkdown?: string;
  /** 最後に完成した描画結果のMarkdown本文。 */
  renderedMarkdown?: string;
  /** 最後に完成した描画結果の設定署名。 */
  renderedSettingsSignature?: string;
  /** 現在のMarpプレビュー設定から生成した署名。 */
  currentSettingsSignature: string;
  /** PDFへ渡す描画結果が存在するときtrue。 */
  hasRenderedResult: boolean;
}

/**
 * Marp PDFレンダーを変える本文と設定を安定した比較用署名へまとめる。
 * @param markdown - Marpプレビューで現在要求されている本文。
 * @param settings - スライドまたはMermaid SVGの生成へ影響する設定。
 * @returns PDFエクスポート内容の描画世代を識別するJSON文字列。
 */
export function createMarpPdfExportRenderSignature(
  markdown: string,
  settings: Pick<
    WebviewSettings,
    "editorTheme" | "language" | "mermaidTheme" | "mermaidFontSize" | "remoteImagesEnabled"
  >,
): string {
  return JSON.stringify([
    markdown,
    settings.editorTheme,
    settings.language,
    settings.mermaidTheme,
    normalizeMermaidFontSize(settings.mermaidFontSize),
    settings.remoteImagesEnabled === true,
  ]);
}

/**
 * PDFへ渡す内容が本文、iframeレイアウト、設定のすべてで現在の描画世代と一致するか判定する。
 * @param input - 現在の要求と最後に完成したMarp結果の対応情報。
 * @returns 現在の本文と設定に一致する完成結果がそろう場合true。
 */
export function isMarpPdfExportReady(input: MarpPdfExportReadinessInput): boolean {
  return input.hasRenderedResult &&
    input.layoutMarkdown === input.requestedMarkdown &&
    input.renderedMarkdown === input.requestedMarkdown &&
    input.renderedSettingsSignature === input.currentSettingsSignature;
}

/**
 * サニタイズ済みのMarpスライドHTMLを、1スライドずつ識別できる要素へ包む。
 * @param slides - Marp Coreが描画し、呼び出し元でサニタイズ済みの各スライドHTML。
 * @param css - Marp Coreが生成したテーマとディレクティブのCSS。
 * @returns 空でないデッキならPDF用HTMLとページ数、空ならundefined。
 */
export function createMarpPdfExportContent(
  slides: readonly string[],
  css: string,
): MarpPdfExportContent | undefined {
  if (slides.length === 0) return undefined;

  const html = slides.map((slide, index) =>
    `<article class="mve-marp-slide mve-marp-pdf-slide" data-mve-marp-pdf-slide="${index + 1}"><div class="marpit">${slide}</div></article>`,
  ).join("\n");

  return { html, css, slideCount: slides.length };
}

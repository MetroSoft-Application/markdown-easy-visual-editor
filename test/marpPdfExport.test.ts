/**
 * @fileoverview Marp PDF用HTMLの生成と、本文・設定変更直後の古い描画結果を出力しない仕様を検証する。
 */
import { describe, expect, it } from "vitest";
import {
  createMarpPdfExportContent,
  createMarpPdfExportRenderSignature,
  isMarpPdfExportReady,
} from "../src/webview/marp/marpPdfExport";

describe("Marp PDF export content", () => {
  it("wraps each rendered slide separately and retains Marp CSS", () => {
    const css = "section { color: #123456; }";
    const content = createMarpPdfExportContent(
      ["<svg data-slide=\"one\"></svg>", "<svg data-slide=\"two\"></svg>"],
      css,
    );

    expect(content).toEqual({
      html: [
        '<article class="mve-marp-slide mve-marp-pdf-slide" data-mve-marp-pdf-slide="1"><div class="marpit"><svg data-slide="one"></svg></div></article>',
        '<article class="mve-marp-slide mve-marp-pdf-slide" data-mve-marp-pdf-slide="2"><div class="marpit"><svg data-slide="two"></svg></div></article>',
      ].join("\n"),
      css,
      slideCount: 2,
    });
  });

  it("does not create an empty deck", () => {
    expect(createMarpPdfExportContent([], "")).toBeUndefined();
  });

  /**
   * 同じ本文の旧フォントサイズ結果が、設定変更後のPDF出力へ再利用されないことを確認する。
   */
  it("waits for the current font-size render before exporting the same Markdown", () => {
    const markdown = "---\nmarp: true\n---\n```mermaid\nflowchart TD\n  A --> B\n```";
    const settings = {
      editorTheme: "dark" as const,
      language: "ja" as const,
      mermaidTheme: "default" as const,
      remoteImagesEnabled: false,
    };
    const previousSettingsSignature = createMarpPdfExportRenderSignature(
      markdown,
      { ...settings, mermaidFontSize: 16 },
    );
    const currentSettingsSignature = createMarpPdfExportRenderSignature(
      markdown,
      { ...settings, mermaidFontSize: 28 },
    );

    expect(isMarpPdfExportReady({
      requestedMarkdown: markdown,
      layoutMarkdown: markdown,
      renderedMarkdown: markdown,
      renderedSettingsSignature: previousSettingsSignature,
      currentSettingsSignature,
      hasRenderedResult: true,
    })).toBe(false);
    expect(isMarpPdfExportReady({
      requestedMarkdown: markdown,
      layoutMarkdown: markdown,
      renderedMarkdown: markdown,
      renderedSettingsSignature: currentSettingsSignature,
      currentSettingsSignature,
      hasRenderedResult: true,
    })).toBe(true);
  });
});

/**
 * @fileoverview draw.ioファイルの編集用XML、SVG描画、Markdown参照の妥当性を検証する。
 */
import { describe, expect, it } from "vitest";
import { chromium } from "playwright-core";
import { findChromium } from "./chromium";
import { imageMarkdown } from "../src/shared/markdown";
import { renderMarkdownUnsafeBlocks } from "../src/webview/markdown/markdownRendererCore";
import {
  createDrawioPlaceholderSvg,
  DRAWIO_SVG_EXTENSION,
  encodeDrawioRelativePath,
} from "../src/shared/drawioSvg";

const browserPath = process.env.MVE_BROWSER_PATH || findChromium();

describe("draw.io SVG placeholder", () => {
  it("embeds an editable uncompressed mxfile and has an independent visible image", () => {
    const svg = createDrawioPlaceholderSvg();
    expect(svg).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 320 160"');
    expect(svg).toContain('<rect x="40" y="40" width="240" height="80"');
    expect(svg).toContain(">draw.io</text>");
    expect(svg).not.toMatch(/<script\b|\bonload=/i);
    const content = /\bcontent="([^"]+)"/.exec(svg)?.[1];
    expect(content).toBeDefined();
    expect(content).toContain("&lt;mxfile");
    expect(content).toContain("compressed=&quot;false&quot;");
    expect(content).toContain("&lt;mxCell id=&quot;0&quot;/&gt;");
    expect(content).toContain("&lt;mxCell id=&quot;1&quot; parent=&quot;0&quot;/&gt;");
    expect(content).toContain("value=&quot;draw.io&quot;");
    expect(content).toContain("width=&quot;240&quot; height=&quot;80&quot;");
    expect(content).toContain("&lt;/mxfile&gt;");
    expect(DRAWIO_SVG_EXTENSION).toBe(".drawio.svg");
  });

  it("creates a relative Markdown image reference even with spaces, Japanese and URL delimiters", () => {
    const relativePath = "assets/資料 #1/diagram-abc.drawio.svg";
    const encoded = encodeDrawioRelativePath(relativePath);
    expect(encoded).toBe("assets/%E8%B3%87%E6%96%99%20%231/diagram-abc.drawio.svg");
    expect(imageMarkdown(encoded, "draw.io")).toBe(
      "![draw.io](assets/%E8%B3%87%E6%96%99%20%231/diagram-abc.drawio.svg)",
    );
    expect(encodeDrawioRelativePath("..\\diagrams\\a?.drawio.svg")).toBe(
      "../diagrams/a%3F.drawio.svg",
    );
    const markup = renderMarkdownUnsafeBlocks(imageMarkdown(encoded, "draw.io"), {
      remoteImagesEnabled: false,
      language: "ja",
    }).map((block) => block.html).join("");
    expect(markup).toContain("<img ");
    expect(markup).toContain("diagram-abc.drawio.svg");
  });

  it.skipIf(!browserPath)("renders SVG in Chromium and parses the embedded draw.io XML", async () => {
    const browser = await chromium.launch({ executablePath: browserPath, headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 400, height: 240 } });
      await page.goto("data:image/svg+xml," + encodeURIComponent(createDrawioPlaceholderSvg()));
      const state = await page.evaluate(() => {
        const svg = document.documentElement;
        const content = svg.getAttribute("content") ?? "";
        const drawing = new DOMParser().parseFromString(content, "application/xml");
        const rectangle = svg.querySelector("rect[x='40']");
        const label = svg.querySelector("text");
        return {
          size: [svg.getAttribute("width"), svg.getAttribute("height")],
          svgError: document.querySelector("parsererror") !== null,
          modelError: drawing.querySelector("parsererror") !== null,
          model: drawing.documentElement.tagName,
          layerCount: drawing.querySelectorAll("mxCell").length,
          visibleRectangle: Boolean(rectangle && rectangle.getBoundingClientRect().width > 0),
          visibleLabel: Boolean(label && label.getBoundingClientRect().width > 0),
        };
      });
      expect(state).toEqual({
        size: ["320", "160"],
        svgError: false,
        modelError: false,
        model: "mxfile",
        layerCount: 3,
        visibleRectangle: true,
        visibleLabel: true,
      });
      const screenshot = await page.screenshot({ type: "png" });
      expect(screenshot.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    } finally {
      await browser.close();
    }
  });
});

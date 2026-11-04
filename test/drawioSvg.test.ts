/**
 * @fileoverview draw.ioファイルの編集用XML、SVG描画、Markdown参照の妥当性を検証する。
 */
import { describe, expect, it } from "vitest";
import { chromium } from "playwright-core";
import { getMessages } from "../src/shared/messages";
import { RIBBON_LAYOUT } from "../src/webview/ribbon/ribbonLayout";
import { RIBBON_DEFINITIONS } from "../src/webview/ribbon/ribbonDefinitions";
import { resolveRibbonLabel } from "../src/webview/ribbon/ribbonLabels";
import { findChromium } from "./chromium";
import { renderMarkdownUnsafeBlocks } from "../src/webview/markdown/markdownRendererCore";
import {
  createDrawioPlaceholderSvg,
  drawioImageMarkdown,
  DRAWIO_IMAGE_ALT,
  DRAWIO_SVG_EXTENSION,
  encodeDrawioRelativePath,
  isDrawioSvgReference,
  isLocalDrawioSvgImageSource,
} from "../src/shared/drawioSvg";

/** SVG描画検証に使うChromium。見つからない環境では描画テストだけを省略する。 */
const browserPath = process.env.MVE_BROWSER_PATH || findChromium();

/**
 * Chromiumのコールド起動はVitestの既定5秒を超えることがあるため、描画テストだけ上限を延ばす。
 * 起動に失敗した場合はこの時間内に例外で失敗する。
 */
const CHROMIUM_TEST_TIMEOUT_MS = 30_000;

describe("draw.io SVG placeholder", () => {
  it("places a branded draw.io button in the Insert tab", () => {
    const insert = RIBBON_LAYOUT.tabs.find((tab) => tab.id === "insert");
    expect(insert?.groups.find((group) => group.id === "basic")?.itemIds).toContain("drawio");
    expect(resolveRibbonLabel(RIBBON_DEFINITIONS.items.drawio.label, getMessages("ja"))).toBe("draw.io");
    expect(resolveRibbonLabel(RIBBON_DEFINITIONS.items.drawio.label, getMessages("en"))).toBe("draw.io");
  });

  it("embeds an editable uncompressed mxfile and has an independent visible image", () => {
    const svg = createDrawioPlaceholderSvg();
    expect(svg).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="-0.5 -0.5 161 49"');
    expect(svg).toContain('<rect x="0" y="0" width="160" height="48"');
    expect(svg).toContain(">draw.io</text>");
    expect(svg).not.toMatch(/<script\b|\bonload=/i);
    const content = /\bcontent="([^"]+)"/.exec(svg)?.[1];
    expect(content).toBeDefined();
    expect(content).toContain("&lt;mxfile");
    expect(content).toContain("compressed=&quot;false&quot;");
    expect(content).toContain("&lt;mxCell id=&quot;0&quot;/&gt;");
    expect(content).toContain("&lt;mxCell id=&quot;1&quot; parent=&quot;0&quot;/&gt;");
    expect(content).toContain("value=&quot;draw.io&quot;");
    expect(content).toContain("width=&quot;160&quot; height=&quot;48&quot;");
    expect(content).toContain("&lt;/mxfile&gt;");
    expect(DRAWIO_SVG_EXTENSION).toBe(".drawio.svg");
  });

  /**
   * Markdownを壊す文字だけをエスケープし、日本語は既存の画像挿入と同じく生のまま残す。
   * プレビューとHostはdecodeURIComponentで戻すため、%自体のエスケープ漏れは別ファイル参照になる。
   */
  it("escapes only Markdown-breaking characters and keeps Japanese readable", () => {
    const encoded = encodeDrawioRelativePath("assets/資料 #1 (案)/diagram-abc.drawio.svg");
    expect(encoded).toBe("assets/資料%20%231%20%28案%29/diagram-abc.drawio.svg");
    expect(encodeDrawioRelativePath("..\\diagrams\\a?.drawio.svg")).toBe(
      "../diagrams/a%3F.drawio.svg",
    );
    expect(encodeDrawioRelativePath("100%/[x]　<y>.drawio.svg")).toBe(
      "100%25/%5Bx%5D%E3%80%80%3Cy%3E.drawio.svg",
    );
    expect(decodeURIComponent(encoded)).toBe("assets/資料 #1 (案)/diagram-abc.drawio.svg");
  });

  /** 挿入するMarkdownは画像とリンクの両方を同じ相対パスで持ち、プレビューでリンク付き画像として描画される。 */
  it("inserts a linked image so the preview shows the diagram and links to it", () => {
    const encoded = encodeDrawioRelativePath("assets/資料 1/diagram-abc.drawio.svg");
    const markdown = drawioImageMarkdown(encoded);
    expect(markdown).toBe(
      `[![${DRAWIO_IMAGE_ALT}](assets/資料%201/diagram-abc.drawio.svg)](assets/資料%201/diagram-abc.drawio.svg)`,
    );
    const markup = renderMarkdownUnsafeBlocks(markdown, {
      remoteImagesEnabled: false,
      language: "ja",
    }).map((block) => block.html).join("");
    expect(markup).toMatch(/<a [^>]*data-mve-link="assets\/資料%201\/diagram-abc\.drawio\.svg"[^>]*><img /);
    expect(markup).toContain('alt="draw.io"');
  });

  /** プレビューのクリック判定とHostの振り分けで、draw.io SVGだけを編集リンクとして扱う。 */
  /**
   * プレビューの画像クリックでdraw.ioを開くのは文書相対のローカル参照だけにする。
   * リモート画像のブラウザー遷移や、生HTML属性からワークスペース外の絶対パスを開く退行を検出する。
   */
  it("opens only document-relative draw.io images from the preview", () => {
    expect(isLocalDrawioSvgImageSource("images/diagram.drawio.svg")).toBe(true);
    expect(isLocalDrawioSvgImageSource("../shared/資料%201/a.dio.svg")).toBe(true);
    expect(isLocalDrawioSvgImageSource("https://example.com/a.drawio.svg")).toBe(false);
    expect(isLocalDrawioSvgImageSource("file:///C:/outside/a.drawio.svg")).toBe(false);
    expect(isLocalDrawioSvgImageSource("C:/outside/a.drawio.svg")).toBe(false);
    expect(isLocalDrawioSvgImageSource("/workspace-root/a.drawio.svg")).toBe(false);
    expect(isLocalDrawioSvgImageSource("\\\\server\\share\\a.drawio.svg")).toBe(false);
    expect(isLocalDrawioSvgImageSource("images/plain.svg")).toBe(false);
    expect(isLocalDrawioSvgImageSource("")).toBe(false);
  });

  it("recognizes draw.io SVG references regardless of escaping, query and fragment", () => {
    expect(isDrawioSvgReference("images/diagram.drawio.svg")).toBe(true);
    expect(isDrawioSvgReference("images/DIAGRAM.DRAWIO.SVG")).toBe(true);
    expect(isDrawioSvgReference("images/diagram.dio.svg?v=2#page")).toBe(true);
    expect(isDrawioSvgReference("images/diagram%2Edrawio%2Esvg")).toBe(true);
    expect(isDrawioSvgReference("images/%E0%A4%A.drawio.svg")).toBe(true);
    expect(isDrawioSvgReference("images/diagram.svg")).toBe(false);
    expect(isDrawioSvgReference("images/diagram.drawio")).toBe(false);
    expect(isDrawioSvgReference("images/diagram.drawio.svg.png")).toBe(false);
    expect(isDrawioSvgReference("")).toBe(false);
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
        const rectangle = svg.querySelector("rect[x='0']");
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
        size: ["161", "49"],
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
  }, CHROMIUM_TEST_TIMEOUT_MS);
});

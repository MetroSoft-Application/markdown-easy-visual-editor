import { describe, expect, it } from "vitest";
import { createMarpPdfExportContent } from "../src/webview/marp/marpPdfExport";

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
});

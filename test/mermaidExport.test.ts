/**
 * @fileoverview Mermaid SVGの大きさが変わるHTML/PDF出力で、以前の遅延SVG属性が残らないことを検証する。
 */
import { describe, expect, it } from "vitest";
import { prepareExportHtml } from "../src/shared/exportHtml";
import { applyMermaidExportMarkup } from "../src/webview/markdown/mermaidExport";

describe("Mermaid export SVG markup", () => {
  /**
   * 大きな旧SVGを遅延属性に保持した後、小さなSVGをインライン化した出力から旧属性を除去する。
   */
  it("removes a previous deferred SVG when the updated result becomes inline", () => {
    const oldSvg = `<svg id="old">${"x".repeat(80_000)}</svg>`;
    const currentSvg = '<svg id="current"><text>current</text></svg>';
    const nodeState = {
      dataset: { mveExportSvg: encodeURIComponent(oldSvg) },
      innerHTML: "",
      replaceChildren(): void {
        nodeState.innerHTML = "";
      },
    };
    const node = nodeState as unknown as HTMLElement;

    expect(applyMermaidExportMarkup(node, currentSvg, true)).toBe(true);

    const deferredSvgAttribute = node.dataset.mveExportSvg
      ? ` data-mve-export-svg="${node.dataset.mveExportSvg}"`
      : "";
    const output = prepareExportHtml(
      `<div class="diagram-block mermaid"${deferredSvgAttribute}>${node.innerHTML}</div>`,
    );

    expect(output).toContain(currentSvg);
    expect(output).not.toContain("data-mve-export-svg");
    expect(output).not.toContain("old");
  });

  /**
   * インラインSVGから巨大な外部SVGへ切り替えた場合、新しい文字列だけを遅延属性に格納する。
   */
  it("replaces the deferred attribute when the updated result remains large", () => {
    const nodeState = {
      dataset: { mveExportSvg: encodeURIComponent('<svg id="old"></svg>') },
      innerHTML: "old inline content",
      replaceChildren(): void {
        nodeState.innerHTML = "";
      },
    };
    const node = nodeState as unknown as HTMLElement;
    const currentSvg = `<svg id="current">${"x".repeat(80_000)}</svg>`;

    expect(applyMermaidExportMarkup(node, currentSvg, true)).toBe(false);
    expect(node.innerHTML).toBe("");
    expect(decodeURIComponent(node.dataset.mveExportSvg ?? "")).toBe(currentSvg);
  });
});

/**
 * @fileoverview Marp Coreのテーマ、スライド分割、数式、ソース対応を検証する。
 */
import { describe, expect, it } from "vitest";
import { renderMarpMarkdown } from "../src/webview/marp/marpRenderer";

describe("Marp Markdown rendering", () => {
  it("renders every slide and maps the result back to source offsets", () => {
    const markdown = [
      "---",
      "marp: true",
      "theme: gaia",
      "---",
      "# First slide",
      "",
      "```javascript",
      "const active = true;",
      "---",
      "```",
      "",
      "---",
      "",
      "# Second slide",
      "",
      "Content",
    ].join("\n");
    const result = renderMarpMarkdown(markdown, "file:///extension/marp-katex-fonts/");

    expect(result.slides).toHaveLength(2);
    expect(result.css.length).toBeGreaterThan(100);
    expect(result.sourceRanges).toHaveLength(2);
    expect(result.sourceRanges[0]).toMatchObject({ index: 1, heading: "First slide" });
    expect(result.sourceRanges[1]).toMatchObject({ index: 2, heading: "Second slide" });
    expect(markdown.slice(result.sourceRanges[1].startOffset)).toContain("# Second slide");
    expect(result.renderDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.slides.join("\n")).toContain("hljs-keyword");
  });

  it("uses bundled KaTeX output and supports the three built-in themes", () => {
    const themes = ["default", "gaia", "uncover"];
    const styles = themes.map((theme) => renderMarpMarkdown(
      `---\nmarp: true\ntheme: ${theme}\nmath: katex\n---\n\n# ${theme}\n\n$e^{i\\pi}+1=0$`,
      "file:///extension/marp-katex-fonts/",
    ));

    expect(styles.every((result) => result.slides.join("\n").includes("katex"))).toBe(true);
    expect(styles.every((result) => result.css.length > 100)).toBe(true);
    expect(styles.every((result) => !/@import[^;]+https?:\/\//i.test(result.css))).toBe(true);
    expect(new Set(styles.map((result) => result.css)).size).toBe(3);
  });

  it("keeps Unicode emoji available without remote Twemoji image dependencies", () => {
    const result = renderMarpMarkdown(
      "---\nmarp: true\n---\n\n# Emoji offline\n\n✅ Preview 🚀",
      "file:///extension/marp-katex-fonts/",
    );
    const html = result.slides.join("\n");

    expect(html).toContain("✅ Preview 🚀");
    expect(html).not.toContain("data-marp-twemoji");
    expect(html).not.toContain("twemoji");
  });
});

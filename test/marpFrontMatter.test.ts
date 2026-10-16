/**
 * @fileoverview Marp自動判定のfront matter境界とYAML型判定を検証する。
 */
import { describe, expect, it } from "vitest";
import { parseMarpFrontMatter } from "../src/extension/marpYamlRuntime";
import {
  hasMarpFrontMatterCandidate,
  isMarpMarkdown,
} from "../src/shared/marpFrontMatter";

function detectMarpMarkdown(markdown: string): boolean {
  return isMarpMarkdown(markdown, parseMarpFrontMatter);
}

describe("Marp Markdown detection", () => {
  it("avoids YAML loading when front matter has no possible Marp key", () => {
    expect(hasMarpFrontMatterCandidate("---\ntitle: ordinary\n---\n# Slide")).toBe(false);
    expect(hasMarpFrontMatterCandidate("# ordinary\n\nmarp: true")).toBe(false);
    expect(hasMarpFrontMatterCandidate("---\nmarp: false\n---\n# Slide")).toBe(true);
    expect(hasMarpFrontMatterCandidate('---\n"m\\u0061rp": true\n---\n# Slide')).toBe(true);
  });

  it("accepts a root boolean marker with a UTF-8 BOM and either closing delimiter", () => {
    expect(detectMarpMarkdown("\uFEFF---\r\nmarp: true\r\n---\r\n# Slide" )).toBe(true);
    expect(detectMarpMarkdown("---\nmarp: true\n...\n# Slide")).toBe(true);
  });

  it.each([
    ["no front matter", "# marp: true"],
    ["no marker", "---\n---\n# Slide"],
    ["false marker", "---\nmarp: false\n---\n# Slide"],
    ["string marker", '---\nmarp: "true"\n---\n# Slide'],
    ["nested marker", "---\nmetadata:\n  marp: true\n---\n# Slide"],
    ["duplicate marker", "---\nmarp: true\nmarp: true\n---\n# Slide"],
    ["invalid YAML", "---\nmarp: [true\n---\n# Slide"],
    ["missing end delimiter", "---\nmarp: true\n# Slide"],
    ["body marker", "# Slide\n\nmarp: true"],
    ["fenced marker", "```yaml\nmarp: true\n```"],
    ["body horizontal rule", "# Slide\n\n---\n\nmarp: true"],
    ["delimiter after front matter", "---\ntitle: slide\n---\n\n---\nmarp: true"],
  ])("rejects %s", (_label, markdown) => {
    expect(detectMarpMarkdown(markdown)).toBe(false);
  });
});

/**
 * @fileoverview Mermaidコードフェンスの軽量検出と入れ子コード除外を検証する。
 */
import { describe, expect, it } from "vitest";
import { hasMermaidFence } from "../src/shared/markdownFence";

describe("Mermaid code fence detection", () => {
  it.each([
    ["backtick fence", "```mermaid\ngraph LR\n  A --> B\n```"],
    ["uppercase language label", "```Mermaid\nflowchart TD\n  A --> B\n```"],
    ["tilde fence with options", "~~~mermaid\nflowchart LR\n~~~"],
    ["indented fence", "   ```mermaid\ngraph TD\n   ```"],
    ["long fence with CRLF", "````mermaid title\r\ngraph LR\r\n````\r\n"],
  ])("detects %s", (_label, markdown) => {
    expect(hasMermaidFence(markdown)).toBe(true);
  });

  it("detects a Mermaid fence when its body is within the preload limit", () => {
    expect(hasMermaidFence("```mermaid\nA-->B\n```", 96)).toBe(true);
  });

  it("does not select a Mermaid fence for preload when its body exceeds the limit", () => {
    const markdown = `\`\`\`mermaid\n${"A".repeat(97)}\n\`\`\``;

    expect(hasMermaidFence(markdown, 96)).toBe(false);
    expect(hasMermaidFence(markdown)).toBe(true);
  });

  it.each([
    ["plain text", "A Mermaid diagram is discussed here."],
    ["inline code", "Use `mermaid` as the language label."],
    ["another language", "```yaml\nmermaid: true\n```"],
    ["nested fence in a longer code fence", "````markdown\n```mermaid\ngraph LR\n```\n````"],
    ["backtick in backtick fence info", "```md` text\nmermaid\n```"],
  ])("ignores %s", (_label, markdown) => {
    expect(hasMermaidFence(markdown)).toBe(false);
  });
});

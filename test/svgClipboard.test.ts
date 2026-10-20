/**
 * @fileoverview クリップボードSVG文字列の受け入れ条件を検証する。
 */
import { describe, expect, it } from "vitest";
import { normalizeSvgClipboardText } from "../src/shared/svgClipboard";

describe("normalizeSvgClipboardText", () => {
  it("accepts a normal SVG document", () => {
    const source = '  <svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>  ';
    expect(normalizeSvgClipboardText(source)).toBe(source.trim());
  });

  it("accepts XML declaration, comments, and SVG doctype", () => {
    const source = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!-- generated -->',
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">',
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    ].join("\n");
    expect(normalizeSvgClipboardText(source)).toBe(source);
  });

  it("accepts an empty self-closing SVG root", () => {
    expect(normalizeSvgClipboardText("<svg viewBox=\"0 0 1 1\"/>")).toBe(
      "<svg viewBox=\"0 0 1 1\"/>",
    );
  });

  it("rejects HTML that merely contains an SVG", () => {
    expect(normalizeSvgClipboardText("<div><svg></svg></div>")).toBeUndefined();
  });

  it("rejects arbitrary text around an SVG", () => {
    expect(normalizeSvgClipboardText("before <svg></svg>")).toBeUndefined();
    expect(normalizeSvgClipboardText("<svg></svg> after")).toBeUndefined();
  });

  it("rejects non-SVG clipboard text", () => {
    expect(normalizeSvgClipboardText("plain text")).toBeUndefined();
    expect(normalizeSvgClipboardText("<img src=\"x.png\">")).toBeUndefined();
  });
});

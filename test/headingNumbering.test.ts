/**
 * @fileoverview 見出しの自動番号付けの設定値の正規化、番号を描くCSS、出力形式ごとのCSSの受け渡し、リボン項目と7言語の文言を検証する（実行境界はtest/Node）。
 * 検証する仕様: 未設定・旧値・不正値は番号なし（off）、H1から／H2からの番号の階層、引用・リスト内の見出しとfront matterを数えないこと、
 * DOCXと番号なしではエンジンへCSSを渡さないこと、表示タブに選択欄があり選択肢がpackage.jsonのenumと一致すること。
 * 回帰リスク: 既定で番号が付いて既存文書の表示・出力が変わること、counter-resetを見出しに置いてブロックをまたぐと番号が1へ戻ること、
 * DOCXへ効かないCSSを渡して出力が変わること、ロケールの欠落。
 * CSSカウンターの実際の描画結果はChromiumでの出力比較（output-compare）で確認する。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// exportEngine.tsはVS Code APIをimportするため、純粋関数だけを検証できるよう空のスタブにする。
vi.mock("vscode", () => ({}));

import {
  DEFAULT_HEADING_NUMBERING_MODE,
  HEADING_NUMBERING_MODES,
  headingNumberingCss,
  normalizeHeadingNumberingMode,
} from "../src/shared/headingNumbering";
import { exportHeadingNumberingCss } from "../src/extension/exportEngine";
import { getMessages, SUPPORTED_LANGUAGES } from "../src/shared/messages";
import { RIBBON_DEFINITIONS } from "../src/webview/ribbon/ribbonDefinitions";
import { resolveRibbonLabel } from "../src/webview/ribbon/ribbonLabels";
import { RIBBON_LAYOUT } from "../src/webview/ribbon/ribbonLayout";

describe("heading numbering mode", () => {
  it("defaults to off so existing documents keep their appearance", () => {
    expect(DEFAULT_HEADING_NUMBERING_MODE).toBe("off");
    expect(normalizeHeadingNumberingMode(undefined)).toBe("off");
    expect(normalizeHeadingNumberingMode(null)).toBe("off");
    expect(normalizeHeadingNumberingMode("H1")).toBe("off");
    expect(normalizeHeadingNumberingMode("h3")).toBe("off");
    expect(normalizeHeadingNumberingMode(true)).toBe("off");
  });

  it("keeps the known values", () => {
    for (const mode of HEADING_NUMBERING_MODES) expect(normalizeHeadingNumberingMode(mode)).toBe(mode);
  });

  it("matches the enum of the VS Code setting", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));
    const setting = manifest.contributes.configuration.properties["markdownEasyVisualEditor.preview.headingNumbering"];
    expect(setting.enum).toEqual([...HEADING_NUMBERING_MODES]);
    expect(setting.default).toBe(DEFAULT_HEADING_NUMBERING_MODE);
    expect(setting.scope).toBe("application");
  });
});

describe("heading numbering CSS", () => {
  it("is empty when numbering is off", () => {
    expect(headingNumberingCss("off", ".rendered-markdown")).toBe("");
  });

  it("numbers H1 to H6 from H1 as 1. / 1.1 / ... / 1.1.1.1.1.1", () => {
    const css = headingNumberingCss("h1", "body");
    expect(css).toContain("body{counter-reset:mve-heading-number-1 0 mve-heading-number-2 0 mve-heading-number-3 0 mve-heading-number-4 0 mve-heading-number-5 0 mve-heading-number-6 0}");
    expect(css).toContain('body .markdown-source-block > h1::before{content:counter(mve-heading-number-1) ". "}');
    expect(css).toContain('body .markdown-source-block > h2::before{content:counter(mve-heading-number-1) "." counter(mve-heading-number-2) " "}');
    expect(css).toContain("counter(mve-heading-number-6) \" \"}");
  });

  it("leaves H1 as the title and starts numbering at H2", () => {
    const css = headingNumberingCss("h2", ".rendered-markdown");
    expect(css).not.toMatch(/> h1(::before)?\{/);
    expect(css).toContain('.rendered-markdown .markdown-source-block > h2::before{content:counter(mve-heading-number-2) ". "}');
    expect(css).toContain('.rendered-markdown .markdown-source-block > h3::before{content:counter(mve-heading-number-2) "." counter(mve-heading-number-3) " "}');
  });

  it("restarts lower levels with counter-set on the heading, and never resets counters on headings", () => {
    const css = headingNumberingCss("h1", "body");
    expect(css).toContain("body .markdown-source-block > h2{counter-increment:mve-heading-number-2;counter-set:mve-heading-number-3 0 mve-heading-number-4 0 mve-heading-number-5 0 mve-heading-number-6 0}");
    expect(css).toContain("body .markdown-source-block > h6{counter-increment:mve-heading-number-6}");
    // counter-resetはルートの1件だけ。見出しに置くと、見出しを包むブロックの外へ番号が引き継がれない。
    expect(css.match(/counter-reset/g)).toHaveLength(1);
  });

  it("shows 0 for a skipped level (H1 followed directly by H3 becomes 1.0.1)", () => {
    // H3の番号は、H2のカウンターを必ず含む。H2がなければ0のまま表示される（README に記載した仕様）。
    const css = headingNumberingCss("h1", "body");
    expect(css).toContain('body .markdown-source-block > h3::before{content:counter(mve-heading-number-1) "." counter(mve-heading-number-2) "." counter(mve-heading-number-3) " "}');
  });

  it("numbers only headings directly inside a top-level block", () => {
    const css = headingNumberingCss("h1", "body");
    const headingSelectors = css.match(/[^}\n]*> h[1-6]\{/g) ?? [];
    expect(headingSelectors).toHaveLength(6);
    for (const selector of headingSelectors) expect(selector).toMatch(/^body \.markdown-source-block > h[1-6]\{$/);
  });

  it("does not count the heading drawn by front matter at the start of the document", () => {
    const css = headingNumberingCss("h2", "body");
    expect(css).toContain('body .markdown-source-block[data-source-from="0"]:has(> hr:only-child) + .markdown-source-block[data-source-from="4"] > :is(h1, h2){counter-increment:none;counter-set:none}');
    expect(css).toContain(":is(h1, h2)::before{content:none}");
  });
});

describe("heading numbering CSS sent to the export engine", () => {
  it("is sent for PDF and HTML when numbering is on", () => {
    expect(exportHeadingNumberingCss("pdf", "h1")).toBe(headingNumberingCss("h1", "body"));
    expect(exportHeadingNumberingCss("html", "h2")).toBe(headingNumberingCss("h2", "body"));
  });

  it("is not sent for DOCX, numbering off, or old requests without the field", () => {
    expect(exportHeadingNumberingCss("docx", "h1")).toBeUndefined();
    expect(exportHeadingNumberingCss("pdf", "off")).toBeUndefined();
    expect(exportHeadingNumberingCss("pdf", undefined)).toBeUndefined();
    expect(exportHeadingNumberingCss("html", "unknown")).toBeUndefined();
  });
});

describe("heading numbering on the View tab", () => {
  it("places the selector in the preview group after image resize", () => {
    const viewTab = RIBBON_LAYOUT.tabs.find((tab) => tab.id === "view");
    const group = viewTab?.groups.find((item) => item.id === "preview");
    expect(group?.itemIds).toEqual(["imageResize", "headingNumbering"]);
  });

  it("offers the same choices as the setting, in every language", () => {
    const numbering = RIBBON_DEFINITIONS.items.headingNumbering;
    const choices = numbering.options?.choices ?? [];
    expect(choices.map((choice) => choice.value)).toEqual([...HEADING_NUMBERING_MODES]);
    for (const language of SUPPORTED_LANGUAGES) {
      const messages = getMessages(language);
      for (const spec of [
        numbering.label,
        numbering.options?.title,
        ...choices.map((choice) => choice.label),
      ]) {
        expect(spec, language).toBeDefined();
        expect(resolveRibbonLabel(spec!, messages).trim(), language).not.toBe("");
      }
    }
  });
});

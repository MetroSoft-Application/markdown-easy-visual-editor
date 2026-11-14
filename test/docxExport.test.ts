/**
 * @fileoverview DOCX（Word文書）出力のWebview・共有側の仕様を検証する（実行境界はtest/Node）。
 * 検証する仕様: DOCX設定の既定値と正規化、出力タブのDOCXグループの配置・定義・7言語の文言、
 * 保存ダイアログのフィルター・ボタン文言・拡張子補完の規則、ヘッダー/フッターのトークン保護（印刷プレビューとの一致）。
 * 回帰リスク: 旧Host（docxOptionsなし）や手書き設定で例外になること、リボン項目・ロケールの欠落、
 * 拡張子のない保存先へ関連付けで開けないファイルを書くこと、PDF/HTMLの保存規則を変えてしまうこと。
 */
import { describe, expect, it, vi } from "vitest";

// exportEngine.tsはVS Code APIをimportするため、保存規則の純粋関数だけを検証できるよう空のスタブにする。
vi.mock("vscode", () => ({}));

import { getMessages, SUPPORTED_LANGUAGES } from "../src/shared/messages";
import {
  DEFAULT_DOCX_EXPORT_SETTINGS,
  normalizeDocxExportSettings,
} from "../src/shared/protocol";
import { RIBBON_DEFINITIONS } from "../src/webview/ribbon/ribbonDefinitions";
import { resolveRibbonLabel } from "../src/webview/ribbon/ribbonLabels";
import { RIBBON_LAYOUT } from "../src/webview/ribbon/ribbonLayout";
import { exportTargetSpec, protectEngineOnlyPlaceholders } from "../src/extension/exportEngine";

describe("header and footer placeholders sent to the export engine", () => {
  /** エンジンが文字の「{」として扱う私用領域の文字（U+E000）。 */
  const literalBrace = String.fromCharCode(0xe000);

  it("protects {title}, {file}, and {date} so the output matches the print preview", () => {
    expect(protectEngineOnlyPlaceholders("{title} - {file} ({date})"))
      .toBe(`${literalBrace}title} - ${literalBrace}file} (${literalBrace}date})`);
  });

  it("keeps page numbers, other braces, and empty values unchanged", () => {
    expect(protectEngineOnlyPlaceholders("{page}/{pages}")).toBe("{page}/{pages}");
    expect(protectEngineOnlyPlaceholders("{titles} {Title} {")).toBe("{titles} {Title} {");
    expect(protectEngineOnlyPlaceholders(undefined)).toBe("");
    expect(protectEngineOnlyPlaceholders("")).toBe("");
  });
});

describe("DOCX export settings", () => {
  it("defaults to saving without a dialog, like PDF and HTML export", () => {
    expect(DEFAULT_DOCX_EXPORT_SETTINGS).toEqual({ saveWithoutDialog: true });
  });

  it("falls back to defaults for missing, legacy, and invalid values", () => {
    expect(normalizeDocxExportSettings(undefined)).toEqual(DEFAULT_DOCX_EXPORT_SETTINGS);
    expect(normalizeDocxExportSettings(null)).toEqual(DEFAULT_DOCX_EXPORT_SETTINGS);
    expect(normalizeDocxExportSettings("false")).toEqual(DEFAULT_DOCX_EXPORT_SETTINGS);
    expect(normalizeDocxExportSettings({ saveWithoutDialog: "no" })).toEqual(DEFAULT_DOCX_EXPORT_SETTINGS);
  });

  it("keeps an explicit choice and drops unknown fields", () => {
    expect(normalizeDocxExportSettings({ saveWithoutDialog: false, extra: 1 })).toEqual({ saveWithoutDialog: false });
  });
});

describe("DOCX ribbon group", () => {
  it("follows the HTML group on the export tab with the save option and the export button", () => {
    const exportTab = RIBBON_LAYOUT.tabs.find((tab) => tab.id === "export");
    const groupIds = exportTab?.groups.map((group) => group.id) ?? [];
    expect(groupIds.indexOf("docx")).toBe(groupIds.indexOf("html") + 1);
    expect(exportTab?.groups.find((group) => group.id === "docx")?.itemIds)
      .toEqual(["docxSaveWithoutDialog", "exportDocx"]);
  });

  it("resolves the group, item labels, and help text in every supported language", () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const messages = getMessages(language);
      expect(resolveRibbonLabel(RIBBON_DEFINITIONS.groups.docx.label, messages), language).toBeTruthy();
      for (const id of ["docxSaveWithoutDialog", "exportDocx"] as const) {
        expect(resolveRibbonLabel(RIBBON_DEFINITIONS.items[id].label, messages), `${language} ${id}`).toBeTruthy();
      }
      expect(messages.ribbon.featureDescriptions.exportDocx, language).toBeTruthy();
      expect(messages.host.docxTrustRequired, language).toBeTruthy();
      expect(messages.host.docxProgress, language).toBeTruthy();
      expect(messages.host.docxExported("C:/out/a.docx"), language).toContain("C:/out/a.docx");
      expect(messages.app.toast.docxExported("C:/out/a.docx"), language).toContain("C:/out/a.docx");
      expect(messages.app.toast.docxExportFailed("engine failed"), language).toContain("engine failed");
    }
  });
});

describe("export save target rules", () => {
  it("offers a Word filter, a localized save label, and appends .docx when missing", () => {
    const spec = exportTargetSpec("docx", "ja");
    expect(spec.filters).toEqual({ Word: ["docx"] });
    expect(spec.saveLabel).toBe(getMessages("ja").ribbon.labels.exportDocx);
    expect(spec.hasExtension("C:/out/report.docx")).toBe(true);
    expect(spec.hasExtension("C:/out/report.DOCX")).toBe(true);
    expect(spec.hasExtension("C:/out/report")).toBe(false);
    expect(spec.hasExtension("C:/out/report.doc")).toBe(false);
  });

  it("keeps the existing PDF and HTML rules", () => {
    const pdf = exportTargetSpec("pdf", "en");
    expect(pdf.filters).toEqual({ PDF: ["pdf"] });
    expect(pdf.saveLabel).toBe("Export PDF");
    // PDFは従来どおり、指定された保存先へそのまま書き込む。
    expect(pdf.hasExtension("C:/out/report")).toBe(true);
    const html = exportTargetSpec("html", "en");
    expect(html.filters).toEqual({ HTML: ["html", "htm"] });
    expect(html.saveLabel).toBe("Export HTML");
    expect(html.hasExtension("C:/out/report.htm")).toBe(true);
    expect(html.hasExtension("C:/out/report")).toBe(false);
  });
});

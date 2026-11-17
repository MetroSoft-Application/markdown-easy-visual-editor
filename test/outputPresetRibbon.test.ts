/**
 * @fileoverview 出力タブに設定プリセットの選択・管理UIが登録され、表示言語別ラベルが有効なことを検証する。
 */
import { describe, expect, it } from "vitest";
import { getMessages, SUPPORTED_LANGUAGES } from "../src/shared/messages";
import { RIBBON_DEFINITIONS } from "../src/webview/ribbon/ribbonDefinitions";
import { RIBBON_LAYOUT } from "../src/webview/ribbon/ribbonLayout";
import { resolveRibbonLabel } from "../src/webview/ribbon/ribbonLabels";

describe("output preset ribbon controls", () => {
  it("places selection before PDF/HTML/DOCX, with a management button", () => {
    const exportTab = RIBBON_LAYOUT.tabs.find((tab) => tab.id === "export");
    expect(exportTab?.groups[0].id).toBe("presets");
    expect(exportTab?.groups[0].itemIds).toEqual([
      "outputPresetSelect", "manageOutputPresets",
    ]);
    expect(exportTab?.groups.map((group) => group.id)).toContain("docx");
    expect(exportTab?.groups.map((group) => group.id)).toContain("html");
    expect(exportTab?.groups.map((group) => group.id)).toContain("pdf");
  });

  it("resolves every preset label in all supported languages", () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const messages = getMessages(language);
      expect(resolveRibbonLabel(RIBBON_DEFINITIONS.items.outputPresetSelect.label, messages)).toBeTruthy();
      expect(resolveRibbonLabel(RIBBON_DEFINITIONS.items.manageOutputPresets.label, messages)).toBeTruthy();
      expect(messages.ribbon.labels.customPreset).toBeTruthy();
    }
  });
});

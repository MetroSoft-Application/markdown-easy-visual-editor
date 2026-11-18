/**
 * @fileoverview 出力タブの「保存した設定」選択欄の配置と、その操作に使う文言が全言語で揃い「プリセット」の語を含まないことを検証する。
 * 回帰リスク: 管理用ボタンの復活（入口の二重化）や、新しい操作ラベルの翻訳漏れによる空表示。
 */
import { describe, expect, it } from "vitest";
import { getMessages, SUPPORTED_LANGUAGES } from "../src/shared/messages";
import { RIBBON_DEFINITIONS } from "../src/webview/ribbon/ribbonDefinitions";
import { RIBBON_LAYOUT } from "../src/webview/ribbon/ribbonLayout";
import { resolveRibbonLabel } from "../src/webview/ribbon/ribbonLabels";

/** 画面に出る文言で使わない「プリセット」の語（各言語の訳語を含む）。 */
const PRESET_WORD = /プリセット|preset|预设|預設|사전 설정|프리셋|préréglage|prédéfini|vorlage|voreinstellung|preajuste|predefinid/i;

/** 印刷設定パネルの保存した設定の行と詳細設定で表示する文言キー。 */
const PRESET_LABEL_KEYS = [
  "customPreset", "outputPresetActions", "overwritePreset", "savePresetAs", "addSavedSettings", "duplicateSavedSettingsName", "renamePreset",
  "discardPresetChanges", "deletePreset", "importPresets", "exportPresets", "presetModified",
  "revertPreset", "presetName", "savePreset", "cancelPresetEdit", "presetDeleted", "presetOverwritten", "undoSavedSettingsChange",
  "advancedPrintSettings",
] as const;

describe("output preset ribbon controls", () => {
  // プリセットの入口は選択欄1つだけにし、管理操作は印刷設定パネルのメニューへまとめる。
  it("places only the preset selector before PDF/HTML/DOCX", () => {
    const exportTab = RIBBON_LAYOUT.tabs.find((tab) => tab.id === "export");
    expect(exportTab?.groups[0].id).toBe("presets");
    expect(exportTab?.groups[0].itemIds).toEqual(["outputPresetSelect"]);
    expect(exportTab?.groups.map((group) => group.id)).toEqual(
      expect.arrayContaining(["pdf", "html", "docx"]),
    );
    expect(Object.keys(RIBBON_DEFINITIONS.items)).not.toContain("manageOutputPresets");
  });

  // 翻訳漏れがあると操作メニューやボタンが空表示になるため、全言語で空でないことを確認する。
  it("resolves the selector label and every preset action label in all supported languages", () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const messages = getMessages(language);
      expect(resolveRibbonLabel(RIBBON_DEFINITIONS.items.outputPresetSelect.label, messages)).toBeTruthy();
      for (const key of PRESET_LABEL_KEYS) {
        expect(messages.ribbon.labels[key], `${language}.${key}`).toBeTruthy();
      }
      expect("managePresets" in messages.ribbon.labels, language).toBe(false);
      // 同じ名前の新規保存が上書きになることをボタンの名前で伝えるため、「保存」と「上書き保存」は別の語にする。
      expect(messages.ribbon.labels.overwritePreset, language).not.toBe(messages.ribbon.labels.savePreset);
      // 「変更あり」に「（PDF）」などの区分を添えない（保存内容は印刷設定パネルの項目だけなので区分の意味がない）。
      expect("presetModifiedParts" in messages.ribbon.labels, language).toBe(false);
      // 画面に出る文言に「プリセット」の語を使わない（ユーザーが保存する設定として扱う）。
      for (const key of ["outputPreset", ...PRESET_LABEL_KEYS] as const) {
        expect(messages.ribbon.labels[key], `${language}.${key}`).not.toMatch(PRESET_WORD);
      }
    }
  });
});

/**
 * @fileoverview 出力プリセットの正規化、組込プリセット、適用判定、共有JSON形式の回帰検査。
 */
import { describe, expect, it } from "vitest";
import {
  ACTIVE_OUTPUT_PRESET_STATE_KEY,
  MAX_OUTPUT_PRESETS,
  OUTPUT_PRESETS_STATE_KEY,
  builtInOutputPresets,
  exportOutputPresets,
  importOutputPresets,
  makeOutputPreset,
  matchesOutputPreset,
  normalizeOutputPresetName,
  normalizeOutputPresetValues,
  normalizeStoredOutputPresets,
  selectedOutputPresetId,
} from "../src/shared/outputPresets";
import {
  DEFAULT_DOCX_EXPORT_SETTINGS,
  DEFAULT_HTML_EXPORT_SETTINGS,
  DEFAULT_PDF_OPTIONS,
} from "../src/shared/protocol";

const example = normalizeOutputPresetValues({
  pdfOptions: DEFAULT_PDF_OPTIONS,
  htmlOptions: DEFAULT_HTML_EXPORT_SETTINGS,
  docxOptions: DEFAULT_DOCX_EXPORT_SETTINGS,
  previewFontFamily: DEFAULT_PDF_OPTIONS.fontFamily,
  editorTheme: "dark",
});

describe("output presets", () => {
  it("ships four built-in presets with distinct layout and names", () => {
    const ja = builtInOutputPresets("ja");
    const en = builtInOutputPresets("en");
    expect(ja.map((item) => item.id)).toEqual(en.map((item) => item.id));
    expect(ja).toHaveLength(4);
    expect(ja.map((item) => item.name)).toEqual([
      "技術仕様書", "社内報告書", "プレゼン資料", "印刷用",
    ]);
    expect(ja[2].pdfOptions.orientation).toBe("landscape");
    expect(ja[3].pdfOptions.saveWithoutDialog).toBe(false);
    expect(ja.every((item) => item.editorTheme === "light")).toBe(true);
  });

  it("stores PDF, HTML, DOCX, preview font and theme together", () => {
    const preset = makeOutputPreset("user-12345678", "社内用", {
      ...example,
      pdfOptions: { ...example.pdfOptions, bodyFontSize: 12, footer: "Confidential" },
      htmlOptions: { ...example.htmlOptions, embedImages: true },
      docxOptions: { saveWithoutDialog: false },
      previewFontFamily: "Arial, sans-serif",
      editorTheme: "light",
    });
    const restored = normalizeStoredOutputPresets([JSON.parse(JSON.stringify(preset))]);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toEqual(preset);
    expect(restored[0].pdfOptions.fontFamily).toBe(restored[0].previewFontFamily);
    expect(restored[0].pdfOptions.bodyFontSize).toBe(12);
    expect(restored[0].htmlOptions.embedImages).toBe(true);
    expect(restored[0].docxOptions.saveWithoutDialog).toBe(false);
  });

  it("marks manually edited settings as custom, but recognizes applied configuration", () => {
    const presets = builtInOutputPresets("ja");
    const active = presets[2];
    expect(selectedOutputPresetId(presets, active, active.id)).toBe(active.id);
    expect(matchesOutputPreset(active, active)).toBe(true);
    const edited = normalizeOutputPresetValues({
      ...active, pdfOptions: { ...active.pdfOptions, margins: { ...active.pdfOptions.margins, top: 23 } },
    });
    expect(selectedOutputPresetId(presets, edited, active.id)).toBe("");
    expect(matchesOutputPreset(active, edited)).toBe(false);
  });

  it("rejects invalid names and malformed stored entries instead of creating presets", () => {
    expect(normalizeOutputPresetName("  ")).toBeUndefined();
    expect(normalizeOutputPresetName("bad\nname")).toBeUndefined();
    expect(normalizeOutputPresetName("x".repeat(65))).toBeUndefined();
    const preset = makeOutputPreset("user-12345678", "Alpha", example);
    expect(normalizeStoredOutputPresets([null, {}, preset, preset])).toEqual([preset]);
    expect(normalizeStoredOutputPresets([])).toEqual([]);
    expect(normalizeStoredOutputPresets("wrong")).toEqual([]);
  });

  it("round-trips a versioned JSON file and rejects incompatible data", () => {
    const preset = makeOutputPreset("user-12345678", "Print report", example);
    const serialized = exportOutputPresets([preset]);
    expect(importOutputPresets(serialized)).toEqual([preset]);
    expect(() => importOutputPresets('{"format":"wrong","version":1,"presets":[]}')).toThrow();
    expect(() => importOutputPresets('{"format":"mve-output-presets","version":2,"presets":[]}')).toThrow();
    expect(() => importOutputPresets('{"format":"mve-output-presets","version":1,"presets":[{}]}')).toThrow();
    expect(() => importOutputPresets("x".repeat(1024 * 1024 + 1))).toThrow();
  });

  it("guards global storage size and uses versioned keys", () => {
    expect(MAX_OUTPUT_PRESETS).toBeGreaterThan(10);
    expect(OUTPUT_PRESETS_STATE_KEY).toContain(".v1");
    expect(ACTIVE_OUTPUT_PRESET_STATE_KEY).toContain(".v1");
  });
});

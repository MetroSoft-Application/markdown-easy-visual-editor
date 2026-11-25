/**
 * @fileoverview ユーザーが保存する出力設定の正規化、組込の設定を持たないこと、適用判定と「変更あり」の判定、共有JSON形式の回帰検査。
 */
import { describe, expect, it } from "vitest";
import {
  ACTIVE_OUTPUT_PRESET_STATE_KEY,
  MAX_OUTPUT_PRESETS,
  OUTPUT_PRESETS_STATE_KEY,
  exportOutputPresets,
  importOutputPresets,
  makeOutputPreset,
  matchesOutputPreset,
  normalizeOutputPresetName,
  normalizeOutputPresetValues,
  normalizeStoredOutputPresets,
  resolveOutputPresetState,
  restoreDeletedOutputPreset,
  selectedOutputPresetId,
} from "../src/shared/outputPresets";
import * as outputSettingsModule from "../src/shared/outputPresets";
import { DEFAULT_PDF_OPTIONS } from "../src/shared/protocol";

const example = normalizeOutputPresetValues({ pdfOptions: DEFAULT_PDF_OPTIONS });

/** 判定テスト用の、ユーザーが保存した設定3件（用紙・向き・文字サイズだけが異なる）。 */
const savedSettings = [
  makeOutputPreset("user-aaaaaaaa-0001", "A4 report", example),
  makeOutputPreset("user-aaaaaaaa-0002", "A3 landscape", {
    ...example, pdfOptions: { ...example.pdfOptions, format: "A3", orientation: "landscape" },
  }),
  makeOutputPreset("user-aaaaaaaa-0003", "Large text", {
    ...example, pdfOptions: { ...example.pdfOptions, bodyFontSize: 14 },
  }),
];

describe("output presets", () => {
  // あらかじめ用意した設定（組込の一覧）は持たない。一覧に出るのはユーザーが保存した設定だけ。
  it("does not ship any predefined settings", () => {
    expect(Object.keys(outputSettingsModule)).not.toContain("builtInOutputPresets");
    expect(normalizeStoredOutputPresets(undefined)).toEqual([]);
  });

  // 保存するのは印刷設定パネルの項目（PDF設定）だけ。フォントはプレビューと共通の設定なので含めない。
  it("stores only the print settings without the font", () => {
    const preset = makeOutputPreset("user-12345678", "社内用", {
      ...example,
      pdfOptions: { ...example.pdfOptions, bodyFontSize: 12, footer: "Confidential", fontFamily: "Arial, sans-serif" },
    });
    const restored = normalizeStoredOutputPresets([JSON.parse(JSON.stringify(preset))]);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toEqual(preset);
    expect(Object.keys(restored[0]).sort()).toEqual(["id", "name", "pdfOptions"]);
    expect(restored[0].pdfOptions.fontFamily).toBe(DEFAULT_PDF_OPTIONS.fontFamily);
    expect(restored[0].pdfOptions.bodyFontSize).toBe(12);
  });

  // 以前の形式で保存されたフォントは読み込み時に捨て、フォントだけが違う現在値も同じ設定として扱う（「変更あり」にしない）。
  it("drops a previously saved font and ignores the font when matching", () => {
    const old = { ...JSON.parse(JSON.stringify(savedSettings[0])), previewFontFamily: "Meiryo" };
    old.pdfOptions.fontFamily = "Meiryo";
    const [restored] = normalizeStoredOutputPresets([old]);
    expect(Object.keys(restored).sort()).toEqual(["id", "name", "pdfOptions"]);
    expect(restored.pdfOptions.fontFamily).toBe(DEFAULT_PDF_OPTIONS.fontFamily);
    expect(matchesOutputPreset(restored, normalizeOutputPresetValues({
      pdfOptions: { ...example.pdfOptions, fontFamily: "Georgia, serif" },
    }))).toBe(true);
  });

  // テーマ・HTML・DOCX は印刷設定ではないので、以前の形式で保存されていても読み込み時に捨てる。
  // 「同じフォルダへ直接出力」は出力のしかたの設定なので、保存内容に含めず比較にも使わない。
  it("drops theme, HTML, DOCX and export-destination settings", () => {
    const old = {
      ...JSON.parse(JSON.stringify(savedSettings[0])),
      editorTheme: "light",
      htmlOptions: { embedImages: true },
      docxOptions: { saveWithoutDialog: true },
    };
    const [restored] = normalizeStoredOutputPresets([old]);
    expect(restored).toEqual(savedSettings[0]);
    expect("editorTheme" in restored).toBe(false);
    const withDirectExport = normalizeOutputPresetValues({
      ...savedSettings[0], pdfOptions: { ...savedSettings[0].pdfOptions, saveWithoutDialog: true },
    });
    expect(withDirectExport.pdfOptions.saveWithoutDialog).toBe(false);
    expect(matchesOutputPreset(savedSettings[0], withDirectExport)).toBe(true);
  });

  it("marks manually edited settings as custom, but recognizes applied configuration", () => {
    const presets = savedSettings;
    const active = presets[1];
    expect(selectedOutputPresetId(presets, active, active.id)).toBe(active.id);
    expect(matchesOutputPreset(active, active)).toBe(true);
    const edited = normalizeOutputPresetValues({
      ...active, pdfOptions: { ...active.pdfOptions, margins: { ...active.pdfOptions.margins, top: 23 } },
    });
    expect(selectedOutputPresetId(presets, edited, active.id)).toBe("");
    expect(matchesOutputPreset(active, edited)).toBe(false);
  });

  // リボンとパネルが同じ表示になるよう、表示する保存済みの設定と「変更あり」を1つの関数で決める。
  it("keeps the last applied preset selected and flags edits as modified", () => {
    const presets = savedSettings;
    const last = presets[0];
    expect(resolveOutputPresetState(presets, last, last.id)).toEqual({ presetId: last.id, modified: false });

    const edited = normalizeOutputPresetValues({
      ...last, pdfOptions: { ...last.pdfOptions, bodyFontSize: 12.5 },
    });
    expect(resolveOutputPresetState(presets, edited, last.id)).toEqual({ presetId: last.id, modified: true });

    // 編集の結果が別の保存済みの設定と一致したら、それを未変更として表示する。
    expect(resolveOutputPresetState(presets, presets[2], last.id)).toEqual({ presetId: presets[2].id, modified: false });

    // 基準がない（未設定・削除済み）なら、一致しない設定は未保存として扱う。
    expect(resolveOutputPresetState(presets, edited)).toEqual({ presetId: "", modified: false });
    expect(resolveOutputPresetState(presets, edited, "user-deleted-0000")).toEqual({ presetId: "", modified: false });
    expect(resolveOutputPresetState(presets, presets[1])).toEqual({ presetId: presets[1].id, modified: false });
    expect(resolveOutputPresetState([], edited, last.id)).toEqual({ presetId: "", modified: false });
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
    // 利用者が開くファイルなので、形式名とキーに「preset」の語を使わない。
    expect(serialized).not.toMatch(/preset/i);
    expect(JSON.parse(serialized)).toMatchObject({ format: "mve-saved-output-settings", version: 1 });
    expect(() => importOutputPresets('{"format":"wrong","version":1,"settings":[]}')).toThrow();
    expect(() => importOutputPresets('{"format":"mve-saved-output-settings","version":2,"settings":[]}')).toThrow();
    expect(() => importOutputPresets('{"format":"mve-saved-output-settings","version":1,"settings":[{}]}')).toThrow();
    expect(() => importOutputPresets('{"format":"mve-output-presets","version":1,"presets":[]}')).toThrow();
    expect(() => importOutputPresets("x".repeat(1024 * 1024 + 1))).toThrow();
  });

  it("guards global storage size and uses versioned keys", () => {
    expect(MAX_OUTPUT_PRESETS).toBeGreaterThan(10);
    expect(OUTPUT_PRESETS_STATE_KEY).toContain(".v1");
    expect(ACTIVE_OUTPUT_PRESET_STATE_KEY).toContain(".v1");
  });
});

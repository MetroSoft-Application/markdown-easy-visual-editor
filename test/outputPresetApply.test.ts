/**
 * @fileoverview 保存した設定の適用で Extension Host が守る約束を検査する（test 境界、VS Code API なし）。
 * 回帰リスク: 完了通知が設定通知より先に届く・届かないと、Webview は選んだ値のまま固まるか、適用前の値へ戻る。
 * 同じ値のキーまで書き込むと、キーごとに settings.json が書かれて選択欄の反映が遅れる。
 */
import { describe, expect, it } from "vitest";
import {
  configurationEntriesToWrite,
  runOutputPresetApply,
  savedPrintSettingsConfigurationEntries,
} from "../src/extension/outputPresetApply";
import { GLOBAL_CONFIGURATION_KEYS } from "../src/extension/globalSettingsKeys";
import { normalizeOutputPresetValues } from "../src/shared/outputPresets";
import { DEFAULT_PDF_OPTIONS } from "../src/shared/protocol";

describe("savedPrintSettingsConfigurationEntries", () => {
  // 保存した印刷設定を選んでも、フォント・テーマ・HTML・DOCX と「同じフォルダへ直接出力」は書かない（印刷設定パネルの項目だけ）。
  it("writes only print panel settings", () => {
    const values = normalizeOutputPresetValues({
      pdfOptions: { ...DEFAULT_PDF_OPTIONS, format: "A3", saveWithoutDialog: true, fontFamily: "Arial, sans-serif" },
    });
    const entries = savedPrintSettingsConfigurationEntries(values);
    const keys = entries.map(([key]) => key);
    // 書いてよいキーの一覧と完全に一致させる（新しい種類のキーが紛れ込んでも検出できるように）。
    const pdf = GLOBAL_CONFIGURATION_KEYS.pdf;
    expect([...keys].sort()).toEqual([
      GLOBAL_CONFIGURATION_KEYS.output.textReplacements,
      pdf.format, pdf.orientation, pdf.marginTop, pdf.marginRight, pdf.marginBottom, pdf.marginLeft, pdf.header, pdf.footer,
      pdf.bodyFontSize, pdf.headingFontSizeH1, pdf.headingFontSizeH2, pdf.headingFontSizeH3, pdf.headingFontSizeH4,
      pdf.headingFontSizeH5, pdf.headingFontSizeH6, pdf.codeFontSize, pdf.lineHeight, pdf.paragraphSpacing,
    ].sort());
    expect(keys).not.toContain(GLOBAL_CONFIGURATION_KEYS.pdf.saveWithoutDialog);
    expect(keys.filter((key) => /theme|^html\.|^docx\./i.test(key))).toEqual([]);
    expect(keys).not.toContain(GLOBAL_CONFIGURATION_KEYS.previewFontFamily);
    expect(keys).toContain(GLOBAL_CONFIGURATION_KEYS.output.textReplacements);
    expect(entries).toContainEqual([GLOBAL_CONFIGURATION_KEYS.pdf.format, "A3"]);
  });
});

describe("configurationEntriesToWrite", () => {
  // 既に同じ値のキーは書かず、違うキーだけを元の順序で書く。
  it("skips keys whose global value is already equal and keeps order", () => {
    const current: Record<string, unknown> = {
      "pdf.format": "A4",
      "pdf.marginTop": 15,
      "output.textReplacements": [{ pattern: "a", replacement: "b", flags: { regex: false } }],
    };
    const entries: Array<readonly [string, unknown]> = [
      ["pdf.marginTop", 20],
      ["pdf.format", "A4"],
      // オブジェクトのキーの順序が違っても同じ値として扱う。
      ["output.textReplacements", [{ replacement: "b", pattern: "a", flags: { regex: false } }]],
      ["pdf.header", "title"],
    ];
    expect(configurationEntriesToWrite(entries, (key) => current[key], false))
      .toEqual([["pdf.marginTop", 20], ["pdf.header", "title"]]);
  });

  // global 値が未設定なら、既定値と同じ値でも明示値として書く（従来の保存結果を変えない）。
  it("still writes keys without a global value", () => {
    expect(configurationEntriesToWrite([["pdf.format", "A4"]], () => undefined, false))
      .toEqual([["pdf.format", "A4"]]);
  });

  // 型が違う値は同じとみなさず書く（安全側）。
  it("writes values that differ only by type", () => {
    expect(configurationEntriesToWrite([["pdf.bodyFontSize", 12]], () => "12", false))
      .toEqual([["pdf.bodyFontSize", 12]]);
  });

  // 移行用の指定では、global 値があるキーは値が違っても書かない。
  it("keeps existing global values when only unset keys may be written", () => {
    const current: Record<string, unknown> = { a: 1 };
    expect(configurationEntriesToWrite([["a", 2], ["b", 3]], (key) => current[key], true))
      .toEqual([["b", 3]]);
  });
});

describe("runOutputPresetApply", () => {
  /**
   * 呼ばれた処理を順に記録する手順一式を作る。
   * @param apply - 書き込み処理。
   * @param broadcast - 設定通知の処理。
   * @returns 記録と手順。
   */
  function recorder(apply: () => Promise<void>, broadcast: () => void = () => undefined) {
    const calls: string[] = [];
    return {
      calls,
      steps: {
        apply: async () => { calls.push("apply"); await apply(); },
        broadcast: () => { calls.push("broadcast"); broadcast(); },
        acknowledge: (succeeded: boolean) => { calls.push(`ack:${succeeded}`); },
      },
    };
  }

  // 成功時は書き込み → 全パネルへの設定通知 → 完了通知の順。
  it("broadcasts the written settings before acknowledging success", async () => {
    const { calls, steps } = recorder(async () => undefined);
    await runOutputPresetApply(steps);
    expect(calls).toEqual(["apply", "broadcast", "ack:true"]);
  });

  // 失敗（設定が見つからない・書き込み失敗・部分書き込み）でも、実際の値を送ってから失敗を知らせ、例外は呼び出し元へ返す。
  it("broadcasts and acknowledges failure, then rethrows", async () => {
    const { calls, steps } = recorder(async () => { throw new Error("write failed"); });
    await expect(runOutputPresetApply(steps)).rejects.toThrow("write failed");
    expect(calls).toEqual(["apply", "broadcast", "ack:false"]);
  });

  // 書き込みと設定通知の両方が失敗したら、利用者へは原因である書き込みの例外を返す。
  it("reports the apply error when both apply and broadcast fail", async () => {
    const original = console.error;
    console.error = () => undefined;
    try {
      const { calls, steps } = recorder(
        async () => { throw new Error("not found"); },
        () => { throw new Error("broadcast failed"); });
      await expect(runOutputPresetApply(steps)).rejects.toThrow("not found");
      expect(calls).toEqual(["apply", "broadcast", "ack:false"]);
    } finally {
      console.error = original;
    }
  });

  // 設定通知が例外を投げても完了通知は必ず送る（Webview が選んだ値のまま固まらない）。
  it("acknowledges even when broadcasting throws", async () => {
    const { calls, steps } = recorder(async () => undefined, () => { throw new Error("broadcast failed"); });
    await expect(runOutputPresetApply(steps)).rejects.toThrow("broadcast failed");
    expect(calls).toEqual(["apply", "broadcast", "ack:true"]);
  });
});

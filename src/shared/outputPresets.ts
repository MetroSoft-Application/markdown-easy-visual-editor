/**
 * @fileoverview HTML・PDF・DOCXで共有する出力設定プリセット。
 * 保存時の不正値の除去と、選択状態の一致判定をHostとWebviewで共有する。
 */
import {
  DEFAULT_DOCX_EXPORT_SETTINGS,
  DEFAULT_HTML_EXPORT_SETTINGS,
  DEFAULT_PDF_OPTIONS,
  normalizeDocxExportSettings,
  normalizeHtmlExportSettings,
  normalizePdfOptions,
  type DocxExportSettings,
  type EditorTheme,
  type HtmlExportSettings,
  type NormalizedPdfOptions,
} from "./protocol";
import { normalizeFontFamily } from "./fontFamily";

/** プリセットのユーザー保存数上限。インポートも同じ制限に従う。 */
export const MAX_OUTPUT_PRESETS = 40;
/** ユーザープリセットの保存キー。VS CodeのglobalStateに保持する。 */
export const OUTPUT_PRESETS_STATE_KEY = "markdownEasyVisualEditor.outputPresets.v1";
/** 直近で適用・保存されたプリセットの識別子。 */
export const ACTIVE_OUTPUT_PRESET_STATE_KEY = "markdownEasyVisualEditor.activeOutputPreset.v1";

/** 印刷・HTML・Wordの出力設定を1組にした永続データ。 */
export interface OutputPreset {
  id: string;
  name: string;
  pdfOptions: NormalizedPdfOptions;
  htmlOptions: HtmlExportSettings;
  docxOptions: DocxExportSettings;
  previewFontFamily: string;
  editorTheme: EditorTheme;
}

/** プリセットが表す設定値。保存名やIDを含まない。 */
export type OutputPresetValues = Omit<OutputPreset, "id" | "name">;

/**
 * 空白や制御文字だけの名前を認めず、表示領域を超える名前も拒否する。
 * @param value - 入力欄または保存ファイルから受け取った候補名。
 * @returns 利用可能な1–64文字の名前。不正な場合はundefined。
 */
export function normalizeOutputPresetName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return name.length > 0 && name.length <= 64 && !/[\u0000-\u001f\u007f]/.test(name)
    ? name : undefined;
}

/**
 * 他言語・旧バージョンで保存された値も、現在のサポート範囲へ正規化する。
 * @param value - PDF・HTML・DOCXの設定候補。
 * @returns 出力に使える値だけを含むスナップショット。
 */
export function normalizeOutputPresetValues(value: unknown): OutputPresetValues {
  const candidate = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<OutputPresetValues>
    : {};
  const pdf = normalizePdfOptions(candidate.pdfOptions);
  const previewFontFamily = normalizeFontFamily(candidate.previewFontFamily ?? pdf.fontFamily);
  return {
    pdfOptions: { ...pdf, fontFamily: previewFontFamily },
    htmlOptions: normalizeHtmlExportSettings(candidate.htmlOptions),
    docxOptions: normalizeDocxExportSettings(candidate.docxOptions),
    previewFontFamily,
    editorTheme: candidate.editorTheme === "light" ? "light" : "dark",
  };
}

/**
 * 検証済みの名前と値からプリセットスナップショットを生成する。
 * @param id - 不変のプリセット識別子。
 * @param name - 表示名。
 * @param values - 出力形式別設定とプレビュー共通設定。
 * @returns 正規化済みのプリセット。
 */
export function makeOutputPreset(id: string, name: string, values: OutputPresetValues): OutputPreset {
  const safeName = normalizeOutputPresetName(name);
  if (!safeName || !id || id.length > 100) throw new Error("Invalid output preset name or ID.");
  return { id, name: safeName, ...normalizeOutputPresetValues(values) };
}

/**
 * 保存データの形式が不正な場合はその項目だけを除去する。
 * @param value - globalStateやJSONファイルから読み込んだ未検証データ。
 * @returns 有効なユーザープリセットのみの一覧。
 */
export function normalizeStoredOutputPresets(value: unknown): OutputPreset[] {
  if (!Array.isArray(value)) return [];
  const used = new Set<string>();
  const presets: OutputPreset[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const candidate = item as Partial<OutputPreset>;
    const name = normalizeOutputPresetName(candidate.name);
    if (!name || typeof candidate.id !== "string" || !/^user-[a-f\d-]{8,90}$/i.test(candidate.id)) continue;
    if (used.has(candidate.id) || presets.some((existing) => existing.name.toLocaleLowerCase() === name.toLocaleLowerCase())) continue;
    if (!candidate.pdfOptions || !candidate.htmlOptions || !candidate.docxOptions) continue;
    used.add(candidate.id);
    presets.push(makeOutputPreset(candidate.id, name, candidate as OutputPresetValues));
    if (presets.length >= MAX_OUTPUT_PRESETS) break;
  }
  return presets;
}

/**
 * あらかじめ使える4種類。既定の設定値を参照するだけで保存データは作らない。
 * @param language - 表示言語のロケールコード。
 * @returns 固定IDを持つ組込プリセット4件。
 */
export function builtInOutputPresets(language: string): OutputPreset[] {
  const japanese = language === "ja";
  const base = normalizeOutputPresetValues({
    pdfOptions: DEFAULT_PDF_OPTIONS,
    htmlOptions: DEFAULT_HTML_EXPORT_SETTINGS,
    docxOptions: DEFAULT_DOCX_EXPORT_SETTINGS,
    previewFontFamily: DEFAULT_PDF_OPTIONS.fontFamily,
    editorTheme: "light",
  });
  const make = (id: string, ja: string, en: string, pdf: NormalizedPdfOptions, html = base.htmlOptions): OutputPreset =>
    makeOutputPreset(id, japanese ? ja : en, { ...base, pdfOptions: pdf, htmlOptions: html });
  return [
    make("builtin-technical", "技術仕様書", "Technical specification", normalizePdfOptions({
      ...base.pdfOptions, header: "", footer: "{page}/{pages}", bodyFontSize: 10.5,
    }), { ...base.htmlOptions, showOutlineSidebar: true }),
    make("builtin-report", "社内報告書", "Business report", normalizePdfOptions({
      ...base.pdfOptions, header: "Report", footer: "{page}/{pages}", bodyFontSize: 11,
    })),
    make("builtin-presentation", "プレゼン資料", "Presentation", normalizePdfOptions({
      ...base.pdfOptions, orientation: "landscape",
      margins: { top: 12, right: 12, bottom: 12, left: 12 },
      bodyFontSize: 15, headingFontSizes: { h1: 30, h2: 26, h3: 22, h4: 19, h5: 17, h6: 15 },
    })),
    make("builtin-print", "印刷用", "Print", normalizePdfOptions({
      ...base.pdfOptions, margins: { top: 20, right: 20, bottom: 20, left: 20 },
      header: "", footer: "", saveWithoutDialog: false,
    })),
  ];
}

/**
 * 保存時に定義した内容と現在の設定が一致するか、名前/IDを除いて比較する。
 * @param preset - 比較対象のプリセット。
 * @param current - 現在の出力設定。
 * @returns 設定値が一致する場合はtrue。
 */
export function matchesOutputPreset(preset: OutputPreset, current: OutputPresetValues): boolean {
  return JSON.stringify(normalizeOutputPresetValues(preset)) === JSON.stringify(normalizeOutputPresetValues(current));
}

/**
 * 設定が一致するプリセットを返し、変更後のカスタム設定では空文字列に戻す。
 * @param presets - 組込と保存済みのプリセット一覧。
 * @param current - 現在の出力設定。
 * @param preferredId - 以前選択したプリセットの識別子。
 * @returns 一致するプリセットID。未保存の変更があれば空文字列。
 */
export function selectedOutputPresetId(
  presets: readonly OutputPreset[],
  current: OutputPresetValues,
  preferredId?: string,
): string {
  const preferred = presets.find((preset) => preset.id === preferredId);
  if (preferred && matchesOutputPreset(preferred, current)) return preferred.id;
  return presets.find((preset) => matchesOutputPreset(preset, current))?.id ?? "";
}

/**
 * インポート・エクスポートで用いるバージョン付きJSONファイル形式。
 * @param presets - 書き出す保存済みプリセット。
 * @returns スキーマとバージョン情報を含むUTF-8 JSON文字列。
 */
export function exportOutputPresets(presets: readonly OutputPreset[]): string {
  return JSON.stringify({ format: "mve-output-presets", version: 1, presets }, null, 2) + "\n";
}

/**
 * JSONを解析し、ファイル形式と各項目の必須構造を検証する。
 * @param text - インポート対象ファイルのUTF-8テキスト。
 * @returns 正規化済みのインポート候補。
 */
export function importOutputPresets(text: string): OutputPreset[] {
  if (text.length > 1024 * 1024) throw new Error("Output preset file is too large.");
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid preset file.");
  const file = parsed as { format?: unknown; version?: unknown; presets?: unknown };
  if (file.format !== "mve-output-presets" || file.version !== 1 ||
      !Array.isArray(file.presets) || file.presets.length > MAX_OUTPUT_PRESETS) {
    throw new Error("Unsupported preset file format.");
  }
  const presets = normalizeStoredOutputPresets(file.presets);
  if (presets.length !== file.presets.length) throw new Error("Preset file contains invalid or duplicate entries.");
  return presets;
}

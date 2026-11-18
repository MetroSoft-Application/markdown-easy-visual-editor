/**
 * @fileoverview 印刷設定パネルでユーザーが名前を付けて保存する印刷設定。
 * 含めるのはパネルにある項目だけ（用紙・向き・余白・文字サイズ・行間・ヘッダー/フッター・見出し・コード・
 * 段落間隔・置換ルール）。フォント（プレビューと共通の設定）、テーマ、HTML・DOCX の出力設定、
 * 「同じフォルダへ直接出力」は含めず、適用しても変えない。
 * あらかじめ用意した設定（組込の一覧）は持たない。保存時の不正値の除去と、選択状態の一致判定をHostとWebviewで共有する。
 */
import {
  DEFAULT_PDF_OPTIONS,
  normalizePdfOptions,
  type NormalizedPdfOptions,
} from "./protocol";

/** 保存した出力設定を書き出すJSONファイルの形式名。読み込み時もこの値だけを受け付ける。 */
export const SAVED_OUTPUT_SETTINGS_FILE_FORMAT = "mve-saved-output-settings";

/** ユーザーが保存できる設定の件数上限。インポートも同じ制限に従う。 */
export const MAX_OUTPUT_PRESETS = 40;
/** ユーザープリセットの保存キー。VS CodeのglobalStateに保持する。 */
export const OUTPUT_PRESETS_STATE_KEY = "markdownEasyVisualEditor.outputPresets.v1";
/** 直近で適用・保存されたプリセットの識別子。 */
export const ACTIVE_OUTPUT_PRESET_STATE_KEY = "markdownEasyVisualEditor.activeOutputPreset.v1";

/**
 * 名前を付けて保存した印刷設定。
 * pdfOptions.saveWithoutDialog（同じフォルダへ直接出力）は印刷の見た目ではなく出力のしかたの設定なので、
 * 保存内容としては常に false に正規化し、比較にも適用にも使わない。
 * pdfOptions.fontFamily はプレビューのフォント設定（設定タブ）から決まる値なので、保存内容としては既定値に固定し、
 * 比較にも適用にも使わない。
 * 以前の形式で保存された htmlOptions、docxOptions、editorTheme、previewFontFamily は読み込み時に捨てる。
 */
export interface OutputPreset {
  id: string;
  name: string;
  pdfOptions: NormalizedPdfOptions;
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
 * 他言語・旧バージョンで保存された値も、現在のサポート範囲へ正規化する。印刷設定パネルにない項目は捨てる。
 * @param value - 印刷設定の候補（以前の形式の余分な項目を含んでよい）。
 * @returns 印刷設定パネルの項目だけを含むスナップショット。saveWithoutDialog は常に false、fontFamily は常に既定値。
 */
export function normalizeOutputPresetValues(value: unknown): OutputPresetValues {
  const candidate = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<OutputPresetValues>
    : {};
  const pdf = normalizePdfOptions(candidate.pdfOptions);
  return {
    pdfOptions: { ...pdf, fontFamily: DEFAULT_PDF_OPTIONS.fontFamily, saveWithoutDialog: false },
  };
}

/**
 * 検証済みの名前と値からプリセットスナップショットを生成する。
 * @param id - 不変のプリセット識別子。
 * @param name - 表示名。
 * @param values - 印刷設定。
 * @returns 正規化済みのプリセット。
 */
export function makeOutputPreset(id: string, name: string, values: OutputPresetValues): OutputPreset {
  const safeName = normalizeOutputPresetName(name);
  if (!safeName || !id || id.length > 100) throw new Error("Invalid name or ID for the saved settings.");
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
    if (!candidate.pdfOptions || typeof candidate.pdfOptions !== "object" || Array.isArray(candidate.pdfOptions)) continue;
    used.add(candidate.id);
    presets.push(makeOutputPreset(candidate.id, name, candidate as OutputPresetValues));
    if (presets.length >= MAX_OUTPUT_PRESETS) break;
  }
  return presets;
}

/**
 * 削除した保存した設定を、削除前の位置へ戻した一覧を返す（削除の「元に戻す」用）。
 * 削除は確認なしで即時に行うため、誤操作をこの関数で取り消せることが前提になる。
 * @param saved - 現在の保存した設定の一覧（正規化済み）。
 * @param deleted - Webview から受け取った削除前の設定。未検証の値として扱い、保存形式の検査を通す。
 * @param index - 削除前の位置。範囲外は先頭または末尾へ丸める。
 * @returns 戻した後の一覧。
 * @throws 形式が不正、同じIDまたは同じ名前が既にある、件数の上限に達している場合。
 * 同じ名前は、削除後に同名で保存し直した場合に起きる。上書きして消さないよう、戻さずに失敗させる。
 */
export function restoreDeletedOutputPreset(
  saved: readonly OutputPreset[],
  deleted: unknown,
  index: number,
): OutputPreset[] {
  const [preset] = normalizeStoredOutputPresets([deleted]);
  if (!preset) throw new Error("The deleted saved settings are invalid.");
  if (saved.length >= MAX_OUTPUT_PRESETS) throw new Error("No more settings can be saved.");
  if (saved.some((item) => item.id === preset.id
    || item.name.toLocaleLowerCase() === preset.name.toLocaleLowerCase())) {
    throw new Error("Saved settings with this name already exist.");
  }
  const position = Number.isInteger(index) ? Math.min(Math.max(index, 0), saved.length) : saved.length;
  return [...saved.slice(0, position), preset, ...saved.slice(position)];
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
 * @param presets - ユーザーが保存した設定の一覧。
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

/** 選択欄に表示するプリセットと、その保存内容から変更されているか。 */
export interface OutputPresetState {
  /** 選択欄に表示するプリセットID。基準がなく一致もしない場合は空文字列。 */
  presetId: string;
  /** presetIdのプリセットから設定が変わっている場合はtrue。presetIdが空ならfalse。 */
  modified: boolean;
}

/**
 * リボンと印刷設定パネルが同じ表示になるよう、選択中のプリセットと変更有無を1か所で決める。
 * 設定がいずれかのプリセットと一致すればそれを未変更として表示し、一致しなければ
 * 最後に適用・保存したプリセットを「変更あり」として表示する。最後のプリセットが
 * 削除済み・未設定の場合だけ、どのプリセットにも属さない設定（空文字列）として扱う。
 * @param presets - ユーザーが保存した設定の一覧。
 * @param current - 現在の出力設定。
 * @param lastPresetId - 最後に適用・保存したプリセットのID。未設定ならundefined。
 * @returns 表示するプリセットIDと変更有無。
 */
export function resolveOutputPresetState(
  presets: readonly OutputPreset[],
  current: OutputPresetValues,
  lastPresetId?: string,
): OutputPresetState {
  const matched = selectedOutputPresetId(presets, current, lastPresetId);
  if (matched) return { presetId: matched, modified: false };
  const last = presets.find((preset) => preset.id === lastPresetId);
  return last ? { presetId: last.id, modified: true } : { presetId: "", modified: false };
}

/**
 * インポート・エクスポートで用いるバージョン付きJSONファイル形式。利用者が開いて読むため、
 * 形式名とキーは「保存した出力設定」を表す名前にする（未リリースのため旧形式の読み込みは設けない）。
 * @param presets - 書き出すユーザーが保存した設定。
 * @returns スキーマとバージョン情報を含むUTF-8 JSON文字列。
 */
export function exportOutputPresets(presets: readonly OutputPreset[]): string {
  return JSON.stringify({ format: SAVED_OUTPUT_SETTINGS_FILE_FORMAT, version: 1, settings: presets }, null, 2) + "\n";
}

/**
 * JSONを解析し、ファイル形式と各項目の必須構造を検証する。
 * @param text - インポート対象ファイルのUTF-8テキスト。
 * @returns 正規化済みのインポート候補。
 */
export function importOutputPresets(text: string): OutputPreset[] {
  if (text.length > 1024 * 1024) throw new Error("The saved settings file is too large.");
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid saved settings file.");
  const file = parsed as { format?: unknown; version?: unknown; settings?: unknown };
  if (file.format !== SAVED_OUTPUT_SETTINGS_FILE_FORMAT || file.version !== 1 ||
      !Array.isArray(file.settings) || file.settings.length > MAX_OUTPUT_PRESETS) {
    throw new Error("Unsupported saved settings file format.");
  }
  const presets = normalizeStoredOutputPresets(file.settings);
  if (presets.length !== file.settings.length) throw new Error("The saved settings file contains invalid or duplicate entries.");
  return presets;
}

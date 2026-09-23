/**
 * @file ribbonLabels.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */

import type { Messages } from "../shared/messages";
import type { RibbonLabelSpec } from "./ribbonDefinitionTypes";
import type { TextColorUiText } from "./ribbonTypes";

/**
 * ラベルを取得または解決します。
 * @param spec 「spec」は、「resolveRibbonLabel」がWebview UI状態の処理対象を特定する入力です。
 * @param messages 「messages」は、「resolveRibbonLabel」がWebview UI状態の処理対象を特定する入力です。
 * @param japanese 「japanese」は、「resolveRibbonLabel」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「resolveRibbonLabel」が生成したWebview UIの表示文字列を返します。
 */
export function resolveRibbonLabel(
  spec: RibbonLabelSpec,
  messages: Messages,
  japanese: boolean,
): string {
  if (spec.kind === "localized") {
    return japanese ? spec.japanese : spec.english;
  }

  const value = spec.path.split(".").reduce<unknown>(
  /**
 * テスト「.」の前提条件を設定し、期待結果を検証するコールバックです。
   * @param current currentとして渡される、このコールバックの入力値です。
   * @param key メッセージまたは設定表から値を取得する識別キーです。
   * @returns テストデータまたは検証処理が生成した値を返します。
   */
  (current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return key in current
      ? (current as Record<string, unknown>)[key]
      : undefined;
  }, messages);

  if (spec.kind === "messageWithNumber") {
    if (typeof value !== "function") {
      throw new Error(`Ribbon label is not a numbered message: ${spec.path}`);
    }
    const result = (value as (numberValue: number) => unknown)(spec.value);
    if (typeof result !== "string") {
      throw new Error(`Ribbon numbered label is not a string: ${spec.path}`);
    }
    return result;
  }

  if (typeof value !== "string") {
    throw new Error(`Ribbon label is not a string: ${spec.path}`);
  }
  return value;
}

/** 「TEXT_COLOR_UI_TEXT」は、関連する処理間で共有する設定値または状態です。 */
const TEXT_COLOR_UI_TEXT: Record<string, TextColorUiText> = {
  ja: {
    label: "文字色",
    defaultColor: "既定（解除）",
    mixed: "混在",
    colors: {
      red: "赤",
      orange: "オレンジ",
      yellow: "黄",
      green: "緑",
      blue: "青",
      purple: "紫",
      gray: "グレー",
    },
  },
  en: {
    label: "Text color",
    defaultColor: "Default (clear)",
    mixed: "Mixed",
    colors: {
      red: "Red",
      orange: "Orange",
      yellow: "Yellow",
      green: "Green",
      blue: "Blue",
      purple: "Purple",
      gray: "Gray",
    },
  },
  "zh-cn": {
    label: "文字颜色",
    defaultColor: "默认（清除）",
    mixed: "混合",
    colors: {
      red: "红色",
      orange: "橙色",
      yellow: "黄色",
      green: "绿色",
      blue: "蓝色",
      purple: "紫色",
      gray: "灰色",
    },
  },
  ko: {
    label: "글자 색",
    defaultColor: "기본값(해제)",
    mixed: "혼합",
    colors: {
      red: "빨강",
      orange: "주황",
      yellow: "노랑",
      green: "초록",
      blue: "파랑",
      purple: "보라",
      gray: "회색",
    },
  },
  fr: {
    label: "Couleur du texte",
    defaultColor: "Par défaut (effacer)",
    mixed: "Mixte",
    colors: {
      red: "Rouge",
      orange: "Orange",
      yellow: "Jaune",
      green: "Vert",
      blue: "Bleu",
      purple: "Violet",
      gray: "Gris",
    },
  },
  de: {
    label: "Textfarbe",
    defaultColor: "Standard (entfernen)",
    mixed: "Gemischt",
    colors: {
      red: "Rot",
      orange: "Orange",
      yellow: "Gelb",
      green: "Grün",
      blue: "Blau",
      purple: "Violett",
      gray: "Grau",
    },
  },
  es: {
    label: "Color del texto",
    defaultColor: "Predeterminado (quitar)",
    mixed: "Mixto",
    colors: {
      red: "Rojo",
      orange: "Naranja",
      yellow: "Amarillo",
      green: "Verde",
      blue: "Azul",
      purple: "Morado",
      gray: "Gris",
    },
  },
};

/**
 * 本文を取得または解決します。
 * @param language 表示文言の解決に使用する言語コードまたはロケールです。
 * @returns 「getTextColorUiText」が読み取りまたは正規化した結果を返します。
 */
export function getTextColorUiText(language: string): TextColorUiText {
  const normalized = language.trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "zh" || normalized.startsWith("zh-cn")) {
    return TEXT_COLOR_UI_TEXT["zh-cn"];
  }
  return TEXT_COLOR_UI_TEXT[normalized.split("-")[0]] ?? TEXT_COLOR_UI_TEXT.en;
}

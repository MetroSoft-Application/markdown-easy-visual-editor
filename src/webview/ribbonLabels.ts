/**
 * @fileoverview Webviewのribbonlabelsを管理する。Hostとの通信、ユーザー操作、表示状態の契約を保つ。
 */
import type { Messages } from "../shared/messages";
import type { RibbonLabelSpec } from "./ribbonDefinitionTypes";
import type { TextColorUiText } from "./ribbonTypes";

/**
 * ribbonlabelsから必要な値またはリソースを取得する。
 * @param spec - ribbonlabelsへ渡す入力。
 * @param messages - ribbonlabelsで扱う文字列または本文。
 * @param japanese - 日本語表示で使う文言。
 * @returns ribbonlabelsで利用する文字列。
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
         * currentをifへ渡し、ribbonlabelsの結果または副作用を処理する。
         * @param current - ribbonlabelsへ渡す入力。
         * @param key - ribbonlabelsの対象や分岐を識別する値。
         * @returns ribbonlabelsのコールバックが生成する結果。
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

/**
 * ribbonlabelsで解析・表示・保存する本文。
 */
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
 * ribbonlabelsから必要な値またはリソースを取得する。
 * @param language - ribbonlabelsの対象や分岐を識別する値。
 * @returns ribbonlabelsのget・text・color・ui・textが生成する結果。
 */
export function getTextColorUiText(language: string): TextColorUiText {
    const normalized = language.trim().toLowerCase().replace(/_/g, "-");
    if (normalized === "zh" || normalized.startsWith("zh-cn")) {
        return TEXT_COLOR_UI_TEXT["zh-cn"];
    }
    return TEXT_COLOR_UI_TEXT[normalized.split("-")[0]] ?? TEXT_COLOR_UI_TEXT.en;
}

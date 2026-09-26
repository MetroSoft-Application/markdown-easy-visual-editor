/**
 * @fileoverview Webviewのribbonlabelsを管理する。Hostとの通信、ユーザー操作、表示状態の契約を保つ。
 */
import type { Messages } from "../shared/messages";
import type { RibbonLabelSpec } from "./ribbonDefinitionTypes";

/**
 * ribbonlabelsから必要な値またはリソースを取得する。
 * @param spec - ribbonlabelsへ渡す入力。
 * @param messages - ribbonlabelsで扱う文字列または本文。
 * @returns ribbonlabelsで利用する文字列。
 */
export function resolveRibbonLabel(
    spec: RibbonLabelSpec,
    messages: Messages,
): string {
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

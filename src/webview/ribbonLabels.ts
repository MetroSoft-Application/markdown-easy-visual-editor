/**
 * @fileoverview Webviewのribbonlabelsを管理する。Hostとの通信、ユーザー操作、表示状態の契約を保つ。
 */
import type { Messages } from "../shared/messages";
import type { RibbonLabelSpec } from "./ribbonDefinitionTypes";

/**
 * ラベル指定のメッセージキーから翻訳済みラベルを解決する。
 * @param spec メッセージオブジェクト内のキー経路と表示方法を指定するラベル設定。
 * @param messages Webviewで使う翻訳済みメッセージ一式。
 * @returns 指定されたメッセージ値、または解決できない場合のフォールバックラベル。
 */
export function resolveRibbonLabel(
    spec: RibbonLabelSpec,
    messages: Messages,
): string {
    const value = spec.path.split(".").reduce<unknown>(
        /**
         * currentをifへ渡し、ribbonlabelsの結果または副作用を処理する。
         * @param current - メッセージパスの走査中に参照している現在の値。
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

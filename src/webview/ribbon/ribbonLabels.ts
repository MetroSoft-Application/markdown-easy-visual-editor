/**
 * @fileoverview リボン項目IDごとの表示文言をローカライズメッセージから解決する。
 */
import type { Messages } from "../../shared/messages";
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
         * 途中の値がオブジェクトなら指定キーへ進み、異なる場合は解決を中断する。
         * @param current - パスの直前まで辿った翻訳値。
         * @param key - 次に読むプロパティ名。
         * @returns 指定プロパティの値。途中の値がオブジェクトでなければundefined。
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

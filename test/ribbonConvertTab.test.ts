/**
 * @fileoverview 変換タブ（文書全体のTextile↔Markdown変換）のリボン構成を検証する。
 * 検証する仕様: 配置・定義・ローカライズが揃っていること、現在の表示形式と同じ記法への変換ボタンと
 * 読み取り専用時のボタンが無効になること。
 * 回帰リスク: タブやボタンの追加時にID・定義・配置・ロケールのいずれかが欠けること。
 * 実行境界はtest（Node）。TSXの実装モジュールは読み込まず、起動時の構成検証（Ribbon.tsx）はスモークと実機確認で扱う。
 */
import { describe, expect, it } from "vitest";
import { getMessages, SUPPORTED_LANGUAGES } from "../src/shared/messages";
import { isDocumentRenderFormat } from "../src/shared/protocol";
import { isConvertButtonDisabled } from "../src/webview/ribbon/ribbonConvert";
import { RIBBON_DEFINITIONS } from "../src/webview/ribbon/ribbonDefinitions";
import { resolveRibbonLabel } from "../src/webview/ribbon/ribbonLabels";
import { RIBBON_LAYOUT } from "../src/webview/ribbon/ribbonLayout";

describe("convert ribbon tab",
    () => {
        it("is placed after the export tab with both conversion buttons",
            () => {
                const tabIds = RIBBON_LAYOUT.tabs.map((tab) => tab.id);
                expect(tabIds.indexOf("convert")).toBe(tabIds.indexOf("export") + 1);
                const convertTab = RIBBON_LAYOUT.tabs.find((tab) => tab.id === "convert");
                expect(convertTab?.groups.map((group) => group.id)).toEqual(["formatConversion"]);
                expect(convertTab?.groups[0]?.itemIds).toEqual(["convertToMarkdown", "convertToTextile"]);
            });

        it("resolves labels, tooltips, and help text in every supported language",
            () => {
                for (const language of SUPPORTED_LANGUAGES) {
                    const messages = getMessages(language);
                    expect(resolveRibbonLabel(RIBBON_DEFINITIONS.tabs.convert, messages), language).toBeTruthy();
                    expect(resolveRibbonLabel(RIBBON_DEFINITIONS.groups.formatConversion.label, messages), language).toBeTruthy();
                    for (const id of ["convertToMarkdown", "convertToTextile"] as const) {
                        const definition = RIBBON_DEFINITIONS.items[id];
                        expect(resolveRibbonLabel(definition.label, messages), `${language} ${id}`).toBeTruthy();
                        expect(definition.options?.title, `${language} ${id} title`).toBeDefined();
                        expect(resolveRibbonLabel(definition.options!.title!, messages), `${language} ${id} title`).toBeTruthy();
                    }
                    expect(messages.ribbon.featureDescriptions.convertDocument, language).toBeTruthy();
                    expect(messages.app.toast.documentConversionUnchanged, language).toBeTruthy();
                    // 変換は止めないため、見た目が変わり得る行・確かめられなかった理由・Marpの通知を、変換した旨の文言として出す。
                    expect(messages.app.toast.documentConvertedMayDiffer("3, 7"), language).toContain("3, 7");
                    expect(messages.app.toast.documentConvertedUnverified("worker failed"), language).toContain("worker failed");
                    expect(messages.app.toast.documentConvertedMarp, language).toBeTruthy();
                }
            });

        it("disables the button for the current syntax and both buttons when read-only",
            () => {
                expect(isConvertButtonDisabled("markdown", { readOnly: false, textileDocument: true })).toBe(false);
                expect(isConvertButtonDisabled("textile", { readOnly: false, textileDocument: true })).toBe(true);
                expect(isConvertButtonDisabled("markdown", { readOnly: false, textileDocument: false })).toBe(true);
                expect(isConvertButtonDisabled("textile", { readOnly: false, textileDocument: false })).toBe(false);
                expect(isConvertButtonDisabled("markdown", { readOnly: true, textileDocument: true })).toBe(true);
                expect(isConvertButtonDisabled("textile", { readOnly: true, textileDocument: false })).toBe(true);
            });
    });

describe("document render format kept by the extension host",
    () => {
        it("accepts only the render formats that the preview supports",
            () => {
                // 変換タブで切り替えた表示形式は、Webviewから拡張機能へ送られ、ワークスペースの状態に保持される。
                // 保持する前に、不正な値（旧版・改ざんされたメッセージ）を受け付けないことを確かめる。
                for (const format of ["markdown", "mixed", "textile"]) expect(isDocumentRenderFormat(format), format).toBe(true);
                for (const value of [undefined, null, "", "html", "Textile", 1, {}]) expect(isDocumentRenderFormat(value), String(value)).toBe(false);
            });
    });

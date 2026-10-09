/**
 * @fileoverview リボン設定の完全性、ID重複、グループ連続性、未使用定義や参照漏れを検証する。
 */
import { describe, expect, it } from "vitest";
import type { RibbonDefinitions } from "../src/webview/ribbonDefinitionTypes";
import type { RibbonLayoutDefinition } from "../src/webview/ribbonLayoutTypes";
import {
    type RibbonValidationHeaderImplementation,
    type RibbonValidationItemImplementation,
    validateRibbonConfiguration,
} from "../src/webview/ribbonValidation";

/**
 * テスト用のラベル参照。検証対象の項目はすべてこのラベルを共有する。
 */
const label = { kind: "message", path: "ribbon.groups.preview" } as const;

/**
 * テスト対象IDから有効な最小リボン配置と実装定義を組み立てる。
 * @param itemIds - リボン項目として定義するID一覧。
 * @returns 指定IDを含む配置と対応する実装定義。
 */
function configuration(
    itemIds: readonly string[] = ["undo"],
): {

    /**
     * 検証対象となるタブ・グループ・項目の配置。
     */
    layout: RibbonLayoutDefinition;

    /**
     * 各項目のラベルと選択肢のテスト用定義。
     */
    definitions: RibbonDefinitions;

    /**
     * リボン検証・テストの回帰で扱うimplementationsの文字列。
     */
    implementations: Record<string, RibbonValidationItemImplementation>;

    /**
     * 各ヘッダー項目へ割り当てるテスト用の実装関数。
     */
    headerImplementations: Record<string, RibbonValidationHeaderImplementation>;
} {
    return {
        layout: {
            tabs: [{ id: "home", groups: [{ id: "history", itemIds }] }],
            header: { itemIds: ["search"] },
        } as unknown as RibbonLayoutDefinition,
        definitions: {
            tabs: { home: label },
            groups: { history: { label } },
            items: Object.fromEntries(
                itemIds.map(
                    (id) => [id, { label }]),
            ),
            containers: {},
            headerItems: { search: { label } },
            headerGroups: {},
            tabListLabel: label,
        } as unknown as RibbonDefinitions,
        implementations: Object.fromEntries(
            itemIds.map(
                (id) => [id, {
                    kind: "button",

                    onClick: /**
       * リボン検証・テストの回帰のイベントまたはメッセージを受け取り、状態を更新する。
       */ () => undefined
                }]),
        ),
        headerImplementations: {
            search: { kind: "button" },
        },
    };
}

describe("validateRibbonConfiguration",
    () => {
        it("accepts a complete configuration",
            () => {
                const value = configuration();

                expect(

                    () => validateRibbonConfiguration(
                        value.layout,
                        value.definitions,
                        value.implementations,
                        value.headerImplementations,
                    )).not.toThrow();
            });

        it("rejects duplicate layout IDs",
            () => {
                const value = configuration(["undo", "undo"]);

                expect(

                    () => validateRibbonConfiguration(
                        value.layout,
                        value.definitions,
                        value.implementations,
                        value.headerImplementations,
                    )).toThrow("duplicate IDs");
            });

        it("rejects non-contiguous visual containers",
            () => {
                const value = configuration(["first", "middle", "last"]);
                const definitions = {
                    ...value.definitions,
                    items: {
                        first: { label, container: "tableInsertForm" },
                        middle: { label },
                        last: { label, container: "tableInsertForm" },
                    },
                    containers: {
                        tableInsertForm: { className: "ribbon-form", ariaLabel: label },
                    },
                } as unknown as RibbonDefinitions;

                expect(

                    () => validateRibbonConfiguration(
                        value.layout,
                        definitions,
                        value.implementations,
                        value.headerImplementations,
                    )).toThrow("must be contiguous");
            });

        it("rejects an empty tab, group, or header",
            () => {
                const value = configuration();
                const emptyTab = {
                    ...value.layout,
                    tabs: [],
                } as unknown as RibbonLayoutDefinition;
                const emptyGroup = {
                    ...value.layout,
                    tabs: [{ id: "home", groups: [] }],
                } as unknown as RibbonLayoutDefinition;
                const emptyItems = {
                    ...value.layout,
                    tabs: [{ id: "home", groups: [{ id: "history", itemIds: [] }] }],
                } as unknown as RibbonLayoutDefinition;
                const emptyHeader = {
                    ...value.layout,
                    header: { itemIds: [] },
                } as unknown as RibbonLayoutDefinition;

                expect(

                    () => validateRibbonConfiguration(
                        emptyTab,
                        value.definitions,
                        value.implementations,
                        value.headerImplementations,
                    )).toThrow("at least one tab");
                expect(

                    () => validateRibbonConfiguration(
                        emptyGroup,
                        value.definitions,
                        value.implementations,
                        value.headerImplementations,
                    )).toThrow("has no groups");
                expect(

                    () => validateRibbonConfiguration(
                        emptyItems,
                        value.definitions,
                        value.implementations,
                        value.headerImplementations,
                    )).toThrow("has no items");
                expect(

                    () => validateRibbonConfiguration(
                        emptyHeader,
                        value.definitions,
                        value.implementations,
                        value.headerImplementations,
                    )).toThrow("at least one item");
            });

        it("rejects missing definitions and implementations",
            () => {
                const value = configuration();
                const missingDefinition = {
                    ...value.definitions,
                    items: {},
                } as unknown as RibbonDefinitions;

                expect(

                    () => validateRibbonConfiguration(
                        value.layout,
                        missingDefinition,
                        value.implementations,
                        value.headerImplementations,
                    )).toThrow("item definitions do not match");
                expect(

                    () => validateRibbonConfiguration(
                        value.layout,
                        value.definitions,
                        {},
                        value.headerImplementations,
                    )).toThrow("item implementations do not match");

                const nonContiguous = configuration(["first", "middle", "last"]);
                const missingMiddle = {
                    ...nonContiguous.definitions,
                    items: {
                        first: { label, container: "tableInsertForm" },
                        last: { label, container: "tableInsertForm" },
                    },
                    containers: {
                        tableInsertForm: { className: "ribbon-form", ariaLabel: label },
                    },
                } as unknown as RibbonDefinitions;
                expect(

                    () => validateRibbonConfiguration(
                        nonContiguous.layout,
                        missingMiddle,
                        nonContiguous.implementations,
                        nonContiguous.headerImplementations,
                    )).toThrow("item definitions do not match");
            });

        it("rejects non-contiguous header groups",
            () => {
                const value = configuration();
                const headerIds = ["search", "splitView", "collapse", "textOnly", "previewOnly"];
                const definitions = {
                    ...value.definitions,
                    headerItems: {
                        search: { label },
                        splitView: { label, group: "viewModes" },
                        textOnly: { label, group: "viewModes" },
                        previewOnly: { label, group: "viewModes" },
                        collapse: { label },
                    },
                    headerGroups: {
                        viewModes: { className: "ribbon-view-controls", ariaLabel: label },
                    },
                } as unknown as RibbonDefinitions;
                const layout = {
                    ...value.layout,
                    header: { itemIds: headerIds },
                } as unknown as RibbonLayoutDefinition;
                const headerImplementations = Object.fromEntries(
                    headerIds.map(
                        (id) => [id, {
                            kind: "button",

                            onClick: /**
       * リボン検証・テストの回帰のイベントまたはメッセージを受け取り、状態を更新する。
       */ () => undefined
                        }]),
                ) as Record<string, RibbonValidationHeaderImplementation>;

                expect(

                    () => validateRibbonConfiguration(
                        layout,
                        definitions,
                        value.implementations,
                        headerImplementations,
                    )).toThrow("header group items must be contiguous");
            });

        it("rejects unused container and header group definitions",
            () => {
                const value = configuration();
                const definitions = {
                    ...value.definitions,
                    containers: {
                        tableInsertForm: { className: "ribbon-form", ariaLabel: label },
                    },
                    headerGroups: {
                        viewModes: { className: "ribbon-view-controls", ariaLabel: label },
                    },
                } as unknown as RibbonDefinitions;

                expect(

                    () => validateRibbonConfiguration(
                        value.layout,
                        definitions,
                        value.implementations,
                        value.headerImplementations,
                    )).toThrow("container definitions do not match");

                const headerGroupDefinitions = {
                    ...value.definitions,
                    headerGroups: {
                        viewModes: { className: "ribbon-view-controls", ariaLabel: label },
                    },
                } as unknown as RibbonDefinitions;
                expect(

                    () => validateRibbonConfiguration(
                        value.layout,
                        headerGroupDefinitions,
                        value.implementations,
                        value.headerImplementations,
                    )).toThrow("header group definitions do not match");
            });
    });

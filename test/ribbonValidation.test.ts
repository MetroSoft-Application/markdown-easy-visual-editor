/**
 * @fileoverview リボン検証・テストの回帰の仕様と回帰条件を検証する。失敗時は期待値と実装差分を示す。
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
 * リボン検証・テストの回帰のlabelに関する状態または設定。
 */
const label = { kind: "localized", japanese: "表示", english: "Label" } as const;

/**
 * リボン検証・テストの回帰のconfigurationを処理し、呼び出し側へ結果または副作用を返す。
 * @param itemIds - リボン検証・テストの回帰の対象や分岐を識別する値。
 * @returns リボン検証・テストの回帰のconfigurationが生成する結果。
 */
function configuration(
    itemIds: readonly string[] = ["undo"],
): {

    /**
     * リボン検証・テストの回帰のlayoutに関する状態または設定。
     */
    layout: RibbonLayoutDefinition;

    /**
     * リボン検証・テストの回帰のdefinitionsに関する状態または設定。
     */
    definitions: RibbonDefinitions;

    /**
     * リボン検証・テストの回帰で扱うimplementationsの文字列。
     */
    implementations: Record<string, RibbonValidationItemImplementation>;

    /**
     * リボン検証・テストの回帰で扱うheader・implementationsの文字列。
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
                    /**
                     * item・idsの各要素を変換して一覧化する。
                     * @param id - リボン検証・テストの回帰の対象や分岐を識別する値。
                     * @returns 入力要素から生成した変換結果の一覧。
                     */
                    (id) => [id, { label }]),
            ),
            containers: {},
            headerItems: { search: { label } },
            headerGroups: {},
            tabListLabel: label,
        } as unknown as RibbonDefinitions,
        implementations: Object.fromEntries(
            itemIds.map(
                /**
                 * item・idsの各要素を変換して一覧化する。
                 * @param id - リボン検証・テストの回帰の対象や分岐を識別する値。
                 * @returns 入力要素から生成した変換結果の一覧。
                 */
                (id) => [id, {
                    kind: "button",

                    onClick: /**
       * リボン検証・テストの回帰のイベントまたはメッセージを受け取り、状態を更新する。
       * @returns 副作用を完了し、値は返さない。
       */ () => undefined
                }]),
        ),
        headerImplementations: {
            search: { kind: "button" },
        },
    };
}

describe("validateRibbonConfiguration",
    /**
     * 「validateRibbonConfiguration」の仕様と回帰条件を検証するテストケース。
     * @returns テストケースを実行し、値は返さない。
     */
    () => {
        it("accepts a complete configuration",
            /**
             * 「accepts a complete configuration」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const value = configuration();

                expect(
                    /**
                     * 要素をvalidate・ribbon・configurationへ渡し、リボン検証・テストの回帰の結果または副作用を処理する。
                     * @returns リボン検証・テストの回帰のコールバックが生成する結果。
                     */
                    () => validateRibbonConfiguration(
                        value.layout,
                        value.definitions,
                        value.implementations,
                        value.headerImplementations,
                    )).not.toThrow();
            });

        it("rejects duplicate layout IDs",
            /**
             * 「rejects duplicate layout IDs」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const value = configuration(["undo", "undo"]);

                expect(
                    /**
                     * 要素をvalidate・ribbon・configurationへ渡し、リボン検証・テストの回帰の結果または副作用を処理する。
                     * @returns リボン検証・テストの回帰のコールバックが生成する結果。
                     */
                    () => validateRibbonConfiguration(
                        value.layout,
                        value.definitions,
                        value.implementations,
                        value.headerImplementations,
                    )).toThrow("duplicate IDs");
            });

        it("rejects non-contiguous visual containers",
            /**
             * 「rejects non-contiguous visual containers」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
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
                    /**
                     * 要素をvalidate・ribbon・configurationへ渡し、リボン検証・テストの回帰の結果または副作用を処理する。
                     * @returns リボン検証・テストの回帰のコールバックが生成する結果。
                     */
                    () => validateRibbonConfiguration(
                        value.layout,
                        definitions,
                        value.implementations,
                        value.headerImplementations,
                    )).toThrow("must be contiguous");
            });

        it("rejects an empty tab, group, or header",
            /**
             * 「rejects an empty tab, group, or header」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
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
                    /**
                     * 要素をvalidate・ribbon・configurationへ渡し、リボン検証・テストの回帰の結果または副作用を処理する。
                     * @returns リボン検証・テストの回帰のコールバックが生成する結果。
                     */
                    () => validateRibbonConfiguration(
                        emptyTab,
                        value.definitions,
                        value.implementations,
                        value.headerImplementations,
                    )).toThrow("at least one tab");
                expect(
                    /**
                     * 要素をvalidate・ribbon・configurationへ渡し、リボン検証・テストの回帰の結果または副作用を処理する。
                     * @returns リボン検証・テストの回帰のコールバックが生成する結果。
                     */
                    () => validateRibbonConfiguration(
                        emptyGroup,
                        value.definitions,
                        value.implementations,
                        value.headerImplementations,
                    )).toThrow("has no groups");
                expect(
                    /**
                     * 要素をvalidate・ribbon・configurationへ渡し、リボン検証・テストの回帰の結果または副作用を処理する。
                     * @returns リボン検証・テストの回帰のコールバックが生成する結果。
                     */
                    () => validateRibbonConfiguration(
                        emptyItems,
                        value.definitions,
                        value.implementations,
                        value.headerImplementations,
                    )).toThrow("has no items");
                expect(
                    /**
                     * 要素をvalidate・ribbon・configurationへ渡し、リボン検証・テストの回帰の結果または副作用を処理する。
                     * @returns リボン検証・テストの回帰のコールバックが生成する結果。
                     */
                    () => validateRibbonConfiguration(
                        emptyHeader,
                        value.definitions,
                        value.implementations,
                        value.headerImplementations,
                    )).toThrow("at least one item");
            });

        it("rejects missing definitions and implementations",
            /**
             * 「rejects missing definitions and implementations」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const value = configuration();
                const missingDefinition = {
                    ...value.definitions,
                    items: {},
                } as unknown as RibbonDefinitions;

                expect(
                    /**
                     * 要素をvalidate・ribbon・configurationへ渡し、リボン検証・テストの回帰の結果または副作用を処理する。
                     * @returns リボン検証・テストの回帰のコールバックが生成する結果。
                     */
                    () => validateRibbonConfiguration(
                        value.layout,
                        missingDefinition,
                        value.implementations,
                        value.headerImplementations,
                    )).toThrow("item definitions do not match");
                expect(
                    /**
                     * 要素をvalidate・ribbon・configurationへ渡し、リボン検証・テストの回帰の結果または副作用を処理する。
                     * @returns リボン検証・テストの回帰のコールバックが生成する結果。
                     */
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
                    /**
                     * 要素をvalidate・ribbon・configurationへ渡し、リボン検証・テストの回帰の結果または副作用を処理する。
                     * @returns リボン検証・テストの回帰のコールバックが生成する結果。
                     */
                    () => validateRibbonConfiguration(
                        nonContiguous.layout,
                        missingMiddle,
                        nonContiguous.implementations,
                        nonContiguous.headerImplementations,
                    )).toThrow("item definitions do not match");
            });

        it("rejects non-contiguous header groups",
            /**
             * 「rejects non-contiguous header groups」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
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
                        /**
                         * header・idsの各要素を変換して一覧化する。
                         * @param id - リボン検証・テストの回帰の対象や分岐を識別する値。
                         * @returns 入力要素から生成した変換結果の一覧。
                         */
                        (id) => [id, {
                            kind: "button",

                            onClick: /**
       * リボン検証・テストの回帰のイベントまたはメッセージを受け取り、状態を更新する。
       * @returns 副作用を完了し、値は返さない。
       */ () => undefined
                        }]),
                ) as Record<string, RibbonValidationHeaderImplementation>;

                expect(
                    /**
                     * 要素をvalidate・ribbon・configurationへ渡し、リボン検証・テストの回帰の結果または副作用を処理する。
                     * @returns リボン検証・テストの回帰のコールバックが生成する結果。
                     */
                    () => validateRibbonConfiguration(
                        layout,
                        definitions,
                        value.implementations,
                        headerImplementations,
                    )).toThrow("header group items must be contiguous");
            });

        it("rejects unused container and header group definitions",
            /**
             * 「rejects unused container and header group definitions」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
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
                    /**
                     * 要素をvalidate・ribbon・configurationへ渡し、リボン検証・テストの回帰の結果または副作用を処理する。
                     * @returns リボン検証・テストの回帰のコールバックが生成する結果。
                     */
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
                    /**
                     * 要素をvalidate・ribbon・configurationへ渡し、リボン検証・テストの回帰の結果または副作用を処理する。
                     * @returns リボン検証・テストの回帰のコールバックが生成する結果。
                     */
                    () => validateRibbonConfiguration(
                        value.layout,
                        headerGroupDefinitions,
                        value.implementations,
                        value.headerImplementations,
                    )).toThrow("header group definitions do not match");
            });
    });

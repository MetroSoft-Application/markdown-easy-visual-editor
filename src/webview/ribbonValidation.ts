/**
 * @fileoverview リボン定義の重複、参照漏れ、表示条件の整合性を検証する。
 */
import type { RibbonDefinitions } from "./ribbonDefinitionTypes";
import type { RibbonLayoutDefinition } from "./ribbonLayoutTypes";

/**
 * リボンで共有するデータ形状を表すインターフェース。
 */
export interface RibbonValidationItemImplementation {

    /**
     * メッセージ、項目、または処理の種類を識別する値。
     */
    readonly kind: "button" | "control";
}

/**
 * リボンで共有するデータ形状を表すインターフェース。
 */
export interface RibbonValidationHeaderImplementation {

    /**
     * メッセージ、項目、または処理の種類を識別する値。
     */
    readonly kind: "button";
}

/**
 * リボンの入力と不変条件を検証し、違反時に失敗を通知する。
 * @param layout - リボンの位置・寸法・件数・時間を表す数値。
 * @param definitions - リボンへ渡す入力。
 * @param implementations - リボンで受け渡す文字列。
 * @param headerImplementations - リボンで受け渡す文字列。
 * @returns 条件が成立したかを示す真偽値。
 */
export function validateRibbonConfiguration(
    layout: RibbonLayoutDefinition,
    definitions: RibbonDefinitions,
    implementations: Record<string, RibbonValidationItemImplementation>,
    headerImplementations: Record<string, RibbonValidationHeaderImplementation>,
): void {
    if (layout.tabs.length === 0) {
        throw new Error("Ribbon layout must contain at least one tab");
    }

    const tabIds = layout.tabs.map(
        /**
         * 各tabから識別子を取り出して一覧化する。
         * @param tab - tabの識別子を参照する走査対象。
         * @returns 識別子を取り出した変換結果の一覧。
         */
        (tab) => tab.id);
    assertUnique(tabIds, "tabs");
    assertSameIds(tabIds, Object.keys(definitions.tabs), "tabs");

    for (const tab of layout.tabs) {
        if (tab.groups.length === 0) {
            throw new Error(`Ribbon tab has no groups: ${tab.id}`);
        }
    }

    const groupIds = layout.tabs.flatMap(
        /**
         * tabをmapへ渡し、リボンの結果または副作用を処理する。
         * @param tab - リボンへ渡す入力。
         * @returns リボンのコールバックが生成する結果。
         */
        (tab) =>
            tab.groups.map(
                /**
                 * 各groupから識別子を取り出して一覧化する。
                 * @param group - groupの識別子を参照する走査対象。
                 * @returns 識別子を取り出した変換結果の一覧。
                 */
                (group) => group.id),
    );
    assertUnique(groupIds, "groups");
    assertSameIds(groupIds, Object.keys(definitions.groups), "groups");

    for (const tab of layout.tabs) {
        for (const group of tab.groups) {
            if (group.itemIds.length === 0) {
                throw new Error(`Ribbon group has no items: ${group.id}`);
            }
        }
    }

    const itemIds = layout.tabs.flatMap(
        /**
         * tabをflat・mapへ渡し、リボンの結果または副作用を処理する。
         * @param tab - リボンへ渡す入力。
         * @returns リボンのコールバックが生成する結果。
         */
        (tab) =>
            tab.groups.flatMap(
                /**
                 * リボンのコールバックとしてgroupを処理する。
                 * @param group - リボンへ渡す入力。
                 * @returns リボンのコールバックが生成する結果。
                 */
                (group) => group.itemIds),
    );
    assertUnique(itemIds, "items");
    assertSameIds(itemIds, Object.keys(definitions.items), "item definitions");
    assertSameIds(itemIds, Object.keys(implementations), "item implementations");

    for (const itemId of itemIds) {
        const containerId = definitions.items[itemId].container;
        if (containerId && !definitions.containers[containerId]) {
            throw new Error(`Ribbon container definition is missing: ${containerId}`);
        }
    }
    validateContiguousItemContainers(layout, definitions);

    const headerIds = layout.header.itemIds;
    if (headerIds.length === 0) {
        throw new Error("Ribbon header must contain at least one item");
    }
    assertUnique(headerIds, "header items");
    assertSameIds(
        headerIds,
        Object.keys(definitions.headerItems),
        "header definitions",
    );
    assertSameIds(
        headerIds,
        Object.keys(headerImplementations),
        "header implementations",
    );

    for (const headerId of headerIds) {
        const groupId = definitions.headerItems[headerId].group;
        if (groupId && !definitions.headerGroups[groupId]) {
            throw new Error(`Ribbon header group definition is missing: ${groupId}`);
        }
    }
    validateContiguousHeaderGroups(layout, definitions);

    const usedContainerIds = Object.values(definitions.items).flatMap(

        /**
         * リボンのコールバックとしてdefinitionを処理する。
         * @param definition - リボンへ渡す入力。
         * @returns 副作用を完了し、値は返さない。
         */
        (definition) => (definition.container ? [definition.container] : []),
    );
    assertSameIds(
        usedContainerIds,
        Object.keys(definitions.containers),
        "container definitions",
    );

    const usedHeaderGroupIds = Object.values(definitions.headerItems).flatMap(

        /**
         * リボンのコールバックとしてdefinitionを処理する。
         * @param definition - リボンへ渡す入力。
         * @returns 副作用を完了し、値は返さない。
         */
        (definition) => (definition.group ? [definition.group] : []),
    );
    assertSameIds(
        usedHeaderGroupIds,
        Object.keys(definitions.headerGroups),
        "header group definitions",
    );
}

/**
 * リボンの入力と不変条件を検証し、違反時に失敗を通知する。
 * @param layout - リボンの位置・寸法・件数・時間を表す数値。
 * @param definitions - リボンへ渡す入力。
 * @returns 条件が成立したかを示す真偽値。
 */
function validateContiguousItemContainers(
    layout: RibbonLayoutDefinition,
    definitions: RibbonDefinitions,
): void {
    const locations = new Map<
        string,
        {
            /**
             * リボンで扱うtab・idの文字列。
             */
            tabId: string;
            /**
             * リボンで扱うgroup・idの文字列。
             */
            groupId: string;
            /**
             * リボンの位置・寸法・件数・時間を表す数値。
             */
            lastIndex: number
        }
    >();
    for (const tab of layout.tabs) {
        for (const group of tab.groups) {
            for (let index = 0; index < group.itemIds.length; index += 1) {
                const containerId = definitions.items[group.itemIds[index]].container;
                if (!containerId) continue;
                const previous = locations.get(containerId);
                if (
                    previous &&
                    (previous.tabId !== tab.id ||
                        previous.groupId !== group.id ||
                        previous.lastIndex + 1 !== index)
                ) {
                    throw new Error(
                        `Ribbon container items must be contiguous: ${containerId}`,
                    );
                }
                locations.set(containerId, {
                    tabId: tab.id,
                    groupId: group.id,
                    lastIndex: index,
                });
            }
        }
    }
}

/**
 * リボンの入力と不変条件を検証し、違反時に失敗を通知する。
 * @param layout - リボンの位置・寸法・件数・時間を表す数値。
 * @param definitions - リボンへ渡す入力。
 * @returns 条件が成立したかを示す真偽値。
 */
function validateContiguousHeaderGroups(
    layout: RibbonLayoutDefinition,
    definitions: RibbonDefinitions,
): void {
    const locations = new Map<string, number>();
    for (let index = 0; index < layout.header.itemIds.length; index += 1) {
        const groupId = definitions.headerItems[layout.header.itemIds[index]].group;
        if (!groupId) continue;
        const previousIndex = locations.get(groupId);
        if (previousIndex !== undefined && previousIndex + 1 !== index) {
            throw new Error(`Ribbon header group items must be contiguous: ${groupId}`);
        }
        locations.set(groupId, index);
    }
}

/**
 * リボンの入力と不変条件を検証し、違反時に失敗を通知する。
 * @param ids - リボンの対象や分岐を識別する値。
 * @param name - リボンの対象や分岐を識別する値。
 * @returns 条件が成立したかを示す真偽値。
 */
function assertUnique(ids: readonly string[], name: string): void {
    if (new Set(ids).size !== ids.length) {
        throw new Error(`Ribbon ${name} contain duplicate IDs`);
    }
}

/**
 * リボンの入力と不変条件を検証し、違反時に失敗を通知する。
 * @param actual - リボンで受け渡す文字列。
 * @param expected - リボンの位置・寸法・件数・時間を表す数値。
 * @param name - リボンの対象や分岐を識別する値。
 * @returns 条件が成立したかを示す真偽値。
 */
function assertSameIds(
    actual: readonly string[],
    expected: readonly string[],
    name: string,
): void {
    const actualSet = new Set(actual);
    const expectedSet = new Set(expected);
    const missing = expected.filter(
        /**
         * 条件を満たす識別子だけを残す。
         * @param id - リボンの対象や分岐を識別する値。
         * @returns 条件を満たした要素だけを含む一覧。
         */
        (id) => !actualSet.has(id));
    const unexpected = actual.filter(
        /**
         * 条件を満たす識別子だけを残す。
         * @param id - リボンの対象や分岐を識別する値。
         * @returns 条件を満たした要素だけを含む一覧。
         */
        (id) => !expectedSet.has(id));
    if (missing.length > 0 || unexpected.length > 0) {
        throw new Error(
            `Ribbon ${name} do not match: missing=${missing.join(",")}, unexpected=${unexpected.join(",")}`,
        );
    }
}

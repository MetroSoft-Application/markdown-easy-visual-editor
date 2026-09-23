/**
 * @file ribbonValidation.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */

import type { RibbonDefinitions } from "./ribbonDefinitionTypes";
import type { RibbonLayoutDefinition } from "./ribbonLayoutTypes";

/**
 * 「RibbonValidationItemImplementation」が満たすデータ契約を定義します。
 */
export interface RibbonValidationItemImplementation {

  /**
   * 「kind」は、対象の識別や処理分岐に使用する値を保持します。
   */
  readonly kind: "button" | "control";
}

/**
 * 「RibbonValidationHeaderImplementation」が満たすデータ契約を定義します。
 */
export interface RibbonValidationHeaderImplementation {

  /**
   * 「kind」は、対象の識別や処理分岐に使用する値を保持します。
   */
  readonly kind: "button";
}

/**
 * validate・ribbon・configurationを検証します。
 * @param layout 処理対象のレイアウトです。
 * @param definitions 「definitions」は、「validateRibbonConfiguration」がWebview UI状態の処理対象を特定する入力です。
 * @param implementations 「implementations」は、「validateRibbonConfiguration」がWebview UI状態の処理対象を特定する入力です。
 * @param headerImplementations 「headerImplementations」は、「validateRibbonConfiguration」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「validateRibbonConfiguration」の副作用または状態更新を実行し、値は返しません。
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
 * 「tab」を変換し、変換後の要素を返すコールバックです。
   * @param tab tabとして渡される、このコールバックの入力値です。
   * @returns 入力要素から生成した変換後の値を返します。
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
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
   * @param tab tabとして渡される、このコールバックの入力値です。
   * @returns 「tab」から生成した処理結果を返します。
   */
  (tab) =>
    tab.groups.map(
    /**
 * 「group」を変換し、変換後の要素を返すコールバックです。
     * @param group groupとして渡される、このコールバックの入力値です。
     * @returns 入力要素から生成した変換後の値を返します。
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
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
   * @param tab tabとして渡される、このコールバックの入力値です。
   * @returns 「tab」から生成した処理結果を返します。
   */
  (tab) =>
    tab.groups.flatMap(
    /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
     * @param group groupとして渡される、このコールバックの入力値です。
     * @returns 「group」から生成した処理結果を返します。
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
 * 「definition」を受け取り、登録された副作用または結果を生成する処理です。
     * @param definition definitionとして渡される、このコールバックの入力値です。
     * @returns 「definition」から生成した処理結果を返します。
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
 * 「definition」を受け取り、登録された副作用または結果を生成する処理です。
     * @param definition definitionとして渡される、このコールバックの入力値です。
     * @returns 「definition」から生成した処理結果を返します。
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
 * validate・contiguous・item・containersを検証します。
 * @param layout 処理対象のレイアウトです。
 * @param definitions 「definitions」は、「validateContiguousItemContainers」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「validateContiguousItemContainers」の副作用または状態更新を実行し、値は返しません。
 */
function validateContiguousItemContainers(
  layout: RibbonLayoutDefinition,
  definitions: RibbonDefinitions,
): void {
  const locations = new Map<
    string,
    {
    /**
     * 「tabId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    tabId: string;
    /**
     * 「groupId」は、対象の識別や処理分岐に使用する値を保持します。
     */
    groupId: string;
    /**
     * 「lastIndex」は、対象の位置、サイズ、件数、または範囲を保持します。
     */
    lastIndex: number }
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
 * validate・contiguous・header・groupsを検証します。
 * @param layout 処理対象のレイアウトです。
 * @param definitions 「definitions」は、「validateContiguousHeaderGroups」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「validateContiguousHeaderGroups」の副作用または状態更新を実行し、値は返しません。
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
 * assert・uniqueを検証します。
 * @param ids 「ids」は、「assertUnique」がWebview UI状態の処理対象を特定する入力です。
 * @param name 対象を識別する名前で、表示または処理分岐に使用します。
 * @returns 「assertUnique」の副作用または状態更新を実行し、値は返しません。
 */
function assertUnique(ids: readonly string[], name: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new Error(`Ribbon ${name} contain duplicate IDs`);
  }
}

/**
 * assert・same・idsを検証します。
 * @param actual 検証または解析で実際に得られた値です。
 * @param expected 検証で期待する値または状態です。
 * @param name 対象を識別する名前で、表示または処理分岐に使用します。
 * @returns 「assertSameIds」の副作用または状態更新を実行し、値は返しません。
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
 * 「id」が条件に一致するか判定し、残す要素を決めるコールバックです。
   * @param id idとして渡される、このコールバックの入力値です。
   * @returns 要素を採用するかどうかの真偽値を返します。
   */
  (id) => !actualSet.has(id));
  const unexpected = actual.filter(
  /**
 * 「id」が条件に一致するか判定し、残す要素を決めるコールバックです。
   * @param id idとして渡される、このコールバックの入力値です。
   * @returns 要素を採用するかどうかの真偽値を返します。
   */
  (id) => !expectedSet.has(id));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Ribbon ${name} do not match: missing=${missing.join(",")}, unexpected=${unexpected.join(",")}`,
    );
  }
}

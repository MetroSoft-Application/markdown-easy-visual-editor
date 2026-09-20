
import type { RibbonDefinitions } from "./ribbonDefinitionTypes";
import type { RibbonLayoutDefinition } from "./ribbonLayoutTypes";

export interface RibbonValidationItemImplementation {
  readonly kind: "button" | "control";
}

export interface RibbonValidationHeaderImplementation {
  readonly kind: "button";
}

export function validateRibbonConfiguration(
  layout: RibbonLayoutDefinition,
  definitions: RibbonDefinitions,
  implementations: Record<string, RibbonValidationItemImplementation>,
  headerImplementations: Record<string, RibbonValidationHeaderImplementation>,
): void {
  if (layout.tabs.length === 0) {
    throw new Error("Ribbon layout must contain at least one tab");
  }

  const tabIds = layout.tabs.map((tab) => tab.id);
  assertUnique(tabIds, "tabs");
  assertSameIds(tabIds, Object.keys(definitions.tabs), "tabs");

  for (const tab of layout.tabs) {
    if (tab.groups.length === 0) {
      throw new Error(`Ribbon tab has no groups: ${tab.id}`);
    }
  }

  const groupIds = layout.tabs.flatMap((tab) =>
    tab.groups.map((group) => group.id),
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

  const itemIds = layout.tabs.flatMap((tab) =>
    tab.groups.flatMap((group) => group.itemIds),
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
    (definition) => (definition.container ? [definition.container] : []),
  );
  assertSameIds(
    usedContainerIds,
    Object.keys(definitions.containers),
    "container definitions",
  );

  const usedHeaderGroupIds = Object.values(definitions.headerItems).flatMap(
    (definition) => (definition.group ? [definition.group] : []),
  );
  assertSameIds(
    usedHeaderGroupIds,
    Object.keys(definitions.headerGroups),
    "header group definitions",
  );
}

function validateContiguousItemContainers(
  layout: RibbonLayoutDefinition,
  definitions: RibbonDefinitions,
): void {
  const locations = new Map<
    string,
    { tabId: string; groupId: string; lastIndex: number }
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

function assertUnique(ids: readonly string[], name: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new Error(`Ribbon ${name} contain duplicate IDs`);
  }
}

function assertSameIds(
  actual: readonly string[],
  expected: readonly string[],
  name: string,
): void {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((id) => !actualSet.has(id));
  const unexpected = actual.filter((id) => !expectedSet.has(id));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Ribbon ${name} do not match: missing=${missing.join(",")}, unexpected=${unexpected.join(",")}`,
    );
  }
}

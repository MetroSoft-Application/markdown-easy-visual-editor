import { describe, expect, it } from "vitest";
import type { RibbonDefinitions } from "../src/webview/ribbonDefinitionTypes";
import type { RibbonLayoutDefinition } from "../src/webview/ribbonLayoutTypes";
import {
  type RibbonValidationHeaderImplementation,
  type RibbonValidationItemImplementation,
  validateRibbonConfiguration,
} from "../src/webview/ribbonValidation";

const label = { kind: "localized", japanese: "表示", english: "Label" } as const;

function configuration(
  itemIds: readonly string[] = ["undo"],
): {
  layout: RibbonLayoutDefinition;
  definitions: RibbonDefinitions;
  implementations: Record<string, RibbonValidationItemImplementation>;
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
        itemIds.map((id) => [id, { label }]),
      ),
      containers: {},
      headerItems: { search: { label } },
      headerGroups: {},
      tabListLabel: label,
    } as unknown as RibbonDefinitions,
    implementations: Object.fromEntries(
      itemIds.map((id) => [id, { kind: "button", onClick: () => undefined }]),
    ),
    headerImplementations: {
      search: { kind: "button" },
    },
  };
}

describe("validateRibbonConfiguration", () => {
  it("accepts a complete configuration", () => {
    const value = configuration();

    expect(() => validateRibbonConfiguration(
      value.layout,
      value.definitions,
      value.implementations,
      value.headerImplementations,
    )).not.toThrow();
  });

  it("rejects duplicate layout IDs", () => {
    const value = configuration(["undo", "undo"]);

    expect(() => validateRibbonConfiguration(
      value.layout,
      value.definitions,
      value.implementations,
      value.headerImplementations,
    )).toThrow("duplicate IDs");
  });

  it("rejects non-contiguous visual containers", () => {
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

    expect(() => validateRibbonConfiguration(
      value.layout,
      definitions,
      value.implementations,
      value.headerImplementations,
    )).toThrow("must be contiguous");
  });

  it("rejects an empty tab, group, or header", () => {
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

    expect(() => validateRibbonConfiguration(
      emptyTab,
      value.definitions,
      value.implementations,
      value.headerImplementations,
    )).toThrow("at least one tab");
    expect(() => validateRibbonConfiguration(
      emptyGroup,
      value.definitions,
      value.implementations,
      value.headerImplementations,
    )).toThrow("has no groups");
    expect(() => validateRibbonConfiguration(
      emptyItems,
      value.definitions,
      value.implementations,
      value.headerImplementations,
    )).toThrow("has no items");
    expect(() => validateRibbonConfiguration(
      emptyHeader,
      value.definitions,
      value.implementations,
      value.headerImplementations,
    )).toThrow("at least one item");
  });

  it("rejects missing definitions and implementations", () => {
    const value = configuration();
    const missingDefinition = {
      ...value.definitions,
      items: {},
    } as unknown as RibbonDefinitions;

    expect(() => validateRibbonConfiguration(
      value.layout,
      missingDefinition,
      value.implementations,
      value.headerImplementations,
    )).toThrow("item definitions do not match");
    expect(() => validateRibbonConfiguration(
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
    expect(() => validateRibbonConfiguration(
      nonContiguous.layout,
      missingMiddle,
      nonContiguous.implementations,
      nonContiguous.headerImplementations,
    )).toThrow("item definitions do not match");
  });

  it("rejects non-contiguous header groups", () => {
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
      headerIds.map((id) => [id, { kind: "button", onClick: () => undefined }]),
    ) as Record<string, RibbonValidationHeaderImplementation>;

    expect(() => validateRibbonConfiguration(
      layout,
      definitions,
      value.implementations,
      headerImplementations,
    )).toThrow("header group items must be contiguous");
  });

  it("rejects unused container and header group definitions", () => {
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

    expect(() => validateRibbonConfiguration(
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
    expect(() => validateRibbonConfiguration(
      value.layout,
      headerGroupDefinitions,
      value.implementations,
      value.headerImplementations,
    )).toThrow("header group definitions do not match");
  });
});

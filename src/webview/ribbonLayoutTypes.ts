
import type {
  RibbonGroupId,
  RibbonHeaderItemId,
  RibbonItemId,
  RibbonTabId,
} from "./ribbonIds";

export type {
  RibbonContainerId,
  RibbonGroupId,
  RibbonHeaderButtonId,
  RibbonHeaderGroupId,
  RibbonHeaderItemId,
  RibbonItemId,
  RibbonTabId,
} from "./ribbonIds";

export interface RibbonGroupLayout {
  readonly id: RibbonGroupId;
  readonly itemIds: readonly RibbonItemId[];
}

export interface RibbonTabLayout {
  readonly id: RibbonTabId;
  readonly groups: readonly RibbonGroupLayout[];
}

export interface RibbonHeaderLayout {
  readonly itemIds: readonly RibbonHeaderItemId[];
}

export interface RibbonLayoutDefinition {
  readonly tabs: readonly RibbonTabLayout[];
  readonly header: RibbonHeaderLayout;
}

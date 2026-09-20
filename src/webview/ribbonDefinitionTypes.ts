import type {
  RibbonContainerId,
  RibbonGroupId,
  RibbonHeaderGroupId,
  RibbonHeaderItemId,
  RibbonItemId,
  RibbonTabId,
} from "./ribbonIds";

export type RibbonLabelSpec =
  | { kind: "message"; path: string }
  | { kind: "messageWithNumber"; path: string; value: number }
  | { kind: "localized"; japanese: string; english: string };

export interface RibbonButtonOptions {
  readonly shortcut?: string;
  readonly variant?: "tool" | "source" | "header";
  readonly title?: RibbonLabelSpec;
}

export interface RibbonControlFieldDefinition {
  readonly id: string;
  readonly label: RibbonLabelSpec;
  readonly placeholder?: RibbonLabelSpec;
  readonly min?: number;
  readonly max?: number;
}

export interface RibbonControlChoiceDefinition {
  readonly value: string;
  readonly label: RibbonLabelSpec;
}

export interface RibbonControlOptions {
  readonly values?: readonly string[];
  readonly fields?: readonly RibbonControlFieldDefinition[];
  readonly choices?: readonly RibbonControlChoiceDefinition[];
  readonly hint?: RibbonLabelSpec;
}

export interface RibbonItemDefinition {
  readonly label: RibbonLabelSpec;
  readonly options?: RibbonButtonOptions & RibbonControlOptions;
  readonly container?: RibbonContainerId;
}

export interface RibbonGroupDefinition {
  readonly label: RibbonLabelSpec;
  readonly className?: string;
}

export interface RibbonContainerDefinition {
  readonly className: string;
  readonly ariaLabel: RibbonLabelSpec;
}

export interface RibbonHeaderGroupDefinition {
  readonly className: string;
  readonly ariaLabel: RibbonLabelSpec;
}

export interface RibbonHeaderItemDefinition {
  readonly label: RibbonLabelSpec;
  readonly collapsedLabel?: RibbonLabelSpec;
  readonly expandedLabel?: RibbonLabelSpec;
  readonly options?: RibbonButtonOptions;
  readonly group?: RibbonHeaderGroupId;
}

export interface RibbonDefinitions {
  readonly tabs: Record<RibbonTabId, RibbonLabelSpec>;
  readonly groups: Record<RibbonGroupId, RibbonGroupDefinition>;
  readonly items: Record<RibbonItemId, RibbonItemDefinition>;
  readonly containers: Record<RibbonContainerId, RibbonContainerDefinition>;
  readonly headerItems: Record<RibbonHeaderItemId, RibbonHeaderItemDefinition>;
  readonly headerGroups: Record<
    RibbonHeaderGroupId,
    RibbonHeaderGroupDefinition
  >;
  readonly tabListLabel: RibbonLabelSpec;
}

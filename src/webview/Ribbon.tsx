import React, { useEffect, useState } from "react";
import type { EditorMode, HtmlExportOptions } from "../shared/protocol";
import type { Messages } from "../shared/messages";
import { mveDebug } from "./debug";
import {
  getPreviewImageResizeControlsVisible,
  subscribePreviewImageResizeControlsVisible,
} from "./previewImageResizeControls";
import { RIBBON_LAYOUT } from "./ribbonLayout";
import type {
  RibbonHeaderItemId,
  RibbonItemId,
  RibbonTabId,
} from "./ribbonIds";
import { RIBBON_DEFINITIONS } from "./ribbonDefinitions";
import type {
  RibbonButtonOptions,
  RibbonItemDefinition,
  RibbonLabelSpec,
} from "./ribbonDefinitionTypes";
import {
  RIBBON_HEADER_IMPLEMENTATIONS,
  RIBBON_IMPLEMENTATIONS,
} from "./ribbonImplementations";
import { getTextColorUiText, resolveRibbonLabel } from "./ribbonLabels";
import { validateRibbonConfiguration } from "./ribbonValidation";
import type {
  RibbonButtonImplementation,
  RibbonHeaderImplementationId,
  RibbonImplementationContext,
  RibbonItemImplementation,
  TextColorChoice,
} from "./ribbonTypes";
import type { RibbonCommand } from "./ribbonTypes";

export type { RibbonCommand, TableAction } from "./ribbonTypes";
export type { RibbonTabId as RibbonTab } from "./ribbonIds";

validateRibbonConfiguration(
  RIBBON_LAYOUT,
  RIBBON_DEFINITIONS,
  RIBBON_IMPLEMENTATIONS,
  RIBBON_HEADER_IMPLEMENTATIONS,
);

interface Props {
  messages: Messages;
  mode: EditorMode;
  readOnly: boolean;
  activeMarks: Record<string, boolean>;
  outlineVisible: boolean;
  scrollSyncEnabled: boolean;
  splitView: "both" | "text" | "preview";
  htmlOptions: HtmlExportOptions;
  imageDirectory: string;
  editorFontFamily: string;
  previewFontFamily: string;
  onHtmlOptionsChange: (options: HtmlExportOptions) => void;
  onCommand: (command: RibbonCommand) => void;
}

export function Ribbon({
  messages,
  mode,
  readOnly,
  activeMarks,
  outlineVisible,
  scrollSyncEnabled,
  splitView,
  htmlOptions,
  imageDirectory,
  editorFontFamily,
  previewFontFamily,
  onHtmlOptionsChange,
  onCommand,
}: Props): React.JSX.Element {
  const [tab, setTab] = useState<RibbonTabId>(RIBBON_LAYOUT.tabs[0].id);
  const [collapsed, setCollapsed] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableColumns, setTableColumns] = useState(3);
  const [codeLanguage, setCodeLanguage] = useState("");
  const [emoji, setEmoji] = useState("\u{1F4D8}");
  const [headerName, setHeaderName] = useState("");
  const [textColorChoice, setTextColorChoice] =
    useState<TextColorChoice>("default");
  const [imageDirectoryDraft, setImageDirectoryDraft] =
    useState(imageDirectory);
  const [editorFontFamilyDraft, setEditorFontFamilyDraft] =
    useState(editorFontFamily);
  const [previewFontFamilyDraft, setPreviewFontFamilyDraft] =
    useState(previewFontFamily);
  const [imageResizeControlsVisible, setImageResizeControlsVisible] = useState(
    getPreviewImageResizeControlsVisible,
  );
  const japanese = document.documentElement.lang.toLowerCase().startsWith("ja");
  const activeTab =
    RIBBON_LAYOUT.tabs.find((definition) => definition.id === tab) ??
    RIBBON_LAYOUT.tabs[0];
  const context: RibbonImplementationContext = {
    messages,
    japanese,
    collapsed,
    setCollapsed,
    textColorText: getTextColorUiText(document.documentElement.lang),
    mode,
    readOnly,
    activeMarks,
    outlineVisible,
    scrollSyncEnabled,
    splitView,
    imageResizeControlsVisible,
    htmlOptions,
    imageDirectory,
    editorFontFamily,
    previewFontFamily,
    onHtmlOptionsChange,
    onCommand,
    tableRows,
    setTableRows,
    tableColumns,
    setTableColumns,
    codeLanguage,
    setCodeLanguage,
    emoji,
    setEmoji,
    headerName,
    setHeaderName,
    textColorChoice,
    setTextColorChoice,
    imageDirectoryDraft,
    setImageDirectoryDraft,
    editorFontFamilyDraft,
    setEditorFontFamilyDraft,
    previewFontFamilyDraft,
    setPreviewFontFamilyDraft,
  };

  useEffect(
    () =>
      subscribePreviewImageResizeControlsVisible(setImageResizeControlsVisible),
    [],
  );

  useEffect(() => setImageDirectoryDraft(imageDirectory), [imageDirectory]);
  useEffect(() => setEditorFontFamilyDraft(editorFontFamily), [editorFontFamily]);
  useEffect(() => setPreviewFontFamilyDraft(previewFontFamily), [previewFontFamily]);
  function renderButton(
    id: string,
    labelSpec: RibbonLabelSpec,
    options: RibbonButtonOptions,
    implementation: RibbonButtonImplementation,
  ): React.JSX.Element {
    const label = resolveRibbonLabel(labelSpec, messages, japanese);
    const active = implementation.active?.(context) ?? false;
    const disabled = implementation.disabled?.(context) ?? false;
    const title = options.title
      ? resolveRibbonLabel(options.title, messages, japanese)
      : undefined;
    if (options.variant === "header") {
      return (
        <button
          key={id}
          type="button"
          disabled={disabled}
          title={title ?? label}
          onClick={() => implementation.onClick(context)}
        >
          {label}
        </button>
      );
    }
    if (options.variant === "source") {
      return (
        <button
          key={id}
          type="button"
          className={`ribbon-source-button ${active ? "active" : ""}`}
          aria-pressed={active}
          disabled={disabled}
          title={title}
          onClick={() => implementation.onClick(context)}
        >
          {label}
        </button>
      );
    }
    return (
      <Tool
        key={id}
        label={label}
        shortcut={options.shortcut}
        active={active}
        disabled={disabled}
        title={title}
        onClick={() => implementation.onClick(context)}
      />
    );
  }

  function renderItem(id: RibbonItemId): React.JSX.Element {
    const definition = getItemDefinition(id);
    const implementation = getItemImplementation(id);
    if (implementation.kind === "button") {
      return renderButton(
        id,
        definition.label,
        definition.options ?? {},
        implementation,
      );
    }
    return (
      <React.Fragment key={id}>
        {implementation.render(
          context,
          definition,
          (spec) => resolveRibbonLabel(spec, messages, japanese),
        )}
      </React.Fragment>
    );
  }

  function renderGroupItems(
    itemIds: readonly RibbonItemId[],
  ): React.ReactNode[] {
    const rendered: React.ReactNode[] = [];
    for (let index = 0; index < itemIds.length; index += 1) {
      const itemId = itemIds[index];
      const itemDefinition = getItemDefinition(itemId);
      if (itemDefinition.container) {
        const containerId = itemDefinition.container;
        const containerDefinition = RIBBON_DEFINITIONS.containers[containerId];
        const containerItemIds: RibbonItemId[] = [itemId];
        while (
          index + 1 < itemIds.length &&
          getItemDefinition(itemIds[index + 1]).container === containerId
        ) {
          index += 1;
          containerItemIds.push(itemIds[index]);
        }
        rendered.push(
          <div
            key={`${containerId}-${index}`}
            className={containerDefinition.className}
            aria-label={resolveRibbonLabel(
              containerDefinition.ariaLabel,
              messages,
              japanese,
            )}
          >
            {containerItemIds.map(renderItem)}
          </div>,
        );
        continue;
      }
      rendered.push(renderItem(itemId));
    }
    return rendered;
  }

  function renderHeaderItems(
    itemIds: readonly RibbonHeaderItemId[],
  ): React.ReactNode[] {
    const rendered: React.ReactNode[] = [];
    for (let index = 0; index < itemIds.length; index += 1) {
      const itemId = itemIds[index];
      const definition = RIBBON_DEFINITIONS.headerItems[itemId];
      if (definition.group) {
        const groupId = definition.group;
        const groupDefinition = RIBBON_DEFINITIONS.headerGroups[groupId];
        const groupItemIds: RibbonHeaderItemId[] = [itemId];
        while (
          index + 1 < itemIds.length &&
          RIBBON_DEFINITIONS.headerItems[itemIds[index + 1]].group === groupId
        ) {
          index += 1;
          groupItemIds.push(itemIds[index]);
        }
        rendered.push(
          <div
            key={`${groupId}-${index}`}
            className={groupDefinition.className}
            role="group"
            aria-label={resolveRibbonLabel(
              groupDefinition.ariaLabel,
              messages,
              japanese,
            )}
          >
            {groupItemIds.map(renderHeaderButton)}
          </div>,
        );
        continue;
      }
      rendered.push(renderHeaderButton(itemId));
    }
    return rendered;
  }

  function renderHeaderButton(id: RibbonHeaderItemId): React.JSX.Element {
    const definition = RIBBON_DEFINITIONS.headerItems[id];
    const labelSpec = context.collapsed
      ? definition.collapsedLabel ?? definition.label
      : definition.expandedLabel ?? definition.label;
    return renderButton(
      id,
      labelSpec,
      definition.options ?? {},
      getHeaderImplementation(id),
    );
  }

  return (
    <header
      className={`ribbon ${collapsed ? "collapsed" : ""}`}
      onClickCapture={(event) => {
        const target =
          event.target instanceof Element
            ? event.target.closest("button")
            : null;
        if (!target) return;
        mveDebug("ribbon.dom-click", {
          text: target.textContent?.trim(),
          title: target.getAttribute("title"),
          detail: event.detail,
          className: target.className,
        });
      }}
    >
      <div
        className="ribbon-tabs"
        role="tablist"
        aria-label={resolveRibbonLabel(
          RIBBON_DEFINITIONS.tabListLabel,
          messages,
          japanese,
        )}
      >
        {RIBBON_LAYOUT.tabs.map((definition) => (
          <button
            key={definition.id}
            type="button"
            role="tab"
            aria-selected={tab === definition.id}
            className={tab === definition.id ? "active" : ""}
            onClick={() => {
              setTab(definition.id);
              setCollapsed(false);
            }}
          >
            {resolveRibbonLabel(
              RIBBON_DEFINITIONS.tabs[definition.id],
              messages,
              japanese,
            )}
          </button>
        ))}
        <span className="ribbon-spacer" />
        {renderHeaderItems(RIBBON_LAYOUT.header.itemIds)}
      </div>
      {!collapsed && (
        <div className="ribbon-content" role="tabpanel">
          {activeTab.groups.map((group) => (
            <Group
              key={group.id}
              label={resolveRibbonLabel(
                RIBBON_DEFINITIONS.groups[group.id].label,
                messages,
                japanese,
              )}
              className={RIBBON_DEFINITIONS.groups[group.id].className}
            >
              {renderGroupItems(group.itemIds)}
            </Group>
          ))}
        </div>
      )}
    </header>
  );
}

function getItemDefinition(id: RibbonItemId): RibbonItemDefinition {
  const definition = RIBBON_DEFINITIONS.items[id];
  if (!definition) {
    throw new Error(`Ribbon definition is missing: ${id}`);
  }
  return definition;
}

function getItemImplementation(id: RibbonItemId): RibbonItemImplementation {
  const implementation = RIBBON_IMPLEMENTATIONS[id];
  if (!implementation) {
    throw new Error(`Ribbon implementation is missing: ${id}`);
  }
  return implementation;
}

function getHeaderImplementation(
  id: RibbonHeaderImplementationId,
): RibbonButtonImplementation {
  const implementation = RIBBON_HEADER_IMPLEMENTATIONS[id];
  if (!implementation) {
    throw new Error(`Ribbon header implementation is missing: ${id}`);
  }
  return implementation;
}

function Group({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <section className={`ribbon-group${className ? ` ${className}` : ""}`}>
      <div className="ribbon-controls">{children}</div>
      <span className="ribbon-group-label">{label}</span>
    </section>
  );
}

function Tool({
  label,
  shortcut,
  active = false,
  disabled = false,
  title,
  onClick,
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`ribbon-tool ${active ? "active" : ""}`}
      aria-pressed={active}
      disabled={disabled}
      title={title ?? (shortcut ? `${label} (${shortcut})` : label)}
      onClick={onClick}
    >
      <span>{label}</span>
      {shortcut && <small>{shortcut}</small>}
    </button>
  );
}

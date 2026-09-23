/**
 * @fileoverview 編集画面のリボンを表示し、コマンド・設定・表示状態の変更をHostへ委譲する。
 */
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

/**
 * リボンで共有するデータ形状を表すインターフェース。
 */
interface Props {
  /**
   * リボンで扱うmessagesの一覧。
   */
  messages: Messages;

  /**
   * 編集面とプレビューの表示構成。
   */
  mode: EditorMode;

  /**
   * 編集操作を許可しない状態。
   */
  readOnly: boolean;

  /**
   * 選択範囲で有効なMarkdown書式の対応表。
   */
  activeMarks: Record<string, boolean>;

  /**
   * リボンのoutline・visibleを示す状態フラグ。
   */
  outlineVisible: boolean;

  /**
   * 本文とプレビューのスクロール同期を有効にする設定。
   */
  scrollSyncEnabled: boolean;

  /**
   * リボンのsplit・viewに関する状態または設定。
   */
  splitView: "both" | "text" | "preview";

  /**
   * リボンへ渡す設定または境界値。
   */
  htmlOptions: HtmlExportOptions;

  /**
   * リボンで読み書きするリソースの場所。
   */
  imageDirectory: string;

  /**
   * リボンで共有するフォント設定または移行状態。
   */
  editorFontFamily: string;

  /**
   * リボンで共有するフォント設定または移行状態。
   */
  previewFontFamily: string;
  /**
   * リボンのイベントまたはメッセージを受け取り、状態を更新する。
   * @param options - 呼び出し側が指定する処理設定。
   * @returns リボンのon・html・options・changeが生成する結果。
   */
  onHtmlOptionsChange: (options: HtmlExportOptions) => void;
  /**
   * リボンのイベントまたはメッセージを受け取り、状態を更新する。
   * @param command - リボンへ渡す入力。
   * @returns リボンのon・commandが生成する結果。
   */
  onCommand: (command: RibbonCommand) => void;
}

/**
 * 編集コマンドと設定項目をまとめたリボンを表示するコンポーネント。
 * @param options - 呼び出し側が指定する処理設定。
 * @returns リボンのribbonが生成する結果。
 */
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
    RIBBON_LAYOUT.tabs.find(
      /**
       * 識別子が条件に一致する最初のdefinitionを取得する。
       * @param definition - definitionの識別子を参照する走査対象。
       * @returns 条件に一致した最初の要素。未検出時はundefined。
       */
      (definition) => definition.id === tab,
    ) ?? RIBBON_LAYOUT.tabs[0];
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
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns リボンのコールバックが生成する結果。
     */
    () =>
      subscribePreviewImageResizeControlsVisible(setImageResizeControlsVisible),
    [],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns リボンのコールバックが生成する結果。
     */
    () => setImageDirectoryDraft(imageDirectory),
    [imageDirectory],
  );
  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns リボンのコールバックが生成する結果。
     */
    () => setEditorFontFamilyDraft(editorFontFamily),
    [editorFontFamily],
  );
  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns リボンのコールバックが生成する結果。
     */
    () => setPreviewFontFamilyDraft(previewFontFamily),
    [previewFontFamily],
  );
  /**
   * リボンを表示用の結果へ変換する。
   * @param id - リボンの対象や分岐を識別する値。
   * @param labelSpec - リボンで扱う文字列または本文。
   * @param options - 呼び出し側が指定する処理設定。
   * @param implementation - リボンへ渡す入力。
   * @returns リボンで生成または変換した値。
   */
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
          onClick={
            /**
             * clickイベントでon・clickを実行する。
             * @returns 副作用を完了し、値は返さない。
             */
            () => implementation.onClick(context)
          }
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
          onClick={
            /**
             * clickイベントでon・clickを実行する。
             * @returns 副作用を完了し、値は返さない。
             */
            () => implementation.onClick(context)
          }
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
        onClick={
          /**
           * clickイベントでon・clickを実行する。
           * @returns 副作用を完了し、値は返さない。
           */
          () => implementation.onClick(context)
        }
      />
    );
  }

  /**
   * リボンを表示用の結果へ変換する。
   * @param id - リボンの対象や分岐を識別する値。
   * @returns リボンで生成または変換した値。
   */
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

          /**
           * specをresolve・ribbon・labelへ渡し、リボンの結果または副作用を処理する。
           * @param spec - リボンへ渡す入力。
           * @returns リボンに対応する要素の一覧。
           */
          (spec) => resolveRibbonLabel(spec, messages, japanese),
        )}
      </React.Fragment>
    );
  }

  /**
   * リボンを表示用の結果へ変換する。
   * @param itemIds - リボンの対象や分岐を識別する値。
   * @returns リボンに対応する要素の一覧。
   */
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

  /**
   * リボンを表示用の結果へ変換する。
   * @param itemIds - リボンの対象や分岐を識別する値。
   * @returns リボンに対応する要素の一覧。
   */
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

  /**
   * リボンを表示用の結果へ変換する。
   * @param id - リボンの対象や分岐を識別する値。
   * @returns リボンで生成または変換した値。
   */
  function renderHeaderButton(id: RibbonHeaderItemId): React.JSX.Element {
    const definition = RIBBON_DEFINITIONS.headerItems[id];
    const labelSpec = context.collapsed
      ? (definition.collapsedLabel ?? definition.label)
      : (definition.expandedLabel ?? definition.label);
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
      onClickCapture={
        /**
         * イベントをclosestへ渡し、リボンの結果または副作用を処理する。
         * @param event - ユーザー操作またはDOMから通知されたイベント。
         * @returns リボンのコールバックが生成する結果。
         */
        (event) => {
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
        }
      }
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
        {RIBBON_LAYOUT.tabs.map(
          /**
           * 各definitionから識別子を取り出して一覧化する。
           * @param definition - definitionの識別子を参照する走査対象。
           * @returns 識別子を取り出した変換結果の一覧。
           */
          (definition) => (
            <button
              key={definition.id}
              type="button"
              role="tab"
              aria-selected={tab === definition.id}
              className={tab === definition.id ? "active" : ""}
              onClick={
                /**
                 * click操作を表示または編集状態へ反映する。
                 * @returns 副作用を完了し、値は返さない。
                 */
                () => {
                  setTab(definition.id);
                  setCollapsed(false);
                }
              }
            >
              {resolveRibbonLabel(
                RIBBON_DEFINITIONS.tabs[definition.id],
                messages,
                japanese,
              )}
            </button>
          ),
        )}
        <span className="ribbon-spacer" />
        {renderHeaderItems(RIBBON_LAYOUT.header.itemIds)}
      </div>
      {!collapsed && (
        <div className="ribbon-content" role="tabpanel">
          {activeTab.groups.map(
            /**
             * 各groupから識別子を取り出して一覧化する。
             * @param group - groupの識別子を参照する走査対象。
             * @returns 識別子を取り出した変換結果の一覧。
             */
            (group) => (
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
            ),
          )}
        </div>
      )}
    </header>
  );
}

/**
 * リボンから必要な値またはリソースを取得する。
 * @param id - リボンの対象や分岐を識別する値。
 * @returns リボンのget・item・definitionが生成する結果。
 */
function getItemDefinition(id: RibbonItemId): RibbonItemDefinition {
  const definition = RIBBON_DEFINITIONS.items[id];
  if (!definition) {
    throw new Error(`Ribbon definition is missing: ${id}`);
  }
  return definition;
}

/**
 * リボンから必要な値またはリソースを取得する。
 * @param id - リボンの対象や分岐を識別する値。
 * @returns リボンのget・item・implementationが生成する結果。
 */
function getItemImplementation(id: RibbonItemId): RibbonItemImplementation {
  const implementation = RIBBON_IMPLEMENTATIONS[id];
  if (!implementation) {
    throw new Error(`Ribbon implementation is missing: ${id}`);
  }
  return implementation;
}

/**
 * リボンから必要な値またはリソースを取得する。
 * @param id - リボンの対象や分岐を識別する値。
 * @returns リボンのget・header・implementationが生成する結果。
 */
function getHeaderImplementation(
  id: RibbonHeaderImplementationId,
): RibbonButtonImplementation {
  const implementation = RIBBON_HEADER_IMPLEMENTATIONS[id];
  if (!implementation) {
    throw new Error(`Ribbon header implementation is missing: ${id}`);
  }
  return implementation;
}

/**
 * リボンのgroupを処理し、呼び出し側へ結果または副作用を返す。
 * @param options - 呼び出し側が指定する処理設定。
 * @returns リボンのgroupが生成する結果。
 */
function Group({
  label,
  children,
  className,
}: {
  /**
   * 画面または検証結果に表示する説明文。
   */
  label: string;

  /**
   * リボンのchildrenに関する状態または設定。
   */
  children: React.ReactNode;

  /**
   * リボンで扱うclass・nameの文字列。
   */
  className?: string;
}): React.JSX.Element {
  return (
    <section className={`ribbon-group${className ? ` ${className}` : ""}`}>
      <div className="ribbon-controls">{children}</div>
      <span className="ribbon-group-label">{label}</span>
    </section>
  );
}

/**
 * リボンのtoolを処理し、呼び出し側へ結果または副作用を返す。
 * @param options - 呼び出し側が指定する処理設定。
 * @returns リボンのtoolが生成する結果。
 */
function Tool({
  label,
  shortcut,
  active = false,
  disabled = false,
  title,
  onClick,
}: {
  /**
   * 画面または検証結果に表示する説明文。
   */
  label: string;

  /**
   * リボン項目に割り当てるキーボードショートカット。
   */
  shortcut?: string;

  /**
   * リボンの状態を示すフラグ。
   */
  active?: boolean;

  /**
   * リボンの状態を示すフラグ。
   */
  disabled?: boolean;

  /**
   * 画面や出力に表示するタイトル。
   */
  title?: string;
  /**
   * リボンのイベントまたはメッセージを受け取り、状態を更新する。
   * @returns リボンのon・clickが生成する結果。
   */
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

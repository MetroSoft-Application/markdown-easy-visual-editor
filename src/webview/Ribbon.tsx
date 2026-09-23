/**
 * @file Ribbon.tsx
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
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
 * 「Props」が満たすデータ契約を定義します。
 */
interface Props {

  /**
   * 「messages」は、画面または通知へ表示する文言を保持します。
   */
  messages: Messages;

  /**
   * 「mode」は、画面の表示モードまたは現在のUI状態を示します。
   */
  mode: EditorMode;

  /**
   * 「readOnly」は、処理条件または状態を表す真偽値です。
   */
  readOnly: boolean;

  /**
   * 「activeMarks」は、画面の表示モードまたは現在のUI状態を示します。
   */
  activeMarks: Record<string, boolean>;

  /**
   * 「outlineVisible」は、画面の表示モードまたは現在のUI状態を示します。
   */
  outlineVisible: boolean;

  /**
   * 「scrollSyncEnabled」は、画面の表示モードまたは現在のUI状態を示します。
   */
  scrollSyncEnabled: boolean;

  /**
   * 「splitView」は、関連処理が共有する構造化データの一項目です。
   */
  splitView: "both" | "text" | "preview";

  /**
   * 「htmlOptions」は、利用側が共有する設定または現在状態を保持します。
   */
  htmlOptions: HtmlExportOptions;

  /**
   * 「imageDirectory」は、対象の内容または識別子を表す文字列です。
   */
  imageDirectory: string;

  /**
   * 「editorFontFamily」は、表示テーマまたはスタイル設定を保持します。
   */
  editorFontFamily: string;

  /**
   * 「previewFontFamily」は、表示テーマまたはスタイル設定を保持します。
   */
  previewFontFamily: string;
  /**
   * 「onHtmlOptionsChange」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @param options 処理経路や表示方法を指定する設定値です。
   * @returns イベントを処理し、状態更新または副作用だけを実行して値は返しません。
   */
  onHtmlOptionsChange: (options: HtmlExportOptions) => void;
  /**
   * 「onCommand」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @param command 「command」は、「onCommand」がWebview UI状態の処理対象を特定する入力です。
   * @returns イベントを処理し、状態更新または副作用だけを実行して値は返しません。
   */
  onCommand: (command: RibbonCommand) => void;
}

/**
 * 「Ribbon」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param props 「props」は、「Ribbon」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「Ribbon」がWebview UI状態の入力を処理して得た固有の結果を返します。
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
 * 「definition」が検索条件に一致するか判定するコールバックです。
     * @param definition definitionとして渡される、このコールバックの入力値です。
     * @returns 条件に一致した要素、または該当しない場合はundefinedを返します。
     */
    (definition) => definition.id === tab) ??
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

    /**
 * Reactの初期状態またはメモ化値を遅延計算するコールバックです。
     * @returns Reactが保持する初期状態またはメモ化値を返します。
     */
    () =>
      subscribePreviewImageResizeControlsVisible(setImageResizeControlsVisible),
    [],
  );

  useEffect(
  /**
 * Reactの初期状態またはメモ化値を遅延計算するコールバックです。
   * @returns Reactが保持する初期状態またはメモ化値を返します。
   */
  () => setImageDirectoryDraft(imageDirectory), [imageDirectory]);
  useEffect(
  /**
 * Reactの初期状態またはメモ化値を遅延計算するコールバックです。
   * @returns Reactが保持する初期状態またはメモ化値を返します。
   */
  () => setEditorFontFamilyDraft(editorFontFamily), [editorFontFamily]);
  useEffect(
  /**
 * Reactの初期状態またはメモ化値を遅延計算するコールバックです。
   * @returns Reactが保持する初期状態またはメモ化値を返します。
   */
  () => setPreviewFontFamilyDraft(previewFontFamily), [previewFontFamily]);
  /**
   * render・buttonを描画します。
   * @param id 「id」は、「renderButton」がWebview UI状態の処理対象を特定する入力です。
   * @param labelSpec 「labelSpec」は、「renderButton」がWebview UI状態の処理対象を特定する入力です。
   * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはmessages、messagesです。
   * @param implementation 「implementation」は、「renderButton」がWebview UI状態の処理対象を特定する入力です。
   * @returns 「renderButton」が生成したWebview UI状態のデータを返します。
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
 * 受け取った入力または現在の状態を検証し、呼び出し元へ必要な処理結果を返すコールバックです。
           * @returns 「implementation.onClick」の呼び出し結果を返します。
           */
          () => implementation.onClick(context)}
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
 * 受け取った入力または現在の状態を検証し、呼び出し元へ必要な処理結果を返すコールバックです。
           * @returns 「implementation.onClick」の呼び出し結果を返します。
           */
          () => implementation.onClick(context)}
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
 * 受け取った入力または現在の状態を検証し、呼び出し元へ必要な処理結果を返すコールバックです。
         * @returns 「implementation.onClick」の呼び出し結果を返します。
         */
        () => implementation.onClick(context)}
      />
    );
  }

  /**
   * 項目を描画します。
   * @param id 「id」は、「renderItem」がWebview UI状態の処理対象を特定する入力です。
   * @returns 「renderItem」が生成したWebview UI状態のデータを返します。
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
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
           * @param spec specとして渡される、このコールバックの入力値です。
           * @returns 「spec」から生成した処理結果を返します。
           */
          (spec) => resolveRibbonLabel(spec, messages, japanese),
        )}
      </React.Fragment>
    );
  }

  /**
   * 項目を描画します。
   * @param itemIds 「itemIds」は、「renderGroupItems」がWebview UI状態の処理対象を特定する入力です。
   * @returns 「renderGroupItems」が生成したWebview UI状態のデータを返します。
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
   * 項目を描画します。
   * @param itemIds 「itemIds」は、「renderHeaderItems」がWebview UI状態の処理対象を特定する入力です。
   * @returns 「renderHeaderItems」が生成したWebview UI状態のデータを返します。
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
   * render・header・buttonを描画します。
   * @param id 「id」は、「renderHeaderButton」がWebview UI状態の処理対象を特定する入力です。
   * @returns 「renderHeaderButton」が生成したWebview UI状態のデータを返します。
   */
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
      onClickCapture={
      /**
 * 「event」を受け取り、処理結果を生成する処理です。
       * @param event 処理対象のイベントです。
       * @returns 「event.target.closest」を実行し、値を返しません。
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
        {RIBBON_LAYOUT.tabs.map(
        /**
 * 「definition」を変換し、変換後の要素を返すコールバックです。
         * @param definition definitionとして渡される、このコールバックの入力値です。
         * @returns 入力要素から生成した変換後の値を返します。
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
 * 登録された副作用または結果を生成する処理を実行するコールバックです。
             * @returns 「setTab」を実行し、値を返しません。
             */
            () => {
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
          {activeTab.groups.map(
          /**
 * 「group」を変換し、変換後の要素を返すコールバックです。
           * @param group groupとして渡される、このコールバックの入力値です。
           * @returns 入力要素から生成した変換後の値を返します。
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
          ))}
        </div>
      )}
    </header>
  );
}

/**
 * get・item・definitionを取得または解決します。
 * @param id 「id」は、「getItemDefinition」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「getItemDefinition」が読み取りまたは正規化した結果を返します。
 */
function getItemDefinition(id: RibbonItemId): RibbonItemDefinition {
  const definition = RIBBON_DEFINITIONS.items[id];
  if (!definition) {
    throw new Error(`Ribbon definition is missing: ${id}`);
  }
  return definition;
}

/**
 * get・item・implementationを取得または解決します。
 * @param id 「id」は、「getItemImplementation」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「getItemImplementation」が読み取りまたは正規化した結果を返します。
 */
function getItemImplementation(id: RibbonItemId): RibbonItemImplementation {
  const implementation = RIBBON_IMPLEMENTATIONS[id];
  if (!implementation) {
    throw new Error(`Ribbon implementation is missing: ${id}`);
  }
  return implementation;
}

/**
 * get・header・implementationを取得または解決します。
 * @param id 「id」は、「getHeaderImplementation」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「getHeaderImplementation」が読み取りまたは正規化した結果を返します。
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
 * 「Group」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param props 「props」は、「Group」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「Group」がWebview UI状態の入力を処理して得た固有の結果を返します。
 */
function Group({
  label,
  children,
  className,
}: {

  /**
   * 「label」は、画面または通知へ表示する文言を保持します。
   */
  label: string;

  /**
   * 「children」は、コンポーネントが表示する子要素を保持します。
   */
  children: React.ReactNode;

  /**
   * 「className」は、対象の識別や処理分岐に使用する値を保持します。
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
 * 「Tool」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param props 「props」は、「Tool」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「Tool」がWebview UI状態の入力を処理して得た固有の結果を返します。
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
   * 「label」は、画面または通知へ表示する文言を保持します。
   */
  label: string;

  /**
   * 「shortcut」は、対象の内容または識別子を表す文字列です。
   */
  shortcut?: string;

  /**
   * 「active」は、画面の表示モードまたは現在のUI状態を示します。
   */
  active?: boolean;

  /**
   * 「disabled」は、処理条件または状態を表す真偽値です。
   */
  disabled?: boolean;

  /**
   * 「title」は、画面または通知へ表示する文言を保持します。
   */
  title?: string;
  /**
   * 「onClick」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @returns イベントを処理し、状態更新または副作用だけを実行して値は返しません。
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

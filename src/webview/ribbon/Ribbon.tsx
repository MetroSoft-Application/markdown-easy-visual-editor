/**
 * @fileoverview 編集画面のリボンを表示し、コマンド・設定・表示状態の変更をHostへ委譲する。
 */
import React, { useEffect, useState } from "react";
import type { EditorMode, HtmlExportOptions } from "../../shared/protocol";
import type { Messages } from "../../shared/messages";
import { mveDebug } from "../runtime/debug";
import {
  getPreviewImageResizeControlsVisible,
  subscribePreviewImageResizeControlsVisible,
} from "../preview/previewImageResizeControls";
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
import { resolveRibbonLabel } from "./ribbonLabels";
import { validateRibbonConfiguration } from "./ribbonValidation";
import type {
  RibbonButtonImplementation,
  RibbonHeaderImplementationId,
  RibbonImplementationContext,
  RibbonItemImplementation,
  TextColorChoice,
} from "./ribbonTypes";
import type { RibbonCommand } from "./ribbonTypes";

/** リボンがHostへ通知するコマンドと表操作の型を再公開する。 */
export type { RibbonCommand, TableAction } from "./ribbonTypes";
/** リボン表示で使うタブ識別子を既存名RibbonTabとして再公開する。 */
export type { RibbonTabId as RibbonTab } from "./ribbonIds";

validateRibbonConfiguration(
  RIBBON_LAYOUT,
  RIBBON_DEFINITIONS,
  RIBBON_IMPLEMENTATIONS,
  RIBBON_HEADER_IMPLEMENTATIONS,
);

/**
 * リボンに表示する状態、操作項目、イベントハンドラーです。
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
   * アウトラインパネルを現在表示している場合にtrue。
   */
  outlineVisible: boolean;

  /**
   * 本文とプレビューのスクロール同期を有効にする設定。
   */
  scrollSyncEnabled: boolean;

  /**
   * 分割表示の構成。両ペイン、テキストのみ、プレビューのみのいずれか。
   */
  splitView: "both" | "text" | "preview";

  /**
   * リボンへ渡す設定または境界値。
   */
  htmlOptions: HtmlExportOptions;

  /** PDF出力時に保存先ダイアログを省略する設定。 */
  pdfSaveWithoutDialog: boolean;

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
    * HTML出力設定の変更をHostへ通知し、永続化とプレビュー反映を依頼する。
   * @param options - 呼び出し側が指定する処理設定。
   */
  onHtmlOptionsChange: (options: HtmlExportOptions) => void;

  /**
   * PDFの保存先ダイアログ設定を変更し、親コンポーネントへ反映する。
   * @param enabled 保存時にダイアログを省略するかどうか。
   */
  onPdfSaveWithoutDialogChange: (enabled: boolean) => void;
  /**
    * リボン操作をHostへ送り、登録済みコマンドの実行を依頼する。
    * @param command - Hostへ送信するリボンコマンド。
   */
  onCommand: (command: RibbonCommand) => void;
}

/**
 * 編集コマンドと設定項目をまとめて表示し、操作を親の文書・設定状態へ委譲する。
 * PDFの保存ダイアログ設定もこのコンテキストを通じて更新し、他のPDF値を保持する。
 * @param messages リボン内のラベルと操作説明に使うローカライズ済み文言。
 * @param mode 本文編集面とプレビューの現在の表示モード。
 * @param readOnly 編集コマンドを無効にする読み取り専用状態。
 * @param activeMarks 選択範囲に適用されている書式マーク。
 * @param outlineVisible 目次パネルの表示状態。
 * @param scrollSyncEnabled 本文とプレビューのスクロール同期状態。
 * @param splitView 本文とプレビューを並べて表示する状態。
 * @param htmlOptions HTML出力で使うフォントと余白の設定。
 * @param pdfSaveWithoutDialog PDF保存先ダイアログを省略する設定。
 * @param imageDirectory ローカル画像を保存するディレクトリ。
 * @param editorFontFamily 本文編集面に使うフォント名。
 * @param previewFontFamily プレビューに使うフォント名。
 * @param onHtmlOptionsChange HTML出力設定の変更を親へ通知する処理。
 * @param onPdfSaveWithoutDialogChange PDF保存ダイアログ設定の変更を親へ通知する処理。
 * @param onCommand 選択された編集または出力コマンドを親へ通知する処理。
 * @returns タブ・設定欄・コマンドボタンを含むリボン。
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
  pdfSaveWithoutDialog,
  imageDirectory,
  editorFontFamily,
  previewFontFamily,
  onHtmlOptionsChange,
  onPdfSaveWithoutDialogChange,
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
    collapsed,
    setCollapsed,
    textColorText: messages.app.textColor,
    mode,
    readOnly,
    activeMarks,
    outlineVisible,
    scrollSyncEnabled,
    splitView,
    imageResizeControlsVisible,
    htmlOptions,
    pdfSaveWithoutDialog,
    imageDirectory,
    editorFontFamily,
    previewFontFamily,
    onHtmlOptionsChange,
    onPdfSaveWithoutDialogChange,
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
      * プレビュー画像のサイズ操作UIが表示されたことをstateへ反映する購読を登録する。
     */
    () =>
      subscribePreviewImageResizeControlsVisible(setImageResizeControlsVisible),
    [],
  );

  useEffect(
    /**
      * Hostから受け取った画像保存先を編集欄へ同期する。
     */
    () => setImageDirectoryDraft(imageDirectory),
    [imageDirectory],
  );
  useEffect(
    /**
      * Hostから受け取ったエディターフォントを編集欄へ同期する。
     */
    () => setEditorFontFamilyDraft(editorFontFamily),
    [editorFontFamily],
  );
  useEffect(
    /**
      * Hostから受け取ったプレビューフォントを編集欄へ同期する。
     */
    () => setPreviewFontFamilyDraft(previewFontFamily),
    [previewFontFamily],
  );
  /**
   * リボン項目の定義と実装から、適切なボタン表示を作る。
   * @param id Reactの一覧描画で使うリボン項目ID。
   * @param labelSpec 共有メッセージキーのパスと、必要に応じて数値を持つラベル定義。
   * @param options 見た目、ショートカット、ツールチップを決めるボタン設定。
   * @param implementation 有効状態、使用可否、クリック処理を持つ項目実装。
   * @returns リボン項目のReactボタン要素。
   */
  function renderButton(
    id: string,
    labelSpec: RibbonLabelSpec,
    options: RibbonButtonOptions,
    implementation: RibbonButtonImplementation,
  ): React.JSX.Element {
    const label = resolveRibbonLabel(labelSpec, messages);
    const active = implementation.active?.(context) ?? false;
    const disabled = implementation.disabled?.(context) ?? false;
    const title = options.title
      ? resolveRibbonLabel(options.title, messages)
      : undefined;
    if (options.variant === "header") {
      return (
        <button
          key={id}
          type="button"
          disabled={disabled}
          title={title ?? label}
          onClick={
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
          () => implementation.onClick(context)
        }
      />
    );
  }

  /**
   * 項目IDに対応する定義と状態に従ってリボン項目を描画する。
   * @param id - 描画するリボン項目のID。
   * @returns 定義と状態に従って描画したリボン項目。
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
           * 各ラベル定義を現在の言語の表示文字列へ解決する。
           * @param spec - ローカライズ済み表示文字列へ解決するラベル定義。
           * @returns 現在の言語で解決したラベル文字列。
           */
          (spec) => resolveRibbonLabel(spec, messages),
        )}
      </React.Fragment>
    );
  }

  /**
   * 指定したIDのリボン項目を、定義されたグループ単位で描画する。
    * @param itemIds - 表示するグループ内リボン項目のID一覧。
   * @returns 各グループを含むリボン項目のReact node一覧。
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
   * 指定したIDのヘッダー項目を、定義されたグループ単位で描画する。
    * @param itemIds - 表示するリボンヘッダー項目のID一覧。
   * @returns 各グループを含むヘッダー項目のReact node一覧。
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
   * ヘッダー項目IDに対応する定義と状態に従ってボタンを描画する。
   * @param id - 描画するリボンヘッダー項目のID。
   * @returns 定義と折りたたみ状態に従って描画したヘッダーボタン。
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
         * button内の子要素から押されたリボン項目を特定して対応する選択状態を更新する。
         * @param event - リボン内buttonのcapture-phase click event。
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
 * IDに対応する項目定義を取得し、定義漏れを設定エラーとして報告する。
 * @param id - 定義を取得するリボン項目ID。
 * @returns 表示名・型・実装IDを含む項目定義。
 */
function getItemDefinition(id: RibbonItemId): RibbonItemDefinition {
  const definition = RIBBON_DEFINITIONS.items[id];
  if (!definition) {
    throw new Error(`Ribbon definition is missing: ${id}`);
  }
  return definition;
}

/**
 * IDに対応する操作実装を取得し、登録漏れを設定エラーとして報告する。
 * @param id - 実装を取得するリボン項目ID。
 * @returns 項目を実行するための実装。
 */
function getItemImplementation(id: RibbonItemId): RibbonItemImplementation {
  const implementation = RIBBON_IMPLEMENTATIONS[id];
  if (!implementation) {
    throw new Error(`Ribbon implementation is missing: ${id}`);
  }
  return implementation;
}

/**
 * ヘッダー操作IDに対応するボタン実装を取得し、登録漏れを報告する。
 * @param id - 実装を取得するヘッダー操作ID。
 * @returns ヘッダー操作のボタン実装。
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
 * 関連する操作をラベル付きのfieldsetへまとめる。
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
    * グループ内に表示する操作要素。
   */
  children: React.ReactNode;

  /**
    * レイアウト調整に使う追加CSSクラス。
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
 * ラベルとショートカットを添えた補助ツール領域を描画する。
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
    * ボタン押下時に実行する操作。
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

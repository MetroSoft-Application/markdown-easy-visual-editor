/**
 * @fileoverview リボン項目の実装を定義し、ボタン・入力コントロール・状態表示をReact要素へ接続する。
 */
import React, { useRef } from "react";
import type { EditorTheme } from "../shared/protocol";
import { normalizeFontFamily } from "../shared/fontFamily";
import { TEXT_COLOR_HEX, TEXT_COLOR_IDS } from "../shared/textColor";
import { setPreviewImageResizeControlsVisible } from "./previewImageResizeControls";
import {
  applyTextColorToActiveSource,
  clearInlineFormattingWithTextColor,
  readActiveSourceTextColor,
} from "./textColorController";
import { sharedVsCodeApi } from "./vscodeApi";
import type {
  RibbonControlFieldDefinition,
  RibbonItemDefinition,
} from "./ribbonDefinitionTypes";
import type { RibbonItemId } from "./ribbonIds";
import type {
  RibbonButtonState,
  RibbonButtonImplementation,
  RibbonControlImplementation,
  RibbonImplementationContext,
  RibbonItemImplementation,
  RibbonHeaderImplementationId,
  TableAction,
} from "./ribbonTypes";

const button = /**
 * リボンボタンのコマンド処理と表示状態を定義する。
 * @param onClick - ボタン操作をHostまたは編集面へ通知する関数。
 * @param options - 呼び出し側が指定する処理設定。
 * @returns クリック処理と表示状態を持つリボンボタン実装。
 */ (
  onClick: RibbonButtonImplementation["onClick"],
  options: Omit<RibbonButtonImplementation, "kind" | "onClick"> = {},
): RibbonButtonImplementation => ({
  kind: "button",
  onClick,
  ...options,
});

const control = /**
 * リボンの入力コントロールを定義する。
 * @param render - リボン項目の表示要素を生成する関数。
 * @returns 表示処理を持つリボン入力コントロール実装。
 */ (
  render: RibbonControlImplementation["render"],
): RibbonControlImplementation => ({
  kind: "control",
  render,
});

const editDisabled = /**
 * 読み取り専用状態から編集操作の無効条件を求める。
 * @param state - 現在の編集・表示状態。
 * @returns 条件が成立したかを示す真偽値。
 */ (state: RibbonButtonState): boolean => state.readOnly;

const activeMark = /**
 * 指定したMarkdown書式が選択範囲で有効か判定する関数を作る。
 * @param mark - リボン実装で受け渡す文字列。
 * @returns 指定書式の有効状態を返す判定関数。
 */ (mark: string) =>
  /**
   * 指定したMarkdown書式が選択範囲で有効か判定する。
   * @param state - 現在の編集・表示状態。
   * @returns 条件が成立したかを示す真偽値。
   */
  (state: RibbonButtonState) =>
    Boolean(state.activeMarks[mark]);

/**
 * リボン項目IDと実行実装を対応付ける定義表。
 */
export const RIBBON_IMPLEMENTATIONS: Record<
  RibbonItemId,
  RibbonItemImplementation
> = {
  undo: button(
    /**
     * クリック時にリボン操作「undo」を編集面へ通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "historyCommand", command: "undo" }),
  ),
  redo: button(
    /**
     * クリック時にリボン操作「redo」を編集面へ通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "historyCommand", command: "redo" }),
  ),
  style: control(
    /**
     * リボンの設定値と文言から入力コントロールを生成する。
     * @param context - 編集状態、表示文言、コマンド通知を含むリボン表示コンテキスト。
     * @param definition - ラベルと選択肢を含むリボン項目定義。
     * @param resolveLabel - ローカライズキーを表示文言へ変換する関数。
     * @returns リボンに表示する入力コントロール。
     */
    (context, definition, resolveLabel) => (
      <label className="ribbon-select-label">
        {resolveLabel(definition.label)}
        <select
          disabled={context.readOnly}
          defaultValue="0"
          onChange={
            /**
             * changeイベントでon・commandを実行する。
             * @param event - ユーザー操作またはDOMから通知されたイベント。
             * @returns 副作用を完了し、値は返さない。
             */
            (event) =>
              context.onCommand({
                type: "heading",
                level: Number(event.target.value),
              })
          }
        >
          {(definition.options?.choices ?? []).map(
            /**
             * 各choiceから値を取り出して一覧化する。
             * @param choice - choiceの値を参照する走査対象。
             * @returns 値を取り出した変換結果の一覧。
             */
            (choice) => (
              <option key={choice.value} value={choice.value}>
                {resolveLabel(choice.label)}
              </option>
            ),
          )}
        </select>
      </label>
    ),
  ),
  quote: button(
    /**
     * クリック時にリボン操作「quote」を編集面へ通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "sourceAction", action: "quote" }),
    { disabled: editDisabled },
  ),
  bulletList: button(
    /**
     * クリック時にリボン操作「bulletList」を編集面へ通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) =>
      onCommand({ type: "sourceAction", action: "bulletList" }),
    { disabled: editDisabled },
  ),
  orderedList: button(
    /**
     * クリック時にリボン操作「orderedList」を編集面へ通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) =>
      onCommand({ type: "sourceAction", action: "orderedList" }),
    { disabled: editDisabled },
  ),
  taskList: button(
    /**
     * クリック時にリボン操作「taskList」を編集面へ通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "sourceAction", action: "taskList" }),
    { disabled: editDisabled },
  ),
  indent: button(
    /**
     * クリック時にリボン操作「indent」を編集面へ通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "sourceAction", action: "indent" }),
    { disabled: editDisabled },
  ),
  outdent: button(
    /**
     * クリック時にリボン操作「outdent」を編集面へ通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "sourceAction", action: "outdent" }),
    { disabled: editDisabled },
  ),
  bold: button(
    /**
     * クリック時にリボン操作「bold」を編集面へ通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "sourceAction", action: "bold" }),
    { disabled: editDisabled, active: activeMark("bold") },
  ),
  italic: button(
    /**
     * クリック時にリボン操作「italic」を編集面へ通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "sourceAction", action: "italic" }),
    { disabled: editDisabled, active: activeMark("italic") },
  ),
  strike: button(
    /**
     * クリック時にリボン操作「strike」を編集面へ通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "sourceAction", action: "strike" }),
    { disabled: editDisabled, active: activeMark("strike") },
  ),
  underline: button(
    /**
     * クリック時にリボン操作「underline」を編集面へ通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "sourceAction", action: "underline" }),
    { disabled: editDisabled, active: activeMark("underline") },
  ),
  highlight: button(
    /**
     * クリック時にリボン操作「highlight」を編集面へ通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "sourceAction", action: "highlight" }),
    { disabled: editDisabled, active: activeMark("highlight") },
  ),
  code: button(
    /**
     * クリック時にリボン操作「inlineCode」を編集面へ通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) =>
      onCommand({ type: "sourceAction", action: "inlineCode" }),
    { disabled: editDisabled, active: activeMark("inlineCode") },
  ),
  superscript: button(
    /**
     * クリック時にリボン操作「sup」を編集面へ通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "sourceAction", action: "sup" }),
    { disabled: editDisabled },
  ),
  subscript: button(
    /**
     * クリック時にリボン操作「sub」を編集面へ通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "sourceAction", action: "sub" }),
    { disabled: editDisabled },
  ),
  textColor: control(
    /**
     * リボンの設定値と文言から入力コントロールを生成する。
     * @param context - 編集状態、表示文言、コマンド通知を含むリボン表示コンテキスト。
     * @param definition - ラベルと選択肢を含むリボン項目定義。
     * @param resolveLabel - ローカライズキーを表示文言へ変換する関数。
     * @returns リボンに表示する入力コントロール。
     */
    (context, definition, resolveLabel) => (
      <label className="ribbon-select-label">
        {context.textColorText.label}
        <select
          className="mve-text-color-select"
          value={context.textColorChoice}
          disabled={context.readOnly}
          onFocus={
            /**
             * 要素をset・text・color・choiceへ渡し、リボン実装の結果または副作用を処理する。
             * @returns リボン実装のコールバックが生成する結果。
             */
            () =>
              context.setTextColorChoice(
                readActiveSourceTextColor() ?? "default",
              )
          }
          onChange={
            /**
             * change操作を表示または編集状態へ反映する。
             * @param event - ユーザー操作またはDOMから通知されたイベント。
             * @returns 副作用を完了し、値は返さない。
             */
            (event) => {
              const value = event.target
                .value as typeof context.textColorChoice;
              if (value === "mixed") return;
              applyTextColorToActiveSource(
                value === "default" ? undefined : value,
              );
              context.setTextColorChoice(value);
            }
          }
          style={
            context.textColorChoice !== "default" &&
            context.textColorChoice !== "mixed"
              ? { color: TEXT_COLOR_HEX[context.textColorChoice] }
              : undefined
          }
        >
          <option value="mixed" disabled>
            {context.textColorText.mixed}
          </option>
          <option value="default">{context.textColorText.defaultColor}</option>
          {TEXT_COLOR_IDS.map(
            /**
             * 各colorからsを取り出して一覧化する。
             * @param color - colorのsを参照する走査対象。
             * @returns sを取り出した変換結果の一覧。
             */
            (color) => (
              <option
                key={color}
                value={color}
                style={{ color: TEXT_COLOR_HEX[color] }}
              >
                {`● ${context.textColorText.colors[color]}`}
              </option>
            ),
          )}
        </select>
      </label>
    ),
  ),
  clearInline: button(
    /**
     * クリック時にリボン操作「clearInline」を編集面へ通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => {
      if (!clearInlineFormattingWithTextColor()) {
        onCommand({ type: "sourceAction", action: "clearInline" });
      }
    },
    { disabled: editDisabled },
  ),
  clearBlock: button(
    /**
     * クリック時にリボン操作「clearBlock」を編集面へ通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) =>
      onCommand({ type: "sourceAction", action: "clearBlock" }),
    { disabled: editDisabled },
  ),
  link: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "link" }),
    { disabled: editDisabled },
  ),
  image: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "image" }),
    { disabled: editDisabled },
  ),
  tableSize: control(
    /**
     * リボンの設定値と文言から入力コントロールを生成する。
     * @param context - 編集状態、表示文言、コマンド通知を含むリボン表示コンテキスト。
     * @param definition - ラベルと選択肢を含むリボン項目定義。
     * @param resolveLabel - ローカライズキーを表示文言へ変換する関数。
     * @returns リボンに表示する入力コントロール。
     */
    (context, definition, resolveLabel) => {
      const rows = getControlField(definition, "rows");
      const columns = getControlField(definition, "columns");
      return (
        <>
          <label>
            {resolveLabel(rows.label)}
            <input
              type="number"
              min={rows.min}
              max={rows.max}
              disabled={context.readOnly}
              value={context.tableRows}
              onChange={
                /**
                 * change操作を表示または編集状態へ反映する。
                 * @param event - ユーザー操作またはDOMから通知されたイベント。
                 * @returns 副作用を完了し、値は返さない。
                 */
                (event) =>
                  context.setTableRows(
                    clampNumber(
                      event.target.value,
                      rows.min ?? 0,
                      rows.max ?? 50,
                    ),
                  )
              }
            />
          </label>
          <label>
            {resolveLabel(columns.label)}
            <input
              type="number"
              min={columns.min}
              max={columns.max}
              disabled={context.readOnly}
              value={context.tableColumns}
              onChange={
                /**
                 * change操作を表示または編集状態へ反映する。
                 * @param event - ユーザー操作またはDOMから通知されたイベント。
                 * @returns 副作用を完了し、値は返さない。
                 */
                (event) =>
                  context.setTableColumns(
                    clampNumber(
                      event.target.value,
                      columns.min ?? 0,
                      columns.max ?? 50,
                    ),
                  )
              }
            />
          </label>
        </>
      );
    },
  ),
  insertTable: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand, tableRows, tableColumns }) =>
      onCommand({
        type: "tableInsert",
        rows: tableRows,
        columns: tableColumns,
      }),
    { disabled: editDisabled },
  ),
  horizontalRule: button(
    /**
     * クリック時にリボン操作「horizontalRule」を編集面へ通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) =>
      onCommand({ type: "sourceAction", action: "horizontalRule" }),
    { disabled: editDisabled },
  ),
  hardBreak: button(
    /**
     * クリック時にリボン操作「hardBreak」を編集面へ通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "sourceAction", action: "hardBreak" }),
    { disabled: editDisabled },
  ),
  codeLanguage: control(
    /**
     * リボンの設定値と文言から入力コントロールを生成する。
     * @param context - 編集状態、表示文言、コマンド通知を含むリボン表示コンテキスト。
     * @param definition - ラベルと選択肢を含むリボン項目定義。
     * @param resolveLabel - ローカライズキーを表示文言へ変換する関数。
     * @returns リボンに表示する入力コントロール。
     */
    (context, definition, resolveLabel) => (
      <label className="ribbon-select-label">
        {resolveLabel(definition.label)}
        <select
          value={context.codeLanguage}
          disabled={context.readOnly}
          onChange={
            /**
             * change操作を表示または編集状態へ反映する。
             * @param event - ユーザー操作またはDOMから通知されたイベント。
             * @returns 副作用を完了し、値は返さない。
             */
            (event) => context.setCodeLanguage(event.target.value)
          }
        >
          {context.messages.ribbon.codeLanguages.map(
            /**
             * 各languageから値を取り出して一覧化する。
             * @param language - languageの値を参照する走査対象。
             * @returns 値を取り出した変換結果の一覧。
             */
            (language) => (
              <option key={language.value} value={language.value}>
                {language.label}
              </option>
            ),
          )}
        </select>
      </label>
    ),
  ),
  codeBlock: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand, codeLanguage }) =>
      onCommand({ type: "codeBlock", language: codeLanguage }),
    { disabled: editDisabled },
  ),
  mermaid: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand, messages }) =>
      onCommand({ type: "insert", value: messages.ribbon.snippets.mermaid }),
    { disabled: editDisabled },
  ),
  math: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) =>
      onCommand({ type: "insert", value: "\n$$\nE = mc^2\n$$\n" }),
    { disabled: editDisabled },
  ),
  footnote: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand, messages }) =>
      onCommand({ type: "insert", value: messages.ribbon.snippets.footnote }),
    { disabled: editDisabled },
  ),
  toc: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "insert", value: "\n[toc]\n" }),
    { disabled: editDisabled },
  ),
  pageBreak: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) =>
      onCommand({ type: "insert", value: "\n<!-- pagebreak -->\n" }),
    { disabled: editDisabled },
  ),
  note: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand, messages }) =>
      onCommand({ type: "insert", value: messages.ribbon.snippets.note }),
    { disabled: editDisabled },
  ),
  warning: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand, messages }) =>
      onCommand({ type: "insert", value: messages.ribbon.snippets.warning }),
    { disabled: editDisabled },
  ),
  emoji: control(
    /**
     * リボンの設定値と文言から入力コントロールを生成する。
     * @param context - 編集状態、表示文言、コマンド通知を含むリボン表示コンテキスト。
     * @param definition - ラベルと選択肢を含むリボン項目定義。
     * @param resolveLabel - ローカライズキーを表示文言へ変換する関数。
     * @returns リボンに表示する入力コントロール。
     */
    (context, definition, resolveLabel) => (
      <label className="ribbon-select-label">
        {resolveLabel(definition.label)}
        <select
          value={context.emoji}
          disabled={context.readOnly}
          onChange={
            /**
             * change操作を表示または編集状態へ反映する。
             * @param event - ユーザー操作またはDOMから通知されたイベント。
             * @returns 副作用を完了し、値は返さない。
             */
            (event) => context.setEmoji(event.target.value)
          }
        >
          {(definition.options?.values ?? []).map(
            /**
             * 各値を変換して一覧化する。
             * @param value - 走査中の要素。
             * @returns 入力要素から生成した変換結果の一覧。
             */
            (value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ),
          )}
        </select>
      </label>
    ),
  ),
  insertEmoji: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand, emoji }) => onCommand({ type: "insert", value: emoji }),
    { disabled: editDisabled },
  ),
  rowBefore: tableButton("rowBefore"),
  rowAfter: tableButton("rowAfter"),
  deleteRow: tableButton("deleteRow"),
  colBefore: tableButton("colBefore"),
  colAfter: tableButton("colAfter"),
  deleteColumn: tableButton("deleteColumn"),
  tableHeader: control(
    /**
     * リボンの設定値と文言から入力コントロールを生成する。
     * @param context - 編集状態、表示文言、コマンド通知を含むリボン表示コンテキスト。
     * @param definition - ラベルと選択肢を含むリボン項目定義。
     * @param resolveLabel - ローカライズキーを表示文言へ変換する関数。
     * @returns リボンに表示する入力コントロール。
     */
    (context, definition, resolveLabel) => {
      const field = getControlField(definition, "header");
      return (
        <label className="ribbon-select-label">
          {resolveLabel(definition.label)}
          <input
            disabled={context.readOnly}
            value={context.headerName}
            placeholder={
              field.placeholder ? resolveLabel(field.placeholder) : undefined
            }
            onChange={
              /**
               * change操作を表示または編集状態へ反映する。
               * @param event - ユーザー操作またはDOMから通知されたイベント。
               * @returns 副作用を完了し、値は返さない。
               */
              (event) => context.setHeaderName(event.target.value)
            }
          />
        </label>
      );
    },
  ),
  alignLeft: tableButton("alignLeft"),
  alignCenter: tableButton("alignCenter"),
  alignRight: tableButton("alignRight"),
  alignColumns: tableButton("alignColumns"),
  cellBreak: button(
    /**
     * クリック時にリボン操作「cellBreak」を編集面へ通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "sourceAction", action: "cellBreak" }),
    { disabled: editDisabled },
  ),
  openTableEditor: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @returns クリック処理を完了し、値は返さない。
     */
    () => window.dispatchEvent(new Event("mve-open-table-editor")),
    { disabled: editDisabled },
  ),
  copyTsv: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "copyTableTsv" }),
    {
      disabled: /**
       * リボン実装の条件を判定する。
       * @param state - 現在の編集・表示状態。
       * @returns リボン実装のdisabledが生成する結果。
       */ (state) =>
        state.mode === "preview" ||
        (state.mode === "split" && state.splitView === "preview"),
    },
  ),
  openSource: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "openSource" }),
  ),
  outline: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "toggleOutline" }),
    {
      active: /**
       * リボン実装のactiveを処理し、呼び出し側へ結果または副作用を返す。
       * @param state - 現在の編集・表示状態。
       * @returns リボン実装のactiveが生成する結果。
       */ (state) => state.outlineVisible,
    },
  ),
  scrollSync: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "toggleScrollSync" }),
    {
      active: /**
       * リボン実装のactiveを処理し、呼び出し側へ結果または副作用を返す。
       * @param state - 現在の編集・表示状態。
       * @returns リボン実装のactiveが生成する結果。
       */ (state) => state.scrollSyncEnabled,
    },
  ),
  zoomHint: control(
    /**
     * リボンの設定値と文言から入力コントロールを生成する。
     * @param _context - リボン実装で扱う文字列または本文。
     * @param definition - ラベルと選択肢を含むリボン項目定義。
     * @param resolveLabel - ローカライズキーを表示文言へ変換する関数。
     * @returns リボンに表示する入力コントロール。
     */
    (_context, definition, resolveLabel) => (
      <span className="ribbon-hint">{resolveLabel(definition.label)}</span>
    ),
  ),
  imageResize: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ imageResizeControlsVisible }) =>
      setPreviewImageResizeControlsVisible(!imageResizeControlsVisible),
    {
      active: /**
       * リボン実装のactiveを処理し、呼び出し側へ結果または副作用を返す。
       * @param state - 現在の編集・表示状態。
       * @returns リボン実装のactiveが生成する結果。
       */ (state) => state.imageResizeControlsVisible,
    },
  ),
  editorTheme: control(
    /**
     * リボンの設定値と文言から入力コントロールを生成する。
     * @param context - 編集状態、表示文言、コマンド通知を含むリボン表示コンテキスト。
     * @param definition - ラベルと選択肢を含むリボン項目定義。
     * @param resolveLabel - ローカライズキーを表示文言へ変換する関数。
     * @returns リボンに表示する入力コントロール。
     */
    (context, definition, resolveLabel) => (
      <label className="ribbon-select-label">
        {resolveLabel(definition.label)}
        <select
          className="mve-editor-theme-select"
          defaultValue={
            (document.documentElement.dataset.editorTheme as
              | EditorTheme
              | undefined) ?? "dark"
          }
          onChange={
            /**
             * change操作をHostまたはWebviewへ通知する。
             * @param event - ユーザー操作またはDOMから通知されたイベント。
             * @returns 副作用を完了し、値は返さない。
             */
            (event) => {
              const theme = event.target.value as EditorTheme;
              document.documentElement.dataset.editorTheme = theme;
              document.documentElement.style.colorScheme = theme;
              sharedVsCodeApi.postMessage({ type: "setEditorTheme", theme });
            }
          }
        >
          {(definition.options?.choices ?? []).map(
            /**
             * 各choiceから値を取り出して一覧化する。
             * @param choice - choiceの値を参照する走査対象。
             * @returns 値を取り出した変換結果の一覧。
             */
            (choice) => (
              <option key={choice.value} value={choice.value}>
                {resolveLabel(choice.label)}
              </option>
            ),
          )}
        </select>
      </label>
    ),
  ),
  openPrintSettings: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "openPrintSettings" }),
  ),
  printPreview: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "togglePrintPreview" }),
  ),
  exportPdf: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "exportPdf" }),
  ),
  embedImages: htmlOption("embedImages"),
  convertLinkedMarkdown: htmlOption("convertLinkedMarkdown"),
  saveWithoutDialog: htmlOption("saveWithoutDialog"),
  exportHtml: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand, htmlOptions }) =>
      onCommand({ type: "exportHtml", options: htmlOptions }),
  ),
  preflight: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "runPreflightCheck" }),
  ),
  imageDirectory: control(
    /**
     * リボンの設定値と文言から入力コントロールを生成する。
     * @param context - 編集状態、表示文言、コマンド通知を含むリボン表示コンテキスト。
     * @param definition - ラベルと選択肢を含むリボン項目定義。
     * @param resolveLabel - ローカライズキーを表示文言へ変換する関数。
     * @returns リボンに表示する入力コントロール。
     */
    (context, definition, resolveLabel) => {
      const field = getControlField(definition, "directory");
      return (
        <>
          <form
            className="ribbon-setting-form"
            onSubmit={
              /**
               * イベントをprevent・defaultへ渡し、リボン実装の結果または副作用を処理する。
               * @param event - ユーザー操作またはDOMから通知されたイベント。
               * @returns リボン実装のコールバックが生成する結果。
               */
              (event) => {
                event.preventDefault();
                saveImageDirectory(context);
              }
            }
          >
            <label>
              <span>{resolveLabel(field.label)}</span>
              <input
                value={context.imageDirectoryDraft}
                placeholder={
                  field.placeholder
                    ? resolveLabel(field.placeholder)
                    : undefined
                }
                spellCheck={false}
                onChange={
                  /**
                   * change操作を表示または編集状態へ反映する。
                   * @param event - ユーザー操作またはDOMから通知されたイベント。
                   * @returns 副作用を完了し、値は返さない。
                   */
                  (event) => context.setImageDirectoryDraft(event.target.value)
                }
                onBlur={
                  /**
                   * 要素をsave・image・directoryへ渡し、リボン実装の結果または副作用を処理する。
                   * @returns リボン実装のコールバックが生成する結果。
                   */
                  () => saveImageDirectory(context)
                }
              />
            </label>
          </form>
          {definition.options?.hint && (
            <span className="ribbon-setting-hint">
              {resolveLabel(definition.options.hint)}
            </span>
          )}
        </>
      );
    },
  ),
  fontSettings: control(
    /**
     * リボンの設定値と文言から入力コントロールを生成する。
     * @param context - 編集状態、表示文言、コマンド通知を含むリボン表示コンテキスト。
     * @param definition - ラベルと選択肢を含むリボン項目定義。
     * @param resolveLabel - ローカライズキーを表示文言へ変換する関数。
     * @returns リボンに表示する入力コントロール。
     */
    (context, definition, resolveLabel) => {
      const editorField = getControlField(definition, "editor");
      const previewField = getControlField(definition, "preview");

      const save = /**
       * リボン実装の値を保存先または共有状態へ書き出す。
       * @returns リボン実装のsaveが生成する結果。
       */ () => saveFontFamilies(context);
      return (
        <>
          <form
            className="ribbon-setting-form"
            onSubmit={
              /**
               * イベントをprevent・defaultへ渡し、リボン実装の結果または副作用を処理する。
               * @param event - ユーザー操作またはDOMから通知されたイベント。
               * @returns リボン実装のコールバックが生成する結果。
               */
              (event) => {
                event.preventDefault();
                save();
              }
            }
          >
            <label>
              <span>{resolveLabel(editorField.label)}</span>
              <FontFamilyInput
                id="mve-editor-font-family"
                label={resolveLabel(editorField.label)}
                value={context.editorFontFamilyDraft}
                placeholder={
                  editorField.placeholder
                    ? resolveLabel(editorField.placeholder)
                    : undefined
                }
                onChange={
                  /**
                   * change操作を表示または編集状態へ反映する。
                   * @param value - ユーザー操作またはDOMから通知されたイベント。
                   * @returns 副作用を完了し、値は返さない。
                   */
                  (value) =>
                    context.setEditorFontFamilyDraft(normalizeFontFamily(value))
                }
                onCommit={
                  /**
                   * 値をsave・font・familyへ渡し、リボン実装の結果または副作用を処理する。
                   * @param value - 検証・変換・保存の対象となる値。
                   * @returns リボン実装のコールバックが生成する結果。
                   */
                  (value) => saveFontFamily(context, "editor", value)
                }
              />
            </label>
            <label>
              <span>{resolveLabel(previewField.label)}</span>
              <FontFamilyInput
                id="mve-preview-font-family"
                label={resolveLabel(previewField.label)}
                value={context.previewFontFamilyDraft}
                placeholder={
                  previewField.placeholder
                    ? resolveLabel(previewField.placeholder)
                    : undefined
                }
                onChange={
                  /**
                   * change操作を表示または編集状態へ反映する。
                   * @param value - ユーザー操作またはDOMから通知されたイベント。
                   * @returns 副作用を完了し、値は返さない。
                   */
                  (value) =>
                    context.setPreviewFontFamilyDraft(
                      normalizeFontFamily(value),
                    )
                }
                onCommit={
                  /**
                   * 値をsave・font・familyへ渡し、リボン実装の結果または副作用を処理する。
                   * @param value - 検証・変換・保存の対象となる値。
                   * @returns リボン実装のコールバックが生成する結果。
                   */
                  (value) => saveFontFamily(context, "preview", value)
                }
              />
            </label>
          </form>
          {definition.options?.hint && (
            <span className="ribbon-setting-hint">
              {resolveLabel(definition.options.hint)}
            </span>
          )}
        </>
      );
    },
  ),
  shortcuts: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "showShortcuts" }),
  ),
  features: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "showFeatures" }),
  ),
};

/**
 * リボン実装で共有するデータ形状を表すインターフェース。
 */
interface FontFamilyInputProps {
  /**
   * リボン実装で扱うidの文字列。
   */
  id: string;

  /**
   * 画面または検証結果に表示する説明文。
   */
  label: string;

  /**
   * 入力欄に値がないときに表示する案内文。
   */
  placeholder?: string;

  /**
   * 検証・変換・保存の対象となる値。
   */
  value: string;
  /**
   * リボン実装のイベントまたはメッセージを受け取り、状態を更新する。
   * @param value - 検証・変換・保存の対象となる値。
   * @returns リボン実装のon・changeが生成する結果。
   */
  onChange: (value: string) => void;
  /**
   * リボン実装のイベントまたはメッセージを受け取り、状態を更新する。
   * @param value - 検証・変換・保存の対象となる値。
   * @returns リボン実装のon・commitが生成する結果。
   */
  onCommit: (value: string) => void;
}

/**
 * リボン実装のfont・family・inputを処理し、呼び出し側へ結果または副作用を返す。
 * @param options - 呼び出し側が指定する処理設定。
 * @returns リボン実装のfont・family・inputが生成する結果。
 */
function FontFamilyInput({
  id,
  label,
  placeholder,
  value,
  onChange,
  onCommit,
}: FontFamilyInputProps): React.JSX.Element {
  const valueBeforeEditRef = useRef(value);
  return (
    <input
      id={id}
      type="text"
      aria-label={label}
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      onFocus={
        /**
         * リボン実装のコールバックとして要素を処理する。
         * @returns リボン実装のコールバックが生成する結果。
         */
        () => {
          valueBeforeEditRef.current = value;
        }
      }
      onChange={
        /**
         * change操作を表示または編集状態へ反映する。
         * @param event - ユーザー操作またはDOMから通知されたイベント。
         * @returns 副作用を完了し、値は返さない。
         */
        (event) => onChange(event.target.value)
      }
      onKeyDown={
        /**
         * keydownイベントでifを実行する。
         * @param event - ユーザー操作またはDOMから通知されたイベント。
         * @returns 副作用を完了し、値は返さない。
         */
        (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onCommit(value);
            valueBeforeEditRef.current = value;
          } else if (event.key === "Escape") {
            event.preventDefault();
            onChange(valueBeforeEditRef.current);
          }
        }
      }
      onBlur={
        /**
         * 要素をon・commitへ渡し、リボン実装の結果または副作用を処理する。
         * @returns リボン実装のコールバックが生成する結果。
         */
        () => onCommit(value)
      }
    />
  );
}

/**
 * リボン実装のribbon・header・implementationsに関する状態または設定。
 */
export const RIBBON_HEADER_IMPLEMENTATIONS: Record<
  RibbonHeaderImplementationId,
  RibbonButtonImplementation
> = {
  search: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "find" }),
  ),
  splitView: viewModeButton("both"),
  textOnly: viewModeButton("text"),
  previewOnly: viewModeButton("preview"),
  collapse: button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ collapsed, setCollapsed }) => setCollapsed(!collapsed),
  ),
};

/**
 * リボン実装のview・mode・buttonを処理し、呼び出し側へ結果または副作用を返す。
 * @param view - リボン実装へ渡す入力。
 * @returns 通知処理を完了し、値は返さない。
 */
function viewModeButton(
  view: "both" | "text" | "preview",
): RibbonButtonImplementation {
  return button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand }) => onCommand({ type: "splitView", view }),
    {
      active: /**
       * リボン実装のactiveを処理し、呼び出し側へ結果または副作用を返す。
       * @param state - 現在の編集・表示状態。
       * @returns リボン実装のactiveが生成する結果。
       */ (state) => state.mode === "split" && state.splitView === view,
    },
  );
}

/**
 * リボン実装のtable・buttonを処理し、呼び出し側へ結果または副作用を返す。
 * @param action - リボン実装へ渡す入力。
 * @returns 通知処理を完了し、値は返さない。
 */
function tableButton(
  action: Exclude<TableAction, "insert">,
): RibbonButtonImplementation {
  return button(
    /**
     * リボンボタンのクリック時に編集コマンドを通知する。
     * @param options - クリック時のコマンド通知と表示状態を受け取るコンテキスト。
     * @returns クリック処理を完了し、値は返さない。
     */
    ({ onCommand, headerName }) =>
      onCommand({
        type: "table",
        action,
        headerName:
          action === "colBefore" || action === "colAfter"
            ? headerName
            : undefined,
      }),
    { disabled: editDisabled },
  );
}

/**
 * HTML出力設定から指定した項目の現在値を取得する。
 * @param option - リボン実装へ渡す設定または境界値。
 * @returns リボン実装のhtml・optionが生成する結果。
 */
function htmlOption(
  option: "embedImages" | "convertLinkedMarkdown" | "saveWithoutDialog",
): RibbonControlImplementation {
  return control(
    /**
     * リボンの設定値と文言から入力コントロールを生成する。
     * @param context - 編集状態、表示文言、コマンド通知を含むリボン表示コンテキスト。
     * @param definition - ラベルと選択肢を含むリボン項目定義。
     * @param resolveLabel - ローカライズキーを表示文言へ変換する関数。
     * @returns リボンに表示する入力コントロール。
     */
    (context, definition, resolveLabel) => {
      return (
        <label className="ribbon-checkbox">
          <input
            type="checkbox"
            checked={context.htmlOptions[option]}
            onChange={
              /**
               * change操作を表示または編集状態へ反映する。
               * @param event - ユーザー操作またはDOMから通知されたイベント。
               * @returns 副作用を完了し、値は返さない。
               */
              (event) =>
                context.onHtmlOptionsChange({
                  ...context.htmlOptions,
                  [option]: event.target.checked,
                })
            }
          />
          <span>{resolveLabel(definition.label)}</span>
        </label>
      );
    },
  );
}

/**
 * リボン項目定義から指定した入力フィールドを取得する。
 * @param definition - リボン実装へ渡す入力。
 * @param id - リボン実装の対象や分岐を識別する値。
 * @returns リボン実装のget・control・fieldが生成する結果。
 */
function getControlField(
  definition: RibbonItemDefinition,
  id: string,
): RibbonControlFieldDefinition {
  const field = definition.options?.fields?.find(
    /**
     * 識別子が条件に一致する最初のcandidateを取得する。
     * @param candidate - candidateの識別子を参照する走査対象。
     * @returns 条件に一致した最初の要素。未検出時はundefined。
     */
    (candidate) => candidate.id === id,
  );
  if (!field) {
    throw new Error(`Ribbon control field is missing: ${id}`);
  }
  return field;
}

/**
 * リボン実装の値を保存先または共有状態へ書き出す。
 * @param context - リボン実装で扱う文字列または本文。
 * @returns 副作用を完了し、値は返さない。
 */
function saveImageDirectory(context: RibbonImplementationContext): void {
  const directory = context.imageDirectoryDraft.trim();
  if (!directory || directory === context.imageDirectory) return;
  context.onCommand({ type: "setImageDirectory", directory });
}

/**
 * リボン実装の値を保存先または共有状態へ書き出す。
 * @param context - リボン実装で扱う文字列または本文。
 * @returns 副作用を完了し、値は返さない。
 */
function saveFontFamilies(context: RibbonImplementationContext): void {
  const editorFontFamily = normalizeFontFamily(context.editorFontFamilyDraft);
  const previewFontFamily = normalizeFontFamily(context.previewFontFamilyDraft);
  saveFontFamilyValues(context, editorFontFamily, previewFontFamily);
}

/**
 * リボン実装の値を保存先または共有状態へ書き出す。
 * @param context - リボン実装で扱う文字列または本文。
 * @param field - リボン実装へ渡す入力。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns 副作用を完了し、値は返さない。
 */
function saveFontFamily(
  context: RibbonImplementationContext,
  field: "editor" | "preview",
  value: string,
): void {
  const editorFontFamily =
    field === "editor"
      ? normalizeFontFamily(value)
      : normalizeFontFamily(context.editorFontFamilyDraft);
  const previewFontFamily =
    field === "preview"
      ? normalizeFontFamily(value)
      : normalizeFontFamily(context.previewFontFamilyDraft);
  saveFontFamilyValues(context, editorFontFamily, previewFontFamily);
}

/**
 * リボン実装の値を保存先または共有状態へ書き出す。
 * @param context - リボン実装で扱う文字列または本文。
 * @param editorFontFamily - リボン実装の位置・寸法・件数・時間を表す数値。
 * @param previewFontFamily - リボン実装の位置・寸法・件数・時間を表す数値。
 * @returns 副作用を完了し、値は返さない。
 */
function saveFontFamilyValues(
  context: RibbonImplementationContext,
  editorFontFamily: string,
  previewFontFamily: string,
): void {
  if (
    editorFontFamily === context.editorFontFamily &&
    previewFontFamily === context.previewFontFamily
  )
    return;
  context.onCommand({
    type: "setFontFamilies",
    editorFontFamily,
    previewFontFamily,
  });
}

/**
 * リボン実装の寸法、容量、位置、または計測値を求める。
 * @param value - 検証・変換・保存の対象となる値。
 * @param minimum - リボン実装で扱う数値。
 * @param maximum - リボン実装の位置・寸法・件数・時間を表す数値。
 * @returns リボン実装で利用する数値。
 */
function clampNumber(value: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
    : minimum;
}

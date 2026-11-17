/**
 * @fileoverview 印刷設定パネル（用紙、方向、ヘッダー・フッター、出力用の正規表現置換、余白、文字サイズ・行間）の React コンポーネント。
 * 実行境界は Webview。設定値は親から受け取り、変更は updatePdfOptions へ「現在値から次の値を作る関数」として渡す。
 * 正規化・Host への保存（デバウンス）は親が担当し、このコンポーネントは状態を持たない。
 * 数値欄は入力途中の値を保持するため非制御（defaultValue）にし、フォーカス離脱時にだけ確定する。
 * 確定後に正規化で値が変わった場合も表示を合わせるため、key に現在値を含めて再生成する。
 */
import React, { useState } from "react";
import type { OutputPreset } from "../../shared/outputPresets";
import type { DocxExportSettings, HtmlExportOptions } from "../../shared/protocol";
import { OutputPresetManager } from "./OutputPresetManager";
import {
  PDF_PAPER_FORMATS,
  isTextReplacementPatternValid,
  type NormalizedPdfOptions,
  type EditorTheme,
  type PdfOptions,
  type TextReplacementRule,
} from "../../shared/protocol";
import type { Messages } from "../../shared/messages";
import {
  clampPdfMargin,
  renderTextWithVisibleSpaces,
  syncReplacementInputVisualizationScroll,
} from "./appHelpers";

/** 印刷設定パネルの入力。 */
interface PrintSettingsPanelProps {
  /** 表示文言。 */
  messages: Messages;
  /** 現在の正規化済みPDF設定。 */
  pdfOptions: NormalizedPdfOptions;
  language: string;
  previewFontFamily: string;
  editorTheme: EditorTheme;
  onPreviewFontFamilyChange: (value: string) => void;
  onEditorThemeChange: (value: EditorTheme) => void;
  outputPresets: readonly OutputPreset[];
  activeOutputPresetId: string;
  htmlOptions: HtmlExportOptions;
  docxOptions: DocxExportSettings;
  onHtmlOptionsChange: (options: HtmlExportOptions) => void;
  onDocxSaveWithoutDialogChange: (enabled: boolean) => void;
  onPresetApply: (id: string) => void;
  onPresetSave: (name: string, presetId?: string) => void;
  onPresetRename: (id: string, name: string) => void;
  onPresetDuplicate: (id: string) => void;
  onPresetDelete: (id: string) => void;
  onPresetImport: () => void;
  onPresetExport: () => void;
  /**
   * PDF設定を更新する。
   * @param update - 現在の設定を受け取り、次の設定を返す関数。
   */
  updatePdfOptions: (update: (current: NormalizedPdfOptions) => PdfOptions) => void;
  /** 閉じるボタンの処理。保留中の保存の確定とパネルの非表示は親が行う。 */
  onClose: () => void;
  /** PDF出力ボタンの処理。 */
  onExportPdf: () => void;
}

/** 余白欄の並びと表示文言の対応。 */
const MARGIN_SIDES = ["top", "right", "bottom", "left"] as const;

/** 見出し文字サイズ欄の並び。 */
const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

/** 数値欄1つの入力。 */
interface NumberFieldProps {
  /** 欄の見出し（単位を含む）。 */
  label: React.ReactNode;
  /** 再生成用 key の接頭辞。 */
  keyPrefix: string;
  /** 現在値。 */
  value: number;
  /** 最小値。 */
  min: number;
  /** 最大値。 */
  max: number;
  /** 刻み。未指定ならブラウザーの既定（1）。 */
  step?: number;
  /**
   * フォーカス離脱時に入力値を確定する。
   * @param value - 入力欄の文字列。
   */
  onCommit: (value: string) => void;
}

/**
 * 印刷設定の数値欄。入力途中の値を保持し、フォーカス離脱時にだけ確定する。
 * @param props - 見出し、現在値、範囲、確定処理。
 * @returns ラベル付きの数値入力欄。
 */
function NumberField({ label, keyPrefix, value, min, max, step, onCommit }: NumberFieldProps): React.JSX.Element {
  return (
    <label>
      {label}
      <input
        key={`${keyPrefix}-${value}`}
        type="number"
        min={min}
        max={max}
        step={step}
        defaultValue={value}
        onBlur={
          /**
           * 入力値を確定する。
           * @param event - 数値欄のフォーカス離脱イベント。
           */
          (event) => onCommit(event.currentTarget.value)
        }
      />
    </label>
  );
}

/**
 * 出力用の置換ルールを編集する欄。可視化した空白を入力欄の下に重ね、無効な正規表現は警告する。
 * @param props - 表示文言、ルール、位置、更新・削除処理。
 * @returns 1件分のルール編集欄。
 */
function ReplacementRuleFields({
  messages,
  rule,
  index,
  onChange,
  onRemove,
}: {
  /** 表示文言。 */
  messages: Messages;
  /** 編集するルール。 */
  rule: TextReplacementRule;
  /** ルールの0始まりの位置。エラー表示の要素IDに使う。 */
  index: number;
  /**
   * ルールの1項目を更新する。
   * @param field - 更新する項目。
   * @param value - 入力値。
   */
  onChange: (field: keyof TextReplacementRule, value: string) => void;
  /** このルールを削除する。 */
  onRemove: () => void;
}): React.JSX.Element {
  const patternInvalid = rule.pattern.length > 0 && !isTextReplacementPatternValid(rule.pattern);
  const errorId = `output-replacement-pattern-error-${index}`;
  /**
   * 文字列欄と、空白を可視化した重ね表示を描画する。
   * @param field - 編集する項目。
   * @param label - 欄の見出し。
   * @param extra - 入力欄へ追加する属性。
   * @returns ラベル付きの入力欄。
   */
  const textField = (
    field: keyof TextReplacementRule,
    label: string,
    extra: React.InputHTMLAttributes<HTMLInputElement> = {},
  ): React.JSX.Element => (
    <label>
      {label}
      <span className="output-text-replacement-input">
        <input
          type="text"
          {...extra}
          value={rule[field]}
          onChange={
            /**
             * 入力値をルールへ反映する。
             * @param event - 入力欄の変更イベント。
             */
            (event) => onChange(field, event.currentTarget.value)
          }
          onScroll={syncReplacementInputVisualizationScroll}
        />
        <span className="output-text-replacement-visualization" aria-hidden="true">
          {renderTextWithVisibleSpaces(rule[field])}
        </span>
      </span>
    </label>
  );
  return (
    <div className="output-text-replacement-rule">
      {textField("pattern", messages.app.outputReplacementPattern, {
        spellCheck: false,
        "aria-invalid": patternInvalid,
        "aria-describedby": patternInvalid ? `output-replacement-help ${errorId}` : "output-replacement-help",
      })}
      {textField("replacement", messages.app.outputReplacementText)}
      <button
        type="button"
        className="output-text-replacement-remove"
        title={messages.app.removeOutputReplacementRule}
        aria-label={messages.app.removeOutputReplacementRule}
        onClick={onRemove}
      >
        {messages.app.removeOutputReplacementRuleShort}
      </button>
      {patternInvalid && (
        <p className="output-replacement-error" id={errorId} role="alert">
          {messages.app.invalidOutputReplacementPattern}
        </p>
      )}
    </div>
  );
}

/**
 * 印刷設定パネル。
 * @param messages - 表示文言。
 * @param pdfOptions - 現在の正規化済みPDF設定。
 * @param language - 出力設定の表示言語。
 * @param previewFontFamily - プレビューと出力で共通して使うフォント。
 * @param editorTheme - HTMLとプレビューに適用するテーマ。
 * @param onPreviewFontFamilyChange - 共通フォントの変更処理。
 * @param onEditorThemeChange - テーマの変更処理。
 * @param outputPresets - 利用可能な出力プリセット。
 * @param activeOutputPresetId - 現在の設定に一致するプリセットID。
 * @param htmlOptions - HTML出力設定。
 * @param docxOptions - DOCX出力設定。
 * @param onHtmlOptionsChange - HTML出力設定の変更処理。
 * @param onDocxSaveWithoutDialogChange - DOCX保存設定の変更処理。
 * @param onPresetApply - プリセットの適用処理。
 * @param onPresetSave - 現在値の保存処理。
 * @param onPresetRename - プリセット名の変更処理。
 * @param onPresetDuplicate - プリセットの複製処理。
 * @param onPresetDelete - プリセットの削除処理。
 * @param onPresetImport - JSONプリセットの読み込み処理。
 * @param onPresetExport - JSONプリセットの書き出し処理。
 * @param updatePdfOptions - 現在の設定から次の設定を作る関数を受け取り、正規化と保存を行う処理。
 * @param onClose - 閉じるボタンの処理。
 * @param onExportPdf - PDF出力ボタンの処理。
 * @returns 印刷設定パネルの要素。
 */
export function PrintSettingsPanel({
  messages,
  pdfOptions,
  language,
  previewFontFamily,
  editorTheme,
  onPreviewFontFamilyChange,
  onEditorThemeChange,
  outputPresets,
  activeOutputPresetId,
  htmlOptions,
  docxOptions,
  onHtmlOptionsChange,
  onDocxSaveWithoutDialogChange,
  onPresetApply,
  onPresetSave,
  onPresetRename,
  onPresetDuplicate,
  onPresetDelete,
  onPresetImport,
  onPresetExport,
  updatePdfOptions,
  onClose,
  onExportPdf,
}: PrintSettingsPanelProps): React.JSX.Element {
  const [settingsTab, setSettingsTab] = useState<"pdf" | "html" | "docx">("pdf");
  /**
   * 設定の1項目だけを差し替える。
   * @param key - 差し替える項目。
   * @param value - 新しい値。
   */
  const setOption = <K extends keyof PdfOptions>(key: K, value: PdfOptions[K]): void =>
    updatePdfOptions(
      /**
       * 現在の設定の1項目を差し替える。
       * @param current - 現在の正規化済みPDF設定。
       * @returns 1項目を差し替えた設定。
       */
      (current) => ({ ...current, [key]: value }));
  /**
   * 置換ルールの一覧を置き換える。
   * @param next - 現在の一覧から次の一覧を作る関数。
   */
  const updateRules = (next: (rules: TextReplacementRule[]) => TextReplacementRule[]): void =>
    updatePdfOptions(
      /**
       * 現在の置換ルール一覧を差し替える。
       * @param current - 現在の正規化済みPDF設定。
       * @returns 置換ルールを差し替えた設定。
       */
      (current) => ({ ...current, textReplacements: next([...current.textReplacements]) }));
  const marginLabels = {
    top: messages.app.top,
    right: messages.app.right,
    bottom: messages.app.bottom,
    left: messages.app.left,
  } as const;

  return (
    <aside className="pdf-settings-panel output-presets-settings-panel">
      <div className="panel-title">
        <h2>{messages.app.printSettings}</h2>
        <button
          type="button"
          className="panel-close-button"
          title={messages.app.close}
          aria-label={messages.app.close}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="output-presets-layout">
        <OutputPresetManager
          language={language}
          presets={outputPresets}
          activePresetId={activeOutputPresetId}
          onApply={onPresetApply}
          onSave={onPresetSave}
          onRename={onPresetRename}
          onDuplicate={onPresetDuplicate}
          onDelete={onPresetDelete}
          onImport={onPresetImport}
          onExport={onPresetExport}
        />
        <div className="output-presets-settings-content">
          <div className="output-presets-tabs" role="tablist" aria-label={messages.app.printSettings}>
            <button type="button" role="tab" aria-selected={settingsTab === "pdf"}
              onClick={() => setSettingsTab("pdf")}>{language === "ja" ? "共通・PDF" : "Common / PDF"}</button>
            <button type="button" role="tab" aria-selected={settingsTab === "html"}
              onClick={() => setSettingsTab("html")}>HTML</button>
            <button type="button" role="tab" aria-selected={settingsTab === "docx"}
              onClick={() => setSettingsTab("docx")}>DOCX</button>
          </div>
          <div role="tabpanel" hidden={settingsTab !== "html"}>
            <h3>HTML</h3>
            {([
              ["embedImages", messages.ribbon.labels.embedImages],
              ["convertLinkedMarkdown", messages.ribbon.labels.convertLinkedMarkdown],
              ["showOutlineSidebar", messages.ribbon.labels.showOutlineSidebar],
              ["saveWithoutDialog", messages.ribbon.labels.saveWithoutDialog],
            ] as const).map(([key, label]) => (
              <label key={key} className="output-preset-checkbox">
                <input type="checkbox" checked={htmlOptions[key]}
                  onChange={(event) => onHtmlOptionsChange({
                    ...htmlOptions, [key]: event.currentTarget.checked,
                  })} />
                {label}
              </label>
            ))}
          </div>
          <div role="tabpanel" hidden={settingsTab !== "docx"}>
            <h3>DOCX</h3>
            <p>{language === "ja" ? "用紙・余白・フォントは共通・PDFの設定を使用します。" : "Paper, margins and typography use the Common / PDF settings."}</p>
            <label className="output-preset-checkbox">
              <input type="checkbox" checked={docxOptions.saveWithoutDialog}
                onChange={(event) => onDocxSaveWithoutDialogChange(event.currentTarget.checked)} />
              {messages.ribbon.labels.saveWithoutDialog}
            </label>
          </div>
          <div role="tabpanel" hidden={settingsTab !== "pdf"}>
      <p>{messages.app.printSettingsHelp}</p>
      <label>
        {language === "ja" ? "共通フォント" : "Shared font"}
        <select value={previewFontFamily} onChange={(event) => onPreviewFontFamilyChange(event.currentTarget.value)}>
          <option value="">{language === "ja" ? "既定のフォント" : "Default font"}</option>
          <option value="Noto Sans JP">Noto Sans JP</option>
          <option value="Yu Gothic UI">Yu Gothic UI</option>
          <option value="Meiryo">Meiryo</option>
          <option value="Arial">Arial</option>
          <option value="Georgia">Georgia</option>
          {previewFontFamily && !["Noto Sans JP", "Yu Gothic UI", "Meiryo", "Arial", "Georgia"].includes(previewFontFamily) && (
            <option value={previewFontFamily}>{previewFontFamily}</option>
          )}
        </select>
      </label>
      <label>
        {language === "ja" ? "出力・プレビューテーマ" : "Output / preview theme"}
        <select value={editorTheme} onChange={(event) => onEditorThemeChange(event.currentTarget.value as EditorTheme)}>
          <option value="light">{language === "ja" ? "ライト" : "Light"}</option>
          <option value="dark">{language === "ja" ? "ダーク" : "Dark"}</option>
        </select>
      </label>
      <label>
        {messages.app.paper}
        <select
          value={pdfOptions.format}
          onChange={
            /**
             * 選択された用紙サイズを反映する。
             * @param event - 用紙サイズの選択イベント。
             */
            (event) => setOption("format", event.target.value as PdfOptions["format"])
          }
        >
          {PDF_PAPER_FORMATS.map(
            /**
             * 用紙サイズの選択肢を作る。
             * @param format - 用紙サイズ。
             * @returns 選択肢の要素。
             */
            (format) => <option key={format}>{format}</option>)}
        </select>
      </label>
      <label>
        {messages.app.orientation}
        <select
          value={pdfOptions.orientation}
          onChange={
            /**
             * 選択されたページ方向を反映する。
             * @param event - ページ方向の選択イベント。
             */
            (event) => setOption("orientation", event.target.value as PdfOptions["orientation"])
          }
        >
          <option value="portrait">{messages.app.portrait}</option>
          <option value="landscape">{messages.app.landscape}</option>
        </select>
      </label>
      {(["header", "footer"] as const).map(
        /**
         * ヘッダー・フッターの文字列欄を作る。
         * @param field - 編集する項目。
         * @returns ラベル付きの入力欄。
         */
        (field) => (
          <label key={field}>
            {messages.app[field]}
            <input
              value={pdfOptions[field]}
              onChange={
                /**
                 * 入力された文字列を反映する。
                 * @param event - 入力欄の変更イベント。
                 */
                (event) => setOption(field, event.target.value)
              }
            />
          </label>
        ))}
      <fieldset className="output-text-replacement-fields">
        <legend>{messages.app.outputReplacementRules}</legend>
        <p className="output-replacement-help" id="output-replacement-help">
          {messages.app.outputReplacementHelp}
        </p>
        {pdfOptions.textReplacements.map(
          /**
           * 置換ルール1件の編集欄を作る。
           * @param rule - 置換ルール。
           * @param index - ルールの位置。
           * @returns 編集欄の要素。
           */
          (rule, index) => (
            <ReplacementRuleFields
              key={index}
              messages={messages}
              rule={rule}
              index={index}
              onChange={
                /**
                 * 対象ルールの1項目を更新する。存在しない位置なら何もしない。
                 * @param field - 更新する項目。
                 * @param value - 入力値。
                 */
                (field, value) => updateRules(
                  /**
                   * 対象ルールだけを差し替える。
                   * @param rules - 現在のルール一覧の複製。
                   * @returns 更新後の一覧。
                   */
                  (rules) => rules.map(
                    /**
                     * 対象位置のルールだけ項目を差し替える。
                     * @param current - ルール。
                     * @param currentIndex - ルールの位置。
                     * @returns 更新後のルール。
                     */
                    (current, currentIndex) => currentIndex === index ? { ...current, [field]: value } : current))
              }
              onRemove={
                /** 対象ルールを削除する。 */
                () => updateRules(
                  /**
                   * 対象位置以外のルールを順序を保って残す。
                   * @param rules - 現在のルール一覧の複製。
                   * @returns 削除後の一覧。
                   */
                  (rules) => rules.filter(
                    /**
                     * 対象位置以外を残す。
                     * @param _rule - ルール。
                     * @param currentIndex - ルールの位置。
                     * @returns 残すならtrue。
                     */
                    (_rule, currentIndex) => currentIndex !== index))
              }
            />
          ))}
        <button
          type="button"
          className="output-text-replacement-add"
          onClick={
            /** 空のルールを末尾へ追加する。 */
            () => updateRules(
              /**
               * 空のルールを末尾へ追加する。
               * @param rules - 現在のルール一覧の複製。
               * @returns 追加後の一覧。
               */
              (rules) => [...rules, { pattern: "", replacement: "" }])
          }
        >
          {messages.app.addOutputReplacementRule}
        </button>
      </fieldset>
      <fieldset className="pdf-margin-fields">
        <legend>{messages.app.margins}</legend>
        {MARGIN_SIDES.map(
          /**
           * 余白欄を作る。
           * @param side - 余白の位置。
           * @returns 数値欄の要素。
           */
          (side) => (
            <NumberField
              key={side}
              label={marginLabels[side]}
              keyPrefix={side}
              value={pdfOptions.margins[side]}
              min={0}
              max={50}
              onCommit={
                /**
                 * 余白を0〜50mmの整数へ丸めて確定する。
                 * @param value - 入力値。
                 */
                (value) => updatePdfOptions(
                  /**
                   * 最新の設定の余白だけを差し替える。
                   * @param current - 現在の正規化済みPDF設定。
                   * @returns 余白を差し替えた設定。
                   */
                  (current) => ({ ...current, margins: { ...current.margins, [side]: clampPdfMargin(value) } }))
              }
            />
          ))}
      </fieldset>
      <fieldset className="pdf-typography-fields">
        <legend>{messages.app.typography}</legend>
        <NumberField
          label={<>{messages.app.bodyFontSize} (pt)</>}
          keyPrefix="body"
          value={pdfOptions.bodyFontSize}
          min={6}
          max={48}
          step={0.5}
          onCommit={
            /**
             * 本文の文字サイズを確定する。範囲外の値は親の正規化で補正する。
             * @param value - 入力値。
             */
            (value) => setOption("bodyFontSize", Number(value))
          }
        />
        <fieldset className="pdf-heading-fields">
          <legend>{messages.app.headingFontSizes} (pt)</legend>
          {HEADINGS.map(
            /**
             * 見出しレベルごとの文字サイズ欄を作る。
             * @param heading - 見出しレベル。
             * @returns 数値欄の要素。
             */
            (heading) => (
              <NumberField
                key={heading}
                label={heading.toUpperCase()}
                keyPrefix={heading}
                value={pdfOptions.headingFontSizes[heading]}
                min={6}
                max={72}
                step={0.5}
                onCommit={
                  /**
                   * 見出しの文字サイズを確定する。
                   * @param value - 入力値。
                   */
                  (value) => updatePdfOptions(
                    /**
                     * 最新の設定の見出しサイズだけを差し替える。
                     * @param current - 現在の正規化済みPDF設定。
                     * @returns 見出しサイズを差し替えた設定。
                     */
                    (current) => ({
                      ...current,
                      headingFontSizes: { ...current.headingFontSizes, [heading]: Number(value) },
                    }))
                }
              />
            ))}
        </fieldset>
        <NumberField
          label={<>{messages.app.codeFontSize} (pt)</>}
          keyPrefix="code"
          value={pdfOptions.codeFontSize}
          min={6}
          max={36}
          step={0.5}
          onCommit={
            /**
             * コードの文字サイズを確定する。
             * @param value - 入力値。
             */
            (value) => setOption("codeFontSize", Number(value))
          }
        />
        <NumberField
          label={messages.app.lineHeight}
          keyPrefix="line-height"
          value={pdfOptions.lineHeight}
          min={0.8}
          max={3}
          step={0.05}
          onCommit={
            /**
             * 行間を確定する。
             * @param value - 入力値。
             */
            (value) => setOption("lineHeight", Number(value))
          }
        />
        <NumberField
          label={<>{messages.app.paragraphSpacing} (pt)</>}
          keyPrefix="paragraph-spacing"
          value={pdfOptions.paragraphSpacing}
          min={0}
          max={48}
          step={0.5}
          onCommit={
            /**
             * 段落間隔を確定する。
             * @param value - 入力値。
             */
            (value) => setOption("paragraphSpacing", Number(value))
          }
        />
      </fieldset>
      <button type="button" className="primary" onClick={onExportPdf}>
        {messages.ribbon.labels.exportPdf}
      </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

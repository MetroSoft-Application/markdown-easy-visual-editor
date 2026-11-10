/**
 * @fileoverview 印刷プレビュー画面（PDF ページ、ツールバー、読み込み・エラー状態）を表示する React コンポーネント。
 * 実行境界は Webview。PDF の生成は Host に依頼し、このコンポーネントは結果の表示と再要求だけを担当する。
 */
import type { MarkdownRenderFormat } from "../markdown/markdownRendererCore";
import type { NormalizedPdfOptions, WebviewSettings } from "../../shared/protocol";
import type { Messages } from "../../shared/messages";
import { RenderedMarkdown, type InspectorTarget } from "./RenderedMarkdown";
import React, { useEffect, useState } from "react";
import { formatPdfTemplate, pdfPageDimensions } from "./appHelpers";
import { mveDebug } from "../runtime/debug";
import { PdfDocumentPreview } from "./PdfDocumentPreview";

/**
 * PDFページ、ツールバー、読み込み・エラー状態を表示するReact要素を構築する。
 * @param markdown - PDFプレビューへ表示するMarkdown本文。
 * @param renderFormat - Markdown/Textile形式のプレビュー描画モード。
 * @param html - PDFプレビューで描画する変換済みHTML。
 * @param settings - プレビュー内のMarkdown描画へ渡すWebview設定。
 * @param options - PDFの用紙、余白、文字組版、ヘッダー、フッター設定。
 * @param zoom - PDFプレビューの表示倍率。
 * @param messages - PDFプレビューとツールバーに表示するローカライズ済み文言。
 * @param pdfBase64 - 描画するPDFデータのBase64文字列。生成前はundefined。
 * @param pdfLoading - PDFの生成または読み込み中かを示すフラグ。
 * @param pdfError - PDF生成に失敗した場合に表示するエラー文。
 * @param onInspect - PDFプレビューから選択された診断対象を親へ通知する処理。
 * @param onNavigate - PDF本文内で選択されたリンク先を親へ通知する処理。
 * @param onZoom - 表示倍率の増減値を親へ通知する処理。
 * @param onRendered - PDFキャンバスの描画完了を親へ通知する処理。
 * @returns PDFページ、操作ツールバー、読み込み・エラー表示を含むプレビュー要素。
 */
export function PdfPreview({
  markdown,
  renderFormat,
  html,
  settings,
  options,
  zoom,
  messages,
  pdfBase64,
  pdfLoading,
  pdfError,
  onInspect,
  onNavigate,
  onZoom,
  onRendered,
}: {
  /**
   * 解析・編集・変換の対象となるMarkdown本文。
   */
  markdown: string;

  /** PDFライブ表示がHTML未確定時に使う文書形式。 */
  renderFormat: MarkdownRenderFormat;

  /**
   * 表示または出力するHTML本文。
   */
  html: string;

  /** PDFプレビュー内のMarkdown描画へ渡すWebview設定。 */
  settings: WebviewSettings;

  /** PDF本文・用紙・余白・文字組版・ヘッダー/フッターを正規化した設定。 */
  options: NormalizedPdfOptions;

  /**
   * プレビューに適用する表示倍率。
   */
  zoom: number;

  /**
   * Webview用の型付きローカライズ済みメッセージカタログ。
   */
  messages: Messages;

  /**
   * PDF.jsへ渡すBase64形式の文書データ。
   */
  pdfBase64?: string;

  /**
   * PDF文書の読み込み中かどうか。
   */
  pdfLoading: boolean;

  /**
   * PDF文書の読み込みに失敗した場合に表示する理由。
   */
  pdfError?: string;
  /** Inspectorを開く対象を親へ通知する。
   * @param target - Inspectorで開く数式・画像などの対象。
   */
  onInspect: (target: InspectorTarget) => void;
  /** プレビューで選択したリンク先を親へ通知し、必要ならワークスペース基準で開く。
   * @param href - プレビュー内で開くリンクのhref文字列。
   */
  onNavigate: (href: string, workspaceRooted?: boolean) => void;
  /** PDFページの表示倍率変更量を親へ通知する。
   * @param delta - ズーム倍率の変更量。正数は拡大、負数は縮小。
   */
  onZoom: (delta: number) => void;
  /** PDF.jsの初回ページ描画完了を親へ通知する。 */
  onRendered: () => void;
}): React.JSX.Element {
  const [pdfCanvasReady, setPdfCanvasReady] = useState(false);
  const dimensions = pdfPageDimensions(options);
  const showPdfLayer = Boolean(pdfBase64 && pdfCanvasReady);

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     */
    () => {
      setPdfCanvasReady(false);
    },
    [pdfBase64, zoom],
  );

  return (
    <div
      className={`pdf-preview-shell ${pdfBase64 ? "pdf-preview-shell-ready" : ""}`}
      data-pdf-format={options.format}
      data-pdf-orientation={options.orientation}
      data-pdf-zoom={zoom}
    >
      <div
        className="pdf-preview-toolbar"
        role="toolbar"
        aria-label={messages.app.status.zoom(Math.round(zoom * 100))}
      >
        <button
          type="button"
          aria-label={messages.app.pdfPreview.zoomOut}
          onClick={
            /**
             * PDFプレビューの倍率を0.1段階下げる。
             */
            () => {
              mveDebug("pdf.zoom-button", { delta: -0.1, zoom });
              onZoom(-0.1);
            }
          }
        >
          −
        </button>
        <span className="pdf-preview-zoom-value">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          aria-label={messages.app.pdfPreview.zoomIn}
          onClick={
            /**
             * PDFプレビューの倍率を0.1段階上げる。
             */
            () => {
              mveDebug("pdf.zoom-button", { delta: 0.1, zoom });
              onZoom(0.1);
            }
          }
        >
          ＋
        </button>
      </div>
      {!showPdfLayer && (
        <p className="pdf-preview-status" aria-live="polite">
          {pdfError
            ? messages.app.pdfPreview.unavailable
            : pdfLoading
              ? messages.app.pdfPreview.generating
              : pdfBase64
                ? messages.app.pdfPreview.drawing
                : messages.app.pdfPreview.preparing}
        </p>
      )}
      {!showPdfLayer && (
        <div className="pdf-preview-live-layer">
          <div
            className="pdf-preview-live-content"
            style={
              {
                zoom,
                fontFamily: options.fontFamily,
                fontSize: `${options.bodyFontSize}pt`,
                lineHeight: options.lineHeight,
                "--mve-pdf-h1-size": `${options.headingFontSizes.h1}pt`,
                "--mve-pdf-h2-size": `${options.headingFontSizes.h2}pt`,
                "--mve-pdf-h3-size": `${options.headingFontSizes.h3}pt`,
                "--mve-pdf-h4-size": `${options.headingFontSizes.h4}pt`,
                "--mve-pdf-h5-size": `${options.headingFontSizes.h5}pt`,
                "--mve-pdf-h6-size": `${options.headingFontSizes.h6}pt`,
                "--mve-pdf-code-size": `${options.codeFontSize}pt`,
                "--mve-pdf-paragraph-spacing": `${options.paragraphSpacing}pt`,
              } as React.CSSProperties
            }
          >
            {options.header && (
              <div className="pdf-preview-header">
                {formatPdfTemplate(options.header)}
              </div>
            )}
            <RenderedMarkdown
              markdown={markdown}
              renderFormat={renderFormat}
              html={html}
              settings={settings}
              className="pdf-preview-content"
              onInspect={onInspect}
              onNavigate={onNavigate}
              onRendered={() => onRendered()}
              deferMermaid
            />
            {options.footer && (
              <div className="pdf-preview-footer">
                {formatPdfTemplate(options.footer)}
              </div>
            )}
          </div>
        </div>
      )}
      {pdfBase64 && (
        <div
          className={`pdf-preview-pdf-layer ${showPdfLayer ? "" : "is-preparing"}`}
        >
          <PdfDocumentPreview
            data={pdfBase64}
            messages={messages.app.pdfPreview}
            pageRatio={dimensions.width / dimensions.height}
            zoom={zoom}
            onRendered={() => {
              mveDebug("pdf.preview-layer-ready", {
                zoom,
                format: options.format,
                orientation: options.orientation,
              });
              setPdfCanvasReady(true);
              onRendered();
            }}
          />
        </div>
      )}
      {pdfError && <p className="pdf-preview-error">{pdfError}</p>}
      <p className="pdf-preview-note">
        {options.format} ·{" "}
        {options.orientation === "portrait"
          ? messages.app.portrait
          : messages.app.landscape}{" "}
        / {messages.app.margins} {messages.app.top}
        {options.margins.top} · {messages.app.right}
        {options.margins.right} · {messages.app.bottom}
        {options.margins.bottom} · {messages.app.left}
        {options.margins.left} mm
      </p>
    </div>
  );
}

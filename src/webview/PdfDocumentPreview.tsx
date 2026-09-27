/**
 * @fileoverview PDF出力前の文書プレビューを表示し、用紙・余白・フォント設定を印刷レイアウトへ反映する。
 */
import React, { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { Messages } from "../shared/messages";

/**
 * PDFプレビューで扱う値の種類と境界を表す型。
 */
type PdfJsModule = typeof import("pdfjs-dist");

/**
 * PDFプレビューで共有するデータ形状を表すインターフェース。
 */
interface Props {
  /**
   * PDFプレビューで扱うdataの文字列。
   */
  data: string;

  /**
   * PDFプレビューで使うローカライズ済み文言。
   */
  messages: Messages["app"]["pdfPreview"];

  /**
   * PDFプレビューのpage・ratioを表す数値。
   */
  pageRatio: number;

  /**
   * プレビューに適用する表示倍率。
   */
  zoom?: number;
  /**
   * PDFプレビューのイベントまたはメッセージを受け取り、状態を更新する。
   * @returns PDFプレビューの非同期処理で得られる結果。
   */
  onRendered?: () => void;
}

/**
 * PDFプレビューの非同期処理を共有するPromise。
 */
let pdfJsPromise: Promise<PdfJsModule> | undefined;

/**
 * PDFプレビューで識別するスクリプトURI欠落エラー。
 */
const PDF_PREVIEW_SCRIPT_MISSING = "PDF_PREVIEW_SCRIPT_MISSING";

/**
 * PDFプレビューから必要な値またはリソースを取得する。
 * @returns PDFプレビューの非同期処理で得られる結果。
 */
function loadPdfJs(): Promise<PdfJsModule> {
  if (pdfJsPromise) return pdfJsPromise;
  const script = document.querySelector<HTMLScriptElement>(
    'script[src*="webview.js"]',
  );
  if (!script?.src)
    return Promise.reject(new Error(PDF_PREVIEW_SCRIPT_MISSING));
  const moduleUrl = new URL("pdfjs.mjs", script.src).toString();
  pdfJsPromise = import(/* @vite-ignore */ moduleUrl);
  return pdfJsPromise;
}

/**
 * PDFプレビューの入力を構造化した値へ変換する。
 * @param value - PDF.jsへ渡すBase64形式のPDFバイト列。
 * @returns PDFプレビューに対応する要素の一覧。
 */
function decodeBase64(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * PDF出力用の文書プレビューを表示するコンポーネント。
 * @param data - PDF.jsへ渡すBase64形式のPDFデータ。
 * @param messages - PDFプレビューで表示するローカライズ済み文言。
 * @param pageRatio - ページ幅に対する高さの比率。
 * @param zoom - 表示するページの倍率。省略時は1。
 * @param onRendered - 最初のページ描画が完了したときに呼び出す通知。
 * @returns PDFページと描画状態を表示するReact要素。
 */
export function PdfDocumentPreview({
  data,
  messages,
  pageRatio,
  zoom = 1,
  onRendered,
}: Props): React.JSX.Element {
  const [documentState, setDocumentState] = useState<PDFDocumentProxy>();
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string>();
  const firstPageRenderedRef = useRef(false);
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns PDFプレビューのコールバックが生成する結果。
     */
    () => {
      firstPageRenderedRef.current = false;
    },
    [zoom],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns PDFプレビューのコールバックが生成する結果。
     */
    () => {
      let cancelled = false;
      let loadingTask: ReturnType<PdfJsModule["getDocument"]> | undefined;
      setDocumentState(undefined);
      setPageCount(0);
      setError(undefined);
      firstPageRenderedRef.current = false;

      void loadPdfJs()
        .then(
          /**
           * pdfjsをifへ渡し、PDFプレビューの結果または副作用を処理する。
           * @param pdfjs - getDocumentとGlobalWorkerOptionsを提供するPDF.jsモジュール。
           * @returns PDFプレビューのコールバックが生成する結果。
           */
          (pdfjs) => {
            if (cancelled) return;
            const script = document.querySelector<HTMLScriptElement>(
              'script[src*="webview.js"]',
            );
            if (script?.src)
              pdfjs.GlobalWorkerOptions.workerSrc = new URL(
                "pdf.worker.min.mjs",
                script.src,
              ).toString();
            loadingTask = pdfjs.getDocument({ data: decodeBase64(data) });
            return loadingTask.promise.then(
              /**
               * pdfをifへ渡し、PDFプレビューの結果または副作用を処理する。
               * @param pdf - ページ取得と破棄に使う読み込み済みPDF文書。
               * @returns PDFプレビューのコールバックが生成する結果。
               */
              (pdf) => {
                if (cancelled) {
                  void pdf.cleanup();
                  return;
                }
                setDocumentState(pdf);
                setPageCount(pdf.numPages);
              },
            );
          },
        )
        .catch(
          /**
           * reasonをifへ渡し、PDFプレビューの結果または副作用を処理する。
           * @param reason - 処理を中断または失敗させた理由。
           * @returns PDFプレビューのコールバックが生成する結果。
           */
          (reason: unknown) => {
            if (cancelled) return;
            const detail =
              reason instanceof Error ? reason.message : String(reason);
            setError(detail);
          },
        );

      /**
       * PDFプレビューのreturnを処理し、呼び出し側へ結果または副作用を返す。
       * @returns PDFプレビューのreturnが生成する結果。
       */
      return () => {
        cancelled = true;
        void loadingTask?.destroy();
        setDocumentState(
          /**
           * previousをifへ渡し、PDFプレビューの結果または副作用を処理する。
           * @param previous - effect再実行時に破棄する前回のPDF文書。初回は未定義。
           * @returns PDFプレビューのコールバックが生成する結果。
           */
          (previous) => {
            if (previous) void previous.cleanup();
            return undefined;
          },
        );
      };
    },
    [data],
  );

  if (error)
    return (
      <p className="pdf-preview-error">
        {messages.failed(
          error === PDF_PREVIEW_SCRIPT_MISSING
            ? messages.webviewUnavailable
            : error,
        )}
      </p>
    );
  if (!documentState)
    return <p className="pdf-preview-loading">{messages.loading}</p>;

  return (
    <div className="pdf-pages" data-page-count={pageCount}>
      {Array.from(
        { length: pageCount },
        /**
         * ・をifへ渡し、PDFプレビューの結果または副作用を処理する。
         * @param _ - 引数位置を維持するための未使用値。
         * @param index - 配列・行列・文字列の要素位置を示す番号。
         * @returns PDFプレビューのコールバックが生成する結果。
         */
        (_, index) => (
          <PdfPage
            key={`${data.length}-${index + 1}-${zoom}`}
            document={documentState}
            messages={messages}
            pageNumber={index + 1}
            pageRatio={pageRatio}
            zoom={zoom}
            onRendered={
              /**
               * 要素をifへ渡し、PDFプレビューの結果または副作用を処理する。
               * @returns PDFプレビューのコールバックが生成する結果。
               */
              () => {
                if (firstPageRenderedRef.current) return;
                firstPageRenderedRef.current = true;
                onRenderedRef.current?.();
              }
            }
          />
        ),
      )}
    </div>
  );
}

/**
 * PDFの1ページをCanvasへ描画し、待機・描画・完了状態を表示する。
 * @param document - 表示するPDFを保持するPDF.jsのドキュメント。
 * @param messages - ページの読み込み・描画状態に表示するローカライズ済み文言。
 * @param pageNumber - PDF内で表示する1始まりのページ番号。
 * @param pageRatio - ページ幅に対する高さの比率。
 * @param zoom - ページに適用する表示倍率。
 * @param onRendered - ページ描画が成功したときに呼び出す通知。
 * @returns PDFページのCanvasと状態を含むReact要素。
 */
function PdfPage({
  document,
  messages,
  pageNumber,
  pageRatio,
  zoom,
  onRendered,
}: {
  /**
   * PDFプレビューのdocumentに関する状態または設定。
   */
  document: PDFDocumentProxy;

  /**
   * PDFプレビューで使うローカライズ済み文言。
   */
  messages: Messages["app"]["pdfPreview"];

  /**
   * PDFプレビューのpage・numberを表す数値。
   */
  pageNumber: number;

  /**
   * PDFプレビューのpage・ratioを表す数値。
   */
  pageRatio: number;

  /**
   * プレビューに適用する表示倍率。
   */
  zoom: number;
  /**
   * PDFプレビューのイベントまたはメッセージを受け取り、状態を更新する。
   * @returns PDFプレビューのon・renderedが生成する結果。
   */
  onRendered: () => void;
}): React.JSX.Element {
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<
    "waiting" | "rendering" | "ready" | "error"
  >("waiting");
  const renderTaskRef = useRef<ReturnType<PDFPageProxy["render"]> | undefined>(
    undefined,
  );
  const statusRef = useRef(status);
  const onRenderedRef = useRef(onRendered);
  statusRef.current = status;
  onRenderedRef.current = onRendered;

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns PDFプレビューのコールバックが生成する結果。
     */
    () => {
      const container = pageRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;
      let cancelled = false;
      let observer: IntersectionObserver | undefined;

      const render = /**
       * PDFプレビューを表示用の結果へ変換する。
       * @returns PDFプレビューで生成または変換した値。
       */ async () => {
        if (
          cancelled ||
          statusRef.current === "ready" ||
          statusRef.current === "rendering"
        )
          return;
        setStatus("rendering");
        try {
          const page = await document.getPage(pageNumber);
          if (cancelled) return;
          const baseViewport = page.getViewport({ scale: 1 });
          const cssWidth = container.clientWidth || 794;
          const viewport = page.getViewport({
            scale: cssWidth / baseViewport.width,
          });
          const outputScale = Math.min(2, window.devicePixelRatio || 1);
          canvas.width = Math.ceil(viewport.width * outputScale);
          canvas.height = Math.ceil(viewport.height * outputScale);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          renderTaskRef.current = page.render({
            canvas,
            canvasContext: canvas.getContext("2d")!,
            viewport,
            transform:
              outputScale === 1
                ? undefined
                : [outputScale, 0, 0, outputScale, 0, 0],
          });
          await renderTaskRef.current.promise;
          if (cancelled) return;
          setStatus("ready");
          onRenderedRef.current();
        } catch (reason) {
          if (cancelled) return;
          setStatus("error");
          console.warn(
            "[Markdown Easy Visual Editor] PDF page rendering failed.",
            reason,
          );
        }
      };

      observer = new IntersectionObserver(
        /**
         * entriesをifへ渡し、PDFプレビューの結果または副作用を処理する。
         * @param entries - PDF表示領域との交差状態を報告するobserver entry一覧。
         * @returns PDFプレビューのコールバックが生成する結果。
         */
        (entries) => {
          if (
            !entries.some(
              /**
               * PDFプレビューのコールバックとしてエントリを処理する。
               * @param entry - PDFプレビューで走査または更新する要素。
               * @returns PDFプレビューのコールバックが生成する結果。
               */
              (entry) => entry.isIntersecting,
            )
          )
            return;
          observer?.disconnect();
          void render();
        },
        { rootMargin: "1000px 0px" },
      );
      observer.observe(container);

      /**
       * PDFプレビューのreturnを処理し、呼び出し側へ結果または副作用を返す。
       * @returns PDFプレビューのreturnが生成する結果。
       */
      return () => {
        cancelled = true;
        observer?.disconnect();
        renderTaskRef.current?.cancel();
      };
    },
    [document, pageNumber],
  );

  return (
    <div
      ref={pageRef}
      className={`pdf-page pdf-page-${status}`}
      data-page-number={pageNumber}
      style={{
        aspectRatio: String(pageRatio),
        width: `${794 * zoom}px`,
      }}
    >
      <canvas ref={canvasRef} aria-label={messages.pageLabel(pageNumber)} />
      {status === "error" && (
        <span className="pdf-page-error">{messages.pageError}</span>
      )}
    </div>
  );
}

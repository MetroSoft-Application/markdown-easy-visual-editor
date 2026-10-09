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
 * PDFプレビューに渡す文書URIと表示状態です。
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
    * ページ幅に対するページ高の比率。Canvasと用紙レイアウトの寸法を合わせる。
   */
  pageRatio: number;

  /**
   * プレビューに適用する表示倍率。
   */
  zoom?: number;
  /**
    * 最初のPDFページが描画できた時点で親へ完了を通知する。
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
 * Webview内のVite script URLを基準にPDF.js moduleを遅延読込し、Promiseを共有する。
 * @returns 読み込んだPDF.js module。script URLがなければ識別可能なErrorで拒否する。
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
 * Base64形式のPDF本文をPDF.jsへ渡せるバイト配列に変換する。
 * @param value - PDF.jsへ渡すBase64形式のPDFバイト列。
 * @returns Base64をデコードしたPDFバイト配列。
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
      * 倍率変更後に新しい最初のページ描画を完了通知できるようフラグを戻す。
     */
    () => {
      firstPageRenderedRef.current = false;
    },
    [zoom],
  );

  useEffect(
    /**
      * Base64文書を読み込み、data変更後の旧タスクをキャンセルしながら文書状態を更新する。
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
            * PDF.js worker URLを設定し、未破棄なら読み込みタスクを開始する。
             * @param pdfjs - getDocumentとGlobalWorkerOptionsを提供するPDF.jsモジュール。
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
               * 読込中にeffectが破棄されていない場合だけPDF文書とページ数をstateへ保存する。
               * @param pdf - ページ取得と破棄に使う読み込み済みPDF文書。
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
            * 現在のeffectで起きた読込失敗だけをエラーstateへ反映する。
            * @param reason - 処理を中断または失敗させた理由。
           */
          (reason: unknown) => {
            if (cancelled) return;
            const detail =
              reason instanceof Error ? reason.message : String(reason);
            setError(detail);
          },
        );

      // 古い読込結果を無視し、PDF.jsの非同期処理と確定済み文書を解放する。
      return () => {
        cancelled = true;
        void loadingTask?.destroy();
        setDocumentState(
            /**
             * effect破棄時に表示中の文書を解放してstateから外す。
             * @param previous - effect再実行時に破棄する前回のPDF文書。初回は未定義。
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
        // ページごとに独立した遅延描画コンポーネントを作る。
        (_, index) => (
          <PdfPage
            key={`${data.length}-${index + 1}-${zoom}`}
            document={documentState}
            messages={messages}
            pageNumber={index + 1}
            pageRatio={pageRatio}
            zoom={zoom}
            onRendered={
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
    * ページ取得とページ数の上限値を提供する読み込み済みPDF文書。
   */
  document: PDFDocumentProxy;

  /**
   * PDFプレビューで使うローカライズ済み文言。
   */
  messages: Messages["app"]["pdfPreview"];

  /**
    * PDF内で表示する1始まりのページ番号。
   */
  pageNumber: number;

  /**
    * ページ幅に対するページ高の比率。
   */
  pageRatio: number;

  /**
   * プレビューに適用する表示倍率。
   */
  zoom: number;
  /**
    * このページのCanvas描画が成功したことを親へ通知する。
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
      * ページが表示範囲へ近づいた時だけCanvasへ描画し、effect破棄時には描画を中断する。
     */
    () => {
      const container = pageRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;
      let cancelled = false;
      let observer: IntersectionObserver | undefined;

      const render = /**
       * PDF.jsで未描画ページをCanvasへ描画し、表示状態を更新する。
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
        /** 可視範囲に入ったページだけを一度描画し、以降の交差監視を止める。
         * @param entries - PDF表示領域との交差状態を報告するobserver entry一覧。
         */
        (entries) => {
          if (
            !entries.some(
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

      // 画面から外れたページの監視と実行中Canvas描画を停止する。
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

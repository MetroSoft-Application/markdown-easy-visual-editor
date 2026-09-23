/**
 * @file PdfDocumentPreview.tsx
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import React, { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

/**
 * 「PdfJsModule」として扱う値の型を定義します。
 */
type PdfJsModule = typeof import("pdfjs-dist");

/**
 * 「Props」が満たすデータ契約を定義します。
 */
interface Props {

  /**
   * 「data」は、解析・編集・変換の対象となる本文またはデータを保持します。
   */
  data: string;

  /**
   * 「pageRatio」は、表示領域のサイズまたは倍率を保持します。
   */
  pageRatio: number;

  /**
   * 「zoom」は、表示領域のサイズまたは倍率を保持します。
   */
  zoom?: number;
  /**
   * 呼び出し側が入力を渡し、宣言された戻り値型で結果を受け取る契約です。
   * @returns 状態更新または副作用を実行し、値は返しません。
   */
  onRendered?: () => void;
}

/** 「pdfJsPromise」は、非同期初期化または処理の重複を防ぐ共有Promiseです。 */
let pdfJsPromise: Promise<PdfJsModule> | undefined;

/**
 * 印刷プレビューを開いたときだけPDF.js本体をロードし、初期Webviewを軽く保つ。
 * @returns 非同期処理の完了を表すPromiseです。
 */
function loadPdfJs(): Promise<PdfJsModule> {
  if (pdfJsPromise) return pdfJsPromise;
  const script = document.querySelector<HTMLScriptElement>(
    'script[src*="webview.js"]',
  );
  if (!script?.src)
    return Promise.reject(new Error("Webview script URI was not found."));
  const moduleUrl = new URL("pdfjs.mjs", script.src).toString();
  pdfJsPromise = import(/* @vite-ignore */ moduleUrl);
  return pdfJsPromise;
}

/**
 * decode・base64を解析または復元します。
 * @param value 「decodeBase64」で検証・変換する入力値です。
 * @returns 「decodeBase64」がWebview UI状態の入力を処理して得た固有の結果を返します。
 */
function decodeBase64(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * 生成済みPDFをページ単位で表示する。
 * ページはIntersectionObserverで遅延描画し、大規模文書の初回表示を軽くする。
 * @param props 「props」は、「PdfDocumentPreview」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「PdfDocumentPreview」がWebview UI状態の入力を処理して得た固有の結果を返します。
 */
export function PdfDocumentPreview({
  data,
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
 * Reactの初期状態またはメモ化値を遅延計算するコールバックです。
   * @returns Reactが保持する初期状態またはメモ化値を返します。
   */
  () => {
    firstPageRenderedRef.current = false;
  }, [zoom]);

  useEffect(
  /**
 * Reactの初期状態またはメモ化値を遅延計算するコールバックです。
   * @returns Reactが保持する初期状態またはメモ化値を返します。
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
 * 非同期処理の完了値を受け取り、次の処理へ渡す結果を生成するコールバックです。
       * @param pdfjs pdfjsとして渡される、このコールバックの入力値です。
       * @returns 解決値を処理した結果を返します。
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
 * 非同期処理の完了値を受け取り、次の処理へ渡す結果を生成するコールバックです。
         * @param pdf pdfとして渡される、このコールバックの入力値です。
         * @returns 解決値を処理した結果を返します。
         */
        (pdf) => {
          if (cancelled) {
            void pdf.cleanup();
            return;
          }
          setDocumentState(pdf);
          setPageCount(pdf.numPages);
        });
      })
      .catch(
      /**
 * 非同期処理の完了値を受け取り、次の処理へ渡す結果を生成するコールバックです。
       * @param reason 失敗した処理の原因または例外情報です。
       * @returns エラー処理またはフォールバックの結果を返します。
       */
      (reason: unknown) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : String(reason));
      });

    return /** 「cancelled」として処理を終了し、保持していたリソースまたは状態を整理します。 @returns 後片付けまたは登録解除を完了した結果を返します。 */ () => {
      cancelled = true;
      void loadingTask?.destroy();
      setDocumentState(
      /**
 * 非同期処理の失敗理由を受け取り、回復処理または代替値を生成するコールバックです。
       * @param previous previousとして渡される、このコールバックの入力値です。
       * @returns 「previous」から生成した処理結果を返します。
       */
      (previous) => {
        if (previous) void previous.cleanup();
        return undefined;
      });
    };
  }, [data]);

  if (error)
    return (
      <p className="pdf-preview-error">
        PDFプレビューを描画できませんでした: {error}
      </p>
    );
  if (!documentState)
    return <p className="pdf-preview-loading">PDFを生成しています…</p>;

  return (
    <div className="pdf-pages" data-page-count={pageCount}>
      {Array.from({ length: pageCount },
      /**
 * 「_」「index」を受け取り、処理結果を生成する処理です。
       * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
       * @param index 本文、表、配列内の対象位置を示すインデックスです。
       * @returns 「_」「index」から生成した処理結果を返します。
       */
      (_, index) => (
        <PdfPage
          key={`${data.length}-${index + 1}-${zoom}`}
          document={documentState}
          pageNumber={index + 1}
          pageRatio={pageRatio}
          zoom={zoom}
          onRendered={
          /**
 * 処理結果を生成する処理を実行するコールバックです。
           * @returns 「if」を実行し、値を返しません。
           */
          () => {
            if (firstPageRenderedRef.current) return;
            firstPageRenderedRef.current = true;
            onRenderedRef.current?.();
          }}
        />
      ))}
    </div>
  );
}

/**
 * 「PdfPage」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param props 「props」は、「PdfPage」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「PdfPage」がWebview UI状態の入力を処理して得た固有の結果を返します。
 */
function PdfPage({
  document,
  pageNumber,
  pageRatio,
  zoom,
  onRendered,
}: {

  /**
   * 「document」は、読み込みまたは出力する文書リソースを示します。
   */
  document: PDFDocumentProxy;

  /**
   * 「pageNumber」は、位置・サイズ・件数などを表す数値です。
   */
  pageNumber: number;

  /**
   * 「pageRatio」は、表示領域のサイズまたは倍率を保持します。
   */
  pageRatio: number;

  /**
   * 「zoom」は、表示領域のサイズまたは倍率を保持します。
   */
  zoom: number;
  /**
   * 「onRendered」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @returns イベントを処理し、状態更新または副作用だけを実行して値は返しません。
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
 * Reactの初期状態またはメモ化値を遅延計算するコールバックです。
   * @returns Reactが保持する初期状態またはメモ化値を返します。
   */
  () => {
    const container = pageRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    let cancelled = false;
    let observer: IntersectionObserver | undefined;


    /**
     * renderを描画します。
     * @returns 「render」が生成したWebview UI状態のデータを返します。
     */
    const render = /**
 * 「render」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @returns 「render」が生成したWebview UI状態のデータを返します。
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
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
       * @param entries 処理対象となる複数要素の集合です。
       * @returns 「entries」から生成した処理結果を返します。
       */
      (entries) => {
        if (!entries.some(
        /**
 * 「entry」が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
         * @param entry entryとして渡される、このコールバックの入力値です。
         * @returns 条件判定の結果を示す真偽値を返します。
         */
        (entry) => entry.isIntersecting)) return;
        observer?.disconnect();
        void render();
      },
      { rootMargin: "1000px 0px" },
    );
    observer.observe(container);

    return /** 「cancelled」として処理を終了し、保持していたリソースまたは状態を整理します。 @returns 後片付けまたは登録解除を完了した結果を返します。 */ () => {
      cancelled = true;
      observer?.disconnect();
      renderTaskRef.current?.cancel();
    };
  }, [document, pageNumber]);

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
      <canvas ref={canvasRef} aria-label={`PDF ${pageNumber}ページ`} />
      {status === "error" && (
        <span className="pdf-page-error">ページを描画できません</span>
      )}
    </div>
  );
}

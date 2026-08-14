import React, { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

type PdfJsModule = typeof import('pdfjs-dist');

interface Props {
  data: string;
  pageRatio: number;
  zoom?: number;
  onRendered?: () => void;
}

let pdfJsPromise: Promise<PdfJsModule> | undefined;

/** 印刷プレビューを開いたときだけPDF.js本体をロードし、初期Webviewを軽く保つ。 */
function loadPdfJs(): Promise<PdfJsModule> {
  if (pdfJsPromise) return pdfJsPromise;
  const script = document.querySelector<HTMLScriptElement>('script[src*="webview.js"]');
  if (!script?.src) return Promise.reject(new Error('Webview script URI was not found.'));
  const moduleUrl = new URL('pdfjs.mjs', script.src).toString();
  pdfJsPromise = import(/* @vite-ignore */ moduleUrl);
  return pdfJsPromise;
}

function decodeBase64(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * 生成済みPDFをページ単位で表示する。
 * ページはIntersectionObserverで遅延描画し、大規模文書の初回表示を軽くする。
 */
export function PdfDocumentPreview({ data, pageRatio, zoom = 1, onRendered }: Props): React.JSX.Element {
  const [documentState, setDocumentState] = useState<PDFDocumentProxy>();
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string>();
  const firstPageRenderedRef = useRef(false);
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;

  useEffect(() => {
    firstPageRenderedRef.current = false;
  }, [zoom]);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<PdfJsModule['getDocument']> | undefined;
    setDocumentState(undefined);
    setPageCount(0);
    setError(undefined);
    firstPageRenderedRef.current = false;

    void loadPdfJs().then((pdfjs) => {
      if (cancelled) return;
      const script = document.querySelector<HTMLScriptElement>('script[src*="webview.js"]');
      if (script?.src) pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', script.src).toString();
      loadingTask = pdfjs.getDocument({ data: decodeBase64(data) });
      return loadingTask.promise.then((pdf) => {
        if (cancelled) {
          void pdf.cleanup();
          return;
        }
        setDocumentState(pdf);
        setPageCount(pdf.numPages);
      });
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    });

    return () => {
      cancelled = true;
      void loadingTask?.destroy();
      setDocumentState((previous) => {
        if (previous) void previous.cleanup();
        return undefined;
      });
    };
  }, [data]);

  if (error) return <p className="pdf-preview-error">PDFプレビューを描画できませんでした: {error}</p>;
  if (!documentState) return <p className="pdf-preview-loading">PDFを生成しています…</p>;

  return (
    <div className="pdf-pages" data-page-count={pageCount}>
      {Array.from({ length: pageCount }, (_, index) => (
        <PdfPage
          key={`${data.length}-${index + 1}-${zoom}`}
          document={documentState}
          pageNumber={index + 1}
          pageRatio={pageRatio}
          zoom={zoom}
          onRendered={() => {
            if (firstPageRenderedRef.current) return;
            firstPageRenderedRef.current = true;
            onRenderedRef.current?.();
          }}
        />
      ))}
    </div>
  );
}

function PdfPage({
  document,
  pageNumber,
  pageRatio,
  zoom,
  onRendered
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
  pageRatio: number;
  zoom: number;
  onRendered: () => void;
}): React.JSX.Element {
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'waiting' | 'rendering' | 'ready' | 'error'>('waiting');
  const renderTaskRef = useRef<ReturnType<PDFPageProxy['render']> | undefined>(undefined);
  const statusRef = useRef(status);
  const onRenderedRef = useRef(onRendered);
  statusRef.current = status;
  onRenderedRef.current = onRendered;

  useEffect(() => {
    const container = pageRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    let cancelled = false;
    let observer: IntersectionObserver | undefined;

    const render = async () => {
      if (cancelled || statusRef.current === 'ready' || statusRef.current === 'rendering') return;
      setStatus('rendering');
      try {
        const page = await document.getPage(pageNumber);
        if (cancelled) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const cssWidth = container.clientWidth || 794;
        const viewport = page.getViewport({ scale: cssWidth / baseViewport.width });
        const outputScale = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.ceil(viewport.width * outputScale);
        canvas.height = Math.ceil(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        renderTaskRef.current = page.render({
          canvas,
          canvasContext: canvas.getContext('2d')!,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0]
        });
        await renderTaskRef.current.promise;
        if (cancelled) return;
        setStatus('ready');
        onRenderedRef.current();
      } catch (reason) {
        if (cancelled) return;
        setStatus('error');
        console.warn('[Markdown Easy Visual Editor] PDF page rendering failed.', reason);
      }
    };

    observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer?.disconnect();
      void render();
    }, { rootMargin: '1000px 0px' });
    observer.observe(container);

    return () => {
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
        width: `${794 * zoom}px`
      }}
    >
      <canvas ref={canvasRef} aria-label={`PDF ${pageNumber}ページ`} />
      {status === 'error' && <span className="pdf-page-error">ページを描画できません</span>}
    </div>
  );
}

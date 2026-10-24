/**
 * @fileoverview Marp Workerの遅延起動と隔離iframeのスライドプレビューを管理する。
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { WebviewSettings } from "../../shared/protocol";
import { normalizeMermaidFontSize } from "../../shared/protocol";
import type { Messages } from "../../shared/messages";
import type { MarpImageResizeTarget } from "../../shared/imageResize";
import type { PreviewViewportAnchor } from "../preview/scrollAnchors";
import { mermaidErrorMessage, renderMermaidSvg } from "../markdown/mermaidRenderer";
import type { MermaidTheme } from "../markdown/mermaidRenderer";
import { sanitizeRenderedMarkdown } from "../markdown/markdownSanitizer";
import { ImagePreviewDialog } from "../components/RenderedMarkdown";
import {
  createMarpPdfExportContent,
  createMarpPdfExportRenderSignature,
  isMarpPdfExportReady,
} from "./marpPdfExport";
import type { MarpPdfExportContent } from "./marpPdfExport";
import type { MarpRenderResult, MarpSlideSourceRange } from "./marpRenderer";
import { findMarpSourceRangeAtOffset } from "./marpSourceRanges";
import { isCurrentMarpWorkerResponse } from "./marpWorkerProtocol";
import { getMarpWorker, retainMarpWorker, terminateMarpWorker } from "./marpWorkerPool";

const RENDER_DEBOUNCE_MS = 100;
let frameScriptValue: string | undefined;

function isValidMarpImageResizeTarget(
  sourceMarkdown: string,
  target: MarpImageResizeTarget | undefined,
): target is MarpImageResizeTarget {
  if (
    !target ||
    !Number.isSafeInteger(target.start) ||
    !Number.isSafeInteger(target.end) ||
    target.start < 0 ||
    target.end <= target.start ||
    target.end > sourceMarkdown.length
  ) {
    return false;
  }
  const sourceText = sourceMarkdown.slice(target.start, target.end);
  if (target.kind === "html") return /^<img\b/i.test(sourceText);
  return target.kind === "markdown" &&
    sourceText.startsWith("![") &&
    Number.isSafeInteger(target.altStart) &&
    Number.isSafeInteger(target.altEnd) &&
    (target.altStart ?? -1) >= target.start + 2 &&
    (target.altEnd ?? Number.POSITIVE_INFINITY) >= (target.altStart ?? 0) &&
    (target.altEnd ?? Number.POSITIVE_INFINITY) <= target.end &&
    sourceMarkdown[target.altEnd ?? -1] === "]";
}

interface MarpWorkerResponse extends MarpRenderResult {
  id: number;
  error?: string;
}

interface FrameSlideMetric {
  index: number;
  top: number;
  height: number;
}

interface FrameMessage {
  channel?: string;
  token?: string;
  type?: string;
  renderId?: number;
  imageIndex?: number;
  imageReference?: MarpImageResizeTarget;
  width?: number;
  enabled?: boolean;
  visible?: boolean;
  resizeLabel?: string;
  height?: number;
  slides?: FrameSlideMetric[];
  sourceRanges?: MarpSlideSourceRange[];
  slideLabels?: string[];
  index?: number;
  href?: string;
  workspaceRooted?: boolean;
  source?: string;
  alt?: string;
  stage?: string;
  detail?: string;
  key?: string;
}

/**
 * Marpプレビューを親コンポーネントから操作するための参照。
 */
export interface MarpPreviewHandle {
  /** 指定したMarkdownオフセットを含むスライドへスクロールする。 */
  scrollToOffset(
    offset: number,
    topOffset?: number,
    onlyIfSlideChanges?: boolean,
  ): void;
  /** 現在のスライドとスクロール比を復元用アンカーとして返す。 */
  captureViewport(): PreviewViewportAnchor | undefined;
  /** 指定本文と、iframeへ反映済みのスライド位置情報の生成元が一致するかを返す。 */
  isMarkdownRendered(sourceMarkdown: string): boolean;
  /** 現在の本文と描画設定に一致する完成結果だけをPDFへ渡す。 */
  getPdfExportContent(sourceMarkdown: string): MarpPdfExportContent | undefined;
}

/**
 * MarpPreview lazy loaderとAppで共有するMarpプレビューの表示プロパティです。
 */
export interface MarpPreviewProps {
  markdown: string;
  settings: WebviewSettings;
  messages: Messages;
  zoom: number;
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
  className?: string;
  showZoomControls?: boolean;
  onZoom?: (delta: number) => void;
  onStartupStage?: (stage: string, detail?: string) => void;
  onNavigate: (href: string, workspaceRooted?: boolean) => void;
  onImageResize?: (
    imageIndex: number,
    width: number,
    sourceMarkdown: string,
    target: MarpImageResizeTarget,
  ) => void;
  onRendered?: () => void;
  /** 表示済みスライドの範囲と、その位置情報を生成した本文を通知する。 */
  onActiveSlide?: (range: MarpSlideSourceRange, sourceMarkdown: string) => void;
}

/**
 * Marp Markdownを別Workerで描画し、結果を権限を絞ったiframeへ渡す。
 * @returns スライド表示、読み込み、失敗状態を含むMarpプレビュー。
 */
export const MarpPreview = forwardRef<MarpPreviewHandle, MarpPreviewProps>(
  function MarpPreview(
    {
      markdown,
      settings,
      messages,
      zoom,
      scrollContainerRef,
      className = "",
      showZoomControls = false,
      onZoom,
      onStartupStage,
      onNavigate,
      onImageResize,
      onRendered,
      onActiveSlide,
    },
    ref,
  ): React.JSX.Element {
    const rootRef = useRef<HTMLDivElement>(null);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const workerRef = useRef<Worker | undefined>(undefined);
    const assetDataUrlCacheRef = useRef(new Map<string, Promise<string>>());
    const initialRenderScheduledRef = useRef(false);
    const generationRef = useRef(0);
    const requestIdRef = useRef(0);
    const pendingScrollOffsetRef = useRef<number | undefined>(undefined);
    const awaitingZoomLayoutRef = useRef(false);
    const tokenRef = useRef(createFrameToken());
    const imageResizeEnabledRef = useRef(Boolean(onImageResize));
    imageResizeEnabledRef.current = Boolean(onImageResize);
    const imageResizeControlsVisibleRef = useRef(
      settings.previewImageResizeControlsVisible !== false,
    );
    imageResizeControlsVisibleRef.current =
      settings.previewImageResizeControlsVisible !== false;
    const imageResizeLabelRef = useRef(messages.app.imageControls.resize);
    imageResizeLabelRef.current = messages.app.imageControls.resize;
    const latestResultRef = useRef<MarpWorkerResponse | undefined>(undefined);
    // PDF出力が古いMermaid設定の結果を再利用しないよう、完成結果の生成設定を保持する。
    const latestResultSettingsSignatureRef = useRef<string | undefined>(undefined);
    const lastViewportAnchorRef = useRef<PreviewViewportAnchor | undefined>(undefined);
    const pendingScrollTopOffsetRef = useRef(0);
    const frameReadyRef = useRef(false);
    const metricsRef = useRef<FrameSlideMetric[]>([]);
    const rangesRef = useRef<MarpSlideSourceRange[]>([]);
    const currentMarkdownRef = useRef(markdown);
    currentMarkdownRef.current = markdown;
    /**
     * 出力世代署名にはMarkdown全文を含むため、描画条件が変わる場合に限ってシリアライズする。
     */
    const currentRenderSettingsSignature = useMemo(
      () => createMarpPdfExportRenderSignature(markdown, settings),
      [
        markdown,
        settings.editorTheme,
        settings.language,
        settings.mermaidTheme,
        settings.mermaidFontSize,
        settings.remoteImagesEnabled,
      ],
    );
    const renderedMarkdownRef = useRef<string | undefined>(undefined);
    // ranges/metricsと同じ世代の本文を、iframeのlayout受理時だけ更新する。
    const layoutMarkdownRef = useRef<string | undefined>(undefined);
    const activeSlideRef = useRef(-1);
    const userScrollPendingRef = useRef(false);
    const programmaticScrollRef = useRef(false);
    const [frameHeight, setFrameHeight] = useState(420);
    const [hasRenderedSlides, setHasRenderedSlides] = useState(false);
    const [renderDurationMs, setRenderDurationMs] = useState<number>();
    const [renderCount, setRenderCount] = useState(0);
    const [error, setError] = useState<string>();
    const [imagePreview, setImagePreview] = useState<{
      source: string;
      alt: string;
    }>();

    useEffect(() => retainMarpWorker(), []);

    const getScrollContainer = useCallback(
      () => scrollContainerRef?.current ?? rootRef.current,
      [scrollContainerRef],
    );
    const releaseWorker = useCallback(() => {
      terminateMarpWorker(workerRef.current);
      workerRef.current = undefined;
    }, []);

    const postImageResizeConfiguration = useCallback(() => {
      const frame = frameRef.current?.contentWindow;
      if (!frameReadyRef.current || !frame) return;
      frame.postMessage(
        {
          channel: "mve-marp",
          token: tokenRef.current,
          type: "image-resize-configuration",
          enabled: imageResizeEnabledRef.current &&
            renderedMarkdownRef.current === currentMarkdownRef.current,
          visible: imageResizeControlsVisibleRef.current,
          resizeLabel: imageResizeLabelRef.current,
        },
        "*",
      );
    }, []);

    const postRenderToFrame = useCallback(() => {
      const result = latestResultRef.current;
      const frame = frameRef.current?.contentWindow;
      if (!frameReadyRef.current || !result || !frame) return;
      frame.postMessage(
        {
          channel: "mve-marp",
          token: tokenRef.current,
          type: "render",
          renderId: result.id,
          slides: result.slides,
          css: result.css,
          sourceRanges: result.sourceRanges,
          slideLabels: result.slides.map((_, index) => messages.app.marpPreview.slideLabel(index + 1)),
          imageResizeEnabled: imageResizeEnabledRef.current,
          imageResizeControlsVisible: imageResizeControlsVisibleRef.current,
          resizeLabel: imageResizeLabelRef.current,
        },
        "*",
      );
    }, [messages.app.marpPreview.slideLabel]);

    useEffect(() => {
      postImageResizeConfiguration();
    }, [
      markdown,
      onImageResize,
      postImageResizeConfiguration,
      settings.previewImageResizeControlsVisible,
      messages.app.imageControls.resize,
    ]);

    const scrollToOffset = useCallback(
      (offset: number, topOffset = 0, onlyIfSlideChanges = false) => {
        const container = getScrollContainer();
        const frame = frameRef.current;
        if (!container || !frame || !Number.isFinite(offset)) return;
        pendingScrollOffsetRef.current = offset;
        const range = findMarpSourceRangeAtOffset(rangesRef.current, offset);
        if (!range) return;
        const targetSlideIndex = range.index - 1;
        if (
          onlyIfSlideChanges &&
          !awaitingZoomLayoutRef.current &&
          activeSlideRef.current === targetSlideIndex
        ) {
          pendingScrollOffsetRef.current = undefined;
          return;
        }
        const metric = metricsRef.current.find((item) => item.index === range.index - 1);
        if (!metric) return;
        const frameTop = getFrameTopInContainer(frame, container);
        programmaticScrollRef.current = true;
        userScrollPendingRef.current = false;
        container.scrollTo({
          top: frameTop + metric.top * zoom - topOffset,
          behavior: "auto",
        });
        requestAnimationFrame(() => {
          programmaticScrollRef.current = false;
        });
        activeSlideRef.current = range.index - 1;
        if (rootRef.current) {
          rootRef.current.dataset.mveMarpActiveSlideIndex = String(targetSlideIndex);
        }
        if (!awaitingZoomLayoutRef.current) pendingScrollOffsetRef.current = undefined;
      },
      [getScrollContainer, zoom],
    );

    const captureViewport = useCallback(() => {
      const container = getScrollContainer();
      const frame = frameRef.current;
      const range = rangesRef.current[activeSlideRef.current];
      const metric = metricsRef.current.find((item) => item.index === activeSlideRef.current);
      if (!container || !frame || !range || !metric || container.clientHeight === 0) return undefined;
      const anchor = {
        offset: range.startOffset,
        topOffset: getFrameTopInContainer(frame, container) + metric.top * zoom - container.scrollTop,
      };
      lastViewportAnchorRef.current = anchor;
      return anchor;
    }, [getScrollContainer, zoom]);

    useImperativeHandle(ref, () => ({
      scrollToOffset,
      captureViewport,
      isMarkdownRendered: (sourceMarkdown: string) => layoutMarkdownRef.current === sourceMarkdown,
      getPdfExportContent: (sourceMarkdown: string) => {
        const result = latestResultRef.current;
        if (!result || !isMarpPdfExportReady({
          requestedMarkdown: sourceMarkdown,
          layoutMarkdown: layoutMarkdownRef.current,
          renderedMarkdown: renderedMarkdownRef.current,
          renderedSettingsSignature: latestResultSettingsSignatureRef.current,
          currentSettingsSignature: currentRenderSettingsSignature,
          hasRenderedResult: true,
        })) {
          return undefined;
        }
        return createMarpPdfExportContent(
          result.slides.map((slide) => sanitizeRenderedMarkdown(slide, true)),
          result.css,
        );
      },
    }), [scrollToOffset, captureViewport, currentRenderSettingsSignature]);

    useEffect(() => {
      onStartupStage?.("preview-mounted");
    }, [onStartupStage]);

    useEffect(() => {
      if (error) onStartupStage?.("preview-error", error);
      else if (hasRenderedSlides) onStartupStage?.("preview-ready");
    }, [error, hasRenderedSlides, onStartupStage]);

    useLayoutEffect(() => {
      const anchor = lastViewportAnchorRef.current;
      const activeRange = rangesRef.current[activeSlideRef.current];
      if (!anchor && !activeRange) return;
      const offset = anchor?.offset ?? activeRange!.startOffset;
      const topOffset = anchor?.topOffset ?? 0;
      pendingScrollOffsetRef.current = offset;
      pendingScrollTopOffsetRef.current = topOffset;
      awaitingZoomLayoutRef.current = true;
      scrollToOffset(offset, topOffset);
      pendingScrollOffsetRef.current = undefined;
      pendingScrollTopOffsetRef.current = 0;
      awaitingZoomLayoutRef.current = false;
      lastViewportAnchorRef.current = undefined;
    }, [scrollToOffset, zoom]);

    useLayoutEffect(() => {
      const currentGeneration = ++generationRef.current;
      const renderSettingsSignature = currentRenderSettingsSignature;
      assetDataUrlCacheRef.current.clear();
      const mermaidRenderController = new AbortController();
      // 次の描画が完了するまで現在のスライドと位置情報を保持する。
      // ローディング要素の挿入と表示高さの消失によるスクロールの跳躍を防ぐ。
      setError(undefined);
      let settled = false;
      let resolvingAssets = false;
      const renderDebounceMs = initialRenderScheduledRef.current
        ? RENDER_DEBOUNCE_MS
        : 0;
      initialRenderScheduledRef.current = true;
      const debounce = window.setTimeout(() => {
        const id = ++requestIdRef.current;
        let worker = workerRef.current;
        if (!worker) {
          const workerUri = document.body.dataset.mveMarpWorkerUri;
          if (!workerUri) {
            settleWithError();
            setError(messages.app.marpPreview.failed);
            return;
          }
          onStartupStage?.("worker-fetch-start");
          void getMarpWorker(workerUri)
            .then((activeWorker) => {
              if (settled || generationRef.current !== currentGeneration) {
                return;
              }
              onStartupStage?.("worker-bundle-fetched");
              worker = activeWorker;
              workerRef.current = activeWorker;
              onStartupStage?.("worker-created");
              attachWorker(activeWorker, currentGeneration, id, markdown);
            })
            .catch((error: unknown) => {
              if (generationRef.current === currentGeneration) {
                onStartupStage?.("worker-fetch-error", error instanceof Error ? error.message : String(error));
                releaseWorker();
                settleWithError();
                setError(messages.app.marpPreview.failed);
              }
            });
          return;
        }
        attachWorker(worker, currentGeneration, id, markdown);
      }, renderDebounceMs);
      setError(undefined);
      return () => {
        window.clearTimeout(debounce);
        mermaidRenderController.abort();
        generationRef.current += 1;
      };

      function attachWorker(
        activeWorker: Worker,
        generation: number,
        id: number,
        source: string,
      ): void {
        activeWorker.onmessage = (event: MessageEvent<unknown>) => {
          const response: unknown = event.data;
          if (
            settled ||
            resolvingAssets ||
            generationRef.current !== generation
          ) {
            return;
          }
          if (!isCurrentMarpWorkerResponse(response, id)) return;
          if (!isValidMarpWorkerResponse(response, id, source.length)) {
            settled = true;
            onStartupStage?.("worker-response-invalid");
            setError(messages.app.marpPreview.failed);
            return;
          }
          if (response.error) {
            settled = true;
            onStartupStage?.("worker-render-error", response.error);
            setError(messages.app.marpPreview.failed);
            return;
          }
          onStartupStage?.("worker-response-received");
          resolvingAssets = true;
          onStartupStage?.("asset-resolution-start");
          void proxyMarpAssets(
            response,
            assetDataUrlCacheRef.current,
            settings.remoteImagesEnabled === true,
            settings.mermaidTheme,
            normalizeMermaidFontSize(settings.mermaidFontSize),
            settings.language,
            mermaidRenderController.signal,
          )
            .then((resolvedResponse) => {
              if (settled || generationRef.current !== generation) return;
              settled = true;
              latestResultRef.current = resolvedResponse;
              latestResultSettingsSignatureRef.current = renderSettingsSignature;
              renderedMarkdownRef.current = source;
              setRenderDurationMs(resolvedResponse.renderDurationMs);
              setRenderCount((count) => count + 1);
              onStartupStage?.("asset-resolution-complete");
              onStartupStage?.("iframe-render-posted");
              postRenderToFrame();
            })
            .catch((error: unknown) => {
              if (settled || generationRef.current !== generation) return;
              settled = true;
              onStartupStage?.("asset-resolution-error", error instanceof Error ? error.message : String(error));
              setError(messages.app.marpPreview.failed);
            });
        };
        activeWorker.onerror = () => {
          if (settled || generationRef.current !== generation) return;
          settled = true;
          onStartupStage?.("worker-runtime-error");
          releaseWorker();
          setError(messages.app.marpPreview.failed);
        };
        activeWorker.postMessage({
          id,
          markdown: source,
          katexFontPath: document.body.dataset.mveMarpKatexFontsUri ?? "",
        });
        onStartupStage?.("worker-render-start");
      }

      function settleWithError(): void {
        if (settled) return;
        settled = true;
      }
    }, [markdown, messages.app.marpPreview.failed, onStartupStage, postRenderToFrame, releaseWorker, settings.editorTheme, settings.language, settings.mermaidTheme, settings.mermaidFontSize, settings.remoteImagesEnabled]);

    useEffect(
      () => () => {
        generationRef.current += 1;
        assetDataUrlCacheRef.current.clear();
      },
      [],
    );

    useEffect(() => {
      frameReadyRef.current = false;
      const frame = frameRef.current;
      if (!frame) return;
      const token = createFrameToken();
      tokenRef.current = token;
      let active = true;
      const fetchController = new AbortController();
      onStartupStage?.("iframe-script-fetch-start");
      void fetchFrameScript(fetchController.signal)
        .then((script) => {
          if (!active || tokenRef.current !== token) return;
          onStartupStage?.("iframe-script-fetched");
          frame.srcdoc = createFrameDocument(
            token,
            settings.remoteImagesEnabled,
            script,
          );
        })
        .catch((error: unknown) => {
          if (active && tokenRef.current === token) {
            onStartupStage?.("iframe-script-fetch-error", error instanceof Error ? error.message : String(error));
            setError(messages.app.marpPreview.failed);
          }
        });
      return () => {
        active = false;
        frameReadyRef.current = false;
        fetchController.abort();
      };
    }, [messages.app.marpPreview.failed, onStartupStage, settings.remoteImagesEnabled]);

    useEffect(() => {
      const frame = frameRef.current;
      if (!frame) return;
      const handleMessage = (event: MessageEvent<FrameMessage>) => {
        if (
          event.source !== frame.contentWindow ||
          event.origin !== "null" ||
          event.data?.channel !== "mve-marp" ||
          event.data?.token !== tokenRef.current
        ) {
          return;
        }
        const message = event.data;
        if (
          message.type === "render-stage" ||
          message.type === "render-error" ||
          message.type === "invalid" ||
          message.type === "layout"
        ) {
          const currentResult = latestResultRef.current;
          if (!currentResult || message.renderId !== currentResult.id) return;
        }
        if (message.type === "ready") {
          frameReadyRef.current = true;
          onStartupStage?.("iframe-ready");
          postImageResizeConfiguration();
          postRenderToFrame();
          return;
        }
        if (message.type === "resize-image") {
          const result = latestResultRef.current;
          const sourceMarkdown = renderedMarkdownRef.current;
          if (
            !onImageResize ||
            !result ||
            sourceMarkdown === undefined ||
            sourceMarkdown !== currentMarkdownRef.current ||
            message.renderId !== result.id ||
            !Number.isInteger(message.imageIndex) ||
            (message.imageIndex ?? -1) < 0 ||
            !isValidMarpImageResizeTarget(sourceMarkdown, message.imageReference) ||
            !Number.isInteger(message.width) ||
            (message.width ?? 0) < 48 ||
            (message.width ?? 0) > 10000
          ) {
            return;
          }
          onImageResize(
            message.imageIndex as number,
            message.width as number,
            sourceMarkdown,
            message.imageReference,
          );
          return;
        }
        if (message.type === "render-stage" && typeof message.stage === "string") {
          onStartupStage?.(`iframe-${message.stage}`);
          return;
        }
        if (message.type === "render-error") {
          onStartupStage?.(
            `iframe-${message.stage ?? "render"}-error`,
            message.detail,
          );
          setError(messages.app.marpPreview.failed);
          return;
        }
        if (message.type === "scroll-intent") {
          userScrollPendingRef.current = true;
          requestAnimationFrame(() => {
            if (!userScrollPendingRef.current) return;
            userScrollPendingRef.current = false;
            pendingScrollOffsetRef.current = undefined;
            awaitingZoomLayoutRef.current = false;
            updateActiveSlide(true);
          });
          return;
        }
        if (message.type === "scroll-key" && typeof message.key === "string") {
          const container = getScrollContainer();
          if (!container) return;
          const pageStep = Math.max(80, Math.floor(container.clientHeight * 0.9));
          let targetTop: number;
          switch (message.key) {
            case "ArrowDown":
              targetTop = container.scrollTop + 40;
              break;
            case "ArrowUp":
              targetTop = container.scrollTop - 40;
              break;
            case "PageDown":
            case " ":
              targetTop = container.scrollTop + pageStep;
              break;
            case "PageUp":
              targetTop = container.scrollTop - pageStep;
              break;
            case "Home":
              targetTop = 0;
              break;
            case "End":
              targetTop = container.scrollHeight;
              break;
            default:
              return;
          }
          const maximumTop = Math.max(0, container.scrollHeight - container.clientHeight);
          targetTop = Math.min(maximumTop, Math.max(0, targetTop));
          pendingScrollOffsetRef.current = undefined;
          awaitingZoomLayoutRef.current = false;
          userScrollPendingRef.current = targetTop !== container.scrollTop;
          container.scrollTop = targetTop;
          if (!userScrollPendingRef.current) updateActiveSlide(true);
          else {
            requestAnimationFrame(() => {
              if (!userScrollPendingRef.current) return;
              userScrollPendingRef.current = false;
              updateActiveSlide(true);
            });
          }
          return;
        }
        if (message.type === "invalid") {
          onStartupStage?.("iframe-render-invalid");
          setError(messages.app.marpPreview.failed);
          return;
        }
        if (message.type === "layout") {
          if (
            !Number.isFinite(message.height) ||
            !Array.isArray(message.slides) ||
            !Array.isArray(message.sourceRanges)
          ) {
            onStartupStage?.("iframe-layout-invalid");
            setError(messages.app.marpPreview.failed);
            return;
          }
          const result = latestResultRef.current;
          if (!result || message.renderId !== result.id || message.slides.length === 0) {
            return;
          }
          if (
            message.slides.length !== result.slides.length ||
            message.sourceRanges.length !== result.sourceRanges.length ||
            !message.slides.every((slide, index) =>
              slide.index === index &&
              Number.isFinite(slide.top) &&
              Number.isFinite(slide.height) &&
              slide.height > 0
            )
          ) {
            onStartupStage?.("iframe-layout-invalid");
            setError(messages.app.marpPreview.failed);
            return;
          }
          setFrameHeight(Math.max(320, Math.ceil(message.height ?? 0)));
          metricsRef.current = message.slides;
          rangesRef.current = message.sourceRanges;
          layoutMarkdownRef.current = renderedMarkdownRef.current;
          onStartupStage?.("iframe-layout-received", `slides=${message.slides.length}`);
          setHasRenderedSlides(true);
          // 旧スライドの再計測では、最新の描画失敗や復元待ちを完了扱いにしない。
          if (
            result.id === requestIdRef.current &&
            renderedMarkdownRef.current === currentMarkdownRef.current
          ) {
            setError(undefined);
            onRendered?.();
          }
          if (pendingScrollOffsetRef.current !== undefined) {
            const pendingOffset = pendingScrollOffsetRef.current;
            const pendingTopOffset = pendingScrollTopOffsetRef.current;
            pendingScrollOffsetRef.current = undefined;
            pendingScrollTopOffsetRef.current = 0;
            awaitingZoomLayoutRef.current = false;
            scrollToOffset(pendingOffset, pendingTopOffset);
          }
          updateActiveSlide(false);
          return;
        }
        if (message.type === "navigate") {
          if (typeof message.href === "string")
            onNavigate(message.href, message.workspaceRooted === true);
          return;
        }
        if (message.type === "image") {
          if (typeof message.source === "string")
            setImagePreview({ source: message.source, alt: message.alt ?? "" });
          return;
        }
        if (message.type === "navigate-slide" && Number.isInteger(message.index)) {
          const range = rangesRef.current[message.index as number];
          if (range) scrollToOffset(range.startOffset);
        }
      };
      window.addEventListener("message", handleMessage);
      return () => window.removeEventListener("message", handleMessage);

      function updateActiveSlide(userInitiated: boolean): void {
        const frame = frameRef.current;
        const container = getScrollContainer();
        if (!frame || !container || !metricsRef.current.length) return;
        const frameTop = getFrameTopInContainer(frame, container);
        const viewportPoint = container.scrollTop + container.clientHeight * 0.38;
        let metric = metricsRef.current[0];
        for (const candidate of metricsRef.current) {
          const top = frameTop + candidate.top * zoom;
          const bottom = top + candidate.height * zoom;
          if (viewportPoint >= top && viewportPoint < bottom) {
            metric = candidate;
            break;
          }
          if (viewportPoint >= top) metric = candidate;
        }
        if (!metric || metric.index === activeSlideRef.current) return;
        activeSlideRef.current = metric.index;
        if (rootRef.current) {
          rootRef.current.dataset.mveMarpActiveSlideIndex = String(metric.index);
        }
        if (userInitiated && !programmaticScrollRef.current) {
          const range = rangesRef.current[metric.index];
          if (range && layoutMarkdownRef.current !== undefined) {
            onActiveSlide?.(range, layoutMarkdownRef.current);
          }
        }
      }
    }, [getScrollContainer, messages.app.marpPreview.failed, onActiveSlide, onNavigate, onRendered, onStartupStage, postRenderToFrame, scrollToOffset, zoom]);

    useEffect(() => {
      const container = getScrollContainer();
      if (!container) return;
      const markUserIntent = () => {
        userScrollPendingRef.current = true;
      };
      const handleScroll = () => {
        if (programmaticScrollRef.current) return;
        const userInitiated = userScrollPendingRef.current;
        userScrollPendingRef.current = false;
        if (userInitiated) {
          pendingScrollOffsetRef.current = undefined;
          awaitingZoomLayoutRef.current = false;
        }
        updateActiveSlide(userInitiated);
      };
      const handleKeyDown = (event: KeyboardEvent) => {
        if (["ArrowDown", "PageDown", " ", "Home", "End"].includes(event.key))
          markUserIntent();
      };
      container.addEventListener("wheel", markUserIntent, { passive: true });
      container.addEventListener("pointerdown", markUserIntent, { passive: true });
      container.addEventListener("touchstart", markUserIntent, { passive: true });
      container.addEventListener("keydown", handleKeyDown);
      container.addEventListener("scroll", handleScroll, { passive: true });
      return () => {
        container.removeEventListener("wheel", markUserIntent);
        container.removeEventListener("pointerdown", markUserIntent);
        container.removeEventListener("touchstart", markUserIntent);
        container.removeEventListener("keydown", handleKeyDown);
        container.removeEventListener("scroll", handleScroll);
      };

      function updateActiveSlide(userInitiated: boolean): void {
        const frame = frameRef.current;
        if (!frame || !container || !metricsRef.current.length) return;
        const frameTop = getFrameTopInContainer(frame, container);
        const viewportPoint = container.scrollTop + container.clientHeight * 0.38;
        let metric = metricsRef.current[0];
        for (const candidate of metricsRef.current) {
          const top = frameTop + candidate.top * zoom;
          const bottom = top + candidate.height * zoom;
          if (viewportPoint >= top && viewportPoint < bottom) {
            metric = candidate;
            break;
          }
          if (viewportPoint >= top) metric = candidate;
        }
        if (!metric || metric.index === activeSlideRef.current) return;
        activeSlideRef.current = metric.index;
        if (rootRef.current) {
          rootRef.current.dataset.mveMarpActiveSlideIndex = String(metric.index);
        }
        if (userInitiated && !programmaticScrollRef.current) {
          const range = rangesRef.current[metric.index];
          if (range && layoutMarkdownRef.current !== undefined) {
            onActiveSlide?.(range, layoutMarkdownRef.current);
          }
        }
      }
    }, [getScrollContainer, onActiveSlide, onImageResize, postImageResizeConfiguration, zoom]);

    return (
      <div
        ref={rootRef}
        className={`mve-marp-preview ${className}`.trim()}
        data-mve-marp-status={error ? "error" : hasRenderedSlides ? "ready" : "loading"}
        data-mve-marp-slide-count={hasRenderedSlides ? metricsRef.current.length : 0}
        data-mve-marp-render-duration-ms={renderDurationMs}
        data-mve-marp-render-count={renderCount}
        aria-busy={!error && !hasRenderedSlides}
      >
        {showZoomControls && (
          <div
            className="pdf-preview-toolbar"
            role="toolbar"
            aria-label={messages.app.status.zoom(Math.round(zoom * 100))}
          >
            <button
              type="button"
              aria-label={messages.app.pdfPreview.zoomOut}
              onClick={() => onZoom?.(-0.1)}
            >
              −
            </button>
            <span className="pdf-preview-zoom-value">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              aria-label={messages.app.pdfPreview.zoomIn}
              onClick={() => onZoom?.(0.1)}
            >
              ＋
            </button>
          </div>
        )}
        {error ? (
          <p className="mve-marp-preview-error" role="alert">
            {error}
          </p>
        ) : !hasRenderedSlides ? (
          <p className="mve-marp-preview-loading" role="status" aria-live="polite">
            {messages.app.marpPreview.loading}
          </p>
        ) : null}
        <div
          className="mve-marp-preview-layout"
          style={{ height: `${frameHeight * zoom}px` }}
        >
          <div
            className="mve-marp-preview-scaled"
            style={{ height: `${frameHeight}px`, transform: `scale(${zoom})` }}
          >
            <iframe
              ref={frameRef}
              className="mve-marp-preview-frame"
              title={messages.app.marpPreview.title}
              sandbox="allow-scripts"
              srcDoc={undefined}
              style={{ height: `${frameHeight}px` }}
            />
          </div>
        </div>
        {imagePreview && (
          <ImagePreviewDialog
            source={resolveImageSource(imagePreview.source)}
            alt={imagePreview.alt}
            language={settings.language}
            onClose={() => setImagePreview(undefined)}
          />
        )}
      </div>
    );
  },
);

/**
 * Marp Workerの応答形状とソース範囲を検証する。
 * @param value - Workerから受け取った任意の値。
 * @param requestId - 現在処理中の要求ID。
 * @param sourceLength - Markdown本文のUTF-16長。
 * @returns 現在の要求に対応した安全なWorker応答ならtrue。
 */
function isValidMarpWorkerResponse(
  value: unknown,
  requestId: number,
  sourceLength: number,
): value is MarpWorkerResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<MarpWorkerResponse>;
  if (response.id !== requestId) return false;
  if (typeof response.error === "string") return response.error.length > 0;
  if (
    !Array.isArray(response.slides) ||
    response.slides.length === 0 ||
    !response.slides.every((slide) => typeof slide === "string") ||
    !Array.isArray(response.sourceRanges) ||
    response.sourceRanges.length !== response.slides.length ||
    typeof response.css !== "string" ||
    typeof response.renderDurationMs !== "number" ||
    !Number.isFinite(response.renderDurationMs) ||
    response.renderDurationMs < 0
  ) {
    return false;
  }
  return response.sourceRanges.every((range, index) => {
    if (!range || typeof range !== "object") return false;
    const candidate = range as Partial<MarpSlideSourceRange>;
    return candidate.index === index + 1 &&
      Number.isInteger(candidate.startLine) && candidate.startLine! >= 1 &&
      Number.isInteger(candidate.endLine) && candidate.endLine! >= candidate.startLine! &&
      Number.isInteger(candidate.startOffset) && candidate.startOffset! >= 0 &&
      Number.isInteger(candidate.endOffset) && candidate.endOffset! >= candidate.startOffset! &&
      candidate.endOffset! <= sourceLength &&
      (candidate.heading === undefined || typeof candidate.heading === "string");
  });
}

/**
 * Marpのブラウザー補助コードを親Webviewで取得し、opaque originのiframeへ埋め込む。
 * @returns nonce付きinline scriptとして使うMarp補助コード。
 */
function fetchFrameScript(signal: AbortSignal): Promise<string> {
  if (frameScriptValue !== undefined) return Promise.resolve(frameScriptValue);
  const resourceUri = document.body.dataset.mveMarpFrameUri;
  if (!resourceUri) return Promise.reject(new Error("Marp frame URI is missing."));
  return fetch(resourceUri, { signal }).then((response) => {
    if (!response.ok) throw new Error(`Marp frame request failed: ${response.status}`);
    return response.text();
  }).then((script) => {
    frameScriptValue = script;
    return script;
  });
}

/**
 * VS Codeのsandbox iframeから直接取得できないローカル資産をdata URIへ変換する。
 * @param response - Marp Workerが返したスライドとテーマCSS。
 * @param cache - 同じMarp描画内の重複資産をまとめるPromise cache。
 * @param allowRemoteImages - リモート画像をスライドへ残す設定。
 * @param mermaidTheme - Mermaid図へ適用するテーマ設定。
 * @param mermaidFontSize - Mermaid図へ適用する文字サイズ（px）。
 * @param language - Mermaid描画エラーを表示する言語。
 * @param signal - 古いMarp生成を中断する通知。
 * @returns ローカル資産をWebview側で解決したMarp描画結果。
 */
async function proxyMarpAssets(
  response: MarpWorkerResponse,
  cache: Map<string, Promise<string>>,
  allowRemoteImages: boolean,
  mermaidTheme: WebviewSettings["mermaidTheme"],
  mermaidFontSize: number,
  language: WebviewSettings["language"],
  signal: AbortSignal,
): Promise<MarpWorkerResponse> {
  const parsedSlides = await Promise.all(response.slides.map(async (html) => {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    for (const element of Array.from(parsed.body.querySelectorAll<HTMLElement | SVGElement>("*"))) {
      const tagName = element.tagName.toLowerCase();
      const attributes = tagName === "img" || tagName === "source" || tagName === "audio"
        ? ["src"]
        : tagName === "video"
          ? ["src", "poster"]
          : tagName === "image"
            ? ["href", "xlink:href"]
            : [];
      for (const attribute of attributes) {
        const value = element.getAttribute(attribute);
        if (value) {
          if (!allowRemoteImages && /^https?:\/\//i.test(value)) {
            element.removeAttribute(attribute);
            if (tagName === "img") element.removeAttribute("data-original-src");
            continue;
          }
          if (tagName === "img" && attribute === "src" && !element.hasAttribute("data-original-src")) {
            element.setAttribute("data-original-src", value);
          }
          const resolved = await proxyAssetReference(value, cache);
          if (resolved !== value) element.setAttribute(attribute, resolved);
        }
      }
      if (element.hasAttribute("style")) {
        const originalStyle = element.getAttribute("style") ?? "";
        const resolvedStyle = await proxyCssAssetUrls(originalStyle, cache, allowRemoteImages);
        if (resolvedStyle !== originalStyle) element.setAttribute("style", resolvedStyle);
      }
    }
    return parsed;
  }));
  for (const parsed of parsedSlides) {
    await renderMarpMermaidBlocks(
      parsed.body,
      mermaidTheme,
      mermaidFontSize,
      language,
      signal,
    );
  }
  const css = await proxyCssAssetUrls(response.css, cache, allowRemoteImages);
  return {
    ...response,
    slides: parsedSlides.map((parsed) => parsed.body.innerHTML),
    css: `${css}\n.mve-marp-slide .mve-marp-mermaid{display:flex;justify-content:center;max-width:100%;overflow-x:auto}.mve-marp-slide .mve-marp-mermaid>svg{display:block;max-width:100%;height:auto}.mve-marp-slide .mve-marp-mermaid-error{display:block;color:#b42318}.mve-marp-slide .mve-marp-mermaid-error-message{margin:.4em 0;white-space:pre-wrap}`,
  };
}

/**
 * MarpのMermaidコードフェンスをHost描画したSVGへ置き換える。
 * @param content - Mermaidコードフェンスを含むスライド本文。
 * @param mermaidTheme - Mermaidテーマ設定。
 * @param mermaidFontSize - Mermaid図へ適用する文字サイズ（px）。
 * @param language - エラー表示に使う言語。
 * @param signal - 古い描画要求を中断するAbortSignal。
 */
async function renderMarpMermaidBlocks(
  content: HTMLElement,
  mermaidTheme: WebviewSettings["mermaidTheme"],
  mermaidFontSize: number,
  language: WebviewSettings["language"],
  signal: AbortSignal,
): Promise<void> {
  const blocks = Array.from(content.querySelectorAll<HTMLPreElement>("pre"))
    .flatMap((pre) => {
      const code = pre.querySelector("code");
      const isMermaid = code && Array.from(code.classList).some(
        (className) => /^(?:language|lang)-mermaid$/i.test(className),
      );
      return code && isMermaid ? [{ pre, code }] : [];
    });

  for (const { pre, code } of blocks) {
    if (signal.aborted) throw new Error("Marp Mermaid rendering was cancelled.");
    const source = code.textContent ?? "";
    const container = document.createElement("div");
    container.className = "mve-marp-mermaid";
    container.setAttribute("role", "img");
    const scalePercent = Number(pre.dataset.mveMermaidScale);
    const theme = resolveMarpMermaidTheme(mermaidTheme, pre);

    try {
      const rendered = await renderMermaidSvg(
        source,
        theme,
        signal,
        mermaidFontSize,
      );
      if (signal.aborted) throw new Error("Marp Mermaid rendering was cancelled.");
      const template = document.createElement("template");
      template.innerHTML = rendered.svg;
      const svg = template.content.querySelector("svg");
      if (!svg) throw new Error("Mermaid rendering returned no SVG.");
      if (rendered.ariaLabel) container.setAttribute("aria-label", rendered.ariaLabel);
      if (Number.isInteger(scalePercent) && scalePercent >= 10 && scalePercent <= 200) {
        const viewBoxWidth = svg.viewBox.baseVal.width;
        if (viewBoxWidth > 0 && scalePercent !== 100) {
          svg.style.width = `${viewBoxWidth * scalePercent / 100}px`;
          container.dataset.mveMermaidScale = String(scalePercent);
        }
      }
      svg.setAttribute("aria-hidden", "true");
      container.append(template.content);
    } catch (error) {
      if (signal.aborted) throw error;
      container.className = "mve-marp-mermaid mve-marp-mermaid-error";
      container.setAttribute("role", "group");
      container.append(pre.cloneNode(true));
      const message = document.createElement("p");
      message.className = "mve-marp-mermaid-error-message";
      message.setAttribute("role", "alert");
      message.textContent = mermaidErrorMessage(error, language);
      container.append(message);
    }

    pre.replaceWith(container);
  }
}

/**
 * Marpスライド内のMermaid図に適用するテーマを解決する。
 * @param mermaidTheme - Mermaidテーマ設定。
 * @param block - 対象のMermaidコードブロック。
 * @returns Mermaid描画に使う配色テーマ。
 */
function resolveMarpMermaidTheme(
  mermaidTheme: WebviewSettings["mermaidTheme"],
  block: HTMLElement,
): MermaidTheme {
  if (mermaidTheme !== "auto") return mermaidTheme;

  const slide = block.closest<HTMLElement>("section");
  for (let element: HTMLElement | null = block; element; element = element.parentElement) {
    if (element.classList.contains("invert")) return "dark";
    const slideTheme = element.dataset.theme?.toLowerCase();
    if (slideTheme === "dark") return "dark";
    if (slideTheme === "light") return "default";
    if (element === slide) break;
  }

  // Marp slides have their own canvas theme; the editor chrome can use a different theme.
  return "default";
}

/**
 * CSS内のローカルurl()だけをWebview側で取得してdata URIへ差し替える。
 * @param css - 資産URLを含むCSS文字列。
 * @param cache - 同じMarp描画内の重複資産をまとめるPromise cache。
 * @param allowRemoteImages - リモート画像を表示する設定が有効ならtrue。
 * @returns ローカル資産参照を置換したCSS文字列。
 */
async function proxyCssAssetUrls(
  css: string,
  cache: Map<string, Promise<string>>,
  allowRemoteImages: boolean,
): Promise<string> {
  const matches = Array.from(css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi));
  let result = css;
  for (const match of matches.reverse()) {
    const reference = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!allowRemoteImages && /^https?:\/\//i.test(reference)) {
      const start = match.index ?? 0;
      result = `${result.slice(0, start)}none${result.slice(start + match[0].length)}`;
      continue;
    }
    const resolved = await proxyAssetReference(reference, cache);
    if (resolved === reference) continue;
    const start = match.index ?? 0;
    result = `${result.slice(0, start)}url("${resolved}")${result.slice(start + match[0].length)}`;
  }
  return result;
}

/**
 * 文書基準URIと同じWebview resource originを持つ資産だけをdata URIへ変換する。
 * @param reference - HTML属性またはCSS url()に記載された資産参照。
 * @param cache - 同じMarp描画内の重複資産をまとめるPromise cache。
 * @returns 外部参照はそのまま、ローカルWebview参照はdata URIへ変換して返す。
 */
async function proxyAssetReference(
  reference: string,
  cache: Map<string, Promise<string>>,
): Promise<string> {
  if (!reference || /^(?:data:|blob:|javascript:|#)/i.test(reference)) return reference;
  let base: URL;
  let asset: URL;
  try {
    base = new URL(document.baseURI);
    asset = new URL(reference, base);
  } catch (error) {
    if (error instanceof TypeError) return reference;
    throw error;
  }
  if ((asset.protocol !== "http:" && asset.protocol !== "https:") || asset.origin !== base.origin) {
    return reference;
  }
  asset.hash = "";
  let pending = cache.get(asset.toString());
  if (!pending) {
    pending = fetch(asset.toString(), { signal: AbortSignal.timeout(5_000) })
      .then(async (response) => response.ok
        ? blobToDataUrl(await response.blob())
        : reference)
      .catch(() => reference);
    cache.set(asset.toString(), pending);
  }
  return pending;
}

/**
 * Blobをiframeのsandbox originでも表示できるdata URIへ変換する。
 * @param blob - Webview resourceから取得したローカル資産。
 * @returns MIME typeを保ったdata URI。
 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Marp asset could not be converted to a data URI."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Marp asset read failed."));
    reader.readAsDataURL(blob);
  });
}

/**
 * 隔離iframeのHTMLとCSPを組み立てる。
 * @param token - 親とiframeの間で照合する一時トークン。
 * @returns sandbox iframeへ設定するsrcdoc。
 */
function createFrameDocument(
  token: string,
  remoteImagesEnabled: boolean,
  frameScript: string,
): string {
  const cspSource = escapeAttribute(document.body.dataset.mveCspSource ?? "");
  const scriptNonce = escapeAttribute(
    document.body.dataset.mveCspNonce || createFrameToken(),
  );
  const remoteImages = remoteImagesEnabled ? " https: http:" : "";
  const baseUri = escapeAttribute(document.baseURI);
  const safeFrameScript = frameScript.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri ${cspSource}; img-src ${cspSource} data: blob:${remoteImages}; font-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${scriptNonce}'; connect-src 'none'; form-action 'none';"><base href="${baseUri}"><style>html,body{margin:0;min-height:100%;background:#e5e8ec}body{padding:22px 0;box-sizing:border-box}#mve-marp-slides{display:flex;flex-direction:column;gap:38px;align-items:center}#mve-marp-slides>.mve-marp-slide{position:relative;width:min(100%,1280px);display:flex;justify-content:center;outline:2px solid rgba(78,88,100,.82);outline-offset:0;box-shadow:0 5px 18px rgba(0,0,0,.28)}.mve-marp-slide .marpit{width:100%;height:auto}.mve-marp-slide .marpit>svg{display:block;width:100%!important;height:auto!important}</style></head><body><style id="mve-marp-theme"></style><main id="mve-marp-slides"></main><script nonce="${scriptNonce}" data-mve-token="${escapeAttribute(token)}">${safeFrameScript}</script></body></html>`;
}

/**
 * Marpのiframe先頭をスクロールコンテナー内の文書座標へ変換する。
 * @param frame - Marpスライドを表示するiframe。
 * @param container - 実際にスクロールする親要素。
 * @returns iframe先頭のスクロールコンテンツ内オフセット。
 */
function getFrameTopInContainer(frame: HTMLIFrameElement, container: HTMLElement): number {
  return frame.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
}

/**
 * iframeへ渡す属性値のHTML特殊文字を置換する。
 * @param value - iframe HTMLの属性値。
 * @returns HTML属性として安全に埋め込める文字列。
 */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 画像の相対参照を文書基準URIで解決する。
 * @param source - Marpスライド内の画像参照。
 * @returns Inspectorで開く絶対画像URI。
 */
function resolveImageSource(source: string): string {
  try {
    return new URL(source, document.baseURI).toString();
  } catch {
    return source;
  }
}

/**
 * 親とsandbox iframeの送信元を区別する128bit一時tokenを生成する。
 * @returns 暗号学的乱数を16進表記したtoken。
 */
function createFrameToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

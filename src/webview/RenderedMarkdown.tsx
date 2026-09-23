/**
 * @fileoverview 変換済みMarkdownをDOMへ描画し、画像・リンク・見出し・表の編集操作をプレビューへ接続する。
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ImageAlignment } from "../shared/imageResize";
import type { MermaidInteraction, WebviewSettings } from "../shared/protocol";
import { getMessages } from "../shared/messages";
import { renderMarkdownFallback } from "./markdownFallback";
import {
  mermaidErrorMessage,
  renderMermaidSvg,
  type MermaidRenderResult,
} from "./mermaidRenderer";
import { mveDebug } from "./debug";

/**
 * Markdownプレビューで扱う値の種類と境界を表す型。
 */
export type InspectorTarget =
  | {
      /**
       * Markdownプレビューで対象や分岐を識別する値の型。
       */
      type: "mermaid";
      /**
       * 解析・描画・変換の起点となる本文。
       */
      source: string;
    }
  | {
      /**
       * Markdownプレビューで対象や分岐を識別する値の型。
       */
      type: "math";
      /**
       * 解析・描画・変換の起点となる本文。
       */
      source: string;
    }
  | {
      /**
       * Markdownプレビューで対象や分岐を識別する値の型。
       */
      type: "image";
      /**
       * 解析・描画・変換の起点となる本文。
       */
      source: string;
      /**
       * Markdownプレビューで扱うaltの文字列。
       */
      alt: string;
      /**
       * Markdownプレビューの位置・寸法・件数・時間を表す数値。
       */
      imageIndex?: number;
    };

/**
 * Markdownプレビューで共有するデータ形状を表すインターフェース。
 */
interface Props {
  /**
   * 解析・編集・変換の対象となるMarkdown本文。
   */
  markdown: string;
  /**
   * 表示または出力するHTML本文。
   */
  html?: string;

  /**
   * Markdownプレビューへ渡す設定または境界値。
   */
  settings: WebviewSettings;

  /**
   * Markdownプレビューで扱うclass・nameの文字列。
   */
  className?: string;

  /**
   * Markdownプレビューのimage・zoomを表す数値。
   */
  imageZoom?: number;
  /**
   * Markdownプレビューのイベントまたはメッセージを受け取り、状態を更新する。
   * @param target - Markdownプレビューへ渡す入力。
   * @returns 副作用を完了し、値は返さない。
   */
  onInspect?: (target: InspectorTarget) => void;
  /**
   * Markdownプレビューのイベントまたはメッセージを受け取り、状態を更新する。
   * @param imageIndex - Markdownプレビューの位置・寸法・件数・時間を表す数値。
   * @param width - 表示領域または列の幅。
   * @returns 副作用を完了し、値は返さない。
   */
  onImageResize?: (imageIndex: number, width: number) => void;
  /**
   * Markdownプレビューのイベントまたはメッセージを受け取り、状態を更新する。
   * @param imageIndex - Markdownプレビューの位置・寸法・件数・時間を表す数値。
   * @returns Markdownプレビューのon・image・resetが生成する結果。
   */
  onImageReset?: (imageIndex: number) => void;
  /**
   * Markdownプレビューのイベントまたはメッセージを受け取り、状態を更新する。
   * @param imageIndex - Markdownプレビューの位置・寸法・件数・時間を表す数値。
   * @param alignment - Markdownプレビューへ渡す入力。
   * @returns Markdownプレビューのon・image・alignが生成する結果。
   */
  onImageAlign?: (imageIndex: number, alignment: ImageAlignment) => void;
  /**
   * Markdownプレビューのイベントまたはメッセージを受け取り、状態を更新する。
   * @param href - リンク操作領域の遷移先URI。
   * @returns Markdownプレビューのon・navigateが生成する結果。
   */
  onNavigate?: (href: string) => void;
  /**
   * Markdownプレビューのイベントまたはメッセージを受け取り、状態を更新する。
   * @param element - 寸法または属性を読み取るDOM要素。
   * @returns Markdownプレビューのon・renderedが生成する結果。
   */
  onRendered?: (element: HTMLElement) => void;
  /**
   * Markdownプレビューのイベントまたはメッセージを受け取り、状態を更新する。
   * @returns Markdownプレビューのon・mermaid・renderedが生成する結果。
   */
  onMermaidRendered?: () => void;

  /**
   * Markdownプレビューのdefer・mermaidを切り替えるフラグ。
   */
  deferMermaid?: boolean;
}

/**
 * Markdownプレビューを表示用の結果へ変換する。
 * @param options - 呼び出し側が指定する処理設定。
 * @returns Markdownプレビューで生成または変換した値。
 */
function RenderedMarkdownView({
  markdown,
  html,
  settings,
  className = "",
  imageZoom,
  onInspect,
  onImageResize,
  onImageReset,
  onImageAlign,
  onNavigate,
  onRendered,
  onMermaidRendered,
  deferMermaid = false,
}: Props & {
  /**
   * 表示または出力するHTML本文。
   */
  html: string;
}): React.JSX.Element {
  // MarkdownをHTMLへ変換し、Mermaid・画像・リンクの表示後処理を行うプレビューを描画する。
  const rootRef = useRef<HTMLDivElement>(null);
  const renderedBlocksRef = useRef<RenderedDomBlock[]>([]);
  const mermaidObjectUrlsRef = useRef(new Set<string>());
  const mermaidRenderControllersRef = useRef(
    new Map<
      HTMLElement,
      {
        /**
         * Markdownプレビューで扱うkeyの文字列。
         */
        key: string;
        /**
         * Markdownプレビューのcontrollerに関する状態または設定。
         */
        controller: AbortController;
      }
    >(),
  );
  const mermaidInteractionManagersRef = useRef(
    new Map<HTMLElement, () => void>(),
  );
  const mermaidCacheRef = useRef(new MermaidResultCache());
  const onRenderedRef = useRef(onRendered);
  const onMermaidRenderedRef = useRef(onMermaidRendered);
  const onImageResizeRef = useRef(onImageResize);
  const onImageResetRef = useRef(onImageReset);
  const onImageAlignRef = useRef(onImageAlign);
  onRenderedRef.current = onRendered;
  onMermaidRenderedRef.current = onMermaidRendered;
  onImageResizeRef.current = onImageResize;
  onImageResetRef.current = onImageReset;
  onImageAlignRef.current = onImageAlign;
  useLayoutEffect(
    /**
     * 要素をifへ渡し、Markdownプレビューの結果または副作用を処理する。
     * @returns Markdownプレビューのコールバックが生成する結果。
     */
    () => {
      const root = rootRef.current;
      if (!root) return;
      const startedAt = performance.now();
      renderedBlocksRef.current = reconcileRenderedBlocks(
        root,
        renderedBlocksRef.current,
        html,
      );
      root.dataset.renderRevision = String(
        (Number(root.dataset.renderRevision) || 0) + 1,
      );
      performance.clearMeasures("mve-preview-dom-reconcile");
      performance.measure("mve-preview-dom-reconcile", {
        start: startedAt,
        end: performance.now(),
      });
    },
    [html],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns Markdownプレビューのコールバックが生成する結果。
     */
    () =>
      /**
       * 要素をfor・eachへ渡し、Markdownプレビューの結果または副作用を処理する。
       * @returns Markdownプレビューのコールバックが生成する結果。
       */
      () => {
        mermaidRenderControllersRef.current.forEach(
          /**
           * 設定ごとにabortを実行する。
           * @param options - 呼び出し側が指定する処理設定。
           * @returns 副作用を完了し、値は返さない。
           */
          ({ controller }) => controller.abort(),
        );
        mermaidRenderControllersRef.current.clear();
        mermaidObjectUrlsRef.current.forEach(
          /**
           * urlごとにrevoke・object・urlを実行する。
           * @param url - Markdownプレビューで読み書きするリソースの場所。
           * @returns 副作用を完了し、値は返さない。
           */
          (url) => URL.revokeObjectURL(url),
        );
        mermaidObjectUrlsRef.current.clear();
        mermaidInteractionManagersRef.current.forEach(
          /**
           * cleanupごとにcleanupを実行する。
           * @param cleanup - Markdownプレビューへ渡す入力。
           * @returns 副作用を完了し、値は返さない。
           */
          (cleanup) => cleanup(),
        );
        mermaidInteractionManagersRef.current.clear();
      },
    [],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns Markdownプレビューのコールバックが生成する結果。
     */
    () => {
      // HTMLの更新を監視し、未処理のMermaidや画像の読み込み後にレイアウトを通知する。
      const root = rootRef.current;
      if (!root) return;
      // 表の短い項目名だけを改行禁止にし、長い先頭列の横溢れを防ぐ。
      root.querySelectorAll<HTMLTableElement>("table").forEach(
        /**
         * tableごとにfromを実行する。
         * @param table - tableのrowsを参照する走査対象。
         * @returns 副作用を完了し、値は返さない。
         */
        (table) => {
          Array.from(table.rows).forEach(
            /**
             * 行ごとにifを実行する。
             * @param row - 行のcellsを参照する走査対象。
             * @returns 副作用を完了し、値は返さない。
             */
            (row) => {
              const cell = row.cells[0];
              if (!cell) return;
              const text = cell.textContent?.trim() ?? "";
              if (
                text.length > 0 &&
                Array.from(text).length <= 8 &&
                !/\s/.test(text)
              ) {
                cell.dataset.mveNowrap = "true";
              } else {
                delete cell.dataset.mveNowrap;
              }
            },
          );
        },
      );
      root.dataset.renderEffect = "active";
      const dark = settings.editorTheme
        ? settings.editorTheme === "dark"
        : document.body.classList.contains("vscode-dark") ||
          document.body.classList.contains("vscode-high-contrast");
      const theme =
        settings.mermaidTheme === "auto"
          ? dark
            ? "dark"
            : "default"
          : settings.mermaidTheme;
      let cancelled = false;
      let renderTimer: number | undefined;
      const interactionManagers = mermaidInteractionManagersRef.current;
      const mermaidObjectUrls = mermaidObjectUrlsRef.current;
      const renderControllers = mermaidRenderControllersRef.current;
      const scrollContainer = findScrollContainer(root);
      let lastViewportActivityAt = 0;
      interactionManagers.forEach(
        /**
         * cleanupごとにifを実行する。
         * @param cleanup - Markdownプレビューへ渡す入力。
         * @param node - DOMノードのis・connectedを参照する走査対象。
         * @returns 副作用を完了し、値は返さない。
         */
        (cleanup, node) => {
          if (node.isConnected) return;
          cleanup();
          interactionManagers.delete(node);
        },
      );
      // 差分DOMで保持された同一図の描画は継続する。図ソース・テーマが変わった要求だけを破棄する。
      renderControllers.forEach(
        /**
         * エントリごとにdecode・uricomponentを実行する。
         * @param entry - エントリのkeyを参照する走査対象。
         * @param node - DOMノードのdatasetを参照する走査対象。
         * @returns 副作用を完了し、値は返さない。
         */
        (entry, node) => {
          const source = decodeURIComponent(node.dataset.mermaidSource ?? "");
          if (node.isConnected && entry.key === `${theme}\0${source}`) return;
          entry.controller.abort();
          renderControllers.delete(node);
          delete node.dataset.mermaidStatus;
        },
      );

      const notifyRendered = /**
       * Markdownプレビューのnotify・renderedを処理し、呼び出し側へ結果または副作用を返す。
       * @returns 副作用を完了し、値は返さない。
       */ () => {
        if (cancelled) return;
        // 出力ステージはMermaidが全件確定する前のResizeObserver通知を完了扱いしない。
        if (
          !deferMermaid &&
          root.querySelector(
            '.mermaid:not([data-mermaid-status]), .mermaid[data-mermaid-status="rendering"]',
          )
        )
          return;
        onRenderedRef.current?.(root);
      };

      const applyMermaid = /**
       * Markdownプレビューの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
       * @param node - Markdownプレビューで走査または更新する要素。
       * @param source - 解析・描画・変換の起点となる本文。
       * @param rendered - Markdownプレビューへ渡す入力。
       * @param isCurrent - Markdownプレビューの条件を示すフラグ。
       * @returns 副作用を完了し、値は返さない。
       */ async (
        node: HTMLElement,
        source: string,
        rendered: MermaidRenderResult,
        isCurrent: () => boolean,
      ): Promise<void> => {
        const applyStartedAt = performance.now();

        const recordApplyDuration = /**
         * Markdownプレビューのrecord・apply・durationを処理し、呼び出し側へ結果または副作用を返す。
         * @param startedAt - Markdownプレビューへ渡す入力。
         * @returns Markdownプレビューのrecord・apply・durationが生成する結果。
         */ (startedAt = applyStartedAt) => {
          performance.clearMeasures("mve-preview-mermaid-apply");
          performance.measure("mve-preview-mermaid-apply", {
            start: startedAt,
            end: performance.now(),
          });
        };
        if (deferMermaid && isPreviewInputActive()) {
          await waitForPreviewInputIdle(
            renderControllers.get(node)?.controller.signal,
          );
          if (!node.isConnected || !isCurrent()) return;
        }
        if (!deferMermaid) {
          if (rendered.external && rendered.svg.length >= 80_000) {
            // 出力用SVGは文字列のまま保持し、直列化時だけ展開する。非表示DOMへの巨大SVG挿入を避ける。
            node.replaceChildren();
            node.dataset.mveExportSvg = encodeURIComponent(rendered.svg);
          } else {
            // ホスト側で既にID名前空間化済み。ここで再走査するとID数×SVG長の二次処理になる。
            node.innerHTML = rendered.svg;
          }
          recordApplyDuration();
          return;
        }
        if (!rendered.external || rendered.svg.length < 80_000) {
          node.innerHTML = rendered.svg;
          recordApplyDuration();
          return;
        }
        // 対話画面では巨大SVGを表示寸法のPNGへ非同期変換し、再スクロール時のSVG再ラスタライズを避ける。
        const svgBlob = new Blob([rendered.svg], { type: "image/svg+xml" });
        const rasterStartedAt = performance.now();
        let previewBlob = svgBlob;
        try {
          previewBlob = rendered.pngBase64
            ? await decodeBase64Png(rendered.pngBase64)
            : await rasterizeMermaidPreview(svgBlob, rendered.svg, root);
        } catch {
          // createImageBitmap/OffscreenCanvas非対応環境では従来どおりSVG画像を使用する。
        }
        performance.clearMeasures("mve-preview-mermaid-rasterize");
        performance.measure("mve-preview-mermaid-rasterize", {
          start: rasterStartedAt,
          end: performance.now(),
        });
        if (!node.isConnected || !isCurrent()) return;
        const domApplyStartedAt = performance.now();
        const objectUrl = URL.createObjectURL(previewBlob);
        mermaidObjectUrls.add(objectUrl);
        const frame = document.createElement("div");
        frame.className = "mermaid-svg-frame";
        frame.dataset.mveRasterized =
          previewBlob.type === "image/png" ? "true" : "false";
        frame.style.aspectRatio = String(readSvgAspectRatio(rendered.svg));
        frame.setAttribute("role", "img");
        frame.setAttribute(
          "aria-label",
          rendered.ariaLabel || `Mermaid: ${source.split(/\r?\n/, 1)[0] ?? ""}`,
        );
        const image = document.createElement("img");
        image.className = "mermaid-svg-image";
        image.alt = "";
        image.draggable = false;
        image.src = objectUrl;
        image.addEventListener(
          "load",

          /**
           * イベントでnotify・renderedを実行する。
           * @returns 副作用を完了し、値は返さない。
           */
          () => {
            notifyRendered();
          },
          { once: true },
        );
        frame.append(image);
        let interactionLayer: HTMLDivElement | undefined;
        if (rendered.interactions.length) {
          interactionLayer = document.createElement("div");
          interactionLayer.className = "mermaid-interaction-layer";
          frame.append(interactionLayer);
        }
        interactionManagers.get(node)?.();
        interactionManagers.delete(node);
        node.replaceChildren(frame);
        if (interactionLayer) {
          interactionManagers.set(
            node,
            attachVirtualMermaidInteractions(
              frame,
              interactionLayer,
              rendered.interactions,
              scrollContainer,
            ),
          );
        }
        recordApplyDuration(domApplyStartedAt);
      };

      const renderNodes = /**
       * Markdownプレビューを表示用の結果へ変換する。
       * @returns 条件が成立したかを示す真偽値。
       */ async (): Promise<boolean> => {
        // 未描画のMermaidノードを抽出し、SVG描画結果またはエラー表示を反映する。
        const allNodes = Array.from(
          root.querySelectorAll<HTMLElement>(".mermaid"),
        );
        const pending = allNodes.filter(
          /**
           * datasetの条件を満たすDOMノードだけを残す。
           * @param node - DOMノードのdatasetを参照する走査対象。
           * @returns 条件を満たした要素だけを含む一覧。
           */
          (node) =>
            !node.dataset.mermaidStatus &&
            (!deferMermaid || isNearViewport(node, scrollContainer)),
        );
        if (!pending.length) {
          if (
            !allNodes.some(
              /**
               * MarkdownプレビューのコールバックとしてDOMノードを処理する。
               * @param node - Markdownプレビューで走査または更新する要素。
               * @returns Markdownプレビューのコールバックが生成する結果。
               */
              (node) => node.dataset.mermaidStatus === "rendering",
            )
          ) {
            notifyRendered();
          }
          return allNodes.some(
            /**
             * MarkdownプレビューのコールバックとしてDOMノードを処理する。
             * @param node - Markdownプレビューで走査または更新する要素。
             * @returns 条件が成立したかを示す真偽値。
             */
            (node) => !node.dataset.mermaidStatus,
          );
        }
        // ホスト側は直列描画なので、可視・画面外・出力のいずれも要求を先行投入しない。
        // 世代ごとに1件だけ開始すれば、更新時の取消対象と35秒タイマーも常に1件に収まる。
        const batch = pending.slice(0, 1);
        await Promise.all(
          batch.map(
            /**
             * 各DOMノードからdatasetを取り出して一覧化する。
             * @param node - DOMノードのdatasetを参照する走査対象。
             * @returns datasetを取り出した変換結果の一覧。
             */
            async (node) => {
              // ノードごとにソースを復元して描画し、以前の描画結果をエラー時の代替として保持する。
              const index = allNodes.indexOf(node);
              const blockKey = `index:${index}`;
              const source = decodeURIComponent(
                node.dataset.mermaidSource ?? "",
              );
              const sourceCacheKey = `source:${theme}\0${source}`;
              const renderKey = `${theme}\0${source}`;
              node.dataset.mermaidStatus = "rendering";
              const controller = new AbortController();
              renderControllers.set(node, { key: renderKey, controller });

              const isCurrent = /**
               * Markdownプレビューの条件を判定する。
               * @returns 条件が成立したかを示す真偽値。
               */ () =>
                !controller.signal.aborted &&
                renderControllers.get(node)?.controller === controller;
              const cached = deferMermaid
                ? mermaidCacheRef.current.get(sourceCacheKey)
                : undefined;
              if (cached) {
                try {
                  await applyMermaid(node, source, cached, isCurrent);
                  if (
                    !node.isConnected ||
                    renderControllers.get(node)?.controller !== controller
                  )
                    return;
                  node.dataset.mermaidStatus = "ready";
                  mermaidCacheRef.current.set(`block:${blockKey}`, cached);
                } finally {
                  if (renderControllers.get(node)?.controller === controller)
                    renderControllers.delete(node);
                }
                return;
              }
              try {
                const rendered = await renderMermaidSvg(
                  source,
                  theme,
                  controller.signal,
                  settings.mermaidHostRendering === true,
                  !deferMermaid,
                  deferMermaid,
                );
                if (
                  !node.isConnected ||
                  renderControllers.get(node)?.controller !== controller
                )
                  return;
                await applyMermaid(node, source, rendered, isCurrent);
                if (
                  !node.isConnected ||
                  renderControllers.get(node)?.controller !== controller
                )
                  return;
                node.dataset.mermaidStatus = "ready";
                onMermaidRenderedRef.current?.();
                mermaidCacheRef.current.set(`block:${blockKey}`, rendered);
                if (deferMermaid && rendered.external) {
                  mermaidCacheRef.current.set(sourceCacheKey, rendered);
                }
              } catch (error) {
                if (
                  controller.signal.aborted ||
                  !node.isConnected ||
                  renderControllers.get(node)?.controller !== controller
                )
                  return;
                const previous = mermaidCacheRef.current.get(
                  `block:${blockKey}`,
                );
                if (previous)
                  await applyMermaid(node, source, previous, isCurrent);
                else node.replaceChildren();
                if (
                  !node.isConnected ||
                  renderControllers.get(node)?.controller !== controller
                )
                  return;
                node.dataset.mermaidStatus = "error";
                onMermaidRenderedRef.current?.();
                const message = document.createElement("pre");
                message.className = "mermaid-error-message";
                message.textContent = mermaidErrorMessage(
                  error,
                  settings.language,
                );
                node.append(message);
              } finally {
                if (renderControllers.get(node)?.controller === controller)
                  renderControllers.delete(node);
              }
            },
          ),
        );
        notifyRendered();
        return allNodes.some(
          /**
           * MarkdownプレビューのコールバックとしてDOMノードを処理する。
           * @param node - Markdownプレビューで走査または更新する要素。
           * @returns 条件が成立したかを示す真偽値。
           */
          (node) => !node.dataset.mermaidStatus,
        );
      };

      const scheduleRenderNodes = /**
       * Markdownプレビューの処理順序と完了状態を管理する。
       * @param delay - Markdownプレビューの位置・寸法・件数・時間を表す数値。
       * @param restart - Markdownプレビューへ渡す入力。
       * @returns Markdownプレビューのschedule・render・nodesが生成する結果。
       */ (delay = deferMermaid ? 80 : 0, restart = false) => {
        const startedAt = performance.now();
        if (restart && renderTimer !== undefined) {
          window.clearTimeout(renderTimer);
          renderTimer = undefined;
        }
        if (
          !cancelled &&
          renderTimer === undefined &&
          (!deferMermaid || !isPreviewInputActive())
        ) {
          renderTimer = window.setTimeout(
            /**
             * 指定時間の経過後に後続処理を実行する。
             * @returns 副作用を完了し、値は返さない。
             */
            () => {
              renderTimer = undefined;
              void renderNodes().then(
                /**
                 * 要素をfromへ渡し、Markdownプレビューの結果または副作用を処理する。
                 * @returns Markdownプレビューのコールバックが生成する結果。
                 */
                () => {
                  const hasNextForegroundNode = Array.from(
                    root.querySelectorAll<HTMLElement>(".mermaid"),
                  ).some(
                    /**
                     * DOMノードをis・near・viewportへ渡し、Markdownプレビューの結果または副作用を処理する。
                     * @param node - Markdownプレビューで走査または更新する要素。
                     * @returns 条件が成立したかを示す真偽値。
                     */
                    (node) =>
                      !node.dataset.mermaidStatus &&
                      (!deferMermaid || isNearViewport(node, scrollContainer)),
                  );
                  if (hasNextForegroundNode) scheduleRenderNodes();
                },
              );
            },
            delay,
          );
        }
        performance.clearMeasures("mve-preview-scroll-mermaid-schedule");
        performance.measure("mve-preview-scroll-mermaid-schedule", {
          start: startedAt,
          end: performance.now(),
        });
      };
      const imageResizeCleanups: Array<() => void> = [];
      const pendingImageEnhancements = new Set<HTMLImageElement>();
      let imageEnhanceTimer: number | undefined;

      const enhanceImages = /**
       * Markdownプレビューのenhance・imagesを処理し、呼び出し側へ結果または副作用を返す。
       * @param candidates - Markdownプレビューの対象や分岐を識別する値。
       * @returns Markdownプレビューのenhance・imagesが生成する結果。
       */ (candidates?: HTMLImageElement[]) => {
        if (onImageResizeRef.current || onImageAlignRef.current) {
          const cleanup = enhanceResizableImages(
            root,
            onImageResizeRef,
            onImageResetRef,
            onImageAlignRef,
            candidates === undefined && deferMermaid,
            candidates,
          );
          if (cleanup) imageResizeCleanups.push(cleanup);
        }
      };

      const processImageEnhancementChunk = /**
       * Markdownプレビューのイベントまたはメッセージを受け取り、状態を更新する。
       * @returns Markdownプレビューのprocess・image・enhancement・chunkが生成する結果。
       */ () => {
        imageEnhanceTimer = undefined;
        if (cancelled) return;
        if (deferMermaid && isPreviewInputActive()) {
          imageEnhanceTimer = window.setTimeout(
            processImageEnhancementChunk,
            100,
          );
          return;
        }
        const activityDelay =
          100 - (performance.now() - lastViewportActivityAt);
        if (activityDelay > 0) {
          imageEnhanceTimer = window.setTimeout(
            processImageEnhancementChunk,
            activityDelay,
          );
          return;
        }
        const startedAt = performance.now();
        let processed = 0;
        for (const image of pendingImageEnhancements) {
          pendingImageEnhancements.delete(image);
          if (image.isConnected && image.dataset.mveEnhanced !== "true")
            enhanceImages([image]);
          processed += 1;
          if (processed >= 1 || performance.now() - startedAt >= 4) break;
        }
        performance.clearMeasures("mve-preview-image-enhance");
        performance.measure("mve-preview-image-enhance", {
          start: startedAt,
          end: performance.now(),
        });
        if (pendingImageEnhancements.size) {
          imageEnhanceTimer = window.setTimeout(
            processImageEnhancementChunk,
            0,
          );
        }
      };

      const scheduleImageEnhancements = /**
       * Markdownプレビューの処理順序と完了状態を管理する。
       * @param imagesToEnhance - Markdownプレビューへ渡す要素の一覧。
       * @returns Markdownプレビューのschedule・image・enhancementsが生成する結果。
       */ (imagesToEnhance: HTMLImageElement[]) => {
        imagesToEnhance.forEach(
          /**
           * 画像ごとに追加を実行する。
           * @param image - Markdownプレビューへ渡す入力。
           * @returns 副作用を完了し、値は返さない。
           */
          (image) => pendingImageEnhancements.add(image),
        );
        if (imageEnhanceTimer === undefined && pendingImageEnhancements.size) {
          imageEnhanceTimer = window.setTimeout(
            processImageEnhancementChunk,
            0,
          );
        }
      };
      const resizeObserver = new ResizeObserver(
        /**
         * 要素をnotify・renderedへ渡し、Markdownプレビューの結果または副作用を処理する。
         * @returns Markdownプレビューのコールバックが生成する結果。
         */
        () => {
          notifyRendered();
        },
      );
      resizeObserver.observe(root);
      const images = Array.from(root.querySelectorAll("img"));
      let imageEnhanceObserver: IntersectionObserver | undefined;
      if (onImageResizeRef.current || onImageAlignRef.current) {
        const resizableImages = Array.from(
          root.querySelectorAll<HTMLImageElement>(
            'img[data-mve-image-index][data-mve-resizable="true"]:not([data-mve-enhanced="true"])',
          ),
        );
        if (deferMermaid && typeof IntersectionObserver !== "undefined") {
          imageEnhanceObserver = new IntersectionObserver(
            /**
             * entriesをifへ渡し、Markdownプレビューの結果または副作用を処理する。
             * @param entries - Markdownプレビューへ渡す入力。
             * @returns Markdownプレビューのコールバックが生成する結果。
             */
            (entries) => {
              if (cancelled) return;
              const visibleImages = entries
                .filter(
                  /**
                   * is・intersectingの条件を満たすエントリだけを残す。
                   * @param entry - エントリのis・intersectingを参照する走査対象。
                   * @returns 条件を満たした要素だけを含む一覧。
                   */
                  (entry) =>
                    entry.isIntersecting &&
                    entry.target instanceof HTMLImageElement,
                )
                .map(
                  /**
                   * 各エントリからtargetを取り出して一覧化する。
                   * @param entry - エントリのtargetを参照する走査対象。
                   * @returns targetを取り出した変換結果の一覧。
                   */
                  (entry) => entry.target as HTMLImageElement,
                );
              visibleImages.forEach(
                /**
                 * 画像ごとにunobserveを実行する。
                 * @param image - 画像のenhance・observerを参照する走査対象。
                 * @returns 副作用を完了し、値は返さない。
                 */
                (image) => imageEnhanceObserver?.unobserve(image),
              );
              if (visibleImages.length)
                scheduleImageEnhancements(visibleImages);
            },
            {
              root: scrollContainer,
              rootMargin: "600px 0px",
            },
          );
          resizableImages.forEach(
            /**
             * 画像ごとにobserveを実行する。
             * @param image - 画像のenhance・observerを参照する走査対象。
             * @returns 副作用を完了し、値は返さない。
             */
            (image) => imageEnhanceObserver?.observe(image),
          );
        } else {
          enhanceImages(resizableImages);
        }
      }
      // 画像の読み込み完了時に、変化したプレビューの大きさを親へ通知する。

      const imageLoaded = /**
       * Markdownプレビューの入力を検証し、表示または保存に使う形式へ変換する。
       * @returns Markdownプレビューのimage・loadedが生成する結果。
       */ () => {
        notifyRendered();
      };
      images.forEach(
        /**
         * 画像ごとにadd・event・listenerを実行する。
         * @param image - 画像のadd・event・listenerを参照する走査対象。
         * @returns 副作用を完了し、値は返さない。
         */
        (image) => image.addEventListener("load", imageLoaded),
      );

      const scheduleAfterViewportActivity = /**
       * Markdownプレビューの処理順序と完了状態を管理する。
       * @returns Markdownプレビューのschedule・after・viewport・activityが生成する結果。
       */ () => {
        lastViewportActivityAt = performance.now();
        scheduleRenderNodes(120, true);
      };
      scrollContainer?.addEventListener(
        "scroll",
        scheduleAfterViewportActivity,
        {
          passive: true,
        },
      );
      window.addEventListener("resize", scheduleAfterViewportActivity, {
        passive: true,
      });

      const pauseForInput = /**
       * Markdownプレビューのpause・for・inputを処理し、呼び出し側へ結果または副作用を返す。
       * @returns Markdownプレビューのpause・for・inputが生成する結果。
       */ () => {
        if (renderTimer !== undefined) {
          window.clearTimeout(renderTimer);
          renderTimer = undefined;
        }
        if (imageEnhanceTimer !== undefined) {
          window.clearTimeout(imageEnhanceTimer);
          imageEnhanceTimer = undefined;
        }
      };

      const resumeAfterInput = /**
       * Markdownプレビューのresume・after・inputを処理し、呼び出し側へ結果または副作用を返す。
       * @returns Markdownプレビューのresume・after・inputが生成する結果。
       */ () => {
        scheduleRenderNodes(120, true);
        if (pendingImageEnhancements.size) scheduleImageEnhancements([]);
      };
      window.addEventListener("mve-preview-input-active", pauseForInput);
      window.addEventListener("mve-preview-input-settled", resumeAfterInput);
      if (deferMermaid) onRenderedRef.current?.(root);
      scheduleRenderNodes();
      /**
       * Markdownプレビューのreturnを処理し、呼び出し側へ結果または副作用を返す。
       * @returns Markdownプレビューのreturnが生成する結果。
       */
      return () => {
        cancelled = true;
        if (renderTimer !== undefined) window.clearTimeout(renderTimer);
        if (imageEnhanceTimer !== undefined)
          window.clearTimeout(imageEnhanceTimer);
        pendingImageEnhancements.clear();
        resizeObserver.disconnect();
        imageEnhanceObserver?.disconnect();
        images.forEach(
          /**
           * 画像ごとにremove・event・listenerを実行する。
           * @param image - 画像のremove・event・listenerを参照する走査対象。
           * @returns 副作用を完了し、値は返さない。
           */
          (image) => image.removeEventListener("load", imageLoaded),
        );
        scrollContainer?.removeEventListener(
          "scroll",
          scheduleAfterViewportActivity,
        );
        window.removeEventListener("resize", scheduleAfterViewportActivity);
        window.removeEventListener("mve-preview-input-active", pauseForInput);
        window.removeEventListener(
          "mve-preview-input-settled",
          resumeAfterInput,
        );
        imageResizeCleanups.forEach(
          /**
           * cleanupごとにcleanupを実行する。
           * @param cleanup - Markdownプレビューへ渡す入力。
           * @returns 副作用を完了し、値は返さない。
           */
          (cleanup) => cleanup(),
        );
        // 差分更新で再利用したMermaid画像のBlob URLは維持し、DOMから消えた分だけ解放する。
        mermaidObjectUrls.forEach(
          /**
           * urlごとにifを実行する。
           * @param url - DOMから抽出したurl。
           * @returns 副作用を完了し、値は返さない。
           */
          (url) => {
            if (
              Array.from(
                root.querySelectorAll<HTMLImageElement>(
                  "img.mermaid-svg-image",
                ),
              ).some(
                /**
                 * Markdownプレビューのコールバックとして画像を処理する。
                 * @param image - Markdownプレビューへ渡す入力。
                 * @returns 副作用を完了し、値は返さない。
                 */
                (image) => image.src === url,
              )
            )
              return;
            URL.revokeObjectURL(url);
            mermaidObjectUrls.delete(url);
          },
        );
      };
    },
    [
      html,
      markdown,
      settings.editorTheme,
      settings.language,
      settings.mermaidTheme,
      settings.mermaidHostRendering,
      Boolean(onImageResize),
      Boolean(onImageAlign),
      deferMermaid,
    ],
  );

  /**
   * Markdownプレビューのイベントまたはメッセージを受け取り、状態を更新する。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @returns 副作用を完了し、値は返さない。
   */
  function onDoubleClick(event: React.MouseEvent<HTMLDivElement>): void {
    // ダブルクリックされた要素からMermaid・数式・画像の編集対象を特定して通知する。
    const target = event.target as HTMLElement;
    const mermaidNode = target.closest<HTMLElement>("[data-mermaid-source]");
    if (mermaidNode) {
      onInspect?.({
        type: "mermaid",
        source: decodeURIComponent(mermaidNode.dataset.mermaidSource ?? ""),
      });
      return;
    }
    const mathNode = target.closest<HTMLElement>("[data-math-source]");
    if (mathNode) {
      onInspect?.({
        type: "math",
        source: decodeURIComponent(mathNode.dataset.mathSource ?? ""),
      });
      return;
    }
    const image = target.closest<HTMLImageElement>("img[data-original-src]");
    if (image) {
      const imageIndex = Number.parseInt(image.dataset.mveImageIndex ?? "", 10);
      onInspect?.({
        type: "image",
        source: image.dataset.originalSrc ?? "",
        alt: image.alt,
        imageIndex: Number.isFinite(imageIndex) ? imageIndex : undefined,
      });
    }
  }

  /**
   * Markdownプレビューのイベントまたはメッセージを受け取り、状態を更新する。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @returns 副作用を完了し、値は返さない。
   */
  function onClick(event: React.MouseEvent<HTMLDivElement>): void {
    // コードコピーと内部・外部リンクのクリックをプレビュー内で処理する。
    const target = event.target as HTMLElement;
    const copy = target.closest<HTMLButtonElement>("[data-copy-code]");
    if (copy) {
      const code =
        copy.closest("figure")?.querySelector("code")?.textContent ?? "";
      void navigator.clipboard.writeText(code);
      const messages = getMessages(settings.language);
      copy.textContent = messages.renderer.copied;
      window.setTimeout(
        /**
         * 指定時間の経過後に後続処理を実行する。
         * @returns 副作用を完了し、値は返さない。
         */
        () => (copy.textContent = messages.renderer.copy),
        1200,
      );
      return;
    }
    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    if (anchor) {
      const originalHref = anchor.dataset.mveLink;
      const href = originalHref ?? anchor.getAttribute("href") ?? "";
      if (!originalHref && href.startsWith("#")) {
        event.preventDefault();
        rootRef.current
          ?.querySelector<HTMLElement>(href)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        // Webviewのネイティブ遷移を許すと、ローカルMarkdownがブラウザへ渡るため、
        // 外部URLを含めてホスト側のリンク処理へ必ず委譲する。
        event.preventDefault();
        onNavigate?.(href);
      }
    }
  }

  return (
    <div
      ref={rootRef}
      className={`rendered-markdown ${className}`}
      data-document-length={markdown.length}
      data-mve-image-zoom={
        imageZoom !== undefined ? String(imageZoom) : undefined
      }
      style={
        imageZoom !== undefined
          ? ({ "--mve-preview-image-zoom": imageZoom } as React.CSSProperties)
          : undefined
      }
      onDoubleClick={onDoubleClick}
      onClick={onClick}
    />
  );
}

/**
 * UIイベントを表示または編集状態へ反映する。
 * @param props - ユーザー操作またはDOMから通知されたイベント。
 * @returns 副作用を完了し、値は返さない。
 */
function RenderedMarkdownLoader(props: Props): React.JSX.Element {
  const { markdown, html, settings } = props;
  const [rendered, setRendered] = useState<{
    /**
     * 解析・編集・変換の対象となるMarkdown本文。
     */
    markdown: string;

    /**
     * Markdownプレビューで扱うlanguageの文字列。
     */
    language: string;

    /**
     * Markdownプレビューのremote・images・enabledを示す状態フラグ。
     */
    remoteImagesEnabled: boolean;

    /**
     * 表示または出力するHTML本文。
     */
    html: string;
  }>();
  const [error, setError] = useState<unknown>();

  useEffect(
    /**
     * 依存状態の変化に応じて購読を更新し、解除処理を返す。
     * @returns Markdownプレビューのコールバックが生成する結果。
     */
    () => {
      if (html !== undefined) return;
      let cancelled = false;
      setError(undefined);
      void renderMarkdownFallback(markdown, {
        remoteImagesEnabled: settings.remoteImagesEnabled,
        language: settings.language,
      })
        .then(
          /**
           * 値をifへ渡し、Markdownプレビューの結果または副作用を処理する。
           * @param value - 検証・変換・保存の対象となる値。
           * @returns Markdownプレビューのコールバックが生成する結果。
           */
          (value) => {
            if (cancelled) return;
            setRendered({
              markdown,
              language: settings.language,
              remoteImagesEnabled: settings.remoteImagesEnabled,
              html: value,
            });
          },
        )
        .catch(
          /**
           * reasonをifへ渡し、Markdownプレビューの結果または副作用を処理する。
           * @param reason - 処理を中断または失敗させた理由。
           * @returns Markdownプレビューのコールバックが生成する結果。
           */
          (reason: unknown) => {
            if (!cancelled) setError(reason);
          },
        );
      /**
       * Markdownプレビューのreturnを処理し、呼び出し側へ結果または副作用を返す。
       * @returns Markdownプレビューに対応する要素の一覧。
       */
      return () => {
        cancelled = true;
      };
    },
    [html, markdown, settings.language, settings.remoteImagesEnabled],
  );

  if (html !== undefined) {
    return <RenderedMarkdownView {...props} html={html} />;
  }
  if (error) {
    return (
      <div className="markdown-render-error" role="alert">
        {String(error)}
      </div>
    );
  }
  if (
    !rendered ||
    rendered.markdown !== markdown ||
    rendered.language !== settings.language ||
    rendered.remoteImagesEnabled !== settings.remoteImagesEnabled
  ) {
    return <div aria-busy="true" />;
  }
  return <RenderedMarkdownView {...props} html={rendered.html} />;
}

/**
 * Markdownプレビューで解析・表示・保存する本文。
 */
export const RenderedMarkdown = React.memo(RenderedMarkdownLoader);

/**
 * Markdownプレビューで共有するデータ形状を表すインターフェース。
 */
interface RenderedDomBlock {
  /**
   * Markdownプレビューで扱うsignatureの文字列。
   */
  signature: string;

  /**
   * Markdownプレビューのnodeに関する状態または設定。
   */
  node: Element;
}

/**
 * Markdownプレビューのreconcile・rendered・blocksを処理し、呼び出し側へ結果または副作用を返す。
 * @param root - Markdownプレビューへ渡す入力。
 * @param previous - Markdownプレビューへ渡す要素の一覧。
 * @param html - 表示または出力するHTML本文。
 * @returns Markdownプレビューに対応する要素の一覧。
 */
function reconcileRenderedBlocks(
  root: HTMLElement,
  previous: RenderedDomBlock[],
  html: string,
): RenderedDomBlock[] {
  const template = document.createElement("template");
  template.innerHTML = html;
  const next = Array.from(template.content.children).map(
    /**
     * 各DOMノードをrendered・block・signatureへ渡し、変換結果を一覧化する。
     * @param node - Markdownプレビューで走査または更新する要素。
     * @returns 入力要素から生成した変換結果の一覧。
     */
    (node) => ({
      signature: renderedBlockSignature(node),
      node,
    }),
  );

  // 外部DOM操作や開発時の再マウントで参照がずれた場合だけ、安全に全件を再構築する。
  if (
    previous.length !== root.children.length ||
    previous.some(
      /**
       * Markdownプレビューのコールバックとしてエントリを処理する。
       * @param entry - Markdownプレビューで走査または更新する要素。
       * @param index - 配列・行列・文字列の要素位置を示す番号。
       * @returns Markdownプレビューのコールバックが生成する結果。
       */
      (entry, index) => root.children[index] !== entry.node,
    )
  ) {
    reuseCompletedMermaidNodes(
      Array.from(root.children),
      next.map(
        /**
         * 各エントリからDOMノードを取り出して一覧化する。
         * @param entry - エントリのDOMノードを参照する走査対象。
         * @returns DOMノードを取り出した変換結果の一覧。
         */
        (entry) => entry.node,
      ),
    );
    root.replaceChildren(
      ...next.map(
        /**
         * 各エントリからDOMノードを取り出して一覧化する。
         * @param entry - エントリのDOMノードを参照する走査対象。
         * @returns DOMノードを取り出した変換結果の一覧。
         */
        (entry) => entry.node,
      ),
    );
    return next;
  }

  let prefix = 0;
  while (
    prefix < previous.length &&
    prefix < next.length &&
    previous[prefix].signature === next[prefix].signature
  ) {
    syncRenderedBlockAttributes(previous[prefix].node, next[prefix].node);
    next[prefix] = {
      signature: next[prefix].signature,
      node: previous[prefix].node,
    };
    prefix += 1;
  }

  let previousSuffix = previous.length - 1;
  let nextSuffix = next.length - 1;
  while (
    previousSuffix >= prefix &&
    nextSuffix >= prefix &&
    previous[previousSuffix].signature === next[nextSuffix].signature
  ) {
    syncRenderedBlockAttributes(
      previous[previousSuffix].node,
      next[nextSuffix].node,
    );
    next[nextSuffix] = {
      signature: next[nextSuffix].signature,
      node: previous[previousSuffix].node,
    };
    previousSuffix -= 1;
    nextSuffix -= 1;
  }

  reuseCompletedMermaidNodes(
    previous.slice(prefix, previousSuffix + 1).map(
      /**
       * 各エントリからDOMノードを取り出して一覧化する。
       * @param entry - エントリのDOMノードを参照する走査対象。
       * @returns DOMノードを取り出した変換結果の一覧。
       */
      (entry) => entry.node,
    ),
    next.slice(prefix, nextSuffix + 1).map(
      /**
       * 各エントリからDOMノードを取り出して一覧化する。
       * @param entry - エントリのDOMノードを参照する走査対象。
       * @returns DOMノードを取り出した変換結果の一覧。
       */
      (entry) => entry.node,
    ),
  );
  for (let index = prefix; index <= previousSuffix; index += 1)
    previous[index].node.remove();
  if (prefix <= nextSuffix) {
    const fragment = document.createDocumentFragment();
    for (let index = prefix; index <= nextSuffix; index += 1)
      fragment.append(next[index].node);
    const suffixAnchor =
      nextSuffix + 1 < next.length ? next[nextSuffix + 1].node : null;
    root.insertBefore(fragment, suffixAnchor);
  }
  return next;
}

/**
 * Markdownプレビューのreuse・completed・mermaid・nodesを処理し、呼び出し側へ結果または副作用を返す。
 * @param previousBlocks - Markdownプレビューへ渡す要素の一覧。
 * @param nextBlocks - Markdownプレビューの位置・寸法・件数・時間を表す数値。
 * @returns 副作用を完了し、値は返さない。
 */
function reuseCompletedMermaidNodes(
  previousBlocks: Element[],
  nextBlocks: Element[],
): void {
  const completed = new Map<string, HTMLElement[]>();
  for (const block of previousBlocks) {
    const candidates = block.matches(".mermaid[data-mermaid-status]")
      ? [block as HTMLElement]
      : Array.from(
          block.querySelectorAll<HTMLElement>(".mermaid[data-mermaid-status]"),
        );
    for (const node of candidates) {
      if (
        !(
          node.dataset.mermaidStatus === "ready" ||
          node.dataset.mermaidStatus === "error"
        )
      )
        continue;
      const key = node.dataset.mermaidSource ?? "";
      const nodes = completed.get(key) ?? [];
      nodes.push(node);
      completed.set(key, nodes);
    }
  }
  for (const block of nextBlocks) {
    const candidates = block.matches(".mermaid")
      ? [block as HTMLElement]
      : Array.from(block.querySelectorAll<HTMLElement>(".mermaid"));
    for (const candidate of candidates) {
      const nodes = completed.get(candidate.dataset.mermaidSource ?? "");
      const retained = nodes?.shift();
      if (!retained) continue;
      syncRenderedBlockAttributes(retained, candidate);
      candidate.replaceWith(retained);
    }
  }
}

/**
 * Markdownプレビューを表示用の結果へ変換する。
 * @param node - Markdownプレビューで走査または更新する要素。
 * @returns Markdownプレビューで利用する文字列。
 */
function renderedBlockSignature(node: Element): string {
  if (node.classList.contains("markdown-source-block")) {
    return `source:${node.className}\0${node.innerHTML}`;
  }
  return `other:${node.outerHTML}`;
}

/**
 * Markdownプレビューのsync・rendered・block・attributesを処理し、呼び出し側へ結果または副作用を返す。
 * @param current - Markdownプレビューへ渡す入力。
 * @param next - Markdownプレビューの位置・寸法・件数・時間を表す数値。
 * @returns 副作用を完了し、値は返さない。
 */
function syncRenderedBlockAttributes(current: Element, next: Element): void {
  const preservedRuntimeAttributes = current.classList.contains("mermaid")
    ? ["data-mermaid-status", "data-mve-export-svg"]
        .map(
          /**
           * 各nameをget・attributeへ渡し、変換結果を一覧化する。
           * @param name - Markdownプレビューの対象や分岐を識別する値。
           * @returns 入力要素から生成した変換結果の一覧。
           */
          (name) => [name, current.getAttribute(name)] as const,
        )
        .filter(
          /**
           * 条件を満たすエントリだけを残す。
           * @param entry - 走査中の要素。
           * @returns 条件を満たした要素だけを含む一覧。
           */
          (entry): entry is readonly [string, string] => entry[1] !== null,
        )
    : [];
  Array.from(current.attributes).forEach(
    /**
     * attributeごとにremove・attributeを実行する。
     * @param attribute - attributeのnameを参照する走査対象。
     * @returns 副作用を完了し、値は返さない。
     */
    (attribute) => current.removeAttribute(attribute.name),
  );
  Array.from(next.attributes).forEach(
    /**
     * attributeごとにset・attributeを実行する。
     * @param attribute - attributeのnameを参照する走査対象。
     * @returns 副作用を完了し、値は返さない。
     */
    (attribute) => current.setAttribute(attribute.name, attribute.value),
  );
  preservedRuntimeAttributes.forEach(
    /**
     * 設定ごとにset・attributeを実行する。
     * @param options - 呼び出し側が指定する処理設定。
     * @returns 副作用を完了し、値は返さない。
     */
    ([name, value]) => current.setAttribute(name, value),
  );
}

/**
 * Webview側で保持するMermaid描画結果の最大件数。
 */
const MERMAID_CACHE_ENTRY_LIMIT = 16;
/**
 * Webview側のMermaid描画キャッシュに許容する合計バイト数。
 */
const MERMAID_CACHE_BYTE_LIMIT = 16 * 1024 * 1024;

/**
 * Markdownプレビューの状態と操作をまとめるクラス。
 */
class MermaidResultCache {
  /**
   * Markdownプレビューで扱うentriesの一覧。
   */
  private readonly entries = new Map<string, MermaidRenderResult>();

  /**
   * Markdownプレビューのretainedに関する状態または設定。
   */
  private readonly retained = new Map<
    MermaidRenderResult,
    {
      /**
       * Markdownプレビューの位置・寸法・件数・時間を表す数値。
       */
      bytes: number;
      /**
       * Markdownプレビューのreferencesを表す数値。
       */
      references: number;
    }
  >();

  /**
   * Markdownプレビューの位置・寸法・件数・時間を表す数値。
   */
  private totalBytes = 0;

  /**
   * Markdownプレビューのコールバックとしてkeyを処理する。
   * @param key - Markdownプレビューの対象や分岐を識別する値。
   * @returns 副作用を完了し、値は返さない。
   */
  get(key: string): MermaidRenderResult | undefined {
    const result = this.entries.get(key);
    if (!result) return undefined;
    this.entries.delete(key);
    this.entries.set(key, result);
    return result;
  }

  /**
   * Markdownプレビューのコールバックとしてkeyを処理する。
   * @param key - Markdownプレビューの対象や分岐を識別する値。
   * @param result - Markdownプレビューへ渡す入力。
   * @returns 副作用を完了し、値は返さない。
   */
  set(key: string, result: MermaidRenderResult): void {
    const previous = this.entries.get(key);
    if (previous) {
      this.entries.delete(key);
      this.release(previous);
    }
    this.entries.set(key, result);
    this.retain(result);
    while (
      this.entries.size > MERMAID_CACHE_ENTRY_LIMIT ||
      this.totalBytes > MERMAID_CACHE_BYTE_LIMIT
    ) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const removed = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      if (removed) this.release(removed);
    }
  }

  /**
   * Markdownプレビューのretainを処理し、呼び出し側へ結果または副作用を返す。
   * @param result - Markdownプレビューへ渡す入力。
   * @returns 副作用を完了し、値は返さない。
   */
  private retain(result: MermaidRenderResult): void {
    const retained = this.retained.get(result);
    if (retained) {
      retained.references += 1;
      return;
    }
    const bytes = estimateMermaidResultBytes(result);
    this.retained.set(result, { bytes, references: 1 });
    this.totalBytes += bytes;
  }

  /**
   * Markdownプレビューの処理またはリソースを終了し、後続利用可能な状態へ戻す。
   * @param result - Markdownプレビューへ渡す入力。
   * @returns 副作用を完了し、値は返さない。
   */
  private release(result: MermaidRenderResult): void {
    const retained = this.retained.get(result);
    if (!retained) return;
    retained.references -= 1;
    if (retained.references > 0) return;
    this.retained.delete(result);
    this.totalBytes -= retained.bytes;
  }
}

/**
 * Markdownプレビューの寸法、容量、位置、または計測値を求める。
 * @param result - Markdownプレビューへ渡す入力。
 * @returns Markdownプレビューで利用する数値。
 */
function estimateMermaidResultBytes(result: MermaidRenderResult): number {
  return (
    (result.svg.length +
      result.ariaLabel.length +
      (result.pngBase64?.length ?? 0)) *
      2 +
    result.interactions.reduce(
      /**
       * 要素を順に加算して累積値を求める。
       * @param total - 累積値へ加算する要素。
       * @param interaction - 累積値へ加算する要素。
       * @returns 要素を集約した累積値。
       */
      (total, interaction) =>
        total +
        (interaction.text.length + (interaction.href?.length ?? 0)) * 2 +
        64,
      0,
    )
  );
}

/**
 * Markdownプレビューの入力を構造化した値へ変換する。
 * @param base64 - 画像または出力データをBase64で表した本文。
 * @returns Markdownプレビューの非同期処理で得られる結果。
 */
async function decodeBase64Png(base64: string): Promise<Blob> {
  const chunks: ArrayBuffer[] = [];
  // Base64全体へのatobは巨大な一時文字列を同期生成してUIを停止させる。
  // 4文字境界のチャンクごとにデコードし、各チャンク後にイベントループへ戻す。
  const base64ChunkSize = 256 * 1024;
  for (let offset = 0; offset < base64.length; offset += base64ChunkSize) {
    const binary = window.atob(base64.slice(offset, offset + base64ChunkSize));
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index);
    chunks.push(buffer);
    if (offset + base64ChunkSize < base64.length) {
      await new Promise<void>(
        /**
         * 遅延処理の完了または失敗を待機側へ通知する。
         * @param resolve - Promiseの成功を通知する関数。
         * @returns 非同期処理の完了値。
         */
        (resolve) => window.setTimeout(resolve, 0),
      );
    }
  }
  return new Blob(chunks, { type: "image/png" });
}

/**
 * Markdownプレビューの条件を判定する。
 * @returns 条件が成立したかを示す真偽値。
 */
function isPreviewInputActive(): boolean {
  return document.body.dataset.mveInputActive === "true";
}

/**
 * Markdownプレビューが指定条件を満たすまで待機する。
 * @param signal - 呼び出し側のキャンセルを通知するAbortSignal。
 * @returns 副作用を完了し、値は返さない。
 */
function waitForPreviewInputIdle(signal?: AbortSignal): Promise<void> {
  if (!isPreviewInputActive() || signal?.aborted) return Promise.resolve();
  return new Promise(
    /**
     * 非同期処理の成功結果を待機側へ通知する。
     * @param resolve - Promiseの成功を通知する関数。
     * @returns 非同期処理の完了値。
     */
    (resolve) => {
      const finish = /**
       * Markdownプレビューのfinishを処理し、呼び出し側へ結果または副作用を返す。
       * @returns 副作用を完了し、値は返さない。
       */ () => {
        window.removeEventListener("mve-preview-input-settled", finish);
        signal?.removeEventListener("abort", finish);
        resolve();
      };
      window.addEventListener("mve-preview-input-settled", finish, {
        once: true,
      });
      signal?.addEventListener("abort", finish, { once: true });
    },
  );
}

/**
 * UIイベントを受け取り、必要な処理を実行する。
 * @param root - ユーザー操作またはDOMから通知されたイベント。
 * @returns 副作用を完了し、値は返さない。
 */
function findScrollContainer(root: HTMLElement): HTMLElement | undefined {
  let parent = root.parentElement;
  while (parent && parent !== document.body) {
    const style = window.getComputedStyle(parent);
    if (/(auto|scroll|overlay)/.test(style.overflowY)) return parent;
    parent = parent.parentElement;
  }
  return undefined;
}

/**
 * Markdownプレビューの条件を判定する。
 * @param node - Markdownプレビューで走査または更新する要素。
 * @param scrollContainer - Markdownプレビューへ渡す入力。
 * @returns 条件が成立したかを示す真偽値。
 */
function isNearViewport(
  node: HTMLElement,
  scrollContainer: HTMLElement | undefined,
): boolean {
  const rect = node.getBoundingClientRect();
  const viewport = scrollContainer?.getBoundingClientRect();
  const viewportTop = viewport?.top ?? 0;
  const viewportBottom = viewport?.bottom ?? window.innerHeight;
  const margin = 900;
  return (
    rect.bottom >= viewportTop - margin && rect.top <= viewportBottom + margin
  );
}

/**
 * Markdownプレビューのrasterize・mermaid・previewを処理し、呼び出し側へ結果または副作用を返す。
 * @param svgBlob - Markdownプレビューで扱う文字列または本文。
 * @param svg - Mermaidが生成したSVG本文。
 * @param root - Markdownプレビューへ渡す入力。
 * @returns Markdownプレビューの非同期処理で得られる結果。
 */
async function rasterizeMermaidPreview(
  svgBlob: Blob,
  svg: string,
  root: HTMLElement,
): Promise<Blob> {
  if (
    typeof createImageBitmap !== "function" ||
    typeof OffscreenCanvas === "undefined"
  ) {
    throw new Error("Mermaid rasterization is unavailable.");
  }
  const aspectRatio = readSvgAspectRatio(svg);
  const pixelRatio = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
  let width = Math.max(
    1,
    Math.ceil(Math.min(1200, root.clientWidth || 1200) * pixelRatio),
  );
  let height = Math.max(1, Math.ceil(width / aspectRatio));
  const maximumDimension = 8192;
  const maximumPixels = 8 * 1024 * 1024;
  const scale = Math.min(
    1,
    maximumDimension / width,
    maximumDimension / height,
    Math.sqrt(maximumPixels / (width * height)),
  );
  width = Math.max(1, Math.floor(width * scale));
  height = Math.max(1, Math.floor(height * scale));
  const bitmap = await createImageBitmap(svgBlob, {
    resizeWidth: width,
    resizeHeight: height,
    resizeQuality: "high",
  });
  try {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Mermaid raster canvas is unavailable.");
    context.drawImage(bitmap, 0, 0, width, height);
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    bitmap.close();
  }
}

/**
 * Markdownプレビューから必要な値またはリソースを取得する。
 * @param svg - Mermaidが生成したSVG本文。
 * @returns Markdownプレビューで利用する数値。
 */
function readSvgAspectRatio(svg: string): number {
  const tag = svg.match(/<svg\b[^>]*>/i)?.[0] ?? "";
  const viewBox = tag
    .match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    viewBox?.length === 4 &&
    viewBox.every(Number.isFinite) &&
    viewBox[2] > 0 &&
    viewBox[3] > 0
  ) {
    return Math.min(100, Math.max(0.01, viewBox[2] / viewBox[3]));
  }
  const width = Number.parseFloat(
    tag.match(/\bwidth\s*=\s*["']([\d.]+)/i)?.[1] ?? "",
  );
  const height = Number.parseFloat(
    tag.match(/\bheight\s*=\s*["']([\d.]+)/i)?.[1] ?? "",
  );
  if (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  ) {
    return Math.min(100, Math.max(0.01, width / height));
  }
  return 16 / 9;
}

/**
 * Markdownプレビューのattach・virtual・mermaid・interactionsを処理し、呼び出し側へ結果または副作用を返す。
 * @param frame - Markdownプレビューへ渡す入力。
 * @param layer - Markdownプレビューの位置・寸法・件数・時間を表す数値。
 * @param interactions - 図中の文字・リンク操作領域の一覧。
 * @param scrollContainer - Markdownプレビューへ渡す入力。
 * @returns Markdownプレビューのattach・virtual・mermaid・interactionsが生成する結果。
 */
function attachVirtualMermaidInteractions(
  frame: HTMLElement,
  layer: HTMLElement,
  interactions: MermaidInteraction[],
  scrollContainer: HTMLElement | undefined,
): () => void {
  const elements = new Map<number, HTMLElement>();
  let desired = new Set<number>();
  let frameRequest = 0;
  let appendTimer: number | undefined;
  let generation = 0;

  const createElement = /**
   * Markdownプレビューで使う値または実行環境を組み立てる。
   * @param interaction - Markdownプレビューへ渡す入力。
   * @param index - 配列・行列・文字列の要素位置を示す番号。
   * @returns Markdownプレビューで生成または変換した値。
   */ (interaction: MermaidInteraction, index: number): HTMLElement => {
    const element =
      interaction.type === "link"
        ? document.createElement("a")
        : document.createElement("span");
    element.className = `mermaid-interaction mermaid-interaction-${interaction.type}`;
    element.dataset.mveInteractionIndex = String(index);
    element.textContent = interaction.text;
    element.style.left = `${interaction.left * 100}%`;
    element.style.top = `${interaction.top * 100}%`;
    element.style.width = `${interaction.width * 100}%`;
    element.style.height = `${interaction.height * 100}%`;
    if (element instanceof HTMLAnchorElement && interaction.href) {
      element.href = interaction.href;
      element.setAttribute("aria-label", interaction.text);
    } else {
      element.setAttribute("aria-hidden", "true");
    }
    return element;
  };

  const appendChunk = /**
   * Markdownプレビューのappend・chunkを処理し、呼び出し側へ結果または副作用を返す。
   * @param expectedGeneration - Markdownプレビューの位置・寸法・件数・時間を表す数値。
   * @param pending - Markdownプレビューで扱う数値。
   * @returns Markdownプレビューのappend・chunkが生成する結果。
   */ (expectedGeneration: number, pending: number[]) => {
    appendTimer = undefined;
    if (expectedGeneration !== generation || !frame.isConnected) return;
    const startedAt = performance.now();
    const fragment = document.createDocumentFragment();
    let appended = 0;
    while (
      pending.length &&
      appended < 8 &&
      performance.now() - startedAt < 2
    ) {
      const index = pending.shift() as number;
      if (!desired.has(index) || elements.has(index)) continue;
      const element = createElement(interactions[index], index);
      elements.set(index, element);
      fragment.append(element);
      appended += 1;
    }
    layer.append(fragment);
    if (pending.length) {
      appendTimer = window.setTimeout(
        /**
         * 指定時間の経過後に後続処理を実行する。
         * @returns 副作用を完了し、値は返さない。
         */
        () => appendChunk(expectedGeneration, pending),
        0,
      );
    }
  };

  const update = /**
   * Markdownプレビューの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @returns 副作用を完了し、値は返さない。
   */ () => {
    frameRequest = 0;
    if (!frame.isConnected || isPreviewInputActive()) return;
    generation += 1;
    if (appendTimer !== undefined) {
      window.clearTimeout(appendTimer);
      appendTimer = undefined;
    }
    const frameBounds = frame.getBoundingClientRect();
    const viewportBounds = scrollContainer?.getBoundingClientRect();
    const viewportTop = (viewportBounds?.top ?? 0) - 300;
    const viewportBottom = (viewportBounds?.bottom ?? window.innerHeight) + 300;
    const nextDesired = new Set<number>();
    interactions.forEach(
      /**
       * interactionごとにmaxを実行する。
       * @param interaction - interactionのtopを参照する走査対象。
       * @param index - 配列・行列・文字列の要素位置を示す番号。
       * @returns 副作用を完了し、値は返さない。
       */
      (interaction, index) => {
        const top = frameBounds.top + interaction.top * frameBounds.height;
        const bottom =
          top + Math.max(1, interaction.height * frameBounds.height);
        if (bottom >= viewportTop && top <= viewportBottom)
          nextDesired.add(index);
      },
    );
    desired = nextDesired;
    const selection = window.getSelection();
    elements.forEach(
      /**
       * 要素ごとにifを実行する。
       * @param element - 要素のcontainsを参照する走査対象。
       * @param index - 配列・行列・文字列の要素位置を示す番号。
       * @returns 副作用を完了し、値は返さない。
       */
      (element, index) => {
        if (desired.has(index)) return;
        const selectionUsesElement = Boolean(
          selection &&
          ((selection.anchorNode && element.contains(selection.anchorNode)) ||
            (selection.focusNode && element.contains(selection.focusNode))),
        );
        if (selectionUsesElement) return;
        element.remove();
        elements.delete(index);
      },
    );
    const pending = Array.from(desired).filter(
      /**
       * 条件を満たす位置だけを残す。
       * @param index - 配列・行列・文字列の要素位置を示す番号。
       * @returns 条件を満たした要素だけを含む一覧。
       */
      (index) => !elements.has(index),
    );
    if (pending.length) appendChunk(generation, pending);
  };

  const schedule = /**
   * Markdownプレビューの処理順序と完了状態を管理する。
   * @returns Markdownプレビューのscheduleが生成する結果。
   */ () => {
    if (frameRequest || isPreviewInputActive()) return;
    frameRequest = window.requestAnimationFrame(update);
  };

  const pauseForInput = /**
   * Markdownプレビューのpause・for・inputを処理し、呼び出し側へ結果または副作用を返す。
   * @returns Markdownプレビューのpause・for・inputが生成する結果。
   */ () => {
    if (frameRequest) {
      window.cancelAnimationFrame(frameRequest);
      frameRequest = 0;
    }
    if (appendTimer !== undefined) {
      window.clearTimeout(appendTimer);
      appendTimer = undefined;
    }
  };

  const cleanup = /**
   * Markdownプレビューから不要または危険な情報を除去する。
   * @returns 副作用を完了し、値は返さない。
   */ () => {
    if (frameRequest) window.cancelAnimationFrame(frameRequest);
    if (appendTimer !== undefined) window.clearTimeout(appendTimer);
    scrollContainer?.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("mve-preview-input-active", pauseForInput);
    window.removeEventListener("mve-preview-input-settled", schedule);
    elements.clear();
  };
  scrollContainer?.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("mve-preview-input-active", pauseForInput);
  window.addEventListener("mve-preview-input-settled", schedule);
  schedule();
  return cleanup;
}

/**
 * Markdownプレビューの入力を検証し、表示または保存に使う形式へ変換する。
 * @param imageIndex - Markdownプレビューの位置・寸法・件数・時間を表す数値。
 * @param width - 表示領域または列の幅。
 * @returns Markdownプレビューのimage・callback・refが生成する結果。
 */
type ImageCallbackRef = React.MutableRefObject<
  ((imageIndex: number, width: number) => void) | undefined
>;
/**
 * Markdownプレビューの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param imageIndex - Markdownプレビューの位置・寸法・件数・時間を表す数値。
 * @returns Markdownプレビューのreset・callback・refが生成する結果。
 */
type ResetCallbackRef = React.MutableRefObject<
  ((imageIndex: number) => void) | undefined
>;
/**
 * Markdownプレビューのalignment・callback・refを処理し、呼び出し側へ結果または副作用を返す。
 * @param imageIndex - Markdownプレビューの位置・寸法・件数・時間を表す数値。
 * @param alignment - Markdownプレビューへ渡す入力。
 * @returns Markdownプレビューのalignment・callback・refが生成する結果。
 */
type AlignmentCallbackRef = React.MutableRefObject<
  ((imageIndex: number, alignment: ImageAlignment) => void) | undefined
>;

/**
 * Markdownプレビューのenhance・resizable・imagesを処理し、呼び出し側へ結果または副作用を返す。
 * @param root - Markdownプレビューへ渡す入力。
 * @param onResizeRef - Markdownプレビューの位置・寸法・件数・時間を表す数値。
 * @param onResetRef - Markdownプレビューへ渡す入力。
 * @param onAlignRef - Markdownプレビューへ渡す入力。
 * @param onlyNearViewport - Markdownプレビューの位置・寸法・件数・時間を表す数値。
 * @param candidates - Markdownプレビューの対象や分岐を識別する値。
 * @returns Markdownプレビューのenhance・resizable・imagesが生成する結果。
 */
function enhanceResizableImages(
  root: HTMLElement,
  onResizeRef: ImageCallbackRef,
  onResetRef: ResetCallbackRef,
  onAlignRef: AlignmentCallbackRef,
  onlyNearViewport = false,
  candidates?: HTMLImageElement[],
): (() => void) | undefined {
  const cleanups: Array<() => void> = [];
  const scrollContainer = onlyNearViewport
    ? findScrollContainer(root)
    : undefined;
  const images = (
    candidates ??
    Array.from(
      root.querySelectorAll<HTMLImageElement>(
        'img[data-mve-image-index][data-mve-resizable="true"]:not([data-mve-enhanced="true"])',
      ),
    )
  ).filter(
    /**
     * 条件を満たす画像だけを残す。
     * @param image - Markdownプレビューへ渡す入力。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (image) => !onlyNearViewport || isNearViewport(image, scrollContainer),
  );

  images.forEach(
    /**
     * 画像ごとにifを実行する。
     * @param image - 画像のdatasetを参照する走査対象。
     * @returns 副作用を完了し、値は返さない。
     */
    (image) => {
      if (image.dataset.mveEnhanced === "true" || !image.parentElement) return;
      const imageIndex = Number.parseInt(image.dataset.mveImageIndex ?? "", 10);
      if (!Number.isFinite(imageIndex)) return;

      const wrapperTarget =
        image.parentElement?.tagName.toLowerCase() === "picture"
          ? image.parentElement
          : image;
      const targetParent = wrapperTarget?.parentElement;
      if (!wrapperTarget || !targetParent) return;
      const originalStyle = image.getAttribute("style");
      const originalWrapperStyle =
        wrapperTarget === image
          ? undefined
          : wrapperTarget.getAttribute("style");
      const frame = document.createElement("span");
      frame.className = "mve-image-frame";
      frame.dataset.mveImageIndex = String(imageIndex);
      const imageAlignment = normalizeImageAlignment(
        image.dataset.mveImageAlign,
      );
      frame.dataset.mveImageAlign = imageAlignment;
      image.dataset.mveEnhanced = "true";
      targetParent.insertBefore(frame, wrapperTarget);
      frame.appendChild(wrapperTarget);

      const badge = document.createElement("span");
      badge.className = "mve-image-badge";
      frame.appendChild(badge);

      // ソースに保存されたwidthは、画像の自然幅や現在の未ロード状態より優先する。
      const preferredWidth =
        getExplicitImageWidth(image) ||
        getRenderedImageWidth(image, root) ||
        image.naturalWidth ||
        320;
      frame.style.width = `${Math.max(1, Math.min(preferredWidth, getAvailableImageWidth(root)))}px`;
      if (wrapperTarget !== image) {
        wrapperTarget.style.display = "block";
        wrapperTarget.style.width = "100%";
      }
      image.style.display = "block";
      image.style.width = "100%";
      image.style.maxWidth = "100%";
      image.style.height = "auto";

      const updateBadge = /**
       * Markdownプレビューの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
       * @returns 副作用を完了し、値は返さない。
       */ () => {
        badge.textContent = `${getLogicalElementWidth(image, root) || preferredWidth}px`;
      };
      updateBadge();

      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "mve-image-handle";
      handle.setAttribute("aria-label", "画像をリサイズ");
      handle.title = "画像をリサイズ";
      frame.appendChild(handle);
      const pointerCleanup = attachResizePointer(
        handle,
        frame,
        image,
        imageIndex,
        root,
        updateBadge,
        onResizeRef,
      );

      const alignmentActions = document.createElement("span");
      alignmentActions.className = "mve-image-align-actions";
      const alignmentLabels: Array<[ImageAlignment, string, string]> = [
        ["left", "左揃え", "左"],
        ["center", "中央揃え", "中"],
        ["right", "右揃え", "右"],
      ];
      alignmentLabels.forEach(
        /**
         * 設定ごとにcreate・elementを実行する。
         * @param options - DOMから抽出した設定。
         * @returns 副作用を完了し、値は返さない。
         */
        ([alignment, label, text]) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "mve-image-align-button";
          button.textContent = text;
          button.setAttribute("aria-label", label);
          button.title = label;
          button.dataset.active =
            alignment === imageAlignment ? "true" : "false";

          const applyAlignment = /**
           * Markdownプレビューの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
           * @param event - ユーザー操作またはDOMから通知されたイベント。
           * @returns 副作用を完了し、値は返さない。
           */ (event: Event) => {
            mveDebug("image-alignment-event", {
              eventType: event.type,
              imageIndex,
              alignment,
              title: button.title,
            });
            event.preventDefault();
            event.stopPropagation();
            frame.dataset.mveImageAlign = alignment;
            alignmentActions
              .querySelectorAll<HTMLButtonElement>(".mve-image-align-button")
              .forEach(
                /**
                 * candidateごとに必要な副作用を実行する。
                 * @param candidate - candidateのdatasetを参照する走査対象。
                 * @returns 副作用を完了し、値は返さない。
                 */
                (candidate) => {
                  candidate.dataset.active =
                    candidate === button ? "true" : "false";
                },
              );
            onAlignRef.current?.(imageIndex, alignment);
          };
          button.addEventListener("click", applyAlignment);
          alignmentActions.appendChild(button);
        },
      );
      frame.appendChild(alignmentActions);

      let resetButton: HTMLButtonElement | undefined;
      if (image.dataset.mveCanReset === "true" && onResetRef.current) {
        resetButton = document.createElement("button");
        resetButton.type = "button";
        resetButton.className = "mve-image-reset";
        resetButton.textContent = "↺";
        resetButton.setAttribute("aria-label", "画像サイズをリセット");
        resetButton.title = "画像サイズをリセット";
        resetButton.addEventListener(
          "click",
          /**
           * UIイベントを表示または編集状態へ反映する。
           * @param event - ユーザー操作またはDOMから通知されたイベント。
           * @returns 副作用を完了し、値は返さない。
           */
          (event) => {
            event.preventDefault();
            event.stopPropagation();
            onResetRef.current?.(imageIndex);
          },
        );
        frame.appendChild(resetButton);
      }

      const handleImageLoad = /**
       * Markdownプレビューのイベントまたはメッセージを受け取り、状態を更新する。
       * @returns 副作用を完了し、値は返さない。
       */ () => {
        // width属性を持つ画像は、loadイベント後も明示幅を維持する。
        const nextWidth = Math.max(
          1,
          Math.min(
            getExplicitImageWidth(image) ||
              getRenderedImageWidth(image, root) ||
              image.naturalWidth ||
              preferredWidth,
            getAvailableImageWidth(root),
          ),
        );
        frame.style.width = `${nextWidth}px`;
        updateBadge();
      };
      image.addEventListener("load", handleImageLoad);

      cleanups.push(
        /**
         * UIイベントを表示または編集状態へ反映する。
         * @returns 副作用を完了し、値は返さない。
         */
        () => {
          pointerCleanup();
          image.removeEventListener("load", handleImageLoad);
          if (frame.parentElement) frame.replaceWith(wrapperTarget);
          image.dataset.mveEnhanced = "";
          if (originalStyle === null) image.removeAttribute("style");
          else image.setAttribute("style", originalStyle);
          if (wrapperTarget !== image) {
            if (originalWrapperStyle === null)
              wrapperTarget.removeAttribute("style");
            else if (originalWrapperStyle !== undefined)
              wrapperTarget.setAttribute("style", originalWrapperStyle);
          }
          resetButton?.remove();
        },
      );
    },
  );

  return cleanups.length
    ? /**
       * 要素をfor・eachへ渡し、Markdownプレビューの結果または副作用を処理する。
       * @returns 副作用を完了し、値は返さない。
       */
      () =>
        cleanups.forEach(
          /**
           * cleanupごとにcleanupを実行する。
           * @param cleanup - Markdownプレビューへ渡す入力。
           * @returns 副作用を完了し、値は返さない。
           */
          (cleanup) => cleanup(),
        )
    : undefined;
}

/**
 * Markdownプレビューのattach・resize・pointerを処理し、呼び出し側へ結果または副作用を返す。
 * @param handle - Markdownプレビューへ渡す入力。
 * @param frame - Markdownプレビューへ渡す入力。
 * @param image - Markdownプレビューへ渡す入力。
 * @param imageIndex - Markdownプレビューの位置・寸法・件数・時間を表す数値。
 * @param root - Markdownプレビューへ渡す入力。
 * @param updateBadge - Markdownプレビューへ渡す入力。
 * @param onResizeRef - Markdownプレビューの位置・寸法・件数・時間を表す数値。
 * @returns Markdownプレビューのattach・resize・pointerが生成する結果。
 */
function attachResizePointer(
  handle: HTMLButtonElement,
  frame: HTMLElement,
  image: HTMLImageElement,
  imageIndex: number,
  root: HTMLElement,
  updateBadge: () => void,
  onResizeRef: ImageCallbackRef,
): () => void {
  let activeCleanup: (() => void) | undefined;

  const onPointerDown = /**
   * Markdownプレビューのイベントまたはメッセージを受け取り、状態を更新する。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @returns Markdownプレビューのon・pointer・downが生成する結果。
   */ (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const previewImageZoom = getPreviewImageZoom(root);
    const startWidth =
      getLogicalElementWidth(frame, root) ||
      getLogicalElementWidth(image, root);
    const minWidth = 48;
    const maxWidth = getAvailableImageWidth(root);
    const originalFrameWidth = frame.style.width;
    frame.classList.add("is-resizing");
    handle.setPointerCapture(pointerId);

    const onPointerMove = /**
     * Markdownプレビューのイベントまたはメッセージを受け取り、状態を更新する。
     * @param moveEvent - Markdownプレビューへ届いたユーザー操作またはDOMイベント。
     * @returns Markdownプレビューのon・pointer・moveが生成する結果。
     */ (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const nextWidth = Math.min(
        maxWidth,
        Math.max(
          minWidth,
          Math.round(
            startWidth + (moveEvent.clientX - startX) / previewImageZoom,
          ),
        ),
      );
      frame.style.width = `${nextWidth}px`;
      updateBadge();
    };

    const finish = /**
     * Markdownプレビューのfinishを処理し、呼び出し側へ結果または副作用を返す。
     * @param commit - Markdownプレビューの条件を示すフラグ。
     * @returns Markdownプレビューのfinishが生成する結果。
     */ (commit: boolean) =>
      /**
       * finish・eventをifへ渡し、Markdownプレビューの結果または副作用を処理する。
       * @param finishEvent - Markdownプレビューへ届いたユーザー操作またはDOMイベント。
       * @returns Markdownプレビューのコールバックが生成する結果。
       */
      (finishEvent: PointerEvent) => {
        if (finishEvent.pointerId !== pointerId) return;
        handle.releasePointerCapture(pointerId);
        handle.removeEventListener("pointermove", onPointerMove);
        handle.removeEventListener("pointerup", onPointerUp);
        handle.removeEventListener("pointercancel", onPointerCancel);
        frame.classList.remove("is-resizing");
        activeCleanup = undefined;
        if (!commit) {
          frame.style.width = originalFrameWidth;
          updateBadge();
          return;
        }
        const width = Math.min(
          maxWidth,
          Math.max(minWidth, getLogicalElementWidth(frame, root)),
        );
        onResizeRef.current?.(imageIndex, width);
      };
    const onPointerUp = finish(true);
    const onPointerCancel = finish(false);
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp);
    handle.addEventListener("pointercancel", onPointerCancel);
    activeCleanup =
      /**
       * イベントでremove・event・listenerを実行する。
       * @returns 副作用を完了し、値は返さない。
       */
      () => {
        handle.removeEventListener("pointermove", onPointerMove);
        handle.removeEventListener("pointerup", onPointerUp);
        handle.removeEventListener("pointercancel", onPointerCancel);
        if (handle.hasPointerCapture(pointerId))
          handle.releasePointerCapture(pointerId);
      };
  };

  handle.addEventListener("pointerdown", onPointerDown);
  /**
   * イベントでremove・event・listenerを実行する。
   * @returns 副作用を完了し、値は返さない。
   */
  return () => {
    handle.removeEventListener("pointerdown", onPointerDown);
    activeCleanup?.();
  };
}

/**
 * Markdownプレビューから必要な値またはリソースを取得する。
 * @param image - Markdownプレビューへ渡す入力。
 * @param root - Markdownプレビューへ渡す入力。
 * @returns Markdownプレビューで利用する数値。
 */
function getRenderedImageWidth(
  image: HTMLImageElement,
  root: HTMLElement,
): number {
  return getLogicalElementWidth(image, root);
}

/**
 * Markdownプレビューから必要な値またはリソースを取得する。
 * @param root - Markdownプレビューへ渡す入力。
 * @returns Markdownプレビューで利用する数値。
 */
function getPreviewImageZoom(root: HTMLElement): number {
  const value = Number.parseFloat(root.dataset.mveImageZoom ?? "");
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * Markdownプレビューから必要な値またはリソースを取得する。
 * @param element - 寸法または属性を読み取るDOM要素。
 * @param root - Markdownプレビューへ渡す入力。
 * @returns Markdownプレビューで利用する数値。
 */
function getLogicalElementWidth(
  element: HTMLElement,
  root: HTMLElement,
): number {
  const width = element.getBoundingClientRect().width;
  if (!(width > 0)) return 0;
  return Math.round(width / getPreviewImageZoom(root));
}

/**
 * Markdownプレビューから必要な値またはリソースを取得する。
 * @param image - Markdownプレビューへ渡す入力。
 * @returns Markdownプレビューで利用する数値。
 */
function getExplicitImageWidth(image: HTMLImageElement): number {
  const value = Number.parseFloat(image.getAttribute("width") ?? "");
  return Number.isFinite(value) ? value : 0;
}

/**
 * Markdownプレビューから必要な値またはリソースを取得する。
 * @param root - Markdownプレビューへ渡す入力。
 * @returns Markdownプレビューで利用する数値。
 */
function getAvailableImageWidth(root: HTMLElement): number {
  const styles = window.getComputedStyle(root);
  const padding =
    parseFloat(styles.paddingLeft || "0") +
    parseFloat(styles.paddingRight || "0");
  const scrollbar = root.offsetWidth - root.clientWidth;
  return Math.max(120, Math.floor(root.clientWidth - padding - scrollbar));
}

/**
 * Markdownプレビューの入力を許可された形式へ整える。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns Markdownプレビューで生成または変換した値。
 */
function normalizeImageAlignment(value: string | undefined): ImageAlignment {
  return value === "center" || value === "right" ? value : "left";
}

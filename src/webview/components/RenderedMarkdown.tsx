/**
 * @fileoverview 変換済みMarkdownをDOMへ描画し、画像・リンク・見出し・表の編集操作をプレビューへ接続する。
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ImageAlignment } from "../../shared/imageResize";
import type { MermaidInteraction, WebviewSettings } from "../../shared/protocol";
import type { Messages } from "../../shared/messages";
import { getMessages } from "../../shared/messages";
import { renderMarkdownFallback } from "../markdown/markdownFallback";
import {
  mermaidErrorMessage,
  renderMermaidSvg,
  type MermaidRenderResult,
} from "../markdown/mermaidRenderer";
import { mveDebug } from "../runtime/debug";

/**
 * Markdownプレビューで扱う値の種類と境界を表す型。
 */
export type InspectorTarget =
  | {
      /**
       * Mermaid図のソースをインスペクターで表示する対象です。
       */
      type: "mermaid";
      /**
       * 解析・描画・変換の起点となる本文。
       */
      source: string;
    }
  | {
      /**
       * 数式のソースをインスペクターで表示する対象です。
       */
      type: "math";
      /**
       * 解析・描画・変換の起点となる本文。
       */
      source: string;
    }
  | {
      /**
       * 画像の参照先をインスペクターで表示する対象です。
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
       * document.images内でこの画像要素に対応する0始まりの番号です。
       */
      imageIndex?: number;
    };

/**
 * Markdownプレビューへ渡す本文、表示設定、操作イベントです。
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
   * プレビュー全体の外側要素へ追加するCSSクラス。
   */
  className?: string;

  /**
   * プレビュー画像の表示倍率。未指定時は通常倍率で描画する。
   */
  imageZoom?: number;
  /**
   * プレビューで選択された画像、数式、MermaidのInspector対象を親へ通知する。
   * @param target - Inspectorで開く対象の種別と本文などを含む情報。
   */
  onInspect?: (target: InspectorTarget) => void;
  /**
   * プレビュー画像の幅変更を親コンポーネントへ通知する。
   * @param imageIndex - 操作するMarkdown画像参照の0始まりインデックス。
   * @param width - 表示領域または列の幅。
   */
  onImageResize?: (imageIndex: number, width: number) => void;
  /**
   * プレビュー画像のサイズを既定値へ戻す要求を親コンポーネントへ通知する。
   * @param imageIndex - 操作するMarkdown画像参照の0始まりインデックス。
   */
  onImageReset?: (imageIndex: number) => void;
  /**
    * 指定画像へ左・中央・右の配置を適用する操作を親へ通知する。
   * @param imageIndex - 操作するMarkdown画像参照の0始まりインデックス。
   * @param alignment - 画像へ適用する配置（left/center/right）。
   */
  onImageAlign?: (imageIndex: number, alignment: ImageAlignment) => void;
  /**
    * Markdownリンクの遷移先とワークスペース基準リンクかどうかを親へ渡す。
   * @param href - リンク操作領域の遷移先URI。
   */
  onNavigate?: (href: string, workspaceRooted?: boolean) => void;
  /**
    * 対象DOM要素のMarkdown描画完了を親へ通知する。
   * @param element - 寸法または属性を読み取るDOM要素。
   */
  onRendered?: (element: HTMLElement) => void;
  /**
    * Mermaid図の描画完了を親へ通知する。
   */
  onMermaidRendered?: () => void;

  /**
   * 初期Markdown表示後にMermaid描画を遅延するかを指定する。
   */
  deferMermaid?: boolean;
}

/**
 * Markdown本文と表示状態からプレビューのReact要素を描画する。
 * @returns Markdownプレビューを表すReact要素。
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
         * この描画要求と関連リソースを中断するAbortController。
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
     */
    () =>

      () => {
        mermaidRenderControllersRef.current.forEach(
          /**
           * 設定ごとにabortを実行する。
           */
          ({ controller }) => controller.abort(),
        );
        mermaidRenderControllersRef.current.clear();
        mermaidObjectUrlsRef.current.forEach((url) =>
          URL.revokeObjectURL(url),
        );
        mermaidObjectUrlsRef.current.clear();
        mermaidInteractionManagersRef.current.forEach(
          /**
           * cleanupごとにcleanupを実行する。
           * @param cleanup - Mermaid図のイベントとインタラクション管理を解除する関数。
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
     */
    () => {
      // HTMLの更新を監視し、未処理のMermaidや画像の読み込み後にレイアウトを通知する。
      const root = rootRef.current;
      if (!root) return;
      const imageMessages = getMessages(settings.language).app.imageControls;
      // 表の短い項目名だけを改行禁止にし、長い先頭列の横溢れを防ぐ。
      root.querySelectorAll<HTMLTableElement>("table").forEach(
        /**
         * tableごとにfromを実行する。
         * @param table - tableのrowsを参照する走査対象。
         */
        (table) => {
          Array.from(table.rows).forEach(
            /**
             * 行ごとにifを実行する。
             * @param row - 行のcellsを参照する走査対象。
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
      interactionManagers.forEach((cleanup, node) => {
          if (node.isConnected) return;
          cleanup();
          interactionManagers.delete(node);
      });
      // 差分DOMで保持された同一図の描画は継続する。図ソース・テーマが変わった要求だけを破棄する。
      renderControllers.forEach((entry, node) => {
          const source = decodeURIComponent(node.dataset.mermaidSource ?? "");
          if (node.isConnected && entry.key === `${theme}\0${source}`) return;
          entry.controller.abort();
          renderControllers.delete(node);
          delete node.dataset.mermaidStatus;
      });

      const notifyRendered =  () => {
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
       * @param source - 現在の図ノードに対応するMermaidソース文字列。
       * @param rendered Mermaidレンダラーが返したSVGと描画状態。
       * @param isCurrent 描画結果を現在のプレビューへ適用できるか判定する関数。
       */ async (
        node: HTMLElement,
        source: string,
        rendered: MermaidRenderResult,
        isCurrent: () => boolean,
      ): Promise<void> => {
        const applyStartedAt = performance.now();

        const recordApplyDuration = (startedAt = applyStartedAt) => {
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
          rendered.ariaLabel ||
            getMessages(settings.language).renderer.mermaidDiagramLabel(
              source.split(/\r?\n/, 1)[0] ?? "",
            ),
        );
        const image = document.createElement("img");
        image.className = "mermaid-svg-image";
        image.alt = "";
        image.draggable = false;
        image.src = objectUrl;
        image.addEventListener(
          "load",

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
       * 未描画Mermaidノードを描画し、その状態をDOMへ反映する。
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

           */
          (node) =>
            !node.dataset.mermaidStatus &&
            (!deferMermaid || isNearViewport(node, scrollContainer)),
        );
        if (!pending.length) {
          if (
            !allNodes.some(
              /**

               * @param node - Markdownプレビューで走査または更新する要素。
               */
              (node) => node.dataset.mermaidStatus === "rendering",
            )
          ) {
            notifyRendered();
          }
          return allNodes.some(
            /**

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

           * @param node - Markdownプレビューで走査または更新する要素。
           * @returns 条件が成立したかを示す真偽値。
           */
          (node) => !node.dataset.mermaidStatus,
        );
      };

      const scheduleRenderNodes = /**
       * 遅延後にMermaid描画を1チャンク実行し、表示範囲内の残件があれば次のチャンクを予約する。
       * @param delay - 次のMermaid描画chunkを開始するまでの遅延（ミリ秒）。
       * @param restart - 既存の描画タイマーを解除して予約し直す場合true。
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
             */
            () => {
              renderTimer = undefined;
              void renderNodes().then(

                () => {
                  const hasNextForegroundNode = Array.from(
                    root.querySelectorAll<HTMLElement>(".mermaid"),
                  ).some(
                    /**
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
        * 対象画像にリサイズ・配置コントロールを追加し、解除処理を保存する。
        * @param candidates - 拡張処理を適用する候補画像一覧。undefinedなら全画像を走査する。
        */ (candidates?: HTMLImageElement[]) => {
        if (onImageResizeRef.current || onImageAlignRef.current) {
          const cleanup = enhanceResizableImages(
            root,
            imageMessages,
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
       * 対象画像を遅延拡張キューへ追加し、未予約なら次の処理チャンクを予約する。
       * @param imagesToEnhance - 遅延拡張キューへ登録する画像要素一覧。
        */ (imagesToEnhance: HTMLImageElement[]) => {
        imagesToEnhance.forEach(
          /**
           * 画像ごとに追加を実行する。
          * @param image - リサイズ操作の拡張処理キューへ追加する画像。
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
             * @param entries - 画像の表示範囲変化を通知したIntersectionObserverエントリ一覧。
             */
            (entries) => {
              if (cancelled) return;
              const visibleImages = entries
                .filter(
                  (entry) =>
                    entry.isIntersecting &&
                    entry.target instanceof HTMLImageElement,
                )
                .map(
                  (entry) => entry.target as HTMLImageElement,
                );
              visibleImages.forEach((image) =>
                imageEnhanceObserver?.unobserve(image),
              );
              if (visibleImages.length)
                scheduleImageEnhancements(visibleImages);
            },
            {
              root: scrollContainer,
              rootMargin: "600px 0px",
            },
          );
          resizableImages.forEach((image) =>
            imageEnhanceObserver?.observe(image),
          );
        } else {
          enhanceImages(resizableImages);
        }
      }
      // 画像の読み込み完了時に、変化したプレビューの大きさを親へ通知する。

      const imageLoaded = () => {
        notifyRendered();
      };
      images.forEach((image) => image.addEventListener("load", imageLoaded));

      const scheduleAfterViewportActivity = /**
       * Markdownプレビューの処理順序と完了状態を管理する。
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

      const pauseForInput = () => {
        // 入力中は高コストなMermaid描画と画像拡張のタイマーを止める。
        if (renderTimer !== undefined) {
          window.clearTimeout(renderTimer);
          renderTimer = undefined;
        }
        if (imageEnhanceTimer !== undefined) {
          window.clearTimeout(imageEnhanceTimer);
          imageEnhanceTimer = undefined;
        }
      };

      const resumeAfterInput = () => {
        // 入力確定後に描画を再開し、保留画像も拡張キューへ戻す。
        scheduleRenderNodes(120, true);
        if (pendingImageEnhancements.size) scheduleImageEnhancements([]);
      };
      window.addEventListener("mve-preview-input-active", pauseForInput);
      window.addEventListener("mve-preview-input-settled", resumeAfterInput);
      if (deferMermaid) onRenderedRef.current?.(root);
      scheduleRenderNodes();
      // effect解除時に監視・タイマー・イベントをすべて解放する。
      return () => {
        cancelled = true;
        if (renderTimer !== undefined) window.clearTimeout(renderTimer);
        if (imageEnhanceTimer !== undefined)
          window.clearTimeout(imageEnhanceTimer);
        pendingImageEnhancements.clear();
        resizeObserver.disconnect();
        imageEnhanceObserver?.disconnect();
        images.forEach((image) =>
          image.removeEventListener("load", imageLoaded),
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
           * @param cleanup - 画像リサイズ操作に登録したイベントを解除する関数。
           */
          (cleanup) => cleanup(),
        );
        // 差分更新で再利用したMermaid画像のBlob URLは維持し、DOMから消えた分だけ解放する。
        mermaidObjectUrls.forEach(
          /**
           * urlごとにifを実行する。
           * @param url - DOMから抽出したurl。
           */
          (url) => {
            if (
              Array.from(
                root.querySelectorAll<HTMLImageElement>(
                  "img.mermaid-svg-image",
                ),
              ).some(
                /**

                 * @param image - 解放前にsrcの参照中かを確認するMermaid画像要素。
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
   * @param event - Mermaid・数式・画像のsourceをInspectorで開くdouble-click event。
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
   * @param event - コードコピーまたはMarkdown linkの遷移を処理するpreview click event。
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
        let id = href.slice(1);
        try {
          id = decodeURIComponent(id);
        } catch {
          // 不正な%エスケープを含むIDも文字列として照合する。
        }
        rootRef.current
          ?.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        // Webviewのネイティブ遷移を許すと、ローカルMarkdownがブラウザへ渡るため、
        // 外部URLを含めてホスト側のリンク処理へ必ず委譲する。
        event.preventDefault();
        onNavigate?.(href, anchor.dataset.mveWorkspaceRooted === "true");
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
 * Markdown、変換済みHTML、設定を使い、描画完了後にプレビューを表示する。
 * @param props 描画するMarkdown、変換済みHTML、表示設定、完了通知を含むプロパティ。
 * @returns 変換済みHTMLの描画領域。処理中または失敗時は対応する状態表示を含む。
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
     * ワークスペース信頼設定に基づき外部画像の読込を許可する状態。
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
           * @param value - Markdown本文から生成されたプレビューHTML。
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
           * @param reason - 処理を中断または失敗させた理由。
           */
          (reason: unknown) => {
            if (!cancelled) setError(reason);
          },
        );
      // 入力または設定が変わって古い非同期結果が戻っても、破棄済みstateを更新しない。
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
 * 表示済みDOM要素と対応するMarkdown本文範囲を結び付けます。
 */
interface RenderedDomBlock {
  /**
   * Markdownプレビューで扱うsignatureの文字列。
   */
  signature: string;

  /**
   * 描画済みブロックに対応する既存DOM要素。
   */
  node: Element;
}

/**
 * 新しいトップレベルHTML要素を署名化し、既存DOMと比較して変更箇所だけを更新する。
 * @param root - 前回描画済みブロックを含むプレビューのルート要素。
 * @param previous - 前回DOMと対応させて差分再描画するsignature付きブロック一覧。
 * @param html - 表示または出力するHTML本文。
 * @returns HTMLから作成したトップレベルDOMブロックと各ブロックの署名一覧。
 */
function reconcileRenderedBlocks(
  root: HTMLElement,
  previous: RenderedDomBlock[],
  html: string,
): RenderedDomBlock[] {
  const template = document.createElement("template");
  template.innerHTML = html;
  const next = Array.from(template.content.children).map(
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

       * @param entry - Markdownプレビューで走査または更新する要素。
       * @param index - 走査中の配列における0始まりの要素位置。
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
 * 再描画後も同じソースの完了済みMermaidノードを再利用する。
 * @param previousBlocks - 完了済みMermaid DOMを再利用する前回描画ブロック一覧。
 * @param nextBlocks 再利用候補を探す新しい描画ブロック。
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
 * プレビュー内のブロック要素と属性から差分判定用の署名を作る。
 * @param node - Markdownプレビューで走査または更新する要素。

 */
function renderedBlockSignature(node: Element): string {
  if (node.classList.contains("markdown-source-block")) {
    return `source:${node.className}\0${node.innerHTML}`;
  }
  return `other:${node.outerHTML}`;
}

/**
 * 新しい描画ブロックの属性を現在のDOMブロックへ反映し、ランタイム属性は保持する。
 * @param current - Mermaidのランタイム属性を維持しながら更新する既存DOMブロック。
 * @param next 属性を反映する新しい描画ブロック。
 */
function syncRenderedBlockAttributes(current: Element, next: Element): void {
  const preservedRuntimeAttributes = current.classList.contains("mermaid")
    ? ["data-mermaid-status", "data-mve-export-svg"]
        .map((name) => [name, current.getAttribute(name)] as const)
        .filter(
          (entry): entry is readonly [string, string] => entry[1] !== null,
        )
    : [];
  Array.from(current.attributes).forEach((attribute) =>
    current.removeAttribute(attribute.name),
  );
  Array.from(next.attributes).forEach((attribute) =>
    current.setAttribute(attribute.name, attribute.value),
  );
  preservedRuntimeAttributes.forEach(([name, value]) =>
    current.setAttribute(name, value),
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
   * 描画結果をLRU順で検索し、エントリ数・概算容量・利用中URLの参照を管理する。
 */
class MermaidResultCache {
  /**
   * render signatureをキーにしたMermaid描画結果のMap。
   */
  private readonly entries = new Map<string, MermaidRenderResult>();

  /**
    * LRUから外れた後も利用中のSVG/blob URLを解放しないための参照情報。
   */
  private readonly retained = new Map<
    MermaidRenderResult,
    {
      /**
       * SVGとPNGのBlob URLを合わせた概算バイト数。
       */
      bytes: number;
      /**
        * 同じ描画結果を利用中のキャッシュ参照数。0になると容量計測から外す。
       */
      references: number;
    }
  >();

  /**
    * retainedに記録された描画結果の概算総容量。上限判定に使う。
   */
  private totalBytes = 0;

  /**
   * キャッシュキーに対応する完了済みMermaid描画結果を取得する。
   * @param key - Markdownプレビューの対象や分岐を識別する値。
   * @returns キャッシュ済み描画結果。キーがなければundefined。
   */
  get(key: string): MermaidRenderResult | undefined {
    const result = this.entries.get(key);
    if (!result) return undefined;
    this.entries.delete(key);
    this.entries.set(key, result);
    return result;
  }

  /**

   * @param key - Markdownプレビューの対象や分岐を識別する値。
   * @param result - LRUキャッシュへ登録するMermaid描画結果。
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
    * LRUから外れても参照中のURLを解放しないよう保持数を加算する。
   * @param result - 保持参照を1件増やすMermaid描画結果。
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
   * @param result - 保持参照を1件減らし、不要なら容量計測から除くMermaid描画結果。
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
 * @param result - キャッシュ容量を見積もるMermaid描画結果。

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
 * PNGのBase64データをチャンク単位でデコードし、画像Blobを作る。
 * @param base64 - 画像または出力データをBase64で表した本文。
 * @returns デコードしたPNG画像を含むBlob。
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
 */
function waitForPreviewInputIdle(signal?: AbortSignal): Promise<void> {
  if (!isPreviewInputActive() || signal?.aborted) return Promise.resolve();
  return new Promise(
    /**
     * 非同期処理の成功結果を待機側へ通知する。
     * @param resolve - Promiseの成功を通知する関数。
     */
    (resolve) => {
      const finish =  () => {
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
 * rootから祖先をたどり、実際にスクロールする要素を探す。
 * @param root スクロール領域をたどり始めるプレビュー要素。
 * @returns スクロール可能な祖先要素。見つからない場合はundefined。
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
 * @param scrollContainer - 近接判定に使うスクロール領域。未指定ならwindowの表示領域。
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
 * Mermaid SVGを画像へラスタライズする。
 * @param svgBlob ラスタライズするSVGを含むBlob。
 * @param svg - Mermaidが生成したSVG本文。
 * @param root 出力幅の計算に使うプレビュー要素。
 * @returns ラスタライズ済みPNG Blobを返すPromise。
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
 * MermaidのSVG寸法から縦横比を読み、画像レイアウトに使う範囲へ制限する。
 * @param svg - Mermaidが生成したSVG本文。
 * @returns viewBoxまたはwidth/heightの比率。寸法が読めない場合は16:9。
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
 * Mermaid図中のリンク・文字操作領域を可視範囲に応じて仮想化し、監視解除関数を返す。
 * @param frame - 図中操作領域を配置するMermaid frame要素。
 * @param layer - 図中操作要素を配置するレイヤー要素。
 * @param interactions - 図中の文字・リンク操作領域の一覧。
 * @param scrollContainer - 図中操作の可視判定とスクロール監視に使う領域。未指定ならwindow。
 * @returns スクロール・resize監視と描画待ちを解除する関数。
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
   * interactionの座標と内容を配置したリンクまたは選択可能な文字領域を生成する。
   * @param interaction - DOM操作要素へ変換するMermaid interaction定義。
   * @param index - 描画結果との対応付けに使うinteractionの配列位置。
   * @returns アクセシブルなリンク、または装飾用文字領域。
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
   * 世代が有効な間、操作領域を最大8件かつ短い描画時間内でDOMへ追加し、残りを次tickへ送る。
   * @param expectedGeneration - この追加処理を開始したMarkdown描画世代番号。
   * @param pending - 後続フレームで追加するMermaid操作領域のインデックス一覧。
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
         */
        () => appendChunk(expectedGeneration, pending),
        0,
      );
    }
  };

  const update = /**
   * Markdownプレビューの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
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
       * @param index - 走査中の配列における0始まりの要素位置。
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
       * @param index - 走査中の配列における0始まりの要素位置。
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
       * @param index - 走査中の配列における0始まりの要素位置。

       */
      (index) => !elements.has(index),
    );
    if (pending.length) appendChunk(generation, pending);
  };

  const schedule = () => {
    // scroll/resizeごとの連続呼び出しを1回のanimation frameへまとめる。
    if (frameRequest || isPreviewInputActive()) return;
    frameRequest = window.requestAnimationFrame(update);
  };

  const pauseForInput = () => {
    // 入力が始まったら待機中の描画フレームとDOM追加タイマーを取り消す。
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
   * 監視・描画待ちを解除し、仮想化した操作要素の参照を破棄する。
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

/** 親へプレビュー画像の幅変更を通知する関数を保持するRef。未設定なら通知しない。 */
type ImageCallbackRef = React.MutableRefObject<{
  /**
   * 親へ変更後の画像幅を通知する。
   * @param imageIndex - プレビュー内の対象画像の0始まりインデックス。
   * @param width - 対象画像へ適用する幅のピクセル値。
   */
  (imageIndex: number, width: number): void;
} | undefined>;
/** 親へプレビュー画像のサイズリセットを通知する関数を保持するRef。 */
type ResetCallbackRef = React.MutableRefObject<{
  /**
   * 親へ画像サイズのリセットを通知する。
   * @param imageIndex - リセットするプレビュー画像の0始まりインデックス。
   */
  (imageIndex: number): void;
} | undefined>;
/** 親へプレビュー画像の配置変更を通知する関数を保持するRef。 */
type AlignmentCallbackRef = React.MutableRefObject<{
  /**
   * 親へ画像配置の変更を通知する。
   * @param imageIndex - 配置を変更するプレビュー画像の0始まりインデックス。
   * @param alignment - 画像へ適用する左・中央・右の配置。
   */
  (imageIndex: number, alignment: ImageAlignment): void;
} | undefined>;

/**
 * Markdownプレビュー内の画像へサイズ変更と配置コントロールを追加する。
 * @param root - 画像を検索してコントロールを追加するプレビューのルート要素。
 * @param messages - 画像コントロールに表示するローカライズ済み文言。
 * @param onResizeRef - 画像幅の変更を親コンポーネントへ通知するコールバックRef。
 * @param onResetRef - 画像サイズのリセットを親へ通知するコールバックRef。
 * @param onAlignRef - 画像配置の変更を親へ通知するコールバックRef。
 * @param onlyNearViewport - trueならスクロール表示領域付近の画像だけを拡張する。
 * @param candidates - 拡張対象を事前に限定する画像一覧。省略時はroot内から検索する。
 * @returns 追加した各画像コントロールのイベントと監視を解除する関数。対象なしならundefined。
 */
function enhanceResizableImages(
  root: HTMLElement,
  messages: Messages["app"]["imageControls"],
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
     * @param image - 表示領域への近接を判定する画像要素。

     */
    (image) => !onlyNearViewport || isNearViewport(image, scrollContainer),
  );

  images.forEach(
    /**
     * 画像ごとにifを実行する。
     * @param image - 画像のdatasetを参照する走査対象。
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
       */ () => {
        badge.textContent = `${getLogicalElementWidth(image, root) || preferredWidth}px`;
      };
      updateBadge();

      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "mve-image-handle";
      handle.setAttribute("aria-label", messages.resize);
      handle.title = messages.resize;
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
        ["left", messages.alignLeft, messages.alignLeftShort],
        ["center", messages.alignCenter, messages.alignCenterShort],
        ["right", messages.alignRight, messages.alignRightShort],
      ];
      alignmentLabels.forEach(([alignment, label, text]) => {
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
           * @param event - 画像配置ボタンのnative click event。
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
      });
      frame.appendChild(alignmentActions);

      let resetButton: HTMLButtonElement | undefined;
      if (image.dataset.mveCanReset === "true" && onResetRef.current) {
        resetButton = document.createElement("button");
        resetButton.type = "button";
        resetButton.className = "mve-image-reset";
        resetButton.textContent = "↺";
        resetButton.setAttribute("aria-label", messages.reset);
        resetButton.title = messages.reset;
        resetButton.addEventListener(
          "click",
          /**
           * UIイベントを表示または編集状態へ反映する。
           * @param event - 画像サイズを初期化するbutton click event。
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
    ?
      () =>
        cleanups.forEach(
          /**
           * cleanupごとにcleanupを実行する。
           * @param cleanup - 画像リサイズ用イベントとobserverの登録を解除する関数。
           */
          (cleanup) => cleanup(),
        )
    : undefined;
}

/**
 * ポインター操作で画像幅を仮変更し、確定時だけ親へ通知するハンドラーを登録する。
 * @param handle - 画像幅変更のpointer操作を受けるハンドルボタン。
 * @param frame - 画像とバッジを含むリサイズ対象frame。
 * @param image - ドラッグで幅を変更する画像要素。
 * @param imageIndex - 親コンポーネントへ通知する画像の0始まりインデックス。
 * @param root - 表示倍率と論理幅の基準となるプレビュー要素。
 * @param updateBadge - 現在幅の表示バッジを更新する関数。
 * @param onResizeRef - ドラッグ確定後の画像幅を親コンポーネントへ通知するコールバックRef。
 * @returns pointerdown登録を解除し、実行中のdragも中断する関数。
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
   * 画像幅変更を開始し、現在の倍率・幅・ポインターIDをドラッグ中の基準として固定する。
   * @param event - プレビュー画像のresize handle dragを開始するpointer event。
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
     * 同じpointerの移動量をプレビュー倍率で補正して一時幅へ反映する。
     * @param moveEvent - 現在のドラッグと同じpointerかを判定する移動イベント。
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
     * pointerupなら幅を確定し、pointercancelなら開始時の幅へ戻す終了イベントを作る。
     * @param commit - 通常終了ならtrue、キャンセル終了ならfalse。
     */ (commit: boolean) =>
      /**
       * @param finishEvent - 対象pointerの終了またはキャンセルイベント。
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
      /** 一時的なdrag listenerを外し、保持中のpointer captureを解放する。 */
      () => {
        handle.removeEventListener("pointermove", onPointerMove);
        handle.removeEventListener("pointerup", onPointerUp);
        handle.removeEventListener("pointercancel", onPointerCancel);
        if (handle.hasPointerCapture(pointerId))
          handle.releasePointerCapture(pointerId);
      };
  };

  handle.addEventListener("pointerdown", onPointerDown);
  /** pointerdown listenerと、進行中ならそのdrag listenerを解除する。 */
  return () => {
    handle.removeEventListener("pointerdown", onPointerDown);
    activeCleanup?.();
  };
}

/**
 * レンダリング後の画像幅をズーム倍率を除いた論理幅で返す。
 * @param image - 表示幅を論理幅へ変換する画像要素。
 * @param root - ズーム倍率の基準となるプレビュー要素。
 * @returns CSS論理ピクセル単位の画像幅。
 */
function getRenderedImageWidth(
  image: HTMLImageElement,
  root: HTMLElement,
): number {
  return getLogicalElementWidth(image, root);
}

/**
 * プレビューのdata属性から正の画像ズーム倍率を読み取る。
 * @param root - 画像ズームを示すdata属性を持つプレビュー要素。
 * @returns 有効な倍率。未設定または不正値なら1。
 */
function getPreviewImageZoom(root: HTMLElement): number {
  const value = Number.parseFloat(root.dataset.mveImageZoom ?? "");
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * DOM上の表示幅をズーム倍率で割り、保存・編集に使う論理幅へ戻す。
 * @param element - 寸法または属性を読み取るDOM要素。
 * @param root - 要素幅の論理値を算出するプレビュー要素。
 * @returns CSS論理ピクセル単位の幅。要素が未描画なら0。
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
 * Markdown画像のwidth属性を数値として読み取り、明示幅の有無を判定する。
 * @param image - width属性から明示幅を読む画像要素。
 * @returns 有効な明示幅。不在または不正値なら0。
 */
function getExplicitImageWidth(image: HTMLImageElement): number {
  const value = Number.parseFloat(image.getAttribute("width") ?? "");
  return Number.isFinite(value) ? value : 0;
}

/**
 * スクロールバーと左右paddingを除いた画像配置可能幅を求める。
 * @param root - 画像配置可能幅を測るプレビュー要素。
 * @returns 配置可能幅。狭いコンテナでも最低120pxを返す。
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
 * 画像配置をleft、center、rightの有効値へ正規化する。
 * @param value - HTML画像タグから読み取った配置属性値。
 * @returns 画像配置として有効なleft、center、rightのいずれか。
 */
function normalizeImageAlignment(value: string | undefined): ImageAlignment {
  return value === "center" || value === "right" ? value : "left";
}

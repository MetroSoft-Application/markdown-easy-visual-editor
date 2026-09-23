/**
 * @file RenderedMarkdown.tsx
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
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
 * 「InspectorTarget」として扱う値の型を定義します。
 */
export type InspectorTarget =
  | {
  /**
   * 「type」は、対象の識別や処理分岐に使用する値を保持します。
   */
  type: "mermaid";
  /**
   * 「source」は、読み込みまたは出力対象を示すパス・URL・内容を保持します。
   */
  source: string }
  | {
  /**
   * 「type」は、対象の識別や処理分岐に使用する値を保持します。
   */
  type: "math";
  /**
   * 「source」は、読み込みまたは出力対象を示すパス・URL・内容を保持します。
   */
  source: string }
  | {
  /**
   * 「type」は、対象の識別や処理分岐に使用する値を保持します。
   */
  type: "image";
  /**
   * 「source」は、読み込みまたは出力対象を示すパス・URL・内容を保持します。
   */
  source: string;
  /**
   * 「alt」は、対象の内容または識別子を表す文字列です。
   */
  alt: string;
  /**
   * 「imageIndex」は、対象の位置、サイズ、件数、または範囲を保持します。
   */
  imageIndex?: number };

/**
 * 「Props」が満たすデータ契約を定義します。
 */
interface Props {

  /**
   * 「markdown」は、解析・編集・変換の対象となる本文またはデータを保持します。
   */
  markdown: string;
  /**
   * 複数の表示先で共有する、計算済みのHTML。
   */
  html?: string;

  /**
   * 「settings」は、利用側が共有する設定または現在状態を保持します。
   */
  settings: WebviewSettings;

  /**
   * 「className」は、対象の識別や処理分岐に使用する値を保持します。
   */
  className?: string;

  /**
   * 「imageZoom」は、位置・サイズ・件数などを表す数値です。
   */
  imageZoom?: number;
  /**
   * 呼び出し側が入力を渡し、宣言された戻り値型で結果を受け取る契約です。
   * @param target 処理対象の対象です。
   * @returns 状態更新または副作用を実行し、値は返しません。
   */
  onInspect?: (target: InspectorTarget) => void;
  /**
   * 呼び出し側が入力を渡し、宣言された戻り値型で結果を受け取る契約です。
   * @param imageIndex 処理対象を特定するimageIndexの入力値です。
   * @param width 処理対象の幅です。
   * @returns 状態更新または副作用を実行し、値は返しません。
   */
  onImageResize?: (imageIndex: number, width: number) => void;
  /**
   * 呼び出し側が入力を渡し、宣言された戻り値型で結果を受け取る契約です。
   * @param imageIndex 処理対象を特定するimageIndexの入力値です。
   * @returns 状態更新または副作用を実行し、値は返しません。
   */
  onImageReset?: (imageIndex: number) => void;
  /**
   * 呼び出し側が入力を渡し、宣言された戻り値型で結果を受け取る契約です。
   * @param imageIndex 処理対象を特定するimageIndexの入力値です。
   * @param alignment 処理対象を特定するalignmentの入力値です。
   * @returns 状態更新または副作用を実行し、値は返しません。
   */
  onImageAlign?: (imageIndex: number, alignment: ImageAlignment) => void;
  /**
   * 呼び出し側が入力を渡し、宣言された戻り値型で結果を受け取る契約です。
   * @param href 処理対象を特定するhrefの入力値です。
   * @returns 状態更新または副作用を実行し、値は返しません。
   */
  onNavigate?: (href: string) => void;
  /**
   * 呼び出し側が入力を渡し、宣言された戻り値型で結果を受け取る契約です。
   * @param element 処理対象の要素です。
   * @returns 状態更新または副作用を実行し、値は返しません。
   */
  onRendered?: (element: HTMLElement) => void;
  /**
   * 呼び出し側が入力を渡し、宣言された戻り値型で結果を受け取る契約です。
   * @returns 状態更新または副作用を実行し、値は返しません。
   */
  onMermaidRendered?: () => void;

  /**
   * 「deferMermaid」は、対象の識別や処理分岐に使用する値を保持します。
   */
  deferMermaid?: boolean;
}

/**
 * MarkdownのHTMLプレビューを表示し、図・画像・リンクの操作を親へ通知する。
 * @param props プレビュー本文、表示設定、操作通知コールバック。
 * @returns レンダリングされたMarkdownプレビュー。
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
 * 「html」は、解析・編集・変換の対象となる本文またはデータを保持します。
 */
html: string }): React.JSX.Element {
  // MarkdownをHTMLへ変換し、Mermaid・画像・リンクの表示後処理を行うプレビューを描画する。
  const rootRef = useRef<HTMLDivElement>(null);
  const renderedBlocksRef = useRef<RenderedDomBlock[]>([]);
  const mermaidObjectUrlsRef = useRef(new Set<string>());
  const mermaidRenderControllersRef = useRef(
    new Map<HTMLElement, {
    /**
     * 「key」は、対象の内容または識別子を表す文字列です。
     */
    key: string;
    /**
     * 「controller」は、非同期処理またはリソースのライフサイクルを管理します。
     */
    controller: AbortController }>(),
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
 * 処理結果を生成する処理を実行するコールバックです。
   * @returns 「if」を実行し、値を返しません。
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
  }, [html]);

  useEffect(

    /**
 * Reactの初期状態またはメモ化値を遅延計算するコールバックです。
     * @returns Reactが保持する初期状態またはメモ化値を返します。
     */
    () =>
    /**
 * 登録された副作用または結果を生成する処理を実行するコールバックです。
     * @returns 「mermaidRenderControllersRef.current.forEach」を実行し、値を返しません。
     */
    () => {
      mermaidRenderControllersRef.current.forEach(
      /**
 * 「controller」を受け取り、処理結果を生成する処理です。
       * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはcontrollerです。
       * @returns 「controller.abort」を実行し、値を返しません。
       */
      ({ controller }) =>
        controller.abort(),
      );
      mermaidRenderControllersRef.current.clear();
      mermaidObjectUrlsRef.current.forEach(
      /**
 * 「url」を受け取り、処理結果を生成する処理です。
       * @param url 読み込みまたは出力するリソースの場所を示します。
       * @returns 「url」から生成した処理結果を返します。
       */
      (url) => URL.revokeObjectURL(url));
      mermaidObjectUrlsRef.current.clear();
      mermaidInteractionManagersRef.current.forEach(
      /**
 * 「cleanup」を受け取り、処理結果を生成する処理です。
       * @param cleanup cleanupとして渡される、このコールバックの入力値です。
       * @returns 購読解除、タイマー解除、リソース破棄などの後片付けを実行し、値は返しません。
       */
      (cleanup) => cleanup());
      mermaidInteractionManagersRef.current.clear();
    },
    [],
  );

  useEffect(
  /**
 * Reactの初期状態またはメモ化値を遅延計算するコールバックです。
   * @returns Reactが保持する初期状態またはメモ化値を返します。
   */
  () => {
    // HTMLの更新を監視し、未処理のMermaidや画像の読み込み後にレイアウトを通知する。
    const root = rootRef.current;
    if (!root) return;
    // 表の短い項目名だけを改行禁止にし、長い先頭列の横溢れを防ぐ。
    root.querySelectorAll<HTMLTableElement>("table").forEach(
    /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
     * @param table 処理対象の表です。
     * @returns 「Array.from」を実行し、値を返しません。
     */
    (table) => {
      Array.from(table.rows).forEach(
      /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
       * @param row 本文、表、配列内の対象位置を示すインデックスです。
       * @returns 「if」を実行し、値を返しません。
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
      });
    });
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
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
     * @param cleanup cleanupとして渡される、このコールバックの入力値です。
     * @param node nodeとして渡される、このコールバックの入力値です。
     * @returns 購読解除、タイマー解除、リソース破棄などの後片付けを実行し、値は返しません。
     */
    (cleanup, node) => {
      if (node.isConnected) return;
      cleanup();
      interactionManagers.delete(node);
    });
    // 差分DOMで保持された同一図の描画は継続する。図ソース・テーマが変わった要求だけを破棄する。
    renderControllers.forEach(
    /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
     * @param entry entryとして渡される、このコールバックの入力値です。
     * @param node nodeとして渡される、このコールバックの入力値です。
     * @returns 「decodeURIComponent」を実行し、値を返しません。
     */
    (entry, node) => {
      const source = decodeURIComponent(node.dataset.mermaidSource ?? "");
      if (node.isConnected && entry.key === `${theme}\0${source}`) return;
      entry.controller.abort();
      renderControllers.delete(node);
      delete node.dataset.mermaidStatus;
    });

    /**
     * 「notifyRendered」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
     * @returns 「notifyRendered」がWebview UI状態の入力を処理して得た固有の結果を返します。
     */
    const notifyRendered = /**
 * 「notifyRendered」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @returns 「notifyRendered」がWebview UI状態の入力を処理して得た固有の結果を返します。
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

    /**
     * Mermaidを処理します。
     * @param node 処理対象のDOMまたは構文木のノードです。
     * @param source 処理対象のソースです。
     * @param rendered 「rendered」は、「applyMermaid」がWebview UI状態の処理対象を特定する入力です。
     * @param isCurrent 「isCurrent」は、「applyMermaid」がWebview UI状態の処理対象を特定する入力です。
     * @returns 非同期処理の完了を表すPromiseです。
     */
    const applyMermaid = /**
 * 「applyMermaid」は、入力を検証して対象の状態または内容へ適用します。
 * @param node 処理対象のDOM要素、エディター、または実行コンテキストです。
 * @param source Webview UIで解析・編集・変換する本文またはデータです。
 * @param rendered 「rendered」は、「applyMermaid」がWebview UIで処理する対象を特定する入力です。
 * @param isCurrent 「isCurrent」は、「applyMermaid」がWebview UIで処理する対象を特定する入力です。
 * @returns 「performance.now」を実行し、値を返しません。
 */ async (
      node: HTMLElement,
      source: string,
      rendered: MermaidRenderResult,
      isCurrent: () => boolean,
    ): Promise<void> => {
      const applyStartedAt = performance.now();

      /**
       * record・apply・durationを更新または保存します。
       * @param startedAt 「startedAt」は、「recordApplyDuration」がWebview UI状態の処理対象を特定する入力です。
       * @returns 「recordApplyDuration」がWebview UI状態の入力を処理して得た固有の結果を返します。
       */
      const recordApplyDuration = /**
 * 「recordApplyDuration」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param startedAt 「startedAt」は、「recordApplyDuration」がWebview UIで処理する対象を特定する入力です。
 * @returns 「recordApplyDuration」がWebview UI状態の入力を処理して得た固有の結果を返します。
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
         * イベント情報を受け取り、DOMまたは画面状態を更新するコールバックです。
         * @returns 「notifyRendered」を実行し、値を返しません。
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
    /**
     * 未描画のMermaidノードを抽出してSVGへ置き換え、描画後のレイアウトを通知する。
     * @returns Mermaidノードの描画が完了するPromise。
     */
    const renderNodes = /**
 * 「renderNodes」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @returns 「renderNodes」が生成または抽出した表示対象を返します。
 */ async (): Promise<boolean> => {
      // 未描画のMermaidノードを抽出し、SVG描画結果またはエラー表示を反映する。
      const allNodes = Array.from(
        root.querySelectorAll<HTMLElement>(".mermaid"),
      );
      const pending = allNodes.filter(

        /**
 * 「node」が条件に一致するか判定し、残す要素を決めるコールバックです。
         * @param node nodeとして渡される、このコールバックの入力値です。
         * @returns 要素を採用するかどうかの真偽値を返します。
         */
        (node) =>
          !node.dataset.mermaidStatus &&
          (!deferMermaid || isNearViewport(node, scrollContainer)),
      );
      if (!pending.length) {
        if (
          !allNodes.some(
          /**
 * 「node」が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
           * @param node nodeとして渡される、このコールバックの入力値です。
           * @returns 条件判定の結果を示す真偽値を返します。
           */
          (node) => node.dataset.mermaidStatus === "rendering")
        ) {
          notifyRendered();
        }
        return allNodes.some(
        /**
 * 「node」が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
         * @param node nodeとして渡される、このコールバックの入力値です。
         * @returns 条件判定の結果を示す真偽値を返します。
         */
        (node) => !node.dataset.mermaidStatus);
      }
      // ホスト側は直列描画なので、可視・画面外・出力のいずれも要求を先行投入しない。
      // 世代ごとに1件だけ開始すれば、更新時の取消対象と35秒タイマーも常に1件に収まる。
      const batch = pending.slice(0, 1);
      await Promise.all(
        batch.map(
        /**
 * 「node」を変換し、変換後の要素を返すコールバックです。
         * @param node nodeとして渡される、このコールバックの入力値です。
         * @returns 入力要素から生成した変換後の値を返します。
         */
        async (node) => {
          // ノードごとにソースを復元して描画し、以前の描画結果をエラー時の代替として保持する。
          const index = allNodes.indexOf(node);
          const blockKey = `index:${index}`;
          const source = decodeURIComponent(node.dataset.mermaidSource ?? "");
          const sourceCacheKey = `source:${theme}\0${source}`;
          const renderKey = `${theme}\0${source}`;
          node.dataset.mermaidStatus = "rendering";
          const controller = new AbortController();
          renderControllers.set(node, { key: renderKey, controller });

          /**
           * is・currentかどうかを判定します。
           * @returns 条件を満たすかどうかを示す真偽値を返します。
           */
          const isCurrent = /**
 * 「isCurrent」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @returns 条件を満たすかどうかを示す真偽値を返します。
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
            const previous = mermaidCacheRef.current.get(`block:${blockKey}`);
            if (previous) await applyMermaid(node, source, previous, isCurrent);
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
            message.textContent = mermaidErrorMessage(error, settings.language);
            node.append(message);
          } finally {
            if (renderControllers.get(node)?.controller === controller)
              renderControllers.delete(node);
          }
        }),
      );
      notifyRendered();
      return allNodes.some(
      /**
 * 「node」が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
       * @param node nodeとして渡される、このコールバックの入力値です。
       * @returns 条件判定の結果を示す真偽値を返します。
       */
      (node) => !node.dataset.mermaidStatus);
    };

    /**
     * 「scheduleRenderNodes」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
     * @param delay 「delay」は、「scheduleRenderNodes」がWebview UI状態の処理対象を特定する入力です。
     * @param restart 「restart」は、「scheduleRenderNodes」がWebview UI状態の処理対象を特定する入力です。
     * @returns 「scheduleRenderNodes」が生成または抽出した表示対象を返します。
     */
    const scheduleRenderNodes = /**
 * 「scheduleRenderNodes」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param delay 「delay」は、「scheduleRenderNodes」がWebview UIで処理する対象を特定する入力です。
 * @param restart 「restart」は、「scheduleRenderNodes」がWebview UIで処理する対象を特定する入力です。
 * @returns 「scheduleRenderNodes」が生成または抽出した表示対象を返します。
 */ (
      delay = deferMermaid ? 80 : 0,
      restart = false,
    ) => {
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
 * 指定時間の経過後に遅延処理を実行するコールバックです。
         * @returns 「renderNodes」を実行し、値を返しません。
         */
        () => {
          renderTimer = undefined;
          void renderNodes().then(
          /**
           * Promiseの解決値を受け取り、後続の表示または状態更新へ渡すコールバックです。
           * @returns 解決値を処理した結果を返します。
           */
          () => {
            const hasNextForegroundNode = Array.from(
              root.querySelectorAll<HTMLElement>(".mermaid"),
            ).some(

              /**
 * 「node」が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
               * @param node nodeとして渡される、このコールバックの入力値です。
               * @returns 解決値を処理した結果を返します。
               */
              (node) =>
                !node.dataset.mermaidStatus &&
                (!deferMermaid || isNearViewport(node, scrollContainer)),
            );
            if (hasNextForegroundNode) scheduleRenderNodes();
          });
        }, delay);
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

    /**
     * 「enhanceImages」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
     * @param candidates 「candidates」は、「enhanceImages」がWebview UI状態の処理対象を特定する入力です。
     * @returns 「enhanceImages」が生成または抽出した表示対象を返します。
     */
    const enhanceImages = /**
 * 「enhanceImages」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param candidates 「candidates」は、「enhanceImages」がWebview UIで処理する対象を特定する入力です。
 * @returns 「enhanceImages」が生成または抽出した表示対象を返します。
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

    /**
     * process・image・enhancement・chunkを処理します。
     * @returns 「processImageEnhancementChunk」が生成または抽出した表示対象を返します。
     */
    const processImageEnhancementChunk = /**
 * 「processImageEnhancementChunk」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @returns 「processImageEnhancementChunk」が生成または抽出した表示対象を返します。
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
      const activityDelay = 100 - (performance.now() - lastViewportActivityAt);
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
        imageEnhanceTimer = window.setTimeout(processImageEnhancementChunk, 0);
      }
    };

    /**
     * 「scheduleImageEnhancements」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
     * @param imagesToEnhance 「imagesToEnhance」は、「scheduleImageEnhancements」がWebview UI状態の処理対象を特定する入力です。
     * @returns 「scheduleImageEnhancements」が生成または抽出した表示対象を返します。
     */
    const scheduleImageEnhancements = /**
 * 「scheduleImageEnhancements」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param imagesToEnhance 「imagesToEnhance」は、「scheduleImageEnhancements」がWebview UIで処理する対象を特定する入力です。
 * @returns 「scheduleImageEnhancements」が生成または抽出した表示対象を返します。
 */ (imagesToEnhance: HTMLImageElement[]) => {
      imagesToEnhance.forEach(
      /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
       * @param image imageとして渡される、このコールバックの入力値です。
       * @returns 「pendingImageEnhancements.add」を実行し、値を返しません。
       */
      (image) => pendingImageEnhancements.add(image));
      if (imageEnhanceTimer === undefined && pendingImageEnhancements.size) {
        imageEnhanceTimer = window.setTimeout(processImageEnhancementChunk, 0);
      }
    };
    const resizeObserver = new ResizeObserver(
    /**
 * 指定時間の経過後に後続処理を実行するコールバックです。
     * @returns 「notifyRendered」を実行し、値を返しません。
     */
    () => {
      notifyRendered();
    });
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
 * 「entries」を受け取り、処理結果を生成する処理です。
           * @param entries 処理対象となる複数要素の集合です。
           * @returns 「if」を実行し、値を返しません。
           */
          (entries) => {
            if (cancelled) return;
            const visibleImages = entries
              .filter(

                /**
 * 「entry」が条件に一致するか判定し、残す要素を決めるコールバックです。
                 * @param entry entryとして渡される、このコールバックの入力値です。
                 * @returns 要素を採用するかどうかの真偽値を返します。
                 */
                (entry) =>
                  entry.isIntersecting &&
                  entry.target instanceof HTMLImageElement,
              )
              .map(
              /**
 * 「entry」を変換し、変換後の要素を返すコールバックです。
               * @param entry entryとして渡される、このコールバックの入力値です。
               * @returns 入力要素から生成した変換後の値を返します。
               */
              (entry) => entry.target as HTMLImageElement);
            visibleImages.forEach(
            /**
 * 「image」を受け取り、登録された副作用または結果を生成する処理です。
             * @param image imageとして渡される、このコールバックの入力値です。
             * @returns 「image」から生成した処理結果を返します。
             */
            (image) =>
              imageEnhanceObserver?.unobserve(image),
            );
            if (visibleImages.length) scheduleImageEnhancements(visibleImages);
          },
          {
            root: scrollContainer,
            rootMargin: "600px 0px",
          },
        );
        resizableImages.forEach(
        /**
 * 「image」を受け取り、登録された副作用または結果を生成する処理です。
         * @param image imageとして渡される、このコールバックの入力値です。
         * @returns 「image」から生成した処理結果を返します。
         */
        (image) =>
          imageEnhanceObserver?.observe(image),
        );
      } else {
        enhanceImages(resizableImages);
      }
    }
    // 画像の読み込み完了時に、変化したプレビューの大きさを親へ通知する。
    /**
     * 画像の読み込み完了を親へ通知し、プレビューサイズの再計算を促す。
     * @returns 何も返さない。
     */
    const imageLoaded = /**
 * 「imageLoaded」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @returns 「imageLoaded」が生成または抽出した表示対象を返します。
 */ () => {
      notifyRendered();
    };
    images.forEach(
    /**
 * 「image」を受け取り、登録された副作用または結果を生成する処理です。
     * @param image imageとして渡される、このコールバックの入力値です。
     * @returns 「image」から生成した処理結果を返します。
     */
    (image) => image.addEventListener("load", imageLoaded));

    /**
     * 「scheduleAfterViewportActivity」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
     * @returns 「scheduleAfterViewportActivity」がWebview UI状態の入力を処理して得た固有の結果を返します。
     */
    const scheduleAfterViewportActivity = /**
 * 「scheduleAfterViewportActivity」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @returns 「scheduleAfterViewportActivity」がWebview UI状態の入力を処理して得た固有の結果を返します。
 */ () => {
      lastViewportActivityAt = performance.now();
      scheduleRenderNodes(120, true);
    };
    scrollContainer?.addEventListener("scroll", scheduleAfterViewportActivity, {
      passive: true,
    });
    window.addEventListener("resize", scheduleAfterViewportActivity, {
      passive: true,
    });

    /**
     * 「pauseForInput」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
     * @returns 「pauseForInput」がWebview UI状態の入力を処理して得た固有の結果を返します。
     */
    const pauseForInput = /**
 * 「pauseForInput」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @returns 「pauseForInput」がWebview UI状態の入力を処理して得た固有の結果を返します。
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

    /**
     * 「resumeAfterInput」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
     * @returns 「resumeAfterInput」がWebview UI状態の入力を処理して得た固有の結果を返します。
     */
    const resumeAfterInput = /**
 * 「resumeAfterInput」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @returns 「resumeAfterInput」がWebview UI状態の入力を処理して得た固有の結果を返します。
 */ () => {
      scheduleRenderNodes(120, true);
      if (pendingImageEnhancements.size) scheduleImageEnhancements([]);
    };
    window.addEventListener("mve-preview-input-active", pauseForInput);
    window.addEventListener("mve-preview-input-settled", resumeAfterInput);
    if (deferMermaid) onRenderedRef.current?.(root);
    scheduleRenderNodes();
    return /** イベント情報を受け取り、DOMまたは画面状態を更新するコールバックです。 @returns 後片付けまたは登録解除を完了した結果を返します。 */ () => {
      cancelled = true;
      if (renderTimer !== undefined) window.clearTimeout(renderTimer);
      if (imageEnhanceTimer !== undefined)
        window.clearTimeout(imageEnhanceTimer);
      pendingImageEnhancements.clear();
      resizeObserver.disconnect();
      imageEnhanceObserver?.disconnect();
      images.forEach(
      /**
 * 「image」を受け取り、登録された副作用または結果を生成する処理です。
       * @param image imageとして渡される、このコールバックの入力値です。
       * @returns 「image.removeEventListener」を実行し、値を返しません。
       */
      (image) => image.removeEventListener("load", imageLoaded));
      scrollContainer?.removeEventListener(
        "scroll",
        scheduleAfterViewportActivity,
      );
      window.removeEventListener("resize", scheduleAfterViewportActivity);
      window.removeEventListener("mve-preview-input-active", pauseForInput);
      window.removeEventListener("mve-preview-input-settled", resumeAfterInput);
      imageResizeCleanups.forEach(
      /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
       * @param cleanup cleanupとして渡される、このコールバックの入力値です。
       * @returns 購読解除、タイマー解除、リソース破棄などの後片付けを実行し、値は返しません。
       */
      (cleanup) => cleanup());
      // 差分更新で再利用したMermaid画像のBlob URLは維持し、DOMから消えた分だけ解放する。
      mermaidObjectUrls.forEach(
      /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
       * @param url 読み込みまたは出力するリソースの場所を示します。
       * @returns 「if」を実行し、値を返しません。
       */
      (url) => {
        if (
          Array.from(
            root.querySelectorAll<HTMLImageElement>("img.mermaid-svg-image"),
          ).some(
          /**
 * 「image」が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
           * @param image imageとして渡される、このコールバックの入力値です。
           * @returns 条件判定の結果を示す真偽値を返します。
           */
          (image) => image.src === url)
        )
          return;
        URL.revokeObjectURL(url);
        mermaidObjectUrls.delete(url);
      });
    };
  }, [
    html,
    markdown,
    settings.editorTheme,
    settings.language,
    settings.mermaidTheme,
    settings.mermaidHostRendering,
    Boolean(onImageResize),
    Boolean(onImageAlign),
    deferMermaid,
  ]);

  /**
   * ダブルクリックされたプレビュー要素から編集対象の図・数式・画像を判定する。
   * @param event プレビュー上のダブルクリックイベント。
   * @returns 何も返さない。
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
   * コードのコピーとMarkdownリンクの内部スクロール・外部遷移を処理する。
   * @param event プレビュー上のクリックイベント。
   * @returns 何も返さない。
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
 * 指定時間の経過後に遅延処理を実行するコールバックです。
         * @returns 「if」を実行し、値を返しません。
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
      data-mve-image-zoom={imageZoom !== undefined ? String(imageZoom) : undefined}
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
 * HTML 未計算の補助プレビューだけ、分離済み Markdown ランタイムを遅延ロードする。
 * @param props 「props」は、「RenderedMarkdownLoader」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「RenderedMarkdownLoader」が生成または整形したWebview UI状態の文字列を返します。
 */
function RenderedMarkdownLoader(props: Props): React.JSX.Element {
  const { markdown, html, settings } = props;
  const [rendered, setRendered] = useState<{

    /**
     * 「markdown」は、解析・編集・変換の対象となる本文またはデータを保持します。
     */
    markdown: string;

    /**
     * 「language」は、対象の内容または識別子を表す文字列です。
     */
    language: string;

    /**
     * 「remoteImagesEnabled」は、画面の表示モードまたは現在のUI状態を示します。
     */
    remoteImagesEnabled: boolean;

    /**
     * 「html」は、解析・編集・変換の対象となる本文またはデータを保持します。
     */
    html: string;
  }>();
  const [error, setError] = useState<unknown>();

  useEffect(
  /**
 * Reactの初期状態またはメモ化値を遅延計算するコールバックです。
   * @returns Reactが保持する初期状態またはメモ化値を返します。
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
 * 非同期処理の完了値を受け取り、次の処理へ渡す結果を生成するコールバックです。
       * @param value 「value」で検証・変換する入力値です。
       * @returns 解決値を処理した結果を返します。
       */
      (value) => {
        if (cancelled) return;
        setRendered({
          markdown,
          language: settings.language,
          remoteImagesEnabled: settings.remoteImagesEnabled,
          html: value,
        });
      })
      .catch(
      /**
 * 非同期処理の完了値を受け取り、次の処理へ渡す結果を生成するコールバックです。
       * @param reason 失敗した処理の原因または例外情報です。
       * @returns エラー処理またはフォールバックの結果を返します。
       */
      (reason: unknown) => {
        if (!cancelled) setError(reason);
      });
    return /** 「cancelled」として処理を終了し、保持していたリソースまたは状態を整理します。 @returns 後片付けまたは登録解除を完了した結果を返します。 */ () => {
      cancelled = true;
    };
  }, [html, markdown, settings.language, settings.remoteImagesEnabled]);

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

/** 「RenderedMarkdown」は、関連する処理間で共有する設定値または状態です。 */
/** Markdownのレンダリング結果を表示し、表示更新が必要な場合だけ子ツリーを再利用するコンポーネント。 */
export const RenderedMarkdown = React.memo(RenderedMarkdownLoader);

/**
 * 「RenderedDomBlock」が満たすデータ契約を定義します。
 */
interface RenderedDomBlock {

  /**
   * 「signature」は、対象の内容または識別子を表す文字列です。
   */
  signature: string;

  /**
   * 「node」は、関連処理が共有する構造化データの一項目です。
   */
  node: Element;
}

/**
 * Markdownのトップレベルブロックを比較し、共通の前後ブロックを同じDOMノードのまま保持する。
 * 通常の一文字編集では変更対象の1ブロックだけを交換し、全文DOM再構築を避ける。
 * @param root 処理対象のルートです。
 * @param previous 「previous」は、「reconcileRenderedBlocks」がWebview UI状態の処理対象を特定する入力です。
 * @param html 解析・編集・変換の対象となる本文または生成済み内容です。
 * @returns 「reconcileRenderedBlocks」がWebview UI状態の入力を処理して得た固有の結果を返します。
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
 * 「node」を変換し、変換後の要素を返すコールバックです。
   * @param node nodeとして渡される、このコールバックの入力値です。
   * @returns 入力要素から生成した変換後の値を返します。
   */
  (node) => ({
    signature: renderedBlockSignature(node),
    node,
  }));

  // 外部DOM操作や開発時の再マウントで参照がずれた場合だけ、安全に全件を再構築する。
  if (
    previous.length !== root.children.length ||
    previous.some(
    /**
 * 「entry」「index」が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
     * @param entry entryとして渡される、このコールバックの入力値です。
     * @param index 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 条件判定の結果を示す真偽値を返します。
     */
    (entry, index) => root.children[index] !== entry.node)
  ) {
    reuseCompletedMermaidNodes(
      Array.from(root.children),
      next.map(
      /**
 * 「entry」を変換し、変換後の要素を返すコールバックです。
       * @param entry entryとして渡される、このコールバックの入力値です。
       * @returns 入力要素から生成した変換後の値を返します。
       */
      (entry) => entry.node),
    );
    root.replaceChildren(...next.map(
    /**
 * 「entry」を変換し、変換後の要素を返すコールバックです。
     * @param entry entryとして渡される、このコールバックの入力値です。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (entry) => entry.node));
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
 * 「entry」を変換し、変換後の要素を返すコールバックです。
     * @param entry entryとして渡される、このコールバックの入力値です。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (entry) => entry.node),
    next.slice(prefix, nextSuffix + 1).map(
    /**
 * 「entry」を変換し、変換後の要素を返すコールバックです。
     * @param entry entryとして渡される、このコールバックの入力値です。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (entry) => entry.node),
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
 * 「reuseCompletedMermaidNodes」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param previousBlocks 「previousBlocks」は、「reuseCompletedMermaidNodes」がWebview UI状態の処理対象を特定する入力です。
 * @param nextBlocks 「nextBlocks」は、「reuseCompletedMermaidNodes」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「reuseCompletedMermaidNodes」の副作用または状態更新を実行し、値は返しません。
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
          block.querySelectorAll<HTMLElement>(
            ".mermaid[data-mermaid-status]",
          ),
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
 * 「renderedBlockSignature」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param node 処理対象のDOMまたは構文木のノードです。
 * @returns 「renderedBlockSignature」が生成または変換したWebview UIの文字列を返します。
 */
function renderedBlockSignature(node: Element): string {
  if (node.classList.contains("markdown-source-block")) {
    return `source:${node.className}\0${node.innerHTML}`;
  }
  return `other:${node.outerHTML}`;
}

/**
 * 「syncRenderedBlockAttributes」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param current 「current」は、「syncRenderedBlockAttributes」がWebview UI状態の処理対象を特定する入力です。
 * @param next 「next」は、「syncRenderedBlockAttributes」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「syncRenderedBlockAttributes」の副作用または状態更新を実行し、値は返しません。
 */
function syncRenderedBlockAttributes(current: Element, next: Element): void {
  const preservedRuntimeAttributes = current.classList.contains("mermaid")
    ? ["data-mermaid-status", "data-mve-export-svg"]
        .map(
        /**
 * 「name」を変換し、変換後の要素を返すコールバックです。
         * @param name 対象を識別する名前で、表示または処理分岐に使用します。
         * @returns 入力要素から生成した変換後の値を返します。
         */
        (name) => [name, current.getAttribute(name)] as const)
        .filter(
        /**
 * 「entry」が条件に一致するか判定し、残す要素を決めるコールバックです。
         * @param entry entryとして渡される、このコールバックの入力値です。
         * @returns 「entry」が生成または変換したWebview UIの文字列を返します。
         */
        (entry): entry is readonly [string, string] => entry[1] !== null)
    : [];
  Array.from(current.attributes).forEach(
  /**
 * 「attribute」を受け取り、登録された副作用または結果を生成する処理です。
   * @param attribute attributeとして渡される、このコールバックの入力値です。
   * @returns 要素を採用するかどうかの真偽値を返します。
   */
  (attribute) =>
    current.removeAttribute(attribute.name),
  );
  Array.from(next.attributes).forEach(
  /**
 * 「attribute」を受け取り、登録された副作用または結果を生成する処理です。
   * @param attribute attributeとして渡される、このコールバックの入力値です。
   * @returns 「current.setAttribute」を実行し、値を返しません。
   */
  (attribute) =>
    current.setAttribute(attribute.name, attribute.value),
  );
  preservedRuntimeAttributes.forEach(
  /**
 * 「name」「value」を受け取り、登録された副作用または結果を生成する処理です。
   * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはname、valueです。
   * @returns 「current.setAttribute」を実行し、値を返しません。
   */
  ([name, value]) =>
    current.setAttribute(name, value),
  );
}

/** 「MERMAID_CACHE_ENTRY_LIMIT」は、入力・表示・資源の上限または下限を表す値です。 */
const MERMAID_CACHE_ENTRY_LIMIT = 16;
/** 「MERMAID_CACHE_BYTE_LIMIT」は、入力・表示・資源の上限または下限を表す値です。 */
const MERMAID_CACHE_BYTE_LIMIT = 16 * 1024 * 1024;

/**
 * 「MermaidResultCache」クラスの状態とライフサイクルを定義します。
 */
class MermaidResultCache {

  /**
   * 「entries」は、関連処理が共有する構造化データの一項目です。
   */
  private readonly entries = new Map<string, MermaidRenderResult>();

  /**
   * 「retained」は、関連処理が共有する構造化データの一項目です。
   */
  private readonly retained = new Map<
    MermaidRenderResult,
    {
    /**
     * 「bytes」は、位置・サイズ・件数などを表す数値です。
     */
    bytes: number;
    /**
     * 「references」は、位置・サイズ・件数などを表す数値です。
     */
    references: number }
  >();

  /**
   * 「totalBytes」は、関連処理が共有する構造化データの一項目です。
   */
  private totalBytes = 0;

  /**
   * getを取得または解決します。
   * @param key メッセージまたは設定表から値を取得する識別キーです。
   * @returns 処理が対象を取得できない場合はundefinedを返します。
   */
  get(key: string): MermaidRenderResult | undefined {
    const result = this.entries.get(key);
    if (!result) return undefined;
    this.entries.delete(key);
    this.entries.set(key, result);
    return result;
  }

  /**
   * setを更新または保存します。
   * @param key メッセージまたは設定表から値を取得する識別キーです。
   * @param result 処理対象の結果です。
   * @returns 状態更新または副作用を実行し、値は返しません。
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
   * 「retain」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param result 処理対象の結果です。
   * @returns 「retain」の副作用または状態更新を実行し、値は返しません。
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
   * 「release」は、処理を終了し、保持していたリソースまたは状態を整理します。
   * @param result 処理対象の結果です。
   * @returns 購読解除、タイマー解除、またはリソース破棄を実行して値は返しません。
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
 * estimate・mermaid・result・bytesを計算します。
 * @param result 処理対象の結果です。
 * @returns 計算結果の数値です。
 */
function estimateMermaidResultBytes(result: MermaidRenderResult): number {
  return (
    (result.svg.length +
      result.ariaLabel.length +
      (result.pngBase64?.length ?? 0)) *
      2 +
    result.interactions.reduce(

      /**
       * 累積値と入力を「total」「interaction」を受け取り、集約結果を更新するコールバックです。
       * @param total totalとして渡される、このコールバックの入力値です。
       * @param interaction interactionとして渡される、このコールバックの入力値です。
       * @returns 更新後の累積値を返します。
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
 * decode・base64・pngを解析または復元します。
 * @param base64 「base64」は、「decodeBase64Png」がWebview UI状態の処理対象を特定する入力です。
 * @returns 非同期処理の完了を表すPromiseです。
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
       * 予約されたタイミングで「resolve」を受け取り、遅延処理を実行するコールバックです。
       * @param resolve Promiseの完了または失敗を通知する関数です。
       * @returns 「window.setTimeout」を実行し、値を返しません。
       */
      (resolve) => window.setTimeout(resolve, 0));
    }
  }
  return new Blob(chunks, { type: "image/png" });
}

/**
 * is・preview・input・activeかどうかを判定します。
 * @returns 判定結果です。
 */
function isPreviewInputActive(): boolean {
  return document.body.dataset.mveInputActive === "true";
}

/**
 * wait・for・preview・input・idleを待機します。
 * @param signal 処理対象のシグナルです。
 * @returns 非同期処理の完了を表すPromiseです。
 */
function waitForPreviewInputIdle(signal?: AbortSignal): Promise<void> {
  if (!isPreviewInputActive() || signal?.aborted) return Promise.resolve();
  return new Promise(
  /**
 * Promiseの完了または失敗を通知し、非同期処理の状態を確定するコールバックです。
   * @param resolve Promiseの完了または失敗を通知する関数です。
   * @returns 「window.removeEventListener」を実行し、値を返しません。
   */
  (resolve) => {

    /**
     * 「finish」は、処理を終了し、保持していたリソースまたは状態を整理します。
     * @returns 「finish」がWebview UI状態の入力を処理して得た固有の結果を返します。
     */
    const finish = /**
 * 「finish」は、処理を終了し、保持していたリソースまたは状態を整理します。
 * @returns 「finish」がWebview UI状態の入力を処理して得た固有の結果を返します。
 */ () => {
      window.removeEventListener("mve-preview-input-settled", finish);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    window.addEventListener("mve-preview-input-settled", finish, {
      once: true,
    });
    signal?.addEventListener("abort", finish, { once: true });
  });
}

/**
 * find・scroll・containerを取得または解決します。
 * @param root 処理対象のルートです。
 * @returns 「findScrollContainer」が対象を取得できない場合はundefinedを返します。
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
 * is・near・viewportかどうかを判定します。
 * @param node 処理対象のDOMまたは構文木のノードです。
 * @param scrollContainer 「scrollContainer」は、「isNearViewport」がWebview UI状態の処理対象を特定する入力です。
 * @returns 判定結果です。
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
 * 巨大Mermaid SVGを表示幅に合わせたPNGへオフメインスレッド寄りの経路で変換する。
 * @param svgBlob 「svgBlob」は、「rasterizeMermaidPreview」がWebview UI状態の処理対象を特定する入力です。
 * @param svg 「svg」は、「rasterizeMermaidPreview」がWebview UI状態の処理対象を特定する入力です。
 * @param root 処理対象のルートです。
 * @returns 非同期処理の完了を表すPromiseです。
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
 * read・svg・aspect・ratioを取得または解決します。
 * @param svg 「svg」は、「readSvgAspectRatio」がWebview UI状態の処理対象を特定する入力です。
 * @returns 計算結果の数値です。
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
 * 巨大図のテキスト・リンク操作層を可視範囲だけDOM化する。
 * @param frame 「frame」は、「attachVirtualMermaidInteractions」がWebview UI状態の処理対象を特定する入力です。
 * @param layer 「layer」は、「attachVirtualMermaidInteractions」がWebview UI状態の処理対象を特定する入力です。
 * @param interactions 「interactions」は、「attachVirtualMermaidInteractions」がWebview UI状態の処理対象を特定する入力です。
 * @param scrollContainer 「scrollContainer」は、「attachVirtualMermaidInteractions」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「attachVirtualMermaidInteractions」の副作用または状態更新を実行し、値は返しません。
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


  /**
   * 要素を作成または組み立てます。
   * @param interaction 「interaction」は、「createElement」がWebview UI状態の処理対象を特定する入力です。
   * @param index 本文、表、配列内の対象位置を示すインデックスです。
   * @returns 「createElement」が生成したデータまたはオブジェクトを返します。
   */
  const createElement = /**
 * 「createElement」は、必要な初期状態または出力データを生成します。
 * @param interaction 「interaction」は、「createElement」がWebview UIで処理する対象を特定する入力です。
 * @param index 処理対象を特定する位置、範囲、または数量です。
 * @returns 「createElement」が生成したデータまたはオブジェクトを返します。
 */ (
    interaction: MermaidInteraction,
    index: number,
  ): HTMLElement => {
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


  /**
   * 「appendChunk」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param expectedGeneration 表示領域のサイズまたは倍率で、画面レイアウト計算に使用します。
   * @param pending 「pending」は、「appendChunk」がWebview UI状態の処理対象を特定する入力です。
   * @returns 「appendChunk」がWebview UI状態の入力を処理して得た固有の結果を返します。
   */
  const appendChunk = /**
 * 「appendChunk」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param expectedGeneration 「expectedGeneration」は、「appendChunk」がWebview UIで処理する対象を特定する入力です。
 * @param pending 「pending」は、「appendChunk」がWebview UIで処理する対象を特定する入力です。
 * @returns 「appendChunk」がWebview UI状態の入力を処理して得た固有の結果を返します。
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
 * 指定時間の経過後に遅延処理を実行するコールバックです。
         * @returns 「appendChunk」を実行し、値を返しません。
         */
        () => appendChunk(expectedGeneration, pending),
        0,
      );
    }
  };


  /**
   * updateを更新または保存します。
   * @returns 「if」を実行し、値を返しません。
   */
  const update = /**
 * 「update」は、入力を検証して対象の状態または内容へ適用します。
 * @returns 「if」を実行し、値を返しません。
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
 * 「interaction」「index」を受け取り、処理結果を生成する処理です。
     * @param interaction interactionとして渡される、このコールバックの入力値です。
     * @param index 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 「Math.max」を実行し、値を返しません。
     */
    (interaction, index) => {
      const top = frameBounds.top + interaction.top * frameBounds.height;
      const bottom = top + Math.max(1, interaction.height * frameBounds.height);
      if (bottom >= viewportTop && top <= viewportBottom)
        nextDesired.add(index);
    });
    desired = nextDesired;
    const selection = window.getSelection();
    elements.forEach(
    /**
 * 「element」「index」を受け取り、処理結果を生成する処理です。
     * @param element 処理対象の要素です。
     * @param index 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 「if」を実行し、値を返しません。
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
    });
    const pending = Array.from(desired).filter(
    /**
 * 「index」が条件に一致するか判定し、残す要素を決めるコールバックです。
     * @param index 本文、表、配列内の対象位置を示すインデックスです。
     * @returns 要素を採用するかどうかの真偽値を返します。
     */
    (index) => !elements.has(index));
    if (pending.length) appendChunk(generation, pending);
  };


  /**
   * 「schedule」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @returns 「schedule」がWebview UI状態の入力を処理して得た固有の結果を返します。
   */
  const schedule = /**
 * 「schedule」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @returns 「schedule」がWebview UI状態の入力を処理して得た固有の結果を返します。
 */ () => {
    if (frameRequest || isPreviewInputActive()) return;
    frameRequest = window.requestAnimationFrame(update);
  };

  /**
   * 「pauseForInput」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @returns 「pauseForInput」がWebview UI状態の入力を処理して得た固有の結果を返します。
   */
  const pauseForInput = /**
 * 「pauseForInput」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @returns 「pauseForInput」がWebview UI状態の入力を処理して得た固有の結果を返します。
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

  /**
   * 「cleanup」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @returns 購読解除、タイマー解除、リソース破棄などの後片付けを実行し、値は返しません。
   */
  const cleanup = /**
 * 「cleanup」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @returns 購読解除、タイマー解除、リソース破棄などの後片付けを実行し、値は返しません。
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
 * 「ImageCallbackRef」として扱う値の型を定義します。
 */
type ImageCallbackRef = React.MutableRefObject<
  ((imageIndex: number, width: number) => void) | undefined
>;
/**
 * 「ResetCallbackRef」として扱う値の型を定義します。
 */
type ResetCallbackRef = React.MutableRefObject<
  ((imageIndex: number) => void) | undefined
>;
/**
 * 「AlignmentCallbackRef」として扱う値の型を定義します。
 */
type AlignmentCallbackRef = React.MutableRefObject<
  ((imageIndex: number, alignment: ImageAlignment) => void) | undefined
>;

/**
 * プレビュー上の画像へリサイズ枠とドラッグハンドルを付与します。
 * @param root Markdownプレビューのルートです。
 * @param onResizeRef 幅確定時のコールバックです。
 * @param onResetRef サイズリセット時のコールバックです。
 * @param onAlignRef 処理完了時に呼び出すコールバックです。
 * @param onlyNearViewport 処理完了時に呼び出すコールバックです。
 * @param candidates 「candidates」は、「enhanceResizableImages」がWebview UI状態の処理対象を特定する入力です。
 * @returns 付与したDOMを解除する関数です。
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
 * 「image」が条件に一致するか判定し、残す要素を決めるコールバックです。
     * @param image imageとして渡される、このコールバックの入力値です。
     * @returns 要素を採用するかどうかの真偽値を返します。
     */
    (image) => !onlyNearViewport || isNearViewport(image, scrollContainer),
  );

  images.forEach(
  /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
   * @param image imageとして渡される、このコールバックの入力値です。
   * @returns 「if」を実行し、値を返しません。
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
      wrapperTarget === image ? undefined : wrapperTarget.getAttribute("style");
    const frame = document.createElement("span");
    frame.className = "mve-image-frame";
    frame.dataset.mveImageIndex = String(imageIndex);
    const imageAlignment = normalizeImageAlignment(image.dataset.mveImageAlign);
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


    /**
     * update・badgeを更新または保存します。
     * @returns 「getLogicalElementWidth」を実行し、値を返しません。
     */
    const updateBadge = /**
 * 「updateBadge」は、入力を検証して対象の状態または内容へ適用します。
 * @returns 「getLogicalElementWidth」を実行し、値を返しません。
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
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
     * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはalignment、label、textです。
     * @returns 「document.createElement」を実行し、値を返しません。
     */
    ([alignment, label, text]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mve-image-align-button";
      button.textContent = text;
      button.setAttribute("aria-label", label);
      button.title = label;
      button.dataset.active = alignment === imageAlignment ? "true" : "false";

      /**
       * 配置を処理します。
       * @param event 処理対象のイベントです。
       * @returns 「mveDebug」を実行し、値を返しません。
       */
      const applyAlignment = /**
 * 「applyAlignment」は、入力を検証して対象の状態または内容へ適用します。
 * @param event DOMイベントまたは入力イベントの情報です。
 * @returns 「mveDebug」を実行し、値を返しません。
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
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
           * @param candidate candidateとして渡される、このコールバックの入力値です。
           * @returns 条件を満たすかどうかを示す真偽値を返します。
           */
          (candidate) => {
            candidate.dataset.active = candidate === button ? "true" : "false";
          });
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
      resetButton.setAttribute("aria-label", "画像サイズをリセット");
      resetButton.title = "画像サイズをリセット";
      resetButton.addEventListener("click",
      /**
       * イベント情報を「event」を受け取り、DOMまたは画面状態を更新するコールバックです。
       * @param event 処理対象のイベントです。
       * @returns 「event.preventDefault」を実行し、値を返しません。
       */
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        onResetRef.current?.(imageIndex);
      });
      frame.appendChild(resetButton);
    }


    /**
     * handle・image・loadを処理します。
     * @returns 「Math.max」を実行し、値を返しません。
     */
    const handleImageLoad = /**
 * 「handleImageLoad」は、イベント入力を検証し、関連する状態またはUIを更新します。
 * @returns 「Math.max」を実行し、値を返しません。
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
     * イベント情報を受け取り、DOMまたは画面状態を更新するコールバックです。
     * @returns Webviewの状態から取得した値を返します。
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
    });
  });

  return cleanups.length
    ?
    /**
 * 登録された副作用または結果を生成する処理を実行するコールバックです。
     * @returns 「cleanups.forEach」の呼び出し結果を返します。
     */
    () => cleanups.forEach(
    /**
 * 「cleanup」を受け取り、登録された副作用または結果を生成する処理です。
     * @param cleanup cleanupとして渡される、このコールバックの入力値です。
     * @returns 購読解除、タイマー解除、リソース破棄などの後片付けを実行し、値は返しません。
     */
    (cleanup) => cleanup())
    : undefined;
}

/**
 * 画像ハンドルのポインター操作を登録します。
 * @param handle リサイズハンドルです。
 * @param frame 画像枠です。
 * @param image 対象画像です。
 * @param imageIndex 画像インデックスです。
 * @param root プレビューのルートです。
 * @param updateBadge 幅表示を更新する関数です。
 * @param onResizeRef 幅確定時のコールバックです。
 * @returns 登録解除関数です。
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


  /**
   * 「onPointerDown」は、イベント入力を受け取り、関連する状態またはUIを更新する処理です。
   * @param event 処理対象のイベントです。
   * @returns 「event.preventDefault」を実行し、値を返しません。
   */
  const onPointerDown = /**
 * 「onPointerDown」は、イベント入力を検証し、関連する状態またはUIを更新します。
 * @param event DOMイベントまたは入力イベントの情報です。
 * @returns 「event.preventDefault」を実行し、値を返しません。
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


    /**
     * 「onPointerMove」は、イベント入力を受け取り、関連する状態またはUIを更新する処理です。
     * @param moveEvent DOMまたはHostから通知されたイベントで、入力内容と発生元を含みます。
     * @returns 「if」を実行し、値を返しません。
     */
    const onPointerMove = /**
 * 「onPointerMove」は、イベント入力を検証し、関連する状態またはUIを更新します。
 * @param moveEvent DOMイベントまたは入力イベントの情報です。
 * @returns 「if」を実行し、値を返しません。
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

    /**
     * 「finish」は、処理を終了し、保持していたリソースまたは状態を整理します。
     * @param commit 「commit」は、「finish」がWebview UI状態の処理対象を特定する入力です。
     * @returns 「finish」がWebview UI状態の入力を処理して得た固有の結果を返します。
     */
    const finish = /**
 * 「finish」は、処理を終了し、保持していたリソースまたは状態を整理します。
 * @param commit 「commit」は、「finish」がWebview UIで処理する対象を特定する入力です。
 * @returns 「if」を実行し、値を返しません。
 */ (commit: boolean) =>
    /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
     * @param finishEvent DOMまたはHostから通知されたイベントで、入力内容と発生元を含みます。
     * @returns 「if」を実行し、値を返しません。
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
     * イベント情報を受け取り、DOMまたは画面状態を更新するコールバックです。
     * @returns 「handle.removeEventListener」の呼び出し結果を返します。
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
  return /** イベント情報を受け取り、DOMまたは画面状態を更新するコールバックです。 @returns 後片付けまたは登録解除を完了した結果を返します。 */ () => {
    handle.removeEventListener("pointerdown", onPointerDown);
    activeCleanup?.();
  };
}

/**
 * 表示中の画像幅を取得します。
 * @param image 対象画像です。
 * @param root 処理対象のルートです。
 * @returns CSS zoomを除いた論理幅です。
 */
function getRenderedImageWidth(image: HTMLImageElement, root: HTMLElement): number {
  return getLogicalElementWidth(image, root);
}

/**
 * 通常プレビューの画像表示倍率を取得します。
 * @param root Markdownプレビューのルートです。
 * @returns 画像表示倍率です。
 */
function getPreviewImageZoom(root: HTMLElement): number {
  const value = Number.parseFloat(root.dataset.mveImageZoom ?? "");
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * CSS zoom後の表示幅をMarkdownへ保存する論理幅へ戻します。
 * @param element 表示幅を取得する要素です。
 * @param root Markdownプレビューのルートです。
 * @returns 表示倍率を除いた論理幅です。
 */
function getLogicalElementWidth(element: HTMLElement, root: HTMLElement): number {
  const width = element.getBoundingClientRect().width;
  if (!(width > 0)) return 0;
  return Math.round(width / getPreviewImageZoom(root));
}

/**
 * HTMLのwidth属性を数値として取得します。
 * @param image 対象画像です。
 * @returns width属性、なければ0です。
 */
function getExplicitImageWidth(image: HTMLImageElement): number {
  const value = Number.parseFloat(image.getAttribute("width") ?? "");
  return Number.isFinite(value) ? value : 0;
}

/**
 * 画像を置ける表示幅を取得します。
 * @param root プレビューのルートです。
 * @returns 画像の最大幅です。
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
 * 配置を正規化します。
 * @param value 「normalizeImageAlignment」で検証・変換する入力値です。
 * @returns 「normalizeImageAlignment」が読み取りまたは正規化した結果を返します。
 */
function normalizeImageAlignment(value: string | undefined): ImageAlignment {
  return value === "center" || value === "right" ? value : "left";
}

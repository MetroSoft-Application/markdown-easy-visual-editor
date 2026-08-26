import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { ImageAlignment } from '../shared/imageResize';
import type { MermaidInteraction, WebviewSettings } from '../shared/protocol';
import { getMessages } from '../shared/messages';
import { renderMarkdown } from './markdownRenderer';
import {
  mermaidErrorMessage,
  renderMermaidSvg,
  type MermaidRenderResult
} from './mermaidRenderer';
import { mveDebug } from './debug';

export type InspectorTarget =
  | { type: 'mermaid'; source: string }
  | { type: 'math'; source: string }
  | { type: 'image'; source: string; alt: string; imageIndex?: number };

interface Props {
  markdown: string;
  /** 複数の表示先で共有する、計算済みのHTML。 */
  html?: string;
  settings: WebviewSettings;
  className?: string;
  onInspect?: (target: InspectorTarget) => void;
  onImageResize?: (imageIndex: number, width: number) => void;
  onImageReset?: (imageIndex: number) => void;
  onImageAlign?: (imageIndex: number, alignment: ImageAlignment) => void;
  onNavigate?: (href: string) => void;
  onRendered?: (element: HTMLElement) => void;
  deferMermaid?: boolean;
}

/**
 * MarkdownのHTMLプレビューを表示し、図・画像・リンクの操作を親へ通知する。
 * @param props プレビュー本文、表示設定、操作通知コールバック。
 * @returns レンダリングされたMarkdownプレビュー。
 */
function RenderedMarkdownView({
  markdown,
  html: providedHtml,
  settings,
  className = '',
  onInspect,
  onImageResize,
  onImageReset,
  onImageAlign,
  onNavigate,
  onRendered,
  deferMermaid = false
}: Props): React.JSX.Element {
  // MarkdownをHTMLへ変換し、Mermaid・画像・リンクの表示後処理を行うプレビューを描画する。
  const rootRef = useRef<HTMLDivElement>(null);
  const renderedBlocksRef = useRef<RenderedDomBlock[]>([]);
  const mermaidObjectUrlsRef = useRef(new Set<string>());
  const mermaidRenderControllersRef = useRef(new Map<HTMLElement, { key: string; controller: AbortController }>());
  const mermaidInteractionManagersRef = useRef(new Map<HTMLElement, () => void>());
  const mermaidCacheRef = useRef(new MermaidResultCache());
  const onRenderedRef = useRef(onRendered);
  const onImageResizeRef = useRef(onImageResize);
  const onImageResetRef = useRef(onImageReset);
  const onImageAlignRef = useRef(onImageAlign);
  onRenderedRef.current = onRendered;
  onImageResizeRef.current = onImageResize;
  onImageResetRef.current = onImageReset;
  onImageAlignRef.current = onImageAlign;
  const html = useMemo(
    () => providedHtml ?? renderMarkdown(markdown, { remoteImagesEnabled: settings.remoteImagesEnabled, language: settings.language }),
    [providedHtml, markdown, settings.language, settings.remoteImagesEnabled]
  );

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const startedAt = performance.now();
    renderedBlocksRef.current = reconcileRenderedBlocks(root, renderedBlocksRef.current, html);
    root.dataset.renderRevision = String((Number(root.dataset.renderRevision) || 0) + 1);
    performance.clearMeasures('mve-preview-dom-reconcile');
    performance.measure('mve-preview-dom-reconcile', { start: startedAt, end: performance.now() });
  }, [html]);

  useEffect(() => () => {
    mermaidRenderControllersRef.current.forEach(({ controller }) => controller.abort());
    mermaidRenderControllersRef.current.clear();
    mermaidObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    mermaidObjectUrlsRef.current.clear();
    mermaidInteractionManagersRef.current.forEach((cleanup) => cleanup());
    mermaidInteractionManagersRef.current.clear();
  }, []);

  useEffect(() => {
    // HTMLの更新を監視し、未処理のMermaidや画像の読み込み後にレイアウトを通知する。
    const root = rootRef.current;
    if (!root) return;
    // 表の短い項目名だけを改行禁止にし、長い先頭列の横溢れを防ぐ。
    root.querySelectorAll<HTMLTableElement>('table').forEach((table) => {
      Array.from(table.rows).forEach((row) => {
        const cell = row.cells[0];
        if (!cell) return;
        const text = cell.textContent?.trim() ?? '';
        if (text.length > 0 && Array.from(text).length <= 8 && !/\s/.test(text)) {
          cell.dataset.mveNowrap = 'true';
        } else {
          delete cell.dataset.mveNowrap;
        }
      });
    });
    root.dataset.renderEffect = 'active';
    const dark = settings.editorTheme
      ? settings.editorTheme === 'dark'
      : document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
    const theme = settings.mermaidTheme === 'auto' ? (dark ? 'dark' : 'default') : settings.mermaidTheme;
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
      const source = decodeURIComponent(node.dataset.mermaidSource ?? '');
      if (node.isConnected && entry.key === `${theme}\0${source}`) return;
      entry.controller.abort();
      renderControllers.delete(node);
      delete node.dataset.mermaidStatus;
    });
    const notifyRendered = () => {
      if (cancelled) return;
      // 出力ステージはMermaidが全件確定する前のResizeObserver通知を完了扱いしない。
      if (!deferMermaid && root.querySelector(
        '.mermaid:not([data-mermaid-status]), .mermaid[data-mermaid-status="rendering"]'
      )) return;
      onRenderedRef.current?.(root);
    };
    const applyMermaid = async (
      node: HTMLElement,
      source: string,
      rendered: MermaidRenderResult,
      isCurrent: () => boolean
    ): Promise<void> => {
      const applyStartedAt = performance.now();
      const recordApplyDuration = (startedAt = applyStartedAt) => {
        performance.clearMeasures('mve-preview-mermaid-apply');
        performance.measure('mve-preview-mermaid-apply', { start: startedAt, end: performance.now() });
      };
      if (deferMermaid && isPreviewInputActive()) {
        await waitForPreviewInputIdle(renderControllers.get(node)?.controller.signal);
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
      const svgBlob = new Blob([rendered.svg], { type: 'image/svg+xml' });
      const rasterStartedAt = performance.now();
      let previewBlob = svgBlob;
      try {
        previewBlob = rendered.pngBase64
          ? await decodeBase64Png(rendered.pngBase64)
          : await rasterizeMermaidPreview(svgBlob, rendered.svg, root);
      } catch {
        // createImageBitmap/OffscreenCanvas非対応環境では従来どおりSVG画像を使用する。
      }
      performance.clearMeasures('mve-preview-mermaid-rasterize');
      performance.measure('mve-preview-mermaid-rasterize', { start: rasterStartedAt, end: performance.now() });
      if (!node.isConnected || !isCurrent()) return;
      const domApplyStartedAt = performance.now();
      const objectUrl = URL.createObjectURL(previewBlob);
      mermaidObjectUrls.add(objectUrl);
      const frame = document.createElement('div');
      frame.className = 'mermaid-svg-frame';
      frame.dataset.mveRasterized = previewBlob.type === 'image/png' ? 'true' : 'false';
      frame.style.aspectRatio = String(readSvgAspectRatio(rendered.svg));
      frame.setAttribute('role', 'img');
      frame.setAttribute('aria-label', rendered.ariaLabel || `Mermaid: ${source.split(/\r?\n/, 1)[0] ?? ''}`);
      const image = document.createElement('img');
      image.className = 'mermaid-svg-image';
      image.alt = '';
      image.draggable = false;
      image.src = objectUrl;
      image.addEventListener('load', () => {
        notifyRendered();
      }, { once: true });
      frame.append(image);
      let interactionLayer: HTMLDivElement | undefined;
      if (rendered.interactions.length) {
        interactionLayer = document.createElement('div');
        interactionLayer.className = 'mermaid-interaction-layer';
        frame.append(interactionLayer);
      }
      interactionManagers.get(node)?.();
      interactionManagers.delete(node);
      node.replaceChildren(frame);
      if (interactionLayer) {
        interactionManagers.set(node, attachVirtualMermaidInteractions(
          frame,
          interactionLayer,
          rendered.interactions,
          scrollContainer
        ));
      }
      recordApplyDuration(domApplyStartedAt);
    };
    /**
     * 未描画のMermaidノードを抽出してSVGへ置き換え、描画後のレイアウトを通知する。
     * @returns Mermaidノードの描画が完了するPromise。
     */
    const renderNodes = async (): Promise<boolean> => {
      // 未描画のMermaidノードを抽出し、SVG描画結果またはエラー表示を反映する。
      const allNodes = Array.from(root.querySelectorAll<HTMLElement>('.mermaid'));
      const pending = allNodes.filter((node) => (
        !node.dataset.mermaidStatus
        && (!deferMermaid || isNearViewport(node, scrollContainer))
      ));
      if (!pending.length) {
        if (!allNodes.some((node) => node.dataset.mermaidStatus === 'rendering')) {
          notifyRendered();
        }
        return allNodes.some((node) => !node.dataset.mermaidStatus);
      }
      // ホスト側は直列描画なので、可視・画面外・出力のいずれも要求を先行投入しない。
      // 世代ごとに1件だけ開始すれば、更新時の取消対象と35秒タイマーも常に1件に収まる。
      const batch = pending.slice(0, 1);
      await Promise.all(batch.map(async (node) => {
        // ノードごとにソースを復元して描画し、以前の描画結果をエラー時の代替として保持する。
        const index = allNodes.indexOf(node);
        const blockKey = `index:${index}`;
        const source = decodeURIComponent(node.dataset.mermaidSource ?? '');
        const sourceCacheKey = `source:${theme}\0${source}`;
        const renderKey = `${theme}\0${source}`;
        node.dataset.mermaidStatus = 'rendering';
        const controller = new AbortController();
        renderControllers.set(node, { key: renderKey, controller });
        const isCurrent = () => (
          !controller.signal.aborted && renderControllers.get(node)?.controller === controller
        );
        const cached = deferMermaid ? mermaidCacheRef.current.get(sourceCacheKey) : undefined;
        if (cached) {
          try {
            await applyMermaid(node, source, cached, isCurrent);
            if (!node.isConnected || renderControllers.get(node)?.controller !== controller) return;
            node.dataset.mermaidStatus = 'ready';
            mermaidCacheRef.current.set(`block:${blockKey}`, cached);
          } finally {
            if (renderControllers.get(node)?.controller === controller) renderControllers.delete(node);
          }
          return;
        }
        try {
          const rendered = await renderMermaidSvg(
            source,
            theme,
            controller.signal,
            settings.mermaidHostRendering === true,
            !deferMermaid
          );
          if (!node.isConnected || renderControllers.get(node)?.controller !== controller) return;
          await applyMermaid(node, source, rendered, isCurrent);
          if (!node.isConnected || renderControllers.get(node)?.controller !== controller) return;
          node.dataset.mermaidStatus = 'ready';
          mermaidCacheRef.current.set(`block:${blockKey}`, rendered);
          if (deferMermaid && rendered.external) {
            mermaidCacheRef.current.set(sourceCacheKey, rendered);
          }
        } catch (error) {
          if (controller.signal.aborted || !node.isConnected || renderControllers.get(node)?.controller !== controller) return;
          const previous = mermaidCacheRef.current.get(`block:${blockKey}`);
          if (previous) await applyMermaid(node, source, previous, isCurrent);
          else node.replaceChildren();
          if (!node.isConnected || renderControllers.get(node)?.controller !== controller) return;
          node.dataset.mermaidStatus = 'error';
          const message = document.createElement('pre');
          message.className = 'mermaid-error-message';
          message.textContent = mermaidErrorMessage(error, settings.language);
          node.append(message);
        } finally {
          if (renderControllers.get(node)?.controller === controller) renderControllers.delete(node);
        }
      }));
      notifyRendered();
      return allNodes.some((node) => !node.dataset.mermaidStatus);
    };
    const scheduleRenderNodes = (delay = deferMermaid ? 80 : 0, restart = false) => {
      const startedAt = performance.now();
      if (restart && renderTimer !== undefined) {
        window.clearTimeout(renderTimer);
        renderTimer = undefined;
      }
      if (!cancelled && renderTimer === undefined && (!deferMermaid || !isPreviewInputActive())) {
        renderTimer = window.setTimeout(() => {
          renderTimer = undefined;
          void renderNodes().then(() => {
            const hasNextForegroundNode = Array.from(root.querySelectorAll<HTMLElement>('.mermaid')).some((node) => (
              !node.dataset.mermaidStatus
              && (!deferMermaid || isNearViewport(node, scrollContainer))
            ));
            if (hasNextForegroundNode) scheduleRenderNodes();
          });
        }, delay);
      }
      performance.clearMeasures('mve-preview-scroll-mermaid-schedule');
      performance.measure('mve-preview-scroll-mermaid-schedule', { start: startedAt, end: performance.now() });
    };
    const imageResizeCleanups: Array<() => void> = [];
    const pendingImageEnhancements = new Set<HTMLImageElement>();
    let imageEnhanceTimer: number | undefined;
    const enhanceImages = (candidates?: HTMLImageElement[]) => {
      if (onImageResizeRef.current || onImageAlignRef.current) {
        const cleanup = enhanceResizableImages(
          root,
          onImageResizeRef,
          onImageResetRef,
          onImageAlignRef,
          candidates === undefined && deferMermaid,
          candidates
        );
        if (cleanup) imageResizeCleanups.push(cleanup);
      }
    };
    const processImageEnhancementChunk = () => {
      imageEnhanceTimer = undefined;
      if (cancelled) return;
      if (deferMermaid && isPreviewInputActive()) {
        imageEnhanceTimer = window.setTimeout(processImageEnhancementChunk, 100);
        return;
      }
      const activityDelay = 100 - (performance.now() - lastViewportActivityAt);
      if (activityDelay > 0) {
        imageEnhanceTimer = window.setTimeout(processImageEnhancementChunk, activityDelay);
        return;
      }
      const startedAt = performance.now();
      let processed = 0;
      for (const image of pendingImageEnhancements) {
        pendingImageEnhancements.delete(image);
        if (image.isConnected && image.dataset.mveEnhanced !== 'true') enhanceImages([image]);
        processed += 1;
        if (processed >= 1 || performance.now() - startedAt >= 4) break;
      }
      performance.clearMeasures('mve-preview-image-enhance');
      performance.measure('mve-preview-image-enhance', { start: startedAt, end: performance.now() });
      if (pendingImageEnhancements.size) {
        imageEnhanceTimer = window.setTimeout(processImageEnhancementChunk, 0);
      }
    };
    const scheduleImageEnhancements = (imagesToEnhance: HTMLImageElement[]) => {
      imagesToEnhance.forEach((image) => pendingImageEnhancements.add(image));
      if (imageEnhanceTimer === undefined && pendingImageEnhancements.size) {
        imageEnhanceTimer = window.setTimeout(processImageEnhancementChunk, 0);
      }
    };
    const resizeObserver = new ResizeObserver(() => {
      notifyRendered();
    });
    resizeObserver.observe(root);
    const images = Array.from(root.querySelectorAll('img'));
    let imageEnhanceObserver: IntersectionObserver | undefined;
    if (onImageResizeRef.current || onImageAlignRef.current) {
      const resizableImages = Array.from(root.querySelectorAll<HTMLImageElement>(
        'img[data-mve-image-index][data-mve-resizable="true"]:not([data-mve-enhanced="true"])'
      ));
      if (deferMermaid && typeof IntersectionObserver !== 'undefined') {
        imageEnhanceObserver = new IntersectionObserver((entries) => {
          if (cancelled) return;
          const visibleImages = entries
            .filter((entry) => entry.isIntersecting && entry.target instanceof HTMLImageElement)
            .map((entry) => entry.target as HTMLImageElement);
          visibleImages.forEach((image) => imageEnhanceObserver?.unobserve(image));
          if (visibleImages.length) scheduleImageEnhancements(visibleImages);
        }, {
          root: scrollContainer,
          rootMargin: '600px 0px'
        });
        resizableImages.forEach((image) => imageEnhanceObserver?.observe(image));
      } else {
        enhanceImages(resizableImages);
      }
    }
    // 画像の読み込み完了時に、変化したプレビューの大きさを親へ通知する。
    /**
     * 画像の読み込み完了を親へ通知し、プレビューサイズの再計算を促す。
     * @returns 何も返さない。
     */
    const imageLoaded = () => { notifyRendered(); };
    images.forEach((image) => image.addEventListener('load', imageLoaded));
    const scheduleAfterViewportActivity = () => {
      lastViewportActivityAt = performance.now();
      scheduleRenderNodes(120, true);
    };
    scrollContainer?.addEventListener('scroll', scheduleAfterViewportActivity, { passive: true });
    window.addEventListener('resize', scheduleAfterViewportActivity, { passive: true });
    const pauseForInput = () => {
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
      scheduleRenderNodes(120, true);
      if (pendingImageEnhancements.size) scheduleImageEnhancements([]);
    };
    window.addEventListener('mve-preview-input-active', pauseForInput);
    window.addEventListener('mve-preview-input-settled', resumeAfterInput);
    if (deferMermaid) onRenderedRef.current?.(root);
    scheduleRenderNodes();
    return () => {
      cancelled = true;
      if (renderTimer !== undefined) window.clearTimeout(renderTimer);
      if (imageEnhanceTimer !== undefined) window.clearTimeout(imageEnhanceTimer);
      pendingImageEnhancements.clear();
      resizeObserver.disconnect();
      imageEnhanceObserver?.disconnect();
      images.forEach((image) => image.removeEventListener('load', imageLoaded));
      scrollContainer?.removeEventListener('scroll', scheduleAfterViewportActivity);
      window.removeEventListener('resize', scheduleAfterViewportActivity);
      window.removeEventListener('mve-preview-input-active', pauseForInput);
      window.removeEventListener('mve-preview-input-settled', resumeAfterInput);
      imageResizeCleanups.forEach((cleanup) => cleanup());
      // 差分更新で再利用したMermaid画像のBlob URLは維持し、DOMから消えた分だけ解放する。
      mermaidObjectUrls.forEach((url) => {
        if (Array.from(root.querySelectorAll<HTMLImageElement>('img.mermaid-svg-image')).some((image) => image.src === url)) return;
        URL.revokeObjectURL(url);
        mermaidObjectUrls.delete(url);
      });
    };
  }, [html, markdown, settings.editorTheme, settings.language, settings.mermaidTheme, settings.mermaidHostRendering, Boolean(onImageResize), Boolean(onImageAlign), deferMermaid]);

  /**
   * ダブルクリックされたプレビュー要素から編集対象の図・数式・画像を判定する。
   * @param event プレビュー上のダブルクリックイベント。
   * @returns 何も返さない。
   */
  function onDoubleClick(event: React.MouseEvent<HTMLDivElement>): void {
    // ダブルクリックされた要素からMermaid・数式・画像の編集対象を特定して通知する。
    const target = event.target as HTMLElement;
    const mermaidNode = target.closest<HTMLElement>('[data-mermaid-source]');
    if (mermaidNode) {
      onInspect?.({ type: 'mermaid', source: decodeURIComponent(mermaidNode.dataset.mermaidSource ?? '') });
      return;
    }
    const mathNode = target.closest<HTMLElement>('[data-math-source]');
    if (mathNode) {
      onInspect?.({ type: 'math', source: decodeURIComponent(mathNode.dataset.mathSource ?? '') });
      return;
    }
    const image = target.closest<HTMLImageElement>('img[data-original-src]');
    if (image) {
      const imageIndex = Number.parseInt(image.dataset.mveImageIndex ?? '', 10);
      onInspect?.({
        type: 'image',
        source: image.dataset.originalSrc ?? '',
        alt: image.alt,
        imageIndex: Number.isFinite(imageIndex) ? imageIndex : undefined
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
    const copy = target.closest<HTMLButtonElement>('[data-copy-code]');
    if (copy) {
      const code = copy.closest('figure')?.querySelector('code')?.textContent ?? '';
      void navigator.clipboard.writeText(code);
      const messages = getMessages(settings.language);
      copy.textContent = messages.renderer.copied;
      window.setTimeout(() => (copy.textContent = messages.renderer.copy), 1200);
      return;
    }
    const anchor = target.closest<HTMLAnchorElement>('a[href]');
    if (anchor) {
      const originalHref = anchor.dataset.mveLink;
      const href = originalHref ?? anchor.getAttribute('href') ?? '';
      if (!originalHref && href.startsWith('#')) {
        event.preventDefault();
        rootRef.current?.querySelector<HTMLElement>(href)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      onDoubleClick={onDoubleClick}
      onClick={onClick}
    />
  );
}

export const RenderedMarkdown = React.memo(RenderedMarkdownView);

interface RenderedDomBlock {
  signature: string;
  node: Element;
}

/**
 * Markdownのトップレベルブロックを比較し、共通の前後ブロックを同じDOMノードのまま保持する。
 * 通常の一文字編集では変更対象の1ブロックだけを交換し、全文DOM再構築を避ける。
 */
function reconcileRenderedBlocks(
  root: HTMLElement,
  previous: RenderedDomBlock[],
  html: string
): RenderedDomBlock[] {
  const template = document.createElement('template');
  template.innerHTML = html;
  const next = Array.from(template.content.children).map((node) => ({
    signature: renderedBlockSignature(node),
    node
  }));

  // 外部DOM操作や開発時の再マウントで参照がずれた場合だけ、安全に全件を再構築する。
  if (previous.length !== root.children.length
    || previous.some((entry, index) => root.children[index] !== entry.node)) {
    root.replaceChildren(...next.map((entry) => entry.node));
    return next;
  }

  let prefix = 0;
  while (prefix < previous.length
    && prefix < next.length
    && previous[prefix].signature === next[prefix].signature) {
    syncRenderedBlockAttributes(previous[prefix].node, next[prefix].node);
    next[prefix] = { signature: next[prefix].signature, node: previous[prefix].node };
    prefix += 1;
  }

  let previousSuffix = previous.length - 1;
  let nextSuffix = next.length - 1;
  while (previousSuffix >= prefix
    && nextSuffix >= prefix
    && previous[previousSuffix].signature === next[nextSuffix].signature) {
    syncRenderedBlockAttributes(previous[previousSuffix].node, next[nextSuffix].node);
    next[nextSuffix] = { signature: next[nextSuffix].signature, node: previous[previousSuffix].node };
    previousSuffix -= 1;
    nextSuffix -= 1;
  }

  for (let index = prefix; index <= previousSuffix; index += 1) previous[index].node.remove();
  if (prefix <= nextSuffix) {
    const fragment = document.createDocumentFragment();
    for (let index = prefix; index <= nextSuffix; index += 1) fragment.append(next[index].node);
    const suffixAnchor = nextSuffix + 1 < next.length ? next[nextSuffix + 1].node : null;
    root.insertBefore(fragment, suffixAnchor);
  }
  return next;
}

function renderedBlockSignature(node: Element): string {
  if (node.classList.contains('markdown-source-block')) {
    return `source:${node.className}\0${node.innerHTML}`;
  }
  return `other:${node.outerHTML}`;
}

function syncRenderedBlockAttributes(current: Element, next: Element): void {
  Array.from(current.attributes).forEach((attribute) => current.removeAttribute(attribute.name));
  Array.from(next.attributes).forEach((attribute) => current.setAttribute(attribute.name, attribute.value));
}

const MERMAID_CACHE_ENTRY_LIMIT = 16;
const MERMAID_CACHE_BYTE_LIMIT = 16 * 1024 * 1024;

class MermaidResultCache {
  private readonly entries = new Map<string, MermaidRenderResult>();
  private readonly retained = new Map<MermaidRenderResult, { bytes: number; references: number }>();
  private totalBytes = 0;

  get(key: string): MermaidRenderResult | undefined {
    const result = this.entries.get(key);
    if (!result) return undefined;
    this.entries.delete(key);
    this.entries.set(key, result);
    return result;
  }

  set(key: string, result: MermaidRenderResult): void {
    const previous = this.entries.get(key);
    if (previous) {
      this.entries.delete(key);
      this.release(previous);
    }
    this.entries.set(key, result);
    this.retain(result);
    while (this.entries.size > MERMAID_CACHE_ENTRY_LIMIT || this.totalBytes > MERMAID_CACHE_BYTE_LIMIT) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const removed = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      if (removed) this.release(removed);
    }
  }

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

  private release(result: MermaidRenderResult): void {
    const retained = this.retained.get(result);
    if (!retained) return;
    retained.references -= 1;
    if (retained.references > 0) return;
    this.retained.delete(result);
    this.totalBytes -= retained.bytes;
  }
}

function estimateMermaidResultBytes(result: MermaidRenderResult): number {
  return (result.svg.length + result.ariaLabel.length + (result.pngBase64?.length ?? 0)) * 2
    + result.interactions.reduce((total, interaction) => (
      total + (interaction.text.length + (interaction.href?.length ?? 0)) * 2 + 64
    ), 0);
}

async function decodeBase64Png(base64: string): Promise<Blob> {
  const chunks: ArrayBuffer[] = [];
  // Base64全体へのatobは巨大な一時文字列を同期生成してUIを停止させる。
  // 4文字境界のチャンクごとにデコードし、各チャンク後にイベントループへ戻す。
  const base64ChunkSize = 256 * 1024;
  for (let offset = 0; offset < base64.length; offset += base64ChunkSize) {
    const binary = window.atob(base64.slice(offset, offset + base64ChunkSize));
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    chunks.push(buffer);
    if (offset + base64ChunkSize < base64.length) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  }
  return new Blob(chunks, { type: 'image/png' });
}

function isPreviewInputActive(): boolean {
  return document.body.dataset.mveInputActive === 'true';
}

function waitForPreviewInputIdle(signal?: AbortSignal): Promise<void> {
  if (!isPreviewInputActive() || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      window.removeEventListener('mve-preview-input-settled', finish);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    window.addEventListener('mve-preview-input-settled', finish, { once: true });
    signal?.addEventListener('abort', finish, { once: true });
  });
}

function findScrollContainer(root: HTMLElement): HTMLElement | undefined {
  let parent = root.parentElement;
  while (parent && parent !== document.body) {
    const style = window.getComputedStyle(parent);
    if (/(auto|scroll|overlay)/.test(style.overflowY)) return parent;
    parent = parent.parentElement;
  }
  return undefined;
}

function isNearViewport(node: HTMLElement, scrollContainer: HTMLElement | undefined): boolean {
  const rect = node.getBoundingClientRect();
  const viewport = scrollContainer?.getBoundingClientRect();
  const viewportTop = viewport?.top ?? 0;
  const viewportBottom = viewport?.bottom ?? window.innerHeight;
  const margin = 900;
  return rect.bottom >= viewportTop - margin && rect.top <= viewportBottom + margin;
}

/** 巨大Mermaid SVGを表示幅に合わせたPNGへオフメインスレッド寄りの経路で変換する。 */
async function rasterizeMermaidPreview(svgBlob: Blob, svg: string, root: HTMLElement): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    throw new Error('Mermaid rasterization is unavailable.');
  }
  const aspectRatio = readSvgAspectRatio(svg);
  const pixelRatio = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
  let width = Math.max(1, Math.ceil(Math.min(1200, root.clientWidth || 1200) * pixelRatio));
  let height = Math.max(1, Math.ceil(width / aspectRatio));
  const maximumDimension = 8192;
  const maximumPixels = 8 * 1024 * 1024;
  const scale = Math.min(
    1,
    maximumDimension / width,
    maximumDimension / height,
    Math.sqrt(maximumPixels / (width * height))
  );
  width = Math.max(1, Math.floor(width * scale));
  height = Math.max(1, Math.floor(height * scale));
  const bitmap = await createImageBitmap(svgBlob, {
    resizeWidth: width,
    resizeHeight: height,
    resizeQuality: 'high'
  });
  try {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Mermaid raster canvas is unavailable.');
    context.drawImage(bitmap, 0, 0, width, height);
    return await canvas.convertToBlob({ type: 'image/png' });
  } finally {
    bitmap.close();
  }
}

function readSvgAspectRatio(svg: string): number {
  const tag = svg.match(/<svg\b[^>]*>/i)?.[0] ?? '';
  const viewBox = tag.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    return Math.min(100, Math.max(0.01, viewBox[2] / viewBox[3]));
  }
  const width = Number.parseFloat(tag.match(/\bwidth\s*=\s*["']([\d.]+)/i)?.[1] ?? '');
  const height = Number.parseFloat(tag.match(/\bheight\s*=\s*["']([\d.]+)/i)?.[1] ?? '');
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return Math.min(100, Math.max(0.01, width / height));
  }
  return 16 / 9;
}

/** 巨大図のテキスト・リンク操作層を可視範囲だけDOM化する。 */
function attachVirtualMermaidInteractions(
  frame: HTMLElement,
  layer: HTMLElement,
  interactions: MermaidInteraction[],
  scrollContainer: HTMLElement | undefined
): () => void {
  const elements = new Map<number, HTMLElement>();
  let desired = new Set<number>();
  let frameRequest = 0;
  let appendTimer: number | undefined;
  let generation = 0;

  const createElement = (interaction: MermaidInteraction, index: number): HTMLElement => {
    const element = interaction.type === 'link'
      ? document.createElement('a')
      : document.createElement('span');
    element.className = `mermaid-interaction mermaid-interaction-${interaction.type}`;
    element.dataset.mveInteractionIndex = String(index);
    element.textContent = interaction.text;
    element.style.left = `${interaction.left * 100}%`;
    element.style.top = `${interaction.top * 100}%`;
    element.style.width = `${interaction.width * 100}%`;
    element.style.height = `${interaction.height * 100}%`;
    if (element instanceof HTMLAnchorElement && interaction.href) {
      element.href = interaction.href;
      element.setAttribute('aria-label', interaction.text);
    } else {
      element.setAttribute('aria-hidden', 'true');
    }
    return element;
  };

  const appendChunk = (expectedGeneration: number, pending: number[]) => {
    appendTimer = undefined;
    if (expectedGeneration !== generation || !frame.isConnected) return;
    const startedAt = performance.now();
    const fragment = document.createDocumentFragment();
    let appended = 0;
    while (pending.length && appended < 8 && performance.now() - startedAt < 2) {
      const index = pending.shift() as number;
      if (!desired.has(index) || elements.has(index)) continue;
      const element = createElement(interactions[index], index);
      elements.set(index, element);
      fragment.append(element);
      appended += 1;
    }
    layer.append(fragment);
    if (pending.length) {
      appendTimer = window.setTimeout(() => appendChunk(expectedGeneration, pending), 0);
    }
  };

  const update = () => {
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
    interactions.forEach((interaction, index) => {
      const top = frameBounds.top + interaction.top * frameBounds.height;
      const bottom = top + Math.max(1, interaction.height * frameBounds.height);
      if (bottom >= viewportTop && top <= viewportBottom) nextDesired.add(index);
    });
    desired = nextDesired;
    const selection = window.getSelection();
    elements.forEach((element, index) => {
      if (desired.has(index)) return;
      const selectionUsesElement = Boolean(selection && (
        (selection.anchorNode && element.contains(selection.anchorNode))
        || (selection.focusNode && element.contains(selection.focusNode))
      ));
      if (selectionUsesElement) return;
      element.remove();
      elements.delete(index);
    });
    const pending = Array.from(desired).filter((index) => !elements.has(index));
    if (pending.length) appendChunk(generation, pending);
  };

  const schedule = () => {
    if (frameRequest || isPreviewInputActive()) return;
    frameRequest = window.requestAnimationFrame(update);
  };
  const pauseForInput = () => {
    if (frameRequest) {
      window.cancelAnimationFrame(frameRequest);
      frameRequest = 0;
    }
    if (appendTimer !== undefined) {
      window.clearTimeout(appendTimer);
      appendTimer = undefined;
    }
  };
  const cleanup = () => {
    if (frameRequest) window.cancelAnimationFrame(frameRequest);
    if (appendTimer !== undefined) window.clearTimeout(appendTimer);
    scrollContainer?.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('mve-preview-input-active', pauseForInput);
    window.removeEventListener('mve-preview-input-settled', schedule);
    elements.clear();
  };
  scrollContainer?.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('mve-preview-input-active', pauseForInput);
  window.addEventListener('mve-preview-input-settled', schedule);
  schedule();
  return cleanup;
}

type ImageCallbackRef = React.MutableRefObject<((imageIndex: number, width: number) => void) | undefined>;
type ResetCallbackRef = React.MutableRefObject<((imageIndex: number) => void) | undefined>;
type AlignmentCallbackRef = React.MutableRefObject<((imageIndex: number, alignment: ImageAlignment) => void) | undefined>;

/**
 * プレビュー上の画像へリサイズ枠とドラッグハンドルを付与します。
 * @param root Markdownプレビューのルートです。
 * @param onResizeRef 幅確定時のコールバックです。
 * @param onResetRef サイズリセット時のコールバックです。
 * @returns 付与したDOMを解除する関数です。
 */
function enhanceResizableImages(
  root: HTMLElement,
  onResizeRef: ImageCallbackRef,
  onResetRef: ResetCallbackRef,
  onAlignRef: AlignmentCallbackRef,
  onlyNearViewport = false,
  candidates?: HTMLImageElement[]
): (() => void) | undefined {
  const cleanups: Array<() => void> = [];
  const scrollContainer = onlyNearViewport ? findScrollContainer(root) : undefined;
  const images = (candidates ?? Array.from(root.querySelectorAll<HTMLImageElement>(
    'img[data-mve-image-index][data-mve-resizable="true"]:not([data-mve-enhanced="true"])'
  )))
    .filter((image) => !onlyNearViewport || isNearViewport(image, scrollContainer));

  images.forEach((image) => {
    if (image.dataset.mveEnhanced === 'true' || !image.parentElement) return;
    const imageIndex = Number.parseInt(image.dataset.mveImageIndex ?? '', 10);
    if (!Number.isFinite(imageIndex)) return;

    const wrapperTarget = image.parentElement?.tagName.toLowerCase() === 'picture' ? image.parentElement : image;
    const targetParent = wrapperTarget?.parentElement;
    if (!wrapperTarget || !targetParent) return;
    const originalStyle = image.getAttribute('style');
    const originalWrapperStyle = wrapperTarget === image ? undefined : wrapperTarget.getAttribute('style');
    const frame = document.createElement('span');
    frame.className = 'mve-image-frame';
    frame.dataset.mveImageIndex = String(imageIndex);
    const imageAlignment = normalizeImageAlignment(image.dataset.mveImageAlign);
    frame.dataset.mveImageAlign = imageAlignment;
    image.dataset.mveEnhanced = 'true';
    targetParent.insertBefore(frame, wrapperTarget);
    frame.appendChild(wrapperTarget);

    const badge = document.createElement('span');
    badge.className = 'mve-image-badge';
    frame.appendChild(badge);

    // ソースに保存されたwidthは、画像の自然幅や現在の未ロード状態より優先する。
    const preferredWidth = getExplicitImageWidth(image) || getRenderedImageWidth(image) || image.naturalWidth || 320;
    frame.style.width = `${Math.max(1, Math.min(preferredWidth, getAvailableImageWidth(root)))}px`;
    if (wrapperTarget !== image) {
      wrapperTarget.style.display = 'block';
      wrapperTarget.style.width = '100%';
    }
    image.style.display = 'block';
    image.style.width = '100%';
    image.style.maxWidth = '100%';
    image.style.height = 'auto';

    const updateBadge = () => {
      badge.textContent = `${Math.round(image.getBoundingClientRect().width || preferredWidth)}px`;
    };
    updateBadge();

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'mve-image-handle';
    handle.setAttribute('aria-label', '画像をリサイズ');
    handle.title = '画像をリサイズ';
    frame.appendChild(handle);
    const pointerCleanup = attachResizePointer(handle, frame, image, imageIndex, root, updateBadge, onResizeRef);

    const alignmentActions = document.createElement('span');
    alignmentActions.className = 'mve-image-align-actions';
    const alignmentLabels: Array<[ImageAlignment, string, string]> = [
      ['left', '左揃え', '左'],
      ['center', '中央揃え', '中'],
      ['right', '右揃え', '右']
    ];
    alignmentLabels.forEach(([alignment, label, text]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mve-image-align-button';
      button.textContent = text;
      button.setAttribute('aria-label', label);
      button.title = label;
      button.dataset.active = alignment === imageAlignment ? 'true' : 'false';
      const applyAlignment = (event: Event) => {
        mveDebug('image-alignment-event', {
          eventType: event.type,
          imageIndex,
          alignment,
          title: button.title
        });
        event.preventDefault();
        event.stopPropagation();
        frame.dataset.mveImageAlign = alignment;
        alignmentActions.querySelectorAll<HTMLButtonElement>('.mve-image-align-button').forEach((candidate) => {
          candidate.dataset.active = candidate === button ? 'true' : 'false';
        });
        onAlignRef.current?.(imageIndex, alignment);
      };
      button.addEventListener('click', applyAlignment);
      alignmentActions.appendChild(button);
    });
    frame.appendChild(alignmentActions);

    let resetButton: HTMLButtonElement | undefined;
    if (image.dataset.mveCanReset === 'true' && onResetRef.current) {
      resetButton = document.createElement('button');
      resetButton.type = 'button';
      resetButton.className = 'mve-image-reset';
      resetButton.textContent = '↺';
      resetButton.setAttribute('aria-label', '画像サイズをリセット');
      resetButton.title = '画像サイズをリセット';
      resetButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onResetRef.current?.(imageIndex);
      });
      frame.appendChild(resetButton);
    }

    const handleImageLoad = () => {
      // width属性を持つ画像は、loadイベント後も明示幅を維持する。
      const nextWidth = Math.max(1, Math.min(getExplicitImageWidth(image) || getRenderedImageWidth(image) || image.naturalWidth || preferredWidth, getAvailableImageWidth(root)));
      frame.style.width = `${nextWidth}px`;
      updateBadge();
    };
    image.addEventListener('load', handleImageLoad);

    cleanups.push(() => {
      pointerCleanup();
      image.removeEventListener('load', handleImageLoad);
      if (frame.parentElement) frame.replaceWith(wrapperTarget);
      image.dataset.mveEnhanced = '';
      if (originalStyle === null) image.removeAttribute('style');
      else image.setAttribute('style', originalStyle);
      if (wrapperTarget !== image) {
        if (originalWrapperStyle === null) wrapperTarget.removeAttribute('style');
        else if (originalWrapperStyle !== undefined) wrapperTarget.setAttribute('style', originalWrapperStyle);
      }
      resetButton?.remove();
    });
  });

  return cleanups.length ? () => cleanups.forEach((cleanup) => cleanup()) : undefined;
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
  onResizeRef: ImageCallbackRef
): () => void {
  let activeCleanup: (() => void) | undefined;

  const onPointerDown = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = frame.getBoundingClientRect().width || image.getBoundingClientRect().width;
    const minWidth = 48;
    const maxWidth = getAvailableImageWidth(root);
    const originalFrameWidth = frame.style.width;
    frame.classList.add('is-resizing');
    handle.setPointerCapture(pointerId);

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const nextWidth = Math.min(maxWidth, Math.max(minWidth, Math.round(startWidth + moveEvent.clientX - startX)));
      frame.style.width = `${nextWidth}px`;
      updateBadge();
    };
    const finish = (commit: boolean) => (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId !== pointerId) return;
      handle.releasePointerCapture(pointerId);
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onPointerUp);
      handle.removeEventListener('pointercancel', onPointerCancel);
      frame.classList.remove('is-resizing');
      activeCleanup = undefined;
      if (!commit) {
        frame.style.width = originalFrameWidth;
        updateBadge();
        return;
      }
      const width = Math.min(maxWidth, Math.max(minWidth, Math.round(frame.getBoundingClientRect().width)));
      onResizeRef.current?.(imageIndex, width);
    };
    const onPointerUp = finish(true);
    const onPointerCancel = finish(false);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerCancel);
    activeCleanup = () => {
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onPointerUp);
      handle.removeEventListener('pointercancel', onPointerCancel);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    };
  };

  handle.addEventListener('pointerdown', onPointerDown);
  return () => {
    handle.removeEventListener('pointerdown', onPointerDown);
    activeCleanup?.();
  };
}

/**
 * 表示中の画像幅を取得します。
 * @param image 対象画像です。
 * @returns 表示幅です。
 */
function getRenderedImageWidth(image: HTMLImageElement): number {
  return Math.round(image.getBoundingClientRect().width);
}

/**
 * HTMLのwidth属性を数値として取得します。
 * @param image 対象画像です。
 * @returns width属性、なければ0です。
 */
function getExplicitImageWidth(image: HTMLImageElement): number {
  const value = Number.parseFloat(image.getAttribute('width') ?? '');
  return Number.isFinite(value) ? value : 0;
}

/**
 * 画像を置ける表示幅を取得します。
 * @param root プレビューのルートです。
 * @returns 画像の最大幅です。
 */
function getAvailableImageWidth(root: HTMLElement): number {
  const styles = window.getComputedStyle(root);
  const padding = parseFloat(styles.paddingLeft || '0') + parseFloat(styles.paddingRight || '0');
  const scrollbar = root.offsetWidth - root.clientWidth;
  return Math.max(120, Math.floor(root.clientWidth - padding - scrollbar));
}

function normalizeImageAlignment(value: string | undefined): ImageAlignment {
  return value === 'center' || value === 'right' ? value : 'left';
}

import React, { useEffect, useMemo, useRef } from 'react';
import type { ImageAlignment } from '../shared/imageResize';
import type { WebviewSettings } from '../shared/protocol';
import { getMessages } from '../shared/messages';
import { renderMarkdown } from './markdownRenderer';
import { mermaidErrorMessage, renderMermaidSvg } from './mermaidRenderer';
import { mveDebug } from './debug';

export type InspectorTarget =
  | { type: 'mermaid'; source: string }
  | { type: 'math'; source: string }
  | { type: 'image'; source: string; alt: string; imageIndex?: number };

interface Props {
  markdown: string;
  settings: WebviewSettings;
  className?: string;
  onInspect?: (target: InspectorTarget) => void;
  onImageResize?: (imageIndex: number, width: number) => void;
  onImageReset?: (imageIndex: number) => void;
  onImageAlign?: (imageIndex: number, alignment: ImageAlignment) => void;
  onNavigate?: (href: string) => void;
  onRendered?: (element: HTMLElement) => void;
}

/**
 * MarkdownのHTMLプレビューを表示し、図・画像・リンクの操作を親へ通知する。
 * @param props プレビュー本文、表示設定、操作通知コールバック。
 * @returns レンダリングされたMarkdownプレビュー。
 */
function RenderedMarkdownView({
  markdown,
  settings,
  className = '',
  onInspect,
  onImageResize,
  onImageReset,
  onImageAlign,
  onNavigate,
  onRendered
}: Props): React.JSX.Element {
  // MarkdownをHTMLへ変換し、Mermaid・画像・リンクの表示後処理を行うプレビューを描画する。
  const rootRef = useRef<HTMLDivElement>(null);
  const lastMermaidRef = useRef(new Map<number, string>());
  const onRenderedRef = useRef(onRendered);
  const onImageResizeRef = useRef(onImageResize);
  const onImageResetRef = useRef(onImageReset);
  const onImageAlignRef = useRef(onImageAlign);
  onRenderedRef.current = onRendered;
  onImageResizeRef.current = onImageResize;
  onImageResetRef.current = onImageReset;
  onImageAlignRef.current = onImageAlign;
  const html = useMemo(
    () => renderMarkdown(markdown, { remoteImagesEnabled: settings.remoteImagesEnabled, language: settings.language }),
    [markdown, settings.language, settings.remoteImagesEnabled]
  );

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
    const dark = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
    const theme = settings.mermaidTheme === 'auto' ? (dark ? 'dark' : 'default') : settings.mermaidTheme;
    let cancelled = false;
    /**
     * 未描画のMermaidノードを抽出してSVGへ置き換え、描画後のレイアウトを通知する。
     * @returns Mermaidノードの描画が完了するPromise。
     */
    const renderNodes = async () => {
      // 未描画のMermaidノードを抽出し、SVG描画結果またはエラー表示を反映する。
      const allNodes = Array.from(root.querySelectorAll<HTMLElement>('.mermaid'));
      const pending = allNodes.filter((node) => !node.dataset.mermaidStatus);
      if (!pending.length) {
        onRenderedRef.current?.(root);
        return;
      }
      await Promise.all(pending.map(async (node) => {
        // ノードごとにソースを復元して描画し、以前の描画結果をエラー時の代替として保持する。
        const index = allNodes.indexOf(node);
        const source = decodeURIComponent(node.dataset.mermaidSource ?? '');
        node.dataset.mermaidStatus = 'rendering';
        try {
          const svg = await renderMermaidSvg(source, theme);
          if (cancelled || !node.isConnected) return;
          node.innerHTML = svg;
          node.dataset.mermaidStatus = 'ready';
          lastMermaidRef.current.set(index, svg);
        } catch (error) {
          if (cancelled || !node.isConnected) return;
          const previous = lastMermaidRef.current.get(index);
          node.innerHTML = previous ?? '';
          node.dataset.mermaidStatus = 'error';
          const message = document.createElement('pre');
          message.className = 'mermaid-error-message';
          message.textContent = mermaidErrorMessage(error, settings.language);
          node.append(message);
        }
      }));
      if (!cancelled) onRenderedRef.current?.(root);
    };
    const imageResizeCleanups: Array<() => void> = [];
    const enhanceImages = () => {
      if (onImageResizeRef.current || onImageAlignRef.current) {
        imageResizeCleanups.push(enhanceResizableImages(root, onImageResizeRef, onImageResetRef, onImageAlignRef));
      }
    };
    const observer = new MutationObserver(() => {
      enhanceImages();
      void renderNodes();
    });
    observer.observe(root, { childList: true, subtree: true });
    const resizeObserver = new ResizeObserver(() => {
      if (!cancelled) onRenderedRef.current?.(root);
    });
    resizeObserver.observe(root);
    const images = Array.from(root.querySelectorAll('img'));
    enhanceImages();
    // 画像の読み込み完了時に、変化したプレビューの大きさを親へ通知する。
    /**
     * 画像の読み込み完了を親へ通知し、プレビューサイズの再計算を促す。
     * @returns 何も返さない。
     */
    const imageLoaded = () => { if (!cancelled) onRenderedRef.current?.(root); };
    images.forEach((image) => image.addEventListener('load', imageLoaded));
    void renderNodes();
    return () => {
      cancelled = true;
      observer.disconnect();
      resizeObserver.disconnect();
      images.forEach((image) => image.removeEventListener('load', imageLoaded));
      imageResizeCleanups.forEach((cleanup) => cleanup());
    };
  }, [html, markdown, settings.language, settings.mermaidTheme, Boolean(onImageResize), Boolean(onImageAlign)]);

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
      const href = anchor.getAttribute('href') ?? '';
      if (href.startsWith('#')) {
        event.preventDefault();
        rootRef.current?.querySelector<HTMLElement>(href)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (onNavigate) {
        event.preventDefault();
        onNavigate(href);
      }
    }
  }

  return (
    <div
      ref={rootRef}
      className={`rendered-markdown ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onDoubleClick={onDoubleClick}
      onClick={onClick}
    />
  );
}

export const RenderedMarkdown = React.memo(RenderedMarkdownView);

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
  onAlignRef: AlignmentCallbackRef
): () => void {
  const cleanups: Array<() => void> = [];
  const images = Array.from(root.querySelectorAll<HTMLImageElement>('img[data-mve-image-index][data-mve-resizable="true"]'));

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

  return () => cleanups.forEach((cleanup) => cleanup());
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

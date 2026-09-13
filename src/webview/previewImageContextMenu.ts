const MENU_CLASS = "mve-preview-image-context-menu";
const TOAST_CLASS = "mve-preview-image-copy-toast";
const MAX_CLIPBOARD_DIMENSION = 16_384;
const MAX_CLIPBOARD_PIXELS = 64 * 1024 * 1024;

type CopyImageText = {
  copy: string;
  preparing: string;
  copied: string;
  unavailable: string;
  failed: string;
};

interface PreparedClipboardImage {
  source: string;
  html: string;
  originalBlob?: Blob;
  originalType?: string;
  pngBlob?: Blob;
}

const COPY_IMAGE_TEXT: Record<string, CopyImageText> = {
  ja: {
    copy: "画像をコピー",
    preparing: "画像を準備中…",
    copied: "画像をクリップボードにコピーしました",
    unavailable: "この画像はコピーできません",
    failed: "画像のコピーに失敗しました",
  },
  en: {
    copy: "Copy image",
    preparing: "Preparing image…",
    copied: "Image copied to clipboard",
    unavailable: "This image cannot be copied",
    failed: "Failed to copy image",
  },
  "zh-cn": {
    copy: "复制图像",
    preparing: "正在准备图像…",
    copied: "图像已复制到剪贴板",
    unavailable: "无法复制此图像",
    failed: "复制图像失败",
  },
  ko: {
    copy: "이미지 복사",
    preparing: "이미지 준비 중…",
    copied: "이미지를 클립보드에 복사했습니다",
    unavailable: "이 이미지는 복사할 수 없습니다",
    failed: "이미지 복사에 실패했습니다",
  },
  fr: {
    copy: "Copier l’image",
    preparing: "Préparation de l’image…",
    copied: "Image copiée dans le presse-papiers",
    unavailable: "Cette image ne peut pas être copiée",
    failed: "Impossible de copier l’image",
  },
  de: {
    copy: "Bild kopieren",
    preparing: "Bild wird vorbereitet…",
    copied: "Bild in die Zwischenablage kopiert",
    unavailable: "Dieses Bild kann nicht kopiert werden",
    failed: "Bild konnte nicht kopiert werden",
  },
  es: {
    copy: "Copiar imagen",
    preparing: "Preparando imagen…",
    copied: "Imagen copiada al portapapeles",
    unavailable: "No se puede copiar esta imagen",
    failed: "No se pudo copiar la imagen",
  },
};

/**
 * プレビュー上のMarkdown画像へ右クリックメニューを追加し、画像本体をクリップボードへコピーする。
 * 元形式を利用できる環境では元形式を保持し、貼り付け互換用の画像・HTML・テキスト表現も用意する。
 * Markdown本文や画像の表示サイズは変更しない。
 */
export function installPreviewImageContextMenu(): () => void {
  let menu: HTMLDivElement | undefined;
  let toastTimer: number | undefined;
  let generation = 0;

  const closeMenu = () => {
    generation += 1;
    menu?.remove();
    menu = undefined;
  };

  const onContextMenu = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;
    const image = event.target.closest<HTMLImageElement>(
      '.rendered-markdown img[data-original-src][data-mve-image-kind]',
    );
    if (!image) {
      closeMenu();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openMenu(image, event.clientX, event.clientY);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (
      !menu ||
      !(event.target instanceof Node) ||
      menu.contains(event.target)
    )
      return;
    closeMenu();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !menu) return;
    event.preventDefault();
    closeMenu();
  };

  const onViewportChange = () => closeMenu();

  document.addEventListener("contextmenu", onContextMenu, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("resize", onViewportChange, { passive: true });
  window.addEventListener("blur", onViewportChange);
  document.addEventListener("scroll", onViewportChange, true);

  return () => {
    closeMenu();
    if (toastTimer !== undefined) window.clearTimeout(toastTimer);
    document.removeEventListener("contextmenu", onContextMenu, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("resize", onViewportChange);
    window.removeEventListener("blur", onViewportChange);
    document.removeEventListener("scroll", onViewportChange, true);
    document
      .querySelectorAll(`.${TOAST_CLASS}`)
      .forEach((node) => node.remove());
  };

  function openMenu(
    image: HTMLImageElement,
    clientX: number,
    clientY: number,
  ): void {
    closeMenu();
    const currentGeneration = generation;
    const text = copyImageText(document.documentElement.lang);
    const nextMenu = document.createElement("div");
    nextMenu.className = MENU_CLASS;
    nextMenu.setAttribute("role", "menu");
    nextMenu.setAttribute("aria-label", text.copy);

    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.disabled = true;
    button.textContent = text.preparing;
    nextMenu.append(button);
    document.body.append(nextMenu);
    menu = nextMenu;
    positionMenu(nextMenu, image, clientX, clientY);

    let prepared: PreparedClipboardImage | undefined;
    void prepareClipboardImage(image)
      .then((value) => {
        if (generation !== currentGeneration || menu !== nextMenu) return;
        prepared = value;
        button.disabled = false;
        button.textContent = text.copy;
        button.focus({ preventScroll: true });
      })
      .catch((error: unknown) => {
        console.warn(
          "[Markdown Easy Visual Editor] Preview image copy preparation failed.",
          error,
        );
        if (generation !== currentGeneration || menu !== nextMenu) return;
        button.disabled = true;
        button.textContent = text.unavailable;
        nextMenu.dataset.state = "error";
      });

    button.addEventListener("click", () => {
      if (!prepared) return;
      const target = prepared;
      closeMenu();
      void copyPreparedImage(image, target)
        .then((copied) => {
          showToast(copied ? text.copied : text.failed, !copied);
        })
        .catch((error: unknown) => {
          console.warn(
            "[Markdown Easy Visual Editor] Preview image clipboard write failed.",
            error,
          );
          showToast(text.failed, true);
        });
    });
  }

  function showToast(message: string, error: boolean): void {
    if (toastTimer !== undefined) window.clearTimeout(toastTimer);
    document
      .querySelectorAll(`.${TOAST_CLASS}`)
      .forEach((node) => node.remove());
    const toast = document.createElement("div");
    toast.className = TOAST_CLASS;
    toast.dataset.state = error ? "error" : "success";
    toast.setAttribute("role", error ? "alert" : "status");
    toast.textContent = message;
    document.body.append(toast);
    toastTimer = window.setTimeout(() => {
      toast.remove();
      toastTimer = undefined;
    }, 2200);
  }
}

function positionMenu(
  menu: HTMLElement,
  image: HTMLImageElement,
  clientX: number,
  clientY: number,
): void {
  const imageBounds = image.getBoundingClientRect();
  const requestedX = clientX > 0 ? clientX : imageBounds.left + 12;
  const requestedY = clientY > 0 ? clientY : imageBounds.top + 12;
  const margin = 8;
  const bounds = menu.getBoundingClientRect();
  const left = Math.min(
    Math.max(margin, requestedX),
    Math.max(margin, window.innerWidth - bounds.width - margin),
  );
  const top = Math.min(
    Math.max(margin, requestedY),
    Math.max(margin, window.innerHeight - bounds.height - margin),
  );
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

async function prepareClipboardImage(
  image: HTMLImageElement,
): Promise<PreparedClipboardImage> {
  const renderedSource = image.currentSrc || image.src;
  if (!renderedSource) throw new Error("Image source is empty.");

  const source =
    image.dataset.originalSrc || image.getAttribute("src") || renderedSource;
  const alt = image.getAttribute("alt") ?? "";
  const prepared: PreparedClipboardImage = {
    source,
    html: `<img src="${escapeHtmlAttribute(source)}" alt="${escapeHtmlAttribute(alt)}">`,
  };

  try {
    const blob = renderedSource.startsWith("data:")
      ? dataUrlToBlob(renderedSource)
      : await fetchImageBlob(renderedSource);
    const type = resolveImageMimeType(blob.type, source);
    if (type) {
      prepared.originalType = type;
      prepared.originalBlob =
        blob.type === type ? blob : blob.slice(0, blob.size, type);
      if (type === "image/png") prepared.pngBlob = prepared.originalBlob;
    }
  } catch (error) {
    console.warn(
      "[Markdown Easy Visual Editor] Original preview image bytes are unavailable; using rendered image fallback.",
      error,
    );
  }

  if (!prepared.pngBlob) {
    try {
      prepared.pngBlob = await rasterizeElementToPng(image);
    } catch (elementError) {
      if (prepared.originalBlob) {
        try {
          prepared.pngBlob = await rasterizeBlobToPng(prepared.originalBlob);
        } catch (blobError) {
          console.warn(
            "[Markdown Easy Visual Editor] Preview image PNG compatibility representation failed.",
            { elementError, blobError },
          );
        }
      }
    }
  }

  if (!prepared.originalBlob && !prepared.pngBlob) {
    throw new Error("Image data is unavailable.");
  }
  return prepared;
}

async function copyPreparedImage(
  image: HTMLImageElement,
  prepared: PreparedClipboardImage,
): Promise<boolean> {
  const clipboard = navigator.clipboard;
  if (clipboard?.write && typeof ClipboardItem !== "undefined") {
    const representations: Record<string, Blob> = {
      "text/html": new Blob([prepared.html], { type: "text/html" }),
      "text/plain": new Blob([prepared.source], { type: "text/plain" }),
    };

    const originalSupported = Boolean(
      prepared.originalBlob &&
        prepared.originalType &&
        clipboardSupportsType(prepared.originalType),
    );
    if (
      originalSupported &&
      prepared.originalBlob &&
      prepared.originalType
    ) {
      representations[prepared.originalType] = prepared.originalBlob;
    }
    if (prepared.pngBlob && !representations["image/png"]) {
      representations["image/png"] = prepared.pngBlob;
    }

    try {
      await writeClipboardWithFocusRetry(
        clipboard,
        new ClipboardItem(representations),
      );
      return true;
    } catch (richError) {
      console.warn(
        "[Markdown Easy Visual Editor] Rich preview image clipboard write failed; retrying image representation.",
        richError,
      );

      if (
        originalSupported &&
        prepared.originalBlob &&
        prepared.originalType
      ) {
        try {
          await writeClipboardWithFocusRetry(
            clipboard,
            new ClipboardItem({
              [prepared.originalType]: prepared.originalBlob,
            }),
          );
          return true;
        } catch (originalError) {
          console.warn(
            "[Markdown Easy Visual Editor] Original-format image clipboard write failed.",
            originalError,
          );
        }
      }

      if (prepared.pngBlob) {
        try {
          await writeClipboardWithFocusRetry(
            clipboard,
            new ClipboardItem({ "image/png": prepared.pngBlob }),
          );
          return true;
        } catch (pngError) {
          console.warn(
            "[Markdown Easy Visual Editor] PNG compatibility clipboard write failed.",
            pngError,
          );
        }
      }
    }
  }

  return copyRenderedImageBySelection(image);
}

async function writeClipboardWithFocusRetry(
  clipboard: Clipboard,
  item: ClipboardItem,
  retries = 5,
): Promise<void> {
  if (!document.hasFocus() && retries > 0) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
    return writeClipboardWithFocusRetry(clipboard, item, retries - 1);
  }
  await clipboard.write([item]);
}

function copyRenderedImageBySelection(image: HTMLImageElement): boolean {
  const selection = window.getSelection();
  if (!selection) return false;

  const previousRanges: Range[] = [];
  for (let index = 0; index < selection.rangeCount; index += 1) {
    previousRanges.push(selection.getRangeAt(index).cloneRange());
  }

  try {
    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNode(image);
    selection.addRange(range);
    return document.execCommand("copy");
  } catch (error) {
    console.warn(
      "[Markdown Easy Visual Editor] Preview image selection-copy fallback failed.",
      error,
    );
    return false;
  } finally {
    selection.removeAllRanges();
    for (const range of previousRanges) {
      try {
        selection.addRange(range);
      } catch {
        // DOM更新済みの古い選択範囲は復元しない。
      }
    }
  }
}

/** ClipboardItemが元MIMEを受け付ける場合だけその形式を使う。 */
export function clipboardSupportsType(type: string): boolean {
  const normalized = normalizeMimeType(type);
  if (!normalized || typeof ClipboardItem === "undefined") return false;
  if (normalized === "image/png") return true;
  const supports = (
    ClipboardItem as typeof ClipboardItem & {
      supports?: (mimeType: string) => boolean;
    }
  ).supports;
  if (typeof supports !== "function") return false;
  try {
    return supports(normalized);
  } catch {
    return false;
  }
}

function resolveImageMimeType(type: string, source: string): string {
  const normalized = normalizeMimeType(type);
  if (normalized.startsWith("image/")) return normalized;
  return imageMimeTypeFromSource(source);
}

function normalizeMimeType(type: string): string {
  const normalized = type.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (normalized === "image/jpg" || normalized === "image/pjpeg") {
    return "image/jpeg";
  }
  if (normalized === "image/svg") return "image/svg+xml";
  return normalized;
}

function imageMimeTypeFromSource(source: string): string {
  const value = source.split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  if (/\.png$/.test(value)) return "image/png";
  if (/\.jpe?g$/.test(value)) return "image/jpeg";
  if (/\.webp$/.test(value)) return "image/webp";
  if (/\.gif$/.test(value)) return "image/gif";
  if (/\.svg$/.test(value)) return "image/svg+xml";
  if (/\.bmp$/.test(value)) return "image/bmp";
  if (/\.avif$/.test(value)) return "image/avif";
  return "";
}

async function fetchImageBlob(source: string): Promise<Blob> {
  const response = await fetch(source, {
    cache: "force-cache",
    credentials: "omit",
  });
  if (!response.ok) {
    throw new Error(`Image request failed: ${response.status}`);
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error("Image response is empty.");
  return blob;
}

function dataUrlToBlob(source: string): Blob {
  const match = /^data:([^;,]*)([^,]*?),(.*)$/s.exec(source);
  if (!match) throw new Error("Invalid data image URL.");
  const mime = normalizeMimeType(match[1] || "application/octet-stream");
  const metadata = match[2] ?? "";
  const payload = match[3] ?? "";
  if (/;base64/i.test(metadata)) {
    const binary = window.atob(payload.replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(payload)], { type: mime });
}

async function rasterizeBlobToPng(blob: Blob): Promise<Blob> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      try {
        return await rasterizeCanvasSource(bitmap, bitmap.width, bitmap.height);
      } finally {
        bitmap.close();
      }
    } catch {
      // SVGなどcreateImageBitmapが扱えない形式はHTMLImageElementへフォールバックする。
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    if (typeof image.decode === "function") await image.decode();
    else await waitForImageLoad(image);
    return await rasterizeElementToPng(image);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function rasterizeElementToPng(image: HTMLImageElement): Promise<Blob> {
  if (!image.complete) await waitForImageLoad(image);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width <= 0 || height <= 0) {
    throw new Error("Image dimensions are unavailable.");
  }
  return rasterizeCanvasSource(image, width, height);
}

async function rasterizeCanvasSource(
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<Blob> {
  const size = fitClipboardDimensions(width, height);
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Clipboard canvas is unavailable.");
    context.drawImage(source, 0, 0, size.width, size.height);
    return canvas.convertToBlob({ type: "image/png" });
  }

  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Clipboard canvas is unavailable.");
  context.drawImage(source, 0, 0, size.width, size.height);
  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("PNG conversion failed."));
      }, "image/png");
    } catch (error) {
      reject(error);
    }
  });
}

/** 巨大画像でフォールバック変換が過剰なメモリを確保しないよう表示比率を保って制限する。 */
export function fitClipboardDimensions(
  width: number,
  height: number,
): { width: number; height: number } {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("Invalid image dimensions.");
  }
  const scale = Math.min(
    1,
    MAX_CLIPBOARD_DIMENSION / width,
    MAX_CLIPBOARD_DIMENSION / height,
    Math.sqrt(MAX_CLIPBOARD_PIXELS / (width * height)),
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function waitForImageLoad(image: HTMLImageElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const loaded = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("Image could not be decoded."));
    };
    const cleanup = () => {
      image.removeEventListener("load", loaded);
      image.removeEventListener("error", failed);
    };
    image.addEventListener("load", loaded, { once: true });
    image.addEventListener("error", failed, { once: true });
  });
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function copyImageText(language: string): CopyImageText {
  const normalized = language.trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "zh" || normalized.startsWith("zh-cn")) {
    return COPY_IMAGE_TEXT["zh-cn"];
  }
  return COPY_IMAGE_TEXT[normalized.split("-")[0]] ?? COPY_IMAGE_TEXT.en;
}

interface PreservedImagePaste {
  file: File;
  type: string;
}

/**
 * プレビュー画像コピーがHTML表現へ保持した元画像バイト列をFileへ戻し、
 * App既存の画像貼り付け処理へ再投入する。
 * Markdown本文へdata URLを直接挿入しない。
 */
export function installPreviewImageClipboardPaste(): () => void {
  const onPaste = (event: ClipboardEvent) => {
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest<HTMLElement>(".cm-content")) return;

    const preserved = readPreservedImagePaste(event.clipboardData);
    if (!preserved) return;

    let transfer: DataTransfer;
    try {
      transfer = new DataTransfer();
      transfer.items.add(preserved.file);
    } catch (error) {
      console.warn(
        "[Markdown Easy Visual Editor] Could not reconstruct copied preview image as a file.",
        error,
      );
      return;
    }

    const target = event.target;
    event.preventDefault();
    event.stopImmediatePropagation();

    const forwarded = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      composed: true,
      clipboardData: transfer,
    });
    target.dispatchEvent(forwarded);
  };

  document.addEventListener("paste", onPaste, true);
  return () => document.removeEventListener("paste", onPaste, true);
}

/**
 * この拡張機能の画像コピーだけを識別し、HTMLに埋め込まれた元形式data URLを
 * 同じMIME・同じバイト列のFileへ復元する。
 */
export function readPreservedImagePaste(
  clipboard: DataTransfer | null,
): PreservedImagePaste | undefined {
  if (!clipboard) return undefined;
  const html = clipboard.getData("text/html");
  if (!html) return undefined;

  const documentNode = new DOMParser().parseFromString(html, "text/html");
  const image = documentNode.querySelector<HTMLImageElement>(
    "img[data-mve-original-src]",
  );
  if (!image) return undefined;

  const dataUrl = image.getAttribute("src")?.trim() ?? "";
  const parsed = decodeImageDataUrl(dataUrl);
  if (!parsed) return undefined;

  const extension = extensionForImageMime(parsed.type);
  const fileName = `clipboard-image.${extension}`;
  return {
    type: parsed.type,
    file: new File([parsed.bytes], fileName, { type: parsed.type }),
  };
}

/** data:image/*;base64,... を元バイト列へ戻す。 */
export function decodeImageDataUrl(
  value: string,
): { type: string; bytes: Uint8Array } | undefined {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(value);
  if (!match) return undefined;
  const type = normalizeMimeType(match[1] ?? "");
  if (!type.startsWith("image/")) return undefined;

  const payload = (match[2] ?? "").replace(/\s+/g, "");
  if (!payload) return undefined;

  try {
    const binary = window.atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return { type, bytes };
  } catch {
    return undefined;
  }
}

function extensionForImageMime(type: string): string {
  switch (normalizeMimeType(type)) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    case "image/bmp":
      return "bmp";
    case "image/avif":
      return "avif";
    default:
      return "img";
  }
}

function normalizeMimeType(type: string): string {
  const normalized = type.trim().toLowerCase();
  if (normalized === "image/jpg" || normalized === "image/pjpeg") {
    return "image/jpeg";
  }
  if (normalized === "image/svg") return "image/svg+xml";
  if (normalized === "image/x-ms-bmp") return "image/bmp";
  return normalized;
}

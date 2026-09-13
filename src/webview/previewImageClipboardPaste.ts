interface PreservedImagePaste {
  file: File;
  type: string;
}

/**
 * プレビュー画像コピーがHTML表現へ保持した元画像バイト列をFileへ戻し、
 * App既存の画像貼り付け処理へ再投入する。
 * Markdown本文へdata URLを直接挿入せず、画像形式も変換しない。
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
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    const target = event.target;
    event.preventDefault();
    event.stopImmediatePropagation();

    // React側の既存pasteハンドラーへ、通常の画像ファイル貼り付けとして渡す。
    // この合成イベントには埋め込みHTMLを含めないため、このハンドラー自身では再処理されない。
    const forwarded = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      composed: true,
      clipboardData: transfer,
    });

    // Chromium実装差でClipboardEventInit.clipboardDataが反映されない場合も、
    // App側から同じDataTransferを読めるように補完する。
    if (!forwarded.clipboardData?.items.length) {
      try {
        Object.defineProperty(forwarded, "clipboardData", {
          configurable: true,
          value: transfer,
        });
      } catch (error) {
        console.warn(
          "[Markdown Easy Visual Editor] Could not attach copied preview image to paste event.",
          error,
        );
        return;
      }
    }

    target.dispatchEvent(forwarded);
  };

  document.addEventListener("paste", onPaste, true);
  return () => document.removeEventListener("paste", onPaste, true);
}

/**
 * HTMLに埋め込まれた元形式data URLを同じバイト列のFileへ復元する。
 * data-mve-original-srcが残っていれば元拡張子を優先し、失われていてもMIMEから復元する。
 */
export function readPreservedImagePaste(
  clipboard: DataTransfer | null,
): PreservedImagePaste | undefined {
  if (!clipboard) return undefined;
  const html = clipboard.getData("text/html");
  if (!html) return undefined;

  const documentNode = new DOMParser().parseFromString(html, "text/html");
  const image = Array.from(documentNode.querySelectorAll<HTMLImageElement>("img")).find(
    (candidate) => /^data:image\//i.test(candidate.getAttribute("src")?.trim() ?? ""),
  );
  if (!image) return undefined;

  const dataUrl = image.getAttribute("src")?.trim() ?? "";
  const parsed = decodeImageDataUrl(dataUrl);
  if (!parsed) return undefined;

  const originalSource = image.getAttribute("data-mve-original-src") ?? "";
  const extension =
    imageExtensionFromSource(originalSource) ?? extensionForImageMime(parsed.type);

  // Appの既存BMP貼り付けは image/bmp だけをPNG化するため、同義MIMEで元BMPを保持する。
  // ホスト側では image/x-ms-bmp を .bmp として正式に受け付ける。
  const fileType = parsed.type === "image/bmp" ? "image/x-ms-bmp" : parsed.type;
  return {
    type: parsed.type,
    file: new File([parsed.bytes], `clipboard-image.${extension}`, {
      type: fileType,
    }),
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

function imageExtensionFromSource(source: string): string | undefined {
  const clean = source.split(/[?#]/, 1)[0] ?? "";
  const match = /\.([a-z0-9]{1,12})$/i.exec(clean);
  return match?.[1]?.toLowerCase();
}

function extensionForImageMime(type: string): string {
  switch (normalizeMimeType(type)) {
    case "image/png":
      return "png";
    case "image/apng":
      return "apng";
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
    case "image/x-icon":
    case "image/vnd.microsoft.icon":
      return "ico";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    case "image/jxl":
      return "jxl";
    case "image/tiff":
      return "tiff";
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

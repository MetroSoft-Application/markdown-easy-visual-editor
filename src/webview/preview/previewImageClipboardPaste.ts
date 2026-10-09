/**
 * @fileoverview クリップボードから貼り付けた画像を検証し、画像保存と本文への参照挿入へつなぐ。
 */
/**
 * 貼り付け後も保持する画像データと挿入位置です。
 */
interface PreservedImagePaste {

    /**
     * previewimageclipboardpasteで読み書きするリソースの場所。
     */
    file: File;

    /**
     * 画像ファイルのMIMEタイプを示す文字列です。
     */
    type: string;
}

/**
 * プレビュー画像上の貼り付けを監視し、画像データを文書へ挿入してリスナーを解除可能にする。
 * @returns 貼り付けリスナーを解除する関数。
 */
export function installPreviewImageClipboardPaste(): () => void {


    const onPaste = /**
   * pasteイベントでifを実行する。
   * @param event - 保存済み画像clipboard payloadをCodeMirrorへのpasteへ復元するclipboard event。
   */ (event: ClipboardEvent) => {
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
 * クリップボードHTMLからdata URL形式で保持された画像を抽出する。
 * @param clipboard - 貼り付けイベントから受け取ったDataTransfer。HTML画像がない場合は結果を作らない。
 * @returns 画像データと元の参照情報。利用可能な画像がない場合はundefined。
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
    const fileBytes = new Uint8Array(parsed.bytes).buffer;
    return {
        type: parsed.type,
        file: new File([fileBytes], `clipboard-image.${extension}`, {
            type: fileType,
        }),
    };
}

/**
 * 画像data URLをMIMEタイプとBase64データへ分解する。
 * @param value - MIMEタイプとBase64ペイロードを含む画像Data URL。
 * @returns 検証済み画像MIMEタイプとデコードしたバイト列。不正なdata URLならundefined.
 */
export function decodeImageDataUrl(
    value: string,
): {
    /**
     * 正規化した画像のMIMEタイプ。
     */
    type: string;
    /**
     * Clipboardから取得した画像データのバイト列。
     */
    bytes: Uint8Array
} | undefined {
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

/**
 * 元画像参照からファイル拡張子を判定する。
 * @param source - 拡張子を判定する画像URLまたはファイルパス。
 * @returns 認識した画像拡張子。拡張子またはdata MIMEが画像形式でなければundefined。
 */
function imageExtensionFromSource(source: string): string | undefined {
    const clean = source.split(/[?#]/, 1)[0] ?? "";
    const match = /\.([a-z0-9]{1,12})$/i.exec(clean);
    return match?.[1]?.toLowerCase();
}

/**
 * クリップボード画像のMIME型から保存ファイルに使う拡張子を選ぶ。
 * @param type - 拡張子へ対応付ける画像MIME type。
 * @returns MIME型に対応する拡張子。未対応型には汎用のbinを返す。
 */
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

/**
 * 画像MIME typeの空白と大文字小文字を正規化する。
 * @param type - 正規化する画像MIME type。

 */
function normalizeMimeType(type: string): string {
    const normalized = type.trim().toLowerCase();
    if (normalized === "image/jpg" || normalized === "image/pjpeg") {
        return "image/jpeg";
    }
    if (normalized === "image/svg") return "image/svg+xml";
    if (normalized === "image/x-ms-bmp") return "image/bmp";
    return normalized;
}

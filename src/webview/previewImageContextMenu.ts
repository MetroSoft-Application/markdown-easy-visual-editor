/**
 * @fileoverview Webviewのプレビュー画像メニューを管理する。Hostとの通信、ユーザー操作、表示状態の契約を保つ。
 */
/**
 * プレビュー画像メニューのmenu・classに関する状態または設定。
 */
const MENU_CLASS = "mve-preview-image-context-menu";
/**
 * プレビュー画像メニューのtoast・classに関する状態または設定。
 */
const TOAST_CLASS = "mve-preview-image-copy-toast";

/**
 * プレビュー画像メニューで扱う値の種類と境界を表す型。
 */
type CopyImageText = {

    /**
     * プレビュー画像メニューで扱うcopyの文字列。
     */
    copy: string;

    /**
     * プレビュー画像メニューで扱うpreparingの文字列。
     */
    preparing: string;

    /**
     * プレビュー画像メニューで扱うcopiedの文字列。
     */
    copied: string;

    /**
     * プレビュー画像メニューで扱うunavailableの文字列。
     */
    unavailable: string;

    /**
     * プレビュー画像メニューで扱うfailedの文字列。
     */
    failed: string;
};

/**
 * プレビュー画像メニューで共有するデータ形状を表すインターフェース。
 */
interface PreparedClipboardImage {

    /**
     * 解析・描画・変換の起点となる本文。
     */
    source: string;

    /**
     * プレビュー画像メニューで対象や分岐を識別する値の型。
     */
    type: string;

    /**
     * プレビュー画像メニューのblobに関する状態または設定。
     */
    blob: Blob;

    /**
     * プレビュー画像メニューで読み書きするリソースの場所。
     */
    dataUrl: string;

    /**
     * 表示または出力するHTML本文。
     */
    html: string;

    /**
     * 解析・編集・変換の対象となるMarkdown本文。
     */
    markdown: string;
}

/**
 * プレビュー画像メニューで解析・表示・保存する本文。
 */
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
 * プレビュー画像メニューのinstall・preview・image・context・menuを処理し、呼び出し側へ結果または副作用を返す。
 * @returns プレビュー画像メニューのinstall・preview・image・context・menuが生成する結果。
 */
export function installPreviewImageContextMenu(): () => void {
    let menu: HTMLDivElement | undefined;
    let toastTimer: number | undefined;
    let generation = 0;



    const closeMenu = /**
   * プレビュー画像メニューの処理またはリソースを終了し、後続利用可能な状態へ戻す。
   * @returns 副作用を完了し、値は返さない。
   */ () => {
            generation += 1;
            menu?.remove();
            menu = undefined;
        };



    const onContextMenu = /**
   * プレビュー画像メニューのイベントまたはメッセージを受け取り、状態を更新する。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @returns プレビュー画像メニューのon・context・menuが生成する結果。
   */ (event: MouseEvent) => {
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



    const onPointerDown = /**
   * プレビュー画像メニューのイベントまたはメッセージを受け取り、状態を更新する。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @returns プレビュー画像メニューのon・pointer・downが生成する結果。
   */ (event: PointerEvent) => {
            if (
                !menu ||
                !(event.target instanceof Node) ||
                menu.contains(event.target)
            )
                return;
            closeMenu();
        };



    const onKeyDown = /**
   * keydownイベントでifを実行する。
   * @param event - ユーザー操作またはDOMから通知されたイベント。
   * @returns 副作用を完了し、値は返さない。
   */ (event: KeyboardEvent) => {
            if (event.key !== "Escape" || !menu) return;
            event.preventDefault();
            closeMenu();
        };



    const onViewportChange = /**
   * プレビュー画像メニューのイベントまたはメッセージを受け取り、状態を更新する。
   * @returns プレビュー画像メニューのon・viewport・changeが生成する結果。
   */ () => closeMenu();

    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onViewportChange, { passive: true });
    window.addEventListener("blur", onViewportChange);
    document.addEventListener("scroll", onViewportChange, true);

    /**
     * イベントでclose・menuを実行する。
     * @returns 副作用を完了し、値は返さない。
     */
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
            .forEach(
                /**
                 * DOMノードごとに削除を実行する。
                 * @param node - DOMノードの削除を参照する走査対象。
                 * @returns 副作用を完了し、値は返さない。
                 */
                (node) => node.remove());
    };

    /**
     * プレビュー画像メニューの表示または操作を開始する。
     * @param image - プレビュー画像メニューへ渡す入力。
     * @param clientX - プレビュー画像メニューの位置・寸法・件数・時間を表す数値。
     * @param clientY - プレビュー画像メニューの位置・寸法・件数・時間を表す数値。
     * @returns 副作用を完了し、値は返さない。
     */
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
            .then(
                /**
                 * 値をifへ渡し、プレビュー画像メニューの結果または副作用を処理する。
                 * @param value - 検証・変換・保存の対象となる値。
                 * @returns プレビュー画像メニューのコールバックが生成する結果。
                 */
                (value) => {
                    if (generation !== currentGeneration || menu !== nextMenu) return;
                    prepared = value;
                    button.disabled = false;
                    button.textContent = text.copy;
                    button.focus({ preventScroll: true });
                })
            .catch(
                /**
                 * errorをwarnへ渡し、プレビュー画像メニューの結果または副作用を処理する。
                 * @param error - 処理に失敗した理由または例外。
                 * @returns プレビュー画像メニューのコールバックが生成する結果。
                 */
                (error: unknown) => {
                    console.warn(
                        "[Markdown Easy Visual Editor] Preview image copy preparation failed.",
                        error,
                    );
                    if (generation !== currentGeneration || menu !== nextMenu) return;
                    button.disabled = true;
                    button.textContent = text.unavailable;
                    nextMenu.dataset.state = "error";
                });

        button.addEventListener("click",
            /**
             * イベントでifを実行する。
             * @returns 副作用を完了し、値は返さない。
             */
            () => {
                if (!prepared) return;
                const target = prepared;
                closeMenu();
                void copyPreparedImage(target)
                    .then(
                        /**
                         * copiedをshow・toastへ渡し、プレビュー画像メニューの結果または副作用を処理する。
                         * @param copied - プレビュー画像メニューへ渡す入力。
                         * @returns 副作用を完了し、値は返さない。
                         */
                        (copied) => {
                            showToast(copied ? text.copied : text.failed, !copied);
                        })
                    .catch(
                        /**
                         * errorをwarnへ渡し、プレビュー画像メニューの結果または副作用を処理する。
                         * @param error - 処理に失敗した理由または例外。
                         * @returns 副作用を完了し、値は返さない。
                         */
                        (error: unknown) => {
                            console.warn(
                                "[Markdown Easy Visual Editor] Preview image clipboard write failed.",
                                error,
                            );
                            showToast(text.failed, true);
                        });
            });
    }

    /**
     * プレビュー画像メニューの表示または操作を開始する。
     * @param message - HostとWebviewの間で受け渡すメッセージ。
     * @param error - 処理に失敗した理由または例外。
     * @returns 副作用を完了し、値は返さない。
     */
    function showToast(message: string, error: boolean): void {
        if (toastTimer !== undefined) window.clearTimeout(toastTimer);
        document
            .querySelectorAll(`.${TOAST_CLASS}`)
            .forEach(
                /**
                 * DOMノードごとに削除を実行する。
                 * @param node - DOMノードの削除を参照する走査対象。
                 * @returns 副作用を完了し、値は返さない。
                 */
                (node) => node.remove());
        const toast = document.createElement("div");
        toast.className = TOAST_CLASS;
        toast.dataset.state = error ? "error" : "success";
        toast.setAttribute("role", error ? "alert" : "status");
        toast.textContent = message;
        document.body.append(toast);
        toastTimer = window.setTimeout(
            /**
             * 指定時間の経過後に後続処理を実行する。
             * @returns 副作用を完了し、値は返さない。
             */
            () => {
                toast.remove();
                toastTimer = undefined;
            }, 2200);
    }
}

/**
 * プレビュー画像メニューのposition・menuを処理し、呼び出し側へ結果または副作用を返す。
 * @param menu - プレビュー画像メニューへ渡す入力。
 * @param image - プレビュー画像メニューへ渡す入力。
 * @param clientX - プレビュー画像メニューの位置・寸法・件数・時間を表す数値。
 * @param clientY - プレビュー画像メニューの位置・寸法・件数・時間を表す数値。
 * @returns 副作用を完了し、値は返さない。
 */
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

/**
 * プレビュー画像メニューで使う値または実行環境を組み立てる。
 * @param image - プレビュー画像メニューへ渡す入力。
 * @returns プレビュー画像メニューの非同期処理で得られる結果。
 */
async function prepareClipboardImage(
    image: HTMLImageElement,
): Promise<PreparedClipboardImage> {
    const renderedSource = image.currentSrc || image.src;
    if (!renderedSource) throw new Error("Image source is empty.");

    const source =
        image.dataset.originalSrc || image.getAttribute("src") || renderedSource;
    const blob = renderedSource.startsWith("data:")
        ? dataUrlToBlob(renderedSource)
        : await fetchImageBlob(renderedSource);
    const type = resolveImageMimeType(blob.type, source);
    if (!type || !type.startsWith("image/")) {
        throw new Error("Image MIME type is unavailable.");
    }

    const originalBlob =
        normalizeMimeType(blob.type) === type
            ? blob
            : blob.slice(0, blob.size, type);
    if (!originalBlob.size) throw new Error("Image data is empty.");

    const dataUrl = await blobToDataUrl(originalBlob, type);
    const alt = image.getAttribute("alt") ?? "";
    return {
        source,
        type,
        blob: originalBlob,
        dataUrl,
        html: `<img src="${escapeHtmlAttribute(dataUrl)}" alt="${escapeHtmlAttribute(alt)}" data-mve-original-src="${escapeHtmlAttribute(source)}">`,
        markdown: `![${escapeMarkdownAlt(alt)}](${dataUrl})`,
    };
}

/**
 * プレビュー画像メニューの入力または状態を走査・複製する。
 * @param prepared - プレビュー画像メニューへ渡す入力。
 * @returns 条件が成立したかを示す真偽値。
 */
async function copyPreparedImage(
    prepared: PreparedClipboardImage,
): Promise<boolean> {
    const clipboard = navigator.clipboard;
    if (clipboard?.write && typeof ClipboardItem !== "undefined") {
        const html = new Blob([prepared.html], { type: "text/html" });
        const markdown = new Blob([prepared.markdown], { type: "text/plain" });

        if (clipboardSupportsType(prepared.type)) {
            try {
                await writeClipboardWithFocusRetry(
                    clipboard,
                    new ClipboardItem({
                        [prepared.type]: prepared.blob,
                        "text/html": html,
                        "text/plain": markdown,
                    }),
                );
                return true;
            } catch (richError) {
                console.warn(
                    "[Markdown Easy Visual Editor] Original-format clipboard write with fallback representations failed.",
                    richError,
                );
            }

            try {
                await writeClipboardWithFocusRetry(
                    clipboard,
                    new ClipboardItem({ [prepared.type]: prepared.blob }),
                );
                return true;
            } catch (imageError) {
                console.warn(
                    "[Markdown Easy Visual Editor] Original-format image clipboard write failed.",
                    imageError,
                );
            }
        }

        try {
            await writeClipboardWithFocusRetry(
                clipboard,
                new ClipboardItem({
                    "text/html": html,
                    "text/plain": markdown,
                }),
            );
            return true;
        } catch (htmlError) {
            console.warn(
                "[Markdown Easy Visual Editor] Embedded original-image clipboard write failed.",
                htmlError,
            );
        }
    }

    return copyEmbeddedImageBySelection(prepared);
}

/**
 * プレビュー画像メニューの値を保存先または共有状態へ書き出す。
 * @param clipboard - プレビュー画像メニューへ渡す入力。
 * @param item - プレビュー画像メニューで走査または更新する要素。
 * @param retries - プレビュー画像メニューへ渡す入力。
 * @returns 副作用を完了し、値は返さない。
 */
async function writeClipboardWithFocusRetry(
    clipboard: Clipboard,
    item: ClipboardItem,
    retries = 5,
): Promise<void> {
    if (!document.hasFocus() && retries > 0) {
        await new Promise<void>(
            /**
             * 遅延処理の完了または失敗を待機側へ通知する。
             * @param resolve - Promiseの成功を通知する関数。
             * @returns 非同期処理の完了値。
             */
            (resolve) => window.setTimeout(resolve, 20));
        return writeClipboardWithFocusRetry(clipboard, item, retries - 1);
    }
    await clipboard.write([item]);
}

/**
 * プレビュー画像メニューの入力または状態を走査・複製する。
 * @param prepared - プレビュー画像メニューへ渡す入力。
 * @returns 条件が成立したかを示す真偽値。
 */
function copyEmbeddedImageBySelection(
    prepared: PreparedClipboardImage,
): boolean {
    const selection = window.getSelection();
    if (!selection) return false;

    const previousRanges: Range[] = [];
    for (let index = 0; index < selection.rangeCount; index += 1) {
        previousRanges.push(selection.getRangeAt(index).cloneRange());
    }

    const container = document.createElement("span");
    container.contentEditable = "true";
    container.setAttribute("aria-hidden", "true");
    container.style.position = "fixed";
    container.style.left = "-100000px";
    container.style.top = "0";
    container.style.opacity = "0";
    container.innerHTML = prepared.html;
    document.body.append(container);

    try {
        selection.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(container);
        selection.addRange(range);
        return document.execCommand("copy");
    } catch (error) {
        console.warn(
            "[Markdown Easy Visual Editor] Embedded preview image copy fallback failed.",
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
        container.remove();
    }
}

/**
 * プレビュー画像メニューのclipboard・supports・typeを処理し、呼び出し側へ結果または副作用を返す。
 * @param type - 操作領域の種類を示す識別子。
 * @returns 条件が成立したかを示す真偽値。
 */
export function clipboardSupportsType(type: string): boolean {
    const normalized = normalizeMimeType(type);
    if (!normalized || typeof ClipboardItem === "undefined") return false;
    const supports = (
        ClipboardItem as typeof ClipboardItem & {
            /**
             * プレビュー画像メニューのsupportsを処理し、呼び出し側へ結果または副作用を返す。
             * @param mimeType - プレビュー画像メニューの対象や分岐を識別する値。
             * @returns プレビュー画像メニューで利用する文字列。
             */
            supports?: (mimeType: string) => boolean;
        }
    ).supports;
    if (typeof supports !== "function") {
        return normalized === "image/png";
    }
    try {
        return supports(normalized);
    } catch {
        return false;
    }
}

/**
 * プレビュー画像メニューから必要な値またはリソースを取得する。
 * @param type - 操作領域の種類を示す識別子。
 * @param source - 解析・描画・変換の起点となる本文。
 * @returns プレビュー画像メニューで利用する文字列。
 */
function resolveImageMimeType(type: string, source: string): string {
    const normalized = normalizeMimeType(type);
    if (normalized.startsWith("image/")) return normalized;
    return imageMimeTypeFromSource(source);
}

/**
 * プレビュー画像メニューの入力を許可された形式へ整える。
 * @param type - 操作領域の種類を示す識別子。
 * @returns プレビュー画像メニューで利用する文字列。
 */
function normalizeMimeType(type: string): string {
    const normalized = type.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (normalized === "image/jpg" || normalized === "image/pjpeg") {
        return "image/jpeg";
    }
    if (normalized === "image/svg") return "image/svg+xml";
    if (normalized === "image/x-ms-bmp") return "image/bmp";
    return normalized;
}

/**
 * プレビュー画像メニューの入力を検証し、表示または保存に使う形式へ変換する。
 * @param source - 解析・描画・変換の起点となる本文。
 * @returns プレビュー画像メニューで利用する文字列。
 */
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

/**
 * プレビュー画像メニューから必要な値またはリソースを取得する。
 * @param source - 解析・描画・変換の起点となる本文。
 * @returns プレビュー画像メニューの非同期処理で得られる結果。
 */
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

/**
 * プレビュー画像メニューの入力を検証し、表示または保存に使う形式へ変換する。
 * @param source - 解析・描画・変換の起点となる本文。
 * @returns プレビュー画像メニューのdata・url・to・blobが生成する結果。
 */
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

/**
 * Blobを画像Data URLへ変換する。
 * @param blob - プレビュー画像メニューへ渡す入力。
 * @param type - 操作領域の種類を示す識別子。
 * @returns 画像を表すData URL文字列。
 */
async function blobToDataUrl(blob: Blob, type: string): Promise<string> {
    const buffer = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < buffer.length; offset += 0x8000) {
        binary += String.fromCharCode(...buffer.subarray(offset, offset + 0x8000));
    }
    return `data:${type};base64,${window.btoa(binary)}`;
}

/**
 * プレビュー画像メニューの入力を許可された形式へ整える。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns プレビュー画像メニューで利用する文字列。
 */
function escapeHtmlAttribute(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/**
 * プレビュー画像メニューの入力を許可された形式へ整える。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns プレビュー画像メニューで利用する文字列。
 */
function escapeMarkdownAlt(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

/**
 * プレビュー画像メニューの入力または状態を走査・複製する。
 * @param language - プレビュー画像メニューの対象や分岐を識別する値。
 * @returns プレビュー画像メニューのcopy・image・textが生成する結果。
 */
function copyImageText(language: string): CopyImageText {
    const normalized = language.trim().toLowerCase().replace(/_/g, "-");
    if (normalized === "zh" || normalized.startsWith("zh-cn")) {
        return COPY_IMAGE_TEXT["zh-cn"];
    }
    return COPY_IMAGE_TEXT[normalized.split("-")[0]] ?? COPY_IMAGE_TEXT.en;
}

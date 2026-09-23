/**
 * @file previewImageContextMenu.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
/** プレビュー画像の右クリックメニューを識別するCSSクラス。 */
const MENU_CLASS = "mve-preview-image-context-menu";
/** 「TOAST_CLASS」は、DOM操作またはメッセージ連携で使用する識別子です。 */
const TOAST_CLASS = "mve-preview-image-copy-toast";

/**
 * 「CopyImageText」として扱う値の型を定義します。
 */
type CopyImageText = {

  /**
   * 「copy」は、対象の内容または識別子を表す文字列です。
   */
  copy: string;

  /**
   * 「preparing」は、対象の内容または識別子を表す文字列です。
   */
  preparing: string;

  /**
   * 「copied」は、対象の内容または識別子を表す文字列です。
   */
  copied: string;

  /**
   * 「unavailable」は、対象の内容または識別子を表す文字列です。
   */
  unavailable: string;

  /**
   * 「failed」は、対象の内容または識別子を表す文字列です。
   */
  failed: string;
};

/**
 * 「PreparedClipboardImage」が満たすデータ契約を定義します。
 */
interface PreparedClipboardImage {

  /**
   * 「source」は、読み込みまたは出力対象を示すパス・URL・内容を保持します。
   */
  source: string;

  /**
   * 「type」は、対象の識別や処理分岐に使用する値を保持します。
   */
  type: string;

  /**
   * 「blob」は、関連処理が共有する構造化データの一項目です。
   */
  blob: Blob;

  /**
   * 「dataUrl」は、読み込みまたは出力対象を示すパス・URL・内容を保持します。
   */
  dataUrl: string;

  /**
   * 「html」は、解析・編集・変換の対象となる本文またはデータを保持します。
   */
  html: string;

  /**
   * 「markdown」は、解析・編集・変換の対象となる本文またはデータを保持します。
   */
  markdown: string;
}

/** 「COPY_IMAGE_TEXT」は、関連する処理間で共有する設定値または状態です。 */
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
 * プレビュー上のMarkdown画像へ右クリックメニューを追加し、元画像のバイト列を保持してコピーする。
 * PNG・JPEG・WebP・GIF・SVG・BMP・AVIF等を別形式へ変換しない。
 * OSのClipboard画像MIMEが元形式を直接受け付けない場合でも、同一バイト列のdata URLを
 * HTMLとMarkdown表現へ載せ、貼り付け時に画像内容とMIMEを保持できるようにする。
 * @returns 「installPreviewImageContextMenu」の副作用または状態更新を実行し、値は返しません。
 */
export function installPreviewImageContextMenu(): () => void {
  let menu: HTMLDivElement | undefined;
  let toastTimer: number | undefined;
  let generation = 0;


  /**
   * close・menuを解除または削除します。
   * @returns 購読解除、タイマー解除、リソース破棄などの後片付けを実行し、値は返しません。
   */
  const closeMenu = /**
 * 「closeMenu」は、処理を終了し、保持していたリソースまたは状態を整理します。
 * @returns 購読解除、タイマー解除、リソース破棄などの後片付けを実行し、値は返しません。
 */ () => {
    generation += 1;
    menu?.remove();
    menu = undefined;
  };


  /**
   * 「onContextMenu」は、イベント入力を受け取り、関連する状態またはUIを更新する処理です。
   * @param event 処理対象のイベントです。
   * @returns 「if」を実行し、値を返しません。
   */
  const onContextMenu = /**
 * 「onContextMenu」は、イベント入力を検証し、関連する状態またはUIを更新します。
 * @param event DOMイベントまたは入力イベントの情報です。
 * @returns 「if」を実行し、値を返しません。
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


  /**
   * 「onPointerDown」は、イベント入力を受け取り、関連する状態またはUIを更新する処理です。
   * @param event 処理対象のイベントです。
   * @returns 「if」を実行し、値を返しません。
   */
  const onPointerDown = /**
 * 「onPointerDown」は、イベント入力を検証し、関連する状態またはUIを更新します。
 * @param event DOMイベントまたは入力イベントの情報です。
 * @returns 「if」を実行し、値を返しません。
 */ (event: PointerEvent) => {
    if (
      !menu ||
      !(event.target instanceof Node) ||
      menu.contains(event.target)
    )
      return;
    closeMenu();
  };


  /**
   * 「onKeyDown」は、イベント入力を受け取り、関連する状態またはUIを更新する処理です。
   * @param event 処理対象のイベントです。
   * @returns 「event」から生成した処理結果を返します。
   */
  const onKeyDown = /**
 * 「onKeyDown」は、イベント入力を検証し、関連する状態またはUIを更新します。
 * @param event DOMイベントまたは入力イベントの情報です。
 * @returns 「event」から生成した処理結果を返します。
 */ (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !menu) return;
    event.preventDefault();
    closeMenu();
  };


  /**
   * 「onViewportChange」は、イベント入力を受け取り、関連する状態またはUIを更新する処理です。
   * @returns 「closeMenu」を実行し、値を返しません。
   */
  const onViewportChange = /**
 * 「onViewportChange」は、イベント入力を検証し、関連する状態またはUIを更新します。
 * @returns 「closeMenu」を実行し、値を返しません。
 */ () => closeMenu();

  document.addEventListener("contextmenu", onContextMenu, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("resize", onViewportChange, { passive: true });
  window.addEventListener("blur", onViewportChange);
  document.addEventListener("scroll", onViewportChange, true);

  return /** イベント情報を受け取り、DOMまたは画面状態を更新するコールバックです。 @returns 後片付けまたは登録解除を完了した結果を返します。 */ () => {
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
 * 「node」を受け取り、登録された副作用または結果を生成する処理です。
       * @param node nodeとして渡される、このコールバックの入力値です。
       * @returns 「node.remove」を実行し、値を返しません。
       */
      (node) => node.remove());
  };

  /**
   * open・menuを開始します。
   * @param image 「image」は、「openMenu」がWebview UI状態の処理対象を特定する入力です。
   * @param clientX 「clientX」は、「openMenu」がWebview UI状態の処理対象を特定する入力です。
   * @param clientY 「clientY」は、「openMenu」がWebview UI状態の処理対象を特定する入力です。
   * @returns 「openMenu」の副作用または状態更新を実行し、値は返しません。
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
 * 非同期処理の完了値を受け取り、次の処理へ渡す結果を生成するコールバックです。
       * @param value 「value」で検証・変換する入力値です。
       * @returns 解決値を処理した結果を返します。
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
 * 非同期処理の完了値を受け取り、次の処理へ渡す結果を生成するコールバックです。
       * @param error 発生したエラーです。
       * @returns エラー処理またはフォールバックの結果を返します。
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
     * イベント情報を受け取り、DOMまたは画面状態を更新するコールバックです。
     * @returns 「if」を実行し、値を返しません。
     */
    () => {
      if (!prepared) return;
      const target = prepared;
      closeMenu();
      void copyPreparedImage(target)
        .then(
        /**
 * 非同期処理の完了値を受け取り、次の処理へ渡す結果を生成するコールバックです。
         * @param copied copiedとして渡される、このコールバックの入力値です。
         * @returns 解決値を処理した結果を返します。
         */
        (copied) => {
          showToast(copied ? text.copied : text.failed, !copied);
        })
        .catch(
        /**
 * 非同期処理の完了値を受け取り、次の処理へ渡す結果を生成するコールバックです。
         * @param error 発生したエラーです。
         * @returns 解決値を処理した結果を返します。
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
   * 「showToast」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @param message 処理対象のメッセージです。
   * @param error 発生したエラーです。
   * @returns 「showToast」の副作用または状態更新を実行し、値は返しません。
   */
  function showToast(message: string, error: boolean): void {
    if (toastTimer !== undefined) window.clearTimeout(toastTimer);
    document
      .querySelectorAll(`.${TOAST_CLASS}`)
      .forEach(
      /**
 * 「node」を受け取り、登録された副作用または結果を生成する処理です。
       * @param node nodeとして渡される、このコールバックの入力値です。
       * @returns 「node.remove」を実行し、値を返しません。
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
 * 指定時間の経過後に遅延処理を実行するコールバックです。
     * @returns 「toast.remove」を実行し、値を返しません。
     */
    () => {
      toast.remove();
      toastTimer = undefined;
    }, 2200);
  }
}

/**
 * 「positionMenu」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param menu 「menu」は、「positionMenu」がWebview UI状態の処理対象を特定する入力です。
 * @param image 「image」は、「positionMenu」がWebview UI状態の処理対象を特定する入力です。
 * @param clientX 「clientX」は、「positionMenu」がWebview UI状態の処理対象を特定する入力です。
 * @param clientY 「clientY」は、「positionMenu」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「positionMenu」の副作用または状態更新を実行し、値は返しません。
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
 * 画像を作成または組み立てます。
 * @param image 「image」は、「prepareClipboardImage」がWebview UI状態の処理対象を特定する入力です。
 * @returns 非同期処理の完了を表すPromiseです。
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
 * 画像を操作します。
 * @param prepared 「prepared」は、「copyPreparedImage」がWebview UI状態の処理対象を特定する入力です。
 * @returns 非同期処理の完了を表すPromiseです。
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
 * write・clipboard・with・focus・retryを更新または保存します。
 * @param clipboard 「clipboard」は、「writeClipboardWithFocusRetry」がWebview UI状態の処理対象を特定する入力です。
 * @param item 「item」は、「writeClipboardWithFocusRetry」がWebview UI状態の処理対象を特定する入力です。
 * @param retries 「retries」は、「writeClipboardWithFocusRetry」がWebview UI状態の処理対象を特定する入力です。
 * @returns 非同期処理の完了を表すPromiseです。
 */
async function writeClipboardWithFocusRetry(
  clipboard: Clipboard,
  item: ClipboardItem,
  retries = 5,
): Promise<void> {
  if (!document.hasFocus() && retries > 0) {
    await new Promise<void>(
    /**
     * 予約されたタイミングで「resolve」を受け取り、遅延処理を実行するコールバックです。
     * @param resolve Promiseの完了または失敗を通知する関数です。
     * @returns 「window.setTimeout」を実行し、値を返しません。
     */
    (resolve) => window.setTimeout(resolve, 20));
    return writeClipboardWithFocusRetry(clipboard, item, retries - 1);
  }
  await clipboard.write([item]);
}

/**
 * 選択を操作します。
 * @param prepared 「prepared」は、「copyEmbeddedImageBySelection」がWebview UI状態の処理対象を特定する入力です。
 * @returns 判定結果です。
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
 * ClipboardItemが元MIMEを受け付ける場合だけ画像バイト列を直接追加する。
 * @param type 処理対象の種別です。
 * @returns 判定結果です。
 */
export function clipboardSupportsType(type: string): boolean {
  const normalized = normalizeMimeType(type);
  if (!normalized || typeof ClipboardItem === "undefined") return false;
  const supports = (
    ClipboardItem as typeof ClipboardItem & {
      /**
       * 呼び出し側が入力を渡し、宣言された戻り値型で結果を受け取る契約です。
       * @param mimeType 処理対象の種別です。
       * @returns 判定結果です。
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
 * 種別を取得または解決します。
 * @param type 処理対象の種別です。
 * @param source 処理対象のソースです。
 * @returns 「resolveImageMimeType」が生成または変換したWebview UIの文字列を返します。
 */
function resolveImageMimeType(type: string, source: string): string {
  const normalized = normalizeMimeType(type);
  if (normalized.startsWith("image/")) return normalized;
  return imageMimeTypeFromSource(source);
}

/**
 * 種別を正規化します。
 * @param type 処理対象の種別です。
 * @returns 「normalizeMimeType」が生成または変換したWebview UIの文字列を返します。
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
 * 「imageMimeTypeFromSource」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param source 処理対象のソースです。
 * @returns 「imageMimeTypeFromSource」が生成または変換したWebview UIの文字列を返します。
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
 * 「fetchImageBlob」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param source 処理対象のソースです。
 * @returns 非同期処理の完了を表すPromiseです。
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
 * 「dataUrlToBlob」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param source 処理対象のソースです。
 * @returns 「dataUrlToBlob」がWebview UI状態の入力を処理して得た固有の結果を返します。
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
 * 「blobToDataUrl」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param blob 「blob」は、「blobToDataUrl」がWebview UI状態の処理対象を特定する入力です。
 * @param type 処理対象の種別です。
 * @returns 非同期処理の完了を表すPromiseです。
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
 * 属性を安全な形式へ変換します。
 * @param value 「escapeHtmlAttribute」で検証・変換する入力値です。
 * @returns 「escapeHtmlAttribute」が生成または変換したWebview UIの文字列を返します。
 */
function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * escape・markdown・altを安全な形式へ変換します。
 * @param value 「escapeMarkdownAlt」で検証・変換する入力値です。
 * @returns 「escapeMarkdownAlt」が生成または変換したWebview UIの文字列を返します。
 */
function escapeMarkdownAlt(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

/**
 * 本文を操作します。
 * @param language 表示文言の解決に使用する言語コードまたはロケールです。
 * @returns 「copyImageText」が生成または整形したWebview UI状態の文字列を返します。
 */
function copyImageText(language: string): CopyImageText {
  const normalized = language.trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "zh" || normalized.startsWith("zh-cn")) {
    return COPY_IMAGE_TEXT["zh-cn"];
  }
  return COPY_IMAGE_TEXT[normalized.split("-")[0]] ?? COPY_IMAGE_TEXT.en;
}

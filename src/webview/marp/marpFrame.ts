/**
 * @fileoverview 隔離iframe内へMarpスライドを描画し、安全な操作通知だけを親へ返す。
 */
import { browser as applyMarpBrowserSupport } from "@marp-team/marp-core/browser";
import type { MarpImageResizeTarget } from "../../shared/imageResize";

interface SourceRange {
  index: number;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  heading?: string;
}

interface RenderMessage {
  channel: "mve-marp";
  token: string;
  type: "render";
  renderId: number;
  slides: string[];
  css: string;
  sourceRanges: SourceRange[];
  slideLabels: string[];
  imageResizeEnabled: boolean;
  imageResizeControlsVisible: boolean;
  resizeLabel: string;
}

const frameScript = document.currentScript as HTMLScriptElement | null;
const token = frameScript?.dataset.mveToken ?? "";
const root = document.getElementById("mve-marp-slides");
const style = document.getElementById("mve-marp-theme") as HTMLStyleElement | null;
const observedSlideNodes = new WeakSet<Element>();
let sourceRanges: SourceRange[] = [];
let renderId: number | undefined;
let scrollIntentScheduled = false;
let imageResizeLabel = "";
let imageResizeCleanup: (() => void) | undefined;

if (root && style && token) {
  installMarpImageResizeStyles();
  parent.postMessage({ channel: "mve-marp", token, type: "ready" }, "*");
  window.addEventListener("message", receiveRender);
  document.addEventListener("click", handleClick);
  document.addEventListener("wheel", notifyScrollIntent, { passive: true });
  document.addEventListener("pointerdown", notifyScrollIntent, { passive: true });
  document.addEventListener("touchstart", notifyScrollIntent, { passive: true });
  document.addEventListener("keydown", handleScrollKeyDown);
  const resizeObserver = new ResizeObserver(publishLayout);
  resizeObserver.observe(root);
  window.addEventListener("resize", publishLayout, { passive: true });
}

/**
 * Marpの隔離iframe内で画像リサイズ部品を表示するCSSを追加する。
 */
function installMarpImageResizeStyles(): void {
  const resizeStyles = document.createElement("style");
  resizeStyles.dataset.mveMarpImageResizeStyles = "true";
  resizeStyles.textContent = [
    ".mve-marp-image-resize-frame{position:relative;display:inline-block;max-width:100%;vertical-align:middle}",
    ".mve-marp-image-resize-frame>img{max-width:100%}",
    ".mve-marp-image-resize-badge{position:absolute;z-index:2;top:4px;right:4px;padding:1px 5px;border:1px solid rgba(255,255,255,.7);border-radius:3px;color:#fff;background:rgba(20,24,32,.82);font:10px/1.4 sans-serif;pointer-events:none}",
    ".mve-marp-image-resize-handle{position:absolute;z-index:3;right:-5px;bottom:-5px;width:14px;height:14px;padding:0;border:1px solid #fff;border-radius:3px;background:#3b82f6;cursor:nwse-resize;opacity:0}",
    ".mve-marp-image-resize-handle:after{position:absolute;right:2px;bottom:2px;width:5px;height:5px;border-right:2px solid #fff;border-bottom:2px solid #fff;content:\"\"}",
    ".mve-marp-image-resize-frame:hover .mve-marp-image-resize-handle,.mve-marp-image-resize-frame.is-resizing .mve-marp-image-resize-handle{opacity:1}",
    ".mve-marp-image-resize-frame.is-resizing,.mve-marp-image-resize-frame.is-resizing *{user-select:none!important}",
    "html[data-mve-image-resize-controls=hidden] .mve-marp-image-resize-badge,html[data-mve-image-resize-controls=hidden] .mve-marp-image-resize-handle{display:none!important}",
  ].join("");
  document.head.append(resizeStyles);
}

/**
 * iframe内の入力イベントを親のスクロール同期へ渡す。
 */
function notifyScrollIntent(): void {
  if (scrollIntentScheduled) return;
  scrollIntentScheduled = true;
  requestAnimationFrame(() => {
    scrollIntentScheduled = false;
    parent.postMessage({ channel: "mve-marp", token, type: "scroll-intent" }, "*");
  });
}

/**
 * iframeにフォーカスした状態でのスクロールキーを親へ伝える。
 * @param event - キーボード入力イベント。
 */
function handleScrollKeyDown(event: KeyboardEvent): void {
  if (
    event.altKey || event.ctrlKey || event.metaKey ||
    !["ArrowDown", "ArrowUp", "PageDown", "PageUp", " ", "Home", "End"].includes(event.key)
  ) return;
  event.preventDefault();
  parent.postMessage(
    { channel: "mve-marp", token, type: "scroll-key", key: event.key },
    "*",
  );
}

/**
 * 親からの描画要求を受け取り、テーマとスライドDOMを更新する。
 * @param event - 親Webviewから受信したメッセージ。
 */
function receiveRender(event: MessageEvent): void {
  if (
    event.source !== parent ||
    event.data?.channel !== "mve-marp" ||
    event.data?.token !== token
  ) {
    return;
  }
  if (event.data?.type === "image-resize-configuration") {
    if (
      typeof event.data.enabled === "boolean" &&
      typeof event.data.visible === "boolean" &&
      typeof event.data.resizeLabel === "string"
    ) {
      configureImageResizeControls(
        event.data.enabled,
        event.data.visible,
        event.data.resizeLabel,
      );
    }
    return;
  }
  if (event.data?.type !== "render") return;
  const message = event.data as RenderMessage;
  if (
    !Array.isArray(message.slides) ||
    !Array.isArray(message.sourceRanges) ||
    !Array.isArray(message.slideLabels) ||
    typeof message.imageResizeEnabled !== "boolean" ||
    typeof message.imageResizeControlsVisible !== "boolean" ||
    typeof message.resizeLabel !== "string" ||
    !Number.isInteger(message.renderId) ||
    message.slides.length !== message.sourceRanges.length ||
    message.slides.length !== message.slideLabels.length ||
    typeof message.css !== "string"
  ) {
    parent.postMessage({
      channel: "mve-marp",
      token,
      type: "invalid",
      renderId: Number.isInteger(message.renderId) ? message.renderId : undefined,
    }, "*");
    return;
  }
  const isInitialRender = renderId === undefined;
  try {
    renderId = message.renderId;
    sourceRanges = message.sourceRanges;
    if (isInitialRender) postRenderStage("received");
    style!.textContent = message.css;
    imageResizeCleanup?.();
    imageResizeCleanup = undefined;
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < message.slides.length; index += 1) {
      const slide = document.createElement("article");
      slide.className = "mve-marp-slide";
      slide.dataset.slideIndex = String(index);
      slide.dataset.sourceStartOffset = String(message.sourceRanges[index]?.startOffset ?? 0);
      slide.dataset.sourceEndOffset = String(message.sourceRanges[index]?.endOffset ?? 0);
      slide.setAttribute("aria-label", message.slideLabels[index] ?? "");
      const marpit = document.createElement("div");
      marpit.className = "marpit";
      marpit.innerHTML = sanitizeMarpHtml(message.slides[index] ?? "");
      slide.append(marpit);
      fragment.append(slide);
      if (!observedSlideNodes.has(slide)) observedSlideNodes.add(slide);
    }
    if (isInitialRender) postRenderStage("slides-created");
    root!.replaceChildren(fragment);
    if (isInitialRender) postRenderStage("dom-replaced");
    applyMarpBrowserSupport(root!);
    configureImageResizeControls(
      message.imageResizeEnabled,
      message.imageResizeControlsVisible,
      message.resizeLabel,
    );
    if (isInitialRender) postRenderStage("browser-support-applied");
    publishInitialLayout(message.renderId, isInitialRender);
  } catch (error) {
    reportRenderError("render", error, message.renderId);
  }
}

/**
 * 初回layoutを同期測定し、iframeのレイアウトが整うまで短い間隔で再試行する。
 * @param targetRenderId - 対象とする描画世代ID。
 * @param reportStages - 起動計測の段階通知を有効にする場合はtrue。
 * @param attempt - 現在の再試行回数。
 */
function publishInitialLayout(
  targetRenderId: number,
  reportStages: boolean,
  attempt = 0,
): void {
  if (renderId !== targetRenderId) return;
  try {
    if (publishLayout()) {
      if (reportStages) postRenderStage("layout-published", targetRenderId);
      return;
    }
  } catch (error) {
    reportRenderError("layout", error, targetRenderId);
    return;
  }
  if (attempt >= 40) {
    reportRenderError(
      "layout-unavailable",
      new Error("Marp slide layout could not be measured after 40 attempts."),
      targetRenderId,
    );
    return;
  }
  window.setTimeout(() => publishInitialLayout(targetRenderId, reportStages, attempt + 1), 50);
}

/**
 * 初回レイアウトの親子ハンドシェイク段階を親Webviewへ報告する。
 * @param stage - iframe内で完了した初回処理段階。
 */
function postRenderStage(stage: string, renderIdForMessage = renderId): void {
  parent.postMessage({
    channel: "mve-marp",
    token,
    type: "render-stage",
    renderId: renderIdForMessage,
    stage,
  }, "*");
}

/**
 * iframe内の同期例外を親Webviewへ伝えて、白画面のまま残さない。
 * @param stage - 例外が発生したiframe処理段階。
 * @param error - 例外情報。
 */
function reportRenderError(
  stage: string,
  error: unknown,
  renderIdForMessage = renderId,
): void {
  const detail = error instanceof Error ? error.message : String(error);
  parent.postMessage({
    channel: "mve-marp",
    token,
    type: "render-error",
    renderId: renderIdForMessage,
    stage,
    detail: detail.slice(0, 300),
  }, "*");
}

/**
 * Marp Coreの安全なHTMLを保ったまま、script、イベント属性、危険なURLを除去する。
 * @param html - Marp Coreが生成した1枚分のHTML。
 * @returns iframeへ挿入できるサニタイズ済みHTML。
 */
function sanitizeMarpHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("script, iframe, object, embed, form, base, meta, link").forEach(
    (element) => element.remove(),
  );
  template.content.querySelectorAll("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (
        name.startsWith("on") ||
        name === "srcdoc" ||
        ((name === "href" || name === "src" || name === "xlink:href") &&
          /^javascript:/i.test(value))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  });
  return template.innerHTML;
}

/**
 * 既知のスライド内リンクと画像クリックを親Webviewへ通知する。
 * @param event - iframe内部で発生したclick event。
 */
function handleClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest(".mve-marp-image-resize-handle")) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const image = target.closest<HTMLImageElement>("img");
  if (image && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    parent.postMessage(
      {
        channel: "mve-marp",
        token,
        type: "image",
        source: image.getAttribute("data-original-src") ?? image.getAttribute("src") ?? image.src,
        alt: image.alt,
      },
      "*",
    );
    return;
  }
  const anchor = target.closest<HTMLAnchorElement>("a[href]");
  if (!anchor) return;
  const href = anchor.getAttribute("href") ?? "";
  event.preventDefault();
  if (href.startsWith("#")) {
    const targetElement = document.getElementById(decodeFragment(href.slice(1)));
    const slide = targetElement?.closest<HTMLElement>(".mve-marp-slide");
    if (slide) {
      parent.postMessage(
        { channel: "mve-marp", token, type: "navigate-slide", index: Number(slide.dataset.slideIndex) },
        "*",
      );
    }
    return;
  }
  parent.postMessage(
    {
      channel: "mve-marp",
      token,
      type: "navigate",
      href,
      workspaceRooted: href.startsWith("/"),
    },
    "*",
  );
}

/**
 * URI fragmentの不正なescapeを許容しながら対象IDを復元する。
 * @param value - URI fragmentのエンコード済み値。
 * @returns デコード後のID。
 */
function decodeFragment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Marp画像のリサイズ操作を有効化し、設定に応じて操作部品の表示を切り替える。
 * @param enabled - 画像リサイズ操作を登録する場合はtrue。
 * @param visible - リサイズ部品を表示する場合はtrue。
 * @param label - リサイズハンドルのアクセシブル名。
 */
function configureImageResizeControls(
  enabled: boolean,
  visible: boolean,
  label: string,
): void {
  imageResizeLabel = label.slice(0, 120);
  document.documentElement.dataset.mveImageResizeControls = visible
    ? "visible"
    : "hidden";
  imageResizeCleanup?.();
  imageResizeCleanup = undefined;
  if (enabled && root) {
    imageResizeCleanup = installMarpImageResizeControls(root, imageResizeLabel);
  }
}

/**
 * ソース位置が対応したスライド画像へドラッグ用のリサイズハンドルを追加する。
 * @param slideRoot - 現在表示している全スライドのルート要素。
 * @param label - リサイズハンドルのアクセシブル名。
 * @returns ハンドラーを解除し、画像要素を元のDOMへ戻す関数。
 */
function installMarpImageResizeControls(
  slideRoot: HTMLElement,
  label: string,
): () => void {
  const cleanups: Array<() => void> = [];
  const images = slideRoot.querySelectorAll<HTMLImageElement>(
    "img[data-mve-image-index][src]",
  );
  images.forEach((image) => {
    const imageIndex = Number.parseInt(
      image.getAttribute("data-mve-image-index") ?? "",
      10,
    );
    const targetStart = Number(image.getAttribute("data-mve-image-start"));
    const targetEnd = Number(image.getAttribute("data-mve-image-end"));
    const targetKind = image.getAttribute("data-mve-image-kind");
    const targetAltStart = Number(image.getAttribute("data-mve-image-alt-start"));
    const targetAltEnd = Number(image.getAttribute("data-mve-image-alt-end"));
    const target: MarpImageResizeTarget | undefined =
      Number.isSafeInteger(targetStart) &&
      Number.isSafeInteger(targetEnd) &&
      (targetKind === "markdown" || targetKind === "html")
        ? {
            start: targetStart,
            end: targetEnd,
            kind: targetKind,
            ...(Number.isSafeInteger(targetAltStart) && Number.isSafeInteger(targetAltEnd)
              ? { altStart: targetAltStart, altEnd: targetAltEnd }
              : {}),
            ...(image.getAttribute("data-mve-image-shortcut-reference") === "true"
              ? { shortcutReference: true }
              : {}),
          }
        : undefined;
    const parentElement = image.parentElement;
    if (!Number.isSafeInteger(imageIndex) || imageIndex < 0 || !target || !parentElement) return;
    const frame = document.createElement("span");
    frame.className = "mve-marp-image-resize-frame";
    frame.dataset.mveImageIndex = String(imageIndex);
    const originalStyle = image.getAttribute("style");
    parentElement.insertBefore(frame, image);
    frame.append(image);

    const badge = document.createElement("span");
    badge.className = "mve-marp-image-resize-badge";
    badge.setAttribute("aria-hidden", "true");
    frame.append(badge);
    const updateBadge = () => {
      const width = getMarpImageWidth(image, frame);
      badge.textContent = width > 0 ? width + "px" : "";
    };

    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "mve-marp-image-resize-handle";
    handle.setAttribute("aria-label", label);
    handle.title = label;
    handle.addEventListener("click", stopResizeClick);
    frame.append(handle);
    const pointerCleanup = attachMarpImageResizePointer(
      handle,
      frame,
      image,
      imageIndex,
      target,
      updateBadge,
    );
    updateBadge();

    cleanups.push(() => {
      pointerCleanup();
      handle.removeEventListener("click", stopResizeClick);
      if (frame.parentElement) frame.replaceWith(image);
      if (originalStyle === null) image.removeAttribute("style");
      else image.setAttribute("style", originalStyle);
    });
  });
  return () => cleanups.forEach((cleanup) => cleanup());
}

/**
 * リサイズハンドルのクリックが画像やリンクの操作へ伝わるのを防ぐ。
 * @param event - ボタンに発生したclick event。
 */
function stopResizeClick(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

/**
 * MarpのSVG表示倍率を除いた画像幅を返す。
 * @param image - 幅を読み取る画像。
 * @param frame - 画像とハンドルを囲む要素。
 * @returns Markdownへ保存するCSSピクセル幅。
 */
function getMarpImageWidth(image: HTMLImageElement, frame: HTMLElement): number {
  const explicitWidth = Number.parseFloat(image.getAttribute("width") ?? "");
  return Math.round(
    frame.offsetWidth || image.clientWidth || explicitWidth || image.naturalWidth,
  );
}

/**
 * ポインター移動量をMarpスライドの元の座標系へ変換して画像幅を確定する。
 * @param handle - ドラッグを開始するハンドル。
 * @param frame - 画像とハンドルを囲む要素。
 * @param image - 幅を変更する画像。
 * @param imageIndex - Markdown本文内の画像ソース順インデックス。
 * @param updateBadge - 現在幅を表示するバッジを更新する関数。
 * @returns ハンドルに登録したイベントを解除する関数。
 */
function attachMarpImageResizePointer(
  handle: HTMLButtonElement,
  frame: HTMLElement,
  image: HTMLImageElement,
  imageIndex: number,
  target: MarpImageResizeTarget,
  updateBadge: () => void,
): () => void {
  let activeCleanup: (() => void) | undefined;
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = Math.max(
      48,
      getMarpImageWidth(image, frame) || 320,
    );
    const maxWidth = getMarpSlideLogicalWidth(frame);
    const originalFrameWidth = frame.style.width;
    const originalImageStyle = image.getAttribute("style");
    frame.classList.add("is-resizing");
    handle.setPointerCapture(pointerId);

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const frameRect = frame.getBoundingClientRect();
      const scale = frameRect.width > 0
        ? frame.offsetWidth / frameRect.width
        : 1;
      const nextWidth = Math.min(
        maxWidth,
        Math.max(
          48,
          Math.round(startWidth + (moveEvent.clientX - startX) * scale),
        ),
      );
      frame.style.width = nextWidth + "px";
      image.style.display = "block";
      image.style.width = "100%";
      image.style.maxWidth = "100%";
      image.style.height = "auto";
      updateBadge();
    };

    const finish = (commit: boolean) => (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId !== pointerId) return;
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", onPointerUp);
      handle.removeEventListener("pointercancel", onPointerCancel);
      frame.classList.remove("is-resizing");
      if (handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId);
      }
      activeCleanup = undefined;
      if (!commit) {
        frame.style.width = originalFrameWidth;
        if (originalImageStyle === null) image.removeAttribute("style");
        else image.setAttribute("style", originalImageStyle);
        updateBadge();
        return;
      }
      const width = Math.min(
        maxWidth,
        Math.max(48, Math.round(frame.offsetWidth)),
      );
      if (width !== startWidth) {
        parent.postMessage(
          {
            channel: "mve-marp",
            token,
            type: "resize-image",
            renderId,
            imageIndex,
            imageReference: target,
            width,
          },
          "*",
        );
        return;
      }
      frame.style.width = originalFrameWidth;
      if (originalImageStyle === null) image.removeAttribute("style");
      else image.setAttribute("style", originalImageStyle);
      updateBadge();
    };
    const onPointerUp = finish(true);
    const onPointerCancel = finish(false);
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp);
    handle.addEventListener("pointercancel", onPointerCancel);
    activeCleanup = () => {
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", onPointerUp);
      handle.removeEventListener("pointercancel", onPointerCancel);
      if (handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId);
      }
    };
  };
  handle.addEventListener("pointerdown", onPointerDown);
  return () => {
    handle.removeEventListener("pointerdown", onPointerDown);
    activeCleanup?.();
  };
}

/**
 * MarpスライドのviewBox幅を画像保存幅の上限として返す。
 * @param frame - Marpスライド内のリサイズ対象要素。
 * @returns viewBoxの幅、またはスライド幅を使った最大保存幅。
 */
function getMarpSlideLogicalWidth(frame: HTMLElement): number {
  const slide = frame.closest<HTMLElement>(".mve-marp-slide");
  const svg = slide?.querySelector<SVGSVGElement>("svg[data-marpit-svg]");
  const viewBoxWidth = svg?.viewBox.baseVal.width ?? 0;
  const measuredWidth = slide?.clientWidth ?? 0;
  return Math.max(
    48,
    Math.round(viewBoxWidth || measuredWidth || frame.offsetWidth || 1280),
  );
}

/**
 * iframe内のレイアウト寸法とスライド位置を親Webviewへ送る。
 */
function publishLayout(): boolean {
  if (!root || !token) return false;
  const slides = Array.from(root.querySelectorAll<HTMLElement>(".mve-marp-slide"), (slide) => ({
    index: Number(slide.dataset.slideIndex),
    top: slide.offsetTop,
    height: slide.offsetHeight,
  }));
  const height = Math.ceil(document.documentElement.scrollHeight);
  if (!slides.length || height <= 0 || slides.some((slide) => slide.height <= 0)) return false;
  parent.postMessage(
    {
      channel: "mve-marp",
      token,
      type: "layout",
      renderId,
      height,
      slides,
      sourceRanges,
    },
    "*",
  );
  return true;
}

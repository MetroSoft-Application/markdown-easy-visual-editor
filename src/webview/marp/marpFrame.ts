/**
 * @fileoverview 隔離iframe内へMarpスライドを描画し、安全な操作通知だけを親へ返す。
 */
import { browser as applyMarpBrowserSupport } from "@marp-team/marp-core/browser";

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
}

const frameScript = document.currentScript as HTMLScriptElement | null;
const token = frameScript?.dataset.mveToken ?? "";
const root = document.getElementById("mve-marp-slides");
const style = document.getElementById("mve-marp-theme") as HTMLStyleElement | null;
const observedSlideNodes = new WeakSet<Element>();
let sourceRanges: SourceRange[] = [];
let renderId: number | undefined;
let scrollIntentScheduled = false;

if (root && style && token) {
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
    event.data?.token !== token ||
    event.data?.type !== "render"
  ) {
    return;
  }
  const message = event.data as RenderMessage;
  if (
    !Array.isArray(message.slides) ||
    !Array.isArray(message.sourceRanges) ||
    !Array.isArray(message.slideLabels) ||
    !Number.isInteger(message.renderId) ||
    message.slides.length !== message.sourceRanges.length ||
    message.slides.length !== message.slideLabels.length ||
    typeof message.css !== "string"
  ) {
    parent.postMessage({ channel: "mve-marp", token, type: "invalid" }, "*");
    return;
  }
  const isInitialRender = renderId === undefined;
  try {
    renderId = message.renderId;
    sourceRanges = message.sourceRanges;
    if (isInitialRender) postRenderStage("received");
    style!.textContent = message.css;
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < message.slides.length; index += 1) {
      const slide = document.createElement("article");
      slide.className = "mve-marp-slide";
      slide.dataset.slideIndex = String(index);
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
    if (isInitialRender) postRenderStage("browser-support-applied");
    publishInitialLayout(message.renderId, isInitialRender);
  } catch (error) {
    reportRenderError("render", error);
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
      if (reportStages) postRenderStage("layout-published");
      return;
    }
  } catch (error) {
    reportRenderError("layout", error);
    return;
  }
  if (attempt >= 40) {
    if (reportStages) postRenderStage("layout-unavailable");
    return;
  }
  window.setTimeout(() => publishInitialLayout(targetRenderId, reportStages, attempt + 1), 50);
}

/**
 * 初回レイアウトの親子ハンドシェイク段階を親Webviewへ報告する。
 * @param stage - iframe内で完了した初回処理段階。
 */
function postRenderStage(stage: string): void {
  parent.postMessage({ channel: "mve-marp", token, type: "render-stage", stage }, "*");
}

/**
 * iframe内の同期例外を親Webviewへ伝えて、白画面のまま残さない。
 * @param stage - 例外が発生したiframe処理段階。
 * @param error - 例外情報。
 */
function reportRenderError(stage: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  parent.postMessage({
    channel: "mve-marp",
    token,
    type: "render-error",
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

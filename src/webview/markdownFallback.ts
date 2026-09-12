import type { RenderOptions } from "./markdownRendererCore";
import { webviewAssetUrl, webviewScriptNonce } from "./assets";

interface MarkdownFallbackRuntime {
  renderMarkdown(markdown: string, options: RenderOptions): string;
}

declare global {
  var mveMarkdownFallback: MarkdownFallbackRuntime | undefined;
}

let runtimePromise: Promise<MarkdownFallbackRuntime> | undefined;

/**
 * Markdown Worker を利用できない環境だけで、同期レンダラーを別成果物から読む。
 * 通常の初回起動では marked/highlight.js/KaTeX を UI スレッドへ読み込まない。
 */
export async function renderMarkdownFallback(
  markdown: string,
  options: RenderOptions,
): Promise<string> {
  const runtime = await loadMarkdownFallback();
  return runtime.renderMarkdown(markdown, options);
}

function loadMarkdownFallback(): Promise<MarkdownFallbackRuntime> {
  if (globalThis.mveMarkdownFallback) {
    return Promise.resolve(globalThis.mveMarkdownFallback);
  }
  runtimePromise ??= new Promise<MarkdownFallbackRuntime>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = webviewAssetUrl(
      "markdown-fallback.js",
      document.body.dataset.mveMarkdownFallbackUri,
    );
    script.async = true;
    const nonce = webviewScriptNonce();
    if (nonce) script.nonce = nonce;
    script.addEventListener(
      "load",
      () => {
        if (globalThis.mveMarkdownFallback) {
          resolve(globalThis.mveMarkdownFallback);
          return;
        }
        runtimePromise = undefined;
        reject(new Error("Markdown fallback runtime did not initialize."));
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => {
        runtimePromise = undefined;
        reject(new Error("Markdown fallback runtime could not be loaded."));
      },
      { once: true },
    );
    document.head.append(script);
  });
  return runtimePromise;
}

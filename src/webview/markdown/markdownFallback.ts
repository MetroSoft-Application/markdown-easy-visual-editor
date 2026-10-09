/**
 * @fileoverview Markdown Workerが利用できない場合に、基本的な本文をエスケープ済みHTMLへ変換する。
 */
import type { RenderOptions } from "./markdownRendererCore";
import { webviewAssetUrl, webviewScriptNonce } from "../runtime/assets";

/**
 * Workerが使えない場合のMarkdown描画関数と依存機能です。
 */
interface MarkdownFallbackRuntime {
    /**
     * Markdownを表示用HTMLへ変換し、見出し・画像・表などの付加情報をまとめる。
     * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
     * @param options - 呼び出し側が指定する処理設定。

     */
    renderMarkdown(markdown: string, options: RenderOptions): string;
}

/** WebviewのwindowへMarkdown fallback runtimeプロパティを宣言する。 */
declare global {
    /**
     * markdownfallbackで解析・表示・保存する本文。
     */
    var mveMarkdownFallback: MarkdownFallbackRuntime | undefined;
}

/**
 * markdownfallbackの非同期処理を共有するPromise。
 */
let runtimePromise: Promise<MarkdownFallbackRuntime> | undefined;

/**
 * 代替Markdown runtimeで本文をHTMLへ描画する。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param options - 呼び出し側が指定する処理設定。
 * @returns 代替Markdown runtimeが生成したHTML文字列。
 */
export async function renderMarkdownFallback(
    markdown: string,
    options: RenderOptions,
): Promise<string> {
    const runtime = await loadMarkdownFallback();
    return runtime.renderMarkdown(markdown, options);
}

/**
 * グローバル注入済みの代替Markdownランタイムを取得し、未注入時はscriptを読み込む。
 * @returns グローバルに注入済み、またはscript読み込み後のMarkdown runtime。
 */
function loadMarkdownFallback(): Promise<MarkdownFallbackRuntime> {
    if (globalThis.mveMarkdownFallback) {
        return Promise.resolve(globalThis.mveMarkdownFallback);
    }
    runtimePromise ??= new Promise<MarkdownFallbackRuntime>(
        /**
         * 非同期処理の成功結果と失敗理由を待機側へ通知する。
         * @param resolve - Promiseの成功を通知する関数。
         * @param reject - Promiseの失敗を通知する関数。
         */
        (resolve, reject) => {
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

                /**
                 * イベントでifを実行する。
                 */
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

                /**
                 * イベントで失敗通知を実行する。
                 */
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

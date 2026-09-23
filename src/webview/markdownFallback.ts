/**
 * @fileoverview Webviewのmarkdownfallbackを管理する。Hostとの通信、ユーザー操作、表示状態の契約を保つ。
 */
import type { RenderOptions } from "./markdownRendererCore";
import { webviewAssetUrl, webviewScriptNonce } from "./assets";

/**
 * markdownfallbackで共有するデータ形状を表すインターフェース。
 */
interface MarkdownFallbackRuntime {
    /**
     * Markdownを表示用HTMLへ変換し、見出し・画像・表などの付加情報をまとめる。
     * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
     * @param options - 呼び出し側が指定する処理設定。
     * @returns markdownfallbackで利用する文字列。
     */
    renderMarkdown(markdown: string, options: RenderOptions): string;
}

/**
 * markdownをcreate・elementへ渡し、markdownfallbackの結果または副作用を処理する。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param options - 呼び出し側が指定する処理設定。
 * @returns markdownfallbackで利用する文字列。
 */
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
 * markdownfallbackを表示用の結果へ変換する。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param options - 呼び出し側が指定する処理設定。
 * @returns markdownfallbackで利用する文字列。
 */
export async function renderMarkdownFallback(
    markdown: string,
    options: RenderOptions,
): Promise<string> {
    const runtime = await loadMarkdownFallback();
    return runtime.renderMarkdown(markdown, options);
}

/**
 * markdownfallbackから必要な値またはリソースを取得する。
 * @returns markdownfallbackの非同期処理で得られる結果。
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
         * @returns 非同期処理の完了値。
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
                 * @returns 副作用を完了し、値は返さない。
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
                 * @returns 副作用を完了し、値は返さない。
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

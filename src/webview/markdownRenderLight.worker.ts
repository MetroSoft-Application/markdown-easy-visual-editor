/**
 * @fileoverview Web Worker内で軽量なMarkdown解析を実行し、要求ID付きでプレビュー結果を返す。
 */
import { collectDiagnostics, getOutline, wordStats } from "../shared/markdown";
import {
    alignOutlineHeadingIds,
    renderMarkdownUnsafeBlocks,
    type RenderOptions,
} from "./markdownRendererCore";

/**
 * Workerで送受信するMarkdown描画要求と応答のデータ形状。
 */
interface RenderRequest {

    /**
     * Hostから届いた描画要求のID。結果を返す際も同じ値を使います。
     */
    id: number;

    /**
     * 解析・編集・変換の対象となるMarkdown本文。
     */
    markdown: string;

    /**
     * 呼び出し側が指定する処理設定。
     */
    options: RenderOptions;
}

self.addEventListener("message",
    /**
     * Hostから描画要求を受け取り、描画結果またはエラーを同じ要求IDで返す。
     * @param event - Markdown本文の描画要求を受信するworker message event。
     */
    (event: MessageEvent<RenderRequest>) => {
        const { id, markdown, options } = event.data;
        try {
            const unsafeBlocks = renderMarkdownUnsafeBlocks(markdown, options);
            self.postMessage({
                id,
                markdown,
                preliminary: true,
                unsafeBlocks,
                outline: alignOutlineHeadingIds(getOutline(markdown), unsafeBlocks),
                diagnostics: collectDiagnostics(markdown, options.language),
                stats: wordStats(markdown),
            });
        } catch (error) {
            self.postMessage({
                id,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });

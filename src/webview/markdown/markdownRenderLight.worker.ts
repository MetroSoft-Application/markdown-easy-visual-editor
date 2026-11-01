/**
 * @fileoverview Web Worker内で軽量なMarkdown解析（highlight.jsを含まない）を実行し、要求ID付きでプレビュー結果を返す。
 * 応答の preliminary は「rich Workerで描き直すと結果が変わり得る」場合だけtrueになる。falseの結果はrich Workerの結果とバイト一致するため、Webviewは最終結果として扱う。
 */
import { collectDiagnostics, wordStats } from "../../shared/markdown";
import {
    getOutlineForFormat,
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
            // ハイライト関数がundefinedを返す描画は、関数なしの描画とバイト一致する（test/markdownStageParity.test.ts で固定）。
            // 呼び出しの有無だけを記録し、一度も呼ばれなければrich Workerの結果も同一なので、この結果を最終結果として返す。
            let highlightRequested = false;
            const unsafeBlocks = renderMarkdownUnsafeBlocks(markdown, options,
                /**
                 * ハイライトが必要なコードの存在だけを記録するプローブ。常に「ハイライトしない」を返す。
                 * @returns 常にundefined。
                 */
                () => {
                    highlightRequested = true;
                    return undefined;
                });
            self.postMessage({
                id,
                markdown,
                preliminary: highlightRequested,
                unsafeBlocks,
                outline: getOutlineForFormat(markdown, options.renderFormat ?? "markdown", unsafeBlocks),
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

/**
 * @fileoverview Web Worker内でリッチなMarkdown解析を実行し、要求ID付きで描画結果またはエラーを返す。
 */
import { collectDiagnostics, getOutline, wordStats } from '../../shared/markdown';
import { alignOutlineHeadingIds, renderMarkdownUnsafeBlocks, type RenderOptions } from './markdownRendererCore';
import { highlightCode } from './codeHighlighter';

/**
 * Markdown描画・Workerで送受信するメッセージまたは要求のデータ形状。
 */
interface RenderRequest {

    /**
     * Hostから受け取った描画要求のIDです。結果返信時も同じ値を使います。
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

self.addEventListener('message',
    /**
     * UIイベントをHostまたはWebviewへ通知する。
     * @param event - Markdown本文の描画要求を受信するworker message event。
     */
    (event: MessageEvent<RenderRequest>) => {
        const { id, markdown, options } = event.data;
        try {
            const unsafeBlocks = renderMarkdownUnsafeBlocks(markdown, options, highlightCode);
            self.postMessage({
                id,
                markdown,
                unsafeBlocks,
                outline: alignOutlineHeadingIds(getOutline(markdown), unsafeBlocks),
                diagnostics: collectDiagnostics(markdown, options.language),
                stats: wordStats(markdown)
            });
        } catch (error) {
            self.postMessage({
                id,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });

/**
 * @fileoverview WebviewのMarkdown描画・Workerを管理する。Hostとの通信、ユーザー操作、表示状態の契約を保つ。
 */
import { collectDiagnostics, getOutline, wordStats } from '../shared/markdown';
import { renderMarkdownUnsafeBlocks, type RenderOptions } from './markdownRendererCore';
import { highlightCode } from './codeHighlighter';

/**
 * Markdown描画・Workerで送受信するメッセージまたは要求のデータ形状。
 */
interface RenderRequest {

    /**
     * Markdown描画・Workerのidを表す数値。
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
     * @param event - ユーザー操作またはDOMから通知されたイベント。
     * @returns 副作用を完了し、値は返さない。
     */
    (event: MessageEvent<RenderRequest>) => {
        const { id, markdown, options } = event.data;
        try {
            self.postMessage({
                id,
                markdown,
                unsafeBlocks: renderMarkdownUnsafeBlocks(markdown, options, highlightCode),
                outline: getOutline(markdown),
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

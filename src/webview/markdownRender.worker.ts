import { collectDiagnostics, getOutline, wordStats } from '../shared/markdown';
import { renderMarkdownUnsafeBlocks, type RenderOptions } from './markdownRendererCore';

interface RenderRequest {
    id: number;
    markdown: string;
    options: RenderOptions;
}

self.addEventListener('message', (event: MessageEvent<RenderRequest>) => {
    const { id, markdown, options } = event.data;
    try {
        self.postMessage({
            id,
            markdown,
            unsafeBlocks: renderMarkdownUnsafeBlocks(markdown, options),
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

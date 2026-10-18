/**
 * @fileoverview Mermaid Host要求の応答監視が、進捗通知後も処理中の要求を待機することを確認する。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebviewToHostMessage } from '../src/shared/protocol';

vi.mock('../src/webview/runtime/vscodeApi', () => ({
    sharedVsCodeApi: {
        postMessage: vi.fn()
    }
}));

import { sharedVsCodeApi } from '../src/webview/runtime/vscodeApi';
import {
    acceptMermaidRenderProgress,
    acceptMermaidRenderResult,
    renderMermaidSvg
} from '../src/webview/markdown/mermaidRenderer';

describe('Mermaid Host描画要求', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.mocked(sharedVsCodeApi.postMessage).mockReset();
    });

    it('描画待ち中に進捗通知を受け取ると無応答タイマーを更新する', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('window', globalThis);

        const settled = vi.fn();
        const resultPromise = renderMermaidSvg('flowchart TD\nA --> B', 'dark');
        void resultPromise.then(settled, settled);
        const request = vi.mocked(sharedVsCodeApi.postMessage).mock.calls[0]?.[0] as WebviewToHostMessage | undefined;
        expect(request?.type).toBe('renderMermaid');
        if (request?.type !== 'renderMermaid') throw new Error('Mermaid描画要求が送信されていません。');

        await vi.advanceTimersByTimeAsync(170_000);
        expect(settled).not.toHaveBeenCalled();

        acceptMermaidRenderProgress({ type: 'mermaidRenderProgress', requestId: request.requestId });
        await vi.advanceTimersByTimeAsync(170_000);
        expect(settled).not.toHaveBeenCalled();

        acceptMermaidRenderResult({
            type: 'mermaidRendered',
            requestId: request.requestId,
            svg: '<svg></svg>'
        });
        await expect(resultPromise).resolves.toMatchObject({ svg: '<svg></svg>' });
    });
});

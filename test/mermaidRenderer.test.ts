/**
 * @fileoverview Mermaid Host要求の応答監視と、フォントサイズの既定値・正規化・送信を確認する。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    normalizeMermaidFontSize,
    type WebviewToHostMessage
} from '../src/shared/protocol';

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
        expect(request.fontSize).toBe(16);

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

    /**
     * 設定や古いメッセージ由来の不正値が描画処理へ漏れないことを確認する。
     */
    it('不正値を16pxへ戻し、8〜48pxの境界へ正規化する', () => {
        expect(normalizeMermaidFontSize(Number.NaN)).toBe(16);
        expect(normalizeMermaidFontSize('28')).toBe(16);
        expect(normalizeMermaidFontSize(7)).toBe(8);
        expect(normalizeMermaidFontSize(49)).toBe(48);
        expect(normalizeMermaidFontSize(27.6)).toBe(28);
    });

    /**
     * Webview側の要求が既定値ではなく確定済みのMermaid文字サイズを伝えることを確認する。
     */
    it('明示されたサイズを正規化してHost描画要求へ含める', async () => {
        vi.stubGlobal('window', globalThis);

        const resultPromise = renderMermaidSvg('flowchart TD\nA --> B', 'dark', undefined, 28);
        const request = vi.mocked(sharedVsCodeApi.postMessage).mock.calls[0]?.[0] as WebviewToHostMessage | undefined;
        expect(request?.type).toBe('renderMermaid');
        if (request?.type !== 'renderMermaid') throw new Error('Mermaid描画要求が送信されていません。');
        expect(request.fontSize).toBe(28);

        acceptMermaidRenderResult({
            type: 'mermaidRendered',
            requestId: request.requestId,
            svg: '<svg></svg>'
        });
        await expect(resultPromise).resolves.toMatchObject({ svg: '<svg></svg>' });
    });
});

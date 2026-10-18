/**
 * @fileoverview Mermaid画像の公開DNS制限、応答検証、画像上限、通信キャンセルを検証する。
 */
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    lookup: vi.fn(),
    httpRequest: vi.fn(),
    httpsRequest: vi.fn()
}));

vi.mock('node:dns', () => ({ lookup: mocks.lookup }));
vi.mock('node:http', () => ({ request: mocks.httpRequest }));
vi.mock('node:https', () => ({ request: mocks.httpsRequest }));

import { resolveMermaidImageSources } from '../src/extension/mermaidImages';

describe('Mermaid画像解決', () => {
    beforeEach(() => {
        mocks.lookup.mockReset();
        mocks.httpRequest.mockReset();
        mocks.httpsRequest.mockReset();
        mocks.lookup.mockImplementation((_hostname, _options, callback) => {
            callback(null, [{ address: '8.8.8.8', family: 4 }]);
        });
    });

    it('画像の合計画素数が上限を超える場合は後続画像を除外する', async () => {
        const sources = Array.from({ length: 3 }, (_, index) => `local-${index}.png`);
        const resolved = await resolveMermaidImageSources(sources, async () => pngHeader(4000, 4000));

        expect(Object.keys(resolved)).toHaveLength(2);
    });

    it('8枚までの小さいローカル画像をdata URIへ変換する', async () => {
        const sources = Array.from({ length: 9 }, (_, index) => `local-${index}.png`);
        const readLocal = vi.fn(async () => pngHeader(1, 1));
        const resolved = await resolveMermaidImageSources(sources, readLocal);

        expect(readLocal).toHaveBeenCalledTimes(8);
        expect(Object.keys(resolved)).toHaveLength(8);
        expect(Object.values(resolved).every((value) => value.startsWith('data:image/png;base64,'))).toBe(true);
    });

    it('拒否対象IPへ解決されたホストには接続しない', async () => {
        mocks.lookup.mockImplementation((_hostname, _options, callback) => {
            callback(null, [{ address: '127.0.0.1', family: 4 }]);
        });

        const resolved = await resolveMermaidImageSources(['https://example.test/image.png'], async () => undefined);

        expect(resolved).toEqual({});
        expect(mocks.httpsRequest).not.toHaveBeenCalled();
    });

    it('公開IPを固定してHTTP要求し、全アドレス形式のlookupにも応答する', async () => {
        let capturedLookup: ((hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => void) | undefined;
        mocks.httpsRequest.mockImplementation((options, callback) => {
            capturedLookup = options.lookup;
            const request = createRequest();
            request.end = () => {
                const response = new EventEmitter() as EventEmitter & {
                    statusCode: number;
                    headers: Record<string, string>;
                    destroy: () => void;
                };
                response.statusCode = 200;
                response.headers = { 'content-type': 'image/png', 'content-length': '24' };
                response.destroy = vi.fn();
                callback(response);
                queueMicrotask(() => {
                    response.emit('data', pngHeader(1, 1));
                    response.emit('end');
                });
            };
            return request;
        });

        const resolved = await resolveMermaidImageSources(['https://example.test/image.png'], async () => undefined);
        let allAddresses: unknown;
        capturedLookup?.('example.test', { all: true }, (...args) => { allAddresses = args; });

        expect(Object.keys(resolved)).toEqual(['https://example.test/image.png']);
        expect(allAddresses).toEqual([null, [{ address: '8.8.8.8', family: 4 }]]);
    });

    it('AbortSignalで進行中の画像要求を破棄する', async () => {
        let requestHandle: ReturnType<typeof createRequest> | undefined;
        mocks.httpsRequest.mockImplementation(() => {
            requestHandle = createRequest();
            return requestHandle;
        });
        const controller = new AbortController();
        const resolving = resolveMermaidImageSources(
            ['https://cancel.example/image.png'],
            async () => undefined,
            controller.signal
        );
        await vi.waitFor(() => expect(mocks.httpsRequest).toHaveBeenCalledOnce());
        controller.abort();

        await expect(resolving).rejects.toThrow('cancelled');
        expect(requestHandle?.destroy).toHaveBeenCalledOnce();
    });

    it('開始前にキャンセルされた画像解決は読み込みを始めない', async () => {
        const controller = new AbortController();
        controller.abort();
        const readLocal = vi.fn(async () => pngHeader(1, 1));

        await expect(resolveMermaidImageSources(['local.png'], readLocal, controller.signal)).rejects.toThrow('cancelled');
        expect(readLocal).not.toHaveBeenCalled();
    });
});

function createRequest(): EventEmitter & {
    destroy: ReturnType<typeof vi.fn>;
    end: () => void;
    setTimeout: ReturnType<typeof vi.fn>;
} {
    const request = new EventEmitter() as EventEmitter & {
        destroy: ReturnType<typeof vi.fn>;
        end: () => void;
        setTimeout: ReturnType<typeof vi.fn>;
    };
    request.destroy = vi.fn(() => request);
    request.end = vi.fn();
    request.setTimeout = vi.fn();
    return request;
}

function pngHeader(width: number, height: number): Buffer {
    const bytes = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
    bytes.writeUInt32BE(width, 16);
    bytes.writeUInt32BE(height, 20);
    return bytes;
}

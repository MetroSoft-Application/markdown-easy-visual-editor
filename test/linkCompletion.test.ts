/**
 * @fileoverview 本文エディターのリンク先補完（CodeMirror の補完ソース）と、Host への要求クライアントを検証する（Webview 層・Node 実行）。
 * 回帰リスク: リンク以外の入力で補完が出る、コード内で補完が出る、アンカーがプレビュー・セクションリンクと異なる ID になる、
 * `./` の後ろの置換範囲がずれる、Host の応答が来ないまま補完が待ち続ける、遅れた応答が別の要求へ渡る。
 */
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { linkCompletionHostFacet, linkCompletionSource, type LinkCompletionHost } from '../src/webview/editor/cmLinkCompletion';
import { createLinkCompletionClient } from '../src/webview/editor/linkCompletionClient';
import type { WebviewToHostMessage } from '../src/shared/protocol';

/**
 * テスト用の Host 通信手段を作る。
 * @param overrides - 差し替える処理。
 * @returns 呼出し記録付きの通信手段。
 */
function createHost(overrides: Partial<LinkCompletionHost> = {}): LinkCompletionHost {
    return {
        requestFiles: vi.fn(async () => [
            { path: 'guide.md', kind: 'markdown' as const },
            { path: 'assets/a%20b.png', kind: 'image' as const },
            { path: '../root.md', kind: 'markdown' as const }
        ]),
        requestHeadings: vi.fn(async () => [{ id: 'install-steps', text: 'Install steps', level: 2 }]),
        format: () => 'mixed',
        ...overrides
    };
}

/**
 * 本文の `|` の位置にカーソルを置き、補完ソースを実行する。
 * @param docWithCursor - `|` でカーソル位置を示した本文。
 * @param host - Host 通信手段。null なら Facet を設定しない。
 * @returns 補完結果。
 */
async function complete(docWithCursor: string, host: LinkCompletionHost | null = createHost()): Promise<CompletionResult | null> {
    const pos = docWithCursor.indexOf('|');
    const doc = docWithCursor.replace('|', '');
    const state = EditorState.create({
        doc,
        extensions: [markdown(), ...(host ? [linkCompletionHostFacet.of(host)] : [])]
    });
    ensureSyntaxTree(state, state.doc.length, 1_000);
    return linkCompletionSource(new CompletionContext(state, pos, false));
}

describe('linkCompletionSource', () => {
    /** `](` の後ろでファイル候補を出し、置換範囲はリンク先の先頭から。 */
    it('offers file paths after "](" and replaces the typed path', async () => {
        const result = await complete('See [guide](gu|');
        expect(result?.from).toBe('See [guide]('.length);
        expect(result?.options.map((option) => option.label)).toEqual(['guide.md', 'assets/a%20b.png', '../root.md']);
        expect(result?.validFor instanceof RegExp && result.validFor.test('guide.m')).toBe(true);
        expect(result?.validFor instanceof RegExp && result.validFor.test('guide.md ')).toBe(false);
    });

    /** `./` で書き始めた場合は接頭辞を残し、親フォルダーの候補を除く。 */
    it('keeps a "./" prefix', async () => {
        const result = await complete('![x](./|');
        expect(result?.from).toBe('![x](./'.length);
        expect(result?.options.map((option) => option.label)).toEqual(['guide.md', 'assets/a%20b.png']);
    });

    /** 同じ文書の見出しは本文から作り、セクションリンクと同じエンコードで挿入する。 */
    it('offers same-document heading anchors from the editor text', async () => {
        const host = createHost();
        const result = await complete('# Intro\n## Set up (Windows)\n[go](#|', host);
        expect(host.requestHeadings).not.toHaveBeenCalled();
        expect(result?.from).toBe('# Intro\n## Set up (Windows)\n[go](#'.length);
        expect(result?.options.map((option) => [option.label, option.apply, option.detail])).toEqual([
            ['intro', 'intro', '# Intro'],
            ['set-up-windows', 'set-up-windows', '## Set up (Windows)']
        ]);
    });

    /** 他の文書の見出しは Host へパスを渡して要求する。 */
    it('requests headings of another document from the host', async () => {
        const host = createHost();
        const result = await complete('[go](guide.md#ins|', host);
        expect(host.requestHeadings).toHaveBeenCalledWith('guide.md');
        expect(result?.from).toBe('[go](guide.md#'.length);
        expect(result?.options[0]).toMatchObject({ label: 'install-steps', detail: '## Install steps' });
    });

    /** コード内、URL、Textile 単独文書、Facet なし、候補なしでは補完しない。 */
    it('stays silent outside link destinations', async () => {
        expect(await complete('```\n[a](gu|\n```')).toBeNull();
        expect(await complete('text `[a](gu|` more')).toBeNull();
        expect(await complete('[a](https://ex|')).toBeNull();
        expect(await complete('plain gu|')).toBeNull();
        expect(await complete('[a](gu|', createHost({ format: () => 'textile' }))).toBeNull();
        expect(await complete('[a](gu|', null)).toBeNull();
        expect(await complete('[a](gu|', createHost({ requestFiles: async () => undefined }))).toBeNull();
    });
});

describe('createLinkCompletionClient', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('window', globalThis);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    /** 要求IDで応答を対応付け、無関係な応答は無視する。 */
    it('matches responses by request id', async () => {
        const sent: WebviewToHostMessage[] = [];
        const client = createLinkCompletionClient((message) => sent.push(message));
        const files = client.requestFiles();
        const headings = client.requestHeadings('a.md');
        expect(sent).toEqual([
            expect.objectContaining({ type: 'requestLinkCompletions', kind: 'paths' }),
            expect.objectContaining({ type: 'requestLinkCompletions', kind: 'headings', path: 'a.md' })
        ]);
        const [filesRequest, headingsRequest] = sent as Array<Extract<WebviewToHostMessage, { type: 'requestLinkCompletions' }>>;
        client.accept({ type: 'linkCompletions', requestId: 'unknown', paths: [] });
        client.accept({ type: 'linkCompletions', requestId: headingsRequest.requestId, headings: [{ id: 'h', text: 'H', level: 1 }] });
        client.accept({ type: 'linkCompletions', requestId: filesRequest.requestId, paths: [{ path: 'b.md', kind: 'markdown' }] });
        await expect(files).resolves.toEqual([{ path: 'b.md', kind: 'markdown' }]);
        await expect(headings).resolves.toEqual([{ id: 'h', text: 'H', level: 1 }]);
    });

    /** 応答が来なければタイムアウトで undefined にし、遅れた応答は無視する。 */
    it('times out and ignores late responses', async () => {
        const sent: WebviewToHostMessage[] = [];
        const client = createLinkCompletionClient((message) => sent.push(message), 100);
        const files = client.requestFiles();
        vi.advanceTimersByTime(100);
        await expect(files).resolves.toBeUndefined();
        const request = sent[0] as Extract<WebviewToHostMessage, { type: 'requestLinkCompletions' }>;
        expect(() => client.accept({ type: 'linkCompletions', requestId: request.requestId, paths: [] })).not.toThrow();
        expect(vi.getTimerCount()).toBe(0);
    });

    /** 破棄で待機中の要求を打ち切り、以後の要求は送らない。 */
    it('resolves pending requests on dispose', async () => {
        const sent: WebviewToHostMessage[] = [];
        const client = createLinkCompletionClient((message) => sent.push(message));
        const files = client.requestFiles();
        client.dispose();
        await expect(files).resolves.toBeUndefined();
        await expect(client.requestHeadings('a.md')).resolves.toBeUndefined();
        expect(sent).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(0);
    });
});

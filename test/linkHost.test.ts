/**
 * @fileoverview Extension Host のリンク先補完候補（LinkCompletionProvider）と、ファイル移動時のリンク書き換え（MarkdownLinkUpdater）を、
 * VS Code API のモックで検証する。
 * 回帰リスク: ワークスペース外のファイルを列挙・読込みする、node_modules を候補に含める、書き換えで改行コードや本文を壊す、
 * 確認なしに書き換える、「更新しない」を選んだのに書き換える、標準の Markdown 拡張機能と二重に書き換える。
 */
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** VS Code API モックの共有状態。テストごとに初期化する。 */
const mock = vi.hoisted(
    /**
     * モックの状態とヘルパーを作る。
     * @returns モックの状態。
     */
    () => {
        /**
         * Uri の最小実装を作る。
         * @param uriPath - Uri.path に相当するパス。
         * @returns Uri のモック。
         */
        const uri = (uriPath: string): any => ({
            scheme: 'file',
            authority: '',
            path: uriPath,
            fsPath: uriPath,
            toString: () => `file://${uriPath}`
        });
        return {
            uri,
            /** パスごとのファイル内容。 */
            files: new Map<string, string>(),
            /** 開いている文書（未保存の内容）。 */
            openTexts: new Map<string, string>(),
            /** パスごとの設定値（`section.key`）。 */
            settings: new Map<string, unknown>(),
            workspaceRoot: '/w',
            renameListeners: [] as Array<(event: any) => void>,
            showInformationMessage: vi.fn(async (..._args: unknown[]): Promise<string | undefined> => undefined),
            showErrorMessage: vi.fn(async (..._args: unknown[]) => undefined),
            applyEdit: vi.fn(async (_edit: any, _options?: unknown) => true),
            configurationUpdate: vi.fn(async (..._args: unknown[]) => undefined),
            findFiles: vi.fn()
        };
    });

vi.mock('vscode',
    /**
     * リンク先補完とリンク書き換えが使う VS Code API だけを持つスタブを返す。
     * @returns vscode モジュールのスタブ。
     */
    () => {
        /** 文書オフセットを保持する Range。 */
        class Range {
            constructor(public start: { offset: number }, public end: { offset: number }) {}
        }
        /** replace の呼出しを記録する WorkspaceEdit。 */
        class WorkspaceEdit {
            readonly replacements: Array<{ path: string; start: number; end: number; text: string }> = [];
            replace(target: any, range: Range, text: string): void {
                this.replacements.push({ path: target.path, start: range.start.offset, end: range.end.offset, text });
            }
        }
        /** 基準とパターンを保持する RelativePattern。 */
        class RelativePattern {
            constructor(public base: any, public pattern: string) {}
        }
        const event = () => ({ dispose: vi.fn() });
        return {
            Range,
            WorkspaceEdit,
            RelativePattern,
            ConfigurationTarget: { Global: 1 },
            Uri: {
                joinPath: (base: any, ...segments: string[]) => mock.uri(path.posix.join(base.path, ...segments))
            },
            window: {
                showInformationMessage: mock.showInformationMessage,
                showErrorMessage: mock.showErrorMessage
            },
            workspace: {
                onDidCreateFiles: event,
                onDidDeleteFiles: event,
                onDidRenameFiles: (listener: (event: any) => void) => {
                    mock.renameListeners.push(listener);
                    return { dispose: vi.fn() };
                },
                findFiles: mock.findFiles,
                getWorkspaceFolder: (target: any) =>
                    target.path.startsWith(`${mock.workspaceRoot}/`) ? { uri: mock.uri(mock.workspaceRoot) } : undefined,
                get textDocuments() {
                    return [...mock.openTexts].map(([documentPath, text]) => ({ uri: mock.uri(documentPath), getText: () => text }));
                },
                openTextDocument: async (target: any) => {
                    const text = mock.openTexts.get(target.path) ?? mock.files.get(target.path) ?? '';
                    return { uri: target, getText: () => text, positionAt: (offset: number) => ({ offset }) };
                },
                fs: {
                    stat: async (target: any) => {
                        const text = mock.files.get(target.path);
                        if (text === undefined) throw Object.assign(new Error('not found'), { code: 'FileNotFound' });
                        return { size: Buffer.byteLength(text) };
                    },
                    readFile: async (target: any) => {
                        const text = mock.files.get(target.path);
                        if (text === undefined) throw Object.assign(new Error('not found'), { code: 'FileNotFound' });
                        return new TextEncoder().encode(text);
                    }
                },
                getConfiguration: (section: string) => ({
                    get: (key: string, fallback?: unknown) => mock.settings.has(`${section}.${key}`)
                        ? mock.settings.get(`${section}.${key}`)
                        : fallback,
                    update: mock.configurationUpdate
                }),
                applyEdit: mock.applyEdit
            }
        };
    });

import { LinkCompletionProvider } from '../src/extension/linkCompletion';
import { MarkdownLinkUpdater, normalizeLinkUpdateMode, planLinkUpdates } from '../src/extension/linkUpdater';
import { getMessages } from '../src/shared/messages';

/**
 * WorkspaceEdit の置換を本文へ適用した結果を返す。
 * @param edit - 置換を記録した WorkspaceEdit のモック。
 * @param documentPath - 対象文書のパス。
 * @returns 置換後の本文。
 */
function applied(edit: any, documentPath: string): string {
    let text = mock.openTexts.get(documentPath) ?? mock.files.get(documentPath) ?? '';
    const replacements = edit.replacements
        .filter((replacement: any) => replacement.path === documentPath)
        .sort((left: any, right: any) => right.start - left.start);
    for (const replacement of replacements) {
        text = text.slice(0, replacement.start) + replacement.text + text.slice(replacement.end);
    }
    return text;
}

/** findFiles を、モックのファイル一覧から glob の拡張子で絞り込んで返すようにする。 */
function useFileListing(): void {
    mock.findFiles.mockImplementation(async (include: any) => {
        const pattern = typeof include === 'string' ? include : include.pattern;
        const base = typeof include === 'string' ? mock.workspaceRoot : include.base.path;
        return [...mock.files.keys()]
            .filter((filePath) => filePath.startsWith(`${base}/`))
            .filter((filePath) => pattern !== '**/*.{md,markdown}' || /\.(?:md|markdown)$/u.test(filePath))
            .map(mock.uri);
    });
}

beforeEach(() => {
    mock.files.clear();
    mock.openTexts.clear();
    mock.settings.clear();
    mock.renameListeners.length = 0;
    mock.findFiles.mockReset();
    mock.showInformationMessage.mockReset();
    mock.showErrorMessage.mockReset();
    mock.applyEdit.mockClear();
    mock.configurationUpdate.mockClear();
    useFileListing();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('LinkCompletionProvider', () => {
    /** 文書からの相対パスで、Markdown・画像・その他の順に並べ、文書自身と node_modules を除く。 */
    it('lists workspace files relative to the document', async () => {
        for (const filePath of ['/w/docs/readme.md', '/w/docs/guide.md', '/w/docs/img/a b.png', '/w/root.md',
            '/w/data.csv', '/w/node_modules/pkg/readme.md']) {
            mock.files.set(filePath, '');
        }
        const provider = new LinkCompletionProvider();
        const files = await provider.listFiles(mock.uri('/w/docs/readme.md'));
        expect(files).toEqual([
            { path: 'guide.md', kind: 'markdown' },
            { path: '../root.md', kind: 'markdown' },
            { path: 'img/a%20b.png', kind: 'image' },
            { path: '../data.csv', kind: 'other' }
        ]);
        provider.dispose();
    });

    /** 一覧は短時間キャッシュし、同じワークスペースへの連続要求で再列挙しない。 */
    it('caches the file listing', async () => {
        mock.files.set('/w/a.md', '');
        const provider = new LinkCompletionProvider();
        await provider.listFiles(mock.uri('/w/b.md'));
        await provider.listFiles(mock.uri('/w/b.md'));
        expect(mock.findFiles).toHaveBeenCalledTimes(1);
        provider.dispose();
    });

    /** 見出しはプレビューと同じ ID で返し、開いている文書は未保存の内容を使う。 */
    it('reads headings of a linked document, preferring unsaved content', async () => {
        mock.files.set('/w/docs/guide.md', '# Saved');
        mock.openTexts.set('/w/docs/guide.md', '# Install\n## Set up\n## Set up');
        const provider = new LinkCompletionProvider();
        expect(await provider.listHeadings(mock.uri('/w/docs/readme.md'), 'guide.md')).toEqual([
            { id: 'install', text: 'Install', level: 1 },
            { id: 'set-up', text: 'Set up', level: 2 },
            { id: 'set-up-1', text: 'Set up', level: 2 }
        ]);
        provider.dispose();
    });

    /** ワークスペース外、Markdown 以外、URL、存在しないファイルは読まない。 */
    it('refuses targets outside the workspace or non-Markdown files', async () => {
        mock.files.set('/outside/secret.md', '# Secret');
        mock.files.set('/w/docs/data.txt', '# Not markdown');
        const provider = new LinkCompletionProvider();
        const documentUri = mock.uri('/w/docs/readme.md');
        expect(await provider.listHeadings(documentUri, '../../outside/secret.md')).toEqual([]);
        expect(await provider.listHeadings(documentUri, 'data.txt')).toEqual([]);
        expect(await provider.listHeadings(documentUri, 'https://example.com/a.md')).toEqual([]);
        expect(await provider.listHeadings(documentUri, 'missing.md')).toEqual([]);
        provider.dispose();
    });
});

describe('planLinkUpdates', () => {
    /** 移動したファイルへのリンクだけを書き換え、CRLF・タイトル・他のリンクを保つ。 */
    it('rewrites only links to the moved file and preserves the rest of the text', async () => {
        const readme = '# Docs\r\n[Guide](guide.md#setup "Title")\r\n[Other](other.md)\r\n`[code](guide.md)`\r\n';
        mock.files.set('/w/docs/readme.md', readme);
        mock.files.set('/w/manual/guide.md', '# Guide');
        const plan = await planLinkUpdates([{ sampleUri: mock.uri('/w/manual/guide.md'), renames: [{ oldPath: '/w/docs/guide.md', newPath: '/w/manual/guide.md' }] }]);
        expect(plan).toMatchObject({ documentCount: 1, linkCount: 1 });
        expect(applied(plan.edit, '/w/docs/readme.md')).toBe(
            '# Docs\r\n[Guide](../manual/guide.md#setup "Title")\r\n[Other](other.md)\r\n`[code](guide.md)`\r\n');
    });

    /** 移動した文書自身の相対リンクを、新しい位置から計算し直す。 */
    it('updates relative links inside a moved document', async () => {
        mock.files.set('/w/archive/readme.md', '![a](img/a.png) [self](#top) [g](../guide.md)');
        mock.files.set('/w/docs/img/a.png', '');
        const plan = await planLinkUpdates([{ sampleUri: mock.uri('/w/archive/readme.md'), renames: [{ oldPath: '/w/docs/readme.md', newPath: '/w/archive/readme.md' }] }]);
        // 同じ深さへの移動なので ../guide.md はそのまま、文書内アンカーも変更しない。
        expect(applied(plan.edit, '/w/archive/readme.md')).toBe('![a](../docs/img/a.png) [self](#top) [g](../guide.md)');
        expect(plan.linkCount).toBe(1);
    });

    /** 関係のない移動では編集を作らない。 */
    it('returns an empty plan when no link is affected', async () => {
        mock.files.set('/w/docs/readme.md', '[x](x.md)');
        const plan = await planLinkUpdates([{ sampleUri: mock.uri('/w/z.md'), renames: [{ oldPath: '/w/y.md', newPath: '/w/z.md' }] }]);
        expect(plan).toMatchObject({ documentCount: 0, linkCount: 0 });
    });
});

describe('MarkdownLinkUpdater', () => {
    /**
     * 移動イベントを発火し、更新処理のキューが空になるまで待つ。
     * @param updater - 対象の更新処理。
     * @param oldPath - 移動前のパス。
     * @param newPath - 移動後のパス。
     */
    async function fireRename(updater: MarkdownLinkUpdater, oldPath: string, newPath: string): Promise<void> {
        for (const listener of mock.renameListeners) listener({ files: [{ oldUri: mock.uri(oldPath), newUri: mock.uri(newPath) }] });
        await updater.whenIdle();
    }

    beforeEach(() => {
        mock.files.set('/w/readme.md', '[g](guide.md)');
        mock.files.set('/w/docs/guide.md', '# Guide');
    });

    /** 既定の prompt では確認し、「更新」で適用する。 */
    it('asks before updating and applies on confirmation', async () => {
        const messages = getMessages('en').host;
        mock.showInformationMessage.mockResolvedValue(messages.linkUpdateApply);
        const updater = new MarkdownLinkUpdater(() => getMessages('en'));
        await fireRename(updater, '/w/guide.md', '/w/docs/guide.md');
        expect(mock.showInformationMessage).toHaveBeenCalledWith(
            messages.linkUpdatePrompt(1), messages.linkUpdateApply, messages.linkUpdateAlways, messages.linkUpdateNever);
        expect(mock.applyEdit).toHaveBeenCalledTimes(1);
        expect(applied(mock.applyEdit.mock.calls[0][0], '/w/readme.md')).toBe('[g](docs/guide.md)');
        expect(mock.applyEdit.mock.calls[0][1]).toEqual({ isRefactoring: true });
        updater.dispose();
    });

    /** 通知を閉じた場合は適用しない。「更新しない」は設定を never に保存する。 */
    it('does not apply when dismissed or declined', async () => {
        const updater = new MarkdownLinkUpdater(() => getMessages('en'));
        await fireRename(updater, '/w/guide.md', '/w/docs/guide.md');
        expect(mock.applyEdit).not.toHaveBeenCalled();

        mock.showInformationMessage.mockResolvedValue(getMessages('en').host.linkUpdateNever);
        await fireRename(updater, '/w/guide.md', '/w/docs/guide.md');
        expect(mock.applyEdit).not.toHaveBeenCalled();
        expect(mock.configurationUpdate).toHaveBeenCalledWith('links.updateOnFileMove', 'never', 1);
        updater.dispose();
    });

    /** always では確認せずに適用し、never と標準拡張機能の有効時は何もしない。 */
    it('honors always, never and the built-in Markdown setting', async () => {
        const updater = new MarkdownLinkUpdater(() => getMessages('en'));
        mock.settings.set('markdownEasyVisualEditor.links.updateOnFileMove', 'always');
        await fireRename(updater, '/w/guide.md', '/w/docs/guide.md');
        expect(mock.showInformationMessage).not.toHaveBeenCalled();
        expect(mock.applyEdit).toHaveBeenCalledTimes(1);

        mock.applyEdit.mockClear();
        mock.settings.set('markdownEasyVisualEditor.links.updateOnFileMove', 'never');
        await fireRename(updater, '/w/guide.md', '/w/docs/guide.md');
        mock.settings.set('markdownEasyVisualEditor.links.updateOnFileMove', 'always');
        mock.settings.set('markdown.updateLinksOnFileMove.enabled', 'prompt');
        await fireRename(updater, '/w/guide.md', '/w/docs/guide.md');
        expect(mock.applyEdit).not.toHaveBeenCalled();
        expect(mock.findFiles).toHaveBeenCalledTimes(1);
        updater.dispose();
    });

    /** 確認通知への応答を待つ間に同じ文書がさらに移動しても、移動を合成して最初の位置基準のリンクを正しく書き換える。 */
    it('composes moves that happen while the prompt is open', async () => {
        mock.files.clear();
        mock.files.set('/w/guide.md', '# Guide');
        mock.files.set('/w/a/readme.md', '[g](guide.md)');
        let answer: (value: string | undefined) => void = () => undefined;
        mock.showInformationMessage.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
        const updater = new MarkdownLinkUpdater(() => getMessages('en'));
        for (const listener of mock.renameListeners) listener({ files: [{ oldUri: mock.uri('/w/readme.md'), newUri: mock.uri('/w/a/readme.md') }] });
        await vi.waitFor(() => expect(mock.showInformationMessage).toHaveBeenCalledTimes(1));
        mock.files.set('/w/a/b/readme.md', mock.files.get('/w/a/readme.md') ?? '');
        mock.files.delete('/w/a/readme.md');
        for (const listener of mock.renameListeners) listener({ files: [{ oldUri: mock.uri('/w/a/readme.md'), newUri: mock.uri('/w/a/b/readme.md') }] });
        answer(getMessages('en').host.linkUpdateApply);
        await updater.whenIdle();
        expect(mock.showInformationMessage).toHaveBeenCalledTimes(1);
        expect(mock.applyEdit).toHaveBeenCalledTimes(1);
        expect(applied(mock.applyEdit.mock.calls[0][0], '/w/a/b/readme.md')).toBe('[g](../../guide.md)');
        updater.dispose();
    });

    /** 書き換えの計算中に同じ文書がさらに移動しても、その移動を合成して計算し直す。 */
    it('recomputes with moves that arrive while planning', async () => {
        mock.files.clear();
        mock.files.set('/w/guide.md', '# Guide');
        mock.files.set('/w/a/readme.md', '[g](guide.md)');
        mock.settings.set('markdownEasyVisualEditor.links.updateOnFileMove', 'always');
        const listing = mock.findFiles.getMockImplementation();
        let fired = false;
        mock.findFiles.mockImplementation(async (...args: unknown[]) => {
            if (!fired) {
                fired = true;
                mock.files.set('/w/a/b/readme.md', mock.files.get('/w/a/readme.md') ?? '');
                mock.files.delete('/w/a/readme.md');
                for (const listener of mock.renameListeners) listener({ files: [{ oldUri: mock.uri('/w/a/readme.md'), newUri: mock.uri('/w/a/b/readme.md') }] });
            }
            return listing?.(...args);
        });
        const updater = new MarkdownLinkUpdater(() => getMessages('en'));
        for (const listener of mock.renameListeners) listener({ files: [{ oldUri: mock.uri('/w/readme.md'), newUri: mock.uri('/w/a/readme.md') }] });
        await updater.whenIdle();
        await updater.whenIdle();
        const edits = mock.applyEdit.mock.calls.map((call) => applied(call[0], '/w/a/b/readme.md'));
        // 計算中に届いた移動も合成した1回の適用だけで、最終位置から正しい相対パスになる。
        expect(edits).toEqual(['[g](../../guide.md)']);
        updater.dispose();
    });

    /** 未知の設定値は prompt として扱う。 */
    it('normalizes unknown modes to prompt', () => {
        expect(normalizeLinkUpdateMode(undefined)).toBe('prompt');
        expect(normalizeLinkUpdateMode('sometimes')).toBe('prompt');
        expect(normalizeLinkUpdateMode('always')).toBe('always');
    });
});

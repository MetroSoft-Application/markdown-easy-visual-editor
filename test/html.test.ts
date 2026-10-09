/**
 * @fileoverview プレビューHTMLの生成、CSP、WebviewリソースURI、本文や属性値のエスケープを検証する。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderMarkdownUnsafe } from '../src/webview/markdown/markdownRendererCore';

/**
 * HTML・テストの回帰の状態と操作をまとめるクラス。
 */
class TestUri {

    /**
     * URIのスキーム部分。
     */
    readonly scheme = 'file';

    /**
     * 読み書きするファイルまたはリソースの場所。
     */
    readonly path: string;

    /**
     * テスト用URIのfilesystem pathをNode.js形式へ正規化する。
     * @param fsPath - テスト対象のファイルパス。
     * @returns 初期化したインスタンス。
     */
    constructor(readonly fsPath: string) {
        this.path = fsPath.replace(/\\/g, '/');
    }
}

/**
 * Extension Hostのモックへ渡す保存先とワークスペース情報。
 */
const vscodeMock = vi.hoisted(

    () => ({ showSaveDialog: vi.fn(), getWorkspaceFolder: vi.fn() }));
vi.mock('vscode',

    () => ({
        Uri: {


            file: /**
     * @param filePath - 読み書きするファイルのパス。
     * @returns HTML・テストの回帰のfileが生成する結果。
     */ (filePath: string) => new TestUri(filePath),


            parse: /**
     * file URI形式の入力からテスト用URIを生成する。
     * @param value - テスト用file URIへ変換するパス文字列。
     * @returns 入力したfile pathを持つテスト用URI。
     */ (value: string) => new TestUri(value.replace(/^file:\/\//i, ''))
        },
        window: { showSaveDialog: vscodeMock.showSaveDialog },
        workspace: {
            getWorkspaceFolder: vscodeMock.getWorkspaceFolder,
            fs: {

                readFile: (uri: TestUri) => fs.readFile(uri.fsPath)
            }
        }
    }));

import { exportHtml, prepareHtmlExport, writePreparedHtml } from '../src/extension/html';

/**
 * HTML・テストの回帰で一時生成物または検証対象を置くディレクトリ。
 */
const temporaryDirectories: string[] = [];

afterEach(
    /**
     * HTML・テストの回帰の前提条件を準備し、回帰条件を検証するテストケース。
     */
    async () => {
        vscodeMock.showSaveDialog.mockReset();
        vscodeMock.getWorkspaceFolder.mockReset();
        await Promise.all(temporaryDirectories.splice(0).map(
            /**
             * 各directoryをrmへ渡し、変換結果を一覧化する。
             * @param directory - HTML・テストの回帰で読み書きするリソースの場所。

             */
            (directory) => fs.rm(directory, { recursive: true, force: true })));
    });

describe('HTML export',
    () => {
        it('recursively converts linked Markdown and embeds local images',
            async () => {
                const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
                temporaryDirectories.push(directory);
                await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
                await fs.mkdir(path.join(directory, 'nested'), { recursive: true });
                await fs.copyFile('sample/assets/local-sample.svg', path.join(directory, 'assets', 'local-sample.svg'));
                await fs.writeFile(path.join(directory, 'child.md'), '# Child\n\n[Grand](nested/grand.md)\n', 'utf8');
                await fs.writeFile(path.join(directory, 'nested', 'grand.md'), '# Grand\n', 'utf8');

                const target = path.join(directory, 'out', 'index.html');
                vscodeMock.showSaveDialog.mockResolvedValue(new TestUri(target));
                const result = await exportHtml({
                    markdown: '# Main\n\n[Child](child.md)',
                    html: '<h1>Main</h1><p><a href="#" data-mve-link="child.md">Child</a></p><img src="assets/local-sample.svg" data-original-src="assets/local-sample.svg" alt="local">',
                    css: 'h1 { color: red; }',
                    options: { embedImages: true, convertLinkedMarkdown: true, saveWithoutDialog: false },
                    documentUri: new TestUri(path.join(directory, 'main.md')) as any,
                    language: 'ja',
                    fontFamily: '"Test Font", sans-serif'
                });

                expect(result?.paths.map(
                    (uri) => uri.fsPath)).toEqual([
                        target,
                        path.join(directory, 'out', 'child.html'),
                        path.join(directory, 'out', 'nested', 'grand.html')
                    ]);
                const main = await fs.readFile(target, 'utf8');
                const child = await fs.readFile(path.join(directory, 'out', 'child.html'), 'utf8');
                expect(main).toContain('href="child.html"');
                expect(main).toContain('src="data:image/svg+xml;base64,');
                expect(main).toContain('font-family: "Test Font", sans-serif, "Noto Sans JP", "Yu Gothic UI", sans-serif;');
                expect(main).not.toContain('data-original-src');
                expect(child).toContain('href="nested/grand.html"');
            });

        it('rewrites local image paths when embedding is disabled',
            async () => {
                const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
                temporaryDirectories.push(directory);
                await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
                await fs.copyFile('sample/assets/local-sample.svg', path.join(directory, 'assets', 'local-sample.svg'));

                const target = path.join(directory, 'out', 'index.html');
                vscodeMock.showSaveDialog.mockResolvedValue(new TestUri(target));
                await exportHtml({
                    markdown: '![local](assets/local-sample.svg)',
                    html: '<img src="assets/local-sample.svg" data-original-src="assets/local-sample.svg" alt="local">',
                    css: '',
                    options: { embedImages: false, convertLinkedMarkdown: false, saveWithoutDialog: false },
                    documentUri: new TestUri(path.join(directory, 'main.md')) as any,
                    language: 'en'
                });

                const output = await fs.readFile(target, 'utf8');
                expect(output).toContain('src="../assets/local-sample.svg"');
                expect(output).not.toContain('data:image/svg+xml;base64,');
            });

        it('uses Webview-rendered HTML for recursive documents',
            async () => {
                const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
                temporaryDirectories.push(directory);
                const markdownPath = path.join(directory, 'main.md');
                const childPath = path.join(directory, 'child.md');
                await fs.writeFile(childPath, '```mermaid\nflowchart TD\n A --> B\n```\n', 'utf8');
                const target = path.join(directory, 'main.html');
                vscodeMock.showSaveDialog.mockResolvedValue(new TestUri(target));
                const request = {
                    markdown: '[Child](child.md)',
                    html: '<p><a href="#" data-mve-link="child.md">Child</a></p>',
                    css: '',
                    options: { embedImages: false, convertLinkedMarkdown: true, saveWithoutDialog: false },
                    documentUri: new TestUri(markdownPath) as any,
                    language: 'ja'
                };
                const preparation = await prepareHtmlExport(request);
                expect(preparation).toBeTruthy();
                await writePreparedHtml(request, preparation!, [{
                    id: childPath,
                    html: '<div class="mermaid"><svg data-rendered="true"></svg></div>'
                }]);

                const child = await fs.readFile(path.join(directory, 'child.html'), 'utf8');
                expect(child).toContain('<svg data-rendered="true"></svg>');
                expect(child).not.toContain('language-mermaid');
            });

        it('resolves workspace-rooted section links when exporting linked Markdown', async () => {
            const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
            temporaryDirectories.push(directory);
            await fs.mkdir(path.join(directory, 'guides'), { recursive: true });
            await fs.writeFile(
                path.join(directory, 'guides', 'overview.md'),
                '[Setup](/guides/setup.md#setup "MVE workspace-root link")\n',
                'utf8'
            );
            await fs.writeFile(
                path.join(directory, 'guides', 'setup.md'),
                '$$\n# A\n$$\n\n[^x]:\n  # B\n\n# Setup\n\n# Setup\n',
                'utf8'
            );
            vscodeMock.getWorkspaceFolder.mockImplementation((uri: TestUri) => {
                const documentPath = path.resolve(uri.fsPath);
                const workspacePath = path.resolve(directory);
                return documentPath.startsWith(`${workspacePath}${path.sep}`) || documentPath === workspacePath
                    ? { uri: new TestUri(workspacePath) }
                    : undefined;
            });

            const target = path.join(directory, 'out', 'index.html');
            vscodeMock.showSaveDialog.mockResolvedValue(new TestUri(target));
            const result = await exportHtml({
                markdown: '[Overview](/guides/overview.md "MVE workspace-root link")',
                html: '<p><a href="#" data-mve-link="/guides/overview.md" data-mve-workspace-rooted="true">Overview</a></p>',
                css: '',
                options: { embedImages: false, convertLinkedMarkdown: true, saveWithoutDialog: false },
                documentUri: new TestUri(path.join(directory, 'notes', 'source.md')) as any,
                language: 'en'
            });

            expect(result?.paths).toHaveLength(3);
            expect(result?.paths[0].fsPath).toBe(target);
            expect(result?.paths[1].fsPath.replace(/\\/g, '/')).toMatch(/(?:^|\/)out\/_linked\/[a-f0-9]{10}-overview\.html$/u);
            expect(result?.paths[2].fsPath.replace(/\\/g, '/')).toMatch(/(?:^|\/)out\/_linked\/[a-f0-9]{10}-setup\.html$/u);
            const main = await fs.readFile(target, 'utf8');
            expect(main).toContain('href="_linked/');
            expect(main).toContain('-overview.html"');
            expect(main).not.toContain('data-mve-workspace-rooted');
            const overview = await fs.readFile(result!.paths[1].fsPath, 'utf8');
            expect(overview).toMatch(/href="[a-f0-9]{10}-setup\.html#setup"/u);
            expect(overview).not.toContain('MVE workspace-root link');
            const setup = await fs.readFile(result!.paths[2].fsPath, 'utf8');
            expect(setup).toContain('<h1 id="setup">Setup</h1>');
            expect(setup).toContain('<h1 id="setup-1">Setup</h1>');
            expect(setup).not.toContain('<h1 id="a">');
            expect(setup).not.toContain('<h1 id="b">');
            expect(setup).toContain('<pre class="math-block"># A</pre>');
        });

        it('rewrites a nested workspace-root link relative to the exported HTML file', async () => {
            const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
            temporaryDirectories.push(workspaceRoot);
            const sampleDirectory = path.join(workspaceRoot, 'sample');
            await fs.mkdir(sampleDirectory, { recursive: true });
            await fs.writeFile(
                path.join(sampleDirectory, '04-tables.md'),
                '# GFMテーブル総合確認\n',
                'utf8'
            );
            vscodeMock.getWorkspaceFolder.mockReturnValue({ uri: new TestUri(workspaceRoot) } as any);

            const markdown = '[GFMテーブル総合確認](/sample/04-tables.md#gfmテーブル総合確認 "MVE workspace-root link")';
            const target = path.join(sampleDirectory, '03-images.html');
            vscodeMock.showSaveDialog.mockResolvedValue(new TestUri(target));
            const result = await exportHtml({
                markdown,
                html: renderMarkdownUnsafe(markdown, { remoteImagesEnabled: true, language: 'ja' }),
                css: '',
                options: { embedImages: false, convertLinkedMarkdown: true, saveWithoutDialog: false },
                documentUri: new TestUri(path.join(sampleDirectory, '03-images.md')) as any,
                language: 'ja'
            });

            expect(result?.paths).toHaveLength(2);
            const rootHtml = await fs.readFile(target, 'utf8');
            const linkedHtml = await fs.readFile(path.join(sampleDirectory, '04-tables.html'), 'utf8');
            const linkedHtmlPath = path.join(sampleDirectory, '04-tables.html');
            const exportedFragment = /href="04-tables\.html#([^"]+)"/u.exec(rootHtml)?.[1];
            const exportedHeadingId = /<h1 id="([^"]+)"/u.exec(linkedHtml)?.[1];
            expect(decodeURIComponent(exportedFragment ?? '')).toBe(exportedHeadingId);
            expect(new URL(`04-tables.html#${exportedFragment ?? ''}`, pathToFileURL(target)).href)
                .toBe(`${pathToFileURL(linkedHtmlPath).href}#${exportedFragment ?? ''}`);
        });

        it('exports a document-relative link when the workspace marker remains', async () => {
            const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
            temporaryDirectories.push(workspaceRoot);
            const sampleDirectory = path.join(workspaceRoot, 'sample');
            await fs.mkdir(sampleDirectory, { recursive: true });
            await fs.writeFile(path.join(sampleDirectory, '04-tables.md'), '# GFMテーブル総合確認\n', 'utf8');
            vscodeMock.getWorkspaceFolder.mockReturnValue({ uri: new TestUri(workspaceRoot) } as any);

            const markdown = '[GFMテーブル総合確認](./04-tables.md#gfmテーブル総合確認 "MVE workspace-root link")';
            const target = path.join(sampleDirectory, '03-images.html');
            vscodeMock.showSaveDialog.mockResolvedValue(new TestUri(target));
            const result = await exportHtml({
                markdown,
                html: renderMarkdownUnsafe(markdown, { remoteImagesEnabled: true, language: 'ja' }),
                css: '',
                options: { embedImages: false, convertLinkedMarkdown: true, saveWithoutDialog: false },
                documentUri: new TestUri(path.join(sampleDirectory, '03-images.md')) as any,
                language: 'ja'
            });

            expect(result?.paths).toHaveLength(2);
            const rootHtml = await fs.readFile(target, 'utf8');
            expect(rootHtml).toMatch(/href="04-tables\.html#[^"]+"/u);
            expect(rootHtml).not.toContain('data-mve-workspace-rooted');
        });

        it('converts inline single-quoted and reference-style workspace links to exported HTML', async () => {
            const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
            temporaryDirectories.push(directory);
            await fs.mkdir(path.join(directory, 'guides'), { recursive: true });
            await fs.writeFile(path.join(directory, 'guides', 'setup.md'), '# Setup\n', 'utf8');
            vscodeMock.getWorkspaceFolder.mockImplementation((uri: TestUri) => {
                const documentPath = path.resolve(uri.fsPath);
                const workspacePath = path.resolve(directory);
                return documentPath.startsWith(`${workspacePath}${path.sep}`) || documentPath === workspacePath
                    ? { uri: new TestUri(workspacePath) }
                    : undefined;
            });

            const escapedTitle = String.raw`"see \"this\""`;
            const linkForms = [
                {
                    name: 'inline',
                    markdown: "[Setup](/guides/setup.md#setup 'MVE workspace-root link')"
                },
                {
                    name: 'reference',
                    markdown: '[Setup][setup]\n\n[setup]: /guides/setup.md#setup "MVE workspace-root link"'
                },
                {
                    name: 'reference-multiline',
                    markdown: '[Setup][setup]\n\n[setup]: /guides/setup.md#setup\n  "MVE workspace-root link"'
                },
                {
                    name: 'reference-multiline-unindented',
                    markdown: '[Setup][setup]\n\n[setup]: /guides/setup.md#setup\n"MVE workspace-root link"'
                },
                {
                    name: 'reference-multiline-four-spaces',
                    markdown: '[Setup][setup]\n\n[setup]: /guides/setup.md#setup\n    "MVE workspace-root link"'
                },
                {
                    name: 'reference-multiline-blockquote',
                    markdown: '> [Setup][setup]\n>\n> [setup]: /guides/setup.md#setup\n>  "MVE workspace-root link"'
                },
                {
                    name: 'reference-escaped-marker',
                    markdown: '[Setup][setup]\n\n[setup]: /guides/setup.md#setup "MVE workspace\\-root link"'
                },
                {
                    name: 'reference-escaped-title',
                    markdown: `[Setup][setup]\n\n[setup]: guides/setup.md#setup ${escapedTitle}`,
                    workspaceRooted: false
                }
            ];

            for (const linkForm of linkForms) {
                const target = path.join(directory, 'out', `${linkForm.name}.html`);
                vscodeMock.showSaveDialog.mockResolvedValue(new TestUri(target));
                const html = renderMarkdownUnsafe(linkForm.markdown, { remoteImagesEnabled: true, language: 'en' });
                if (linkForm.workspaceRooted === false) {
                    expect(html).not.toContain('data-mve-workspace-rooted="true"');
                } else {
                    expect(html).toContain('data-mve-workspace-rooted="true"');
                }
                const result = await exportHtml({
                    markdown: linkForm.markdown,
                    html,
                    css: '',
                    options: { embedImages: false, convertLinkedMarkdown: true, saveWithoutDialog: false },
                    documentUri: new TestUri(path.join(directory, `${linkForm.name}.md`)) as any,
                    language: 'en'
                });

                expect(result?.paths, linkForm.name).toHaveLength(2);
                const output = await fs.readFile(target, 'utf8');
                expect(output).toContain('href="guides/setup.html#setup"');
                expect(result!.paths[1].fsPath).toBe(path.join(directory, 'out', 'guides', 'setup.html'));
                expect(await fs.readFile(result!.paths[1].fsPath, 'utf8')).toContain('<h1 id="setup">Setup</h1>');
            }
        });

        it('keeps workspace-rooted links after a page break pointed at the exported heading', async () => {
            const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
            temporaryDirectories.push(directory);
            const sourceDirectory = path.join(directory, 'sample');
            await fs.mkdir(sourceDirectory, { recursive: true });
            const sourcePath = path.join(sourceDirectory, '06-specification-template.md');
            const linkedPath = path.join(sourceDirectory, '03-images.md');
            await fs.writeFile(linkedPath, '## Ctrl+V確認欄\n\n見出しリンクの到達先です。\n', 'utf8');
            vscodeMock.getWorkspaceFolder.mockImplementation((uri: TestUri) => {
                const documentPath = path.resolve(uri.fsPath);
                const workspacePath = path.resolve(directory);
                return documentPath.startsWith(`${workspacePath}${path.sep}`) || documentPath === workspacePath
                    ? { uri: new TestUri(workspacePath) }
                    : undefined;
            });

            const target = path.join(directory, 'out', '06-specification-template.html');
            vscodeMock.showSaveDialog.mockResolvedValue(new TestUri(target));
            const markdown = '<!-- pagebreak -->\n[CtrlV確認欄](/sample/03-images.md#ctrlv確認欄 "MVE workspace-root link")';
            const result = await exportHtml({
                markdown,
                html: renderMarkdownUnsafe(markdown, { remoteImagesEnabled: true, language: 'ja' }),
                css: '',
                options: { embedImages: false, convertLinkedMarkdown: true, saveWithoutDialog: false },
                documentUri: new TestUri(sourcePath) as any,
                language: 'ja'
            });

            expect(result?.paths).toHaveLength(2);
            const rootHtml = await fs.readFile(target, 'utf8');
            const linkedHtml = await fs.readFile(path.join(directory, 'out', '03-images.html'), 'utf8');
            const linkedHtmlPath = path.join(directory, 'out', '03-images.html');
            expect(rootHtml).toContain('href="03-images.html#ctrlv%E7%A2%BA%E8%AA%8D%E6%AC%84"');
            expect(linkedHtml).toContain('<h2 id="ctrlv確認欄">Ctrl+V確認欄</h2>');
            const exportedHref = /<a href="([^"]+)">CtrlV確認欄<\/a>/u.exec(rootHtml)?.[1];
            const exportedFragment = exportedHref?.split('#', 2)[1];
            const exportedHeadingId = /<h2 id="([^"]+)"/u.exec(linkedHtml)?.[1];
            expect(decodeURIComponent(exportedFragment ?? '')).toBe(exportedHeadingId);
        });

        it('preserves encoded delimiters in workspace-rooted linked filenames', async () => {
            const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
            temporaryDirectories.push(directory);
            const sourcePath = path.join(directory, 'main.md');
            await fs.writeFile(path.join(directory, 'a#b.md'), '# Section\n', 'utf8');
            await fs.writeFile(path.join(directory, '100%20.md'), '# Section\n', 'utf8');
            vscodeMock.getWorkspaceFolder.mockReturnValue({ uri: new TestUri(directory) } as any);

            const target = path.join(directory, 'out', 'main.html');
            vscodeMock.showSaveDialog.mockResolvedValue(new TestUri(target));
            const result = await exportHtml({
                markdown: '[Hash](/a%23b.md#section "MVE workspace-root link")\n\n[Percent](/100%2520.md#section "MVE workspace-root link")',
                html: '<p><a href="#" data-mve-link="/a%23b.md#section" data-mve-workspace-rooted="true">Hash</a></p><p><a href="#" data-mve-link="/100%2520.md#section" data-mve-workspace-rooted="true">Percent</a></p>',
                css: '',
                options: { embedImages: false, convertLinkedMarkdown: true, saveWithoutDialog: false },
                documentUri: new TestUri(sourcePath) as any,
                language: 'en'
            });

            expect(result?.paths).toHaveLength(3);
            const rootHtml = await fs.readFile(target, 'utf8');
            expect(rootHtml).toContain('href="a%23b.html#section"');
            expect(rootHtml).toContain('href="100%2520.html#section"');
            await expect(fs.access(path.join(directory, 'out', 'a#b.html'))).resolves.toBeUndefined();
            await expect(fs.access(path.join(directory, 'out', '100%20.html'))).resolves.toBeUndefined();
        });

        it('encodes same-document Unicode fragments consistently with exported links', async () => {
            const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
            temporaryDirectories.push(directory);
            const sourcePath = path.join(directory, 'main.md');
            const target = path.join(directory, 'main.html');
            vscodeMock.showSaveDialog.mockResolvedValue(new TestUri(target));

            vscodeMock.getWorkspaceFolder.mockReturnValue({ uri: new TestUri(directory) } as any);
            const markdown = '## Ctrl+V確認欄\n\n[CtrlV確認欄](#ctrlv確認欄)\n\n[Workspace copy](/main.md#ctrlv確認欄 "MVE workspace-root link")';
            await exportHtml({
                markdown,
                html: renderMarkdownUnsafe(markdown, { remoteImagesEnabled: true, language: 'ja' }),
                css: '',
                options: { embedImages: false, convertLinkedMarkdown: false, saveWithoutDialog: false },
                documentUri: new TestUri(sourcePath) as any,
                language: 'ja'
            });

            const output = await fs.readFile(target, 'utf8');
            expect(output).toContain('<h2 id="ctrlv確認欄">Ctrl+V確認欄</h2>');
            expect(output).toContain('href="#ctrlv%E7%A2%BA%E8%AA%8D%E6%AC%84"');
            expect(output).toContain('href="main.html#ctrlv%E7%A2%BA%E8%AA%8D%E6%AC%84"');
            const exportedFragment = /href="#([^"]+)"/u.exec(output)?.[1];
            const exportedHeadingId = /<h2 id="([^"]+)"/u.exec(output)?.[1];
            expect(decodeURIComponent(exportedFragment ?? '')).toBe(exportedHeadingId);
        });

        it('exports beside the Markdown file without opening a save dialog by default',
            async () => {
                const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
                temporaryDirectories.push(directory);
                const markdownPath = path.join(directory, 'overview.md');

                const result = await exportHtml({
                    markdown: '# Overview',
                    html: '<h1>Overview</h1>',
                    css: '',
                    options: { embedImages: false, convertLinkedMarkdown: false, saveWithoutDialog: true },
                    documentUri: new TestUri(markdownPath) as any,
                    language: 'en'
                });

                expect(vscodeMock.showSaveDialog).not.toHaveBeenCalled();
                expect(result?.target.fsPath).toBe(path.join(directory, 'overview.html'));
                expect(await fs.stat(path.join(directory, 'overview.html'))).toBeTruthy();
            });
    });

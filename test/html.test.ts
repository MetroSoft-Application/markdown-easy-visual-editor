/**
 * @fileoverview HTML・テストの回帰の仕様と回帰条件を検証する。失敗時は期待値と実装差分を示す。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
     * HTML・テストの回帰で使う値または実行環境を組み立てる。
     * @param fsPath - テスト対象のファイルパス。
     * @returns 初期化したインスタンス。
     */
    constructor(readonly fsPath: string) {
        this.path = fsPath.replace(/\\/g, '/');
    }
}

/**
 * HTML・テストの回帰のvscode・mockに関する状態または設定。
 */
const vscodeMock = vi.hoisted(
    /**
     * 要素をfnへ渡し、HTML・テストの回帰の結果または副作用を処理する。
     * @returns HTML・テストの回帰のコールバックが生成する結果。
     */
    () => ({ showSaveDialog: vi.fn() }));
vi.mock('vscode',
    /**
     * 要素をtest・uriへ渡し、HTML・テストの回帰の結果または副作用を処理する。
     * @returns HTML・テストの回帰のコールバックが生成する結果。
     */
    () => ({
        Uri: {


            file: /**
     * HTML・テストの回帰のfileを処理し、呼び出し側へ結果または副作用を返す。
     * @param filePath - 読み書きするファイルのパス。
     * @returns HTML・テストの回帰のfileが生成する結果。
     */ (filePath: string) => new TestUri(filePath),


            parse: /**
     * HTML・テストの回帰の入力を構造化した値へ変換する。
     * @param value - 検証・変換・保存の対象となる値。
     * @returns HTML・テストの回帰で生成または変換した値。
     */ (value: string) => new TestUri(value.replace(/^file:\/\//i, ''))
        },
        window: { showSaveDialog: vscodeMock.showSaveDialog },
        workspace: {
            fs: {

                readFile: /**
   * HTML・テストの回帰から必要な値またはリソースを取得する。
   * @param uri - VS Codeまたはブラウザーが扱うリソースURI。
   * @returns HTML・テストの回帰のread・fileが生成する結果。
   */ (uri: TestUri) => fs.readFile(uri.fsPath)
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
     * @returns テストケースを実行し、値は返さない。
     */
    async () => {
        vscodeMock.showSaveDialog.mockReset();
        await Promise.all(temporaryDirectories.splice(0).map(
            /**
             * 各directoryをrmへ渡し、変換結果を一覧化する。
             * @param directory - HTML・テストの回帰で読み書きするリソースの場所。
             * @returns 入力要素から生成した変換結果の一覧。
             */
            (directory) => fs.rm(directory, { recursive: true, force: true })));
    });

describe('HTML export',
    /**
     * 「HTML export」の仕様と回帰条件を検証するテストケース。
     * @returns テストケースを実行し、値は返さない。
     */
    () => {
        it('recursively converts linked Markdown and embeds local images',
            /**
             * 「recursively converts linked Markdown and embeds local images」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
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
                    /**
                     * 各uriからfs・pathを取り出して一覧化する。
                     * @param uri - uriのfs・pathを参照する走査対象。
                     * @returns fs・pathを取り出した変換結果の一覧。
                     */
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
            /**
             * 「rewrites local image paths when embedding is disabled」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
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
            /**
             * 「uses Webview-rendered HTML for recursive documents」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
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

        it('exports beside the Markdown file without opening a save dialog by default',
            /**
             * 「exports beside the Markdown file without opening a save dialog by default」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
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

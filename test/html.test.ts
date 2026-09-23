/**
 * @file html.test.ts
 * 実行境界: テスト実行環境。
 * 責務: 現行実装の仕様と回帰条件を検証する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テスト用のモック、ブラウザー、ファイルを必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 「TestUri」クラスの状態とライフサイクルを定義します。
 */
class TestUri {

  /**
   * 「scheme」は、URLリソースの対応する構成要素を保持します。
   */
  readonly scheme = 'file';

  /**
   * 「path」は、読み込みまたは出力対象を示すパス・URL・内容を保持します。
   */
  readonly path: string;

  /**
   * 処理に必要な状態を初期化します。
   * @param fsPath 処理対象を特定するfsPathの入力値です。
   * @returns 「constructor」がHTML出力の入力を処理して得た固有の結果を返します。
   */
  constructor(readonly fsPath: string) {
    this.path = fsPath.replace(/\\/g, '/');
  }
}

/** 「vscodeMock」は、関連する処理間で共有する設定値または状態です。 */
const vscodeMock = vi.hoisted(
/**
 * テスト対象が利用するAPIまたは依存モジュールのモックを生成するコールバックです。
 * @returns 置換後の文字列を返します。
 */
() => ({ showSaveDialog: vi.fn() }));
vi.mock('vscode',
/**
 * テスト対象が利用するAPIまたは依存モジュールのモックを生成するコールバックです。
 * @returns 置換後の文字列を返します。
 */
() => ({
  Uri: {

    /**
     * 「file」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
     * @param filePath 「filePath」は、「file」がHTMLで処理する対象を特定する入力です。
     * @returns 「file」がHTML出力の入力を処理して得た固有の結果を返します。
     */
    file: /**
 * 「file」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param filePath 「filePath」は、「file」がHTMLで処理する対象を特定する入力です。
 * @returns 「file」がHTML出力の入力を処理して得た固有の結果を返します。
 */ (filePath: string) => new TestUri(filePath),

    /**
     * parseを解析または復元します。
     * @param value 処理で検証・変換する入力値です。
     * @returns 「parse」が読み取りまたは正規化した結果を返します。
     */
    parse: /**
 * 「parse」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param value 「parse」で検証・変換する入力値です。
 * @returns 「parse」が読み取りまたは正規化した結果を返します。
 */ (value: string) => new TestUri(value.replace(/^file:\/\//i, ''))
  },
  window: { showSaveDialog: vscodeMock.showSaveDialog },
  workspace: { fs: {
  /**
   * ファイルを取得または解決します。
   * @param uri 「uri」は、「readFile」がHTML出力の処理対象を特定する入力です。
   * @returns 「readFile」が読み取りまたは正規化した結果を返します。
   */
  readFile: /**
 * 「readFile」は、要求された状態、値、または対象を読み取ります。
 * @param uri 「uri」は、「readFile」がHTMLで処理する対象を特定する入力です。
 * @returns 「readFile」が読み取りまたは正規化した結果を返します。
 */ (uri: TestUri) => fs.readFile(uri.fsPath) } }
}));

import { exportHtml, prepareHtmlExport, writePreparedHtml } from '../src/extension/html';

/** 「temporaryDirectories」は、対象ファイルまたは実行環境の場所を表す値です。 */
const temporaryDirectories: string[] = [];

afterEach(
/**
 * 「async」として関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @returns 「vscodeMock.showSaveDialog.mockReset」を実行し、値を返しません。
 */
async () => {
  vscodeMock.showSaveDialog.mockReset();
  await Promise.all(temporaryDirectories.splice(0).map(
  /**
 * 「directory」を変換し、変換後の要素を返すコールバックです。
   * @param directory 読み込みまたは出力するリソースの場所を示します。
   * @returns 入力要素から生成した変換後の値を返します。
   */
  (directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('HTML export',
/**
 * テスト「HTML export」の前提条件を設定し、期待結果を検証するコールバックです。
 * @returns テストの前提条件と期待結果を検証し、値を返しません。
 */
() => {
  it('recursively converts linked Markdown and embeds local images',
  /**
   * 「async」として関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
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
 * 「uri」を変換し、変換後の要素を返すコールバックです。
     * @param uri 処理対象文書またはリソースを示すURIです。
     * @returns 入力要素から生成した変換後の値を返します。
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
   * 「async」として関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
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
   * 「async」として関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
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
   * 「async」として関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
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

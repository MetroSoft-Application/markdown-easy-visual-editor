import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

class TestUri {
  readonly scheme = 'file';
  readonly path: string;

  constructor(readonly fsPath: string) {
    this.path = fsPath.replace(/\\/g, '/');
  }
}

const vscodeMock = vi.hoisted(() => ({ showSaveDialog: vi.fn() }));
vi.mock('vscode', () => ({
  Uri: {
    file: (filePath: string) => new TestUri(filePath),
    parse: (value: string) => new TestUri(value.replace(/^file:\/\//i, ''))
  },
  window: { showSaveDialog: vscodeMock.showSaveDialog },
  workspace: { fs: { readFile: (uri: TestUri) => fs.readFile(uri.fsPath) } }
}));

import { exportHtml } from '../src/extension/html';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vscodeMock.showSaveDialog.mockReset();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('HTML export', () => {
  it('recursively converts linked Markdown and embeds local images', async () => {
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
      language: 'ja'
    });

    expect(result?.paths.map((uri) => uri.fsPath)).toEqual([
      target,
      path.join(directory, 'out', 'child.html'),
      path.join(directory, 'out', 'nested', 'grand.html')
    ]);
    const main = await fs.readFile(target, 'utf8');
    const child = await fs.readFile(path.join(directory, 'out', 'child.html'), 'utf8');
    expect(main).toContain('href="child.html"');
    expect(main).toContain('src="data:image/svg+xml;base64,');
    expect(main).not.toContain('data-original-src');
    expect(child).toContain('href="nested/grand.html"');
  });

  it('rewrites local image paths when embedding is disabled', async () => {
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

  it('exports beside the Markdown file without opening a save dialog by default', async () => {
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

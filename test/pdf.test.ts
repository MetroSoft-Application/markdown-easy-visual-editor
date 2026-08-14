import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

class TestUri {
  readonly authority = '';
  readonly query = '';
  readonly fragment = '';

  constructor(
    readonly scheme: string,
    readonly path: string,
    readonly fsPath: string
  ) {}

  with(change: { path?: string }): TestUri {
    const nextPath = change.path ?? this.path;
    return new TestUri(this.scheme, nextPath, this.fsPath.replace(/\.[^./\\]+$/i, '.pdf'));
  }

  toJSON(): object {
    return { scheme: this.scheme, path: this.path, fsPath: this.fsPath };
  }
}

// Vitestの仮想モジュール指定は型定義にないため、実行時APIを保ったまま検証する。
vi.mock('vscode', () => ({
  Uri: {
    file: (filePath: string) => new TestUri('file', filePath.replace(/\\/g, '/'), filePath),
    joinPath: (base: TestUri, ...segments: string[]) => new TestUri(
      base.scheme,
      path.posix.join(base.path, ...segments),
      path.join(base.fsPath, ...segments)
    ),
    parse: (value: string) => new TestUri('file', value, value.replace(/^file:\/\//i, ''))
  },
  workspace: {
    fs: { readFile: (uri: TestUri) => fs.readFile(uri.fsPath) },
    getConfiguration: () => ({ get: (_key: string, fallback: string) => fallback })
  },
  window: { showSaveDialog: async () => undefined }
// @ts-ignore Vitest supports a third virtual-module option at runtime.
}), { virtual: true });
vi.mock('dompurify', () => ({ default: { sanitize: (value: string) => value } }));

import { buildStandaloneHtml, exportPdf, renderPdf, type PdfExportRequest } from '../src/extension/pdf';
import { renderMarkdown } from '../src/webview/markdownRenderer';

const temporaryDirectories: string[] = [];
const temporaryServers: Server[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
  await Promise.all(temporaryServers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  })));
});

describe('PDF local images', () => {
  it('embeds a relative local image and produces a PDF with it', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-pdf-'));
    temporaryDirectories.push(directory);
    const imagePath = path.join(directory, 'assets', 'local-sample.svg');
    await fs.mkdir(path.dirname(imagePath), { recursive: true });
    await fs.copyFile(path.resolve('sample/assets/local-sample.svg'), imagePath);
    const documentPath = path.join(directory, 'document.md');
    const documentUri = new TestUri('file', documentPath.replace(/\\/g, '/'), documentPath);
    const html = '<p>画像</p><img src="assets/local-sample.svg" data-original-src="assets/local-sample.svg" alt="画像">';
    const request = {
      html,
      css: 'img { max-width: 100%; }',
      options: {
        format: 'A4' as const,
        orientation: 'portrait' as const,
        margins: { top: 10, right: 10, bottom: 10, left: 10 },
        header: '',
        footer: '',
        saveWithoutDialog: true
      },
      documentUri,
      language: 'en'
    } as unknown as PdfExportRequest;

    const standaloneHtml = await buildStandaloneHtml(request);
    expect(standaloneHtml).toContain('<html lang="en">');
    const imageBytes = await fs.readFile(imagePath);
    expect(standaloneHtml).toContain(`src="data:image/svg+xml;base64,${imageBytes.toString('base64')}"`);

    const output = await exportPdf(request);
    expect(output?.fsPath).toBe(path.join(directory, 'document.pdf'));
    expect((await fs.stat(path.join(directory, 'document.pdf'))).size).toBeGreaterThan(0);
  }, 30_000);

  it('does not wait indefinitely for a remote image that never finishes', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-pdf-'));
    temporaryDirectories.push(directory);
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'image/png' });
      // 画像レスポンスを完了させず、応答待ちが無期限にならないことを検証する。
    });
    temporaryServers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not start.');

    const documentPath = path.join(directory, 'document.md');
    const documentUri = new TestUri('file', documentPath.replace(/\\/g, '/'), documentPath);
    const request = {
      html: `<p>remote image</p><img src="http://127.0.0.1:${address.port}/never-finishes.png">`,
      css: 'img { max-width: 100%; }',
      options: {
        format: 'A4' as const,
        orientation: 'portrait' as const,
        margins: { top: 10, right: 10, bottom: 10, left: 10 },
        header: '',
        footer: '',
        saveWithoutDialog: true
      },
      documentUri,
      language: 'en'
    } as unknown as PdfExportRequest;

    const startedAt = Date.now();
    const output = await exportPdf(request);
    expect(Date.now() - startedAt).toBeLessThan(15_000);
    expect(output?.fsPath).toBe(path.join(directory, 'document.pdf'));
    expect((await fs.stat(path.join(directory, 'document.pdf'))).size).toBeGreaterThan(0);
  }, 20_000);

  it('renders sample/03-images.md within the preview budget', async () => {
    const documentPath = path.resolve('sample/03-images.md');
    const documentUri = new TestUri('file', documentPath.replace(/\\/g, '/'), documentPath);
    const markdown = await fs.readFile(documentPath, 'utf8');
    const html = renderMarkdown(markdown, { remoteImagesEnabled: true, language: 'ja' });
    expect(html).toContain('github.githubassets.com/images/modules/logos_page/GitHub-Mark.png');
    const startedAt = Date.now();
    const output = await renderPdf({
      html,
      css: 'body { font-family: sans-serif; } img { max-width: 100%; }',
      options: {
        format: 'A4',
        orientation: 'portrait',
        margins: { top: 15, right: 15, bottom: 15, left: 15 },
        header: '',
        footer: '{page}/{pages}',
        saveWithoutDialog: true
      },
      documentUri,
      language: 'ja',
      purpose: 'preview'
    });
    expect(Date.now() - startedAt).toBeLessThan(10_000);
    expect(output.length).toBeGreaterThan(0);
  }, 15_000);
});

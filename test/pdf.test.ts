import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

class TestUri {
  constructor(
    readonly scheme: string,
    readonly path: string,
    readonly fsPath: string
  ) {}

  with(change: { path?: string }): TestUri {
    const nextPath = change.path ?? this.path;
    return new TestUri(this.scheme, nextPath, this.fsPath.replace(/\.[^./\\]+$/i, '.pdf'));
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

import { buildStandaloneHtml, exportPdf, type PdfExportRequest } from '../src/extension/pdf';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
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
    const extensionPath = path.resolve('.');
    const extensionUri = new TestUri('file', extensionPath.replace(/\\/g, '/'), extensionPath);
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
      extensionUri,
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
});

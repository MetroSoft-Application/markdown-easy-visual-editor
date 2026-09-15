import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  Uri: {
    file: (filePath: string) => ({ scheme: 'file', path: filePath, fsPath: filePath }),
    joinPath: (base: { scheme: string; path: string; fsPath: string }, ...segments: string[]) => ({
      scheme: base.scheme,
      path: [base.path, ...segments].join('/'),
      fsPath: [base.fsPath, ...segments].join('/'),
    }),
    parse: (value: string) => ({ scheme: 'file', path: value, fsPath: value }),
  },
  workspace: {
    fs: { readFile: async () => new Uint8Array() },
    getConfiguration: () => ({ get: (_key: string, fallback: string) => fallback }),
  },
  window: { showSaveDialog: async () => undefined },
// @ts-ignore Vitest supports a third virtual-module option at runtime.
}), { virtual: true });

import { buildStandaloneHtml, type PdfExportRequest } from '../src/extension/pdf';
import { textColorOpenTag } from '../src/shared/textColor';

describe('PDF text color export', () => {
  it('preserves the fixed inline text color in the standalone print HTML', async () => {
    const body = `<p>${textColorOpenTag('orange')}PDF color</span></p>`;
    const request = {
      html: body,
      css: 'p { margin: 0; }',
      options: {
        format: 'A4',
        orientation: 'portrait',
        margins: { top: 10, right: 10, bottom: 10, left: 10 },
        header: '',
        footer: '',
        saveWithoutDialog: true,
      },
      documentUri: { scheme: 'file', path: '/document.md', fsPath: '/document.md' },
      language: 'en',
    } as unknown as PdfExportRequest;

    const html = await buildStandaloneHtml(request);

    expect(html).toContain('data-mve-text-color="orange"');
    expect(html).toContain('style="color:#e65100"');
    expect(html).toContain('PDF color');
  });
});

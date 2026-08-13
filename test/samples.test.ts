import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectDiagnostics, getOutline, splitMarkdownBlocks } from '../src/shared/markdown';

const sampleRoot = path.resolve('sample');
const sampleFiles = readdirSync(sampleRoot)
  .filter((name) => name.endsWith('.md'))
  .map((name) => path.join(sampleRoot, name));

describe('sample Markdown documents', () => {
  it('contains the expected regression documents', () => {
    expect(sampleFiles.length).toBeGreaterThanOrEqual(8);
  });

  for (const file of sampleFiles) {
    const name = path.basename(file);
    it(`${name} can be split without losing bytes`, () => {
      const markdown = readFileSync(file, 'utf8');
      expect(splitMarkdownBlocks(markdown).map((block) => block.raw).join('')).toBe(markdown);
      expect(getOutline(markdown).length).toBeGreaterThan(0);
    });
  }

  it('contains a valid local image fixture', () => {
    const image = path.join(sampleRoot, 'assets', 'local-sample.svg');
    expect(statSync(image).isFile()).toBe(true);
    expect(readFileSync(image, 'utf8')).toContain('<svg');
  });

  it('contains a dedicated diagnostics verification document', () => {
    const markdown = readFileSync(path.join(sampleRoot, '08-diagnostics.md'), 'utf8');
    const codes = new Set(collectDiagnostics(markdown).map((item) => item.code));
    expect(codes).toEqual(new Set([
      'broken-reference-link',
      'duplicate-heading',
      'empty-image-alt',
      'empty-table-header',
      'invalid-table-separator',
      'local-image',
      'table-column-mismatch',
      'unclosed-fence'
    ]));
  });
});

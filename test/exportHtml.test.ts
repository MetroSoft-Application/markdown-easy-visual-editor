import { describe, expect, it } from 'vitest';
import { prepareExportHtml } from '../src/shared/exportHtml';

describe('prepareExportHtml', () => {
  it('expands deferred Mermaid markup and keeps vector SVG in exported HTML', () => {
    const svg = '<svg viewBox="0 0 10 10"><text>diagram</text></svg>';
    const html = `<div class="mermaid-block" data-mve-export-svg="${encodeURIComponent(svg)}"></div>`;

    const result = prepareExportHtml(html);

    expect(result).toContain(svg);
    expect(result).not.toContain('data-mve-export-svg');
  });

  it('forces lazy preview images to load in export documents', () => {
    expect(prepareExportHtml('<img src="a.png" loading="lazy"><img loading=\'lazy\' src="b.png">'))
      .toBe('<img src="a.png" loading="eager"><img loading="eager" src="b.png">');
  });

  it('does not leak malformed deferred SVG payloads into output', () => {
    const result = prepareExportHtml('<div class="mermaid-block" data-mve-export-svg="%E0%A4%A"></div>');

    expect(result).toBe('<div class="mermaid-block"></div>');
  });
});

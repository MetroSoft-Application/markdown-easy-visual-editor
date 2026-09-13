import { describe, expect, it } from 'vitest';
import { highlightCode } from '../src/webview/codeHighlighter';
import { renderMarkdownUnsafeBlocks } from '../src/webview/markdownRendererCore';

const options = { remoteImagesEnabled: false, language: 'ja' as const };

function codeBodies(html: string): string[] {
  return Array.from(html.matchAll(/<pre><code\b[^>]*>([\s\S]*?)<\/code><\/pre>/g), (match) => match[1]);
}

function removeHighlightMarkup(value: string): string {
  return value.replace(/<\/?span\b[^>]*>/g, '');
}

describe('staged Markdown rendering', () => {
  it('keeps code text and document structure identical between preliminary and rich rendering', () => {
    const markdown = [
      '# Heading',
      '',
      '```typescript',
      'const escaped = "<script>";',
      '```',
      '',
      '```unknown-language',
      '<tag>& value',
      '```',
      '',
      '```mermaid',
      'graph TD',
      '  A --> B',
      '```',
    ].join('\n');

    const preliminary = renderMarkdownUnsafeBlocks(markdown, options);
    const rich = renderMarkdownUnsafeBlocks(markdown, options, highlightCode);
    const preliminaryHtml = preliminary.map((block) => block.html).join('');
    const richHtml = rich.map((block) => block.html).join('');

    expect(rich).toHaveLength(preliminary.length);
    expect(codeBodies(richHtml).map(removeHighlightMarkup)).toEqual(codeBodies(preliminaryHtml));
    expect(richHtml).toContain('class="hljs-keyword">const</span>');
    expect(preliminaryHtml).not.toContain('class="hljs-keyword"');
    expect(richHtml).toContain('&lt;tag&gt;&amp; value');
    expect(richHtml).toContain('class="diagram-block mermaid"');
  });

  it('falls back to escaped plain code for unsupported explicit languages', () => {
    const markdown = '```not-a-real-language\n<script>& value\n```';
    const richHtml = renderMarkdownUnsafeBlocks(markdown, options, highlightCode)
      .map((block) => block.html)
      .join('');

    expect(richHtml).toContain('&lt;script&gt;&amp; value');
    expect(richHtml).not.toMatch(/<code[^>]*>\s*<span/);
  });
});

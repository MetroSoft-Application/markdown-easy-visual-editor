import { describe, expect, it } from 'vitest';
import {
  applyTextColorFormatting,
  detectTextColorFormatting,
  textColorOpenTag,
} from '../src/shared/textColor';
import { clearInlineFormatting } from '../src/shared/markdown';
import { prepareExportHtml } from '../src/shared/exportHtml';
import { renderMarkdownUnsafe } from '../src/webview/markdownRendererCore';

function spanCount(value: string): number {
  return (value.match(/<span\b/g) ?? []).length;
}

describe('text color formatting', () => {
  it('applies a fixed text color to the selected text', () => {
    const result = applyTextColorFormatting('alpha beta', { from: 6, to: 10 }, 'red');

    expect(result.text).toBe(`alpha ${textColorOpenTag('red')}beta</span>`);
    expect(result.selection).toEqual({
      from: `alpha ${textColorOpenTag('red')}`.length,
      to: `alpha ${textColorOpenTag('red')}beta`.length,
    });
  });

  it('replaces an existing color without nesting text-color spans', () => {
    const original = `${textColorOpenTag('red')}beta</span>`;
    const betaFrom = textColorOpenTag('red').length;
    const recolored = applyTextColorFormatting(
      original,
      { from: betaFrom + 1, to: betaFrom + 3 },
      'blue',
    );

    expect(recolored.text).toContain(`${textColorOpenTag('red')}b</span>`);
    expect(recolored.text).toContain(`${textColorOpenTag('blue')}et</span>`);
    expect(recolored.text).toContain(`${textColorOpenTag('red')}a</span>`);
    expect(recolored.text).not.toMatch(/data-mve-text-color="[^"]+"[^>]*>[^<]*<span\b/);
    expect(spanCount(recolored.text)).toBe(3);
  });

  it('clears only the selected text color and preserves surrounding colors', () => {
    const original = `${textColorOpenTag('red')}beta</span>`;
    const betaFrom = textColorOpenTag('red').length;
    const cleared = applyTextColorFormatting(
      original,
      { from: betaFrom + 1, to: betaFrom + 3 },
      undefined,
    );

    expect(cleared.text).toBe(
      `${textColorOpenTag('red')}b</span>et${textColorOpenTag('red')}a</span>`,
    );
  });

  it('clears text color together with other inline formatting for the text-format clear command', () => {
    const original = `${textColorOpenTag('red')}**bold** and ++underlined++</span>`;
    const inlineCleared = clearInlineFormatting(original, {
      from: 0,
      to: original.length,
    });
    const fullyCleared = applyTextColorFormatting(
      inlineCleared.text,
      inlineCleared.selection,
      undefined,
    );

    expect(fullyCleared.text).toBe('bold and underlined');
    expect(fullyCleared.text).not.toContain('data-mve-text-color');
    expect(fullyCleared.text).not.toMatch(/\*\*|\+\+/);
  });

  it('splits a multi-line selection so no color span crosses a newline', () => {
    const result = applyTextColorFormatting('one\ntwo\nthree', { from: 0, to: 13 }, 'green');

    expect(result.text).toBe(
      `${textColorOpenTag('green')}one</span>\n` +
        `${textColorOpenTag('green')}two</span>\n` +
        `${textColorOpenTag('green')}three</span>`,
    );
    expect(result.text).not.toMatch(/<span[^>]*>[^<]*\n/);
  });

  it('colors third-level and deeper nested list items without treating them as indented code', () => {
    const source = [
      '- 箇条書き',
      '  - ネストした箇条書き',
      '    - さらにネスト',
      '      1. 番号付きの深いネスト',
    ].join('\n');
    const result = applyTextColorFormatting(
      source,
      { from: 0, to: source.length },
      'red',
    ).text;
    const tag = textColorOpenTag('red');

    expect(result).toBe([
      `- ${tag}箇条書き</span>`,
      `  - ${tag}ネストした箇条書き</span>`,
      `    - ${tag}さらにネスト</span>`,
      `      1. ${tag}番号付きの深いネスト</span>`,
    ].join('\n'));

    const rendered = renderMarkdownUnsafe(result, {
      remoteImagesEnabled: true,
      language: 'ja',
    });
    expect((rendered.match(/<ul>/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(rendered).toContain('data-mve-text-color="red"');
    expect(rendered).toContain('さらにネスト');
    expect(rendered).toContain('番号付きの深いネスト');
  });

  it('preserves Markdown block structure across headings, lists, tables and fences', () => {
    const source = [
      '# Heading',
      '- item',
      '| left | right |',
      '| --- | --- |',
      '```ts',
      'const value = 1;',
      '```',
    ].join('\n');
    const result = applyTextColorFormatting(
      source,
      { from: 0, to: source.length },
      'purple',
    ).text;

    expect(result).toContain(`# ${textColorOpenTag('purple')}Heading</span>`);
    expect(result).toContain(`- ${textColorOpenTag('purple')}item</span>`);
    expect(result).toContain(
      `| ${textColorOpenTag('purple')}left</span> | ${textColorOpenTag('purple')}right</span> |`,
    );
    expect(result).toContain('| --- | --- |');
    expect(result).toContain('```ts\nconst value = 1;\n```');
    expect(result).not.toContain(`${textColorOpenTag('purple')}---`);
    expect(result).not.toContain(`${textColorOpenTag('purple')}const value`);
  });

  it('reports a single color or mixed state for ribbon selection', () => {
    const red = `${textColorOpenTag('red')}red</span>`;
    expect(detectTextColorFormatting(red, { from: 0, to: red.length })).toBe('red');

    const mixed = `${textColorOpenTag('red')}red</span> ${textColorOpenTag('blue')}blue</span>`;
    expect(detectTextColorFormatting(mixed, { from: 0, to: mixed.length })).toBe('mixed');
  });

  it('keeps fixed text-color markup through Markdown rendering and HTML export preparation', () => {
    const markup = `${textColorOpenTag('blue')}Exported color</span>`;
    const rendered = renderMarkdownUnsafe(markup, {
      remoteImagesEnabled: true,
      language: 'en',
    });
    const exported = prepareExportHtml(rendered);

    expect(rendered).toContain('data-mve-text-color="blue"');
    expect(rendered).toContain('style="color:#1565c0"');
    expect(exported).toContain('data-mve-text-color="blue"');
    expect(exported).toContain('style="color:#1565c0"');
  });
});
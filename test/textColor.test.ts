/**
 * @file textColor.test.ts
 * 実行境界: テスト実行環境。
 * 責務: 現行実装の仕様と回帰条件を検証する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テスト用のモック、ブラウザー、ファイルを必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { describe, expect, it } from 'vitest';
import {
  applyTextColorFormatting,
  detectTextColorFormatting,
  textColorOpenTag,
} from '../src/shared/textColor';
import {
  applyMarkdownTableAction,
  clearInlineFormatting,
  collectDiagnostics,
  getOutline,
  wordStats,
} from '../src/shared/markdown';
import { prepareExportHtml } from '../src/shared/exportHtml';
import { renderMarkdownUnsafe } from '../src/webview/markdownRendererCore';

/**
 * 「spanCount」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param value 「spanCount」で検証・変換する入力値です。
 * @returns 計算結果の数値です。
 */
function spanCount(value: string): number {
  return (value.match(/<span\b/g) ?? []).length;
}

describe('text color formatting',
/**
 * テスト「text color formatting」の前提条件を設定し、期待結果を検証するコールバックです。
 * @returns テストの前提条件と期待結果を検証し、値を返しません。
 */
() => {
  it('applies a fixed text color to the selected text',
  /**
 * テスト「applies a fixed text color to the selected text」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const result = applyTextColorFormatting('alpha beta', { from: 6, to: 10 }, 'red');

    expect(result.text).toBe(`alpha ${textColorOpenTag('red')}beta</span>`);
    expect(result.selection).toEqual({
      from: `alpha ${textColorOpenTag('red')}`.length,
      to: `alpha ${textColorOpenTag('red')}beta`.length,
    });
  });

  it('replaces an existing color without nesting text-color spans',
  /**
 * テスト「replaces an existing color without nesting text-color spans」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
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

  it('clears only the selected text color and preserves surrounding colors',
  /**
 * テスト「clears only the selected text color and preserves surrounding colors」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
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

  it('clears text color together with other inline formatting for the text-format clear command',
  /**
 * テスト「clears text color together with other inline formatting for the text-format clear command」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
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

  it('splits a multi-line selection so no color span crosses a newline',
  /**
 * テスト「splits a multi-line selection so no color span crosses a newline」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const result = applyTextColorFormatting('one\ntwo\nthree', { from: 0, to: 13 }, 'green');

    expect(result.text).toBe(
      `${textColorOpenTag('green')}one</span>\n` +
        `${textColorOpenTag('green')}two</span>\n` +
        `${textColorOpenTag('green')}three</span>`,
    );
    expect(result.text).not.toMatch(/<span[^>]*>[^<]*\n/);
  });

  it('colors third-level and deeper nested list items without treating them as indented code',
  /**
 * テスト「colors third-level and deeper nested list items without treating them as indented code」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
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

  it('preserves Markdown block structure across headings, lists, tables and fences',
  /**
 * テスト「preserves Markdown block structure across headings, lists, tables and fences」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
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

  it('reports a single color or mixed state for ribbon selection',
  /**
 * テスト「reports a single color or mixed state for ribbon selection」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const red = `${textColorOpenTag('red')}red</span>`;
    expect(detectTextColorFormatting(red, { from: 0, to: red.length })).toBe('red');

    const mixed = `${textColorOpenTag('red')}red</span> ${textColorOpenTag('blue')}blue</span>`;
    expect(detectTextColorFormatting(mixed, { from: 0, to: mixed.length })).toBe('mixed');
  });

  it('does not rewrite literal MVE markup in unselected code',
  /**
 * テスト「does not rewrite literal MVE markup in unselected code」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const literal = textColorOpenTag('red') + 'literal</span>';
    const source = 'outside\n    ' + literal + '\ntarget';
    const from = source.lastIndexOf('target');
    const result = applyTextColorFormatting(
      source,
      { from, to: from + 'target'.length },
      'blue',
    ).text;

    expect(result).toBe(
      'outside\n    ' + literal + '\n' + textColorOpenTag('blue') + 'target</span>',
    );
  });

  it('keeps code fenced inside block quotes unchanged',
  /**
 * テスト「keeps code fenced inside block quotes unchanged」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const fence = String.fromCharCode(96).repeat(3);
    const source = '> ' + fence + 'js\n> const value = 1;\n> ' + fence;
    const result = applyTextColorFormatting(
      source,
      { from: 0, to: source.length },
      'red',
    ).text;

    expect(result).toBe(source);
    expect(renderMarkdownUnsafe(result, {
      remoteImagesEnabled: true,
      language: 'en',
    })).toContain('<pre><code class="hljs language-js">const value = 1;');
  });

  it('colors link labels without breaking their Markdown syntax',
  /**
 * テスト「colors link labels without breaking their Markdown syntax」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const source = '[label](https://example.com)';
    const result = applyTextColorFormatting(
      source,
      { from: 0, to: source.length },
      'red',
    ).text;

    expect(result).toBe(
      '[' + textColorOpenTag('red') + 'label</span>](https://example.com)',
    );
    expect(renderMarkdownUnsafe(result, {
      remoteImagesEnabled: true,
      language: 'en',
    })).toContain('<a href="https://example.com"><span');
  });

  it('preserves nested and escaped Markdown link syntax',
  /**
 * テスト「preserves nested and escaped Markdown link syntax」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const source = [
      '[label](https://example.com/foo_(bar))',
      '![alt](https://example.com/a_(b).png)',
      '[a [nested] label](https://x.test)',
      '[foo\\]bar](https://example.com)',
    ].join('\n');
    const result = applyTextColorFormatting(source, { from: 0, to: source.length }, 'red').text;
    const rendered = renderMarkdownUnsafe(result, {
      remoteImagesEnabled: true,
      language: 'en',
    });

    expect(result).toContain('https://example.com/foo_(bar))');
    expect(result).toContain('https://example.com/a_(b).png)');
    expect(rendered).toContain('href="https://example.com/foo_(bar)"');
    expect(rendered).toContain('src="https://example.com/a_(b).png"');
    expect(rendered).toContain('href="https://x.test"');
    expect(rendered).toContain('href="https://example.com"');
  });

  it('preserves reference definitions inside block quotes',
  /**
 * テスト「preserves reference definitions inside block quotes」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const source = '> [foo][ref]\n>\n> [ref]: https://example.com/x';
    const result = applyTextColorFormatting(source, { from: 0, to: source.length }, 'green').text;

    expect(result).toContain('> [ref]: https://example.com/x');
    expect(renderMarkdownUnsafe(result, {
      remoteImagesEnabled: true,
      language: 'en',
    })).toContain('href="https://example.com/x"');
  });

  it('preserves multiline Markdown links, images, and inline code',
  /**
 * テスト「preserves multiline Markdown links, images, and inline code」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const literal = '`' + textColorOpenTag('red') + '\nA</span>`';
    const codeSource = literal + '\ntarget';
    const target = codeSource.indexOf('target');
    const codeResult = applyTextColorFormatting(codeSource, { from: target, to: target + 6 }, 'blue').text;
    const source = [
      '[label](',
      'https://example.com/foo_(bar)',
      ')',
      '![alt](',
      'https://example.com/a_(b).png',
      ')',
      '[a',
      'b](https://x.test)',
    ].join('\n');
    const result = applyTextColorFormatting(source, { from: 0, to: source.length }, 'red').text;
    const rendered = renderMarkdownUnsafe(result, {
      remoteImagesEnabled: true,
      language: 'en',
    });

    expect(codeResult).toBe(literal + '\n' + textColorOpenTag('blue') + 'target</span>');
    expect(rendered).toContain('href="https://example.com/foo_(bar)"');
    expect(rendered).toContain('src="https://example.com/a_(b).png"');
    expect(rendered).toContain('href="https://x.test"');
  });

  it('keeps heading IDs, outline labels, and word statistics semantic',
  /**
 * テスト「keeps heading IDs, outline labels, and word statistics semantic」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const source = '# Heading {#custom}\n\n[Jump](#custom)\n\nhello';
    const result = applyTextColorFormatting(
      source,
      { from: 0, to: source.length },
      'purple',
    ).text;
    const rendered = renderMarkdownUnsafe(result, {
      remoteImagesEnabled: true,
      language: 'en',
    });

    expect(getOutline(result)).toMatchObject([{ text: 'Heading', id: 'custom' }]);
    expect(rendered).toContain('<h1 id="custom">');
    expect(rendered).toContain('href="#custom"');
    expect(wordStats(applyTextColorFormatting('hello', { from: 0, to: 5 }, 'red').text).text).toBe(5);
  });

  it('preserves explicit heading IDs before and after applying text color',
  /**
 * テスト「preserves explicit heading IDs before and after applying text color」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const source = '# Heading {#custom}';
    const colored = applyTextColorFormatting(source, { from: 0, to: source.length }, 'purple').text;
    const duplicate = '# First {#same}\n# Second {#same}';

    expect(getOutline(source)).toMatchObject([{ id: 'custom' }]);
    expect(getOutline(colored)).toMatchObject([{ id: 'custom' }]);
    expect(renderMarkdownUnsafe(colored, {
      remoteImagesEnabled: true,
      language: 'en',
    })).toContain('<h1 id="custom">');
    expect(collectDiagnostics(duplicate, 'en')).toContainEqual(expect.objectContaining({
      code: 'duplicate-heading',
      line: 2,
    }));
  });

  it('does not interpret literal MVE spans in inline code as text color markup',
  /**
 * テスト「does not interpret literal MVE spans in inline code as text color markup」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const literal = '`' + textColorOpenTag('red') + 'A</span>`';
    const source = '# ' + literal;
    const outline = getOutline(source)[0];
    const rendered = renderMarkdownUnsafe(source, {
      remoteImagesEnabled: true,
      language: 'en',
    });
    const table = '| ' + literal + ' | B |\n| --- | --- |\n| x | y |';
    const aligned = applyMarkdownTableAction(
      table,
      { from: table.indexOf('B'), to: table.indexOf('B') },
      'alignColumns',
    )?.text;

    expect(outline.text).not.toBe('A');
    expect(outline.id).not.toBe('a');
    expect(rendered).toContain('<h1 id="' + outline.id + '">');
    expect(wordStats(literal).text).toBeGreaterThan(1);
    expect(aligned).toMatch(/\| --- {20,}\|/);
  });

  it('handles deeply nested text-color spans without a quadratic slowdown',
  /**
 * テスト「handles deeply nested text-color spans without a quadratic slowdown」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const depth = 20_000;
    const source = Array.from({ length: depth },
    /**
 * テスト「handles deeply nested text-color spans without a quadratic slowdown」の前提条件を設定し、期待結果を検証するコールバックです。
     * @returns 配列要素または初期値を返します。
     */
    () => textColorOpenTag('red') + 'x').join('') + '</span>'.repeat(depth);
    const startedAt = Date.now();
    const applied = applyTextColorFormatting(source, { from: 0, to: source.length }, 'blue');
    const detected = detectTextColorFormatting(applied.text, { from: 0, to: applied.text.length });

    expect(applied.text).toBe(textColorOpenTag('blue') + 'x'.repeat(depth) + '</span>');
    expect(detected).toBe('blue');
    expect(Date.now() - startedAt).toBeLessThan(1_500);
  });

  it('handles incomplete HTML and link-like text without a quadratic slowdown',
  /**
 * テスト「handles incomplete HTML and link-like text without a quadratic slowdown」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const source = '<span'.repeat(16_000) + '['.repeat(40_000) + '[^'.repeat(20_000);
    const startedAt = Date.now();
    const applied = applyTextColorFormatting(source, { from: 0, to: source.length }, 'green');
    const detected = detectTextColorFormatting(source, { from: 0, to: source.length });

    expect(applied.text).toContain(textColorOpenTag('green'));
    expect(detected).toBeUndefined();
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it('handles many protected multiline ranges without a quadratic slowdown',
  /**
 * テスト「handles many protected multiline ranges without a quadratic slowdown」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const source = Array.from(
      { length: 24_000 },

      /**
 * テスト「handles many protected multiline ranges without a quadratic slowdown」の前提条件を設定し、期待結果を検証するコールバックです。
       * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
       * @param index 本文、表、配列内の対象位置を示すインデックスです。
       * @returns 配列要素または初期値を返します。
       */
      (_, index) => '[label ' + index + '](https://example.com/' + index + ')',
    ).join('\n');
    const startedAt = Date.now();
    const applied = applyTextColorFormatting(source, { from: 0, to: source.length }, 'red');
    const detected = detectTextColorFormatting(applied.text, { from: 0, to: applied.text.length });

    expect(detected).toBe('red');
    expect(Date.now() - startedAt).toBeLessThan(1_500);
  });

  it('uses visible text width when aligning a colored table cell',
  /**
 * テスト「uses visible text width when aligning a colored table cell」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const source = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const cell = source.indexOf('A');
    const colored = applyTextColorFormatting(
      source,
      { from: cell, to: cell + 1 },
      'red',
    ).text;
    const aligned = applyMarkdownTableAction(
      colored,
      { from: colored.indexOf('A'), to: colored.indexOf('A') },
      'alignColumns',
    )?.text;

    expect(aligned).toContain(textColorOpenTag('red') + 'A</span>   |');
    expect(aligned?.length).toBeLessThan(colored.length + 30);
  });

  it('keeps fixed text-color markup through Markdown rendering and HTML export preparation',
  /**
 * テスト「keeps fixed text-color markup through Markdown rendering and HTML export preparation」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
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

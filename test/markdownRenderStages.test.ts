/**
 * @file markdownRenderStages.test.ts
 * 実行境界: テスト実行環境。
 * 責務: 現行実装の仕様と回帰条件を検証する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テスト用のモック、ブラウザー、ファイルを必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { describe, expect, it } from 'vitest';
import { highlightCode } from '../src/webview/codeHighlighter';
import { renderMarkdownUnsafeBlocks } from '../src/webview/markdownRendererCore';

/** 「options」は、呼び出し先へ渡す設定値の集合です。 */
const options = { remoteImagesEnabled: false, language: 'ja' as const };

/**
 * 「codeBodies」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param html 解析・編集・変換の対象となる本文または生成済み内容です。
 * @returns 「codeBodies」が生成または変換したMarkdownの文字列を返します。
 */
function codeBodies(html: string): string[] {
  return Array.from(html.matchAll(/<pre><code\b[^>]*>([\s\S]*?)<\/code><\/pre>/g),
  /**
 * 「match」を受け取り、入力文字列を置換して変換する処理です。
   * @param match matchとして渡される、このコールバックの入力値です。
   * @returns 置換後の文字列を返します。
   */
  (match) => match[1]);
}

/**
 * マークアップを解除または削除します。
 * @param value 「removeHighlightMarkup」で検証・変換する入力値です。
 * @returns 「removeHighlightMarkup」が生成または変換したMarkdownの文字列を返します。
 */
function removeHighlightMarkup(value: string): string {
  return value.replace(/<\/?span\b[^>]*>/g, '');
}

describe('staged Markdown rendering',
/**
 * テスト「staged Markdown rendering」の前提条件を設定し、期待結果を検証するコールバックです。
 * @returns テストの前提条件と期待結果を検証し、値を返しません。
 */
() => {
  it('keeps code text and document structure identical between preliminary and rich rendering',
  /**
 * テスト「keeps code text and document structure identical between preliminary and rich rendering」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
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
    const preliminaryHtml = preliminary.map(
    /**
 * 「block」を変換し、変換後の要素を返すコールバックです。
     * @param block blockとして渡される、このコールバックの入力値です。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (block) => block.html).join('');
    const richHtml = rich.map(
    /**
 * 「block」を変換し、変換後の要素を返すコールバックです。
     * @param block blockとして渡される、このコールバックの入力値です。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (block) => block.html).join('');

    expect(rich).toHaveLength(preliminary.length);
    expect(codeBodies(richHtml).map(removeHighlightMarkup)).toEqual(codeBodies(preliminaryHtml));
    expect(richHtml).toContain('class="hljs-keyword">const</span>');
    expect(preliminaryHtml).not.toContain('class="hljs-keyword"');
    expect(richHtml).toContain('&lt;tag&gt;&amp; value');
    expect(richHtml).toContain('class="diagram-block mermaid"');
  });

  it('falls back to escaped plain code for unsupported explicit languages',
  /**
 * テスト「falls back to escaped plain code for unsupported explicit languages」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const markdown = '```not-a-real-language\n<script>& value\n```';
    const richHtml = renderMarkdownUnsafeBlocks(markdown, options, highlightCode)
      .map(
      /**
 * 「block」を変換し、変換後の要素を返すコールバックです。
       * @param block blockとして渡される、このコールバックの入力値です。
       * @returns 入力要素から生成した変換後の値を返します。
       */
      (block) => block.html)
      .join('');

    expect(richHtml).toContain('&lt;script&gt;&amp; value');
    expect(richHtml).not.toMatch(/<code[^>]*>\s*<span/);
  });
});

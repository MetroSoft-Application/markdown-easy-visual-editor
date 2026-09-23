/**
 * @file resource-link.test.ts
 * 実行境界: テスト実行環境。
 * 責務: 現行実装の仕様と回帰条件を検証する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テスト用のモック、ブラウザー、ファイルを必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { describe, expect, it } from 'vitest';
import { classifyResourceLink, resolveWebviewResourcePath } from '../src/extension/resourceLink';

describe('Webview resource links',
/**
 * テスト「Webview resource links」の前提条件を設定し、期待結果を検証するコールバックです。
 * @returns テストの前提条件と期待結果を検証し、値を返しません。
 */
() => {
  it('converts a local Webview URL to a local path',
  /**
 * テスト「converts a local Webview URL to a local path」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(resolveWebviewResourcePath(
      'https://file+.vscode-resource.vscode-cdn.net/e%3A/source/markdown-easy-visual-editor/guide.md'
    )).toBe('e:/source/markdown-easy-visual-editor/guide.md');
  });

  it('does not classify an ordinary HTTPS URL as a local resource',
  /**
 * テスト「does not classify an ordinary HTTPS URL as a local resource」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(resolveWebviewResourcePath('https://example.com/guide.md')).toBeUndefined();
  });

  it('routes an ordinary HTTPS URL to the browser',
  /**
 * テスト「routes an ordinary HTTPS URL to the browser」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(classifyResourceLink('https://example.com/guide.md')).toEqual({
      kind: 'external',
      href: 'https://example.com/guide.md'
    });
  });

  it('routes a relative local link to VS Code',
  /**
 * テスト「routes a relative local link to VS Code」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(classifyResourceLink('guide.md#section')).toEqual({
      kind: 'relative',
      href: 'guide.md#section'
    });
  });

  it('routes a Webview local URL to VS Code instead of the browser',
  /**
 * テスト「routes a Webview local URL to VS Code instead of the browser」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(classifyResourceLink(
      'https://file+.vscode-resource.vscode-cdn.net/e%3A/source/guide.md'
    )).toEqual({
      kind: 'localWebview',
      path: 'e:/source/guide.md'
    });
  });

  it('decodes spaces and ignores a Webview URL fragment',
  /**
 * テスト「decodes spaces and ignores a Webview URL fragment」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(resolveWebviewResourcePath(
      'https://file+.vscode-resource.vscode-cdn.net/e%3A/source/my%20guide.md?view=preview#section'
    )).toBe('e:/source/my guide.md');
  });

  it('routes file URIs and Windows absolute paths to VS Code',
  /**
 * テスト「routes file URIs and Windows absolute paths to VS Code」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(classifyResourceLink('file:///E:/source/guide.md')).toEqual({
      kind: 'absoluteFile',
      href: 'file:///E:/source/guide.md'
    });
    expect(classifyResourceLink('E:/source/guide.md')).toEqual({
      kind: 'absoluteFile',
      href: 'E:/source/guide.md'
    });
    expect(classifyResourceLink('E:\\source\\guide.md')).toEqual({
      kind: 'absoluteFile',
      href: 'E:\\source\\guide.md'
    });
  });

  it('rejects malformed local resource URLs',
  /**
 * テスト「rejects malformed local resource URLs」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(resolveWebviewResourcePath(
      'https://file+.vscode-resource.vscode-cdn.net/e%ZZ/source/guide.md'
    )).toBeUndefined();
    expect(classifyResourceLink(
      'https://file+.vscode-resource.vscode-cdn.net/e%ZZ/source/guide.md'
    )).toEqual({ kind: 'invalidLocalWebview' });
  });
});

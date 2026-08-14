import { describe, expect, it } from 'vitest';
import { classifyResourceLink, resolveWebviewResourcePath } from '../src/extension/resourceLink';

describe('Webview resource links', () => {
  it('converts a local Webview URL to a local path', () => {
    expect(resolveWebviewResourcePath(
      'https://file+.vscode-resource.vscode-cdn.net/e%3A/source/markdown-easy-visual-editor/guide.md'
    )).toBe('e:/source/markdown-easy-visual-editor/guide.md');
  });

  it('does not classify an ordinary HTTPS URL as a local resource', () => {
    expect(resolveWebviewResourcePath('https://example.com/guide.md')).toBeUndefined();
  });

  it('routes an ordinary HTTPS URL to the browser', () => {
    expect(classifyResourceLink('https://example.com/guide.md')).toEqual({
      kind: 'external',
      href: 'https://example.com/guide.md'
    });
  });

  it('routes a relative local link to VS Code', () => {
    expect(classifyResourceLink('guide.md#section')).toEqual({
      kind: 'relative',
      href: 'guide.md#section'
    });
  });

  it('routes a Webview local URL to VS Code instead of the browser', () => {
    expect(classifyResourceLink(
      'https://file+.vscode-resource.vscode-cdn.net/e%3A/source/guide.md'
    )).toEqual({
      kind: 'localWebview',
      path: 'e:/source/guide.md'
    });
  });

  it('decodes spaces and ignores a Webview URL fragment', () => {
    expect(resolveWebviewResourcePath(
      'https://file+.vscode-resource.vscode-cdn.net/e%3A/source/my%20guide.md?view=preview#section'
    )).toBe('e:/source/my guide.md');
  });

  it('routes file URIs and Windows absolute paths to VS Code', () => {
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

  it('rejects malformed local resource URLs', () => {
    expect(resolveWebviewResourcePath(
      'https://file+.vscode-resource.vscode-cdn.net/e%ZZ/source/guide.md'
    )).toBeUndefined();
    expect(classifyResourceLink(
      'https://file+.vscode-resource.vscode-cdn.net/e%ZZ/source/guide.md'
    )).toEqual({ kind: 'invalidLocalWebview' });
  });
});

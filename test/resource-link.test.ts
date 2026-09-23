/**
 * @fileoverview リソース・link・テストの回帰の仕様と回帰条件を検証する。失敗時は期待値と実装差分を示す。
 */
import { describe, expect, it } from 'vitest';
import { classifyResourceLink, resolveWebviewResourcePath } from '../src/extension/resourceLink';

describe('Webview resource links',
    /**
     * 「Webview resource links」の仕様と回帰条件を検証するテストケース。
     * @returns テストケースを実行し、値は返さない。
     */
    () => {
        it('converts a local Webview URL to a local path',
            /**
             * 「converts a local Webview URL to a local path」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(resolveWebviewResourcePath(
                    'https://file+.vscode-resource.vscode-cdn.net/e%3A/source/markdown-easy-visual-editor/guide.md'
                )).toBe('e:/source/markdown-easy-visual-editor/guide.md');
            });

        it('does not classify an ordinary HTTPS URL as a local resource',
            /**
             * 「does not classify an ordinary HTTPS URL as a local resource」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(resolveWebviewResourcePath('https://example.com/guide.md')).toBeUndefined();
            });

        it('routes an ordinary HTTPS URL to the browser',
            /**
             * 「routes an ordinary HTTPS URL to the browser」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(classifyResourceLink('https://example.com/guide.md')).toEqual({
                    kind: 'external',
                    href: 'https://example.com/guide.md'
                });
            });

        it('routes a relative local link to VS Code',
            /**
             * 「routes a relative local link to VS Code」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(classifyResourceLink('guide.md#section')).toEqual({
                    kind: 'relative',
                    href: 'guide.md#section'
                });
            });

        it('routes a Webview local URL to VS Code instead of the browser',
            /**
             * 「routes a Webview local URL to VS Code instead of the browser」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
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
             * 「decodes spaces and ignores a Webview URL fragment」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(resolveWebviewResourcePath(
                    'https://file+.vscode-resource.vscode-cdn.net/e%3A/source/my%20guide.md?view=preview#section'
                )).toBe('e:/source/my guide.md');
            });

        it('routes file URIs and Windows absolute paths to VS Code',
            /**
             * 「routes file URIs and Windows absolute paths to VS Code」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
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
             * 「rejects malformed local resource URLs」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
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

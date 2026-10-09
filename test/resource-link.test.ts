/**
 * @fileoverview Webview URL、相対リンク、file URI、Windows絶対パスの振り分けとルート外拒否を検証する。
 */
import { describe, expect, it } from 'vitest';
import { classifyResourceLink, resolveWebviewResourcePath, workspaceRootPathSegments } from '../src/extension/resourceLink';
import { collectLocalResourceReferences } from '../src/shared/markdown';

describe('Webview resource links',
    () => {
        it('converts a local Webview URL to a local path',
            () => {
                expect(resolveWebviewResourcePath(
                    'https://file+.vscode-resource.vscode-cdn.net/e%3A/source/markdown-easy-visual-editor/guide.md'
                )).toBe('e:/source/markdown-easy-visual-editor/guide.md');
            });

        it('does not classify an ordinary HTTPS URL as a local resource',
            () => {
                expect(resolveWebviewResourcePath('https://example.com/guide.md')).toBeUndefined();
            });

        it('routes an ordinary HTTPS URL to the browser',
            () => {
                expect(classifyResourceLink('https://example.com/guide.md')).toEqual({
                    kind: 'external',
                    href: 'https://example.com/guide.md'
                });
            });

        it('routes a relative local link to VS Code',
            () => {
                expect(classifyResourceLink('guide.md#section')).toEqual({
                    kind: 'relative',
                    href: 'guide.md#section'
                });
            });

        it('resolves a single-slash path from the workspace root and rejects root escapes', () => {
            expect(workspaceRootPathSegments('/guides/setup.md')).toEqual(['guides', 'setup.md']);
            expect(workspaceRootPathSegments('/guides/../setup.md')).toEqual(['setup.md']);
            expect(workspaceRootPathSegments('/../../outside.md')).toBeUndefined();
            expect(workspaceRootPathSegments('//server/share.md')).toBeUndefined();
            expect(workspaceRootPathSegments('/E:/docs/setup.md')).toBeUndefined();
        });

        it('recognizes workspace-rooted links with inline and reference-style title quoting', () => {
            const inline = collectLocalResourceReferences(
                "[Display](/guides/a.md#id 'MVE workspace-root link')"
            );
            const reference = collectLocalResourceReferences(
                '[Display][x]\n\n[x]: /guides/a.md#id "MVE workspace-root link"'
            );
            const multilineTitles = [
                '"MVE workspace-root link"',
                ' "MVE workspace-root link"',
                '   "MVE workspace-root link"',
                '    "MVE workspace-root link"',
                '\t"MVE workspace-root link"'
            ];
            const multilineReferences = multilineTitles.map((title) => collectLocalResourceReferences(
                `[Display][x]\n\n[x]: /guides/a.md#id\n${title}`
            ));
            const quotedReference = collectLocalResourceReferences(
                '> [Display][x]\n>\n> [x]: /guides/a.md#id\n>  "MVE workspace-root link"'
            );
            const escapedMarkerReference = collectLocalResourceReferences(
                '[Display][x]\n\n[x]: /guides/a.md#id "MVE workspace\\-root link"'
            );

            expect(inline).toEqual([expect.objectContaining({
                kind: 'link',
                source: '/guides/a.md#id',
                workspaceRooted: true
            })]);
            expect(reference).toEqual([expect.objectContaining({
                kind: 'link',
                source: '/guides/a.md#id',
                workspaceRooted: true
            })]);
            for (const references of [...multilineReferences, quotedReference, escapedMarkerReference]) {
                expect(references).toEqual([expect.objectContaining({
                    kind: 'link',
                    source: '/guides/a.md#id',
                    workspaceRooted: true
                })]);
            }
        });

        it('keeps local references with escaped quotes in their title', () => {
            const escapedTitle = String.raw`"see \"this\""`;
            const references = collectLocalResourceReferences(
                `[Display][x]

[x]: guides/a.md#id ${escapedTitle}`
            );

            expect(references).toEqual([expect.objectContaining({
                kind: 'link',
                source: 'guides/a.md#id'
            })]);
        });

        it('routes a Webview local URL to VS Code instead of the browser',
            () => {
                expect(classifyResourceLink(
                    'https://file+.vscode-resource.vscode-cdn.net/e%3A/source/guide.md'
                )).toEqual({
                    kind: 'localWebview',
                    path: 'e:/source/guide.md'
                });
            });

        it('decodes spaces and ignores a Webview URL fragment',
            () => {
                expect(resolveWebviewResourcePath(
                    'https://file+.vscode-resource.vscode-cdn.net/e%3A/source/my%20guide.md?view=preview#section'
                )).toBe('e:/source/my guide.md');
            });

        it('routes file URIs and Windows absolute paths to VS Code',
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
            () => {
                expect(resolveWebviewResourcePath(
                    'https://file+.vscode-resource.vscode-cdn.net/e%ZZ/source/guide.md'
                )).toBeUndefined();
                expect(classifyResourceLink(
                    'https://file+.vscode-resource.vscode-cdn.net/e%ZZ/source/guide.md'
                )).toEqual({ kind: 'invalidLocalWebview' });
            });
    });

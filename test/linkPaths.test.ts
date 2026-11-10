/**
 * @fileoverview リンク先パスの補完文脈判定と、ファイル移動時のリンク書き換え計算を検証する（shared 層・Node 実行）。
 * 回帰リスク: 補完がコードやURLで誤って起動すること、書き換えで記法（./、山括弧、エンコード、#・?）や改行コードが崩れること、
 * コードブロック内やHTMLコメント内のリンクを書き換えてしまうこと。
 */
import { describe, expect, it } from 'vitest';
import {
    composeRenameMappings,
    createRenameMapper,
    detectLinkCompletionContext,
    encodeLinkPath,
    relativePosixPath,
    rewriteLinkDestination
} from '../src/shared/linkPaths';
import { collectLocalLinkDestinations, encodeMarkdownLinkFragment, sectionMarkdownLink } from '../src/shared/markdown';
import { errorMessage } from '../src/shared/errorMessage';

describe('detectLinkCompletionContext', () => {
    /** インラインリンク・画像・参照定義・HTML属性でパス入力を検出する。 */
    it('detects path completion in inline links, images, definitions and HTML attributes', () => {
        expect(detectLinkCompletionContext('see [docs](gu')).toEqual({ kind: 'path', from: 11, query: 'gu' });
        expect(detectLinkCompletionContext('![alt](')).toEqual({ kind: 'path', from: 7, query: '' });
        expect(detectLinkCompletionContext('[ref]: ./img')).toEqual({ kind: 'path', from: 7, query: './img' });
        expect(detectLinkCompletionContext('> [ref]: a')).toEqual({ kind: 'path', from: 9, query: 'a' });
        expect(detectLinkCompletionContext('<img src="as')).toEqual({ kind: 'path', from: 10, query: 'as' });
        expect(detectLinkCompletionContext("<a class='x' href='d")).toEqual({ kind: 'path', from: 19, query: 'd' });
        expect(detectLinkCompletionContext('[a](<my fi')).toEqual({ kind: 'path', from: 5, query: 'my fi' });
    });

    /** `#` の後ろは見出しアンカーとして扱い、前のパスを返す。 */
    it('detects anchor completion for the same document and other documents', () => {
        expect(detectLinkCompletionContext('[a](#')).toEqual({ kind: 'anchor', from: 5, path: '', query: '' });
        expect(detectLinkCompletionContext('[a](guide.md#set')).toEqual({ kind: 'anchor', from: 13, path: 'guide.md', query: 'set' });
    });

    /** URL、脚注、通常の文章、リンク先の入力完了後では起動しない。 */
    it('ignores URLs, footnotes and non-link text', () => {
        expect(detectLinkCompletionContext('[a](https://exa')).toBeUndefined();
        expect(detectLinkCompletionContext('[a](mailto:x')).toBeUndefined();
        expect(detectLinkCompletionContext('[a](//cdn')).toBeUndefined();
        expect(detectLinkCompletionContext('[^1]: note')).toBeUndefined();
        expect(detectLinkCompletionContext('plain (text')).toBeUndefined();
        expect(detectLinkCompletionContext('[a](b.md) more')).toBeUndefined();
        expect(detectLinkCompletionContext('[a](b.md "title')).toBeUndefined();
    });
});

describe('relativePosixPath and encodeLinkPath', () => {
    /** 兄弟・子・親フォルダーへの相対パスと、Windows のドライブ表記を扱う。 */
    it('computes relative paths', () => {
        expect(relativePosixPath('/w/docs', '/w/docs/a.md')).toBe('a.md');
        expect(relativePosixPath('/w/docs', '/w/img/x.png')).toBe('../img/x.png');
        expect(relativePosixPath('/w', '/w/docs/sub/a.md')).toBe('docs/sub/a.md');
        expect(relativePosixPath('/e:/W/Docs', '/e:/w/docs/a.md', true)).toBe('a.md');
        expect(relativePosixPath('/e:/W/Docs', '/e:/w/docs/a.md', false)).toBe('../../w/docs/a.md');
    });

    /** 方式ごとに、リンク構文を壊す文字だけ・URI全体・山括弧向けにエンコードする。 */
    it('encodes path segments by style', () => {
        expect(encodeLinkPath('../my dir/日本 (1).md')).toBe('../my%20dir/日本%20%281%29.md');
        expect(encodeLinkPath('../my dir/日本.md', 'uri')).toBe('../my%20dir/%E6%97%A5%E6%9C%AC.md');
        expect(encodeLinkPath('my dir/a<b>.md', 'raw')).toBe('my dir/a%3Cb%3E.md');
    });
});

describe('rewriteLinkDestination', () => {
    const location = { documentOldPath: '/w/docs/readme.md', documentNewPath: '/w/docs/readme.md', workspaceRootPath: '/w' };

    /** 移動したファイルへのリンクを、#・? と ./ を保って書き換える。 */
    it('rewrites links to a moved file and keeps suffixes and ./ prefix', () => {
        const map = createRenameMapper([{ oldPath: '/w/docs/guide.md', newPath: '/w/manual/setup guide.md' }]);
        const rewrite = (destination: string, angleBracketed = false) =>
            rewriteLinkDestination({ destination, angleBracketed, workspaceRooted: false }, location, map);
        expect(rewrite('guide.md')).toBe('../manual/setup%20guide.md');
        expect(rewrite('./guide.md#install')).toBe('../manual/setup%20guide.md#install');
        expect(rewrite('guide.md?raw=1#x')).toBe('../manual/setup%20guide.md?raw=1#x');
        expect(rewrite('guide.md', true)).toBe('../manual/setup guide.md');
        expect(rewrite('other.md')).toBeUndefined();
        expect(rewrite('#local')).toBeUndefined();
        expect(rewrite('https://example.com/guide.md')).toBeUndefined();
        expect(rewrite('/abs/guide.md')).toBeUndefined();
    });

    /** 同じフォルダー内の移動では ./ を保ち、百分率エンコードされた日本語は同じ方式で書く。 */
    it('preserves the original encoding style', () => {
        const map = createRenameMapper([{ oldPath: '/w/docs/日本.md', newPath: '/w/docs/日本語.md' }]);
        const rewrite = (destination: string) =>
            rewriteLinkDestination({ destination, angleBracketed: false, workspaceRooted: false }, location, map);
        expect(rewrite('./日本.md')).toBe('./日本語.md');
        expect(rewrite('%E6%97%A5%E6%9C%AC.md')).toBe('%E6%97%A5%E6%9C%AC%E8%AA%9E.md');
    });

    /** フォルダーの移動では、その配下を指すリンクをすべて写像する。 */
    it('maps links into a moved folder', () => {
        const map = createRenameMapper([{ oldPath: '/w/docs/assets', newPath: '/w/media' }]);
        const rewrite = (destination: string) =>
            rewriteLinkDestination({ destination, angleBracketed: false, workspaceRooted: false }, location, map);
        expect(rewrite('assets/readme/a.png')).toBe('../media/readme/a.png');
        expect(rewrite('assets/')).toBe('../media/');
        expect(rewrite('assetsx/a.png')).toBeUndefined();
    });

    /** 文書自体が移動した場合、移動していない対象への相対パスを新しい位置から計算し直す。 */
    it('recomputes relative links when the linking document moves', () => {
        const moved = { ...location, documentNewPath: '/w/archive/2026/readme.md' };
        const map = createRenameMapper([{ oldPath: '/w/docs/readme.md', newPath: '/w/archive/2026/readme.md' }]);
        const rewrite = (destination: string, workspaceRooted = false) =>
            rewriteLinkDestination({ destination, angleBracketed: false, workspaceRooted }, moved, map);
        expect(rewrite('../img/a.png')).toBe('../../img/a.png');
        // 自分自身へのリンクは、移動後も同じファイル名なので変更しない。
        expect(rewrite('readme.md#top')).toBeUndefined();
        expect(rewrite('/docs/guide.md', true)).toBeUndefined();
    });

    /** ワークスペース基準リンクは、移動先をワークスペースルートからのパスで書き直す。 */
    it('rewrites workspace-rooted links', () => {
        const map = createRenameMapper([{ oldPath: '/w/docs/guide.md', newPath: '/w/manual/guide.md' }]);
        expect(rewriteLinkDestination(
            { destination: '/docs/guide.md#setup', angleBracketed: false, workspaceRooted: true },
            location,
            map
        )).toBe('/manual/guide.md#setup');
        expect(rewriteLinkDestination(
            { destination: '/docs/guide.md', angleBracketed: false, workspaceRooted: true },
            { ...location, workspaceRootPath: undefined },
            map
        )).toBeUndefined();
    });

    /** 大文字小文字を区別しない環境では、表記の違うリンクも同じファイルとして扱う。 */
    it('matches case-insensitively when requested', () => {
        const map = createRenameMapper([{ oldPath: '/e:/w/docs/Guide.md', newPath: '/e:/w/docs/setup.md' }], true);
        expect(rewriteLinkDestination(
            { destination: 'guide.md', angleBracketed: false, workspaceRooted: false },
            { documentOldPath: '/e:/w/docs/readme.md', documentNewPath: '/e:/w/docs/readme.md', ignoreCase: true },
            map
        )).toBe('setup.md');
    });
});

describe('rewriteLinkDestination edge cases', () => {
    const location = { documentOldPath: '/w/docs/readme.md', documentNewPath: '/w/docs/readme.md', workspaceRootPath: '/w' };

    /** 移動した文書でも、新しい位置から同じ先を指す表記は正規化しない。 */
    it('keeps equivalent spellings when the document moves to a sibling folder', () => {
        const moved = { ...location, documentNewPath: '/w/notes/readme.md' };
        const map = composeRenameMappings([[{ oldPath: '/w/docs/readme.md', newPath: '/w/notes/readme.md' }]]).toNew;
        const rewrite = (destination: string) =>
            rewriteLinkDestination({ destination, angleBracketed: false, workspaceRooted: false }, moved, map);
        expect(rewrite('../img/a.png')).toBeUndefined();
        expect(rewrite('./x/../../img/a.png')).toBeUndefined();
        expect(rewrite(String.raw`..\img\a.png`)).toBeUndefined();
    });

    /** 括弧をエスケープしたリンクと、日本語名への移動を扱う。 */
    it('handles escaped parentheses and non-ASCII destinations', () => {
        const map = composeRenameMappings([[{ oldPath: '/w/docs/a (1).md', newPath: '/w/docs/資料 (2).md' }]]).toNew;
        expect(rewriteLinkDestination({ destination: String.raw`a%20\(1\).md`, angleBracketed: false, workspaceRooted: false }, location, map))
            .toBe('資料%20%282%29.md');
    });

    /** 連続した移動を合成し、逆方向にも戻せる。 */
    it('composes sequential moves', () => {
        const mapping = composeRenameMappings([
            [{ oldPath: '/w/a.md', newPath: '/w/b.md' }],
            [{ oldPath: '/w/b.md', newPath: '/w/docs/c.md' }]
        ]);
        expect(mapping.toNew('/w/a.md')).toBe('/w/docs/c.md');
        expect(mapping.toOld('/w/docs/c.md')).toBe('/w/a.md');
        expect(mapping.toNew('/w/other.md')).toBeUndefined();
    });
});

describe('collectLocalLinkDestinations syntax coverage', () => {
    /** 参照定義（山括弧・タイトル付き）と、引用符なしの HTML 属性の範囲を返す。 */
    it('covers reference definitions and unquoted attributes', () => {
        const markdown = [
            '[r]: <docs/my file.md> "T"',
            '![i][r]',
            '<img src=pic.png alt=x>',
            String.raw`[p](a\(1\).md)`
        ].join('\n');
        expect(collectLocalLinkDestinations(markdown).map((item) => markdown.slice(item.start, item.end))).toEqual([
            'docs/my file.md',
            'pic.png',
            String.raw`a\(1\).md`
        ]);
    });
});

describe('collectLocalLinkDestinations', () => {
    /** インライン・画像・参照定義・HTML属性の参照先範囲を、CRLFの本文でも正しく返す。 */
    it('returns exact destination ranges with CRLF line endings', () => {
        const markdown = [
            '# Title',
            'See [guide](guide.md#setup "t") and ![img](<assets/my img.png>).',
            '[ref]: ./ref.md',
            '<img src="a.png"> <a href=\'b.md\'>b</a>',
            '[remote](https://example.com/x.md)'
        ].join('\r\n');
        const destinations = collectLocalLinkDestinations(markdown);
        expect(destinations.map((item) => markdown.slice(item.start, item.end))).toEqual([
            'guide.md#setup',
            'assets/my img.png',
            './ref.md',
            'a.png',
            'b.md'
        ]);
        expect(destinations.map((item) => item.destination)).toEqual(
            destinations.map((item) => markdown.slice(item.start, item.end)));
        expect(destinations[1]).toMatchObject({ kind: 'image', angleBracketed: true });
    });

    /** コードブロック、インラインコード、HTMLコメントの中のリンクは対象外にする。 */
    it('skips code and comments', () => {
        const markdown = [
            '```md',
            '[a](fenced.md)',
            '```',
            'Inline `[b](inline.md)` text',
            '<!-- [c](comment.md) -->',
            '    [d](indented.md)',
            '[e](real.md)'
        ].join('\n');
        expect(collectLocalLinkDestinations(markdown).map((item) => item.destination)).toEqual(['real.md']);
    });

    /** ワークスペース基準の印を持つリンクを区別する。 */
    it('marks workspace-rooted links', () => {
        const markdown = '[Setup](/guides/setup.md#setup "MVE workspace-root link")';
        expect(collectLocalLinkDestinations(markdown)).toEqual([
            expect.objectContaining({ destination: '/guides/setup.md#setup', workspaceRooted: true })
        ]);
    });
});

describe('encodeMarkdownLinkFragment', () => {
    /** セクションリンクのコピーと同じエンコードを使う。 */
    it('matches the section link fragment encoding', () => {
        expect(encodeMarkdownLinkFragment('a b(c)')).toBe('a%20b%28c%29');
        expect(sectionMarkdownLink('A', 'a b(c)')).toBe('[A](#a%20b%28c%29)');
        expect(encodeMarkdownLinkFragment('日本語')).toBe('日本語');
    });
});

describe('errorMessage', () => {
    /** Error・文字列・文字列化できない値のいずれでも例外を投げずに説明文を返す。 */
    it('converts any thrown value without throwing', () => {
        expect(errorMessage(new Error('boom'))).toBe('boom');
        expect(errorMessage('text')).toBe('text');
        expect(errorMessage(Object.create(null))).toBe('[object Object]');
    });
});

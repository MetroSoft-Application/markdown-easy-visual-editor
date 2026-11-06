/**
 * @fileoverview 本文エディターのリンク判定（Ctrl+クリックとツールチップの対象）を回帰検証する。
 *
 * 実行境界はtest（CodeMirrorの状態と構文木だけを使い、DOMは使わない）。
 * インライン・画像・入れ子・参照・自動リンク・HTML属性・素のURL・ワークスペース基準の印を開ける一方、
 * コードの中やリンク外の位置を誤ってリンクとして扱わないことを確認する。
 */
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { findEditorLinkAt } from '../src/webview/editor/cmLinkNavigation';
import { WORKSPACE_SECTION_LINK_TITLE } from '../src/shared/markdown';

/**
 * Markdown言語を有効にし、構文木の解析を終えたCodeMirror状態を作る。
 * @param doc - テスト対象のMarkdown。
 * @returns 構文木を保持する状態。
 */
function createState(doc: string): EditorState {
    const state = EditorState.create({ doc, extensions: [markdown()] });
    if (!ensureSyntaxTree(state, state.doc.length, 1_000)) {
        throw new Error('The CodeMirror Markdown syntax tree did not finish parsing.');
    }
    return state;
}

/**
 * 指定した文字列の先頭文字の位置にあるリンク先を返す。
 * @param doc - テスト対象のMarkdown。
 * @param marker - 位置を指定する文字列（最初の出現位置を使う）。
 * @param offset - markerの先頭からのずれ。
 * @returns リンク先。リンクでなければundefined。
 */
function hrefAt(doc: string, marker: string, offset = 0): string | undefined {
    const index = doc.indexOf(marker);
    if (index < 0) throw new Error(`marker not found: ${marker}`);
    return findEditorLinkAt(createState(doc), index + offset)?.href;
}

describe('findEditorLinkAt', () => {
    /** リンクのテキスト部分でもURL部分でも、インラインリンクのリンク先を返す。 */
    it('opens inline links from both the text and the destination', () => {
        const doc = 'see [docs](other.md#second) end';
        expect(hrefAt(doc, 'docs')).toBe('other.md#second');
        expect(hrefAt(doc, 'other.md')).toBe('other.md#second');
        expect(hrefAt(doc, '[docs]')).toBe('other.md#second');
        expect(hrefAt(doc, ')', 0)).toBe('other.md#second');
        expect(hrefAt(doc, ' end')).toBeUndefined();
        expect(hrefAt(doc, 'see')).toBeUndefined();
    });

    /** 画像を囲むリンクは、画像部分では画像、外側ではリンク先を開く（draw.io の図を直接開ける）。 */
    it('prefers the innermost image inside a linked image', () => {
        const doc = '[![draw.io](images/a.drawio.svg)](images/b.drawio.svg)';
        expect(hrefAt(doc, 'images/a')).toBe('images/a.drawio.svg');
        expect(hrefAt(doc, 'images/b')).toBe('images/b.drawio.svg');
    });

    /** 山括弧付きのリンク先と自動リンクは山括弧を除く。 */
    it('strips angle brackets from destinations and autolinks', () => {
        expect(hrefAt('[a](<my file.md>)', 'a')).toBe('my file.md');
        expect(hrefAt('go <https://example.com/x> now', 'example')).toBe('https://example.com/x');
    });

    /** 参照リンクは定義を探してリンク先にする（完全・省略・ショートカットの3形式と、大文字小文字の違い）。 */
    it('resolves reference links through their definitions', () => {
        const doc = '[full][Ref] [Ref][] [ref]\n\n[ref]: target.md "Title"\n';
        expect(hrefAt(doc, 'full')).toBe('target.md');
        expect(hrefAt(doc, '[Ref][]', 1)).toBe('target.md');
        expect(hrefAt(doc, ' [ref]', 2)).toBe('target.md');
        expect(hrefAt(doc, '[ref]:', 1)).toBe('target.md');
        expect(hrefAt('[missing][none]\n', 'missing')).toBeUndefined();
    });

    /** ワークスペース基準リンクの印（タイトル）を引き継ぎ、Hostで同じ解決規則を使えるようにする。 */
    it('marks workspace-rooted section links', () => {
        const doc = `[sec](/guides/a.md#x "${WORKSPACE_SECTION_LINK_TITLE}") [plain](/guides/a.md "other")`;
        const state = createState(doc);
        expect(findEditorLinkAt(state, doc.indexOf('sec'))?.workspaceRooted).toBe(true);
        expect(findEditorLinkAt(state, doc.indexOf('plain'))?.workspaceRooted).toBe(false);
    });

    /** HTMLのhref・src属性値は開けるが、属性名や複数URLを持つsrcsetは対象外にする。 */
    it('opens HTML href and src attribute values only', () => {
        const doc = '<a href="page.md">x</a> <img src="pic.png" srcset="a.png 1x, b.png 2x">\n';
        expect(hrefAt(doc, 'page.md')).toBe('page.md');
        expect(hrefAt(doc, 'pic.png')).toBe('pic.png');
        expect(hrefAt(doc, 'href')).toBeUndefined();
        expect(hrefAt(doc, 'a.png 1x')).toBeUndefined();
    });

    /** 本文中の素のURLは、GFMと同じく文末の句読点・強調記号・対応しない閉じ括弧を含めずに開く。 */
    it('opens bare URLs with GFM-like trailing punctuation rules', () => {
        const doc = 'visit https://example.com/path. (see https://example.org/x)';
        const state = createState(doc);
        const first = findEditorLinkAt(state, doc.indexOf('example.com'));
        expect(first?.href).toBe('https://example.com/path');
        expect(findEditorLinkAt(state, doc.indexOf('path.') + 'path'.length)).toBeUndefined();
        expect(hrefAt(doc, 'example.org')).toBe('https://example.org/x');
        expect(hrefAt('see https://en.wikipedia.org/wiki/Foo_(bar) now', 'wikipedia')).toBe('https://en.wikipedia.org/wiki/Foo_(bar)');
        expect(hrefAt('**https://x.com/a** bold', 'x.com')).toBe('https://x.com/a');
    });

    /** メールアドレスの自動リンクは、プレビューと同じくmailto:として開く（ローカルファイルとして開かない）。 */
    it('opens e-mail autolinks as mailto links', () => {
        expect(hrefAt('mail <foo@bar.com> me', 'foo')).toBe('mailto:foo@bar.com');
        expect(hrefAt('mail <mailto:foo@bar.com> me', 'foo')).toBe('mailto:foo@bar.com');
    });

    /** 脚注参照と脚注定義はプレビューで脚注になるため、リンクとして扱わない。 */
    it('does not treat footnotes as links', () => {
        const doc = 'text[^1] more\n\n[^1]: Note.\n';
        expect(hrefAt(doc, '[^1] more', 1)).toBeUndefined();
        expect(hrefAt(doc, '[^1]: Note', 1)).toBeUndefined();
        expect(hrefAt(doc, 'Note.')).toBeUndefined();
    });

    /** 大きな文書でも、文末の参照定義を解決できる（背景解析が文末まで進んでいない状態から）。 */
    it('resolves reference definitions at the end of a large document', () => {
        // 背景解析が先読みする100,000文字を超える約144KBの文書にする。
        const doc = `[top][far]\n\n${'filler paragraph text.\n\n'.repeat(6_000)}[far]: far.md\n`;
        const state = EditorState.create({ doc, extensions: [markdown()] });
        // エディターの表示範囲だけ解析済みで、文末の定義はまだ解析されていない状態を再現する。
        ensureSyntaxTree(state, 1_000, 1_000);
        expect(findEditorLinkAt(state, 1)?.href).toBe('far.md');
    });

    /** Markdown文書の中のTextile記法も、プレビューのレンダラーと同じ規則でリンクとして開く。 */
    it('opens Textile links inside Markdown documents', () => {
        const doc = 'see "guide":other.md. and !pic.png!https://example.com/x here\n';
        expect(hrefAt(doc, 'guide')).toBe('other.md');
        expect(hrefAt(doc, 'other.md')).toBe('other.md');
        expect(hrefAt(doc, 'pic.png')).toBe('pic.png');
        expect(hrefAt(doc, 'example.com')).toBe('https://example.com/x');
    });

    /** Textile単独の文書はtextile-jsでリンクになる記法だけを開き、Markdown記法と素のURLは開かない。 */
    it('follows textile-js rules in Textile documents', () => {
        const doc = 'a "guide":other.textile. b ["box":box.textile] c !pic.png(alt)!:target.textile d [md](x.md) https://example.com @"code":c.textile@\n';
        const state = createState(doc);
        const at = (marker: string, offset = 0) => findEditorLinkAt(state, doc.indexOf(marker) + offset, 'textile')?.href;
        expect(at('guide')).toBe('other.textile');
        expect(at('box"')).toBe('box.textile');
        expect(at('pic.png')).toBe('pic.png');
        expect(at('(alt)')).toBe('target.textile');
        expect(at('md]')).toBeUndefined();
        expect(at('example.com')).toBeUndefined();
        expect(at('code')).toBeUndefined();
    });

    /** インラインコードとコードブロックの中のリンク記法やURLは開かない。 */
    it('ignores links inside code', () => {
        const doc = 'a `[x](inline.md)` b\n\n```\n[y](block.md) https://example.com\n```\n';
        expect(hrefAt(doc, 'inline.md')).toBeUndefined();
        expect(hrefAt(doc, 'block.md')).toBeUndefined();
        expect(hrefAt(doc, 'example.com')).toBeUndefined();
    });

    /** 範囲外の位置や空文書でも例外を出さない。 */
    it('returns undefined for out-of-range positions', () => {
        const state = createState('[a](b)');
        expect(findEditorLinkAt(state, -1)).toBeUndefined();
        expect(findEditorLinkAt(state, state.doc.length)).toBeUndefined();
        expect(findEditorLinkAt(createState(''), 0)).toBeUndefined();
    });
});

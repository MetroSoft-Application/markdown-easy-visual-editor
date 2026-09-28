/**
 * @fileoverview Markdown本文内HTMLのURL属性ハイライトについて構文認識と走査範囲を回帰検証する。
 */
import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
    findHtmlUrlAttributeRanges,
    type HtmlUrlAttributeRange
} from '../src/webview/cmHtmlUrlHighlight';

/**
 * Markdown言語を有効にしたCodeMirror状態を作る。
 * @param doc - テスト対象Markdown。
 * @returns 構文木を保持するCodeMirror状態。
 */
function createState(doc: string): EditorState {
    return EditorState.create({
        doc,
        extensions: [markdown()]
    });
}

/**
 * 抽出範囲を属性名と実際の属性値へ変換する。
 * @param state - テスト対象CodeMirror状態。
 * @param ranges - URL属性として抽出された範囲。
 * @returns 比較しやすい属性名・値一覧。
 */
function values(
    state: EditorState,
    ranges: HtmlUrlAttributeRange[]
): Array<{ attribute: string; value: string }> {
    return ranges.map(
        /**
         * @param range - URL属性値の範囲。
         * @returns 属性名と文書上の実値。
         */
        (range) => ({
            attribute: range.attribute,
            value: state.doc.sliceString(range.from, range.to)
        })
    );
}

describe('findHtmlUrlAttributeRanges',
    /**
     * HTML URL属性の抽出仕様を検証する。
     * @returns テストケースを実行し、値は返さない。
     */
    () => {
        it('highlights common image and link URL attributes without quotes',
            /**
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const state = createState(
                    '<img src="./images/photo.png" alt="photo" width="800">\n'
                    + '<a href="docs/readme.md">Read</a>'
                );
                expect(values(state, findHtmlUrlAttributeRanges(state))).toEqual([
                    { attribute: 'src', value: './images/photo.png' },
                    { attribute: 'href', value: 'docs/readme.md' }
                ]);
            });

        it('supports srcset, poster and unquoted URL attributes',
            /**
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const state = createState(
                    '<source srcset="small.png 1x, large.png 2x">\n'
                    + '<video poster=cover.jpg src=movie.mp4></video>'
                );
                expect(values(state, findHtmlUrlAttributeRanges(state))).toEqual([
                    { attribute: 'srcset', value: 'small.png 1x, large.png 2x' },
                    { attribute: 'poster', value: 'cover.jpg' },
                    { attribute: 'src', value: 'movie.mp4' }
                ]);
            });

        it('matches URL attribute names case-insensitively',
            /**
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const state = createState('<IMG SRC="./upper.png">');
                expect(values(state, findHtmlUrlAttributeRanges(state))).toEqual([
                    { attribute: 'src', value: './upper.png' }
                ]);
            });

        it('ignores ordinary HTML attributes and Markdown link syntax',
            /**
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const state = createState(
                    '<img alt="photo" width="800" class="hero">\n'
                    + '![markdown image](./images/photo.png)\n'
                    + '[markdown link](docs/readme.md)'
                );
                expect(findHtmlUrlAttributeRanges(state)).toEqual([]);
            });

        it('does not treat HTML-looking text inside code fences as HTML attributes',
            /**
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const state = createState(
                    '```text\n'
                    + '<img src="./not-html.png">\n'
                    + '<a href="./not-html.md">not html</a>\n'
                    + '```'
                );
                expect(findHtmlUrlAttributeRanges(state)).toEqual([]);
            });

        it('restricts traversal and decoration candidates to the requested range',
            /**
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const doc = '<img src="first.png">\n<a href="second.md">Second</a>';
                const state = createState(doc);
                const firstLineEnd = doc.indexOf('\n');
                expect(values(
                    state,
                    findHtmlUrlAttributeRanges(state, 0, firstLineEnd)
                )).toEqual([
                    { attribute: 'src', value: 'first.png' }
                ]);
            });
    });

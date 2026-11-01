/**
 * @fileoverview プレビューのコードハイライト色が、CLIのHTML/PDF出力と同じ明るい背景用の配色になることを検証する。
 * ダークテーマでも白い用紙で描くPDFプレビューに暗い背景用の色が残ると、#f5f5f5上で読めなくなる回帰を防ぐ。
 * 同じ配色は5か所に定義されているため、値の食い違いをここで一括して検出する。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** 明るい背景で同じ色を使うべきhighlight.jsのクラス。 */
const HLJS_CLASSES = ['keyword', 'selector-tag', 'literal', 'string', 'attr', 'title', 'section', 'comment', 'number'];

/** 拡張のプレビュー用CSS。 */
const previewCss = readFileSync('src/webview/editor/editorThemePolish.css', 'utf8');
/** PDFプレビュー描画用のPRINT_CSSを含むHostのソース。 */
const pdfSource = readFileSync('src/extension/pdf.ts', 'utf8');
/** CLIのHTML出力スタイルを含むソース。 */
const htmlSource = readFileSync('cli/src/html.ts', 'utf8');
/** CLIのPDF出力スタイル。 */
const printCss = readFileSync('cli/src/styles/print-assets.css', 'utf8');

/**
 * コメントを除いたCSSから、セレクターと宣言の組を列挙する。
 * 直前の@importやTypeScriptの文がセレクターへ混ざらないよう、最後の`;`より後だけをセレクターとして扱う。
 * @param css - 対象のCSS文字列。
 * @returns セレクター一覧と宣言本文の組。
 */
function rules(css: string): { selectors: string[]; body: string }[] {
    return [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
        selectors: match[1].slice(match[1].lastIndexOf(';') + 1).split(',').map((selector) => selector.trim()),
        body: match[2],
    }));
}

/**
 * 指定したセレクターを含む規則の色を返す。
 * @param css - 対象のCSS文字列。
 * @param selector - 完全一致で探すセレクター。
 * @returns 小文字の色値。見つからない場合はundefined。
 */
function colorFor(css: string, selector: string): string | undefined {
    const rule = rules(css).find((item) => item.selectors.includes(selector));
    return /(?:^|[;\s])color:\s*(#[0-9a-f]{3,8})/i.exec(rule?.body ?? '')?.[1].toLowerCase();
}

/** 明るい背景用ハイライト色の定義箇所ごとに、CLIのHTML出力の値と一致することを検証する。 */
describe('preview code highlight colors', () => {
    for (const name of HLJS_CLASSES) {
        /** HTML出力の値を基準に、PDF出力・PDFプレビュー描画・ライブ表示・ライトテーマの各定義を照合する。 */
        it(`uses the CLI output color for .hljs-${name} in every light-background definition`, () => {
            const html = colorFor(htmlSource, `.mve-html .hljs-${name}`);
            expect(html).toBeDefined();
            expect(colorFor(printCss, `.hljs-${name}:not(.marpit *)`)).toBe(html);
            expect(colorFor(pdfSource, `.mve-print .hljs-${name}:not(.marpit *)`)).toBe(html);
            expect(colorFor(previewCss, `body[data-editor-theme] .pdf-preview-live-content .rendered-markdown .hljs-${name}`)).toBe(html);
            expect(colorFor(previewCss, `body[data-editor-theme="light"] .rendered-markdown .hljs-${name}`)).toBe(html);
        });
    }
});

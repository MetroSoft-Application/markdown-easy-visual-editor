/**
 * @fileoverview ソースエディターのシンタックス色が、各テーマの背景に対して読めるコントラストを保つことを検証する。
 * ダークテーマに暗い背景向けでない色(型名の#155e4fなど)が残り、型名やプロパティ定義が背景に沈む回帰を防ぐ。
 * 判定はWCAG 2.xの通常文字の基準4.5:1を、本文背景と入力中の行の背景に適用する。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** テーマ変数を定義するエディターのCSS。 */
const themeCss = readFileSync('src/webview/editor/editorTheme.css', 'utf8');

/** WCAG 2.xで通常サイズの文字に求められる最小コントラスト比。 */
const MIN_CONTRAST = 4.5;

/**
 * 指定したテーマの変数定義ブロックから、CSS変数名と16進色の組を取り出す。
 * @param theme - `data-editor-theme`の値。
 * @returns 変数名をキー、小文字の6桁16進色を値とする表。ブロックが見つからない場合や、
 *   読み取れない書式の--mve-syntax-*宣言がある場合は例外。
 */
function themeVariables(theme: 'light' | 'dark'): Map<string, string> {
    const header = `body[data-editor-theme="${theme}"] {`;
    const start = themeCss.indexOf(header);
    if (start < 0) throw new Error(`theme block not found: ${theme}`);
    const body = themeCss.slice(start + header.length, themeCss.indexOf('}', start));
    const variables = new Map([...body.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((match) => [match[1], match[2].toLowerCase()]));
    // 6桁16進以外(3桁、rgb()、var()など)で書かれたシンタックス色を黙って検査対象から外さないよう、宣言数と照合する。
    const declared = body.match(/--mve-syntax-[\w-]+\s*:/g) ?? [];
    const parsed = [...variables.keys()].filter((name) => name.startsWith('--mve-syntax-'));
    if (declared.length !== parsed.length) throw new Error(`unparsed --mve-syntax-* declarations in ${theme} theme`);
    return variables;
}

/** 文字が載る背景の変数。本文、入力中の行のテーマ上書き、CodeMirrorが現在行に使うVS Code変数を含む。 */
const BACKGROUND_VARIABLES = ['--mve-theme-bg', '--mve-theme-surface-alt', '--vscode-editor-lineHighlightBackground'];

/**
 * 16進色の相対輝度をWCAG 2.xの式で求める。
 * @param hex - `#rrggbb`形式の色。
 * @returns 0から1の相対輝度。
 */
function luminance(hex: string): number {
    const [r, g, b] = [1, 3, 5].map((offset) => {
        const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 2色のコントラスト比を求める。
 * @param foreground - 文字色。
 * @param background - 背景色。
 * @returns 1以上21以下のコントラスト比。
 */
function contrast(foreground: string, background: string): number {
    const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (light + 0.05) / (dark + 0.05);
}

/** ライト・ダークの両テーマで、すべてのシンタックス色を本文背景と入力中の行の背景に対して検査する。 */
describe('source editor syntax colors', () => {
    for (const theme of ['light', 'dark'] as const) {
        /** テーマ内の--mve-syntax-*がいずれも基準のコントラストを満たすことを確認する。 */
        it(`keep readable contrast in the ${theme} theme`, () => {
            const variables = themeVariables(theme);
            const backgrounds = BACKGROUND_VARIABLES.map((name) => variables.get(name));
            // 背景が取れないとコントラストがNaNになり、比較が常に偽で素通りするため、先に定義を確認する。
            expect(backgrounds).not.toContain(undefined);
            const syntax = [...variables].filter(([name]) => name.startsWith('--mve-syntax-'));
            expect(syntax.length).toBeGreaterThan(0);
            const failures = syntax.flatMap(([name, color]) => (backgrounds as string[])
                .filter((background) => contrast(color, background) < MIN_CONTRAST)
                .map((background) => `${name} ${color} on ${background}: ${contrast(color, background).toFixed(2)}`));
            expect(failures).toEqual([]);
        });
    }
});

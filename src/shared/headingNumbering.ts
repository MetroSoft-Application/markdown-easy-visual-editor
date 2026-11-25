/**
 * @fileoverview 見出しの自動番号付けの設定値を正規化し、番号を描くCSSを生成する（Webview / Extension Host 共通）。
 * 番号はCSSカウンターと`::before`で描くため、Markdown原文・見出しのid・リンク先アンカーを変えない。
 * 対象は描画結果の最上位ブロック（`.markdown-source-block`）の直下にある見出しだけで、引用・リスト・表の中の見出しと、
 * 文書先頭のfront matterが描く見出しには番号を付けない。プレビュー・印刷プレビュー・PDF・HTMLで同じCSSを使い、番号を一致させる。
 */

/**
 * 見出し番号の付け方。`off`は番号なし、`h1`はH1から「1.」「1.1」…、`h2`はH1を表題として番号を付けずH2から番号を付ける。
 */
export type HeadingNumberingMode = 'off' | 'h1' | 'h2';

/** 設定値として受け付ける番号付けモードの一覧。package.json の enum と同じ順序・値を保つ。 */
export const HEADING_NUMBERING_MODES: readonly HeadingNumberingMode[] = ['off', 'h1', 'h2'];

/** 未設定・不正値のときに使う番号付けモード。既存文書の表示を変えないよう番号なしにする。 */
export const DEFAULT_HEADING_NUMBERING_MODE: HeadingNumberingMode = 'off';

/**
 * 設定・メッセージから受け取った値を番号付けモードへ正規化する。
 * @param value - VS Code設定、Webviewメッセージ、出力要求の値。旧形式では存在しない。
 * @returns 既知の値ならその値、undefined・未知の文字列・文字列以外なら`off`。
 */
export function normalizeHeadingNumberingMode(value: unknown): HeadingNumberingMode {
    return HEADING_NUMBERING_MODES.includes(value as HeadingNumberingMode)
        ? value as HeadingNumberingMode
        : DEFAULT_HEADING_NUMBERING_MODE;
}

/** CSSカウンター名の接頭辞。利用者のCSSや他機能のカウンターと衝突しないよう拡張固有の名前にする。 */
const COUNTER_PREFIX = 'mve-heading-number-';

/**
 * 見出しに番号を付けるCSSを生成する。
 * カウンターは`rootSelector`でまとめて初期化し、見出しでは`counter-set`で下位のカウンターだけを0へ戻す。
 * `counter-reset`を見出しへ置くと、見出しを包むブロックの外へカウンターの有効範囲が届かず、次のブロックで番号が1から数え直されるため使わない。
 * @param mode - 番号付けモード。`off`なら空文字列を返す。
 * @param rootSelector - カウンターを初期化する要素のセレクター。プレビューは`.rendered-markdown`、印刷・出力は`body`。
 * @returns 番号を描くCSS。上位の番号は「1.」、下位は「1.1」の形で、本文との間に空白を1つ置く。
 */
export function headingNumberingCss(mode: HeadingNumberingMode, rootSelector: string): string {
    if (mode === 'off') return '';
    const levels = mode === 'h1' ? [1, 2, 3, 4, 5, 6] : [2, 3, 4, 5, 6];
    /**
     * 番号を付ける階層の位置からカウンター名を返す。
     * @param index - `levels`内の位置。0が最上位の番号。
     * @returns 見出しレベルを含むカウンター名。
     */
    const counter = (index: number): string => `${COUNTER_PREFIX}${levels[index]}`;
    /**
     * 番号を付ける見出しのセレクターを返す。最上位ブロックの直下だけに限り、引用やリスト内の見出しを除く。
     * @param level - 見出しレベル1〜6。
     * @returns ルート要素から見出しまでのセレクター。
     */
    const heading = (level: number): string => `${rootSelector} .markdown-source-block > h${level}`;
    const resets: string[] = [];
    for (let index = 0; index < levels.length; index += 1) resets.push(`${counter(index)} 0`);
    const rules: string[] = [`${rootSelector}{counter-reset:${resets.join(' ')}}`];
    for (let index = 0; index < levels.length; index += 1) {
        const lower: string[] = [];
        for (let next = index + 1; next < levels.length; next += 1) lower.push(`${counter(next)} 0`);
        rules.push(`${heading(levels[index])}{counter-increment:${counter(index)}${lower.length ? `;counter-set:${lower.join(' ')}` : ''}}`);
        const parts: string[] = [];
        for (let part = 0; part <= index; part += 1) parts.push(`counter(${counter(part)})`);
        // 上位の見出しは「1.」、下位は「1.1」とし、どちらも番号と本文の間に空白を1つ置く。
        const content = index === 0 ? `${parts[0]} ". "` : `${parts.join(' "." ')} " "`;
        rules.push(`${heading(levels[index])}::before{content:${content}}`);
    }
    // front matterは先頭の`---`だけのブロックと、その改行の直後（オフセット4）から始まる見出しとして描かれる。本文の見出しではないため番号を数えない。
    // 水平線の後に空行を挟んで始まる本文の見出し（オフセット5以降）は対象外とし、通常どおり番号を付ける。
    const frontMatter = `${rootSelector} .markdown-source-block[data-source-from="0"]:has(> hr:only-child) + .markdown-source-block[data-source-from="4"] > :is(h1, h2)`;
    rules.push(`${frontMatter}{counter-increment:none;counter-set:none}`, `${frontMatter}::before{content:none}`);
    return rules.join('\n');
}

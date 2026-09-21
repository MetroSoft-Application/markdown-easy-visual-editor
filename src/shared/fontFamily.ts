/**
 * フォントファミリー設定をCSSへ安全に渡すための共通処理。
 * フォント名が未インストールでも指定できるため、候補一覧とは独立して扱う。
 */

export interface FontFamilySettings {
    editorFontFamily: string;
    previewFontFamily: string;
}

/** 既存のPDF・印刷表示で使用していた標準フォントフォールバック。 */
export const DEFAULT_FONT_FAMILY_STACK = '"Noto Sans JP", "Yu Gothic UI", sans-serif';

export const DEFAULT_FONT_FAMILY_SETTINGS: FontFamilySettings = {
    editorFontFamily: '',
    previewFontFamily: ''
};

/** ユーザー入力や永続化値をCSS宣言へ安全に渡せる値へ正規化する。 */
export function normalizeFontFamily(value: unknown): string {
    if (typeof value !== 'string') return '';
    if (/[\u0000-\u001f\u007f{};<>\x60]/.test(value)) return '';
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length <= 512 ? normalized : '';
}

/** CSS変数または出力用CSSへ設定するフォントファミリー値を返す。 */
export function fontFamilyForCss(value: unknown, fallback: string): string {
    const normalizedValue = normalizeFontFamily(value);
    const normalizedFallback = normalizeFontFamily(fallback);
    if (!normalizedValue) return normalizedFallback;
    if (!normalizedFallback) return normalizedValue;

    const valueKey = normalizedValue.toLocaleLowerCase();
    const fallbackKey = normalizedFallback.toLocaleLowerCase();
    if (valueKey === fallbackKey || valueKey.endsWith(`, ${fallbackKey}`)) {
        return normalizedValue;
    }
    return `${normalizedValue}, ${normalizedFallback}`;
}

/** 永続化されたフォント設定を読み取り、未指定値を空文字へそろえる。 */
export function normalizeFontFamilySettings(value: unknown): FontFamilySettings | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const candidate = value as Partial<FontFamilySettings>;
    if (!Object.prototype.hasOwnProperty.call(candidate, 'editorFontFamily') &&
        !Object.prototype.hasOwnProperty.call(candidate, 'previewFontFamily')) {
        return undefined;
    }
    return {
        editorFontFamily: normalizeFontFamily(candidate.editorFontFamily),
        previewFontFamily: normalizeFontFamily(candidate.previewFontFamily)
    };
}

/** 標準フォントを先頭へ置き、列挙結果に同じ値があれば重複を除去する。 */
export function prependDefaultFontFamily(fonts: readonly string[]): string[] {
    const defaultKey = DEFAULT_FONT_FAMILY_STACK.toLocaleLowerCase();
    return [
        DEFAULT_FONT_FAMILY_STACK,
        ...fonts.filter((font) => font.toLocaleLowerCase() !== defaultKey)
    ];
}

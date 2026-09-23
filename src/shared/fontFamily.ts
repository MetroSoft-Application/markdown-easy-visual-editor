/**
 * @fileoverview エディター、プレビュー、HTML、PDFで共有するフォント設定を正規化し、空値・不正値を既定のフォントへ戻す。
 */
/**
 * fontfamilyへ渡す設定項目と既定値のデータ形状。
 */

export interface FontFamilySettings {

    /**
     * fontfamilyで共有するフォント設定または移行状態。
     */
    editorFontFamily: string;

    /**
     * fontfamilyで共有するフォント設定または移行状態。
     */
    previewFontFamily: string;
}

/**
 * CSSへ渡す既定のフォントフォールバック列。
 */
export const DEFAULT_FONT_FAMILY_STACK = '"Noto Sans JP", "Yu Gothic UI", sans-serif';


/**
 * フォント設定が未指定のときに使う既定の入力値。
 */
export const DEFAULT_FONT_FAMILY_SETTINGS: FontFamilySettings = {
    editorFontFamily: '',
    previewFontFamily: ''
};

/**
 * フォント入力をCSSで扱える形式へ整え、空値・不正値を既定スタックへ戻す。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns fontfamilyで利用する文字列。
 */
export function normalizeFontFamily(value: unknown): string {
    if (typeof value !== 'string') return '';
    if (/[\u0000-\u001f\u007f{};<>\x60]/.test(value)) return '';
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length <= 512 ? normalized : '';
}

/**
 * fontfamilyのfont・family・for・cssを処理し、呼び出し側へ結果または副作用を返す。
 * @param value - 検証・変換・保存の対象となる値。
 * @param fallback - fontfamilyで受け渡す文字列。
 * @returns fontfamilyで利用する文字列。
 */
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

/**
 * fontfamilyの入力を許可された形式へ整える。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns 副作用を完了し、値は返さない。
 */
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

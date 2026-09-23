/**
 * @file fontFamily.ts
 * 実行境界: Extension HostとWebviewの共有層。
 * 責務: 両実行境界で共有する値、プロトコル、変換を扱う。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: 呼び出し元から渡された値を変換し、外部状態を直接変更しない。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
/**
 * フォントファミリー設定をCSSへ安全に渡すための共通処理。
 * フォント名が未インストールでも指定できるため、候補一覧とは独立して扱う。
 */

export interface FontFamilySettings {

    /**
     * 「editorFontFamily」は、表示テーマまたはスタイル設定を保持します。
     */
    editorFontFamily: string;

    /**
     * 「previewFontFamily」は、表示テーマまたはスタイル設定を保持します。
     */
    previewFontFamily: string;
}

/** 既存のPDF・印刷表示で使用していた標準フォントフォールバック。 */
export const DEFAULT_FONT_FAMILY_STACK = '"Noto Sans JP", "Yu Gothic UI", sans-serif';

/** 「DEFAULT_FONT_FAMILY_SETTINGS」は、呼び出し先へ渡す設定値の集合です。 */
/** エディターとプレビューへ初期適用するフォント設定。入力が空または不正な場合の共通フォールバックにも使う。 */
export const DEFAULT_FONT_FAMILY_SETTINGS: FontFamilySettings = {
    editorFontFamily: '',
    previewFontFamily: ''
};

/**
 * ユーザー入力や永続化値をCSS宣言へ安全に渡せる値へ正規化する。
 * @param value 「normalizeFontFamily」で検証・変換する入力値です。
 * @returns 「normalizeFontFamily」が生成または変換した関連処理の文字列を返します。
 */
export function normalizeFontFamily(value: unknown): string {
    if (typeof value !== 'string') return '';
    if (/[\u0000-\u001f\u007f{};<>\x60]/.test(value)) return '';
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length <= 512 ? normalized : '';
}

/**
 * CSS変数または出力用CSSへ設定するフォントファミリー値を返す。
 * @param value 「fontFamilyForCss」で検証・変換する入力値です。
 * @param fallback 「fallback」は、「fontFamilyForCss」が関連処理の処理対象を特定する入力です。
 * @returns 「fontFamilyForCss」が生成または変換した関連処理の文字列を返します。
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
 * 永続化されたフォント設定を読み取り、未指定値を空文字へそろえる。
 * @param value 「normalizeFontFamilySettings」で検証・変換する入力値です。
 * @returns 「normalizeFontFamilySettings」が対象を取得できない場合はundefinedを返します。
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

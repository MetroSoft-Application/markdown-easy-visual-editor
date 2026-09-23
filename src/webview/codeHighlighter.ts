/**
 * @fileoverview Webviewのcodehighlighterを管理する。Hostとの通信、ユーザー操作、表示状態の契約を保つ。
 */
import hljs from "highlight.js";

/**
 * codehighlighterの計算結果を再利用するキャッシュ。
 */
const highlightedCodeCache = new Map<string, string>();
/**
 * シンタックスハイライト結果を保持する最大件数。
 */
const MAX_HIGHLIGHTED_CODE_CACHE_ENTRIES = 96;

/**
 * codehighlighterを表示用の結果へ変換する。
 * @param text - 表示・解析・変換の対象となる本文。
 * @param language - codehighlighterの対象や分岐を識別する値。
 * @returns 副作用を完了し、値は返さない。
 */
export function highlightCode(text: string, language: string): string | undefined {
    if (language && !hljs.getLanguage(language)) return undefined;
    const key = `${language || "auto"}\u0000${text}`;
    const cached = highlightedCodeCache.get(key);
    if (cached !== undefined) {
        highlightedCodeCache.delete(key);
        highlightedCodeCache.set(key, cached);
        return cached;
    }
    const highlighted = language
        ? hljs.highlight(text, { language }).value
        : hljs.highlightAuto(text).value;
    highlightedCodeCache.set(key, highlighted);
    if (highlightedCodeCache.size > MAX_HIGHLIGHTED_CODE_CACHE_ENTRIES) {
        const oldest = highlightedCodeCache.keys().next().value as string | undefined;
        if (oldest !== undefined) highlightedCodeCache.delete(oldest);
    }
    return highlighted;
}

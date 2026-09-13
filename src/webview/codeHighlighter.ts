import hljs from "highlight.js";

const highlightedCodeCache = new Map<string, string>();
const MAX_HIGHLIGHTED_CODE_CACHE_ENTRIES = 96;

/** highlight.jsの全言語定義を使い、指定言語または自動判定でコードをHTML化する。 */
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

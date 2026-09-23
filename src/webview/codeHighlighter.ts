/**
 * @file codeHighlighter.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import hljs from "highlight.js";

/** 「highlightedCodeCache」は、再利用する結果を保持し、同じ処理の重複を抑えるキャッシュです。 */
const highlightedCodeCache = new Map<string, string>();
/** 「MAX_HIGHLIGHTED_CODE_CACHE_ENTRIES」は、入力・表示・資源の上限または下限を表す値です。 */
const MAX_HIGHLIGHTED_CODE_CACHE_ENTRIES = 96;

/**
 * highlight.jsの全言語定義を使い、指定言語または自動判定でコードをHTML化する。
 * @param text 処理対象の本文です。
 * @param language 表示文言の解決に使用する言語コードまたはロケールです。
 * @returns 「highlightCode」が生成または変換したWebview UIの文字列を返します。
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

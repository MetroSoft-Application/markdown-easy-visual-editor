/**
 * @fileoverview PDF出力直前に適用する正規表現置換ルールの検証と文字列変換を提供する。
 */
import type { PdfTextReplacementRule } from "./protocol";

/**
 * 正規表現パターンがPDF置換で利用できるか確認する。
 *
 * 空文字は未設定行として扱い、出力処理では無効とする。
 */
export function isValidPdfTextReplacementPattern(pattern: string): boolean {
  if (!pattern) return false;
  try {
    void new RegExp(pattern, "g");
    return true;
  } catch {
    return false;
  }
}

/**
 * PDF出力用テキストへ登録順に正規表現置換を適用する。
 *
 * replacementはJavaScriptの$1等として解釈せず、入力された文字列をそのまま挿入する。
 * 無効な正規表現と空パターンは、設定編集中でもPDF生成を失敗させないためスキップする。
 */
export function applyPdfTextReplacements(
  value: string,
  rules: readonly PdfTextReplacementRule[] | undefined,
): string {
  let result = value;
  for (const rule of rules ?? []) {
    if (!rule.pattern || !isValidPdfTextReplacementPattern(rule.pattern)) {
      continue;
    }
    const expression = new RegExp(rule.pattern, "g");
    result = result.replace(expression, () => rule.replacement);
  }
  return result;
}

/**
 * @fileoverview PDF出力前にMarkdownへ適用する正規表現置換ルールを検証・実行する。
 */
import type { PdfTextReplacementRule } from "./protocol";

/**
 * 1件の正規表現置換ルールで発生した検証エラー。
 */
export interface PdfTextReplacementError {
  /**
   * 設定一覧内の0始まりインデックス。
   */
  index: number;

  /**
   * RegExp生成時に得られたエラー内容。
   */
  message: string;
}

/**
 * PDF出力前置換の実行結果。
 */
export interface PdfTextReplacementResult {
  /**
   * すべての有効な置換ルールを順番に適用したMarkdown本文。
   */
  text: string;

  /**
   * 不正な正規表現またはフラグの一覧。
   */
  errors: PdfTextReplacementError[];
}

/**
 * 全件置換を保証するため、未指定ならgフラグを追加する。
 * @param flags ユーザーが指定したJavaScript RegExpフラグ。
 * @returns gを含むRegExpフラグ。
 */
function globalFlags(flags: string | undefined): string {
  const value = flags ?? "";
  return value.includes("g") ? value : `${value}g`;
}

/**
 * 1件のPDF出力前置換ルールがRegExpとして有効か検証する。
 * 空パターンは入力途中の無効化されたルールとして扱う。
 * @param rule 検証する置換ルール。
 * @returns 有効ならundefined、不正ならRegExp生成エラー。
 */
export function validatePdfTextReplacementRule(
  rule: PdfTextReplacementRule,
): string | undefined {
  if (!rule.pattern) return undefined;
  try {
    new RegExp(rule.pattern, globalFlags(rule.flags));
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * PDF出力直前のMarkdownへ置換ルールを上から順に適用する。
 *
 * 空パターンは無視する。不正なルールが1件でもある場合はerrorsへ記録し、
 * 呼び出し側が出力を中止できるようにする。各有効ルールは常に全件置換する。
 *
 * @param source 元のMarkdown本文。
 * @param rules 正規表現パターン、置換文字列、フラグの一覧。
 * @returns 置換後本文と検証エラー。
 */
export function applyPdfTextReplacements(
  source: string,
  rules: readonly PdfTextReplacementRule[] | undefined,
): PdfTextReplacementResult {
  let text = source;
  const errors: PdfTextReplacementError[] = [];

  for (const [index, rule] of (rules ?? []).entries()) {
    if (!rule.pattern) continue;
    try {
      text = text.replace(
        new RegExp(rule.pattern, globalFlags(rule.flags)),
        rule.replacement,
      );
    } catch (error) {
      errors.push({
        index,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { text, errors };
}

/**
 * @fileoverview 変換タブ（文書全体のTextile↔Markdown変換）のボタンの有効・無効規則を定義する。
 * 実行境界: Webview。React・CodeMirrorに依存しない純粋関数にして、Node環境の単体テストから直接検証できるようにする。
 */
import type { DocumentSyntax } from "../../shared/formatConversion";

/**
 * 変換ボタンの有効判定に使う表示状態。
 */
export interface ConvertButtonState {
  /** 編集操作を許可しない状態（プレビューのみ表示、読み取り専用など）。 */
  readonly readOnly: boolean;
  /** 現在の文書をTextileとして表示・編集している場合にtrue。 */
  readonly textileDocument: boolean;
}

/**
 * 変換ボタンを無効にするか判定する。
 * 本文を書き換えられない状態と、既に変換先の記法で表示している文書では無効にする。
 * @param target - ボタンの変換先の記法。
 * @param state - 現在の表示状態。
 * @returns 無効にする場合はtrue。
 */
export function isConvertButtonDisabled(
  target: DocumentSyntax,
  state: ConvertButtonState,
): boolean {
  if (state.readOnly) return true;
  return target === "textile" ? state.textileDocument : !state.textileDocument;
}

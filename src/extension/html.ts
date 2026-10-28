/**
 * @fileoverview Extension HostからCLI所有のHTML出力処理を利用する互換窓口。出力ロジックはcli/html.tsに集約する。
 */

/** HTML出力要求の型をCLI実装から再公開する。 */
export type { HtmlExportRequest } from '../../cli/html';
/** HTML出力結果の型をCLI実装から再公開する。 */
export type { HtmlExportResult } from '../../cli/html';
/** HTML出力対象文書の型をCLI実装から再公開する。 */
export type { HtmlDocument } from '../../cli/html';
/** HTML出力準備結果の型をCLI実装から再公開する。 */
export type { HtmlExportPreparation } from '../../cli/html';
/** Webviewで描画されたHTML文書の型をCLI実装から再公開する。 */
export type { HtmlRenderedDocument } from '../../cli/html';

/** HTML出力要求を保存まで実行する関数を再公開する。 */
export { exportHtml } from '../../cli/html';
/** 保存先を選択し、HTML出力対象文書を集める関数を再公開する。 */
export { prepareHtmlExport } from '../../cli/html';
/** 準備済み文書と描画結果をHTMLファイルへ書き出す関数を再公開する。 */
export { writePreparedHtml } from '../../cli/html';
/** HTMLアウトライン操作用スクリプトを再公開する。 */
export { HTML_OUTLINE_RESIZER_SCRIPT } from '../../cli/html';

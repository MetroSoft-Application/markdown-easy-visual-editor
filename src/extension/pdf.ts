/**
 * @fileoverview Extension HostからCLI所有のPDF出力処理を利用する互換窓口。出力ロジックはcli/pdf.tsに集約する。
 */

/** PDF出力要求の型をCLI実装から再公開する。 */
export type { PdfExportRequest } from '../../cli/pdf';

/** PDF出力要求を保存まで実行する関数を再公開する。 */
export { exportPdf } from '../../cli/pdf';
/** 印刷用HTMLからPDFバイト列を生成する関数を再公開する。 */
export { renderPdf } from '../../cli/pdf';
/** 共有PDFブラウザーを終了する関数を再公開する。 */
export { closePdfBrowser } from '../../cli/pdf';
/** PDF出力用ブラウザーを取得する関数を再公開する。 */
export { acquirePdfBrowser } from '../../cli/pdf';
/** PDF印刷用の単独HTMLを生成する関数を再公開する。 */
export { buildStandaloneHtml } from '../../cli/pdf';

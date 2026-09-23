/**
 * @file textColorPdf.test.ts
 * 実行境界: テスト実行環境。
 * 責務: 現行実装の仕様と回帰条件を検証する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テスト用のモック、ブラウザー、ファイルを必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode',
/**
 * テスト対象が利用するAPIまたは依存モジュールのモックを生成するコールバックです。
 * @returns 初期化したオブジェクト（Uri、file、filePath、scheme、path）を返します。
 */
() => ({
  Uri: {

    /**
     * 「file」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
     * @param filePath 「filePath」は、「file」が検証シナリオで処理する対象を特定する入力です。
     * @returns 「file」が検証シナリオの入力を処理して得た固有の結果を返します。
     */
    file: /**
 * 「file」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param filePath 「filePath」は、「file」が検証シナリオで処理する対象を特定する入力です。
 * @returns 「file」が検証シナリオの入力を処理して得た固有の結果を返します。
 */ (filePath: string) => ({ scheme: 'file', path: filePath, fsPath: filePath }),

    /**
     * 「joinPath」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
     * @param base 「base」は、「joinPath」が検証シナリオの処理対象を特定する入力です。
     * @param segments 解析済み入力を分割した要素の集合です。
     * @returns 「joinPath」が検証シナリオの入力を処理して得た固有の結果を返します。
     */
    joinPath: /**
 * 「joinPath」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param base 「base」は、「joinPath」が検証シナリオで処理する対象を特定する入力です。
 * @param segments 「segments」は、「joinPath」が検証シナリオで処理する対象を特定する入力です。
 * @returns 「joinPath」が検証シナリオの入力を処理して得た固有の結果を返します。
 */ (base: {
    /**
     * 「scheme」は、URLリソースの対応する構成要素を保持します。
     */
    scheme: string;
    /**
     * 「path」は、読み込みまたは出力対象を示すパス・URL・内容を保持します。
     */
    path: string;
    /**
     * 「fsPath」は、読み込みまたは出力対象を示すパス・URL・内容を保持します。
     */
    fsPath: string }, ...segments: string[]) => ({
      scheme: base.scheme,
      path: [base.path, ...segments].join('/'),
      fsPath: [base.fsPath, ...segments].join('/'),
    }),

    /**
     * parseを解析または復元します。
     * @param value 処理で検証・変換する入力値です。
     * @returns 「parse」が読み取りまたは正規化した結果を返します。
     */
    parse: /**
 * 「parse」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param value 「parse」で検証・変換する入力値です。
 * @returns 「parse」が読み取りまたは正規化した結果を返します。
 */ (value: string) => ({ scheme: 'file', path: value, fsPath: value }),
  },
  workspace: {
    fs: {
    /**
     * ファイルを取得または解決します。
     * @returns 「readFile」が読み取りまたは正規化した結果を返します。
     */
    readFile: /**
 * 「readFile」は、要求された状態、値、または対象を読み取ります。
 * @returns 「readFile」が読み取りまたは正規化した結果を返します。
 */ async () => new Uint8Array() },

    /**
     * get・configurationを取得または解決します。
     * @returns 「getConfiguration」が読み取りまたは正規化した結果を返します。
     */
    getConfiguration: /**
 * 「getConfiguration」は、要求された状態、値、または対象を読み取ります。
 * @returns 「getConfiguration」が読み取りまたは正規化した結果を返します。
 */ () => ({
    /**
     * getを取得または解決します。
     * @param _key 処理対象を特定する_keyの入力値です。
     * @param fallback 「fallback」は、「get」が検証シナリオの処理対象を特定する入力です。
     * @returns 「get」が読み取りまたは正規化した結果を返します。
     */
    get: /**
 * 「get」は、要求された状態、値、または対象を読み取ります。
 * @param _key 「_key」は、「get」が検証シナリオで処理する対象を特定する入力です。
 * @param fallback 「fallback」は、「get」が検証シナリオで処理する対象を特定する入力です。
 * @returns 「get」が読み取りまたは正規化した結果を返します。
 */ (_key: string, fallback: string) => fallback }),
  },
  window: {
  /**
   * 「showSaveDialog」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @returns 「showSaveDialog」が検証シナリオの入力を処理して得た固有の結果を返します。
   */
  showSaveDialog: /**
 * 「showSaveDialog」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @returns 「showSaveDialog」が検証シナリオの入力を処理して得た固有の結果を返します。
 */ async () => undefined },
// @ts-ignore Vitest supports a third virtual-module option at runtime.
}), { virtual: true });

import { buildStandaloneHtml, type PdfExportRequest } from '../src/extension/pdf';
import { textColorOpenTag } from '../src/shared/textColor';

describe('PDF text color export',
/**
 * テスト「PDF text color export」の前提条件を設定し、期待結果を検証するコールバックです。
 * @returns テストの前提条件と期待結果を検証し、値を返しません。
 */
() => {
  it('preserves the fixed inline text color in the standalone print HTML',
  /**
   * 「async」として関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  async () => {
    const body = `<p>${textColorOpenTag('orange')}PDF color</span></p>`;
    const request = {
      html: body,
      css: 'p { margin: 0; }',
      options: {
        format: 'A4',
        orientation: 'portrait',
        margins: { top: 10, right: 10, bottom: 10, left: 10 },
        header: '',
        footer: '',
        saveWithoutDialog: true,
      },
      documentUri: { scheme: 'file', path: '/document.md', fsPath: '/document.md' },
      language: 'en',
    } as unknown as PdfExportRequest;

    const html = await buildStandaloneHtml(request);

    expect(html).toContain('data-mve-text-color="orange"');
    expect(html).toContain('style="color:#e65100"');
    expect(html).toContain('PDF color');
  });
});

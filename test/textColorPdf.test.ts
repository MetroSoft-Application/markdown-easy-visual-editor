/**
 * @fileoverview textcolorpdf・テストの回帰の仕様と回帰条件を検証する。失敗時は期待値と実装差分を示す。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode',
    /**
     * 要素をjoinへ渡し、textcolorpdf・テストの回帰の結果または副作用を処理する。
     * @returns textcolorpdf・テストの回帰のコールバックが生成する結果。
     */
    () => ({
        Uri: {


            file: /**
     * textcolorpdf・テストの回帰のfileを処理し、呼び出し側へ結果または副作用を返す。
     * @param filePath - 読み書きするファイルのパス。
     * @returns textcolorpdf・テストの回帰のfileが生成する結果。
     */ (filePath: string) => ({ scheme: 'file', path: filePath, fsPath: filePath }),


            joinPath: /**
     * textcolorpdf・テストの回帰で読み書きするリソースの場所。
     */ (base: {
                /**
                 * URIのスキーム部分。
                 */
                scheme: string;
                /**
                 * 読み書きするファイルまたはリソースの場所。
                 */
                path: string;
                /**
                 * textcolorpdf・テストの回帰のfs・pathを処理し、呼び出し側へ結果または副作用を返す。
                 * @param value - 検証・変換・保存の対象となる値。
                 * @returns textcolorpdf・テストの回帰のfs・pathが生成する結果。
                 */
                fsPath: string
            }, ...segments: string[]) => ({
                scheme: base.scheme,
                path: [base.path, ...segments].join('/'),
                fsPath: [base.fsPath, ...segments].join('/'),
            }),


            parse: /**
     * textcolorpdf・テストの回帰の入力を構造化した値へ変換する。
     * @param value - 検証・変換・保存の対象となる値。
     * @returns textcolorpdf・テストの回帰で生成または変換した値。
     */ (value: string) => ({ scheme: 'file', path: value, fsPath: value }),
        },
        workspace: {
            fs: {

                readFile: /**
     * textcolorpdf・テストの回帰から必要な値またはリソースを取得する。
     * @returns textcolorpdf・テストの回帰に対応する要素の一覧。
     */ async () => new Uint8Array()
            },


            getConfiguration: /**
     * textcolorpdf・テストの回帰から必要な値またはリソースを取得する。
     * @returns textcolorpdf・テストの回帰のget・configurationが生成する結果。
     */ () => ({

                    get: /**
     * textcolorpdf・テストの回帰から必要な値またはリソースを取得する。
     * @param _key - textcolorpdf・テストの回帰の対象や分岐を識別する値。
     * @param fallback - textcolorpdf・テストの回帰で受け渡す文字列。
     * @returns textcolorpdf・テストの回帰のgetが生成する結果。
     */ (_key: string, fallback: string) => fallback
                }),
        },
        window: {

            showSaveDialog: /**
   * textcolorpdf・テストの回帰の表示または操作を開始する。
   * @returns 副作用を完了し、値は返さない。
   */ async () => undefined
        },
        // @ts-ignore Vitest supports a third virtual-module option at runtime.
    }), { virtual: true });

import { buildStandaloneHtml, type PdfExportRequest } from '../src/extension/pdf';
import { textColorOpenTag } from '../src/shared/textColor';

describe('PDF text color export',
    /**
     * 「PDF text color export」の仕様と回帰条件を検証するテストケース。
     * @returns テストケースを実行し、値は返さない。
     */
    () => {
        it('preserves the fixed inline text color in the standalone print HTML',
            /**
             * 「preserves the fixed inline text color in the standalone print HTML」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
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

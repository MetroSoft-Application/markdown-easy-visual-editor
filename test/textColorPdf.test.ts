/**
 * @fileoverview 固定色の文字色マークアップがPDF用HTMLへ保持され、外部CSSに依存しないことを検証する。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode',

    () => ({
        Uri: {


            file: /**
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
                /** URIを参照するモックのファイルシステムパス。 */
                fsPath: string
            }, ...segments: string[]) => ({
                scheme: base.scheme,
                path: [base.path, ...segments].join('/'),
                fsPath: [base.fsPath, ...segments].join('/'),
            }),


            parse: /**
     * file URI形式の入力からテスト用URIを生成する。
     * @param value - file URIのパス部へ変換する入力パス文字列。
     * @returns 入力パスを持つfile形式のテスト用URI。
     */ (value: string) => ({ scheme: 'file', path: value, fsPath: value }),
        },
        workspace: {
            fs: {

                readFile: async () => new Uint8Array()
            },


            getConfiguration: () => ({

                    get:  (_key: string, fallback: string) => fallback
                }),
        },
        window: {

            showSaveDialog: /**
   * textcolorpdf・テストの回帰の表示または操作を開始する。
   */ async () => undefined
        },
        // @ts-ignore Vitest supports a third virtual-module option at runtime.
    }), { virtual: true });

import { buildStandaloneHtml, type PdfExportRequest } from '../src/extension/pdf';
import { textColorOpenTag } from '../src/shared/textColor';

describe('PDF text color export',
    () => {
        it('preserves the fixed inline text color in the standalone print HTML',
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

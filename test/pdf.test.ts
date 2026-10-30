/**
 * @fileoverview PDFオプションの正規化、Chromiumの取得と解放、出力HTMLや画像データの処理を検証する。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * PDF・テストの回帰の状態と操作をまとめるクラス。
 */
class TestUri {

    /**
     * テスト用URIでは権限部分を使わないため常に空文字。
     */
    readonly authority = '';

    /**
     * テスト用URIではクエリ部分を使わないため常に空文字。
     */
    readonly query = '';

    /**
     * テスト用URIではフラグメント部分を使わないため常に空文字。
     */
    readonly fragment = '';

    /**
     * 指定scheme、path、filesystem pathを持つテスト用URIを初期化する。
     * @param scheme - URIのスキーム部分。
     * @param path - 読み書きするファイルまたはリソースの場所。
     * @param fsPath - テスト対象のファイルパス。
     * @returns 初期化したインスタンス。
     */
    constructor(
        readonly scheme: string,
        readonly path: string,
        readonly fsPath: string
    ) { }

    /**
     * URIの一部変更を適用した新しいテスト用URIを作る。
     * @param change - 本文上の1件の変更範囲。
     * @returns 変更を反映したURI。
     */
    with(change: {
        /**
         * 読み書きするファイルまたはリソースの場所。
         */
        path?: string
    }): TestUri {
        const nextPath = change.path ?? this.path;
        return new TestUri(this.scheme, nextPath, this.fsPath.replace(/\.[^./\\]+$/i, '.pdf'));
    }

    /**
     * VS Code URIと同じプロパティを持つJSON表現を返す。
     * @returns URIの文字列表現とパス要素。
     */
    toJSON(): object {
        return { scheme: this.scheme, path: this.path, fsPath: this.fsPath };
    }
}

// Vitestの仮想モジュール指定は型定義にないため、実行時APIを保ったまま検証する。
vi.mock('vscode',

    () => ({
        Uri: {


            file: /**
     * @param filePath - 読み書きするファイルのパス。
     * @returns PDF・テストの回帰のfileが生成する結果。
     */ (filePath: string) => new TestUri('file', filePath.replace(/\\/g, '/'), filePath),


             joinPath: (base: TestUri, ...segments: string[]) => new TestUri(
                base.scheme,
                path.posix.join(base.path, ...segments),
                path.join(base.fsPath, ...segments)
            ),


            parse: /**
     * file URI形式の入力からテスト用URIを生成する。
     * @param value - file URIへ変換するテスト用のパス文字列。
     * @returns 指定scheme、path、filesystem pathを持つテスト用URI。
     */ (value: string) => new TestUri('file', value, value.replace(/^file:\/\//i, ''))
        },
        workspace: {
            fs: {

                readFile: (uri: TestUri) => fs.readFile(uri.fsPath)
            },


            getConfiguration: () => ({

                    get:  (_key: string, fallback: string) => fallback
                })
        },
        window: {

            showSaveDialog: /**
   * PDF・テストの回帰の表示または操作を開始する。
   */ async () => undefined
        }
        // @ts-ignore Vitest supports a third virtual-module option at runtime.
    }), { virtual: true });
vi.mock('dompurify',
    /**
     * PDF出力テスト用のDOMPurifyサニタイザーを返す。
     */
    () => ({
        default: {

            sanitize: /**
 * 入力HTMLを許可された要素と属性だけに制限し、危険なMarkupを除去する。
 * @param value - サニタイズ関数のモックへ渡す文字列。モックは値をそのまま返す。
 * @returns PDF・テストの回帰のsanitizeが生成する結果。
 */ (value: string) => value
        }
    }));

import { acquirePdfBrowser, buildStandaloneHtml, closePdfBrowser, renderPdf, type PdfExportRequest } from '../src/extension/pdf';
import { normalizePdfOptions } from '../src/shared/protocol';
import { printContentCss } from '../src/shared/printContentCss';
import { renderMarkdown } from '../src/webview/markdown/markdownRenderer';
import { TABLE_WIDTH_COMPACT_PATTERN_MARKERS, TABLE_WIDTH_PATTERN_MARKERS, TABLE_WIDTH_WRAP_PATTERN_MARKERS } from './fixtures/table-width-patterns';

/**
 * PDF・テストの回帰で一時生成物または検証対象を置くディレクトリ。
 */
const temporaryDirectories: string[] = [];
/**
 * PDF・テストの回帰で扱う一覧または対応表。
 */
const temporaryServers: Server[] = [];

afterEach(
    /**
     * PDF・テストの回帰の前提条件を準備し、回帰条件を検証するテストケース。
     */
    async () => {
        await Promise.all(temporaryDirectories.splice(0).map(
            /**
             * 各directoryをrmへ渡し、変換結果を一覧化する。
             * @param directory - PDF・テストの回帰で読み書きするリソースの場所。

             */
            (directory) => fs.rm(directory, { recursive: true, force: true })));
        await Promise.all(temporaryServers.splice(0).map(
            /**
             * 各serverから閉じるを取り出して一覧化する。
             * @param server - serverの閉じるを参照する走査対象。
             * @returns 閉じるを取り出した変換結果の一覧。
             */
            (server) => new Promise<void>(
                /**
                 * 非同期処理の成功結果を待機側へ通知する。
                 * @param resolve - Promiseの成功を通知する関数。
                 */
                (resolve) => {
                    server.close(

                        () => resolve());
                    server.closeAllConnections();
                })));
    });

describe('PDF local images',
    () => {
        /**
         * 白いPDF用紙に適したライト・ダーク見出し色と、テーマ未指定時の互換動作を検証する。
         */
        it('normalizes typography settings and includes them in the standalone print HTML',
            async () => {
                expect(normalizePdfOptions({ format: 'Letter' }).format).toBe('A4');
                expect(normalizePdfOptions({ format: 'B5' }).format).toBe('B5');
                const bounded = normalizePdfOptions({ bodyFontSize: 100, lineHeight: 0, paragraphSpacing: -1 });
                expect(bounded.bodyFontSize).toBe(48);
                expect(bounded.lineHeight).toBe(0.8);
                expect(bounded.paragraphSpacing).toBe(0);

                const options = normalizePdfOptions({
                    format: 'A4',
                    orientation: 'portrait',
                    margins: { top: 10, right: 10, bottom: 10, left: 10 },
                    header: '',
                    footer: '',
                    fontFamily: '"Test Font", sans-serif',
                    bodyFontSize: 18,
                    headingFontSizes: { h1: 30, h2: 25, h3: 20, h4: 16, h5: 13, h6: 11 },
                    codeFontSize: 8,
                    lineHeight: 1.4,
                    paragraphSpacing: 10,
                    saveWithoutDialog: true,
                });
                const request = {
                    html: '<h1>見出し</h1><p>本文</p><pre><code>code</code></pre>',
                    css: '',
                    options,
                    documentUri: new TestUri('file', '/document.md', '/document.md'),
                    language: 'ja',
                } as unknown as PdfExportRequest;

                const html = await buildStandaloneHtml(request);

                expect(html).toContain('font-size: 18pt');
                expect(html).toContain('.mve-print h1 { font-size: 30pt; }');
                expect(html).toContain('.mve-print h6 { font-size: 11pt; }');
                expect(html).toContain('.mve-print pre, .mve-print code { font-size: 8pt; }');
                expect(html).toContain('line-height: 1.4');
                expect(html).toContain('.mve-print p { margin-bottom: 10pt; }');
                expect(html).toContain('<main class="mve-print"><h1>見出し</h1><p>本文</p>');
                expect(html).toContain('.mve-print :is(h1, h2, h3, h4, h5, h6) { color: #0550ae; }');
                expect(html).toContain('.mve-marp-pdf-slide:not(:last-child) { break-after: page; page-break-after: always; }');
                expect(html).toContain('.mve-marp-pdf-slide .marpit > svg { display: block; width: 100% !important; height: auto !important; max-width: 100%; max-height: 100vh; }');
                expect(html).toContain('font-family: "Test Font", sans-serif, "Noto Sans JP", "Yu Gothic UI", sans-serif;');

                const lightHtml = await buildStandaloneHtml({ ...request, editorTheme: 'light' });
                expect(lightHtml).toContain('<main class="mve-print"><h1>見出し</h1><p>本文</p>');
                expect(lightHtml).toContain('.mve-print :is(h1, h2, h3, h4, h5, h6) { color: #0969da; }');
            });

        /** PDF出力で小さい表を内容幅にし、印刷幅不足時にセル内折り返しを保つ。 */
        it('keeps standalone PDF tables content-sized and wrappable', async () => {
            const longCellText = 'unbrokenvalue'.repeat(24);
            const samplePath = path.resolve('test/fixtures/table-width-wrap.md');
            const sampleMarkdown = await fs.readFile(samplePath, 'utf8');
            const sampleHtml = renderMarkdown(sampleMarkdown, { remoteImagesEnabled: false, language: 'ja', renderFormat: 'mixed' });
            const pdfOptions = normalizePdfOptions({ format: 'A4' });
            const printableViewport = {
                width: Math.floor((210 - pdfOptions.margins.left - pdfOptions.margins.right) * 96 / 25.4),
                height: Math.floor((297 - pdfOptions.margins.top - pdfOptions.margins.bottom) * 96 / 25.4)
            };
            const previewTable = `<table id="preview-table"><tbody><tr><td id="marked-cell" data-mve-nowrap="true">${longCellText}</td></tr></tbody></table>`;
            const request = {
                html: `<div id="fixture" style="width: 320px">${sampleHtml}${previewTable}</div>`,
                css: printContentCss(pdfOptions.fontFamily),
                options: pdfOptions,
                documentUri: new TestUri('file', '/document.md', '/document.md'),
                language: 'ja'
            } as unknown as PdfExportRequest;

            const html = await buildStandaloneHtml(request);

            expect(sampleMarkdown).toContain(longCellText);
            expect(sampleHtml).toContain('data-mve-short-value-candidate="true"');
            expect(html).toContain('body{font-family:');
            expect(html).toContain('padding:6px 8px');
            expect(html).toContain('data-mve-short-value-label="true"');
            expect(html).not.toContain('table { width: fit-content;');
            expect(html).not.toContain('table { width: 100%;');
            expect(html).toContain('table { width: max-content; max-width: 100%; border-collapse: collapse; }');
            expect(html).toContain('table th { color: #202124; background-color: #bdd5ef; }');
            expect(html).toContain('table th, table td { word-break: normal; overflow-wrap: anywhere; }');
            expect(html).toContain('table th[data-mve-nowrap="true"], table td[data-mve-nowrap="true"] { white-space: normal; overflow-wrap: anywhere; }');
            expect(html).toContain('table th[data-mve-short-value-candidate="true"], table td[data-mve-short-value-candidate="true"] { word-break: keep-all; overflow-wrap: break-word; }');
            expect(html).toContain('table th[data-mve-short-value-label="true"] { white-space: nowrap; overflow-wrap: normal; }');

            try {
                const pdf = await renderPdf({ ...request, purpose: 'preview' });
                expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
                expect((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length).toBeGreaterThan(0);

                // 明示された成果物取得時だけ、印刷幅での60表PDFを追加生成して視覚確認へ渡す。
                if (process.env.MVE_TABLE_WIDTH_CAPTURE_DIR) {
                    await fs.mkdir(process.env.MVE_TABLE_WIDTH_CAPTURE_DIR, { recursive: true });
                    const fullWidthPdf = await renderPdf({
                        ...request,
                        html: sampleHtml,
                        purpose: 'preview'
                    });
                    await fs.writeFile(
                        path.join(process.env.MVE_TABLE_WIDTH_CAPTURE_DIR, 'pdf-table-width-sample-60-patterns.pdf'),
                        fullWidthPdf
                    );
                }

                const browser = await acquirePdfBrowser('ja');
                const context = await browser.newContext({ viewport: printableViewport });
                try {
                    const page = await context.newPage();
                    await page.emulateMedia({ media: 'print' });
                    await page.setContent(html, { waitUntil: 'load' });
                    /** 60パターンをIDで取得し、印刷CSS適用後の全表幅と長文セルの描画行を測定する。 */
                    const layout = await page.evaluate(({ tableMarkers, compactMarkers, wrapMarkers, printableWidth }) => {
                        const fixture = document.getElementById('fixture')!;
                        const tables = Array.from(fixture.querySelectorAll('table'));
                        /** Fixture IDを表ヘッダーから解決し、表外へ移動した場合も失敗させる。 */
                        const findTable = (marker: string) => {
                            const inTable = tables.find((candidate) => candidate.textContent?.includes(marker));
                            if (!inTable) throw new Error(`Missing fixture table marker: ${marker}`);
                            return inTable;
                        };
                        /** 同じ高さの文字断片を1行として数え、見た目の折り返しを測る。 */
                        const countTextLines = (node: Node) => {
                            const range = document.createRange();
                            range.selectNodeContents(node);
                            return new Set(Array.from(range.getClientRects())
                                .filter((rect) => rect.width > 0)
                                .map((rect) => Math.round(rect.top))).size;
                        };
                        const patternTables = tableMarkers.map(findTable);
                        const headerCell = findTable('P01').querySelector('thead th');
                        const headerBackground = headerCell ? getComputedStyle(headerCell).backgroundColor : '';
                        const headerTextColor = headerCell ? getComputedStyle(headerCell).color : '';
                        const compactTableWidths = compactMarkers.map((marker) => findTable(marker).getBoundingClientRect().width);
                        const separatorRows = tables.flatMap((table) => Array.from(table.rows)
                            .filter((row) => Array.from(row.cells).some((cell) => cell.textContent?.trim() === '---'))).length;
                        const markedCell = document.getElementById('marked-cell')!;
                        const fixtureWidth = fixture.getBoundingClientRect().width;
                        const widths = tables.map((table) => table.getBoundingClientRect().width);
                        const wrapLineCounts = wrapMarkers.map((marker) => {
                            const cells = Array.from(findTable(marker).querySelectorAll('tbody td'));
                            return { marker, lines: Math.max(...cells.map(countTextLines)) };
                        });
                        /** 長文が隣列にある場合も、二文字の短い値を不要に分割しないことを検査する。 */
                        const p24Table = findTable('P24');
                        const shortValueCell = p24Table.querySelector('tbody tr:first-child td:nth-child(2)')!;
                        const p24ShortValueLines = countTextLines(shortValueCell);
                        const p24ShortValueCellWidth = shortValueCell.getBoundingClientRect().width;
                        const p24ShortValueStyle = {
                            candidate: shortValueCell.hasAttribute('data-mve-short-value-candidate'),
                            wordBreak: getComputedStyle(shortValueCell).wordBreak,
                            whiteSpace: getComputedStyle(shortValueCell).whiteSpace,
                            overflowWrap: getComputedStyle(shortValueCell).overflowWrap,
                            clientWidth: shortValueCell.clientWidth
                        };
                        /** P24とP29〜P32の具体的な短文がそれぞれ一行で残ることを確認する。 */
                        const shortValueCases = [
                            ['P24', '短文'], ['P29', 'P29 ID'], ['P29', '1'], ['P30', 'P30 番号'], ['P30', '02'], ['P30', '進行中'],
                            ['P31', '003'], ['P31', '種別'], ['P31', 'PDF'], ['P31', '結果'], ['P31', '成功'],
                            ['P31', 'P31 ID'], ['P32', '短い行'], ['P32', '最後の短い行'], ['P32', 'OK'], ['P32', '完了'], ['P58', 'ID']
                        ];
                        const shortValueCaseLines = shortValueCases.map(([marker, value]) => {
                            const table = findTable(marker);
                            const cell = Array.from(table.querySelectorAll('th, td')).find((candidate) => candidate.textContent?.trim() === value);
                            return { marker, value, lines: cell ? countTextLines(cell) : 0 };
                        });
                        const alignmentCells = Array.from(findTable('P19').querySelectorAll('tbody tr:last-child td'));
                        const explicitBreakCount = findTable('P20').querySelectorAll('br').length;
                        const escapedPipeContent = findTable('P23').textContent?.includes('left | middle | right') ?? false;
                        const emptyCellCount = findTable('P18').querySelectorAll('tbody td:empty').length;
                        fixture.style.width = `${printableWidth}px`;
                        const wideFixtureWidth = fixture.getBoundingClientRect().width;
                        const wideTableWidths = tables.map((table) => table.getBoundingClientRect().width);
                        const wideLongTableWidth = findTable('P09').getBoundingClientRect().width;
                        return {
                            tableCount: tables.length,
                            fixtureWidth,
                            compactTableWidths,
                            maximumTableWidth: Math.max(...widths),
                            patternTableCount: patternTables.length,
                            headerBackground,
                            headerTextColor,
                            separatorRows,
                            cellBorderTopWidth: getComputedStyle(markedCell).borderTopWidth,
                            markedWhiteSpace: getComputedStyle(markedCell).whiteSpace,
                            markedTextLineCount: countTextLines(markedCell.firstChild!),
                            wrapLineCounts,
                            p24ShortValueLines,
                            p24ShortValueCellWidth,
                            p24ShortValueStyle,
                            shortValueCaseLines,
                            alignment: alignmentCells.map((cell) => getComputedStyle(cell).textAlign.replace('-webkit-', '')),
                            explicitBreakCount,
                            escapedPipeContent,
                            emptyCellCount,
                            wideFixtureWidth,
                            wideMaximumTableWidth: Math.max(...wideTableWidths),
                            wideLongTableWidth,
                        };
                    }, {
                        tableMarkers: TABLE_WIDTH_PATTERN_MARKERS,
                        compactMarkers: TABLE_WIDTH_COMPACT_PATTERN_MARKERS,
                        wrapMarkers: TABLE_WIDTH_WRAP_PATTERN_MARKERS,
                        printableWidth: printableViewport.width
                    });

                    expect(layout.tableCount).toBe(TABLE_WIDTH_PATTERN_MARKERS.length + 1);
                    expect(layout.patternTableCount).toBe(TABLE_WIDTH_PATTERN_MARKERS.length);
                    expect(layout.headerBackground).toBe('rgb(189, 213, 239)');
                    expect(layout.headerTextColor).toBe('rgb(32, 33, 36)');
                    expect(layout.separatorRows).toBe(0);
                    expect(layout.compactTableWidths.every((width) => width < layout.fixtureWidth)).toBe(true);
                    expect(layout.maximumTableWidth).toBeLessThanOrEqual(layout.fixtureWidth + 1);
                    expect(layout.wideMaximumTableWidth).toBeLessThanOrEqual(layout.wideFixtureWidth + 1);
                    expect(layout.wideLongTableWidth).toBeCloseTo(layout.wideFixtureWidth, 0);
                    expect(layout.cellBorderTopWidth).toBe('1px');
                    expect(layout.markedWhiteSpace).toBe('normal');
                    expect(layout.markedTextLineCount).toBeGreaterThan(1);
                    expect(layout.wrapLineCounts.every(({ lines }) => lines > 1), JSON.stringify(layout.wrapLineCounts)).toBe(true);
                    expect(layout.p24ShortValueLines, `P24 短文の幅確認: ${JSON.stringify({ lines: layout.p24ShortValueLines, cellWidth: layout.p24ShortValueCellWidth, state: layout.p24ShortValueStyle })}`).toBe(1);
                    expect(layout.p24ShortValueStyle.candidate).toBe(true);
                    expect(layout.p24ShortValueStyle.wordBreak).toBe('keep-all');
                    expect(layout.p24ShortValueStyle.whiteSpace).toBe('normal');
                    expect(layout.p24ShortValueStyle.overflowWrap).toBe('break-word');
                    expect(layout.shortValueCaseLines, JSON.stringify(layout.shortValueCaseLines)).toEqual(layout.shortValueCaseLines.map(({ marker, value }) => ({ marker, value, lines: 1 })));
                    expect(layout.alignment).toEqual(['left', 'center', 'right']);
                    expect(layout.explicitBreakCount).toBeGreaterThan(0);
                    expect(layout.escapedPipeContent).toBe(true);
                    expect(layout.emptyCellCount).toBeGreaterThan(0);

                    // 実PDFと同じ本文幅で、固定fixtureに依存せず60表の出力本文を直接検証する。
                    const actualOutputHtml = await buildStandaloneHtml({ ...request, html: sampleHtml });
                    await page.setContent(actualOutputHtml, { waitUntil: 'load' });
                    await page.evaluate(() => document.fonts.ready);
                    const actualOutputLayout = await page.evaluate((targetCases) => {
                        const tables = Array.from(document.querySelectorAll('table'));
                        const countLines = (node: Node) => {
                            const range = document.createRange();
                            range.selectNodeContents(node);
                            return new Set(Array.from(range.getClientRects())
                                .filter((rect) => rect.width > 0)
                                .map((rect) => Math.round(rect.top))).size;
                        };
                        const cases = targetCases.map(([marker, value]) => {
                            const table = tables.find((candidate) => candidate.textContent?.includes(marker));
                            const cell = table && Array.from(table.querySelectorAll('th, td'))
                                .find((candidate) => candidate.textContent?.trim() === value);
                                return {
                                    marker,
                                    value,
                                    lines: cell ? countLines(cell) : 0,
                                    whiteSpace: cell ? getComputedStyle(cell).whiteSpace : '',
                                    wordBreak: cell ? getComputedStyle(cell).wordBreak : '',
                                    overflowWrap: cell ? getComputedStyle(cell).overflowWrap : '',
                                    tableWidth: table?.getBoundingClientRect().width ?? 0,
                                    parentWidth: table?.parentElement?.clientWidth ?? 0
                                };
                        });
                        return {
                            cases,
                            overflowTables: tables.filter((table) => table.getBoundingClientRect().right > table.parentElement!.getBoundingClientRect().right + 1)
                                .map((table) => table.textContent?.match(/P\\d{2}/)?.[0] ?? 'unknown')
                        };
                    }, [
                        ['P24', '短文'], ['P29', 'P29 ID'], ['P29', '1'], ['P30', 'P30 番号'], ['P30', '進行中'],
                        ['P31', 'P31 ID'], ['P31', 'PDF'], ['P31', '成功'], ['P32', '最後の短い行']
                    ]);
                    expect(actualOutputLayout.overflowTables, JSON.stringify(actualOutputLayout)).toEqual([]);
                    expect(actualOutputLayout.cases.map(({ marker, value, lines }) => ({ marker, value, lines })), JSON.stringify(actualOutputLayout.cases))
                        .toEqual(actualOutputLayout.cases.map(({ marker, value }) => ({ marker, value, lines: 1 })));
                } finally {
                    await context.close();
                }
            } finally {
                await closePdfBrowser();
            }
        }, 30_000);

        it('embeds a relative local image and produces a PDF with it',
            async () => {
                const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-pdf-'));
                temporaryDirectories.push(directory);
                const imagePath = path.join(directory, 'assets', 'local-sample.svg');
                await fs.mkdir(path.dirname(imagePath), { recursive: true });
                await fs.copyFile(path.resolve('sample/assets/local-sample.svg'), imagePath);
                const documentPath = path.join(directory, 'document.md');
                const documentUri = new TestUri('file', documentPath.replace(/\\/g, '/'), documentPath);
                const html = '<p>画像</p><img src="assets/local-sample.svg" data-original-src="assets/local-sample.svg" alt="画像">';
                const request = {
                    html,
                    css: 'img { max-width: 100%; }',
                    options: {
                        format: 'A4' as const,
                        orientation: 'portrait' as const,
                        margins: { top: 10, right: 10, bottom: 10, left: 10 },
                        header: '',
                        footer: '',
                        saveWithoutDialog: true
                    },
                    documentUri,
                    language: 'en'
                } as unknown as PdfExportRequest;

                const standaloneHtml = await buildStandaloneHtml(request);
                expect(standaloneHtml).toContain('<html lang="en">');
                const imageBytes = await fs.readFile(imagePath);
                expect(standaloneHtml).toContain(`src="data:image/svg+xml;base64,${imageBytes.toString('base64')}"`);

                const output = await renderPdf(request);
                expect(output.subarray(0, 4).toString()).toBe('%PDF');
                expect(output.length).toBeGreaterThan(0);
            }, 30_000);

        it('does not wait indefinitely for a remote image that never finishes',
            async () => {
                const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-pdf-'));
                temporaryDirectories.push(directory);
                const server = createServer(

                    (_request, response) => {
                        response.writeHead(200, { 'Content-Type': 'image/png' });
                        // 画像レスポンスを完了させず、応答待ちが無期限にならないことを検証する。
                    });
                temporaryServers.push(server);
                await new Promise<void>(
                    /**
                     * 非同期処理の成功結果を待機側へ通知する。
                     * @param resolve - Promiseの成功を通知する関数。
                     */
                    (resolve) => server.listen(0, '127.0.0.1',

                        () => resolve()));
                const address = server.address();
                if (!address || typeof address === 'string') throw new Error('Test server did not start.');

                const documentPath = path.join(directory, 'document.md');
                const documentUri = new TestUri('file', documentPath.replace(/\\/g, '/'), documentPath);
                const request = {
                    html: `<p>remote image</p><img src="http://127.0.0.1:${address.port}/never-finishes.png">`,
                    css: 'img { max-width: 100%; }',
                    options: {
                        format: 'A4' as const,
                        orientation: 'portrait' as const,
                        margins: { top: 10, right: 10, bottom: 10, left: 10 },
                        header: '',
                        footer: '',
                        saveWithoutDialog: true
                    },
                    documentUri,
                    language: 'en'
                } as unknown as PdfExportRequest;

                const startedAt = Date.now();
                const output = await renderPdf(request);
                expect(Date.now() - startedAt).toBeLessThan(15_000);
                expect(output.subarray(0, 4).toString()).toBe('%PDF');
                expect(output.length).toBeGreaterThan(0);
            }, 20_000);

        it('renders sample/03-images.md within the preview budget',
            async () => {
                const documentPath = path.resolve('sample/03-images.md');
                const documentUri = new TestUri('file', documentPath.replace(/\\/g, '/'), documentPath);
                const markdown = await fs.readFile(documentPath, 'utf8');
                const html = renderMarkdown(markdown, { remoteImagesEnabled: true, language: 'ja' });
                expect(html).toContain('github.githubassets.com/images/modules/logos_page/GitHub-Mark.png');
                const startedAt = Date.now();
                const output = await renderPdf({
                    html,
                    css: 'body { font-family: sans-serif; } img { max-width: 100%; }',
                    options: {
                        format: 'B5',
                        orientation: 'portrait',
                        margins: { top: 15, right: 15, bottom: 15, left: 15 },
                        header: '',
                        footer: '{page}/{pages}',
                        textReplacements: [],
                        saveWithoutDialog: true
                    },
                    documentUri,
                    language: 'ja',
                    purpose: 'preview'
                });
                expect(Date.now() - startedAt).toBeLessThan(10_000);
                expect(output.length).toBeGreaterThan(0);
            }, 15_000);
    });

/** PDF出力に渡す混在Markdown HTMLがTextileブロックを保ち、実PDF生成まで到達することを確認する。 */
describe('Textile PDF export',
    () => {
        it('uses the mixed Markdown/Textile HTML when generating a PDF',
            async () => {
                const markdown = [
                    '# Mixed PDF heading',
                    '',
                    'Markdown **bold** and Textile +inserted+ and -deleted-.',
                    '',
                    '|Textile|PDF|',
                    '|Mixed|preserved|',
                    '',
                    '<pre><code class="csharp">',
                    'using System;',
                    '',
                    'internal static class HelloWorld',
                    '{',
                    '    private static void Main()',
                    '    {',
                    '        Console.WriteLine("Hello, world!");',
                    '    }',
                    '}',
                    '</code></pre>'
                ].join('\n');
                const html = renderMarkdown(markdown, {
                    remoteImagesEnabled: false,
                    language: 'ja',
                    renderFormat: 'mixed'
                });
                const documentUri = new TestUri('file', '/textile-mixed.md', '/textile-mixed.md');
                const request = {
                    html,
                    css: 'table { border-collapse: collapse; }',
                    options: {
                        format: 'A4' as const,
                        orientation: 'portrait' as const,
                        margins: { top: 10, right: 10, bottom: 10, left: 10 },
                        header: '',
                        footer: '',
                        saveWithoutDialog: true
                    },
                    documentUri,
                    language: 'ja',
                    purpose: 'preview' as const
                } as unknown as PdfExportRequest;

                expect(html).toContain('<strong>bold</strong>');
                expect(html).toContain('<ins>inserted</ins>');
                expect(html).toContain('<del>deleted</del>');
                expect(html).toContain('<table>');
                expect(html).toContain('class="csharp hljs"');
                expect(html).toContain('<span class="hljs-keyword">using</span> System;\n\n<span class="hljs-keyword">internal</span>');
                expect(html).not.toContain('<br');
                const standaloneHtml = await buildStandaloneHtml(request);
                expect(standaloneHtml).toContain('<ins>inserted</ins>');
                expect(standaloneHtml).toContain('class="csharp hljs"');
                expect(standaloneHtml).not.toContain('<br');

                const pdf = await renderPdf(request);
                expect(pdf.length).toBeGreaterThan(0);
                const evidenceDirectory = path.resolve('sample', 'textile', 'evidence');
                await fs.mkdir(evidenceDirectory, { recursive: true });
                await fs.writeFile(path.join(evidenceDirectory, 'mixed-export.pdf'), pdf);
            }, 20_000);
    });

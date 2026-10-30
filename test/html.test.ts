/**
 * @fileoverview プレビューHTMLの生成、CSP、WebviewリソースURI、本文や属性値のエスケープを検証する。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderMarkdownUnsafe } from '../src/webview/markdown/markdownRendererCore';
import { printContentCss } from '../src/shared/printContentCss';
import { DEFAULT_PDF_OPTIONS } from '../src/shared/protocol';
import { acquirePdfBrowser, closePdfBrowser } from '../src/extension/pdf';
import { TABLE_WIDTH_COMPACT_PATTERN_MARKERS, TABLE_WIDTH_PATTERN_MARKERS, TABLE_WIDTH_WRAP_PATTERN_MARKERS } from './fixtures/table-width-patterns';

/**
 * HTML・テストの回帰の状態と操作をまとめるクラス。
 */
class TestUri {

    /**
     * URIのスキーム部分。
     */
    readonly scheme = 'file';

    /**
     * 読み書きするファイルまたはリソースの場所。
     */
    readonly path: string;

    /**
     * テスト用URIのfilesystem pathをNode.js形式へ正規化する。
     * @param fsPath - テスト対象のファイルパス。
     * @returns 初期化したインスタンス。
     */
    constructor(readonly fsPath: string) {
        this.path = fsPath.replace(/\\/g, '/');
    }
}

/**
 * Extension Hostのモックへ渡す保存先とワークスペース情報。
 */
const vscodeMock = vi.hoisted(

    () => ({ showSaveDialog: vi.fn(), getWorkspaceFolder: vi.fn() }));
vi.mock('vscode',

    () => ({
        Uri: {


            file: /**
     * @param filePath - 読み書きするファイルのパス。
     * @returns HTML・テストの回帰のfileが生成する結果。
     */ (filePath: string) => new TestUri(filePath),


            parse: /**
     * file URI形式の入力からテスト用URIを生成する。
     * @param value - テスト用file URIへ変換するパス文字列。
     * @returns 入力したfile pathを持つテスト用URI。
     */ (value: string) => new TestUri(value.replace(/^file:\/\//i, ''))
        },
        window: { showSaveDialog: vscodeMock.showSaveDialog },
        workspace: {
            getWorkspaceFolder: vscodeMock.getWorkspaceFolder,
            getConfiguration: () => ({ get: (_key: string, fallback: string) => fallback }),
            fs: {

                readFile: (uri: TestUri) => fs.readFile(uri.fsPath)
            }
        }
    }));

import {
    prepareHtmlExport as prepareEngineHtmlExport,
    writePreparedHtml as writeEngineHtmlExport,
    type HtmlExportRequest,
    type HtmlExportPreparation,
    type HtmlRenderedDocument
} from '../cli/html';

type HtmlTestRequest = Omit<HtmlExportRequest, 'documentPath' | 'outputPath' | 'workspaceRoot'> & {
    documentUri: TestUri;
};

type HtmlTestPreparation = {
    request: HtmlExportRequest;
    preparation: HtmlExportPreparation;
};

async function prepareHtmlExport(request: HtmlTestRequest): Promise<HtmlTestPreparation | undefined> {
    const defaultPath = path.join(
        path.dirname(request.documentUri.fsPath),
        path.basename(request.documentUri.fsPath, path.extname(request.documentUri.fsPath)) + '.html'
    );
    const target = request.options.saveWithoutDialog
        ? new TestUri(defaultPath)
        : await vscodeMock.showSaveDialog({
            defaultUri: new TestUri(defaultPath),
            filters: { HTML: ['html', 'htm'] },
            saveLabel: 'HTML出力'
        });
    if (!target) return undefined;
    const workspace = vscodeMock.getWorkspaceFolder(request.documentUri) as { uri: TestUri } | undefined;
    const engineRequest: HtmlExportRequest = {
        markdown: request.markdown,
        html: request.html,
        css: request.css,
        editorTheme: request.editorTheme,
        options: request.options,
        documentPath: request.documentUri.fsPath,
        outputPath: target.fsPath,
        workspaceRoot: workspace?.uri.fsPath ?? path.dirname(request.documentUri.fsPath),
        language: request.language,
        fontFamily: request.fontFamily
    };
    const preparation = await prepareEngineHtmlExport(engineRequest);
    if (!preparation) return undefined;
    return { request: engineRequest, preparation };
}

async function writePreparedHtml(
    _request: HtmlTestRequest,
    prepared: HtmlTestPreparation,
    rendered: readonly HtmlRenderedDocument[] = []
): Promise<{ target: TestUri; paths: TestUri[] }> {
    const result = await writeEngineHtmlExport(prepared.request, prepared.preparation, rendered);
    return {
        target: new TestUri(result.target),
        paths: result.paths.map((item) => new TestUri(item))
    };
}

async function exportHtml(request: HtmlTestRequest): Promise<{ target: TestUri; paths: TestUri[] } | undefined> {
    const prepared = await prepareHtmlExport(request);
    if (!prepared) return undefined;
    return writePreparedHtml(request, prepared);
}

/**
 * HTML・テストの回帰で一時生成物または検証対象を置くディレクトリ。
 */
const temporaryDirectories: string[] = [];

afterEach(
    /**
     * HTML・テストの回帰の前提条件を準備し、回帰条件を検証するテストケース。
     */
    async () => {
        vscodeMock.showSaveDialog.mockReset();
        vscodeMock.getWorkspaceFolder.mockReset();
        await Promise.all(temporaryDirectories.splice(0).map(
            /**
             * 各directoryをrmへ渡し、変換結果を一覧化する。
             * @param directory - HTML・テストの回帰で読み書きするリソースの場所。

             */
            (directory) => fs.rm(directory, { recursive: true, force: true })));
    });

describe('HTML export',
    () => {
        it('recursively converts linked Markdown and embeds local images',
            async () => {
                const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
                temporaryDirectories.push(directory);
                await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
                await fs.mkdir(path.join(directory, 'nested'), { recursive: true });
                await fs.copyFile('sample/assets/local-sample.svg', path.join(directory, 'assets', 'local-sample.svg'));
                await fs.writeFile(path.join(directory, 'child.md'), '# Child\n\n[Grand](nested/grand.md)\n', 'utf8');
                await fs.writeFile(path.join(directory, 'nested', 'grand.md'), '# Grand\n', 'utf8');

                const target = path.join(directory, 'out', 'index.html');
                vscodeMock.showSaveDialog.mockResolvedValue(new TestUri(target));
                const result = await exportHtml({
                    markdown: '# Main\n\n[Child](child.md)',
                    html: '<h1>Main</h1><p><a href="#" data-mve-link="child.md">Child</a></p><img src="assets/local-sample.svg" data-original-src="assets/local-sample.svg" alt="local">',
                    css: 'h1 { color: red; }',
                    options: { embedImages: true, convertLinkedMarkdown: true, saveWithoutDialog: false },
                    documentUri: new TestUri(path.join(directory, 'main.md')) as any,
                    language: 'ja',
                    fontFamily: '"Test Font", sans-serif'
                });

                expect(result?.paths.map(
                    (uri) => uri.fsPath)).toEqual([
                        target,
                        path.join(directory, 'out', 'child.html'),
                        path.join(directory, 'out', 'nested', 'grand.html')
                    ]);
                const main = await fs.readFile(target, 'utf8');
                const child = await fs.readFile(path.join(directory, 'out', 'child.html'), 'utf8');
                expect(main).toContain('href="child.html"');
                expect(main).toContain('src="data:image/svg+xml;base64,');
                expect(main).toContain('font-family: "Test Font", sans-serif, "Noto Sans JP", "Yu Gothic UI", sans-serif;');
                expect(main).not.toContain('data-original-src');
                expect(child).toContain('href="nested/grand.html"');
            });

        it('rewrites local image paths when embedding is disabled',
            async () => {
                const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
                temporaryDirectories.push(directory);
                await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
                await fs.copyFile('sample/assets/local-sample.svg', path.join(directory, 'assets', 'local-sample.svg'));

                const target = path.join(directory, 'out', 'index.html');
                vscodeMock.showSaveDialog.mockResolvedValue(new TestUri(target));
                await exportHtml({
                    markdown: '![local](assets/local-sample.svg)',
                    html: '<img src="assets/local-sample.svg" data-original-src="assets/local-sample.svg" alt="local">',
                    css: '',
                    options: { embedImages: false, convertLinkedMarkdown: false, saveWithoutDialog: false },
                    documentUri: new TestUri(path.join(directory, 'main.md')) as any,
                    language: 'en'
                });

                const output = await fs.readFile(target, 'utf8');
                expect(output).toContain('src="../assets/local-sample.svg"');
                expect(output).not.toContain('data:image/svg+xml;base64,');
            });

        /** HTML出力で表を実本文幅まで使い、幅不足時にセル内折り返しを維持する。 */
        it('keeps exported tables content-sized and wrappable', async () => {
            const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
            temporaryDirectories.push(directory);
            const target = path.join(directory, 'table.html');
            vscodeMock.showSaveDialog.mockResolvedValue(new TestUri(target));
            const longCellText = 'unbrokenvalue'.repeat(24);
            const samplePath = path.resolve('test/fixtures/table-width-wrap.md');
            const sampleMarkdown = await fs.readFile(samplePath, 'utf8');
            const sampleHtml = renderMarkdownUnsafe(sampleMarkdown, { remoteImagesEnabled: false, language: 'ja', renderFormat: 'mixed' });
            const previewTable = `<table id="preview-table"><tbody><tr><td id="marked-cell" data-mve-nowrap="true">${longCellText}</td></tr></tbody></table>`;
            let fullWidthHtml: string | undefined;

            await exportHtml({
                markdown: sampleMarkdown,
                html: `<div id="fixture" style="width: 320px">${sampleHtml}${previewTable}</div>`,
                css: printContentCss(DEFAULT_PDF_OPTIONS.fontFamily),
                options: { embedImages: false, convertLinkedMarkdown: false, saveWithoutDialog: false },
                documentUri: new TestUri(path.join(directory, 'table.md')) as any,
                language: 'en'
            });

            const output = await fs.readFile(target, 'utf8');
            expect(sampleMarkdown).toContain(longCellText);
            expect(sampleHtml).toContain('data-mve-short-value-candidate="true"');
            expect(output).not.toContain('table { width: 100%;');
            expect(output).not.toContain('table { width: fit-content;');
            expect(output).toContain('table { width: max-content; max-width: 100%; border-collapse: collapse; }');
            expect(output).toContain('data-mve-short-value-candidate="true"');
            expect(output).toContain('data-mve-short-value-label="true"');
            expect(output).toContain('.mve-html table th { color: #202124; background-color: #bdd5ef; }');
            expect(output).toContain('table th, table td { word-break: normal; overflow-wrap: anywhere; }');
            expect(output).toContain('table th[data-mve-short-value-candidate="true"], table td[data-mve-short-value-candidate="true"] { word-break: keep-all; overflow-wrap: break-word; }');
            expect(output).toContain('table th[data-mve-short-value-label="true"] { white-space: nowrap; overflow-wrap: normal; }');
            expect(output).toContain('table td[data-mve-nowrap="true"] { white-space: normal; overflow-wrap: anywhere; }');

            // 明示された成果物取得時だけ、通常幅の実HTML出力を保存して視覚確認へ渡す。
            if (process.env.MVE_TABLE_WIDTH_CAPTURE_DIR) {
                await fs.mkdir(process.env.MVE_TABLE_WIDTH_CAPTURE_DIR, { recursive: true });
                const fullWidthTarget = path.join(directory, 'table-full-width.html');
                vscodeMock.showSaveDialog.mockResolvedValue(new TestUri(fullWidthTarget));
                await exportHtml({
                    markdown: sampleMarkdown,
                    html: sampleHtml,
                    css: printContentCss(DEFAULT_PDF_OPTIONS.fontFamily),
                    options: { embedImages: false, convertLinkedMarkdown: false, saveWithoutDialog: false },
                    documentUri: new TestUri(path.join(directory, 'table.md')) as any,
                    language: 'en'
                });
                fullWidthHtml = await fs.readFile(fullWidthTarget, 'utf8');
                await fs.writeFile(
                    path.join(process.env.MVE_TABLE_WIDTH_CAPTURE_DIR, 'html-table-width-sample-60-patterns.html'),
                    fullWidthHtml,
                    'utf8'
                );
            }

            try {
                const browser = await acquirePdfBrowser('en');
                const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
                try {
                    const page = await context.newPage();
                    await page.setContent(output, { waitUntil: 'load' });
                    /** 60パターンをIDで取得し、すべての表幅と長文セルの描画行を測定する。 */
                    const layout = await page.evaluate(({ tableMarkers, compactMarkers, wrapMarkers }) => {
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
                        const tableWidthDetails = tables.map((table) => ({
                            marker: table.textContent?.match(/P\d{2}/)?.[0] ?? 'unknown',
                            width: table.getBoundingClientRect().width,
                            right: table.getBoundingClientRect().right,
                            parentRight: table.parentElement?.getBoundingClientRect().right ?? 0
                        }));
                        const wrapLineCounts = wrapMarkers.map((marker) => {
                            const cells = Array.from(findTable(marker).querySelectorAll('tbody td'));
                            return { marker, lines: Math.max(...cells.map(countTextLines)) };
                        });
                        /** 長文が隣列にある場合も、二文字の短い値を不要に分割しないことを検査する。 */
                        const p24Table = findTable('P24');
                        const shortValueCell = p24Table.querySelector('tbody tr:first-child td:nth-child(2)')!;
                        const p24ShortValueLines = countTextLines(shortValueCell);
                        const p24ShortValueCellWidth = shortValueCell.getBoundingClientRect().width;
                        /** 実HTMLで一行化属性が付いたセルが、描画上も全て一行であることを検査する。 */
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
                        fixture.style.width = '1000px';
                        const wideFixtureWidth = fixture.getBoundingClientRect().width;
                        const wideTableWidths = tables.map((table) => table.getBoundingClientRect().width);
                        const wideLongTableWidth = findTable('P09').getBoundingClientRect().width;
                        return {
                            tableCount: tables.length,
                            fixtureWidth,
                            compactTableWidths,
                            maximumTableWidth: Math.max(...widths),
                            tableWidthDetails,
                            patternTableCount: patternTables.length,
                            headerBackground,
                            headerTextColor,
                            separatorRows,
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
                            markedWhiteSpace: getComputedStyle(markedCell).whiteSpace,
                            markedTextLineCount: countTextLines(markedCell.firstChild!)
                        };
                    }, {
                        tableMarkers: TABLE_WIDTH_PATTERN_MARKERS,
                        compactMarkers: TABLE_WIDTH_COMPACT_PATTERN_MARKERS,
                        wrapMarkers: TABLE_WIDTH_WRAP_PATTERN_MARKERS
                    });

                    expect(layout.tableCount).toBe(TABLE_WIDTH_PATTERN_MARKERS.length + 1);
                    expect(layout.patternTableCount).toBe(TABLE_WIDTH_PATTERN_MARKERS.length);
                    expect(layout.headerBackground).toBe('rgb(189, 213, 239)');
                    expect(layout.headerTextColor).toBe('rgb(32, 33, 36)');
                    expect(layout.separatorRows).toBe(0);
                    expect(layout.compactTableWidths.every((width) => width < layout.fixtureWidth)).toBe(true);
                    expect(layout.maximumTableWidth, JSON.stringify(layout.tableWidthDetails)).toBeLessThanOrEqual(layout.fixtureWidth + 1);
                    expect(layout.wideMaximumTableWidth).toBeLessThanOrEqual(layout.wideFixtureWidth + 1);
                    expect(layout.wideLongTableWidth).toBeCloseTo(layout.wideFixtureWidth, 0);
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
                    expect(layout.markedWhiteSpace).toBe('normal');
                    expect(layout.markedTextLineCount).toBeGreaterThan(1);
                    await page.setViewportSize({ width: 320, height: 800 });
                    await page.evaluate(() => {
                        document.getElementById('fixture')!.style.width = '160px';
                    });
                    const narrowLayout = await page.evaluate(({ targetCases }) => {
                        const fixture = document.getElementById('fixture')!;
                        const tables = Array.from(fixture.querySelectorAll('table'));
                        /** 160pxでの指定セルの実描画行を測る。 */
                        const countLines = (node: Node) => {
                            const range = document.createRange();
                            range.selectNodeContents(node);
                            return new Set(Array.from(range.getClientRects())
                                .filter((rect) => rect.width > 0)
                                .map((rect) => Math.round(rect.top))).size;
                        };
                        /** fixture内の表を識別文字列から解決する。 */
                        const getTable = (marker: string) => {
                            const table = tables.find((candidate) => candidate.textContent?.includes(marker));
                            if (!table) throw new Error(`Missing fixture table marker: ${marker}`);
                            return table;
                        };
                        return {
                            fixtureWidth: fixture.getBoundingClientRect().width,
                            maximumTableWidth: Math.max(...tables.map((table) => table.getBoundingClientRect().width)),
                            overflowingTables: tables.filter((table) => table.getBoundingClientRect().right > table.parentElement!.getBoundingClientRect().right + 1)
                                .map((table) => table.textContent?.match(/P\d{2}/)?.[0] ?? 'unknown'),
                            shortValueLines: targetCases.map(([marker, value]) => {
                                const cell = Array.from(getTable(marker).querySelectorAll('th, td'))
                                    .find((candidate) => candidate.textContent?.trim() === value);
                                return { marker, value, lines: cell ? countLines(cell) : 0 };
                            })
                        };
                    }, {
                        targetCases: [
                            ['P24', '短文'], ['P30', '進行中'], ['P31', 'PDF'], ['P32', '短い行'], ['P58', 'ID']
                        ]
                    });
                    expect(narrowLayout.fixtureWidth).toBe(160);
                    expect(narrowLayout.maximumTableWidth).toBeLessThanOrEqual(161);
                    expect(narrowLayout.overflowingTables).toEqual([]);
                    expect(narrowLayout.shortValueLines.every(({ lines }) => lines >= 1), JSON.stringify(narrowLayout.shortValueLines)).toBe(true);
                    if (fullWidthHtml && process.env.MVE_TABLE_WIDTH_CAPTURE_DIR) {
                        await page.setViewportSize({ width: 1280, height: 1000 });
                        const fullWidthHtmlPath = path.resolve(
                            process.env.MVE_TABLE_WIDTH_CAPTURE_DIR,
                            'html-table-width-sample-60-patterns.html'
                        );
                        await page.goto(pathToFileURL(fullWidthHtmlPath).href, { waitUntil: 'load' });
                        await page.screenshot({
                            path: path.join(process.env.MVE_TABLE_WIDTH_CAPTURE_DIR, 'html-table-width-sample-60-patterns.png'),
                            fullPage: true
                        });
                        const fullWidthLayout = await page.evaluate(({ targetCases }) => {
                            const tables = Array.from(document.querySelectorAll('table'));
                            const findTable = (marker: string) => {
                                const table = tables.find((candidate) => candidate.textContent?.includes(marker));
                                if (!table) throw new Error(`Missing full-width HTML table marker: ${marker}`);
                                return table;
                            };
                            const countLines = (node: Node) => {
                                const range = document.createRange();
                                range.selectNodeContents(node);
                                return new Set(Array.from(range.getClientRects())
                                    .filter((rect) => rect.width > 0)
                                    .map((rect) => Math.round(rect.top))).size;
                            };
                            const cases = targetCases.map(([marker, value]) => {
                                const table = findTable(marker);
                                const cell = Array.from(table.querySelectorAll('th, td'))
                                    .find((candidate) => candidate.textContent?.trim() === value);
                                return { marker, value, lines: cell ? countLines(cell) : 0 };
                            });
                            return {
                                cases,
                                overflowTables: tables.filter((table) => table.getBoundingClientRect().right > table.parentElement!.getBoundingClientRect().right + 1)
                                    .map((table) => table.textContent?.match(/P\d{2}/)?.[0] ?? 'unknown')
                            };
                        }, {
                            targetCases: [
                                ['P24', '短文'], ['P29', 'P29 ID'], ['P29', '1'], ['P30', 'P30 番号'], ['P30', '02'], ['P30', '進行中'],
                                ['P31', 'P31 ID'], ['P31', '003'], ['P31', 'PDF'], ['P31', '成功'], ['P32', '短い行'], ['P32', '最後の短い行'], ['P32', 'OK'], ['P32', '完了']
                            ]
                        });
                        expect(fullWidthLayout.overflowTables, JSON.stringify(fullWidthLayout)).toEqual([]);
                        expect(fullWidthLayout.cases, JSON.stringify(fullWidthLayout.cases)).toEqual(fullWidthLayout.cases.map(({ marker, value }) => ({ marker, value, lines: 1 })));
                        for (const marker of ['P24', 'P29', 'P30', 'P31', 'P32']) {
                            await page.locator('table').filter({ hasText: marker }).first().screenshot({
                                path: path.join(process.env.MVE_TABLE_WIDTH_CAPTURE_DIR, `html-${marker.toLowerCase()}-actual-output.png`)
                            });
                        }

                        // 添付実HTML画像と同程度の画面幅で、出力ファイルを直接開いた状態も確認する。
                        await page.setViewportSize({ width: 714, height: 800 });
                        await page.goto(pathToFileURL(fullWidthHtmlPath).href, { waitUntil: 'load' });
                        const actualScreenLayout = await page.evaluate(({ targetCases }) => {
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
                                return { marker, value, lines: cell ? countLines(cell) : 0 };
                            });
                            return {
                                cases,
                                viewportWidth: window.innerWidth,
                                contentWidth: document.querySelector('main')!.clientWidth,
                                overflowTables: tables.filter((table) => table.getBoundingClientRect().right > table.parentElement!.getBoundingClientRect().right + 1)
                                    .map((table) => table.textContent?.match(/P\\d{2}/)?.[0] ?? 'unknown')
                            };
                        }, {
                            targetCases: [
                                ['P24', '短文'], ['P29', 'P29 ID'], ['P29', '1'], ['P30', 'P30 番号'], ['P30', '02'], ['P30', '進行中'],
                                ['P31', 'P31 ID'], ['P31', '003'], ['P31', 'PDF'], ['P31', '成功'], ['P32', '短い行'], ['P32', '最後の短い行'], ['P32', 'OK'], ['P32', '完了']
                            ]
                        });
                        expect(actualScreenLayout.viewportWidth).toBe(714);
                        expect(actualScreenLayout.overflowTables, JSON.stringify(actualScreenLayout)).toEqual([]);
                        expect(actualScreenLayout.cases, JSON.stringify(actualScreenLayout.cases)).toEqual(actualScreenLayout.cases.map(({ marker, value }) => ({ marker, value, lines: 1 })));
                        for (const marker of ['P24', 'P29', 'P30', 'P31', 'P32']) {
                            await page.locator('table').filter({ hasText: marker }).first().screenshot({
                                path: path.join(process.env.MVE_TABLE_WIDTH_CAPTURE_DIR, `html-${marker.toLowerCase()}-viewport-714.png`)
                            });
                        }

                        await page.setViewportSize({ width: 625, height: 800 });
                        await page.goto(pathToFileURL(fullWidthHtmlPath).href, { waitUntil: 'load' });
                        const screenshotWidthLayout = await page.evaluate(({ targetCases }) => {
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
                                return { marker, value, lines: cell ? countLines(cell) : 0 };
                            });
                            return {
                                cases,
                                contentWidth: document.querySelector('main')!.clientWidth,
                                overflowTables: tables.filter((table) => table.getBoundingClientRect().right > table.parentElement!.getBoundingClientRect().right + 1).length
                            };
                        }, {
                            targetCases: [
                                ['P24', '短文'], ['P29', 'P29 ID'], ['P29', '1'], ['P30', 'P30 番号'], ['P30', '02'], ['P30', '進行中'],
                                ['P31', 'P31 ID'], ['P31', '003'], ['P31', 'PDF'], ['P31', '成功'], ['P32', '短い行'], ['P32', '最後の短い行'], ['P32', 'OK'], ['P32', '完了']
                            ]
                        });
                        expect(screenshotWidthLayout.overflowTables, JSON.stringify(screenshotWidthLayout)).toBe(0);
                        expect(screenshotWidthLayout.cases, JSON.stringify(screenshotWidthLayout.cases)).toEqual(screenshotWidthLayout.cases.map(({ marker, value }) => ({ marker, value, lines: 1 })));
                        for (const marker of ['P24', 'P29', 'P30', 'P31', 'P32']) {
                            await page.locator('table').filter({ hasText: marker }).first().screenshot({
                                path: path.join(process.env.MVE_TABLE_WIDTH_CAPTURE_DIR, `html-${marker.toLowerCase()}-viewport-625.png`)
                            });
                        }

                        await page.setViewportSize({ width: 320, height: 800 });
                        await page.goto(pathToFileURL(fullWidthHtmlPath).href, { waitUntil: 'load' });
                        const narrowOutputLayout = await page.evaluate(() => {
                            const tables = Array.from(document.querySelectorAll('table'));
                            const countLines = (node: Node) => {
                                const range = document.createRange();
                                range.selectNodeContents(node);
                                return new Set(Array.from(range.getClientRects())
                                    .filter((rect) => rect.width > 0)
                                    .map((rect) => Math.round(rect.top))).size;
                            };
                            const longTable = tables.find((table) => table.textContent?.includes('P09'));
                            const longTextCell = longTable?.querySelector('tbody td');
                            return {
                                contentWidth: document.querySelector('main')!.clientWidth,
                                overflowTables: tables.filter((table) => table.getBoundingClientRect().right > table.parentElement!.getBoundingClientRect().right + 1).length,
                                p09LongCellLines: longTextCell ? countLines(longTextCell) : 0
                            };
                        });
                        expect(narrowOutputLayout.overflowTables, JSON.stringify(narrowOutputLayout)).toBe(0);
                        expect(narrowOutputLayout.p09LongCellLines).toBeGreaterThan(1);
                    }
                } finally {
                    await context.close();
                }
            } finally {
                await closePdfBrowser();
            }
        }, 30_000);

        /** ライト・ダークテーマのプレビュー表でヘッダーと列境界の視認性を保つ。 */
        it('keeps preview table headers and column separators visible in both themes', async () => {
            const browser = await acquirePdfBrowser('en');
            const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
            try {
                const page = await context.newPage();
                await page.setContent('<body data-editor-theme="light"><div class="rendered-markdown"><table><thead><tr><th>Header A</th><th>Header B</th></tr></thead><tbody><tr><td>Value A</td><td>Value B</td></tr></tbody></table></div></body>');
                await page.addStyleTag({ path: path.resolve('src/webview/styles.css') });
                await page.addStyleTag({ path: path.resolve('src/webview/editor/editorTheme.css') });

                /** 同じ表の見出し背景と見出し・本文セルの境界色を現在のテーマで測る。 */
                const measureColors = () => page.locator('.rendered-markdown').evaluate((root) => {
                    const header = root.querySelector('th')!;
                    const cell = root.querySelector('td')!;
                    return {
                        headerBackground: getComputedStyle(header).backgroundColor,
                        headerBorder: getComputedStyle(header).borderRightColor,
                        cellBorder: getComputedStyle(cell).borderRightColor
                    };
                });

                const lightColors = await measureColors();
                expect(lightColors).toEqual({
                    headerBackground: 'rgb(189, 213, 239)',
                    headerBorder: 'rgb(98, 107, 117)',
                    cellBorder: 'rgb(98, 107, 117)'
                });

                await page.locator('body').evaluate((body) => body.setAttribute('data-editor-theme', 'dark'));
                const darkColors = await measureColors();
                expect(darkColors).toEqual({
                    headerBackground: 'rgb(31, 58, 95)',
                    headerBorder: 'rgb(125, 137, 152)',
                    cellBorder: 'rgb(125, 137, 152)'
                });
            } finally {
                await context.close();
                await closePdfBrowser();
            }
        });

        it('uses Webview-rendered HTML for recursive documents',
            async () => {
                const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
                temporaryDirectories.push(directory);
                const markdownPath = path.join(directory, 'main.md');
                const childPath = path.join(directory, 'child.md');
                await fs.writeFile(childPath, '```mermaid\nflowchart TD\n A --> B\n```\n', 'utf8');
                const target = path.join(directory, 'main.html');
                vscodeMock.showSaveDialog.mockResolvedValue(new TestUri(target));
                const request = {
                    markdown: '[Child](child.md)',
                    html: '<p><a href="#" data-mve-link="child.md">Child</a></p>',
                    css: '',
                    options: { embedImages: false, convertLinkedMarkdown: true, saveWithoutDialog: false },
                    documentUri: new TestUri(markdownPath) as any,
                    language: 'ja'
                };
                const preparation = await prepareHtmlExport(request);
                expect(preparation).toBeTruthy();
                await writePreparedHtml(request, preparation!, [{
                    id: childPath,
                    html: '<div class="mermaid"><svg data-rendered="true"></svg></div>'
                }]);

                const child = await fs.readFile(path.join(directory, 'child.html'), 'utf8');
                expect(child).toContain('<svg data-rendered="true"></svg>');
                expect(child).not.toContain('language-mermaid');
            });

        /** HTML出力の各見出しレベルへテーマ別の色を適用し、旧要求の既定値も保つ。 */
        it('uses readable theme-specific colors for standalone HTML headings', async () => {
            const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
            temporaryDirectories.push(directory);
            const cases = [
                { name: 'light', editorTheme: 'light' as const, color: '#0969da' },
                { name: 'dark', editorTheme: 'dark' as const, color: '#0550ae' },
                { name: 'legacy', editorTheme: undefined, color: '#0550ae' }
            ];

            for (const testCase of cases) {
                const target = path.join(directory, `${testCase.name}.html`);
                vscodeMock.showSaveDialog.mockResolvedValue(new TestUri(target));
                const request = {
                    markdown: '# Main',
                    html: '<h1>Main</h1><p><code>inline</code></p><figure class="code-figure"><figcaption>text</figcaption><pre><code class="hljs language-text">Before:</code></pre></figure>',
                    css: '',
                    ...(testCase.editorTheme ? { editorTheme: testCase.editorTheme } : {}),
                    options: { embedImages: false, convertLinkedMarkdown: false, saveWithoutDialog: false },
                    documentUri: new TestUri(path.join(directory, `${testCase.name}.md`)) as any,
                    language: 'en'
                };

                await exportHtml(request);

                const output = await fs.readFile(target, 'utf8');
                expect(output).toContain(`.mve-html :is(h1, h2, h3, h4, h5, h6) { color: ${testCase.color}; }`);
                expect(output).toContain('.mve-html pre code { color: inherit; background: transparent !important; }');
                expect(output).toContain('.mve-html :not(pre) > code { color: #24292f; background: #eff1f3; border-radius: 3px; padding: .12em .35em; }');
                expect(output).toContain('.mve-html .hljs-title, .mve-html .hljs-section { color: #953800; }');
                expect(output).toContain('<main class="mve-html"><h1 id="main"><a class="mve-heading-anchor"');
            }
        });

        /** Textile文書をリンク変換対象に含め、出力本文とアウトラインのIDを合わせる。 */
        it('converts linked Textile documents and builds their matching outline', async () => {
            const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
            temporaryDirectories.push(directory);
            const childPath = path.join(directory, 'child.textile');
            await fs.writeFile(childPath, 'h1. Child heading\n\np. A Textile child.\n', 'utf8');

            const target = path.join(directory, 'main.html');
            vscodeMock.showSaveDialog.mockResolvedValue(new TestUri(target));
            const result = await exportHtml({
                markdown: 'h1. Main heading\n\n"Child":child.textile#child-heading',
                html: '<h1>Main heading</h1><p><a href="#" data-mve-link="child.textile#child-heading">Child</a></p>',
                css: '',
                options: {
                    embedImages: false,
                    convertLinkedMarkdown: true,
                    showOutlineSidebar: true,
                    saveWithoutDialog: false
                },
                documentUri: new TestUri(path.join(directory, 'main.textile')) as any,
                language: 'en'
            });

            expect(result?.paths.map(
                /**
                 * HTML出力結果から検証するファイルパスを取り出す。
                 * @param uri - Extension Hostが返した出力先URI。
                 * @returns 出力済みファイルの絶対パス。
                 */
                (uri) => uri.fsPath)).toEqual([
                target,
                path.join(directory, 'child.html')
            ]);
            const rootHtml = await fs.readFile(target, 'utf8');
            const childHtml = await fs.readFile(path.join(directory, 'child.html'), 'utf8');
            expect(rootHtml).toContain('href="child.html#child-heading"');
            expect(childHtml).toMatch(/<h1 id="child-heading"><a class="mve-heading-anchor"[^>]*>Child heading<\/a><\/h1>/u);
            expect(childHtml).toContain('href="#child-heading"');
        });

        it('resolves workspace-rooted section links when exporting linked Markdown', async () => {
            const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
            temporaryDirectories.push(directory);
            await fs.mkdir(path.join(directory, 'guides'), { recursive: true });
            await fs.writeFile(
                path.join(directory, 'guides', 'overview.md'),
                '[Setup](/guides/setup.md#setup "MVE workspace-root link")\n',
                'utf8'
            );
            await fs.writeFile(
                path.join(directory, 'guides', 'setup.md'),
                '$$\n# A\n$$\n\n[^x]:\n  # B\n\n# Setup\n\n# Setup\n',
                'utf8'
            );
            vscodeMock.getWorkspaceFolder.mockImplementation((uri: TestUri) => {
                const documentPath = path.resolve(uri.fsPath);
                const workspacePath = path.resolve(directory);
                return documentPath.startsWith(`${workspacePath}${path.sep}`) || documentPath === workspacePath
                    ? { uri: new TestUri(workspacePath) }
                    : undefined;
            });

            const target = path.join(directory, 'out', 'index.html');
            vscodeMock.showSaveDialog.mockResolvedValue(new TestUri(target));
            const result = await exportHtml({
                markdown: '[Overview](/guides/overview.md "MVE workspace-root link")',
                html: '<p><a href="#" data-mve-link="/guides/overview.md" data-mve-workspace-rooted="true">Overview</a></p>',
                css: '',
                options: { embedImages: false, convertLinkedMarkdown: true, saveWithoutDialog: false },
                documentUri: new TestUri(path.join(directory, 'notes', 'source.md')) as any,
                language: 'en'
            });

            expect(result?.paths).toHaveLength(3);
            expect(result?.paths[0].fsPath).toBe(target);
            expect(result?.paths[1].fsPath.replace(/\\/g, '/')).toMatch(/(?:^|\/)out\/_linked\/[a-f0-9]{10}-overview\.html$/u);
            expect(result?.paths[2].fsPath.replace(/\\/g, '/')).toMatch(/(?:^|\/)out\/_linked\/[a-f0-9]{10}-setup\.html$/u);
            const main = await fs.readFile(target, 'utf8');
            expect(main).toContain('href="_linked/');
            expect(main).toContain('-overview.html"');
            expect(main).not.toContain('data-mve-workspace-rooted');
            const overview = await fs.readFile(result!.paths[1].fsPath, 'utf8');
            expect(overview).toMatch(/href="[a-f0-9]{10}-setup\.html#setup"/u);
            expect(overview).not.toContain('MVE workspace-root link');
            const setup = await fs.readFile(result!.paths[2].fsPath, 'utf8');
            expect(setup).toContain('<h1 id="setup">Setup</h1>');
            expect(setup).toContain('<h1 id="setup-1">Setup</h1>');
            expect(setup).not.toContain('<h1 id="a">');
            expect(setup).not.toContain('<h1 id="b">');
            expect(setup).toContain('<pre class="math-block"># A</pre>');
        });

        it('rewrites a nested workspace-root link relative to the exported HTML file', async () => {
            const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
            temporaryDirectories.push(workspaceRoot);
            const sampleDirectory = path.join(workspaceRoot, 'sample');
            await fs.mkdir(sampleDirectory, { recursive: true });
            await fs.writeFile(
                path.join(sampleDirectory, '04-tables.md'),
                '# GFMテーブル総合確認\n',
                'utf8'
            );
            vscodeMock.getWorkspaceFolder.mockReturnValue({ uri: new TestUri(workspaceRoot) } as any);

            const markdown = '[GFMテーブル総合確認](/sample/04-tables.md#gfmテーブル総合確認 "MVE workspace-root link")';
            const target = path.join(sampleDirectory, '03-images.html');
            vscodeMock.showSaveDialog.mockResolvedValue(new TestUri(target));
            const result = await exportHtml({
                markdown,
                html: renderMarkdownUnsafe(markdown, { remoteImagesEnabled: true, language: 'ja' }),
                css: '',
                options: { embedImages: false, convertLinkedMarkdown: true, saveWithoutDialog: false },
                documentUri: new TestUri(path.join(sampleDirectory, '03-images.md')) as any,
                language: 'ja'
            });

            expect(result?.paths).toHaveLength(2);
            const rootHtml = await fs.readFile(target, 'utf8');
            const linkedHtml = await fs.readFile(path.join(sampleDirectory, '04-tables.html'), 'utf8');
            const linkedHtmlPath = path.join(sampleDirectory, '04-tables.html');
            const exportedFragment = /href="04-tables\.html#([^"]+)"/u.exec(rootHtml)?.[1];
            const exportedHeadingId = /<h1 id="([^"]+)"/u.exec(linkedHtml)?.[1];
            expect(decodeURIComponent(exportedFragment ?? '')).toBe(exportedHeadingId);
            expect(new URL(`04-tables.html#${exportedFragment ?? ''}`, pathToFileURL(target)).href)
                .toBe(`${pathToFileURL(linkedHtmlPath).href}#${exportedFragment ?? ''}`);
        });

        it('exports a document-relative link when the workspace marker remains', async () => {
            const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
            temporaryDirectories.push(workspaceRoot);
            const sampleDirectory = path.join(workspaceRoot, 'sample');
            await fs.mkdir(sampleDirectory, { recursive: true });
            await fs.writeFile(path.join(sampleDirectory, '04-tables.md'), '# GFMテーブル総合確認\n', 'utf8');
            vscodeMock.getWorkspaceFolder.mockReturnValue({ uri: new TestUri(workspaceRoot) } as any);

            const markdown = '[GFMテーブル総合確認](./04-tables.md#gfmテーブル総合確認 "MVE workspace-root link")';
            const target = path.join(sampleDirectory, '03-images.html');
            vscodeMock.showSaveDialog.mockResolvedValue(new TestUri(target));
            const result = await exportHtml({
                markdown,
                html: renderMarkdownUnsafe(markdown, { remoteImagesEnabled: true, language: 'ja' }),
                css: '',
                options: { embedImages: false, convertLinkedMarkdown: true, saveWithoutDialog: false },
                documentUri: new TestUri(path.join(sampleDirectory, '03-images.md')) as any,
                language: 'ja'
            });

            expect(result?.paths).toHaveLength(2);
            const rootHtml = await fs.readFile(target, 'utf8');
            expect(rootHtml).toMatch(/href="04-tables\.html#[^"]+"/u);
            expect(rootHtml).not.toContain('data-mve-workspace-rooted');
        });

        it('converts inline single-quoted and reference-style workspace links to exported HTML', async () => {
            const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
            temporaryDirectories.push(directory);
            await fs.mkdir(path.join(directory, 'guides'), { recursive: true });
            await fs.writeFile(path.join(directory, 'guides', 'setup.md'), '# Setup\n', 'utf8');
            vscodeMock.getWorkspaceFolder.mockImplementation((uri: TestUri) => {
                const documentPath = path.resolve(uri.fsPath);
                const workspacePath = path.resolve(directory);
                return documentPath.startsWith(`${workspacePath}${path.sep}`) || documentPath === workspacePath
                    ? { uri: new TestUri(workspacePath) }
                    : undefined;
            });

            const escapedTitle = String.raw`"see \"this\""`;
            const linkForms = [
                {
                    name: 'inline',
                    markdown: "[Setup](/guides/setup.md#setup 'MVE workspace-root link')"
                },
                {
                    name: 'reference',
                    markdown: '[Setup][setup]\n\n[setup]: /guides/setup.md#setup "MVE workspace-root link"'
                },
                {
                    name: 'reference-multiline',
                    markdown: '[Setup][setup]\n\n[setup]: /guides/setup.md#setup\n  "MVE workspace-root link"'
                },
                {
                    name: 'reference-multiline-unindented',
                    markdown: '[Setup][setup]\n\n[setup]: /guides/setup.md#setup\n"MVE workspace-root link"'
                },
                {
                    name: 'reference-multiline-four-spaces',
                    markdown: '[Setup][setup]\n\n[setup]: /guides/setup.md#setup\n    "MVE workspace-root link"'
                },
                {
                    name: 'reference-multiline-blockquote',
                    markdown: '> [Setup][setup]\n>\n> [setup]: /guides/setup.md#setup\n>  "MVE workspace-root link"'
                },
                {
                    name: 'reference-escaped-marker',
                    markdown: '[Setup][setup]\n\n[setup]: /guides/setup.md#setup "MVE workspace\\-root link"'
                },
                {
                    name: 'reference-escaped-title',
                    markdown: `[Setup][setup]\n\n[setup]: guides/setup.md#setup ${escapedTitle}`,
                    workspaceRooted: false
                }
            ];

            for (const linkForm of linkForms) {
                const target = path.join(directory, 'out', `${linkForm.name}.html`);
                vscodeMock.showSaveDialog.mockResolvedValue(new TestUri(target));
                const html = renderMarkdownUnsafe(linkForm.markdown, { remoteImagesEnabled: true, language: 'en' });
                if (linkForm.workspaceRooted === false) {
                    expect(html).not.toContain('data-mve-workspace-rooted="true"');
                } else {
                    expect(html).toContain('data-mve-workspace-rooted="true"');
                }
                const result = await exportHtml({
                    markdown: linkForm.markdown,
                    html,
                    css: '',
                    options: { embedImages: false, convertLinkedMarkdown: true, saveWithoutDialog: false },
                    documentUri: new TestUri(path.join(directory, `${linkForm.name}.md`)) as any,
                    language: 'en'
                });

                expect(result?.paths, linkForm.name).toHaveLength(2);
                const output = await fs.readFile(target, 'utf8');
                expect(output).toContain('href="guides/setup.html#setup"');
                expect(result!.paths[1].fsPath).toBe(path.join(directory, 'out', 'guides', 'setup.html'));
                expect(await fs.readFile(result!.paths[1].fsPath, 'utf8')).toContain('<h1 id="setup">Setup</h1>');
            }
        });

        it('keeps workspace-rooted links after a page break pointed at the exported heading', async () => {
            const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
            temporaryDirectories.push(directory);
            const sourceDirectory = path.join(directory, 'sample');
            await fs.mkdir(sourceDirectory, { recursive: true });
            const sourcePath = path.join(sourceDirectory, '06-specification-template.md');
            const linkedPath = path.join(sourceDirectory, '03-images.md');
            await fs.writeFile(linkedPath, '## Ctrl+V確認欄\n\n見出しリンクの到達先です。\n', 'utf8');
            vscodeMock.getWorkspaceFolder.mockImplementation((uri: TestUri) => {
                const documentPath = path.resolve(uri.fsPath);
                const workspacePath = path.resolve(directory);
                return documentPath.startsWith(`${workspacePath}${path.sep}`) || documentPath === workspacePath
                    ? { uri: new TestUri(workspacePath) }
                    : undefined;
            });

            const target = path.join(directory, 'out', '06-specification-template.html');
            vscodeMock.showSaveDialog.mockResolvedValue(new TestUri(target));
            const markdown = '<!-- pagebreak -->\n[CtrlV確認欄](/sample/03-images.md#ctrlv確認欄 "MVE workspace-root link")';
            const result = await exportHtml({
                markdown,
                html: renderMarkdownUnsafe(markdown, { remoteImagesEnabled: true, language: 'ja' }),
                css: '',
                options: { embedImages: false, convertLinkedMarkdown: true, saveWithoutDialog: false },
                documentUri: new TestUri(sourcePath) as any,
                language: 'ja'
            });

            expect(result?.paths).toHaveLength(2);
            const rootHtml = await fs.readFile(target, 'utf8');
            const linkedHtml = await fs.readFile(path.join(directory, 'out', '03-images.html'), 'utf8');
            const linkedHtmlPath = path.join(directory, 'out', '03-images.html');
            expect(rootHtml).toContain('href="03-images.html#ctrlv%E7%A2%BA%E8%AA%8D%E6%AC%84"');
            expect(linkedHtml).toContain('<h2 id="ctrlv確認欄">Ctrl+V確認欄</h2>');
            const exportedHref = /<a href="([^"]+)">CtrlV確認欄<\/a>/u.exec(rootHtml)?.[1];
            const exportedFragment = exportedHref?.split('#', 2)[1];
            const exportedHeadingId = /<h2 id="([^"]+)"/u.exec(linkedHtml)?.[1];
            expect(decodeURIComponent(exportedFragment ?? '')).toBe(exportedHeadingId);
        });

        it('preserves encoded delimiters in workspace-rooted linked filenames', async () => {
            const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
            temporaryDirectories.push(directory);
            const sourcePath = path.join(directory, 'main.md');
            await fs.writeFile(path.join(directory, 'a#b.md'), '# Section\n', 'utf8');
            await fs.writeFile(path.join(directory, '100%20.md'), '# Section\n', 'utf8');
            vscodeMock.getWorkspaceFolder.mockReturnValue({ uri: new TestUri(directory) } as any);

            const target = path.join(directory, 'out', 'main.html');
            vscodeMock.showSaveDialog.mockResolvedValue(new TestUri(target));
            const result = await exportHtml({
                markdown: '[Hash](/a%23b.md#section "MVE workspace-root link")\n\n[Percent](/100%2520.md#section "MVE workspace-root link")',
                html: '<p><a href="#" data-mve-link="/a%23b.md#section" data-mve-workspace-rooted="true">Hash</a></p><p><a href="#" data-mve-link="/100%2520.md#section" data-mve-workspace-rooted="true">Percent</a></p>',
                css: '',
                options: { embedImages: false, convertLinkedMarkdown: true, saveWithoutDialog: false },
                documentUri: new TestUri(sourcePath) as any,
                language: 'en'
            });

            expect(result?.paths).toHaveLength(3);
            const rootHtml = await fs.readFile(target, 'utf8');
            expect(rootHtml).toContain('href="a%23b.html#section"');
            expect(rootHtml).toContain('href="100%2520.html#section"');
            await expect(fs.access(path.join(directory, 'out', 'a#b.html'))).resolves.toBeUndefined();
            await expect(fs.access(path.join(directory, 'out', '100%20.html'))).resolves.toBeUndefined();
        });

        it('encodes same-document Unicode fragments consistently with exported links', async () => {
            const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
            temporaryDirectories.push(directory);
            const sourcePath = path.join(directory, 'main.md');
            const target = path.join(directory, 'main.html');
            vscodeMock.showSaveDialog.mockResolvedValue(new TestUri(target));

            vscodeMock.getWorkspaceFolder.mockReturnValue({ uri: new TestUri(directory) } as any);
            const markdown = '## Ctrl+V確認欄\n\n[CtrlV確認欄](#ctrlv確認欄)\n\n[Workspace copy](/main.md#ctrlv確認欄 "MVE workspace-root link")';
            await exportHtml({
                markdown,
                html: renderMarkdownUnsafe(markdown, { remoteImagesEnabled: true, language: 'ja' }),
                css: '',
                options: { embedImages: false, convertLinkedMarkdown: false, saveWithoutDialog: false },
                documentUri: new TestUri(sourcePath) as any,
                language: 'ja'
            });

            const output = await fs.readFile(target, 'utf8');
            expect(output).toContain('<h2 id="ctrlv確認欄">Ctrl+V確認欄</h2>');
            expect(output).toContain('href="#ctrlv%E7%A2%BA%E8%AA%8D%E6%AC%84"');
            expect(output).toContain('href="main.html#ctrlv%E7%A2%BA%E8%AA%8D%E6%AC%84"');
            const exportedFragment = /href="#([^"]+)"/u.exec(output)?.[1];
            const exportedHeadingId = /<h2 id="([^"]+)"/u.exec(output)?.[1];
            expect(decodeURIComponent(exportedFragment ?? '')).toBe(exportedHeadingId);
        });

        it('adds the Markdown outline sidebar only when the HTML option is enabled',
            async () => {
                const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
                temporaryDirectories.push(directory);
                const markdown = '# Parent\n\n## Child\n\n### Grandchild\n\n## Sibling\n';
                const sourcePath = path.join(directory, 'outline.md');

                const withOutlineTarget = path.join(directory, 'with-outline.html');
                vscodeMock.showSaveDialog.mockResolvedValueOnce(new TestUri(withOutlineTarget));
                await exportHtml({
                    markdown,
                    html: renderMarkdownUnsafe(markdown, { remoteImagesEnabled: true, language: 'en' }),
                    css: '',
                    options: {
                        embedImages: false,
                        convertLinkedMarkdown: false,
                        showOutlineSidebar: true,
                        saveWithoutDialog: false,
                    },
                    documentUri: new TestUri(sourcePath) as any,
                    language: 'en'
                });

                const withOutline = await fs.readFile(withOutlineTarget, 'utf8');
                expect(withOutline).toContain('class="mve-html-layout mve-html-layout-with-outline"');
                expect(withOutline).toContain('<aside class="mve-html-outline" aria-label="Outline">');
                expect(withOutline).toContain('<a href="#parent">Parent</a>');
                expect(withOutline).toContain('<a href="#child">Child</a>');
                expect(withOutline).toContain('<a href="#grandchild">Grandchild</a>');
                expect(withOutline).toContain('<a href="#sibling">Sibling</a>');
                expect(withOutline).toContain('class="mve-html-outline-children"');
                expect(withOutline).toContain('<main class="mve-html">');

                const withoutOutlineTarget = path.join(directory, 'without-outline.html');
                vscodeMock.showSaveDialog.mockResolvedValueOnce(new TestUri(withoutOutlineTarget));
                await exportHtml({
                    markdown,
                    html: renderMarkdownUnsafe(markdown, { remoteImagesEnabled: true, language: 'en' }),
                    css: '',
                    options: {
                        embedImages: false,
                        convertLinkedMarkdown: false,
                        showOutlineSidebar: false,
                        saveWithoutDialog: false,
                    },
                    documentUri: new TestUri(sourcePath) as any,
                    language: 'en'
                });

                const withoutOutline = await fs.readFile(withoutOutlineTarget, 'utf8');
                expect(withoutOutline).not.toContain('mve-html-outline');
                expect(withoutOutline).not.toContain('mve-html-layout-with-outline');
                expect(withoutOutline).toContain('<main class="mve-html">');
            });

        it('adds the outline sidebar to linked Markdown HTML when conversion is enabled',
            async () => {
                const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
                temporaryDirectories.push(directory);
                await fs.writeFile(path.join(directory, 'child.md'), '# Child\n\n## Details\n', 'utf8');
                const target = path.join(directory, 'index.html');
                const markdown = '[Child](child.md)';
                vscodeMock.showSaveDialog.mockResolvedValue(new TestUri(target));

                const result = await exportHtml({
                    markdown,
                    html: renderMarkdownUnsafe(markdown, { remoteImagesEnabled: true, language: 'en' }),
                    css: '',
                    options: {
                        embedImages: false,
                        convertLinkedMarkdown: true,
                        showOutlineSidebar: true,
                        saveWithoutDialog: false,
                    },
                    documentUri: new TestUri(path.join(directory, 'main.md')) as any,
                    language: 'en'
                });

                expect(result?.paths).toHaveLength(2);
                const child = await fs.readFile(path.join(directory, 'child.html'), 'utf8');
                expect(child).toContain('<aside class="mve-html-outline" aria-label="Outline">');
                expect(child).toContain('<a href="#child">Child</a>');
                expect(child).toContain('<a href="#details">Details</a>');
            });

        /** .mdの実出力でも混在MarkdownとTextileの見出し・phraseが同じHTML本文へ入ることを確認する。 */
        it('exports Markdown and Textile blocks together for mixed Markdown documents', async () => {
            const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
            temporaryDirectories.push(directory);
            const markdown = [
                '# Mixed Markdown',
                '',
                '**Markdown bold** remains Markdown.',
                '',
                'Textile +inserted+, -deleted-, and ??citation?? remain recognizable.',
                '',
                'h2. Textile heading'
            ].join('\n');
            const target = path.join(directory, 'mixed.html');
            vscodeMock.showSaveDialog.mockResolvedValue(new TestUri(target));
            await exportHtml({
                markdown,
                html: renderMarkdownUnsafe(markdown, {
                    remoteImagesEnabled: true,
                    language: 'en',
                    renderFormat: 'mixed'
                }),
                css: '',
                options: {
                    embedImages: false,
                    convertLinkedMarkdown: false,
                    showOutlineSidebar: true,
                    saveWithoutDialog: false
                },
                documentUri: new TestUri(path.join(directory, 'mixed.md')) as any,
                language: 'en'
            });

            const output = await fs.readFile(target, 'utf8');
            expect(output).toContain('<h1 id="mixed-markdown"><a class="mve-heading-anchor"');
            expect(output).toContain('Mixed Markdown</a></h1>');
            expect(output).toContain('<h2 id="textile-heading"><a class="mve-heading-anchor"');
            expect(output).toContain('Textile heading</a></h2>');
            expect(output).toContain('<strong>Markdown bold</strong>');
            expect(output).toContain('<ins>inserted</ins>');
            expect(output).toContain('<del>deleted</del>');
            expect(output).toContain('<cite>citation</cite>');
            expect(output).toContain('<a href="#textile-heading">Textile heading</a>');
            expect(output).not.toContain('h2. Textile heading');
            const evidenceDirectory = path.resolve('sample', 'textile', 'evidence');
            await fs.mkdir(evidenceDirectory, { recursive: true });
            await fs.writeFile(path.join(evidenceDirectory, 'mixed-export.html'), output, 'utf8');
        });

        it('exports beside the Markdown file without opening a save dialog by default',
            async () => {
                const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-html-'));
                temporaryDirectories.push(directory);
                const markdownPath = path.join(directory, 'overview.md');

                const result = await exportHtml({
                    markdown: '# Overview',
                    html: '<h1>Overview</h1>',
                    css: '',
                    options: { embedImages: false, convertLinkedMarkdown: false, saveWithoutDialog: true },
                    documentUri: new TestUri(markdownPath) as any,
                    language: 'en'
                });

                expect(vscodeMock.showSaveDialog).not.toHaveBeenCalled();
                expect(result?.target.fsPath).toBe(path.join(directory, 'overview.html'));
                expect(await fs.stat(path.join(directory, 'overview.html'))).toBeTruthy();
            });
    });

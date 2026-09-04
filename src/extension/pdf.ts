import * as vscode from 'vscode';
import type { Browser, BrowserContext } from 'playwright-core';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { PdfOptions } from '../shared/protocol';
import { getMessages, type SupportedLanguage } from '../shared/messages';

export interface PdfExportRequest {
    html: string;
    css: string;
    options: PdfOptions;
    documentUri: vscode.Uri;
    language: SupportedLanguage;
    purpose?: 'preview' | 'export';
    signal?: AbortSignal;
}

let sharedBrowser: Browser | undefined;
let sharedBrowserPromise: Promise<Browser> | undefined;
const PDF_ASSET_TIMEOUT_MS = 5_000;
const PDF_PREVIEW_ASSET_TIMEOUT_MS = 1_000;
const PDF_BROWSER_LAUNCH_TIMEOUT_MS = 5_000;
const PDF_PREVIEW_RENDER_TIMEOUT_MS = 10_000;
const PDF_EXPORT_RENDER_TIMEOUT_MS = 60_000;
const PDF_CONTEXT_CLOSE_TIMEOUT_MS = 2_000;

/**
 * Markdown本文をPDFへ出力し、保存されたPDFのURIを返す。
 * @param request PDF出力対象のHTML・CSS・設定・URI。
 * @returns 保存先のURI。保存ダイアログがキャンセルされた場合はundefined。
 * @throws ブラウザ起動、HTML設定、またはPDF出力に失敗した場合。
 */
export async function exportPdf(request: PdfExportRequest): Promise<vscode.Uri | undefined> {
    // 保存先を決め、HTMLをPDFへ変換してブラウザ資源を確実に解放する。
    const defaultUri = request.documentUri.with({
        path: request.documentUri.path.replace(/\.(?:md|markdown)$/i, '') + '.pdf'
    });
    const target = request.options.saveWithoutDialog
        ? defaultUri
        : await vscode.window.showSaveDialog({
            defaultUri,
            filters: { PDF: ['pdf'] },
            saveLabel: getMessages(request.language).ribbon.labels.exportPdf
        });
    if (!target) return undefined;

    // MarkdownのHTMLを単独で表示できる文書へ組み立て、PDF出力用ブラウザを起動する。
    const pdf = await renderPdf(request);
    await fs.writeFile(target.fsPath, pdf);
    return target;
}

/**
 * 印刷用HTMLをPDFバッファへ変換する。
 * 保存とプレビューの両方から共有し、レイアウト計算を一本化する。
 * @param request PDF変換対象のHTML・CSS・設定・URI。
 * @returns 生成済みPDFのバッファ。
 */
export async function renderPdf(request: PdfExportRequest): Promise<Buffer> {
    const startedAt = Date.now();
    const deadlineAt = startedAt + (request.purpose === 'preview'
        ? PDF_PREVIEW_RENDER_TIMEOUT_MS
        : PDF_EXPORT_RENDER_TIMEOUT_MS);
    const previewLog = request.purpose === 'preview'
        ? (stage: string) => console.info(`[Markdown Easy Visual Editor] PDF preview ${stage} (${Date.now() - startedAt}ms)`)
        : undefined;
    const html = await withRenderControl(
        () => buildStandaloneHtml(request),
        request.signal,
        deadlineAt,
        'HTML build'
    );
    previewLog?.(`HTML ready: ${html.length} chars`);
    const browser = await withRenderControl(
        () => acquirePdfBrowser(request.language),
        request.signal,
        deadlineAt,
        'browser launch'
    );
    previewLog?.('browser ready');
    let context: BrowserContext | undefined;
    let closePromise: Promise<void> | undefined;
    const closeContext = (): Promise<void> => {
        if (!context) return Promise.resolve();
        if (!closePromise) closePromise = closePdfContext(context);
        return closePromise;
    };
    const abortContext = () => { void closeContext(); };
    request.signal?.addEventListener('abort', abortContext, { once: true });
    try {
        context = await withRenderControl(
            () => browser.newContext({ javaScriptEnabled: false }),
            request.signal,
            deadlineAt,
            'browser context',
            abortContext,
            (lateContext) => closePdfContext(lateContext)
        );
        const page = await withRenderControl(
            () => context!.newPage(),
            request.signal,
            deadlineAt,
            'new page',
            abortContext,
            () => closeContext()
        );
        const assetTimeoutMs = request.purpose === 'preview'
            ? PDF_PREVIEW_ASSET_TIMEOUT_MS
            : PDF_ASSET_TIMEOUT_MS;
        await withRenderControl(
            () => page.route('**/*', async (route) => {
                const resource = route.request();
                if (resource.resourceType() !== 'image' || !/^https?:/i.test(resource.url())) {
                    await route.continue();
                    return;
                }
                try {
                    const response = await route.fetch({ timeout: assetTimeoutMs });
                    await route.fulfill({ response });
                } catch {
                    // 応答しないリモート画像はPDF全体を止めず、欠損画像として扱う。
                    await route.abort('timedout').catch(() => undefined);
                }
            }),
            request.signal,
            deadlineAt,
            'route setup',
            abortContext
        );
        // 印刷用メディアと指定されたページ設定を適用してPDFを書き出す。
        // 外部画像のloadを待つと、応答しないリモート画像でsetContent自体が無期限に止まる。
        // DOMの構築完了後に、フォント・画像だけを別途まとめて有限時間待つ。
        await withRenderControl(
            () => page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10_000 }),
            request.signal,
            deadlineAt,
            'DOM load',
            abortContext
        );
        previewLog?.('DOM ready');
        await withRenderControl(
            () => page.emulateMedia({ media: 'print' }),
            request.signal,
            deadlineAt,
            'print media',
            abortContext
        );
        // DOMContentLoaded後も、正常なローカル画像は読み込み完了まで待つ。
        // リモート画像は上のrouteで同じ時間内に成功または中断する。
        await withRenderControl(
            () => page.waitForLoadState('load', { timeout: assetTimeoutMs }).catch(() => undefined),
            request.signal,
            deadlineAt,
            'asset load',
            abortContext
        );
        previewLog?.('assets ready');
        const options = request.options;
        const pdf = await withRenderControl(
            () => page.pdf({
                format: options.format,
                landscape: options.orientation === 'landscape',
                printBackground: true,
                preferCSSPageSize: false,
                margin: {
                    top: `${options.margins.top}mm`,
                    right: `${options.margins.right}mm`,
                    bottom: `${options.margins.bottom}mm`,
                    left: `${options.margins.left}mm`
                },
                displayHeaderFooter: Boolean(options.header || options.footer),
                headerTemplate: template(options.header),
                footerTemplate: template(options.footer, true),
                tagged: request.purpose !== 'preview',
                outline: request.purpose !== 'preview'
            }),
            request.signal,
            deadlineAt,
            'PDF generation',
            abortContext
        );
        previewLog?.(`PDF ready: ${pdf.length} bytes`);
        return pdf;
    } finally {
        request.signal?.removeEventListener('abort', abortContext);
        await closeContext();
    }
}

/** PDF生成の各段階を中断・期限管理し、遅れて完了したリソースも解放する。 */
async function withRenderControl<T>(
    operationFactory: () => Promise<T>,
    signal: AbortSignal | undefined,
    deadlineAt: number,
    stage: string,
    onCancel?: () => void,
    lateCleanup?: (value: T) => void
): Promise<T> {
    if (signal?.aborted) throw new Error('PDF preview render was canceled.');
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) throw new Error(`PDF ${stage} timed out.`);

    const operation = Promise.resolve().then(operationFactory);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortHandler: (() => void) | undefined;
    let cancelled = false;
    let rejectCancellation: ((reason: Error) => void) | undefined;
    const cancellation = new Promise<never>((_, reject) => {
        rejectCancellation = reject;
    });
    const cancel = (reason: Error): void => {
        if (cancelled) return;
        cancelled = true;
        onCancel?.();
        void operation.then((value) => lateCleanup?.(value), () => undefined);
        rejectCancellation?.(reason);
    };

    timer = setTimeout(() => {
        console.warn(`[Markdown Easy Visual Editor] PDF ${stage} timed out.`);
        cancel(new Error(`PDF ${stage} timed out.`));
    }, remainingMs);
    if (signal) {
        abortHandler = () => cancel(new Error('PDF preview render was canceled.'));
        signal.addEventListener('abort', abortHandler, { once: true });
    }
    try {
        return await Promise.race([operation, cancellation]);
    } finally {
        if (timer) clearTimeout(timer);
        if (abortHandler) signal?.removeEventListener('abort', abortHandler);
        if (!cancelled) void operation.catch(() => undefined);
    }
}

async function closePdfContext(context: BrowserContext): Promise<void> {
    const close = context.close().catch(() => undefined);
    await Promise.race([
        close,
        new Promise<void>((resolve) => setTimeout(resolve, PDF_CONTEXT_CLOSE_TIMEOUT_MS))
    ]);
}

/** Extension lifecycle終了時に共有Chromiumを解放する。 */
export async function closePdfBrowser(): Promise<void> {
    const browser = sharedBrowser;
    sharedBrowser = undefined;
    if (browser?.isConnected()) await browser.close();
}

/** PDFプレビューの連続要求でChromiumを毎回起動しないよう、ブラウザプロセスを共有する。 */
export async function acquirePdfBrowser(language: SupportedLanguage): Promise<Browser> {
    if (sharedBrowser?.isConnected()) return sharedBrowser;
    if (!sharedBrowserPromise) {
        sharedBrowserPromise = launchPdfBrowser(language).then((browser) => {
            sharedBrowser = browser;
            browser.on('disconnected', () => {
                if (sharedBrowser === browser) sharedBrowser = undefined;
            });
            return browser;
        }).finally(() => {
            sharedBrowserPromise = undefined;
        });
    }
    return sharedBrowserPromise;
}

/**
 * HTML・CSS・ローカル画像をPDF印刷用の単独HTMLへ組み立てる。
 * @param request PDF出力対象のHTML・CSS・文書URI。
 * @returns PDF印刷へ渡す完全なHTML。
 */
export async function buildStandaloneHtml(request: PdfExportRequest): Promise<string> {
    // 危険なHTMLを除去し、ローカル画像を埋め込んだ本文と印刷用CSSからHTMLを作る。
    let body = stripUnsafeMarkup(request.html);
    body = await embedLocalImages(body, request.documentUri);
    const css = request.css.replace(/<\/style/gi, '<\\/style');
    return `<!doctype html><html lang="${request.language}"><head><meta charset="utf-8"><style>${css}\n${PRINT_CSS}</style></head><body><main class="mve-print">${body}</main></body></html>`;
}

/**
 * HTML内のローカル画像を読み込み、PDFから参照できるData URLへ埋め込む。
 * @param html 画像タグを含むHTML。
 * @param documentUri 相対画像パスの基準となる文書URI。
 * @returns ローカル画像を埋め込んだHTML。
 */
async function embedLocalImages(html: string, documentUri: vscode.Uri): Promise<string> {
    // HTML内の相対画像を解決し、読み込めた画像だけをData URLへ置き換える。
    const matches = [...html.matchAll(/<img\b[^>]*>/gi)];
    let result = html;
    for (const match of matches) {
        const tag = match[0];
        // data-original-srcを優先して画像元を取得し、外部参照や埋め込み済み画像は処理しない。
        const original = decodeImageSource(
            readHtmlAttribute(tag, 'data-original-src') ?? readHtmlAttribute(tag, 'src')
        );
        if (!original || /^(?:https?:|data:|blob:|#|\/\/)/i.test(original)) continue;
        try {
            const imageUri = resolveLocalImageUri(documentUri, original);
            if (!imageUri) continue;
            const bytes = imageUri.scheme === 'file'
                ? await fs.readFile(imageUri.fsPath)
                : await vscode.workspace.fs.readFile(imageUri);
            // 画像の拡張子からMIMEタイプを決め、Base64のData URLを作る。
            const mime = mimeFromPath(imageUri.path);
            const data = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
            const sourceAttribute = findHtmlAttribute(tag, 'src');
            if (!sourceAttribute) continue;
            const replacement = tag.slice(0, sourceAttribute.from)
                + `src="${data}"`
                + tag.slice(sourceAttribute.to);
            result = result.replace(tag, replacement);
        } catch {
            // 画像を読めない場合は元のタグを残し、診断で表示済みの壊れた画像状態を維持する。
        }
    }
    return result;
}

/**
 * HTMLタグから指定属性の値だけを読み取る。
 * @param tag 解析するHTMLタグ。
 * @param name 読み取る属性名。
 * @returns 属性値。属性が見つからない場合はundefined。
 */
function readHtmlAttribute(tag: string, name: string): string | undefined {
    // HTML属性の位置情報を検索し、属性値だけを返す。
    return findHtmlAttribute(tag, name)?.value;
}

/**
 * HTMLタグ内の属性値と、値を置換するための文字位置を検索する。
 * @param tag 解析するHTMLタグ。
 * @param name 検索する属性名。
 * @returns 属性値と置換範囲。属性がない場合はundefined。
 */
function findHtmlAttribute(tag: string, name: string): { value: string; from: number; to: number } | undefined {
    // 引用符付き・引用符なしの属性値を検出し、置換対象の文字位置も返す。
    const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
    const match = pattern.exec(tag);
    if (!match || match.index === undefined) return undefined;
    const value = match[1] ?? match[2] ?? match[3];
    if (value === undefined) return undefined;
    return {
        value,
        from: match.index,
        to: match.index + match[0].length
    };
}

/**
 * HTMLエンティティとURLエンコードを復号して画像参照元を返す。
 * @param value HTML属性から読み取った画像参照元。
 * @returns 復号済みの画像参照元。入力が空ならundefined。
 */
function decodeImageSource(value: string | undefined): string | undefined {
    // HTMLエンティティとURLエンコードを順に戻し、画像参照元を復元する。
    if (!value) return undefined;
    const decoded = decodeHtml(value);
    try {
        return decodeURIComponent(decoded);
    } catch {
        return decoded;
    }
}

/**
 * 画像参照元を文書位置に基づくローカルまたは仮想ワークスペースURIへ解決する。
 * @param documentUri 画像パスの基準となる文書URI。
 * @param source 画像のfile URIまたは相対パス。
 * @returns 解決済みの画像URI。空の相対パスなど解決できない場合はundefined。
 */
function resolveLocalImageUri(documentUri: vscode.Uri, source: string): vscode.Uri | undefined {
    // file URI・ローカルファイル・仮想ワークスペースの相対パスをVS Code URIへ解決する。
    if (/^file:/i.test(source)) {
        try {
            return vscode.Uri.parse(source);
        } catch {
            return undefined;
        }
    }
    if (documentUri.scheme === 'file') {
        const normalized = source.replace(/\\/g, path.sep);
        const absolute = /^[A-Za-z]:[\\/]/.test(source) || path.isAbsolute(normalized)
            ? normalized
            : path.resolve(path.dirname(documentUri.fsPath), normalized);
        return vscode.Uri.file(absolute);
    }
    const baseDirectory = vscode.Uri.joinPath(documentUri, '..');
    const segments = source.replace(/\\/g, '/').split('/').filter(Boolean);
    return segments.length ? vscode.Uri.joinPath(baseDirectory, ...segments) : undefined;
}

/**
 * 設定値・Edge・Chromeの順にPDF出力用ブラウザを起動する。
 * @returns 起動したPlaywrightブラウザ。
 * @throws 利用可能なブラウザを起動できない場合。
 */
async function launchPdfBrowser(language: SupportedLanguage): Promise<Browser> {
    // Playwrightを遅延ロードし、設定・Edge・Chromeの順にPDF用ブラウザを探す。
    const { chromium } = await import('playwright-core');
    const configured = vscode.workspace.getConfiguration('markdownEasyVisualEditor').get<string>('pdf.browserPath', '').trim();
    if (configured) return chromium.launch({ executablePath: configured, headless: true, timeout: PDF_BROWSER_LAUNCH_TIMEOUT_MS });

    try {
        return await chromium.launch({ channel: 'msedge', headless: true, timeout: PDF_BROWSER_LAUNCH_TIMEOUT_MS });
    } catch (edgeError) {
        try {
            return await chromium.launch({ channel: 'chrome', headless: true, timeout: PDF_BROWSER_LAUNCH_TIMEOUT_MS });
        } catch (chromeError) {
            console.error('[Markdown Easy Visual Editor] EdgeとChromeの起動に失敗しました。', { edgeError, chromeError });
            throw new Error(getMessages(language).host.pdfBrowserUnavailable);
        }
    }
}

/**
 * PDFへ渡すHTMLからスクリプトやイベント属性などの危険なマークアップを除去する。
 * @param value 無害化するHTML文字列。
 * @returns 危険な要素を除去したHTML。
 */
function stripUnsafeMarkup(value: string): string {
    // スクリプト・イベント属性・javascript URLを取り除き、PDFへ渡すHTMLを無害化する。
    return value
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
        .replace(/javascript:/gi, '');
}

/**
 * ヘッダーまたはフッター文字列を印刷用HTMLテンプレートへ変換する。
 * @param value ヘッダーまたはフッターの表示文字列。
 * @param footer フッター用の中央寄せテンプレートにするかどうか。
 * @returns Chromiumの印刷ヘッダー・フッター用HTML。
 */
function template(value: string, footer = false): string {
    // ヘッダーまたはフッター文字列をHTMLへ変換し、ページ番号プレースホルダーを展開する。
    if (!value) return '<span></span>';
    const safe = escapeHtml(value)
        .replace(/\{page\}/g, '<span class="pageNumber"></span>')
        .replace(/\{pages\}/g, '<span class="totalPages"></span>');
    return `<div style="font-size:8px;width:100%;padding:0 15mm;text-align:${footer ? 'center' : 'left'};color:#666">${safe}</div>`;
}

/**
 * HTML属性や本文へ安全に埋め込めるよう特殊文字をエスケープする。
 * @param value エスケープ対象の文字列。
 * @returns HTMLエンティティへ変換した文字列。
 */
function escapeHtml(value: string): string {
    // HTMLへ埋め込めない文字をエンティティへ変換する。
    return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

/**
 * HTML属性に含まれる主要な文字エンティティを通常の文字へ戻す。
 * @param value デコード対象のHTML文字列。
 * @returns エンティティを復元した文字列。
 */
function decodeHtml(value: string): string {
    // 画像属性に含まれる主要なHTMLエンティティを元の文字へ戻す。
    return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/**
 * 画像ファイルの拡張子からPDF埋め込み用のMIMEタイプを求める。
 * @param filePath MIMEタイプを判定するファイルパス。
 * @returns 画像のMIMEタイプ。未対応拡張子はimage/png。
 */
function mimeFromPath(filePath: string): string {
    // ファイル拡張子に対応する画像MIMEタイプを返し、未知の拡張子はPNGとして扱う。
    const extension = path.extname(filePath).toLowerCase();
    return ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' } as Record<string, string>)[extension] || 'image/png';
}

const PRINT_CSS = `
  @page { size: auto; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font-family: "Noto Sans JP", "Yu Gothic UI", sans-serif; color: #202124; }
  .mve-print { max-width: none; }
  .page-break { break-after: page; }
  table { width: 100%; border-collapse: collapse; }
  table th, table td { word-break: normal; overflow-wrap: anywhere; }
  table th[data-mve-nowrap="true"], table td[data-mve-nowrap="true"] { white-space: nowrap; overflow-wrap: normal; }
  thead { display: table-header-group; }
  tr, img, pre, blockquote { break-inside: avoid; }
  img { max-width: 100%; height: auto; }
  a { color: inherit; text-decoration: underline; }
`;

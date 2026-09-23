/**
 * @fileoverview Markdown HTMLとPDF設定からChromiumでPDFを生成し、保存先へ書き出す。ブラウザーと一時リソースを解放する。
 */
import * as vscode from 'vscode';
import type { Browser, BrowserContext } from 'playwright-core';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
    normalizePdfOptions,
    type NormalizedPdfOptions,
    type PdfOptions,
    type PdfPaperFormat
} from '../shared/protocol';
import { getMessages, type SupportedLanguage } from '../shared/messages';
import { DEFAULT_FONT_FAMILY_STACK, fontFamilyForCss } from '../shared/fontFamily';

/**
 * PDF出力へ渡すHTML、CSS、設定、保存先をまとめた要求。
 */
export interface PdfExportRequest {
    /**
     * 表示または出力するHTML本文。
     */
    html: string;
    /**
     * PDFで解析・表示・保存する本文。
     */
    css: string;
    /**
     * 呼び出し側が指定する処理設定。
     */
    options: PdfOptions;
    /**
     * PDFで読み書きするリソースの場所。
     */
    documentUri: vscode.Uri;
    /**
     * PDFのlanguageに関する状態または設定。
     */
    language: SupportedLanguage;
    /**
     * PDFのpurposeに関する状態または設定。
     */
    purpose?: 'preview' | 'export';
    /**
     * 呼び出し側のキャンセルを通知するAbortSignal。
     */
    signal?: AbortSignal;
}


/**
 * PDFの位置・寸法・件数・時間を表す数値。
 */
let sharedBrowser: Browser | undefined;

/**
 * PDFの非同期処理を共有するPromise。
 */
let sharedBrowserPromise: Promise<Browser> | undefined;

/**
 * PDFの待機時間または期限。
 */
const PDF_ASSET_TIMEOUT_MS = 5_000;

/**
 * PDFの待機時間または期限。
 */
const PDF_PREVIEW_ASSET_TIMEOUT_MS = 1_000;

/**
 * PDFの待機時間または期限。
 */
const PDF_BROWSER_LAUNCH_TIMEOUT_MS = 5_000;

/**
 * PDFの待機時間または期限。
 */
const PDF_PREVIEW_RENDER_TIMEOUT_MS = 10_000;

/**
 * PDFの待機時間または期限。
 */
const PDF_EXPORT_RENDER_TIMEOUT_MS = 60_000;

/**
 * PDFの待機時間または期限。
 */
const PDF_CONTEXT_CLOSE_TIMEOUT_MS = 2_000;

/**
 * PDFのexport・pdfを処理し、呼び出し側へ結果または副作用を返す。
 * @param request - PDFへ渡す入力。
 * @returns 副作用を完了し、値は返さない。
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
 * PDFを表示用の結果へ変換する。
 * @param request - PDFへ渡す入力。
 * @returns PDFの非同期処理で得られる結果。
 */
export async function renderPdf(request: PdfExportRequest): Promise<Buffer> {
    const startedAt = Date.now();
    const deadlineAt = startedAt + (request.purpose === 'preview'
        ? PDF_PREVIEW_RENDER_TIMEOUT_MS
        : PDF_EXPORT_RENDER_TIMEOUT_MS);
    const previewLog = request.purpose === 'preview'
        ?
        /**
         * stageをinfoへ渡し、PDFの結果または副作用を処理する。
         * @param stage - PDFで受け渡す文字列。
         * @returns 副作用を完了し、値は返さない。
         */
        (stage: string) => console.info(`[Markdown Easy Visual Editor] PDF preview ${stage} (${Date.now() - startedAt}ms)`)
        : undefined;
    const html = await withRenderControl(

        /**
         * 要素をbuild・standalone・htmlへ渡し、PDFの結果または副作用を処理する。
         * @returns 副作用を完了し、値は返さない。
         */
        () => buildStandaloneHtml(request),
        request.signal,
        deadlineAt,
        'HTML build'
    );
    previewLog?.(`HTML ready: ${html.length} chars`);
    const browser = await withRenderControl(

        /**
         * 要素をacquire・pdf・browserへ渡し、PDFの結果または副作用を処理する。
         * @returns 副作用を完了し、値は返さない。
         */
        () => acquirePdfBrowser(request.language),
        request.signal,
        deadlineAt,
        'browser launch'
    );
    previewLog?.('browser ready');
    let context: BrowserContext | undefined;
    let closePromise: Promise<void> | undefined;


    const closeContext = /**
     * PDFの処理またはリソースを終了し、後続利用可能な状態へ戻す。
     * @returns 副作用を完了し、値は返さない。
     */ (): Promise<void> => {
            if (!context) return Promise.resolve();
            if (!closePromise) closePromise = closePdfContext(context);
            return closePromise;
        };


    const abortContext = /**
     * PDFのabort・contextを処理し、呼び出し側へ結果または副作用を返す。
     * @returns PDFのabort・contextが生成する結果。
     */ () => { void closeContext(); };
    request.signal?.addEventListener('abort', abortContext, { once: true });
    try {
        context = await withRenderControl(

            /**
             * 要素をnew・contextへ渡し、PDFの結果または副作用を処理する。
             * @returns PDFのコールバックが生成する結果。
             */
            () => browser.newContext({ javaScriptEnabled: false }),
            request.signal,
            deadlineAt,
            'browser context',
            abortContext,

            /**
             * late・contextをclose・pdf・contextへ渡し、PDFの結果または副作用を処理する。
             * @param lateContext - PDFで扱う文字列または本文。
             * @returns PDFのコールバックが生成する結果。
             */
            (lateContext) => closePdfContext(lateContext)
        );
        const page = await withRenderControl(

            /**
             * 要素をnew・pageへ渡し、PDFの結果または副作用を処理する。
             * @returns PDFのコールバックが生成する結果。
             */
            () => context!.newPage(),
            request.signal,
            deadlineAt,
            'new page',
            abortContext,

            /**
             * 要素をclose・contextへ渡し、PDFの結果または副作用を処理する。
             * @returns PDFのコールバックが生成する結果。
             */
            () => closeContext()
        );
        const assetTimeoutMs = request.purpose === 'preview'
            ? PDF_PREVIEW_ASSET_TIMEOUT_MS
            : PDF_ASSET_TIMEOUT_MS;
        await withRenderControl(

            /**
             * 要素をrouteへ渡し、PDFの結果または副作用を処理する。
             * @returns PDFのコールバックが生成する結果。
             */
            () => page.route('**/*',
                /**
                 * routeをrequestへ渡し、PDFの結果または副作用を処理する。
                 * @param route - PDFへ渡す入力。
                 * @returns PDFのコールバックが生成する結果。
                 */
                async (route) => {
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
                        await route.abort('timedout').catch(
                            /**
                             * PDFのコールバックとして要素を処理する。
                             * @returns 副作用を完了し、値は返さない。
                             */
                            () => undefined);
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

            /**
             * 要素をset・contentへ渡し、PDFの結果または副作用を処理する。
             * @returns PDFのコールバックが生成する結果。
             */
            () => page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10_000 }),
            request.signal,
            deadlineAt,
            'DOM load',
            abortContext
        );
        previewLog?.('DOM ready');
        await withRenderControl(

            /**
             * 要素をemulate・mediaへ渡し、PDFの結果または副作用を処理する。
             * @returns PDFのコールバックが生成する結果。
             */
            () => page.emulateMedia({ media: 'print' }),
            request.signal,
            deadlineAt,
            'print media',
            abortContext
        );
        // DOMContentLoaded後も、正常なローカル画像は読み込み完了まで待つ。
        // リモート画像は上のrouteで同じ時間内に成功または中断する。
        await withRenderControl(

            /**
             * 要素をwait・for・load・stateへ渡し、PDFの結果または副作用を処理する。
             * @returns PDFのコールバックが生成する結果。
             */
            () => page.waitForLoadState('load', { timeout: assetTimeoutMs }).catch(
                /**
                 * PDFのコールバックとして要素を処理する。
                 * @returns 副作用を完了し、値は返さない。
                 */
                () => undefined),
            request.signal,
            deadlineAt,
            'asset load',
            abortContext
        );
        previewLog?.('assets ready');
        const options = normalizePdfOptions(request.options);
        const pdf = await withRenderControl(

            /**
             * 要素をpdfへ渡し、PDFの結果または副作用を処理する。
             * @returns PDFのコールバックが生成する結果。
             */
            () => page.pdf({
                ...pdfPaperOptions(options.format, options.orientation),
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

/**
 * PDFのwith・render・controlを処理し、呼び出し側へ結果または副作用を返す。
 * @param operationFactory - PDFの位置・寸法・件数・時間を表す数値。
 * @param signal - 呼び出し側のキャンセルを通知するAbortSignal。
 * @param deadlineAt - PDFの位置・寸法・件数・時間を表す数値。
 * @param stage - PDFで受け渡す文字列。
 * @param onCancel - PDFへ渡す入力。
 * @param lateCleanup - PDFへ渡す入力。
 * @returns PDFの非同期処理で得られる結果。
 */
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
    const cancellation = new Promise<never>(
        /**
         * 非同期処理の完了条件と失敗条件を待機側へ通知する。
         * @param _ - 引数位置を維持するための未使用値。
         * @param reject - Promiseの失敗を通知する関数。
         * @returns 非同期処理の完了値。
         */
        (_, reject) => {
            rejectCancellation = reject;
        });


    const cancel = /**
     * PDFの条件を判定する。
     * @param reason - 処理を中断または失敗させた理由。
     * @returns 条件が成立したかを示す真偽値。
     */ (reason: Error): void => {
            if (cancelled) return;
            cancelled = true;
            onCancel?.();
            void operation.then(
                /**
                 * PDFのコールバックとして値を処理する。
                 * @param value - 検証・変換・保存の対象となる値。
                 * @returns 副作用を完了し、値は返さない。
                 */
                (value) => lateCleanup?.(value),
                /**
                 * PDFのコールバックとして要素を処理する。
                 * @returns 副作用を完了し、値は返さない。
                 */
                () => undefined);
            rejectCancellation?.(reason);
        };

    timer = setTimeout(
        /**
         * 指定時間の経過後に後続処理を実行する。
         * @returns 副作用を完了し、値は返さない。
         */
        () => {
            console.warn(`[Markdown Easy Visual Editor] PDF ${stage} timed out.`);
            cancel(new Error(`PDF ${stage} timed out.`));
        }, remainingMs);
    if (signal) {
        abortHandler =
            /**
             * PDFのabort・handlerを処理し、呼び出し側へ結果または副作用を返す。
             * @returns 副作用を完了し、値は返さない。
             */
            () => cancel(new Error('PDF preview render was canceled.'));
        signal.addEventListener('abort', abortHandler, { once: true });
    }
    try {
        return await Promise.race([operation, cancellation]);
    } finally {
        if (timer) clearTimeout(timer);
        if (abortHandler) signal?.removeEventListener('abort', abortHandler);
        if (!cancelled) void operation.catch(
            /**
             * PDFのコールバックとして要素を処理する。
             * @returns 副作用を完了し、値は返さない。
             */
            () => undefined);
    }
}

/**
 * PDFの処理またはリソースを終了し、後続利用可能な状態へ戻す。
 * @param context - PDFで扱う文字列または本文。
 * @returns 副作用を完了し、値は返さない。
 */
async function closePdfContext(context: BrowserContext): Promise<void> {
    const close = context.close().catch(
        /**
         * PDFのコールバックとして要素を処理する。
         * @returns 副作用を完了し、値は返さない。
         */
        () => undefined);
    await Promise.race([
        close,
        new Promise<void>(
            /**
             * 遅延処理の完了または失敗を待機側へ通知する。
             * @param resolve - Promiseの成功を通知する関数。
             * @returns 非同期処理の完了値。
             */
            (resolve) => setTimeout(resolve, PDF_CONTEXT_CLOSE_TIMEOUT_MS))
    ]);
}

/**
 * PDFの処理またはリソースを終了し、後続利用可能な状態へ戻す。
 * @returns 副作用を完了し、値は返さない。
 */
export async function closePdfBrowser(): Promise<void> {
    const browser = sharedBrowser;
    sharedBrowser = undefined;
    if (browser?.isConnected()) await browser.close();
}

/**
 * PDFのacquire・pdf・browserを処理し、呼び出し側へ結果または副作用を返す。
 * @param language - PDFの対象や分岐を識別する値。
 * @returns PDFの非同期処理で得られる結果。
 */
export async function acquirePdfBrowser(language: SupportedLanguage): Promise<Browser> {
    if (sharedBrowser?.isConnected()) return sharedBrowser;
    if (!sharedBrowserPromise) {
        sharedBrowserPromise = launchPdfBrowser(language).then(
            /**
             * browserをonへ渡し、PDFの結果または副作用を処理する。
             * @param browser - PDFで走査または更新する要素。
             * @returns PDFで利用する文字列。
             */
            (browser) => {
                sharedBrowser = browser;
                browser.on('disconnected',
                    /**
                     * disconnectedイベントでifを実行する。
                     * @returns 副作用を完了し、値は返さない。
                     */
                    () => {
                        if (sharedBrowser === browser) sharedBrowser = undefined;
                    });
                return browser;
            }).finally(
                /**
                 * PDFのコールバックとして要素を処理する。
                 * @returns PDFで利用する文字列。
                 */
                () => {
                    sharedBrowserPromise = undefined;
                });
    }
    return sharedBrowserPromise;
}

/**
 * PDFで使う値または実行環境を組み立てる。
 * @param request - PDFへ渡す入力。
 * @returns PDFで利用する文字列。
 */
export async function buildStandaloneHtml(request: PdfExportRequest): Promise<string> {
    // 危険なHTMLを除去し、ローカル画像を埋め込んだ本文と印刷用CSSからHTMLを作る。
    const options = normalizePdfOptions(request.options);
    let body = stripUnsafeMarkup(request.html);
    body = await embedLocalImages(body, request.documentUri);
    const css = request.css.replace(/<\/style/gi, '<\\/style');
    return `<!doctype html><html lang="${request.language}"><head><meta charset="utf-8"><style>${css}\n${PRINT_CSS}\n${printOptionsCss(options)}</style></head><body><main class="mve-print">${body}</main></body></html>`;
}

/**
 * PDFの外部参照を出力へ埋め込む。
 * @param html - 表示または出力するHTML本文。
 * @param documentUri - PDFで読み書きするリソースの場所。
 * @returns PDFで利用する文字列。
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
 * PDFから必要な値またはリソースを取得する。
 * @param tag - PDFで受け渡す文字列。
 * @param name - PDFの対象や分岐を識別する値。
 * @returns 副作用を完了し、値は返さない。
 */
function readHtmlAttribute(tag: string, name: string): string | undefined {
    // HTML属性の位置情報を検索し、属性値だけを返す。
    return findHtmlAttribute(tag, name)?.value;
}

/**
 * PDFから必要な値またはリソースを取得する。
 * @param tag - PDFで受け渡す文字列。
 * @param name - PDFの対象や分岐を識別する値。
 * @returns PDFのfind・html・attributeが生成する結果。
 */
function findHtmlAttribute(tag: string, name: string): {
    /**
     * 検証・変換・保存の対象となる値。
     */
    value: string;
    /**
     * PDFのfromを表す数値。
     */
    from: number;
    /**
     * PDFのtoを表す数値。
     */
    to: number
} | undefined {
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
 * PDFの入力を構造化した値へ変換する。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns 副作用を完了し、値は返さない。
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
 * PDFから必要な値またはリソースを取得する。
 * @param documentUri - PDFで読み書きするリソースの場所。
 * @param source - 解析・描画・変換の起点となる本文。
 * @returns 条件に一致する値。未検出時はundefinedまたはnull。
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
 * PDFのlaunch・pdf・browserを処理し、呼び出し側へ結果または副作用を返す。
 * @param language - PDFの対象や分岐を識別する値。
 * @returns PDFの非同期処理で得られる結果。
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
 * PDFから不要または危険な情報を除去する。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns PDFで利用する文字列。
 */
function stripUnsafeMarkup(value: string): string {
    // スクリプト・イベント属性・javascript URLを取り除き、PDFへ渡すHTMLを無害化する。
    return value
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
        .replace(/javascript:/gi, '');
}

/**
 * PDFのtemplateを処理し、呼び出し側へ結果または副作用を返す。
 * @param value - 検証・変換・保存の対象となる値。
 * @param footer - PDFへ渡す入力。
 * @returns PDFで利用する文字列。
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
 * PDFの入力を許可された形式へ整える。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns PDFで利用する文字列。
 */
function escapeHtml(value: string): string {
    // HTMLへ埋め込めない文字をエンティティへ変換する。
    return value.replace(/[&<>"']/g,
        /**
         * PDFのコールバックとしてcharacterを処理する。
         * @param character - PDFへ渡す入力。
         * @returns PDFで利用する文字列。
         */
        (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

/**
 * PDFの入力を構造化した値へ変換する。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns PDFで利用する文字列。
 */
function decodeHtml(value: string): string {
    // 画像属性に含まれる主要なHTMLエンティティを元の文字へ戻す。
    return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/**
 * PDFのmime・from・pathを処理し、呼び出し側へ結果または副作用を返す。
 * @param filePath - 読み書きするファイルのパス。
 * @returns PDFで利用する文字列。
 */
function mimeFromPath(filePath: string): string {
    // ファイル拡張子に対応する画像MIMEタイプを返し、未知の拡張子はPNGとして扱う。
    const extension = path.extname(filePath).toLowerCase();
    return ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' } as Record<string, string>)[extension] || 'image/png';
}


/**
 * PDFで解析・表示・保存する本文。
 */
const PRINT_CSS = `
  @page { size: auto; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font-family: ${DEFAULT_FONT_FAMILY_STACK}; color: #202124; }
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

/**
 * PDFを出力または保存できる文字列へ整える。
 * @param options - 呼び出し側が指定する処理設定。
 * @returns PDFで利用する文字列。
 */
function printOptionsCss(options: NormalizedPdfOptions): string {
    const fontFamily = sanitizeCssFontFamily(options.fontFamily);
    const headings = options.headingFontSizes;
    return `
  body, .mve-print { font-family: ${fontFamily}; font-size: ${options.bodyFontSize}pt; line-height: ${options.lineHeight}; }
  .mve-print .rendered-markdown { font-size: inherit; line-height: inherit; }
  .mve-print h1 { font-size: ${headings.h1}pt; }
  .mve-print h2 { font-size: ${headings.h2}pt; }
  .mve-print h3 { font-size: ${headings.h3}pt; }
  .mve-print h4 { font-size: ${headings.h4}pt; }
  .mve-print h5 { font-size: ${headings.h5}pt; }
  .mve-print h6 { font-size: ${headings.h6}pt; }
  .mve-print pre, .mve-print code { font-size: ${options.codeFontSize}pt; }
  .mve-print p { margin-bottom: ${options.paragraphSpacing}pt; }
`;
}

/**
 * PDFの入力を許可された形式へ整える。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns PDFで利用する文字列。
 */
function sanitizeCssFontFamily(value: string): string {
    return fontFamilyForCss(value, DEFAULT_FONT_FAMILY_STACK);
}

/**
 * PDFのpdf・paper・optionsを処理し、呼び出し側へ結果または副作用を返す。
 * @param format - 本文または出力を解釈する形式。
 * @param orientation - PDFの用紙方向。
 * @returns PDFのpdf・paper・optionsが生成する結果。
 */
function pdfPaperOptions(
    format: PdfPaperFormat,
    orientation: PdfOptions['orientation']
): {
    /**
     * 本文または出力を解釈する形式。
     */
    format?: string;
    /**
     * 表示領域または列の幅。
     */
    width?: string;
    /**
     * 表示領域または行の高さ。
     */
    height?: string;
    /**
     * PDFのlandscapeを切り替えるフラグ。
     */
    landscape?: boolean
} {
    if (format === 'B4' || format === 'B5') {
        const dimensions = format === 'B4'
            ? { width: 257, height: 364 }
            : { width: 182, height: 257 };
        const width = orientation === 'landscape' ? dimensions.height : dimensions.width;
        const height = orientation === 'landscape' ? dimensions.width : dimensions.height;
        return { width: `${width}mm`, height: `${height}mm`, landscape: false };
    }
    return { format, landscape: orientation === 'landscape' };
}

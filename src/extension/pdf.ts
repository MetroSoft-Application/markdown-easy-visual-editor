/**
 * @file pdf.ts
 * 実行境界: Extension Host。
 * 責務: VS Code文書、Webview、外部リソースを連携する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: 文書、ファイル、Webview、ブラウザーなどの外部状態を必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
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
 * 「PdfExportRequest」が満たすデータ契約を定義します。
 */
export interface PdfExportRequest {
    /**
     * PDF本文として出力する、サニタイズ前のWebview生成HTML。
     */
    html: string;
    /**
     * PDF本文へ適用する、Webviewから収集したCSS。
     */
    css: string;
    /**
     * 用紙・余白・タイポグラフィを含むPDF印刷設定。旧形式も受け付ける。
     */
    options: PdfOptions;
    /**
     * 相対画像の解決基準になるMarkdown文書URI。
     */
    documentUri: vscode.Uri;
    /**
     * standalone HTMLのlang属性とエラーメッセージに使う言語。
     */
    language: SupportedLanguage;
    /**
     * 実PDF保存か、短い期限で返す印刷プレビューかを区別する目的。
     */
    purpose?: 'preview' | 'export';
    /**
     * プレビューの古い要求を中断し、ブラウザ資源を早期解放するためのシグナル。
     */
    signal?: AbortSignal;
}

/** 「sharedBrowser」は、ブラウザー処理の共有状態または実行設定です。 */
/** PDF出力で共有するChromiumブラウザー。文書ごとの起動を避けて起動コストを抑える。 */
let sharedBrowser: Browser | undefined;
/** 「sharedBrowserPromise」は、非同期初期化または処理の重複を防ぐ共有Promiseです。 */
/** Chromium起動中の処理を共有し、同時要求が複数プロセスを作らないようにするPromise。 */
let sharedBrowserPromise: Promise<Browser> | undefined;
/** 「PDF_ASSET_TIMEOUT_MS」は、時間制限または遅延量を処理間で共有する値です。 */
/** PDF資産の読み込みを待機する上限時間。 */
const PDF_ASSET_TIMEOUT_MS = 5_000;
/** 「PDF_PREVIEW_ASSET_TIMEOUT_MS」は、時間制限または遅延量を処理間で共有する値です。 */
/** PDFプレビュー用資産の短い読み込み上限時間。 */
const PDF_PREVIEW_ASSET_TIMEOUT_MS = 1_000;
/** 「PDF_BROWSER_LAUNCH_TIMEOUT_MS」は、時間制限または遅延量を処理間で共有する値です。 */
/** PDF用Chromiumを起動する上限時間。 */
const PDF_BROWSER_LAUNCH_TIMEOUT_MS = 5_000;
/** 「PDF_PREVIEW_RENDER_TIMEOUT_MS」は、時間制限または遅延量を処理間で共有する値です。 */
/** プレビュー描画を待機する上限時間。 */
const PDF_PREVIEW_RENDER_TIMEOUT_MS = 10_000;
/** 「PDF_EXPORT_RENDER_TIMEOUT_MS」は、時間制限または遅延量を処理間で共有する値です。 */
/** PDFファイル出力の描画を待機する上限時間。 */
const PDF_EXPORT_RENDER_TIMEOUT_MS = 60_000;
/** 「PDF_CONTEXT_CLOSE_TIMEOUT_MS」は、時間制限または遅延量を処理間で共有する値です。 */
/** PDF用ブラウザーコンテキストを閉じる上限時間。 */
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
        ?
        /**
 * 「stage」を受け取り、登録された副作用または結果を生成する処理です。
         * @param stage stageとして渡される、このコールバックの入力値です。
         * @returns 「stage」から生成した処理結果を返します。
         */
        (stage: string) => console.info(`[Markdown Easy Visual Editor] PDF preview ${stage} (${Date.now() - startedAt}ms)`)
        : undefined;
    const html = await withRenderControl(

        /**
 * 処理結果を生成する処理を実行するコールバックです。
         * @returns 非同期処理へ渡す完了結果を返します。
         */
        () => buildStandaloneHtml(request),
        request.signal,
        deadlineAt,
        'HTML build'
    );
    previewLog?.(`HTML ready: ${html.length} chars`);
    const browser = await withRenderControl(

        /**
 * 処理結果を生成する処理を実行するコールバックです。
         * @returns 非同期処理へ渡す完了結果を返します。
         */
        () => acquirePdfBrowser(request.language),
        request.signal,
        deadlineAt,
        'browser launch'
    );
    previewLog?.('browser ready');
    let context: BrowserContext | undefined;
    let closePromise: Promise<void> | undefined;

    /**
     * close・contextを解除または削除します。
     * @returns 非同期処理の完了を表すPromiseです。
     */
    const closeContext = /**
 * 「closeContext」は、処理を終了し、保持していたリソースまたは状態を整理します。
 * @returns 購読解除、タイマー解除、リソース破棄などの後片付けを実行し、値は返しません。
 */ (): Promise<void> => {
        if (!context) return Promise.resolve();
        if (!closePromise) closePromise = closePdfContext(context);
        return closePromise;
    };

    /**
     * 「abortContext」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
     * @returns 「abortContext」が生成または整形したPDFプレビュー・出力の文字列を返します。
     */
    const abortContext = /**
 * 「abortContext」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @returns 「abortContext」が生成または整形したPDFプレビュー・出力の文字列を返します。
 */ () => { void closeContext(); };
    request.signal?.addEventListener('abort', abortContext, { once: true });
    try {
        context = await withRenderControl(

            /**
             * イベント情報を受け取り、DOMまたは画面状態を更新するコールバックです。
             * @returns 「browser.newContext」の呼び出し結果を返します。
             */
            () => browser.newContext({ javaScriptEnabled: false }),
            request.signal,
            deadlineAt,
            'browser context',
            abortContext,

            /**
 * 受け取った値を検証し、呼び出し元が利用する処理結果を返すコールバックです。
             * @param lateContext lateContextとして渡される、このコールバックの入力値です。
             * @returns 「lateContext」から生成した処理結果を返します。
             */
            (lateContext) => closePdfContext(lateContext)
        );
        const page = await withRenderControl(

            /**
 * 受け取った入力または現在の状態を検証し、呼び出し元へ必要な処理結果を返すコールバックです。
             * @returns 「newPage」の呼び出し結果を返します。
             */
            () => context!.newPage(),
            request.signal,
            deadlineAt,
            'new page',
            abortContext,

            /**
 * 受け取った入力または現在の状態を検証し、呼び出し元へ必要な処理結果を返すコールバックです。
             * @returns 「closeContext」の呼び出し結果を返します。
             */
            () => closeContext()
        );
        const assetTimeoutMs = request.purpose === 'preview'
            ? PDF_PREVIEW_ASSET_TIMEOUT_MS
            : PDF_ASSET_TIMEOUT_MS;
        await withRenderControl(

            /**
             * 予約されたタイミングでタイマーまたはフレーム後の処理を実行するコールバックです。
             * @returns 「page.route」を実行し、値を返しません。
             */
            () => page.route('**/*',
            /**
             * 「async」として「route」を受け取り、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
             * @param route 「route」は、「async」がPDFプレビュー・出力の処理対象を特定する入力です。
             * @returns 「route.request」を実行し、値を返しません。
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
                     * Promiseの失敗理由を受け取り、エラー表示またはフォールバックを実行するコールバックです。
                     * @returns エラー処理またはフォールバックの結果を返します。
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
 * 非同期処理の失敗理由を受け取り、回復処理または代替値を生成するコールバックです。
             * @returns 「page.setContent」を実行し、値を返しません。
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
 * 登録された副作用または結果を生成する処理を実行するコールバックです。
             * @returns 「page.emulateMedia」の呼び出し結果を返します。
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
 * 非同期処理の失敗理由を受け取り、回復処理または代替値を生成するコールバックです。
             * @returns 「page.waitForLoadState」の呼び出し結果を返します。
             */
            () => page.waitForLoadState('load', { timeout: assetTimeoutMs }).catch(
            /**
             * Promiseの失敗理由を受け取り、エラー表示またはフォールバックを実行するコールバックです。
             * @returns エラー処理またはフォールバックの結果を返します。
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
 * 非同期処理の失敗理由を受け取り、回復処理または代替値を生成するコールバックです。
             * @returns 「page.pdf」の呼び出し結果を返します。
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
 * PDF生成の各段階を中断・期限管理し、遅れて完了したリソースも解放する。
 * @param operationFactory 表示領域のサイズまたは倍率で、画面レイアウト計算に使用します。
 * @param signal 処理対象のシグナルです。
 * @param deadlineAt 「deadlineAt」は、「withRenderControl」がPDFプレビュー・出力の処理対象を特定する入力です。
 * @param stage 「stage」は、「withRenderControl」がPDFプレビュー・出力の処理対象を特定する入力です。
 * @param onCancel 処理完了時に呼び出すコールバックです。
 * @param lateCleanup 「lateCleanup」は、「withRenderControl」がPDFプレビュー・出力の処理対象を特定する入力です。
 * @returns 非同期処理の完了を表すPromiseです。
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
 * 非同期処理の完了値を受け取り、次の処理へ渡す結果を生成するコールバックです。
     * @param _ 呼び出し側が渡すが、このコールバックでは使用しない値です。
     * @param reject Promiseの完了または失敗を通知する関数です。
     * @returns 解決値を処理した結果を返します。
     */
    (_, reject) => {
        rejectCancellation = reject;
    });

    /**
     * cancelを解除または削除します。
     * @param reason 失敗した処理の原因または例外情報です。
     * @returns 購読解除、タイマー解除、またはリソース破棄を実行して値は返しません。
     */
    const cancel = /**
 * 「cancel」は、処理を終了し、保持していたリソースまたは状態を整理します。
 * @param reason 失敗した処理の原因または例外情報です。
 * @returns 条件を満たすかどうかを示す真偽値を返します。
 */ (reason: Error): void => {
        if (cancelled) return;
        cancelled = true;
        onCancel?.();
        void operation.then(
        /**
 * 非同期処理の完了値を受け取り、次の処理へ渡す結果を生成するコールバックです。
         * @param value 「value」で検証・変換する入力値です。
         * @returns 解決値を処理した結果を返します。
         */
        (value) => lateCleanup?.(value),
        /**
         * Promiseの解決値を受け取り、後続の表示または状態更新へ渡すコールバックです。
         * @returns 解決値を処理した結果を返します。
         */
        () => undefined);
        rejectCancellation?.(reason);
    };

    timer = setTimeout(
    /**
 * 指定時間の経過後に遅延処理を実行するコールバックです。
     * @returns 「console.warn」の呼び出し結果を返します。
     */
    () => {
        console.warn(`[Markdown Easy Visual Editor] PDF ${stage} timed out.`);
        cancel(new Error(`PDF ${stage} timed out.`));
    }, remainingMs);
    if (signal) {
        abortHandler =
        /**
 * 指定時間の経過後に遅延処理を実行するコールバックです。
         * @returns 「cancel」を実行し、値を返しません。
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
         * Promiseの失敗理由を受け取り、エラー表示またはフォールバックを実行するコールバックです。
         * @returns エラー処理またはフォールバックの結果を返します。
         */
        () => undefined);
    }
}

/**
 * close・pdf・contextを解除または削除します。
 * @param context 「context」は、「closePdfContext」がPDFプレビュー・出力の処理対象を特定する入力です。
 * @returns 非同期処理の完了を表すPromiseです。
 */
async function closePdfContext(context: BrowserContext): Promise<void> {
    const close = context.close().catch(
    /**
     * Promiseの失敗理由を受け取り、エラー表示またはフォールバックを実行するコールバックです。
     * @returns エラー処理またはフォールバックの結果を返します。
     */
    () => undefined);
    await Promise.race([
        close,
        new Promise<void>(
        /**
         * 予約されたタイミングで「resolve」を受け取り、遅延処理を実行するコールバックです。
         * @param resolve Promiseの完了または失敗を通知する関数です。
         * @returns エラー処理またはフォールバックの結果を返します。
         */
        (resolve) => setTimeout(resolve, PDF_CONTEXT_CLOSE_TIMEOUT_MS))
    ]);
}

/**
 * Extension lifecycle終了時に共有Chromiumを解放する。
 * @returns 非同期処理の完了を表すPromiseです。
 */
export async function closePdfBrowser(): Promise<void> {
    const browser = sharedBrowser;
    sharedBrowser = undefined;
    if (browser?.isConnected()) await browser.close();
}

/**
 * PDFプレビューの連続要求でChromiumを毎回起動しないよう、ブラウザプロセスを共有する。
 * @param language 表示文言の解決に使用する言語コードまたはロケールです。
 * @returns 非同期処理の完了を表すPromiseです。
 */
export async function acquirePdfBrowser(language: SupportedLanguage): Promise<Browser> {
    if (sharedBrowser?.isConnected()) return sharedBrowser;
    if (!sharedBrowserPromise) {
        sharedBrowserPromise = launchPdfBrowser(language).then(
        /**
 * 非同期処理の完了値を受け取り、次の処理へ渡す結果を生成するコールバックです。
         * @param browser browserとして渡される、このコールバックの入力値です。
         * @returns 解決値を処理した結果を返します。
         */
        (browser) => {
            sharedBrowser = browser;
            browser.on('disconnected',
            /**
             * Promiseの解決値を受け取り、後続の表示または状態更新へ渡すコールバックです。
             * @returns 解決値を処理した結果を返します。
             */
            () => {
                if (sharedBrowser === browser) sharedBrowser = undefined;
            });
            return browser;
        }).finally(
        /**
         * Promiseの成否にかかわらず、購読解除やリソース整理を実行するコールバックです。
         * @returns 置換後の文字列を返します。
         */
        () => {
            sharedBrowserPromise = undefined;
        });
    }
    return sharedBrowserPromise;
}

/**
 * HTML・CSS・ローカル画像をPDF印刷用の単独HTMLへ組み立てる。
 * CSSの末尾へ正規化済みの印刷設定を追加するため、画面プレビューと同じ設定を実PDFへ渡せる。
 * @param request PDF出力対象のHTML・CSS・文書URI。
 * @returns PDF印刷へ渡せる、危険なマークアップと相対画像を処理済みの完全なHTML。
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
function findHtmlAttribute(tag: string, name: string): {
/**
 * 「value」は、対象の内容または識別子を表す文字列です。
 */
value: string;
/**
 * 「from」は、本文または選択範囲の位置・長さを保持します。
 */
from: number;
/**
 * 「to」は、本文または選択範囲の位置・長さを保持します。
 */
to: number } | undefined {
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
 * @param language 表示文言の解決に使用する言語コードまたはロケールです。
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
    return value.replace(/[&<>"']/g,
    /**
 * 「character」から（value、filePath）のオブジェクトを生成して返すコールバックです。
     * @param character HTMLまたはテキストから取り出した対象文字列です。
     * @returns 置換後の文字列を返します。
     */
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
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

/** 「PRINT_CSS」は、関連する処理間で共有する設定値または状態です。 */
/**
 * PDF印刷時にWebviewの画面用スタイルを印刷用レイアウトへ合わせるCSS。
 * 改ページ、背景、画像幅の規則をここへ集約し、プレビューと保存結果の差を抑える。
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
 * PDF出力だけに適用する本文・見出し・コードの印刷スタイルを作る。
 * Webview画面のテーマや表示倍率には影響させず、PDFの紙面へだけ数値設定を反映する。
 * @param options すべての値が正規化済みのPDF設定。
 * @returns standalone HTMLの末尾へ追加するCSS文字列。
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
 * フォント指定へCSSの構造を持ち込ませず、フォント名とフォールバックだけを許可する。
 * @param value ユーザーが入力したフォントファミリー文字列。
 * @returns CSS宣言を壊さないよう制御文字と構造文字を除去したフォント指定。
 */
function sanitizeCssFontFamily(value: string): string {
    return fontFamilyForCss(value, DEFAULT_FONT_FAMILY_STACK);
}

/**
 * Playwright標準のA判、またはJIS寸法を明示するB4/B5のPDF用紙指定を作る。
 * @param format 選択された用紙種別。
 * @param orientation 用紙の向き。
 * @returns page.pdfへ渡す用紙指定。B判はmm指定、A判は標準format指定。
 */
function pdfPaperOptions(
    format: PdfPaperFormat,
    orientation: PdfOptions['orientation']
): {
/**
 * 「format」は、対象の内容または識別子を表す文字列です。
 */
format?: string;
/**
 * 「width」は、対象の位置、サイズ、件数、または範囲を保持します。
 */
width?: string;
/**
 * 「height」は、対象の位置、サイズ、件数、または範囲を保持します。
 */
height?: string;
/**
 * 「landscape」は、関連処理が共有する構造化データの一項目です。
 */
landscape?: boolean } {
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

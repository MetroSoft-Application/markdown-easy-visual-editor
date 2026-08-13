import * as vscode from 'vscode';
import type { Browser } from 'playwright-core';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { PdfOptions } from '../shared/protocol';
import { getMessages, type SupportedLanguage } from '../shared/messages';

export interface PdfExportRequest {
  html: string;
  css: string;
  options: PdfOptions;
  documentUri: vscode.Uri;
  extensionUri: vscode.Uri;
  language: SupportedLanguage;
  signal?: AbortSignal;
}

let sharedBrowser: Browser | undefined;
let sharedBrowserPromise: Promise<Browser> | undefined;

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
  const html = await buildStandaloneHtml(request);
  if (request.signal?.aborted) throw new Error('PDF preview render was canceled.');
  const browser = await acquirePdfBrowser(request.extensionUri, request.language);
  const context = await browser.newContext({ javaScriptEnabled: false });
  const abortContext = () => { void context.close().catch(() => undefined); };
  request.signal?.addEventListener('abort', abortContext, { once: true });
  try {
    if (request.signal?.aborted) throw new Error('PDF preview render was canceled.');
    const page = await context.newPage();
    // 印刷用メディアと指定されたページ設定を適用してPDFを書き出す。
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(`(async () => {
      await document.fonts.ready;
      await Promise.race([
        Promise.all(Array.from(document.images).map((image) => image.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
            image.addEventListener('load', () => resolve(), { once: true });
            image.addEventListener('error', () => resolve(), { once: true });
          }))),
        new Promise((resolve) => setTimeout(resolve, 5000))
      ]);
    })()`);
    const options = request.options;
    return await page.pdf({
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
      tagged: true,
      outline: true
    });
  } finally {
    request.signal?.removeEventListener('abort', abortContext);
    await context.close();
  }
}

/** Extension lifecycle終了時に共有Chromiumを解放する。 */
export async function closePdfBrowser(): Promise<void> {
  const browser = sharedBrowser;
  sharedBrowser = undefined;
  if (browser?.isConnected()) await browser.close();
}

/** PDFプレビューの連続要求でChromiumを毎回起動しないよう、ブラウザプロセスを共有する。 */
async function acquirePdfBrowser(extensionUri: vscode.Uri, language: SupportedLanguage): Promise<Browser> {
  if (sharedBrowser?.isConnected()) return sharedBrowser;
  if (!sharedBrowserPromise) {
    sharedBrowserPromise = launchPdfBrowser(extensionUri, language).then((browser) => {
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
 * 設定値・同梱ブラウザ・Edgeの順にPDF出力用ブラウザを起動する。
 * @param extensionUri 拡張機能のルートURI。
 * @returns 起動したPlaywrightブラウザ。
 * @throws 利用可能なブラウザを起動できない場合。
 */
async function launchPdfBrowser(extensionUri: vscode.Uri, language: SupportedLanguage): Promise<Browser> {
  // Playwrightを遅延ロードし、設定・同梱ブラウザ・Edgeの順にPDF用ブラウザを探す。
  const { chromium } = await import('playwright-core');
  const configured = vscode.workspace.getConfiguration('markdownEasyVisualEditor').get<string>('pdf.browserPath', '').trim();
  if (configured) return chromium.launch({ executablePath: configured, headless: true });

  const bundledRoot = vscode.Uri.joinPath(extensionUri, '.chromium').fsPath;
  const bundled = (await findFile(bundledRoot, 'chrome-headless-shell.exe')) ?? (await findFile(bundledRoot, 'chrome.exe'));
  if (bundled) return chromium.launch({ executablePath: bundled, headless: true });

  try {
    return await chromium.launch({ channel: 'msedge', headless: true });
  } catch (error) {
    console.error('[Markdown Easy Visual Editor] PDF用ブラウザの起動に失敗しました。', error);
    throw new Error(getMessages(language).host.pdfBrowserUnavailable);
  }
}

/**
 * 指定ディレクトリ以下を再帰検索し、名前が一致するファイルのパスを返す。
 * @param root 検索を開始するディレクトリ。
 * @param name 探すファイル名。
 * @returns 一致したファイルのパス。読み取り失敗または未発見時はundefined。
 */
async function findFile(root: string, name: string): Promise<string | undefined> {
  // ディレクトリを再帰的に走査し、指定名と一致する最初のファイルを返す。
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = path.join(root, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return candidate;
      if (entry.isDirectory()) {
        const nested = await findFile(candidate, name);
        if (nested) return nested;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
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

/**
 * @fileoverview Markdownプレビュー用HTMLを組み立て、テーマ・設定・リソースURIをWebviewへ渡す。HTMLへ入る値をエスケープする。
 */
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import * as vscode from 'vscode';
import { marked } from 'marked';
import { DEFAULT_PDF_OPTIONS, type HtmlExportOptions } from '../shared/protocol';
import { fontFamilyForCss } from '../shared/fontFamily';
import { collectLocalResourceReferences } from '../shared/markdown';
import { decodeLocalResourceSource } from './resourceCheck';

/**
 * HTMLで送受信するメッセージまたは要求のデータ形状。
 */
export interface HtmlExportRequest {

    /**
     * 解析・編集・変換の対象となるMarkdown本文。
     */
    markdown: string;

    /**
     * 表示または出力するHTML本文。
     */
    html: string;

    /**
     * HTMLで解析・表示・保存する本文。
     */
    css: string;

    /**
     * 呼び出し側が指定する処理設定。
     */
    options: HtmlExportOptions;

    /**
     * HTMLで読み書きするリソースの場所。
     */
    documentUri: vscode.Uri;

    /**
     * HTMLで扱うlanguageの文字列。
     */
    language: string;

    /**
     * HTMLで共有するフォント設定または移行状態。
     */
    fontFamily?: string;
}

/**
 * HTMLの処理結果と失敗時情報のデータ形状。
 */
export interface HtmlExportResult {

    /**
     * HTMLのtargetに関する状態または設定。
     */
    target: vscode.Uri;

    /**
     * HTMLで扱うpathsの一覧。
     */
    paths: vscode.Uri[];
}

/**
 * HTMLで共有するデータ形状を表すインターフェース。
 */
export interface HtmlDocument {

    /**
     * VS Codeまたはブラウザーが扱うリソースURI。
     */
    uri: vscode.Uri;

    /**
     * HTMLで読み書きするリソースの場所。
     */
    sourcePath: string;

    /**
     * 解析・編集・変換の対象となるMarkdown本文。
     */
    markdown: string;

    /**
     * 表示または出力するHTML本文。
     */
    html: string;

    /**
     * HTMLで読み書きするリソースの場所。
     */
    outputPath: string;
}

/**
 * HTMLで共有するデータ形状を表すインターフェース。
 */
export interface HtmlExportPreparation {

    /**
     * HTMLのtargetに関する状態または設定。
     */
    target: vscode.Uri;

    /**
     * 文書URIと開いている文書オブジェクトの対応表。
     */
    documents: HtmlDocument[];
}

/**
 * HTMLで共有するデータ形状を表すインターフェース。
 */
export interface HtmlRenderedDocument {

    /**
     * HTMLで扱うidの文字列。
     */
    id: string;

    /**
     * 表示または出力するHTML本文。
     */
    html: string;
}

/**
 * HTMLのexport・htmlを処理し、呼び出し側へ結果または副作用を返す。
 * @param request - HTMLへ渡す入力。
 * @returns 副作用を完了し、値は返さない。
 */
export async function exportHtml(request: HtmlExportRequest): Promise<HtmlExportResult | undefined> {
    const preparation = await prepareHtmlExport(request);
    if (!preparation) return undefined;
    return writePreparedHtml(request, preparation);
}

/**
 * HTMLで使う値または実行環境を組み立てる。
 * @param request - HTMLへ渡す入力。
 * @returns 副作用を完了し、値は返さない。
 */
export async function prepareHtmlExport(request: HtmlExportRequest): Promise<HtmlExportPreparation | undefined> {
    const defaultUri = request.documentUri.scheme === 'file'
        ? vscode.Uri.file(path.join(
            path.dirname(request.documentUri.fsPath),
            `${path.basename(request.documentUri.fsPath, path.extname(request.documentUri.fsPath))}.html`
        ))
        : undefined;
    const target = request.options.saveWithoutDialog && defaultUri
        ? defaultUri
        : await vscode.window.showSaveDialog({
            defaultUri,
            filters: { HTML: ['html', 'htm'] },
            saveLabel: 'HTML出力'
        });
    if (!target) return undefined;

    const targetPath = ensureHtmlExtension(target.fsPath);
    return {
        target: vscode.Uri.file(targetPath),
        documents: await collectDocuments(request, targetPath)
    };
}

/**
 * HTMLの値を保存先または共有状態へ書き出す。
 * @param request - HTMLへ渡す入力。
 * @param preparation - HTMLへ渡す入力。
 * @param renderedDocuments - HTMLへ渡す要素の一覧。
 * @returns HTMLの非同期処理で得られる結果。
 */
export async function writePreparedHtml(
    request: HtmlExportRequest,
    preparation: HtmlExportPreparation,
    renderedDocuments: readonly HtmlRenderedDocument[] = []
): Promise<HtmlExportResult> {
    const renderedById = new Map(renderedDocuments.map(
        /**
         * 各documentから識別子を取り出して一覧化する。
         * @param document - documentの識別子を参照する走査対象。
         * @returns 識別子を取り出した変換結果の一覧。
         */
        (document) => [normalizePath(document.id), document.html]));
    const documents = preparation.documents.map(
        /**
         * 各documentからsource・pathを取り出して一覧化する。
         * @param document - documentのsource・pathを参照する走査対象。
         * @returns source・pathを取り出した変換結果の一覧。
         */
        (document) => ({
            ...document,
            html: renderedById.get(normalizePath(document.sourcePath)) ?? document.html
        }));
    const output = await Promise.all(documents.map(
        /**
         * 各documentからhtmlを取り出して一覧化する。
         * @param document - documentのhtmlを参照する走査対象。
         * @returns htmlを取り出した変換結果の一覧。
         */
        async (document) => {
            const body = await rewriteBody(
                document.html,
                document.sourcePath,
                document.outputPath,
                documents,
                request.options
            );
            const standalone = buildStandaloneHtml(body, request.css, request.language, request.fontFamily);
            await fs.mkdir(path.dirname(document.outputPath), { recursive: true });
            await fs.writeFile(document.outputPath, standalone, 'utf8');
            return vscode.Uri.file(document.outputPath);
        }));

    return {
        target: preparation.target,
        paths: output
    };
}

/**
 * HTMLから必要な値またはリソースを取得する。
 * @param request - HTMLへ渡す入力。
 * @param targetPath - HTMLで読み書きするリソースの場所。
 * @returns HTMLに対応する要素の一覧。
 */
async function collectDocuments(request: HtmlExportRequest, targetPath: string): Promise<HtmlDocument[]> {
    const documents: HtmlDocument[] = [];
    const byPath = new Map<string, HtmlDocument>();
    const rootPath = request.documentUri.scheme === 'file'
        ? path.resolve(request.documentUri.fsPath)
        : '';
    const root = {
        uri: request.documentUri,
        sourcePath: rootPath,
        markdown: request.markdown,
        html: request.html,
        outputPath: targetPath
    } satisfies HtmlDocument;
    documents.push(root);
    if (!request.options.convertLinkedMarkdown || !rootPath) return documents;
    byPath.set(normalizePath(rootPath), root);

    for (let index = 0; index < documents.length; index += 1) {
        const document = documents[index];
        const references = collectLocalResourceReferences(document.markdown)
            .filter(
                /**
                 * 種別「link」のreferenceだけを残す。
                 * @param reference - referenceのkindを参照する走査対象。
                 * @returns 条件を満たした要素だけを含む一覧。
                 */
                (reference) => reference.kind === 'link');
        for (const reference of references) {
            const linkedUri = resolveLocalFileUri(document.uri, reference.source);
            if (!linkedUri || !isMarkdownPath(linkedUri.fsPath)) continue;
            const linkedPath = normalizePath(linkedUri.fsPath);
            if (byPath.has(linkedPath)) continue;
            let markdown: string;
            try {
                markdown = Buffer.from(await vscode.workspace.fs.readFile(linkedUri)).toString('utf8');
            } catch {
                // 存在しないリンクは元のリンクを残し、他のページの変換を継続する。
                continue;
            }
            const linkedDocument: HtmlDocument = {
                uri: linkedUri,
                sourcePath: linkedUri.fsPath,
                markdown,
                html: renderLinkedMarkdown(markdown),
                outputPath: outputPathFor(linkedUri.fsPath, rootPath, targetPath)
            };
            byPath.set(linkedPath, linkedDocument);
            documents.push(linkedDocument);
        }
    }
    return documents;
}

/**
 * HTMLを表示用の結果へ変換する。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @returns HTMLで利用する文字列。
 */
function renderLinkedMarkdown(markdown: string): string {
    const renderer = new marked.Renderer();
    renderer.image =
        /**
         * HTMLの入力を検証し、表示または保存に使う形式へ変換する。
         * @param options - 呼び出し側が指定する処理設定。
         * @returns HTMLで利用する文字列。
         */
        ({ href, title, text }) => {
            const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : '';
            return `<img src="${escapeAttribute(href)}" data-original-src="${escapeAttribute(href)}" alt="${escapeAttribute(text)}"${titleAttribute}>`;
        };
    return String(marked.parse(markdown, { gfm: true, renderer }));
}

/**
 * HTMLで使う値または実行環境を組み立てる。
 * @param body - HTMLの位置・寸法・件数・時間を表す数値。
 * @param css - HTMLで扱う文字列または本文。
 * @param language - HTMLの対象や分岐を識別する値。
 * @param fontFamily - HTMLの位置・寸法・件数・時間を表す数値。
 * @returns HTMLで利用する文字列。
 */
function buildStandaloneHtml(body: string, css: string, language: string, fontFamily?: string): string {
    const safeCss = css.replace(/<\/style/gi, '<\\/style');
    const safeFontFamily = fontFamilyForCss(fontFamily, DEFAULT_PDF_OPTIONS.fontFamily);
    return `<!doctype html><html lang="${escapeAttribute(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${safeCss}\n${HTML_CSS(safeFontFamily)}</style></head><body><main class="mve-html">${body}</main></body></html>`;
}

/**
 * HTMLのrewrite・bodyを処理し、呼び出し側へ結果または副作用を返す。
 * @param html - 表示または出力するHTML本文。
 * @param sourcePath - HTMLで読み書きするリソースの場所。
 * @param outputPath - HTMLで読み書きするリソースの場所。
 * @param documents - 文書URIと開いている文書オブジェクトの対応表。
 * @param options - 呼び出し側が指定する処理設定。
 * @returns HTMLで利用する文字列。
 */
async function rewriteBody(
    html: string,
    sourcePath: string,
    outputPath: string,
    documents: HtmlDocument[],
    options: HtmlExportOptions
): Promise<string> {
    let result = stripUnsafeMarkup(html);
    const imageTags = [...result.matchAll(/<img\b[^>]*>/gi)].map(
        /**
         * 各matchを変換して一覧化する。
         * @param match - HTMLへ渡す入力。
         * @returns 入力要素から生成した変換結果の一覧。
         */
        (match) => match[0]);
    for (const tag of imageTags) {
        const replacement = await rewriteImageTag(tag, sourcePath, outputPath, options);
        result = result.replace(tag, replacement);
    }
    result = result.replace(/<a\b[^>]*>/gi,
        /**
         * tagをrewrite・link・tagへ渡し、HTMLの結果または副作用を処理する。
         * @param tag - HTMLで受け渡す文字列。
         * @returns HTMLで利用する文字列。
         */
        (tag) => rewriteLinkTag(tag, sourcePath, outputPath, documents, options));
    return result.replace(/\sdata-(?:original-src|mve-[\w-]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '');
}

/**
 * HTMLのrewrite・image・tagを処理し、呼び出し側へ結果または副作用を返す。
 * @param tag - HTMLで受け渡す文字列。
 * @param sourcePath - HTMLで読み書きするリソースの場所。
 * @param outputPath - HTMLで読み書きするリソースの場所。
 * @param options - 呼び出し側が指定する処理設定。
 * @returns HTMLで利用する文字列。
 */
async function rewriteImageTag(
    tag: string,
    sourcePath: string,
    outputPath: string,
    options: HtmlExportOptions
): Promise<string> {
    const original = decodeHtmlValue(readAttribute(tag, 'data-original-src') ?? readAttribute(tag, 'src'));
    if (!original || isRemoteResource(original) || !sourcePath) return cleanDataAttributes(tag);
    const imagePath = resolveLocalPath(sourcePath, original);
    if (!imagePath) return cleanDataAttributes(tag);
    let nextSource: string;
    if (options.embedImages) {
        try {
            const bytes = await fs.readFile(imagePath);
            nextSource = `data:${mimeFromPath(imagePath)};base64,${bytes.toString('base64')}`;
        } catch {
            return cleanDataAttributes(tag);
        }
    } else {
        nextSource = relativeHref(outputPath, imagePath);
    }
    return replaceAttribute(cleanDataAttributes(tag), 'src', nextSource);
}

/**
 * HTMLのrewrite・link・tagを処理し、呼び出し側へ結果または副作用を返す。
 * @param tag - HTMLで受け渡す文字列。
 * @param sourcePath - HTMLで読み書きするリソースの場所。
 * @param outputPath - HTMLで読み書きするリソースの場所。
 * @param documents - 文書URIと開いている文書オブジェクトの対応表。
 * @param options - 呼び出し側が指定する処理設定。
 * @returns HTMLで利用する文字列。
 */
function rewriteLinkTag(
    tag: string,
    sourcePath: string,
    outputPath: string,
    documents: HtmlDocument[],
    options: HtmlExportOptions
): string {
    const original = decodeHtmlValue(readAttribute(tag, 'data-mve-link') ?? readAttribute(tag, 'href'));
    if (!original || original.startsWith('#') || isRemoteResource(original) || !sourcePath) {
        return cleanDataAttributes(tag);
    }
    const linkedPath = resolveLocalPath(sourcePath, original);
    if (!linkedPath) return cleanDataAttributes(tag);
    const linkedDocument = documents.find(
        /**
         * source・pathが条件に一致する最初のdocumentを取得する。
         * @param document - documentのsource・pathを参照する走査対象。
         * @returns 条件に一致した最初の要素。未検出時はundefined。
         */
        (document) => normalizePath(document.sourcePath) === normalizePath(linkedPath));
    const isMarkdown = isMarkdownPath(linkedPath);
    const destinationPath = options.convertLinkedMarkdown && isMarkdown && linkedDocument
        ? linkedDocument.outputPath
        : linkedPath;
    const fragment = readFragment(original);
    const destination = `${relativeHref(outputPath, destinationPath)}${fragment}`;
    return replaceAttribute(cleanDataAttributes(tag), 'href', destination);
}

/**
 * HTMLから必要な値またはリソースを取得する。
 * @param baseUri - HTMLで読み書きするリソースの場所。
 * @param source - 解析・描画・変換の起点となる本文。
 * @returns 条件に一致する値。未検出時はundefinedまたはnull。
 */
function resolveLocalFileUri(baseUri: vscode.Uri, source: string): vscode.Uri | undefined {
    const clean = decodeLocalResourceSource(source);
    if (!clean || isRemoteResource(clean)) return undefined;
    if (/^file:/i.test(clean)) {
        try {
            const parsed = vscode.Uri.parse(clean);
            return parsed.scheme === 'file' ? parsed : undefined;
        } catch {
            return undefined;
        }
    }
    if (baseUri.scheme !== 'file') return undefined;
    return vscode.Uri.file(resolveLocalPath(baseUri.fsPath, clean));
}

/**
 * HTMLから必要な値またはリソースを取得する。
 * @param baseFilePath - HTMLで読み書きするリソースの場所。
 * @param source - 解析・描画・変換の起点となる本文。
 * @returns HTMLで利用する文字列。
 */
function resolveLocalPath(baseFilePath: string, source: string): string {
    const clean = decodeLocalResourceSource(source);
    if (/^file:/i.test(clean)) {
        try {
            return path.normalize(vscode.Uri.parse(clean).fsPath);
        } catch {
            return clean;
        }
    }
    const normalized = clean.replace(/\\/g, path.sep);
    if (/^[A-Za-z]:[\\/]/.test(normalized) || path.isAbsolute(normalized)) return path.normalize(normalized);
    return path.resolve(path.dirname(baseFilePath), normalized);
}

/**
 * HTMLのoutput・path・forを処理し、呼び出し側へ結果または副作用を返す。
 * @param sourcePath - HTMLで読み書きするリソースの場所。
 * @param rootSourcePath - HTMLで読み書きするリソースの場所。
 * @param rootOutputPath - HTMLで読み書きするリソースの場所。
 * @returns HTMLで利用する文字列。
 */
function outputPathFor(sourcePath: string, rootSourcePath: string, rootOutputPath: string): string {
    const sourceRoot = path.dirname(rootSourcePath);
    const relative = path.relative(sourceRoot, sourcePath);
    const safeRelative = relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
        ? relative
        : path.join('_linked', `${createHash('sha1').update(sourcePath).digest('hex').slice(0, 10)}-${path.basename(sourcePath)}`);
    return path.join(path.dirname(rootOutputPath), replaceExtension(safeRelative, '.html'));
}

/**
 * HTMLのrelative・hrefを処理し、呼び出し側へ結果または副作用を返す。
 * @param fromFilePath - HTMLで読み書きするリソースの場所。
 * @param toFilePath - HTMLで読み書きするリソースの場所。
 * @returns HTMLで利用する文字列。
 */
function relativeHref(fromFilePath: string, toFilePath: string): string {
    const relative = path.relative(path.dirname(fromFilePath), toFilePath).replace(/\\/g, '/');
    const normalized = relative || path.basename(toFilePath);
    return normalized.split('/').map(
        /**
         * 各segmentをencode・uricomponentへ渡し、変換結果を一覧化する。
         * @param segment - HTMLへ渡す入力。
         * @returns 入力要素から生成した変換結果の一覧。
         */
        (segment) => segment === '.' || segment === '..' ? segment : encodeURIComponent(segment)).join('/');
}

/**
 * HTMLから必要な値またはリソースを取得する。
 * @param tag - HTMLで受け渡す文字列。
 * @param name - HTMLの対象や分岐を識別する値。
 * @returns 副作用を完了し、値は返さない。
 */
function readAttribute(tag: string, name: string): string | undefined {
    const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
    return match?.[1] ?? match?.[2] ?? match?.[3];
}

/**
 * HTMLの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param tag - HTMLで受け渡す文字列。
 * @param name - HTMLの対象や分岐を識別する値。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns HTMLで利用する文字列。
 */
function replaceAttribute(tag: string, name: string, value: string): string {
    const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
    const attribute = `${name}="${escapeAttribute(value)}"`;
    if (pattern.test(tag)) return tag.replace(pattern, attribute);
    if (/\/\s*>$/.test(tag)) return tag.replace(/\/\s*>$/, ` ${attribute}/>`);
    return tag.replace(/>$/, ` ${attribute}>`);
}

/**
 * HTMLから不要または危険な情報を除去する。
 * @param tag - HTMLで受け渡す文字列。
 * @returns HTMLで利用する文字列。
 */
function cleanDataAttributes(tag: string): string {
    return tag.replace(/\sdata-(?:original-src|mve-[\w-]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '');
}

/**
 * HTMLの入力を構造化した値へ変換する。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns 副作用を完了し、値は返さない。
 */
function decodeHtmlValue(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const decoded = value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    try {
        return decodeURIComponent(decoded);
    } catch {
        return decoded;
    }
}

/**
 * HTMLから必要な値またはリソースを取得する。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns HTMLで利用する文字列。
 */
function readFragment(value: string): string {
    const index = value.indexOf('#');
    if (index < 0) return '';
    return `#${encodeURIComponent(value.slice(index + 1))}`;
}

/**
 * HTMLの条件を判定する。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns 条件が成立したかを示す真偽値。
 */
function isRemoteResource(value: string): boolean {
    return /^(?:https?:|mailto:|tel:|ftp:|data:|blob:|javascript:|#|\/\/)/i.test(value);
}

/**
 * HTMLの条件を判定する。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns 条件が成立したかを示す真偽値。
 */
function isMarkdownPath(value: string): boolean {
    return /\.(?:md|markdown)$/i.test(value);
}

/**
 * HTMLの入力を許可された形式へ整える。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns HTMLで利用する文字列。
 */
function normalizePath(value: string): string {
    return path.normalize(path.resolve(value)).toLowerCase();
}

/**
 * HTMLの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param value - 検証・変換・保存の対象となる値。
 * @param extension - HTMLの位置・寸法・件数・時間を表す数値。
 * @returns HTMLで利用する文字列。
 */
function replaceExtension(value: string, extension: string): string {
    return value.replace(/\.[^./\\]+$/, extension);
}

/**
 * HTMLのensure・html・extensionを処理し、呼び出し側へ結果または副作用を返す。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns HTMLで利用する文字列。
 */
function ensureHtmlExtension(value: string): string {
    return /\.html?$/i.test(value) ? value : `${value}.html`;
}

/**
 * HTMLの入力を許可された形式へ整える。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns HTMLで利用する文字列。
 */
function escapeAttribute(value: string): string {
    return value.replace(/[&<>"']/g,
        /**
         * HTMLの前提条件を準備し、回帰条件を検証するテストケース。
         * @param character - テスト本体を実行するコールバック。
         * @returns テストケースを実行し、値は返さない。
         */
        (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

/**
 * HTMLから不要または危険な情報を除去する。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns HTMLで利用する文字列。
 */
function stripUnsafeMarkup(value: string): string {
    return value
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
        .replace(/javascript:/gi, '');
}

/**
 * HTMLのmime・from・pathを処理し、呼び出し側へ結果または副作用を返す。
 * @param filePath - 読み書きするファイルのパス。
 * @returns HTMLで利用する文字列。
 */
function mimeFromPath(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();
    return ({
        '.avif': 'image/avif',
        '.gif': 'image/gif',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp'
    } as Record<string, string>)[extension] ?? 'image/png';
}


const HTML_CSS = /**
 * HTMLのhtml・cssを処理し、呼び出し側へ結果または副作用を返す。
 * @param fontFamily - HTMLの位置・寸法・件数・時間を表す数値。
 * @returns HTMLで利用する文字列。
 */ (fontFamily: string): string => `
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font-family: ${fontFamily}; color: #202124; background: #fff; }
  .mve-html { max-width: 100%; margin: 0 auto; padding: 24px; box-sizing: border-box; }
  img { max-width: 100%; height: auto; }
  table { width: 100%; border-collapse: collapse; }
  table th, table td { word-break: normal; overflow-wrap: anywhere; }
  pre { overflow-x: auto; }
  a { color: inherit; text-decoration: underline; }
`;

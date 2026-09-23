/**
 * @file html.ts
 * 実行境界: Extension Host。
 * 責務: VS Code文書、Webview、外部リソースを連携する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: 文書、ファイル、Webview、ブラウザーなどの外部状態を必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
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
 * 「HtmlExportRequest」が満たすデータ契約を定義します。
 */
export interface HtmlExportRequest {

    /**
     * 「markdown」は、解析・編集・変換の対象となる本文またはデータを保持します。
     */
    markdown: string;

    /**
     * 「html」は、解析・編集・変換の対象となる本文またはデータを保持します。
     */
    html: string;

    /**
     * 「css」は、対象の内容または識別子を表す文字列です。
     */
    css: string;

    /**
     * 「options」は、利用側が共有する設定または現在状態を保持します。
     */
    options: HtmlExportOptions;

    /**
     * 「documentUri」は、関連処理が共有する構造化データの一項目です。
     */
    documentUri: vscode.Uri;

    /**
     * 「language」は、対象の内容または識別子を表す文字列です。
     */
    language: string;

    /**
     * 「fontFamily」は、表示テーマまたはスタイル設定を保持します。
     */
    fontFamily?: string;
}

/**
 * 「HtmlExportResult」が満たすデータ契約を定義します。
 */
export interface HtmlExportResult {

    /**
     * 「target」は、操作対象または処理目的を示す値を保持します。
     */
    target: vscode.Uri;

    /**
     * 「paths」は、読み込みまたは出力対象を示すパス・URL・内容を保持します。
     */
    paths: vscode.Uri[];
}

/**
 * 「HtmlDocument」が満たすデータ契約を定義します。
 */
export interface HtmlDocument {

    /**
     * 「uri」は、読み込みまたは出力する文書リソースを示します。
     */
    uri: vscode.Uri;

    /**
     * 「sourcePath」は、読み込みまたは出力対象を示すパス・URL・内容を保持します。
     */
    sourcePath: string;

    /**
     * 「markdown」は、解析・編集・変換の対象となる本文またはデータを保持します。
     */
    markdown: string;

    /**
     * 「html」は、解析・編集・変換の対象となる本文またはデータを保持します。
     */
    html: string;

    /**
     * 「outputPath」は、読み込みまたは出力対象を示すパス・URL・内容を保持します。
     */
    outputPath: string;
}

/**
 * 「HtmlExportPreparation」が満たすデータ契約を定義します。
 */
export interface HtmlExportPreparation {

    /**
     * 「target」は、操作対象または処理目的を示す値を保持します。
     */
    target: vscode.Uri;

    /**
     * 「documents」は、関連する複数の対象または識別子を保持します。
     */
    documents: HtmlDocument[];
}

/**
 * 「HtmlRenderedDocument」が満たすデータ契約を定義します。
 */
export interface HtmlRenderedDocument {

    /**
     * 「id」は、対象の識別や処理分岐に使用する値を保持します。
     */
    id: string;

    /**
     * 「html」は、解析・編集・変換の対象となる本文またはデータを保持します。
     */
    html: string;
}

/**
 * 現在のMarkdownを単独で開けるHTMLへ変換し、必要ならリンク先も同じ構成で保存する。
 * @param request 処理対象の要求です。
 * @returns 非同期処理の完了を表すPromiseです。
 */
export async function exportHtml(request: HtmlExportRequest): Promise<HtmlExportResult | undefined> {
    const preparation = await prepareHtmlExport(request);
    if (!preparation) return undefined;
    return writePreparedHtml(request, preparation);
}

/**
 * 保存先を決定し、再帰変換対象のMarkdownを収集する。
 * @param request 処理対象の要求です。
 * @returns 非同期処理の完了を表すPromiseです。
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
 * Webviewで描画済みのHTMLを使って、準備済みのHTML文書群を保存する。
 * @param request 処理対象の要求です。
 * @param preparation 表示領域のサイズまたは倍率で、画面レイアウト計算に使用します。
 * @param renderedDocuments 「renderedDocuments」は、「writePreparedHtml」がHTML出力の処理対象を特定する入力です。
 * @returns 非同期処理の完了を表すPromiseです。
 */
export async function writePreparedHtml(
    request: HtmlExportRequest,
    preparation: HtmlExportPreparation,
    renderedDocuments: readonly HtmlRenderedDocument[] = []
): Promise<HtmlExportResult> {
    const renderedById = new Map(renderedDocuments.map(
    /**
 * 「document」を変換し、変換後の要素を返すコールバックです。
     * @param document 処理対象の文書です。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (document) => [normalizePath(document.id), document.html]));
    const documents = preparation.documents.map(
    /**
 * 「document」を変換し、変換後の要素を返すコールバックです。
     * @param document 処理対象の文書です。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (document) => ({
        ...document,
        html: renderedById.get(normalizePath(document.sourcePath)) ?? document.html
    }));
    const output = await Promise.all(documents.map(
    /**
 * 「document」を変換し、変換後の要素を返すコールバックです。
     * @param document 処理対象の文書です。
     * @returns 入力要素から生成した変換後の値を返します。
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
 * 「collectDocuments」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param request 処理対象の要求です。
 * @param targetPath 「targetPath」は、「collectDocuments」がHTMLで処理する対象を特定する入力です。
 * @returns 非同期処理の完了を表すPromiseです。
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
 * 「reference」が条件に一致するか判定し、残す要素を決めるコールバックです。
             * @param reference referenceとして渡される、このコールバックの入力値です。
             * @returns 要素を採用するかどうかの真偽値を返します。
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
 * Markdownを描画します。
 * @param markdown 解析・編集・変換の対象となる本文または生成済み内容です。
 * @returns 「renderLinkedMarkdown」が生成または変換したHTMLの文字列を返します。
 */
function renderLinkedMarkdown(markdown: string): string {
    const renderer = new marked.Renderer();
    renderer.image =
    /**
 * 「href」「title」「text」を受け取り、Markdown画像の表示用HTMLを生成するコールバックです。
     * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはhref、title、textです。
     * @returns 画像の表示用HTMLを返します。
     */
    ({ href, title, text }) => {
        const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : '';
        return `<img src="${escapeAttribute(href)}" data-original-src="${escapeAttribute(href)}" alt="${escapeAttribute(text)}"${titleAttribute}>`;
    };
    return String(marked.parse(markdown, { gfm: true, renderer }));
}

/**
 * HTMLを作成または組み立てます。
 * @param body 解析・編集・変換の対象となる本文または生成済み内容です。
 * @param css 「css」は、「buildStandaloneHtml」がHTML出力の処理対象を特定する入力です。
 * @param language 表示文言の解決に使用する言語コードまたはロケールです。
 * @param fontFamily 「fontFamily」は、「buildStandaloneHtml」がHTML出力の処理対象を特定する入力です。
 * @returns 「buildStandaloneHtml」が生成または変換したHTMLの文字列を返します。
 */
function buildStandaloneHtml(body: string, css: string, language: string, fontFamily?: string): string {
    const safeCss = css.replace(/<\/style/gi, '<\\/style');
    const safeFontFamily = fontFamilyForCss(fontFamily, DEFAULT_PDF_OPTIONS.fontFamily);
    return `<!doctype html><html lang="${escapeAttribute(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${safeCss}\n${HTML_CSS(safeFontFamily)}</style></head><body><main class="mve-html">${body}</main></body></html>`;
}

/**
 * 「rewriteBody」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param html 解析・編集・変換の対象となる本文または生成済み内容です。
 * @param sourcePath 「sourcePath」は、「rewriteBody」がHTMLで処理する対象を特定する入力です。
 * @param outputPath 「outputPath」は、「rewriteBody」がHTMLで処理する対象を特定する入力です。
 * @param documents 「documents」は、「rewriteBody」がHTML出力の処理対象を特定する入力です。
 * @param options 処理経路や表示方法を指定する設定値です。
 * @returns 非同期処理の完了を表すPromiseです。
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
 * 「match」を変換し、変換後の要素を返すコールバックです。
     * @param match matchとして渡される、このコールバックの入力値です。
     * @returns 置換後の文字列を返します。
     */
    (match) => match[0]);
    for (const tag of imageTags) {
        const replacement = await rewriteImageTag(tag, sourcePath, outputPath, options);
        result = result.replace(tag, replacement);
    }
    result = result.replace(/<a\b[^>]*>/gi,
    /**
 * 「tag」を受け取り、入力文字列を置換して変換する処理です。
     * @param tag HTMLまたはテキストから取り出した対象文字列です。
     * @returns 置換後の文字列を返します。
     */
    (tag) => rewriteLinkTag(tag, sourcePath, outputPath, documents, options));
    return result.replace(/\sdata-(?:original-src|mve-[\w-]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '');
}

/**
 * 「rewriteImageTag」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param tag 「tag」は、「rewriteImageTag」がHTML出力の処理対象を特定する入力です。
 * @param sourcePath 「sourcePath」は、「rewriteImageTag」がHTMLで処理する対象を特定する入力です。
 * @param outputPath 「outputPath」は、「rewriteImageTag」がHTMLで処理する対象を特定する入力です。
 * @param options 処理経路や表示方法を指定する設定値です。
 * @returns 非同期処理の完了を表すPromiseです。
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
 * 「rewriteLinkTag」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param tag 「tag」は、「rewriteLinkTag」がHTML出力の処理対象を特定する入力です。
 * @param sourcePath 「sourcePath」は、「rewriteLinkTag」がHTMLで処理する対象を特定する入力です。
 * @param outputPath 「outputPath」は、「rewriteLinkTag」がHTMLで処理する対象を特定する入力です。
 * @param documents 「documents」は、「rewriteLinkTag」がHTML出力の処理対象を特定する入力です。
 * @param options 処理経路や表示方法を指定する設定値です。
 * @returns 「rewriteLinkTag」が生成または変換したHTMLの文字列を返します。
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
 * 「document」が検索条件に一致するか判定するコールバックです。
     * @param document 処理対象の文書です。
     * @returns 条件に一致した要素、または該当しない場合はundefinedを返します。
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
 * URIを取得または解決します。
 * @param baseUri 「baseUri」は、「resolveLocalFileUri」がHTML出力の処理対象を特定する入力です。
 * @param source 処理対象のソースです。
 * @returns 「resolveLocalFileUri」が対象を取得できない場合はundefinedを返します。
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
 * パスを取得または解決します。
 * @param baseFilePath 「baseFilePath」は、「resolveLocalPath」がHTMLで処理する対象を特定する入力です。
 * @param source 処理対象のソースです。
 * @returns 「resolveLocalPath」が生成または変換したHTMLの文字列を返します。
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
 * 「outputPathFor」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param sourcePath 「sourcePath」は、「outputPathFor」がHTMLで処理する対象を特定する入力です。
 * @param rootSourcePath 「rootSourcePath」は、「outputPathFor」がHTMLで処理する対象を特定する入力です。
 * @param rootOutputPath 「rootOutputPath」は、「outputPathFor」がHTMLで処理する対象を特定する入力です。
 * @returns 「outputPathFor」が生成または変換したHTMLの文字列を返します。
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
 * 「relativeHref」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param fromFilePath 「fromFilePath」は、「relativeHref」がHTMLで処理する対象を特定する入力です。
 * @param toFilePath 「toFilePath」は、「relativeHref」がHTMLで処理する対象を特定する入力です。
 * @returns 「relativeHref」が生成または変換したHTMLの文字列を返します。
 */
function relativeHref(fromFilePath: string, toFilePath: string): string {
    const relative = path.relative(path.dirname(fromFilePath), toFilePath).replace(/\\/g, '/');
    const normalized = relative || path.basename(toFilePath);
    return normalized.split('/').map(
    /**
 * 「segment」を変換し、変換後の要素を返すコールバックです。
     * @param segment segmentとして渡される、このコールバックの入力値です。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (segment) => segment === '.' || segment === '..' ? segment : encodeURIComponent(segment)).join('/');
}

/**
 * 属性を取得または解決します。
 * @param tag 「tag」は、「readAttribute」がHTML出力の処理対象を特定する入力です。
 * @param name 対象を識別する名前で、表示または処理分岐に使用します。
 * @returns 「readAttribute」が生成または変換したHTMLの文字列を返します。
 */
function readAttribute(tag: string, name: string): string | undefined {
    const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
    return match?.[1] ?? match?.[2] ?? match?.[3];
}

/**
 * 「replaceAttribute」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param tag 「tag」は、「replaceAttribute」がHTML出力の処理対象を特定する入力です。
 * @param name 対象を識別する名前で、表示または処理分岐に使用します。
 * @param value 「replaceAttribute」で検証・変換する入力値です。
 * @returns 「replaceAttribute」が生成または変換したHTMLの文字列を返します。
 */
function replaceAttribute(tag: string, name: string, value: string): string {
    const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
    const attribute = `${name}="${escapeAttribute(value)}"`;
    if (pattern.test(tag)) return tag.replace(pattern, attribute);
    if (/\/\s*>$/.test(tag)) return tag.replace(/\/\s*>$/, ` ${attribute}/>`);
    return tag.replace(/>$/, ` ${attribute}>`);
}

/**
 * 「cleanDataAttributes」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param tag 「tag」は、「cleanDataAttributes」がHTML出力の処理対象を特定する入力です。
 * @returns 「cleanDataAttributes」が生成または変換したHTMLの文字列を返します。
 */
function cleanDataAttributes(tag: string): string {
    return tag.replace(/\sdata-(?:original-src|mve-[\w-]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '');
}

/**
 * 値を解析または復元します。
 * @param value 「decodeHtmlValue」で検証・変換する入力値です。
 * @returns 「decodeHtmlValue」が生成または変換したHTMLの文字列を返します。
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
 * read・fragmentを取得または解決します。
 * @param value 「readFragment」で検証・変換する入力値です。
 * @returns 「readFragment」が生成または変換したHTMLの文字列を返します。
 */
function readFragment(value: string): string {
    const index = value.indexOf('#');
    if (index < 0) return '';
    return `#${encodeURIComponent(value.slice(index + 1))}`;
}

/**
 * is・remote・resourceかどうかを判定します。
 * @param value 「isRemoteResource」で検証・変換する入力値です。
 * @returns 判定結果です。
 */
function isRemoteResource(value: string): boolean {
    return /^(?:https?:|mailto:|tel:|ftp:|data:|blob:|javascript:|#|\/\/)/i.test(value);
}

/**
 * パスかどうかを判定します。
 * @param value 「isMarkdownPath」で検証・変換する入力値です。
 * @returns 判定結果です。
 */
function isMarkdownPath(value: string): boolean {
    return /\.(?:md|markdown)$/i.test(value);
}

/**
 * パスを正規化します。
 * @param value 「normalizePath」で検証・変換する入力値です。
 * @returns 「normalizePath」が生成または変換したHTMLの文字列を返します。
 */
function normalizePath(value: string): string {
    return path.normalize(path.resolve(value)).toLowerCase();
}

/**
 * 「replaceExtension」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param value 「replaceExtension」で検証・変換する入力値です。
 * @param extension 「extension」は、「replaceExtension」がHTML出力の処理対象を特定する入力です。
 * @returns 「replaceExtension」が生成または変換したHTMLの文字列を返します。
 */
function replaceExtension(value: string, extension: string): string {
    return value.replace(/\.[^./\\]+$/, extension);
}

/**
 * 「ensureHtmlExtension」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param value 「ensureHtmlExtension」で検証・変換する入力値です。
 * @returns 「ensureHtmlExtension」が生成または変換したHTMLの文字列を返します。
 */
function ensureHtmlExtension(value: string): string {
    return /\.html?$/i.test(value) ? value : `${value}.html`;
}

/**
 * 属性を安全な形式へ変換します。
 * @param value 「escapeAttribute」で検証・変換する入力値です。
 * @returns 「escapeAttribute」が生成または変換したHTMLの文字列を返します。
 */
function escapeAttribute(value: string): string {
    return value.replace(/[&<>"']/g,
    /**
 * 「character」から（value、javascript、filePath）のオブジェクトを生成して返すコールバックです。
     * @param character HTMLまたはテキストから取り出した対象文字列です。
     * @returns 置換後の文字列を返します。
     */
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

/**
 * 「stripUnsafeMarkup」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param value 「stripUnsafeMarkup」で検証・変換する入力値です。
 * @returns 「stripUnsafeMarkup」が生成または変換したHTMLの文字列を返します。
 */
function stripUnsafeMarkup(value: string): string {
    return value
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
        .replace(/javascript:/gi, '');
}

/**
 * 「mimeFromPath」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param filePath 「filePath」は、「mimeFromPath」がHTMLで処理する対象を特定する入力です。
 * @returns 「mimeFromPath」が生成または変換したHTMLの文字列を返します。
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

/**
 * 「HTML_CSS」は、関連する処理間で共有する設定値または状態を保持します。
 * @param fontFamily 「fontFamily」は、「HTML_CSS」がHTML出力の処理対象を特定する入力です。
 * @returns 「HTML_CSS」が生成または変換したHTMLの文字列を返します。
 */
const HTML_CSS = /**
 * 「HTML_CSS」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param fontFamily 「fontFamily」は、「HTML_CSS」がHTMLで処理する対象を特定する入力です。
 * @returns 「HTML_CSS」が生成または整形したHTML出力の文字列を返します。
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

/**
 * @fileoverview Markdownプレビュー用HTMLを組み立て、テーマ・設定・リソースURIをWebviewへ渡す。HTMLへ入る値をエスケープする。
 */
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import * as vscode from 'vscode';
import { Marked, Renderer } from 'marked';
import { DEFAULT_PDF_OPTIONS, type HtmlExportOptions } from '../shared/protocol';
import { fontFamilyForCss } from '../shared/fontFamily';
import { footnoteDefinitionSyntax, mathBlockSyntax, tableOfContentsSyntax } from '../shared/markdownBlockSyntax';
import {
    collectLocalResourceReferences,
    nextHeadingAnchorId,
    WORKSPACE_SECTION_LINK_TITLE
} from '../shared/markdown';
import { workspaceRootPathSegments } from './resourceLink';
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
     * 出力HTMLファイルを保存する最終パス。
     */
    target: vscode.Uri;

    /**
     * HTMLで扱うpathsの一覧。
     */
    paths: vscode.Uri[];
}

/**
 * 元文書のURI、ファイルパス、HTML化するMarkdown本文を保持します。
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
 * 保存先URIと、HTML化する文書一覧をまとめた準備情報です。
 */
export interface HtmlExportPreparation {

    /**
     * export処理が保存先として選んだHTMLファイルのURI。
     */
    target: vscode.Uri;

    /**
     * 文書URIと開いている文書オブジェクトの対応表。
     */
    documents: HtmlDocument[];
}

/**
 * HTML文書の識別子と、レンダリング済みHTML本文です。
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
 * Markdownと関連HTML文書を解決し、設定を適用したHTMLを保存する。
 * @param request - HTML本文・CSS・元文書URI・言語・フォント・出力設定をまとめた要求。
 * @returns 書き出したHTMLのURIと関連文書情報。保存ダイアログをキャンセルした場合はundefined。
 */
export async function exportHtml(request: HtmlExportRequest): Promise<HtmlExportResult | undefined> {
    const preparation = await prepareHtmlExport(request);
    if (!preparation) return undefined;
    return writePreparedHtml(request, preparation);
}

/**
 * HTMLの保存先を決定し、出力対象のローカル文書を収集する。
 * @param request - HTML本文・CSS・元文書URI・言語・フォント・出力設定をまとめた要求。
 * @returns 書き出し用HTMLと関連文書を準備した結果。保存をキャンセルした場合はundefined。
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
 * @param request - HTML本文・CSS・元文書URI・言語・フォント・出力設定をまとめた要求。
 * @param preparation - HTML保存先URIと、出力対象文書のレコード一覧。
 * @param renderedDocuments - Webviewから受け取った識別子付きHTML描画結果の一覧。
 * @returns 保存したHTMLファイルのURIと、出力で参照するファイルURI一覧。
 */
export async function writePreparedHtml(
    request: HtmlExportRequest,
    preparation: HtmlExportPreparation,
    renderedDocuments: readonly HtmlRenderedDocument[] = []
): Promise<HtmlExportResult> {
    const renderedById = new Map(renderedDocuments.map(
        /**
         * 各documentから識別子を取り出して一覧化する。
         * @param document - Webviewで描画された識別子とHTML本文を持つ結果レコード。
         * @returns 識別子を取り出した変換結果の一覧。
         */
        (document) => [normalizePath(document.id), document.html]));
    const documents = preparation.documents.map(
        (document) => ({
            ...document,
            html: renderedById.get(normalizePath(document.sourcePath)) ?? document.html
        }));
    const output = await Promise.all(documents.map(
        /**
         * 各documentからhtmlを取り出して一覧化する。
         * @param document - HTMLファイルとして書き出す文書レコード。
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
 * ルート文書とリンク先文書を収集し、各文書のHTML出力先と本文を決定する。
 * @param request - HTML本文・CSS・元文書URI・言語・フォント・出力設定をまとめた要求。
 * @param targetPath - ルートHTMLの保存先ファイルパス。
 * ソースURIと出力パスを持つ、重複を除いたHTML出力対象文書一覧。
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
                * @param reference - Markdown本文から見つけたリンクまたはリソース参照。

                 */
                (reference) => reference.kind === 'link');
        for (const reference of references) {
            const linkedUri = resolveLocalFileUri(
                document.uri,
                reference.source,
                reference.workspaceRooted === true
            );
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
 * Markdownを見出しアンカーとローカル参照情報を含むHTMLへ描画する。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。

 */
function renderLinkedMarkdown(markdown: string): string {
    const parser = new Marked({ gfm: true });
    const renderer = new Renderer();
    const headingIds = new Map<string, number>();
    const usedHeadingIds = new Set<string>();
    renderer.heading =
        /**
         * Markdown見出しを同じリンクID付きHTMLへ変換する。
         * @param heading - Markedから受け取った見出しtoken。
         * @returns HTMLの見出し要素。
         */
        function (heading) {
            const { depth, tokens } = heading;
            const id = nextHeadingAnchorId(tokens.map((token) => token.raw).join(''), headingIds, usedHeadingIds);
            const content = this.parser.parseInline(tokens)
                .replace(/\s+\{#[^}]+\}(?=(?:<\/span>)*\s*$)/, '');
            return `<h${depth} id="${escapeAttribute(id)}">${content}</h${depth}>`;
        };
    renderer.image =
        /**
         * HTMLの入力を検証し、表示または保存に使う形式へ変換する。
         * @param image - Markedから受け取った画像トークン。href、title、textをimg要素へ反映する。
         * @returns HTMLで利用するimg要素。
         */
        (image) => {
            const { href, title, text } = image;
            const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : '';
            return `<img src="${escapeAttribute(href)}" data-original-src="${escapeAttribute(href)}" alt="${escapeAttribute(text)}"${titleAttribute}>`;
        };
    renderer.link =
        /**
         * MarkdownリンクをHTMLへ変換し、ワークスペース基準リンクの識別情報を保持する。
         * @param link - Markedから受け取ったリンクトークン。
         * @returns HTMLのa要素。
         */
        function (link) {
            const { href, title, tokens } = link;
            const workspaceRooted = title === WORKSPACE_SECTION_LINK_TITLE;
            const titleAttribute = title && !workspaceRooted ? ` title="${escapeAttribute(title)}"` : '';
            const workspaceAttribute = workspaceRooted ? ' data-mve-workspace-rooted="true"' : '';
            const content = this.parser.parseInline(tokens);
            return `<a href="${escapeAttribute(href)}"${workspaceAttribute}${titleAttribute}>${content}</a>`;
        };
    parser.setOptions({ renderer });
    parser.use({
        extensions: [
            {
                ...mathBlockSyntax(),
                renderer(token) {
                    const text = typeof token === 'object' && token !== null
                        && 'text' in token && typeof token.text === 'string'
                        ? token.text
                        : '';
                    return `<pre class="math-block">${escapeAttribute(text)}</pre>`;
                }
            },
            {
                ...tableOfContentsSyntax(),
                renderer() {
                    return '<p>[toc]</p>';
                }
            },
            {
                ...footnoteDefinitionSyntax(),
                renderer() {
                    return '';
                }
            }
        ]
    });
    return String(parser.parse(markdown));
}

/**
 * HTML本文、スタイル、言語、フォントを使って単体表示用HTMLを組み立てる。
 * @param body - main要素内へ挿入する変換済みHTML本文。
 * @param css - head内のstyle要素へ挿入するスタイルシート。
 * @param language - html要素のlang属性に設定する言語コード。
 * @param fontFamily - 生成HTMLの本文へ適用するフォントファミリー。

 */
function buildStandaloneHtml(body: string, css: string, language: string, fontFamily?: string): string {
    const safeCss = css.replace(/<\/style/gi, '<\\/style');
    const safeFontFamily = fontFamilyForCss(fontFamily, DEFAULT_PDF_OPTIONS.fontFamily);
    return `<!doctype html><html lang="${escapeAttribute(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${safeCss}\n${HTML_CSS(safeFontFamily)}</style></head><body><main class="mve-html">${body}</main></body></html>`;
}

/**
 * body内の画像・文書リンクを出力先相対参照や埋め込みデータへ書き換える。
 * @param html - 表示または出力するHTML本文。
 * @param sourcePath - 変換するHTML内の相対参照を解決するリンク元ファイルパス。
 * @param outputPath - 書き換え後の相対リンクの基準となる生成HTMLの保存先パス。
 * @param documents - 現在のHTML出力に含まれるHtmlDocument一覧。リンク先Markdownの出力先解決に使う。
 * @param options - 画像を埋め込むか、リンク先MarkdownをHTML化するかを指定するHTML出力設定。

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
         * @param match - img開始タグに一致した正規表現のMatch。match[0]にタグ全体を含む。

         */
        (match) => match[0]);
    for (const tag of imageTags) {
        const replacement = await rewriteImageTag(tag, sourcePath, outputPath, options);
        result = result.replace(tag, replacement);
    }
    result = result.replace(/<a\b[^>]*>/gi,
        /**
         * @param tag - 書き換えるa要素のHTMLタグ全体。

         */
        (tag) => rewriteLinkTag(tag, sourcePath, outputPath, documents, options));
    return result.replace(/\sdata-(?:original-src|mve-[\w-]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '');
}

/**
 * 画像srcを埋め込みData URLまたは生成HTMLからの相対パスへ書き換える。
 * @param tag - 画像のsrc属性を読み書きするimg要素のHTMLタグ全体。
 * @param sourcePath - 相対画像参照を解決するリンク元HTMLファイルのパス。
 * @param outputPath - 画像リンクの基準となる生成HTMLの保存先パス。
 * @param options - 画像を埋め込むか相対参照にするかを指定するHTML出力設定。

 */
async function rewriteImageTag(
    tag: string,
    sourcePath: string,
    outputPath: string,
    options: HtmlExportOptions
): Promise<string> {
    const original = decodeHtmlEntities(readAttribute(tag, 'data-original-src') ?? readAttribute(tag, 'src'));
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
 * 文書リンクを関連文書のHTML出力先または元の相対参照へ書き換える。
 * @param tag - href属性を書き換えるa要素のHTMLタグ全体。
 * @param sourcePath - 相対リンクを解決するリンク元HTMLファイルのパス。
 * @param outputPath - 相対リンクの基準となる生成HTMLの保存先パス。
 * @param documents - 現在のHTML出力に含まれるHtmlDocument一覧。リンク先Markdownの出力先解決に使う。
 * @param options - リンク先MarkdownをHTML化するかを指定するHTML出力設定。

 */
function rewriteLinkTag(
    tag: string,
    sourcePath: string,
    outputPath: string,
    documents: HtmlDocument[],
    options: HtmlExportOptions
): string {
    const original = decodeHtmlEntities(readAttribute(tag, 'data-mve-link') ?? readAttribute(tag, 'href'));
    if (!original || !sourcePath) {
        return cleanDataAttributes(tag);
    }
    if (original.startsWith('#')) {
        return replaceAttribute(cleanDataAttributes(tag), 'href', readFragment(original));
    }
    if (isRemoteResource(original)) return cleanDataAttributes(tag);
    const workspaceRooted = readAttribute(tag, 'data-mve-workspace-rooted') === 'true';
    const linkedPath = workspaceRooted
        ? resolveLocalFileUri(vscode.Uri.file(sourcePath), original, true)?.fsPath
        : resolveLocalPath(sourcePath, original);
    if (!linkedPath) return cleanDataAttributes(tag);
    const linkedDocument = documents.find(
        (document) => normalizePath(document.sourcePath) === normalizePath(linkedPath));
    const isMarkdown = isMarkdownPath(linkedPath);
    const isSameDocument = normalizePath(linkedPath) === normalizePath(sourcePath);
    const destinationPath = linkedDocument && (isSameDocument || (options.convertLinkedMarkdown && isMarkdown))
        ? linkedDocument.outputPath
        : linkedPath;
    const fragment = readFragment(original);
    const destination = `${relativeHref(outputPath, destinationPath)}${fragment}`;
    return replaceAttribute(cleanDataAttributes(tag), 'href', destination);
}

/**
 * HTML文書を基準にローカルリソース参照をファイルURIへ解決する。
 * @param baseUri - 相対参照の基準となるHTMLまたはMarkdown文書のURI。
 * @param source - MarkdownまたはHTMLから取得したローカルURI、パス、参照文字列。
 * @returns 条件に一致する値。未検出時はundefinedまたはnull。
 */
function resolveLocalFileUri(baseUri: vscode.Uri, source: string, workspaceRooted = false): vscode.Uri | undefined {
    const clean = decodeLocalResourceSource(source);
    if (!clean || isRemoteResource(clean)) return undefined;
    if (workspaceRooted) {
        if (baseUri.scheme !== 'file') return undefined;
        const segments = workspaceRootPathSegments(clean);
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(baseUri);
        if (!segments || !workspaceFolder || workspaceFolder.uri.scheme !== 'file') return undefined;
        return vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, ...segments));
    }
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
 * ファイルを基準にローカルリソース参照を絶対パスへ解決する。
 * @param baseFilePath - 相対参照の基準となるHTMLまたはMarkdownファイルのパス。
 * @param source - ローカルURI、絶対パス、または基準ファイルからの相対パス。

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
 * リンク先Markdownがルート文書と同じ相対位置になるよう出力先HTMLパスを求める。
 * @param sourcePath - 出力対象Markdown文書のソースパス。
 * @param rootSourcePath - ルートMarkdown文書のソースパス。
 * @param rootOutputPath - ルートHTMLの保存先パス。
 * @returns ソースツリー内の相対位置を保った生成HTMLパス。
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
 * 2つのファイルパスからHTML hrefを作り、各URL区間を安全にエンコードする。
 * @param fromFilePath - 生成hrefを使用するHTMLファイルのパス。
 * @param toFilePath - hrefの参照先ファイルパス。
 * @returns 区切りを`/`へ揃えてエンコードした相対href。
 */
function relativeHref(fromFilePath: string, toFilePath: string): string {
    const relative = path.relative(path.dirname(fromFilePath), toFilePath).replace(/\\/g, '/');
    const normalized = relative || path.basename(toFilePath);
    return normalized.split('/').map(
        (segment) => segment === '.' || segment === '..' ? segment : encodeURIComponent(segment)).join('/');
}

/**
 * HTML開始タグから指定属性の値を引用符を除いて読み取る。
 * @param tag - 属性を読み取るHTML要素タグ全体。
 * @param name - 読み取るHTML属性名。
 * @returns 指定属性の引用符を除いた値。属性がなければundefined。
 */
function readAttribute(tag: string, name: string): string | undefined {
    const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
    return match?.[1] ?? match?.[2] ?? match?.[3];
}

/**
 * HTMLの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param tag - 属性を置換するHTML要素タグ全体。
 * @param name - 置換するHTML属性名。
 * @param value - 指定HTML属性へ設定する新しい未エスケープ値。

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
 * @param tag - 不要なdata属性を除去するHTML要素タグ全体。

 */
function cleanDataAttributes(tag: string): string {
    return tag.replace(/\sdata-(?:original-src|mve-[\w-]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '');
}

/**
 * HTML属性値の文字参照だけをデコードし、URIのパーセント表記を保つ。
 * @param value - HTMLエンティティを含む属性値。未指定ならundefined。
 * @returns HTMLエンティティを戻した値。入力が未指定ならundefined。
 */
function decodeHtmlEntities(value: string | undefined): string | undefined {
    if (!value) return undefined;
    return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/**
 * リンク参照のフラグメント部分をURIエンコードして返す。
 * @param value - リンク参照文字列。#以降を抽出してURIエンコードする。

 */
function readFragment(value: string): string {
    const index = value.indexOf('#');
    if (index < 0) return '';
    const rawFragment = value.slice(index + 1);
    let decodedFragment = rawFragment;
    try {
        decodedFragment = decodeURIComponent(rawFragment);
    } catch {
        // 不正な%エスケープは文字列のまま再エンコードする。
    }
    return `#${encodeURIComponent(decodedFragment)}`;
}

/**
 * 参照先がHTTPなどのリモートまたは非ファイルURIかを判定する。
 * @param value - ローカル解決を行うか判定するsrcまたはhref参照文字列。
 * @returns 条件が成立したかを示す真偽値。
 */
function isRemoteResource(value: string): boolean {
    return /^(?:https?:|mailto:|tel:|ftp:|data:|blob:|javascript:|#|\/\/)/i.test(value);
}

/**
 * ファイルパスがMarkdown拡張子かを判定する。
 * @param value - Markdown拡張子かを判定するファイルパス。
 * @returns 条件が成立したかを示す真偽値。
 */
function isMarkdownPath(value: string): boolean {
    return /\.(?:md|markdown)$/i.test(value);
}

/**
 * 絶対化、正規化、小文字化したファイルパスを返す。
 * @param value - 絶対化・正規化・小文字化して比較するファイルパス。

 */
function normalizePath(value: string): string {
    return path.normalize(path.resolve(value)).toLowerCase();
}

/**
 * ファイルパス末尾の拡張子を指定した拡張子へ置き換える。
 * @param value - 拡張子を置き換えるファイルパス。
 * @param extension - 置き換え後に付ける拡張子。

 */
function replaceExtension(value: string, extension: string): string {
    return value.replace(/\.[^./\\]+$/, extension);
}

/**
 * 出力ファイルパスにHTML拡張子がない場合は.htmlを付ける。
 * @param value - HTML拡張子を付ける出力ファイルパス。

 */
function ensureHtmlExtension(value: string): string {
    return /\.html?$/i.test(value) ? value : `${value}.html`;
}

/**
 * HTML属性値に含まれるアンパサンド、山括弧、引用符をエンティティへ変換する。
 * @param value - HTML属性へ出力する未エスケープ文字列。

 */
function escapeAttribute(value: string): string {
    return value.replace(/[&<>"']/g,
        /**
         * HTML属性内で特別な扱いが必要な1文字を文字参照へ置き換える。
         * @param character - 現在置換するアンパサンド、山括弧、引用符のいずれか。
         * @returns 対応するHTML文字参照。
         */
        (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

/**
 * PDFまたはHTML出力前に危険な要素と属性をHTML本文から除去する。
 * @param value - PDFまたはHTML出力前に危険な要素・属性を除去するHTML本文。

 */
function stripUnsafeMarkup(value: string): string {
    return value
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
        .replace(/javascript:/gi, '');
}

/**
 * ファイル拡張子からHTML出力で使う画像MIMEタイプを決める。
 * @param filePath - 拡張子から画像MIMEタイプを判定するファイルパス。
 * @returns 拡張子に対応するMIMEタイプ。不明な拡張子はapplication/octet-stream。
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
 * HTML出力用の印刷・レイアウト規則を指定フォントで生成する。
 * @param fontFamily - body要素へ適用するCSSフォント指定。

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

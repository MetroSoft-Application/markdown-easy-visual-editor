/**
 * @fileoverview 保存ダイアログとVS Code文書の境界を保ち、出力要求時だけ独立エンジンを読む（HTML/PDF/DOCX）。
 * プレビューが使うPDF/HTML描画器やブラウザープールはこのモジュールを参照しない。
 */
import * as vscode from 'vscode';
import path from 'node:path';
import { getMessages } from '../shared/messages';
import {
    DEFAULT_PDF_OPTIONS,
    type DocxExportSettings,
    type EditorTheme,
    type ExportRenderSnapshot,
    type HtmlExportOptions,
    type PdfOptions
} from '../shared/protocol';

/**
 * 拡張が出力エンジンへ要求する出力形式。DOCXはエンジン0.2.0以降が対応し、PDFと同じ印刷設定から組版する。
 */
export type ExportFormat = 'html' | 'pdf' | 'docx';

/** 拡張からCLIへ渡す値だけを定義し、CLIの型やソースをimportしない。 */
interface EngineArguments {
    input: string;
    output: string;
    format: ExportFormat;
    markdown: string;
    language: ExportRenderSnapshot['language'];
    browserPath?: string;
    workspaceRoot: string;
    theme: EditorTheme;
    mermaidTheme: 'default' | 'dark' | 'neutral';
    mermaidFontSize: number;
    fontFamily: string;
    remoteImagesEnabled: boolean;
    renderFormat: ExportRenderSnapshot['renderFormat'];
    linked: boolean;
    embedImages: boolean;
    outline: boolean;
    /**
     * YAML front matterの扱い。エンジン0.1.3以降の既定（auto）は本文から除くが、エディターのプレビューと印刷プレビューは
     * front matterを水平線と見出しとして表示するため、出力をプレビューと一致させるよう常にrender（0.1.2以前と同じ描画）を渡す。
     * renderでも、front matterのtitleはHTMLの`<title>`とPDF/DOCXの文書情報のタイトルに使われる（本文の表示は変わらない）。
     */
    frontMatter: 'render';
    force: true;
    pdfOptions: PdfOptions;
    htmlOptions?: HtmlExportOptions;
    signal?: AbortSignal;
}

/** 出力エンジンの公開関数の最小契約。ロード失敗は出力要求だけの例外にする。 */
interface ExportEngine {
    convert(args: EngineArguments): Promise<readonly string[]>;
}

/**
 * 出力時点の原文・設定・保存先を保持する。文書同期の検証は呼び出し元が行う。
 */
export interface ExportEngineRequest {
    documentUri: vscode.Uri;
    markdown: string;
    format: ExportFormat;
    rendering: ExportRenderSnapshot;
    editorTheme: EditorTheme;
    /** PDFの用紙・余白・文字組み。DOCXも同じ値でページ設定と本文書式を決める。 */
    pdfOptions: PdfOptions;
    htmlOptions?: HtmlExportOptions;
    /** DOCX出力の保存設定。formatがdocxのときだけ参照する。 */
    docxOptions?: DocxExportSettings;
    signal?: AbortSignal;
}

/**
 * 出力形式ごとの保存ダイアログの表示内容と、拡張子の補完規則を返す。
 * @param format - 出力形式。
 * @param language - 保存ボタンの文言に使う表示言語。
 * @returns 保存ダイアログのフィルターとボタン文言、保存先が既に正しい拡張子を持つかの判定。
 * PDFは従来どおり指定された保存先へそのまま書き込むため、常に拡張子ありとして扱う。
 */
export function exportTargetSpec(format: ExportFormat, language: ExportRenderSnapshot['language']): {
    filters: Record<string, string[]>;
    saveLabel: string;
    hasExtension: (fsPath: string) => boolean;
} {
    const labels = getMessages(language).ribbon.labels;
    if (format === 'pdf') return { filters: { PDF: ['pdf'] }, saveLabel: labels.exportPdf, hasExtension: () => true };
    if (format === 'docx') {
        return { filters: { Word: ['docx'] }, saveLabel: labels.exportDocx, hasExtension: (item) => /\.docx$/i.test(item) };
    }
    return { filters: { HTML: ['html', 'htm'] }, saveLabel: labels.exportHtml, hasExtension: (item) => /\.html?$/i.test(item) };
}

/**
 * 出力エンジンが「文字としての`{`」として扱い、ヘッダー・フッターの書き出し直前に`{`へ戻す私用領域の文字（エンジンのLITERAL_BRACE）。
 * エンジンの公開APIではないため、エンジンを更新するときは、この値とPDF・DOCXでの復元処理が残っていることを再確認する
 * （統合テストがDOCXのheader1.xmlとPDFの本文テキストで文字どおりの出力を検査する）。
 */
const ENGINE_LITERAL_BRACE = '\uE000';

/**
 * ヘッダー・フッターの`{title}`・`{file}`・`{date}`を、出力エンジンが展開しない文字どおりの表記にする。
 * エンジン0.1.3以降はこれらを出力時に展開するが、エディターの印刷プレビューは`{page}`・`{pages}`しか展開しないため、
 * 展開させるとプレビューとPDF/DOCXの見た目が一致しなくなる。0.1.1と同じく文字列のまま出力させるため、先頭の`{`だけを保護する。
 * `{page}`・`{pages}`はプレビューと同じくページ番号へ展開させるので変えない。
 * 既知の制約: エンジンは保護後の文字列へ出力置換を適用するため、`{`を含む置換パターン（例: `\{date\}`）は
 * 印刷プレビューでは一致してもPDF/DOCXでは一致しない。エンジンに展開を止める公開オプションができたら切り替える。
 * @param value - ヘッダーまたはフッターの文字列。未指定は空文字列として扱う。
 * @returns 3つのトークンの`{`をエンジンの保護文字へ置き換えた文字列。出力ではもとの`{title}`等として表示される。
 */
export function protectEngineOnlyPlaceholders(value: string | undefined): string {
    return (value ?? '').replace(/\{(?=(?:title|file|date)\})/g, ENGINE_LITERAL_BRACE);
}

/**
 * 出力エンジンの成果物を実行時だけ読む。欠落や読込失敗でも拡張起動を阻害しない。
 */
function loadExportEngine(): ExportEngine {
    const enginePath = path.join(__dirname, 'export-engine', 'mve-convert.cjs');
    const engine = require(enginePath) as Partial<ExportEngine>;
    if (typeof engine.convert !== 'function') throw new Error('Export engine is unavailable.');
    return engine as ExportEngine;
}

/**
 * 拡張UIで保存先を決め、原文をCLIと同じエンジンへ渡す。
 * @param request - 文書の確定済み原文、描画設定、保存形式と保存設定。
 * @returns キャンセル時はundefined、成功時は主出力とリンク先出力のURI。
 */
export async function exportWithEngine(
    request: ExportEngineRequest
): Promise<{ target: vscode.Uri; paths: vscode.Uri[] } | undefined> {
    if (request.documentUri.scheme !== 'file') throw new Error('Export requires a local file.');
    const sourcePath = request.documentUri.fsPath;
    const defaultPath = path.join(path.dirname(sourcePath),
        `${path.basename(sourcePath, path.extname(sourcePath))}.${request.format}`);
    const defaultUri = vscode.Uri.file(defaultPath);
    const saveWithoutDialog = request.format === 'pdf' ? request.pdfOptions.saveWithoutDialog
        : request.format === 'docx' ? request.docxOptions?.saveWithoutDialog
            : request.htmlOptions?.saveWithoutDialog;
    const spec = exportTargetSpec(request.format, request.rendering.language);
    const target = saveWithoutDialog ? defaultUri : await vscode.window.showSaveDialog({
        defaultUri,
        filters: spec.filters,
        saveLabel: spec.saveLabel
    });
    if (!target) return undefined;
    // 拡張子を消した保存先でも、関連付けアプリで開ける拡張子を補う。
    const outputPath = spec.hasExtension(target.fsPath) ? target.fsPath : `${target.fsPath}.${request.format}`;
    const workspaceRoot = vscode.workspace.getWorkspaceFolder(request.documentUri)?.uri.fsPath
        ?? path.dirname(sourcePath);
    const browserPath = vscode.workspace.getConfiguration('markdownEasyVisualEditor')
        .get<string>('pdf.browserPath', '').trim() || undefined;
    const theme = request.editorTheme;
    const mermaidTheme = request.rendering.mermaidTheme === 'auto'
        ? 'default' : request.rendering.mermaidTheme;
    const html = request.htmlOptions;
    const pdfOptions = request.pdfOptions ?? DEFAULT_PDF_OPTIONS;
    const args: EngineArguments = {
        input: sourcePath,
        output: outputPath,
        format: request.format,
        markdown: request.markdown,
        language: request.rendering.language,
        browserPath,
        workspaceRoot,
        theme,
        mermaidTheme,
        mermaidFontSize: request.rendering.mermaidFontSize,
        fontFamily: request.rendering.fontFamily,
        remoteImagesEnabled: request.rendering.remoteImagesEnabled,
        renderFormat: request.rendering.renderFormat,
        linked: html?.convertLinkedMarkdown ?? false,
        embedImages: html?.embedImages ?? false,
        outline: html?.showOutlineSidebar ?? false,
        frontMatter: 'render',
        force: true,
        // ヘッダー・フッターは印刷プレビューと同じ表示になるよう、エンジンだけが展開するトークンを保護する。
        pdfOptions: {
            ...pdfOptions,
            header: protectEngineOnlyPlaceholders(pdfOptions.header),
            footer: protectEngineOnlyPlaceholders(pdfOptions.footer)
        },
        htmlOptions: html,
        signal: request.signal
    };
    const paths = await loadExportEngine().convert(args);
    return { target: vscode.Uri.file(outputPath), paths: paths.map((item) => vscode.Uri.file(item)) };
}

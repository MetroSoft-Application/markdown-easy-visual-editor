/**
 * @fileoverview 保存ダイアログとVS Code文書の境界を保ち、出力要求時だけ独立エンジンを読む。
 * プレビューが使うPDF/HTML描画器やブラウザープールはこのモジュールを参照しない。
 */
import * as vscode from 'vscode';
import path from 'node:path';
import { getMessages } from '../shared/messages';
import {
    DEFAULT_PDF_OPTIONS,
    type EditorTheme,
    type ExportRenderSnapshot,
    type HtmlExportOptions,
    type PdfOptions
} from '../shared/protocol';

/** 拡張からCLIへ渡す値だけを定義し、CLIの型やソースをimportしない。 */
interface EngineArguments {
    input: string;
    output: string;
    format: 'html' | 'pdf';
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
    format: 'html' | 'pdf';
    rendering: ExportRenderSnapshot;
    editorTheme: EditorTheme;
    pdfOptions: PdfOptions;
    htmlOptions?: HtmlExportOptions;
    signal?: AbortSignal;
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
    const saveWithoutDialog = request.format === 'pdf'
        ? request.pdfOptions.saveWithoutDialog : request.htmlOptions?.saveWithoutDialog;
    const target = saveWithoutDialog ? defaultUri : await vscode.window.showSaveDialog({
        defaultUri,
        filters: request.format === 'pdf' ? { PDF: ['pdf'] } : { HTML: ['html', 'htm'] },
        saveLabel: request.format === 'pdf'
            ? getMessages(request.rendering.language).ribbon.labels.exportPdf : 'HTML出力'
    });
    if (!target) return undefined;
    const outputPath = request.format === 'html' && !/\.html?$/i.test(target.fsPath)
        ? target.fsPath + '.html' : target.fsPath;
    const workspaceRoot = vscode.workspace.getWorkspaceFolder(request.documentUri)?.uri.fsPath
        ?? path.dirname(sourcePath);
    const browserPath = vscode.workspace.getConfiguration('markdownEasyVisualEditor')
        .get<string>('pdf.browserPath', '').trim() || undefined;
    const theme = request.editorTheme;
    const mermaidTheme = request.rendering.mermaidTheme === 'auto'
        ? 'default' : request.rendering.mermaidTheme;
    const html = request.htmlOptions;
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
        force: true,
        pdfOptions: request.pdfOptions ?? DEFAULT_PDF_OPTIONS,
        htmlOptions: html,
        signal: request.signal
    };
    const paths = await loadExportEngine().convert(args);
    return { target: vscode.Uri.file(outputPath), paths: paths.map((item) => vscode.Uri.file(item)) };
}

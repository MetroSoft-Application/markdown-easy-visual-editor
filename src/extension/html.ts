import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import * as vscode from 'vscode';
import { marked } from 'marked';
import type { HtmlExportOptions } from '../shared/protocol';
import { collectLocalResourceReferences } from '../shared/markdown';
import { decodeLocalResourceSource } from './resourceCheck';

export interface HtmlExportRequest {
  markdown: string;
  html: string;
  css: string;
  options: HtmlExportOptions;
  documentUri: vscode.Uri;
  language: string;
}

export interface HtmlExportResult {
  target: vscode.Uri;
  paths: vscode.Uri[];
}

interface HtmlDocument {
  uri: vscode.Uri;
  sourcePath: string;
  markdown: string;
  html: string;
  outputPath: string;
}

/** 現在のMarkdownを単独で開けるHTMLへ変換し、必要ならリンク先も同じ構成で保存する。 */
export async function exportHtml(request: HtmlExportRequest): Promise<HtmlExportResult | undefined> {
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
  const documents = await collectDocuments(request, targetPath);
  const output = await Promise.all(documents.map(async (document) => {
    const body = await rewriteBody(
      document.html,
      document.sourcePath,
      document.outputPath,
      documents,
      request.options
    );
    const standalone = buildStandaloneHtml(body, request.css, request.language);
    await fs.mkdir(path.dirname(document.outputPath), { recursive: true });
    await fs.writeFile(document.outputPath, standalone, 'utf8');
    return vscode.Uri.file(document.outputPath);
  }));

  return {
    target: vscode.Uri.file(targetPath),
    paths: output
  };
}

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
      .filter((reference) => reference.kind === 'link');
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

function renderLinkedMarkdown(markdown: string): string {
  const renderer = new marked.Renderer();
  renderer.image = ({ href, title, text }) => {
    const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : '';
    return `<img src="${escapeAttribute(href)}" data-original-src="${escapeAttribute(href)}" alt="${escapeAttribute(text)}"${titleAttribute}>`;
  };
  return String(marked.parse(markdown, { gfm: true, renderer }));
}

function buildStandaloneHtml(body: string, css: string, language: string): string {
  const safeCss = css.replace(/<\/style/gi, '<\\/style');
  return `<!doctype html><html lang="${escapeAttribute(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${safeCss}\n${HTML_CSS}</style></head><body><main class="mve-html">${body}</main></body></html>`;
}

async function rewriteBody(
  html: string,
  sourcePath: string,
  outputPath: string,
  documents: HtmlDocument[],
  options: HtmlExportOptions
): Promise<string> {
  let result = stripUnsafeMarkup(html);
  const imageTags = [...result.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
  for (const tag of imageTags) {
    const replacement = await rewriteImageTag(tag, sourcePath, outputPath, options);
    result = result.replace(tag, replacement);
  }
  result = result.replace(/<a\b[^>]*>/gi, (tag) => rewriteLinkTag(tag, sourcePath, outputPath, documents, options));
  return result.replace(/\sdata-(?:original-src|mve-[\w-]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '');
}

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
  const linkedDocument = documents.find((document) => normalizePath(document.sourcePath) === normalizePath(linkedPath));
  const isMarkdown = isMarkdownPath(linkedPath);
  const destinationPath = options.convertLinkedMarkdown && isMarkdown && linkedDocument
    ? linkedDocument.outputPath
    : linkedPath;
  const fragment = readFragment(original);
  const destination = `${relativeHref(outputPath, destinationPath)}${fragment}`;
  return replaceAttribute(cleanDataAttributes(tag), 'href', destination);
}

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

function outputPathFor(sourcePath: string, rootSourcePath: string, rootOutputPath: string): string {
  const sourceRoot = path.dirname(rootSourcePath);
  const relative = path.relative(sourceRoot, sourcePath);
  const safeRelative = relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
    ? relative
    : path.join('_linked', `${createHash('sha1').update(sourcePath).digest('hex').slice(0, 10)}-${path.basename(sourcePath)}`);
  return path.join(path.dirname(rootOutputPath), replaceExtension(safeRelative, '.html'));
}

function relativeHref(fromFilePath: string, toFilePath: string): string {
  const relative = path.relative(path.dirname(fromFilePath), toFilePath).replace(/\\/g, '/');
  const normalized = relative || path.basename(toFilePath);
  return normalized.split('/').map((segment) => segment === '.' || segment === '..' ? segment : encodeURIComponent(segment)).join('/');
}

function readAttribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function replaceAttribute(tag: string, name: string, value: string): string {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
  const attribute = `${name}="${escapeAttribute(value)}"`;
  if (pattern.test(tag)) return tag.replace(pattern, attribute);
  if (/\/\s*>$/.test(tag)) return tag.replace(/\/\s*>$/, ` ${attribute}/>`);
  return tag.replace(/>$/, ` ${attribute}>`);
}

function cleanDataAttributes(tag: string): string {
  return tag.replace(/\sdata-(?:original-src|mve-[\w-]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '');
}

function decodeHtmlValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const decoded = value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  try {
    return decodeURIComponent(decoded);
  } catch {
    return decoded;
  }
}

function readFragment(value: string): string {
  const index = value.indexOf('#');
  if (index < 0) return '';
  return `#${encodeURIComponent(value.slice(index + 1))}`;
}

function isRemoteResource(value: string): boolean {
  return /^(?:https?:|mailto:|tel:|ftp:|data:|blob:|javascript:|#|\/\/)/i.test(value);
}

function isMarkdownPath(value: string): boolean {
  return /\.(?:md|markdown)$/i.test(value);
}

function normalizePath(value: string): string {
  return path.normalize(path.resolve(value)).toLowerCase();
}

function replaceExtension(value: string, extension: string): string {
  return value.replace(/\.[^./\\]+$/, extension);
}

function ensureHtmlExtension(value: string): string {
  return /\.html?$/i.test(value) ? value : `${value}.html`;
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function stripUnsafeMarkup(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    .replace(/javascript:/gi, '');
}

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

const HTML_CSS = `
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font-family: "Noto Sans JP", "Yu Gothic UI", sans-serif; color: #202124; background: #fff; }
  .mve-html { max-width: 100%; margin: 0 auto; padding: 24px; box-sizing: border-box; }
  img { max-width: 100%; height: auto; }
  table { width: 100%; border-collapse: collapse; }
  table th, table td { word-break: normal; overflow-wrap: anywhere; }
  pre { overflow-x: auto; }
  a { color: inherit; text-decoration: underline; }
`;

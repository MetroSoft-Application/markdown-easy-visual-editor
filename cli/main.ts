/**
 * @fileoverview Markdown-to-HTML/PDF CLI entrypoint. It parses file-based
 * requests, invokes the CLI-owned output modules, and closes browser resources.
 *
 * Markdown rendering and workspace helpers are shared with the editor; HTML
 * and PDF output implementations are owned by the CLI and also used in-process
 * by the Extension Host.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { Page } from 'playwright-core';
import { Uri, configureCliHost } from './vscode-bridge';
import { prepareHtmlExport, writePreparedHtml } from './html';
import { acquirePdfBrowser, closePdfBrowser, renderPdf } from './pdf';
import { closePeleRenderer, renderPeleMermaid } from '../src/extension/peleMermaid';
import { MAX_MERMAID_IMAGE_BYTES, resolveMermaidImageSources } from '../src/extension/mermaidImages';
import { namespaceMermaidSvg } from '../src/shared/mermaidSvg';
import { decodeLocalResourceSource } from '../src/extension/resourceCheck';
import { DEFAULT_HTML_EXPORT_OPTIONS, DEFAULT_PDF_OPTIONS } from '../src/shared/protocol';
import { DEFAULT_FONT_FAMILY_STACK } from '../src/shared/fontFamily';
import { hasMarpFrontMatterCandidate, isMarpMarkdown } from '../src/shared/marpFrontMatter';
import { prepareExportHtml } from '../src/shared/exportHtml';
import { printContentCss } from '../src/shared/printContentCss';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../src/shared/messages';

/** Formats accepted by the file-based CLI entrypoint. */
type OutputFormat = 'html' | 'pdf';
/** Heading themes accepted by HTML and PDF output. */
type Theme = 'dark' | 'light';
/** Normalized CLI arguments consumed by the conversion operation. */
interface Arguments {
    input: string;
    output?: string;
    format: OutputFormat;
    language: SupportedLanguage;
    browserPath?: string;
    workspaceRoot?: string;
    theme: Theme;
    mermaidTheme: 'default' | 'dark' | 'neutral';
    linked: boolean;
    embedImages: boolean;
    outline: boolean;
}

/** Directory containing the CLI bundle's copied renderer and print assets. */
const assetDir = __dirname;
/** Help text kept in sync with the accepted command-line options. */
const usage = `Usage: mve-convert INPUT.md [--format html|pdf] [-o OUTPUT]
  --format html|pdf       Output format (default: html)
  -o, --output PATH       Output file (default: INPUT.html or INPUT.pdf)
  --workspace-root PATH   Workspace root for root-relative Markdown links
  --browser PATH          Chromium/Edge/Chrome executable for rendering
  --language CODE         ja, en, zh-cn, ko, fr, de, es (default: ja)
  --theme light|dark      Heading color theme (default: dark)
  --mermaid-theme NAME    default, dark, neutral (default: default)
  --linked                Recursively export linked Markdown (HTML)
  --no-embed-images       Keep relative image paths (HTML)
  --outline               Add HTML outline sidebar
  -h, --help              Show usage
`;

/**
 * Parse CLI arguments into a normalized conversion request.
 * @param argv - Arguments after the executable name; paths remain resolved by the parser.
 * @returns A conversion request, or undefined when help was requested.
 * @throws Error when an option, value, or required input path is invalid.
 */
export function parseArguments(argv: readonly string[]): Arguments | undefined {
    if (argv.includes('-h') || argv.includes('--help')) return undefined;
    let input: string | undefined;
    let output: string | undefined;
    let format: OutputFormat = 'html';
    let language: SupportedLanguage = 'ja';
    let browserPath: string | undefined;
    let workspaceRoot: string | undefined;
    let theme: Theme = 'dark';
    let mermaidTheme: Arguments['mermaidTheme'] = 'default';
    let linked = false;
    let embedImages = true;
    let outline = false;
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--linked') { linked = true; continue; }
        if (arg === '--no-embed-images') { embedImages = false; continue; }
        if (arg === '--outline') { outline = true; continue; }
        if (!arg.startsWith('-')) {
            if (input !== undefined) throw new Error('Only one input file is supported.');
            input = arg;
            continue;
        }
        const value = argv[++index];
        if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
        switch (arg) {
            case '-o':
            case '--output':
                output = value;
                break;
            case '--format':
                if (value !== 'html' && value !== 'pdf') throw new Error('Invalid format: ' + value);
                format = value;
                break;
            case '--language':
                if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(value)) throw new Error('Invalid language: ' + value);
                language = value as SupportedLanguage;
                break;
            case '--browser':
                browserPath = value;
                break;
            case '--workspace-root':
                workspaceRoot = value;
                break;
            case '--theme':
                if (value !== 'dark' && value !== 'light') throw new Error('Invalid theme: ' + value);
                theme = value;
                break;
            case '--mermaid-theme':
                if (value !== 'default' && value !== 'dark' && value !== 'neutral') throw new Error('Invalid Mermaid theme: ' + value);
                mermaidTheme = value;
                break;
            default:
                throw new Error('Unknown argument: ' + arg);
        }
    }
    if (!input) throw new Error('Input Markdown path is required.');
    if (format === 'pdf' && (linked || outline || !embedImages)) {
        throw new Error('--linked, --outline, --no-embed-images are HTML-only options.');
    }
    return { input: path.resolve(input), output: output && path.resolve(output), format,
        language, browserPath, workspaceRoot, theme, mermaidTheme, linked, embedImages, outline };
}

/** Mermaid images may only read real files contained in the workspace. */
async function readDiagramLocalImage(
    source: string, sourceFile: string, workspaceRoot: string
): Promise<Uint8Array | undefined> {
    const clean = decodeLocalResourceSource(source);
    if (!clean || (/^[a-z][a-z0-9+.-]*:/i.test(clean) && !/^file:/i.test(clean))) return undefined;
    try {
        const name = /^file:/i.test(clean)
            ? fileURLToPath(clean)
            : path.resolve(path.dirname(sourceFile), clean);
        const [root, target] = await Promise.all([fs.realpath(workspaceRoot), fs.realpath(name)]);
        const relative = path.relative(root, target);
        if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return undefined;
        const stat = await fs.stat(target);
        if (!stat.isFile() || stat.size > MAX_MERMAID_IMAGE_BYTES) return undefined;
        return await fs.readFile(target);
    } catch {
        return undefined;
    }
}

/**
 * Run the original browser renderer (including DOMPurify), then the original
 * Pele diagram worker. Reusing one browser avoids repeated launch overhead.
 */
async function renderMarkdownFile(
    page: Page, markdown: string, sourceFile: string, args: Arguments
): Promise<string> {
    if (hasMarpFrontMatterCandidate(markdown) && isMarpMarkdown(markdown, (yaml) => {
        const parsed = parseYaml(yaml);
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
            && parsed.marp === true;
    })) {
        throw new Error('Marp documents require the dedicated slide export pipeline; this extraction does not yet provide it.');
    }
    const renderFormat = /\.textile$/i.test(sourceFile) ? 'textile' : 'mixed';
    const html = await page.evaluate(({ source, format, language }) => {
        const renderer = (globalThis as unknown as {
            mveMarkdownFallback?: {
                renderMarkdown: (input: string, options: {
                    remoteImagesEnabled: boolean; renderFormat: string; language: string
                }) => string;
            }
        }).mveMarkdownFallback;
        if (!renderer) throw new Error('Markdown fallback renderer was not loaded.');
        return renderer.renderMarkdown(source, {
            remoteImagesEnabled: true, renderFormat: format, language
        });
    }, { source: markdown, format: renderFormat, language: args.language });

    const diagrams = await page.evaluate((markup) => {
        const root = document.createElement('div');
        root.innerHTML = markup;
        return [...root.querySelectorAll<HTMLElement>('[data-mermaid-source]')].map((node) =>
            decodeURIComponent(node.dataset.mermaidSource ?? ''));
    }, html);
    if (!diagrams.length) return prepareExportHtml(html);

    const rendered = await Promise.all(diagrams.map(async (source, index) => {
        const result = await renderPeleMermaid(
            source, args.mermaidTheme, path.join(assetDir, 'pele-render-worker.js'),
            () => acquirePdfBrowser(args.language), undefined, {
                fontFamily: DEFAULT_FONT_FAMILY_STACK,
                resourceScope: sourceFile,
                resolveImages: (sources, signal) => resolveMermaidImageSources(
                    sources,
                    (image) => readDiagramLocalImage(image, sourceFile, args.workspaceRoot ?? path.dirname(sourceFile)),
                    signal
                )
            }
        );
        return namespaceMermaidSvg(result.svg, `cli-${index}`);
    }));
    return prepareExportHtml(await page.evaluate(({ markup, svgs }) => {
        const root = document.createElement('div');
        root.innerHTML = markup;
        const nodes = root.querySelectorAll<HTMLElement>('[data-mermaid-source]');
        nodes.forEach((node, index) => {
            node.innerHTML = svgs[index];
            node.setAttribute('data-mermaid-status', 'ready');
        });
        return root.innerHTML;
    }, { markup: html, svgs: rendered }));
}

/**
 * Render one Markdown file and write its selected HTML or PDF output.
 * @param args - Validated input, output, browser, and rendering options.
 * @returns Absolute paths written by this conversion.
 * @throws Error when input or output paths are invalid or rendering fails.
 */
export async function convert(args: Arguments): Promise<readonly string[]> {
    const inputStat = await fs.stat(args.input);
    if (!inputStat.isFile()) throw new Error('Input must be a file.');
    const output = args.output ?? args.input.replace(/\.[^.\\/]+$/, '') + '.' + args.format;
    if (path.resolve(output) === args.input) throw new Error('Output must differ from input.');
    configureCliHost({
        outputPath: output,
        workspaceRoot: args.workspaceRoot ?? path.dirname(args.input),
        browserPath: args.browserPath
    });
    const browser = await acquirePdfBrowser(args.language);
    const context = await browser.newContext({ javaScriptEnabled: true });
    try {
        const page = await context.newPage();
        await page.addScriptTag({ path: path.join(assetDir, 'markdown-fallback.js') });
        const markdown = await fs.readFile(args.input, 'utf8');
        const html = await renderMarkdownFile(page, markdown, args.input, args);
        const css = printContentCss(DEFAULT_FONT_FAMILY_STACK) + '\n'
            + await fs.readFile(path.join(assetDir, 'print-assets.css'), 'utf8');
        if (args.format === 'pdf') {
            const pdf = await renderPdf({
                html, css,
                documentUri: Uri.file(args.input),
                options: { ...DEFAULT_PDF_OPTIONS, saveWithoutDialog: true },
                editorTheme: args.theme,
                language: args.language,
                purpose: 'export'
            });
            await fs.mkdir(path.dirname(output), { recursive: true });
            await fs.writeFile(output, pdf);
            return [output];
        }
        const request = {
            markdown, html, css,
            options: { ...DEFAULT_HTML_EXPORT_OPTIONS,
                embedImages: args.embedImages,
                convertLinkedMarkdown: args.linked,
                showOutlineSidebar: args.outline,
                saveWithoutDialog: false
            },
            documentUri: Uri.file(args.input),
            language: args.language,
            fontFamily: DEFAULT_FONT_FAMILY_STACK,
            editorTheme: args.theme
        };
        // Exactly the host's collection, link rewrite, image embedding, and HTML writer.
        const preparation = await prepareHtmlExport(request);
        if (!preparation) throw new Error('Output path was not selected.');
        const linked = await Promise.all(preparation.documents.slice(1).map(async (document) => ({
            id: document.sourcePath,
            html: await renderMarkdownFile(page, document.markdown, document.sourcePath, args)
        })));
        const result = await writePreparedHtml(request, preparation, linked);
        return result.paths.map((uri) => uri.fsPath);
    } finally {
        await context.close().catch(() => undefined);
        await closePeleRenderer();
        await closePdfBrowser();
    }
}

/** Run the process entrypoint and translate failures into a nonzero exit code. */
async function main(): Promise<void> {
    try {
        const args = parseArguments(process.argv.slice(2));
        if (!args) {
            process.stdout.write(usage);
            return;
        }
        const written = await convert(args);
        for (const file of written) process.stdout.write(file + '\n');
    } catch (error) {
        process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
        process.exitCode = 1;
    }
}

if (require.main === module) void main();

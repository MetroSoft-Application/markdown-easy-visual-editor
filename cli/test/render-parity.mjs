/**
 * ブラウザーのスクリーンショット、PDF.jsによるページ画像化、画素差分を使い、
 * 実際のVS Code HTML/PDF出力とCLIの変換結果を比較する。
 *
 * node cli/test/render-parity.mjs --input sample.md
 *   --reference-html editor.html --reference-pdf editor.pdf
 *   [--browser /path/to/chromium] [--out-dir parity-results]
 *
 * 比較用ファイルは同じ設定で既存エディターから出力する。
 * PDFを生成できただけでは、出力互換性を検証したことにならない。
 */
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';

const run = promisify(execFile);
const flags = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
    if (!process.argv[i]?.startsWith('--') || !process.argv[i + 1]) {
        throw new Error('Every option must be a --name value pair.');
    }
    flags.set(process.argv[i], process.argv[i + 1]);
}
for (const name of ['--input', '--reference-html', '--reference-pdf']) {
    if (!flags.has(name)) throw new Error('Missing ' + name);
}
const source = path.resolve(flags.get('--input'));
const references = ['html', 'pdf'].map((ext) => path.resolve(flags.get('--reference-' + ext)));
const output = path.resolve(flags.get('--out-dir') || 'cli/visual-report');
const executable = flags.get('--browser') || process.env.MVE_CLI_TEST_BROWSER;
const maxRatio = Number(flags.get('--max-different-ratio') || '0');
if (!(maxRatio >= 0 && maxRatio <= 1)) throw new Error('Invalid pixel difference threshold.');
await fs.mkdir(output, { recursive: true });
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mve-visual-parity-'));
const candidates = ['html', 'pdf'].map((ext) => path.join(temp, 'candidate.' + ext));
const errors = [];
const report = { input: source, references, threshold: maxRatio, html: [], pdf: [], errors };
let browser;
let server;

async function screenshotHtml(file, label, width) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    try {
        await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 30000 });
        await page.evaluate(async () => {
            await document.fonts.ready;
            await Promise.all([...document.images].map((img) => img.complete
                ? undefined
                : Promise.race([
                    new Promise((resolve) => {
                        img.addEventListener('load', resolve, { once: true });
                        img.addEventListener('error', resolve, { once: true });
                    }),
                    new Promise((resolve) => setTimeout(resolve, 5000))
                ])));
        });
        const dom = await page.evaluate(() => {
            const main = document.querySelector('main') || document.body;
            return {
                text: main.innerText.replace(/\s+/g, ' ').trim(),
                headings: [...main.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => h.textContent.trim()),
                images: main.querySelectorAll('img').length,
                diagrams: main.querySelectorAll('svg').length,
                brokenImages: [...main.querySelectorAll('img')]
                    .filter((img) => !img.complete || !img.naturalWidth).map((img) => img.src.slice(0, 120)),
                unrenderedMermaid: main.querySelectorAll('[data-mermaid-source]:not(:has(svg))').length,
                overflow: [...main.querySelectorAll('table,pre,img,svg')]
                    .filter((el) => el.getBoundingClientRect().right > innerWidth + 3).length
            };
        });
        const png = path.join(output, label + '-' + width + '.png');
        await page.screenshot({ path: png, fullPage: true, animations: 'disabled' });
        return { png, dom, pageErrors };
    } finally {
        await page.close();
    }
}

async function pdfServer() {
    const allowed = new Map([
        ['/pdfjs.mjs', path.resolve('node_modules/pdfjs-dist/build/pdf.mjs')],
        ['/pdf.worker.min.mjs', path.resolve('node_modules/pdfjs-dist/build/pdf.worker.min.mjs')]
    ]);
    server = createServer(async (request, response) => {
        const file = allowed.get(request.url);
        if (!file) return void response.writeHead(404).end();
        try {
            response.writeHead(200, { 'content-type': 'text/javascript' });
            response.end(await fs.readFile(file));
        } catch {
            response.writeHead(500).end();
        }
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    return 'http://127.0.0.1:' + server.address().port + '/';
}

async function screenshotPdf(file, label, origin) {
    const page = await browser.newPage();
    try {
        await page.goto(origin);
        const pages = await page.evaluate(async (base64) => {
            const pdfjs = await import('/pdfjs.mjs');
            pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
            const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
            const document = await pdfjs.getDocument({ data: bytes }).promise;
            const results = [];
            for (let index = 1; index <= document.numPages; index++) {
                const sheet = await document.getPage(index);
                const viewport = sheet.getViewport({ scale: 1.5 });
                const canvas = window.document.createElement('canvas');
                canvas.width = Math.ceil(viewport.width);
                canvas.height = Math.ceil(viewport.height);
                await sheet.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
                const text = await sheet.getTextContent();
                results.push({
                    text: text.items.map((item) => item.str || '').join(' ').replace(/\s+/g, ' ').trim(),
                    width: canvas.width,
                    height: canvas.height,
                    data: canvas.toDataURL('image/png').split(',')[1]
                });
                canvas.width = canvas.height = 0;
                sheet.cleanup();
            }
            await document.destroy();
            return results;
        }, (await fs.readFile(file)).toString('base64'));
        return await Promise.all(pages.map(async (entry, i) => {
            const png = path.join(output, label + '-page-' + (i + 1) + '.png');
            await fs.writeFile(png, Buffer.from(entry.data, 'base64'));
            return { ...entry, data: undefined, png };
        }));
    } finally {
        await page.close();
    }
}

async function pixels(left, right, name) {
    const page = await browser.newPage();
    try {
        const [a, b] = await Promise.all([fs.readFile(left), fs.readFile(right)]);
        const result = await page.evaluate(async ({ first, second }) => {
            const image = (b64) => new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = 'data:image/png;base64,' + b64;
            });
            const [a, b] = await Promise.all([image(first), image(second)]);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(a.width, b.width);
            canvas.height = Math.max(a.height, b.height);
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            const sample = (img) => {
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0);
                return ctx.getImageData(0, 0, canvas.width, canvas.height);
            };
            const x = sample(a), y = sample(b), diff = ctx.createImageData(canvas.width, canvas.height);
            let changed = 0;
            for (let i = 0; i < x.data.length; i += 4) {
                const mismatch = Math.max(
                    Math.abs(x.data[i] - y.data[i]),
                    Math.abs(x.data[i + 1] - y.data[i + 1]),
                    Math.abs(x.data[i + 2] - y.data[i + 2])
                ) > 0;
                if (mismatch) changed++;
                diff.data[i] = mismatch ? 255 : 245;
                diff.data[i + 1] = mismatch ? 0 : 245;
                diff.data[i + 2] = mismatch ? 0 : 245;
                diff.data[i + 3] = 255;
            }
            ctx.putImageData(diff, 0, 0);
            return {
                ratio: changed / (canvas.width * canvas.height),
                referenceSize: [a.width, a.height], candidateSize: [b.width, b.height],
                png: canvas.toDataURL('image/png').split(',')[1]
            };
        }, { first: a.toString('base64'), second: b.toString('base64') });
        const png = path.join(output, name + '-diff.png');
        await fs.writeFile(png, Buffer.from(result.png, 'base64'));
        return { ratio: result.ratio, referenceSize: result.referenceSize,
            candidateSize: result.candidateSize, diff: png };
    } finally {
        await page.close();
    }
}

try {
    await fs.stat('cli/dist/mve-convert.cjs').catch(() => {
        throw new Error('Build CLI first: npm run build:cli');
    });
    browser = await chromium.launch(executable
        ? { executablePath: path.resolve(executable), headless: true }
        : { channel: 'chrome', headless: true });
    for (const [index, ext] of ['html', 'pdf'].entries()) {
        const args = ['cli/dist/mve-convert.cjs', source, '--format', ext, '--output', candidates[index]];
        if (executable) args.push('--browser', executable);
        if (flags.has('--workspace-root')) args.push('--workspace-root', flags.get('--workspace-root'));
        if (ext === 'html' && flags.has('--linked')) args.push('--linked');
        if (ext === 'html' && flags.has('--outline')) args.push('--outline');
        await run(process.execPath, args, { timeout: 180000 });
    }
    for (const width of [800, 1440]) {
        const [reference, candidate] = await Promise.all([
            screenshotHtml(references[0], 'reference-html', width),
            screenshotHtml(candidates[0], 'candidate-html', width)
        ]);
        const difference = await pixels(reference.png, candidate.png, 'html-' + width);
        const problems = [];
        if (reference.dom.text !== candidate.dom.text) problems.push('body text');
        if (JSON.stringify(reference.dom.headings) !== JSON.stringify(candidate.dom.headings)) problems.push('headings');
        if (reference.dom.images !== candidate.dom.images || reference.dom.diagrams !== candidate.dom.diagrams) problems.push('images/SVG');
        if (reference.dom.brokenImages.length || candidate.dom.brokenImages.length) problems.push('broken images');
        if (reference.dom.unrenderedMermaid || candidate.dom.unrenderedMermaid) problems.push('unrendered Mermaid');
        if (candidate.dom.overflow) problems.push('horizontal overflow');
        if (candidate.pageErrors.length) problems.push('browser exceptions');
        if (difference.ratio > maxRatio) problems.push('rendered pixel difference');
        if (problems.length) errors.push('HTML ' + width + 'px: ' + problems.join(', '));
        report.html.push({ width, difference, problems, reference, candidate });
    }
    const origin = await pdfServer();
    const [referencePages, candidatePages] = await Promise.all([
        screenshotPdf(references[1], 'reference-pdf', origin),
        screenshotPdf(candidates[1], 'candidate-pdf', origin)
    ]);
    if (referencePages.length !== candidatePages.length) errors.push('PDF page count mismatch');
    for (let index = 0; index < Math.min(referencePages.length, candidatePages.length); index++) {
        const reference = referencePages[index], candidate = candidatePages[index];
        const difference = await pixels(reference.png, candidate.png, 'pdf-page-' + (index + 1));
        const problems = [];
        if (reference.text !== candidate.text) problems.push('text');
        if (reference.width !== candidate.width || reference.height !== candidate.height) problems.push('page size');
        if (difference.ratio > maxRatio) problems.push('rendered pixel difference');
        if (problems.length) errors.push('PDF page ' + (index + 1) + ': ' + problems.join(', '));
        report.pdf.push({ page: index + 1, reference, candidate, difference, problems });
    }
    report.pdfPageCounts = { reference: referencePages.length, candidate: candidatePages.length };
} catch (error) {
    errors.push(error.stack || String(error));
} finally {
    if (browser) await browser.close().catch(() => undefined);
    if (server) await new Promise((resolve) => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log('Visual comparison:', path.join(output, 'report.json'));
for (const error of errors) console.error(error);
if (errors.length) process.exitCode = 1;

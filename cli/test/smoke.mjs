/**
 * Browser-backed CLI smoke tests. Run after the editor and CLI bundles build.
 * These exercise exported files, rather than merely parsing CLI options.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const exec = promisify(execFile);
const executable = path.resolve('cli/dist/mve-convert.cjs');
const browserArgs = process.env.MVE_CLI_TEST_BROWSER
    ? ['--browser', process.env.MVE_CLI_TEST_BROWSER]
    : [];

async function withDocument(callback) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'mve-cli-smoke-'));
    try {
        const source = path.join(root, 'index.md');
        await mkdir(path.join(root, 'assets'), { recursive: true });
        await writeFile(path.join(root, 'assets', 'pixel.svg'),
            '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2"/></svg>');
        await writeFile(path.join(root, 'child.md'), '# Child section\n\n**Linked body**\n');
        await writeFile(source, [
            '# CLI document',
            '',
            '[Child](child.md)',
            '',
            '![Local image](assets/pixel.svg)',
            '',
            '$x^2$',
            '',
            '```mermaid',
            'flowchart LR',
            '  A --> B',
            '```',
            ''
        ].join('\n'));
        await callback({ root, source });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

test('CLI exposes standalone HTML/PDF usage', async () => {
    const { stdout } = await exec(process.execPath, [executable, '--help']);
    assert.match(stdout, /--format html\|pdf/);
});

test('HTML CLI renders math, Mermaid, local images and linked Markdown', async () => {
    await withDocument(async ({ root, source }) => {
        const output = path.join(root, 'export', 'result.html');
        await exec(process.execPath, [
            executable, source, '--format', 'html', '--output', output,
            '--linked', '--outline', '--workspace-root', root, ...browserArgs
        ], { timeout: 180_000 });
        const html = await readFile(output, 'utf8');
        const child = await readFile(path.join(root, 'export', 'child.html'), 'utf8');
        assert.match(html, /CLI document/);
        assert.match(html, /mve-html-outline/);
        assert.match(html, /data:image\/svg\+xml;base64,/);
        assert.match(html, /class="katex/);
        assert.match(html, /<svg\b/);
        assert.match(html, /child\.html/);
        assert.match(child, /Linked body/);
    });
});

test('PDF CLI produces a nonempty real PDF', async () => {
    await withDocument(async ({ root, source }) => {
        const output = path.join(root, 'render.pdf');
        await exec(process.execPath, [
            executable, source, '--format', 'pdf', '--output', output,
            '--workspace-root', root, ...browserArgs
        ], { timeout: 180_000 });
        const pdf = await readFile(output);
        assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
        assert.ok(pdf.length > 1000, 'PDF document should contain actual rendered pages');
    });
});

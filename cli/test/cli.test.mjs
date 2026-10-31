/**
 * @fileoverview CLIの引数境界と出力保護を検証する。リンク先と同時書き込みは実ブラウザーで確認する。
 * 独立コピーでも実行できるよう、親リポジトリのファイルを参照しない。
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { link, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import test from 'node:test';
import { findTestBrowser } from './browser.mjs';

/** CLI成果物はテストの配置から解決し、呼び出し側の作業ディレクトリに依存しない。 */
const cli = fileURLToPath(new URL('../dist/mve-convert.cjs', import.meta.url));
/** 子プロセスの終了コードと出力を取得するためのPromise版。 */
const execute = promisify(execFile);
/** CLIの公開APIをパッケージ成果物から読み込む。 */
const require = createRequire(import.meta.url);
/** リンク先の実変換と同時書き込みを検証するブラウザー。 */
const browserPath = findTestBrowser();
if (process.env.MVE_REQUIRE_BROWSER_TESTS === '1' && !browserPath) {
  throw new Error('Browser tests are required, but no Chromium/Edge/Chrome executable was found.');
}

/**
 * 意図した入力だけを用いる一時ディレクトリを作り、テスト終了後に解放する。
 * @param callback - 一時ディレクトリ内で実行する検証。
 */
async function withDirectory(callback) {
  const directory = await mkdtemp(path.join(tmpdir(), 'mve-cli-test-'));
  try {
    await callback(directory);
  } finally {
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(directory));
    assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative), 'refusing to remove a path outside the temp directory');
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * 不正な引数や出力先衝突を、書き込み前に区別する契約を検証する。
 */
test('argument errors and output collisions do not overwrite files', async () => {
  await withDirectory(async (directory) => {
    const input = path.join(directory, 'input.md');
    const output = path.join(directory, 'output.html');
    await writeFile(input, '# Source\n');
    await writeFile(output, 'sentinel');
    for (const requestedOutput of [output, output.slice(0, -5)]) {
      await assert.rejects(execute(process.execPath, [cli, input, '--format', 'html', '--output', requestedOutput]),
        (error) => error.code === 1 && /Output already exists/.test(error.stderr));
      assert.equal(await readFile(output, 'utf8'), 'sentinel');
    }
    await assert.rejects(execute(process.execPath, [cli, input, '--format', 'pdf', '--output', input, '--force']),
      (error) => error.code === 1 && /Output must differ from input/.test(error.stderr));
    assert.equal(await readFile(input, 'utf8'), '# Source\n');
    await assert.rejects(execute(process.execPath, [cli, input, '--format', 'unknown']),
      (error) => error.code === 2 && /Invalid format/.test(error.stderr));
  });
});

/** 拡張子補完後の既存HTMLは、明示的な--forceを指定した場合だけ置換できる。 */
test('force overwrites the normalized HTML destination', { skip: !browserPath }, async () => {
  await withDirectory(async (directory) => {
    const input = path.join(directory, 'input.md');
    const output = path.join(directory, 'result.html');
    await writeFile(input, '# Replacement marker\n');
    await writeFile(output, 'sentinel');
    const result = await execute(process.execPath, [cli, input, '--format', 'html',
      '--output', output.slice(0, -5), '--browser', browserPath, '--force']);
    assert.equal(result.stdout.trim(), output);
    assert.match(await readFile(output, 'utf8'), /Replacement marker/);
    assert.equal(await readFile(input, 'utf8'), '# Replacement marker\n');
  });
});

/** 主文書とリンク先、または拡張子だけ異なるリンク先の出力衝突は、forceでも全書込前に拒否する。 */
test('linked output collisions fail before writing any document', { skip: !browserPath }, async () => {
  await withDirectory(async (directory) => {
    const input = path.join(directory, 'index.md');
    await writeFile(path.join(directory, 'child.md'), '# Child marker\n');
    await writeFile(path.join(directory, 'page.md'), '# Markdown marker\n');
    await writeFile(path.join(directory, 'page.textile'), 'h1. Textile marker\n');
    for (const [markdown, destination] of [
      ['[Child](child.md)\n', 'child.html'],
      ['[Markdown](page.md)\n\n[Textile](page.textile)\n', 'index.html'],
    ]) {
      await writeFile(input, markdown);
      for (const force of [[], ['--force']]) {
        await assert.rejects(execute(process.execPath, [cli, input, '--format', 'html',
          '--output', path.join(directory, destination), '--html-linked', '--browser', browserPath, ...force]),
        (error) => error.code === 1 && /Output paths must be distinct/.test(error.stderr));
        assert.deepEqual((await readdir(directory)).filter((name) => name.endsWith('.html')), []);
        assert.equal(await readFile(input, 'utf8'), markdown);
      }
    }
  });
});

/** 同時実行した別文書は既存確認を両方通過しても、一方だけが出力を新規作成できる。 */
test('concurrent conversions do not overwrite each other without force', { skip: !browserPath }, async () => {
  await withDirectory(async (directory) => {
    const output = path.join(directory, 'result.html');
    const markers = ['ConcurrentAlphaMarker', 'ConcurrentBetaMarker'];
    const inputs = markers.map((marker) => path.join(directory, `${marker}.md`));
    for (let index = 0; index < inputs.length; index += 1) {
      await writeFile(inputs[index], `# ${markers[index]}\n`);
    }
    const results = await Promise.allSettled(inputs.map((input) => execute(process.execPath,
      [cli, input, '--format', 'html', '--output', output, '--browser', browserPath])));
    const winner = results.findIndex((result) => result.status === 'fulfilled');
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const loser = results[1 - winner];
    assert.equal(loser.reason.code, 1);
    assert.match(loser.reason.stderr, /Output already exists|EEXIST/);
    const html = await readFile(output, 'utf8');
    assert.ok(html.includes(markers[winner]));
    assert.ok(!html.includes(markers[1 - winner]));
  });
});

/** 大小文字を区別する実ファイルシステムでは、両文書の本文とリンク先を別々に保持する。 */
test('linked documents preserve case-sensitive filenames', { skip: !browserPath }, async (context) => {
  await withDirectory(async (directory) => {
    const upper = path.join(directory, 'A.md');
    const lower = path.join(directory, 'a.md');
    await writeFile(upper, '# UpperCaseMarker\n', { flag: 'wx' });
    try {
      await writeFile(lower, '# LowerCaseMarker\n', { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      context.skip('The temporary filesystem does not distinguish filename case.');
      return;
    }
    const input = path.join(directory, 'index.md');
    const output = path.join(directory, 'index.html');
    await writeFile(input, '[Upper](A.md)\n\n[Lower](a.md)\n');
    await execute(process.execPath, [cli, input, '--format', 'html', '--output', output,
      '--html-linked', '--browser', browserPath]);
    const html = await readFile(output, 'utf8');
    assert.match(html, /href="A\.html"/);
    assert.match(html, /href="a\.html"/);
    assert.match(await readFile(path.join(directory, 'A.html'), 'utf8'), /UpperCaseMarker/);
    assert.match(await readFile(path.join(directory, 'a.html'), 'utf8'), /LowerCaseMarker/);
  });
});

/**
 * 設定エラーが変換前に報告され、基本のCLI操作が実行可能なことを検証する。
 */
test('help, version and malformed JSON configuration', async () => {
  await withDirectory(async (directory) => {
    const input = path.join(directory, 'input.md');
    const config = path.join(directory, 'export.json');
    await writeFile(input, '# Source\n');
    await writeFile(config, '{ invalid json');
    const help = await execute(process.execPath, [cli, '--help']);
    assert.match(help.stdout, /mve-convert INPUT\.md/);
    const version = await execute(process.execPath, [cli, '--version']);
    assert.match(version.stdout, /^\d+\.\d+\.\d+\n$/);
    await assert.rejects(execute(process.execPath, [cli, input, '--format', 'html', '--config', config]),
      (error) => error.code === 2 && /JSON/.test(error.stderr));
  });
});

/**
 * PDF設定の誤記と壊れた置換パターンは、正規化で隠さず書き込み前に拒否する。
 */
test('invalid export settings fail before output is written', async () => {
  await withDirectory(async (directory) => {
    const input = path.join(directory, 'input.md');
    const output = path.join(directory, 'output.pdf');
    const config = path.join(directory, 'export.json');
    await writeFile(input, '# Source\n');
    for (const pdf of [
      { format: 'Letter' },
      { textReplacements: [{ pattern: '[', replacement: 'x' }] },
      { margins: { top: 'invalid' } },
    ]) {
      await writeFile(config, JSON.stringify({ pdf }));
      await assert.rejects(execute(process.execPath,
        [cli, input, '--format', 'pdf', '--output', output, '--config', config]),
      (error) => error.code === 2 && /Invalid pdf/.test(error.stderr));
      await assert.rejects(readFile(output), { code: 'ENOENT' });
    }
  });
});

/** `--force` でも原文のハードリンク別名は入力として保護する。 */
test('force refuses an output hard link to the input', async () => {
  await withDirectory(async (directory) => {
    const input = path.join(directory, 'input.md');
    const output = path.join(directory, 'output.pdf');
    await writeFile(input, '# Keep this source\n');
    await link(input, output);
    await assert.rejects(execute(process.execPath,
      [cli, input, '--format', 'pdf', '--output', output, '--force']),
    (error) => error.code === 1 && /Output must differ from input/.test(error.stderr));
    assert.equal(await readFile(input, 'utf8'), '# Keep this source\n');
  });
});

/** 中断済みの要求は描画やファイル書き込みへ進めない。 */
test('a cancelled conversion does not write an output', async () => {
  await withDirectory(async (directory) => {
    const controller = new AbortController();
    controller.abort();
    const output = path.join(directory, 'cancelled.html');
    const { convert } = require(cli);
    await assert.rejects(convert({ input: path.join(directory, 'input.md'), output,
      format: 'html', language: 'ja', theme: 'dark', mermaidTheme: 'dark',
      linked: false, embedImages: false, outline: false, signal: controller.signal }),
    (error) => error.name === 'AbortError');
    await assert.rejects(readFile(output), { code: 'ENOENT' });
  });
});

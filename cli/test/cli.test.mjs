/**
 * @fileoverview CLIの引数境界と書き込み前の衝突検出を、ブラウザーなしで検証する。
 * 独立コピーでも実行できるよう、親リポジトリのファイルを参照しない。
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { link, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import test from 'node:test';

/** CLI成果物はテストの配置から解決し、呼び出し側の作業ディレクトリに依存しない。 */
const cli = fileURLToPath(new URL('../dist/mve-convert.cjs', import.meta.url));
/** 子プロセスの終了コードと出力を取得するためのPromise版。 */
const execute = promisify(execFile);
/** CLIの公開APIをパッケージ成果物から読み込む。 */
const require = createRequire(import.meta.url);

/**
 * 意図した入力だけを用いる一時ディレクトリを作り、テスト終了後に解放する。
 * @param callback - 一時ディレクトリ内で実行する検証。
 */
async function withDirectory(callback) {
  const directory = await mkdtemp(path.join(tmpdir(), 'mve-cli-test-'));
  try {
    await callback(directory);
  } finally {
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
    await assert.rejects(execute(process.execPath, [cli, input, '--format', 'html', '--output', output]),
      (error) => error.code === 1 && /Output already exists/.test(error.stderr));
    assert.equal(await readFile(output, 'utf8'), 'sentinel');
    await assert.rejects(execute(process.execPath, [cli, input, '--format', 'pdf', '--output', input, '--force']),
      (error) => error.code === 1 && /Output must differ from input/.test(error.stderr));
    assert.equal(await readFile(input, 'utf8'), '# Source\n');
    await assert.rejects(execute(process.execPath, [cli, input, '--format', 'unknown']),
      (error) => error.code === 2 && /Invalid format/.test(error.stderr));
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

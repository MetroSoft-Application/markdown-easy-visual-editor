/**
 * @fileoverview cli/だけをOSの一時領域へ複製し、親のソースとnode_modulesに
 * 到達しない場所でインストール、検査、ビルド、実変換、npm pack後の実行を確認する。
 * 生成した一時領域はこのスクリプトだけが所有し、結果をJSONで保存する。
 */
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 作業ディレクトリと結果JSONの場所をリポジトリ位置から決定する。 */
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** 親の依存解決を遮断するため、コピー先はリポジトリ外のOS一時領域にする。 */
const sandbox = await mkdtemp(path.join(tmpdir(), 'mve-cli-isolation-'));
/** CLIソースを配置する独立ディレクトリ。 */
const standalone = path.join(sandbox, 'cli');
/** npm pack成果物の展開先。 */
const packed = path.join(sandbox, 'packed');
/** 証跡へ記録する各段階の結果。 */
const results = [];

/**
 * 子プロセスを待ち、終了コードと出力を記録する。期待外の終了は直ちに失敗させる。
 * @param command - 実行ファイル。
 * @param args - 固定した引数配列。
 * @param cwd - 親リポジトリへ到達しない実行ディレクトリ。
 */
async function run(command, args, cwd) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === 'win32' && command === 'npm.cmd',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
  results.push({ command, args, cwd, ...result });
  if (result.code !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.code}): ${result.stderr || result.stdout}`);
  return result;
}

/**
 * コピー対象をCLI内の手書きソースとlockfileに限定し、既存生成物と依存を除く。
 * @param source - fs.cpが列挙したコピー元。
 */
function sourceFilter(source) {
  const relative = path.relative(path.join(repository, 'cli'), source);
  return !relative.split(path.sep).some((component) => component === 'node_modules' || component === 'dist');
}

/** CLIの自動ブラウザー選択と同じ順序で、既存ブラウザーを検出する。 */
async function browserPath() {
  for (const candidate of [
    process.env.MVE_BROWSER_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ]) {
    if (candidate && await stat(candidate).then((item) => item.isFile()).catch(() => false)) return candidate;
  }
  throw new Error('Edge or Chrome executable was not found for real output verification.');
}

try {
  await cp(path.join(repository, 'cli'), standalone, { recursive: true, filter: sourceFilter });
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  await run(npm, ['ci', '--ignore-scripts'], standalone);
  await run(npm, ['run', 'check'], standalone);
  await run(npm, ['test'], standalone);
  const browser = await browserPath();
  const input = path.join(sandbox, '図と数式.md');
  await writeFile(input, '# 隔離出力\n\n```mermaid\ngraph LR\nA-->B\n```\n\n$E=mc^2$\n');
  for (const format of ['html', 'pdf']) {
    const output = path.join(sandbox, `standalone.${format}`);
    await run(process.execPath, [path.join(standalone, 'dist', 'mve-convert.cjs'), input,
      '--format', format, '--output', output, '--browser', browser], sandbox);
    const data = await readFile(output);
    if (format === 'pdf' && data.subarray(0, 5).toString() !== '%PDF-') throw new Error('PDF signature is missing.');
    if (format === 'html' && !data.toString().includes('<svg')) throw new Error('Mermaid SVG is missing from HTML.');
  }
  await run(npm, ['pack', '--pack-destination', sandbox], standalone);
  const archive = (await readdir(sandbox)).find((name) => name.endsWith('.tgz'));
  if (!archive) throw new Error('npm pack did not create a tarball.');
  await mkdir(packed);
  await run('tar', ['-xzf', path.join(sandbox, archive), '-C', packed], sandbox);
  const packedBin = path.join(packed, 'package', 'dist', 'mve-convert.cjs');
  await run(process.execPath, [packedBin, input, '--format', 'html',
    '--output', path.join(sandbox, 'packed.html'), '--browser', browser], sandbox);
  const packedHtml = await readFile(path.join(sandbox, 'packed.html'), 'utf8');
  if (!packedHtml.includes('<svg')) throw new Error('Packed CLI omitted the Mermaid renderer.');
} catch (error) {
  results.push({ error: error instanceof Error ? error.stack : String(error) });
  process.exitCode = 1;
} finally {
  const reportPath = path.join(repository, 'artifacts', 'cli-extraction', 'cli-isolation.json');
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify({ sandbox, results }, null, 2) + '\n');
  // mkdtempで作成した専用領域のみを解放する。
  await rm(sandbox, { recursive: true, force: true });
  console.log(reportPath);
}

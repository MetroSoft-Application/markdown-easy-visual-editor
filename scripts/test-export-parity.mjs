/**
 * @fileoverview 拡張配布位置の遅延ロード用エンジンとCLI実行ファイルを、
 * 同一原文・設定・ブラウザーでHTML DOM/画面とPDF全ページ画像まで比較する。
 * 実Workbench経由の確認は別のUI証跡で行う。
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

/** この検証スクリプトのファイル位置に固定したrequire。 */
const require = createRequire(import.meta.url);
/** 配布時と同じ場所に置いた出力エンジン。 */
const engine = require('../dist/export-engine/mve-convert.cjs');
/** 比較対象を収める生成物ディレクトリ。 */
const directory = path.resolve('artifacts/cli-extraction/export-parity');
/** 子プロセスの完了と終了コードを取得するPromise版。 */
const execute = promisify(execFile);

/** WindowsでCLIと拡張が共通して使える既存Chromiumを選ぶ。 */
async function browserPath() {
  for (const candidate of [
    process.env.MVE_BROWSER_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ]) {
    if (candidate && await stat(candidate).then((item) => item.isFile()).catch(() => false)) return candidate;
  }
  throw new Error('An installed Edge or Chrome browser is required.');
}

await mkdir(directory, { recursive: true });
const browser = await browserPath();
const input = path.join(directory, '日本語 テスト.md');
const referenceHtml = path.join(directory, 'extension-engine.html');
const referencePdf = path.join(directory, 'extension-engine.pdf');
await writeFile(input, '# 日本語の出力\n\n| 項目 | 値 |\n| --- | --- |\n| 表 | 折り返し |\n\n' +
  '```mermaid\ngraph LR\n  A[開始] --> B[終了]\n```\n\n$E=mc^2$\n');
const markdown = await readFile(input, 'utf8');
await Promise.all(['html', 'pdf'].map((format) =>
  engine.convert({
    input, output: format === 'html' ? referenceHtml : referencePdf,
    format, markdown, language: 'ja', browserPath: browser,
    workspaceRoot: directory, theme: 'dark', mermaidTheme: 'auto',
    linked: false, embedImages: false, outline: false, force: true,
    remoteImagesEnabled: true, renderFormat: 'mixed',
  })));
const comparison = await execute(process.execPath, [
  'cli/test/render-parity.mjs', '--input', input,
  '--reference-html', referenceHtml, '--reference-pdf', referencePdf,
  '--browser', browser, '--out-dir', directory,
], { maxBuffer: 1024 * 1024 });
console.log(comparison.stdout.trim());

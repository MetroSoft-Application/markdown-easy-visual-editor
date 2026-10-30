/**
 * @fileoverview 各プレビュー入口のビルド依存グラフにCLIのコード・型・資産が
 * 混入しないことを検査する。保存専用アダプターはプレビュー入口に含めない。
 */
import * as esbuild from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** プレビューの実行境界に対応するソース入口。 */
const entries = [
  ['normal-and-latex', 'src/webview/index.tsx', 'browser'],
  ['marp', 'src/webview/marp/marp.worker.ts', 'browser'],
  ['print', 'src/extension/pdf.ts', 'node'],
  ['mermaid', 'src/extension/peleMermaid.ts', 'node'],
  ['generated-html', 'src/extension/htmlPreview.ts', 'node'],
];
/** 判定結果を実行環境とともに保存するレコード。 */
const report = [];
let failed = false;

for (const [name, entry, platform] of entries) {
  try {
    const result = await esbuild.build({
      entryPoints: [entry], bundle: true, write: false, metafile: true,
      outdir: 'dist/.preview-independence',
      platform, format: platform === 'node' ? 'cjs' : 'iife',
      target: platform === 'node' ? 'node20' : 'chrome120',
      external: platform === 'node' ? ['vscode', 'playwright-core'] : [],
      loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
    });
    const inputs = Object.keys(result.metafile.inputs).map((item) => item.replaceAll('\\', '/'));
    const cliInputs = inputs.filter((item) => item.startsWith('cli/') || item.includes('/cli/'));
    report.push({ name, entry, inputs: inputs.length, cliInputs });
    if (cliInputs.length) failed = true;
  } catch (error) {
    report.push({ name, entry, error: error instanceof Error ? error.message : String(error) });
    failed = true;
  }
}

const output = path.resolve('artifacts/cli-extraction/preview-independence.json');
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ report }, null, 2) + '\n');
console.log(output);
if (failed) process.exitCode = 1;

/**
 * @fileoverview VS Code Extension Hostを取り込まず、独立したNode.js CLIをビルドする。
 * エディターはCLIが所有するHTML/PDF出力モジュールをプロセス内で読み込む。
 * CLI内の変換ソースだけからMarkdownレンダラーとMermaidワーカーも生成する。
 */
import * as esbuild from 'esbuild';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** コピー先の作業ディレクトリに左右されないCLIソースの配置。 */
const root = path.dirname(fileURLToPath(import.meta.url));
/** HTML/PDF変換時に参照する実行ファイルと描画資産の配置。 */
const outdir = path.join(root, 'dist');
/** CLI内の依存を優先し、親ビルドから起動された場合も解決元を明示する。 */
const requireFromCli = createRequire(import.meta.url);
await mkdir(outdir, { recursive: true });
await copyFile(path.join(path.dirname(requireFromCli.resolve('playwright-core')), 'browsers.json'),
  path.join(root, 'browsers.json'));
await esbuild.build({
  entryPoints: [path.join(root, 'main.ts')],
  outfile: path.join(outdir, 'mve-convert.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  external: [],
  logLevel: 'info'
});
await esbuild.build({
  entryPoints: [path.join(root, 'print-assets.css')],
  outfile: path.join(outdir, 'print-assets.css'),
  bundle: true,
  minify: true,
  loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
  logLevel: 'info'
});
await esbuild.build({
  entryPoints: [path.join(root, 'source', 'runtime', 'peleWorker.ts')],
  outfile: path.join(outdir, 'pele-render-worker.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['chrome120'],
  minify: true,
  sourcemap: false,
  logLevel: 'info'
});
await esbuild.build({
  entryPoints: [path.join(root, 'source', 'webview', 'markdown', 'markdownRenderer.ts')],
  outfile: path.join(outdir, 'markdown-fallback.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['chrome120'],
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  globalName: 'mveMarkdownFallback',
  logLevel: 'info'
});
/** 置換ルールは別のブラウザーWorkerで実行し、病的な正規表現を2秒で中断する。 */
await esbuild.build({
  entryPoints: [path.join(root, 'source', 'outputReplacements.ts')],
  outfile: path.join(outdir, 'output-replacements.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['chrome120'],
  minify: true,
  globalName: 'mveOutputReplacements',
  logLevel: 'info'
});
await chmod(path.join(outdir, 'mve-convert.cjs'), 0o755);
console.log('CLI built: dist/mve-convert.cjs');

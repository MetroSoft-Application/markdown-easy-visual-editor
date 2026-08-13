import * as esbuild from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

const extensionOptions = {
  entryPoints: ['src/extension/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: false,
  external: ['vscode'],
  logLevel: 'info'
};

const webviewOptions = {
  entryPoints: ['src/webview/index.tsx'],
  bundle: true,
  outfile: 'dist/webview.js',
  platform: 'browser',
  format: 'iife',
  target: ['chrome120'],
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  minify: !watch,
  sourcemap: false,
  loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
  logLevel: 'info'
};

async function copyAssets() {
  await mkdir('dist', { recursive: true });
  await Promise.all([
    copyFile('src/webview/styles.css', 'dist/styles.css'),
    copyFile('node_modules/pdfjs-dist/build/pdf.min.mjs', 'dist/pdfjs.mjs'),
    copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'dist/pdf.worker.min.mjs'),
    copyFile('node_modules/playwright-core/browsers.json', 'browsers.json')
  ]);
}

await copyAssets();

if (watch) {
  const extensionContext = await esbuild.context(extensionOptions);
  const webviewContext = await esbuild.context(webviewOptions);
  await Promise.all([extensionContext.watch(), webviewContext.watch()]);
  console.log('Watching extension and webview...');
} else {
  await Promise.all([esbuild.build(extensionOptions), esbuild.build(webviewOptions)]);
}

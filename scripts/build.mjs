import * as esbuild from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';

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
  plugins: [{
    name: 'defer-playwright-runtime',
    setup(build) {
      build.onResolve({ filter: /^playwright-core$/ }, () => ({
        path: './playwright.js',
        external: true
      }));
    }
  }],
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
  loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' },
  assetNames: 'fonts/[name]-[hash]',
  logLevel: 'info'
};

const markdownWorkerOptions = {
  entryPoints: ['src/webview/markdownRender.worker.ts'],
  bundle: true,
  outfile: 'dist/markdown-worker.js',
  platform: 'browser',
  format: 'iife',
  target: ['chrome120'],
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  minify: !watch,
  logLevel: 'info'
};

const markdownFallbackOptions = {
  ...markdownWorkerOptions,
  entryPoints: ['src/webview/markdownRenderer.ts'],
  outfile: 'dist/markdown-fallback.js',
  globalName: 'mveMarkdownFallback'
};

const exportFontOptions = {
  entryPoints: ['src/webview/exportFonts.css'],
  bundle: true,
  outfile: 'dist/export-fonts.css',
  minify: !watch,
  loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
  logLevel: 'info'
};

const playwrightOptions = {
  entryPoints: ['playwright-core'],
  bundle: true,
  outfile: 'dist/playwright.js',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: false,
  logLevel: 'info'
};

async function copyAssets() {
  await mkdir('dist', { recursive: true });
  await Promise.all([
    copyFile('src/webview/styles.css', 'dist/styles.css'),
    copyFile('node_modules/pdfjs-dist/build/pdf.min.mjs', 'dist/pdfjs.mjs'),
    copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'dist/pdf.worker.min.mjs'),
    copyFile('node_modules/mermaid/dist/mermaid.min.js', 'dist/mermaid.min.js'),
    copyFile('node_modules/playwright-core/browsers.json', 'browsers.json')
  ]);
}

// dist は生成物専用である。過去ビルドの chunk や runtime を VSIX へ混入させない。
await rm('dist', { recursive: true, force: true });
await copyAssets();

if (watch) {
  const extensionContext = await esbuild.context(extensionOptions);
  const webviewContext = await esbuild.context(webviewOptions);
  const markdownWorkerContext = await esbuild.context(markdownWorkerOptions);
  const markdownFallbackContext = await esbuild.context(markdownFallbackOptions);
  const exportFontContext = await esbuild.context(exportFontOptions);
  await esbuild.build(playwrightOptions);
  await Promise.all([
    extensionContext.watch(),
    webviewContext.watch(),
    markdownWorkerContext.watch(),
    markdownFallbackContext.watch(),
    exportFontContext.watch()
  ]);
  console.log('Watching extension and webview...');
} else {
  await Promise.all([
    esbuild.build(extensionOptions),
    esbuild.build(webviewOptions),
    esbuild.build(markdownWorkerOptions),
    esbuild.build(markdownFallbackOptions),
    esbuild.build(exportFontOptions),
    esbuild.build(playwrightOptions)
  ]);
}

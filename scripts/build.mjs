/**
 * @fileoverview ビルドを開発・検証環境で実行する。前提条件や失敗条件を終了コードとログで示す。
 */
import * as esbuild from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';


/**
 * ビルドのwatchに関する状態または設定。
 */
const watch = process.argv.includes('--watch');


/**
 * ビルドへ渡す設定または境界値。
 */
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
    /**
     * ビルドの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
     * @param build - ビルドへ渡す入力。
     * @returns ビルドのsetupが生成する結果。
     */
    setup(build) {
      build.onResolve({ filter: /^playwright-core$/ },
      /**
       * ビルドのコールバックとして要素を処理する。
       * @returns ビルドのコールバックが生成する結果。
       */
      () => ({
        path: './playwright.js',
        external: true
      }));
    }
  }],
  logLevel: 'info'
};


/**
 * ビルドへ渡す設定または境界値。
 */
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


/**
 * ビルドで解析・表示・保存する本文。
 */
const markdownWorkerOptions = {
  entryPoints: ['src/webview/markdownRenderLight.worker.ts'],
  bundle: true,
  outfile: 'dist/markdown-worker.js',
  platform: 'browser',
  format: 'iife',
  target: ['chrome120'],
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  minify: !watch,
  logLevel: 'info'
};


/**
 * ビルドで解析・表示・保存する本文。
 */
const markdownRichWorkerOptions = {
  ...markdownWorkerOptions,
  entryPoints: ['src/webview/markdownRender.worker.ts'],
  outfile: 'dist/markdown-rich-worker.js'
};


/**
 * ビルドで解析・表示・保存する本文。
 */
const markdownFallbackOptions = {
  ...markdownWorkerOptions,
  entryPoints: ['src/webview/markdownRenderer.ts'],
  outfile: 'dist/markdown-fallback.js',
  globalName: 'mveMarkdownFallback'
};


/**
 * ビルドへ渡す設定または境界値。
 */
const exportFontOptions = {
  entryPoints: ['src/webview/exportFonts.css'],
  bundle: true,
  outfile: 'dist/export-fonts.css',
  minify: !watch,
  loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
  logLevel: 'info'
};


/**
 * ビルドへ渡す設定または境界値。
 */
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

/**
 * ビルドの入力または状態を走査・複製する。
 * @returns ビルドのcopy・assetsが生成する結果。
 */
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
  const markdownRichWorkerContext = await esbuild.context(markdownRichWorkerOptions);
  const markdownFallbackContext = await esbuild.context(markdownFallbackOptions);
  const exportFontContext = await esbuild.context(exportFontOptions);
  await esbuild.build(playwrightOptions);
  await Promise.all([
    extensionContext.watch(),
    webviewContext.watch(),
    markdownWorkerContext.watch(),
    markdownRichWorkerContext.watch(),
    markdownFallbackContext.watch(),
    exportFontContext.watch()
  ]);
  console.log('Watching extension and webview...');
} else {
  await Promise.all([
    esbuild.build(extensionOptions),
    esbuild.build(webviewOptions),
    esbuild.build(markdownWorkerOptions),
    esbuild.build(markdownRichWorkerOptions),
    esbuild.build(markdownFallbackOptions),
    esbuild.build(exportFontOptions),
    esbuild.build(playwrightOptions)
  ]);
}

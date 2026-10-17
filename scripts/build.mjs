/**
 * @fileoverview esbuildでExtension Host、Webview、Markdown Workerを個別にbundleし、配布用リソースをdistへまとめる。
 */
import * as esbuild from 'esbuild';
import { copyFile, cp, mkdir, rm, stat } from 'node:fs/promises';


/**
 * コマンドラインにwatchが指定されているか示すビルドモード。
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
       * playwright-coreを外部依存として扱い、実行時スタブへ解決する。
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
  entryPoints: ['src/webview/markdown/markdownRenderLight.worker.ts'],
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
  entryPoints: ['src/webview/markdown/markdownRender.worker.ts'],
  outfile: 'dist/markdown-rich-worker.js'
};


/**
 * ビルドで解析・表示・保存する本文。
 */
const markdownFallbackOptions = {
  ...markdownWorkerOptions,
  entryPoints: ['src/webview/markdown/markdownRenderer.ts'],
  outfile: 'dist/markdown-fallback.js',
  globalName: 'mveMarkdownFallback'
};


/**
 * Marp Coreを通常のWebview bundleから分離してビルドする設定。
 */
const marpWorkerOptions = {
  ...markdownWorkerOptions,
  entryPoints: ['src/webview/marp/marp.worker.ts'],
  outfile: 'dist/marp-worker.js',
  plugins: [{
    name: 'marp-worker-optional-rendering-libraries',
    setup(build) {
      build.onResolve({ filter: /^mathjax-full\// }, (args) => ({
        path: args.path,
        namespace: 'marp-katex-only-mathjax-stub'
      }));
      build.onLoad({ filter: /.*/, namespace: 'marp-katex-only-mathjax-stub' }, () => ({
        contents: 'export {};',
        loader: 'js'
      }));
      build.onResolve({ filter: /^highlight\.js\/lib\/languages\// }, (args) => {
        const importer = args.importer.replaceAll('\\', '/');
        if (!importer.includes('@marp-team/marp-core/lib/marp.js')) return null;
        return {
          path: args.path,
          namespace: 'marp-curated-highlight-stub'
        };
      });
      build.onLoad({ filter: /.*/, namespace: 'marp-curated-highlight-stub' }, () => ({
        contents: 'export default () => ({ contains: [] });',
        loader: 'js'
      }));
    }
  }]
};


/**
 * Marpプレビュー用の隔離iframe補助コードを個別にビルドする設定。
 */
const marpFrameOptions = {
  ...markdownWorkerOptions,
  entryPoints: ['src/webview/marp/marpFrame.ts'],
  outfile: 'dist/marp-frame.js'
};

/**
 * YAMLパーサーをExtension Hostから候補文書の判定時にだけ読み込む資産へbundleする。
 */
const marpYamlOptions = {
  entryPoints: ['src/extension/marpYamlRuntime.ts'],
  bundle: true,
  outfile: 'dist/marp-yaml.cjs',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  minify: !watch,
  sourcemap: false,
  logLevel: 'info'
};

/** Mermaid描画をUIスレッドから分離するPele Worker bundle。 */
const peleWorkerOptions = {
  entryPoints: ['src/extension/peleWorker.ts'],
  bundle: true,
  outfile: 'dist/pele-render-worker.js',
  platform: 'browser',
  format: 'iife',
  target: ['chrome120'],
  minify: !watch,
  sourcemap: false,
  logLevel: 'info'
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
 * 拡張機能の出力先へWebview用CSSと実行時に必要なライブラリをコピーする。
 */
async function copyAssets() {
  await mkdir('dist', { recursive: true });
  await Promise.all([
    copyFile('src/webview/styles.css', 'dist/styles.css'),
    copyFile('node_modules/pdfjs-dist/build/pdf.min.mjs', 'dist/pdfjs.mjs'),
    copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'dist/pdf.worker.min.mjs'),
    copyFile('node_modules/mermaid/dist/mermaid.min.js', 'dist/mermaid.min.js'),
    cp('node_modules/@marp-team/marp-core/node_modules/katex/dist/fonts', 'dist/marp-katex-fonts', { recursive: true }),
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
  const marpWorkerContext = await esbuild.context(marpWorkerOptions);
  const marpFrameContext = await esbuild.context(marpFrameOptions);
  const marpYamlContext = await esbuild.context(marpYamlOptions);
  const peleWorkerContext = await esbuild.context(peleWorkerOptions);
  const exportFontContext = await esbuild.context(exportFontOptions);
  await esbuild.build(playwrightOptions);
  await Promise.all([
    extensionContext.watch(),
    webviewContext.watch(),
    markdownWorkerContext.watch(),
    markdownRichWorkerContext.watch(),
    markdownFallbackContext.watch(),
    marpWorkerContext.watch(),
    marpFrameContext.watch(),
    marpYamlContext.watch(),
    peleWorkerContext.watch(),
    exportFontContext.watch()
  ]);
  console.log('Watching extension and webview...');
} else {
  const results = await Promise.all([
    esbuild.build(extensionOptions),
    esbuild.build({ ...webviewOptions, metafile: true }),
    esbuild.build({ ...markdownWorkerOptions, metafile: true }),
    esbuild.build({ ...markdownRichWorkerOptions, metafile: true }),
    esbuild.build({ ...markdownFallbackOptions, metafile: true }),
    esbuild.build({ ...marpWorkerOptions, metafile: true }),
    esbuild.build(marpFrameOptions),
    esbuild.build(marpYamlOptions),
    esbuild.build(peleWorkerOptions),
    esbuild.build(exportFontOptions),
    esbuild.build(playwrightOptions)
  ]);
  const commonBundles = [results[1], results[2], results[3], results[4]];
  const includesMarpCore = commonBundles.some(({ metafile }) =>
    Object.keys(metafile.inputs).some((input) => input.replaceAll('\\', '/').includes('@marp-team/marp-core/'))
  );
  if (includesMarpCore) {
    throw new Error('Marp Core entered a common Webview or Markdown Worker bundle.');
  }
  const marpWorkerInputs = Object.keys(results[5].metafile.inputs);
  if (!marpWorkerInputs.some((input) => input.replaceAll('\\', '/').includes('@marp-team/marp-core/lib/marp.js'))) {
    throw new Error('Marp Core is missing from its dedicated Worker bundle.');
  }
  const marpWorkerOutput = Object.values(results[5].metafile.outputs).find(
    ({ entryPoint }) => entryPoint?.replaceAll('\\', '/').endsWith('src/webview/marp/marp.worker.ts')
  );
  const marpFrameOutput = await stat('dist/marp-frame.js');
  if (!marpWorkerOutput || marpWorkerOutput.bytes > 1024 * 1024) {
    throw new Error(`Marp Worker exceeds 1 MiB or is missing: ${marpWorkerOutput?.bytes ?? 'missing'} bytes`);
  }
  if (marpFrameOutput.size > 256 * 1024) {
    throw new Error(`Marp frame helper exceeds 256 KiB: ${marpFrameOutput.size} bytes`);
  }
}

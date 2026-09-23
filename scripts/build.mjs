/**
 * @file build.mjs
 * 実行境界: 開発・検証スクリプト。
 * 責務: ビルド、スモーク、統合検証または補助生成を実行する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: プロセス、生成物、Webview、VS Code、Chromiumなどの外部環境を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import * as esbuild from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';

/** 「watch」は、関連する処理間で共有する設定値または状態です。 */
/**
 * 差分監視ビルドを選択するコマンドラインフラグ。
 * 監視時だけ開発用環境とesbuildのwatchコンテキストを有効にし、通常ビルドの出力条件を変えない。
 */
const watch = process.argv.includes('--watch');

/** 「extensionOptions」は、呼び出し先へ渡す設定値の集合です。 */
/**
 * Extension Host用バンドルの入力、実行環境、出力先を定義するesbuild設定。
 * vscode本体は実行時に提供されるためexternalに残し、それ以外の依存をNode向けCommonJSへまとめる。
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
     * 「setup」は、入力を検証して対象の状態または内容へ適用します。
     * @param build 「build」は、「setup」が関連処理の処理対象を特定する入力です。
     * @returns 初期化したオブジェクト（path、external、logLevel、entryPoints、bundle）を返します。
     */
    setup(build) {
      build.onResolve({ filter: /^playwright-core$/ },
      /**
       * esbuildのplaywright-core解決要求を処理し、外部化する解決結果を返すコールバックです。
       * @returns pathとexternalを含むesbuildの解決結果を返します。
       */
      () => ({
        path: './playwright.js',
        external: true
      }));
    }
  }],
  logLevel: 'info'
};

/** 「webviewOptions」は、呼び出し先へ渡す設定値の集合です。 */
/**
 * Webview用ブラウザーバンドルとフォント資産の扱いを定義するesbuild設定。
 * 開発時は未圧縮、配布時は圧縮としてデバッグ可能性と配布容量を両立する。
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

/** 「markdownWorkerOptions」は、呼び出し先へ渡す設定値の集合です。 */
/**
 * 軽量Markdownワーカーの共通ビルド設定。
 * richワーカーとフォールバックが継承するため、対象ブラウザーと環境定義を一箇所で維持する。
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

/** 「markdownRichWorkerOptions」は、呼び出し先へ渡す設定値の集合です。 */
/**
 * 数式・図表などを含むリッチMarkdownワーカーの差分設定。
 * 共通設定を継承し、入力エントリと出力ファイルだけを専用名へ置き換える。
 */
const markdownRichWorkerOptions = {
  ...markdownWorkerOptions,
  entryPoints: ['src/webview/markdownRender.worker.ts'],
  outfile: 'dist/markdown-rich-worker.js'
};

/** 「markdownFallbackOptions」は、呼び出し先へ渡す設定値の集合です。 */
/**
 * Workerを利用できない環境で読み込むMarkdownフォールバックの設定。
 * 固定したグローバル名によりWebviewから遅延ロードできるようにする。
 */
const markdownFallbackOptions = {
  ...markdownWorkerOptions,
  entryPoints: ['src/webview/markdownRenderer.ts'],
  outfile: 'dist/markdown-fallback.js',
  globalName: 'mveMarkdownFallback'
};

/** 「exportFontOptions」は、呼び出し先へ渡す設定値の集合です。 */
/**
 * HTML/PDF出力用フォントCSSをdata URLへ埋め込むesbuild設定。
 * 外部フォント参照を残さず、出力物を単独で利用できる状態にする。
 */
const exportFontOptions = {
  entryPoints: ['src/webview/exportFonts.css'],
  bundle: true,
  outfile: 'dist/export-fonts.css',
  minify: !watch,
  loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
  logLevel: 'info'
};

/** 「playwrightOptions」は、呼び出し先へ渡す設定値の集合です。 */
/**
 * Extension Hostから遅延利用するPlaywright実行コードのNode向けバンドル設定。
 * distへ固定配置し、Extension Host側の動的ロード先を安定させる。
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
 * copy・assetsを操作します。
 * @returns 「copyAssets」が関連処理の入力を処理して得た固有の結果を返します。
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

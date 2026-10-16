/**
 * @fileoverview VS Code Extension Hostで拡張機能の起動と初期化時間を計測し、過去の起動回帰を検出する。
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * 起動・regressionに許可する上限値。
 */
const limits = {
  'extension.js': 512 * 1024,
  'webview.js': 2 * 1024 * 1024,
  'webview.css': 256 * 1024,
  'markdown-worker.js': 512 * 1024,
  'marp-worker.js': 1024 * 1024,
  'marp-frame.js': 256 * 1024,
  'marp-yaml.cjs': 512 * 1024,
  total: 48 * 1024 * 1024
};

/**
 * 起動・regressionで読み書きするリソースの場所。
 */
const requiredTopLevelFiles = [
  'export-fonts.css',
  'extension.js',
  'markdown-fallback.js',
  'markdown-rich-worker.js',
  'markdown-worker.js',
  'marp-frame.js',
  'marp-worker.js',
  'marp-yaml.cjs',
  'mermaid.min.js',
  'pdf.worker.min.mjs',
  'pdfjs.mjs',
  'playwright.js',
  'styles.css',
  'webview.css',
  'webview.js'
];

/**
 * 起動・regressionで扱う一覧または対応表。
 */
const topLevelEntries = await readdir('dist', { withFileTypes: true });
/**
 * 起動・regressionで読み書きするリソースの場所。
 */
const topLevelFiles = topLevelEntries
  .filter(
  /**
    * 通常ファイルだけを残し、ディレクトリを計測対象から除外する。
    * @param entry - ディレクトリ走査で検出した項目。

   */
  (entry) => entry.isFile())
  .map(
  /**
   * 各エントリからnameを取り出して一覧化する。
   * @param entry - エントリのnameを参照する走査対象。
   * @returns nameを取り出した変換結果の一覧。
   */
  (entry) => entry.name)
  .sort();
assertEqualList(topLevelFiles, requiredTopLevelFiles, 'dist のトップレベル成果物');

/**
 * 成果物ファイル名をキー、ファイルサイズ（バイト）を値とする対応表です。
 */
const sizes = Object.fromEntries(await Promise.all(requiredTopLevelFiles.map(
/**
 * 各fileをstatへ渡し、変換結果を一覧化する。
 * @param file - 起動・regressionで読み書きするリソースの場所。

 */
async (file) => [
  file,
  (await stat(path.join('dist', file))).size
])));
/**
 * 起動・regressionで扱う一覧または対応表。
 */
const fontEntries = await readdir(path.join('dist', 'fonts'), { withFileTypes: true });
/**
 * 起動・regressionで読み書きするリソースの場所。
 */
const fontFiles = fontEntries.filter(
/**
 * dist/fonts内の通常ファイルだけを残す。
 * @param entry - ファイルかどうかを判定するfontsディレクトリエントリ。

 */
(entry) => entry.isFile());
/**
 * dist内にあるすべての通常ファイルを再帰列挙する。
 * @param directory - 読み取り対象のディレクトリ。
 * @returns ディレクトリ内の全ファイルパス。
 */
async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(candidate));
    else if (entry.isFile()) files.push(candidate);
  }
  return files;
}
const allDistFiles = await listFiles(path.resolve('dist'));
/** dist内の全ファイルサイズを合計し、配布成果物の総サイズとする。 */
const totalBytes = (await Promise.all(allDistFiles.map(
/**
 * dist内のファイルサイズを読み取る。
 * @param file - サイズを測るファイルパス。
 * @returns ファイルサイズ（バイト）。
 */
async (file) => (await stat(file)).size
))).reduce(
/**
 * ファイルサイズを累積する。
 * @param sum - ここまでに合計したファイルサイズ。
 * @param size - 次に加算するファイルサイズ。
 * @returns 累積した合計サイズ。
 */
(sum, size) => sum + size, 0);

assertAtMost('extension.js', sizes['extension.js'], limits['extension.js']);
assertAtMost('webview.js', sizes['webview.js'], limits['webview.js']);
assertAtMost('webview.css', sizes['webview.css'], limits['webview.css']);
assertAtMost('markdown-worker.js', sizes['markdown-worker.js'], limits['markdown-worker.js']);
assertAtMost('marp-worker.js', sizes['marp-worker.js'], limits['marp-worker.js']);
assertAtMost('marp-frame.js', sizes['marp-frame.js'], limits['marp-frame.js']);
assertAtMost('dist 合計', totalBytes, limits.total);
if (fontFiles.length < 10) throw new Error('KaTeX の外部フォント成果物が不足しています。');

/**
 * 起動・regressionのextensionとして読み込んだ本文または設定。
 */
const extension = await readFile(path.join('dist', 'extension.js'), 'utf8');
/**
 * 起動・regressionのwebviewとして読み込んだ本文または設定。
 */
const webview = await readFile(path.join('dist', 'webview.js'), 'utf8');
if (/playwright-core[\\/]lib[\\/](?:coreBundle|utilsBundle)/.test(extension)) {
  throw new Error('Playwright が初期 Extension Host バンドルへ再混入しました。');
}
if (!extension.includes('./playwright.js')) {
  throw new Error('Playwright の遅延ロード参照が Extension Host バンドルにありません。');
}
if (!webview.includes('markdown-rich-worker.js') || !webview.includes('markdown-fallback.js') || !webview.includes('mermaid.min.js')) {
  throw new Error('Webview の障害時ランタイム遅延ロード参照が不足しています。');
}
if (!webview.includes('mveMarpWorkerUri') || !extension.includes('marp-worker.js')) {
  throw new Error('Marp Worker の遅延ロード URI または Extension Host 資産参照がありません。');
}
if (!webview.includes('mveMarpFrameUri') || !extension.includes('marp-frame.js')) {
  throw new Error('Marp iframe 補助コードの URI または Extension Host 資産参照がありません。');
}
if (sizes['export-fonts.css'] < 1024 * 1024 || sizes['playwright.js'] < 1024 * 1024) {
  throw new Error('遅延ロード対象の完全な成果物が生成されていません。');
}

console.log([
  '起動回帰ガード: OK',
  `extension.js=${formatBytes(sizes['extension.js'])}`,
  `webview.js=${formatBytes(sizes['webview.js'])}`,
  `marp-worker.js=${formatBytes(sizes['marp-worker.js'])}`,
  `marp-frame.js=${formatBytes(sizes['marp-frame.js'])}`,
  `webview.css=${formatBytes(sizes['webview.css'])}`,
  `dist=${formatBytes(totalBytes)}`
].join(' / '));

/**
 * 起動・regressionの入力と不変条件を検証し、違反時に失敗を通知する。
 * @param label - 画面または検証結果に表示する説明文。
 * @param actual - 上限と比較する実測byte数。
 * @param maximum - 許容する最大byte数。
 * @returns 条件が成立したかを示す真偽値。
 */
function assertAtMost(label, actual, maximum) {
  if (actual > maximum) {
    throw new Error(`${label} が起動性能上限を超えました: ${formatBytes(actual)} > ${formatBytes(maximum)}`);
  }
}

/**
 * 起動・regressionの入力と不変条件を検証し、違反時に失敗を通知する。
 * @param actual - 期待値と照合する実測結果一覧。
 * @param expected - actualと同じ順序で照合する期待結果一覧。
 * @param label - 画面または検証結果に表示する説明文。
 * @returns 条件が成立したかを示す真偽値。
 */
function assertEqualList(actual, expected, label) {
  const expectedSorted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expectedSorted)) {
    throw new Error(`${label}が不正です。actual=${JSON.stringify(actual)} expected=${JSON.stringify(expectedSorted)}`);
  }
}

/**
 * バイト数を読みやすい単位へ変換し、計測ログへ表示する。
 * @param bytes - MiB単位の表示へ変換するbyte数。
 * @returns MiB単位に整形したバイト数。
 */
function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

/**
 * @fileoverview 起動・regressionを開発・検証環境で実行する。前提条件や失敗条件を終了コードとログで示す。
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
   * is・fileの条件を満たすエントリだけを残す。
   * @param entry - エントリのis・fileを参照する走査対象。
   * @returns 条件を満たした要素だけを含む一覧。
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
 * 起動・regressionの位置・寸法・件数・時間を表す数値。
 */
const sizes = Object.fromEntries(await Promise.all(requiredTopLevelFiles.map(
/**
 * 各fileをstatへ渡し、変換結果を一覧化する。
 * @param file - 起動・regressionで読み書きするリソースの場所。
 * @returns 入力要素から生成した変換結果の一覧。
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
 * is・fileの条件を満たすエントリだけを残す。
 * @param entry - エントリのis・fileを参照する走査対象。
 * @returns 条件を満たした要素だけを含む一覧。
 */
(entry) => entry.isFile());
/**
 * 起動・regressionのfont・bytesを処理し、呼び出し側へ結果または副作用を返す。
 * @param entry - 起動・regressionで走査または更新する要素。
 * @returns 起動・regressionのfont・bytesが生成する結果。
 */
const fontBytes = (await Promise.all(fontFiles.map(
/**
 * 各エントリからnameを取り出して一覧化する。
 * @param entry - エントリのnameを参照する走査対象。
 * @returns nameを取り出した変換結果の一覧。
 */
async (entry) =>
  (await stat(path.join('dist', 'fonts', entry.name))).size
))).reduce(
/**
 * 要素を順に加算して累積値を求める。
 * @param sum - 累積値へ加算する要素。
 * @param size - 累積値へ加算する要素。
 * @returns 要素を集約した累積値。
 */
(sum, size) => sum + size, 0);
/**
 * 起動・regressionの位置・寸法・件数・時間を表す数値。
 */
const totalBytes = Object.values(sizes).reduce(
/**
 * 要素を順に加算して累積値を求める。
 * @param sum - 累積値へ加算する要素。
 * @param size - 累積値へ加算する要素。
 * @returns 要素を集約した累積値。
 */
(sum, size) => sum + size, 0) + fontBytes;

assertAtMost('extension.js', sizes['extension.js'], limits['extension.js']);
assertAtMost('webview.js', sizes['webview.js'], limits['webview.js']);
assertAtMost('webview.css', sizes['webview.css'], limits['webview.css']);
assertAtMost('markdown-worker.js', sizes['markdown-worker.js'], limits['markdown-worker.js']);
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
if (sizes['export-fonts.css'] < 1024 * 1024 || sizes['playwright.js'] < 1024 * 1024) {
  throw new Error('遅延ロード対象の完全な成果物が生成されていません。');
}

console.log([
  '起動回帰ガード: OK',
  `extension.js=${formatBytes(sizes['extension.js'])}`,
  `webview.js=${formatBytes(sizes['webview.js'])}`,
  `webview.css=${formatBytes(sizes['webview.css'])}`,
  `dist=${formatBytes(totalBytes)}`
].join(' / '));

/**
 * 起動・regressionの入力と不変条件を検証し、違反時に失敗を通知する。
 * @param label - 画面または検証結果に表示する説明文。
 * @param actual - 起動・regressionへ渡す入力。
 * @param maximum - 起動・regressionの位置・寸法・件数・時間を表す数値。
 * @returns 条件が成立したかを示す真偽値。
 */
function assertAtMost(label, actual, maximum) {
  if (actual > maximum) {
    throw new Error(`${label} が起動性能上限を超えました: ${formatBytes(actual)} > ${formatBytes(maximum)}`);
  }
}

/**
 * 起動・regressionの入力と不変条件を検証し、違反時に失敗を通知する。
 * @param actual - 起動・regressionへ渡す入力。
 * @param expected - 起動・regressionの位置・寸法・件数・時間を表す数値。
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
 * @param bytes - 起動・regressionの位置・寸法・件数・時間を表す数値。
 * @returns 起動・regressionのformat・bytesが生成する結果。
 */
function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

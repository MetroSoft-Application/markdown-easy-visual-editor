/**
 * @file startup-regression.mjs
 * 実行境界: 開発・検証スクリプト。
 * 責務: ビルド、スモーク、統合検証または補助生成を実行する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: プロセス、生成物、Webview、VS Code、Chromiumなどの外部環境を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/** 「limits」は、入力・表示・資源の上限または下限を表す値です。 */
const limits = {
  'extension.js': 512 * 1024,
  'webview.js': 2 * 1024 * 1024,
  'webview.css': 256 * 1024,
  'markdown-worker.js': 512 * 1024,
  total: 48 * 1024 * 1024
};

/** 「requiredTopLevelFiles」は、対象ファイルまたは実行環境の場所を表す値です。 */
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

/** 「topLevelEntries」は、後続処理で順序を保って参照する一覧です。 */
const topLevelEntries = await readdir('dist', { withFileTypes: true });
/** 「topLevelFiles」は、対象ファイルまたは実行環境の場所を表す値です。 */
const topLevelFiles = topLevelEntries
  .filter(
  /**
 * 「entry」が条件に一致するか判定し、残す要素を決めるコールバックです。
   * @param entry entryとして渡される、このコールバックの入力値です。
   * @returns 要素を採用するかどうかの真偽値を返します。
   */
  (entry) => entry.isFile())
  .map(
  /**
 * 「entry」を変換し、変換後の要素を返すコールバックです。
   * @param entry entryとして渡される、このコールバックの入力値です。
   * @returns 入力要素から生成した変換後の値を返します。
   */
  (entry) => entry.name)
  .sort();
assertEqualList(topLevelFiles, requiredTopLevelFiles, 'dist のトップレベル成果物');

/** 「sizes」は、関連する処理間で共有する設定値または状態です。 */
const sizes = Object.fromEntries(await Promise.all(requiredTopLevelFiles.map(
/**
 * 「async」として「file」を受け取り、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param file 処理対象のファイルです。
 * @returns 入力要素から生成した変換後の値を返します。
 */
async (file) => [
  file,
  (await stat(path.join('dist', file))).size
])));
/** 「fontEntries」は、後続処理で順序を保って参照する一覧です。 */
const fontEntries = await readdir(path.join('dist', 'fonts'), { withFileTypes: true });
/** 「fontFiles」は、対象ファイルまたは実行環境の場所を表す値です。 */
const fontFiles = fontEntries.filter(
/**
 * 「entry」が条件に一致するか判定し、残す要素を決めるコールバックです。
 * @param entry entryとして渡される、このコールバックの入力値です。
 * @returns 要素を採用するかどうかの真偽値を返します。
 */
(entry) => entry.isFile());
/** 「fontBytes」は、関連する処理間で共有する設定値または状態です。 */
const fontBytes = (await Promise.all(fontFiles.map(
/**
 * 「entry」を変換し、変換後の要素を返すコールバックです。
 * @param entry entryとして渡される、このコールバックの入力値です。
 * @returns 入力要素から生成した変換後の値を返します。
 */
async (entry) =>
  (await stat(path.join('dist', 'fonts', entry.name))).size
))).reduce(
/**
 * 累積値と入力を「sum」「size」を受け取り、集約結果を更新するコールバックです。
 * @param sum sumとして渡される、このコールバックの入力値です。
 * @param size 処理対象の件数または上限を表す数値です。
 * @returns 更新後の累積値を返します。
 */
(sum, size) => sum + size, 0);
/** 「totalBytes」は、関連する処理間で共有する設定値または状態です。 */
const totalBytes = Object.values(sizes).reduce(
/**
 * 累積値と入力を「sum」「size」を受け取り、集約結果を更新するコールバックです。
 * @param sum sumとして渡される、このコールバックの入力値です。
 * @param size 処理対象の件数または上限を表す数値です。
 * @returns 更新後の累積値を返します。
 */
(sum, size) => sum + size, 0) + fontBytes;

assertAtMost('extension.js', sizes['extension.js'], limits['extension.js']);
assertAtMost('webview.js', sizes['webview.js'], limits['webview.js']);
assertAtMost('webview.css', sizes['webview.css'], limits['webview.css']);
assertAtMost('markdown-worker.js', sizes['markdown-worker.js'], limits['markdown-worker.js']);
assertAtMost('dist 合計', totalBytes, limits.total);
if (fontFiles.length < 10) throw new Error('KaTeX の外部フォント成果物が不足しています。');

/** 「extension」は、関連する処理間で共有する設定値または状態です。 */
const extension = await readFile(path.join('dist', 'extension.js'), 'utf8');
/** 「webview」は、関連する処理間で共有する設定値または状態です。 */
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
 * assert・at・mostを検証します。
 * @param label 「label」は、「assertAtMost」が関連処理の処理対象を特定する入力です。
 * @param actual 検証または解析で実際に得られた値です。
 * @param maximum 「maximum」は、「assertAtMost」が関連処理の処理対象を特定する入力です。
 * @returns 「assertAtMost」が判定した検証結果を返します。
 */
function assertAtMost(label, actual, maximum) {
  if (actual > maximum) {
    throw new Error(`${label} が起動性能上限を超えました: ${formatBytes(actual)} > ${formatBytes(maximum)}`);
  }
}

/**
 * assert・equal・listを検証します。
 * @param actual 検証または解析で実際に得られた値です。
 * @param expected 検証で期待する値または状態です。
 * @param label 「label」は、「assertEqualList」が関連処理の処理対象を特定する入力です。
 * @returns 「assertEqualList」が判定した検証結果を返します。
 */
function assertEqualList(actual, expected, label) {
  const expectedSorted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expectedSorted)) {
    throw new Error(`${label}が不正です。actual=${JSON.stringify(actual)} expected=${JSON.stringify(expectedSorted)}`);
  }
}

/**
 * 「formatBytes」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param bytes 「bytes」は、「formatBytes」が関連処理の処理対象を特定する入力です。
 * @returns バイト数を読みやすい単位へ変換した表示用文字列を返します。
 */
function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const limits = {
  'extension.js': 512 * 1024,
  'webview.js': 2 * 1024 * 1024,
  'webview.css': 256 * 1024,
  total: 48 * 1024 * 1024
};

const requiredTopLevelFiles = [
  'export-fonts.css',
  'extension.js',
  'markdown-fallback.js',
  'markdown-worker.js',
  'mermaid.min.js',
  'pdf.worker.min.mjs',
  'pdfjs.mjs',
  'playwright.js',
  'styles.css',
  'webview.css',
  'webview.js'
];

const topLevelEntries = await readdir('dist', { withFileTypes: true });
const topLevelFiles = topLevelEntries
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .sort();
assertEqualList(topLevelFiles, requiredTopLevelFiles, 'dist のトップレベル成果物');

const sizes = Object.fromEntries(await Promise.all(requiredTopLevelFiles.map(async (file) => [
  file,
  (await stat(path.join('dist', file))).size
])));
const fontEntries = await readdir(path.join('dist', 'fonts'), { withFileTypes: true });
const fontFiles = fontEntries.filter((entry) => entry.isFile());
const fontBytes = (await Promise.all(fontFiles.map(async (entry) =>
  (await stat(path.join('dist', 'fonts', entry.name))).size
))).reduce((sum, size) => sum + size, 0);
const totalBytes = Object.values(sizes).reduce((sum, size) => sum + size, 0) + fontBytes;

assertAtMost('extension.js', sizes['extension.js'], limits['extension.js']);
assertAtMost('webview.js', sizes['webview.js'], limits['webview.js']);
assertAtMost('webview.css', sizes['webview.css'], limits['webview.css']);
assertAtMost('dist 合計', totalBytes, limits.total);
if (fontFiles.length < 10) throw new Error('KaTeX の外部フォント成果物が不足しています。');

const extension = await readFile(path.join('dist', 'extension.js'), 'utf8');
const webview = await readFile(path.join('dist', 'webview.js'), 'utf8');
if (/playwright-core[\\/]lib[\\/](?:coreBundle|utilsBundle)/.test(extension)) {
  throw new Error('Playwright が初期 Extension Host バンドルへ再混入しました。');
}
if (!extension.includes('./playwright.js')) {
  throw new Error('Playwright の遅延ロード参照が Extension Host バンドルにありません。');
}
if (!webview.includes('markdown-fallback.js') || !webview.includes('mermaid.min.js')) {
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

function assertAtMost(label, actual, maximum) {
  if (actual > maximum) {
    throw new Error(`${label} が起動性能上限を超えました: ${formatBytes(actual)} > ${formatBytes(maximum)}`);
  }
}

function assertEqualList(actual, expected, label) {
  const expectedSorted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expectedSorted)) {
    throw new Error(`${label}が不正です。actual=${JSON.stringify(actual)} expected=${JSON.stringify(expectedSorted)}`);
  }
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

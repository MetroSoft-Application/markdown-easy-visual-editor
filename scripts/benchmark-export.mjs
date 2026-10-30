/**
 * @fileoverview CLI起動込みと同一プロセスでの出力時間を各5回以上計測する。
 * 変更前の同条件JSONを MVE_EXPORT_BASELINE に指定した場合、中央値・P95の10%悪化を非0終了で検出する。
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** 実行位置に依存しない独立出力エンジンの参照。 */
const require = createRequire(import.meta.url);
/** 出力要求の連続実行を検証する同一プロセス版エンジン。 */
const engine = require('../dist/export-engine/mve-convert.cjs');
/** CLI子プロセスの終了を待つ。 */
const execute = promisify(execFile);
/** 過去値と現在値の比較を残すディレクトリ。 */
const directory = path.resolve('artifacts/cli-extraction/export-benchmark');
/** コールド・ウォームそれぞれの最低測定回数。 */
const repetitions = Math.max(5, Number.parseInt(process.env.MVE_EXPORT_RUNS ?? '5', 10) || 5);
/** 計測に使用する固定入力。外部通信を含めない。 */
const input = path.join(directory, 'benchmark.md');
await mkdir(directory, { recursive: true });
await writeFile(input, '# 日本語の出力性能\n\n| 項目 | 内容 |\n| --- | --- |\n| 表 | 折り返しの確認 |\n\n```mermaid\ngraph LR\n  A[開始] --> B[終了]\n```\n\n$E=mc^2$\n');

/** Edge、Chromeの順にインストール済みの描画ブラウザーを選ぶ。 */
async function browserPath() {
  for (const candidate of [process.env.MVE_BROWSER_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']) {
    if (candidate && await stat(candidate).then((item) => item.isFile()).catch(() => false)) return candidate;
  }
  throw new Error('Edge or Chrome is required for export benchmarking.');
}

/** 昇順の試行値から中央値と近似P95を返す。 */
function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1], max: sorted.at(-1), values };
}

/** PDFの全ページ数を読み、空の生成物を性能成功と扱わない。 */
async function pdfPages(file) {
  const task = getDocument({ data: new Uint8Array(await readFile(file)), useSystemFonts: true });
  try { return (await task.promise).numPages; }
  finally { await task.destroy(); }
}

/** ベースラインと同じ測定条件の中央値・P95を照合する。 */
function compare(current, baseline) {
  const failures = [];
  for (const format of ['html', 'pdf']) for (const mode of ['cold', 'warm']) {
    for (const metric of ['median', 'p95']) {
      const oldValue = baseline?.results?.[format]?.[mode]?.totalMs?.[metric];
      const newValue = current.results[format][mode].totalMs[metric];
      if (!Number.isFinite(oldValue) || oldValue <= 0) {
        failures.push(`${format}/${mode}/${metric}: missing baseline`);
      } else if (newValue >= oldValue * 1.10) {
        failures.push(`${format}/${mode}/${metric}: ${newValue}ms >= ${oldValue}ms * 1.10`);
      }
    }
  }
  return failures;
}

const browser = await browserPath();
const report = { generatedAt: new Date().toISOString(), platform: process.platform,
  node: process.version, browser, repetitions, inputBytes: (await stat(input)).size,
  results: {}, failures: [] };
for (const format of ['html', 'pdf']) {
  report.results[format] = {};
  for (const mode of ['cold', 'warm']) {
    const times = [], memories = [], pageCounts = [];
    for (let index = 0; index < repetitions; index++) {
      const output = path.join(directory, `${format}-${mode}-${index}.${format}`);
      const start = performance.now();
      if (mode === 'cold') {
        await execute(process.execPath, ['cli/dist/mve-convert.cjs', input,
          '--format', format, '--output', output, '--browser', browser, '--force'],
        { timeout: 180_000, maxBuffer: 1024 * 1024 });
      } else {
        await engine.convert({ input, output, format, markdown: await readFile(input, 'utf8'),
          language: 'ja', browserPath: browser, workspaceRoot: directory,
          theme: 'dark', mermaidTheme: 'dark', linked: false,
          embedImages: false, outline: false, force: true });
      }
      times.push(Math.round(performance.now() - start));
      memories.push(process.memoryUsage().rss);
      if (format === 'pdf') pageCounts.push(await pdfPages(output));
    }
    report.results[format][mode] = { totalMs: summarize(times), rssBytes: summarize(memories), pageCounts };
  }
}
const baselinePath = process.env.MVE_EXPORT_BASELINE;
if (baselinePath) {
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  if (baseline.platform !== report.platform || baseline.browser !== report.browser ||
      baseline.inputBytes !== report.inputBytes || baseline.repetitions !== report.repetitions) {
    report.failures.push('Baseline measurement conditions differ.');
  } else report.failures.push(...compare(report, baseline));
} else report.failures.push('MVE_EXPORT_BASELINE is required for a before/after performance verdict.');
const reportPath = path.join(directory, 'current.json');
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(reportPath);
for (const failure of report.failures) console.error(failure);
if (report.failures.length) process.exitCode = 1;

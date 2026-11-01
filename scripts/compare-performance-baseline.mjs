/**
 * @fileoverview 性能ベースラインJSONと今回の計測JSONを比較し、中央値またはP95の悪化が閾値を超えたら非0で終了する。
 * 対象環境: Node 20以上。入力は scripts/benchmark-vscode-startup.mjs（kind: 'vscode-startup'）が出力したレポート。
 * 他の計測でも scenarios[].statistics[条件][指標] = { count, median, p95, max } の形と kind を揃えれば比較できる。
 * 使い方: node scripts/compare-performance-baseline.mjs <baseline.json> <candidate.json> [output.json]
 * 失敗条件（終了コード1）:
 * - 同一指標の中央値またはP95が、ベースラインより MVE_PERF_THRESHOLD（既定0.10 = 10%）以上悪化した。
 * - ベースラインにあるシナリオ・条件・指標が今回の計測に無い、または試行数が5未満。
 * - 計測環境（OS・CPU・Node・VS Code）が異なる。MVE_PERF_ALLOW_ENV_MISMATCH=1 で警告扱いにできるが、その結果を性能判定の根拠にしてはならない。
 * 悪化量が MVE_PERF_MIN_DELTA_MS（既定0）未満なら閾値超過でも不合格にしない。既定0のため、AGENTS.md の10%規定をそのまま適用する。
 */
import { readFile, writeFile } from 'node:fs/promises';

/**
 * 悪化と判定する相対閾値。
 */
const threshold = Number.parseFloat(process.env.MVE_PERF_THRESHOLD ?? '0.10');
/**
 * 不合格にする最小の絶対悪化量（ミリ秒）。
 */
const minimumDeltaMs = Number.parseFloat(process.env.MVE_PERF_MIN_DELTA_MS ?? '0');
/**
 * 計測環境の不一致を警告に留める場合はtrue。
 */
const allowEnvironmentMismatch = process.env.MVE_PERF_ALLOW_ENV_MISMATCH === '1';
/**
 * 比較に必要な最小試行数。
 */
const MINIMUM_RUNS = 5;

const [baselinePath, candidatePath, outputPath] = process.argv.slice(2);
if (!baselinePath || !candidatePath) {
  console.error('Usage: node scripts/compare-performance-baseline.mjs <baseline.json> <candidate.json> [output.json]');
  process.exit(2);
}

const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
const candidate = JSON.parse(await readFile(candidatePath, 'utf8'));
const failures = [];
const warnings = [];
const comparisons = [];

if (baseline.kind !== candidate.kind) {
  failures.push(`レポート種別が異なります: baseline=${baseline.kind} candidate=${candidate.kind}`);
}
for (const field of ['platform', 'osRelease', 'cpu', 'nodeVersion', 'vscodeVersion', 'browserVersion']) {
  if (baseline[field] === undefined && candidate[field] === undefined) continue;
  if (baseline[field] !== candidate[field]) {
    const message = `計測環境が異なります: ${field} baseline=${baseline[field]} candidate=${candidate[field]}`;
    (allowEnvironmentMismatch ? warnings : failures).push(message);
  }
}

for (const baselineScenario of baseline.scenarios ?? []) {
  const candidateScenario = candidate.scenarios?.find(
    /**
     * 同名のシナリオを探す。
     * @param scenario - 今回の計測のシナリオ。
     * @returns シナリオ名が一致すればtrue。
     */
    (scenario) => scenario.name === baselineScenario.name);
  if (!candidateScenario) {
    failures.push(`シナリオ ${baselineScenario.name} が今回の計測にありません。`);
    continue;
  }
  for (const [condition, baselineMetrics] of Object.entries(baselineScenario.statistics ?? {})) {
    const candidateMetrics = candidateScenario.statistics?.[condition] ?? {};
    for (const [metric, before] of Object.entries(baselineMetrics)) {
      const after = candidateMetrics[metric];
      const label = `${baselineScenario.name}/${condition}/${metric}`;
      if (!after) {
        failures.push(`${label} が今回の計測にありません。`);
        continue;
      }
      if (before.count < MINIMUM_RUNS || after.count < MINIMUM_RUNS) {
        failures.push(`${label} の試行数が不足しています: baseline=${before.count} candidate=${after.count}（最低${MINIMUM_RUNS}回）`);
      }
      for (const statistic of ['median', 'p95']) {
        // ベースラインが0の指標は比率を定義できないため、少しでも増えていれば悪化（無限大）として扱う。
        const ratio = before[statistic] > 0
          ? after[statistic] / before[statistic] - 1
          : after[statistic] > before[statistic] ? Number.POSITIVE_INFINITY : 0;
        const delta = after[statistic] - before[statistic];
        const regressed = ratio >= threshold && delta >= minimumDeltaMs;
        comparisons.push({ scenario: baselineScenario.name, condition, metric, statistic, baseline: before[statistic], candidate: after[statistic], deltaMs: delta, ratio, regressed });
        if (regressed) {
          failures.push(`${label} ${statistic}: ${before[statistic]}ms → ${after[statistic]}ms (+${(ratio * 100).toFixed(1)}%)`);
        }
      }
    }
  }
}

for (const row of comparisons) {
  const sign = row.ratio >= 0 ? '+' : '';
  console.log(`${row.regressed ? 'NG' : 'OK'} ${row.scenario}/${row.condition}/${row.metric} ${row.statistic}: ${row.baseline} → ${row.candidate} (${sign}${(row.ratio * 100).toFixed(1)}%)`);
}
for (const warning of warnings) console.warn(`警告: ${warning}`);
const result = { generatedAt: new Date().toISOString(), baselinePath, candidatePath, threshold, minimumDeltaMs, comparisons, warnings, failures, passed: failures.length === 0 };
if (outputPath) await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
if (failures.length) {
  console.error(`性能比較で不合格になりました（${failures.length}件）:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('性能比較に合格しました。');

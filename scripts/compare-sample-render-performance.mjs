/**
 * @fileoverview sample描画性能の固定JSONベースラインと現行計測を条件・文書単位で比較する。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const [baselineArgument, currentArgument] = process.argv.slice(2);
if (!baselineArgument || !currentArgument) {
  throw new Error('使い方: node scripts/compare-sample-render-performance.mjs <baseline.json> <current.json>');
}

const baselinePath = path.resolve(baselineArgument);
const currentPath = path.resolve(currentArgument);
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
const current = JSON.parse(await readFile(currentPath, 'utf8'));
const thresholdPercent = Number.parseFloat(process.env.MVE_SAMPLE_RENDER_REGRESSION_LIMIT_PERCENT ?? '5');
if (!Number.isFinite(thresholdPercent) || thresholdPercent < 0) {
  throw new Error(`性能劣化の許容率が不正です: ${thresholdPercent}`);
}

validateReport(baseline, 'baseline');
validateReport(current, 'current');
const sharedEnvironmentKeys = ['browser', 'browserVersion'];
const environmentMatches = sharedEnvironmentKeys.every((key) => baseline[key] === current[key]) &&
  JSON.stringify(baseline.environment) === JSON.stringify(current.environment) &&
  JSON.stringify(baseline.conditionDefinitions) === JSON.stringify(current.conditionDefinitions);
if (!environmentMatches) {
  throw new Error('baselineとcurrentのOS、Node、Chromium、viewport、cold/warm条件が一致しません。');
}
if (baseline.sampleCount !== current.sampleCount) {
  throw new Error(`baseline/currentのsample件数が異なります: ${baseline.sampleCount}/${current.sampleCount}`);
}
const baselineByKey = new Map(baseline.files.map((file) => [keyFor(file), file]));
const currentByKey = new Map(current.files.map((file) => [keyFor(file), file]));
const regressions = [];
for (const [key, baselineFile] of baselineByKey) {
  const currentFile = currentByKey.get(key);
  if (!currentFile) {
    regressions.push({ key, issue: 'current measurement missing' });
    continue;
  }
  if (baselineFile.type !== currentFile.type || baselineFile.status !== 'passed' || currentFile.status !== 'passed') {
    regressions.push({ key, issue: 'type or run status mismatch' });
    continue;
  }
  for (const metric of ['medianFirstVisibleMs', 'p95FirstVisibleMs']) {
    const before = baselineFile[metric];
    const after = currentFile[metric];
    const changePercent = before > 0 ? ((after - before) / before) * 100 : 0;
    if (!Number.isFinite(before) || !Number.isFinite(after) || changePercent > thresholdPercent) {
      regressions.push({
        key,
        metric,
        before,
        after,
        changePercent: Number.isFinite(changePercent) ? Number(changePercent.toFixed(2)) : null,
      });
    }
  }
}
for (const key of currentByKey.keys()) {
  if (!baselineByKey.has(key)) regressions.push({ key, issue: 'baseline measurement missing' });
}

console.log(JSON.stringify({
  baseline: baselinePath,
  current: currentPath,
  baselineGeneratedAt: baseline.generatedAt,
  currentGeneratedAt: current.generatedAt,
  environment: current.environment,
  browser: current.browser,
  browserVersion: current.browserVersion,
  conditionDefinitions: current.conditionDefinitions,
  conditions: current.conditions,
  sampleCount: current.sampleCount,
  thresholdPercent,
  comparedFileConditions: baselineByKey.size,
  regressions,
  result: regressions.length ? 'FAIL' : 'PASS',
}, null, 2));
if (regressions.length) process.exitCode = 1;

/**
 * 計測レポートが冷間・温間それぞれの全サンプルを5回以上含むことを検証する。
 * @param report - 比較対象のJSONレポート。
 * @param label - エラー表示に使うレポート名。
 */
function validateReport(report, label) {
  const expectedConditions = ['cold', 'warm'];
  if (!report || !Array.isArray(report.files) || !Array.isArray(report.conditions)) {
    throw new Error(`${label} reportの構造が不正です。`);
  }
  if (expectedConditions.some((condition) => !report.conditions.includes(condition))) {
    throw new Error(`${label} reportにcold/warmの両方がありません。`);
  }
  if (report.failures?.length || report.externalRequests?.length || report.pageErrors?.length) {
    throw new Error(`${label} reportに失敗または外部要求があります。`);
  }
  if (report.sampleCount !== report.ordinaryCount + report.marpCount) {
    throw new Error(`${label} reportのMarkdown/Marp件数が一致しません。`);
  }
  for (const file of report.files) {
    if (file.runs < 5 || file.status !== 'passed') {
      throw new Error(`${label} reportに5回未満または失敗した項目があります: ${keyFor(file)} (${file.runs})`);
    }
  }
  for (const condition of expectedConditions) {
    const files = report.files.filter((file) => file.condition === condition);
    if (files.length !== report.sampleCount) {
      throw new Error(`${label} reportの${condition}サンプル数が不足しています: ${files.length}/${report.sampleCount}`);
    }
  }
  const warmMeasurements = report.measurements?.filter((measurement) => measurement.condition === 'warm') ?? [];
  if (warmMeasurements.length < report.sampleCount * 5 || warmMeasurements.some((measurement) =>
    !Array.isArray(measurement.warmCacheEvidence) ||
    measurement.warmCacheEvidence.length < 3 ||
    measurement.warmCacheEvidence.some((asset) => asset.reused !== true),
  )) {
    throw new Error(`${label} reportの温間計測で主要資材のHTTPキャッシュ再利用が確認できません。`);
  }
}

/**
 * 同一文書・同一キャッシュ条件を識別する比較キーを生成する。
 * @param file - sampleの性能集計。
 * @returns 条件名と相対パスを連結した比較キー。
 */
function keyFor(file) {
  return `${file.condition}:${file.path}`;
}

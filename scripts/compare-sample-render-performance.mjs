/**
 * @fileoverview sample-render-performanceの変更前後JSONを比較し、10%性能閾値超過時に失敗終了する。
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Markdown描画の許容劣化率。 */
const maximumRegressionRatio = 0.1;

/**
 * 描画計測JSONを読み込み、必須条件と入力同一性を確認する。
 * @param filePath - 読み込む基準または候補 JSON。
 * @returns sample-render-performanceが記録した測定値。
 */
async function readReport(filePath) {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    if (!parsed.environment || !Array.isArray(parsed.files) || !Array.isArray(parsed.failures)) {
        throw new Error(`sample性能レポートの形式が不正です: ${filePath}`);
    }
    if (parsed.failures.length || parsed.pageErrors?.length || parsed.externalRequests?.length) {
        throw new Error(`sample性能レポートに失敗または外部要求があります: ${filePath}`);
    }
    return parsed;
}

/**
 * 指定サンプル・冷暖条件の一意な集計結果を取得する。
 * @param report - sample-render-performanceの結果。
 * @param samplePath - 比較するsample相対パス。
 * @param condition - coldまたはwarm。
 * @returns 中央値・P95・Worker中央値を含む集計。
 */
function getFileSummary(report, samplePath, condition) {
    const matches = report.files.filter((item) => item.path === samplePath && item.condition === condition);
    if (matches.length !== 1 || matches[0].status !== 'passed' || matches[0].runs < 5) {
        throw new Error(`${samplePath} ${condition}はPASSかつ5回以上の計測が必要です。`);
    }
    return matches[0];
}

/**
 * 基準値と候補値から劣化率を計算する。
 * @param baseline - 変更前の計測値。
 * @param candidate - 変更後の計測値。
 * @returns 変更前中央値が0でない場合の相対差分率。
 */
function getRegressionRatio(baseline, candidate) {
    return candidate / Math.max(baseline, Number.EPSILON) - 1;
}

/**
 * 冷起動・ウォームの実ブラウザー指標を比較し、結果JSONと終了コードを設定する。
 * @returns 全指標が閾値未満なら0、計測条件不一致または閾値超過なら1。
 */
async function main() {
    const inputPaths = process.argv.slice(2);
    if (inputPaths.length !== 3) {
        throw new Error('Usage: node scripts/compare-sample-render-performance.mjs <baseline.json> <candidate.json> <output.json>');
    }
    const [baselinePath, candidatePath, outputPath] = inputPaths.map((value) => path.resolve(value));
    const [baseline, candidate] = await Promise.all([readReport(baselinePath), readReport(candidatePath)]);
    if (baseline.browser !== candidate.browser || baseline.browserVersion !== candidate.browserVersion
        || baseline.environment.os !== candidate.environment.os
        || baseline.environment.node !== candidate.environment.node) {
        throw new Error('変更前後のブラウザー、OS、Node環境が一致しません。');
    }
    if (baseline.sampleCount !== 1 || candidate.sampleCount !== 1
        || baseline.files[0]?.path !== candidate.files[0]?.path
        || baseline.files[0]?.bytes !== candidate.files[0]?.bytes
        || baseline.files[0]?.characters !== candidate.files[0]?.characters) {
        throw new Error('変更前後の測定サンプルまたは入力サイズが一致しません。');
    }

    const samplePath = baseline.files[0].path;
    const conditions = ['cold', 'warm'];
    const comparisons = conditions.map((condition) => {
        const baselineMetrics = getFileSummary(baseline, samplePath, condition);
        const candidateMetrics = getFileSummary(candidate, samplePath, condition);
        const regression = {
            firstVisibleMedian: getRegressionRatio(baselineMetrics.medianFirstVisibleMs, candidateMetrics.medianFirstVisibleMs),
            firstVisibleP95: getRegressionRatio(baselineMetrics.p95FirstVisibleMs, candidateMetrics.p95FirstVisibleMs),
            workerMedian: getRegressionRatio(baselineMetrics.medianWorkerMs, candidateMetrics.medianWorkerMs)
        };
        return {
            condition,
            runsPerCondition: candidateMetrics.runs,
            baseline: {
                medianFirstVisibleMs: baselineMetrics.medianFirstVisibleMs,
                p95FirstVisibleMs: baselineMetrics.p95FirstVisibleMs,
                medianWorkerMs: baselineMetrics.medianWorkerMs
            },
            candidate: {
                medianFirstVisibleMs: candidateMetrics.medianFirstVisibleMs,
                p95FirstVisibleMs: candidateMetrics.p95FirstVisibleMs,
                medianWorkerMs: candidateMetrics.medianWorkerMs
            },
            regression
        };
    });
    const ratios = comparisons.flatMap((comparison) => Object.values(comparison.regression));
    const thresholdExceeded = ratios.some((ratio) => ratio >= maximumRegressionRatio);
    const result = {
        generatedAt: new Date().toISOString(),
        sample: {
            path: samplePath,
            bytes: candidate.files[0].bytes,
            characters: candidate.files[0].characters,
            headings: candidate.files[0].headingCount
        },
        environment: candidate.environment,
        browser: { name: candidate.browser, version: candidate.browserVersion },
        methodology: {
            baseline: baselinePath,
            candidate: candidatePath,
            runsPerCondition: candidate.repetitions,
            p95: 'nearest rank from sample-render-performance.mjs',
            thresholdRatio: maximumRegressionRatio,
            thresholdExceeded
        },
        comparisons
    };
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ outputPath, thresholdExceeded, comparisons }, null, 2)}\n`);
    if (thresholdExceeded) process.exitCode = 1;
}

await main();

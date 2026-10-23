/**
 * @fileoverview Markdown優先の混在解析オーバーヘッドとTextile描画時間を同一Node環境で測定する。
 */
import { spawnSync } from 'node:child_process';
import { cpus, platform, arch, tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

/** P95が少数の外れ値だけに左右されにくいよう、各条件を独立プロセスで測る回数。 */
const measurementRuns = 50;

/** 各ウォーム測定で破棄する事前描画回数。 */
const warmupRuns = 10;

/** Each warm sample averages repeated renders to reduce timer jitter. */
const warmMeasurementIterations = 50;

/** 混在解析による許容性能低下率。 */
const maximumRegressionRatio = 0.1;

/**
 * 中央値と最近順位法のP95を求める。
 * @param values - 昇順化して統計する測定値。
 * @returns 測定数、中央値、P95をミリ秒で示す統計。
 */
function summarize(values) {
    const sorted = [...values].sort(
        /**
         * 測定時間を小さい順に並べる。
         * @param left - 比較元の時間。
         * @param right - 比較先の時間。
         * @returns 数値昇順の比較値。
         */
        (left, right) => left - right
    );
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
    return { runs: sorted.length, medianMs: median, p95Ms: p95, samplesMs: values };
}

/**
 * 1つの描画形式を新規Nodeプロセスでコールドまたはウォーム測定する。
 * @param runnerPath - Textile描画APIを呼び出す一時Nodeスクリプト。
 * @param bundlePath - 現在のMarkdown描画コアをbundleしたESMファイル。
 * @param sourcePath - 同一条件で読み込むMarkdownまたはTextileサンプル。
 * @param format - 測定するMarkdown描画形式。
 * @param warm - 10回のウォームアップを実施する場合はtrue。
 * @returns 子プロセスが測定した描画時間とブロック数。
 */
function measureProcess(runnerPath, bundlePath, sourcePath, format, warm) {
    const result = spawnSync(
        process.execPath,
        [runnerPath, bundlePath, sourcePath, format, warm ? String(warmupRuns) : '0'],
        { encoding: 'utf8', windowsHide: true }
    );
    if (result.status !== 0) {
        throw new Error(`Textile性能測定プロセスが失敗しました: ${result.stderr || result.error || result.status}`);
    }
    return JSON.parse(result.stdout);
}

/**
 * 描画形式ごとにコールド・ウォームの測定を反復し、統計を作る。
 * @param runnerPath - Textile描画APIを呼び出す一時Nodeスクリプト。
 * @param bundlePath - 現在のMarkdown描画コアをbundleしたESMファイル。
 * @param sourcePath - 同一条件で読み込むMarkdownまたはTextileサンプル。
 * @param format - 測定するMarkdown描画形式。
 * @returns 各5回のコールド・ウォーム測定結果。
 */
function measureFormat(runnerPath, bundlePath, sourcePath, format) {
    const cold = [];
    const warm = [];
    for (let run = 0; run < measurementRuns; run += 1) {
        cold.push(measureProcess(runnerPath, bundlePath, sourcePath, format, false));
        warm.push(measureProcess(runnerPath, bundlePath, sourcePath, format, true));
    }
    return {
        format,
        cold: summarize(getDurations(cold)),
        warm: summarize(getDurations(warm)),
        renderedBlocks: Math.max(...getRenderedBlockCounts(cold))
    };
}

/**
 * プロセス測定結果から描画時間を取り出す。
 * @param results - Textile描画プロセスが返した測定結果。
 * @returns 描画時間を並べた配列。
 */
function getDurations(results) {
    return results.map(
        /**
         * 各測定結果から描画時間を選ぶ。
         * @param result - Textile描画1回分の時間と生成ブロック数。
         * @returns 1回分の描画時間。
         */
        (result) => result.durationMs
    );
}

/**
 * プロセス測定結果から描画ブロック数を取り出す。
 * @param results - Textile描画プロセスが返した測定結果。
 * @returns 描画ブロック数を並べた配列。
 */
function getRenderedBlockCounts(results) {
    return results.map(
        /**
         * 各測定結果から描画ブロック数を選ぶ。
         * @param result - Textile描画1回分の時間と生成ブロック数。
         * @returns 1回分の描画ブロック数。
         */
        (result) => result.renderedBlocks
    );
}

/**
 * 同じ入力をMarkdown基準経路と混在経路で測定し、Markdown回帰閾値を判定する。
 * @param runnerPath - Textile描画APIを呼び出す一時Nodeスクリプト。
 * @param bundlePath - 現在のMarkdown描画コアをbundleしたESMファイル。
 * @param sourcePath - Textile構文を含まないMarkdownサンプル。
 * @param name - 結果JSONに記録するシナリオ名。
 * @returns 基準・変更後の統計と中央値・P95の差分率。
 */
function measureComparison(runnerPath, bundlePath, sourcePath, name) {
    const measurements = {
        markdown: { cold: [], warm: [] },
        mixed: { cold: [], warm: [] }
    };
    for (let run = 0; run < measurementRuns; run += 1) {
        const formats = run % 2 === 0 ? ['markdown', 'mixed'] : ['mixed', 'markdown'];
        for (const format of formats) {
            measurements[format].cold.push(measureProcess(runnerPath, bundlePath, sourcePath, format, false));
        }
        for (const format of formats) {
            measurements[format].warm.push(measureProcess(runnerPath, bundlePath, sourcePath, format, true));
        }
    }
    const baseline = createFormatSummary('markdown', measurements.markdown);
    const candidate = createFormatSummary('mixed', measurements.mixed);
    const regression = {
        coldMedianRatio: candidate.cold.medianMs / Math.max(baseline.cold.medianMs, Number.EPSILON) - 1,
        coldP95Ratio: candidate.cold.p95Ms / Math.max(baseline.cold.p95Ms, Number.EPSILON) - 1,
        warmMedianRatio: candidate.warm.medianMs / Math.max(baseline.warm.medianMs, Number.EPSILON) - 1,
        warmP95Ratio: candidate.warm.p95Ms / Math.max(baseline.warm.p95Ms, Number.EPSILON) - 1
    };
    return { name, baseline, candidate, regression };
}

/**
 * 交互順で測定した条件別の子プロセス結果を統計へまとめる。
 * @param format - Markdown基準またはTextile混在形式。
 * @param measurements - コールド・ウォーム各測定値。
 * @returns 中央値、P95、描画ブロック数を含む条件別結果。
 */
function createFormatSummary(format, measurements) {
    return {
        format,
        cold: summarize(getDurations(measurements.cold)),
        warm: summarize(getDurations(measurements.warm)),
        renderedBlocks: Math.max(...getRenderedBlockCounts(measurements.cold))
    };
}

/**
 * Textileサンプルの比較測定結果を生成し、閾値超過時は失敗終了する。
 * @returns 完了したら0、Markdown混在経路で閾値を超過したら1。
 */
async function main() {
    const outputDirectory = path.resolve('sample', 'textile');
    const scratchDirectory = await mkdtemp(path.join(tmpdir(), 'mve-textile-performance-'));
    const bundlePath = path.join(scratchDirectory, 'renderer.mjs');
    const runnerPath = path.join(scratchDirectory, 'runner.mjs');
    const runnerSource = `/**
 * @fileoverview 1プロセス内でTextile描画コアの指定回数を測定してJSONを返す。
 */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** 描画時間と生成ブロック数をJSONへ出力するプロセス処理。 */
async function run() {
  const [bundlePath, sourcePath, format, warmupValue] = process.argv.slice(2);
  const { renderMarkdownUnsafeBlocks } = await import(pathToFileURL(bundlePath).href);
  const source = await readFile(sourcePath, 'utf8');
  const options = { remoteImagesEnabled: false, language: 'ja', renderFormat: format };
  for (let index = 0; index < Number(warmupValue); index += 1) {
    renderMarkdownUnsafeBlocks(source, options);
  }
  const measurementIterations = Number(warmupValue) > 0 ? ${warmMeasurementIterations} : 1;
  let blocks;
  const started = performance.now();
  for (let index = 0; index < measurementIterations; index += 1) {
    blocks = renderMarkdownUnsafeBlocks(source, options);
  }
  const durationMs = (performance.now() - started) / measurementIterations;
  process.stdout.write(JSON.stringify({ durationMs, renderedBlocks: blocks.length, measurementIterations }));
}

await run();
`;
    await writeFile(runnerPath, runnerSource, 'utf8');
    try {
        const entryPoint = path.resolve('src', 'webview', 'markdown', 'markdownRendererCore.ts');
        await build({
            entryPoints: [entryPoint],
            outfile: bundlePath,
            bundle: true,
            platform: 'node',
            format: 'esm',
            target: 'node20',
            logLevel: 'silent'
        });

        const smallPath = path.resolve('sample', '01-commonmark-gfm.md');
        const smallMarkdown = await readFile(smallPath, 'utf8');
        const largePath = path.join(scratchDirectory, 'large-markdown.md');
        await writeFile(largePath, Array(20).fill(smallMarkdown).join('\n'), 'utf8');
        const textilePath = path.resolve(outputDirectory, 'core.textile');
        const scenarios = [
            measureComparison(runnerPath, bundlePath, smallPath, 'small-markdown-no-textile'),
            measureComparison(runnerPath, bundlePath, largePath, 'large-markdown-no-textile')
        ];
        const textile = measureFormat(runnerPath, bundlePath, textilePath, 'textile');
        const regressionValues = [];
        for (const scenario of scenarios) regressionValues.push(...Object.values(scenario.regression));
        const thresholdExceeded = regressionValues.some(
            /**
             * 10%を超える性能劣化があるか確認する。
             * @param ratio - Markdown混在経路の基準からの性能変化率。
             * @returns 閾値以上の性能劣化であればtrue。
             */
            (ratio) => ratio >= maximumRegressionRatio
        );
        const result = {
            methodology: {
                comparison: 'same renderer bundle, Markdown-only legacy mode versus mixed Markdown/Textile mode',
                cold: 'first render in a fresh Node process; process startup, imports, and file read excluded',
                warm: `average of ${warmMeasurementIterations} renders after ${warmupRuns} warm-up renders in a fresh Node process`,
                runsPerCondition: measurementRuns,
                p95Method: 'nearest rank',
                thresholdRatio: maximumRegressionRatio,
                thresholdExceeded,
                note: 'The legacy Markdown route is a same-build control, not a checkout from the pre-change revision.'
            },
            environment: {
                date: new Date().toISOString(),
                platform: platform(),
                architecture: arch(),
                node: process.version,
                cpu: cpus()[0]?.model ?? 'unknown',
                logicalCpuCount: cpus().length
            },
            scenarios,
            textileOnly: textile
        };
        const resultPath = path.join(outputDirectory, 'performance-results.json');
        await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
        console.log(JSON.stringify({ resultPath, thresholdExceeded, scenarios, textileOnly: textile }, null, 2));
        if (thresholdExceeded) process.exitCode = 1;
    } finally {
        await rm(scratchDirectory, { recursive: true, force: true });
    }
}

await main();

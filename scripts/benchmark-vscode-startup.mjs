/**
 * @fileoverview 実VS Code上で拡張機能を起動し、起動時間を反復計測して回帰を検出する。
 * 対象環境: Windows / Node 20以上。@vscode/test-electron がVS Code stable を取得・起動できること（MVE_STARTUP_VSCODE_EXECUTABLE で既存実行ファイルも指定可）。
 * 前提: npm run build 済みの dist。各試行は新規プロファイルの別プロセスで、初回オープン（cold）と同一プロセスでの再オープン（warm）を計測する。
 * 出力: MVE_STARTUP_REPORT（既定は一時フォルダー）へ、各試行値と cold / warm の中央値・P95・最大値を含むJSONを書く。
 * 失敗条件: 試行数3以上で、既存シナリオのcold中央値が固定上限を超えた場合は非0で終了する。ベースラインとの比較は compare-performance-baseline.mjs が担う。
 */
import { runTests } from '@vscode/test-electron';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';

delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.VSCODE_DEV;

/**
 * 起動計測で作成した一時ファイルのルート。
 */
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'mve-real-startup-'));
/**
 * 性能・VS Code・起動で読み書きするリソースの場所。
 */
const plainPath = path.join(temporaryRoot, 'plain.md');
/**
 * 性能・VS Code・起動で読み書きするリソースの場所。
 */
const mermaidPath = path.join(temporaryRoot, 'mermaid.md');
/**
 * 初期表示範囲に複数のMermaid図が入る合成文書の場所。図の種類を変えて描画経路の偏りを避ける。
 */
const mermaidMultiPath = path.join(temporaryRoot, 'mermaid-multi.md');
await writeFile(plainPath, '# Plain Markdown\n\nCold startup measurement.\n', 'utf8');
await writeFile(mermaidPath, '```mermaid\nflowchart TD\n  Start --> Ready\n```\n', 'utf8');
await writeFile(mermaidMultiPath, [
  '```mermaid\nflowchart LR\n  A[Open] --> B{Mermaid?}\n  B -->|yes| C[Render]\n  B -->|no| D[Skip]\n```',
  '```mermaid\nsequenceDiagram\n  Webview->>Host: renderMermaid\n  Host-->>Webview: mermaidRendered\n```',
  '```mermaid\nstateDiagram-v2\n  [*] --> Pending\n  Pending --> Ready\n  Ready --> [*]\n```',
  '```mermaid\npie title Share\n  "A" : 40\n  "B" : 60\n```',
  ''
].join('\n\n'), 'utf8');
const extensionDevelopmentPath = path.resolve(
  process.env.MVE_STARTUP_EXTENSION_PATH ?? '.',
);
/**
 * 性能・VS Code・起動で使用するVS Code実行ファイル。指定時はダウンロードを行わない。
 */
const vscodeExecutablePath = process.env.MVE_STARTUP_VSCODE_EXECUTABLE;
/**
 * 起動計測を実行するExtension Hostテストの場所。
 */
const extensionTestsPath = path.resolve(
  process.env.MVE_STARTUP_TESTS_PATH ??
    path.join(extensionDevelopmentPath, 'test', 'integration', 'startup.cjs'),
);

/**
 * 計測サンプルを置くルート。
 */
const sampleRoot = path.resolve(process.env.MVE_STARTUP_SAMPLE_ROOT ?? 'sample');
/**
 * 起動シナリオ。waitFor は計測完了とみなす前に揃っている必要がある指標を表す。
 * rich は簡易描画の後の最終描画、visibleMermaid は初期表示範囲の全Mermaid図の完了。Marpは通常プレビューを使わないため rich を待たない。
 */
const scenarios = [
  { name: 'plain', filePath: plainPath, waitFor: { rich: true } },
  { name: 'representative', filePath: path.join(sampleRoot, '06-specification-template.md'), waitFor: { rich: true } },
  { name: 'marp', filePath: path.join(sampleRoot, 'marp', '02-multiple-slides.md'), waitFor: {} },
  { name: 'mermaid-first', filePath: mermaidPath, waitFor: { mermaid: true, rich: true, visibleMermaid: true } },
  { name: 'mermaid-multi', filePath: mermaidMultiPath, waitFor: { mermaid: true, rich: true, visibleMermaid: true } },
  { name: 'large', filePath: path.join(sampleRoot, '11-performance-stress.md'), waitFor: { rich: true } }
];
/**
 * 統計を出す計測指標。存在しない指標（例: Mermaidの無い文書のMermaid指標）は集計から除く。
 */
const timingMetrics = [
  'editorOpenedMs', 'endToEndMs', 'activationMs', 'webviewReadyMs', 'initializedMs', 'previewReadyMs',
  'richReadyMs', 'firstMermaidRequestedMs', 'firstMermaidReadyMs', 'visibleMermaidReadyMs'
];
/**
 * 各起動シナリオを繰り返す回数。
 */
const repetitions = Math.max(1, Number.parseInt(process.env.MVE_STARTUP_RUNS ?? '5', 10) || 5);
/**
 * MVE_STARTUP_SCENARIOSが指定された場合に測定するシナリオ名の集合です。
 */
const selectedScenarioNames = process.env.MVE_STARTUP_SCENARIOS
  ? new Set(process.env.MVE_STARTUP_SCENARIOS.split(',').map((name) => name.trim()).filter(Boolean))
  : undefined;
const selectedScenarios = selectedScenarioNames
  ? scenarios.filter(({ name }) => selectedScenarioNames.has(name))
  : scenarios;
if (selectedScenarioNames && selectedScenarios.length !== selectedScenarioNames.size) {
  const unknownScenarios = [...selectedScenarioNames].filter((name) => !scenarios.some((scenario) => scenario.name === name));
  throw new Error(`Unknown startup benchmark scenarios: ${unknownScenarios.join(', ')}`);
}
/**
 * 起動測定の再確認に使う永続レポートの保存先。
 */
const reportPath = process.env.MVE_STARTUP_REPORT ?? path.join(
  os.tmpdir(),
  `mve-startup-benchmark-${new Date().toISOString().replaceAll(':', '-')}.json`,
);
/**
 * 測定条件、各試行値、中央値、ゲート結果を保存する。
 */
const benchmarkReport = {
  kind: 'vscode-startup',
  generatedAt: new Date().toISOString(),
  codeVersion: readCodeVersion(extensionDevelopmentPath),
  platform: `${process.platform}-${process.arch}`,
  osRelease: os.release(),
  cpu: os.cpus()[0]?.model,
  nodeVersion: process.version,
  vscodeVersion: undefined,
  vscodeExecutablePath,
  extensionDevelopmentPath,
  extensionTestsPath,
  sampleRoot,
  repetitions,
  conditionDefinitions: {
    cold: '新しいVS Codeプロセスと新規プロファイルで、拡張機能のactivationを含む初回オープン。OSのファイルキャッシュは温まっている。',
    warm: 'cold計測と同じプロセスで全エディターを閉じた後の再オープン。activation済みで、共有ブラウザー等の常駐資源は残る。'
  },
  scenarios: [],
  failures: [],
};
/**
 * 起動シナリオごとに許可する性能上限。
 */
const regressionLimits = {
  plain: { endToEndMs: 2300, previewReadyMs: 1400 },
  representative: { endToEndMs: 2800, previewReadyMs: 1800 },
  marp: { endToEndMs: 5000, previewReadyMs: 3000 },
  'mermaid-first': { endToEndMs: 2500, previewReadyMs: 1200, firstMermaidReadyMs: 1700 }
};

try {
  const limitFailures = [];
  for (const { name, filePath, waitFor } of selectedScenarios) {
    const samples = [];
    for (let iteration = 1; iteration <= repetitions; iteration += 1) {
      const profileRoot = await mkdtemp(path.join(os.tmpdir(), `mve-vscode-${name}-`));
      const resultPath = path.join(temporaryRoot, `${name}-${iteration}.json`);
      const childOutput = [];
      const outputSink = new Writable({

        write(chunk, _encoding, callback) {
          childOutput.push(String(chunk));
          callback();
        }
      });
      try {
        try {
          await runTests({
            version: 'stable',
            extensionDevelopmentPath,
            extensionTestsPath,
            vscodeExecutablePath,
            extensionTestsEnv: {
              MVE_STARTUP_BENCHMARK: '1',
              MVE_STARTUP_FILE: filePath,
              MVE_STARTUP_RESULT: resultPath,
              MVE_STARTUP_WAIT_FOR_MERMAID: waitFor.mermaid ? '1' : '0',
              MVE_STARTUP_WAIT_FOR_RICH: waitFor.rich ? '1' : '0',
              MVE_STARTUP_WAIT_FOR_VISIBLE_MERMAID: waitFor.visibleMermaid ? '1' : '0'
            },
            launchArgs: [
              `--user-data-dir=${path.join(profileRoot, 'data')}`,
              `--extensions-dir=${path.join(profileRoot, 'extensions')}`,
              '--disable-extensions',
              '--skip-welcome',
              '--skip-release-notes'
            ],
            stdout: outputSink,
            stderr: outputSink
          });
        } catch (error) {
          process.stderr.write(childOutput.join(''));
          throw error;
        }
        const timing = JSON.parse(await readFile(resultPath, 'utf8'));
        benchmarkReport.vscodeVersion ??= timing.vscodeVersion;
        samples.push(timing);
        console.log(`${name} ${iteration}/${repetitions}: ${JSON.stringify(timing)}`);
      } finally {
        outputSink.end();
        await removeProfile(profileRoot);
      }
    }
    const median = medianTiming(samples);
    const statistics = {
      cold: summarizeTimings(samples),
      // activationMs は同じExtension Hostでの初回activationの値をwarmでも繰り返し報告するだけなので、warmの比較対象から外す。
      warm: summarizeTimings(samples.map(
        /**
         * 各試行の再オープン計測値を取り出し、cold値の複製である activationMs を除く。
         * @param sample - 1試行分の計測結果。
         * @returns warm計測値。計測しなかった試行ではundefined。
         */
        (sample) => sample.warm && { ...sample.warm, activationMs: undefined }).filter(Boolean))
    };
    console.log(`${name} median: ${JSON.stringify(median)}`);
    console.log(`${name} statistics: ${JSON.stringify(statistics)}`);
    // 新設シナリオには固定上限が無い。回帰判定はベースライン比較（10%）で行う。
    const scenarioFailures = repetitions >= 3 && regressionLimits[name]
      ? findStartupLimitFailures(name, median, regressionLimits[name])
      : [];
    benchmarkReport.scenarios.push({
      name,
      file: path.basename(filePath),
      waitFor,
      runs: samples,
      median,
      statistics,
      limits: regressionLimits[name],
      failures: scenarioFailures,
    });
    limitFailures.push(...scenarioFailures);
  }
  benchmarkReport.failures = limitFailures;
  await writeFile(reportPath, `${JSON.stringify(benchmarkReport, null, 2)}\n`, 'utf8');
  console.log(`起動ベンチマークレポート: ${reportPath}`);
  if (limitFailures.length) throw new Error(limitFailures.join('\n'));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

/**
 * 複数回の起動計測から各指標の中央値を計算する。
 * @param samples - 起動または描画計測の結果一覧。
 * @returns 指標ごとの中央値を含む起動時間レコード。
 */
function medianTiming(samples) {
  const result = { runs: samples.length };
  for (const key of timingMetrics) {
    const values = samples.map(
    /**
     * samplesの各要素を変換して一覧化する。
     * @param sample - 性能・VS Code・起動へ渡す入力。

     */
    (sample) => sample[key]).filter(Number.isFinite).sort(
    /**
     * 2つの値を比較して並び順を決める。
     * @param left - 比較対象の左側の値。
     * @param right - 比較対象の右側の値。
     * @returns 2つの要素の順序を示す数値。
     */
    (left, right) => left - right);
    if (!values.length) continue;
    const middle = Math.floor(values.length / 2);
    result[key] = values.length % 2 ? values[middle] : Math.round((values[middle - 1] + values[middle]) / 2);
  }
  return result;
}

/**
 * 計測した拡張機能のコードの版（commitと未コミット変更の有無）を記録用に読む。Gitが使えない場合は理由を返し、計測は続ける。
 * @param directory - 計測対象の拡張機能フォルダー。
 * @returns commit と、未コミット変更の要約。
 */
function readCodeVersion(directory) {
  try {
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim();
    const changed = execFileSync('git', ['status', '--porcelain'], { cwd: directory, encoding: 'utf8' })
      .split('\n').filter(Boolean).length;
    return { commit, uncommittedFiles: changed };
  } catch (error) {
    return { unavailable: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 計測指標ごとに件数・中央値・P95（最近接順位法）・最大値を求める。
 * @param samples - 1シナリオ1条件分の計測結果一覧。
 * @returns 指標名から統計値への対応。値が1件も無い指標は含めない。
 */
function summarizeTimings(samples) {
  const result = {};
  for (const key of timingMetrics) {
    const values = samples.map(
      /**
       * 計測結果から対象指標の値を取り出す。
       * @param sample - 1回分の計測結果。
       * @returns 指標値。未計測ならundefined。
       */
      (sample) => sample[key]).filter(Number.isFinite).sort(
      /**
       * 数値を昇順に並べる。
       * @param left - 比較対象の左側の値。
       * @param right - 比較対象の右側の値。
       * @returns 2つの要素の順序を示す数値。
       */
      (left, right) => left - right);
    if (!values.length) continue;
    const middle = Math.floor(values.length / 2);
    result[key] = {
      count: values.length,
      median: values.length % 2 ? values[middle] : Math.round((values[middle - 1] + values[middle]) / 2),
      p95: values[Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1)],
      max: values[values.length - 1]
    };
  }
  return result;
}

/**
 * 起動計測値がシナリオ別の上限を超えていないことを検証する。
 * @param name - 性能・VS Code・起動の対象や分岐を識別する値。
 * @param timing - 1シナリオ分の起動計測結果。
 * @param limits - シナリオごとに許可する性能上限。
 * @returns 条件が成立したかを示す真偽値。
 */
function assertStartupLimits(name, timing, limits) {
  const failures = findStartupLimitFailures(name, timing, limits);
  if (failures.length) throw new Error(failures.join('\n'));
}

/**
 * 測定値が既存のシナリオ別上限内にあるかを検査し、超過内容を返します。
 * @param name - 起動シナリオ名。
 * @param timing - 1シナリオの起動測定結果。
 * @param limits - シナリオごとの許容性能上限。
 * @returns 上限を超えた測定値の説明。
 */
function findStartupLimitFailures(name, timing, limits) {
  const failures = [];
  for (const [metric, maximum] of Object.entries(limits)) {
    const actual = timing[metric];
    if (!Number.isFinite(actual) || actual > maximum) {
      failures.push(`${name} の実VS Code起動性能が回帰しました: ${metric}=${actual}ms > ${maximum}ms`);
    }
  }
  return failures;
}

/**
 * 統合テスト用VS Codeプロファイルを削除し、失敗時も後始末を再試行する。
 * @param profileRoot - 統合テスト用プロファイルの一時ディレクトリ。
 */
async function removeProfile(profileRoot) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await rm(profileRoot, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      return;
    } catch (error) {
      if (attempt === 7) {
        console.warn(`計測プロファイルはVS Codeプロセス終了後にOSが回収します: ${error}`);
        return;
      }
      await new Promise(
      /**
       * 遅延処理の完了または失敗を待機側へ通知する。
       * @param resolve - Promiseの成功を通知する関数。
       */
      (resolve) => setTimeout(resolve, 250));
    }
  }
}

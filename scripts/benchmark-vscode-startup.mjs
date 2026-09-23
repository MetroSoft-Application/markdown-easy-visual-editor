/**
 * @file benchmark-vscode-startup.mjs
 * 実行境界: 開発・検証スクリプト。
 * 責務: ビルド、スモーク、統合検証または補助生成を実行する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: プロセス、生成物、Webview、VS Code、Chromiumなどの外部環境を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { runTests } from '@vscode/test-electron';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';

delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.VSCODE_DEV;

/** 「temporaryRoot」は、対象ファイルまたは実行環境の場所を表す値です。 */
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'mve-real-startup-'));
/** 「plainPath」は、対象ファイルまたは実行環境の場所を表す値です。 */
const plainPath = path.join(temporaryRoot, 'plain.md');
/** 「mermaidPath」は、対象ファイルまたは実行環境の場所を表す値です。 */
const mermaidPath = path.join(temporaryRoot, 'mermaid.md');
await writeFile(plainPath, '# Plain Markdown\n\nCold startup measurement.\n', 'utf8');
await writeFile(mermaidPath, '```mermaid\nflowchart TD\n  Start --> Ready\n```\n', 'utf8');

/** 「scenarios」は、関連する処理間で共有する設定値または状態です。 */
const scenarios = [
  ['plain', plainPath, false],
  ['representative', path.resolve('sample', '06-specification-template.md'), false],
  ['mermaid-first', mermaidPath, true]
];
/** 「repetitions」は、関連する処理間で共有する設定値または状態です。 */
const repetitions = Math.max(1, Number.parseInt(process.env.MVE_STARTUP_RUNS ?? '3', 10) || 3);
/** 「regressionLimits」は、入力・表示・資源の上限または下限を表す値です。 */
const regressionLimits = {
  plain: { endToEndMs: 2300, previewReadyMs: 1400 },
  representative: { endToEndMs: 2800, previewReadyMs: 1800 },
  'mermaid-first': { endToEndMs: 2500, previewReadyMs: 1200, firstMermaidReadyMs: 1700 }
};

try {
  for (const [name, filePath, waitForMermaid] of scenarios) {
    const samples = [];
    for (let iteration = 1; iteration <= repetitions; iteration += 1) {
      const profileRoot = await mkdtemp(path.join(os.tmpdir(), `mve-vscode-${name}-`));
      const resultPath = path.join(temporaryRoot, `${name}-${iteration}.json`);
      const childOutput = [];
      const outputSink = new Writable({
        /**
         * writeを更新または保存します。
         * @param chunk 「chunk」は、「write」が検証シナリオの処理対象を特定する入力です。
         * @param _encoding 「_encoding」は、「write」が検証シナリオの処理対象を特定する入力です。
         * @param callback 処理完了時に呼び出すコールバックです。
         * @returns 「chunk」「_encoding」「callback」から生成した処理結果を返します。
         */
        write(chunk, _encoding, callback) {
          childOutput.push(String(chunk));
          callback();
        }
      });
      try {
        try {
          await runTests({
            version: 'stable',
            extensionDevelopmentPath: path.resolve('.'),
            extensionTestsPath: path.resolve('test/integration/startup.cjs'),
            extensionTestsEnv: {
              MVE_STARTUP_BENCHMARK: '1',
              MVE_STARTUP_FILE: filePath,
              MVE_STARTUP_RESULT: resultPath,
              MVE_STARTUP_WAIT_FOR_MERMAID: waitForMermaid ? '1' : '0'
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
        samples.push(timing);
        console.log(`${name} ${iteration}/${repetitions}: ${JSON.stringify(timing)}`);
      } finally {
        outputSink.end();
        await removeProfile(profileRoot);
      }
    }
    const median = medianTiming(samples);
    console.log(`${name} median: ${JSON.stringify(median)}`);
    if (repetitions >= 3) assertStartupLimits(name, median, regressionLimits[name]);
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

/**
 * 「medianTiming」は、処理時間、入力サイズ、または対象数を制限する境界値です。
 * @param samples 「samples」は、「medianTiming」が検証シナリオの処理対象を特定する入力です。
 * @returns 「medianTiming」が検証シナリオの入力を処理して得た固有の結果を返します。
 */
function medianTiming(samples) {
  const result = { runs: samples.length };
  for (const key of ['editorOpenedMs', 'endToEndMs', 'webviewReadyMs', 'initializedMs', 'previewReadyMs', 'firstMermaidReadyMs']) {
    const values = samples.map(
    /**
 * 「sample」を変換し、変換後の要素を返すコールバックです。
     * @param sample sampleとして渡される、このコールバックの入力値です。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (sample) => sample[key]).filter(Number.isFinite).sort(
    /**
 * 「left」「right」を比較し、並び順を示す数値を返すコールバックです。
     * @param left 比較対象の左側の値です。
     * @param right 比較対象の右側の値です。
     * @returns 比較対象の順序を示す負数、0、または正数を返します。
     */
    (left, right) => left - right);
    if (!values.length) continue;
    const middle = Math.floor(values.length / 2);
    result[key] = values.length % 2 ? values[middle] : Math.round((values[middle - 1] + values[middle]) / 2);
  }
  return result;
}

/**
 * assert・startup・limitsを検証します。
 * @param name ベンチマーク対象のシナリオ名で、測定結果の識別に使用します。
 * @param timing 性能計測または待機処理に使用する時間値です。
 * @param limits 検証シナリオが回帰と判定する性能上限の表です。
 * @returns 「assertStartupLimits」が判定した検証結果を返します。
 */
function assertStartupLimits(name, timing, limits) {
  for (const [metric, maximum] of Object.entries(limits)) {
    const actual = timing[metric];
    if (!Number.isFinite(actual) || actual > maximum) {
      throw new Error(`${name} の実VS Code起動性能が回帰しました: ${metric}=${actual}ms > ${maximum}ms`);
    }
  }
}

/**
 * remove・profileを解除または削除します。
 * @param profileRoot 処理対象のルートです。
 * @returns 「removeProfile」が検証シナリオの入力を処理して得た固有の結果を返します。
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
       * 予約されたタイミングで「resolve」を受け取り、遅延処理を実行するコールバックです。
       * @param resolve Promiseの完了または失敗を通知する関数です。
       * @returns エラー処理またはフォールバックの結果を返します。
       */
      (resolve) => setTimeout(resolve, 250));
    }
  }
}

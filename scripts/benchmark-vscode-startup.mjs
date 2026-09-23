/**
 * @fileoverview 性能・VS Code・起動を開発・検証環境で実行する。前提条件や失敗条件を終了コードとログで示す。
 */
import { runTests } from '@vscode/test-electron';
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
await writeFile(plainPath, '# Plain Markdown\n\nCold startup measurement.\n', 'utf8');
await writeFile(mermaidPath, '```mermaid\nflowchart TD\n  Start --> Ready\n```\n', 'utf8');

/**
 * 性能・VS Code・起動で扱う一覧または対応表。
 */
const scenarios = [
  ['plain', plainPath, false],
  ['representative', path.resolve('sample', '06-specification-template.md'), false],
  ['mermaid-first', mermaidPath, true]
];
/**
 * 各起動シナリオを繰り返す回数。
 */
const repetitions = Math.max(1, Number.parseInt(process.env.MVE_STARTUP_RUNS ?? '3', 10) || 3);
/**
 * 起動シナリオごとに許可する性能上限。
 */
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
         * 性能・VS Code・起動の値を保存先または共有状態へ書き出す。
         * @param chunk - ストリームから受け取ったデータ片。
         * @param _encoding - ストリームが通知する文字エンコーディング。
         * @param callback - ストリーム処理の完了を通知する関数。
         * @returns 副作用を完了し、値は返さない。
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
 * 複数回の起動計測から各指標の中央値を計算する。
 * @param samples - 起動または描画計測の結果一覧。
 * @returns 性能・VS Code・起動のmedian・timingが生成する結果。
 */
function medianTiming(samples) {
  const result = { runs: samples.length };
  for (const key of ['editorOpenedMs', 'endToEndMs', 'webviewReadyMs', 'initializedMs', 'previewReadyMs', 'firstMermaidReadyMs']) {
    const values = samples.map(
    /**
     * samplesの各要素を変換して一覧化する。
     * @param sample - 性能・VS Code・起動へ渡す入力。
     * @returns 入力要素から生成した変換結果の一覧。
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
 * 起動計測値がシナリオ別の上限を超えていないことを検証する。
 * @param name - 性能・VS Code・起動の対象や分岐を識別する値。
 * @param timing - 1シナリオ分の起動計測結果。
 * @param limits - シナリオごとに許可する性能上限。
 * @returns 条件が成立したかを示す真偽値。
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
 * 統合テスト用VS Codeプロファイルを削除し、失敗時も後始末を再試行する。
 * @param profileRoot - 統合テスト用プロファイルの一時ディレクトリ。
 * @returns 性能・VS Code・起動のremove・profileが生成する結果。
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
       * @returns 非同期処理の完了値。
       */
      (resolve) => setTimeout(resolve, 250));
    }
  }
}

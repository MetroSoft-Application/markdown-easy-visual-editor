import { runTests } from '@vscode/test-electron';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';

delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.VSCODE_DEV;

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'mve-real-startup-'));
const plainPath = path.join(temporaryRoot, 'plain.md');
const mermaidPath = path.join(temporaryRoot, 'mermaid.md');
await writeFile(plainPath, '# Plain Markdown\n\nCold startup measurement.\n', 'utf8');
await writeFile(mermaidPath, '```mermaid\nflowchart TD\n  Start --> Ready\n```\n', 'utf8');

const scenarios = [
  ['plain', plainPath, false],
  ['representative', path.resolve('sample', '06-specification-template.md'), false],
  ['mermaid-first', mermaidPath, true]
];
const repetitions = Math.max(1, Number.parseInt(process.env.MVE_STARTUP_RUNS ?? '3', 10) || 3);

try {
  for (const [name, filePath, waitForMermaid] of scenarios) {
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
    console.log(`${name} median: ${JSON.stringify(medianTiming(samples))}`);
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

function medianTiming(samples) {
  const result = { runs: samples.length };
  for (const key of ['editorOpenedMs', 'endToEndMs', 'webviewReadyMs', 'initializedMs', 'previewReadyMs', 'firstMermaidReadyMs']) {
    const values = samples.map((sample) => sample[key]).filter(Number.isFinite).sort((left, right) => left - right);
    if (!values.length) continue;
    const middle = Math.floor(values.length / 2);
    result[key] = values.length % 2 ? values[middle] : Math.round((values[middle - 1] + values[middle]) / 2);
  }
  return result;
}

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
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

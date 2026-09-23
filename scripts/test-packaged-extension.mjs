/**
 * @file test-packaged-extension.mjs
 * 実行境界: 開発・検証スクリプト。
 * 責務: ビルド、スモーク、統合検証または補助生成を実行する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: プロセス、生成物、Webview、VS Code、Chromiumなどの外部環境を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { runTests, runVSCodeCommand } from '@vscode/test-electron';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.VSCODE_DEV;

/** 「temporaryRoot」は、対象ファイルまたは実行環境の場所を表す値です。 */
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'mve-packaged-extension-'));
/** 「suppliedVsixPath」は、対象ファイルまたは実行環境の場所を表す値です。 */
const suppliedVsixPath = process.argv[2];
/** 「vsixPath」は、対象ファイルまたは実行環境の場所を表す値です。 */
const vsixPath = suppliedVsixPath
  ? path.resolve(suppliedVsixPath)
  : path.join(temporaryRoot, 'markdown-easy-visual-editor-test.vsix');
/** 「extensionsDir」は、対象ファイルまたは実行環境の場所を表す値です。 */
const extensionsDir = path.join(temporaryRoot, 'extensions');
/** 「userDataDir」は、対象ファイルまたは実行環境の場所を表す値です。 */
const userDataDir = path.join(temporaryRoot, 'data');
/** 「runnerDir」は、対象ファイルまたは実行環境の場所を表す値です。 */
const runnerDir = path.join(temporaryRoot, 'runner');

try {
  if (suppliedVsixPath) {
    await access(vsixPath);
  } else {
    const require = createRequire(import.meta.url);
    await promisify(execFile)(process.execPath, [
      require.resolve('@vscode/vsce/vsce'),
      'package',
      '--target', 'win32-x64',
      '--no-dependencies',
      '--allow-missing-repository',
      '--out', vsixPath
    ], { cwd: path.resolve('.') });
  }
  await writeFile(path.join(temporaryRoot, 'placeholder'), '', 'utf8');
  await mkdir(runnerDir, { recursive: true });
  await writeFile(path.join(runnerDir, 'package.json'), JSON.stringify({
    name: 'mve-packaged-test-runner',
    publisher: 'local',
    version: '0.0.0',
    engines: { vscode: '^1.100.0' },
    main: './noop.cjs'
  }), 'utf8');
  await writeFile(path.join(runnerDir, 'noop.cjs'), 'exports.activate = () => undefined;\n', 'utf8');

  await runVSCodeCommand([
    '--install-extension', vsixPath,
    '--force',
    `--extensions-dir=${extensionsDir}`,
    `--user-data-dir=${userDataDir}`
  ], { version: 'stable' });

  await runTests({
    version: 'stable',
    extensionDevelopmentPath: runnerDir,
    extensionTestsPath: path.resolve('test/integration/index.cjs'),
    launchArgs: [
      `--extensions-dir=${extensionsDir}`,
      `--user-data-dir=${userDataDir}`,
      '--skip-welcome',
      '--skip-release-notes'
    ]
  });
  console.log('VSIXインストール後のCustom Editor、同期、HTML/PDF出力、Undo/Redoを確認しました。');
} finally {
  await removeTemporaryRoot(temporaryRoot);
}

/**
 * ルートを解除または削除します。
 * @param directory 読み込みまたは出力するリソースの場所を示します。
 * @returns 「removeTemporaryRoot」がExtension Host処理の入力を処理して得た固有の結果を返します。
 */
async function removeTemporaryRoot(directory) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      return;
    } catch (error) {
      if (attempt === 7) {
        console.warn(`VSIX検証プロファイルはVS Code終了後にOSが回収します: ${error}`);
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

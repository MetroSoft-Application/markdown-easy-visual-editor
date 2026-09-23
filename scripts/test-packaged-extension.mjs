/**
 * @fileoverview テスト・パッケージ・拡張機能を開発・検証環境で実行する。前提条件や失敗条件を終了コードとログで示す。
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

/**
 * 起動計測で作成した一時ファイルのルート。
 */
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'mve-packaged-extension-'));
/**
 * テスト・パッケージ・拡張機能で読み書きするリソースの場所。
 */
const suppliedVsixPath = process.argv[2];
/**
 * テスト・パッケージ・拡張機能で読み書きするリソースの場所。
 */
const vsixPath = suppliedVsixPath
  ? path.resolve(suppliedVsixPath)
  : path.join(temporaryRoot, 'markdown-easy-visual-editor-test.vsix');
/**
 * テスト・パッケージ・拡張機能で一時生成物または検証対象を置くディレクトリ。
 */
const extensionsDir = path.join(temporaryRoot, 'extensions');
/**
 * テスト・パッケージ・拡張機能で一時生成物または検証対象を置くディレクトリ。
 */
const userDataDir = path.join(temporaryRoot, 'data');
/**
 * テスト・パッケージ・拡張機能で一時生成物または検証対象を置くディレクトリ。
 */
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
 * テスト・パッケージ・拡張機能の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param directory - テスト・パッケージ・拡張機能で読み書きするリソースの場所。
 * @returns テスト・パッケージ・拡張機能のremove・temporary・rootが生成する結果。
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
       * 遅延処理の完了または失敗を待機側へ通知する。
       * @param resolve - Promiseの成功を通知する関数。
       * @returns 非同期処理の完了値。
       */
      (resolve) => setTimeout(resolve, 250));
    }
  }
}

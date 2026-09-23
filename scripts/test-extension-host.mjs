/**
 * @fileoverview テスト・拡張機能・hostを開発・検証環境で実行する。前提条件や失敗条件を終了コードとログで示す。
 */
import { runTests } from '@vscode/test-electron';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.VSCODE_DEV;

/**
 * テスト・拡張機能・hostで読み書きするリソースの場所。
 */
const profileRoot = await mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-vscode-'));
try {
  await runTests({
    version: 'stable',
    extensionDevelopmentPath: path.resolve('.'),
    extensionTestsPath: path.resolve('test/integration/index.cjs'),
    launchArgs: [
      `--user-data-dir=${path.join(profileRoot, 'data')}`,
      `--extensions-dir=${path.join(profileRoot, 'extensions')}`,
      '--disable-extensions',
      '--skip-welcome',
      '--skip-release-notes'
    ]
  });
  console.log('Extension Host起動、Custom Editor表示、保存、HTML/PDF出力、Undo/Redoを確認しました。');
} finally {
  await removeProfile(profileRoot);
}

/**
 * 統合テスト用VS Codeプロファイルを削除し、失敗時も後始末を再試行する。
 * @param profileRoot - 統合テスト用プロファイルの一時ディレクトリ。
 * @returns テスト・拡張機能・hostのremove・profileが生成する結果。
 */
async function removeProfile(profileRoot) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await rm(profileRoot, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      return;
    } catch (error) {
      if (attempt === 7) {
        console.warn(`試験プロファイルはVS Codeプロセス終了後にOSが回収します: ${error}`);
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

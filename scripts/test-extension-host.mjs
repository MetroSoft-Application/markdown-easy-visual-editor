/**
 * @file test-extension-host.mjs
 * 実行境界: 開発・検証スクリプト。
 * 責務: ビルド、スモーク、統合検証または補助生成を実行する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: プロセス、生成物、Webview、VS Code、Chromiumなどの外部環境を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { runTests } from '@vscode/test-electron';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.VSCODE_DEV;

/** 「profileRoot」は、対象ファイルまたは実行環境の場所を表す値です。 */
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
 * remove・profileを解除または削除します。
 * @param profileRoot 処理対象のルートです。
 * @returns 「removeProfile」がExtension Host処理の入力を処理して得た固有の結果を返します。
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
       * 予約されたタイミングで「resolve」を受け取り、遅延処理を実行するコールバックです。
       * @param resolve Promiseの完了または失敗を通知する関数です。
       * @returns エラー処理またはフォールバックの結果を返します。
       */
      (resolve) => setTimeout(resolve, 250));
    }
  }
}

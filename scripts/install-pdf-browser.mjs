/**
 * @file install-pdf-browser.mjs
 * 実行境界: 開発・検証スクリプト。
 * 責務: ビルド、スモーク、統合検証または補助生成を実行する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: プロセス、生成物、Webview、VS Code、Chromiumなどの外部環境を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/** 「browserPath」は、ブラウザー処理の共有状態または実行設定です。 */
const browserPath = path.resolve('.chromium');
/** 「result」は、関連する処理間で共有する設定値または状態です。 */
const result = spawnSync(
  process.execPath,
  [path.resolve('node_modules/playwright-core/cli.js'), 'install', '--only-shell', 'chromium'],
  {
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserPath }
  }
);

process.exit(result.status ?? 1);

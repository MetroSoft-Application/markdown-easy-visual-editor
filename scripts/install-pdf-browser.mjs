/**
 * @fileoverview 導入・PDF・ブラウザーを開発・検証環境で実行する。前提条件や失敗条件を終了コードとログで示す。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/**
 * 導入・PDF・ブラウザーで読み書きするリソースの場所。
 */
const browserPath = path.resolve('.chromium');
/**
 * 導入・PDF・ブラウザーのresultに関する状態または設定。
 */
const result = spawnSync(
  process.execPath,
  [path.resolve('node_modules/playwright-core/cli.js'), 'install', '--only-shell', 'chromium'],
  {
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserPath }
  }
);

process.exit(result.status ?? 1);

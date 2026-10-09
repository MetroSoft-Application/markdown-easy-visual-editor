/**
 * @fileoverview PDF出力に使うChromium実行ファイルを所定のローカルディレクトリへ導入し、起動可能性を確認する。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/**
 * 導入・PDF・ブラウザーで読み書きするリソースの場所。
 */
const browserPath = path.resolve('.chromium');
/**
 * PlaywrightのChromiumインストーラーを実行したプロセス結果。
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

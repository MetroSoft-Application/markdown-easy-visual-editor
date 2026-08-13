import { spawnSync } from 'node:child_process';
import path from 'node:path';

const browserPath = path.resolve('.chromium');
const result = spawnSync(
  process.execPath,
  [path.resolve('node_modules/playwright-core/cli.js'), 'install', '--only-shell', 'chromium'],
  {
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserPath }
  }
);

process.exit(result.status ?? 1);

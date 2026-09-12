import { runTests } from '@vscode/test-electron';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.VSCODE_DEV;

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
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

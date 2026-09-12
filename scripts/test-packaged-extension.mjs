import { runTests, runVSCodeCommand } from '@vscode/test-electron';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.VSCODE_DEV;

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'mve-packaged-extension-'));
const suppliedVsixPath = process.argv[2];
const vsixPath = suppliedVsixPath
  ? path.resolve(suppliedVsixPath)
  : path.join(temporaryRoot, 'markdown-easy-visual-editor-test.vsix');
const extensionsDir = path.join(temporaryRoot, 'extensions');
const userDataDir = path.join(temporaryRoot, 'data');
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
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

import { spawnSync } from 'node:child_process';
import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const where = spawnSync('where.exe', ['code'], { encoding: 'utf8' });
if (where.status !== 0) throw new Error('VS Code CLI (code) が見つかりません。');
const candidates = where.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
const codePath = candidates.find((value) => value.toLowerCase().endsWith('.cmd')) ?? candidates[0];
if (!codePath) throw new Error('VS Code CLIのパスを解決できません。');
const codeRoot = path.resolve(path.dirname(codePath), '..');
const codeExecutable = path.join(codeRoot, 'Code.exe');
await access(codeExecutable);
const cliPath = await findCli(codeRoot);

const profileRoot = await mkdtemp(path.join(os.tmpdir(), 'markdown-easy-visual-editor-vscode-'));
try {
  const result = spawnSync(codeExecutable, [cliPath,
    `--user-data-dir=${path.join(profileRoot, 'data')}`,
    `--extensions-dir=${path.join(profileRoot, 'extensions')}`,
    '--disable-extensions',
    '--skip-welcome',
    '--skip-release-notes',
    `--extensionDevelopmentPath=${path.resolve('.')}`,
    `--extensionTestsPath=${path.resolve('test/integration/index.cjs')}`
  ], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: '' }
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Extension Host統合テストが終了コード ${result.status} で失敗しました。`);
  console.log('Extension Host起動、Custom Editor表示、保存、Undo/Redoを確認しました。');
} finally {
  await removeProfile(profileRoot);
}

async function findCli(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(root, entry.name, 'resources', 'app', 'out', 'cli.js');
    try {
      await access(candidate);
      return candidate;
    } catch {
      // 次のVS Codeビルドディレクトリを確認する。
    }
  }
  throw new Error('VS Code cli.jsが見つかりません。');
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

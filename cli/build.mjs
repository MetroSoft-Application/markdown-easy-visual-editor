/**
 * Build a separate Node CLI without pulling the VS Code extension host into it.
 * The current shared conversion sources remain in the parent repository until
 * extraction to a versioned conversion-core package is complete.
 */
import * as esbuild from 'esbuild';
import path from 'node:path';
import { appendFile, chmod, copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import postcss from 'postcss';

const root = process.cwd();
const outdir = path.join(root, 'cli', 'dist');
for (const file of ['markdown-fallback.js', 'pele-render-worker.js', 'export-fonts.css']) {
  await stat(path.join(root, 'dist', file)).catch(() => {
    throw new Error('Build the editor assets first: npm run build');
  });
}
await mkdir(outdir, { recursive: true });
await esbuild.build({
  entryPoints: [path.join(root, 'cli', 'main.ts')],
  outfile: path.join(outdir, 'mve-convert.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  external: ['playwright-core'],
  plugins: [{
    name: 'vscode-host-adapter',
    setup(build) {
      build.onResolve({ filter: /^vscode$/ }, () => ({
        path: path.join(root, 'cli', 'vscode-bridge.ts')
      }));
    }
  }],
  logLevel: 'info'
});
await esbuild.build({
  entryPoints: [path.join(root, 'cli', 'print-assets.css')],
  outfile: path.join(outdir, 'print-assets.css'),
  bundle: true,
  minify: true,
  loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
  logLevel: 'info'
});
// Preserve the original editor's syntax colors (not another theme).
const editorCss = postcss.parse(await readFile(path.join(root, 'src/webview/styles.css'), 'utf8'));
const syntaxRules = [];
editorCss.walkRules((rule) => {
  if (rule.selector.includes('.hljs') || rule.selector.includes('.katex')) {
    syntaxRules.push(rule.parent.type === 'atrule'
      ? '@' + rule.parent.name + ' ' + rule.parent.params + '{' + rule.toString() + '}'
      : rule.toString());
  }
});
if (!syntaxRules.some((rule) => rule.includes('.hljs-keyword'))) {
  throw new Error('Editor syntax color rules not found');
}
await appendFile(path.join(outdir, 'print-assets.css'), '\n' + syntaxRules.join('\n'));
await Promise.all(['markdown-fallback.js', 'pele-render-worker.js', 'export-fonts.css'].map(
  (file) => copyFile(path.join(root, 'dist', file), path.join(outdir, file))
));
await chmod(path.join(outdir, 'mve-convert.cjs'), 0o755);
console.log('CLI built: cli/dist/mve-convert.cjs');

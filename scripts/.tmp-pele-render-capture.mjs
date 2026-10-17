import { chromium } from 'playwright-core';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderPeleMermaid } from '../src/extension/peleMermaid.ts';

const cases = [
  ['flowchart', 'sample/mermaid/02-flowchart-branches.md', 'default'],
  ['flowchart-dark', 'sample/mermaid/02-flowchart-branches.md', 'dark'],
  ['sequence', 'sample/mermaid/05-sequence-basic.md', 'default'],
  ['state', 'sample/mermaid/09-state-diagram-basic.md', 'default'],
  ['pie', 'sample/mermaid/14-pie-chart.md', 'default']
];
const chromePath = 'E:/source/markdown-easy-visual-editor/.chromium/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';
const outDir = path.resolve('artifacts');
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const results = [];
try {
  for (const [name, file, theme] of cases) {
    const markdown = await readFile(file, 'utf8');
    const match = markdown.match(/```mermaid\s*\r?\n([\s\S]*?)\r?\n```/);
    if (!match) throw new Error(`No Mermaid fence found in ${file}`);
    const rendered = await renderPeleMermaid(
      match[1], theme,
      path.resolve('dist/pele-render-worker.js'),
      async () => browser,
      undefined,
      { fontFamily: 'Arial', resolveImages: async () => ({}) }
    );
    if (!rendered.svg.startsWith('<svg') && !rendered.svg.includes('<svg')) throw new Error(`Pele returned no SVG for ${file}`);
    await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:#fff}body{display:flex;align-items:center;justify-content:center}.diagram{width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:48px;box-sizing:border-box}.diagram svg{max-width:100%;max-height:100%}</style></head><body><main class="diagram"></main></body></html>');
    await page.locator('.diagram').evaluate((element, svg) => { element.innerHTML = svg; }, rendered.svg);
    await page.evaluate(() => document.fonts.ready);
    const bounds = await page.locator('.diagram svg').boundingBox();
    if (!bounds || bounds.width < 20 || bounds.height < 20) throw new Error(`Rendered SVG has invalid bounds for ${file}: ${JSON.stringify(bounds)}`);
    const screenshot = path.join(outDir, `pele-preview-${name}.png`);
    await page.locator('.diagram svg').screenshot({ path: screenshot, animations: 'disabled' });
    results.push({ name, theme, file, svgCharacters: rendered.svg.length, width: Math.round(bounds.width), height: Math.round(bounds.height), interactions: rendered.interactions.length, screenshot });
  }
} finally {
  await browser.close();
}
await writeFile(path.join(outDir, 'pele-preview-manifest.json'), JSON.stringify(results, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify(results, null, 2) + '\n');

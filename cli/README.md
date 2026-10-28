# Markdown Easy Convert — staged CLI extraction

This directory owns the HTML/PDF output modules and the Markdown-to-HTML/PDF
command-line application. The VS Code extension imports the same output
modules in-process through compatibility facades under `src/extension/`, so
the editor and CLI use one HTML/PDF writer. The CLI is **not yet an
independently releasable package** because it still depends on repository
sources and root-level runtime dependencies.

## Build

From the **repository root**:

```sh
npm ci
npm run build
node cli/build.mjs
node cli/dist/mve-convert.cjs --help
```

The CLI output is in `cli/dist/`. `node_modules/playwright-core` must remain
available at runtime. HTML rendering and PDF printing use the same Edge/Chrome
browser discovery as the editor, or pass `--browser /path/to/browser`.

```sh
node cli/dist/mve-convert.cjs docs/readme.md --format html --linked --outline
node cli/dist/mve-convert.cjs docs/readme.md --format pdf --output out/readme.pdf
```

The CLI reuses the browser Markdown renderer and sanitizer, HTML link/image
writer, PDF printer, and Pele Mermaid worker. The same browser is reused within
one invocation. Local Mermaid images are only read inside the specified
workspace root. `--linked` renders each linked Markdown document with the same
renderer rather than the host's reduced fallback renderer.

## Parity and release gate

The editor calls the CLI-owned HTML/PDF output modules in-process while keeping
its existing Webview render requests, save dialogs, progress messages, and
unsaved document contents. This is not a separately launched CLI process. The
shared output path does not by itself prove pixel-identical output or
performance parity.

Before declaring independent release readiness:

1. Move the Markdown renderer, CLI-owned HTML/PDF output modules, CSS/fonts,
   Pele/Marp workers and file/URI abstractions into a versioned shared
   conversion package. Import it from **both** the editor and the CLI; do not
   duplicate algorithms.
2. Complete the Marp slide conversion path. The CLI currently **fails clearly**
   on Marp-enabled input instead of silently producing a different document.
3. Add exact support for the editor's configurable output text replacements,
   theme/fonts, PDF options and all HTML output behavior. Current CLI flags only
   cover the subset shown by `--help`.
4. Run the complete existing Vitest, extension host, sample matrix, HTML/PDF,
   Mermaid, Textile, Marp and smoke suites against the same shared core.
5. Add golden HTML/PDF fixture comparisons and browser-based visual regression
   for font layout, SVG images, tables, links, Math/KaTeX, print margins,
   headers/footers, clipping and page breaks.
6. Compare memory, startup time, steady-state throughput, cold/warm Chromium,
   and large-sample rendering against the checked-in baseline. Set and enforce
   zero-regression acceptance thresholds before release.
7. Package `cli/dist/` with its runtime dependencies, licenses, browser
   installation instructions and assets; verify from a clean checkout of only
   the standalone CLI repository.

Keep `private: true` in this directory's package.json until these gates pass.
Keep the Extension Host compatibility facades until all imports and tests use
the shared conversion package.

# Markdown Easy Convert — staged CLI extraction

This directory is the initial separation boundary for the Markdown-to-HTML/PDF
command-line application. It is **not yet an independently releasable package**.
The present source imports the original rendering/export implementations from
`../src`; the next extraction phase must move those implementations to a
versioned shared core and make the editor consume that package.

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

The CLI reuses the **original** browser Markdown renderer and sanitizer,
HTML link/image writer, PDF printer, and Pele Mermaid worker. The same browser is
reused within one invocation. Local Mermaid images are only read inside the
specified workspace root. `--linked` renders each linked Markdown document
with the same renderer rather than the host's reduced fallback renderer.

## Parity and release gate

The current implementation is an **integration starting point**, not proof of
pixel-identical output or performance parity. The editor is not switched to the
CLI, and its existing code paths remain unchanged.

Before declaring independent release readiness:

1. Move the Markdown renderer, HTML writer, PDF engine, CSS/fonts, Pele/Marp
   workers and file/URI abstractions into a versioned shared conversion package.
   Import it from **both** the editor and the CLI; do not duplicate algorithms.
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
Do not remove the editor's existing renderer/exporter during the transition.

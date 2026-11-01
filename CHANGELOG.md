# Changelog

## 1.3.0

- Added automatic Marp slide previews for Markdown files with `marp: true` in YAML front matter.

## 1.3.1

- Added links from headings to their sections in exported HTML.
- Added immediate notifications when PDF or HTML export starts.

## 1.4.0

- Changed the mermaid rendering engine to Pele.

## 1.4.1

- Added resizing and a hide button to the HTML outline option.

## 1.4.2

- Added the ability to paste SVG images from the clipboard in the source editor.

## 1.4.3

- Added image resizing to Marp slide previews.
- Fixed Marp previews returning to the first slide while the Markdown is being updated.

## 1.4.4

- Added Mermaid diagrams to Marp slides, with per-diagram size adjustment.
- Added page breaks between Marp slides in PDF exports.

## 1.5.0

- Added Textile document previews with mixed Markdown and Textile rendering.
- Added syntax highlighting for nested Textile list markers.
- Added Textile rendering to HTML and PDF output.

## 1.5.1

- Added a global Mermaid font-size setting for previews and HTML/PDF output, including Marp.

## 1.5.2

- Added theme-specific heading colors to previews and HTML/PDF output.

## 1.5.3

- Fixed table sizing in HTML and PDF output so short cell values remain on one line and longer content wraps within the available page width.

## 2.0.0

- Changed HTML and PDF export to use `@metrosoft/markdown-easy-converter`.
- Fixed preview spacing and highlight/table colors.

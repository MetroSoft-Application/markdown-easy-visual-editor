/**
 * Prepare rendered preview markup for HTML/PDF output without mutating the live DOM.
 * Large Mermaid SVGs stay encoded in the interactive preview and are expanded here
 * only after serialization, so export remains vector based without freezing the UI.
 */
export function prepareExportHtml(html: string): string {
  const eagerImages = html.replace(/\sloading=(['"])lazy\1/gi, ' loading="eager"');
  return eagerImages.replace(
    /<div([^>]*?)\sdata-mve-export-svg="([^"]+)"([^>]*)><\/div>/gi,
    (_match, before: string, encoded: string, after: string) => {
      try {
        return `<div${before}${after}>${decodeURIComponent(encoded)}</div>`;
      } catch {
        return `<div${before}${after}></div>`;
      }
    }
  );
}

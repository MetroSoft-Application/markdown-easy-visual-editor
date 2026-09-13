import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

interface PreservedImagePaste {
  markdown: string;
  type: string;
}

/**
 * プレビュー画像コピーが用意した埋め込み画像を、ブラウザのClipboard画像MIME対応状況に依存せず
 * 元data URLのままCodeMirrorへ貼り付ける。画像バイト列の再エンコードは行わない。
 */
export function installPreviewImageClipboardPaste(): () => void {
  const onPaste = (event: ClipboardEvent) => {
    if (!(event.target instanceof Element)) return;
    const content = event.target.closest<HTMLElement>(".cm-content");
    if (!content) return;

    const preserved = readPreservedImagePaste(event.clipboardData);
    if (!preserved) return;

    const editorElement = content.closest<HTMLElement>(".cm-editor");
    if (!editorElement) return;
    const view = EditorView.findFromDOM(editorElement);
    if (!view) return;

    const selection = view.state.selection.main;
    event.preventDefault();
    event.stopImmediatePropagation();
    view.dispatch({
      changes: {
        from: selection.from,
        to: selection.to,
        insert: preserved.markdown,
      },
      selection: EditorSelection.cursor(selection.from + preserved.markdown.length),
    });
    view.focus();
  };

  document.addEventListener("paste", onPaste, true);
  return () => document.removeEventListener("paste", onPaste, true);
}

/**
 * この拡張機能の画像コピーだけを識別し、HTMLに埋め込まれた元形式data URLからMarkdownを再構成する。
 */
export function readPreservedImagePaste(
  clipboard: DataTransfer | null,
): PreservedImagePaste | undefined {
  if (!clipboard) return undefined;
  const html = clipboard.getData("text/html");
  if (!html) return undefined;

  const documentNode = new DOMParser().parseFromString(html, "text/html");
  const image = documentNode.querySelector<HTMLImageElement>(
    "img[data-mve-original-src]",
  );
  if (!image) return undefined;

  const dataUrl = image.getAttribute("src")?.trim() ?? "";
  const type = imageMimeFromDataUrl(dataUrl);
  if (!type) return undefined;

  const alt = image.getAttribute("alt") ?? "";
  return {
    type,
    markdown: `![${escapeMarkdownAlt(alt)}](${dataUrl})`,
  };
}

/** data:image/*;base64,... のMIMEだけを返し、画像以外や壊れたdata URLは拒否する。 */
export function imageMimeFromDataUrl(value: string): string | undefined {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(value);
  if (!match) return undefined;
  const type = normalizeMimeType(match[1] ?? "");
  if (!type.startsWith("image/")) return undefined;
  if (!(match[2] ?? "").replace(/\s+/g, "")) return undefined;
  return type;
}

function normalizeMimeType(type: string): string {
  const normalized = type.trim().toLowerCase();
  if (normalized === "image/jpg" || normalized === "image/pjpeg") {
    return "image/jpeg";
  }
  if (normalized === "image/svg") return "image/svg+xml";
  if (normalized === "image/x-ms-bmp") return "image/bmp";
  return normalized;
}

function escapeMarkdownAlt(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

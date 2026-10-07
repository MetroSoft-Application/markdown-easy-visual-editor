/**
 * @fileoverview PDFプレビュー/出力用DOMの可視テキストだけへ正規表現置換を適用する。
 */
import type { PdfTextReplacementRule } from "../shared/protocol";
import { applyPdfTextReplacements } from "../shared/pdfTextReplacement";

/** PDF本文置換の対象外にする、表示本文ではないHTML要素。 */
const PDF_TEXT_REPLACEMENT_EXCLUDED_SELECTOR =
  "script,style,template,noscript";

/**
 * DOMサブツリー内の可視テキストノードへPDF置換ルールを登録順で適用する。
 *
 * 属性値やタグ名は変更しないため、href/src/style等のHTML構造を正規表現で壊さない。
 */
export function applyPdfTextReplacementsToDom(
  root: Node,
  rules: readonly PdfTextReplacementRule[] | undefined,
): void {
  if (!rules?.length) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    const text = current as Text;
    const parent = text.parentElement;
    if (!parent?.closest(PDF_TEXT_REPLACEMENT_EXCLUDED_SELECTOR)) {
      targets.push(text);
    }
    current = walker.nextNode();
  }

  for (const text of targets) {
    const before = text.data;
    const after = applyPdfTextReplacements(before, rules);
    if (after !== before) text.data = after;
  }
}

/**
 * 出力用DOMを複製し、元プレビューを変更せずにPDF置換を適用する。
 */
export function cloneWithPdfTextReplacements(
  element: HTMLElement,
  rules: readonly PdfTextReplacementRule[] | undefined,
): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement;
  applyPdfTextReplacementsToDom(clone, rules);
  return clone;
}

/**
 * レンダリング済みHTML文字列へPDF置換を適用する。
 * 印刷プレビューの一時ライブレイヤーで使用する。
 */
export function applyPdfTextReplacementsToHtml(
  html: string,
  rules: readonly PdfTextReplacementRule[] | undefined,
): string {
  if (!rules?.length || !html) return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  applyPdfTextReplacementsToDom(template.content, rules);
  return template.innerHTML;
}

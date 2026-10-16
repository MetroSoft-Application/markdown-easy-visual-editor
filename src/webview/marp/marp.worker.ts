/**
 * @fileoverview Marp専用Web WorkerでスライドHTMLとソース範囲を生成する。
 */
import { renderMarpMarkdown } from "./marpRenderer";

interface RenderRequest {
  id: number;
  markdown: string;
  katexFontPath: string;
}

self.addEventListener(
  "message",
  /**
   * 最新のMarp描画要求を処理し、要求ID付きで結果またはエラーを返す。
   * @param event - Marp Markdown描画要求を受信したmessage event。
   */
  (event: MessageEvent<RenderRequest>) => {
    const { id, markdown, katexFontPath } = event.data;
    try {
      const result = renderMarpMarkdown(markdown, katexFontPath);
      self.postMessage({ id, ...result });
    } catch (error) {
      self.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);

/**
 * @file markdownRenderLight.worker.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { collectDiagnostics, getOutline, wordStats } from "../shared/markdown";
import {
  renderMarkdownUnsafeBlocks,
  type RenderOptions,
} from "./markdownRendererCore";

/**
 * 「RenderRequest」が満たすデータ契約を定義します。
 */
interface RenderRequest {

  /**
   * 「id」は、対象の識別や処理分岐に使用する値を保持します。
   */
  id: number;

  /**
   * 「markdown」は、解析・編集・変換の対象となる本文またはデータを保持します。
   */
  markdown: string;

  /**
   * 「options」は、利用側が共有する設定または現在状態を保持します。
   */
  options: RenderOptions;
}

self.addEventListener("message",
/**
 * イベント情報を「event」を受け取り、DOMまたは画面状態を更新するコールバックです。
 * @param event 処理対象のイベントです。
 * @returns 「self.postMessage」を実行し、値を返しません。
 */
(event: MessageEvent<RenderRequest>) => {
  const { id, markdown, options } = event.data;
  try {
    self.postMessage({
      id,
      markdown,
      preliminary: true,
      unsafeBlocks: renderMarkdownUnsafeBlocks(markdown, options),
      outline: getOutline(markdown),
      diagnostics: collectDiagnostics(markdown, options.language),
      stats: wordStats(markdown),
    });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

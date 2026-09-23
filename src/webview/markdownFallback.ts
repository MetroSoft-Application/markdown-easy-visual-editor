/**
 * @file markdownFallback.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import type { RenderOptions } from "./markdownRendererCore";
import { webviewAssetUrl, webviewScriptNonce } from "./assets";

/**
 * 「MarkdownFallbackRuntime」が満たすデータ契約を定義します。
 */
interface MarkdownFallbackRuntime {
  /**
   * 「renderMarkdown」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
   * @param markdown 解析・編集・変換の対象となる本文または生成済み内容です。
   * @param options 処理経路や表示方法を指定する設定値です。
   * @returns 「renderMarkdown」が生成または変換したMarkdownの文字列を返します。
   */
  renderMarkdown(markdown: string, options: RenderOptions): string;
}

/**
 * 同期フォールバック用ランタイムをWebview全体で共有するグローバル宣言です。
 */
declare global {
  /** Workerを利用できない環境から読み込んだMarkdown変換ランタイムです。 */
  var mveMarkdownFallback: MarkdownFallbackRuntime | undefined;
}

/** 「runtimePromise」は、非同期初期化または処理の重複を防ぐ共有Promiseです。 */
let runtimePromise: Promise<MarkdownFallbackRuntime> | undefined;

/**
 * Markdown Worker を利用できない環境だけで、同期レンダラーを別成果物から読む。
 * 通常の初回起動では marked/highlight.js/KaTeX を UI スレッドへ読み込まない。
 * @param markdown 解析・編集・変換の対象となる本文または生成済み内容です。
 * @param options 処理経路や表示方法を指定する設定値です。
 * @returns 非同期処理の完了を表すPromiseです。
 */
export async function renderMarkdownFallback(
  markdown: string,
  options: RenderOptions,
): Promise<string> {
  const runtime = await loadMarkdownFallback();
  return runtime.renderMarkdown(markdown, options);
}

/**
 * load・markdown・fallbackを取得または解決します。
 * @returns 非同期処理の完了を表すPromiseです。
 */
function loadMarkdownFallback(): Promise<MarkdownFallbackRuntime> {
  if (globalThis.mveMarkdownFallback) {
    return Promise.resolve(globalThis.mveMarkdownFallback);
  }
  runtimePromise ??= new Promise<MarkdownFallbackRuntime>(
  /**
 * 「resolve」「reject」を受け取り、処理結果を生成する処理です。
   * @param resolve Promiseの完了または失敗を通知する関数です。
   * @param reject Promiseの完了または失敗を通知する関数です。
   * @returns 「document.createElement」を実行し、値を返しません。
   */
  (resolve, reject) => {
    const script = document.createElement("script");
    script.src = webviewAssetUrl(
      "markdown-fallback.js",
      document.body.dataset.mveMarkdownFallbackUri,
    );
    script.async = true;
    const nonce = webviewScriptNonce();
    if (nonce) script.nonce = nonce;
    script.addEventListener(
      "load",

      /**
       * イベント情報を受け取り、DOMまたは画面状態を更新するコールバックです。
       * @returns 非同期処理へ渡す完了結果を返します。
       */
      () => {
        if (globalThis.mveMarkdownFallback) {
          resolve(globalThis.mveMarkdownFallback);
          return;
        }
        runtimePromise = undefined;
        reject(new Error("Markdown fallback runtime did not initialize."));
      },
      { once: true },
    );
    script.addEventListener(
      "error",

      /**
       * イベント情報を受け取り、DOMまたは画面状態を更新するコールバックです。
       * @returns 「reject」の呼び出し結果を返します。
       */
      () => {
        runtimePromise = undefined;
        reject(new Error("Markdown fallback runtime could not be loaded."));
      },
      { once: true },
    );
    document.head.append(script);
  });
  return runtimePromise;
}

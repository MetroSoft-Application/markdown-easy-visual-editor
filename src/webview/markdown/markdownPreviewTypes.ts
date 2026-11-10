/**
 * @fileoverview Markdown プレビューの描画スナップショットと描画 Worker 応答のデータ形状を定義する。
 * App と markdownPreviewSnapshot の両方が参照するため、実行時コードを持たない型だけを置き、循環 import を避ける。
 */
import type { Diagnostic, OutlineItem } from "../../shared/markdown";
import type { UnsafeMarkdownBlock } from "./markdownRendererCore";

/**
 * ある時点の Markdown 本文に対応するプレビュー描画結果（HTML、アウトライン、診断、統計）。
 */
export interface MarkdownPreviewSnapshot {
  /**
   * 解析・編集・変換の対象となるMarkdown本文。
   */
  markdown: string;

  /**
   * 表示または出力するHTML本文。
   */
  html: string;

  /**
   * 解析済みMarkdownから抽出した目次項目の一覧。
   */
  outline: OutlineItem[];

  /**
   * 本文検査とローカルリソース検査で得た診断一覧。
   */
  diagnostics: Diagnostic[];

  /**
   * Markdown本文、本文文字列、行数の集計結果。
   */
  stats: {
    /**
     * 集計対象Markdown本文の文字数。
     */
    markdown: number;
    /**
     * Markdown構文を除去した本文の文字数。
     */
    text: number;
    /**
     * Markdown本文の行数。
     */
    lines: number;
  };

  /**
   * 軽量Workerによる簡易描画の結果ならtrue。最終描画（rich Worker・フォールバック）ならfalse。
   * 初期値の空スナップショットでは未設定。起動計測で最終描画の反映時刻を判定するために使う。
   */
  preliminary?: boolean;
}

/**
 * Markdown 描画 Worker から Webview 本体へ返る応答のデータ形状。
 */
export interface MarkdownWorkerResponse {
  /**
   * Workerへ送った描画要求を対応付けるIDです。
   */
  id: number;

  /**
   * 軽量 Worker による簡易描画の応答なら true。後続のリッチ描画で置き換えられる。
   */
  preliminary?: boolean;

  /**
   * Markdown Workerが先行描画した本文。
   */
  markdown?: string;

  /**
   * サニタイズ前のMarkdownブロック。描画直前のサニタイズ入力に使う。
   */
  unsafeBlocks?: UnsafeMarkdownBlock[];

  /**
   * Markdown本文から抽出した目次項目の一覧。
   */
  outline?: OutlineItem[];

  /**
   * 本文検査とローカルリソース検査で得た診断一覧。
   */
  diagnostics?: Diagnostic[];

  /**
   * Markdown本文、構文を除いた本文、行数の集計値。
   */
  stats?: {
    /**
     * 集計対象Markdown本文の文字数。
     */
    markdown: number;
    /**
     * Markdown構文を除去した本文の文字数。
     */
    text: number;
    /**
     * Markdown本文の行数。
     */
    lines: number;
  };

  /**
   * 処理に失敗した理由または例外。
   */
  error?: string;
}

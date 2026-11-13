/**
 * @fileoverview Webview の永続状態（vscode.getState / setState）の形と、Host が HTML に埋め込んだ起動データの読み取りを定義する。
 * VS Code API は runtime/vscodeApi の共有インスタンスを使い、acquireVsCodeApi を二重に呼ばない不変条件を守る。
 */
import type { EditorMode, ViewMode, WebviewSettings } from "../../shared/protocol";
import type { EditorViewportAnchor } from "../editor/SourceEditor";
import type { PreviewViewportAnchor } from "../preview/scrollAnchors";
import { sharedVsCodeApi } from "./vscodeApi";
import type { VsCodeApi } from "../../shared/protocol";
import type { MarkdownRenderFormat } from "../markdown/markdownRendererCore";

/**
 * vscode.setState で保存し、Webview の再生成後に復元する表示状態。
 */
export interface PersistedState {
  /**
   * 編集面とプレビューの表示構成。
   */
  mode: EditorMode;

  /**
   * 本文ペインとプレビューペインの分割比率。
   */
  splitRatio?: number;

  /**
   * 目次ペインの表示幅。
   */
  outlineWidth?: number;

  /**
   * プレビューに適用する表示倍率。
   */
  zoom?: number;
  /**
   * 再読み込み後に復元する編集面とプレビューの表示状態。
   */
  viewMode?: ViewMode;

  /**
   * 分割表示で表示する本文面とプレビュー面の組み合わせ。
   */
  splitView?: "both" | "text" | "preview";

  /**
   * 編集面のスクロール復元に使う表示位置アンカー。
   */
  sourceViewport?: EditorViewportAnchor;

  /**
   * 分割表示プレビューのスクロール復元に使う表示位置アンカー。
   */
  splitPreviewViewport?: PreviewViewportAnchor;

  /**
   * プレビュー単独表示のスクロール復元に使う表示位置アンカー。
   */
  previewOnlyViewport?: PreviewViewportAnchor;

  /**
   * 変換タブで文書全体を別の記法へ書き換えた後の表示形式。
   * 拡張子から決まる既定の形式を上書きし、Webviewの再生成後も同じ文書（`uri`が一致）に限って復元する。
   * 別の文書を開いた場合は無視する。
   */
  renderFormatOverride?: {
    /** 上書きが有効な文書のURI。 */
    uri: string;
    /** 変換後に使う描画形式。 */
    format: MarkdownRenderFormat;
  };
}

/**
 * Hostとの通信とWebview状態の永続化に使うVS Code API。
 */
export const vscode = sharedVsCodeApi as VsCodeApi<PersistedState>;

/**
 * 拡張機能からWebview初期化時に渡される設定と文書状態です。
 */
export interface WebviewBootstrap {
  /**
   * 表示・解析・変換の対象となる本文。
   */
  text: string;

  /**
   * 起動時に受け取るホスト連携プロトコルのバージョンです。
   */
  version: number;

  /**
   * VS Codeまたはブラウザーが扱うリソースURI。
   */
  uri: string;

  /**
   * Host が起動時に埋め込んだ Webview 設定。
   */
  settings: WebviewSettings;
}

/**
 * 文書URIの拡張子からプレビュー形式を選び、未知の形式はMarkdownへ戻す。
 * @param uri - 初期化時のVS Code文書URIまたはリンク先のファイルパス。
 * @returns Textile専用、Markdown/Textile混在、またはMarkdown描画形式。
 */
export function getRenderFormatForUri(uri?: string): MarkdownRenderFormat {
  const path = (uri ?? "").split(/[?#]/, 1)[0].toLowerCase();
  if (/\.textile$/.test(path)) return "textile";
  if (/\.(?:md|markdown)$/.test(path)) return "mixed";
  return "markdown";
}

/**
 * 永続化状態から、指定した文書に対する表示形式の上書きを読む。
 * 保存値は旧版や破損で不正な形になり得るため、URIの一致と形式名を検証し、不正なら上書きなしとして扱う。
 * @param state - Webviewの永続化状態。未保存ならundefined。
 * @param uri - 現在の文書URI。
 * @returns 有効な上書き。該当しない、または不正ならundefined。
 */
export function readRenderFormatOverride(
  state: PersistedState | undefined,
  uri: string,
): PersistedState["renderFormatOverride"] {
  const override = state?.renderFormatOverride;
  if (!override || typeof override !== "object" || override.uri !== uri) return undefined;
  return override.format === "markdown" || override.format === "mixed" || override.format === "textile"
    ? { uri, format: override.format }
    : undefined;
}

/**
 * windowに埋め込まれた初期化データを読み、必須フィールドの有無を確認する。
 * @returns 有効なWebview初期化データ。埋め込み値がない、または必須フィールドが不足する場合はundefined。
 */
export function readWebviewBootstrap(): WebviewBootstrap | undefined {
  return (
    globalThis as typeof globalThis & {
      /**
       * HTMLから注入されるWebview初期化データ。
       */
      __mveBootstrap?: WebviewBootstrap;
    }
  ).__mveBootstrap;
}

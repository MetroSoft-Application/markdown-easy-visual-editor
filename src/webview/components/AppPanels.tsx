/**
 * @fileoverview Webview ルート（App）が表示する小さな補助パネル群（検索と置換、検査結果、セクションリンクのメニュー）。
 * 実行境界は Webview。いずれも状態を持たない表示部品で、状態の更新と Host への送信は親から渡された処理で行う。
 */
import React from "react";
import type { Messages } from "../../shared/messages";
import type { Diagnostic, DiagnosticSummary } from "../../shared/markdown";

/** 検索と置換パネルの入力。 */
interface SearchPanelProps {
  /** 表示文言。 */
  messages: Messages;
  /** 検索語入力欄の参照。開いたときのフォーカス移動に使う。 */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** 検索語。 */
  query: string;
  /** 置換後の文字列。 */
  replacement: string;
  /** 一致件数。 */
  hitCount: number;
  /** 現在の一致の0始まりの位置。 */
  hitIndex: number;
  /**
   * 検索語を変更する。一致位置は先頭へ戻す。
   * @param value - 新しい検索語。
   */
  onQueryChange: (value: string) => void;
  /**
   * 置換後の文字列を変更する。
   * @param value - 新しい置換文字列。
   */
  onReplacementChange: (value: string) => void;
  /**
   * 前後の一致へ移動する。
   * @param direction - 1なら次、-1なら前。
   */
  onJump: (direction: 1 | -1) => void;
  /**
   * 置換する。
   * @param all - すべて置換するならtrue。
   */
  onReplace: (all: boolean) => void;
  /** パネルを閉じる。 */
  onClose: () => void;
}

/**
 * 検索と置換のパネル。Enter で次、Shift+Enter で前の一致へ移動し、Escape で閉じる。
 * @param messages - 表示文言。
 * @param inputRef - 検索語入力欄の参照。開いたときのフォーカス移動に使う。
 * @param query - 検索語。空なら置換ボタンを無効にする。
 * @param replacement - 置換後の文字列。
 * @param hitCount - 一致件数。0なら前後移動ボタンを無効にする。
 * @param hitIndex - 現在の一致の0始まりの位置。
 * @param onQueryChange - 検索語の変更処理。
 * @param onReplacementChange - 置換文字列の変更処理。
 * @param onJump - 前後の一致へ移動する処理。
 * @param onReplace - 置換処理（引数がtrueならすべて置換）。
 * @param onClose - パネルを閉じる処理。Escapeキーでも呼ぶ。
 * @returns 検索と置換のパネル要素。
 */
export function SearchPanel({
  messages,
  inputRef,
  query,
  replacement,
  hitCount,
  hitIndex,
  onQueryChange,
  onReplacementChange,
  onJump,
  onReplace,
  onClose,
}: SearchPanelProps): React.JSX.Element {
  return (
    <section className="search-panel" aria-label={messages.app.searchAndReplace}>
      <input
        ref={inputRef}
        aria-label={messages.app.searchText}
        placeholder={messages.ribbon.search}
        value={query}
        onChange={
          /**
           * 検索語の入力を反映する。
           * @param event - 入力欄の変更イベント。
           */
          (event) => onQueryChange(event.target.value)
        }
        onKeyDown={
          /**
           * Escape で閉じ、Enter で前後の一致へ移動する。
           * @param event - キー入力イベント。
           */
          (event) => {
            if (event.key === "Escape") onClose();
            if (event.key === "Enter") onJump(event.shiftKey ? -1 : 1);
          }
        }
      />
      <input
        aria-label={messages.app.replacementText}
        placeholder={messages.app.replacement}
        value={replacement}
        onChange={
          /**
           * 置換文字列の入力を反映する。
           * @param event - 入力欄の変更イベント。
           */
          (event) => onReplacementChange(event.target.value)
        }
      />
      <span className="search-count">{hitCount ? `${hitIndex + 1}/${hitCount}` : "0/0"}</span>
      <button type="button" onClick={/** 前の一致へ移動する。 */ () => onJump(-1)} disabled={!hitCount} title={messages.app.previousMatch}>
        {messages.app.previousMatch}
      </button>
      <button type="button" onClick={/** 次の一致へ移動する。 */ () => onJump(1)} disabled={!hitCount} title={messages.app.nextMatch}>
        {messages.app.nextMatch}
      </button>
      <button type="button" onClick={/** 現在の一致を置換する。 */ () => onReplace(false)} disabled={!query}>
        {messages.app.replacement}
      </button>
      <button type="button" onClick={/** すべての一致を置換する。 */ () => onReplace(true)} disabled={!query}>
        {messages.app.replaceAll}
      </button>
      <button type="button" title={messages.app.close} aria-label={messages.app.close} onClick={onClose}>
        ×
      </button>
    </section>
  );
}

/**
 * 出力前チェックの結果パネル。行番号のある項目は、その行へ移動するボタンを表示する。
 * @param messages - 表示文言。
 * @param diagnostics - 表示する診断（並べ替え済み）。
 * @param summary - 重大度ごとの集計。
 * @param onGoToLine - 診断の行へ移動する処理。
 * @param onClose - パネルを閉じる処理。
 * @returns 検査結果パネルの要素。
 */
export function DiagnosticsPanel({
  messages,
  diagnostics,
  summary,
  onGoToLine,
  onClose,
}: {
  /** 表示文言。 */
  messages: Messages;
  /** 表示する診断（並べ替え済み）。 */
  diagnostics: readonly Diagnostic[];
  /** 重大度ごとの集計。 */
  summary: DiagnosticSummary;
  /**
   * 指定行へ移動する。
   * @param line - 1始まりの行番号。
   */
  onGoToLine: (line: number) => void;
  /** パネルを閉じる。 */
  onClose: () => void;
}): React.JSX.Element {
  return (
    <aside className="diagnostics-panel">
      <div className="panel-title">
        <h2>{messages.app.diagnosticsTitle}</h2>
        <button
          type="button"
          className="panel-close-button"
          title={messages.app.close}
          aria-label={messages.app.close}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p className="diagnostic-summary">
        {messages.app.severity.error} {summary.errors.length} /{" "}
        {messages.app.severity.warning}{" "}
        {summary.warnings.length} / {messages.app.severity.info}{" "}
        {summary.infos.length}
      </p>
      <p className="diagnostic-help">{messages.app.diagnosticHelp}</p>
      {diagnostics.length ? (
        diagnostics.map(
          /**
           * 診断1件を表示する。
           * @param item - 診断。
           * @param index - 一覧内の位置。同じコードの診断を区別する key に使う。
           * @returns 診断の要素。
           */
          (item, index) => (
            <div key={`${item.code}-${index}`} className={`diagnostic ${item.severity}`}>
              <strong>{messages.app.severity[item.severity]}</strong>
              {item.line ? (
                <button
                  type="button"
                  className="diagnostic-location"
                  onClick={/** 診断の行へ移動する。 */ () => onGoToLine(item.line as number)}
                >
                  {messages.app.line(item.line)}
                </button>
              ) : null}
              <span>{item.message}</span>
            </div>
          ))
      ) : (
        <p>{messages.app.noProblems}</p>
      )}
    </aside>
  );
}

/** セクションリンクのメニューを開いた見出しと表示位置。 */
export interface SectionLinkMenuState {
  /** 見出しアンカーID。 */
  id: string;
  /** 見出し本文。リンクのラベルに使う。 */
  text: string;
  /** メニューの表示位置（ビューポート座標）。 */
  x: number;
  /** メニューの表示位置（ビューポート座標）。 */
  y: number;
}

/**
 * 見出しのセクションリンクをコピーするコンテキストメニュー。
 * @param messages - 表示文言。
 * @param menu - 対象の見出しと表示位置。
 * @param menuRef - メニュー要素の参照。外側クリックで閉じる判定に使う。
 * @param onCopy - リンクをコピーしてメニューを閉じる処理。
 * @returns メニューの要素。
 */
export function SectionLinkMenu({
  messages,
  menu,
  menuRef,
  onCopy,
}: {
  /** 表示文言。 */
  messages: Messages;
  /** 対象の見出しと表示位置。 */
  menu: SectionLinkMenuState;
  /** メニュー要素の参照。外側クリックでの close 判定に使う。 */
  menuRef: React.RefObject<HTMLDivElement | null>;
  /**
   * リンクをコピーしてメニューを閉じる。
   * @param scope - document なら同じ文書内のリンク、workspace ならワークスペース基準のリンク。
   */
  onCopy: (scope: "document" | "workspace") => void;
}): React.JSX.Element {
  return (
    <div
      ref={menuRef}
      className="section-link-context-menu"
      role="menu"
      aria-label={messages.app.sectionLinkMenu}
      style={{ left: menu.x, top: menu.y }}
    >
      <button type="button" role="menuitem" onClick={/** 同じ文書内のリンクをコピーする。 */ () => onCopy("document")}>
        {messages.app.copySectionLink}
      </button>
      <button type="button" role="menuitem" onClick={/** ワークスペース基準のリンクをコピーする。 */ () => onCopy("workspace")}>
        {messages.app.copyWorkspaceSectionLink}
      </button>
    </div>
  );
}

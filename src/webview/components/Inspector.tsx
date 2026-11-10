/**
 * @fileoverview Webview のプレビューで選択した画像・図・数式の参照元と属性を表示する Inspector コンポーネント。
 * 実行境界は Webview。編集結果は親から渡されたコールバック経由で Markdown 本文へ反映され、このファイル自身は Host と通信しない。
 */
import { RenderedMarkdown, type InspectorTarget } from "./RenderedMarkdown";
import type { WebviewSettings } from "../../shared/protocol";
import type { Messages } from "../../shared/messages";
import React, { useEffect, useState } from "react";

/**
 * 選択した画像・図・数式の参照元を確認し、編集可能な属性を更新するパネル。
 * @param target 詳細を表示するプレビュー要素とその参照元。
 * @param settings 画像表示に使うWebview設定。
 * @param messages ラベルと操作案内を表示するローカライズ辞書。
 * @param onChange 変更した参照元や画像altを親の文書状態へ反映する処理。
 * @param onClose パネルを閉じる処理。
 * @param onOpenResource 画像の参照先をエディターで開く処理。
 * @returns 対象種別に応じたプレビュー要素または参照元編集欄を含むパネル。
 */
export function Inspector({
  target,
  settings,
  messages,
  onChange,
  onClose,
  onOpenResource,
}: {
  /** 詳細を表示する画像・図・数式と、Markdown上の参照元。 */
  target: InspectorTarget;

  /**
   * Inspector 内のプレビュー描画（リモート画像の許可、言語など）に使う現在の Webview 設定。
   */
  settings: WebviewSettings;

  /**
   * Webview用の型付きローカライズ済みメッセージカタログ。
   */
  messages: Messages;
  /** Inspectorで編集した参照元と画像altを親の状態へ反映する。
   * @param source - Inspectorで編集している画像・数式・図の参照元文字列。
   * @param alt - Inspectorで編集している画像の代替テキスト。画像以外では省略する。
   */
  onChange: (source: string, alt?: string) => void;
  /** Inspectorを閉じるよう親へ通知する。 */
  onClose: () => void;
  /**
   * Inspectorで選択したローカルリソースをエディターで開くよう親へ通知する。
   * @param href - Inspectorから開くMarkdownリソースのhref文字列。
   */
  onOpenResource: (href: string) => void;
}): React.JSX.Element {
  const [source, setSource] = useState(target.source);
  const [alt, setAlt] = useState(target.type === "image" ? target.alt : "");
  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     */
    () => {
      setSource(target.source);
      if (target.type === "image") setAlt(target.alt);
    },
    [target],
  );
  return (
    <aside className="inspector-panel">
      <div className="panel-title">
        <h2>
          {target.type === "mermaid"
            ? messages.app.inspector.mermaid
            : target.type === "math"
              ? messages.app.inspector.math
              : messages.app.inspector.image}
        </h2>
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
      {target.type === "image" ? (
        <>
          <img src={source} alt={alt} />
          <label>
            {messages.app.inspector.alt}
            <input
              value={alt}
              onChange={
                /**
                 * change操作を表示または編集状態へ反映する。
                 * @param event - 画像altテキスト入力の更新を処理するchange event。
                 */
                (event) => setAlt(event.target.value)
              }
            />
          </label>
          <label>
            {messages.app.inspector.reference}
            <input value={source} readOnly />
          </label>
          <button
            onClick={
              /**
               * click操作を表示または編集状態へ反映する。
               */
              () => onOpenResource(source)
            }
          >
            {messages.app.inspector.openFile}
          </button>
          <button
            className="primary"
            onClick={
              /**
               * click操作を表示または編集状態へ反映する。
               */
              () => onChange(source, alt)
            }
          >
            {messages.app.inspector.apply}
          </button>
        </>
      ) : (
        <>
          <textarea
            value={source}
            spellCheck={false}
            onChange={
              /**
               * change操作を表示または編集状態へ反映する。
               * @param event - Inspectorの画像Markdown本文入力を処理するchange event。
               */
              (event) => setSource(event.target.value)
            }
          />
          <div className="inspector-preview">
            <RenderedMarkdown
              markdown={
                target.type === "mermaid"
                  ? `\`\`\`mermaid\n${source}\n\`\`\``
                  : `$$\n${source}\n$$`
              }
              settings={settings}
            />
          </div>
          <button
            className="primary"
            onClick={
              /**
               * click操作を表示または編集状態へ反映する。
               */
              () => onChange(source)
            }
          >
            {messages.app.inspector.apply}
          </button>
        </>
      )}
    </aside>
  );
}

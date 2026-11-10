/**
 * @fileoverview リンク挿入ダイアログの React コンポーネント。
 * 入力中の URL とリンク文字列を親へ反映し、確定・キャンセル時のフォーカス復帰は親が担当する。
 */
import type { Messages } from "../../shared/messages";
import React from "react";

/**
 * 入力中のURLとリンク文字列を親へ反映し、確定またはキャンセル時に閉じるモーダル。
 * @param href 編集中のリンクURL。
 * @param label 編集中のリンク文字列。
 * @param messages ラベルと検証案内を表示するローカライズ辞書。
 * @param onHrefChange 入力URLを親状態へ反映する処理。
 * @param onLabelChange 入力文字列を親状態へ反映する処理。
 * @param onApply 入力値からリンクを文書へ挿入する処理。
 * @param onClose ダイアログを閉じる処理。
 * @returns リンク作成フォームと閉じる操作を備えたダイアログ。
 */
export function LinkDialog({
  href,
  label,
  messages,
  onHrefChange,
  onLabelChange,
  onApply,
  onClose,
}: {
  /**
   * リンク操作領域の遷移先URI。
   */
  href: string;

  /**
   * 画面または検証結果に表示する説明文。
   */
  label: string;

  /**
   * Webview用の型付きローカライズ済みメッセージカタログ。
   */
  messages: Messages;
  /**
   * リンク先 URL 入力欄の変更を親へ通知する。
   * @param value - リンク先URLの新しい入力値。
   * @returns 親コンポーネントへ新しいリンク先を通知する。
   */
  onHrefChange: (value: string) => void;
  /**
   * リンク表示テキスト入力欄の変更を親へ通知する。
   * @param value - リンク表示テキストの新しい入力値。
   * @returns 親コンポーネントへ新しいリンク表示テキストを通知する。
   */
  onLabelChange: (value: string) => void;
  /**
   * 適用操作後に設定ダイアログを閉じるコールバック。
   */
  onApply: () => void;
  /**
   * 閉じる操作を処理するコールバック。
   */
  onClose: () => void;
}): React.JSX.Element {
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="link-dialog-title"
    >
      <form
        className="help-dialog link-dialog"
        onSubmit={
          /**
           * @param event - リンク設定を確定するform submit event。
           */
          (event) => {
            event.preventDefault();
            onApply();
          }
        }
      >
        <div className="panel-title">
          <h2 id="link-dialog-title">{messages.app.link.title}</h2>
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
        <label>
          {messages.app.link.url}
          <input
            autoFocus
            type="url"
            value={href}
            onChange={
              /**
               * リンク先の編集値を親へ通知する。
               * @param event - リンク先URL入力の更新を処理するchange event。
               */
              (event) => onHrefChange(event.target.value)
            }
            placeholder={messages.app.link.urlPlaceholder}
          />
        </label>
        <label>
          {messages.app.link.text} {messages.app.link.textHint}
          <input
            value={label}
            onChange={
              /**
               * リンクラベルの編集値を親へ通知する。
               * @param event - リンク表示文字列入力の更新を処理するchange event。
               */
              (event) => onLabelChange(event.target.value)
            }
          />
        </label>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            {messages.app.link.cancel}
          </button>
          <button className="primary" type="submit">
            {messages.app.link.insert}
          </button>
        </div>
      </form>
    </div>
  );
}

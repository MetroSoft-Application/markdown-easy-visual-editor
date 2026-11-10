/**
 * @fileoverview キーボードショートカットと機能概要を表示するヘルプダイアログの React コンポーネント。
 * 表示文言はローカライズ済みメッセージから受け取り、閉じる操作は親へ通知する。
 */
import type { Messages } from "../../shared/messages";
import React from "react";

/**
 * ヘルプダイアログで表示する説明の種類。shortcuts はキーボード操作一覧、features は機能概要。
 */
export type HelpTopic = "shortcuts" | "features";

/**
 * キーボード操作または機能説明を表示し、閉じる操作を呼び出し元へ通知するモーダル。
 * @param topic 表示する説明の種類。
 * @param messages ラベル・ショートカット・機能説明を表示するローカライズ辞書。
 * @param onClose ダイアログを閉じる処理。
 * @returns 選択された話題の説明と閉じる操作を含むダイアログ。
 */
export function HelpDialog({
  topic,
  messages,
  onClose,
}: {
  /** 表示するヘルプ区分。 */
  topic: HelpTopic;

  /**
   * Webview用の型付きローカライズ済みメッセージカタログ。
   */
  messages: Messages;
  /** ヘルプダイアログを閉じるよう親へ通知する。 */
  onClose: () => void;
}): React.JSX.Element {
  const title =
    topic === "shortcuts"
      ? messages.app.help.shortcuts
      : messages.ribbon.labels.features;
  const featureSections = [
    {
      title: messages.ribbon.tabs.home,
      items: [
        [messages.ribbon.labels.undo, messages.ribbon.featureDescriptions.undo],
        [messages.ribbon.labels.redo, messages.ribbon.featureDescriptions.redo],
        [messages.ribbon.labels.bold, messages.ribbon.featureDescriptions.bold],
        [
          messages.ribbon.labels.italic,
          messages.ribbon.featureDescriptions.italic,
        ],
        [
          messages.ribbon.labels.clearInline,
          messages.ribbon.featureDescriptions.clearInline,
        ],
        [
          messages.ribbon.labels.clearBlock,
          messages.ribbon.featureDescriptions.clearBlock,
        ],
      ],
    },
    {
      title: messages.ribbon.tabs.insert,
      items: [
        [messages.ribbon.labels.link, messages.ribbon.featureDescriptions.link],
        [
          messages.ribbon.labels.image,
          messages.ribbon.featureDescriptions.image,
        ],
        [
          messages.ribbon.labels.insertTable,
          messages.ribbon.featureDescriptions.insertTable,
        ],
        [
          messages.ribbon.labels.codeBlock,
          messages.ribbon.featureDescriptions.codeBlock,
        ],
        [messages.ribbon.labels.math, messages.ribbon.featureDescriptions.math],
        [
          messages.ribbon.labels.footnote,
          messages.ribbon.featureDescriptions.footnote,
        ],
        [messages.ribbon.labels.toc, messages.ribbon.featureDescriptions.toc],
      ],
    },
    {
      title: messages.ribbon.tabs.table,
      items: [
        [
          messages.app.tableEditor.title,
          messages.ribbon.featureDescriptions.tableEditor,
        ],
        [
          messages.app.tableEditor.resizeColumn,
          messages.ribbon.featureDescriptions.tableEditorColumnResize,
        ],
        [
          messages.app.tableEditor.resizeRow,
          messages.ribbon.featureDescriptions.tableEditorRowResize,
        ],
        [
          messages.app.tableEditor.resizeEditor,
          messages.ribbon.featureDescriptions.tableEditorLayout,
        ],
        [
          messages.ribbon.labels.addBefore,
          messages.ribbon.featureDescriptions.addBefore,
        ],
        [
          messages.ribbon.labels.deleteRow,
          messages.ribbon.featureDescriptions.deleteRow,
        ],
        [
          messages.ribbon.labels.deleteColumn,
          messages.ribbon.featureDescriptions.deleteColumn,
        ],
        [
          messages.ribbon.labels.alignLeft,
          messages.ribbon.featureDescriptions.alignLeft,
        ],
        [
          messages.ribbon.labels.alignCenter,
          messages.ribbon.featureDescriptions.alignCenter,
        ],
        [
          messages.ribbon.labels.alignRight,
          messages.ribbon.featureDescriptions.alignRight,
        ],
        [
          messages.ribbon.labels.copyTsv,
          messages.ribbon.featureDescriptions.copyTsv,
        ],
      ],
    },
    {
      title: messages.ribbon.tabs.view,
      items: [
        [messages.ribbon.outline, messages.ribbon.featureDescriptions.outline],
        [messages.ribbon.search, messages.ribbon.featureDescriptions.search],
        [messages.ribbon.split, messages.ribbon.featureDescriptions.split],
        [
          messages.ribbon.textOnly,
          messages.ribbon.featureDescriptions.textOnly,
        ],
        [
          messages.ribbon.previewOnly,
          messages.ribbon.featureDescriptions.previewOnly,
        ],
      ],
    },
    {
      title: messages.ribbon.tabs.export,
      items: [
        [
          messages.ribbon.labels.printPreview,
          messages.ribbon.featureDescriptions.printPreview,
        ],
        [
          messages.ribbon.labels.exportPdf,
          messages.ribbon.featureDescriptions.exportPdf,
        ],
        [
          messages.ribbon.labels.preflight,
          messages.ribbon.featureDescriptions.preflight,
        ],
      ],
    },
  ];
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-dialog-title"
    >
      <section className="help-dialog">
        <div className="panel-title">
          <h2 id="help-dialog-title">{title}</h2>
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
        {topic === "shortcuts" && (
          <table>
            <tbody>
              <tr>
                <th>Ctrl+V</th>
                <td>{messages.app.help.shortcutImage}</td>
              </tr>
              <tr>
                <th>Alt+Enter</th>
                <td>{messages.app.help.shortcutTableBreak}</td>
              </tr>
            </tbody>
          </table>
        )}
        {topic === "features" && (
          <div className="feature-list">
            {featureSections.map(
              /**
               * 各機能カテゴリの見出しと説明を表示する。
               * @param section - 機能セクションの見出しと項目一覧。
               * @returns 見出しと機能一覧を表示するReact要素。
               */
              (section) => (
                <section key={section.title}>
                  <h3>{section.title}</h3>
                  <ul>
                    {section.items.map(
                      /**
                       * section.itemsの各要素を変換して一覧化する。
                       * @param label - 機能項目の表示名。
                       * @param description - 機能項目の説明文。
                       * @returns 表示名と説明文を含むリスト項目。
                       */
                      ([label, description]) => (
                        <li key={label}>
                          <strong>{label}</strong>
                          <span>{description}</span>
                        </li>
                      ),
                    )}
                  </ul>
                </section>
              ),
            )}
          </div>
        )}
      </section>
    </div>
  );
}

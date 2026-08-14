import React, { useState } from 'react';
import type { EditorMode, HtmlExportOptions } from '../shared/protocol';
import type { MarkdownTableAction } from '../shared/markdown';
import type { Messages } from '../shared/messages';
import { mveDebug } from './debug';
import type { SourceAction } from './SourceEditor';

export type TableAction = 'insert' | MarkdownTableAction;

export type RibbonTab = 'home' | 'insert' | 'table' | 'view' | 'export' | 'help';

export type RibbonCommand =
  | { type: 'sourceAction'; action: SourceAction }
  | { type: 'historyCommand'; command: 'undo' | 'redo' }
  | { type: 'heading'; level: number }
  | { type: 'insert'; value: string }
  | { type: 'link' }
  | { type: 'image' }
  | { type: 'copyTableTsv' }
  | { type: 'table'; action: TableAction; headerName?: string }
  | { type: 'tableInsert'; rows: number; columns: number }
  | { type: 'codeBlock'; language: string }
  | { type: 'splitView'; view: 'both' | 'text' | 'preview' }
  | { type: 'toggleOutline' | 'toggleInspector' | 'togglePrintPreview' }
  | { type: 'runPreflightCheck' }
  | { type: 'showShortcuts' | 'showFeatures' }
  | { type: 'openSource' | 'exportPdf' | 'find' }
  | { type: 'exportHtml'; options: HtmlExportOptions };

interface Props {
  messages: Messages;
  mode: EditorMode;
  readOnly: boolean;
  activeMarks: Record<string, boolean>;
  outlineVisible: boolean;
  splitView: 'both' | 'text' | 'preview';
  onCommand: (command: RibbonCommand) => void;
}

/**
 * Markdown操作をタブとツールボタンで表示し、選択された操作を親へ通知する。
 * @param props リボンの表示状態と親へ操作を通知するコールバック。
 * @returns Markdown操作用のリボンUI。
 */
export function Ribbon({ messages, mode, readOnly, activeMarks, outlineVisible, splitView, onCommand }: Props): React.JSX.Element {
  // リボンの表示状態を管理し、選択中タブの各操作を親へコマンドとして通知する。
  const [tab, setTab] = useState<RibbonTab>('home');
  const [collapsed, setCollapsed] = useState(false);
  const [pinned, setPinned] = useState(true);
  const [tableRows, setTableRows] = useState(3);
  const [tableColumns, setTableColumns] = useState(3);
  const [codeLanguage, setCodeLanguage] = useState('');
  const [emoji, setEmoji] = useState(DOCUMENT_EMOJIS[0]);
  const [headerName, setHeaderName] = useState('');
  const [htmlOptions, setHtmlOptions] = useState<HtmlExportOptions>({ embedImages: false, convertLinkedMarkdown: false, saveWithoutDialog: true });

  return (
    <header
      className={`ribbon ${collapsed ? 'collapsed' : ''} ${pinned ? 'pinned' : ''}`}
      onMouseLeave={() => { if (!pinned) setCollapsed(true); }}
      onClickCapture={(event) => {
        const target = event.target instanceof Element ? event.target.closest('button') : null;
        if (!target) return;
        mveDebug('ribbon.dom-click', {
          text: target.textContent?.trim(),
          title: target.getAttribute('title'),
          detail: event.detail,
          className: target.className
        });
      }}
    >
      <div className="ribbon-tabs" role="tablist" aria-label={messages.ribbon.label}>
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'active' : ''}
            onClick={() => {
              setTab(id);
              setCollapsed(false);
            }}
          >
            {messages.ribbon.tabs[id]}
          </button>
        ))}
        <span className="ribbon-spacer" />
        <button type="button" className="ribbon-source-button" title={messages.ribbon.search} onClick={() => onCommand({ type: 'find' })}>{messages.ribbon.search}</button>
        <button type="button" className={`ribbon-source-button ${mode === 'split' && splitView === 'both' ? 'active' : ''}`} onClick={() => onCommand({ type: 'splitView', view: 'both' })}>{messages.ribbon.split}</button>
        <button type="button" className={`ribbon-source-button ${mode === 'split' && splitView === 'text' ? 'active' : ''}`} onClick={() => onCommand({ type: 'splitView', view: 'text' })}>{messages.ribbon.textOnly}</button>
        <button type="button" className={`ribbon-source-button ${mode === 'split' && splitView === 'preview' ? 'active' : ''}`} onClick={() => onCommand({ type: 'splitView', view: 'preview' })}>{messages.ribbon.previewOnly}</button>
        <button type="button" title={pinned ? messages.ribbon.unpin : messages.ribbon.pin} className={pinned ? 'active' : ''} onClick={() => setPinned(!pinned)}>
          {messages.ribbon.pin}
        </button>
        <button type="button" title={collapsed ? messages.ribbon.expand : messages.ribbon.collapse} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? messages.ribbon.expand : messages.ribbon.collapse}
        </button>
      </div>
      {!collapsed && (
        <div className="ribbon-content" role="tabpanel">
          {tab === 'home' && (
            <>
              <Group label={messages.ribbon.groups.history}>
                <Tool label={messages.ribbon.labels.undo} shortcut="Ctrl+Z" onClick={() => onCommand({ type: 'historyCommand', command: 'undo' })} />
                <Tool label={messages.ribbon.labels.redo} shortcut="Ctrl+Y" onClick={() => onCommand({ type: 'historyCommand', command: 'redo' })} />
              </Group>
              <Group label={messages.ribbon.groups.paragraph}>
                <label className="ribbon-select-label">
                  {messages.ribbon.labels.style}
                  <select disabled={readOnly} defaultValue="0" onChange={(event) => onCommand({ type: 'heading', level: Number(event.target.value) })}>
                    <option value="0">{messages.ribbon.labels.body}</option>
                    {[1, 2, 3, 4, 5, 6].map((level) => (
                      <option key={level} value={level}>{messages.ribbon.labels.heading(level)}</option>
                    ))}
                  </select>
                </label>
                <Tool label={messages.ribbon.labels.quote} disabled={readOnly} onClick={() => source('quote')} />
                <Tool label={messages.ribbon.labels.bulletList} disabled={readOnly} onClick={() => source('bulletList')} />
                <Tool label={messages.ribbon.labels.orderedList} disabled={readOnly} onClick={() => source('orderedList')} />
                <Tool label={messages.ribbon.labels.taskList} disabled={readOnly} onClick={() => source('taskList')} />
                <Tool label={messages.ribbon.labels.indent} disabled={readOnly} onClick={() => source('indent')} />
                <Tool label={messages.ribbon.labels.outdent} disabled={readOnly} onClick={() => source('outdent')} />
              </Group>
              <Group label={messages.ribbon.groups.textFormat}>
                <Tool label={messages.ribbon.labels.bold} active={activeMarks.bold} disabled={readOnly} onClick={() => source('bold')} />
                <Tool label={messages.ribbon.labels.italic} active={activeMarks.italic} disabled={readOnly} onClick={() => source('italic')} />
                <Tool label={messages.ribbon.labels.strike} active={activeMarks.strike} disabled={readOnly} onClick={() => source('strike')} />
                <Tool label={messages.ribbon.labels.underline} active={activeMarks.underline} disabled={readOnly} onClick={() => source('underline')} />
                <Tool label={messages.ribbon.labels.highlight} active={activeMarks.highlight} disabled={readOnly} onClick={() => source('highlight')} />
                <Tool label={messages.ribbon.labels.code} active={activeMarks.inlineCode} disabled={readOnly} onClick={() => source('inlineCode')} />
                <Tool label={messages.ribbon.labels.superscript} disabled={readOnly} onClick={() => source('sup')} />
                <Tool label={messages.ribbon.labels.subscript} disabled={readOnly} onClick={() => source('sub')} />
              </Group>
              <Group label={messages.ribbon.groups.clear}>
                <Tool label={messages.ribbon.labels.clearInline} disabled={readOnly} onClick={() => source('clearInline')} />
                <Tool label={messages.ribbon.labels.clearBlock} disabled={readOnly} onClick={() => source('clearBlock')} />
              </Group>
            </>
          )}
          {tab === 'insert' && (
            <>
              <Group label={messages.ribbon.groups.basic}>
                <Tool label={messages.ribbon.labels.link} disabled={readOnly} onClick={() => onCommand({ type: 'link' })} />
                <Tool label={messages.ribbon.labels.image} shortcut="Ctrl+V" disabled={readOnly} onClick={() => onCommand({ type: 'image' })} />
                <div className="ribbon-form" aria-label={messages.ribbon.labels.tableSize}>
                  <label>{messages.ribbon.labels.rows}<input type="number" min={2} max={50} disabled={readOnly} value={tableRows} onChange={(event) => setTableRows(clampNumber(event.target.value, 2, 50))} /></label>
                  <label>{messages.ribbon.labels.columns}<input type="number" min={1} max={20} disabled={readOnly} value={tableColumns} onChange={(event) => setTableColumns(clampNumber(event.target.value, 1, 20))} /></label>
                  <Tool label={messages.ribbon.labels.insertTable} disabled={readOnly} onClick={() => onCommand({ type: 'tableInsert', rows: tableRows, columns: tableColumns })} />
                </div>
                <Tool label={messages.ribbon.labels.horizontalRule} disabled={readOnly} onClick={() => source('horizontalRule')} />
                <Tool label={messages.ribbon.labels.hardBreak} disabled={readOnly} onClick={() => source('hardBreak')} />
              </Group>
              <Group label={messages.ribbon.groups.block}>
                <label className="ribbon-select-label">{messages.ribbon.labels.language}<select value={codeLanguage} disabled={readOnly} onChange={(event) => setCodeLanguage(event.target.value)}>
                  {messages.ribbon.codeLanguages.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}
                </select></label>
                <Tool label={messages.ribbon.labels.codeBlock} disabled={readOnly} onClick={() => onCommand({ type: 'codeBlock', language: codeLanguage })} />
                <Tool label={messages.app.inspector.mermaid} disabled={readOnly} onClick={() => insert(messages.ribbon.snippets.mermaid)} />
                <Tool label={messages.ribbon.labels.math} disabled={readOnly} onClick={() => insert('\n$$\nE = mc^2\n$$\n')} />
                <Tool label={messages.ribbon.labels.footnote} disabled={readOnly} onClick={() => insert(messages.ribbon.snippets.footnote)} />
                <Tool label={messages.ribbon.labels.toc} disabled={readOnly} onClick={() => insert('\n[toc]\n')} />
                <Tool label={messages.ribbon.labels.pageBreak} disabled={readOnly} onClick={() => insert('\n<!-- pagebreak -->\n')} />
              </Group>
              <Group label={messages.ribbon.groups.assist}>
                <Tool label={messages.renderer.alerts.note} disabled={readOnly} onClick={() => insert(messages.ribbon.snippets.note)} />
                <Tool label={messages.renderer.alerts.warning} disabled={readOnly} onClick={() => insert(messages.ribbon.snippets.warning)} />
                <label className="ribbon-select-label">{messages.ribbon.labels.emoji}<select value={emoji} disabled={readOnly} onChange={(event) => setEmoji(event.target.value)}>
                  {DOCUMENT_EMOJIS.map((value) => <option key={value} value={value}>{value}</option>)}
                </select></label>
                <Tool label={messages.ribbon.labels.insertEmoji} disabled={readOnly} onClick={() => insert(emoji)} />
              </Group>
            </>
          )}
          {tab === 'table' && (
            <>
              <Group label={messages.ribbon.groups.rows}>
                <Tool label={messages.ribbon.labels.addBefore} disabled={readOnly} onClick={() => tableCommand('rowBefore')} />
                <Tool label={messages.ribbon.labels.addAfter} disabled={readOnly} onClick={() => tableCommand('rowAfter')} />
                <Tool label={messages.ribbon.labels.deleteRow} disabled={readOnly} onClick={() => tableCommand('deleteRow')} />
                <Tool label={messages.ribbon.labels.toggleHeader} disabled={readOnly} onClick={() => tableCommand('header')} />
              </Group>
              <Group label={messages.ribbon.groups.columns}>
                <Tool label={messages.ribbon.labels.addLeft} disabled={readOnly} onClick={() => tableCommand('colBefore')} />
                <Tool label={messages.ribbon.labels.addRight} disabled={readOnly} onClick={() => tableCommand('colAfter')} />
                <Tool label={messages.ribbon.labels.deleteColumn} disabled={readOnly} onClick={() => tableCommand('deleteColumn')} />
                <label className="ribbon-select-label">{messages.ribbon.labels.header}<input disabled={readOnly} value={headerName} placeholder={messages.ribbon.labels.headerPlaceholder} onChange={(event) => setHeaderName(event.target.value)} /></label>
              </Group>
              <Group label={messages.ribbon.groups.alignment}>
                <Tool label={messages.ribbon.labels.alignLeft} disabled={readOnly} onClick={() => tableCommand('alignLeft')} />
                <Tool label={messages.ribbon.labels.alignCenter} disabled={readOnly} onClick={() => tableCommand('alignCenter')} />
                <Tool label={messages.ribbon.labels.alignRight} disabled={readOnly} onClick={() => tableCommand('alignRight')} />
                <Tool label={messages.ribbon.labels.alignColumns} disabled={readOnly} onClick={() => tableCommand('alignColumns')} />
                <Tool label={messages.ribbon.labels.cellBreak} shortcut="Alt+Enter" disabled={readOnly} onClick={() => source('cellBreak')} />
              </Group>
              <Group label={messages.ribbon.groups.excel}>
                <Tool label={messages.ribbon.labels.copyTsv} disabled={mode === 'preview' || (mode === 'split' && splitView === 'preview')} onClick={() => onCommand({ type: 'copyTableTsv' })} />
              </Group>
            </>
          )}
          {tab === 'view' && (
            <>
              <Group label={messages.ribbon.groups.pane}>
                <Tool
                  label={messages.ribbon.source}
                  title={messages.ribbon.sourceTitle}
                  onClick={() => onCommand({ type: 'openSource' })}
                />
                <Tool
                  label={messages.ribbon.outline}
                  active={outlineVisible}
                  title={messages.ribbon.outlineTitle}
                  onClick={() => onCommand({ type: 'toggleOutline' })}
                />
                <span className="ribbon-hint">{messages.ribbon.hintZoom}</span>
              </Group>
            </>
          )}
          {tab === 'export' && (
            <>
              <Group label={messages.ribbon.groups.pdf}>
                <Tool label={messages.ribbon.labels.printPreview} onClick={() => onCommand({ type: 'togglePrintPreview' })} />
                <Tool label={messages.ribbon.labels.exportPdf} onClick={() => onCommand({ type: 'exportPdf' })} />
              </Group>
              <Group label={messages.ribbon.groups.html}>
                <label className="ribbon-checkbox">
                  <input
                    type="checkbox"
                    checked={htmlOptions.embedImages}
                    onChange={(event) => setHtmlOptions({ ...htmlOptions, embedImages: event.target.checked })}
                  />
                  <span>{messages.ribbon.labels.embedImages}</span>
                </label>
                <label className="ribbon-checkbox">
                  <input
                    type="checkbox"
                    checked={htmlOptions.convertLinkedMarkdown}
                    onChange={(event) => setHtmlOptions({ ...htmlOptions, convertLinkedMarkdown: event.target.checked })}
                  />
                  <span>{messages.ribbon.labels.convertLinkedMarkdown}</span>
                </label>
                <label className="ribbon-checkbox">
                  <input
                    type="checkbox"
                    checked={htmlOptions.saveWithoutDialog}
                    onChange={(event) => setHtmlOptions({ ...htmlOptions, saveWithoutDialog: event.target.checked })}
                  />
                  <span>{messages.ribbon.labels.saveWithoutDialog}</span>
                </label>
                <Tool label={messages.ribbon.labels.exportHtml} onClick={() => onCommand({ type: 'exportHtml', options: htmlOptions })} />
              </Group>
              <Group label={messages.ribbon.groups.inspection}>
                <Tool label={messages.ribbon.labels.preflight} onClick={() => onCommand({ type: 'runPreflightCheck' })} />
              </Group>
            </>
          )}
          {tab === 'help' && (
            <>
              <Group label={messages.ribbon.groups.help}>
                <Tool label={messages.ribbon.labels.shortcuts} onClick={() => onCommand({ type: 'showShortcuts' })} />
                <Tool label={messages.ribbon.labels.features} onClick={() => onCommand({ type: 'showFeatures' })} />
              </Group>
            </>
          )}
        </div>
      )}
    </header>
  );

  /**
   * SourceEditorへ渡す編集操作をRibbonCommandへ変換する。
   * @param action 実行するソース編集操作。
   * @returns 何も返さない。
   */
  function source(action: SourceAction): void {
    // ソース編集操作を親コンポーネントへ渡す。
    onCommand({ type: 'sourceAction', action });
  }
  /**
   * 指定文字列の挿入操作をRibbonCommandへ変換する。
   * @param value 挿入するMarkdown文字列。
   * @returns 何も返さない。
   */
  function insert(value: string): void {
    // 指定文字列の挿入操作を親コンポーネントへ渡す。
    onCommand({ type: 'insert', value });
  }
  /**
   * 表操作と列追加時の見出し名をRibbonCommandへ変換する。
   * @param action 実行する表操作。
   * @returns 何も返さない。
   */
  function tableCommand(action: TableAction): void {
    // 表操作と列追加時の見出し名を親コンポーネントへ渡す。
    onCommand({ type: 'table', action, headerName: action === 'colBefore' || action === 'colAfter' ? headerName : undefined });
  }
}

/**
 * 複数のリボン操作を1つのラベル付きグループとして描画する。
 * @param props グループラベルと子操作。
 * @returns リボン操作グループ。
 */
function Group({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  // リボン内の操作群をラベル付きのセクションとしてまとめる。
  return (
    <section className="ribbon-group">
      <div className="ribbon-controls">{children}</div>
      <span className="ribbon-group-label">{label}</span>
    </section>
  );
}

/**
 * 状態・無効状態・ショートカットを表示できる共通ツールボタンを描画する。
 * @param props ボタン表示文字列、状態、クリック処理。
 * @returns リボンツールボタン。
 */
function Tool({
  label,
  shortcut,
  active = false,
  disabled = false,
  title,
  onClick
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}): React.JSX.Element {
  // ラベル・ショートカット・状態を持つ共通のリボンボタンを描画する。
  return (
    <button
      type="button"
      className={`ribbon-tool ${active ? 'active' : ''}`}
      aria-pressed={active}
      disabled={disabled}
      title={title ?? (shortcut ? `${label} (${shortcut})` : label)}
      onClick={onClick}
    >
      <span>{label}</span>
      {shortcut && <small>{shortcut}</small>}
    </button>
  );
}

const TABS: RibbonTab[] = [
  'home',
  'insert',
  'table',
  'view',
  'export',
  'help'
];

// 文書の構造・参照・状態を示す用途に絞った絵文字一覧。
const DOCUMENT_EMOJIS = [
  '📘', '📚', '📖', '📝', '✏️', '📌', '🔖', '🔍',
  '🧭', '💡', 'ℹ️', '✅', '⚠️', '❌', '⛔', '🔧',
  '⚙️', '📋', '🔗', '🖼️', '📊', '📈', '📐', '🧪'
];

/**
 * 文字列入力を整数へ変換し、指定された範囲に収める。
 * @param value 数値化する入力文字列。
 * @param minimum 許可する最小値。
 * @param maximum 許可する最大値。
 * @returns 範囲内に収めた整数。数値化できない場合はminimum。
 */
function clampNumber(value: string, minimum: number, maximum: number): number {
  // 入力値を整数へ変換し、指定された最小値と最大値の範囲へ収める。
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed))) : minimum;
}

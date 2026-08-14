import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown as markdownLanguage } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Annotation, EditorSelection, EditorState, StateEffect, StateField, type Extension, type Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, keymap, lineNumbers, placeholder as placeholderExtension, ViewPlugin } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import {
  clearBlockFormatting,
  clearInlineFormatting,
  indentSelectedLines,
  mapLineSelection,
  prefixOrderedList,
  prefixSelectedLines,
  wrapSelection,
  type SourceEdit,
  type TextSelection
} from '../shared/markdown';
import { applyTextChanges, computeTextChanges, mapTextChanges, mapTextOffset, type TextChange } from '../shared/textChanges';
import { getScrollRatio } from '../shared/scroll';
import type { Messages } from '../shared/messages';
import { mveDebug } from './debug';

export type SourceAction =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'highlight'
  | 'underline'
  | 'sup'
  | 'sub'
  | 'inlineCode'
  | 'quote'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'indent'
  | 'outdent'
  | 'codeBlock'
  | 'horizontalRule'
  | 'hardBreak'
  | 'cellBreak'
  | 'clearInline'
  | 'clearBlock'
  | 'clearAll'
  | 'unlink';

const CARET_PRESERVING_LINE_ACTIONS = new Set<SourceAction>([
  'quote',
  'bulletList',
  'orderedList',
  'taskList',
  'indent',
  'outdent',
  'clearInline',
  'clearBlock',
  'clearAll'
]);

export interface TextEditorHandle {
  insert(markdown: string, inline?: boolean): void;
  applyEdit(edit: SourceEdit): void;
  action(action: SourceAction): void;
  codeBlock(language?: string): void;
  heading(level: number): void;
  link(href: string, label?: string): void;
  getSelection(): TextSelection;
  setSelection(selection: TextSelection): void;
  revealRange(selection: TextSelection): void;
  getViewport(): EditorViewportAnchor | undefined;
  restoreViewport(anchor: EditorViewportAnchor): void;
  restoreScrollRatio(ratio: number): void;
}

export interface EditorViewportAnchor {
  offset: number;
  topOffset: number;
  endOffset?: number;
  /** エディター全体の最大スクロール量に対する現在位置。 */
  scrollRatio?: number;
}

/** 外部同期トランザクションをユーザー編集と区別するためのCodeMirrorアノテーション。 */
const externalSyncTransaction = Annotation.define<boolean>();

/** VS Codeテーマ上でMarkdownリンクとURLを読みやすく表示する。 */
const vscodeLinkHighlightStyle = HighlightStyle.define([
  {
    tag: [tags.link, tags.url],
    color: 'var(--vscode-textLink-foreground)',
    textDecoration: 'underline'
  }
]);

interface SearchHighlightData {
  hits: readonly TextSelection[];
  active?: TextSelection;
}

interface SearchHighlightState extends SearchHighlightData {
  decorations: DecorationSet;
}

const setSearchHighlights = StateEffect.define<SearchHighlightData>();
const searchHighlightField = StateField.define<SearchHighlightState>({
  create: () => ({ hits: [], decorations: Decoration.none }),
  update(value, transaction) {
    let next = value;
    for (const effect of transaction.effects) {
      if (effect.is(setSearchHighlights)) {
        next = {
          ...effect.value,
          decorations: createSearchDecorations(transaction.state, effect.value)
        };
      }
    }
    if (transaction.docChanged && next === value) return { hits: [], decorations: Decoration.none };
    return next;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations)
});

/**
 * 検索ヒットをCodeMirrorの装飾範囲へ変換する。
 * @param state 現在のエディター状態。
 * @param data 検索ヒットとアクティブなヒット。
 * @returns 検索ヒットへ適用する装飾集合。
 */
function createSearchDecorations(state: EditorState, data: SearchHighlightData): DecorationSet {
  const activeKey = data.active ? `${data.active.from}:${data.active.to}` : '';
  const ranges = data.hits
    .map((hit) => {
      const from = externalOffsetToEditorValue(state.sliceDoc(), hit.from);
      const to = externalOffsetToEditorValue(state.sliceDoc(), hit.to);
      if (to <= from) return undefined;
      const active = `${hit.from}:${hit.to}` === activeKey;
      return Decoration.mark({ class: active ? 'cm-search-match cm-search-match-active' : 'cm-search-match' }).range(from, to);
    })
    .filter((range): range is Range<Decoration> => Boolean(range));
  return Decoration.set(ranges);
}

/**
 * 表示中の範囲にある半角スペースへ可視化用の装飾を付ける。
 * @param view 装飾対象のCodeMirrorビュー。
 * @returns 半角スペースへ適用する装飾集合。
 */
function visibleSpaceDecorations(view: EditorView): DecorationSet {
  const ranges = [] as Array<{ from: number; to: number }>;
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to, '\n');
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === ' ') {
        ranges.push({ from: from + index, to: from + index + 1 });
      }
    }
  }
  return Decoration.set(ranges.map(({ from, to }) => Decoration.mark({ class: 'cm-visible-space' }).range(from, to)));
}

const visibleSpaces: Extension = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  /** 表示中のスペース装飾を初期化する。 */
  constructor(view: EditorView) {
    this.decorations = visibleSpaceDecorations(view);
  }

  /** 文書または表示範囲の変更時にスペース装飾を再計算する。 */
  update(update: { view: EditorView; docChanged: boolean; viewportChanged: boolean }): void {
    if (update.docChanged || update.viewportChanged) this.decorations = visibleSpaceDecorations(update.view);
  }
}, { decorations: (value) => value.decorations });

interface Props {
  messages: Messages;
  value: string;
  initialSelection?: TextSelection;
  searchHits?: readonly TextSelection[];
  activeSearchHit?: TextSelection;
  onChange: (value: string, changes: TextChange[]) => void;
  onSelectionChange?: (selection: TextSelection) => void;
  className?: string;
  placeholder?: string;
  onViewportChange?: (anchor: EditorViewportAnchor, userInitiated: boolean) => void;
  onUserScrollIntent?: () => void;
}

/**
 * CodeMirrorをMarkdownソースエディターとして初期化し、編集・選択・表示位置を親へ通知する。
 * @param props エディター本文、選択、検索結果、各種イベントコールバック。
 * @param ref 親から命令型操作を呼び出すための参照。
 * @returns CodeMirrorを格納するエディター要素。
 */
export const SourceEditor = forwardRef<TextEditorHandle, Props>(function SourceEditor(
  {
    messages,
    value,
    initialSelection,
    searchHits = [],
    activeSearchHit,
    onChange,
    onSelectionChange,
    className = '',
    placeholder = messages.editor.placeholder,
    onViewportChange,
    onUserScrollIntent
  },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | undefined>(undefined);
  const suppressRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const selectionRef = useRef(onSelectionChange);
  const viewportRef = useRef(onViewportChange);
  const viewportIntentRef = useRef(onUserScrollIntent);
  const userScrollPendingRef = useRef(false);
  const pointerScrollActiveRef = useRef(false);
  const touchScrollActiveRef = useRef(false);
  const programmaticScrollPendingRef = useRef(false);
  const viewportRestoreGenerationRef = useRef(0);
  const viewportRestoreAnchorRef = useRef<EditorViewportAnchor | undefined>(undefined);
  const viewportRestoreActiveRef = useRef(false);
  const compositionActiveRef = useRef(false);
  const deferredValueRef = useRef<string | undefined>(undefined);
  const compositionEndTimerRef = useRef<number | undefined>(undefined);
  const [compositionNonce, setCompositionNonce] = useState(0);
  onChangeRef.current = onChange;
  selectionRef.current = onSelectionChange;
  viewportRef.current = onViewportChange;
  viewportIntentRef.current = onUserScrollIntent;

  useEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      doc: value,
      selection: initialSelection
        ? EditorSelection.range(
            externalOffsetToEditorValue(value, initialSelection.from),
            externalOffsetToEditorValue(value, initialSelection.to)
          )
        : undefined,
      extensions: [
        EditorState.lineSeparator.of(detectLineSeparator(value)),
        lineNumbers(),
        markdownLanguage(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        syntaxHighlighting(vscodeLinkHighlightStyle),
        visibleSpaces,
        searchHighlightField,
        placeholderExtension(placeholder),
        keymap.of([...defaultKeymap, indentWithTab]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          // 選択変更を外部オフセットへ通知し、ユーザー編集だけを本文変更として送信する。
          if (update.selectionSet) {
            const main = update.state.selection.main;
            publishSelectionData(hostRef.current, update.state);
            selectionRef.current?.({
              from: editorOffsetToExternal(update.state, main.from),
              to: editorOffsetToExternal(update.state, main.to)
            });
          }
          const isExternalSync = update.transactions.some(
            (transaction) => transaction.annotation(externalSyncTransaction) === true
          );
          if (update.docChanged && !suppressRef.current && !isExternalSync) {
            viewportRestoreAnchorRef.current = undefined;
            viewportRestoreGenerationRef.current += 1;
            let changes: TextChange[] = [];
            update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
              // CodeMirror上の変更範囲を元文書の改行形式に戻してTextChangeへ変換する。
              changes.push({
                rangeOffset: editorOffsetToExternal(update.startState, fromA),
                rangeLength: update.startState.sliceDoc(fromA, toA).length,
                text: inserted.sliceString(0, inserted.length, update.state.facet(EditorState.lineSeparator) ?? '\n')
              });
            });
            let nextValue = update.state.sliceDoc();
            const deferredValue = deferredValueRef.current;
            if (deferredValue !== undefined) {
              // IME入力中に届いた外部本文を保留し、ユーザー入力を優先して差分を統合する。
              const startValue = update.startState.sliceDoc();
              try {
                const deferredChanges = computeTextChanges(startValue, deferredValue);
                changes = mapTextChanges(changes, deferredChanges, startValue.length, true);
                nextValue = applyTextChanges(deferredValue, changes);
                deferredValueRef.current = nextValue;
              } catch (error) {
                console.warn('[Markdown Easy Visual Editor] IME入力と外部変更を入力優先で統合しました。', error);
                const deferredChanges = computeTextChanges(startValue, deferredValue);
                changes = mapChangesPreferLocal(changes, deferredChanges, startValue.length);
                nextValue = applyTextChanges(deferredValue, changes);
                deferredValueRef.current = nextValue;
              }
            }
            mveDebug('source.doc-changed', {
              changeCount: changes.length,
              changes: changes.slice(0, 8),
              nextLength: nextValue.length,
              selection: update.state.selection.main
                ? {
                    from: editorOffsetToExternal(update.state, update.state.selection.main.from),
                    to: editorOffsetToExternal(update.state, update.state.selection.main.to)
                  }
                : undefined
            });
            onChangeRef.current(nextValue, changes);
          }
        }),
        EditorView.theme({
          '&': { height: '100%', color: 'var(--vscode-editor-foreground)', backgroundColor: 'transparent' },
          '.cm-content': { caretColor: 'var(--vscode-editorCursor-foreground)', padding: '18px 24px 42px' },
          '.cm-gutters': {
            backgroundColor: 'var(--vscode-editor-background)',
            color: 'var(--vscode-editorLineNumber-foreground)',
            border: 'none'
          },
          '.cm-activeLine': { backgroundColor: 'var(--vscode-editor-lineHighlightBackground)' },
          '.cm-activeLineGutter': { backgroundColor: 'var(--vscode-editor-lineHighlightBackground)' },
          '&.cm-focused': { outline: 'none' },
          '.cm-selectionBackground, ::selection': {
            backgroundColor: 'var(--vscode-editor-selectionBackground) !important'
          }
        })
      ]
    });
    const view = new EditorView({ state, parent: hostRef.current });
    // スクロール・履歴・IMEの各DOMイベントを購読し、レイアウト変化を検知する。
    /** ユーザーがスクロールを開始したことを記録し、保存位置を無効化する。 */
    const markUserScrollIntent = () => {
      viewportRestoreGenerationRef.current += 1;
      viewportRestoreAnchorRef.current = undefined;
      viewportRestoreActiveRef.current = false;
      programmaticScrollPendingRef.current = false;
      userScrollPendingRef.current = true;
      viewportIntentRef.current?.();
    };
    /** ポインタースクロールを開始し、ユーザー操作として記録する。 */
    const beginPointerScroll = () => {
      markUserScrollIntent();
      pointerScrollActiveRef.current = true;
    };
    /** ポインタースクロールの開始状態を解除する。 */
    const endPointerScroll = () => { pointerScrollActiveRef.current = false; };
    /** タッチスクロールを開始し、ユーザー操作として記録する。 */
    const beginTouchScroll = () => {
      markUserScrollIntent();
      touchScrollActiveRef.current = true;
    };
    /** タッチスクロールの開始状態を解除する。 */
    const endTouchScroll = () => { touchScrollActiveRef.current = false; };
    /**
     * CodeMirror外部のUndo/Redo入力を停止し、ホスト側の履歴処理へ任せる。
     * @param event 入力前イベント。
     */
    const handleHistoryBeforeInput = (event: InputEvent) => {
      if (event.inputType !== 'historyUndo' && event.inputType !== 'historyRedo') return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    /** IMEの変換開始を記録する。 */
    const beginComposition = () => { compositionActiveRef.current = true; };
    /** IMEの変換終了を記録し、保留した外部本文を再評価する。 */
    const endComposition = () => {
      compositionActiveRef.current = false;
      if (compositionEndTimerRef.current !== undefined) window.clearTimeout(compositionEndTimerRef.current);
      compositionEndTimerRef.current = window.setTimeout(() => {
        compositionEndTimerRef.current = undefined;
        setCompositionNonce((value) => value + 1);
      }, 0);
    };
    /**
     * 現在の表示アンカーをDOMデータ属性へ出力する。
     * @param anchor 出力する表示アンカー。
     */
    const publishViewport = (anchor: EditorViewportAnchor) => publishViewportData(hostRef.current, anchor);
    /** スクロール位置を読み取り、ユーザー操作かプログラム操作かを親へ通知する。 */
    const handleScroll = () => {
      const anchor = readViewport(view);
      if (!anchor) return;
      publishViewport(anchor);
      const programmatic = programmaticScrollPendingRef.current;
      programmaticScrollPendingRef.current = false;
      // スクロールバーのつまみ操作ではpointerdownがscrollDOMへ届かないことがある。
      // プログラム復元として明示されていないscrollイベントはユーザー操作として扱う。
      const userInitiated = !programmatic && !viewportRestoreActiveRef.current;
      if (!programmatic && !viewportRestoreActiveRef.current) viewportRestoreAnchorRef.current = { ...anchor };
      userScrollPendingRef.current = false;
      viewportRef.current?.(anchor, userInitiated);
    };
    view.scrollDOM.addEventListener('scroll', handleScroll, { passive: true });
    view.scrollDOM.addEventListener('wheel', markUserScrollIntent, { passive: true });
    view.scrollDOM.addEventListener('pointerdown', beginPointerScroll, { passive: true });
    view.scrollDOM.addEventListener('touchstart', beginTouchScroll, { passive: true });
    view.scrollDOM.addEventListener('keydown', markUserScrollIntent);
    view.contentDOM.addEventListener('beforeinput', handleHistoryBeforeInput, true);
    view.contentDOM.addEventListener('compositionstart', beginComposition);
    view.contentDOM.addEventListener('compositionend', endComposition);
    window.addEventListener('pointerup', endPointerScroll);
    window.addEventListener('pointercancel', endPointerScroll);
    window.addEventListener('touchend', endTouchScroll);
    window.addEventListener('touchcancel', endTouchScroll);
    const resizeObserver = new ResizeObserver(() => {
      // レイアウトサイズ変更後に保存済み表示位置を復元し、復元対象がなければ現在位置を再通知する。
      const restoreAnchor = viewportRestoreAnchorRef.current;
      if (restoreAnchor) {
        const generation = ++viewportRestoreGenerationRef.current;
        restoreViewportUntilSettled(
          view,
          restoreAnchor,
          hostRef.current,
          programmaticScrollPendingRef,
          () => viewportRestoreGenerationRef.current === generation,
          (restored) => viewportRef.current?.(restored, false),
          () => { viewportRestoreActiveRef.current = false; }
        );
        return;
      }
      view.requestMeasure({
        read: () => readViewport(view),
        write: (anchor) => { if (anchor) publishViewport(anchor); }
      });
    });
    resizeObserver.observe(view.scrollDOM);
    viewRef.current = view;
    publishSelectionData(hostRef.current, view.state);
    view.requestMeasure({
      read: () => readViewport(view),
      write: (anchor) => { if (anchor) publishViewport(anchor); }
    });
    return () => {
      // アンマウント時にすべてのイベント購読・Observer・CodeMirrorビューを破棄する。
      view.scrollDOM.removeEventListener('scroll', handleScroll);
      view.scrollDOM.removeEventListener('wheel', markUserScrollIntent);
      view.scrollDOM.removeEventListener('pointerdown', beginPointerScroll);
      view.scrollDOM.removeEventListener('touchstart', beginTouchScroll);
      view.scrollDOM.removeEventListener('keydown', markUserScrollIntent);
      view.contentDOM.removeEventListener('beforeinput', handleHistoryBeforeInput, true);
      view.contentDOM.removeEventListener('compositionstart', beginComposition);
      view.contentDOM.removeEventListener('compositionend', endComposition);
      if (compositionEndTimerRef.current !== undefined) window.clearTimeout(compositionEndTimerRef.current);
      window.removeEventListener('pointerup', endPointerScroll);
      window.removeEventListener('pointercancel', endPointerScroll);
      window.removeEventListener('touchend', endTouchScroll);
      window.removeEventListener('touchcancel', endTouchScroll);
      resizeObserver.disconnect();
      view.destroy();
      viewRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    // 親から本文が変わったとき、IME入力中でなければ外部同期トランザクションとして反映する。
    const view = viewRef.current;
    if (!view || view.state.sliceDoc() === value) return;
    if (compositionActiveRef.current) {
      deferredValueRef.current = value;
      return;
    }
    deferredValueRef.current = undefined;
    // 外部本文の差分をCodeMirrorの改行形式へ変換し、表示位置のスナップショットも写像する。
    const changes = computeTextChanges(view.state.sliceDoc(), value);
    const editorChanges = changes.map((change) => ({
      from: externalOffsetToEditor(view.state, change.rangeOffset),
      to: externalOffsetToEditor(view.state, change.rangeOffset + change.rangeLength),
      insert: toEditorInsertion(view.state, change.text)
    }));
    const changeSet = view.state.changes(editorChanges);
    const snapshot = view.scrollDOM.clientHeight > 0 ? view.scrollSnapshot().map(changeSet) : undefined;
    if (snapshot) programmaticScrollPendingRef.current = true;
    suppressRef.current = true;
    view.dispatch({
      changes: changeSet,
      effects: snapshot,
      annotations: [
        externalSyncTransaction.of(true)
      ]
    });
    suppressRef.current = false;
    view.requestMeasure({
      read: () => readViewport(view),
      write: (anchor) => { if (anchor) publishViewportData(hostRef.current, anchor); }
    });
    const currentSelection = view.state.selection.main;
    selectionRef.current?.({
      from: editorOffsetToExternal(view.state, currentSelection.from),
      to: editorOffsetToExternal(view.state, currentSelection.to)
    });
    publishSelectionData(hostRef.current, view.state);
  }, [value, compositionNonce]);

  useEffect(() => {
    // 親から受け取った検索結果をCodeMirrorの装飾フィールドへ反映する。
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setSearchHighlights.of({ hits: searchHits, active: activeSearchHit }) });
  }, [searchHits, activeSearchHit]);

  useImperativeHandle(ref, () => ({
    /** 選択範囲をMarkdown文字列で置換する。 */
    insert: (markdown) => replaceSelection(markdown),
    /** 共通編集結果をCodeMirrorへ適用する。 */
    applyEdit: (edit) => applyEdit(edit),
    /** 指定されたソース編集操作を実行する。 */
    action: (action) => applyAction(action),
    /** 選択範囲をコードブロックで囲む。 */
    codeBlock: (language = '') => applyCodeBlock(language),
    /** 現在行の見出しレベルを変更する。 */
    heading: (level) => applyHeading(level),
    /** 現在の選択範囲を指定URLのMarkdownリンクへ変換する。 */
    link: (href, label = messages.editor.defaultLinkLabel) => {
      const view = viewRef.current;
      if (!view) return;
      const main = view.state.selection.main;
      const selection = {
        from: editorOffsetToExternal(view.state, main.from),
        to: editorOffsetToExternal(view.state, main.to)
      };
      const source = view.state.sliceDoc();
      const selected = source.slice(selection.from, selection.to) || label;
      applyEdit(
        wrapSelection(source, selection, '[', `](${href})`, selected)
      );
    },
    /** 外部本文オフセットで現在の選択範囲を返す。 */
    getSelection: () => {
      const view = viewRef.current;
      const main = view?.state.selection.main;
      return view && main
        ? { from: editorOffsetToExternal(view.state, main.from), to: editorOffsetToExternal(view.state, main.to) }
        : { from: 0, to: 0 };
    },
    /** 外部本文オフセットでCodeMirrorの選択範囲を設定する。 */
    setSelection: (selection) => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        selection: EditorSelection.range(
          externalOffsetToEditor(view.state, selection.from),
          externalOffsetToEditor(view.state, selection.to)
        )
      });
    },
    /** 指定選択範囲を表示領域中央へスクロールする。 */
    revealRange: (selection) => {
      const view = viewRef.current;
      if (!view) return;
      viewportRestoreAnchorRef.current = undefined;
      viewportRestoreActiveRef.current = false;
      viewportRestoreGenerationRef.current += 1;
      const from = externalOffsetToEditor(view.state, selection.from);
      const to = externalOffsetToEditor(view.state, selection.to);
      programmaticScrollPendingRef.current = true;
      view.dispatch({ effects: EditorView.scrollIntoView(EditorSelection.range(from, to), { y: 'center' }) });
    },
    /** 現在の表示アンカーを取得する。 */
    getViewport: () => {
      const view = viewRef.current;
      return view ? readViewport(view) : undefined;
    },
    /** 指定された表示アンカーへスクロール位置を復元する。 */
    restoreViewport: (anchor) => {
      const view = viewRef.current;
      if (!view || view.scrollDOM.clientHeight === 0) return;
      viewportRestoreAnchorRef.current = { ...anchor };
      viewportRestoreActiveRef.current = true;
      const generation = ++viewportRestoreGenerationRef.current;
      restoreViewportUntilSettled(
        view,
        anchor,
        hostRef.current,
        programmaticScrollPendingRef,
        () => viewportRestoreGenerationRef.current === generation,
        (restored) => viewportRef.current?.(restored, false),
        () => { viewportRestoreActiveRef.current = false; }
      );
    },
    /** 指定された全体スクロール比率へ移動する。 */
    restoreScrollRatio: (ratio) => {
      const view = viewRef.current;
      if (!view || view.scrollDOM.clientHeight === 0 || !Number.isFinite(ratio)) return;
      viewportRestoreAnchorRef.current = undefined;
      viewportRestoreActiveRef.current = false;
      viewportRestoreGenerationRef.current += 1;
      const maxScrollTop = Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight);
      const nextScrollTop = Math.min(1, Math.max(0, ratio)) * maxScrollTop;
      programmaticScrollPendingRef.current = Math.abs(view.scrollDOM.scrollTop - nextScrollTop) > 0.5;
      view.scrollDOM.scrollTop = nextScrollTop;
    }
  }));

  /**
   * 現在の選択範囲を指定されたMarkdown文字列で置換する。
   * @param markdown 挿入するMarkdown文字列。
   * @returns 何も返さない。
   */
  function replaceSelection(markdown: string): void {
    const view = viewRef.current;
    if (!view) return;
    const selection = view.state.selection.main;
    const normalized = normalizeLineEndings(markdown);
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: toEditorInsertion(view.state, markdown) },
      selection: EditorSelection.cursor(selection.from + normalized.length)
    });
  }

  /**
   * 現在の選択範囲を指定言語の fenced code block で囲む。
   * @param language コードブロックへ記載する言語名。
   * @returns 何も返さない。
   */
  function applyCodeBlock(language = ''): void {
    const view = viewRef.current;
    if (!view) return;
    const source = view.state.sliceDoc();
    const main = view.state.selection.main;
    const selection = {
      from: editorOffsetToExternal(view.state, main.from),
      to: editorOffsetToExternal(view.state, main.to)
    };
    const safeLanguage = language.trim().replace(/[^a-zA-Z0-9_+#.-]/g, '');
    applyEdit(wrapSelection(source, selection, `\`\`\`${safeLanguage}\n`, '\n```', messages.editor.codePlaceholder));
  }

  /**
   * 指定されたソース編集操作を現在の選択範囲へ適用する。
   * @param action 実行するMarkdown編集操作。
   * @returns 何も返さない。
   */
  function applyAction(action: SourceAction): void {
    const view = viewRef.current;
    if (!view) return;
    const source = view.state.sliceDoc();
    const main = view.state.selection.main;
    const selection = {
      from: editorOffsetToExternal(view.state, main.from),
      to: editorOffsetToExternal(view.state, main.to)
    };
    mveDebug('source.action', { action, selection, sourceLength: source.length });
    let edit: SourceEdit | undefined;
    // 操作種別に応じて装飾・リスト・ブロック編集の共通関数を選択する。
    switch (action) {
      case 'bold':
        edit = wrapSelection(source, selection, '**');
        break;
      case 'italic':
        edit = wrapSelection(source, selection, '*');
        break;
      case 'strike':
        edit = wrapSelection(source, selection, '~~');
        break;
      case 'highlight':
        edit = wrapSelection(source, selection, '==');
        break;
      case 'underline':
        edit = wrapSelection(source, selection, '++');
        break;
      case 'sup':
        edit = wrapSelection(source, selection, '^');
        break;
      case 'sub':
        edit = wrapSelection(source, selection, '~');
        break;
      case 'inlineCode':
        edit = wrapSelection(source, selection, '`');
        break;
      case 'quote':
        edit = prefixSelectedLines(source, selection, '> ');
        break;
      case 'bulletList':
        edit = prefixSelectedLines(source, selection, '- ');
        break;
      case 'orderedList':
        edit = prefixOrderedList(source, selection);
        break;
      case 'taskList':
        edit = prefixSelectedLines(source, selection, '- [ ] ');
        break;
      case 'indent':
        edit = indentSelectedLines(source, selection);
        break;
      case 'outdent': {
        const target = selection.from === selection.to
          ? currentLineSelection(source, selection.from)
          : selection;
        const from = Math.min(target.from, target.to);
        const to = Math.max(target.from, target.to);
        const original = source.slice(from, to);
        const selected = original.replace(/^ {1,2}/gm, '');
        edit = {
          text: source.slice(0, from) + selected + source.slice(to),
          selection: selection.from === selection.to
            ? { from: selection.from + selected.length - original.length, to: selection.from + selected.length - original.length }
            : mapLineSelection(original, selected, from, selection)
        };
        break;
      }
      case 'codeBlock':
        applyCodeBlock();
        return;
      case 'horizontalRule':
        replaceSelection('\n\n---\n\n');
        return;
      case 'hardBreak':
        replaceSelection('\\\n');
        return;
      case 'cellBreak':
        replaceSelection('<br>\n');
        return;
      case 'clearInline':
        edit = clearInlineFormatting(source, selection.from === selection.to
          ? currentLineSelection(source, selection.from)
          : selection);
        break;
      case 'clearBlock':
        edit = clearBlockFormatting(source, selection.from === selection.to
          ? currentLineSelection(source, selection.from)
          : selection);
        break;
      case 'clearAll': {
        // ブロック記号を先に除去し、その結果へインライン記号の除去を重ねる。
        const actionSelection = selection.from === selection.to
          ? currentLineSelection(source, selection.from)
          : selection;
        const blockCleared = clearBlockFormatting(source, actionSelection);
        edit = clearInlineFormatting(blockCleared.text, blockCleared.selection);
        break;
      }
      case 'unlink': {
        // カーソルがリンク内にある場合はリンク全体を表示文字列へ置き換える。
        const actionSelection = selection.from === selection.to
          ? linkSelectionAt(source, selection.from)
          : selection;
        if (!actionSelection) return;
        const selected = source.slice(actionSelection.from, actionSelection.to);
        const replacement = selected.replace(/\[([^\]]+)]\([^)]+\)/g, '$1');
        edit = {
          text: source.slice(0, actionSelection.from) + replacement + source.slice(actionSelection.to),
          selection: { from: actionSelection.from, to: actionSelection.from + replacement.length }
        };
        break;
      }
    }
    // 編集結果が生成された操作だけをCodeMirrorへ反映する。
    if (edit && selection.from === selection.to && CARET_PRESERVING_LINE_ACTIONS.has(action)) {
      const changes = computeTextChanges(source, edit.text);
      const caret = mapTextOffset(selection.from, changes, source.length, 1);
      edit = { ...edit, selection: { from: caret, to: caret } };
      mveDebug('source.caret-normalized', { action, from: selection.from, to: caret });
    }
    if (edit) applyEdit(edit);
  }

  /**
   * 現在行の見出しレベルを指定値へ変更する。
   * @param level 設定する見出しレベル。0は本文を表す。
   * @returns 何も返さない。
   */
  function applyHeading(level: number): void {
    const view = viewRef.current;
    if (!view) return;
    const selection = view.state.selection.main;
    const line = view.state.doc.lineAt(selection.from);
    const prefix = level > 0 ? `${'#'.repeat(level)} ` : '';
    const changed = prefix + line.text.replace(/^(#{1,6})\s+/, '');
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: changed },
      selection: EditorSelection.cursor(line.from + Math.min(changed.length, selection.from - line.from + prefix.length))
    });
  }

  /**
   * 共通編集結果をCodeMirrorの変更へ変換し、選択範囲と表示位置を維持して適用する。
   * @param edit 置換後本文と外部オフセットの選択範囲。
   * @returns 何も返さない。
   */
  function applyEdit(edit: SourceEdit): void {
    const view = viewRef.current;
    if (!view) return;
    // 共通編集結果を外部オフセットの差分へ変換し、CodeMirror内部の位置へ写像する。
    const changes = computeTextChanges(view.state.sliceDoc(), edit.text);
    mveDebug('source.apply-edit', {
      beforeLength: view.state.sliceDoc().length,
      afterLength: edit.text.length,
      changeCount: changes.length,
      changes: changes.slice(0, 8),
      selection: edit.selection
    });
    const editorChanges = changes.map((change) => ({
      from: externalOffsetToEditor(view.state, change.rangeOffset),
      to: externalOffsetToEditor(view.state, change.rangeOffset + change.rangeLength),
      insert: toEditorInsertion(view.state, change.text)
    }));
    const changeSet = view.state.changes(editorChanges);
    const snapshot = view.scrollDOM.clientHeight > 0 ? view.scrollSnapshot().map(changeSet) : undefined;
    if (snapshot) programmaticScrollPendingRef.current = true;
    view.dispatch({
      changes: changeSet,
      selection: EditorSelection.range(
        externalOffsetToEditorValue(edit.text, edit.selection.from),
        externalOffsetToEditorValue(edit.text, edit.selection.to)
      ),
      effects: snapshot
    });
  }

  return <div ref={hostRef} className={`source-editor ${className}`} />;
});

/**
 * 本文オフセットを含む1行の選択範囲を求める。
 * @param source 対象のMarkdown本文。
 * @param offset 行を調べる本文オフセット。
 * @returns 行頭から改行直前までの選択範囲。
 */
function currentLineSelection(source: string, offset: number): TextSelection {
  const safeOffset = Math.max(0, Math.min(offset, source.length));
  const from = source.lastIndexOf('\n', Math.max(0, safeOffset - 1)) + 1;
  const lineBreak = source.indexOf('\n', safeOffset);
  const to = lineBreak < 0 ? source.length : lineBreak;
  return { from, to };
}

/**
 * 本文オフセットを含むMarkdownリンク全体の選択範囲を探す。
 * @param source 対象のMarkdown本文。
 * @param offset リンク内か確認する本文オフセット。
 * @returns 見つかったリンク範囲。リンク外ならundefined。
 */
function linkSelectionAt(source: string, offset: number): TextSelection | undefined {
  const linkPattern = /\[[^\]\r\n]+\]\([^\)\r\n]+\)/g;
  for (const match of source.matchAll(linkPattern)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (from <= offset && offset <= to) return { from, to };
  }
  return undefined;
}

/**
 * 本文で使用されている改行文字を検出する。
 * @param value 改行形式を調べる本文。
 * @returns CRLF、CR、LFのいずれか。
 */
function detectLineSeparator(value: string): string {
  return value.includes('\r\n') ? '\r\n' : value.includes('\r') ? '\r' : '\n';
}

/**
 * 表示アンカーをエディターDOMのdata属性へ書き込む。
 * @param host エディターのホスト要素。
 * @param anchor 保存する表示アンカー。
 * @returns 何も返さない。
 */
function publishViewportData(host: HTMLElement | null, anchor: EditorViewportAnchor): void {
  if (!host) return;
  host.dataset.viewportOffset = String(anchor.offset);
  host.dataset.viewportTopOffset = String(anchor.topOffset);
  if (anchor.endOffset !== undefined) host.dataset.viewportEndOffset = String(anchor.endOffset);
}

/**
 * CodeMirrorの選択範囲を外部オフセットへ変換してDOMのdata属性へ書き込む。
 * @param host エディターのホスト要素。
 * @param state 選択範囲を含むCodeMirror状態。
 * @returns 何も返さない。
 */
function publishSelectionData(host: HTMLElement | null, state: EditorState): void {
  if (!host) return;
  const selection = state.selection.main;
  host.dataset.selectionFrom = String(editorOffsetToExternal(state, selection.from));
  host.dataset.selectionTo = String(editorOffsetToExternal(state, selection.to));
}

/**
 * CRLFとCRをLFへ変換して改行形式を統一する。
 * @param value 正規化する文字列。
 * @returns LFへ統一した文字列。
 */
function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?|\n/g, '\n');
}

/**
 * 外部文字列をCodeMirror状態が使用する改行形式へ変換する。
 * @param state 改行形式を取得するCodeMirror状態。
 * @param value 挿入する外部文字列。
 * @returns CodeMirrorへ挿入する文字列。
 */
function toEditorInsertion(state: EditorState, value: string): string {
  const separator = state.facet(EditorState.lineSeparator) ?? '\n';
  return normalizeLineEndings(value).replace(/\n/g, separator);
}

/**
 * CodeMirror内部オフセットを外部本文の改行を含むオフセットへ変換する。
 * @param state オフセット変換対象のCodeMirror状態。
 * @param offset CodeMirror内部オフセット。
 * @returns 外部本文上のオフセット。
 */
function editorOffsetToExternal(state: EditorState, offset: number): number {
  return state.sliceDoc(0, Math.max(0, Math.min(offset, state.doc.length))).length;
}

/**
 * 外部本文のオフセットをCodeMirror内部の改行正規化済みオフセットへ変換する。
 * @param state 変換対象のCodeMirror状態。
 * @param offset 外部本文上のオフセット。
 * @returns CodeMirror内部オフセット。
 */
function externalOffsetToEditor(state: EditorState, offset: number): number {
  return externalOffsetToEditorValue(state.sliceDoc(), offset);
}

/**
 * 任意の外部本文のオフセットをCodeMirror形式のオフセットへ変換する。
 * @param value 外部本文。
 * @param offset 外部本文上のオフセット。
 * @returns 改行をLFへ正規化した本文上のオフセット。
 */
function externalOffsetToEditorValue(value: string, offset: number): number {
  const safeOffset = Math.max(0, Math.min(offset, value.length));
  return normalizeLineEndings(value.slice(0, safeOffset)).length;
}

/**
 * 外部変更と重なるローカル変更を、ローカル側を優先する境界規則で写像する。
 * @param changes ローカル側の変更一覧。
 * @param over 先に適用された外部変更一覧。
 * @param baseLength 両方の変更が基準とする本文長。
 * @returns 外部変更後の本文位置へ写像したローカル変更一覧。
 */
function mapChangesPreferLocal(
  changes: readonly TextChange[],
  over: readonly TextChange[],
  baseLength: number
): TextChange[] {
  return changes.map((change) => {
    if (change.rangeLength === 0) {
      return { ...change, rangeOffset: mapTextOffset(change.rangeOffset, over, baseLength, 1) };
    }
    const from = mapTextOffset(change.rangeOffset, over, baseLength, -1);
    const to = mapTextOffset(change.rangeOffset + change.rangeLength, over, baseLength, 1);
    return { ...change, rangeOffset: from, rangeLength: Math.max(0, to - from) };
  });
}

/**
 * CodeMirrorのスクロール位置から、表示中ブロックの外部本文アンカーを読む。
 * @param view 表示位置を取得するCodeMirrorビュー。
 * @returns 現在の表示アンカー。ビューが非表示ならundefined。
 */
function readViewport(view: EditorView): EditorViewportAnchor | undefined {
  if (view.scrollDOM.clientHeight === 0) return undefined;
  const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
  return {
    offset: editorOffsetToExternal(view.state, block.from),
    topOffset: block.top - view.scrollDOM.scrollTop,
    endOffset: editorOffsetToExternal(view.state, block.to),
    scrollRatio: getScrollRatio(
      view.scrollDOM.scrollTop,
      view.scrollDOM.scrollHeight,
      view.scrollDOM.clientHeight
    )
  };
}

/**
 * レイアウトが安定するまで表示アンカーへのスクロール復元をフレーム単位で繰り返す。
 * @param view 復元対象のCodeMirrorビュー。
 * @param anchor 復元する外部本文アンカー。
 * @param host 表示アンカーを公開するホスト要素。
 * @param programmaticScrollPendingRef プログラムスクロール中かを保持する参照。
 * @param isCurrent 現在の復元要求かを判定する関数。
 * @param onRestored 復元位置が計算できたときの通知関数。
 * @param onSettled 復元処理が完了したときの通知関数。
 * @param attempt 現在の再試行回数。
 * @returns 何も返さない。復元はrequestAnimationFrameで非同期に行う。
 */
function restoreViewportUntilSettled(
  view: EditorView,
  anchor: EditorViewportAnchor,
  host: HTMLElement | null,
  programmaticScrollPendingRef: React.MutableRefObject<boolean>,
  isCurrent: () => boolean,
  onRestored: (anchor: EditorViewportAnchor) => void,
  onSettled: () => void,
  attempt = 0
): void {
  if (!isCurrent()) return;
  window.requestAnimationFrame(() => {
    if (!isCurrent()) return;
    const offset = externalOffsetToEditor(view.state, anchor.offset);
    const block = view.lineBlockAt(offset);
    const nextScrollTop = Math.max(0, block.top - anchor.topOffset);
    programmaticScrollPendingRef.current = Math.abs(view.scrollDOM.scrollTop - nextScrollTop) > 0.5;
    view.scrollDOM.scrollTop = nextScrollTop;
    const restored = readViewport(view);
    if (restored) {
      publishViewportData(host, restored);
      onRestored(restored);
    }
    const settled = Boolean(
      restored
      && anchor.offset >= restored.offset
      && anchor.offset <= (restored.endOffset ?? restored.offset)
      && Math.abs(restored.topOffset - anchor.topOffset) <= 1
    );
    if (restored && (attempt < 8 || (!settled && attempt < 16))) {
      restoreViewportUntilSettled(
        view,
        anchor,
        host,
        programmaticScrollPendingRef,
        isCurrent,
        onRestored,
        onSettled,
        attempt + 1
      );
    } else {
      onSettled();
    }
  });
}

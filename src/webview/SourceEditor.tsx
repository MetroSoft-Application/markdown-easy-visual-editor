import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { cpp } from '@codemirror/lang-cpp';
import { css } from '@codemirror/lang-css';
import { go } from '@codemirror/lang-go';
import { html } from '@codemirror/lang-html';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown as markdownLanguage } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { sql } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language';
import { Annotation, Compartment, EditorSelection, EditorState, StateEffect, StateField, type Extension, type Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, keymap, lineNumbers, placeholder as placeholderExtension, ViewPlugin, type ViewUpdate } from '@codemirror/view';
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
import { computeTextChanges, mapTextOffset, type TextChange } from '../shared/textChanges';
import { getScrollRatio } from '../shared/scroll';
import type { Messages } from '../shared/messages';
import { isMveDebugEnabled, mveDebug } from './debug';
import { exactSelectionMatchExtension } from './cmSelectionMatchHighlight';

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

/** フェンス付きコードブロック内で利用するCodeMirror言語を定義する。 */
const sourceCodeLanguages = [
  LanguageDescription.of({
    name: 'JavaScript',
    alias: ['javascript', 'js', 'jsx'],
    support: javascript({ jsx: true })
  }),
  LanguageDescription.of({
    name: 'TypeScript',
    alias: ['typescript', 'ts', 'tsx'],
    support: javascript({ typescript: true, jsx: true })
  }),
  LanguageDescription.of({
    name: 'HTML',
    alias: ['html', 'xhtml'],
    support: html()
  }),
  LanguageDescription.of({
    name: 'CSS',
    alias: ['css'],
    support: css()
  }),
  LanguageDescription.of({
    name: 'Python',
    alias: ['python', 'py'],
    support: python()
  }),
  LanguageDescription.of({
    name: 'Java',
    alias: ['java'],
    support: java()
  }),
  LanguageDescription.of({
    name: 'C++',
    alias: ['cpp', 'c++'],
    support: cpp()
  }),
  LanguageDescription.of({
    name: 'Go',
    alias: ['go', 'golang'],
    support: go()
  }),
  LanguageDescription.of({
    name: 'Rust',
    alias: ['rust', 'rs'],
    support: rust()
  }),
  LanguageDescription.of({
    name: 'SQL',
    alias: ['sql'],
    support: sql()
  }),
  LanguageDescription.of({
    name: 'JSON',
    alias: ['json'],
    support: json()
  }),
  LanguageDescription.of({
    name: 'YAML',
    alias: ['yaml', 'yml'],
    support: yaml()
  })
] as const;

/** Markdownとフェンス内コードをVS Codeテーマに合わせて読みやすく表示する。 */
const vscodeSyntaxHighlightStyle = HighlightStyle.define([
  { tag: tags.meta, color: 'var(--vscode-descriptionForeground)' },
  { tag: tags.heading, color: '#4ec9b0', fontWeight: '600' },
  { tag: tags.quote, color: 'var(--vscode-textBlockQuote-foreground, var(--vscode-foreground))' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  {
    tag: tags.link,
    color: '#4ec9b0',
    textDecoration: 'underline'
  },
  { tag: tags.url, color: '#4ec9b0' },
  { tag: tags.processingInstruction, color: '#d7ba7d' },
  {
    tag: tags.monospace,
    color: '#ce9178',
    backgroundColor: 'var(--vscode-textCodeBlock-background, var(--vscode-editor-inactiveSelectionBackground))',
    fontFamily: 'var(--vscode-editor-font-family, monospace)'
  },
  { tag: tags.escape, color: '#ce9178' },
  { tag: tags.character, color: '#b5cea8' },
  {
    tag: [tags.keyword, tags.operator],
    color: '#c586c0'
  },
  {
    tag: [tags.atom, tags.bool, tags.contentSeparator],
    color: '#dcdcaa'
  },
  { tag: tags.number, color: '#b5cea8' },
  { tag: tags.labelName, color: '#d7ba7d' },
  {
    tag: [tags.string, tags.special(tags.string)],
    color: '#ce9178'
  },
  { tag: [tags.literal, tags.inserted], color: '#b5cea8' },
  { tag: tags.deleted, color: '#f48771' },
  { tag: tags.regexp, color: '#d16969' },
  { tag: tags.comment, color: 'var(--vscode-descriptionForeground)', fontStyle: 'italic' },
  {
    tag: [tags.typeName, tags.className, tags.namespace],
    color: '#155e4f'
  },
  {
    tag: [tags.definition(tags.variableName), tags.local(tags.variableName)],
    color: '#dcdcaa'
  },
  {
    tag: [tags.special(tags.variableName), tags.macroName],
    color: '#c586c0'
  },
  {
    tag: tags.definition(tags.propertyName),
    color: '#155e4f'
  },
  {
    tag: [tags.variableName, tags.propertyName, tags.function(tags.variableName)],
    color: 'var(--vscode-editor-foreground)'
  },
  { tag: tags.invalid, color: 'var(--vscode-errorForeground)' },
  { tag: [tags.punctuation, tags.paren, tags.brace, tags.squareBracket, tags.separator], color: '#d4d4d4' }
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
  const source = state.sliceDoc();
  const ranges = data.hits
    .map((hit) => {
      const from = externalOffsetToEditorValue(source, hit.from);
      const to = externalOffsetToEditorValue(source, hit.to);
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

/**
 * 文書差分を既存の空白装飾へ写像し、変更された範囲内の空白だけを再作成する。
 * @param decorations 変更前の空白装飾。
 * @param update CodeMirrorの表示更新。
 * @returns 変更後の空白装飾。
 */
function updateVisibleSpaceDecorations(decorations: DecorationSet, update: ViewUpdate): DecorationSet {
  if (update.viewportChanged) return visibleSpaceDecorations(update.view);
  let next = decorations.map(update.changes);
  update.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    const additions: Range<Decoration>[] = [];
    if (toB > fromB) {
      for (const visible of update.view.visibleRanges) {
        const scanFrom = Math.max(fromB, visible.from);
        const scanTo = Math.min(toB, visible.to);
        if (scanTo <= scanFrom) continue;
        const text = update.state.doc.sliceString(scanFrom, scanTo, '\n');
        for (let index = 0; index < text.length; index += 1) {
          if (text[index] === ' ') {
            additions.push(Decoration.mark({ class: 'cm-visible-space' }).range(scanFrom + index, scanFrom + index + 1));
          }
        }
      }
      // 置換前の空白装飾が変更後の文字へ写像されても残らないよう、変更範囲だけ入れ替える。
      next = next.update({
        filterFrom: fromB,
        filterTo: toB,
        filter: () => false,
        add: additions,
        sort: true
      });
    }
  });
  return next;
}

const visibleSpaces: Extension = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  /** 表示中のスペース装飾を初期化する。 */
  constructor(view: EditorView) {
    this.decorations = visibleSpaceDecorations(view);
  }

  /** 文書または表示範囲の変更時にスペース装飾を再計算する。 */
  update(update: ViewUpdate): void {
    if (update.docChanged) {
      this.decorations = updateVisibleSpaceDecorations(this.decorations, update);
    } else if (update.viewportChanged) {
      this.decorations = visibleSpaceDecorations(update.view);
    }
  }
}, { decorations: (value) => value.decorations });

interface Props {
  messages: Messages;
  value: string;
  initialSelection?: TextSelection;
  searchHits?: readonly TextSelection[];
  activeSearchHit?: TextSelection;
  /** `isCompositionCommit` はIME確定時にまとめて通知した操作であることを示す。 */
  onChange: (beforeValue: string, value: string, changes: TextChange[], isCompositionCommit?: boolean) => void;
  onInputActivity?: () => void;
  onSettled?: () => void;
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
const SourceEditorView = forwardRef<TextEditorHandle, Props>(function SourceEditor(
  {
    messages,
    value,
    initialSelection,
    searchHits = [],
    activeSearchHit,
    onChange,
    onInputActivity,
    onSettled,
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
  const inputActivityRef = useRef(onInputActivity);
  const onSettledRef = useRef(onSettled);
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
  const compositionSessionRef = useRef<{
    /** 変換開始時点の外部文書。preedit差分は必ずこの本文を基準に確定する。 */
    beforeValue: string;
    from: number;
    to: number;
    changed: boolean;
  } | undefined>(undefined);
  const compositionHandoffRef = useRef<{
    /** 確定直後にReactから届き得る、確定前の古い本文は再適用しない。 */
    beforeValue: string;
    deferredValue?: string;
  } | undefined>(undefined);
  const lineSeparatorCompartmentRef = useRef(new Compartment());
  const lastSynchronizedValueRef = useRef(value);
  const deferredValueRef = useRef<string | undefined>(undefined);
  const compositionEndTimerRef = useRef<number | undefined>(undefined);
  const inputSettledTimerRef = useRef<number | undefined>(undefined);
  const [compositionNonce, setCompositionNonce] = useState(0);
  onChangeRef.current = onChange;
  inputActivityRef.current = onInputActivity;
  onSettledRef.current = onSettled;
  selectionRef.current = onSelectionChange;
  viewportRef.current = onViewportChange;
  viewportIntentRef.current = onUserScrollIntent;

  useEffect(() => {
    if (!hostRef.current) return;
    let selectionFrame = 0;
    let pendingSelection: TextSelection | undefined;
    const publishSelection = (nextSelection: TextSelection) => {
      pendingSelection = nextSelection;
      if (selectionFrame) return;
      selectionFrame = window.requestAnimationFrame(() => {
        selectionFrame = 0;
        const selection = pendingSelection;
        pendingSelection = undefined;
        if (selection) selectionRef.current?.(selection);
      });
    };
    const state = EditorState.create({
      doc: value,
      selection: initialSelection
        ? EditorSelection.range(
            externalOffsetToEditorValue(value, initialSelection.from),
            externalOffsetToEditorValue(value, initialSelection.to)
          )
        : undefined,
      extensions: [
        lineSeparatorCompartmentRef.current.of(EditorState.lineSeparator.of(detectLineSeparator(value))),
        lineNumbers(),
        markdownLanguage({ codeLanguages: sourceCodeLanguages }),
        // 標準スタイルは濃い青を含むため使わず、明るいテーマ配色を1つだけ適用する。
        syntaxHighlighting(vscodeSyntaxHighlightStyle),
        visibleSpaces,
        exactSelectionMatchExtension,
        searchHighlightField,
        placeholderExtension(placeholder),
        keymap.of([...defaultKeymap, indentWithTab]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          const isExternalSync = update.transactions.some(
            (transaction) => transaction.annotation(externalSyncTransaction) === true
          );
          const isUserDocumentChange = update.docChanged && !suppressRef.current && !isExternalSync;
          const compositionSession = compositionSessionRef.current;

          // 変換途中の文書変更はCodeMirrorの内部だけで即時に反映する。
          // 候補の更新ごとに親・ホストへ送ると差分の再配置が割り込み、確定文字列の
          // 順序やキャレットを壊す。開始本文から確定本文への単一差分だけを送る。
          if (compositionActiveRef.current && isUserDocumentChange && compositionSession) {
            compositionSessionRef.current = {
              ...compositionSession,
              from: update.changes.mapPos(compositionSession.from, -1),
              to: update.changes.mapPos(compositionSession.to, 1),
              changed: true
            };
            inputActivityRef.current?.();
            if (inputSettledTimerRef.current !== undefined) {
              window.clearTimeout(inputSettledTimerRef.current);
              inputSettledTimerRef.current = undefined;
            }
            viewportRestoreAnchorRef.current = undefined;
            viewportRestoreGenerationRef.current += 1;
            if (hostRef.current) hostRef.current.dataset.documentLength = String(externalDocumentLength(update.state));
          }

          // 変換中の選択通知も親の再描画・装飾更新の入口になるため、確定時まで隔離する。
          if (update.selectionSet && !compositionActiveRef.current) {
            const main = update.state.selection.main;
            publishSelectionData(hostRef.current, update.state);
            publishSelection({
              from: editorOffsetToExternal(update.state, main.from),
              to: editorOffsetToExternal(update.state, main.to)
            });
          }

          if (isUserDocumentChange && !compositionActiveRef.current) {
            inputActivityRef.current?.();
            if (inputSettledTimerRef.current !== undefined) window.clearTimeout(inputSettledTimerRef.current);
            inputSettledTimerRef.current = window.setTimeout(() => {
              inputSettledTimerRef.current = undefined;
              onSettledRef.current?.();
            }, 220);
            viewportRestoreAnchorRef.current = undefined;
            viewportRestoreGenerationRef.current += 1;
            let changes: TextChange[] = [];
            update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
              changes.push({
                rangeOffset: editorOffsetToExternal(update.startState, fromA),
                rangeLength: update.startState.sliceDoc(fromA, toA).length,
                text: inserted.sliceString(0, inserted.length, update.state.facet(EditorState.lineSeparator) ?? '\n')
              });
            });
            if (isMveDebugEnabled()) {
              mveDebug('source.doc-changed', {
                changeCount: changes.length,
                changes: changes.slice(0, 8),
                nextLength: externalDocumentLength(update.state),
                selection: update.state.selection.main
                  ? {
                      from: editorOffsetToExternal(update.state, update.state.selection.main.from),
                      to: editorOffsetToExternal(update.state, update.state.selection.main.to)
                    }
                  : undefined
              });
            }
            const nextValue = externalDocumentValue(update.state);
            const beforeValue = externalDocumentValue(update.startState);
            if (hostRef.current) hostRef.current.dataset.documentLength = String(nextValue.length);
            onChangeRef.current(beforeValue, nextValue, changes);
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
    hostRef.current.dataset.documentLength = String(view.state.sliceDoc().length);
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
    /** 確定したユーザー入力だけにsettled通知を予約する。 */
    const scheduleInputSettled = () => {
      inputActivityRef.current?.();
      if (inputSettledTimerRef.current !== undefined) window.clearTimeout(inputSettledTimerRef.current);
      inputSettledTimerRef.current = window.setTimeout(() => {
        inputSettledTimerRef.current = undefined;
        onSettledRef.current?.();
      }, 220);
    };
    /**
     * CodeMirrorがcompositionend直後のMutationRecordを反映してから、変換セッション全体を
     * 開始本文からの一つの操作として親へ渡す。preeditは同期しない。
     */
    const settleComposition = () => {
      if (!compositionActiveRef.current) return;
      if (compositionEndTimerRef.current !== undefined) window.clearTimeout(compositionEndTimerRef.current);
      compositionEndTimerRef.current = undefined;
      const compositionSession = compositionSessionRef.current;
      compositionSessionRef.current = undefined;
      const main = view.state.selection.main;
      const strandedAtStart = Boolean(
        compositionSession
        && compositionSession.changed
        && compositionSession.to > compositionSession.from
        && main.empty
        && main.head === compositionSession.from
      );
      const selection = strandedAtStart
        ? view.state.selection.replaceRange(EditorSelection.cursor(compositionSession!.to))
        : view.state.selection;
      // 同じ選択でも明示的に確定し、ブラウザーDOMのcaretとCodeMirror状態を再結合する。
      view.dispatch({ selection });
      const committedValue = externalDocumentValue(view.state);
      const hasCommittedChange = Boolean(
        compositionSession?.changed && committedValue !== compositionSession.beforeValue
      );
      if (hasCommittedChange && compositionSession) {
        // 変換中に届いた親valueは確定前のスナップショットなので、確定直後に本文へ
        // 書き戻さない。Appがこの操作を再配置した最終本文だけを受け入れる。
        compositionHandoffRef.current = {
          beforeValue: compositionSession.beforeValue,
          deferredValue: deferredValueRef.current
        };
        scheduleInputSettled();
        viewportRestoreAnchorRef.current = undefined;
        viewportRestoreGenerationRef.current += 1;
        if (hostRef.current) hostRef.current.dataset.documentLength = String(committedValue.length);
        const changes = computeTextChanges(compositionSession.beforeValue, committedValue);
        if (isMveDebugEnabled()) {
          mveDebug('source.composition-commit', {
            changeCount: changes.length,
            changes: changes.slice(0, 8),
            nextLength: committedValue.length
          });
        }
        compositionActiveRef.current = false;
        onChangeRef.current(compositionSession.beforeValue, committedValue, changes, true);
      } else {
        compositionActiveRef.current = false;
      }
      publishSelectionData(hostRef.current, view.state);
      const settled = view.state.selection.main;
      publishSelection({
        from: editorOffsetToExternal(view.state, settled.from),
        to: editorOffsetToExternal(view.state, settled.to)
      });
      setCompositionNonce((value) => value + 1);
    };
    /** IME変換を1つの原子トランザクションとして開始する。 */
    const beginComposition = () => {
      // 直前のcompositionendと次の入力開始が連続した場合も、前回分を失わず先に確定する。
      if (compositionEndTimerRef.current !== undefined) settleComposition();
      if (compositionActiveRef.current) return;
      const selection = view.state.selection.main;
      compositionActiveRef.current = true;
      compositionSessionRef.current = {
        beforeValue: externalDocumentValue(view.state),
        from: selection.from,
        to: selection.to,
        changed: false
      };
    };
    /** IMEの変換終了後、ブラウザーの保留DOM変更と同じタスクでは外部同期を再開しない。 */
    const endComposition = () => {
      if (compositionEndTimerRef.current !== undefined) window.clearTimeout(compositionEndTimerRef.current);
      compositionEndTimerRef.current = window.setTimeout(() => {
        settleComposition();
      }, 0);
    };
    /** 次の物理入力がタイマーより先に来た場合、CodeMirrorのキーハンドラーより先に確定位置を直す。 */
    const settleBeforeNextKey = (event: KeyboardEvent) => {
      if (compositionEndTimerRef.current === undefined || event.isComposing) return;
      settleComposition();
    };
    /**
     * 現在の表示アンカーをDOMデータ属性へ出力する。
     * @param anchor 出力する表示アンカー。
     */
    const publishViewport = (anchor: EditorViewportAnchor) => publishViewportData(hostRef.current, anchor);
    let scrollFrame = 0;
    let pendingUserScroll = false;
    /** スクロール位置を読み取り、ユーザー操作かプログラム操作かを親へ通知する。 */
    const handleScroll = () => {
      const programmatic = programmaticScrollPendingRef.current;
      // CodeMirrorの差分写像・復元は複数の遅延scrollイベントを発生させる。
      // 1件目では解除せず、wheel/pointer/touch/keyboardの明示入力時だけ
      // markUserScrollIntentで解除して逆方向同期を防ぐ。
      const userInitiated = !programmatic && !viewportRestoreActiveRef.current;
      pendingUserScroll ||= userInitiated;
      userScrollPendingRef.current = false;
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(() => {
        const startedAt = performance.now();
        scrollFrame = 0;
        const notifyAsUserScroll = pendingUserScroll;
        pendingUserScroll = false;
        const anchor = readViewport(view);
        if (!anchor) return;
        publishViewport(anchor);
        if (notifyAsUserScroll) viewportRestoreAnchorRef.current = { ...anchor };
        viewportRef.current?.(anchor, notifyAsUserScroll);
        performance.clearMeasures('mve-source-scroll-sync');
        performance.measure('mve-source-scroll-sync', { start: startedAt, end: performance.now() });
      });
    };
    view.scrollDOM.addEventListener('scroll', handleScroll, { passive: true });
    view.scrollDOM.addEventListener('wheel', markUserScrollIntent, { passive: true });
    view.scrollDOM.addEventListener('pointerdown', beginPointerScroll, { passive: true });
    view.scrollDOM.addEventListener('touchstart', beginTouchScroll, { passive: true });
    view.scrollDOM.addEventListener('keydown', markUserScrollIntent);
    view.contentDOM.addEventListener('keydown', settleBeforeNextKey, true);
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
      // 入力settledタイマーを破棄する前に親へ完了通知し、ビュー切替直前の入力で
      // bodyの入力中フラグやプレビュー待機処理が残留しないようにする。
      onSettledRef.current?.();
      // アンマウント時にすべてのイベント購読・Observer・CodeMirrorビューを破棄する。
      view.scrollDOM.removeEventListener('scroll', handleScroll);
      view.scrollDOM.removeEventListener('wheel', markUserScrollIntent);
      view.scrollDOM.removeEventListener('pointerdown', beginPointerScroll);
      view.scrollDOM.removeEventListener('touchstart', beginTouchScroll);
      view.scrollDOM.removeEventListener('keydown', markUserScrollIntent);
      view.contentDOM.removeEventListener('keydown', settleBeforeNextKey, true);
      view.contentDOM.removeEventListener('compositionstart', beginComposition);
      view.contentDOM.removeEventListener('compositionend', endComposition);
      if (compositionEndTimerRef.current !== undefined) window.clearTimeout(compositionEndTimerRef.current);
      compositionActiveRef.current = false;
      compositionSessionRef.current = undefined;
      compositionHandoffRef.current = undefined;
      window.removeEventListener('pointerup', endPointerScroll);
      window.removeEventListener('pointercancel', endPointerScroll);
      window.removeEventListener('touchend', endTouchScroll);
      window.removeEventListener('touchcancel', endTouchScroll);
      if (inputSettledTimerRef.current !== undefined) window.clearTimeout(inputSettledTimerRef.current);
      resizeObserver.disconnect();
      if (selectionFrame) window.cancelAnimationFrame(selectionFrame);
      if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
      view.destroy();
      viewRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    // 親から本文が変わったとき、IME入力中でなければ外部同期トランザクションとして反映する。
    const view = viewRef.current;
    if (!view) return;
    if (compositionActiveRef.current) {
      deferredValueRef.current = value;
      return;
    }
    const shouldSynchronize = value !== lastSynchronizedValueRef.current;
    lastSynchronizedValueRef.current = value;
    const currentValue = externalDocumentValue(view.state);
    const compositionHandoff = compositionHandoffRef.current;
    if (compositionHandoff) {
      // Appが確定操作を再配置した本文を返した時だけ、変換中に保留した外部変更を
      // CodeMirrorへ反映する。確定前の親スナップショットを優先して巻き戻してはいけない。
      if (currentValue === value) {
        compositionHandoffRef.current = undefined;
        deferredValueRef.current = undefined;
        return;
      }
      if (value === compositionHandoff.beforeValue || value === compositionHandoff.deferredValue) return;
      compositionHandoffRef.current = undefined;
    }
    deferredValueRef.current = undefined;
    if (!shouldSynchronize) return;
    if (currentValue === value) return;
    // CodeMirror内部は改行を1文字で保持する。外部文書の改行形式を変更する場合も、
    // 内部LFオフセットで差分を作ってからlineSeparatorを同一トランザクションで切り替える。
    const currentEditorValue = view.state.doc.sliceString(0, view.state.doc.length, '\n');
    const nextEditorValue = normalizeLineEndings(value);
    const changes = computeTextChanges(currentEditorValue, nextEditorValue);
    const editorChanges = changes.map((change) => ({
      from: change.rangeOffset,
      to: change.rangeOffset + change.rangeLength,
      insert: toEditorInsertion(view.state, change.text)
    }));
    const changeSet = view.state.changes(editorChanges);
    const snapshot = view.scrollDOM.clientHeight > 0 ? view.scrollSnapshot().map(changeSet) : undefined;
    const nextLineSeparator = detectLineSeparator(value);
    const lineSeparatorEffect = lineSeparatorCompartmentRef.current.reconfigure(
      EditorState.lineSeparator.of(nextLineSeparator)
    );
    // 本文差分にはCodeMirror標準のscrollSnapshot写像を使う。リサイズ用の古い
    // アンカーを残すとResizeObserverが変更前オフセットへ二重復元してしまう。
    viewportRestoreGenerationRef.current += 1;
    viewportRestoreAnchorRef.current = undefined;
    viewportRestoreActiveRef.current = false;
    if (snapshot) programmaticScrollPendingRef.current = true;
    suppressRef.current = true;
    view.dispatch({
      changes: changeSet,
      effects: snapshot ? [snapshot, lineSeparatorEffect] : [lineSeparatorEffect],
      annotations: [
        externalSyncTransaction.of(true)
      ]
    });
    suppressRef.current = false;
    if (hostRef.current) {
      const synchronizedValue = externalDocumentValue(view.state);
      hostRef.current.dataset.documentLength = String(synchronizedValue.length);
      if (synchronizedValue !== value) {
        hostRef.current.dataset.documentMismatch = JSON.stringify(computeTextChanges(value, synchronizedValue));
      } else {
        delete hostRef.current.dataset.documentMismatch;
      }
    }
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
    // composition中は編集DOMへ装飾トランザクションを割り込ませず、確定後に最新結果だけを反映する。
    const view = viewRef.current;
    if (!view || compositionActiveRef.current) return;
    view.dispatch({ effects: setSearchHighlights.of({ hits: searchHits, active: activeSearchHit }) });
  }, [searchHits, activeSearchHit, compositionNonce]);

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

// 選択・スクロール中は親コンポーネントが頻繁に更新される。CodeMirror本体は
// value/searchの変更がない限り再描画不要なので、イベントコールバックの同一性に
// 依存せずエディターのサブツリーを再利用する。
export const SourceEditor = React.memo(SourceEditorView, (previous, next) => (
  previous.value === next.value
  && previous.messages === next.messages
  && previous.placeholder === next.placeholder
  && previous.className === next.className
  && previous.searchHits === next.searchHits
  && previous.activeSearchHit === next.activeSearchHit
  && previous.onChange === next.onChange
  && previous.onInputActivity === next.onInputActivity
  && previous.onSettled === next.onSettled
  && previous.onSelectionChange === next.onSelectionChange
  && previous.onViewportChange === next.onViewportChange
  && previous.onUserScrollIntent === next.onUserScrollIntent
));

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

function externalDocumentLength(state: EditorState): number {
  const separatorLength = (state.facet(EditorState.lineSeparator) ?? '\n').length;
  return state.doc.length + (state.doc.lines - 1) * Math.max(0, separatorLength - 1);
}

/** CodeMirrorの現在値を、ホスト文書と同じ改行形式の全文スナップショットへ変換する。 */
function externalDocumentValue(state: EditorState): string {
  return state.doc.sliceString(0, state.doc.length, state.facet(EditorState.lineSeparator) ?? '\n');
}

/**
 * CodeMirror内部オフセットを外部本文の改行を含むオフセットへ変換する。
 * @param state オフセット変換対象のCodeMirror状態。
 * @param offset CodeMirror内部オフセット。
 * @returns 外部本文上のオフセット。
 */
function editorOffsetToExternal(state: EditorState, offset: number): number {
  const safeOffset = Math.max(0, Math.min(offset, state.doc.length));
  const separatorLength = (state.facet(EditorState.lineSeparator) ?? '\n').length;
  if (separatorLength <= 1 || safeOffset === 0) return safeOffset;
  const line = state.doc.lineAt(safeOffset);
  return safeOffset + (line.number - 1) * (separatorLength - 1);
}

/**
 * 外部本文のオフセットをCodeMirror内部の改行正規化済みオフセットへ変換する。
 * @param state 変換対象のCodeMirror状態。
 * @param offset 外部本文上のオフセット。
 * @returns CodeMirror内部オフセット。
 */
function externalOffsetToEditor(state: EditorState, offset: number): number {
  const separatorLength = (state.facet(EditorState.lineSeparator) ?? '\n').length;
  if (separatorLength <= 1) return Math.max(0, Math.min(offset, state.doc.length));
  const externalLength = state.doc.length + (state.doc.lines - 1) * (separatorLength - 1);
  const target = Math.max(0, Math.min(offset, externalLength));
  let low = 0;
  let high = state.doc.length;
  // CRLFの2文字目など内部位置を持たない外部オフセットは、次行先頭へ写像する。
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const line = state.doc.lineAt(middle);
    const external = middle + (line.number - 1) * (separatorLength - 1);
    if (external < target) low = middle + 1;
    else high = middle;
  }
  return low;
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
 * CodeMirrorのスクロール位置から、表示中ブロックの外部本文アンカーを読む。
 * @param view 表示位置を取得するCodeMirrorビュー。
 * @returns 現在の表示アンカー。ビューが非表示ならundefined。
 */
function readViewport(view: EditorView): EditorViewportAnchor | undefined {
  if (view.scrollDOM.clientHeight === 0) return undefined;
  const scrollTop = view.scrollDOM.scrollTop;
  const block = view.lineBlockAtHeight(scrollTop);
  // lineBlockAtHeightは、ブロックWidgetや行内ブロックの境界ではfrom === toを返すことがある。
  // endOffsetは「先頭ブロックの終端」ではなく実際の可視領域下端として公開し、
  // 復元対象が同じ先頭行の途中にある場合も可視範囲内と正しく判定できるようにする。
  const viewportBottom = Math.max(scrollTop, scrollTop + view.scrollDOM.clientHeight - 1);
  const bottomBlock = view.lineBlockAtHeight(viewportBottom);
  return {
    offset: editorOffsetToExternal(view.state, block.from),
    topOffset: block.top - scrollTop,
    endOffset: editorOffsetToExternal(view.state, Math.max(block.to, bottomBlock.to)),
    scrollRatio: getScrollRatio(
      scrollTop,
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

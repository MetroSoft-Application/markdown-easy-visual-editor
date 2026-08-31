import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import TurndownService from 'turndown';
import { gfm as turndownGfm } from 'turndown-plugin-gfm';
import type {
  EditorMode,
  HostToWebviewMessage,
  HtmlExportOptions,
  ImagePayload,
  PdfOptions,
  VsCodeApi,
  ViewMode,
  WebviewSettings,
  WebviewToHostMessage
} from '../shared/protocol';
import {
  applyMarkdownTableAction,
  applyMarkdownTableTsv,
  collectDiagnostics,
  createTableMarkdown,
  getOutline,
  imageMarkdown,
  isMarkdownCodeFencePosition,
  markdownTableToTsv,
  sortDiagnostics,
  summarizeDiagnostics,
  type Diagnostic,
  type OutlineItem,
  type TextSelection,
  wordStats
} from '../shared/markdown';
import {
  applyTextChanges,
  computeTextChanges,
  mapTextChanges,
  mapTextOffset,
  type TextChange
} from '../shared/textChanges';
import {
  alignImageInMarkdown,
  resetImageSizeInMarkdown,
  resizeImageInMarkdown,
  type ImageAlignment
} from '../shared/imageResize';
import { getMessages, type Messages } from '../shared/messages';
import { prepareExportHtml } from '../shared/exportHtml';
import { createClientId } from './id';
import { isMveDebugEnabled, mveDebug } from './debug';
import { escapeHtml, renderMarkdown, sanitizeRenderedMarkdown } from './markdownRenderer';
import type { UnsafeMarkdownBlock } from './markdownRendererCore';
import { acceptMermaidRenderResult } from './mermaidRenderer';
import { RenderedMarkdown, type InspectorTarget } from './RenderedMarkdown';
import { PdfDocumentPreview } from './PdfDocumentPreview';
import { Ribbon, type RibbonCommand } from './Ribbon';
import { SourceEditor, type EditorViewportAnchor, type TextEditorHandle } from './SourceEditor';
import {
  capturePreviewViewport,
  restoreScrollRatio,
  restorePreviewViewport,
  type PreviewViewportAnchor
} from './scrollAnchors';

declare const acquireVsCodeApi: <State = unknown>() => VsCodeApi<State>;

interface PersistedState {
  mode: EditorMode;
  outlineVisible: boolean;
  splitRatio?: number;
  outlineWidth?: number;
  zoom?: number;
  /** 通常表示で選択したペイン構成。splitViewは旧バージョン互換用に残す。 */
  viewMode?: ViewMode;
  splitView?: 'both' | 'text' | 'preview';
  sourceViewport?: EditorViewportAnchor;
  splitPreviewViewport?: PreviewViewportAnchor;
  previewOnlyViewport?: PreviewViewportAnchor;
}

interface PendingLocalOperation {
  opId: string;
  baseVersion: number;
  baseText: string;
  resultText: string;
  changes: TextChange[];
}

type LocalResourceCheckPurpose = 'preflight' | 'pdf';

interface LocalResourceCheckRequest {
  markdown: string;
  version: number;
  generation: number;
  purpose: LocalResourceCheckPurpose;
}

interface PdfPreviewState {
  requestId: string;
  pdfBase64?: string;
  loading: boolean;
  error?: string;
}

const vscode = acquireVsCodeApi<PersistedState>();
const CROSS_PANE_SCROLL_SYNC_MS = 32;
const DEFAULT_SETTINGS: WebviewSettings = {
  language: 'ja',
  imageDirectory: 'assets/${documentBasename}',
  maxPasteSizeMb: 20,
  remoteImagesEnabled: true,
  mermaidTheme: 'auto',
  viewMode: 'both',
  workspaceTrusted: false
};
const DEFAULT_PDF: PdfOptions = {
  format: 'A4',
  orientation: 'portrait',
  margins: { top: 15, right: 15, bottom: 15, left: 15 },
  header: '',
  footer: '{page}/{pages}',
  saveWithoutDialog: true
};

const PREVIEW_UPDATE_DELAY_MS = 120;

type HelpTopic = 'shortcuts' | 'features';

function mergeDiagnostics(markdown: string, localResourceDiagnostics: Diagnostic[], language: WebviewSettings['language']): Diagnostic[] {
  return mergeCollectedDiagnostics(collectDiagnostics(markdown, language), localResourceDiagnostics);
}

interface MarkdownPreviewSnapshot {
  markdown: string;
  html: string;
  outline: OutlineItem[];
  diagnostics: Diagnostic[];
  stats: { markdown: number; text: number; lines: number };
}

interface MarkdownWorkerResponse {
  id: number;
  markdown?: string;
  unsafeBlocks?: UnsafeMarkdownBlock[];
  outline?: OutlineItem[];
  diagnostics?: Diagnostic[];
  stats?: { markdown: number; text: number; lines: number };
  error?: string;
}

function mergeCollectedDiagnostics(staticDiagnostics: Diagnostic[], localResourceDiagnostics: Diagnostic[]): Diagnostic[] {
  const missingImages = new Set(
    localResourceDiagnostics
      .filter((item) => item.code === 'missing-local-image' && item.source)
      .map((item) => item.source as string)
  );
  const filteredStaticDiagnostics = staticDiagnostics.filter((item) => (
    item.code !== 'local-image' || !item.source || !missingImages.has(item.source)
  ));
  return sortDiagnostics([...filteredStaticDiagnostics, ...localResourceDiagnostics]);
}

/**
 * Markdown編集画面全体を描画し、ホストとの同期・検索・プレビュー・各種ダイアログを管理する。
 * @returns Markdown Easy Visual EditorのアプリケーションUI。
 */
export function App(): React.JSX.Element {
  const restored = vscode.getState();
  const hasRestoredViewMode = restored?.viewMode !== undefined || restored?.splitView !== undefined;
  // modeのpreviewは印刷プレビュー用の一時状態だったため、通常表示としては復元しない。
  const [mode, setMode] = useState<EditorMode>('split');
  const [outlineVisible, setOutlineVisible] = useState(restored?.outlineVisible ?? true);
  const [outlineWidth, setOutlineWidth] = useState(() => clampOutlineWidth(restored?.outlineWidth ?? 220));
  const [splitRatio, setSplitRatio] = useState(() => clampSplitRatio(restored?.splitRatio ?? 0.5));
  const [zoom, setZoom] = useState(() => clampZoom(restored?.zoom ?? 1));
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [splitView, setSplitView] = useState<ViewMode>(restoreViewMode(restored?.viewMode ?? restored?.splitView));
  const [initialized, setInitialized] = useState(false);
  const [markdown, setMarkdown] = useState('');
  // 入力経路と、解析・HTML化が重い表示経路を分離する。入力が再開した場合は
  // 既に予約済みの全文更新を同期的に取り消し、キーイベントへ割り込ませない。
  const [previewMarkdown, cancelPendingPreviewUpdate] = useInterruptibleDebouncedValue(
    markdown,
    PREVIEW_UPDATE_DELAY_MS
  );
  const [version, setVersion] = useState(0);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [previewSnapshot, cancelActivePreviewRender] = useMarkdownPreviewSnapshot(
    previewMarkdown,
    settings.remoteImagesEnabled,
    settings.language
  );
  const cancelPreviewWork = useCallback(() => {
    if (document.body.dataset.mveInputActive !== 'true') {
      document.body.dataset.mveInputActive = 'true';
      window.dispatchEvent(new Event('mve-preview-input-active'));
    }
    cancelPendingPreviewUpdate();
    cancelActivePreviewRender();
  }, [cancelPendingPreviewUpdate, cancelActivePreviewRender]);
  const renderedPreviewMarkdown = previewSnapshot.markdown;
  const messages = useMemo(() => getMessages(settings.language), [settings.language]);
  useEffect(() => {
    if (settings.language) document.documentElement.lang = settings.language;
  }, [settings.language]);
  // HTML/PDFの出力先は白背景のため、VS CodeのダークテーマをSVGへ持ち込まない。
  const exportSettings = useMemo(() => ({ ...settings, mermaidTheme: 'default' as const }), [settings]);
  const [activeMarks, setActiveMarks] = useState<Record<string, boolean>>({});
  const activeMarksRef = useRef<Record<string, boolean>>({});
  const [inspector, setInspector] = useState<InspectorTarget>();
  const [diagnosticsVisible, setDiagnosticsVisible] = useState(false);
  const [localResourceDiagnostics, setLocalResourceDiagnostics] = useState<Diagnostic[]>([]);
  const [printPreview, setPrintPreview] = useState(false);
  const [printSettingsVisible, setPrintSettingsVisible] = useState(false);
  const [helpTopic, setHelpTopic] = useState<HelpTopic>();
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchReplacement, setSearchReplacement] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [linkDialogVisible, setLinkDialogVisible] = useState(false);
  const [linkHref, setLinkHref] = useState('https://example.com');
  const [linkLabel, setLinkLabel] = useState('');
  const [pdfOptions, setPdfOptions] = useState(DEFAULT_PDF);
  const [pdfPreview, setPdfPreview] = useState<PdfPreviewState>({ requestId: '', loading: false });
  const [htmlRenderRequest, setHtmlRenderRequest] = useState<Extract<HostToWebviewMessage, { type: 'renderHtmlDocuments' }>>();
  const [exportStageRequested, setExportStageRequested] = useState(false);
  const [toast, setToast] = useState('');

  const clientIdRef = useRef(createClientId());
  const sourceRef = useRef<TextEditorHandle>(null);
  const splitPreviewRef = useRef<HTMLDivElement>(null);
  const editorAreaRef = useRef<HTMLElement>(null);
  const exportRootRef = useRef<HTMLDivElement>(null);
  const exportStageWaitersRef = useRef<Array<(root: HTMLDivElement | undefined) => void>>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const hostTextRef = useRef('');
  const localTextRef = useRef('');
  const markdownForSelectionRef = useRef(markdown);
  const updateMarkdownRef = useRef<(
    nextText: string,
    knownChanges?: TextChange[],
    origin?: 'local' | 'remote',
    updateRenderedState?: boolean
  ) => void>(() => undefined);
  const versionRef = useRef(0);
  const initializedRef = useRef(false);
  // ACK待ちは常に1件だけとし、その間の入力はlocalTextRefの最新値へ上書き集約する。
  const inFlightOperationRef = useRef<PendingLocalOperation | undefined>(undefined);
  const pendingHistoryCommandsRef = useRef<Array<'undo' | 'redo'>>([]);
  const selectionStateRef = useRef<TextSelection>({ from: 0, to: 0 });
  const imageRequestsRef = useRef(new Set<string>());
  const pdfRequestsRef = useRef(new Set<string>());
  const htmlRequestsRef = useRef(new Set<string>());
  const pdfPreviewRequestRef = useRef('');
  const pdfPreviewSignatureRef = useRef<string | undefined>(undefined);
  const pdfPreviewTimerRef = useRef<number | undefined>(undefined);
  const resourceCheckRequestsRef = useRef(new Map<string, LocalResourceCheckRequest>());
  const resourceCheckGenerationRef = useRef(0);
  const latestResourceCheckRequestRef = useRef('');
  const viewportStateRef = useRef({
    source: restored?.sourceViewport,
    splitPreview: restored?.splitPreviewViewport,
    previewOnly: restored?.previewOnlyViewport
  });
  const pendingViewportRestoreRef = useRef(false);
  const pendingSourceViewportRestoreRef = useRef<EditorViewportAnchor | undefined>(undefined);
  const skipNextSourceViewportRestoreRef = useRef(false);
  const pendingPreviewViewportRestoreRef = useRef<{
    splitPreview?: PreviewViewportAnchor;
    previewOnly?: PreviewViewportAnchor;
  }>({});
  const pendingNavigationRef = useRef<TextSelection | undefined>(undefined);
  const recentRibbonCommandsRef = useRef(new Map<string, number>());
  const previousModeBeforePrintRef = useRef<EditorMode>('split');
  const previewUserScrollPendingRef = useRef(new WeakSet<HTMLElement>());
  const previewPointerScrollActiveRef = useRef(new WeakSet<HTMLElement>());
  const previewTouchScrollActiveRef = useRef(new WeakSet<HTMLElement>());
  // 復元が複数・遅延scrollイベントを発生させても、明示入力まで逆同期させない。
  const programmaticPreviewScrollsRef = useRef(new WeakSet<HTMLElement>());
  const pendingPreviewScrollsRef = useRef(new Map<HTMLElement, {
    kind: 'splitPreview' | 'previewOnly';
    userInitiated: boolean;
  }>());
  const previewScrollFrameRef = useRef<number | undefined>(undefined);
  const previewToSourceSyncTimerRef = useRef<number | undefined>(undefined);
  const sourceToPreviewSyncTimerRef = useRef<number | undefined>(undefined);
  const pendingPreviewToSourceAnchorRef = useRef<PreviewViewportAnchor | undefined>(undefined);
  const pendingSourceToPreviewAnchorRef = useRef<EditorViewportAnchor | undefined>(undefined);
  const lastPreviewToSourceSyncRef = useRef(0);
  const lastSourceToPreviewSyncRef = useRef(0);
  const lastPreviewUserScrollAtRef = useRef(0);
  const pendingRenderedPreviewKindsRef = useRef(new Set<'splitPreview' | 'previewOnly'>());
  const renderedPreviewRestoreFrameRef = useRef<number | undefined>(undefined);
  const renderedPreviewRestoreTimerRef = useRef<number | undefined>(undefined);
  const viewportUserIntentGenerationRef = useRef(0);
  const settledOperationIdsRef = useRef(new Set<string>());
  const resyncInFlightRef = useRef(false);
  // 同じHostスナップショットへの再送は1回だけに制限し、失敗時の自動再同期ループを防ぐ。
  // 全文連結キーを作らず、既存スナップショットへの参照だけを保持する。
  const lastAutomaticRetryRef = useRef<{
    version: number;
    hostText: string;
    localText: string;
  } | undefined>(undefined);
  const persistViewStateRef = useRef<(viewModeOverride?: ViewMode) => void>(() => undefined);
  const persistViewStateTimerRef = useRef<number | undefined>(undefined);
  const pendingPersistViewModeRef = useRef<ViewMode | undefined>(undefined);
  const hostMessageHandlerRef = useRef<(message: HostToWebviewMessage) => void>(() => undefined);
  versionRef.current = version;
  markdownForSelectionRef.current = markdown;
  hostMessageHandlerRef.current = handleHostMessage;

  /**
   * 現在の表示モードで編集可能なSourceEditorを取得する。
   * @returns 操作対象のエディター。プレビューのみの場合はundefined。
   */
  function getActiveEditor(): TextEditorHandle | undefined {
    if (mode === 'split' && splitView !== 'preview') return sourceRef.current ?? undefined;
    return undefined;
  }

  const outline = previewSnapshot.outline;
  const diagnostics = useMemo(
    () => mergeCollectedDiagnostics(previewSnapshot.diagnostics, localResourceDiagnostics),
    [previewSnapshot.diagnostics, localResourceDiagnostics]
  );
  const diagnosticSummary = useMemo(() => summarizeDiagnostics(diagnostics), [diagnostics]);
  const stats = previewSnapshot.stats;
  const searchHits = useMemo(
    () => findSearchHits(renderedPreviewMarkdown, searchQuery),
    [renderedPreviewMarkdown, searchQuery]
  );
  const previewHtml = previewSnapshot.html;

  useEffect(() => {
    // ホストへWebviewの準備完了を通知し、以後のメッセージを現在のハンドラーへ渡す。
    mveDebug('webview.ready', { clientId: clientIdRef.current });
    vscode.postMessage({ type: 'ready', clientId: clientIdRef.current });
    /** ホストから受信したメッセージをアプリのメッセージ処理へ渡す。 */
    const onMessage = (event: MessageEvent<HostToWebviewMessage>) => hostMessageHandlerRef.current(event.data);
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      if (persistViewStateTimerRef.current !== undefined) {
        window.clearTimeout(persistViewStateTimerRef.current);
        persistViewStateTimerRef.current = undefined;
      }
      if (previewScrollFrameRef.current !== undefined) {
        window.cancelAnimationFrame(previewScrollFrameRef.current);
        previewScrollFrameRef.current = undefined;
      }
      if (previewToSourceSyncTimerRef.current !== undefined) {
        window.clearTimeout(previewToSourceSyncTimerRef.current);
        previewToSourceSyncTimerRef.current = undefined;
      }
      if (sourceToPreviewSyncTimerRef.current !== undefined) {
        window.clearTimeout(sourceToPreviewSyncTimerRef.current);
        sourceToPreviewSyncTimerRef.current = undefined;
      }
      if (renderedPreviewRestoreFrameRef.current !== undefined) {
        window.cancelAnimationFrame(renderedPreviewRestoreFrameRef.current);
        renderedPreviewRestoreFrameRef.current = undefined;
      }
      if (renderedPreviewRestoreTimerRef.current !== undefined) {
        window.clearTimeout(renderedPreviewRestoreTimerRef.current);
        renderedPreviewRestoreTimerRef.current = undefined;
      }
      pendingPreviewScrollsRef.current.clear();
      pendingPreviewToSourceAnchorRef.current = undefined;
      pendingSourceToPreviewAnchorRef.current = undefined;
      pendingRenderedPreviewKindsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    // 表示モードやレイアウト設定をVS CodeのWebview状態へ保存する。
    persistViewState();
  }, [outlineVisible, outlineWidth, splitRatio, zoom, splitView]);

  useEffect(() => {
    // 本文が変わったら、前の本文に対するローカル参照診断を破棄する。
    resourceCheckGenerationRef.current += 1;
    setLocalResourceDiagnostics((previous) => previous.length ? [] : previous);
  }, [markdown]);

  useEffect(() => {
    if (!printPreview) pdfPreviewSignatureRef.current = undefined;
  }, [printPreview]);

  useEffect(() => {
    if (!printPreview || !initialized || !settings.workspaceTrusted) return;
    if (pdfPreviewTimerRef.current !== undefined) window.clearTimeout(pdfPreviewTimerRef.current);
    pdfPreviewTimerRef.current = window.setTimeout(() => {
      pdfPreviewTimerRef.current = undefined;
      requestPdfPreview();
    }, 350);
    return () => {
      if (pdfPreviewTimerRef.current !== undefined) {
        window.clearTimeout(pdfPreviewTimerRef.current);
        pdfPreviewTimerRef.current = undefined;
      }
    };
  }, [initialized, markdown, pdfOptions, printPreview, settings.language, settings.remoteImagesEnabled, version]);

  useEffect(() => {
    // 検索パネルが開いた直後に入力欄へフォーカスし、既存文字列を選択する。
    if (!searchVisible) return;
    const frame = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [searchVisible]);

  useEffect(() => {
    // 検索結果の現在位置をソースエディターへ選択・表示する。
    if (!searchVisible || !searchHits.length) return;
    const active = searchHits[Math.min(searchIndex, searchHits.length - 1)];
    if (mode === 'split' && splitView !== 'preview') {
      sourceRef.current?.setSelection(active);
      sourceRef.current?.revealRange(active);
    }
  }, [searchVisible, searchHits, searchIndex, mode, splitView]);

  useEffect(() => {
    // リモート画像設定をCSSから参照できるbody属性へ反映する。
    document.body.dataset.remoteImagesEnabled = String(settings.remoteImagesEnabled);
  }, [settings.remoteImagesEnabled]);

  useEffect(() => {
    // CtrlまたはCmdを押しながらのホイール入力で表示倍率を変更する。
    const editorArea = editorAreaRef.current;
    if (!editorArea) return;
    /** Ctrl/Cmdホイールをズーム操作へ変換する。 */
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      adjustZoom(event.deltaY < 0 ? 0.1 : -0.1);
    };
    editorArea.addEventListener('wheel', onWheel, { passive: false });
    return () => editorArea.removeEventListener('wheel', onWheel);
  }, [initialized]);

  /** 現在の表示倍率を変更し、PDFを含む表示位置を維持する。 */
  function adjustZoom(delta: number): void {
    captureVisibleViewports();
    pendingViewportRestoreRef.current = true;
    const previous = zoomRef.current;
    const next = clampZoom(previous + delta);
    if (next === previous) {
      mveDebug('zoom.unchanged', { delta, zoom: previous, mode, splitView, printPreview });
      return;
    }
    zoomRef.current = next;
    mveDebug('zoom.changed', {
      delta,
      previous,
      next,
      mode,
      splitView,
      printPreview
    });
    setZoom(next);
  }

  useLayoutEffect(() => {
    // 保留した選択移動または表示位置復元をレイアウト確定後に実行する。
    const navigation = pendingNavigationRef.current;
    if (navigation && mode === 'split' && splitView !== 'preview' && sourceRef.current) {
      sourceRef.current.setSelection(navigation);
      sourceRef.current.revealRange(navigation);
      const preview = splitPreviewRef.current;
      if (preview) {
        const previewAnchor: PreviewViewportAnchor = {
          offset: navigation.from,
          topOffset: 18
        };
        viewportStateRef.current.splitPreview = previewAnchor;
        // CodeMirrorのrevealRangeと同じ描画世代で、プレビューも選択位置へ揃える。
        requestAnimationFrame(() => {
          if (splitPreviewRef.current === preview) restorePreview(preview, previewAnchor);
        });
      }
      pendingNavigationRef.current = undefined;
      pendingViewportRestoreRef.current = false;
      return;
    }
    if (!pendingViewportRestoreRef.current) return;
    // Markdown Workerが旧プレビューを表示している間は復元を消化しない。
    // 最新世代のDOMが確定したレイアウトで一度だけ復元する。
    if (renderedPreviewMarkdown !== markdown) return;
    const frame = requestAnimationFrame(() => {
      restoreVisibleViewports();
      pendingViewportRestoreRef.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [mode, splitView, zoom, splitRatio, outlineVisible, diagnosticsVisible, Boolean(inspector), markdown, renderedPreviewMarkdown]);

  useLayoutEffect(() => {
    const area = editorAreaRef.current;
    const split = area?.querySelector<HTMLElement>('.split-editor');
    const source = area?.querySelector<HTMLElement>('.split-source-pane');
    const preview = area?.querySelector<HTMLElement>('.split-preview-pane');
    if (!area) return;
    const size = (element: HTMLElement | null) => {
      if (!element) return undefined;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
        display: style.display
      };
    };
    mveDebug('view.layout', {
      mode,
      splitView,
      editorArea: size(area),
      split: size(split ?? null),
      source: size(source ?? null),
      preview: size(preview ?? null),
      columns: split ? getComputedStyle(split).gridTemplateColumns : undefined
    });
  }, [initialized, mode, splitView, outlineVisible, splitRatio, zoom, diagnosticsVisible, Boolean(inspector)]);

  useEffect(() => {
    // リサイズ中に各ペインの表示アンカーを保存し、リサイズ後に同じ位置へ戻す。
    let frame = 0;
    let resetSnapshotTimer = 0;
    let resizeSnapshot: {
      source?: EditorViewportAnchor;
      splitPreview?: PreviewViewportAnchor;
      previewOnly?: PreviewViewportAnchor;
      intentGeneration: number;
    } | undefined;
    /** ウィンドウサイズ変更時の表示スナップショットを作成または更新する。 */
    const onResize = () => {
      if (!resizeSnapshot) {
        resizeSnapshot = {
          source: viewportStateRef.current.source ? { ...viewportStateRef.current.source } : undefined,
          splitPreview: viewportStateRef.current.splitPreview ? { ...viewportStateRef.current.splitPreview } : undefined,
          previewOnly: viewportStateRef.current.previewOnly ? { ...viewportStateRef.current.previewOnly } : undefined,
          intentGeneration: viewportUserIntentGenerationRef.current
        };
      }
      pendingSourceViewportRestoreRef.current = resizeSnapshot.source
        ? { ...resizeSnapshot.source }
        : undefined;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const snapshot = resizeSnapshot;
        if (!snapshot || snapshot.intentGeneration !== viewportUserIntentGenerationRef.current) return;
        if (mode === 'split' && splitView !== 'preview' && snapshot.source) {
          sourceRef.current?.restoreViewport(snapshot.source);
        }
        if (mode === 'split' && splitView !== 'text' && splitPreviewRef.current && snapshot.splitPreview) {
          restorePreview(splitPreviewRef.current, snapshot.splitPreview);
        }
        if (mode === 'preview' && editorAreaRef.current && snapshot.previewOnly) {
          restorePreview(editorAreaRef.current, snapshot.previewOnly);
        }
      });
      window.clearTimeout(resetSnapshotTimer);
      resetSnapshotTimer = window.setTimeout(() => { resizeSnapshot = undefined; }, 120);
    };
    /** プレビューのポインタースクロール状態を解除する。 */
    const endPreviewPointerScroll = () => {
      const splitPreview = splitPreviewRef.current;
      const editorArea = editorAreaRef.current;
      if (splitPreview) previewPointerScrollActiveRef.current.delete(splitPreview);
      if (editorArea) previewPointerScrollActiveRef.current.delete(editorArea);
    };
    /** プレビューのタッチスクロール状態を解除する。 */
    const endPreviewTouchScroll = () => {
      const splitPreview = splitPreviewRef.current;
      const editorArea = editorAreaRef.current;
      if (splitPreview) previewTouchScrollActiveRef.current.delete(splitPreview);
      if (editorArea) previewTouchScrollActiveRef.current.delete(editorArea);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('pointerup', endPreviewPointerScroll);
    window.addEventListener('pointercancel', endPreviewPointerScroll);
    window.addEventListener('touchend', endPreviewTouchScroll);
    window.addEventListener('touchcancel', endPreviewTouchScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(resetSnapshotTimer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointerup', endPreviewPointerScroll);
      window.removeEventListener('pointercancel', endPreviewPointerScroll);
      window.removeEventListener('touchend', endPreviewTouchScroll);
      window.removeEventListener('touchcancel', endPreviewTouchScroll);
    };
  }, [initialized, mode, splitView]);

  useEffect(() => {
    // 貼り付け・ドラッグ&ドロップ・キーボードショートカットを文書編集へ接続する。
    /** 貼り付けイベントを画像またはHTML貼り付け処理へ渡す。 */
    const onPaste = (event: ClipboardEvent) => void handlePaste(event);
    /** 編集可能な場合だけ画像ファイルのドラッグを受け付ける。 */
    const onDragOver = (event: DragEvent) => {
      if (isEditingEnabled(mode, splitView) && Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === 'file')) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      }
    };
    /** ドロップされた画像ファイルをローカル保存して本文へ挿入する。 */
    const onDrop = (event: DragEvent) => {
      if (!isEditingEnabled(mode, splitView)) return;
      const files = Array.from(event.dataTransfer?.files ?? []).filter(isImageFile);
      if (!files.length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void saveImageFiles(files);
    };
    /** 検索ショートカットと表内改行ショートカットを処理する。 */
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : undefined;
      const inApp = Boolean(target?.closest('.app'));
      const inSourceEditor = Boolean(target?.closest('.cm-content'));
      const inFormControl = Boolean(target?.closest('input, textarea, select'));
      if (inApp && (inSourceEditor || !inFormControl) && !event.isComposing
        && (event.ctrlKey || event.metaKey) && !event.altKey) {
        const key = event.key.toLowerCase();
        const command = key === 'z'
          ? (event.shiftKey ? 'redo' : 'undo')
          : key === 'y' && !event.shiftKey
            ? 'redo'
            : undefined;
        if (command) {
          event.preventDefault();
          event.stopImmediatePropagation();
          requestHistoryCommand(command);
          return;
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        openSearch();
        return;
      }
      if (event.altKey && event.key === 'Enter' && isEditingEnabled(mode, splitView)) {
        event.preventDefault();
        getActiveEditor()?.action('cellBreak');
      }
    };
    document.addEventListener('paste', onPaste, true);
    document.addEventListener('dragover', onDragOver, true);
    document.addEventListener('drop', onDrop, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('paste', onPaste, true);
      document.removeEventListener('dragover', onDragOver, true);
      document.removeEventListener('drop', onDrop, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [mode, splitView, settings.maxPasteSizeMb]);

  useEffect(() => {
    // 通知トーストを一定時間後に自動的に閉じる。
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  /**
   * ホストからのメッセージを初期化・ACK・外部変更・再同期・設定・コマンドへ振り分ける。
   * @param message ホストから受信したメッセージ。
   * @returns 何も返さない。
   */
  function handleHostMessage(message: HostToWebviewMessage): void {
    const record = message as unknown as Record<string, unknown>;
    if (isMveDebugEnabled()) {
      mveDebug('host.message', {
        type: message.type,
        clientId: record.clientId,
        opId: record.opId,
        baseVersion: record.baseVersion,
        version: record.version,
        reason: record.reason
      });
    }
    // ホスト側の判定タイミングによって自分の操作がexternalChangesとして返る場合がある。
    // これを未反映のローカル操作としてリベースすると、末尾挿入が同じ内容を二重に挿入する。
    if (message.type === 'externalChanges'
      && message.clientId === clientIdRef.current
      && message.opId
      && !settledOperationIdsRef.current.has(message.opId)) {
      handleHostMessage({
        type: 'editAck',
        clientId: message.clientId,
        opId: message.opId,
        baseVersion: message.baseVersion,
        version: message.version,
        changes: message.changes
      });
      return;
    }
    switch (message.type) {
      case 'init':
        if (initializedRef.current) {
          setSettings(message.settings);
          if (message.version !== versionRef.current || message.text !== hostTextRef.current) {
            applyResyncSnapshot(message.text, message.version, '再初期化通知を受信しました。');
          }
          return;
        }
        initializedRef.current = true;
        resyncInFlightRef.current = false;
        setInitialized(true);
        hostTextRef.current = message.text;
        versionRef.current = message.version;
        setVersion(message.version);
        setSettings(message.settings);
        if (!hasRestoredViewMode && message.settings.viewMode) {
          setSplitView(restoreViewMode(message.settings.viewMode));
        }
        if (!inFlightOperationRef.current) {
          localTextRef.current = message.text;
          setMarkdown(message.text);
        }
        return;
      case 'editAck': {
        if (message.clientId !== clientIdRef.current) return;
        const pending = inFlightOperationRef.current;
        if (!pending || pending.opId !== message.opId) {
          if (!settledOperationIdsRef.current.has(message.opId)) {
            console.warn('[Markdown Easy Visual Editor] 順序外のACKを破棄しました。', message.opId);
            requestResync('unexpected-ack', message.opId);
          }
          return;
        }
        if (message.baseVersion !== versionRef.current) {
          console.warn('[Markdown Easy Visual Editor] ACKの文書versionが一致しないため再同期します。', {
            expected: versionRef.current,
            received: message.baseVersion,
            opId: message.opId
          });
          requestResync('ack-version-mismatch', message.opId);
          return;
        }
        try {
          hostTextRef.current = applyTextChanges(hostTextRef.current, message.changes);
          if (hostTextRef.current !== pending.resultText) {
            throw new Error(messages.app.errors.ackMismatch);
          }
        } catch (error) {
          console.warn('[Markdown Easy Visual Editor] ACK差分を適用できないため再同期します。', error);
          requestResync('ack-apply-failed', message.opId);
          return;
        }
        versionRef.current = message.version;
        setVersion(message.version);
        inFlightOperationRef.current = undefined;
        lastAutomaticRetryRef.current = undefined;
        rememberSettledOperation(message.opId);
        sendNextLocalOperation();
        flushHistoryCommands();
        return;
      }
      case 'externalChanges':
        applyExternalChanges(message);
        return;
      case 'resyncRequired':
        if (message.clientId !== clientIdRef.current) return;
        applyResyncSnapshot(
          message.text,
          message.version,
          message.reason,
          message.opId,
          message.operationApplied
        );
        return;
      case 'settingsChanged':
        setSettings(message.settings);
        if (message.settings.viewMode) setSplitView(restoreViewMode(message.settings.viewMode));
        return;
      case 'mermaidRendered':
        acceptMermaidRenderResult(message);
        return;
      case 'imagesSaved':
        imageRequestsRef.current.delete(message.requestId);
        if (message.paths.length) {
          getActiveEditor()?.insert(message.paths.map((item) => imageMarkdown(item, messages.editor.defaultImageAlt)).join('\n'), true);
          setToast(messages.app.toast.imagesSaved(message.paths.length));
        }
        return;
      case 'localResourcesChecked':
        {
          const request = resourceCheckRequestsRef.current.get(message.requestId);
          resourceCheckRequestsRef.current.delete(message.requestId);
          if (!request
            || request.markdown !== markdown
            || request.version !== versionRef.current
            || request.generation !== resourceCheckGenerationRef.current
            || message.requestId !== latestResourceCheckRequestRef.current) return;
          if (message.diagnostics.length && request.purpose === 'pdf') {
            const detail = message.diagnostics
              .map((item) => `${item.line ? `行${item.line}: ` : ''}${item.message}`)
              .join(' / ');
            setToast(messages.app.toast.pdfResourceWarnings(message.diagnostics.length, detail));
          } else if (request.purpose === 'preflight') {
            const summary = summarizeDiagnostics(mergeDiagnostics(markdown, message.diagnostics, settings.language));
            setToast(messages.app.toast.preflightSummary(summary.errors.length, summary.warnings.length, summary.infos.length));
          }
        }
        setLocalResourceDiagnostics(message.diagnostics);
        return;
      case 'operationFailed':
        {
          if (message.requestId && message.requestId === pdfPreviewRequestRef.current) {
            setPdfPreview((previous) => ({ ...previous, loading: false, error: message.message }));
            console.error('[Markdown Easy Visual Editor] PDF preview failed.', message.message);
            return;
          }
          const imageFailed = message.requestId ? imageRequestsRef.current.delete(message.requestId) : false;
          const pdfFailed = message.requestId ? pdfRequestsRef.current.delete(message.requestId) : false;
          const htmlFailed = message.requestId ? htmlRequestsRef.current.delete(message.requestId) : false;
          const resourceCheckRequest = message.requestId
            ? resourceCheckRequestsRef.current.get(message.requestId)
            : undefined;
          const resourceCheckFailed = message.requestId ? resourceCheckRequestsRef.current.delete(message.requestId) : false;
          setToast(imageFailed ? messages.app.toast.imageSaveFailed(message.message)
            : pdfFailed ? messages.app.toast.pdfExportFailed(message.message)
              : htmlFailed ? messages.app.toast.htmlExportFailed(message.message)
              : resourceCheckFailed
                ? messages.app.toast.resourceCheckFailed(message.message, resourceCheckRequest?.purpose === 'pdf')
                : messages.app.toast.operationFailed(message.message));
        }
            console.error('[Markdown Easy Visual Editor] 操作に失敗しました。', message.message);
        return;
      case 'pdfExported':
        pdfRequestsRef.current.delete(message.requestId);
        setToast(messages.app.toast.pdfExported(message.path));
        return;
      case 'htmlExported':
        htmlRequestsRef.current.delete(message.requestId);
        setToast(messages.app.toast.htmlExported(message.paths[0] ?? '', message.paths.length));
        return;
      case 'renderHtmlDocuments':
        setHtmlRenderRequest(message);
        return;
      case 'pdfPreviewReady':
        if (message.requestId !== pdfPreviewRequestRef.current) return;
        setPdfPreview({ requestId: message.requestId, pdfBase64: message.pdfBase64, loading: false });
        return;
      case 'hostCommand':
        if (message.command === 'insertImage') requestImagePicker();
        if (message.command === 'exportPdf') void requestPdfExport();
        if (message.command === 'undo' || message.command === 'redo') requestHistoryCommand(message.command);
        return;
    }
  }

  /**
   * ホストから届いた外部差分を、送信中操作と最新ローカル本文へ再適用する。
   * @param message 外部差分と新しい文書バージョンを含むメッセージ。
   * @returns 何も返さない。
   */
  function applyExternalChanges(message: Extract<HostToWebviewMessage, { type: 'externalChanges' }>): void {
    if (message.baseVersion !== versionRef.current) {
      requestResync(`外部変更の基準versionが一致しません: ${message.baseVersion}/${versionRef.current}`);
      return;
    }
    const previousHost = hostTextRef.current;
    const operation = inFlightOperationRef.current;
    if (operation?.baseText === previousHost) {
      try {
        // clientId/opIdが欠落した自己エコーでも、ホスト結果が送信中操作と一致するならACKとして確定する。
        // 一致しない場合だけ通常の外部変更リベースへ進み、末尾貼り付けを再挿入しない。
        const externallyApplied = applyTextChanges(previousHost, message.changes);
        if (externallyApplied === operation.resultText) {
          handleHostMessage({
            type: 'editAck',
            clientId: clientIdRef.current,
            opId: operation.opId,
            baseVersion: message.baseVersion,
            version: message.version,
            changes: message.changes
          });
          return;
        }
      } catch {
        // 通常の外部変更処理で再同期理由を記録する。
      }
    }
    try {
      const previousLocal = localTextRef.current;
      const nextHost = applyTextChanges(previousHost, message.changes);
      const remoteClientId = message.clientId ?? 'host';
      const localBeforeRemote = clientIdRef.current.localeCompare(remoteClientId) < 0;
      const localChanges = computeTextChanges(previousHost, previousLocal);
      const mappedLocal = mapTextChanges(
        localChanges,
        message.changes,
        previousHost.length,
        localBeforeRemote
      );
      const rebasedLocal = applyTextChanges(nextHost, mappedLocal);
      if (operation) {
        if (operation.baseText !== previousHost) throw new Error(messages.app.errors.pendingOperationChain(operation.opId));
        const mappedOperation = mapTextChanges(
          operation.changes,
          message.changes,
          previousHost.length,
          localBeforeRemote
        );
        operation.baseVersion = message.version;
        operation.baseText = nextHost;
        operation.changes = mappedOperation;
        operation.resultText = applyTextChanges(nextHost, mappedOperation);
      }
      hostTextRef.current = nextHost;
      versionRef.current = message.version;
      setVersion(message.version);
      updateMarkdown(rebasedLocal, computeTextChanges(previousLocal, rebasedLocal), 'remote');
      if (!operation) sendNextLocalOperation();
      flushHistoryCommands();
    } catch (error) {
      console.warn('[Markdown Easy Visual Editor] 外部変更を統合できないため再同期します。', error);
      requestResync('external-rebase-failed');
    }
  }

  /**
   * ホストの最新本文へ最新ローカル本文だけを再適用し、同期状態を再構築する。
   * @param nextHost ホストが保持する最新本文。
   * @param nextVersion 最新本文のバージョン。
   * @param reason 再同期が発生した理由。
   * @param opId 再同期対象の操作ID。
   * @param operationApplied 対象操作がホスト側で適用済みかどうか。
   * @returns 何も返さない。
   */
  function applyResyncSnapshot(
    nextHost: string,
    nextVersion: number,
    reason: string,
    opId?: string,
    operationApplied?: boolean
  ): void {
    const previousHost = hostTextRef.current;
    const previousLocal = localTextRef.current;
    const operation = inFlightOperationRef.current;
    inFlightOperationRef.current = undefined;
    if (operation) rememberSettledOperation(operation.opId);
    if (opId) rememberSettledOperation(opId);
    resyncInFlightRef.current = false;
    console.warn('[Markdown Easy Visual Editor] 文書同期を再確認しました。', {
      reason,
      opId,
      operationApplied,
      nextVersion
    });
    const refersToOperation = Boolean(operation && (!opId || opId === operation.opId));
    const wasApplied = Boolean(refersToOperation && operation && (
      operationApplied ?? (nextHost === operation.resultText || nextHost === previousLocal)
    ));
    const rebaseBase = wasApplied && operation ? operation.resultText : operation?.baseText ?? previousHost;
    let rebasedText = nextHost;
    try {
      if (previousLocal !== rebaseBase) {
        const localChanges = computeTextChanges(rebaseBase, previousLocal);
        const remoteChanges = computeTextChanges(rebaseBase, nextHost);
        const mapped = mapChangesPreferLocal(localChanges, remoteChanges, rebaseBase.length);
        rebasedText = applyTextChanges(nextHost, mapped);
      }
    } catch (error) {
      console.error('[Markdown Easy Visual Editor] 入力を保持した自動再適用で補正しました。', error);
      const localChanges = computeTextChanges(rebaseBase, previousLocal);
      const remoteChanges = computeTextChanges(rebaseBase, nextHost);
      rebasedText = applyTextChanges(nextHost, mapChangesPreferLocal(localChanges, remoteChanges, rebaseBase.length));
    }
    hostTextRef.current = nextHost;
    versionRef.current = nextVersion;
    setVersion(nextVersion);
    updateMarkdown(rebasedText, computeTextChanges(previousLocal, rebasedText), 'remote');
    // 再同期後にローカル編集が残っている場合だけ再送する。同一スナップショットで
    // 再び失敗した場合は保留し、同じ自動再送を無限に繰り返さない。
    if (rebasedText !== nextHost) {
      const previousRetry = lastAutomaticRetryRef.current;
      const sameSnapshot = previousRetry?.version === nextVersion
        && previousRetry.hostText === nextHost
        && previousRetry.localText === rebasedText;
      if (!sameSnapshot) {
        lastAutomaticRetryRef.current = {
          version: nextVersion,
          hostText: nextHost,
          localText: rebasedText
        };
        sendNextLocalOperation();
      }
    }
    flushHistoryCommands();
  }

  /**
   * ホストへ最新本文の再同期を要求する。要求中は重複送信しない。
   * @param reason 再同期を要求する理由。
   * @param opId 再同期対象の保留操作ID。
   * @returns 何も返さない。
   */
  function requestResync(reason: string, opId = inFlightOperationRef.current?.opId): void {
    if (resyncInFlightRef.current) return;
    resyncInFlightRef.current = true;
    vscode.postMessage({
      type: 'requestResync',
      clientId: clientIdRef.current,
      opId,
      version: versionRef.current,
      reason
    });
  }

  /** プレビュー・出力用stateを、即時同期済みの最新ローカル本文へ進める。 */
  function commitSourceSnapshot(): string {
    const current = localTextRef.current;
    setMarkdown((previous) => previous === current ? previous : current);
    return current;
  }

  /**
   * UndoまたはRedoを保留履歴キューへ追加する。
   * @param command 実行する履歴コマンド。
   * @returns 何も返さない。
   */
  function requestHistoryCommand(command: 'undo' | 'redo'): void {
    commitSourceSnapshot();
    pendingHistoryCommandsRef.current.push(command);
    flushHistoryCommands();
  }

  /**
   * 同期中の操作がない場合に、保留中の履歴コマンドをホストへ送る。
   * @returns 何も返さない。
   */
  function flushHistoryCommands(): void {
    // 未同期のローカル編集は sourceEditorChange / 再同期処理が送信する。
    // ここから再送すると、同一スナップショットへの再同期ループを迂回してしまう。
    if (resyncInFlightRef.current || inFlightOperationRef.current || localTextRef.current !== hostTextRef.current) return;
    const command = pendingHistoryCommandsRef.current.shift();
    if (!command) return;
    vscode.postMessage({
      type: 'historyCommand',
      clientId: clientIdRef.current,
      command
    });
  }

  /**
   * 完了済み操作IDを記録し、記録数が増えすぎないよう古いIDを削除する。
   * @param opId 完了済みとして記録する操作ID。
   * @returns 何も返さない。
   */
  function rememberSettledOperation(opId: string): void {
    const settled = settledOperationIdsRef.current;
    settled.add(opId);
    if (settled.size <= 256) return;
    const oldest = settled.values().next().value as string | undefined;
    if (oldest) settled.delete(oldest);
  }

  /**
   * 表示モード・レイアウト・各ペインの表示位置をWebview状態へ保存する。
   * @param viewModeOverride クリック直後に保存する表示モード。未指定時は現在値を使う。
   * @returns 何も返さない。
   */
  function persistViewState(viewModeOverride?: ViewMode): void {
    const savedViewMode = viewModeOverride ?? splitView;
    vscode.setState({
      // 印刷プレビュー中にWebviewが再生成されても、通常の表示設定を復元する。
      mode: 'split',
      outlineVisible,
      outlineWidth,
      splitRatio,
      zoom,
      splitView: savedViewMode,
      viewMode: savedViewMode,
      sourceViewport: viewportStateRef.current.source,
      splitPreviewViewport: viewportStateRef.current.splitPreview,
      previewOnlyViewport: viewportStateRef.current.previewOnly
    });
  }

  /** スクロール中の状態保存をフレームごとにVS Codeへ送らず、最新位置だけを保存する。 */
  function schedulePersistViewState(viewModeOverride?: ViewMode): void {
    if (viewModeOverride !== undefined) pendingPersistViewModeRef.current = viewModeOverride;
    if (persistViewStateTimerRef.current !== undefined) return;
    persistViewStateTimerRef.current = window.setTimeout(() => {
      persistViewStateTimerRef.current = undefined;
      const pendingViewMode = pendingPersistViewModeRef.current;
      pendingPersistViewModeRef.current = undefined;
      persistViewStateRef.current(pendingViewMode);
    }, 100);
  }

  persistViewStateRef.current = persistViewState;

  /**
   * 表示モードを切り替え、切り替え前の選択範囲と表示位置を復元対象として保存する。
   * @param nextMode 切り替え先の編集またはプレビューモード。
   * @returns 何も返さない。
   */
  function changeMode(nextMode: EditorMode): void {
    mveDebug('view.change-mode', { from: mode, to: nextMode, splitView });
    captureVisibleViewports();
    const activeSelection = sourceRef.current?.getSelection();
    if (activeSelection) {
      selectionStateRef.current = activeSelection;
    }
    if (nextMode === 'preview' && !viewportStateRef.current.previewOnly) {
      viewportStateRef.current.previewOnly = viewportStateRef.current.splitPreview
        ?? viewportStateRef.current.source;
    }
    if (nextMode === 'split' && viewportStateRef.current.previewOnly) {
      viewportStateRef.current.splitPreview ??= viewportStateRef.current.previewOnly;
      viewportStateRef.current.source ??= viewportStateRef.current.previewOnly;
    }
    pendingViewportRestoreRef.current = true;
    setMode(nextMode);
  }

  /**
   * 分割表示のペイン構成を切り替え、変更前の表示位置を保存する。
   * @param nextView 切り替え先のペイン構成。
   * @returns 何も返さない。
   */
  function changeSplitView(nextView: 'both' | 'text' | 'preview'): void {
    mveDebug('view.change-split', { from: splitView, to: nextView, mode });
    captureVisibleViewports();
    if (nextView !== 'text' && !viewportStateRef.current.splitPreview) {
      viewportStateRef.current.splitPreview = viewportStateRef.current.source;
    }
    if (nextView !== 'preview' && !viewportStateRef.current.source) {
      viewportStateRef.current.source = viewportStateRef.current.splitPreview;
    }
    pendingViewportRestoreRef.current = true;
    setSplitView(nextView);
    setMode('split');
    persistViewState(nextView);
    vscode.postMessage({ type: 'setViewMode', viewMode: nextView });
  }

  /**
   * リボンから受け取ったコマンドをエディター操作・表示切替・ダイアログへ振り分ける。
   * @param command リボンが生成したコマンド。
   * @returns 何も返さない。
   */
  function handleRibbon(command: RibbonCommand): void {
    commitSourceSnapshot();
    // 同一ジェスチャーから同じリボン操作が短時間に重複して届いても、編集は1回だけ適用する。
    const commandKey = JSON.stringify(command);
    const now = performance.now();
    const previous = recentRibbonCommandsRef.current.get(commandKey);
    recentRibbonCommandsRef.current.set(commandKey, now);
    const delta = previous === undefined ? undefined : Math.round((now - previous) * 100) / 100;
    mveDebug('ribbon.command-received', { command, delta });
    // 印刷プレビューは「設定を再表示」「通常表示へ戻る」を同じボタンで行うため、
    // 高速な意図的連続操作を重複ジェスチャーとして抑止しない。
    if (command.type !== 'togglePrintPreview' && previous !== undefined && now - previous < 250) {
      mveDebug('ribbon.command-suppressed', { command, delta });
      return;
    }
    mveDebug('ribbon.command-applied', { command });

    switch (command.type) {
      case 'sourceAction':
        getActiveEditor()?.action(command.action);
        return;
      case 'historyCommand':
        requestHistoryCommand(command.command);
        return;
      case 'heading':
        getActiveEditor()?.heading(command.level);
        return;
      case 'insert':
        getActiveEditor()?.insert(command.value);
        return;
      case 'tableInsert':
        getActiveEditor()?.insert(`\n${createTableMarkdown(command.rows, command.columns)}\n`);
        return;
      case 'codeBlock':
        getActiveEditor()?.codeBlock(command.language);
        return;
      case 'link': {
        if (!getActiveEditor()) return;
        setLinkHref('https://example.com');
        setLinkLabel('');
        setLinkDialogVisible(true);
        return;
      }
      case 'image':
        requestImagePicker();
        return;
      case 'table':
        if (command.action === 'insert') getActiveEditor()?.insert(`\n${createTableMarkdown()}\n`);
        else {
          const editor = getActiveEditor();
          const edit = editor
            ? applyMarkdownTableAction(localTextRef.current, editor.getSelection(), command.action, { headerName: command.headerName })
            : undefined;
          if (edit) editor?.applyEdit(edit);
          else setToast(messages.app.toast.tableCellRequired);
        }
        return;
      case 'copyTableTsv':
        void copyTableTsv();
        return;
      case 'splitView':
        changeSplitView(command.view);
        return;
      case 'toggleOutline':
        prepareLayoutRestore();
        setOutlineVisible((value) => !value);
        return;
      case 'toggleInspector':
        if (inspector) changeInspector(undefined);
        return;
      case 'runPreflightCheck':
        runPreflightCheck();
        return;
      case 'togglePrintPreview':
        if (printPreview) {
          if (!printSettingsVisible) {
            setPrintSettingsVisible(true);
          } else {
            setPrintPreview(false);
            setPrintSettingsVisible(false);
            changeMode(previousModeBeforePrintRef.current);
          }
        } else {
          previousModeBeforePrintRef.current = mode;
          setPrintPreview(true);
          setPrintSettingsVisible(true);
          changeMode('preview');
        }
        return;
      case 'openSource':
        vscode.postMessage({ type: 'openSource' });
        return;
      case 'exportPdf':
        void requestPdfExport();
        return;
      case 'exportHtml':
        void requestHtmlExport(command.options);
        return;
      case 'find': {
        openSearch();
        return;
      }
      case 'showShortcuts':
        setHelpTopic('shortcuts');
        return;
      case 'showFeatures':
        setHelpTopic('features');
        return;
    }
  }

  /**
   * Markdown診断件数を集計し、出力前チェックパネルを表示する。
   * @returns 何も返さない。
   */
  function runPreflightCheck(): void {
    prepareLayoutRestore();
    setDiagnosticsVisible(true);
    requestLocalResourceCheck('preflight');
    const currentSummary = summarizeDiagnostics(mergeDiagnostics(localTextRef.current, localResourceDiagnostics, settings.language));
    setToast(messages.app.toast.preflightSummary(currentSummary.errors.length, currentSummary.warnings.length, currentSummary.infos.length));
  }

  /** ローカル画像・リンクの実在確認をホストへ依頼する。 */
  function requestLocalResourceCheck(purpose: LocalResourceCheckPurpose): void {
    const requestId = createClientId();
    const currentMarkdown = localTextRef.current;
    latestResourceCheckRequestRef.current = requestId;
    resourceCheckRequestsRef.current.set(requestId, {
      markdown: currentMarkdown,
      version: versionRef.current,
      generation: resourceCheckGenerationRef.current,
      purpose
    });
    vscode.postMessage({ type: 'checkLocalResources', requestId, markdown: currentMarkdown });
  }

  /**
   * 編集可能なテキストペインを表示して検索パネルを開く。
   * @returns 何も返さない。
   */
  function openSearch(): void {
    if (mode === 'preview') changeMode('split');
    if (splitView === 'preview') changeSplitView('text');
    setSearchVisible(true);
  }

  /**
   * リンクダイアログの入力値を検証し、現在の選択範囲へリンクを挿入する。
   * @returns 何も返さない。
   */
  function applyLinkDialog(): void {
    const href = linkHref.trim();
    if (!href) return;
    getActiveEditor()?.link(href, linkLabel.trim() || undefined);
    setLinkDialogVisible(false);
  }

  /**
   * 検索パネルを閉じ、検索位置を先頭へ戻す。
   * @returns 何も返さない。
   */
  function closeSearch(): void {
    setSearchVisible(false);
    setSearchIndex(0);
  }

  /**
   * 検索結果の選択位置を前後へ移動し、該当範囲へ移動する。
   * @param direction 次へ進む場合は1、前へ戻る場合は-1。
   * @returns 何も返さない。
   */
  function jumpToSearch(direction: 1 | -1): void {
    if (!searchHits.length) return;
    const nextIndex = (searchIndex + direction + searchHits.length) % searchHits.length;
    const hit = searchHits[nextIndex];
    setSearchIndex(nextIndex);
    navigateToSelection(hit);
  }

  /**
   * 現在の検索一致箇所またはすべての一致箇所を置換する。
   * @param all すべての一致を置換するかどうか。
   * @returns 何も返さない。
   */
  function replaceSearch(all: boolean): void {
    if (!searchQuery || !searchHits.length) return;
    if (all) {
      updateMarkdown(localTextRef.current.split(searchQuery).join(searchReplacement));
      setSearchIndex(0);
      return;
    }
    const hit = searchHits[searchIndex] ?? searchHits[0];
    updateMarkdown(localTextRef.current.slice(0, hit.from) + searchReplacement + localTextRef.current.slice(hit.to));
    setSearchIndex(Math.max(0, Math.min(searchIndex, searchHits.length - 2)));
  }

  /**
   * 画像貼り付けを保存処理へ渡し、HTML貼り付けは安全化してMarkdownへ変換する。
   * @param event クリップボード貼り付けイベント。
   * @returns 貼り付け処理が完了するPromise。
   */
  async function handlePaste(event: ClipboardEvent): Promise<void> {
    if (!isEditingEnabled(mode, splitView)) return;
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('.cm-content')) return;
    const items = Array.from(event.clipboardData?.items ?? []);
    const imageFiles = items
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (imageFiles.length) {
      event.preventDefault();
      event.stopImmediatePropagation();
      await saveImageFiles(imageFiles);
      return;
    }
    const html = event.clipboardData?.getData('text/html');
    const editor = getActiveEditor();
    const plainText = event.clipboardData?.getData('text/plain') ?? '';
    const hasHtmlTable = /<table\b[^>]*>[\s\S]*<\/table>/i.test(html ?? '');
    const hasTsvMime = Array.from(event.clipboardData?.types ?? []).some((type) => type === 'text/tab-separated-values' || type === 'text/tsv');
    const hasTableClipboard = hasHtmlTable || (!html && (hasTsvMime || plainText.includes('\t')));
    if (editor && hasTableClipboard && !isMarkdownCodeFencePosition(localTextRef.current, editor.getSelection())) {
      const edit = applyMarkdownTableTsv(localTextRef.current, editor.getSelection(), plainText);
      event.preventDefault();
      event.stopImmediatePropagation();
      if (edit) {
        editor.applyEdit(edit);
      } else {
        setToast(messages.app.toast.cannotPasteTsv);
      }
      return;
    }
    if (html && editor) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const safe = DOMPurify.sanitize(html, { FORBID_TAGS: ['script', 'style', 'iframe', 'object'] });
      const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' });
      turndown.use(turndownGfm);
      editor.insert(turndown.turndown(safe) || plainText);
      return;
    }
    // プレーンテキストもここで1回だけ挿入し、CodeMirrorの標準paste処理との二重実行を防ぐ。
    if (editor && plainText) {
      event.preventDefault();
      event.stopImmediatePropagation();
      editor.insert(plainText);
    }
  }

  /**
   * 現在の表をヘッダーとデータ行だけのTSVへ変換してクリップボードへコピーする。
   * @returns コピー処理が完了するPromise。
   */
  async function copyTableTsv(): Promise<void> {
    const editor = getActiveEditor();
    const tsv = editor ? markdownTableToTsv(localTextRef.current, editor.getSelection()) : undefined;
    if (tsv === undefined) {
      setToast(messages.app.toast.tableCellRequired);
      return;
    }
    try {
      await writeClipboardText(tsv);
      setToast(messages.app.toast.tableCopied);
    } catch (error) {
      setToast(messages.app.toast.cannotCopyTsv(error instanceof Error ? error.message : undefined));
    }
  }

  /**
   * Clipboard APIを優先し、Webview環境で利用できない場合は選択コピーへフォールバックする。
   * @param text コピーするテキスト。
   * @returns コピー処理が完了するPromise。
   */
  async function writeClipboardText(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error(messages.app.errors.clipboardUnavailable);
  }

  /**
   * 画像ファイルをペイロードへ変換し、ホストへ保存要求を送信する。
   * @param files 保存対象の画像ファイル一覧。
   * @returns 保存要求の送信が完了するPromise。
   */
  async function saveImageFiles(files: File[]): Promise<void> {
    try {
      const images: ImagePayload[] = [];
      for (const file of files) images.push(await fileToPayload(file, settings.maxPasteSizeMb, messages));
      const requestId = createClientId();
      imageRequestsRef.current.add(requestId);
      vscode.postMessage({ type: 'saveImages', requestId, images });
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * ホストへ画像ファイル選択ダイアログの表示を要求する。
   * @returns 何も返さない。
   */
  function requestImagePicker(): void {
    const requestId = createClientId();
    imageRequestsRef.current.add(requestId);
    vscode.postMessage({ type: 'pickImage', requestId });
  }

  /**
   * 診断結果を通知したうえで、印刷用HTMLとPDF設定をホストへ送信する。
   * @returns PDF出力要求の送信が完了するPromise。
   */
  async function ensureExportRoot(): Promise<HTMLDivElement | undefined> {
    if (exportRootRef.current && (printPreview || exportStageRequested)) return exportRootRef.current;
    return new Promise((resolve) => {
      let waiter: ((root: HTMLDivElement | undefined) => void) | undefined;
      const timeout = window.setTimeout(() => {
        const index = waiter ? exportStageWaitersRef.current.indexOf(waiter) : -1;
        if (index >= 0) exportStageWaitersRef.current.splice(index, 1);
        resolve(exportRootRef.current ?? undefined);
      }, 15_000);
      waiter = (root) => {
        window.clearTimeout(timeout);
        resolve(root);
      };
      exportStageWaitersRef.current.push(waiter);
      setExportStageRequested(true);
    });
  }

  async function requestPdfExport(): Promise<void> {
    if (!settings.workspaceTrusted) {
      setToast(messages.app.toast.workspaceTrustRequired);
      return;
    }
    requestLocalResourceCheck('pdf');
    const currentMarkdown = localTextRef.current;
    const currentSummary = summarizeDiagnostics(mergeDiagnostics(currentMarkdown, localResourceDiagnostics, settings.language));
    const diagnosticNotice = currentSummary.errors.length
      ? currentSummary.errors
        .map((item) => `${item.line ? `行${item.line}: ` : ''}${item.message}`)
        .join(' / ')
      : '';
    if (diagnosticNotice) setToast(messages.app.toast.pdfStartedWithDiagnostics(currentSummary.errors.length, diagnosticNotice));
    const root = await ensureExportRoot();
    if (!await waitForHtmlMermaidRendering(root)) {
      setToast(`${messages.renderer.mermaidError}: timeout`);
      if (!printPreview) setExportStageRequested(false);
      return;
    }
    const html = root ? serializeExportHtml(root) : `<pre>${escapeHtml(currentMarkdown)}</pre>`;
    if (!root) setToast(messages.app.toast.pdfFallbackToMarkdown(diagnosticNotice));
    const requestId = createClientId();
    const message: WebviewToHostMessage = {
      type: 'exportPdf',
      requestId,
      html,
      css: collectPrintableCss(),
      options: pdfOptions
    };
    pdfRequestsRef.current.add(requestId);
    vscode.postMessage(message);
    if (!printPreview) {
      exportRootRef.current = null;
      setExportStageRequested(false);
    }
  }

  /** 現在のプレビューHTMLとHTML出力オプションをホストへ渡し、HTMLファイルとして保存する。 */
  async function requestHtmlExport(options: HtmlExportOptions): Promise<void> {
    if (!settings.workspaceTrusted) {
      setToast(messages.app.toast.workspaceTrustRequired);
      return;
    }
    const root = await ensureExportRoot();
    if (!await waitForHtmlMermaidRendering(root)) {
      setToast(`${messages.renderer.mermaidError}: timeout`);
      if (!printPreview) setExportStageRequested(false);
      return;
    }
    const requestId = createClientId();
    const currentMarkdown = localTextRef.current;
    htmlRequestsRef.current.add(requestId);
    vscode.postMessage({
      type: 'exportHtml',
      requestId,
      markdown: currentMarkdown,
      html: root ? serializeExportHtml(root) : `<pre>${escapeHtml(currentMarkdown)}</pre>`,
      css: collectPrintableCss(),
      options
    });
    if (!printPreview) {
      exportRootRef.current = null;
      setExportStageRequested(false);
    }
  }

  /** HTML出力直前に、非同期のMermaid描画が完了するまで待つ。 */
  async function waitForHtmlMermaidRendering(root: HTMLDivElement | null | undefined = exportRootRef.current): Promise<boolean> {
    if (!root) return true;
    const deadline = Date.now() + 60_000;
    while (root.querySelector('.mermaid:not([data-mermaid-status]), .mermaid[data-mermaid-status="rendering"]')
      && Date.now() < deadline) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
    }
    return !root.querySelector('.mermaid:not([data-mermaid-status]), .mermaid[data-mermaid-status="rendering"]');
  }

  /**
   * 保存せずに同じHTML・CSSからPDFを生成し、印刷プレビューへ反映する。
   * 要求IDで古い生成結果を破棄し、入力中の大規模文書でも表示を巻き戻さない。
   */
  function requestPdfPreview(): void {
    if (!printPreview || !settings.workspaceTrusted) return;
    const root = exportRootRef.current;
    if (!root || root.querySelector('.mermaid:not([data-mermaid-status]), .mermaid[data-mermaid-status="rendering"]')) return;
    const html = root ? serializeExportHtml(root) : `<pre>${escapeHtml(markdown)}</pre>`;
    // 画像のloadやResizeObserverでexport-stageのDOMが変わっても、同じ本文のPDFを再生成しない。
    // 画像サイズの変更はMarkdown本文が変わるため、このキーも変わる。
    const signature = `${settings.language}\0${settings.remoteImagesEnabled}\0${settings.mermaidTheme}\0${JSON.stringify(pdfOptions)}\0${markdown}`;
    if (pdfPreviewSignatureRef.current === signature) return;
    pdfPreviewSignatureRef.current = signature;
    const requestId = createClientId();
    pdfPreviewRequestRef.current = requestId;
    setPdfPreview((previous) => ({ ...previous, requestId, loading: true, error: undefined }));
    const css = collectPrintableCss(false);
    mveDebug('pdf.preview-request', {
      requestId,
      htmlChars: html.length,
      cssChars: css.length
    });
    vscode.postMessage({
      type: 'renderPdfPreview',
      requestId,
      html,
      css,
      options: pdfOptions
    });
  }

  /** PDF用の非表示描画領域を更新し、Mermaid等の非同期描画後にプレビューを再要求する。 */
  function handleExportRendered(element: HTMLElement): void {
    exportRootRef.current = element as HTMLDivElement;
    const waiters = exportStageWaitersRef.current.splice(0);
    waiters.forEach((resolve) => resolve(exportRootRef.current ?? undefined));
    if (printPreview && settings.workspaceTrusted) {
      if (pdfPreviewTimerRef.current !== undefined) window.clearTimeout(pdfPreviewTimerRef.current);
      pdfPreviewTimerRef.current = window.setTimeout(() => {
        pdfPreviewTimerRef.current = undefined;
        requestPdfPreview();
      }, 80);
    }
  }

  /**
   * Inspectorで編集したMermaid・数式・画像の内容をMarkdown本文へ反映する。
   * @param nextSource 更新後のソースまたは画像参照先。
   * @param alt 更新後の画像代替テキスト。
   * @returns 何も返さない。
   */
  function updateInspector(nextSource: string, alt?: string): void {
    if (!inspector) return;
    if (inspector.type === 'mermaid') {
      updateMarkdown(replaceDelimitedBlock(localTextRef.current, '```mermaid', '```', inspector.source, nextSource));
      setInspector({ type: 'mermaid', source: nextSource });
    } else if (inspector.type === 'math') {
      const blockUpdated = replaceDelimitedBlock(localTextRef.current, '$$', '$$', inspector.source, nextSource);
      updateMarkdown(blockUpdated.replace(`$${inspector.source}$`, `$${nextSource}$`));
      setInspector({ type: 'math', source: nextSource });
    } else {
      const escaped = escapeRegExp(inspector.source);
      updateMarkdown(localTextRef.current.replace(new RegExp(`!\\[[^\\]]*\\]\\(${escaped}\\)`), imageMarkdown(inspector.source, alt || messages.editor.defaultImageAlt)));
      setInspector({ ...inspector, alt: alt || '' });
    }
  }

  /**
   * プレビュー上で変更した画像幅をMarkdown本文へ反映します。
   * @param imageIndex レンダリング順の画像インデックスです。
   * @param width 新しい画像幅です。
   * @returns 何も返しません。
   */
  function resizePreviewImage(imageIndex: number, width: number): void {
    if (!(mode === 'split' && splitView !== 'text')) return;
    updateMarkdown(resizeImageInMarkdown(localTextRef.current, imageIndex, width));
  }

  /**
   * HTML画像の幅指定を除去して自然サイズへ戻します。
   * @param imageIndex レンダリング順の画像インデックスです。
   * @returns 何も返しません。
   */
  function resetPreviewImage(imageIndex: number): void {
    if (!(mode === 'split' && splitView !== 'text')) return;
    updateMarkdown(resetImageSizeInMarkdown(localTextRef.current, imageIndex));
  }

  /**
   * プレビュー上で変更した画像の揃え位置をMarkdown本文へ反映します。
   * @param imageIndex レンダリング順の画像インデックスです。
   * @param alignment 新しい揃え位置です。
   * @returns 何も返しません。
   */
  function alignPreviewImage(imageIndex: number, alignment: ImageAlignment): void {
    if (!(mode === 'split' && splitView !== 'text')) return;
    updateMarkdown(alignImageInMarkdown(localTextRef.current, imageIndex, alignment));
  }

  /**
   * Inspectorの対象を変更する前に表示位置を保存し、対象状態を更新する。
   * @param next 次に表示するInspector対象。undefinedなら閉じる。
   * @returns 何も返さない。
   */
  function changeInspector(next: InspectorTarget | undefined): void {
    prepareLayoutRestore();
    setInspector(next);
  }

  /**
   * レイアウト変更後に各ペインの表示位置を復元できるよう現在位置を保存する。
   * @returns 何も返さない。
   */
  function prepareLayoutRestore(): void {
    captureVisibleViewports();
    pendingViewportRestoreRef.current = true;
  }

  /**
   * 指定された本文オフセットへ選択範囲とエディター表示位置を移動する。
   * @param offset 移動先の本文オフセット。
   * @returns 何も返さない。
   */
  function goToOffset(offset: number): void {
    navigateToSelection({ from: offset, to: offset });
  }

  /**
   * アウトラインの見出しへ、現在のペイン構成を維持したまま移動する。
   * プレビューのみでは非表示のソースを開かず、表示中のプレビューを直接スクロールする。
   * @param offset 移動先の見出し本文オフセット。
   * @returns 何も返さない。
   */
  function goToOutlineOffset(offset: number): void {
    const nextSelection = { from: offset, to: offset };
    if (mode === 'split' && splitView === 'preview') {
      selectionStateRef.current = nextSelection;
      revealOutlineInSplitPreview(offset, false);
      return;
    }
    navigateToSelection(nextSelection);
    if (mode === 'split' && splitView === 'both') {
      // CodeMirrorの選択行とスクロール位置が確定してから、同じ高さへプレビューを揃える。
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => revealOutlineInSplitPreview(offset, true));
      });
    }
  }

  /**
   * アウトライン対象を分割プレビューへ表示し、以後の復元処理でも維持するアンカーとして保存する。
   * @param offset 移動先の見出し本文オフセット。
   * @param alignWithSource ソースの選択行と同じ画面上の高さへ揃えるかどうか。
   * @returns 何も返さない。
   */
  function revealOutlineInSplitPreview(offset: number, alignWithSource: boolean): void {
    const preview = splitPreviewRef.current;
    if (!preview) return;
    const sourcePane = preview.closest('.split-editor')
      ?.querySelector<HTMLElement>('.split-source-pane:not(.pane-hidden)');
    const sourceScroller = sourcePane?.querySelector<HTMLElement>('.cm-scroller');
    const activeLine = sourcePane?.querySelector<HTMLElement>('.cm-activeLine');
    const topOffset = alignWithSource && sourceScroller && activeLine
      ? activeLine.getBoundingClientRect().top - sourceScroller.getBoundingClientRect().top
      : 18;
    const anchor: PreviewViewportAnchor = { offset, topOffset };
    viewportStateRef.current.splitPreview = anchor;
    pendingPreviewViewportRestoreRef.current.splitPreview = undefined;
    pendingRenderedPreviewKindsRef.current.delete('splitPreview');
    pendingViewportRestoreRef.current = false;
    restorePreview(preview, anchor);
  }

  /**
   * 診断行番号を本文オフセットへ変換し、その行へ移動する。診断パネルは開いたままにする。
   * @param line 1始まりの診断行番号。
   * @returns 何も返さない。
   */
  function goToDiagnosticLine(line: number): void {
    let offset = 0;
    for (let index = 1; index < line; index += 1) {
      const lineEnd = /\r\n|\r|\n/.exec(markdown.slice(offset));
      if (!lineEnd) break;
      offset += lineEnd.index + lineEnd[0].length;
    }
    goToOffset(offset);
  }

  /**
   * 選択範囲を保存し、現在の表示構成に応じてソースエディターまたは分割表示へ移動する。
   * @param nextSelection 移動先の本文選択範囲。
   * @returns 何も返さない。
   */
  function navigateToSelection(nextSelection: TextSelection): void {
    selectionStateRef.current = nextSelection;
    if (mode !== 'split' || splitView === 'preview') {
      pendingNavigationRef.current = nextSelection;
      changeSplitView('both');
      return;
    }
    sourceRef.current?.setSelection(nextSelection);
    sourceRef.current?.revealRange(nextSelection);
  }

  /**
   * ローカルまたは外部由来の本文を更新し、必要な差分同期と表示位置写像を行う。
   * @param nextText 更新後のMarkdown本文。
   * @param knownChanges 既に計算済みの本文差分。
   * @param origin 更新元がローカル編集か外部同期か。
   * @returns 何も返さない。
   */
  function updateMarkdown(
    nextText: string,
    knownChanges?: TextChange[],
    origin: 'local' | 'remote' = 'local',
    updateRenderedState = true
  ): void {
    const previous = localTextRef.current;
    if (previous === nextText) return;
    let changes = knownChanges ?? computeTextChanges(previous, nextText);
    if (isMveDebugEnabled()) {
      mveDebug('markdown.update', {
        origin,
        previousLength: previous.length,
        nextLength: nextText.length,
        changeCount: changes.length,
        changes: changes.slice(0, 8)
      });
    }
    if (origin === 'local') {
      try {
        if (applyTextChanges(previous, changes) !== nextText) {
          throw new Error('Local text changes do not produce the current editor value.');
        }
      } catch (error) {
        // 差分の検証に失敗しても入力は止めない。エディタの確定全文から
        // 差分を再計算し、今回の入力を必ずホスト同期へ乗せる。
        console.error('[Markdown Easy Visual Editor] ローカル差分を全文から再計算します。', error);
        changes = computeTextChanges(previous, nextText);
      }
    }
    // 外部差分は非同期scroll通知より先に届くことがあるため、変更前DOMから
    // 現在位置を同期取得してからオフセット写像する。古いRAFアンカーを写像しない。
    if (origin === 'remote') captureVisibleViewports();
    if (origin === 'local') lastAutomaticRetryRef.current = undefined;
    mapStoredViewports(changes, previous.length);
    if (origin === 'remote') {
      // マウント中のCodeMirrorはscrollSnapshot().map(changeSet)で折り返し段まで
      // 正確に追従するため、App側の文字オフセット復元を重ねない。
      pendingSourceViewportRestoreRef.current = undefined;
      skipNextSourceViewportRestoreRef.current = Boolean(sourceRef.current);
      pendingViewportRestoreRef.current = true;
    }
    if (!sourceRef.current && changes.length) {
      const currentSelection = selectionStateRef.current;
      const collapsed = currentSelection.from === currentSelection.to;
      const mappedSelection = {
        from: mapTextOffset(currentSelection.from, changes, previous.length, collapsed ? 1 : -1),
        to: mapTextOffset(currentSelection.to, changes, previous.length, 1)
      };
      selectionStateRef.current = mappedSelection;
    }
    localTextRef.current = nextText;
    if (updateRenderedState) {
      stagePreviewViewportRestore();
      setMarkdown(nextText);
    }
    if (origin === 'local') sendNextLocalOperation();
  }

  updateMarkdownRef.current = updateMarkdown;

  /**
   * ACK待ちがなければ、ホスト本文と最新ローカル本文の差分を1件だけ送信する。
   * ACK待ち中の入力はlocalTextRefへ上書きされるため、送信待ちキューは生成しない。
   * @returns 何も返さない。
   */
  function sendNextLocalOperation(): void {
    if (resyncInFlightRef.current || inFlightOperationRef.current) return;
    const baseText = hostTextRef.current;
    const resultText = localTextRef.current;
    if (baseText === resultText) return;
    const changes = computeTextChanges(baseText, resultText);
    const current: PendingLocalOperation = {
      opId: createClientId(),
      baseVersion: versionRef.current,
      baseText,
      resultText,
      changes
    };
    inFlightOperationRef.current = current;
    if (isMveDebugEnabled()) {
      mveDebug('sync.local-sent', {
        opId: current.opId,
        baseVersion: current.baseVersion,
        pendingCount: 1,
        changeCount: current.changes.length,
        changes: current.changes.slice(0, 8)
      });
    }
    vscode.postMessage({
      type: 'localChanges',
      clientId: clientIdRef.current,
      opId: current.opId,
      baseVersion: current.baseVersion,
      changes: current.changes
    });
  }

  /**
   * 本文変更に合わせて保存済みの3種類の表示アンカーのオフセットを写像する。
   * @param changes 本文へ適用された変更一覧。
   * @param baseLength 変更前本文の長さ。
   * @returns 何も返さない。
   */
  function mapStoredViewports(changes: TextChange[], baseLength: number): void {
    if (!changes.length) return;
    for (const key of ['source', 'splitPreview', 'previewOnly'] as const) {
      const anchor = viewportStateRef.current[key];
      if (!anchor) continue;
      anchor.offset = mapTextOffset(Math.min(anchor.offset, baseLength), changes, baseLength, -1);
      if ('blockFrom' in anchor && anchor.blockFrom !== undefined) {
        anchor.blockFrom = mapTextOffset(Math.min(anchor.blockFrom, baseLength), changes, baseLength, -1);
      }
      if ('endOffset' in anchor && anchor.endOffset !== undefined) {
        anchor.endOffset = mapTextOffset(Math.min(anchor.endOffset, baseLength), changes, baseLength, 1);
      }
    }
  }

  /**
   * 現在表示されているソース・分割プレビュー・プレビュー専用の位置を保存する。
   * @returns 何も返さない。
   */
  function captureVisibleViewports(): void {
    if (mode === 'split' && splitView !== 'preview') {
      viewportStateRef.current.source = sourceRef.current?.getViewport() ?? viewportStateRef.current.source;
    }
    if (mode === 'split' && splitView !== 'text' && splitPreviewRef.current) {
      viewportStateRef.current.splitPreview = capturePreviewViewport(splitPreviewRef.current)
        ?? viewportStateRef.current.splitPreview;
    }
    if (mode === 'preview' && editorAreaRef.current) {
      viewportStateRef.current.previewOnly = capturePreviewViewport(editorAreaRef.current)
        ?? viewportStateRef.current.previewOnly;
    }
  }

  /**
   * 保存済みの各ペイン表示位置を現在のレイアウトへ復元する。
   * @returns 何も返さない。
   */
  function restoreVisibleViewports(): void {
    const sourceAnchor = pendingSourceViewportRestoreRef.current ?? viewportStateRef.current.source;
    if (skipNextSourceViewportRestoreRef.current) {
      skipNextSourceViewportRestoreRef.current = false;
    } else if (mode === 'split' && splitView !== 'preview' && sourceAnchor) {
      sourceRef.current?.restoreViewport(sourceAnchor);
    }
    if (mode === 'split' && splitView !== 'text' && splitPreviewRef.current) {
      restorePendingPreview('splitPreview', splitPreviewRef.current);
    }
    if (mode === 'preview' && editorAreaRef.current) {
      restorePendingPreview('previewOnly', editorAreaRef.current);
    }
  }

  /** 次回のDOM差分描画より前に、ブラウザの自動スクロールで失われてはならないプレビュー位置を固定する。 */
  function stagePreviewViewportRestore(): void {
    pendingPreviewViewportRestoreRef.current = {
      splitPreview: viewportStateRef.current.splitPreview
        ? { ...viewportStateRef.current.splitPreview }
        : undefined,
      previewOnly: viewportStateRef.current.previewOnly
        ? { ...viewportStateRef.current.previewOnly }
        : undefined
    };
    mveDebug('preview.restore.staged', pendingPreviewViewportRestoreRef.current);
  }

  /**
   * ソースエディターの表示位置を保存し、分割表示時はプレビュー位置にも同期する。
   * @param anchor ソースエディターから通知された表示アンカー。
   * @param userInitiated ユーザー操作によるスクロールかどうか。
   * @returns 何も返さない。
   */
  function handleSourceViewport(anchor: EditorViewportAnchor, userInitiated: boolean): void {
    const pendingRestore = pendingSourceViewportRestoreRef.current;
    if (userInitiated) {
      pendingSourceViewportRestoreRef.current = undefined;
    } else if (pendingRestore) {
      const containsTarget = pendingRestore.offset >= anchor.offset
        && pendingRestore.offset <= (anchor.endOffset ?? anchor.offset);
      if (containsTarget && Math.abs(anchor.topOffset - pendingRestore.topOffset) <= 1) {
        // 復元対象の論理オフセットと画面上位置を維持しつつ、可視終端と
        // スクロール比は復元後の実測値へ更新する。
        viewportStateRef.current.source = {
          ...anchor,
          offset: pendingRestore.offset,
          topOffset: pendingRestore.topOffset
        };
        pendingSourceViewportRestoreRef.current = undefined;
        schedulePersistViewState();
      }
      return;
    }
    viewportStateRef.current.source = anchor;
    schedulePersistViewState();
    if (!userInitiated || mode !== 'split' || splitView !== 'both') return;
    const preview = splitPreviewRef.current;
    if (!preview) return;
    const previewAnchor = {
      offset: anchor.offset,
      topOffset: anchor.topOffset,
      scrollRatio: anchor.scrollRatio
    };
    viewportStateRef.current.splitPreview = previewAnchor;
    scheduleSourceToPreviewSync(previewAnchor);
  }

  /**
   * プレビュー上の入力をユーザースクロールとして記録する。
   * @param event スクロール開始を示すDOMイベント。
   * @returns 何も返さない。
   */
  function markPreviewScrollIntent(event: React.SyntheticEvent<HTMLElement>): void {
    viewportUserIntentGenerationRef.current += 1;
    const container = event.currentTarget;
    if (container === splitPreviewRef.current) {
      pendingPreviewViewportRestoreRef.current.splitPreview = undefined;
    }
    if (container === editorAreaRef.current) {
      pendingPreviewViewportRestoreRef.current.previewOnly = undefined;
    }
    pendingViewportRestoreRef.current = false;
    skipNextSourceViewportRestoreRef.current = false;
    programmaticPreviewScrollsRef.current.delete(container);
    previewUserScrollPendingRef.current.add(container);
    if (event.type === 'pointerdown') previewPointerScrollActiveRef.current.add(container);
    if (event.type === 'touchstart') previewTouchScrollActiveRef.current.add(container);
  }

  /**
   * プレビューのスクロール位置を保存し、分割表示時はソース位置へ反映する。
   * @param kind スクロールしたプレビューの種類。
   * @param container スクロールイベントを発生させたコンテナー。
   * @returns 何も返さない。
   */
  function handlePreviewScroll(kind: 'splitPreview' | 'previewOnly', container: HTMLElement): void {
    const startedAt = performance.now();
    const programmatic = programmaticPreviewScrollsRef.current.has(container);
    const pending = pendingPreviewScrollsRef.current.get(container);
    pendingPreviewScrollsRef.current.set(container, {
      kind,
      userInitiated: (pending?.userInitiated ?? false) || !programmatic
    });
    mveDebug('preview.scroll.queued', {
      kind,
      programmatic,
      pendingUserInitiated: (pending?.userInitiated ?? false) || !programmatic,
      scrollTop: container.scrollTop
    });
    if (previewScrollFrameRef.current === undefined) {
      previewScrollFrameRef.current = window.requestAnimationFrame(() => {
        previewScrollFrameRef.current = undefined;
        const scrolls = Array.from(pendingPreviewScrollsRef.current.entries());
        pendingPreviewScrollsRef.current.clear();
        scrolls.forEach(([pendingContainer, next]) => {
          processPreviewScroll(next.kind, pendingContainer, next.userInitiated);
        });
      });
    }
    performance.clearMeasures('mve-preview-scroll-handler');
    performance.measure('mve-preview-scroll-handler', { start: startedAt, end: performance.now() });
  }

  /** 同一描画フレーム内で重複したプレビュースクロールを、最新位置に対して一度だけ反映する。 */
  function processPreviewScroll(
    kind: 'splitPreview' | 'previewOnly',
    container: HTMLElement,
    userInitiated: boolean
  ): void {
    const startedAt = performance.now();
    try {
      if (!container.isConnected) return;
      const stagedAnchor = pendingPreviewViewportRestoreRef.current[kind];
      // DOM差分・画像・Mermaidの寸法変化が発生させたscrollイベントは、
      // 描画前に固定した論理アンカーを上書きさせない。明示的な入力は
      // markPreviewScrollIntentで先にスナップショットを破棄する。
      if (stagedAnchor) return;
      // DOM更新直後のscrollが復元より先にRAFキューへ入った場合も、処理時点で
      // 復元中ならユーザー操作扱いを取り消して逆方向同期を防ぐ。
      // 復元結果の丸め値で論理アンカーを上書きすると、画像・Mermaidの後段
      // レイアウト変化ごとに誤差が累積するため保存状態も変更しない。
      if (programmaticPreviewScrollsRef.current.has(container)) return;
      const anchor = capturePreviewViewport(container);
      if (!anchor) return;
      mveDebug('preview.scroll.processed', {
        kind,
        userInitiated,
        anchor,
        scrollTop: container.scrollTop
      });
      viewportStateRef.current[kind] = anchor;
      if (!userInitiated) {
        schedulePersistViewState();
        return;
      }
      // スクロールバーのつまみ操作ではpointerdownがReactへ届かないことがあるため、
      // プログラムスクロール以外のscrollイベントはユーザー操作として扱う。
      lastPreviewUserScrollAtRef.current = performance.now();
      previewUserScrollPendingRef.current.delete(container);
      schedulePersistViewState();
      if (
        kind !== 'splitPreview'
        || mode !== 'split'
        || splitView !== 'both'
      ) return;
      viewportStateRef.current.source = {
        offset: anchor.offset,
        topOffset: anchor.topOffset,
        scrollRatio: anchor.scrollRatio
      };
      schedulePreviewToSourceSync(viewportStateRef.current.source);
    } finally {
      performance.clearMeasures('mve-preview-scroll-sync');
      performance.measure('mve-preview-scroll-sync', { start: startedAt, end: performance.now() });
    }
  }

  /** プレビューからソースへの追従描画を最新1件・最大約30Hzに制限する。 */
  function schedulePreviewToSourceSync(anchor: PreviewViewportAnchor): void {
    pendingPreviewToSourceAnchorRef.current = anchor;
    if (previewToSourceSyncTimerRef.current !== undefined) return;
    const delay = Math.max(0, CROSS_PANE_SCROLL_SYNC_MS - (performance.now() - lastPreviewToSourceSyncRef.current));
    previewToSourceSyncTimerRef.current = window.setTimeout(() => {
      previewToSourceSyncTimerRef.current = undefined;
      lastPreviewToSourceSyncRef.current = performance.now();
      const pending = pendingPreviewToSourceAnchorRef.current;
      pendingPreviewToSourceAnchorRef.current = undefined;
      if (!pending) return;
      mveDebug('preview.scroll.sync-source', { pending });
      if (pending.scrollRatio !== undefined) {
        sourceRef.current?.restoreScrollRatio(pending.scrollRatio);
      } else {
        sourceRef.current?.restoreViewport(pending);
      }
    }, delay);
  }

  /** ソースからプレビューへの追従描画を最新1件・最大約30Hzに制限する。 */
  function scheduleSourceToPreviewSync(anchor: EditorViewportAnchor): void {
    pendingSourceToPreviewAnchorRef.current = anchor;
    if (sourceToPreviewSyncTimerRef.current !== undefined) return;
    const delay = Math.max(0, CROSS_PANE_SCROLL_SYNC_MS - (performance.now() - lastSourceToPreviewSyncRef.current));
    sourceToPreviewSyncTimerRef.current = window.setTimeout(() => {
      sourceToPreviewSyncTimerRef.current = undefined;
      lastSourceToPreviewSyncRef.current = performance.now();
      const pending = pendingSourceToPreviewAnchorRef.current;
      pendingSourceToPreviewAnchorRef.current = undefined;
      const preview = splitPreviewRef.current;
      if (!pending || !preview) return;
      if (pending.scrollRatio !== undefined) {
        restorePreviewScrollRatio(preview, pending.scrollRatio);
      } else {
        restorePreview(preview, pending);
      }
    }, delay);
  }

  /**
   * プレビューのプログラムスクロールを記録し、指定された表示アンカーへ移動する。
   * @param container スクロール位置を変更するプレビュー。
   * @param anchor 復元対象のプレビューアンカー。
   * @returns 何も返さない。
   */
  function restorePreview(container: HTMLElement, anchor: PreviewViewportAnchor): void {
    programmaticPreviewScrollsRef.current.add(container);
    const before = container.scrollTop;
    const restored = restorePreviewViewport(container, anchor);
    mveDebug('preview.restore.result', {
      restored,
      before,
      after: container.scrollTop,
      anchor
    });
  }

  /** プレビューを先頭または末尾へ移動し、同期スクロールを無限に発生させない。 */
  function restorePreviewScrollRatio(container: HTMLElement, ratio: number): void {
    programmaticPreviewScrollsRef.current.add(container);
    restoreScrollRatio(container, ratio);
  }

  /**
   * プレビューの描画完了後に、その種類に保存されている表示位置を復元する。
   * @param kind 描画が完了したプレビューの種類。
   * @returns 何も返さない。
   */
  function handlePreviewRendered(kind: 'splitPreview' | 'previewOnly'): void {
    pendingRenderedPreviewKindsRef.current.add(kind);
    scheduleRenderedPreviewRestore();
  }

  /** レイアウト変化後の表示位置復元を集約し、ユーザースクロール中は完了後まで延期する。 */
  function scheduleRenderedPreviewRestore(): void {
    if (renderedPreviewRestoreFrameRef.current !== undefined
      || renderedPreviewRestoreTimerRef.current !== undefined) return;
    const delay = Math.max(0, 100 - (performance.now() - lastPreviewUserScrollAtRef.current));
    if (delay > 0) {
      renderedPreviewRestoreTimerRef.current = window.setTimeout(() => {
        renderedPreviewRestoreTimerRef.current = undefined;
        scheduleRenderedPreviewRestore();
      }, delay);
      return;
    }
    renderedPreviewRestoreFrameRef.current = window.requestAnimationFrame(() => {
      renderedPreviewRestoreFrameRef.current = undefined;
      const kinds = Array.from(pendingRenderedPreviewKindsRef.current);
      pendingRenderedPreviewKindsRef.current.clear();
      kinds.forEach((pendingKind) => {
        const container = pendingKind === 'splitPreview' ? splitPreviewRef.current : editorAreaRef.current;
        if (container) restorePendingPreview(pendingKind, container);
      });
    });
  }

  /** 固定済みアンカーを優先してプレビューを復元し、以後のscrollイベントを通常処理へ戻す。 */
  function restorePendingPreview(
    kind: 'splitPreview' | 'previewOnly',
    container: HTMLElement
  ): void {
    const staged = pendingPreviewViewportRestoreRef.current[kind];
    const anchor = staged ?? viewportStateRef.current[kind];
    if (!anchor) return;
    mveDebug('preview.restore.applied', { kind, staged: Boolean(staged), anchor });
    restorePreview(container, anchor);
    if (staged === pendingPreviewViewportRestoreRef.current[kind]) {
      pendingPreviewViewportRestoreRef.current[kind] = undefined;
    }
  }

  /**
   * 分割境界のポインター操作を開始し、移動量から分割比率を更新する。
   * @param event 分割境界のポインターダウンイベント。
   * @returns 何も返さない。
   */
  function beginSplitResize(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    captureVisibleViewports();
    const container = event.currentTarget.parentElement;
    if (!container) return;
    /** 分割境界の移動量から左右ペインの比率を更新する。 */
    const move = (moveEvent: PointerEvent) => {
      const bounds = container.getBoundingClientRect();
      if (bounds.width) setSplitRatio(clampSplitRatio((moveEvent.clientX - bounds.left) / bounds.width));
    };
    /** 分割リサイズを終了し、表示位置を復元して状態を保存する。 */
    const end = () => {
      window.removeEventListener('pointermove', move);
      document.body.classList.remove('mve-resizing-split');
      restoreVisibleViewports();
      pendingViewportRestoreRef.current = false;
      persistViewState();
    };
    document.body.classList.add('mve-resizing-split');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
  }

  /**
   * アウトライン境界のポインター操作を開始し、移動量から幅を更新する。
   * @param event アウトライン境界のポインターダウンイベント。
   * @returns 何も返さない。
   */
  function beginOutlineResize(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    captureVisibleViewports();
    const workspace = event.currentTarget.parentElement;
    if (!workspace) return;
    /** アウトライン境界の移動量からアウトライン幅を更新する。 */
    const move = (moveEvent: PointerEvent) => {
      const bounds = workspace.getBoundingClientRect();
      setOutlineWidth(clampOutlineWidth(moveEvent.clientX - bounds.left));
    };
    /** アウトラインリサイズを終了し、表示位置を復元して状態を保存する。 */
    const end = () => {
      window.removeEventListener('pointermove', move);
      document.body.classList.remove('mve-resizing-outline');
      restoreVisibleViewports();
      pendingViewportRestoreRef.current = false;
      persistViewState();
    };
    document.body.classList.add('mve-resizing-outline');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
  }

  const imageResizeEnabled = mode === 'split' && splitView !== 'text';
  const splitPreviewImageResize = useCallback(
    (imageIndex: number, width: number) => { if (imageResizeEnabled) resizePreviewImage(imageIndex, width); },
    [imageResizeEnabled, mode, splitView]
  );
  const splitPreviewImageReset = useCallback(
    (imageIndex: number) => { if (imageResizeEnabled) resetPreviewImage(imageIndex); },
    [imageResizeEnabled, mode, splitView]
  );
  const splitPreviewImageAlign = useCallback(
    (imageIndex: number, alignment: ImageAlignment) => { if (imageResizeEnabled) alignPreviewImage(imageIndex, alignment); },
    [imageResizeEnabled, mode, splitView]
  );
  const splitPreviewInspect = useCallback((target: InspectorTarget) => changeInspector(target), [mode, splitView]);
  const splitPreviewNavigate = useCallback((href: string) => vscode.postMessage({ type: 'openResource', href }), []);
  const splitPreviewRendered = useCallback(() => handlePreviewRendered('splitPreview'), [mode, splitView]);
  const sourceEditorChange = useCallback((beforeText: string, nextText: string, changes: TextChange[]) => {
    const previous = localTextRef.current;
    let effectiveText = nextText;
    let effectiveChanges = changes;
    try {
      if (beforeText !== previous) {
        // 外部変更がReact/CodeMirrorへ届く途中でも、ユーザー入力を破棄しない。
        // CodeMirror更新前の本文を基準に外部側の差分を作り、今回の入力だけを
        // 最新のlocal本文へ写像する。これによりIME変換中の外部追記も残る。
        const bridgeChanges = computeTextChanges(beforeText, previous);
        try {
          effectiveChanges = mapTextChanges(changes, bridgeChanges, beforeText.length, true);
        } catch {
          effectiveChanges = mapChangesPreferLocal(changes, bridgeChanges, beforeText.length);
        }
        effectiveText = applyTextChanges(previous, effectiveChanges);
      } else if (applyTextChanges(previous, changes) !== nextText) {
        // CodeMirror差分の基準が一致しない場合は、現在値同士から安全に再計算する。
        effectiveChanges = computeTextChanges(previous, nextText);
      }
    } catch {
      // 競合写像の一次経路で例外が出ても、古いCodeMirror全文をそのまま
      // local本文へ戻さない。まず全文差分を作り直し、外部変更を含む現在本文へ
      // ユーザー編集だけを再度写像することで、入力と外部変更の両方を保持する。
      if (beforeText !== previous) {
        const bridgeChanges = computeTextChanges(beforeText, previous);
        const editorChanges = computeTextChanges(beforeText, nextText);
        effectiveChanges = mapChangesPreferLocal(editorChanges, bridgeChanges, beforeText.length);
        effectiveText = applyTextChanges(previous, effectiveChanges);
      } else {
        effectiveChanges = computeTextChanges(previous, nextText);
        effectiveText = applyTextChanges(previous, effectiveChanges);
      }
    }
    updateMarkdownRef.current(effectiveText, effectiveChanges, 'local', beforeText !== previous);
  }, []);
  const sourceEditorSettled = useCallback(() => {
    stagePreviewViewportRestore();
    setMarkdown(localTextRef.current);
    delete document.body.dataset.mveInputActive;
    window.dispatchEvent(new Event('mve-preview-input-settled'));
  }, []);

  const sourceEditorSelectionChange = useCallback((nextSelection: TextSelection) => {
    selectionStateRef.current = nextSelection;
    const source = markdownForSelectionRef.current;
    const nextMarks = nextSelection.from === nextSelection.to
      ? {}
      : inferMarks(source.slice(nextSelection.from, nextSelection.to));
    const previous = activeMarksRef.current;
    const previousKeys = Object.keys(previous);
    const nextKeys = Object.keys(nextMarks);
    if (previousKeys.length === nextKeys.length
      && nextKeys.every((key) => previous[key] === nextMarks[key])) return;
    activeMarksRef.current = nextMarks;
    setActiveMarks(nextMarks);
  }, []);
  const sourceEditorViewportChange = useCallback(
    (anchor: EditorViewportAnchor, userInitiated: boolean) => handleSourceViewport(anchor, userInitiated),
    [mode, splitView]
  );
  const sourceEditorUserScrollIntent = useCallback(() => {
    viewportUserIntentGenerationRef.current += 1;
    pendingSourceViewportRestoreRef.current = undefined;
    skipNextSourceViewportRestoreRef.current = false;
    pendingPreviewViewportRestoreRef.current = {};
    pendingViewportRestoreRef.current = false;
  }, []);

  if (!initialized) return <div className="startup">{messages.app.startup}</div>;

  const readOnly = !isEditingEnabled(mode, splitView);
  const splitColumns = splitView === 'both'
    ? `minmax(0, ${splitRatio}fr) 8px minmax(0, ${1 - splitRatio}fr)`
    : 'minmax(0, 1fr)';
  return (
    <div className={`app ${printPreview ? 'print-preview-mode' : ''}`}>
      <Ribbon
        messages={messages}
        mode={mode}
        readOnly={readOnly}
        activeMarks={activeMarks}
        outlineVisible={outlineVisible}
        splitView={splitView}
        onCommand={handleRibbon}
      />
      <div className="workspace">
        {outlineVisible ? (
          <>
          <aside className="outline-panel" style={{ flexBasis: `${outlineWidth}px` }} aria-label={messages.app.outline}>
            <div className="outline-header">
              <h2>{messages.app.outline}</h2>
              <button type="button" title={messages.app.hideOutline} aria-label={messages.app.hideOutline} onClick={() => { prepareLayoutRestore(); setOutlineVisible(false); }}>×</button>
            </div>
            {outline.length ? (
              <nav>
                {outline.map((item) => (
                  <button key={`${item.offset}-${item.id}`} style={{ paddingLeft: `${8 + item.level * 10}px` }} onClick={() => goToOutlineOffset(item.offset)}>
                    {item.text}
                  </button>
                ))}
              </nav>
            ) : (
              <p>{messages.app.noHeadings}</p>
            )}
          </aside>
          <div
            className="outline-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label={messages.app.outlineWidth}
            aria-valuemin={160}
            aria-valuemax={420}
            aria-valuenow={outlineWidth}
            tabIndex={0}
            onPointerDown={beginOutlineResize}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                setOutlineWidth((value) => clampOutlineWidth(value + (event.key === 'ArrowLeft' ? -10 : 10)));
              }
            }}
          />
          </>
        ) : (
          <button className="outline-reopen" type="button" title={messages.app.showOutline} aria-label={messages.app.showOutline} onClick={() => { prepareLayoutRestore(); setOutlineVisible(true); }}>›</button>
        )}
        <main
          ref={editorAreaRef}
          className="editor-area"
          onMouseUp={() => {
            selectionStateRef.current = getActiveEditor()?.getSelection() ?? selectionStateRef.current;
          }}
          tabIndex={mode === 'preview' ? 0 : undefined}
          onWheelCapture={mode === 'preview' ? markPreviewScrollIntent : undefined}
          onPointerDownCapture={mode === 'preview' ? markPreviewScrollIntent : undefined}
          onTouchStartCapture={mode === 'preview' ? markPreviewScrollIntent : undefined}
          onKeyDownCapture={mode === 'preview' ? markPreviewScrollIntent : undefined}
          onScroll={mode === 'preview'
            ? (event) => handlePreviewScroll('previewOnly', event.currentTarget)
            : undefined}
        >
          {searchVisible && (
            <section className="search-panel" aria-label={messages.app.searchAndReplace}>
              <input
                ref={searchInputRef}
                aria-label={messages.app.searchText}
                placeholder={messages.ribbon.search}
                value={searchQuery}
                onChange={(event) => { setSearchQuery(event.target.value); setSearchIndex(0); }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') closeSearch();
                  if (event.key === 'Enter') jumpToSearch(event.shiftKey ? -1 : 1);
                }}
              />
              <input aria-label={messages.app.replacementText} placeholder={messages.app.replacement} value={searchReplacement} onChange={(event) => setSearchReplacement(event.target.value)} />
              <span className="search-count">{searchHits.length ? `${searchIndex + 1}/${searchHits.length}` : '0/0'}</span>
              <button type="button" onClick={() => jumpToSearch(-1)} disabled={!searchHits.length} title={messages.app.previousMatch}>{messages.app.previousMatch}</button>
              <button type="button" onClick={() => jumpToSearch(1)} disabled={!searchHits.length} title={messages.app.nextMatch}>{messages.app.nextMatch}</button>
              <button type="button" onClick={() => replaceSearch(false)} disabled={!searchQuery}>{messages.app.replacement}</button>
              <button type="button" onClick={() => replaceSearch(true)} disabled={!searchQuery}>{messages.app.replaceAll}</button>
              <button type="button" onClick={closeSearch}>{messages.app.close}</button>
            </section>
          )}
          {mode === 'split' && (
            <div
              className={`split-editor ${splitView === 'both' ? '' : 'single-pane'}`}
              style={{ gridTemplateColumns: splitColumns }}
            >
              <div className={`split-source-pane ${splitView === 'preview' ? 'pane-hidden' : ''}`} style={{ fontSize: `${zoom}em` }}>
                <SourceEditor
                  ref={sourceRef}
                  value={markdown}
                  initialSelection={selectionStateRef.current}
                  searchHits={searchVisible ? searchHits : []}
                  activeSearchHit={searchVisible ? searchHits[searchIndex] : undefined}
                  messages={messages}
                  placeholder={messages.editor.placeholder}
                  onChange={sourceEditorChange}
                  onInputActivity={cancelPreviewWork}
                  onSettled={sourceEditorSettled}
                  onSelectionChange={sourceEditorSelectionChange}
                  onViewportChange={sourceEditorViewportChange}
                  onUserScrollIntent={sourceEditorUserScrollIntent}
                />
              </div>
              <div
                className={`split-divider ${splitView === 'both' ? '' : 'pane-hidden'}`}
                role="separator"
                aria-orientation="vertical"
                aria-label={messages.app.splitBoundary}
                aria-valuemin={20}
                aria-valuemax={80}
                aria-valuenow={Math.round(splitRatio * 100)}
                tabIndex={0}
                onPointerDown={beginSplitResize}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    prepareLayoutRestore();
                    setSplitRatio((value) => clampSplitRatio(value + (event.key === 'ArrowLeft' ? -0.02 : 0.02)));
                  }
                }}
              />
              <div
                ref={splitPreviewRef}
                className={`split-preview ${splitView === 'text' ? 'pane-hidden' : ''}`}
                style={{ fontSize: `${zoom}em` }}
                tabIndex={splitView !== 'text' ? 0 : undefined}
                onWheel={markPreviewScrollIntent}
                onPointerDown={markPreviewScrollIntent}
                onTouchStart={markPreviewScrollIntent}
                onKeyDown={markPreviewScrollIntent}
                onScroll={(event) => handlePreviewScroll('splitPreview', event.currentTarget)}
              >
                <RenderedMarkdown
                  markdown={renderedPreviewMarkdown}
                  html={previewHtml}
                  settings={settings}
                  onImageResize={imageResizeEnabled ? splitPreviewImageResize : undefined}
                  onImageReset={imageResizeEnabled ? splitPreviewImageReset : undefined}
                  onImageAlign={imageResizeEnabled ? splitPreviewImageAlign : undefined}
                  onInspect={splitPreviewInspect}
                  onNavigate={splitPreviewNavigate}
                  onRendered={splitPreviewRendered}
                  deferMermaid
                />
              </div>
            </div>
          )}
          {mode === 'preview' && (
            <PdfPreview
              markdown={renderedPreviewMarkdown}
              html={previewHtml}
              settings={settings}
              options={pdfOptions}
              zoom={zoom}
              messages={messages}
              pdfBase64={pdfPreview.pdfBase64}
              pdfLoading={pdfPreview.loading}
              pdfError={pdfPreview.error}
              onInspect={(target) => changeInspector(target)}
              onNavigate={(href) => vscode.postMessage({ type: 'openResource', href })}
              onZoom={adjustZoom}
              onRendered={() => handlePreviewRendered('previewOnly')}
            />
          )}
        </main>
        {inspector && (
          <Inspector
            target={inspector}
            settings={settings}
            messages={messages}
            onChange={updateInspector}
            onClose={() => changeInspector(undefined)}
            onOpenResource={(href) => vscode.postMessage({ type: 'openResource', href })}
          />
        )}
        {diagnosticsVisible && (
          <aside className="diagnostics-panel">
            <div className="panel-title"><h2>{messages.app.diagnosticsTitle}</h2><button onClick={() => { prepareLayoutRestore(); setDiagnosticsVisible(false); }}>{messages.app.close}</button></div>
            <p className="diagnostic-summary">
              {messages.app.severity.error} {diagnosticSummary.errors.length} / {messages.app.severity.warning} {diagnosticSummary.warnings.length} / {messages.app.severity.info} {diagnosticSummary.infos.length}
            </p>
            <p className="diagnostic-help">{messages.app.diagnosticHelp}</p>
            {diagnostics.length ? diagnostics.map((item, index) => (
              <div key={`${item.code}-${index}`} className={`diagnostic ${item.severity}`}>
                <strong>{messages.app.severity[item.severity]}</strong>
                {item.line ? <button type="button" className="diagnostic-location" onClick={() => goToDiagnosticLine(item.line as number)}>{messages.app.line(item.line as number)}</button> : null}
                <span>{item.message}</span>
              </div>
            )) : <p>{messages.app.noProblems}</p>}
          </aside>
        )}
        {printPreview && printSettingsVisible && (
          <aside className="pdf-settings-panel">
            <div className="panel-title"><h2>{messages.app.printSettings}</h2><button onClick={() => setPrintSettingsVisible(false)}>{messages.app.close}</button></div>
            <p>{messages.app.printSettingsHelp}</p>
            <label>{messages.app.paper}<select value={pdfOptions.format} onChange={(event) => setPdfOptions({ ...pdfOptions, format: event.target.value as PdfOptions['format'] })}><option>A4</option><option>A3</option><option>Letter</option></select></label>
            <label>{messages.app.orientation}<select value={pdfOptions.orientation} onChange={(event) => setPdfOptions({ ...pdfOptions, orientation: event.target.value as PdfOptions['orientation'] })}><option value="portrait">{messages.app.portrait}</option><option value="landscape">{messages.app.landscape}</option></select></label>
            <label>{messages.app.header}<input value={pdfOptions.header} onChange={(event) => setPdfOptions({ ...pdfOptions, header: event.target.value })} /></label>
            <label>{messages.app.footer}<input value={pdfOptions.footer} onChange={(event) => setPdfOptions({ ...pdfOptions, footer: event.target.value })} /></label>
            <fieldset className="pdf-margin-fields">
              <legend>{messages.app.margins}</legend>
              {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                <label key={side}>{({ top: messages.app.top, right: messages.app.right, bottom: messages.app.bottom, left: messages.app.left } as const)[side]}
                  <input type="number" min={0} max={50} value={pdfOptions.margins[side]} onChange={(event) => setPdfOptions({ ...pdfOptions, margins: { ...pdfOptions.margins, [side]: clampPdfMargin(event.target.value) } })} />
                </label>
              ))}
            </fieldset>
            <label className="pdf-checkbox"><input type="checkbox" checked={pdfOptions.saveWithoutDialog} onChange={(event) => setPdfOptions({ ...pdfOptions, saveWithoutDialog: event.target.checked })} /> {messages.app.withoutDialog}</label>
            <button className="primary" onClick={() => void requestPdfExport()}>{messages.ribbon.labels.exportPdf}</button>
          </aside>
        )}
      </div>
      <footer className="status-bar">
        <span>{modeLabel(mode, messages)}</span><span>{messages.app.status.lines(stats.lines)}</span><span>{messages.app.status.textCharacters(stats.text)}</span><span>{messages.app.status.markdownCharacters(stats.markdown)}</span><span>{messages.app.status.zoom(Math.round(zoom * 100))}</span><span>{inFlightOperationRef.current || localTextRef.current !== hostTextRef.current ? messages.app.status.syncing : messages.app.status.synced}</span>
      </footer>
      {(printPreview || exportStageRequested) && (
        <div className="export-stage" aria-hidden="true">
          <RenderedMarkdown markdown={renderedPreviewMarkdown} html={previewHtml} settings={exportSettings} onRendered={handleExportRendered} />
        </div>
      )}
      {htmlRenderRequest && (
        <HtmlDocumentRenderStage
          request={htmlRenderRequest}
          settings={exportSettings}
          onRendered={(documents) => {
            vscode.postMessage({
              type: 'htmlDocumentsRendered',
              requestId: htmlRenderRequest.requestId,
              documents
            });
            setHtmlRenderRequest(undefined);
          }}
        />
      )}
      {helpTopic && <HelpDialog topic={helpTopic} messages={messages} onClose={() => setHelpTopic(undefined)} />}
      {linkDialogVisible && (
        <LinkDialog
          href={linkHref}
          label={linkLabel}
          messages={messages}
          onHrefChange={setLinkHref}
          onLabelChange={setLinkLabel}
          onApply={applyLinkDialog}
          onClose={() => setLinkDialogVisible(false)}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

/**
 * 選択した画像・数式・Mermaidの参照元と編集内容を表示するインスペクターを描画する。
 * @param props インスペクターの対象、表示設定、変更・終了・参照先操作のコールバック。
 * @returns インスペクターパネルのReact要素。
 */
function Inspector({ target, settings, messages, onChange, onClose, onOpenResource }: {
  target: InspectorTarget;
  settings: WebviewSettings;
  messages: Messages;
  onChange: (source: string, alt?: string) => void;
  onClose: () => void;
  onOpenResource: (href: string) => void;
}): React.JSX.Element {
  const [source, setSource] = useState(target.source);
  const [alt, setAlt] = useState(target.type === 'image' ? target.alt : '');
  useEffect(() => { setSource(target.source); if (target.type === 'image') setAlt(target.alt); }, [target]);
  return (
    <aside className="inspector-panel">
      <div className="panel-title"><h2>{target.type === 'mermaid' ? messages.app.inspector.mermaid : target.type === 'math' ? messages.app.inspector.math : messages.app.inspector.image}</h2><button onClick={onClose}>{messages.app.close}</button></div>
      {target.type === 'image' ? (
        <><img src={source} alt={alt} /><label>{messages.app.inspector.alt}<input value={alt} onChange={(event) => setAlt(event.target.value)} /></label><label>{messages.app.inspector.reference}<input value={source} readOnly /></label><button onClick={() => onOpenResource(source)}>{messages.app.inspector.openFile}</button><button className="primary" onClick={() => onChange(source, alt)}>{messages.app.inspector.apply}</button></>
      ) : (
        <><textarea value={source} spellCheck={false} onChange={(event) => setSource(event.target.value)} /><div className="inspector-preview"><RenderedMarkdown markdown={target.type === 'mermaid' ? `\`\`\`mermaid\n${source}\n\`\`\`` : `$$\n${source}\n$$`} settings={settings} /></div><button className="primary" onClick={() => onChange(source)}>{messages.app.inspector.apply}</button></>
      )}
    </aside>
  );
}

function useMarkdownPreviewSnapshot(
  markdown: string,
  remoteImagesEnabled: boolean,
  language: WebviewSettings['language']
): [MarkdownPreviewSnapshot, () => void] {
  const [snapshot, setSnapshot] = useState<MarkdownPreviewSnapshot>({
    markdown: '',
    html: '',
    outline: [],
    diagnostics: [],
    stats: { markdown: 0, text: 0, lines: 1 }
  });
  const workerRef = useRef<Worker | undefined>(undefined);
  const workerBusyRef = useRef(false);
  const cancelSanitizationRef = useRef<() => void>(() => undefined);
  const generationRef = useRef(0);

  const cancelActiveRender = useCallback(() => {
    generationRef.current += 1;
    if (workerBusyRef.current) {
      workerRef.current?.terminate();
      workerRef.current = undefined;
      workerBusyRef.current = false;
    }
    cancelSanitizationRef.current();
    cancelSanitizationRef.current = () => undefined;
  }, []);

  useEffect(() => {
    cancelActiveRender();
    const id = generationRef.current;
    const startedAt = performance.now();
    const applySynchronousFallback = (error: unknown) => {
      if (generationRef.current !== id) return;
      document.body.dataset.mveMarkdownWorkerStatus = 'fallback';
      console.error('[Markdown Easy Visual Editor] Markdown Workerを利用できないため同期描画へ切り替えます。', error);
      const fallbackStartedAt = performance.now();
      setSnapshot({
        markdown,
        html: renderMarkdown(markdown, { remoteImagesEnabled, language }),
        outline: getOutline(markdown),
        diagnostics: collectDiagnostics(markdown, language),
        stats: wordStats(markdown)
      });
      recordLatestPerformanceMeasure('mve-preview-markdown', fallbackStartedAt);
    };
    const startWorker = async () => {
      try {
        let worker = workerRef.current;
        if (!worker) {
          document.body.dataset.mveMarkdownWorkerStatus = 'loading';
          const workerUrl = await resolveMarkdownWorkerLaunchUrl();
          if (generationRef.current !== id) return;
          worker = new Worker(workerUrl);
          workerRef.current = worker;
        }
        if (generationRef.current !== id) return;
        workerBusyRef.current = true;
        document.body.dataset.mveMarkdownWorkerStatus = 'running';
        worker.onmessage = (event: MessageEvent<MarkdownWorkerResponse>) => {
          recordLatestPerformanceMark('mve-preview-worker-response');
          const response = event.data;
          if (response.id !== id || generationRef.current !== id || workerRef.current !== worker) return;
          workerBusyRef.current = false;
          if (response.error || !response.unsafeBlocks || response.markdown === undefined
            || !response.outline || !response.diagnostics || !response.stats) {
            applySynchronousFallback(response.error);
            return;
          }
          document.body.dataset.mveMarkdownWorkerStatus = 'ready';
          recordLatestPerformanceMeasure('mve-preview-markdown-worker', startedAt);
          cancelSanitizationRef.current = sanitizeMarkdownBlocks(response.unsafeBlocks, () => (
            generationRef.current === id
          ), (html, maximumChunkDuration) => {
            recordLatestPerformanceMark('mve-preview-sanitize-complete');
            cancelSanitizationRef.current = () => undefined;
            recordPerformanceDuration('mve-preview-markdown', maximumChunkDuration);
            if (generationRef.current !== id) return;
            setSnapshot({
              markdown: response.markdown as string,
              html,
              outline: response.outline as OutlineItem[],
              diagnostics: response.diagnostics as Diagnostic[],
              stats: response.stats as { markdown: number; text: number; lines: number }
            });
          });
        };
        worker.onerror = (event) => {
          if (generationRef.current !== id || workerRef.current !== worker) return;
          workerBusyRef.current = false;
          worker.terminate();
          workerRef.current = undefined;
          applySynchronousFallback(event.message);
        };
        worker.postMessage({ id, markdown, options: { remoteImagesEnabled, language } });
      } catch (error) {
        applySynchronousFallback(error);
      }
    };
    void startWorker();
    return cancelActiveRender;
  }, [markdown, remoteImagesEnabled, language, cancelActiveRender]);

  useEffect(() => () => {
    workerRef.current?.terminate();
    workerRef.current = undefined;
    workerBusyRef.current = false;
  }, []);

  return [snapshot, cancelActiveRender];
}

let markdownWorkerBlobUrlPromise: Promise<string> | undefined;

function resolveMarkdownWorkerResourceUrl(): string {
  const configured = document.body.dataset.mveMarkdownWorkerUri;
  if (configured) return configured;
  const script = Array.from(document.scripts).find((candidate) => /(?:^|\/)webview\.js(?:[?#]|$)/.test(candidate.src));
  return new URL('markdown-worker.js', script?.src || document.baseURI).toString();
}

async function resolveMarkdownWorkerLaunchUrl(): Promise<string> {
  const resourceUrl = resolveMarkdownWorkerResourceUrl();
  if (/^(?:blob:|data:)/i.test(resourceUrl)) return resourceUrl;
  markdownWorkerBlobUrlPromise ??= fetch(resourceUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`Markdown Workerの取得に失敗しました (${response.status})`);
      return response.blob();
    })
    .then((blob) => URL.createObjectURL(blob))
    .catch((error) => {
      markdownWorkerBlobUrlPromise = undefined;
      throw error;
    });
  return markdownWorkerBlobUrlPromise;
}

function sanitizeMarkdownBlocks(
  unsafeBlocks: UnsafeMarkdownBlock[],
  shouldContinue: () => boolean,
  onComplete: (html: string, maximumChunkDuration: number) => void
): () => void {
  if (!unsafeBlocks.length) {
    onComplete('', 0);
    return () => undefined;
  }
  const sanitized: string[] = [];
  let index = 0;
  let cancelled = false;
  let timer: number | undefined;
  let maximumChunkDuration = 0;
  let slowestBlock = { duration: 0, length: 0, prefix: '' };
  const close = () => {
    cancelled = true;
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
  };
  const runChunk = () => {
    timer = undefined;
    if (cancelled || !shouldContinue()) {
      close();
      return;
    }
    const startedAt = performance.now();
    do {
      const block = unsafeBlocks[index++];
      const blockStartedAt = performance.now();
      sanitized.push(block.requiresSanitization ? sanitizeRenderedMarkdown(block.html) : block.html);
      const blockDuration = performance.now() - blockStartedAt;
      if (blockDuration > slowestBlock.duration) {
        slowestBlock = {
          duration: blockDuration,
          length: block.html.length,
          prefix: block.html.slice(0, 100)
        };
      }
    } while (index < unsafeBlocks.length && performance.now() - startedAt < 4);
    maximumChunkDuration = Math.max(maximumChunkDuration, performance.now() - startedAt);
    if (index < unsafeBlocks.length) {
      timer = window.setTimeout(runChunk, 0);
      return;
    }
    close();
    performance.clearMarks('mve-preview-sanitize-slowest');
    performance.mark('mve-preview-sanitize-slowest', { detail: slowestBlock });
    (globalThis as typeof globalThis & { __mveSlowestSanitizeBlock?: typeof slowestBlock }).__mveSlowestSanitizeBlock = slowestBlock;
    onComplete(sanitized.join(''), maximumChunkDuration);
  };
  timer = window.setTimeout(runChunk, 0);
  return close;
}

function recordLatestPerformanceMeasure(name: string, startedAt: number): void {
  performance.clearMeasures(name);
  performance.measure(name, { start: startedAt, end: performance.now() });
}

function recordLatestPerformanceMark(name: string): void {
  performance.clearMarks(name);
  performance.mark(name);
}

function recordPerformanceDuration(name: string, duration: number): void {
  performance.clearMeasures(name);
  performance.measure(name, { start: 0, duration });
}

function useInterruptibleDebouncedValue<T>(value: T, delay: number): [T, () => void] {
  const [debounced, setDebounced] = useState(value);
  const initialValueRef = useRef(value);
  const firstNonInitialValueRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  const idleHandleRef = useRef<number | undefined>(undefined);
  const idleUsesTimeoutRef = useRef(false);
  const generationRef = useRef(0);

  const cancelPending = useCallback(() => {
    generationRef.current += 1;
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    if (idleHandleRef.current !== undefined) {
      const idleWindow = window as Window & { cancelIdleCallback?: (handle: number) => void };
      if (idleUsesTimeoutRef.current || !idleWindow.cancelIdleCallback) {
        window.clearTimeout(idleHandleRef.current);
      } else {
        idleWindow.cancelIdleCallback(idleHandleRef.current);
      }
      idleHandleRef.current = undefined;
    }
  }, []);

  useEffect(() => {
    if (!firstNonInitialValueRef.current && value === initialValueRef.current) return;
    // 初回のホスト文書だけは起動時の表示を遅らせない。
    if (!firstNonInitialValueRef.current) {
      firstNonInitialValueRef.current = true;
      setDebounced(value);
      return;
    }
    cancelPending();
    const generation = generationRef.current;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = undefined;
      const commit = () => {
        idleHandleRef.current = undefined;
        if (generation !== generationRef.current) return;
        setDebounced(value);
      };
      const idleWindow = window as Window & {
        requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      };
      if (idleWindow.requestIdleCallback) {
        idleUsesTimeoutRef.current = false;
        idleHandleRef.current = idleWindow.requestIdleCallback(commit, { timeout: 750 });
      } else {
        idleUsesTimeoutRef.current = true;
        idleHandleRef.current = window.setTimeout(commit, 0);
      }
    }, delay);
    return cancelPending;
  }, [value, delay, cancelPending]);

  return [debounced, cancelPending];
}

/** 対話表示用の遅延画像を、PDF・HTML出力では確実に読み込む属性へ置換する。 */
function serializeExportHtml(element: HTMLElement): string {
  return prepareExportHtml(element.innerHTML);
}

/**
 * Markdownを印刷用紙サイズと余白に合わせたプレビューとして描画する。
 * @param props Markdown本文、表示設定、PDF設定、プレビュー内操作のコールバック。
 * @returns 印刷プレビューのReact要素。
 */
function HtmlDocumentRenderStage({ request, settings, onRendered }: {
  request: Extract<HostToWebviewMessage, { type: 'renderHtmlDocuments' }>;
  settings: WebviewSettings;
  onRendered: (documents: Array<{ id: string; html: string }>) => void;
}): React.JSX.Element {
  const renderedRef = useRef(new Map<string, string>());
  const completedRef = useRef(false);
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;

  function handleRendered(id: string, element: HTMLElement): void {
    if (completedRef.current) return;
    renderedRef.current.set(id, serializeExportHtml(element));
    if (renderedRef.current.size !== request.documents.length) return;
    completedRef.current = true;
    onRenderedRef.current(request.documents.map((document) => ({
      id: document.id,
      html: renderedRef.current.get(document.id) ?? ''
    })));
  }

  return (
    <div className="export-stage html-document-render-stage" aria-hidden="true">
      {request.documents.map((document) => (
        <RenderedMarkdown
          key={document.id}
          markdown={document.markdown}
          settings={settings}
          onRendered={(element) => handleRendered(document.id, element)}
        />
      ))}
    </div>
  );
}

function PdfPreview({ markdown, html, settings, options, zoom, messages, pdfBase64, pdfLoading, pdfError, onInspect, onNavigate, onZoom, onRendered }: {
  markdown: string;
  html: string;
  settings: WebviewSettings;
  options: PdfOptions;
  zoom: number;
  messages: Messages;
  pdfBase64?: string;
  pdfLoading: boolean;
  pdfError?: string;
  onInspect: (target: InspectorTarget) => void;
  onNavigate: (href: string) => void;
  onZoom: (delta: number) => void;
  onRendered: () => void;
}): React.JSX.Element {
  const [pdfCanvasReady, setPdfCanvasReady] = useState(false);
  const dimensions = pdfPageDimensions(options);
  const showPdfLayer = Boolean(pdfBase64 && pdfCanvasReady);

  useEffect(() => {
    setPdfCanvasReady(false);
  }, [pdfBase64, zoom]);

  return (
    <div
      className={`pdf-preview-shell ${pdfBase64 ? 'pdf-preview-shell-ready' : ''}`}
      data-pdf-format={options.format}
      data-pdf-orientation={options.orientation}
      data-pdf-zoom={zoom}
    >
      <div className="pdf-preview-toolbar" role="toolbar" aria-label={messages.ribbon.hintZoom}>
        <button type="button" aria-label="PDFズームアウト" title={messages.ribbon.hintZoom} onClick={() => { mveDebug('pdf.zoom-button', { delta: -0.1, zoom }); onZoom(-0.1); }}>−</button>
        <span className="pdf-preview-zoom-value">{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="PDFズームイン" title={messages.ribbon.hintZoom} onClick={() => { mveDebug('pdf.zoom-button', { delta: 0.1, zoom }); onZoom(0.1); }}>＋</button>
      </div>
      {!showPdfLayer && (
        <p className="pdf-preview-status" aria-live="polite">
          {pdfError ? 'PDFプレビューを表示できません。' : pdfLoading ? 'PDFを生成しています。' : pdfBase64 ? 'PDFページを描画しています。' : 'PDFプレビューを準備しています。'}
        </p>
      )}
      {!showPdfLayer && (
        <div className="pdf-preview-live-layer">
          <div className="pdf-preview-live-content" style={{ zoom }}>
            {options.header && <div className="pdf-preview-header">{formatPdfTemplate(options.header)}</div>}
            <RenderedMarkdown
              markdown={markdown}
              html={html}
              settings={settings}
              className="pdf-preview-content"
              onInspect={onInspect}
              onNavigate={onNavigate}
              onRendered={() => onRendered()}
              deferMermaid
            />
            {options.footer && <div className="pdf-preview-footer">{formatPdfTemplate(options.footer)}</div>}
          </div>
        </div>
      )}
      {pdfBase64 && (
        <div className={`pdf-preview-pdf-layer ${showPdfLayer ? '' : 'is-preparing'}`}>
          <PdfDocumentPreview
            data={pdfBase64}
            pageRatio={dimensions.width / dimensions.height}
            zoom={zoom}
            onRendered={() => {
              mveDebug('pdf.preview-layer-ready', { zoom, format: options.format, orientation: options.orientation });
              setPdfCanvasReady(true);
              onRendered();
            }}
          />
        </div>
      )}
      {pdfError && <p className="pdf-preview-error">{pdfError}</p>}
      <p className="pdf-preview-note">{options.format} · {options.orientation === 'portrait' ? messages.app.portrait : messages.app.landscape} / {messages.app.margins} {messages.app.top}{options.margins.top} · {messages.app.right}{options.margins.right} · {messages.app.bottom}{options.margins.bottom} · {messages.app.left}{options.margins.left} mm</p>
    </div>
  );
}

/**
 * リンクのURLと表示文字列を入力するダイアログを描画する。
 * @param props 現在の入力値と各入力・適用・終了操作のコールバック。
 * @returns リンク入力ダイアログのReact要素。
 */
function LinkDialog({ href, label, messages, onHrefChange, onLabelChange, onApply, onClose }: {
  href: string;
  label: string;
  messages: Messages;
  onHrefChange: (value: string) => void;
  onLabelChange: (value: string) => void;
  onApply: () => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="link-dialog-title">
      <form className="help-dialog link-dialog" onSubmit={(event) => { event.preventDefault(); onApply(); }}>
        <div className="panel-title"><h2 id="link-dialog-title">{messages.app.link.title}</h2><button type="button" onClick={onClose}>{messages.app.close}</button></div>
        <label>{messages.app.link.url}<input autoFocus type="url" value={href} onChange={(event) => onHrefChange(event.target.value)} placeholder={messages.app.link.urlPlaceholder} /></label>
        <label>{messages.app.link.text} {messages.app.link.textHint}<input value={label} onChange={(event) => onLabelChange(event.target.value)} /></label>
        <div className="dialog-actions"><button type="button" onClick={onClose}>{messages.app.link.cancel}</button><button className="primary" type="submit">{messages.app.link.insert}</button></div>
      </form>
    </div>
  );
}

/**
 * ショートカットとアプリの機能一覧を表示する。
 * @param props 表示するヘルプ種別とダイアログを閉じるコールバック。
 * @returns ヘルプダイアログのReact要素。
 */
function HelpDialog({ topic, messages, onClose }: { topic: HelpTopic; messages: Messages; onClose: () => void }): React.JSX.Element {
  const title = topic === 'shortcuts'
    ? messages.app.help.shortcuts
    : messages.ribbon.labels.features;
  const featureSections = [
    {
      title: messages.ribbon.tabs.home,
      items: [
        [messages.ribbon.labels.undo, messages.ribbon.featureDescriptions.undo],
        [messages.ribbon.labels.redo, messages.ribbon.featureDescriptions.redo],
        [messages.ribbon.labels.bold, messages.ribbon.featureDescriptions.bold],
        [messages.ribbon.labels.italic, messages.ribbon.featureDescriptions.italic],
        [messages.ribbon.labels.clearInline, messages.ribbon.featureDescriptions.clearInline],
        [messages.ribbon.labels.clearBlock, messages.ribbon.featureDescriptions.clearBlock]
      ]
    },
    {
      title: messages.ribbon.tabs.insert,
      items: [
        [messages.ribbon.labels.link, messages.ribbon.featureDescriptions.link],
        [messages.ribbon.labels.image, messages.ribbon.featureDescriptions.image],
        [messages.ribbon.labels.insertTable, messages.ribbon.featureDescriptions.insertTable],
        [messages.ribbon.labels.codeBlock, messages.ribbon.featureDescriptions.codeBlock],
        [messages.ribbon.labels.math, messages.ribbon.featureDescriptions.math],
        [messages.ribbon.labels.footnote, messages.ribbon.featureDescriptions.footnote],
        [messages.ribbon.labels.toc, messages.ribbon.featureDescriptions.toc]
      ]
    },
    {
      title: messages.ribbon.tabs.table,
      items: [
        [messages.app.tableEditor.title, messages.ribbon.featureDescriptions.tableEditor],
        [messages.app.tableEditor.resizeColumn, messages.ribbon.featureDescriptions.tableEditorColumnResize],
        [messages.app.tableEditor.resizeRow, messages.ribbon.featureDescriptions.tableEditorRowResize],
        [messages.app.tableEditor.resizeEditor, messages.ribbon.featureDescriptions.tableEditorLayout],
        [messages.ribbon.labels.addBefore, messages.ribbon.featureDescriptions.addBefore],
        [messages.ribbon.labels.deleteRow, messages.ribbon.featureDescriptions.deleteRow],
        [messages.ribbon.labels.deleteColumn, messages.ribbon.featureDescriptions.deleteColumn],
        [messages.ribbon.labels.alignLeft, messages.ribbon.featureDescriptions.alignLeft],
        [messages.ribbon.labels.alignCenter, messages.ribbon.featureDescriptions.alignCenter],
        [messages.ribbon.labels.alignRight, messages.ribbon.featureDescriptions.alignRight],
        [messages.ribbon.labels.copyTsv, messages.ribbon.featureDescriptions.copyTsv]
      ]
    },
    {
      title: messages.ribbon.tabs.view,
      items: [
        [messages.ribbon.outline, messages.ribbon.featureDescriptions.outline],
        [messages.ribbon.search, messages.ribbon.featureDescriptions.search],
        [messages.ribbon.split, messages.ribbon.featureDescriptions.split],
        [messages.ribbon.textOnly, messages.ribbon.featureDescriptions.textOnly],
        [messages.ribbon.previewOnly, messages.ribbon.featureDescriptions.previewOnly]
      ]
    },
    {
      title: messages.ribbon.tabs.export,
      items: [
        [messages.ribbon.labels.printPreview, messages.ribbon.featureDescriptions.printPreview],
        [messages.ribbon.labels.exportPdf, messages.ribbon.featureDescriptions.exportPdf],
        [messages.ribbon.labels.preflight, messages.ribbon.featureDescriptions.preflight]
      ]
    }
  ];
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="help-dialog-title">
      <section className="help-dialog">
        <div className="panel-title"><h2 id="help-dialog-title">{title}</h2><button onClick={onClose}>{messages.app.close}</button></div>
        {topic === 'shortcuts' && (
          <table><tbody><tr><th>Ctrl+V</th><td>{messages.app.help.shortcutImage}</td></tr><tr><th>Alt+Enter</th><td>{messages.app.help.shortcutTableBreak}</td></tr></tbody></table>
        )}
        {topic === 'features' && (
          <div className="feature-list">
            {featureSections.map((section) => (
              <section key={section.title}>
                <h3>{section.title}</h3>
                <ul>
                  {section.items.map(([label, description]) => (
                    <li key={label}><strong>{label}</strong><span>{description}</span></li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * 選択された画像ファイルをホストへ送信できるBase64ペイロードへ変換する。
 * @param file 変換対象の画像ファイル。
 * @param maxSizeMb 許可するファイルサイズの上限（MB）。
 * @returns ファイル名、MIMEタイプ、Base64本文を含むペイロード。
 * @throws Error ファイルがサイズ上限を超える場合、またはBMPのPNG変換に失敗した場合。
 */
async function fileToPayload(file: File, maxSizeMb: number, messages: Messages): Promise<ImagePayload> {
  if (file.size > maxSizeMb * 1024 * 1024) throw new Error(messages.app.errors.imageSize(maxSizeMb));
  if (file.type === 'image/bmp') {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error(messages.app.errors.bmpConversion)), 'image/png'));
    return { name: file.name.replace(/\.bmp$/i, '.png'), mime: 'image/png', base64: await blobBase64(blob) };
  }
  return { name: file.name, mime: file.type || 'image/png', base64: await blobBase64(file) };
}

/**
 * ファイルのMIMEタイプまたは拡張子から画像ファイルかどうかを判定する。
 * @param file 判定対象のファイル。
 * @returns 画像として扱える場合はtrue。
 */
function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(?:png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name);
}

/**
 * BlobのバイナリをWebviewから送信可能なBase64文字列へ変換する。
 * @param blob 変換対象のBlob。
 * @returns BlobのBase64表現。
 */
async function blobBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

/**
 * 選択文字列に含まれるMarkdown記法からツールバーの書式状態を推測する。
 * @param value 書式状態を調べる選択文字列。
 * @returns 各書式が含まれているかを示す真偽値の集合。
 */
function inferMarks(value: string): Record<string, boolean> {
  return { bold: /\*\*[^*]+\*\*/.test(value), italic: /(?:^|[^*])\*[^*]+\*/.test(value), strike: /~~.+~~/.test(value), underline: /\+\+.+\+\+/.test(value), highlight: /==.+==/.test(value), inlineCode: /`[^`]+`/.test(value), link: /\[[^\]]+]\([^)]+\)/.test(value) };
}

/**
 * 本文中の検索文字列の出現位置を、半開区間の配列として列挙する。
 * @param value 検索対象の本文。
 * @param query 検索する文字列。
 * @returns 一致箇所の開始位置と終了位置の配列。
 */
function findSearchHits(value: string, query: string): Array<{ from: number; to: number }> {
  if (!query) return [];
  const hits: Array<{ from: number; to: number }> = [];
  let offset = 0;
  while (offset <= value.length) {
    const index = value.indexOf(query, offset);
    if (index < 0) break;
    hits.push({ from: index, to: index + query.length });
    offset = index + query.length;
  }
  return hits;
}

/**
 * 分割ペイン比率を許容範囲へ丸める。
 * @param value 入力された分割比率。
 * @returns 0.2から0.8の範囲に収めた分割比率。
 */
function clampSplitRatio(value: number): number {
  return Math.max(0.2, Math.min(0.8, Number.isFinite(value) ? value : 0.5));
}

/**
 * 用紙種別と向きから印刷プレビューのページ寸法をmm単位で求める。
 * @param options PDF出力設定。
 * @returns ページの幅と高さ。
 */
function pdfPageDimensions(options: PdfOptions): { width: number; height: number } {
  const dimensions = options.format === 'A3'
    ? { width: 297, height: 420 }
    : options.format === 'Letter'
      ? { width: 216, height: 279 }
      : { width: 210, height: 297 };
  return options.orientation === 'landscape'
    ? { width: dimensions.height, height: dimensions.width }
    : dimensions;
}

/**
 * PDFヘッダー・フッターのページ置換記号をライブプレビュー用の値へ置き換える。
 * @param value ヘッダーまたはフッターのテンプレート。
 * @returns ライブプレビュー表示用に置換した文字列。
 */
function formatPdfTemplate(value: string): string {
  return value.replace(/\{page\}/g, '1').replace(/\{pages\}/g, '1');
}

/**
 * PDF余白入力を数値化し、0から50mmの範囲へ丸める。
 * @param value 数値入力欄の文字列。
 * @returns 正規化した余白値（mm）。
 */
function clampPdfMargin(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(50, Math.round(parsed))) : 0;
}

/**
 * アウトラインペインの幅を許容範囲へ丸める。
 * @param value 入力された幅（px）。
 * @returns 160から420pxの範囲に収めた幅。
 */
function clampOutlineWidth(value: number): number {
  return Math.max(160, Math.min(420, Number.isFinite(value) ? Math.round(value) : 220));
}

/**
 * プレビューの拡大率を0.1刻みの許容範囲へ丸める。
 * @param value 入力された拡大率。
 * @returns 0.7から1.6の範囲に収めた拡大率。
 */
function clampZoom(value: number): number {
  return Math.max(0.7, Math.min(1.6, Math.round(value * 10) / 10));
}

/**
 * リモート変更を基準にローカル変更の位置を写像し、重複時はローカル範囲を優先する。
 * @param changes ローカル側へ適用する変更集合。
 * @param over 先に適用された変更集合。
 * @param baseLength 変更前本文の長さ。
 * @returns 写像後のローカル変更集合。
 */
function mapChangesPreferLocal(
  changes: readonly TextChange[],
  over: readonly TextChange[],
  baseLength: number
): TextChange[] {
  return [...changes]
    .sort((left, right) => left.rangeOffset - right.rangeOffset)
    .map((change) => {
      const start = change.rangeOffset;
      if (change.rangeLength === 0) {
        return { ...change, rangeOffset: mapTextOffset(start, over, baseLength, 1) };
      }
      const mappedStart = mapTextOffset(start, over, baseLength, -1);
      const mappedEnd = mapTextOffset(start + change.rangeLength, over, baseLength, 1);
      return {
        ...change,
        rangeOffset: mappedStart,
        rangeLength: Math.max(0, mappedEnd - mappedStart)
      };
    });
}

/**
 * 現在のモードと分割表示からテキスト編集を許可できるか判定する。
 * @param mode エディター全体の表示モード。
 * @param splitView 分割モード時に表示するペイン。
 * @returns テキスト編集を許可する場合はtrue。
 */
function isEditingEnabled(mode: EditorMode, splitView: 'both' | 'text' | 'preview'): boolean {
  return mode !== 'preview' && !(mode === 'split' && splitView === 'preview');
}

/** Webview状態から有効な通常表示モードを復元する。 */
function restoreViewMode(value: unknown): ViewMode {
  return value === 'text' || value === 'preview' ? value : 'both';
}

/**
 * エディターモードをステータスバー用の日本語表示へ変換する。
 * @param mode エディター全体の表示モード。
 * @returns モードの表示名。
 */
function modeLabel(mode: EditorMode, messages: Messages): string {
  return mode === 'split' ? messages.app.status.modeSplit : messages.app.status.modePreview;
}

/**
 * 指定された囲みブロックの本文が期待値と一致するときだけ新しい本文へ置換する。
 * @param markdown 置換対象のMarkdown本文。
 * @param opening ブロック開始記号。
 * @param closing ブロック終了記号。
 * @param previous 置換対象として期待する現在の本文。
 * @param next 置換後に挿入する本文。
 * @returns 条件に一致したブロックを置換したMarkdown本文。
 */
function replaceDelimitedBlock(markdown: string, opening: string, closing: string, previous: string, next: string): string {
  const pattern = new RegExp(`(${escapeRegExp(opening)}[^\\r\\n]*(\\r\\n|\\r|\\n))([\\s\\S]*?)(\\r\\n|\\r|\\n)${escapeRegExp(closing)}`, 'g');
  const normalizedPrevious = previous.replace(/\r\n?|\n/g, '\n');
  return markdown.replace(pattern, (whole, prefix: string, openingEol: string, body: string, closingEol: string) => {
    if (body.replace(/\r\n?|\n/g, '\n') !== normalizedPrevious) return whole;
    const replacement = next.replace(/\r\n?|\n/g, '\n').replace(/\n/g, openingEol);
    return `${prefix}${replacement}${closingEol}${closing}`;
  });
}

/**
 * 文字列を正規表現のリテラルとして扱えるようにメタ文字をエスケープする。
 * @param value エスケープ対象の文字列。
 * @returns 正規表現へ埋め込めるエスケープ済み文字列。
 */
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const PRINT_CONTENT_CSS = `
body{font-family:"Noto Sans JP","Yu Gothic UI",sans-serif;color:#202124;line-height:1.75;font-size:11pt}
h1{font-size:24pt;border-bottom:2px solid #3a70b8;padding-bottom:6px}h2{font-size:18pt;border-bottom:1px solid #bbb;padding-bottom:4px}h3{font-size:14pt}
table{border-collapse:collapse;width:100%;margin:1em 0}th,td{border:1px solid #888;padding:6px 8px;vertical-align:top;word-break:normal;overflow-wrap:anywhere}th{background:#eaf1fb}
table th[data-mve-nowrap="true"],table td[data-mve-nowrap="true"]{white-space:nowrap;overflow-wrap:normal}
pre{background:#f5f5f5;border:1px solid #ddd;border-radius:4px;padding:12px;overflow-wrap:anywhere;white-space:pre-wrap}
blockquote,.markdown-alert{border-left:4px solid #3a70b8;margin:1em 0;padding:8px 14px;background:#f4f7fb}
img,svg{max-width:100%;height:auto}.page-break{break-after:page}.code-figure figcaption button{display:none}.table-of-contents ul{list-style:none;padding-left:0}.toc-level-2{padding-left:1em}.toc-level-3{padding-left:2em}
`;

/**
 * 印刷用HTMLへ渡すCSSを組み立て、同一オリジンで読めるスタイルシートの規則を追加する。
 * @returns 印刷用の結合済みCSS文字列。
 */
function collectPrintableCss(includeEmbeddedFonts = true): string {
  const rules: string[] = [PRINT_CONTENT_CSS];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (!includeEmbeddedFonts && rule.type === CSSRule.FONT_FACE_RULE) continue;
        const css = rule.cssText;
        if ((includeEmbeddedFonts && css.startsWith('@font-face')) || css.includes('.katex') || css.includes('.hljs')) {
          rules.push(css);
        }
      }
    } catch {
      // 読み取りが禁止されたスタイルシートは印刷本文の生成を妨げないよう除外する。
    }
  }
  return rules.join('\n');
}

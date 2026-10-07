/**
 * @fileoverview Webviewのルートコンポーネントとして、編集状態、Hostメッセージ、プレビュー、設定、保存操作を統合する。
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import DOMPurify from "dompurify";
import TurndownService from "turndown";
import { gfm as turndownGfm } from "turndown-plugin-gfm";
import {
  DEFAULT_HTML_EXPORT_SETTINGS,
  DEFAULT_HTML_EXPORT_OPTIONS,
  DEFAULT_PDF_OPTIONS,
  PDF_PAPER_FORMATS,
  mergeHtmlExportOptions,
  normalizeHtmlExportSettings,
  normalizePdfOptions,
} from "../shared/protocol";
import type {
  EditorMode,
  HostToWebviewMessage,
  HtmlExportSettings,
  HtmlExportOptions,
  ImagePayload,
  NormalizedPdfOptions,
  PdfOptions,
  PdfTextReplacementRule,
  VsCodeApi,
  ViewMode,
  WebviewSettings,
  WebviewToHostMessage,
} from "../shared/protocol";
import {
  applyMarkdownTableAction,
  applyMarkdownTableTsv,
  canMoveOutlineSection,
  collectDiagnostics,
  createTableMarkdown,
  getOutline,
  imageMarkdown,
  isMarkdownCodeFencePosition,
  isOutlineEmptyParentTarget,
  markdownTableToTsv,
  moveOutlineSection,
  sortDiagnostics,
  summarizeDiagnostics,
  type Diagnostic,
  type OutlineItem,
  type TextSelection,
  wordStats,
} from "../shared/markdown";
import {
  applyTextChanges,
  computeTextChanges,
  mapTextChanges,
  mapTextOffset,
  type TextChange,
} from "../shared/textChanges";
import { fingerprintText } from "../shared/canonicalText";
import {
  alignImageInMarkdown,
  resetImageSizeInMarkdown,
  resizeImageInMarkdown,
  type ImageAlignment,
} from "../shared/imageResize";
import { getMessages, type Messages } from "../shared/messages";
import {
  DEFAULT_FONT_FAMILY_STACK,
  DEFAULT_FONT_FAMILY_SETTINGS,
  fontFamilyForCss,
  normalizeFontFamily,
} from "../shared/fontFamily";
import { prepareExportHtml } from "../shared/exportHtml";
import { applyPdfTextReplacements } from "../shared/pdfTextReplacement";
import { createClientId } from "./id";
import { webviewAssetUrl } from "./assets";
import { isMveDebugEnabled, mveDebug } from "./debug";
import { escapeHtml } from "../shared/escapeHtml";
import { sanitizeRenderedMarkdown } from "./markdownSanitizer";
import { renderMarkdownFallback } from "./markdownFallback";
import type { UnsafeMarkdownBlock } from "./markdownRendererCore";
import { acceptMermaidRenderResult } from "./mermaidRenderer";
import { RenderedMarkdown, type InspectorTarget } from "./RenderedMarkdown";
import { PdfDocumentPreview } from "./PdfDocumentPreview";
import { Ribbon, type RibbonCommand } from "./Ribbon";
import {
  SourceEditor,
  type EditorViewportAnchor,
  type TextEditorHandle,
} from "./SourceEditor";
import {
  capturePreviewViewport,
  restoreScrollRatio,
  restorePreviewViewport,
  type PreviewViewportAnchor,
} from "./scrollAnchors";

/**
 * Webviewルートのacquire・vs・code・apiに関する状態または設定。
 */
declare const acquireVsCodeApi: <State = unknown>() => VsCodeApi<State>;

/**
 * Webviewルートの現在状態または履歴を保持するデータ形状。
 */
interface PersistedState {
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
   * Webviewルートのview・modeに関する状態または設定。
   */
  viewMode?: ViewMode;

  /**
   * Webviewルートのsplit・viewに関する状態または設定。
   */
  splitView?: "both" | "text" | "preview";

  /**
   * Webviewルートのsource・viewportに関する状態または設定。
   */
  sourceViewport?: EditorViewportAnchor;

  /**
   * Webviewルートのsplit・preview・viewportに関する状態または設定。
   */
  splitPreviewViewport?: PreviewViewportAnchor;

  /**
   * Webviewルートのpreview・only・viewportに関する状態または設定。
   */
  previewOnlyViewport?: PreviewViewportAnchor;
}

/**
 * Webviewルートで共有するデータ形状を表すインターフェース。
 */
interface PendingLocalOperation {
  /**
   * Webviewルートで扱うop・idの文字列。
   */
  opId: string;

  /**
   * Webviewルートのbase・versionを表す数値。
   */
  baseVersion: number;

  /**
   * Webviewルートで解析・表示・保存する本文。
   */
  baseText: string;

  /**
   * Webviewルートで解析・表示・保存する本文。
   */
  resultText: string;

  /**
   * 本文へ適用する変更範囲の一覧。
   */
  changes: TextChange[];
}

/**
 * 右ドラッグで見出しを並べ替える間のポインターと配置状態を保持する。
 */
interface OutlineDragState {
  /**
   * ドラッグを開始した見出しのアウトライン配列内の位置。
   */
  sourceIndex: number;

  /**
   * 操作中のポインターを識別するID。
   */
  pointerId: number;

  /**
   * 右ドラッグを開始した画面上のX座標。
   */
  startX: number;

  /**
   * 右ドラッグを開始した画面上のY座標。
   */
  startY: number;

  /**
   * ドラッグ開始時点のMarkdown本文。
   */
  markdown: string;

  /**
   * ドラッグ開始時点のアウトライン項目。
   */
  outline: OutlineItem[];

  /**
   * 移動距離がしきい値を超えて並べ替え操作になったかどうか。
   */
  dragging: boolean;

  /**
   * 現在のドロップ先見出しのアウトライン配列内の位置。
   */
  targetIndex?: number;

  /**
   * ドロップ先見出しの前後どちらへ配置するか。
   */
  position?: "before" | "after";
}

/** アウトライン項目の階層と元の一覧位置を保持するツリーノード。 */
interface OutlineTreeNode {
  /** 対応する平坦なアウトライン項目。 */
  item: OutlineItem;

  /** 元のアウトライン配列における0始まりの位置。 */
  index: number;

  /** 見出しレベルから導出した子見出し。 */
  children: OutlineTreeNode[];
}

/** 現在の見出し構成に対応する折りたたみ状態。 */
interface OutlineCollapseState {
  /** 開閉状態が有効な見出し構成の署名。 */
  signature: string;

  /** 折りたたまれている見出しID。 */
  collapsedIds: Set<string>;
}

/**
 * 平坦な見出し一覧から、レベル順のツリーを線形時間で構築する。
 * @param outline 文書順のアウトライン項目。
 * @returns 元の配列位置を保持したツリーのルート項目。
 */
function buildOutlineTree(outline: readonly OutlineItem[]): OutlineTreeNode[] {
  const roots: OutlineTreeNode[] = [];
  const ancestors: OutlineTreeNode[] = [];

  for (let index = 0; index < outline.length; index += 1) {
    const item = outline[index];
    while (
      ancestors.length > 0 &&
      ancestors[ancestors.length - 1].item.level >= item.level
    ) {
      ancestors.pop();
    }

    const node: OutlineTreeNode = { item, index, children: [] };
    const parent = ancestors[ancestors.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    ancestors.push(node);
  }

  return roots;
}

/**
 * 開閉状態を無効化する見出し構成の署名を作成する。
 * @param outline 文書順のアウトライン項目。
 * @returns 見出しID、レベル、本文を含む構成署名。
 */
function getOutlineStructureSignature(outline: readonly OutlineItem[]): string {
  const structure: Array<[string, number, string]> = [];
  for (const item of outline) {
    structure.push([item.id, item.level, item.text]);
  }
  return JSON.stringify(structure);
}

/** 折りたたまれた見出しがない場合に参照する空のID集合。 */
const EMPTY_OUTLINE_IDS = new Set<string>();

/**
 * Webviewルートで扱う値の種類と境界を表す型。
 */
type LocalResourceCheckPurpose = "preflight" | "pdf";

/**
 * Webviewルートで送受信するメッセージまたは要求のデータ形状。
 */
interface LocalResourceCheckRequest {
  /**
   * 解析・編集・変換の対象となるMarkdown本文。
   */
  markdown: string;

  /**
   * Webviewルートのversionを表す数値。
   */
  version: number;

  /**
   * Webviewルートのgenerationを表す数値。
   */
  generation: number;

  /**
   * Webviewルートのpurposeに関する状態または設定。
   */
  purpose: LocalResourceCheckPurpose;
}

/**
 * Webviewルートの現在状態または履歴を保持するデータ形状。
 */
interface PdfPreviewState {
  /**
   * 要求と応答を対応付ける識別子。
   */
  requestId: string;

  /**
   * Webviewルートで扱うpdf・base64の文字列。
   */
  pdfBase64?: string;

  /**
   * Webviewルートのloadingを切り替えるフラグ。
   */
  loading: boolean;

  /**
   * 処理に失敗した理由または例外。
   */
  error?: string;
}

/**
 * Webviewルートのvscodeに関する状態または設定。
 */
const vscode = acquireVsCodeApi<PersistedState>();

/**
 * 本文ペインとプレビューペインのスクロール同期を再実行する間隔（ミリ秒）。
 */
const CROSS_PANE_SCROLL_SYNC_MS = 32;

/**
 * Webviewルートで未指定時に使う既定値。
 */
const DEFAULT_SETTINGS: WebviewSettings = {
  ...DEFAULT_FONT_FAMILY_SETTINGS,
  language: "ja",
  imageDirectory: "assets/${documentBasename}",
  maxPasteSizeMb: 20,
  remoteImagesEnabled: true,
  mermaidTheme: "auto",
  viewMode: "both",
  outlineVisible: true,
  scrollSyncEnabled: true,
  pdfOptions: DEFAULT_PDF_OPTIONS,
  htmlOptions: DEFAULT_HTML_EXPORT_SETTINGS,
  workspaceTrusted: false,
};

/**
 * Markdown preview再描画をまとめる遅延時間（ミリ秒）。
 */
const PREVIEW_UPDATE_DELAY_MS = 120;

/**
 * Webviewルートへ渡す設定または境界値。
 */
const PDF_OPTIONS_PERSIST_DELAY_MS = 250;

/**
 * アウトライン項目をドラッグと判定する最小移動距離（CSS px）。
 */
const OUTLINE_DRAG_THRESHOLD_PX = 6;

/**
 * Webviewルートで扱う値の種類と境界を表す型。
 */
type HelpTopic = "shortcuts" | "features";

/**
 * 静的検査とローカルリソース検査の診断をまとめ、言語に合わせて表示する。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param localResourceDiagnostics ローカルリソース検査で得た診断一覧。
 * @param language 診断メッセージのロケール。
 * @returns 表示言語へ変換して統合した診断一覧。
 */
function mergeDiagnostics(
  markdown: string,
  localResourceDiagnostics: Diagnostic[],
  language: WebviewSettings["language"],
): Diagnostic[] {
  return mergeCollectedDiagnostics(
    collectDiagnostics(markdown, language),
    localResourceDiagnostics,
  );
}

/**
 * Webviewルートの現在状態または履歴を保持するデータ形状。
 */
interface MarkdownPreviewSnapshot {
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
   * Webviewルートのdiagnosticsに関する状態または設定。
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
}

/**
 * Webviewルートで送受信するメッセージまたは要求のデータ形状。
 */
interface MarkdownWorkerResponse {
  /**
   * Webviewルートのidを表す数値。
   */
  id: number;

  /**
   * Webviewルートのpreliminaryを切り替えるフラグ。
   */
  preliminary?: boolean;

  /**
   * Markdown Workerが先行描画した本文。
   */
  markdown?: string;

  /**
   * Webviewルートのunsafe・blocksに関する状態または設定。
   */
  unsafeBlocks?: UnsafeMarkdownBlock[];

  /**
   * Markdown本文から抽出した目次項目の一覧。
   */
  outline?: OutlineItem[];

  /**
   * Webviewルートのdiagnosticsに関する状態または設定。
   */
  diagnostics?: Diagnostic[];

  /**
   * Webviewルートのstatsに関する状態または設定。
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

/**
 * Webviewルートで共有するデータ形状を表すインターフェース。
 */
interface WebviewBootstrap {
  /**
   * 表示・解析・変換の対象となる本文。
   */
  text: string;

  /**
   * Webviewルートのversionを表す数値。
   */
  version: number;

  /**
   * VS Codeまたはブラウザーが扱うリソースURI。
   */
  uri: string;

  /**
   * Webviewルートへ渡す設定または境界値。
   */
  settings: WebviewSettings;
}

/**
 * Webviewルートから必要な値またはリソースを取得する。
 * @returns 副作用を完了し、値は返さない。
 */
function readWebviewBootstrap(): WebviewBootstrap | undefined {
  return (
    globalThis as typeof globalThis & {
      /**
       * Webviewルートの・mve・bootstrapに関する状態または設定。
       */
      __mveBootstrap?: WebviewBootstrap;
    }
  ).__mveBootstrap;
}

/**
 * 静的診断とローカルリソース診断を統合し、重複する画像警告をまとめる。
 * @param staticDiagnostics - 事前生成済みで動的検査結果と統合する診断一覧。
 * @param localResourceDiagnostics ローカルリソース検査で得た診断一覧。
 * @returns 重複をまとめた診断一覧。
 */
function mergeCollectedDiagnostics(
  staticDiagnostics: Diagnostic[],
  localResourceDiagnostics: Diagnostic[],
): Diagnostic[] {
  const missingImages = new Set(
    localResourceDiagnostics
      .filter(
        /**
         * sourceを持つmissing-local-image診断だけを残す。
         * @param item - 欠落したローカル画像を示すリソース診断。
         * @returns 条件を満たした要素だけを含む一覧。
         */
        (item) => item.code === "missing-local-image" && item.source,
      )
      .map(
        /**
         * 欠落画像診断から参照元を集める。
         * @param item - 重複診断を照合するローカル画像参照文字列を含む診断。
         * @returns sourceを取り出した変換結果の一覧。
         */
        (item) => item.source as string,
      ),
  );
  const filteredStaticDiagnostics = staticDiagnostics.filter(
    /**
     * 欠落画像診断と重複する静的診断を除外する。
     * @param item - 静的Markdown解析が生成した診断。
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (item) =>
      item.code !== "local-image" ||
      !item.source ||
      !missingImages.has(item.source),
  );
  return sortDiagnostics([
    ...filteredStaticDiagnostics,
    ...localResourceDiagnostics,
  ]);
}

/**
 * Host設定を編集状態へ取り込み、リボン・各種パネル・プレビューの表示と更新を統括する。
 * @returns Webviewのメイン画面。設定変更はHostへ送り、文書編集は本文状態へ反映する。
 */
export function App(): React.JSX.Element {
  const restored = vscode.getState();
  const bootstrap = readWebviewBootstrap();
  const hasRestoredViewMode =
    restored?.viewMode !== undefined || restored?.splitView !== undefined;
  // modeのpreviewは印刷プレビュー用の一時状態だったため、通常表示としては復元しない。
  const [mode, setMode] = useState<EditorMode>("split");
  const [outlineVisible, setOutlineVisible] = useState(
    bootstrap?.settings.outlineVisible ?? true,
  );
  const [outlineWidth, setOutlineWidth] = useState(
    /**
     * 要素をclamp・outline・widthへ渡し、Webviewルートの結果または副作用を処理する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => clampOutlineWidth(restored?.outlineWidth ?? 220),
  );
  const [splitRatio, setSplitRatio] = useState(
    /**
     * 要素をclamp・split・ratioへ渡し、Webviewルートの結果または副作用を処理する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => clampSplitRatio(restored?.splitRatio ?? 0.5),
  );
  const [zoom, setZoom] = useState(
    /**
     * 要素をclamp・zoomへ渡し、Webviewルートの結果または副作用を処理する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => clampZoom(restored?.zoom ?? 1),
  );
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [splitView, setSplitView] = useState<ViewMode>(
    restoreViewMode(
      restored?.viewMode ?? restored?.splitView ?? bootstrap?.settings.viewMode,
    ),
  );
  const [initialized, setInitialized] = useState(Boolean(bootstrap));
  const [markdown, setMarkdown] = useState(bootstrap?.text ?? "");
  // 入力経路と、解析・HTML化が重い表示経路を分離する。入力が再開した場合は
  // 既に予約済みの全文更新を同期的に取り消し、キーイベントへ割り込ませない。
  const [previewMarkdown, cancelPendingPreviewUpdate] =
    useInterruptibleDebouncedValue(markdown, PREVIEW_UPDATE_DELAY_MS);
  const [version, setVersion] = useState(bootstrap?.version ?? 0);
  const [settings, setSettings] = useState(
    bootstrap?.settings ?? DEFAULT_SETTINGS,
  );
  const scrollSyncEnabled = settings.scrollSyncEnabled !== false;
  const scrollSyncEnabledRef = useRef(scrollSyncEnabled);
  scrollSyncEnabledRef.current = scrollSyncEnabled;
  const [previewSnapshot, cancelActivePreviewRender] =
    useMarkdownPreviewSnapshot(
      previewMarkdown,
      settings.remoteImagesEnabled,
      settings.language,
      initialized,
      stagePreviewRefinementViewportRestore,
    );
  const cancelPreviewWork = useCallback(
    /**
     * 要素をifへ渡し、Webviewルートの結果または副作用を処理する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => {
      if (document.body.dataset.mveInputActive !== "true") {
        document.body.dataset.mveInputActive = "true";
        window.dispatchEvent(new Event("mve-preview-input-active"));
      }
      cancelPendingPreviewUpdate();
      cancelActivePreviewRender();
    },
    [cancelPendingPreviewUpdate, cancelActivePreviewRender],
  );
  const renderedPreviewMarkdown = previewSnapshot.markdown;
  const messages = useMemo(
    /**
     * 要素をget・messagesへ渡し、Webviewルートの結果または副作用を処理する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => getMessages(settings.language),
    [settings.language],
  );
  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => {
      if (settings.language) document.documentElement.lang = settings.language;
    },
    [settings.language],
  );
  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => {
      const root = document.documentElement;
      const editorFontFamily = normalizeFontFamily(settings.editorFontFamily);
      const previewFontFamily = normalizeFontFamily(settings.previewFontFamily);
      root.style.setProperty(
        "--mve-editor-font-family",
        fontFamilyForCss(editorFontFamily, DEFAULT_FONT_FAMILY_STACK),
      );
      root.style.setProperty(
        "--mve-preview-font-family",
        fontFamilyForCss(previewFontFamily, DEFAULT_FONT_FAMILY_STACK),
      );
    },
    [settings.editorFontFamily, settings.previewFontFamily],
  );
  // HTML/PDFの出力先は白背景のため、VS CodeのダークテーマをSVGへ持ち込まない。
  const exportSettings = useMemo(
    /**
     * Webviewルートのコールバックとして要素を処理する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => ({ ...settings, mermaidTheme: "default" as const }),
    [settings],
  );
  const [activeMarks, setActiveMarks] = useState<Record<string, boolean>>({});
  const activeMarksRef = useRef<Record<string, boolean>>({});
  const [inspector, setInspector] = useState<InspectorTarget>();
  const [diagnosticsVisible, setDiagnosticsVisible] = useState(false);
  const [localResourceDiagnostics, setLocalResourceDiagnostics] = useState<
    Diagnostic[]
  >([]);
  const [printPreview, setPrintPreview] = useState(false);
  const [printSettingsVisible, setPrintSettingsVisible] = useState(false);
  const [helpTopic, setHelpTopic] = useState<HelpTopic>();
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchReplacement, setSearchReplacement] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [linkDialogVisible, setLinkDialogVisible] = useState(false);
  const [linkHref, setLinkHref] = useState("https://example.com");
  const [linkLabel, setLinkLabel] = useState("");
  const [pdfOptions, setPdfOptions] = useState<NormalizedPdfOptions>(
    /**
     * 要素をnormalize・pdf・optionsへ渡し、Webviewルートの結果または副作用を処理する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () =>
      normalizePdfOptions(
        bootstrap?.settings.pdfOptions ?? DEFAULT_PDF_OPTIONS,
      ),
  );
  /**
   * WebviewルートのDOMまたは状態を保持する参照。
   */
  const pdfOptionsRef = useRef(pdfOptions);
  /**
   * WebviewルートのDOMまたは状態を保持する参照。
   */
  const pdfOptionsPersistTimerRef = useRef<number | undefined>(undefined);
  const pdfReplacementResult = useMemo(
    /**
     * 印刷用Markdownへ現在の置換ルールを順番に適用する。
     * @returns 置換後Markdownと正規表現エラー一覧。
     */
    () =>
      applyPdfTextReplacements(
        renderedPreviewMarkdown,
        pdfOptions.textReplacements,
      ),
    [renderedPreviewMarkdown, pdfOptions.textReplacements],
  );
  const printablePreviewMarkdown = pdfReplacementResult.errors.length
    ? renderedPreviewMarkdown
    : pdfReplacementResult.text;
  const [pdfExportMarkdown, setPdfExportMarkdown] = useState<
    string | undefined
  >(undefined);
  const [pdfExportStageRequested, setPdfExportStageRequested] =
    useState(false);
  const activePdfExportMarkdown =
    pdfExportMarkdown ?? printablePreviewMarkdown;
  const [htmlOptions, setHtmlOptions] = useState<HtmlExportOptions>(
    /**
     * 要素をmerge・html・export・optionsへ渡し、Webviewルートの結果または副作用を処理する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => ({
      ...mergeHtmlExportOptions(
        DEFAULT_HTML_EXPORT_OPTIONS,
        bootstrap?.settings.htmlOptions ?? DEFAULT_HTML_EXPORT_SETTINGS,
      ),
    }),
  );
  /**
   * WebviewルートのDOMまたは状態を保持する参照。
   */
  const htmlOptionsRef = useRef(htmlOptions);
  const pendingHtmlOptionsRef = useRef<HtmlExportSettings | undefined>(
    undefined,
  );
  htmlOptionsRef.current = htmlOptions;
  const [pdfPreview, setPdfPreview] = useState<PdfPreviewState>({
    requestId: "",
    loading: false,
  });
  const [htmlRenderRequest, setHtmlRenderRequest] = useState<
    Extract<
      HostToWebviewMessage,
      {
        /**
         * Webviewルートで対象や分岐を識別する値の型。
         */
        type: "renderHtmlDocuments";
      }
    >
  >();
  const [exportStageRequested, setExportStageRequested] = useState(false);
  const [toast, setToast] = useState("");
  const [sectionLinkMenu, setSectionLinkMenu] = useState<{
    id: string;
    text: string;
    x: number;
    y: number;
  }>();
  const sectionLinkMenuRef = useRef<HTMLDivElement>(null);
  const skipOutlineContextMenuRef = useRef(false);
  /** 三角形上から始まった右ポインター操作を見出し名の右クリックと区別する。 */
  const outlineDisclosureRightPointerRef = useRef(false);

  const clientIdRef = useRef(createClientId());
  const sourceRef = useRef<TextEditorHandle>(null);
  const splitPreviewRef = useRef<HTMLDivElement>(null);
  const editorAreaRef = useRef<HTMLElement>(null);
  const exportRootRef = useRef<HTMLDivElement>(null);
  const exportStageWaitersRef = useRef<
    Array<(root: HTMLDivElement | undefined) => void>
  >([]);
  const pdfExportRootRef = useRef<HTMLDivElement>(null);
  const pdfExportRootMarkdownRef = useRef<string | undefined>(undefined);
  const pdfExportStageWaitersRef = useRef<
    Array<{
      markdown: string;
      resolve: (root: HTMLDivElement | undefined) => void;
    }>
  >([]);
  const previewSnapshotWaitersRef = useRef<Array<() => void>>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const hostTextRef = useRef(bootstrap?.text ?? "");
  const localTextRef = useRef(bootstrap?.text ?? "");
  const markdownForSelectionRef = useRef(markdown);
  const updateMarkdownRef = useRef<
    (
      nextText: string,
      knownChanges?: TextChange[],
      origin?: "local" | "remote",
      updateRenderedState?: boolean,
    ) => void
  >(
    /**
     * Webviewルートのコールバックとして要素を処理する。
     * @returns 副作用を完了し、値は返さない。
     */
    () => undefined,
  );
  const versionRef = useRef(bootstrap?.version ?? 0);
  const initializedRef = useRef(Boolean(bootstrap));
  const startupReportedRef = useRef(false);
  const startupMermaidReportedRef = useRef(false);
  const startupInitReceivedAtRef = useRef<number | undefined>(
    bootstrap
      ? (
          globalThis as typeof globalThis & {
            /**
             * Webviewルートの・mve・bundle・executed・atを表す数値。
             */
            __mveBundleExecutedAt?: number;
          }
        ).__mveBundleExecutedAt
      : undefined,
  );
  // ACK待ちは常に1件だけとし、その間の入力はlocalTextRefの最新値へ上書き集約する。
  const inFlightOperationRef = useRef<PendingLocalOperation | undefined>(
    undefined,
  );
  const pendingHistoryCommandsRef = useRef<Array<"undo" | "redo">>([]);
  const selectionStateRef = useRef<TextSelection>({ from: 0, to: 0 });
  const imageRequestsRef = useRef(new Set<string>());
  const pdfRequestsRef = useRef(new Set<string>());
  const htmlRequestsRef = useRef(new Set<string>());
  const pdfPreviewRequestRef = useRef("");
  const pdfPreviewSignatureRef = useRef<string | undefined>(undefined);
  const pdfPreviewTimerRef = useRef<number | undefined>(undefined);
  const resourceCheckRequestsRef = useRef(
    new Map<string, LocalResourceCheckRequest>(),
  );
  const resourceCheckGenerationRef = useRef(0);
  const latestResourceCheckRequestRef = useRef("");
  const viewportStateRef = useRef({
    source: restored?.sourceViewport,
    splitPreview: restored?.splitPreviewViewport,
    previewOnly: restored?.previewOnlyViewport,
  });
  const pendingViewportRestoreRef = useRef(false);
  const pendingSourceViewportRestoreRef = useRef<
    EditorViewportAnchor | undefined
  >(undefined);
  const skipNextSourceViewportRestoreRef = useRef(false);
  const pendingPreviewViewportRestoreRef = useRef<{
    /**
     * Webviewルートのsplit・previewに関する状態または設定。
     */
    splitPreview?: PreviewViewportAnchor;

    /**
     * Webviewルートのpreview・onlyに関する状態または設定。
     */
    previewOnly?: PreviewViewportAnchor;
  }>({});
  const pendingNavigationRef = useRef<TextSelection | undefined>(undefined);
  const recentRibbonCommandsRef = useRef(new Map<string, number>());
  const previousModeBeforePrintRef = useRef<EditorMode>("split");
  const previewUserScrollPendingRef = useRef(new WeakSet<HTMLElement>());
  const previewPointerScrollActiveRef = useRef(new WeakSet<HTMLElement>());
  const previewTouchScrollActiveRef = useRef(new WeakSet<HTMLElement>());
  /** Pointer Events の各段階で参照する最新の見出し並べ替え状態。 */
  const outlineDragRef = useRef<OutlineDragState | undefined>(undefined);
  const [outlineDrag, setOutlineDrag] = useState<OutlineDragState | undefined>(
    undefined,
  );
  // 復元が複数・遅延scrollイベントを発生させても、明示入力まで逆同期させない。
  const programmaticPreviewScrollsRef = useRef(new WeakSet<HTMLElement>());
  const pendingPreviewScrollsRef = useRef(
    new Map<
      HTMLElement,
      {
        /**
         * メッセージ、項目、または処理の種類を識別する値。
         */
        kind: "splitPreview" | "previewOnly";

        /**
         * Webviewルートのuser・initiatedを切り替えるフラグ。
         */
        userInitiated: boolean;
      }
    >(),
  );
  const previewScrollFrameRef = useRef<number | undefined>(undefined);
  const previewToSourceSyncTimerRef = useRef<number | undefined>(undefined);
  const sourceToPreviewSyncTimerRef = useRef<number | undefined>(undefined);
  const pendingPreviewToSourceAnchorRef = useRef<
    PreviewViewportAnchor | undefined
  >(undefined);
  const pendingSourceToPreviewAnchorRef = useRef<
    EditorViewportAnchor | undefined
  >(undefined);
  const lastPreviewToSourceSyncRef = useRef(0);
  const lastSourceToPreviewSyncRef = useRef(0);
  const lastPreviewUserScrollAtRef = useRef(0);
  const pendingRenderedPreviewKindsRef = useRef(
    new Set<"splitPreview" | "previewOnly">(),
  );
  const renderedPreviewRestoreFrameRef = useRef<number | undefined>(undefined);
  const renderedPreviewRestoreTimerRef = useRef<number | undefined>(undefined);
  const viewportUserIntentGenerationRef = useRef(0);
  const sourceViewportIntentGenerationRef = useRef(0);
  const settledOperationIdsRef = useRef(new Set<string>());
  const resyncInFlightRef = useRef(false);
  // 同じHostスナップショットへの再送は1回だけに制限し、失敗時の自動再同期ループを防ぐ。
  // 全文連結キーを作らず、既存スナップショットへの参照だけを保持する。
  const lastAutomaticRetryRef = useRef<
    | {
        /**
         * Webviewルートのversionを表す数値。
         */
        version: number;

        /**
         * Webviewルートで解析・表示・保存する本文。
         */
        hostText: string;

        /**
         * Webviewルートで解析・表示・保存する本文。
         */
        localText: string;
      }
    | undefined
  >(undefined);
  const persistViewStateRef = useRef<(viewModeOverride?: ViewMode) => void>(
    /**
     * Webviewルートのコールバックとして要素を処理する。
     * @returns 副作用を完了し、値は返さない。
     */
    () => undefined,
  );
  const persistViewStateTimerRef = useRef<number | undefined>(undefined);
  const pendingPersistViewModeRef = useRef<ViewMode | undefined>(undefined);
  const hostMessageHandlerRef = useRef<(message: HostToWebviewMessage) => void>(
    /**
     * Webviewルートのコールバックとして要素を処理する。
     * @returns 副作用を完了し、値は返さない。
     */
    () => undefined,
  );
  versionRef.current = version;
  markdownForSelectionRef.current = markdown;
  pdfOptionsRef.current = pdfOptions;
  hostMessageHandlerRef.current = handleHostMessage;

  /**
   * Webviewルートから必要な値またはリソースを取得する。
   * @returns 条件に一致する値。未検出時はundefinedまたはnull。
   */
  function getActiveEditor(): TextEditorHandle | undefined {
    if (mode === "split" && splitView !== "preview")
      return sourceRef.current ?? undefined;
    return undefined;
  }

  const outline = previewSnapshot.outline;
  const outlineStructureSignature = useMemo(
    /**
     * 現在の見出し構成から開閉状態の識別子を作成する。
     * @returns 見出し構成の署名。
     */
    () => getOutlineStructureSignature(outline),
    [outline],
  );
  const outlineTree = useMemo(
    /**
     * 見出し一覧から表示用のツリーを構築する。
     * @returns 階層を持つアウトライン項目。
     */
    () => buildOutlineTree(outline),
    [outline],
  );
  const [outlineCollapseState, setOutlineCollapseState] =
    useState<OutlineCollapseState>(
      /**
       * Webview起動時に全見出しを展開した状態で初期化する。
       * @returns 初期構造署名と空の折りたたみID集合。
       */
      () => ({ signature: outlineStructureSignature, collapsedIds: new Set() }),
    );
  const collapsedOutlineIds =
    outlineCollapseState.signature === outlineStructureSignature
      ? outlineCollapseState.collapsedIds
      : EMPTY_OUTLINE_IDS;

  useEffect(
    /**
     * 見出し構成が変わった際に古い折りたたみ状態を解除する。
     * @returns 開閉状態の更新を完了する副作用コールバック。
     */
    () => {
      setOutlineCollapseState(
        /**
         * 新しい見出し構成に対して折りたたみ状態を初期化する。
         * @param current 直前の開閉状態。
         * @returns 新しい構成署名と、空または既存の折りたたみID集合。
         */
        (current) =>
          current.signature === outlineStructureSignature
            ? current
            : {
                signature: outlineStructureSignature,
                collapsedIds: new Set(),
              },
      );
    },
    [outlineStructureSignature],
  );

  /**
   * 指定した見出しの子見出しの表示状態を反転する。
   * @param id 開閉する見出しの一意なID。
   * @returns 副作用を完了し、値は返さない。
   */
  function toggleOutlineSection(id: string): void {
    setOutlineCollapseState(
      /**
       * 開閉する見出しIDを現在の状態へ追加または削除する。
       * @param current 直前の開閉状態。
       * @returns 更新した構成署名と折りたたみID集合。
       */
      (current) => {
        const collapsedIds =
          current.signature === outlineStructureSignature
            ? new Set(current.collapsedIds)
            : new Set<string>();
        if (collapsedIds.has(id)) collapsedIds.delete(id);
        else collapsedIds.add(id);
        return { signature: outlineStructureSignature, collapsedIds };
      },
    );
  }

  /**
   * ツリー項目とその子孫を階層順に描画する。
   * @param nodes 元の配列位置を持つツリー項目。
   * @param depth ツリー内の階層。行のホバー範囲を親列まで戻すために使う。
   * @returns アウトライン項目のリスト要素。
   */
  function renderOutlineNodes(
    nodes: readonly OutlineTreeNode[],
    depth = 0,
  ): React.JSX.Element[] {
    return nodes.map(
      /**
       * 見出し行、開閉三角形、子見出しを描画する。
       * @param node 現在描画する見出しツリー項目。
       * @returns 見出し行と子見出しのリスト要素。
       */
      (node) => {
        const { item, index, children } = node;
        const hasChildren = children.length > 0;
        const collapsed = collapsedOutlineIds.has(item.id);
        const childListId = `outline-children-${index}`;
        const isDragSource =
          outlineDrag?.dragging && outlineDrag.sourceIndex === index;
        const isDropTarget =
          outlineDrag?.targetIndex === index && outlineDrag.position;

        return (
          <li
            className={
              hasChildren ? "outline-node outline-node-parent" : "outline-node"
            }
            data-outline-level={item.level}
            key={`${item.offset}-${item.id}`}
          >
            <div
              className="outline-row"
              style={
                {
                  "--outline-row-inset":
                    depth === 0 && !hasChildren
                      ? "0px"
                      : `${18 + depth * 22}px`,
                } as React.CSSProperties
              }
            >
              {hasChildren ? (
                <button
                  type="button"
                  className="outline-disclosure"
                  aria-label={item.text}
                  aria-expanded={!collapsed}
                  aria-controls={childListId}
                  onClick={
                    /**
                     * 開閉三角形の操作を処理し、見出し移動を起動しない。
                     * @param event 開閉三角形のクリックイベント。
                     * @returns 副作用を完了し、値は返さない。
                    */
                    (event) => {
                      event.stopPropagation();
                      if (event.button !== 0) return;
                      toggleOutlineSection(item.id);
                    }
                  }
                  onContextMenu={
                    /**
                     * 開閉三角形上の右クリックを既定処理と親のメニュー処理へ伝えない。
                     * @param event 開閉三角形のコンテキストメニューイベント。
                     * @returns 既定メニューと親への伝播を抑止する副作用。
                    */
                    (event) => {
                      outlineDisclosureRightPointerRef.current = false;
                      event.preventDefault();
                      event.stopPropagation();
                    }
                  }
                >
                  <span
                    className="outline-disclosure-icon"
                    aria-hidden="true"
                  />
                </button>
              ) : null}
              <button
                type="button"
                className={
                  `outline-item${isDragSource ? " outline-drag-source" : ""}` +
                  `${isDropTarget ? ` outline-drop-${outlineDrag?.position}` : ""}`
                }
                data-outline-index={index}
                data-section-id={item.id}
                data-dragging={isDragSource ? "true" : undefined}
                onClick={
                  /**
                   * 見出し名をクリックした場合に対応する本文位置へ移動する。
                   * @param event 見出し名のクリックイベント。
                   * @returns 副作用を完了し、値は返さない。
                   */
                  (event) => {
                    if (event.button === 0) goToOutlineOffset(item.offset);
                  }
                }
                onPointerDown={
                  /**
                   * 見出し名の右ドラッグによる節移動を開始する。
                   * @param event 見出し名のポインターイベント。
                   * @returns 副作用を完了し、値は返さない。
                   */
                  (event) => beginOutlineDrag(event, index)
                }
                onPointerMove={updateOutlineDrag}
                onPointerUp={finishOutlineDrag}
                onPointerCancel={
                  /**
                   * キャンセルされた節ドラッグを終了する。
                   * @param event 見出し名のポインターキャンセルイベント。
                   * @returns 副作用を完了し、値は返さない。
                   */
                  (event) => finishOutlineDrag(event, true)
                }
              >
                {item.text}
              </button>
            </div>
            {hasChildren ? (
              <ul
                className="outline-children"
                id={childListId}
                hidden={collapsed}
              >
                {renderOutlineNodes(children, depth + 1)}
              </ul>
            ) : null}
          </li>
        );
      },
    );
  }

  const diagnostics = useMemo(
    /**
     * 要素をmerge・collected・diagnosticsへ渡し、Webviewルートの結果または副作用を処理する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () =>
      mergeCollectedDiagnostics(
        previewSnapshot.diagnostics,
        localResourceDiagnostics,
      ),
    [previewSnapshot.diagnostics, localResourceDiagnostics],
  );
  const diagnosticSummary = useMemo(
    /**
     * 要素をsummarize・diagnosticsへ渡し、Webviewルートの結果または副作用を処理する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => summarizeDiagnostics(diagnostics),
    [diagnostics],
  );
  const stats = previewSnapshot.stats;
  const searchHits = useMemo(
    /**
     * 要素をfind・search・hitsへ渡し、Webviewルートの結果または副作用を処理する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => findSearchHits(renderedPreviewMarkdown, searchQuery),
    [renderedPreviewMarkdown, searchQuery],
  );
  const previewHtml = previewSnapshot.html;

  useEffect(
    /**
     * 依存状態の変化に応じて購読を更新し、解除処理を返す。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => {
      // ホストへWebviewの準備完了を通知し、以後のメッセージを現在のハンドラーへ渡す。
      mveDebug("webview.ready", { clientId: clientIdRef.current });
      vscode.postMessage({ type: "ready", clientId: clientIdRef.current });

      const onMessage = /**
       * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
       * @param event - ホストから受信したwebview向けメッセージイベント。
       * @returns Webviewルートのon・messageが生成する結果。
       */ (event: MessageEvent<HostToWebviewMessage>) =>
        hostMessageHandlerRef.current(event.data);
      window.addEventListener("message", onMessage);
      /**
       * イベントでremove・event・listenerを実行する。
       * @returns 副作用を完了し、値は返さない。
       */
      return () => {
        window.removeEventListener("message", onMessage);
        if (persistViewStateTimerRef.current !== undefined) {
          window.clearTimeout(persistViewStateTimerRef.current);
          persistViewStateTimerRef.current = undefined;
        }
        if (pdfOptionsPersistTimerRef.current !== undefined) {
          flushPdfOptionsPersistence();
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
    },
    [],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => {
      if (!initialized) return;
      // Explorer起点の出力が描画要求を送る前に、init反映済みのApp状態を保証する。
      vscode.postMessage({
        type: "initialized",
        clientId: clientIdRef.current,
      });
    },
    [initialized],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => {
      if (previewSnapshot.markdown !== localTextRef.current) return;
      const waiters = previewSnapshotWaitersRef.current.splice(0);
      waiters.forEach(
        /**
         * 成功結果通知ごとに成功結果通知を実行する。
         * @param resolve - Promiseの成功を通知する関数。
         * @returns 副作用を完了し、値は返さない。
         */
        (resolve) => resolve(),
      );
    },
    [previewSnapshot.markdown],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => {
      // 表示モードやレイアウト設定をVS CodeのWebview状態へ保存する。
      persistViewState();
    },
    [outlineWidth, splitRatio, zoom, splitView],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => {
      // 本文が変わったら、前の本文に対するローカル参照診断を破棄する。
      resourceCheckGenerationRef.current += 1;
      setLocalResourceDiagnostics(
        /**
         * Webviewルートのコールバックとしてpreviousを処理する。
         * @param previous - Markdown変更前のローカルリソース診断一覧。未解決診断が残る場合にクリアする基準値。
         * @returns Webviewルートに対応する要素の一覧。
         */
        (previous) => (previous.length ? [] : previous),
      );
    },
    [markdown],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => {
      if (!printPreview) pdfPreviewSignatureRef.current = undefined;
    },
    [printPreview],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて購読を更新し、解除処理を返す。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => {
      if (!printPreview || !initialized || !settings.workspaceTrusted) return;
      if (pdfPreviewTimerRef.current !== undefined)
        window.clearTimeout(pdfPreviewTimerRef.current);
      pdfPreviewTimerRef.current = window.setTimeout(
        /**
         * 指定時間の経過後に後続処理を実行する。
         * @returns 副作用を完了し、値は返さない。
         */
        () => {
          pdfPreviewTimerRef.current = undefined;
          requestPdfPreview();
        },
        350,
      );
      /**
       * Webviewルートのreturnを処理し、呼び出し側へ結果または副作用を返す。
       * @returns Webviewルートのreturnが生成する結果。
       */
      return () => {
        if (pdfPreviewTimerRef.current !== undefined) {
          window.clearTimeout(pdfPreviewTimerRef.current);
          pdfPreviewTimerRef.current = undefined;
        }
      };
    },
    [
      initialized,
      markdown,
      pdfOptions,
      printPreview,
      settings.language,
      settings.remoteImagesEnabled,
      version,
    ],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて購読を更新し、解除処理を返す。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => {
      // 検索パネルが開いた直後に入力欄へフォーカスし、既存文字列を選択する。
      if (!searchVisible) return;
      const frame = requestAnimationFrame(
        /**
         * 次の描画フレームで表示更新を実行する。
         * @returns Webviewルートのコールバックが生成する結果。
         */
        () => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        },
      );
      /**
       * Webviewルートのreturnを処理し、呼び出し側へ結果または副作用を返す。
       * @returns Webviewルートのreturnが生成する結果。
       */
      return () => cancelAnimationFrame(frame);
    },
    [searchVisible],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => {
      // 検索結果の現在位置をソースエディターへ選択・表示する。
      if (!searchVisible || !searchHits.length) return;
      const active = searchHits[Math.min(searchIndex, searchHits.length - 1)];
      if (mode === "split" && splitView !== "preview") {
        sourceRef.current?.setSelection(active);
        sourceRef.current?.revealRange(active);
      }
    },
    [searchVisible, searchHits, searchIndex, mode, splitView],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns 副作用を完了し、値は返さない。
     */
    () => {
      // リモート画像設定をCSSから参照できるbody属性へ反映する。
      document.body.dataset.remoteImagesEnabled = String(
        settings.remoteImagesEnabled,
      );
    },
    [settings.remoteImagesEnabled],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて購読を更新し、解除処理を返す。
     * @returns 副作用を完了し、値は返さない。
     */
    () => {
      // CtrlまたはCmdを押しながらのホイール入力で表示倍率を変更する。
      const editorArea = editorAreaRef.current;
      if (!editorArea) return;

      const onWheel = /**
       * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
       * @param event - Ctrl+ホイールによるプレビュー倍率変更を判定するwheel event。
       * @returns 副作用を完了し、値は返さない。
       */ (event: WheelEvent) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        adjustZoom(event.deltaY < 0 ? 0.1 : -0.1);
      };
      editorArea.addEventListener("wheel", onWheel, { passive: false });
      /**
       * イベントでremove・event・listenerを実行する。
       * @returns 副作用を完了し、値は返さない。
       */
      return () => editorArea.removeEventListener("wheel", onWheel);
    },
    [initialized],
  );

  /**
   * Webviewルートのadjust・zoomを処理し、呼び出し側へ結果または副作用を返す。
   * @param delta - ズーム倍率へ加える変更量。ホイール操作では0.1刻みで増減する。
   * @returns 副作用を完了し、値は返さない。
   */
  function adjustZoom(delta: number): void {
    captureVisibleViewports();
    pendingViewportRestoreRef.current = true;
    const previous = zoomRef.current;
    const next = clampZoom(previous + delta);
    if (next === previous) {
      mveDebug("zoom.unchanged", {
        delta,
        zoom: previous,
        mode,
        splitView,
        printPreview,
      });
      return;
    }
    zoomRef.current = next;
    mveDebug("zoom.changed", {
      delta,
      previous,
      next,
      mode,
      splitView,
      printPreview,
    });
    setZoom(next);
  }

  useLayoutEffect(
    /**
     * 要素をifへ渡し、Webviewルートの結果または副作用を処理する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => {
      // 保留した選択移動または表示位置復元をレイアウト確定後に実行する。
      const navigation = pendingNavigationRef.current;
      if (
        navigation &&
        mode === "split" &&
        splitView !== "preview" &&
        sourceRef.current
      ) {
        sourceRef.current.setSelection(navigation);
        sourceRef.current.revealRange(navigation);
        const preview = splitPreviewRef.current;
        if (preview) {
          const previewAnchor: PreviewViewportAnchor = {
            offset: navigation.from,
            topOffset: 18,
          };
          viewportStateRef.current.splitPreview = previewAnchor;
          // CodeMirrorのrevealRangeと同じ描画世代で、プレビューも選択位置へ揃える。
          requestAnimationFrame(
            /**
             * 次の描画フレームで表示更新を実行する。
             * @returns Webviewルートのコールバックが生成する結果。
             */
            () => {
              if (splitPreviewRef.current === preview)
                restorePreview(preview, previewAnchor);
            },
          );
        }
        pendingNavigationRef.current = undefined;
        pendingViewportRestoreRef.current = false;
        return;
      }
      if (!pendingViewportRestoreRef.current) return;
      // Markdown Workerが旧プレビューを表示している間は復元を消化しない。
      // 最新世代のDOMが確定したレイアウトで一度だけ復元する。
      if (renderedPreviewMarkdown !== markdown) return;
      const frame = requestAnimationFrame(
        /**
         * 次の描画フレームで表示更新を実行する。
         * @returns Webviewルートのコールバックが生成する結果。
         */
        () => {
          restoreVisibleViewports();
          pendingViewportRestoreRef.current = false;
        },
      );
      /**
       * Webviewルートのreturnを処理し、呼び出し側へ結果または副作用を返す。
       * @returns Webviewルートのreturnが生成する結果。
       */
      return () => cancelAnimationFrame(frame);
    },
    [
      mode,
      splitView,
      zoom,
      splitRatio,
      outlineVisible,
      diagnosticsVisible,
      Boolean(inspector),
      markdown,
      renderedPreviewMarkdown,
    ],
  );

  useLayoutEffect(
    /**
     * 要素をifへ渡し、Webviewルートの結果または副作用を処理する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => {
      const area = editorAreaRef.current;
      const split = area?.querySelector<HTMLElement>(".split-editor");
      const source = area?.querySelector<HTMLElement>(".split-source-pane");
      const preview = area?.querySelector<HTMLElement>(".split-preview-pane");
      if (!area) return;

      const size = /**
       * Webviewルートのsizeを処理し、呼び出し側へ結果または副作用を返す。
       * @param element - 表示寸法とCSSのdisplay値を測定する領域。未描画ならnull。
       * @returns Webviewルートのsizeが生成する結果。
       */ (element: HTMLElement | null) => {
        if (!element) return undefined;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
          display: style.display,
        };
      };
      mveDebug("view.layout", {
        mode,
        splitView,
        editorArea: size(area),
        split: size(split ?? null),
        source: size(source ?? null),
        preview: size(preview ?? null),
        columns: split
          ? getComputedStyle(split).gridTemplateColumns
          : undefined,
      });
    },
    [
      initialized,
      mode,
      splitView,
      outlineVisible,
      splitRatio,
      zoom,
      diagnosticsVisible,
      Boolean(inspector),
    ],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => {
      // リサイズ中に各ペインの表示アンカーを保存し、リサイズ後に同じ位置へ戻す。
      let frame = 0;
      let resetSnapshotTimer = 0;
      let resizeSnapshot:
        | {
            /**
             * 解析・描画・変換の起点となる本文。
             */
            source?: EditorViewportAnchor;

            /**
             * Webviewルートのsplit・previewに関する状態または設定。
             */
            splitPreview?: PreviewViewportAnchor;

            /**
             * Webviewルートのpreview・onlyに関する状態または設定。
             */
            previewOnly?: PreviewViewportAnchor;

            /**
             * Webviewルートのintent・generationを表す数値。
             */
            intentGeneration: number;
          }
        | undefined;

      const onResize = /**
       * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
       * @returns Webviewルートのon・resizeが生成する結果。
       */ () => {
        if (!resizeSnapshot) {
          resizeSnapshot = {
            source: viewportStateRef.current.source
              ? { ...viewportStateRef.current.source }
              : undefined,
            splitPreview: viewportStateRef.current.splitPreview
              ? { ...viewportStateRef.current.splitPreview }
              : undefined,
            previewOnly: viewportStateRef.current.previewOnly
              ? { ...viewportStateRef.current.previewOnly }
              : undefined,
            intentGeneration: viewportUserIntentGenerationRef.current,
          };
        }
        pendingSourceViewportRestoreRef.current = resizeSnapshot.source
          ? { ...resizeSnapshot.source }
          : undefined;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(
          /**
           * 次の描画フレームで表示更新を実行する。
           * @returns Webviewルートのコールバックが生成する結果。
           */
          () => {
            const snapshot = resizeSnapshot;
            if (
              !snapshot ||
              snapshot.intentGeneration !==
                viewportUserIntentGenerationRef.current
            )
              return;
            if (
              mode === "split" &&
              splitView !== "preview" &&
              snapshot.source
            ) {
              restoreSource(snapshot.source);
            }
            if (
              mode === "split" &&
              splitView !== "text" &&
              splitPreviewRef.current &&
              snapshot.splitPreview
            ) {
              restorePreview(splitPreviewRef.current, snapshot.splitPreview);
            }
            if (
              mode === "preview" &&
              editorAreaRef.current &&
              snapshot.previewOnly
            ) {
              restorePreview(editorAreaRef.current, snapshot.previewOnly);
            }
          },
        );
        window.clearTimeout(resetSnapshotTimer);
        resetSnapshotTimer = window.setTimeout(
          /**
           * 指定時間の経過後に後続処理を実行する。
           * @returns 副作用を完了し、値は返さない。
           */
          () => {
            resizeSnapshot = undefined;
          },
          120,
        );
      };

      const endPreviewPointerScroll = /**
       * Webviewルートのend・preview・pointer・scrollを処理し、呼び出し側へ結果または副作用を返す。
       * @returns Webviewルートのend・preview・pointer・scrollが生成する結果。
       */ () => {
        const splitPreview = splitPreviewRef.current;
        const editorArea = editorAreaRef.current;
        if (splitPreview)
          previewPointerScrollActiveRef.current.delete(splitPreview);
        if (editorArea)
          previewPointerScrollActiveRef.current.delete(editorArea);
      };

      const endPreviewTouchScroll = /**
       * Webviewルートのend・preview・touch・scrollを処理し、呼び出し側へ結果または副作用を返す。
       * @returns Webviewルートのend・preview・touch・scrollが生成する結果。
       */ () => {
        const splitPreview = splitPreviewRef.current;
        const editorArea = editorAreaRef.current;
        if (splitPreview)
          previewTouchScrollActiveRef.current.delete(splitPreview);
        if (editorArea) previewTouchScrollActiveRef.current.delete(editorArea);
      };
      window.addEventListener("resize", onResize);
      window.addEventListener("pointerup", endPreviewPointerScroll);
      window.addEventListener("pointercancel", endPreviewPointerScroll);
      window.addEventListener("touchend", endPreviewTouchScroll);
      window.addEventListener("touchcancel", endPreviewTouchScroll);
      /**
       * UIイベントを表示または編集状態へ反映する。
       * @returns 副作用を完了し、値は返さない。
       */
      return () => {
        cancelAnimationFrame(frame);
        window.clearTimeout(resetSnapshotTimer);
        window.removeEventListener("resize", onResize);
        window.removeEventListener("pointerup", endPreviewPointerScroll);
        window.removeEventListener("pointercancel", endPreviewPointerScroll);
        window.removeEventListener("touchend", endPreviewTouchScroll);
        window.removeEventListener("touchcancel", endPreviewTouchScroll);
      };
    },
    [initialized, mode, splitView],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () =>
      /**
       * 要素を削除へ渡し、Webviewルートの結果または副作用を処理する。
       * @returns Webviewルートのコールバックが生成する結果。
       */
      () => {
        outlineDragRef.current = undefined;
        document.body.classList.remove("mve-dragging-outline");
      },
    [],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => {
      // 貼り付け・ドラッグ&ドロップ・キーボードショートカットを文書編集へ接続する。

      const onPaste = /**
       * pasteイベントでhandle・pasteを実行する。
       * @param event - 編集中の本文に貼り付けられた画像またはテキストを処理するclipboard event。
       * @returns 副作用を完了し、値は返さない。
       */ (event: ClipboardEvent) => void handlePaste(event);

      const onDragOver = /**
       * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
       * @param event - 画像ファイルのdrag-overを受け取り、copy dropを許可するdrag event。
       * @returns Webviewルートのon・drag・overが生成する結果。
       */ (event: DragEvent) => {
        if (
          isEditingEnabled(mode, splitView) &&
          Array.from(event.dataTransfer?.items ?? []).some(
            /**
             * Webviewルートのコールバックとして項目を処理する。
             * @param item - DataTransferから取得した貼り付け項目。画像ファイルかを判定する。
             * @returns Webviewルートのコールバックが生成する結果。
             */
            (item) => item.kind === "file",
          )
        ) {
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        }
      };

      const onDrop = /**
       * dropイベントでifを実行する。
       * @param event - 本文へ画像ファイルをdropした際のdrag event。
       * @returns 副作用を完了し、値は返さない。
       */ (event: DragEvent) => {
        if (!isEditingEnabled(mode, splitView)) return;
        const files = Array.from(event.dataTransfer?.files ?? []).filter(
          isImageFile,
        );
        if (!files.length) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void saveImageFiles(files);
      };

      const onKeyDown = /**
       * keydownイベントでbooleanを実行する。
       * @param event - Webview本文とプレビューのグローバルショートカットを処理するkeydown event。
       * @returns 副作用を完了し、値は返さない。
       */ (event: KeyboardEvent) => {
        const target =
          event.target instanceof Element ? event.target : undefined;
        const inApp =
          Boolean(target?.closest(".app")) || target === document.body;
        const inSourceEditor = Boolean(target?.closest(".cm-content"));
        const inFormControl = Boolean(
          target?.closest("input, textarea, select"),
        );
        const inTableEditor = Boolean(target?.closest(".mve-table-editor"));
        if (
          inApp &&
          (inSourceEditor || !inFormControl) &&
          !event.isComposing &&
          (event.ctrlKey || event.metaKey) &&
          !event.altKey
        ) {
          const key = event.key.toLowerCase();
          const command =
            key === "z"
              ? event.shiftKey
                ? "redo"
                : "undo"
              : key === "y" && !event.shiftKey
                ? "redo"
                : undefined;
          if (command) {
            event.preventDefault();
            event.stopImmediatePropagation();
            requestHistoryCommand(command);
            return;
          }
        }
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "f"
        ) {
          event.preventDefault();
          openSearch();
          return;
        }
        if (
          event.altKey &&
          event.key === "Enter" &&
          isEditingEnabled(mode, splitView) &&
          !inTableEditor
        ) {
          event.preventDefault();
          getActiveEditor()?.action("cellBreak");
        }
      };
      document.addEventListener("paste", onPaste, true);
      document.addEventListener("dragover", onDragOver, true);
      document.addEventListener("drop", onDrop, true);
      document.addEventListener("keydown", onKeyDown, true);
      /**
       * イベントでremove・event・listenerを実行する。
       * @returns 副作用を完了し、値は返さない。
       */
      return () => {
        document.removeEventListener("paste", onPaste, true);
        document.removeEventListener("dragover", onDragOver, true);
        document.removeEventListener("drop", onDrop, true);
        document.removeEventListener("keydown", onKeyDown, true);
      };
    },
    [mode, splitView, settings.maxPasteSizeMb, settings.imageDirectory],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて購読を更新し、解除処理を返す。
     * @returns 副作用を完了し、値は返さない。
     */
    () => {
      // 通知トーストを一定時間後に自動的に閉じる。
      if (!toast) return;
      const timer = window.setTimeout(
        /**
         * 指定時間の経過後に後続処理を実行する。
         * @returns 副作用を完了し、値は返さない。
         */
        () => setToast(""),
        2600,
      );
      /**
       * Webviewルートのreturnを処理し、呼び出し側へ結果または副作用を返す。
       * @returns 副作用を完了し、値は返さない。
       */
      return () => window.clearTimeout(timer);
    },
    [toast],
  );

  useLayoutEffect(() => {
    if (!sectionLinkMenu || !sectionLinkMenuRef.current) return;
    const menu = sectionLinkMenuRef.current;
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(sectionLinkMenu.x, window.innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(sectionLinkMenu.y, window.innerHeight - bounds.height - 8))}px`;
    menu.querySelector("button")?.focus({ preventScroll: true });
  }, [sectionLinkMenu]);

  useEffect(() => {
    if (!sectionLinkMenu) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        sectionLinkMenuRef.current?.contains(event.target)
      )
        return;
      setSectionLinkMenu(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setSectionLinkMenu(undefined);
    };
    const closeMenu = () => setSectionLinkMenu(undefined);
    document.addEventListener("pointerdown", closeOnPointerDown, true);
    document.addEventListener("keydown", closeOnEscape, true);
    document.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("blur", closeMenu);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown, true);
      document.removeEventListener("keydown", closeOnEscape, true);
      document.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("blur", closeMenu);
    };
  }, [sectionLinkMenu]);

  useEffect(() => {
    const resetOnRightPointerDown = (event: PointerEvent) => {
      if (event.button === 2) skipOutlineContextMenuRef.current = false;
    };
    const suppressCompletedOutlineGesture = (event: MouseEvent) => {
      if (!skipOutlineContextMenuRef.current || event.button !== 2) return;
      event.preventDefault();
      event.stopPropagation();
      skipOutlineContextMenuRef.current = false;
    };
    document.addEventListener("pointerdown", resetOnRightPointerDown, true);
    document.addEventListener(
      "contextmenu",
      suppressCompletedOutlineGesture,
      true,
    );
    return () => {
      document.removeEventListener(
        "pointerdown",
        resetOnRightPointerDown,
        true,
      );
      document.removeEventListener(
        "contextmenu",
        suppressCompletedOutlineGesture,
        true,
      );
    };
  }, []);

  /**
   * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
   * @param message - HostとWebviewの間で受け渡すメッセージ。
   * @returns 副作用を完了し、値は返さない。
   */
  function handleHostMessage(message: HostToWebviewMessage): void {
    const record = message as unknown as Record<string, unknown>;
    if (isMveDebugEnabled()) {
      mveDebug("host.message", {
        type: message.type,
        clientId: record.clientId,
        opId: record.opId,
        baseVersion: record.baseVersion,
        version: record.version,
        reason: record.reason,
      });
    }
    // ホスト側の判定タイミングによって自分の操作がexternalChangesとして返る場合がある。
    // これを未反映のローカル操作としてリベースすると、末尾挿入が同じ内容を二重に挿入する。
    if (
      message.type === "externalChanges" &&
      message.clientId === clientIdRef.current &&
      message.opId &&
      !settledOperationIdsRef.current.has(message.opId)
    ) {
      handleHostMessage({
        type: "editAck",
        clientId: message.clientId,
        opId: message.opId,
        baseVersion: message.baseVersion,
        version: message.version,
        changes: message.changes,
      });
      return;
    }
    switch (message.type) {
      case "sectionLinkCopied":
        setToast(messages.app.sectionLinkCopied);
        return;
      case "workspaceSectionLinkUnavailable":
        setToast(messages.app.workspaceSectionLinkUnavailable);
        return;
      case "init":
        if (initializedRef.current) {
          applyHostSettings(message.settings);
          if (
            message.version !== versionRef.current ||
            message.text !== hostTextRef.current
          ) {
            applyResyncSnapshot(
              message.text,
              message.version,
              "再初期化通知を受信しました。",
            );
          }
          return;
        }
        initializedRef.current = true;
        startupInitReceivedAtRef.current = performance.now();
        resyncInFlightRef.current = false;
        setInitialized(true);
        hostTextRef.current = message.text;
        versionRef.current = message.version;
        setVersion(message.version);
        applyHostSettings(message.settings);
        if (!hasRestoredViewMode && message.settings.viewMode) {
          setSplitView(restoreViewMode(message.settings.viewMode));
        }
        if (!inFlightOperationRef.current) {
          localTextRef.current = message.text;
          setMarkdown(message.text);
        }
        return;
      case "editAck": {
        if (message.clientId !== clientIdRef.current) return;
        const pending = inFlightOperationRef.current;
        if (!pending || pending.opId !== message.opId) {
          if (!settledOperationIdsRef.current.has(message.opId)) {
            console.warn(
              "[Markdown Easy Visual Editor] 順序外のACKを破棄しました。",
              message.opId,
            );
            requestResync("unexpected-ack", message.opId);
          }
          return;
        }
        if (message.baseVersion !== versionRef.current) {
          console.warn(
            "[Markdown Easy Visual Editor] ACKの文書versionが一致しないため再同期します。",
            {
              expected: versionRef.current,
              received: message.baseVersion,
              opId: message.opId,
            },
          );
          requestResync("ack-version-mismatch", message.opId);
          return;
        }
        try {
          hostTextRef.current = applyTextChanges(
            hostTextRef.current,
            message.changes,
          );
          if (hostTextRef.current !== pending.resultText) {
            throw new Error(messages.app.errors.ackMismatch);
          }
        } catch (error) {
          console.warn(
            "[Markdown Easy Visual Editor] ACK差分を適用できないため再同期します。",
            error,
          );
          requestResync("ack-apply-failed", message.opId);
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
      case "externalChanges":
        applyExternalChanges(message);
        return;
      case "resyncRequired":
        if (message.clientId !== clientIdRef.current) return;
        applyResyncSnapshot(
          message.text,
          message.version,
          message.reason,
          message.opId,
          message.operationApplied,
        );
        return;
      case "settingsChanged":
        applyHostSettings(message.settings);
        if (message.settings.viewMode)
          setSplitView(restoreViewMode(message.settings.viewMode));
        return;
      case "mermaidRendered":
        acceptMermaidRenderResult(message);
        return;
      case "imagesSaved":
        imageRequestsRef.current.delete(message.requestId);
        if (message.paths.length) {
          getActiveEditor()?.insert(
            message.paths
              .map(
                /**
                 * 各項目をimage・markdownへ渡し、変換結果を一覧化する。
                 * @param item - 走査中の要素。
                 * @returns 入力要素から生成した変換結果の一覧。
                 */
                (item) => imageMarkdown(item, messages.editor.defaultImageAlt),
              )
              .join("\n"),
            true,
          );
          setToast(messages.app.toast.imagesSaved(message.paths.length));
        }
        return;
      case "localResourcesChecked":
        {
          const request = resourceCheckRequestsRef.current.get(
            message.requestId,
          );
          resourceCheckRequestsRef.current.delete(message.requestId);
          if (
            !request ||
            request.markdown !== markdown ||
            request.version !== versionRef.current ||
            request.generation !== resourceCheckGenerationRef.current ||
            message.requestId !== latestResourceCheckRequestRef.current
          )
            return;
          if (message.diagnostics.length && request.purpose === "pdf") {
            const detail = message.diagnostics
              .map(
                /**
                 * 行番号があれば診断文の先頭へ付ける。
                 * @param item - PDF書き出し前に表示するローカルリソース診断。
                 * @returns lineを取り出した変換結果の一覧。
                 */
                (item) =>
                  `${item.line ? `行${item.line}: ` : ""}${item.message}`,
              )
              .join(" / ");
            setToast(
              messages.app.toast.pdfResourceWarnings(
                message.diagnostics.length,
                detail,
              ),
            );
          } else if (request.purpose === "preflight") {
            const summary = summarizeDiagnostics(
              mergeDiagnostics(
                markdown,
                message.diagnostics,
                settings.language,
              ),
            );
            setToast(
              messages.app.toast.preflightSummary(
                summary.errors.length,
                summary.warnings.length,
                summary.infos.length,
              ),
            );
          }
        }
        setLocalResourceDiagnostics(message.diagnostics);
        return;
      case "operationFailed":
        {
          if (
            message.requestId &&
            message.requestId === pdfPreviewRequestRef.current
          ) {
            setPdfPreview(
              /**
               * Webviewルートのコールバックとしてpreviousを処理する。
               * @param previous - 更新前のPDFプレビュー状態。loadingとerrorを更新し、他の状態を保つ基準値。
               * @returns Webviewルートのコールバックが生成する結果。
               */
              (previous) => ({
                ...previous,
                loading: false,
                error: message.message,
              }),
            );
            console.error(
              "[Markdown Easy Visual Editor] PDF preview failed.",
              message.message,
            );
            return;
          }
          const imageFailed = message.requestId
            ? imageRequestsRef.current.delete(message.requestId)
            : false;
          const pdfFailed = message.requestId
            ? pdfRequestsRef.current.delete(message.requestId)
            : false;
          const htmlFailed = message.requestId
            ? htmlRequestsRef.current.delete(message.requestId)
            : false;
          const resourceCheckRequest = message.requestId
            ? resourceCheckRequestsRef.current.get(message.requestId)
            : undefined;
          const resourceCheckFailed = message.requestId
            ? resourceCheckRequestsRef.current.delete(message.requestId)
            : false;
          setToast(
            imageFailed
              ? messages.app.toast.imageSaveFailed(message.message)
              : pdfFailed
                ? messages.app.toast.pdfExportFailed(message.message)
                : htmlFailed
                  ? messages.app.toast.htmlExportFailed(message.message)
                  : resourceCheckFailed
                    ? messages.app.toast.resourceCheckFailed(
                        message.message,
                        resourceCheckRequest?.purpose === "pdf",
                      )
                    : messages.app.toast.operationFailed(message.message),
          );
        }
        console.error(
          "[Markdown Easy Visual Editor] 操作に失敗しました。",
          message.message,
        );
        return;
      case "pdfExported":
        pdfRequestsRef.current.delete(message.requestId);
        setToast(messages.app.toast.pdfExported(message.path));
        return;
      case "htmlExported":
        htmlRequestsRef.current.delete(message.requestId);
        setToast(
          messages.app.toast.htmlExported(
            message.paths[0] ?? "",
            message.paths.length,
          ),
        );
        return;
      case "renderHtmlDocuments":
        setHtmlRenderRequest(message);
        return;
      case "pdfPreviewReady":
        if (message.requestId !== pdfPreviewRequestRef.current) return;
        setPdfPreview({
          requestId: message.requestId,
          pdfBase64: message.pdfBase64,
          loading: false,
        });
        return;
      case "hostCommand":
        if (message.command === "navigateToOffset") {
          if (Number.isSafeInteger(message.offset) && message.offset >= 0) {
            goToOutlineOffset(message.offset);
          }
          return;
        }
        if (message.command === "insertImage") requestImagePicker();
        if (message.command === "exportPdf") void requestPdfExport();
        if (message.command === "exportHtml")
          void requestHtmlExport(htmlOptions);
        if (message.command === "undo" || message.command === "redo")
          requestHistoryCommand(message.command);
        return;
    }
  }

  /**
   * Webviewルートの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param message - HostとWebviewの間で受け渡すメッセージ。
   * @returns 副作用を完了し、値は返さない。
   */
  function applyExternalChanges(
    message: Extract<
      HostToWebviewMessage,
      {
        /**
         * Webviewルートで対象や分岐を識別する値の型。
         */
        type: "externalChanges";
      }
    >,
  ): void {
    if (message.baseVersion !== versionRef.current) {
      requestResync(
        `外部変更の基準versionが一致しません: ${message.baseVersion}/${versionRef.current}`,
      );
      return;
    }
    const previousHost = hostTextRef.current;
    const operation = inFlightOperationRef.current;
    if (operation?.baseText === previousHost) {
      try {
        // clientId/opIdが欠落した自己エコーでも、ホスト結果が送信中操作と一致するならACKとして確定する。
        // 一致しない場合だけ通常の外部変更リベースへ進み、末尾貼り付けを再挿入しない。
        const externallyApplied = applyTextChanges(
          previousHost,
          message.changes,
        );
        if (externallyApplied === operation.resultText) {
          handleHostMessage({
            type: "editAck",
            clientId: clientIdRef.current,
            opId: operation.opId,
            baseVersion: message.baseVersion,
            version: message.version,
            changes: message.changes,
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
      const remoteClientId = message.clientId ?? "host";
      const localBeforeRemote =
        clientIdRef.current.localeCompare(remoteClientId) < 0;
      const localChanges = computeTextChanges(previousHost, previousLocal);
      const mappedLocal = mapTextChanges(
        localChanges,
        message.changes,
        previousHost.length,
        localBeforeRemote,
      );
      const rebasedLocal = applyTextChanges(nextHost, mappedLocal);
      if (operation) {
        if (operation.baseText !== previousHost)
          throw new Error(
            messages.app.errors.pendingOperationChain(operation.opId),
          );
        const mappedOperation = mapTextChanges(
          operation.changes,
          message.changes,
          previousHost.length,
          localBeforeRemote,
        );
        operation.baseVersion = message.version;
        operation.baseText = nextHost;
        operation.changes = mappedOperation;
        operation.resultText = applyTextChanges(nextHost, mappedOperation);
      }
      hostTextRef.current = nextHost;
      versionRef.current = message.version;
      setVersion(message.version);
      updateMarkdown(
        rebasedLocal,
        computeTextChanges(previousLocal, rebasedLocal),
        "remote",
      );
      if (!operation) sendNextLocalOperation();
      flushHistoryCommands();
    } catch (error) {
      console.warn(
        "[Markdown Easy Visual Editor] 外部変更を統合できないため再同期します。",
        error,
      );
      requestResync("external-rebase-failed");
    }
  }

  /**
   * Webviewルートの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param nextHost Hostから受信した、再同期後のMarkdown本文。
   * @param nextVersion 再同期スナップショットのHost側バージョン番号。
   * @param reason - 処理を中断または失敗させた理由。
   * @param opId - Hostで適用済みかを照合するWebview編集操作ID。省略時は同期中の操作に結び付ける。
   * @param operationApplied 対象操作がHost側ですでに適用されている場合はtrue。
   * @returns 副作用を完了し、値は返さない。
   */
  function applyResyncSnapshot(
    nextHost: string,
    nextVersion: number,
    reason: string,
    opId?: string,
    operationApplied?: boolean,
  ): void {
    const previousHost = hostTextRef.current;
    const previousLocal = localTextRef.current;
    const operation = inFlightOperationRef.current;
    inFlightOperationRef.current = undefined;
    if (operation) rememberSettledOperation(operation.opId);
    if (opId) rememberSettledOperation(opId);
    resyncInFlightRef.current = false;
    console.warn("[Markdown Easy Visual Editor] 文書同期を再確認しました。", {
      reason,
      opId,
      operationApplied,
      nextVersion,
    });
    const refersToOperation = Boolean(
      operation && (!opId || opId === operation.opId),
    );
    const wasApplied = Boolean(
      refersToOperation &&
      operation &&
      (operationApplied ??
        (nextHost === operation.resultText || nextHost === previousLocal)),
    );
    const rebaseBase =
      wasApplied && operation
        ? operation.resultText
        : (operation?.baseText ?? previousHost);
    let rebasedText = nextHost;
    try {
      if (previousLocal !== rebaseBase) {
        const localChanges = computeTextChanges(rebaseBase, previousLocal);
        const remoteChanges = computeTextChanges(rebaseBase, nextHost);
        const mapped = mapChangesPreferLocal(
          localChanges,
          remoteChanges,
          rebaseBase.length,
        );
        rebasedText = applyTextChanges(nextHost, mapped);
      }
    } catch (error) {
      console.error(
        "[Markdown Easy Visual Editor] 入力を保持した自動再適用で補正しました。",
        error,
      );
      const localChanges = computeTextChanges(rebaseBase, previousLocal);
      const remoteChanges = computeTextChanges(rebaseBase, nextHost);
      rebasedText = applyTextChanges(
        nextHost,
        mapChangesPreferLocal(localChanges, remoteChanges, rebaseBase.length),
      );
    }
    hostTextRef.current = nextHost;
    versionRef.current = nextVersion;
    setVersion(nextVersion);
    updateMarkdown(
      rebasedText,
      computeTextChanges(previousLocal, rebasedText),
      "remote",
    );
    // 再同期後にローカル編集が残っている場合だけ再送する。同一スナップショットで
    // 再び失敗した場合は保留し、同じ自動再送を無限に繰り返さない。
    if (rebasedText !== nextHost) {
      const previousRetry = lastAutomaticRetryRef.current;
      const sameSnapshot =
        previousRetry?.version === nextVersion &&
        previousRetry.hostText === nextHost &&
        previousRetry.localText === rebasedText;
      if (!sameSnapshot) {
        lastAutomaticRetryRef.current = {
          version: nextVersion,
          hostText: nextHost,
          localText: rebasedText,
        };
        sendNextLocalOperation();
      }
    }
    flushHistoryCommands();
  }

  /**
   * Webviewルートの変更または要求をHost・Webview間へ通知する。
   * @param reason - 処理を中断または失敗させた理由。
   * @param opId - 再同期対象の編集操作ID。未指定時は現在進行中の操作IDを使う。
   * @returns 副作用を完了し、値は返さない。
   */
  function requestResync(
    reason: string,
    opId = inFlightOperationRef.current?.opId,
  ): void {
    if (resyncInFlightRef.current) return;
    resyncInFlightRef.current = true;
    vscode.postMessage({
      type: "requestResync",
      clientId: clientIdRef.current,
      opId,
      version: versionRef.current,
      reason,
    });
  }

  /**
   * Webviewルートの変更または要求をHost・Webview間へ通知する。
   * @returns Webviewルートで利用する文字列。
   */
  function commitSourceSnapshot(): string {
    const current = localTextRef.current;
    setMarkdown(
      /**
       * Webviewルートのコールバックとしてpreviousを処理する。
       * @param previous - 更新前のMarkdown本文。エディター最新値へ置き換えるか判定する基準値。
       * @returns 副作用を完了し、値は返さない。
       */
      (previous) => (previous === current ? previous : current),
    );
    return current;
  }

  /**
   * Webviewルートの変更または要求をHost・Webview間へ通知する。
   * @param command - Webviewへ送信するundoまたはredoコマンド。
   * @returns 副作用を完了し、値は返さない。
   */
  function requestHistoryCommand(command: "undo" | "redo"): void {
    commitSourceSnapshot();
    pendingHistoryCommandsRef.current.push(command);
    flushHistoryCommands();
  }

  /**
   * Webviewルートの処理順序と完了状態を管理する。
   * @returns 副作用を完了し、値は返さない。
   */
  function flushHistoryCommands(): void {
    // 未同期のローカル編集は sourceEditorChange / 再同期処理が送信する。
    // ここから再送すると、同一スナップショットへの再同期ループを迂回してしまう。
    if (
      resyncInFlightRef.current ||
      inFlightOperationRef.current ||
      localTextRef.current !== hostTextRef.current
    )
      return;
    const command = pendingHistoryCommandsRef.current.shift();
    if (!command) return;
    vscode.postMessage({
      type: "historyCommand",
      clientId: clientIdRef.current,
      command,
    });
  }

  /**
   * Webviewルートのremember・settled・operationを処理し、呼び出し側へ結果または副作用を返す。
   * @param opId - 完了済みとして記録するWebview編集操作ID。
   * @returns 副作用を完了し、値は返さない。
   */
  function rememberSettledOperation(opId: string): void {
    const settled = settledOperationIdsRef.current;
    settled.add(opId);
    if (settled.size <= 256) return;
    const oldest = settled.values().next().value as string | undefined;
    if (oldest) settled.delete(oldest);
  }

  /**
   * Webviewルートの値を保存先または共有状態へ書き出す。
   * @param viewModeOverride - 保存する分割表示状態。省略時は現在のsplitViewを保存する。
   * @returns 副作用を完了し、値は返さない。
   */
  function persistViewState(viewModeOverride?: ViewMode): void {
    const savedViewMode = viewModeOverride ?? splitView;
    vscode.setState({
      // 印刷プレビュー中にWebviewが再生成されても、通常の表示設定を復元する。
      mode: "split",
      outlineWidth,
      splitRatio,
      zoom,
      splitView: savedViewMode,
      viewMode: savedViewMode,
      sourceViewport: viewportStateRef.current.source,
      splitPreviewViewport: viewportStateRef.current.splitPreview,
      previewOnlyViewport: viewportStateRef.current.previewOnly,
    });
  }

  /**
   * Webviewルートの処理順序と完了状態を管理する。
   * @param viewModeOverride - 保存処理の実行まで保留する分割表示状態。
   * @returns 副作用を完了し、値は返さない。
   */
  function schedulePersistViewState(viewModeOverride?: ViewMode): void {
    if (viewModeOverride !== undefined)
      pendingPersistViewModeRef.current = viewModeOverride;
    if (persistViewStateTimerRef.current !== undefined) return;
    persistViewStateTimerRef.current = window.setTimeout(
      /**
       * 指定時間の経過後に後続処理を実行する。
       * @returns 副作用を完了し、値は返さない。
       */
      () => {
        persistViewStateTimerRef.current = undefined;
        const pendingViewMode = pendingPersistViewModeRef.current;
        pendingPersistViewModeRef.current = undefined;
        persistViewStateRef.current(pendingViewMode);
      },
      100,
    );
  }

  persistViewStateRef.current = persistViewState;

  /**
   * Webviewルートの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param visible - trueならアウトラインを表示し、falseなら非表示にする。
   * @returns 副作用を完了し、値は返さない。
   */
  function setOutlineVisibility(visible: boolean): void {
    if (outlineVisible === visible) return;
    setOutlineVisible(visible);
    vscode.postMessage({ type: "setOutlineVisible", visible });
  }

  /**
   * Webviewルートの変更または利用者の操作意図を記録し、後続処理へ渡す。
   * @param nextMode - 切り替え先の本文・分割・プレビュー表示モード。
   * @returns 副作用を完了し、値は返さない。
   */
  function changeMode(nextMode: EditorMode): void {
    mveDebug("view.change-mode", { from: mode, to: nextMode, splitView });
    captureVisibleViewports();
    const activeSelection = sourceRef.current?.getSelection();
    if (activeSelection) {
      selectionStateRef.current = activeSelection;
    }
    if (nextMode === "preview" && !viewportStateRef.current.previewOnly) {
      viewportStateRef.current.previewOnly =
        viewportStateRef.current.splitPreview ??
        viewportStateRef.current.source;
    }
    if (nextMode === "split" && viewportStateRef.current.previewOnly) {
      viewportStateRef.current.splitPreview ??=
        viewportStateRef.current.previewOnly;
      viewportStateRef.current.source ??= viewportStateRef.current.previewOnly;
    }
    pendingViewportRestoreRef.current = true;
    setMode(nextMode);
  }

  /**
   * スプリットビューの表示モードを切り替える。
   * @param nextView 切り替え先の分割表示モード。
   * @returns 副作用を完了し、値は返さない。
   */
  function changeSplitView(nextView: "both" | "text" | "preview"): void {
    mveDebug("view.change-split", { from: splitView, to: nextView, mode });
    captureVisibleViewports();
    if (nextView !== "text" && !viewportStateRef.current.splitPreview) {
      viewportStateRef.current.splitPreview = viewportStateRef.current.source;
    }
    if (nextView !== "preview" && !viewportStateRef.current.source) {
      viewportStateRef.current.source = viewportStateRef.current.splitPreview;
    }
    pendingViewportRestoreRef.current = true;
    setSplitView(nextView);
    setMode("split");
    persistViewState(nextView);
    vscode.postMessage({ type: "setViewMode", viewMode: nextView });
  }

  /**
   * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
   * @param command - 実行するリボン操作の種別と、その操作に必要な値。
   * @returns 副作用を完了し、値は返さない。
   */
  function handleRibbon(command: RibbonCommand): void {
    commitSourceSnapshot();
    // 同一ジェスチャーから同じリボン操作が短時間に重複して届いても、編集は1回だけ適用する。
    const commandKey = JSON.stringify(command);
    const now = performance.now();
    const previous = recentRibbonCommandsRef.current.get(commandKey);
    recentRibbonCommandsRef.current.set(commandKey, now);
    const delta =
      previous === undefined
        ? undefined
        : Math.round((now - previous) * 100) / 100;
    mveDebug("ribbon.command-received", { command, delta });
    // 印刷プレビューは「設定を再表示」「通常表示へ戻る」を同じボタンで行うため、
    // 高速な意図的連続操作を重複ジェスチャーとして抑止しない。
    if (
      command.type !== "togglePrintPreview" &&
      previous !== undefined &&
      now - previous < 250
    ) {
      mveDebug("ribbon.command-suppressed", { command, delta });
      return;
    }
    mveDebug("ribbon.command-applied", { command });

    switch (command.type) {
      case "sourceAction":
        getActiveEditor()?.action(command.action);
        return;
      case "historyCommand":
        requestHistoryCommand(command.command);
        return;
      case "heading":
        getActiveEditor()?.heading(command.level);
        return;
      case "insert":
        getActiveEditor()?.insert(command.value);
        return;
      case "tableInsert":
        getActiveEditor()?.insert(
          `\n${createTableMarkdown(command.rows, command.columns)}\n`,
        );
        return;
      case "codeBlock":
        getActiveEditor()?.codeBlock(command.language);
        return;
      case "link": {
        if (!getActiveEditor()) return;
        setLinkHref("https://example.com");
        setLinkLabel("");
        setLinkDialogVisible(true);
        return;
      }
      case "image":
        requestImagePicker();
        return;
      case "table":
        if (command.action === "insert")
          getActiveEditor()?.insert(`\n${createTableMarkdown()}\n`);
        else {
          const editor = getActiveEditor();
          const edit = editor
            ? applyMarkdownTableAction(
                localTextRef.current,
                editor.getSelection(),
                command.action,
                { headerName: command.headerName },
              )
            : undefined;
          if (edit) editor?.applyEdit(edit);
          else setToast(messages.app.toast.tableCellRequired);
        }
        return;
      case "copyTableTsv":
        void copyTableTsv();
        return;
      case "splitView":
        changeSplitView(command.view);
        return;
      case "toggleOutline":
        prepareLayoutRestore();
        setOutlineVisibility(!outlineVisible);
        return;
      case "toggleScrollSync": {
        const enabled = !scrollSyncEnabledRef.current;
        scrollSyncEnabledRef.current = enabled;
        if (!enabled) cancelPendingCrossPaneScrollSync();
        setSettings(
          /**
           * Webviewルートのコールバックとしてcurrentを処理する。
           * @param current - 現在のWebview設定。スクロール同期だけを切り替え、他設定を保つ基準値。
           * @returns Webviewルートのコールバックが生成する結果。
           */
          (current) => ({
            ...current,
            scrollSyncEnabled: enabled,
          }),
        );
        vscode.postMessage({ type: "setScrollSyncEnabled", enabled });
        return;
      }
      case "toggleInspector":
        if (inspector) changeInspector(undefined);
        return;
      case "runPreflightCheck":
        runPreflightCheck();
        return;
      case "togglePrintPreview":
        flushPdfOptionsPersistence();
        if (printPreview) {
          setPrintPreview(false);
          setPrintSettingsVisible(false);
          changeMode(previousModeBeforePrintRef.current);
        } else {
          previousModeBeforePrintRef.current = mode;
          setPrintPreview(true);
          setPrintSettingsVisible(false);
          changeMode("preview");
        }
        return;
      // PDFプレビューを維持したまま印刷設定を開く。
      case "openPrintSettings":
        flushPdfOptionsPersistence();
        setPrintSettingsVisible(true);
        return;
      case "openSource":
        vscode.postMessage({ type: "openSource" });
        return;
      case "exportPdf":
        void requestPdfExport();
        return;
      case "exportHtml":
        void requestHtmlExport(command.options);
        return;
      case "setImageDirectory":
        setSettings(
          /**
           * Webviewルートのコールバックとしてcurrentを処理する。
           * @param current - 現在のWebview設定。画像保存先だけを置き換え、他設定を保つ基準値。
           * @returns Webviewルートのコールバックが生成する結果。
           */
          (current) => ({
            ...current,
            imageDirectory: command.directory,
          }),
        );
        vscode.postMessage({
          type: "setImageDirectory",
          directory: command.directory,
        });
        return;
      case "setFontFamilies": {
        const editorFontFamily = normalizeFontFamily(command.editorFontFamily);
        const previewFontFamily = normalizeFontFamily(
          command.previewFontFamily,
        );
        const nextPdfOptions = normalizePdfOptions({
          ...pdfOptionsRef.current,
          fontFamily: previewFontFamily || DEFAULT_PDF_OPTIONS.fontFamily,
        });
        pdfOptionsRef.current = nextPdfOptions;
        setPdfOptions(nextPdfOptions);
        setSettings(
          /**
           * Webviewルートのコールバックとしてcurrentを処理する。
           * @param current - 現在のWebview設定。エディター・プレビューのフォントとPDF設定を更新する基準値。
           * @returns 副作用を完了し、値は返さない。
           */
          (current) => ({
            ...current,
            editorFontFamily,
            previewFontFamily,
            pdfOptions: nextPdfOptions,
          }),
        );
        vscode.postMessage({
          type: "setFontFamilies",
          editorFontFamily,
          previewFontFamily,
        });
        return;
      }
      case "find": {
        openSearch();
        return;
      }
      case "showShortcuts":
        setHelpTopic("shortcuts");
        return;
      case "showFeatures":
        setHelpTopic("features");
        return;
    }
  }

  /**
   * Webviewルートの処理順序と完了状態を管理する。
   * @returns 副作用を完了し、値は返さない。
   */
  function runPreflightCheck(): void {
    prepareLayoutRestore();
    setDiagnosticsVisible(true);
    requestLocalResourceCheck("preflight");
    const currentSummary = summarizeDiagnostics(
      mergeDiagnostics(
        localTextRef.current,
        localResourceDiagnostics,
        settings.language,
      ),
    );
    setToast(
      messages.app.toast.preflightSummary(
        currentSummary.errors.length,
        currentSummary.warnings.length,
        currentSummary.infos.length,
      ),
    );
  }

  /**
   * Webviewルートの変更または要求をHost・Webview間へ通知する。
   * @param purpose - 診断要求が設定変更後の再確認か、ユーザーによる手動確認かを示す理由。
   * @returns 副作用を完了し、値は返さない。
   */
  function requestLocalResourceCheck(purpose: LocalResourceCheckPurpose): void {
    const requestId = createClientId();
    const currentMarkdown = localTextRef.current;
    latestResourceCheckRequestRef.current = requestId;
    resourceCheckRequestsRef.current.set(requestId, {
      markdown: currentMarkdown,
      version: versionRef.current,
      generation: resourceCheckGenerationRef.current,
      purpose,
    });
    vscode.postMessage({
      type: "checkLocalResources",
      requestId,
      markdown: currentMarkdown,
    });
  }

  /**
   * Webviewルートの表示または操作を開始する。
   * @returns 副作用を完了し、値は返さない。
   */
  function openSearch(): void {
    if (mode === "preview") changeMode("split");
    if (splitView === "preview") changeSplitView("text");
    setSearchVisible(true);
  }

  /**
   * Webviewルートの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @returns 副作用を完了し、値は返さない。
   */
  function applyLinkDialog(): void {
    const href = linkHref.trim();
    if (!href) return;
    getActiveEditor()?.link(href, linkLabel.trim() || undefined);
    setLinkDialogVisible(false);
  }

  /**
   * Webviewルートの処理またはリソースを終了し、後続利用可能な状態へ戻す。
   * @returns 副作用を完了し、値は返さない。
   */
  function closeSearch(): void {
    setSearchVisible(false);
    setSearchIndex(0);
  }

  /**
   * Webviewルートのjump・to・searchを処理し、呼び出し側へ結果または副作用を返す。
   * @param direction - 検索ヒットを進む場合は1、戻る場合は-1。
   * @returns 副作用を完了し、値は返さない。
   */
  function jumpToSearch(direction: 1 | -1): void {
    if (!searchHits.length) return;
    const nextIndex =
      (searchIndex + direction + searchHits.length) % searchHits.length;
    const hit = searchHits[nextIndex];
    setSearchIndex(nextIndex);
    navigateToSelection(hit);
  }

  /**
   * Webviewルートの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param all - Webviewルートの条件を示すフラグ。
   * @returns 副作用を完了し、値は返さない。
   */
  function replaceSearch(all: boolean): void {
    if (!searchQuery || !searchHits.length) return;
    if (all) {
      updateMarkdown(
        localTextRef.current.split(searchQuery).join(searchReplacement),
      );
      setSearchIndex(0);
      return;
    }
    const hit = searchHits[searchIndex] ?? searchHits[0];
    updateMarkdown(
      localTextRef.current.slice(0, hit.from) +
        searchReplacement +
        localTextRef.current.slice(hit.to),
    );
    setSearchIndex(Math.max(0, Math.min(searchIndex, searchHits.length - 2)));
  }

  /**
   * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
   * @param event - CodeMirror本文への貼り付け内容を検査するclipboard event。
   * @returns 副作用を完了し、値は返さない。
   */
  async function handlePaste(event: ClipboardEvent): Promise<void> {
    if (!isEditingEnabled(mode, splitView)) return;
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(".cm-content")) return;
    const items = Array.from(event.clipboardData?.items ?? []);
    const imageFiles = items
      .filter(
        /**
         * 画像ファイルを表すクリップボード項目だけを残す。
         * @param item - 貼り付けられた画像ファイルを表すDataTransferItem。
         * @returns 条件を満たした要素だけを含む一覧。
         */
        (item) => item.kind === "file" && item.type.startsWith("image/"),
      )
      .map(
        /**
         * 画像クリップボード項目からFileを取得する。
         * @param item - 画像ファイルかを確認済みのDataTransferItem。
         * @returns get・as・fileを取り出した変換結果の一覧。
         */
        (item) => item.getAsFile(),
      )
      .filter(
        /**
         * 未定義または無効なfileを除外する。
         * @param file - 有効性を判定するfile。
         * @returns 条件を満たした要素だけを含む一覧。
         */
        (file): file is File => Boolean(file),
      );
    if (imageFiles.length) {
      event.preventDefault();
      event.stopImmediatePropagation();
      await saveImageFiles(imageFiles);
      return;
    }
    const html = event.clipboardData?.getData("text/html");
    const editor = getActiveEditor();
    const plainText = event.clipboardData?.getData("text/plain") ?? "";
    const hasHtmlTable = /<table\b[^>]*>[\s\S]*<\/table>/i.test(html ?? "");
    const hasTsvMime = Array.from(event.clipboardData?.types ?? []).some(
      /**
       * Webviewルートのコールバックとしてtypeを処理する。
       * @param type - Clipboard APIが報告したクリップボード項目のMIME type。
       * @returns Webviewルートのコールバックが生成する結果。
       */
      (type) => type === "text/tab-separated-values" || type === "text/tsv",
    );
    const hasTableClipboard =
      hasHtmlTable || (!html && (hasTsvMime || plainText.includes("\t")));
    if (
      editor &&
      hasTableClipboard &&
      !isMarkdownCodeFencePosition(localTextRef.current, editor.getSelection())
    ) {
      const edit = applyMarkdownTableTsv(
        localTextRef.current,
        editor.getSelection(),
        plainText,
      );
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
      const safe = DOMPurify.sanitize(html, {
        FORBID_TAGS: ["script", "style", "iframe", "object"],
      });
      const turndown = new TurndownService({
        headingStyle: "atx",
        bulletListMarker: "-",
        codeBlockStyle: "fenced",
      });
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
   * Webviewルートの入力または状態を走査・複製する。
   * @returns 副作用を完了し、値は返さない。
   */
  async function copyTableTsv(): Promise<void> {
    const editor = getActiveEditor();
    const tsv = editor
      ? markdownTableToTsv(localTextRef.current, editor.getSelection())
      : undefined;
    if (tsv === undefined) {
      setToast(messages.app.toast.tableCellRequired);
      return;
    }
    try {
      await writeClipboardText(tsv);
      setToast(messages.app.toast.tableCopied);
    } catch (error) {
      setToast(
        messages.app.toast.cannotCopyTsv(
          error instanceof Error ? error.message : undefined,
        ),
      );
    }
  }

  /**
   * Webviewルートの値を保存先または共有状態へ書き出す。
   * @param text - 表示・解析・変換の対象となる本文。
   * @returns 副作用を完了し、値は返さない。
   */
  async function writeClipboardText(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error(messages.app.errors.clipboardUnavailable);
  }

  /**
   * Webviewルートの値を保存先または共有状態へ書き出す。
   * @param files - Webviewルートで読み書きするリソースの場所。
   * @returns 副作用を完了し、値は返さない。
   */
  async function saveImageFiles(files: File[]): Promise<void> {
    try {
      const images: ImagePayload[] = [];
      for (const file of files)
        images.push(
          await fileToPayload(file, settings.maxPasteSizeMb, messages),
        );
      const requestId = createClientId();
      imageRequestsRef.current.add(requestId);
      vscode.postMessage({
        type: "saveImages",
        requestId,
        images,
        imageDirectory: settings.imageDirectory,
      });
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Webviewルートの変更または要求をHost・Webview間へ通知する。
   * @returns 副作用を完了し、値は返さない。
   */
  function requestImagePicker(): void {
    const requestId = createClientId();
    imageRequestsRef.current.add(requestId);
    vscode.postMessage({
      type: "pickImage",
      requestId,
      imageDirectory: settings.imageDirectory,
    });
  }

  /**
   * Webviewルートが指定条件を満たすまで待機する。
   * @returns 条件が成立したかを示す真偽値。
   */
  async function waitForCurrentPreviewSnapshot(): Promise<boolean> {
    if (previewSnapshot.markdown === localTextRef.current) return true;
    return new Promise(
      /**
       * 遅延処理の完了または失敗を待機側へ通知する。
       * @param resolve - Promiseの成功を通知する関数。
       * @returns 非同期処理の完了値。
       */
      (resolve) => {
        let waiter: (() => void) | undefined;
        const timeout = window.setTimeout(
          /**
           * 指定時間の経過後に後続処理を実行する。
           * @returns 副作用を完了し、値は返さない。
           */
          () => {
            const index = waiter
              ? previewSnapshotWaitersRef.current.indexOf(waiter)
              : -1;
            if (index >= 0) previewSnapshotWaitersRef.current.splice(index, 1);
            resolve(false);
          },
          15_000,
        );
        waiter =
          /**
           * Webviewルートが指定条件を満たすまで待機する。
           * @returns 副作用を完了し、値は返さない。
           */
          () => {
            window.clearTimeout(timeout);
            const index = previewSnapshotWaitersRef.current.indexOf(
              waiter as () => void,
            );
            if (index >= 0) previewSnapshotWaitersRef.current.splice(index, 1);
            resolve(true);
          };
        previewSnapshotWaitersRef.current.push(waiter);
      },
    );
  }

  /**
   * Webviewルートのensure・export・rootを処理し、呼び出し側へ結果または副作用を返す。
   * @returns 副作用を完了し、値は返さない。
   */
  async function ensureExportRoot(): Promise<HTMLDivElement | undefined> {
    if (exportRootRef.current && exportStageRequested)
      return exportRootRef.current;
    return new Promise(
      /**
       * 遅延処理の完了または失敗を待機側へ通知する。
       * @param resolve - Promiseの成功を通知する関数。
       * @returns 非同期処理の完了値。
       */
      (resolve) => {
        let waiter: ((root: HTMLDivElement | undefined) => void) | undefined;
        const timeout = window.setTimeout(
          /**
           * 指定時間の経過後に後続処理を実行する。
           * @returns 副作用を完了し、値は返さない。
           */
          () => {
            const index = waiter
              ? exportStageWaitersRef.current.indexOf(waiter)
              : -1;
            if (index >= 0) exportStageWaitersRef.current.splice(index, 1);
            resolve(exportRootRef.current ?? undefined);
          },
          15_000,
        );
        waiter =
          /**
           * Webviewルートが指定条件を満たすまで待機する。
           * @param root - エクスポート用プレビューの描画ルート。未マウント時はundefined。
           * @returns 副作用を完了し、値は返さない。
           */
          (root) => {
            window.clearTimeout(timeout);
            resolve(root);
          };
        exportStageWaitersRef.current.push(waiter);
        setExportStageRequested(true);
      },
    );
  }

  /**
   * 置換済みMarkdownをPDF専用の非表示描画ステージへ反映し、描画完了したDOMを返す。
   * @param printableMarkdown PDFへ出力する置換済みMarkdown本文。
   * @returns PDF用Markdownを描画したDOM。タイムアウト時はundefined。
   */
  async function ensurePdfExportRoot(
    printableMarkdown: string,
  ): Promise<HTMLDivElement | undefined> {
    if (
      pdfExportRootRef.current &&
      pdfExportRootMarkdownRef.current === printableMarkdown &&
      (printPreview || pdfExportStageRequested)
    ) {
      return pdfExportRootRef.current;
    }

    return new Promise(
      /**
       * PDF専用描画ステージの完了を待つ。
       * @param resolve 描画済みDOMを返すPromise解決関数。
       * @returns 副作用を完了し、値は返さない。
       */
      (resolve) => {
        const waiter: {
          markdown: string;
          resolve: (root: HTMLDivElement | undefined) => void;
        } = {
          markdown: printableMarkdown,
          resolve: (root) => resolve(root),
        };
        const timeout = window.setTimeout(
          /**
           * 描画が完了しない場合に待機を解除する。
           * @returns 副作用を完了し、値は返さない。
           */
          () => {
            const index = pdfExportStageWaitersRef.current.indexOf(waiter);
            if (index >= 0) pdfExportStageWaitersRef.current.splice(index, 1);
            resolve(
              pdfExportRootMarkdownRef.current === printableMarkdown
                ? pdfExportRootRef.current ?? undefined
                : undefined,
            );
          },
          15_000,
        );
        waiter.resolve =
          /**
           * 対象Markdownの描画完了時にタイムアウトを解除してDOMを返す。
           * @param root PDF専用描画ステージのルート要素。
           * @returns 副作用を完了し、値は返さない。
           */
          (root) => {
            window.clearTimeout(timeout);
            resolve(root);
          };
        pdfExportStageWaitersRef.current.push(waiter);
        setPdfExportMarkdown(printableMarkdown);
        setPdfExportStageRequested(true);
      },
    );
  }

  /**
   * Webviewルートの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param update - 現在の正規化済みPDF設定を受け取り、次に保存するPDF設定を返す更新関数。
   * @returns 副作用を完了し、値は返さない。
   */
  function updatePdfOptions(
    update: (current: NormalizedPdfOptions) => PdfOptions,
  ): void {
    const next = normalizePdfOptions(update(pdfOptionsRef.current));
    pdfOptionsRef.current = next;
    setPdfOptions(next);
    if (pdfOptionsPersistTimerRef.current !== undefined) {
      window.clearTimeout(pdfOptionsPersistTimerRef.current);
    }
    pdfOptionsPersistTimerRef.current = window.setTimeout(
      /**
       * 指定時間の経過後に後続処理を実行する。
       * @returns 副作用を完了し、値は返さない。
       */
      () => {
        pdfOptionsPersistTimerRef.current = undefined;
        vscode.postMessage({
          type: "setPdfOptions",
          options: pdfOptionsRef.current,
        });
      },
      PDF_OPTIONS_PERSIST_DELAY_MS,
    );
  }

  /**
   * Webviewルートの処理順序と完了状態を管理する。
   * @returns 副作用を完了し、値は返さない。
   */
  function flushPdfOptionsPersistence(): void {
    if (pdfOptionsPersistTimerRef.current === undefined) return;
    window.clearTimeout(pdfOptionsPersistTimerRef.current);
    pdfOptionsPersistTimerRef.current = undefined;
    vscode.postMessage({
      type: "setPdfOptions",
      options: pdfOptionsRef.current,
    });
  }

  /**
   * Webviewルートの変更または要求をHost・Webview間へ通知する。
   * @returns 副作用を完了し、値は返さない。
   */
  async function requestPdfExport(): Promise<void> {
    if (!settings.workspaceTrusted) {
      setToast(messages.app.toast.workspaceTrustRequired);
      return;
    }

    flushPdfOptionsPersistence();
    const ruleValidation = applyPdfTextReplacements(
      "",
      pdfOptionsRef.current.textReplacements,
    );
    if (ruleValidation.errors.length) {
      const first = ruleValidation.errors[0];
      setToast(
        messages.app.toast.operationFailed(
          `${messages.app.invalidRegularExpression} (${first.index + 1}): ${first.message}`,
        ),
      );
      return;
    }

    if (!(await waitForCurrentPreviewSnapshot())) {
      setToast(
        messages.app.toast.operationFailed(
          `${messages.renderer.mermaidError}: timeout`,
        ),
      );
      return;
    }
    const currentMarkdown = localTextRef.current;
    const replacementResult = applyPdfTextReplacements(
      currentMarkdown,
      pdfOptionsRef.current.textReplacements,
    );
    if (replacementResult.errors.length) {
      const first = replacementResult.errors[0];
      setToast(
        messages.app.toast.operationFailed(
          `${messages.app.invalidRegularExpression} (${first.index + 1}): ${first.message}`,
        ),
      );
      return;
    }
    requestLocalResourceCheck("pdf");
    const currentSummary = summarizeDiagnostics(
      mergeDiagnostics(
        currentMarkdown,
        localResourceDiagnostics,
        settings.language,
      ),
    );
    const diagnosticNotice = currentSummary.errors.length
      ? currentSummary.errors
          .map(
            /**
             * 行番号があれば診断文の先頭へ付ける。
             * @param item - PDF書き出し前に表示するエラー診断。
             * @returns lineを取り出した変換結果の一覧。
             */
            (item) => `${item.line ? `行${item.line}: ` : ""}${item.message}`,
          )
          .join(" / ")
      : "";
    if (diagnosticNotice)
      setToast(
        messages.app.toast.pdfStartedWithDiagnostics(
          currentSummary.errors.length,
          diagnosticNotice,
        ),
      );

    const root = await ensurePdfExportRoot(replacementResult.text);
    if (!(await waitForHtmlMermaidRendering(root))) {
      setToast(`${messages.renderer.mermaidError}: timeout`);
      setPdfExportMarkdown(undefined);
      if (!printPreview) setPdfExportStageRequested(false);
      return;
    }
    const html = root
      ? serializeExportHtml(root)
      : `<pre>${escapeHtml(replacementResult.text)}</pre>`;
    if (!root)
      setToast(messages.app.toast.pdfFallbackToMarkdown(diagnosticNotice));
    const requestId = createClientId();
    const message: WebviewToHostMessage = {
      type: "exportPdf",
      requestId,
      html,
      css: await collectEmbeddedPrintableCss(settings.previewFontFamily),
      options: pdfOptionsRef.current,
    };
    pdfRequestsRef.current.add(requestId);
    vscode.postMessage(message);

    setPdfExportMarkdown(undefined);
    if (!printPreview) {
      pdfExportRootRef.current = null;
      pdfExportRootMarkdownRef.current = undefined;
      setPdfExportStageRequested(false);
    }
  }

  /**
   * HTML文書をレンダリングし、HostからのHTML出力要求を完了させる。
   * @param options - 画像埋め込み、リンク先Markdown変換、保存ダイアログのHTML出力設定。
   * @returns 出力要求が完了したときに解決するPromise。
   */
  async function requestHtmlExport(options: HtmlExportOptions): Promise<void> {
    if (!settings.workspaceTrusted) {
      setToast(messages.app.toast.workspaceTrustRequired);
      return;
    }
    if (!(await waitForCurrentPreviewSnapshot())) {
      setToast(
        messages.app.toast.operationFailed(
          `${messages.renderer.mermaidError}: timeout`,
        ),
      );
      return;
    }
    const root = await ensureExportRoot();
    if (!(await waitForHtmlMermaidRendering(root))) {
      setToast(`${messages.renderer.mermaidError}: timeout`);
      exportRootRef.current = null;
      setExportStageRequested(false);
      return;
    }
    const requestId = createClientId();
    const currentMarkdown = localTextRef.current;
    htmlRequestsRef.current.add(requestId);
    vscode.postMessage({
      type: "exportHtml",
      requestId,
      markdown: currentMarkdown,
      html: root
        ? serializeExportHtml(root)
        : `<pre>${escapeHtml(currentMarkdown)}</pre>`,
      css: await collectEmbeddedPrintableCss(settings.previewFontFamily),
      options,
    });
    exportRootRef.current = null;
    setExportStageRequested(false);
  }

  /**
   * Webviewルートが指定条件を満たすまで待機する。
   * @param root - 配下の未完了Mermaid描画を監視するHTML出力ルート。未指定時は現在の出力ルートを使う。
   * @returns 条件が成立したかを示す真偽値。
   */
  async function waitForHtmlMermaidRendering(
    root: HTMLDivElement | null | undefined = exportRootRef.current,
  ): Promise<boolean> {
    if (!root) return true;
    const deadline = Date.now() + 60_000;
    while (
      root.querySelector(
        '.mermaid:not([data-mermaid-status]), .mermaid[data-mermaid-status="rendering"]',
      ) &&
      Date.now() < deadline
    ) {
      await new Promise<void>(
        /**
         * 遅延処理の完了または失敗を待機側へ通知する。
         * @param resolve - Promiseの成功を通知する関数。
         * @returns 非同期処理の完了値。
         */
        (resolve) => window.setTimeout(resolve, 50),
      );
    }
    return !root.querySelector(
      '.mermaid:not([data-mermaid-status]), .mermaid[data-mermaid-status="rendering"]',
    );
  }

  /**
   * Webviewルートの変更または要求をHost・Webview間へ通知する。
   * @returns 副作用を完了し、値は返さない。
   */
  function requestPdfPreview(): void {
    if (!printPreview || !settings.workspaceTrusted) return;
    if (pdfReplacementResult.errors.length) return;
    const root = pdfExportRootRef.current;
    if (
      pdfExportRootMarkdownRef.current !== printablePreviewMarkdown
    )
      return;
    if (
      !root ||
      root.querySelector(
        '.mermaid:not([data-mermaid-status]), .mermaid[data-mermaid-status="rendering"]',
      )
    )
      return;
    const html = serializeExportHtml(root);
    // 画像のloadやResizeObserverでexport-stageのDOMが変わっても、同じ本文のPDFを再生成しない。
    // 画像サイズの変更はMarkdown本文が変わるため、このキーも変わる。
    const signature = `${settings.language}\0${settings.remoteImagesEnabled}\0${settings.mermaidTheme}\0${JSON.stringify(pdfOptions)}\0${printablePreviewMarkdown}`;
    if (pdfPreviewSignatureRef.current === signature) return;
    pdfPreviewSignatureRef.current = signature;
    const requestId = createClientId();
    pdfPreviewRequestRef.current = requestId;
    setPdfPreview(
      /**
       * Webviewルートのコールバックとしてpreviousを処理する。
       * @param previous - 更新前のPDFプレビュー状態。新しい要求IDとloading状態を設定し、PDFデータなどを保つ基準値。
       * @returns 副作用を完了し、値は返さない。
       */
      (previous) => ({
        ...previous,
        requestId,
        loading: true,
        error: undefined,
      }),
    );
    const css = collectPrintableCss(settings.previewFontFamily, false);
    mveDebug("pdf.preview-request", {
      requestId,
      htmlChars: html.length,
      cssChars: css.length,
    });
    vscode.postMessage({
      type: "renderPdfPreview",
      requestId,
      html,
      css,
      options: pdfOptions,
    });
  }

  /**
   * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
   * @param element - 寸法または属性を読み取るDOM要素。
   * @returns 通知処理を完了し、値は返さない。
   */
  function handleExportRendered(element: HTMLElement): void {
    exportRootRef.current = element as HTMLDivElement;
    const waiters = exportStageWaitersRef.current.splice(0);
    waiters.forEach(
      /**
       * 成功結果通知ごとに成功結果通知を実行する。
       * @param resolve - Promiseの成功を通知する関数。
       * @returns 副作用を完了し、値は返さない。
       */
      (resolve) => resolve(exportRootRef.current ?? undefined),
    );
  }

  /**
   * PDF専用描画ステージの完了を保存し、待機中の出力と印刷プレビューへ通知する。
   * @param element PDF用Markdownを描画したルート要素。
   * @param renderedMarkdown このDOMへ描画済みの置換後Markdown。
   * @returns 副作用を完了し、値は返さない。
   */
  function handlePdfExportRendered(
    element: HTMLElement,
    renderedMarkdown: string,
  ): void {
    pdfExportRootRef.current = element as HTMLDivElement;
    pdfExportRootMarkdownRef.current = renderedMarkdown;

    const matching = pdfExportStageWaitersRef.current.filter(
      (waiter) => waiter.markdown === renderedMarkdown,
    );
    pdfExportStageWaitersRef.current =
      pdfExportStageWaitersRef.current.filter(
        (waiter) => waiter.markdown !== renderedMarkdown,
      );
    matching.forEach((waiter) => waiter.resolve(pdfExportRootRef.current ?? undefined));

    if (
      printPreview &&
      settings.workspaceTrusted &&
      renderedMarkdown === printablePreviewMarkdown
    ) {
      if (pdfPreviewTimerRef.current !== undefined)
        window.clearTimeout(pdfPreviewTimerRef.current);
      pdfPreviewTimerRef.current = window.setTimeout(
        /**
         * PDF専用DOMが確定した後にプレビュー生成を要求する。
         * @returns 副作用を完了し、値は返さない。
         */
        () => {
          pdfPreviewTimerRef.current = undefined;
          requestPdfPreview();
        },
        80,
      );
    }
  }

  /**
   * Inspectorで編集中の画像、リンク、数式、またはMermaid内容を更新する。
   * @param nextSource Inspectorで編集中の対象へ設定する新しい内容。
   * @param alt 画像の代替テキスト。画像Inspectorで使う場合に指定する。
   * @returns 副作用を完了し、値は返さない。
   */
  function updateInspector(nextSource: string, alt?: string): void {
    if (!inspector) return;
    if (inspector.type === "mermaid") {
      updateMarkdown(
        replaceDelimitedBlock(
          localTextRef.current,
          "```mermaid",
          "```",
          inspector.source,
          nextSource,
        ),
      );
      setInspector({ type: "mermaid", source: nextSource });
    } else if (inspector.type === "math") {
      const blockUpdated = replaceDelimitedBlock(
        localTextRef.current,
        "$$",
        "$$",
        inspector.source,
        nextSource,
      );
      updateMarkdown(
        blockUpdated.replace(`$${inspector.source}$`, `$${nextSource}$`),
      );
      setInspector({ type: "math", source: nextSource });
    } else {
      const escaped = escapeRegExp(inspector.source);
      updateMarkdown(
        localTextRef.current.replace(
          new RegExp(`!\\[[^\\]]*\\]\\(${escaped}\\)`),
          imageMarkdown(
            inspector.source,
            alt || messages.editor.defaultImageAlt,
          ),
        ),
      );
      setInspector({ ...inspector, alt: alt || "" });
    }
  }

  /**
   * Webviewルートのresize・preview・imageを処理し、呼び出し側へ結果または副作用を返す。
   * @param imageIndex - Markdown本文内でサイズを変更するプレビュー画像の0始まりインデックス。
   * @param width - 表示領域または列の幅。
   * @returns 副作用を完了し、値は返さない。
   */
  function resizePreviewImage(imageIndex: number, width: number): void {
    if (!(mode === "split" && splitView !== "text")) return;
    updateMarkdown(
      resizeImageInMarkdown(localTextRef.current, imageIndex, width),
    );
  }

  /**
   * Webviewルートの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param imageIndex - Markdown本文内で元のサイズへ戻すプレビュー画像の0始まりインデックス。
   * @returns 副作用を完了し、値は返さない。
   */
  function resetPreviewImage(imageIndex: number): void {
    if (!(mode === "split" && splitView !== "text")) return;
    updateMarkdown(resetImageSizeInMarkdown(localTextRef.current, imageIndex));
  }

  /**
   * Webviewルートのalign・preview・imageを処理し、呼び出し側へ結果または副作用を返す。
   * @param imageIndex - Markdown本文内で配置を変えるプレビュー画像の0始まりインデックス。
   * @param alignment - 画像を左・中央・右のどこへ配置するかを示す値。
   * @returns 副作用を完了し、値は返さない。
   */
  function alignPreviewImage(
    imageIndex: number,
    alignment: ImageAlignment,
  ): void {
    if (!(mode === "split" && splitView !== "text")) return;
    updateMarkdown(
      alignImageInMarkdown(localTextRef.current, imageIndex, alignment),
    );
  }

  /**
   * Inspectorの表示対象を切り替える。
   * @param next 表示するInspector対象。undefinedならInspectorを閉じる。
   * @returns 副作用を完了し、値は返さない。
   */
  function changeInspector(next: InspectorTarget | undefined): void {
    prepareLayoutRestore();
    setInspector(next);
  }

  /**
   * Webviewルートで使う値または実行環境を組み立てる。
   * @returns 副作用を完了し、値は返さない。
   */
  function prepareLayoutRestore(): void {
    captureVisibleViewports();
    pendingViewportRestoreRef.current = true;
  }

  /**
   * Webviewルートのgo・to・offsetを処理し、呼び出し側へ結果または副作用を返す。
   * @param offset アウトライン見出しのMarkdown本文内UTF-16オフセット。
   * @returns 副作用を完了し、値は返さない。
   */
  function goToOffset(offset: number): void {
    navigateToSelection({ from: offset, to: offset });
  }

  /**
   * Webviewルートのgo・to・outline・offsetを処理し、呼び出し側へ結果または副作用を返す。
   * @param offset - 見出しの開始位置を示すMarkdown本文内のUTF-16オフセット。
   * @returns 副作用を完了し、値は返さない。
   */
  function goToOutlineOffset(offset: number): void {
    const nextSelection = { from: offset, to: offset };
    if (mode === "split" && splitView === "preview") {
      selectionStateRef.current = nextSelection;
      revealOutlineInSplitPreview(offset, false);
      return;
    }
    navigateToSelection(nextSelection);
    if (mode === "split" && splitView === "both") {
      // CodeMirrorの選択行とスクロール位置が確定してから、同じ高さへプレビューを揃える。
      window.requestAnimationFrame(
        /**
         * 次の描画フレームで表示更新を実行する。
         * @returns 副作用を完了し、値は返さない。
         */
        () => {
          window.requestAnimationFrame(
            /**
             * 次の描画フレームで表示更新を実行する。
             * @returns 副作用を完了し、値は返さない。
             */
            () => revealOutlineInSplitPreview(offset, true),
          );
        },
      );
    }
  }

  /**
   * Webviewルートの表示または操作を開始する。
   * @param offset - 見出しの開始位置を示すMarkdown本文内のUTF-16オフセット。
   * @param alignWithSource プレビュー位置をMarkdown本文の該当位置へ揃える場合はtrue。
   * @returns 副作用を完了し、値は返さない。
   */
  function revealOutlineInSplitPreview(
    offset: number,
    alignWithSource: boolean,
  ): void {
    const preview = splitPreviewRef.current;
    if (!preview) return;
    const sourcePane = preview
      .closest(".split-editor")
      ?.querySelector<HTMLElement>(".split-source-pane:not(.pane-hidden)");
    const sourceScroller =
      sourcePane?.querySelector<HTMLElement>(".cm-scroller");
    const activeLine = sourcePane?.querySelector<HTMLElement>(".cm-activeLine");
    const topOffset =
      alignWithSource && sourceScroller && activeLine
        ? activeLine.getBoundingClientRect().top -
          sourceScroller.getBoundingClientRect().top
        : 18;
    const anchor: PreviewViewportAnchor = { offset, topOffset };
    viewportStateRef.current.splitPreview = anchor;
    pendingPreviewViewportRestoreRef.current.splitPreview = undefined;
    pendingRenderedPreviewKindsRef.current.delete("splitPreview");
    pendingViewportRestoreRef.current = false;
    restorePreview(preview, anchor);
  }

  /**
   * Webviewルートのgo・to・diagnostic・lineを処理し、呼び出し側へ結果または副作用を返す。
   * @param line - 診断が示す1始まりのMarkdown行番号。
   * @returns 副作用を完了し、値は返さない。
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
   * 指定した選択範囲へエディターと表示ペインを移動する。
   * @param nextSelection 移動先として同期する選択範囲。
   * @returns 副作用を完了し、値は返さない。
   */
  function navigateToSelection(nextSelection: TextSelection): void {
    selectionStateRef.current = nextSelection;
    if (mode !== "split" || splitView === "preview") {
      pendingNavigationRef.current = nextSelection;
      changeSplitView("both");
      return;
    }
    sourceRef.current?.setSelection(nextSelection);
    sourceRef.current?.revealRange(nextSelection);
  }

  /**
   * Webviewルートの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param nextText - エディターとプレビューに反映する更新後のMarkdown本文。
   * @param knownChanges - 更新前後の本文から事前に計算した変更範囲。省略時はこの関数で計算する。
   * @param origin - 更新元。localはHostへ送信し、remoteはHostから受信した変更として扱う。
   * @param updateRenderedState - trueならReactのMarkdown表示状態も更新する。
   * @returns 副作用を完了し、値は返さない。
   */
  function updateMarkdown(
    nextText: string,
    knownChanges?: TextChange[],
    origin: "local" | "remote" = "local",
    updateRenderedState = true,
  ): void {
    const previous = localTextRef.current;
    if (previous === nextText) return;
    let changes = knownChanges ?? computeTextChanges(previous, nextText);
    if (isMveDebugEnabled()) {
      mveDebug("markdown.update", {
        origin,
        previousLength: previous.length,
        nextLength: nextText.length,
        changeCount: changes.length,
        changes: changes.slice(0, 8),
      });
    }
    if (origin === "local") {
      try {
        if (applyTextChanges(previous, changes) !== nextText) {
          throw new Error(
            "Local text changes do not produce the current editor value.",
          );
        }
      } catch (error) {
        // 差分の検証に失敗しても入力は止めない。エディタの確定全文から
        // 差分を再計算し、今回の入力を必ずホスト同期へ乗せる。
        console.error(
          "[Markdown Easy Visual Editor] ローカル差分を全文から再計算します。",
          error,
        );
        changes = computeTextChanges(previous, nextText);
      }
    }
    // 外部差分は非同期scroll通知より先に届くことがあるため、変更前DOMから
    // 現在位置を同期取得してからオフセット写像する。古いRAFアンカーを写像しない。
    if (origin === "remote") captureVisibleViewports();
    if (origin === "local") lastAutomaticRetryRef.current = undefined;
    mapStoredViewports(changes, previous.length);
    if (origin === "remote") {
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
        from: mapTextOffset(
          currentSelection.from,
          changes,
          previous.length,
          collapsed ? 1 : -1,
        ),
        to: mapTextOffset(currentSelection.to, changes, previous.length, 1),
      };
      selectionStateRef.current = mappedSelection;
    }
    localTextRef.current = nextText;
    if (updateRenderedState) {
      stagePreviewViewportRestore();
      setMarkdown(nextText);
    }
    if (origin === "local") sendNextLocalOperation();
  }

  updateMarkdownRef.current = updateMarkdown;

  /**
   * Webviewルートの変更または要求をHost・Webview間へ通知する。
   * @returns 副作用を完了し、値は返さない。
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
      changes,
    };
    inFlightOperationRef.current = current;
    if (isMveDebugEnabled()) {
      mveDebug("sync.local-sent", {
        opId: current.opId,
        baseVersion: current.baseVersion,
        pendingCount: 1,
        changeCount: current.changes.length,
        changes: current.changes.slice(0, 8),
      });
    }
    vscode.postMessage({
      type: "localChanges",
      clientId: clientIdRef.current,
      opId: current.opId,
      baseVersion: current.baseVersion,
      changes: current.changes,
    });
  }

  /**
   * Webviewルートのmap・stored・viewportsを処理し、呼び出し側へ結果または副作用を返す。
   * @param changes - 本文へ適用する変更範囲の一覧。
   * @param baseLength - changesを計算した変更前本文のUTF-16文字数。
   * @returns 副作用を完了し、値は返さない。
   */
  function mapStoredViewports(changes: TextChange[], baseLength: number): void {
    if (!changes.length) return;
    for (const key of ["source", "splitPreview", "previewOnly"] as const) {
      const anchor = viewportStateRef.current[key];
      if (!anchor) continue;
      anchor.offset = mapTextOffset(
        Math.min(anchor.offset, baseLength),
        changes,
        baseLength,
        -1,
      );
      if ("blockFrom" in anchor && anchor.blockFrom !== undefined) {
        anchor.blockFrom = mapTextOffset(
          Math.min(anchor.blockFrom, baseLength),
          changes,
          baseLength,
          -1,
        );
      }
      if ("endOffset" in anchor && anchor.endOffset !== undefined) {
        anchor.endOffset = mapTextOffset(
          Math.min(anchor.endOffset, baseLength),
          changes,
          baseLength,
          1,
        );
      }
    }
  }

  /**
   * Webviewルートのcapture・visible・viewportsを処理し、呼び出し側へ結果または副作用を返す。
   * @returns 副作用を完了し、値は返さない。
   */
  function captureVisibleViewports(): void {
    if (mode === "split" && splitView !== "preview") {
      viewportStateRef.current.source =
        sourceRef.current?.getViewport() ?? viewportStateRef.current.source;
    }
    if (mode === "split" && splitView !== "text" && splitPreviewRef.current) {
      viewportStateRef.current.splitPreview =
        capturePreviewViewport(splitPreviewRef.current) ??
        viewportStateRef.current.splitPreview;
    }
    if (mode === "preview" && editorAreaRef.current) {
      viewportStateRef.current.previewOnly =
        capturePreviewViewport(editorAreaRef.current) ??
        viewportStateRef.current.previewOnly;
    }
  }

  /**
   * Webviewルートの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @returns 副作用を完了し、値は返さない。
   */
  function restoreVisibleViewports(): void {
    const sourceAnchor =
      pendingSourceViewportRestoreRef.current ??
      viewportStateRef.current.source;
    if (skipNextSourceViewportRestoreRef.current) {
      skipNextSourceViewportRestoreRef.current = false;
    } else if (mode === "split" && splitView !== "preview" && sourceAnchor) {
      restoreSource(sourceAnchor);
    }
    if (mode === "split" && splitView !== "text" && splitPreviewRef.current) {
      restorePendingPreview("splitPreview", splitPreviewRef.current);
    }
    if (mode === "preview" && editorAreaRef.current) {
      restorePendingPreview("previewOnly", editorAreaRef.current);
    }
  }

  /**
   * Webviewルートのstage・preview・viewport・restoreを処理し、呼び出し側へ結果または副作用を返す。
   * @returns 副作用を完了し、値は返さない。
   */
  function stagePreviewViewportRestore(): void {
    pendingPreviewViewportRestoreRef.current = {
      splitPreview: viewportStateRef.current.splitPreview
        ? { ...viewportStateRef.current.splitPreview }
        : undefined,
      previewOnly: viewportStateRef.current.previewOnly
        ? { ...viewportStateRef.current.previewOnly }
        : undefined,
    };
    mveDebug(
      "preview.restore.staged",
      pendingPreviewViewportRestoreRef.current,
    );
  }

  /**
   * Webviewルートのstage・preview・refinement・viewport・restoreを処理し、呼び出し側へ結果または副作用を返す。
   * @returns 副作用を完了し、値は返さない。
   */
  function stagePreviewRefinementViewportRestore(): void {
    // scrollイベントのRAF通知より先に完全描画が返っても、古い保存アンカーで
    // ユーザーが移動した直後のプレビューを巻き戻さないよう実測値を先に読む。
    captureVisibleViewports();
    stagePreviewViewportRestore();
  }

  /**
   * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
   * @param anchor - 本文エディターから通知された可視位置アンカー。
   * @param userInitiated - ユーザー操作で始まったスクロールならtrue。
   * @returns 副作用を完了し、値は返さない。
   */
  function handleSourceViewport(
    anchor: EditorViewportAnchor,
    userInitiated: boolean,
  ): void {
    const pendingRestore = pendingSourceViewportRestoreRef.current;
    if (userInitiated) {
      pendingSourceViewportRestoreRef.current = undefined;
    } else if (pendingRestore) {
      const containsTarget =
        pendingRestore.offset >= anchor.offset &&
        pendingRestore.offset <= (anchor.endOffset ?? anchor.offset);
      if (
        containsTarget &&
        Math.abs(anchor.topOffset - pendingRestore.topOffset) <= 1
      ) {
        // 復元対象の論理オフセットと画面上位置を維持しつつ、可視終端と
        // スクロール比は復元後の実測値へ更新する。
        viewportStateRef.current.source = {
          ...anchor,
          offset: pendingRestore.offset,
          topOffset: pendingRestore.topOffset,
        };
        pendingSourceViewportRestoreRef.current = undefined;
        schedulePersistViewState();
      }
      return;
    }
    viewportStateRef.current.source = anchor;
    schedulePersistViewState();
    if (
      !scrollSyncEnabledRef.current ||
      !userInitiated ||
      sourceViewportIntentGenerationRef.current !==
        viewportUserIntentGenerationRef.current ||
      mode !== "split" ||
      splitView !== "both"
    )
      return;
    const preview = splitPreviewRef.current;
    if (!preview) return;
    const previewAnchor = {
      offset: anchor.offset,
      topOffset: anchor.topOffset,
      scrollRatio: anchor.scrollRatio,
    };
    viewportStateRef.current.splitPreview = previewAnchor;
    scheduleSourceToPreviewSync(previewAnchor);
  }

  /**
   * Webviewルートの変更または利用者の操作意図を記録し、後続処理へ渡す。
   * @param event - プレビューからの利用者起点scrollまたはkeyboard操作を識別するReact synthetic event。
   * @returns 副作用を完了し、値は返さない。
   */
  function markPreviewScrollIntent(
    event: React.SyntheticEvent<HTMLElement>,
  ): void {
    cancelPendingCrossPaneScrollSync();
    cancelPendingRenderedPreviewRestore();
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
    if (event.type === "pointerdown")
      previewPointerScrollActiveRef.current.add(container);
    if (event.type === "touchstart")
      previewTouchScrollActiveRef.current.add(container);
  }

  /**
   * 指定したプレビュー領域のスクロールを同期キューへ登録する。
   * @param kind - スクロール元となる分割プレビューまたはプレビュー単独表示。
   * @param container - スクロール位置を取得して同期するプレビュー要素。
   * @returns 副作用を完了し、値は返さない。
   */
  function handlePreviewScroll(
    kind: "splitPreview" | "previewOnly",
    container: HTMLElement,
  ): void {
    const startedAt = performance.now();
    const programmatic = programmaticPreviewScrollsRef.current.has(container);
    const explicitUserIntent =
      previewUserScrollPendingRef.current.has(container) ||
      previewPointerScrollActiveRef.current.has(container) ||
      previewTouchScrollActiveRef.current.has(container);
    if (
      !programmatic &&
      (explicitUserIntent || !pendingPreviewViewportRestoreRef.current[kind])
    ) {
      cancelPendingCrossPaneScrollSync();
      cancelPendingRenderedPreviewRestore();
      // wheel/pointer/touch開始後に段階描画が完了すると、描画側が新しい復元予約を
      // 作る場合がある。明示的なユーザー操作を常に優先し、その予約だけを破棄する。
      if (explicitUserIntent) {
        pendingPreviewViewportRestoreRef.current[kind] = undefined;
      }
      viewportUserIntentGenerationRef.current += 1;
      lastPreviewUserScrollAtRef.current = performance.now();
      const immediateAnchor = capturePreviewViewport(container);
      if (immediateAnchor) viewportStateRef.current[kind] = immediateAnchor;
    }
    const pending = pendingPreviewScrollsRef.current.get(container);
    pendingPreviewScrollsRef.current.set(container, {
      kind,
      userInitiated: (pending?.userInitiated ?? false) || !programmatic,
    });
    mveDebug("preview.scroll.queued", {
      kind,
      programmatic,
      pendingUserInitiated: (pending?.userInitiated ?? false) || !programmatic,
      scrollTop: container.scrollTop,
    });
    if (previewScrollFrameRef.current === undefined) {
      previewScrollFrameRef.current = window.requestAnimationFrame(
        /**
         * 次の描画フレームで表示更新を実行する。
         * @returns 副作用を完了し、値は返さない。
         */
        () => {
          previewScrollFrameRef.current = undefined;
          const scrolls = Array.from(
            pendingPreviewScrollsRef.current.entries(),
          );
          pendingPreviewScrollsRef.current.clear();
          scrolls.forEach(
            /**
             * キューから取り出した対象コンテナーへプレビューのスクロールを反映する。
             * @param pendingContainer - スクロールを反映するプレビュー要素。
             * @param next - 同期方向とユーザー操作由来かどうかを保持する保留中のスクロール情報。
             * @returns 副作用を完了し、値は返さない。
             */
            ([pendingContainer, next]) => {
              processPreviewScroll(
                next.kind,
                pendingContainer,
                next.userInitiated,
              );
            },
          );
        },
      );
    }
    performance.clearMeasures("mve-preview-scroll-handler");
    performance.measure("mve-preview-scroll-handler", {
      start: startedAt,
      end: performance.now(),
    });
  }

  /**
   * プレビューのスクロール位置を記録し、対応する別ペインへ反映する。
   * @param kind - スクロール元となる分割プレビューまたはプレビュー単独表示。
   * @param container - スクロール位置の反映先となるプレビュー要素。
   * @param userInitiated ユーザー操作由来のスクロールならtrue。プログラムによる復元はfalse。
   * @returns 副作用を完了し、値は返さない。
   */
  function processPreviewScroll(
    kind: "splitPreview" | "previewOnly",
    container: HTMLElement,
    userInitiated: boolean,
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
      mveDebug("preview.scroll.processed", {
        kind,
        userInitiated,
        anchor,
        scrollTop: container.scrollTop,
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
        !scrollSyncEnabledRef.current ||
        kind !== "splitPreview" ||
        mode !== "split" ||
        splitView !== "both"
      )
        return;
      viewportStateRef.current.source = {
        offset: anchor.offset,
        topOffset: anchor.topOffset,
        scrollRatio: anchor.scrollRatio,
      };
      schedulePreviewToSourceSync(viewportStateRef.current.source);
    } finally {
      performance.clearMeasures("mve-preview-scroll-sync");
      performance.measure("mve-preview-scroll-sync", {
        start: startedAt,
        end: performance.now(),
      });
    }
  }

  /**
   * Webviewルートの処理順序と完了状態を管理する。
   * @param anchor - プレビュー側で取得し、本文側へ同期する保留中の可視位置アンカー。
   * @returns 副作用を完了し、値は返さない。
   */
  function schedulePreviewToSourceSync(anchor: PreviewViewportAnchor): void {
    if (!scrollSyncEnabledRef.current) return;
    pendingPreviewToSourceAnchorRef.current = anchor;
    if (previewToSourceSyncTimerRef.current !== undefined) return;
    const delay = Math.max(
      0,
      CROSS_PANE_SCROLL_SYNC_MS -
        (performance.now() - lastPreviewToSourceSyncRef.current),
    );
    previewToSourceSyncTimerRef.current = window.setTimeout(
      /**
       * 指定時間の経過後に後続処理を実行する。
       * @returns 副作用を完了し、値は返さない。
       */
      () => {
        previewToSourceSyncTimerRef.current = undefined;
        lastPreviewToSourceSyncRef.current = performance.now();
        const pending = pendingPreviewToSourceAnchorRef.current;
        pendingPreviewToSourceAnchorRef.current = undefined;
        if (!scrollSyncEnabledRef.current || !pending) return;
        mveDebug("preview.scroll.sync-source", { pending });
        restoreSource(pending);
      },
      delay,
    );
  }

  /**
   * Webviewルートの処理順序と完了状態を管理する。
   * @param anchor - 本文エディター側で取得し、プレビューへ同期する保留中の可視位置アンカー。
   * @returns 副作用を完了し、値は返さない。
   */
  function scheduleSourceToPreviewSync(anchor: EditorViewportAnchor): void {
    if (!scrollSyncEnabledRef.current) return;
    pendingSourceToPreviewAnchorRef.current = anchor;
    if (sourceToPreviewSyncTimerRef.current !== undefined) return;
    const delay = Math.max(
      0,
      CROSS_PANE_SCROLL_SYNC_MS -
        (performance.now() - lastSourceToPreviewSyncRef.current),
    );
    sourceToPreviewSyncTimerRef.current = window.setTimeout(
      /**
       * 指定時間の経過後に後続処理を実行する。
       * @returns 副作用を完了し、値は返さない。
       */
      () => {
        sourceToPreviewSyncTimerRef.current = undefined;
        lastSourceToPreviewSyncRef.current = performance.now();
        const pending = pendingSourceToPreviewAnchorRef.current;
        pendingSourceToPreviewAnchorRef.current = undefined;
        const preview = splitPreviewRef.current;
        if (!scrollSyncEnabledRef.current || !pending || !preview) return;
        if (pending.scrollRatio !== undefined) {
          restorePreviewScrollRatio(preview, pending.scrollRatio);
        } else {
          restorePreview(preview, pending);
        }
      },
      delay,
    );
  }

  /**
   * Webviewルートの条件を判定する。
   * @returns 条件が成立したかを示す真偽値。
   */
  function cancelPendingCrossPaneScrollSync(): void {
    if (previewToSourceSyncTimerRef.current !== undefined) {
      window.clearTimeout(previewToSourceSyncTimerRef.current);
      previewToSourceSyncTimerRef.current = undefined;
    }
    if (sourceToPreviewSyncTimerRef.current !== undefined) {
      window.clearTimeout(sourceToPreviewSyncTimerRef.current);
      sourceToPreviewSyncTimerRef.current = undefined;
    }
    pendingPreviewToSourceAnchorRef.current = undefined;
    pendingSourceToPreviewAnchorRef.current = undefined;
  }

  /**
   * Webviewルートの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param nextSettings - Webviewルートへ渡す設定または境界値。
   * @returns 副作用を完了し、値は返さない。
   */
  function applyHostSettings(nextSettings: WebviewSettings): void {
    const enabled = nextSettings.scrollSyncEnabled !== false;
    scrollSyncEnabledRef.current = enabled;
    if (!enabled) cancelPendingCrossPaneScrollSync();
    if (nextSettings.outlineVisible !== undefined) {
      setOutlineVisible(nextSettings.outlineVisible);
    }
    const nextPdfOptions = normalizePdfOptions(
      nextSettings.pdfOptions ?? DEFAULT_PDF_OPTIONS,
    );
    const nextHtmlSettings = normalizeHtmlExportSettings(
      nextSettings.htmlOptions,
    );
    const pendingHtmlSettings = pendingHtmlOptionsRef.current;
    const effectiveHtmlSettings = pendingHtmlSettings ?? nextHtmlSettings;
    if (
      pendingHtmlSettings &&
      pendingHtmlSettings.embedImages === nextHtmlSettings.embedImages &&
      pendingHtmlSettings.convertLinkedMarkdown ===
        nextHtmlSettings.convertLinkedMarkdown &&
      pendingHtmlSettings.saveWithoutDialog ===
        nextHtmlSettings.saveWithoutDialog
    ) {
      pendingHtmlOptionsRef.current = undefined;
    }
    const effectiveHtmlOptions = mergeHtmlExportOptions(
      htmlOptionsRef.current,
      effectiveHtmlSettings,
    );
    htmlOptionsRef.current = effectiveHtmlOptions;
    setHtmlOptions(effectiveHtmlOptions);
    // 自分の入力を保存するまでの間に届いた古いsettingsChangedで、画面の最新値を戻さない。
    const hasPendingPdfOptions =
      pdfOptionsPersistTimerRef.current !== undefined;
    const effectivePdfOptions = hasPendingPdfOptions
      ? pdfOptionsRef.current
      : nextPdfOptions;
    if (!hasPendingPdfOptions) {
      pdfOptionsRef.current = nextPdfOptions;
      setPdfOptions(nextPdfOptions);
    }
    setSettings({
      ...nextSettings,
      htmlOptions: effectiveHtmlSettings,
      pdfOptions: effectivePdfOptions,
    });
  }

  /**
   * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
   * @param nextOptions - Webviewルートへ渡す設定または境界値。
   * @returns 副作用を完了し、値は返さない。
   */
  function handleHtmlOptionsChange(nextOptions: HtmlExportOptions): void {
    const nextSettings = normalizeHtmlExportSettings(nextOptions);
    const currentSettings = normalizeHtmlExportSettings(htmlOptionsRef.current);
    const nextHtmlOptions = mergeHtmlExportOptions(
      htmlOptionsRef.current,
      nextOptions,
    );
    htmlOptionsRef.current = nextHtmlOptions;
    setHtmlOptions(nextHtmlOptions);
    if (
      currentSettings.embedImages !== nextSettings.embedImages ||
      currentSettings.convertLinkedMarkdown !==
        nextSettings.convertLinkedMarkdown ||
      currentSettings.saveWithoutDialog !== nextSettings.saveWithoutDialog
    ) {
      pendingHtmlOptionsRef.current = nextSettings;
      vscode.postMessage({ type: "setHtmlOptions", options: nextSettings });
    }
  }

  /**
   * Webviewルートの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param anchor - 本文エディターへ復元する可視位置アンカー。
   * @returns 副作用を完了し、値は返さない。
   */
  function restoreSource(anchor: EditorViewportAnchor): void {
    if (anchor.scrollRatio !== undefined) {
      sourceRef.current?.restoreScrollRatio(anchor.scrollRatio);
    } else {
      sourceRef.current?.restoreViewport(anchor);
    }
  }

  /**
   * Webviewルートの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param container - 可視位置を復元するスクロール可能なプレビューコンテナー。
   * @param anchor - プレビューコンテナーへ復元する可視位置アンカー。
   * @returns 副作用を完了し、値は返さない。
   */
  function restorePreview(
    container: HTMLElement,
    anchor: PreviewViewportAnchor,
  ): void {
    programmaticPreviewScrollsRef.current.add(container);
    const before = container.scrollTop;
    // 先頭・末尾は本文ブロックの位置だけでは余白を表現できないため、
    // 描画完了・リサイズ・表示切替を含むすべての復元経路で境界比率を優先する。
    // ここで分岐しないと、同期で一度最下端へ到達しても遅延描画完了後の
    // アンカー復元によって最終ブロックの先頭側へ戻される。
    const restored =
      anchor.scrollRatio !== undefined
        ? restoreScrollRatio(container, anchor.scrollRatio)
        : restorePreviewViewport(container, anchor);
    mveDebug("preview.restore.result", {
      restored,
      before,
      after: container.scrollTop,
      anchor,
    });
  }

  /**
   * Webviewルートの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param container - 縦スクロール比率を復元するプレビューコンテナー。
   * @param ratio - プレビュー縦スクロール位置を表す0から1までの比率。
   * @returns 副作用を完了し、値は返さない。
   */
  function restorePreviewScrollRatio(
    container: HTMLElement,
    ratio: number,
  ): void {
    programmaticPreviewScrollsRef.current.add(container);
    restoreScrollRatio(container, ratio);
  }

  /**
   * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
   * @param kind - メッセージ、項目、または処理の種類を識別する値。
   * @returns 副作用を完了し、値は返さない。
   */
  function handlePreviewRendered(kind: "splitPreview" | "previewOnly"): void {
    if (
      settings.startupProbe &&
      initialized &&
      !startupReportedRef.current &&
      renderedPreviewMarkdown === localTextRef.current
    ) {
      startupReportedRef.current = true;
      vscode.postMessage({
        type: "startupReady",
        clientId: clientIdRef.current,
        markdownLength: renderedPreviewMarkdown.length,
        metrics: collectStartupMetrics(startupInitReceivedAtRef.current),
      });
    }
    pendingRenderedPreviewKindsRef.current.add(kind);
    scheduleRenderedPreviewRestore();
  }

  /**
   * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
   * @returns 副作用を完了し、値は返さない。
   */
  function handleStartupMermaidRendered(): void {
    if (!settings.startupProbe || startupMermaidReportedRef.current) return;
    startupMermaidReportedRef.current = true;
    vscode.postMessage({
      type: "startupMermaidReady",
      clientId: clientIdRef.current,
    });
  }

  /**
   * Webviewルートの処理順序と完了状態を管理する。
   * @returns 副作用を完了し、値は返さない。
   */
  function scheduleRenderedPreviewRestore(): void {
    if (
      renderedPreviewRestoreFrameRef.current !== undefined ||
      renderedPreviewRestoreTimerRef.current !== undefined
    )
      return;
    const delay = Math.max(
      0,
      100 - (performance.now() - lastPreviewUserScrollAtRef.current),
    );
    if (delay > 0) {
      renderedPreviewRestoreTimerRef.current = window.setTimeout(
        /**
         * 指定時間の経過後に後続処理を実行する。
         * @returns 副作用を完了し、値は返さない。
         */
        () => {
          renderedPreviewRestoreTimerRef.current = undefined;
          scheduleRenderedPreviewRestore();
        },
        delay,
      );
      return;
    }
    renderedPreviewRestoreFrameRef.current = window.requestAnimationFrame(
      /**
       * 次の描画フレームで表示更新を実行する。
       * @returns 副作用を完了し、値は返さない。
       */
      () => {
        renderedPreviewRestoreFrameRef.current = undefined;
        const kinds = Array.from(pendingRenderedPreviewKindsRef.current);
        pendingRenderedPreviewKindsRef.current.clear();
        kinds.forEach(
          /**
           * pending・kindごとにifを実行する。
           * @param pendingKind - 復元するプレビュー種別。分割表示かプレビュー単独表示を示す。
           * @returns 副作用を完了し、値は返さない。
           */
          (pendingKind) => {
            const container =
              pendingKind === "splitPreview"
                ? splitPreviewRef.current
                : editorAreaRef.current;
            if (
              container &&
              !pendingPreviewScrollsRef.current.get(container)?.userInitiated
            )
              restorePendingPreview(pendingKind, container);
          },
        );
      },
    );
  }

  /**
   * Webviewルートの条件を判定する。
   * @returns 条件が成立したかを示す真偽値。
   */
  function cancelPendingRenderedPreviewRestore(): void {
    if (renderedPreviewRestoreFrameRef.current !== undefined) {
      window.cancelAnimationFrame(renderedPreviewRestoreFrameRef.current);
      renderedPreviewRestoreFrameRef.current = undefined;
    }
    if (renderedPreviewRestoreTimerRef.current !== undefined) {
      window.clearTimeout(renderedPreviewRestoreTimerRef.current);
      renderedPreviewRestoreTimerRef.current = undefined;
    }
    pendingRenderedPreviewKindsRef.current.clear();
  }

  /**
   * Webviewルートの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param kind - 復元するプレビュー領域。splitPreviewまたはpreviewOnly。
   * @param container - 保留中の位置アンカーを適用するプレビューコンテナー。
   * @returns 副作用を完了し、値は返さない。
   */
  function restorePendingPreview(
    kind: "splitPreview" | "previewOnly",
    container: HTMLElement,
  ): void {
    const staged = pendingPreviewViewportRestoreRef.current[kind];
    const anchor = staged ?? viewportStateRef.current[kind];
    if (!anchor) return;
    mveDebug("preview.restore.applied", {
      kind,
      staged: Boolean(staged),
      anchor,
    });
    restorePreview(container, anchor);
    if (staged === pendingPreviewViewportRestoreRef.current[kind]) {
      pendingPreviewViewportRestoreRef.current[kind] = undefined;
    }
  }

  /**
   * Webviewルートの表示または操作を開始する。
   * @param event - 分割境界のpointer resizeを開始するpointer event。
   * @returns 副作用を完了し、値は返さない。
   */
  function beginSplitResize(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    captureVisibleViewports();
    pendingViewportRestoreRef.current = true;
    const container = event.currentTarget.parentElement;
    if (!container) return;

    const move = /**
     * Webviewルートの要素を規則に従って並べ替える。
     * @param moveEvent - Webviewルートへ届いたユーザー操作またはDOMイベント。
     * @returns 副作用を完了し、値は返さない。
     */ (moveEvent: PointerEvent) => {
      const bounds = container.getBoundingClientRect();
      if (bounds.width) {
        pendingViewportRestoreRef.current = true;
        setSplitRatio(
          clampSplitRatio((moveEvent.clientX - bounds.left) / bounds.width),
        );
      }
    };

    const end = /**
     * Webviewルートのendを処理し、呼び出し側へ結果または副作用を返す。
     * @returns 副作用を完了し、値は返さない。
     */ () => {
      window.removeEventListener("pointermove", move);
      document.body.classList.remove("mve-resizing-split");
      restoreVisibleViewports();
      pendingViewportRestoreRef.current = false;
      persistViewState();
    };
    document.body.classList.add("mve-resizing-split");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  }

  /**
   * UIイベントを受け取り、必要な処理を実行する。
   * @param event - ドラッグ中の目次項目の移動先を更新するpointer event。
   * @returns 副作用を完了し、値は返さない。
   */
  function updateOutlineDrag(
    event: React.PointerEvent<HTMLButtonElement>,
  ): void {
    const current = outlineDragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const distance = Math.hypot(
      event.clientX - current.startX,
      event.clientY - current.startY,
    );
    if (!current.dragging && distance < OUTLINE_DRAG_THRESHOLD_PX) return;

    if (!current.dragging) document.body.classList.add("mve-dragging-outline");
    const element = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLButtonElement>("button[data-outline-index]");
    const targetIndex = element
      ? Number(element.dataset.outlineIndex)
      : Number.NaN;
    let nextTargetIndex: number | undefined;
    let position: "before" | "after" | undefined;
    if (
      element &&
      Number.isInteger(targetIndex) &&
      canMoveOutlineSection(current.outline, current.sourceIndex, targetIndex)
    ) {
      nextTargetIndex = targetIndex;
      if (
        isOutlineEmptyParentTarget(
          current.outline,
          current.sourceIndex,
          targetIndex,
        )
      ) {
        position = "after";
      } else {
        const bounds = element.getBoundingClientRect();
        position =
          event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
      }
    }
    const next: OutlineDragState = {
      ...current,
      dragging: true,
      targetIndex: nextTargetIndex,
      position,
    };
    outlineDragRef.current = next;
    if (
      current.dragging !== next.dragging ||
      current.targetIndex !== next.targetIndex ||
      current.position !== next.position
    ) {
      setOutlineDrag(next);
    }
    event.preventDefault();
  }

  /**
   * Webviewルートのfinish・outline・dragを処理し、呼び出し側へ結果または副作用を返す。
   * @param event - 目次項目のdragを確定またはcancelするpointer event。
   * @param cancelled - キャンセル済みで後続処理を開始できない状態。
   * @returns 副作用を完了し、値は返さない。
   */
  function finishOutlineDrag(
    event: React.PointerEvent<HTMLButtonElement>,
    cancelled = false,
  ): void {
    const current = outlineDragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.dragging) event.preventDefault();
    skipOutlineContextMenuRef.current = true;
    if (
      !cancelled &&
      isEditingEnabled(mode, splitView) &&
      current.dragging &&
      current.targetIndex !== undefined &&
      current.position &&
      localTextRef.current === current.markdown
    ) {
      const nextText = moveOutlineSection(
        current.markdown,
        current.outline,
        current.sourceIndex,
        current.targetIndex,
        current.position,
      );
      if (nextText && nextText !== current.markdown) {
        prepareLayoutRestore();
        updateMarkdownRef.current(nextText);
      }
    }
    outlineDragRef.current = undefined;
    setOutlineDrag(undefined);
    document.body.classList.remove("mve-dragging-outline");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!cancelled && !current.dragging) {
      const item = current.outline[current.sourceIndex];
      if (item)
        setSectionLinkMenu({
          id: item.id,
          text: item.text,
          x: event.clientX,
          y: event.clientY,
        });
    }
  }

  /**
   * アウトライン項目の右ドラッグを開始する。
   * @param event - 指定した目次項目のdragを開始するpointer event。
   * @param sourceIndex ドラッグ元となるアウトライン項目の0始まりインデックス。
   * @returns 副作用を完了し、値は返さない。
   */
  function beginOutlineDrag(
    event: React.PointerEvent<HTMLButtonElement>,
    sourceIndex: number,
  ): void {
    if (event.button === 2) skipOutlineContextMenuRef.current = false;
    if (event.button !== 2 || !isEditingEnabled(mode, splitView)) return;
    // プレビューが遅延中の古いオフセットで本文を壊さないよう、最新描画済みのときだけ開始する。
    if (previewSnapshot.markdown !== markdown) return;
    const next: OutlineDragState = {
      sourceIndex,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      markdown,
      outline: [...outline],
      dragging: false,
    };
    outlineDragRef.current = next;
    setOutlineDrag(next);
    // 右ボタン押下ではブラウザが通常フォーカスを移さないため、ドラッグ後のUndo/RedoをWebviewへ届ける。
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  /**
   * 開閉三角形から始まった右ポインター操作を識別する。
   * @param event アプリ領域に届いたポインター押下イベント。
   * @returns 右ポインター操作の開始位置を記録する副作用。
   */
  function trackOutlineDisclosurePointer(
    event: React.PointerEvent<HTMLDivElement>,
  ): void {
    outlineDisclosureRightPointerRef.current =
      event.button === 2 &&
      event.target instanceof Element &&
      event.target.closest(".outline-disclosure") !== null;
  }

  /**
   * ソース面の右クリックでは選択範囲と本文指紋をHostへ送り、見出し上では見出しIDに対応するメニューを開く。
   * @param event - 右クリックされたソース面またはアウトライン要素のマウスイベント。
   */
  function handleSectionContextMenu(
    event: React.MouseEvent<HTMLDivElement>,
  ): void {
    if (!(event.target instanceof Element)) return;
    if (event.nativeEvent.button === 2 && outlineDisclosureRightPointerRef.current) {
      outlineDisclosureRightPointerRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.target.closest(".source-editor")) {
      const selection = sourceRef.current?.getSelection();
      vscode.postMessage({
        type: "copilotSelectionContext",
        selection:
          selection && selection.from !== selection.to ? selection : undefined,
        sourceFingerprint:
          selection && selection.from !== selection.to
            ? fingerprintText(localTextRef.current)
            : undefined,
      });
      return;
    }
    const outlineItem = event.target.closest<HTMLButtonElement>(
      ".outline-item[data-section-id]",
    );
    if (outlineItem) {
      event.preventDefault();
      if (
        outlineDragRef.current ||
        (skipOutlineContextMenuRef.current && event.nativeEvent.button === 2)
      ) {
        skipOutlineContextMenuRef.current = false;
        return;
      }
      const id = outlineItem.dataset.sectionId;
      if (id)
        setSectionLinkMenu({
          id,
          text: outlineItem.textContent?.trim() || id,
          x: event.clientX,
          y: event.clientY,
        });
      return;
    }
    const heading = event.target.closest<HTMLElement>(
      ".rendered-markdown h1[data-mve-heading], .rendered-markdown h2[data-mve-heading], .rendered-markdown h3[data-mve-heading], .rendered-markdown h4[data-mve-heading], .rendered-markdown h5[data-mve-heading], .rendered-markdown h6[data-mve-heading]",
    );
    if (!heading?.id) return;
    event.preventDefault();
    setSectionLinkMenu({
      id: heading.id,
      text: heading.textContent?.trim() || heading.id,
      x: event.clientX,
      y: event.clientY,
    });
  }

  /**
   * Webviewルートの表示または操作を開始する。
   * @param event - アウトラインpane幅のresizeを開始するpointer event。
   * @returns 副作用を完了し、値は返さない。
   */
  function beginOutlineResize(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    captureVisibleViewports();
    const workspace = event.currentTarget.parentElement;
    if (!workspace) return;

    const move = /**
     * Webviewルートの要素を規則に従って並べ替える。
     * @param moveEvent - Webviewルートへ届いたユーザー操作またはDOMイベント。
     * @returns Webviewルートのmoveが生成する結果。
     */ (moveEvent: PointerEvent) => {
      const bounds = workspace.getBoundingClientRect();
      setOutlineWidth(clampOutlineWidth(moveEvent.clientX - bounds.left));
    };

    const end = /**
     * Webviewルートのendを処理し、呼び出し側へ結果または副作用を返す。
     * @returns Webviewルートのendが生成する結果。
     */ () => {
      window.removeEventListener("pointermove", move);
      document.body.classList.remove("mve-resizing-outline");
      restoreVisibleViewports();
      pendingViewportRestoreRef.current = false;
      persistViewState();
    };
    document.body.classList.add("mve-resizing-outline");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  }

  const imageResizeEnabled = mode === "split" && splitView !== "text";
  const splitPreviewImageResize = useCallback(
    /**
     * image・indexをifへ渡し、Webviewルートの結果または副作用を処理する。
     * @param imageIndex - Markdown本文内でサイズを変更するプレビュー画像の0始まりインデックス。
     * @param width - 表示領域または列の幅。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    (imageIndex: number, width: number) => {
      if (imageResizeEnabled) resizePreviewImage(imageIndex, width);
    },
    [imageResizeEnabled, mode, splitView],
  );
  const splitPreviewImageReset = useCallback(
    /**
     * image・indexをifへ渡し、Webviewルートの結果または副作用を処理する。
     * @param imageIndex - Markdown本文内で元のサイズへ戻すプレビュー画像の0始まりインデックス。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    (imageIndex: number) => {
      if (imageResizeEnabled) resetPreviewImage(imageIndex);
    },
    [imageResizeEnabled, mode, splitView],
  );
  const splitPreviewImageAlign = useCallback(
    /**
     * image・indexをifへ渡し、Webviewルートの結果または副作用を処理する。
     * @param imageIndex - Markdown本文内で配置を変えるプレビュー画像の0始まりインデックス。
     * @param alignment - 画像を左・中央・右のどこへ配置するかを示す値。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    (imageIndex: number, alignment: ImageAlignment) => {
      if (imageResizeEnabled) alignPreviewImage(imageIndex, alignment);
    },
    [imageResizeEnabled, mode, splitView],
  );
  const splitPreviewInspect = useCallback(
    /**
     * targetをchange・inspectorへ渡し、Webviewルートの結果または副作用を処理する。
     * @param target - プレビューで選択されたMermaid図、数式、画像のInspector対象。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    (target: InspectorTarget) => changeInspector(target),
    [mode, splitView],
  );
  const splitPreviewNavigate = useCallback(
    /**
     * hrefをメッセージ送信へ渡し、Webviewルートの結果または副作用を処理する。
     * @param href - プレビュー内で開くMarkdownリンクのhref文字列。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    (href: string, workspaceRooted = false) =>
      vscode.postMessage({ type: "openResource", href, workspaceRooted }),
    [],
  );
  const splitPreviewRendered = useCallback(
    /**
     * 要素をhandle・preview・renderedへ渡し、Webviewルートの結果または副作用を処理する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => handlePreviewRendered("splitPreview"),
    [
      initialized,
      mode,
      renderedPreviewMarkdown,
      settings.startupProbe,
      splitView,
    ],
  );
  const sourceEditorChange = useCallback(
    /**
     * エディターの変更内容をローカル状態へ反映し、必要ならHostへ同期する。
     * @param beforeText - Webviewルートで扱う文字列または本文。
     * @param nextText - Webviewルートで扱う文字列または本文。
     * @param changes - 本文へ適用する変更範囲の一覧。
     * @param isCompositionCommit IME composition確定に伴う変更ならtrue。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    (
      beforeText: string,
      nextText: string,
      changes: TextChange[],
      isCompositionCommit = false,
    ) => {
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
            effectiveChanges = mapTextChanges(
              changes,
              bridgeChanges,
              beforeText.length,
              true,
            );
          } catch {
            effectiveChanges = mapChangesPreferLocal(
              changes,
              bridgeChanges,
              beforeText.length,
            );
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
          effectiveChanges = mapChangesPreferLocal(
            editorChanges,
            bridgeChanges,
            beforeText.length,
          );
          effectiveText = applyTextChanges(previous, effectiveChanges);
        } else {
          effectiveChanges = computeTextChanges(previous, nextText);
          effectiveText = applyTextChanges(previous, effectiveChanges);
        }
      }
      // IMEは確定までReactへ本文を渡さない。確定操作は即座に再描画値にも反映し、
      // 変換開始時の古いvalueがCodeMirrorへ書き戻される余地をなくす。
      updateMarkdownRef.current(
        effectiveText,
        effectiveChanges,
        "local",
        isCompositionCommit || beforeText !== previous,
      );
    },
    [],
  );
  const sourceEditorSettled = useCallback(
    /**
     * 要素をstage・preview・viewport・restoreへ渡し、Webviewルートの結果または副作用を処理する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => {
      stagePreviewViewportRestore();
      setMarkdown(localTextRef.current);
      delete document.body.dataset.mveInputActive;
      window.dispatchEvent(new Event("mve-preview-input-settled"));
    },
    [],
  );

  const sourceEditorSelectionChange = useCallback(
    /**
     * UIイベントを表示または編集状態へ反映する。
     * @param nextSelection CodeMirrorとプレビューへ反映する新しい選択範囲。
     * @returns 副作用を完了し、値は返さない。
     */
    (nextSelection: TextSelection) => {
      selectionStateRef.current = nextSelection;
      const source = markdownForSelectionRef.current;
      const nextMarks =
        nextSelection.from === nextSelection.to
          ? {}
          : inferMarks(source.slice(nextSelection.from, nextSelection.to));
      const previous = activeMarksRef.current;
      const previousKeys = Object.keys(previous);
      const nextKeys = Object.keys(nextMarks);
      if (
        previousKeys.length === nextKeys.length &&
        nextKeys.every(
          /**
           * Webviewルートのコールバックとしてkeyを処理する。
           * @param key - 選択範囲に適用中のMarkdown書式名。
           * @returns Webviewルートのコールバックが生成する結果。
           */
          (key) => previous[key] === nextMarks[key],
        )
      )
        return;
      activeMarksRef.current = nextMarks;
      setActiveMarks(nextMarks);
    },
    [],
  );
  const sourceEditorViewportChange = useCallback(
    /**
     * anchorをhandle・source・viewportへ渡し、Webviewルートの結果または副作用を処理する。
     * @param anchor - 本文エディターから通知された可視位置アンカー。
     * @param userInitiated - ユーザー操作で始まったスクロールならtrue。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    (anchor: EditorViewportAnchor, userInitiated: boolean) =>
      handleSourceViewport(anchor, userInitiated),
    [mode, splitView],
  );
  const sourceEditorUserScrollIntent = useCallback(
    /**
     * 要素をcancel・pending・cross・pane・scroll・syncへ渡し、Webviewルートの結果または副作用を処理する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => {
      cancelPendingCrossPaneScrollSync();
      cancelPendingRenderedPreviewRestore();
      viewportUserIntentGenerationRef.current += 1;
      sourceViewportIntentGenerationRef.current =
        viewportUserIntentGenerationRef.current;
      pendingSourceViewportRestoreRef.current = undefined;
      skipNextSourceViewportRestoreRef.current = false;
      pendingPreviewViewportRestoreRef.current = {};
      pendingViewportRestoreRef.current = false;
    },
    [],
  );

  if (!initialized)
    return <div className="startup">{messages.app.startup}</div>;

  const readOnly = !isEditingEnabled(mode, splitView);
  const splitColumns =
    splitView === "both"
      ? `minmax(0, ${splitRatio}fr) 8px minmax(0, ${1 - splitRatio}fr)`
      : "minmax(0, 1fr)";
  return (
    <div
      className={`app ${printPreview ? "print-preview-mode" : ""}`}
      onPointerDownCapture={trackOutlineDisclosurePointer}
      onContextMenu={handleSectionContextMenu}
    >
      <Ribbon
        messages={messages}
        mode={mode}
        readOnly={readOnly}
        activeMarks={activeMarks}
        outlineVisible={outlineVisible}
        scrollSyncEnabled={scrollSyncEnabled}
        splitView={splitView}
        htmlOptions={htmlOptions}
        pdfSaveWithoutDialog={pdfOptions.saveWithoutDialog}
        imageDirectory={settings.imageDirectory}
        editorFontFamily={settings.editorFontFamily}
        previewFontFamily={settings.previewFontFamily}
        onHtmlOptionsChange={handleHtmlOptionsChange}
        onPdfSaveWithoutDialogChange={
          /**
           * PDF保存ダイアログの設定変更を親状態へ反映し、残りのPDF設定を維持する。
           * @param enabled - 保存ダイアログを省略するかどうか。
           * @returns 設定更新を親状態へ反映する処理。
           */
          (enabled) =>
            updatePdfOptions((current) => ({
              ...current,
              saveWithoutDialog: enabled,
            }))
        }
        onCommand={handleRibbon}
      />
      <div className="workspace">
        {outlineVisible ? (
          <>
            <aside
              className="outline-panel"
              style={{ flexBasis: `${outlineWidth}px` }}
              aria-label={messages.app.outline}
            >
              <div className="outline-header">
                <h2>{messages.app.outline}</h2>
                <button
                  type="button"
                  className="panel-close-button"
                  title={messages.app.hideOutline}
                  aria-label={messages.app.hideOutline}
                  onClick={
                    /**
                     * click操作を表示または編集状態へ反映する。
                     * @returns 副作用を完了し、値は返さない。
                     */
                    () => {
                      prepareLayoutRestore();
                      setOutlineVisibility(false);
                    }
                  }
                >
                  ×
                </button>
              </div>
              {outline.length ? (
                <nav aria-label={messages.app.outline}>
                  <ul className="outline-tree">
                    {renderOutlineNodes(outlineTree)}
                  </ul>
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
              onKeyDown={
                /**
                 * keydown操作を表示または編集状態へ反映する。
                 * @param event - アウトライン幅を矢印キーで変更するkeydown event。
                 * @returns 副作用を完了し、値は返さない。
                 */
                (event) => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    setOutlineWidth(
                      /**
                       * 値をclamp・outline・widthへ渡し、Webviewルートの結果または副作用を処理する。
                       * @param value - キー操作前のアウトライン幅（px）。
                       * @returns Webviewルートのコールバックが生成する結果。
                       */
                      (value) =>
                        clampOutlineWidth(
                          value + (event.key === "ArrowLeft" ? -10 : 10),
                        ),
                    );
                  }
                }
              }
            />
          </>
        ) : (
          <button
            className="outline-reopen"
            type="button"
            title={messages.app.showOutline}
            aria-label={messages.app.showOutline}
            onClick={
              /**
               * click操作を表示または編集状態へ反映する。
               * @returns 副作用を完了し、値は返さない。
               */
              () => {
                prepareLayoutRestore();
                setOutlineVisibility(true);
              }
            }
          >
            ›
          </button>
        )}
        <main
          ref={editorAreaRef}
          className="editor-area"
          onMouseUp={
            /**
             * 要素をget・active・editorへ渡し、Webviewルートの結果または副作用を処理する。
             * @returns 副作用を完了し、値は返さない。
             */
            () => {
              selectionStateRef.current =
                getActiveEditor()?.getSelection() ?? selectionStateRef.current;
            }
          }
          tabIndex={mode === "preview" ? 0 : undefined}
          onWheelCapture={
            mode === "preview" ? markPreviewScrollIntent : undefined
          }
          onPointerDownCapture={
            mode === "preview" ? markPreviewScrollIntent : undefined
          }
          onTouchStartCapture={
            mode === "preview" ? markPreviewScrollIntent : undefined
          }
          onKeyDownCapture={
            mode === "preview" ? markPreviewScrollIntent : undefined
          }
          onScroll={
            mode === "preview"
              ? /**
                 * イベントをhandle・preview・scrollへ渡し、Webviewルートの結果または副作用を処理する。
                 * @param event - preview-only paneのscroll event。
                 * @returns 副作用を完了し、値は返さない。
                 */
                (event) =>
                  handlePreviewScroll("previewOnly", event.currentTarget)
              : undefined
          }
        >
          {searchVisible && (
            <section
              className="search-panel"
              aria-label={messages.app.searchAndReplace}
            >
              <input
                ref={searchInputRef}
                aria-label={messages.app.searchText}
                placeholder={messages.ribbon.search}
                value={searchQuery}
                onChange={
                  /**
                   * change操作を表示または編集状態へ反映する。
                   * @param event - 検索入力の更新を処理するchange event。
                   * @returns 副作用を完了し、値は返さない。
                   */
                  (event) => {
                    setSearchQuery(event.target.value);
                    setSearchIndex(0);
                  }
                }
                onKeyDown={
                  /**
                   * keydownイベントでifを実行する。
                   * @param event - Escapeで検索を閉じ、Enter系キーで一致箇所を移動するkeydown event。
                   * @returns 副作用を完了し、値は返さない。
                   */
                  (event) => {
                    if (event.key === "Escape") closeSearch();
                    if (event.key === "Enter")
                      jumpToSearch(event.shiftKey ? -1 : 1);
                  }
                }
              />
              <input
                aria-label={messages.app.replacementText}
                placeholder={messages.app.replacement}
                value={searchReplacement}
                onChange={
                  /**
                   * change操作を表示または編集状態へ反映する。
                   * @param event - 置換文字列入力の更新を処理するchange event。
                   * @returns 副作用を完了し、値は返さない。
                   */
                  (event) => setSearchReplacement(event.target.value)
                }
              />
              <span className="search-count">
                {searchHits.length
                  ? `${searchIndex + 1}/${searchHits.length}`
                  : "0/0"}
              </span>
              <button
                type="button"
                onClick={
                  /**
                   * clickイベントでjump・to・searchを実行する。
                   * @returns 副作用を完了し、値は返さない。
                   */
                  () => jumpToSearch(-1)
                }
                disabled={!searchHits.length}
                title={messages.app.previousMatch}
              >
                {messages.app.previousMatch}
              </button>
              <button
                type="button"
                onClick={
                  /**
                   * clickイベントでjump・to・searchを実行する。
                   * @returns 副作用を完了し、値は返さない。
                   */
                  () => jumpToSearch(1)
                }
                disabled={!searchHits.length}
                title={messages.app.nextMatch}
              >
                {messages.app.nextMatch}
              </button>
              <button
                type="button"
                onClick={
                  /**
                   * clickイベントでreplace・searchを実行する。
                   * @returns 副作用を完了し、値は返さない。
                   */
                  () => replaceSearch(false)
                }
                disabled={!searchQuery}
              >
                {messages.app.replacement}
              </button>
              <button
                type="button"
                onClick={
                  /**
                   * clickイベントでreplace・searchを実行する。
                   * @returns 副作用を完了し、値は返さない。
                   */
                  () => replaceSearch(true)
                }
                disabled={!searchQuery}
              >
                {messages.app.replaceAll}
              </button>
              <button
                type="button"
                title={messages.app.close}
                aria-label={messages.app.close}
                onClick={closeSearch}
              >
                ×
              </button>
            </section>
          )}
          {mode === "split" && (
            <div
              className={`split-editor ${splitView === "both" ? "" : "single-pane"}`}
              style={{ gridTemplateColumns: splitColumns }}
            >
              <div
                className={`split-source-pane ${splitView === "preview" ? "pane-hidden" : ""}`}
                style={{ fontSize: `${zoom}em` }}
              >
                <SourceEditor
                  ref={sourceRef}
                  value={markdown}
                  initialSelection={selectionStateRef.current}
                  searchHits={searchVisible ? searchHits : []}
                  activeSearchHit={
                    searchVisible ? searchHits[searchIndex] : undefined
                  }
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
                className={`split-divider ${splitView === "both" ? "" : "pane-hidden"}`}
                role="separator"
                aria-orientation="vertical"
                aria-label={messages.app.splitBoundary}
                aria-valuemin={20}
                aria-valuemax={80}
                aria-valuenow={Math.round(splitRatio * 100)}
                tabIndex={0}
                onPointerDown={beginSplitResize}
                onKeyDown={
                  /**
                   * keydown操作を表示または編集状態へ反映する。
                   * @param event - 分割pane比率を矢印キーで変更するkeydown event。
                   * @returns 副作用を完了し、値は返さない。
                   */
                  (event) => {
                    if (
                      event.key === "ArrowLeft" ||
                      event.key === "ArrowRight"
                    ) {
                      prepareLayoutRestore();
                      setSplitRatio(
                        /**
                         * 値をclamp・split・ratioへ渡し、Webviewルートの結果または副作用を処理する。
                         * @param value - キー操作前の左右ペイン分割比率。
                         * @returns Webviewルートのコールバックが生成する結果。
                         */
                        (value) =>
                          clampSplitRatio(
                            value + (event.key === "ArrowLeft" ? -0.02 : 0.02),
                          ),
                      );
                    }
                  }
                }
              />
              <div
                ref={splitPreviewRef}
                className={`split-preview ${splitView === "text" ? "pane-hidden" : ""}`}
                style={{ fontSize: `${zoom}em` }}
                tabIndex={splitView !== "text" ? 0 : undefined}
                onWheel={markPreviewScrollIntent}
                onPointerDown={markPreviewScrollIntent}
                onTouchStart={markPreviewScrollIntent}
                onKeyDown={markPreviewScrollIntent}
                onScroll={
                  /**
                   * イベントをhandle・preview・scrollへ渡し、Webviewルートの結果または副作用を処理する。
                   * @param event - split previewのscroll event。
                   * @returns Webviewルートのコールバックが生成する結果。
                   */
                  (event) =>
                    handlePreviewScroll("splitPreview", event.currentTarget)
                }
              >
                <RenderedMarkdown
                  markdown={renderedPreviewMarkdown}
                  html={previewHtml}
                  settings={settings}
                  imageZoom={zoom}
                  onImageResize={
                    imageResizeEnabled ? splitPreviewImageResize : undefined
                  }
                  onImageReset={
                    imageResizeEnabled ? splitPreviewImageReset : undefined
                  }
                  onImageAlign={
                    imageResizeEnabled ? splitPreviewImageAlign : undefined
                  }
                  onInspect={splitPreviewInspect}
                  onNavigate={splitPreviewNavigate}
                  onRendered={splitPreviewRendered}
                  onMermaidRendered={handleStartupMermaidRendered}
                  deferMermaid
                />
              </div>
            </div>
          )}
          {mode === "preview" && (
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
              onInspect={
                /**
                 * targetをchange・inspectorへ渡し、Webviewルートの結果または副作用を処理する。
                 * @param target - プレビューで選択されたMermaid図、数式、画像のInspector対象。
                 * @returns Webviewルートのコールバックが生成する結果。
                 */
                (target) => changeInspector(target)
              }
              onNavigate={
                /**
                 * hrefをメッセージ送信へ渡し、Webviewルートの結果または副作用を処理する。
                 * @param href - PDFプレビュー内で開くMarkdownリンクのhref文字列。
                 * @returns Webviewルートのコールバックが生成する結果。
                 */
                (href, workspaceRooted = false) =>
                  vscode.postMessage({
                    type: "openResource",
                    href,
                    workspaceRooted,
                  })
              }
              onZoom={adjustZoom}
              onRendered={
                /**
                 * 要素をhandle・preview・renderedへ渡し、Webviewルートの結果または副作用を処理する。
                 * @returns Webviewルートのコールバックが生成する結果。
                 */
                () => handlePreviewRendered("previewOnly")
              }
            />
          )}
        </main>
        {inspector && (
          <Inspector
            target={inspector}
            settings={settings}
            messages={messages}
            onChange={updateInspector}
            onClose={
              /**
               * UIイベントをHostまたはWebviewへ通知する。
               * @returns 副作用を完了し、値は返さない。
               */
              () => changeInspector(undefined)
            }
            onOpenResource={
              /**
               * hrefをメッセージ送信へ渡し、Webviewルートの結果または副作用を処理する。
               * @param href - Inspectorから開くMarkdownリソースのhref文字列。
               * @returns Webviewルートのコールバックが生成する結果。
               */
              (href) => vscode.postMessage({ type: "openResource", href })
            }
          />
        )}
        {diagnosticsVisible && (
          <aside className="diagnostics-panel">
            <div className="panel-title">
              <h2>{messages.app.diagnosticsTitle}</h2>
              <button
                type="button"
                className="panel-close-button"
                title={messages.app.close}
                aria-label={messages.app.close}
                onClick={
                  /** 診断一覧を閉じる前に、パネル幅の復元値を準備する。 */
                  () => {
                    prepareLayoutRestore();
                    setDiagnosticsVisible(false);
                  }
                }
              >
                ×
              </button>
            </div>
            <p className="diagnostic-summary">
              {messages.app.severity.error} {diagnosticSummary.errors.length} /{" "}
              {messages.app.severity.warning}{" "}
              {diagnosticSummary.warnings.length} / {messages.app.severity.info}{" "}
              {diagnosticSummary.infos.length}
            </p>
            <p className="diagnostic-help">{messages.app.diagnosticHelp}</p>
            {diagnostics.length ? (
              diagnostics.map(
                /**
                 * 診断項目を種別と一覧内位置を用いたキーで表示する。
                 * @param item - 画面に詳細を表示する診断。
                 * @param index - 診断一覧内の項目位置。
                 * @returns 診断内容を表示するReact要素。
                 */
                (item, index) => (
                  <div
                    key={`${item.code}-${index}`}
                    className={`diagnostic ${item.severity}`}
                  >
                    <strong>{messages.app.severity[item.severity]}</strong>
                    {item.line ? (
                      <button
                        type="button"
                        className="diagnostic-location"
                        onClick={
                          /**
                           * click操作を表示または編集状態へ反映する。
                           * @returns 副作用を完了し、値は返さない。
                           */
                          () => goToDiagnosticLine(item.line as number)
                        }
                      >
                        {messages.app.line(item.line as number)}
                      </button>
                    ) : null}
                    <span>{item.message}</span>
                  </div>
                ),
              )
            ) : (
              <p>{messages.app.noProblems}</p>
            )}
          </aside>
        )}
        {printSettingsVisible && (
          <aside className="pdf-settings-panel">
            <div className="panel-title">
              <h2>{messages.app.printSettings}</h2>
              <button
                type="button"
                className="panel-close-button"
                title={messages.app.close}
                aria-label={messages.app.close}
                onClick={
                  /**
                   * click操作を表示または編集状態へ反映する。
                   * @returns 副作用を完了し、値は返さない。
                   */
                  () => {
                    flushPdfOptionsPersistence();
                    setPrintSettingsVisible(false);
                  }
                }
              >
                ×
              </button>
            </div>
            <p>{messages.app.printSettingsHelp}</p>
            <label>
              {messages.app.paper}
              <select
                value={pdfOptions.format}
                onChange={
                  /**
                   * changeイベントでupdate・pdf・optionsを実行する。
                   * @param event - PDF出力形式の選択を処理するchange event。
                   * @returns 副作用を完了し、値は返さない。
                   */
                  (event) =>
                    updatePdfOptions(
                      /**
                       * Webviewルートのコールバックとしてcurrentを処理する。
                       * @param current - 現在の正規化済みPDF設定。用紙サイズを変更し、他の設定を維持する基準値。
                       * @returns Webviewルートのコールバックが生成する結果。
                       */
                      (current) => ({
                        ...current,
                        format: event.target.value as PdfOptions["format"],
                      }),
                    )
                }
              >
                {PDF_PAPER_FORMATS.map(
                  /**
                   * pdf・paper・formatsの各要素を変換して一覧化する。
                   * @param format - 本文または出力を解釈する形式。
                   * @returns 入力要素から生成した変換結果の一覧。
                   */
                  (format) => (
                    <option key={format}>{format}</option>
                  ),
                )}
              </select>
            </label>
            <label>
              {messages.app.orientation}
              <select
                value={pdfOptions.orientation}
                onChange={
                  /**
                   * changeイベントでupdate・pdf・optionsを実行する。
                   * @param event - PDFページ方向の選択を処理するchange event。
                   * @returns 副作用を完了し、値は返さない。
                   */
                  (event) =>
                    updatePdfOptions(
                      /**
                       * Webviewルートのコールバックとしてcurrentを処理する。
                       * @param current - 現在の正規化済みPDF設定。用紙方向を変更し、他の設定を維持する基準値。
                       * @returns Webviewルートのコールバックが生成する結果。
                       */
                      (current) => ({
                        ...current,
                        orientation: event.target
                          .value as PdfOptions["orientation"],
                      }),
                    )
                }
              >
                <option value="portrait">{messages.app.portrait}</option>
                <option value="landscape">{messages.app.landscape}</option>
              </select>
            </label>
            <label>
              {messages.app.header}
              <input
                value={pdfOptions.header}
                onChange={
                  /**
                   * changeイベントでupdate・pdf・optionsを実行する。
                   * @param event - PDFヘッダー出力設定の変更を処理するchange event。
                   * @returns 副作用を完了し、値は返さない。
                   */
                  (event) =>
                    updatePdfOptions(
                      /**
                       * Webviewルートのコールバックとしてcurrentを処理する。
                       * @param current - 現在の正規化済みPDF設定。ヘッダー文字列を変更し、他の設定を維持する基準値。
                       * @returns Webviewルートのコールバックが生成する結果。
                       */
                      (current) => ({
                        ...current,
                        header: event.target.value,
                      }),
                    )
                }
              />
            </label>
            <label>
              {messages.app.footer}
              <input
                value={pdfOptions.footer}
                onChange={
                  /**
                   * changeイベントでupdate・pdf・optionsを実行する。
                   * @param event - PDFフッター出力設定の変更を処理するchange event。
                   * @returns 副作用を完了し、値は返さない。
                   */
                  (event) =>
                    updatePdfOptions(
                      /**
                       * Webviewルートのコールバックとしてcurrentを処理する。
                       * @param current - 現在の正規化済みPDF設定。フッター文字列を変更し、他の設定を維持する基準値。
                       * @returns Webviewルートのコールバックが生成する結果。
                       */
                      (current) => ({
                        ...current,
                        footer: event.target.value,
                      }),
                    )
                }
              />
            </label>
            <fieldset className="pdf-margin-fields">
              <legend>{messages.app.margins}</legend>
              {(["top", "right", "bottom", "left"] as const).map(
                /**
                 * 4方向のPDF余白入力欄を作る。
                 * @param side - 編集する余白の位置（top、right、bottom、left）。
                 * @returns 入力要素から生成した変換結果の一覧。
                 */
                (side) => (
                  <label key={side}>
                    {
                      (
                        {
                          top: messages.app.top,
                          right: messages.app.right,
                          bottom: messages.app.bottom,
                          left: messages.app.left,
                        } as const
                      )[side]
                    }
                    <input
                      key={`${side}-${pdfOptions.margins[side]}`}
                      type="number"
                      min={0}
                      max={50}
                      defaultValue={pdfOptions.margins[side]}
                      onBlur={
                        /**
                         * イベントをupdate・pdf・optionsへ渡し、Webviewルートの結果または副作用を処理する。
                         * @param event - PDF余白入力をblur時に確定するfocus event。
                         * @returns Webviewルートのコールバックが生成する結果。
                         */
                        (event) =>
                          updatePdfOptions(
                            /**
                             * currentをclamp・pdf・marginへ渡し、Webviewルートの結果または副作用を処理する。
                             * @param current - 現在の正規化済みPDF設定。指定した辺の余白を変更し、他の余白と設定を維持する基準値。
                             * @returns Webviewルートのコールバックが生成する結果。
                             */
                            (current) => ({
                              ...current,
                              margins: {
                                ...current.margins,
                                [side]: clampPdfMargin(
                                  event.currentTarget.value,
                                ),
                              },
                            }),
                          )
                      }
                    />
                  </label>
                ),
              )}
            </fieldset>
            <fieldset className="pdf-typography-fields">
              <legend>{messages.app.typography}</legend>
              {/* 数値欄は入力途中の値を保持し、フォーカス離脱時にだけ範囲正規化して確定する。 */}
              <label>
                {messages.app.bodyFontSize} (pt)
                <input
                  key={`body-${pdfOptions.bodyFontSize}`}
                  type="number"
                  min={6}
                  max={48}
                  step={0.5}
                  defaultValue={pdfOptions.bodyFontSize}
                  onBlur={
                    /**
                     * イベントをupdate・pdf・optionsへ渡し、Webviewルートの結果または副作用を処理する。
                     * @param event - PDF本文フォントサイズ入力をblur時に確定するfocus event。
                     * @returns Webviewルートのコールバックが生成する結果。
                     */
                    (event) =>
                      updatePdfOptions(
                        /**
                         * currentをnumberへ渡し、Webviewルートの結果または副作用を処理する。
                         * @param current - 現在の正規化済みPDF設定。本文文字サイズを変更し、他の設定を維持する基準値。
                         * @returns Webviewルートのコールバックが生成する結果。
                         */
                        (current) => ({
                          ...current,
                          bodyFontSize: Number(event.currentTarget.value),
                        }),
                      )
                  }
                />
              </label>
              <fieldset className="pdf-heading-fields">
                <legend>{messages.app.headingFontSizes} (pt)</legend>
                {(["h1", "h2", "h3", "h4", "h5", "h6"] as const).map(
                  /**
                   * h1からh6のPDF見出し文字サイズ入力欄を作る。
                   * @param heading - 編集する見出しレベル（h1〜h6）。
                   * @returns 見出しレベルと対応する文字サイズ入力欄。
                   */
                  (heading) => (
                    <label key={heading}>
                      {heading.toUpperCase()}
                      <input
                        key={`${heading}-${pdfOptions.headingFontSizes[heading]}`}
                        type="number"
                        min={6}
                        max={72}
                        step={0.5}
                        defaultValue={pdfOptions.headingFontSizes[heading]}
                        onBlur={
                          /**
                           * イベントをupdate・pdf・optionsへ渡し、Webviewルートの結果または副作用を処理する。
                           * @param event - PDF見出しレベル別フォントサイズ入力をblur時に確定するfocus event。
                           * @returns Webviewルートのコールバックが生成する結果。
                           */
                          (event) =>
                            updatePdfOptions(
                              /**
                               * currentをnumberへ渡し、Webviewルートの結果または副作用を処理する。
                               * @param current - 現在の正規化済みPDF設定。対象見出しの文字サイズを変更し、他の見出しと設定を維持する基準値。
                               * @returns Webviewルートのコールバックが生成する結果。
                               */
                              (current) => ({
                                ...current,
                                headingFontSizes: {
                                  ...current.headingFontSizes,
                                  [heading]: Number(event.currentTarget.value),
                                },
                              }),
                            )
                        }
                      />
                    </label>
                  ),
                )}
              </fieldset>
              <label>
                {messages.app.codeFontSize} (pt)
                <input
                  key={`code-${pdfOptions.codeFontSize}`}
                  type="number"
                  min={6}
                  max={36}
                  step={0.5}
                  defaultValue={pdfOptions.codeFontSize}
                  onBlur={
                    /**
                     * イベントをupdate・pdf・optionsへ渡し、Webviewルートの結果または副作用を処理する。
                     * @param event - PDFコードフォントサイズ入力をblur時に確定するfocus event。
                     * @returns Webviewルートのコールバックが生成する結果。
                     */
                    (event) =>
                      updatePdfOptions(
                        /**
                         * currentをnumberへ渡し、Webviewルートの結果または副作用を処理する。
                         * @param current - 現在の正規化済みPDF設定。コード文字サイズを変更し、他の設定を維持する基準値。
                         * @returns Webviewルートのコールバックが生成する結果。
                         */
                        (current) => ({
                          ...current,
                          codeFontSize: Number(event.currentTarget.value),
                        }),
                      )
                  }
                />
              </label>
              <label>
                {messages.app.lineHeight}
                <input
                  key={`line-height-${pdfOptions.lineHeight}`}
                  type="number"
                  min={0.8}
                  max={3}
                  step={0.05}
                  defaultValue={pdfOptions.lineHeight}
                  onBlur={
                    /**
                     * イベントをupdate・pdf・optionsへ渡し、Webviewルートの結果または副作用を処理する。
                     * @param event - PDF行間設定入力をblur時に確定するfocus event。
                     * @returns Webviewルートのコールバックが生成する結果。
                     */
                    (event) =>
                      updatePdfOptions(
                        /**
                         * currentをnumberへ渡し、Webviewルートの結果または副作用を処理する。
                         * @param current - 現在の正規化済みPDF設定。行高を変更し、他の設定を維持する基準値。
                         * @returns Webviewルートのコールバックが生成する結果。
                         */
                        (current) => ({
                          ...current,
                          lineHeight: Number(event.currentTarget.value),
                        }),
                      )
                  }
                />
              </label>
              <label>
                {messages.app.paragraphSpacing} (pt)
                <input
                  key={`paragraph-spacing-${pdfOptions.paragraphSpacing}`}
                  type="number"
                  min={0}
                  max={48}
                  step={0.5}
                  defaultValue={pdfOptions.paragraphSpacing}
                  onBlur={
                    /**
                     * イベントをupdate・pdf・optionsへ渡し、Webviewルートの結果または副作用を処理する。
                     * @param event - PDF段落間隔入力をblur時に確定するfocus event。
                     * @returns Webviewルートのコールバックが生成する結果。
                     */
                    (event) =>
                      updatePdfOptions(
                        /**
                         * currentをnumberへ渡し、Webviewルートの結果または副作用を処理する。
                         * @param current - 現在の正規化済みPDF設定。段落間隔を変更し、他の設定を維持する基準値。
                         * @returns Webviewルートのコールバックが生成する結果。
                         */
                        (current) => ({
                          ...current,
                          paragraphSpacing: Number(event.currentTarget.value),
                        }),
                      )
                  }
                />
              </label>
            </fieldset>
            <fieldset className="pdf-replacement-fields">
              <legend>{messages.app.printReplacements}</legend>
              <p className="pdf-replacement-help">
                {messages.app.printReplacementsHelp}
              </p>
              {pdfOptions.textReplacements.map(
                (rule: PdfTextReplacementRule, index: number) => {
                  const validationError =
                    pdfReplacementResult.errors.find(
                      (error) => error.index === index,
                    )?.message;
                  return (
                    <div className="pdf-replacement-rule" key={index}>
                      <label>
                        {messages.app.regexPattern}
                        <input
                          value={rule.pattern}
                          spellCheck={false}
                          onChange={(event) =>
                            updatePdfOptions((current) => ({
                              ...current,
                              textReplacements: current.textReplacements.map(
                                (item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, pattern: event.target.value }
                                    : item,
                              ),
                            }))
                          }
                        />
                      </label>
                      <label className="pdf-replacement-flags">
                        {messages.app.regexFlags}
                        <input
                          value={rule.flags ?? ""}
                          spellCheck={false}
                          placeholder="imsu"
                          onChange={(event) =>
                            updatePdfOptions((current) => ({
                              ...current,
                              textReplacements: current.textReplacements.map(
                                (item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, flags: event.target.value }
                                    : item,
                              ),
                            }))
                          }
                        />
                      </label>
                      <label>
                        {messages.app.replacementText}
                        <input
                          value={rule.replacement}
                          onChange={(event) =>
                            updatePdfOptions((current) => ({
                              ...current,
                              textReplacements: current.textReplacements.map(
                                (item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        replacement: event.target.value,
                                      }
                                    : item,
                              ),
                            }))
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="pdf-replacement-remove"
                        onClick={() =>
                          updatePdfOptions((current) => ({
                            ...current,
                            textReplacements:
                              current.textReplacements.filter(
                                (_item, itemIndex) => itemIndex !== index,
                              ),
                          }))
                        }
                      >
                        {messages.app.removeReplacementRule}
                      </button>
                      {validationError ? (
                        <p className="pdf-replacement-error" role="alert">
                          {messages.app.invalidRegularExpression}:{" "}
                          {validationError}
                        </p>
                      ) : null}
                    </div>
                  );
                },
              )}
              <button
                type="button"
                className="pdf-replacement-add"
                onClick={() =>
                  updatePdfOptions((current) => ({
                    ...current,
                    textReplacements: [
                      ...current.textReplacements,
                      { pattern: "", replacement: "", flags: "" },
                    ],
                  }))
                }
              >
                {messages.app.addReplacementRule}
              </button>
            </fieldset>
            <button
              type="button"
              className="primary"
              disabled={pdfReplacementResult.errors.length > 0}
              onClick={
                /**
                 * clickイベントでrequest・pdf・exportを実行する。
                 * @returns 副作用を完了し、値は返さない。
                 */
                () => void requestPdfExport()
              }
            >
              {messages.ribbon.labels.exportPdf}
            </button>
          </aside>
        )}
      </div>
      <footer className="status-bar">
        <span>{modeLabel(mode, messages)}</span>
        <span>{messages.app.status.lines(stats.lines)}</span>
        <span>{messages.app.status.textCharacters(stats.text)}</span>
        <span>{messages.app.status.markdownCharacters(stats.markdown)}</span>
        <span>{messages.app.status.zoom(Math.round(zoom * 100))}</span>
        <span>
          {inFlightOperationRef.current ||
          localTextRef.current !== hostTextRef.current
            ? messages.app.status.syncing
            : messages.app.status.synced}
        </span>
      </footer>
      {exportStageRequested && (
        <div className="export-stage" aria-hidden="true">
          <RenderedMarkdown
            markdown={renderedPreviewMarkdown}
            html={previewHtml}
            settings={exportSettings}
            onRendered={handleExportRendered}
          />
        </div>
      )}
      {(printPreview || pdfExportStageRequested) &&
        pdfReplacementResult.errors.length === 0 && (
          <div className="export-stage" aria-hidden="true">
            <RenderedMarkdown
              markdown={activePdfExportMarkdown}
              settings={exportSettings}
              onRendered={(element) =>
                handlePdfExportRendered(element, activePdfExportMarkdown)
              }
            />
          </div>
        )}
      {htmlRenderRequest && (
        <HtmlDocumentRenderStage
          request={htmlRenderRequest}
          settings={exportSettings}
          onRendered={
            /**
             * documentsをメッセージ送信へ渡し、Webviewルートの結果または副作用を処理する。
             * @param documents - 文書URIと開いている文書オブジェクトの対応表。
             * @returns Webviewルートのコールバックが生成する結果。
             */
            (documents) => {
              vscode.postMessage({
                type: "htmlDocumentsRendered",
                requestId: htmlRenderRequest.requestId,
                documents,
              });
              setHtmlRenderRequest(undefined);
            }
          }
        />
      )}
      {helpTopic && (
        <HelpDialog
          topic={helpTopic}
          messages={messages}
          onClose={
            /**
             * 要素をset・help・topicへ渡し、Webviewルートの結果または副作用を処理する。
             * @returns 副作用を完了し、値は返さない。
             */
            () => setHelpTopic(undefined)
          }
        />
      )}
      {linkDialogVisible && (
        <LinkDialog
          href={linkHref}
          label={linkLabel}
          messages={messages}
          onHrefChange={setLinkHref}
          onLabelChange={setLinkLabel}
          onApply={applyLinkDialog}
          onClose={
            /**
             * 要素をset・link・dialog・visibleへ渡し、Webviewルートの結果または副作用を処理する。
             * @returns Webviewルートのコールバックが生成する結果。
             */
            () => setLinkDialogVisible(false)
          }
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {sectionLinkMenu && (
        <div
          ref={sectionLinkMenuRef}
          className="section-link-context-menu"
          role="menu"
          aria-label={messages.app.sectionLinkMenu}
          style={{ left: sectionLinkMenu.x, top: sectionLinkMenu.y }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              vscode.postMessage({
                type: "copySectionLink",
                scope: "document",
                id: sectionLinkMenu.id,
                text: sectionLinkMenu.text,
              });
              setSectionLinkMenu(undefined);
            }}
          >
            {messages.app.copySectionLink}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              vscode.postMessage({
                type: "copySectionLink",
                scope: "workspace",
                id: sectionLinkMenu.id,
                text: sectionLinkMenu.text,
              });
              setSectionLinkMenu(undefined);
            }}
          >
            {messages.app.copyWorkspaceSectionLink}
          </button>
        </div>
      )}
    </div>
  );
}

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
function Inspector({
  target,
  settings,
  messages,
  onChange,
  onClose,
  onOpenResource,
}: {
  /**
   * Webviewルートのtargetに関する状態または設定。
   */
  target: InspectorTarget;

  /**
   * Webviewルートへ渡す設定または境界値。
   */
  settings: WebviewSettings;

  /**
   * Webview用の型付きローカライズ済みメッセージカタログ。
   */
  messages: Messages;
  /**
   * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
   * @param source - Inspectorで編集している画像・数式・図の参照元文字列。
   * @param alt - Inspectorで編集している画像の代替テキスト。画像以外では省略する。
   * @returns Webviewルートのon・changeが生成する結果。
   */
  onChange: (source: string, alt?: string) => void;
  /**
   * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
   * @returns Webviewルートのon・closeが生成する結果。
   */
  onClose: () => void;
  /**
   * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
   * @param href - Inspectorから開くMarkdownリソースのhref文字列。
   * @returns Webviewルートのon・open・resourceが生成する結果。
   */
  onOpenResource: (href: string) => void;
}): React.JSX.Element {
  const [source, setSource] = useState(target.source);
  const [alt, setAlt] = useState(target.type === "image" ? target.alt : "");
  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns Webviewルートのコールバックが生成する結果。
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
                 * @returns 副作用を完了し、値は返さない。
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
               * @returns 副作用を完了し、値は返さない。
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
               * @returns 副作用を完了し、値は返さない。
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
               * @returns 副作用を完了し、値は返さない。
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
               * @returns 副作用を完了し、値は返さない。
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

/**
 * Webviewルートのuse・markdown・preview・snapshotを処理し、呼び出し側へ結果または副作用を返す。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param remoteImagesEnabled - Webviewルートの条件を示すフラグ。
 * @param language - プレビュー内のコードブロックに適用する表示言語コード。
 * @param enabled - Webviewルートの条件を示すフラグ。
 * @param onBeforeRefinement - Worker描画の精緻化結果を反映する直前に、プレビュー位置などを退避する処理。
 * @returns Webviewルートのuse・markdown・preview・snapshotが生成する結果。
 */
function useMarkdownPreviewSnapshot(
  markdown: string,
  remoteImagesEnabled: boolean,
  language: WebviewSettings["language"],
  enabled: boolean,
  onBeforeRefinement: () => void,
): [MarkdownPreviewSnapshot, () => void] {
  const [snapshot, setSnapshot] = useState<MarkdownPreviewSnapshot>({
    markdown: "",
    html: "",
    outline: [],
    diagnostics: [],
    stats: { markdown: 0, text: 0, lines: 1 },
  });
  const workerRef = useRef<Worker | undefined>(undefined);
  const workerBusyRef = useRef(false);
  const cancelSanitizationRef = useRef<() => void>(
    /**
     * Webviewルートのコールバックとして要素を処理する。
     * @returns 副作用を完了し、値は返さない。
     */
    () => undefined,
  );
  const generationRef = useRef(0);
  const onBeforeRefinementRef = useRef(onBeforeRefinement);
  onBeforeRefinementRef.current = onBeforeRefinement;

  const cancelActiveRender = useCallback(
    /**
     * 要素をifへ渡し、Webviewルートの結果または副作用を処理する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => {
      generationRef.current += 1;
      if (workerBusyRef.current) {
        workerRef.current?.terminate();
        workerRef.current = undefined;
        workerBusyRef.current = false;
      }
      cancelSanitizationRef.current();
      cancelSanitizationRef.current =
        /**
         * Webviewルートのcurrentを処理し、呼び出し側へ結果または副作用を返す。
         * @returns 副作用を完了し、値は返さない。
         */
        () => undefined;
    },
    [],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => {
      cancelActiveRender();
      if (!enabled) return;
      const id = generationRef.current;
      const startedAt = performance.now();

      const applySynchronousFallback = /**
       * Webviewルートの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
       * @param error - 処理に失敗した理由または例外。
       * @returns 副作用を完了し、値は返さない。
       */ async (error: unknown) => {
        if (generationRef.current !== id) return;
        document.body.dataset.mveMarkdownWorkerStatus = "fallback";
        console.error(
          "[Markdown Easy Visual Editor] Markdown Workerを利用できないため同期描画へ切り替えます。",
          error,
        );
        const fallbackStartedAt = performance.now();
        let html: string;
        try {
          html = await renderMarkdownFallback(markdown, {
            remoteImagesEnabled,
            language,
          });
        } catch (fallbackError) {
          if (generationRef.current !== id) return;
          console.error(
            "[Markdown Easy Visual Editor] Markdown フォールバックを読み込めませんでした。",
            fallbackError,
          );
          html = `<pre>${escapeHtml(markdown)}</pre>`;
        }
        if (generationRef.current !== id) return;
        const rendered = document.createElement("template");
        rendered.innerHTML = html;
        const headingIds = new Map<number, string>();
        for (const heading of rendered.content.querySelectorAll<HTMLElement>(
          ".markdown-source-block > [data-mve-heading][id]",
        )) {
          const offset = Number(heading.parentElement?.dataset.sourceFrom);
          if (Number.isInteger(offset)) headingIds.set(offset, heading.id);
        }
        setSnapshot({
          markdown,
          html,
          outline: getOutline(markdown).flatMap((item) => {
            const id = headingIds.get(item.offset);
            return id ? [{ ...item, id }] : [];
          }),
          diagnostics: collectDiagnostics(markdown, language),
          stats: wordStats(markdown),
        });
        recordLatestPerformanceMeasure(
          "mve-preview-markdown",
          fallbackStartedAt,
        );
      };

      const startWorker = /**
       * Webviewルートの表示または操作を開始する。
       * @param rich - リッチMarkdown用Workerを選ぶ場合はtrue。
       * @param refinement - 完成HTMLの反映として描画する場合はtrue。初回の簡易描画はfalse。
       * @returns Webviewルートのstart・workerが生成する結果。
       */ async (rich = false, refinement = false) => {
        try {
          let worker = workerRef.current;
          if (!worker) {
            document.body.dataset.mveMarkdownWorkerStatus = "loading";
            worker = await acquireMarkdownWorker(rich);
            if (generationRef.current !== id) {
              worker.terminate();
              return;
            }
            workerRef.current = worker;
          }
          if (generationRef.current !== id) return;
          workerBusyRef.current = true;
          document.body.dataset.mveMarkdownWorkerStatus = "running";
          worker.onmessage =
            /**
             * Webviewルートのonmessageを処理し、呼び出し側へ結果または副作用を返す。
             * @param event - Markdown rendering workerから応答を受信するmessage event。
             * @returns Webviewルートのonmessageが生成する結果。
             */
            (event: MessageEvent<MarkdownWorkerResponse>) => {
              recordLatestPerformanceMark("mve-preview-worker-response");
              const response = event.data;
              if (
                response.id !== id ||
                generationRef.current !== id ||
                workerRef.current !== worker
              )
                return;
              workerBusyRef.current = false;
              if (
                response.error ||
                !response.unsafeBlocks ||
                response.markdown === undefined ||
                !response.outline ||
                !response.diagnostics ||
                !response.stats
              ) {
                void applySynchronousFallback(response.error);
                return;
              }
              const preliminary = response.preliminary === true;
              document.body.dataset.mveMarkdownWorkerStatus = preliminary
                ? "preliminary"
                : "ready";
              recordLatestPerformanceMeasure(
                "mve-preview-markdown-worker",
                startedAt,
              );
              if (preliminary && workerRef.current === worker) {
                worker.terminate();
                workerRef.current = undefined;
              }
              cancelSanitizationRef.current = sanitizeMarkdownBlocks(
                response.unsafeBlocks,

                /**
                 * Webviewルートのコールバックとして要素を処理する。
                 * @returns Webviewルートのコールバックが生成する結果。
                 */
                () => generationRef.current === id,

                /**
                 * htmlをrecord・latest・performance・markへ渡し、Webviewルートの結果または副作用を処理する。
                 * @param html - 表示または出力するHTML本文。
                 * @param maximumChunkDuration - 1回のHTMLサニタイズ処理にかかった最長チャンク時間（ミリ秒）。
                 * @returns Webviewルートのコールバックが生成する結果。
                 */
                (html, maximumChunkDuration) => {
                  recordLatestPerformanceMark("mve-preview-sanitize-complete");
                  cancelSanitizationRef.current =
                    /**
                     * Webviewルートのcurrentを処理し、呼び出し側へ結果または副作用を返す。
                     * @returns 副作用を完了し、値は返さない。
                     */
                    () => undefined;
                  recordPerformanceDuration(
                    "mve-preview-markdown",
                    maximumChunkDuration,
                  );
                  if (generationRef.current !== id) return;
                  if (refinement) onBeforeRefinementRef.current();
                  setSnapshot({
                    markdown: response.markdown as string,
                    html,
                    outline: response.outline as OutlineItem[],
                    diagnostics: response.diagnostics as Diagnostic[],
                    stats: response.stats as {
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
                    },
                  });
                  if (preliminary) void startWorker(true, true);
                },
              );
            };
          worker.onerror =
            /**
             * Webviewルートのonerrorを処理し、呼び出し側へ結果または副作用を返す。
             * @param event - Markdown rendering workerで処理失敗を受信するerror event。
             * @returns Webviewルートのonerrorが生成する結果。
             */
            (event) => {
              if (generationRef.current !== id || workerRef.current !== worker)
                return;
              workerBusyRef.current = false;
              worker.terminate();
              workerRef.current = undefined;
              void applySynchronousFallback(event.message);
            };
          worker.postMessage({
            id,
            markdown,
            options: { remoteImagesEnabled, language },
          });
        } catch (error) {
          void applySynchronousFallback(error);
        }
      };
      void startWorker();
      return cancelActiveRender;
    },
    [markdown, remoteImagesEnabled, language, enabled, cancelActiveRender],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns Webviewルートで利用する文字列。
     */
    () =>
      /**
       * 要素をterminateへ渡し、Webviewルートの結果または副作用を処理する。
       * @returns Webviewルートで利用する文字列。
       */
      () => {
        workerRef.current?.terminate();
        workerRef.current = undefined;
        workerBusyRef.current = false;
      },
    [],
  );

  return [snapshot, cancelActiveRender];
}

/**
 * Webviewルートの非同期処理を共有するPromise。
 */
const markdownWorkerBlobUrlPromises = new Map<string, Promise<string>>();
/**
 * Webviewルートで共有するデータ形状を表すインターフェース。
 */
interface PreloadedMarkdownWorker {
  /**
   * Webviewルートのworkerに関する状態または設定。
   */
  worker: Worker;

  /**
   * 処理に失敗した理由または例外。
   */
  error?: unknown;
  /**
   * Webviewルートのerror・listenerを処理し、呼び出し側へ結果または副作用を返す。
   * @param event - Markdown worker preload失敗のmessageまたはerrorを保持するErrorEvent。
   * @returns 戻り値はなく、worker preloadのerror情報をstateへ記録する。
   */
  errorListener: (event: ErrorEvent) => void;
}
/**
 * Webviewルートの非同期処理を共有するPromise。
 */
let preloadedMarkdownWorkerPromise:
  | Promise<PreloadedMarkdownWorker>
  | undefined;

/**
 * Webviewルートから必要な値またはリソースを取得する。
 * @param rich - リッチMarkdown用WorkerスクリプトのURLを解決する場合はtrue。
 * @returns Webviewルートで利用する文字列。
 */
function resolveMarkdownWorkerResourceUrl(rich = false): string {
  const configured = rich
    ? document.body.dataset.mveMarkdownRichWorkerUri
    : document.body.dataset.mveMarkdownWorkerUri;
  if (configured) return configured;
  const script = Array.from(document.scripts).find(
    /**
     * Webviewのバンドルスクリプトを探す。
     * @param candidate - 読み込まれたWebviewスクリプト要素。
     * @returns 条件に一致した最初の要素。未検出時はundefined。
     */
    (candidate) => /(?:^|\/)webview\.js(?:[?#]|$)/.test(candidate.src),
  );
  return new URL(
    rich ? "markdown-rich-worker.js" : "markdown-worker.js",
    script?.src || document.baseURI,
  ).toString();
}

/**
 * Webviewルートから必要な値またはリソースを取得する。
 * @param rich - リッチMarkdown用Workerスクリプトの起動URLを解決する場合はtrue。
 * @returns Webviewルートで利用する文字列。
 */
async function resolveMarkdownWorkerLaunchUrl(rich = false): Promise<string> {
  const resourceUrl = resolveMarkdownWorkerResourceUrl(rich);
  if (/^(?:blob:|data:)/i.test(resourceUrl)) return resourceUrl;
  let pending = markdownWorkerBlobUrlPromises.get(resourceUrl);
  pending ??= fetch(resourceUrl)
    .then(
      /**
       * responseをifへ渡し、Webviewルートの結果または副作用を処理する。
       * @param response - Markdown Worker取得要求のHTTP応答。成功状態を確認して本文Blobを読み取る。
       * @returns 副作用を完了し、値は返さない。
       */
      (response) => {
        if (!response.ok)
          throw new Error(
            `Markdown Workerの取得に失敗しました (${response.status})`,
          );
        return response.blob();
      },
    )
    .then(
      /**
       * blobをcreate・object・urlへ渡し、Webviewルートの結果または副作用を処理する。
       * @param blob - 取得したMarkdown Workerスクリプト本文のBlob。Worker起動用Object URLを作る元データ。
       * @returns 副作用を完了し、値は返さない。
       */
      (blob) => URL.createObjectURL(blob),
    )
    .catch(
      /**
       * errorを削除へ渡し、Webviewルートの結果または副作用を処理する。
       * @param error - 処理に失敗した理由または例外。
       * @returns 副作用を完了し、値は返さない。
       */
      (error) => {
        markdownWorkerBlobUrlPromises.delete(resourceUrl);
        throw error;
      },
    );
  markdownWorkerBlobUrlPromises.set(resourceUrl, pending);
  return pending;
}

/**
 * Webviewルートのpreload・markdown・workerを処理し、呼び出し側へ結果または副作用を返す。
 * @returns 副作用を完了し、値は返さない。
 */
export function preloadMarkdownWorker(): void {
  preloadedMarkdownWorkerPromise ??= resolveMarkdownWorkerLaunchUrl().then(
    /**
     * urlをworkerへ渡し、Webviewルートの結果または副作用を処理する。
     * @param url - Webviewルートで読み書きするリソースの場所。
     * @returns Webviewルートの非同期処理で得られる結果。
     */
    (url) => {
      const state = {} as PreloadedMarkdownWorker;
      const worker = new Worker(url);
      state.worker = worker;
      state.errorListener =
        /**
         * Webviewルートのerror・listenerを処理し、呼び出し側へ結果または副作用を返す。
         * @param event - preload中に発生したworker errorの詳細を記録するErrorEvent。
         * @returns Webviewルートの非同期処理で得られる結果。
         */
        (event: ErrorEvent) => {
          state.error =
            event.message || event.error || "Markdown Worker preload failed";
        };
      worker.addEventListener("error", state.errorListener);
      return state;
    },
  );
  void preloadedMarkdownWorkerPromise.catch(
    /**
     * Webviewルートのコールバックとして要素を処理する。
     * @returns Webviewルートの非同期処理で得られる結果。
     */
    () => undefined,
  );
}

/**
 * Webviewルートのacquire・markdown・workerを処理し、呼び出し側へ結果または副作用を返す。
 * @param rich - リッチMarkdown用Workerを取得する場合はtrue。
 * @returns Webviewルートの非同期処理で得られる結果。
 */
async function acquireMarkdownWorker(rich = false): Promise<Worker> {
  if (rich) return new Worker(await resolveMarkdownWorkerLaunchUrl(true));
  preloadMarkdownWorker();
  const pending =
    preloadedMarkdownWorkerPromise as Promise<PreloadedMarkdownWorker>;
  preloadedMarkdownWorkerPromise = undefined;
  const state = await pending;
  state.worker.removeEventListener("error", state.errorListener);
  if (state.error !== undefined) {
    state.worker.terminate();
    throw state.error;
  }

  return state.worker;
}

/**
 * 危険な要素を除いたMarkdownブロックを順に作る。
 * @param unsafeBlocks サニタイズして出力するMarkdownブロック一覧。
 * @param shouldContinue 次のチャンクの処理を続けるかを判定する関数。
 * @param onComplete サニタイズ済みHTMLと最長チャンク時間を受け取る完了処理。
 * @returns 残りのチャンク処理を中止する関数。
 */
function sanitizeMarkdownBlocks(
  unsafeBlocks: UnsafeMarkdownBlock[],
  shouldContinue: () => boolean,
  onComplete: (html: string, maximumChunkDuration: number) => void,
): () => void {
  if (!unsafeBlocks.length) {
    onComplete("", 0);
    /**
     * Webviewルートのreturnを処理し、呼び出し側へ結果または副作用を返す。
     * @returns 副作用を完了し、値は返さない。
     */
    return () => undefined;
  }
  const sanitized: string[] = [];
  let index = 0;
  let cancelled = false;
  let timer: number | undefined;
  let maximumChunkDuration = 0;
  let slowestBlock = { duration: 0, length: 0, prefix: "" };

  const close = /**
   * Webviewルートの処理またはリソースを終了し、後続利用可能な状態へ戻す。
   * @returns 副作用を完了し、値は返さない。
   */ () => {
    cancelled = true;
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
  };

  const runChunk = /**
   * Webviewルートの処理順序と完了状態を管理する。
   * @returns Webviewルートのrun・chunkが生成する結果。
   */ () => {
    timer = undefined;
    if (cancelled || !shouldContinue()) {
      close();
      return;
    }
    const startedAt = performance.now();
    do {
      const block = unsafeBlocks[index++];
      const blockStartedAt = performance.now();
      sanitized.push(
        block.requiresSanitization
          ? sanitizeRenderedMarkdown(block.html)
          : block.html,
      );
      const blockDuration = performance.now() - blockStartedAt;
      if (blockDuration > slowestBlock.duration) {
        slowestBlock = {
          duration: blockDuration,
          length: block.html.length,
          prefix: block.html.slice(0, 100),
        };
      }
    } while (index < unsafeBlocks.length && performance.now() - startedAt < 4);
    maximumChunkDuration = Math.max(
      maximumChunkDuration,
      performance.now() - startedAt,
    );
    if (index < unsafeBlocks.length) {
      timer = window.setTimeout(runChunk, 0);
      return;
    }
    close();
    performance.clearMarks("mve-preview-sanitize-slowest");
    performance.mark("mve-preview-sanitize-slowest", { detail: slowestBlock });
    (
      globalThis as typeof globalThis & {
        /**
         * Webviewルートの・mve・slowest・sanitize・blockに関する状態または設定。
         */
        __mveSlowestSanitizeBlock?: typeof slowestBlock;
      }
    ).__mveSlowestSanitizeBlock = slowestBlock;
    onComplete(sanitized.join(""), maximumChunkDuration);
  };
  timer = window.setTimeout(runChunk, 0);
  return close;
}

/**
 * Webviewルートのrecord・latest・performance・measureを処理し、呼び出し側へ結果または副作用を返す。
 * @param name - 計測するPerformance Measureの名前。
 * @param startedAt - 計測開始時のperformance.now()値。
 * @returns 副作用を完了し、値は返さない。
 */
function recordLatestPerformanceMeasure(name: string, startedAt: number): void {
  performance.clearMeasures(name);
  performance.measure(name, { start: startedAt, end: performance.now() });
}

/**
 * Webviewルートのrecord・latest・performance・markを処理し、呼び出し側へ結果または副作用を返す。
 * @param name - 記録するPerformance Markの名前。
 * @returns 副作用を完了し、値は返さない。
 */
function recordLatestPerformanceMark(name: string): void {
  performance.clearMarks(name);
  performance.mark(name);
}

/**
 * Webviewルートのrecord・performance・durationを処理し、呼び出し側へ結果または副作用を返す。
 * @param name - 計測するPerformance Measureの名前。
 * @param duration - 処理にかかった時間（ミリ秒）。
 * @returns 副作用を完了し、値は返さない。
 */
function recordPerformanceDuration(name: string, duration: number): void {
  performance.clearMeasures(name);
  performance.measure(name, { start: 0, duration });
}

/**
 * Webviewルートから必要な値またはリソースを取得する。
 * @param initReceivedAt - 初期化メッセージ受信時のperformance.now()値。未計測ならundefined。
 * @returns Webviewルートで利用する文字列。
 */
function collectStartupMetrics(
  initReceivedAt: number | undefined,
): Record<string, number> {
  const metrics: Record<string, number> = {
    previewReportedAt: performance.now(),
  };
  const bundleExecutedAt = (
    globalThis as typeof globalThis & {
      /**
       * Webviewルートの・mve・bundle・executed・atを表す数値。
       */
      __mveBundleExecutedAt?: number;
    }
  ).__mveBundleExecutedAt;
  if (bundleExecutedAt !== undefined)
    metrics.bundleExecutedAt = bundleExecutedAt;
  if (initReceivedAt !== undefined) metrics.initReceivedAt = initReceivedAt;
  const workerResponse = performance
    .getEntriesByName("mve-preview-worker-response", "mark")
    .at(-1);
  if (workerResponse) metrics.workerResponseAt = workerResponse.startTime;
  for (const [name, key] of [
    ["mve-preview-markdown-worker", "markdownWorkerDuration"],
    ["mve-preview-markdown", "sanitizeChunkDuration"],
    ["mve-preview-dom-reconcile", "domReconcileDuration"],
  ] as const) {
    const entry = performance.getEntriesByName(name, "measure").at(-1);
    if (entry) metrics[key] = entry.duration;
  }
  for (const entry of performance.getEntriesByType("resource")) {
    if (entry.name.includes("markdown-worker.js")) {
      metrics.markdownWorkerFetchStartedAt = entry.startTime;
      metrics.markdownWorkerFetchDuration = entry.duration;
    } else if (entry.name.includes("webview.js")) {
      metrics.webviewFetchStartedAt = entry.startTime;
      metrics.webviewFetchDuration = entry.duration;
    }
  }
  return metrics;
}

/**
 * 値の更新を待ち時間後に反映し、必要なら保留中の反映を取り消せる状態を管理する。
 * @param value - 遅延反映する入力値。
 * @param delay - 確定値を反映するまで待つ時間（ミリ秒）。
 * @returns Webviewルートのuse・interruptible・debounced・valueが生成する結果。
 */
function useInterruptibleDebouncedValue<T>(
  value: T,
  delay: number,
): [T, () => void] {
  const [debounced, setDebounced] = useState(value);
  const initialValueRef = useRef(value);
  const firstNonInitialValueRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  const idleHandleRef = useRef<number | undefined>(undefined);
  const idleUsesTimeoutRef = useRef(false);
  const generationRef = useRef(0);

  const cancelPending = useCallback(
    /**
     * 要素をifへ渡し、Webviewルートの結果または副作用を処理する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => {
      generationRef.current += 1;
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
      if (idleHandleRef.current !== undefined) {
        const idleWindow = window as Window & {
          /**
           * Webviewルートの条件を判定する。
           * @param handle - requestIdleCallbackが返した、取り消すアイドルコールバックID。
           * @returns 戻り値はなく、指定したidle callbackを取り消す。
           */
          cancelIdleCallback?: (handle: number) => void;
        };
        if (idleUsesTimeoutRef.current || !idleWindow.cancelIdleCallback) {
          window.clearTimeout(idleHandleRef.current);
        } else {
          idleWindow.cancelIdleCallback(idleHandleRef.current);
        }
        idleHandleRef.current = undefined;
      }
    },
    [],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => {
      if (!firstNonInitialValueRef.current && value === initialValueRef.current)
        return;
      // 初回のホスト文書だけは起動時の表示を遅らせない。
      if (!firstNonInitialValueRef.current) {
        firstNonInitialValueRef.current = true;
        setDebounced(value);
        return;
      }
      cancelPending();
      const generation = generationRef.current;
      timerRef.current = window.setTimeout(
        /**
         * 指定時間の経過後に後続処理を実行する。
         * @returns 副作用を完了し、値は返さない。
         */
        () => {
          timerRef.current = undefined;

          const commit = /**
           * Webviewルートの変更または要求をHost・Webview間へ通知する。
           * @returns Webviewルートで利用する文字列。
           */ () => {
            idleHandleRef.current = undefined;
            if (generation !== generationRef.current) return;
            setDebounced(value);
          };
          const idleWindow = window as Window & {
            /**
             * アイドル時または上限時間の経過後にコールバックを実行するブラウザーAPI。
             * @param callback - 実行を予約するアイドル処理。
             * @param options - 強制実行までの最大待機時間を指定する設定。
             * @returns 予約した処理の識別番号。
             */
            requestIdleCallback?: (
              callback: () => void,
              options?: {
                /** アイドル処理を強制実行するまでの最大待機時間（ミリ秒）。 */
                timeout: number;
              },
            ) => number;
          };
          if (idleWindow.requestIdleCallback) {
            idleUsesTimeoutRef.current = false;
            idleHandleRef.current = idleWindow.requestIdleCallback(commit, {
              timeout: 750,
            });
          } else {
            idleUsesTimeoutRef.current = true;
            idleHandleRef.current = window.setTimeout(commit, 0);
          }
        },
        delay,
      );
      return cancelPending;
    },
    [value, delay, cancelPending],
  );

  return [debounced, cancelPending];
}

/**
 * Webviewルートを出力または保存できる文字列へ整える。
 * @param element - 出力対象HTMLを含む非表示レンダリング領域のルート要素。
 * @returns Webviewルートで利用する文字列。
 */
function serializeExportHtml(element: HTMLElement): string {
  return prepareExportHtml(element.innerHTML);
}

/**
 * Hostが指定したMarkdown文書を非表示領域でレンダリングし、HTML出力用データを返す。
 * @param request - HTML出力対象のMarkdown文書一覧を含むHost要求。
 * @param settings - 非表示レンダリングに使うWebview設定。
 * @param onRendered - 全文書のHTMLが揃った後、文書IDとHTMLの一覧を受け取る処理。
 * @returns HTML出力用レンダリング領域のReact要素。
 */
function HtmlDocumentRenderStage({
  request,
  settings,
  onRendered,
}: {
  /**
   * Webviewルートのrequestに関する状態または設定。
   */
  request: Extract<
    HostToWebviewMessage,
    {
      /**
       * Webviewルートで対象や分岐を識別する値の型。
       */
      type: "renderHtmlDocuments";
    }
  >;

  /**
   * Webviewルートへ渡す設定または境界値。
   */
  settings: WebviewSettings;
  /**
   * Webviewルートのon・renderedに関する状態または設定。
   */
  onRendered: (
    documents: Array<{
      /**
       * Webviewルートで扱うidの文字列。
       */
      id: string;
      /** 対象Markdown文書からレンダリングしたHTML本文。 */
      html: string;
    }>,
  ) => void;
}): React.JSX.Element {
  const renderedRef = useRef(new Map<string, string>());
  const completedRef = useRef(false);
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;

  /**
   * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
   * @param id - 描画完了を対応付けるMarkdown文書ID。
   * @param element - 出力用HTMLをシリアライズする、描画済み文書のDOM要素。
   * @returns 副作用を完了し、値は返さない。
   */
  function handleRendered(id: string, element: HTMLElement): void {
    if (completedRef.current) return;
    renderedRef.current.set(id, serializeExportHtml(element));
    if (renderedRef.current.size !== request.documents.length) return;
    completedRef.current = true;
    onRenderedRef.current(
      request.documents.map(
        /**
         * 各HTML出力文書のIDに対応するレンダリング済み本文をまとめる。
         * @param document - Hostから受け取ったHTML出力対象文書。
         * @returns 文書IDとサニタイズ済みHTML本文の組。
         */
        (document) => ({
          id: document.id,
          html: renderedRef.current.get(document.id) ?? "",
        }),
      ),
    );
  }

  return (
    <div className="export-stage html-document-render-stage" aria-hidden="true">
      {request.documents.map(
        /**
         * HTML出力対象文書ごとに非表示のMarkdownレンダラーを作る。
         * @param document - 描画するMarkdown本文とHost側の文書ID。
         * @returns その文書をレンダリングするReact要素。
         */
        (document) => (
          <RenderedMarkdown
            key={document.id}
            markdown={document.markdown}
            settings={settings}
            onRendered={
              /**
               * 要素をhandle・renderedへ渡し、Webviewルートの結果または副作用を処理する。
               * @param element - 出力用HTMLがレンダリングされた文書のルート要素。
               * @returns Webviewルートのコールバックが生成する結果。
               */
              (element) => handleRendered(document.id, element)
            }
          />
        ),
      )}
    </div>
  );
}

/**
 * MarkdownのPDFプレビュー、表示状態、操作コールバックを組み立てる。
 * @param markdown - PDFプレビューへ表示するMarkdown本文。
 * @param html - PDFプレビューで描画する変換済みHTML。
 * @param settings - プレビュー内のMarkdown描画へ渡すWebview設定。
 * @param options - PDFの用紙、余白、文字組版、ヘッダー、フッター設定。
 * @param zoom - PDFプレビューの表示倍率。
 * @param messages - PDFプレビューとツールバーに表示するローカライズ済み文言。
 * @param pdfBase64 - 描画するPDFデータのBase64文字列。生成前はundefined。
 * @param pdfLoading - PDFの生成または読み込み中かを示すフラグ。
 * @param pdfError - PDF生成に失敗した場合に表示するエラー文。
 * @param onInspect - PDFプレビューから選択された診断対象を親へ通知する処理。
 * @param onNavigate - PDF本文内で選択されたリンク先を親へ通知する処理。
 * @param onZoom - 表示倍率の増減値を親へ通知する処理。
 * @param onRendered - PDFキャンバスの描画完了を親へ通知する処理。
 * @returns 副作用を完了し、値は返さない。
 */
function PdfPreview({
  markdown,
  html,
  settings,
  options,
  zoom,
  messages,
  pdfBase64,
  pdfLoading,
  pdfError,
  onInspect,
  onNavigate,
  onZoom,
  onRendered,
}: {
  /**
   * 解析・編集・変換の対象となるMarkdown本文。
   */
  markdown: string;

  /**
   * 表示または出力するHTML本文。
   */
  html: string;

  /** PDFプレビュー内のMarkdown描画へ渡すWebview設定。 */
  settings: WebviewSettings;

  /** PDF本文・用紙・余白・文字組版・ヘッダー/フッターを正規化した設定。 */
  options: NormalizedPdfOptions;

  /**
   * プレビューに適用する表示倍率。
   */
  zoom: number;

  /**
   * Webview用の型付きローカライズ済みメッセージカタログ。
   */
  messages: Messages;

  /**
   * Webviewルートで扱うpdf・base64の文字列。
   */
  pdfBase64?: string;

  /**
   * Webviewルートのpdf・loadingを切り替えるフラグ。
   */
  pdfLoading: boolean;

  /**
   * Webviewルートで扱うpdf・errorの文字列。
   */
  pdfError?: string;
  /**
   * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
   * @param target - Inspectorで開く数式・画像などの対象。
   * @returns Webviewルートのon・inspectが生成する結果。
   */
  onInspect: (target: InspectorTarget) => void;
  /**
   * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
   * @param href - プレビュー内で開くリンクのhref文字列。
   * @returns Webviewルートのon・navigateが生成する結果。
   */
  onNavigate: (href: string, workspaceRooted?: boolean) => void;
  /**
   * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
   * @param delta - ズーム倍率の変更量。正数は拡大、負数は縮小。
   * @returns Webviewルートのon・zoomが生成する結果。
   */
  onZoom: (delta: number) => void;
  /**
   * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
   * @returns Webviewルートのon・renderedが生成する結果。
   */
  onRendered: () => void;
}): React.JSX.Element {
  const [pdfCanvasReady, setPdfCanvasReady] = useState(false);
  const dimensions = pdfPageDimensions(options);
  const showPdfLayer = Boolean(pdfBase64 && pdfCanvasReady);

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     * @returns Webviewルートのコールバックが生成する結果。
     */
    () => {
      setPdfCanvasReady(false);
    },
    [pdfBase64, zoom],
  );

  return (
    <div
      className={`pdf-preview-shell ${pdfBase64 ? "pdf-preview-shell-ready" : ""}`}
      data-pdf-format={options.format}
      data-pdf-orientation={options.orientation}
      data-pdf-zoom={zoom}
    >
      <div
        className="pdf-preview-toolbar"
        role="toolbar"
        aria-label={messages.app.status.zoom(Math.round(zoom * 100))}
      >
        <button
          type="button"
          aria-label={messages.app.pdfPreview.zoomOut}
          onClick={
            /**
             * clickイベントでmve・debugを実行する。
             * @returns 副作用を完了し、値は返さない。
             */
            () => {
              mveDebug("pdf.zoom-button", { delta: -0.1, zoom });
              onZoom(-0.1);
            }
          }
        >
          −
        </button>
        <span className="pdf-preview-zoom-value">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          aria-label={messages.app.pdfPreview.zoomIn}
          onClick={
            /**
             * clickイベントでmve・debugを実行する。
             * @returns 副作用を完了し、値は返さない。
             */
            () => {
              mveDebug("pdf.zoom-button", { delta: 0.1, zoom });
              onZoom(0.1);
            }
          }
        >
          ＋
        </button>
      </div>
      {!showPdfLayer && (
        <p className="pdf-preview-status" aria-live="polite">
          {pdfError
            ? messages.app.pdfPreview.unavailable
            : pdfLoading
              ? messages.app.pdfPreview.generating
              : pdfBase64
                ? messages.app.pdfPreview.drawing
                : messages.app.pdfPreview.preparing}
        </p>
      )}
      {!showPdfLayer && (
        <div className="pdf-preview-live-layer">
          <div
            className="pdf-preview-live-content"
            style={
              {
                zoom,
                fontFamily: options.fontFamily,
                fontSize: `${options.bodyFontSize}pt`,
                lineHeight: options.lineHeight,
                "--mve-pdf-h1-size": `${options.headingFontSizes.h1}pt`,
                "--mve-pdf-h2-size": `${options.headingFontSizes.h2}pt`,
                "--mve-pdf-h3-size": `${options.headingFontSizes.h3}pt`,
                "--mve-pdf-h4-size": `${options.headingFontSizes.h4}pt`,
                "--mve-pdf-h5-size": `${options.headingFontSizes.h5}pt`,
                "--mve-pdf-h6-size": `${options.headingFontSizes.h6}pt`,
                "--mve-pdf-code-size": `${options.codeFontSize}pt`,
                "--mve-pdf-paragraph-spacing": `${options.paragraphSpacing}pt`,
              } as React.CSSProperties
            }
          >
            {options.header && (
              <div className="pdf-preview-header">
                {formatPdfTemplate(options.header)}
              </div>
            )}
            <RenderedMarkdown
              markdown={markdown}
              html={html}
              settings={settings}
              className="pdf-preview-content"
              onInspect={onInspect}
              onNavigate={onNavigate}
              onRendered={
                /**
                 * 要素をon・renderedへ渡し、Webviewルートの結果または副作用を処理する。
                 * @returns Webviewルートのコールバックが生成する結果。
                 */
                () => onRendered()
              }
              deferMermaid
            />
            {options.footer && (
              <div className="pdf-preview-footer">
                {formatPdfTemplate(options.footer)}
              </div>
            )}
          </div>
        </div>
      )}
      {pdfBase64 && (
        <div
          className={`pdf-preview-pdf-layer ${showPdfLayer ? "" : "is-preparing"}`}
        >
          <PdfDocumentPreview
            data={pdfBase64}
            messages={messages.app.pdfPreview}
            pageRatio={dimensions.width / dimensions.height}
            zoom={zoom}
            onRendered={
              /**
               * 要素をmve・debugへ渡し、Webviewルートの結果または副作用を処理する。
               * @returns Webviewルートのコールバックが生成する結果。
               */
              () => {
                mveDebug("pdf.preview-layer-ready", {
                  zoom,
                  format: options.format,
                  orientation: options.orientation,
                });
                setPdfCanvasReady(true);
                onRendered();
              }
            }
          />
        </div>
      )}
      {pdfError && <p className="pdf-preview-error">{pdfError}</p>}
      <p className="pdf-preview-note">
        {options.format} ·{" "}
        {options.orientation === "portrait"
          ? messages.app.portrait
          : messages.app.landscape}{" "}
        / {messages.app.margins} {messages.app.top}
        {options.margins.top} · {messages.app.right}
        {options.margins.right} · {messages.app.bottom}
        {options.margins.bottom} · {messages.app.left}
        {options.margins.left} mm
      </p>
    </div>
  );
}

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
function LinkDialog({
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
   * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
   * @param value - リンク先URLの新しい入力値。
   * @returns 親コンポーネントへ新しいリンク先を通知する。
   */
  onHrefChange: (value: string) => void;
  /**
   * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
   * @param value - リンク表示テキストの新しい入力値。
   * @returns 親コンポーネントへ新しいリンク表示テキストを通知する。
   */
  onLabelChange: (value: string) => void;
  /**
   * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
   * @returns Webviewルートのon・applyが生成する結果。
   */
  onApply: () => void;
  /**
   * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
   * @returns Webviewルートのon・closeが生成する結果。
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
           * イベントをprevent・defaultへ渡し、Webviewルートの結果または副作用を処理する。
           * @param event - リンク設定を確定するform submit event。
           * @returns Webviewルートのコールバックが生成する結果。
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
               * changeイベントでon・href・changeを実行する。
               * @param event - リンク先URL入力の更新を処理するchange event。
               * @returns 副作用を完了し、値は返さない。
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
               * changeイベントでon・label・changeを実行する。
               * @param event - リンク表示文字列入力の更新を処理するchange event。
               * @returns 副作用を完了し、値は返さない。
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

/**
 * キーボード操作または機能説明を表示し、閉じる操作を呼び出し元へ通知するモーダル。
 * @param topic 表示する説明の種類。
 * @param messages ラベル・ショートカット・機能説明を表示するローカライズ辞書。
 * @param onClose ダイアログを閉じる処理。
 * @returns 選択された話題の説明と閉じる操作を含むダイアログ。
 */
function HelpDialog({
  topic,
  messages,
  onClose,
}: {
  /**
   * Webviewルートのtopicに関する状態または設定。
   */
  topic: HelpTopic;

  /**
   * Webview用の型付きローカライズ済みメッセージカタログ。
   */
  messages: Messages;
  /**
   * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
   * @returns Webviewルートのon・closeが生成する結果。
   */
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

/**
 * 画像ファイルをサイズ上限内で読み込み、必要ならBMPをPNGへ変換してペイロードを作る。
 * @param file 読み込む画像ファイル。
 * @param maxSizeMb アップロードを許可するファイルサイズ上限（MiB）。
 * @param messages ファイルエラーに表示する翻訳済みメッセージ。
 * @returns Webviewから送信できる画像データの非同期結果。
 * @throws Error ファイルがサイズ上限を超える場合、またはBMPのPNG変換に失敗した場合。
 */
async function fileToPayload(
  file: File,
  maxSizeMb: number,
  messages: Messages,
): Promise<ImagePayload> {
  if (file.size > maxSizeMb * 1024 * 1024)
    throw new Error(messages.app.errors.imageSize(maxSizeMb));
  if (file.type === "image/bmp") {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob>(
      /**
       * 非同期処理の成功結果と失敗理由を待機側へ通知する。
       * @param resolve - Promiseの成功を通知する関数。
       * @param reject - Promiseの失敗を通知する関数。
       * @returns 非同期処理の完了値。
       */
      (resolve, reject) =>
        canvas.toBlob(
          /**
           * 値を成功結果通知へ渡し、Webviewルートの結果または副作用を処理する。
           * @param value - canvasから受け取る画像変換結果。nullなら変換に失敗している。
           * @returns Webviewルートのコールバックが生成する結果。
           */
          (value) =>
            value
              ? resolve(value)
              : reject(new Error(messages.app.errors.bmpConversion)),
          "image/png",
        ),
    );
    return {
      name: file.name.replace(/\.bmp$/i, ".png"),
      mime: "image/png",
      base64: await blobBase64(blob),
    };
  }
  return {
    name: file.name,
    mime: file.type || "image/png",
    base64: await blobBase64(file),
  };
}

/**
 * Webviewルートの条件を判定する。
 * @param file - Webviewルートで読み書きするリソースの場所。
 * @returns 条件が成立したかを示す真偽値。
 */
function isImageFile(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    /\.(?:png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name)
  );
}

/**
 * Webviewルートのblob・base64を処理し、呼び出し側へ結果または副作用を返す。
 * @param blob - Base64へ変換する画像ファイルのBlob。
 * @returns Webviewルートで利用する文字列。
 */
async function blobBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

/**
 * Markdown本文から編集ツールバーに表示する書式状態を推定する。
 * @param value - Markdown装飾の有無を推定する本文。
 * @returns 太字、斜体、取消線、下線、ハイライト、コード、リンクの有無。
 */
function inferMarks(value: string): Record<string, boolean> {
  return {
    bold: /\*\*[^*]+\*\*/.test(value),
    italic: /(?:^|[^*])\*[^*]+\*/.test(value),
    strike: /~~.+~~/.test(value),
    underline: /\+\+.+\+\+/.test(value),
    highlight: /==.+==/.test(value),
    inlineCode: /`[^`]+`/.test(value),
    link: /\[[^\]]+]\([^)]+\)/.test(value),
  };
}

/**
 * 本文から指定した検索語の一致位置を抽出する。
 * @param value 検索対象となるMarkdown本文。
 * @param query 本文内で検索する語句。
 * @returns 本文内でqueryに一致した範囲の一覧。
 */
function findSearchHits(
  value: string,
  query: string,
): Array<{
  /**
   * Webviewルートのfromを表す数値。
   */
  from: number;
  /**
   * Webviewルートのtoを表す数値。
   */
  to: number;
}> {
  if (!query) return [];
  const hits: Array<{
    /**
     * Webviewルートのfromを表す数値。
     */
    from: number;
    /**
     * Webviewルートのtoを表す数値。
     */
    to: number;
  }> = [];
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
 * 左右ペインの分割比を表示可能な範囲へ制限する。
 * @param value - 左右ペイン分割比として要求された値。
 * @returns Webviewルートで利用する数値。
 */
function clampSplitRatio(value: number): number {
  return Math.max(0.2, Math.min(0.8, Number.isFinite(value) ? value : 0.5));
}

/**
 * Webviewルートのpdf・page・dimensionsを処理し、呼び出し側へ結果または副作用を返す。
 * @param options - 呼び出し側が指定する処理設定。
 * @returns Webviewルートのpdf・page・dimensionsが生成する結果。
 */
function pdfPageDimensions(options: NormalizedPdfOptions): {
  /**
   * 表示領域または列の幅。
   */
  width: number;

  /**
   * 表示領域または行の高さ。
   */
  height: number;
} {
  const dimensions: {
    /**
     * 表示領域または列の幅。
     */
    width: number;
    /**
     * 表示領域または行の高さ。
     */
    height: number;
  } = {
    A0: { width: 841, height: 1189 },
    A1: { width: 594, height: 841 },
    A2: { width: 420, height: 594 },
    A3: { width: 297, height: 420 },
    A4: { width: 210, height: 297 },
    A5: { width: 148, height: 210 },
    A6: { width: 105, height: 148 },
    B4: { width: 257, height: 364 },
    B5: { width: 182, height: 257 },
  }[options.format];
  return options.orientation === "landscape"
    ? { width: dimensions.height, height: dimensions.width }
    : dimensions;
}

/**
 * Webviewルートを出力または保存できる文字列へ整える。
 * @param value - {page}と{pages}を置換するPDFヘッダーまたはフッターのテンプレート。
 * @returns ページ番号プレースホルダーを1へ置き換えたテンプレート。
 */
function formatPdfTemplate(value: string): string {
  return value.replace(/\{page\}/g, "1").replace(/\{pages\}/g, "1");
}

/**
 * Webviewルートの寸法、容量、位置、または計測値を求める。
 * @param value - PDF余白欄に入力された文字列。
 * @returns Webviewルートで利用する数値。
 */
function clampPdfMargin(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(50, Math.round(parsed)))
    : 0;
}

/**
 * Webviewルートの寸法、容量、位置、または計測値を求める。
 * @param value - アウトライン幅として保存する数値（ピクセル）。
 * @returns Webviewルートで利用する数値。
 */
function clampOutlineWidth(value: number): number {
  return Math.max(
    160,
    Math.min(420, Number.isFinite(value) ? Math.round(value) : 220),
  );
}

/**
 * Webviewルートの寸法、容量、位置、または計測値を求める。
 * @param value - 現在の表示倍率。
 * @returns Webviewルートで利用する数値。
 */
function clampZoom(value: number): number {
  return Math.max(0.7, Math.min(1.6, Math.round(value * 10) / 10));
}

/**
 * Webviewルートのmap・changes・prefer・localを処理し、呼び出し側へ結果または副作用を返す。
 * @param changes - 本文へ適用する変更範囲の一覧。
 * @param over - 同じ変更前本文に対して計算した、競合を確認する他方の変更範囲。
 * @param baseLength - 変更範囲を計算した元本文のUTF-16文字数。
 * @returns Webviewルートに対応する要素の一覧。
 */
function mapChangesPreferLocal(
  changes: readonly TextChange[],
  over: readonly TextChange[],
  baseLength: number,
): TextChange[] {
  return [...changes]
    .sort(
      /**
       * 2つの値を比較して並び順を決める。
       * @param left - 比較対象の左側の値。
       * @param right - 比較対象の右側の値。
       * @returns 2つの要素の順序を示す数値。
       */
      (left, right) => left.rangeOffset - right.rangeOffset,
    )
    .map(
      /**
       * 各ローカル変更範囲の位置を他方の変更範囲に合わせて移動する。
       * @param change - 変更前本文に対して計算した、位置を移動するローカル変更。
       * @returns range・offsetを取り出した変換結果の一覧。
       */
      (change) => {
        const start = change.rangeOffset;
        if (change.rangeLength === 0) {
          return {
            ...change,
            rangeOffset: mapTextOffset(start, over, baseLength, 1),
          };
        }
        const mappedStart = mapTextOffset(start, over, baseLength, -1);
        const mappedEnd = mapTextOffset(
          start + change.rangeLength,
          over,
          baseLength,
          1,
        );
        return {
          ...change,
          rangeOffset: mappedStart,
          rangeLength: Math.max(0, mappedEnd - mappedStart),
        };
      },
    );
}

/**
 * Webviewルートの条件を判定する。
 * @param mode - 編集面とプレビューの表示構成。
 * @param splitView - 分割表示で見せるペイン。本文エディターを有効にするか判定する。
 * @returns 条件が成立したかを示す真偽値。
 */
function isEditingEnabled(
  mode: EditorMode,
  splitView: "both" | "text" | "preview",
): boolean {
  return mode !== "preview" && !(mode === "split" && splitView === "preview");
}

/**
 * 保存状態から読み取った候補を、対応する表示モードへ正規化する。
 * @param value - 永続化状態から読み取った表示モード候補。textまたはpreviewならその値を返し、それ以外はbothにする。
 * @returns Webviewルートのrestore・view・modeが生成する結果。
 */
function restoreViewMode(value: unknown): ViewMode {
  return value === "text" || value === "preview" ? value : "both";
}

/**
 * Webviewルートのmode・labelを処理し、呼び出し側へ結果または副作用を返す。
 * @param mode 編集面とプレビューの表示構成。
 * @param messages 表示用に選択された翻訳済みメッセージ。
 * @returns Webviewルートで利用する文字列。
 */
function modeLabel(mode: EditorMode, messages: Messages): string {
  return mode === "split"
    ? messages.app.status.modeSplit
    : messages.app.status.modePreview;
}

/**
 * Webviewルートの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param opening 置換対象ブロックの開始区切り。
 * @param closing 置換対象ブロックの終了区切り。
 * @param previous 置換対象として一致する既存ブロック本文。
 * @param next 区切りブロック内へ挿入する置換後の内容。
 * @returns Webviewルートで利用する文字列。
 */
function replaceDelimitedBlock(
  markdown: string,
  opening: string,
  closing: string,
  previous: string,
  next: string,
): string {
  const pattern = new RegExp(
    `(${escapeRegExp(opening)}[^\\r\\n]*(\\r\\n|\\r|\\n))([\\s\\S]*?)(\\r\\n|\\r|\\n)${escapeRegExp(closing)}`,
    "g",
  );
  const normalizedPrevious = previous.replace(/\r\n?|\n/g, "\n");
  return markdown.replace(
    pattern,

    /**
     * 区切りブロックの一致部分を調べ、内容が一致する場合に置換後の文字列を返す。
     * @param whole - 区切りブロック全体に一致した文字列。
     * @param prefix 一致した開始区切り行とその行末文字。
     * @param openingEol 開始区切り行の後にある改行文字。
     * @param body 一致した開始行と終了行の間にある既存内容。
     * @param closingEol 終了区切り行の前にある改行文字。
     * @returns Webviewルートで利用する文字列。
     */
    (
      whole,
      prefix: string,
      openingEol: string,
      body: string,
      closingEol: string,
    ) => {
      if (body.replace(/\r\n?|\n/g, "\n") !== normalizedPrevious) return whole;
      const replacement = next
        .replace(/\r\n?|\n/g, "\n")
        .replace(/\n/g, openingEol);
      return `${prefix}${replacement}${closingEol}${closing}`;
    },
  );
}

/**
 * 正規表現内で特別な意味を持つ文字をエスケープする。
 * @param value - 正規表現内で文字どおり照合する文字列。
 * @returns Webviewルートで利用する文字列。
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 印刷本文へ適用するフォントと基本レイアウトのCSSを作る。
 * @param fontFamily 印刷CSSへ設定するフォントファミリー。
 * @returns Webviewルートで利用する文字列。
 */
function printContentCss(fontFamily: string): string {
  const safeFontFamily = fontFamilyForCss(
    fontFamily,
    DEFAULT_PDF_OPTIONS.fontFamily,
  );
  return `
body{font-family:${safeFontFamily};color:#202124;line-height:1.75;font-size:11pt}
h1{font-size:24pt;border-bottom:2px solid #3a70b8;padding-bottom:6px}h2{font-size:18pt;border-bottom:1px solid #bbb;padding-bottom:4px}h3{font-size:14pt}
table{border-collapse:collapse;width:auto;max-width:100%;margin:1em 0}th,td{border:1px solid #888;padding:6px 8px;vertical-align:top;word-break:normal;overflow-wrap:anywhere}th{background:#eaf1fb}
table th[data-mve-nowrap="true"],table td[data-mve-nowrap="true"]{white-space:nowrap;overflow-wrap:normal}
pre{background:#f5f5f5;border:1px solid #ddd;border-radius:4px;padding:12px;overflow-wrap:anywhere;white-space:pre-wrap}
blockquote,.markdown-alert{border-left:4px solid #3a70b8;margin:1em 0;padding:8px 14px;background:#f4f7fb}
img,svg{max-width:100%;height:auto}.page-break{break-after:page}.code-figure figcaption button{display:none}.table-of-contents ul{list-style:none;padding-left:0}.toc-level-2{padding-left:1em}.toc-level-3{padding-left:2em}
`;
}

/**
 * 印刷文書で使うスタイルシート規則を集める。
 * @param fontFamily 印刷CSSへ設定するフォントファミリー。
 * @param includeEmbeddedFonts Webview内の@font-face規則も含める場合はtrue。
 * @returns Webviewルートで利用する文字列。
 */
function collectPrintableCss(
  fontFamily: string,
  includeEmbeddedFonts = true,
): string {
  const rules: string[] = [printContentCss(fontFamily)];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (!includeEmbeddedFonts && rule.type === CSSRule.FONT_FACE_RULE)
          continue;
        const css = rule.cssText;
        if (
          (includeEmbeddedFonts && css.startsWith("@font-face")) ||
          css.includes(".katex") ||
          css.includes(".hljs")
        ) {
          rules.push(css);
        }
      }
    } catch {
      // 読み取りが禁止されたスタイルシートは印刷本文の生成を妨げないよう除外する。
    }
  }
  return rules.join("\n");
}

/**
 * Webviewルートの非同期処理を共有するPromise。
 */
let exportFontCssPromise: Promise<string> | undefined;

/**
 * 印刷CSSからフォント関連の規則を収集し、キャッシュ済みのCSSを返す。
 * @param fontFamily 印刷CSSへ設定するフォントファミリー。
 * @returns Webviewルートで利用する文字列。
 */
async function collectEmbeddedPrintableCss(
  fontFamily: string,
): Promise<string> {
  exportFontCssPromise ??= fetch(
    webviewAssetUrl(
      "export-fonts.css",
      document.body.dataset.mveExportFontsUri,
    ),
  )
    .then(
      /**
       * responseをifへ渡し、Webviewルートの結果または副作用を処理する。
       * @param response - 埋め込みフォントCSS取得要求のHTTP応答。成功状態を確認してCSS本文を読み取る。
       * @returns Webviewルートのコールバックが生成する結果。
       */
      (response) => {
        if (!response.ok) {
          throw new Error(`Unable to load export fonts (${response.status})`);
        }
        return response.text();
      },
    )
    .catch(
      /**
       * Webviewルートのコールバックとしてerrorを処理する。
       * @param error - 処理に失敗した理由または例外。
       * @returns Webviewルートのコールバックが生成する結果。
       */
      (error) => {
        exportFontCssPromise = undefined;
        throw error;
      },
    );
  return `${collectPrintableCss(fontFamily, false)}\n${await exportFontCssPromise}`;
}

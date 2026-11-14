/**
 * @fileoverview Webviewのルートコンポーネントとして、編集状態、Hostメッセージ、プレビュー、設定、保存操作を統合する。
 */
import { errorMessage } from "../../shared/errorMessage";
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
  DEFAULT_DOCX_EXPORT_SETTINGS,
  DEFAULT_HTML_EXPORT_SETTINGS,
  DEFAULT_HTML_EXPORT_OPTIONS,
  DEFAULT_PDF_OPTIONS,
  DEFAULT_MERMAID_FONT_SIZE,
  normalizeMermaidFontSize,
  mergeHtmlExportOptions,
  normalizeDocxExportSettings,
  normalizeHtmlExportSettings,
  normalizePdfOptions,
  isTextReplacementPatternValid,
} from "../../shared/protocol";
import type {
  DocxExportSettings,
  EditorMode,
  HostToWebviewMessage,
  HtmlExportSettings,
  HtmlExportOptions,
  ImagePayload,
  NormalizedPdfOptions,
  PdfOptions,
  TextReplacementRule,
  ViewMode,
  WebviewSettings,
  WebviewToHostMessage,
} from "../../shared/protocol";
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
} from "../../shared/markdown";
import { drawioImageMarkdown } from "../../shared/drawioSvg";
import type { EditorLinkTarget } from "../editor/cmLinkNavigation";
import { markLocalResourceChanged } from "../preview/localResourceVersions";
import {
  applyTextChanges,
  computeTextChanges,
  mapTextChanges,
  mapTextOffset,
  type TextChange,
} from "../../shared/textChanges";
import { convertDocumentSyntax, type DocumentSyntax } from "../../shared/formatConversion";
import { fingerprintText } from "../../shared/canonicalText";
import {
  alignImageInMarkdown,
  resetImageSizeInMarkdown,
  resizeImageInMarkdown,
  resizeMarpImageInMarkdown,
  type ImageAlignment,
  type MarpImageResizeTarget,
} from "../../shared/imageResize";
import { getMessages } from "../../shared/messages";
import { hasMarpFrontMatterCandidate } from "../../shared/marpFrontMatter";
import {
  DEFAULT_FONT_FAMILY_STACK,
  DEFAULT_FONT_FAMILY_SETTINGS,
  fontFamilyForCss,
  normalizeFontFamily,
} from "../../shared/fontFamily";
import { createClientId } from "../runtime/id";
import { isMveDebugEnabled, mveDebug } from "../runtime/debug";
import { reuseIfStructurallyEqual } from "../runtime/structuralEqual";
// アウトライン抽出はKaTeX・textile-js・描画コアに依存しないモジュールから読み込み、Webview本体のバンドルを軽く保つ。
import type {
  MarkdownRenderFormat,
} from "../markdown/markdownRendererCore";
import {
  acceptMermaidRenderProgress,
  acceptMermaidRenderResult,
} from "../markdown/mermaidRenderer";
import { RenderedMarkdown, type InspectorTarget } from "./RenderedMarkdown";
import { MarpPreview } from "../marp/MarpPreview";
import type { MarpPreviewHandle } from "../marp/MarpPreview";
import type { MarpSlideSourceRange } from "../marp/marpRenderer";
import { Ribbon, type RibbonCommand } from "../ribbon/Ribbon";
import {
  SourceEditor,
  type EditorViewportAnchor,
  type TextEditorHandle,
} from "../editor/SourceEditor";
import {
  capturePreviewViewport,
  restoreScrollRatio,
  restorePreviewViewport,
  type PreviewViewportAnchor,
} from "../preview/scrollAnchors";
import {
  cancelAnimationFrameRef,
  clearTimeoutRef,
  clampOutlineWidth,
  clampSplitRatio,
  clampZoom,
  escapeRegExp,
  fileToPayload,
  findSearchHits,
  inferMarks,
  isEditingEnabled,
  isImageFile,
  mapChangesPreferLocal,
  modeLabel,
  replaceDelimitedBlock,
  restoreViewMode,
} from "./appHelpers";
import {
  useInterruptibleDebouncedValue,
} from "../runtime/useInterruptibleDebouncedValue";
import { createPreviewRenderSession, useMarkdownPreviewSnapshot } from "../markdown/markdownPreviewSnapshot";
import {
  comparePreviewBlocks,
  lineNumberAtOffset,
} from "../markdown/previewEquivalence";
import { convertPreservingPreview } from "../markdown/conversionWithFallback";
import {
  collectStartupMetrics,
  countVisibleMermaidNodes,
} from "../runtime/performanceMetrics";
import {
  TextReplacementCancelledError,
  TextReplacementTimeoutError,
  serializePdfExport,
} from "../export/outputSerialization";
import { collectPrintableCss } from "../export/printableCss";
import { PdfPreview } from "./PdfPreview";
import { Inspector } from "./Inspector";
import { HelpDialog, type HelpTopic } from "./HelpDialog";
import { LinkDialog } from "./LinkDialog";
import { OutlinePanel, buildOutlineTree } from "./OutlinePanel";
import { useOutlineReorder } from "./useOutlineReorder";
import { PrintSettingsPanel } from "./PrintSettingsPanel";
import { DiagnosticsPanel, SearchPanel, SectionLinkMenu, type SectionLinkMenuState } from "./AppPanels";
import {
  getRenderFormatForUri,
  readRenderFormatOverride,
  readWebviewBootstrap,
  vscode,
} from "../runtime/webviewState";
import { useLinkCompletionClient } from "../editor/linkCompletionClient";

/**
 * Webview内で開始し、拡張機能からの応答を待つ操作です。
 */
interface PendingLocalOperation {
  /**
   * Hostとの変更同期で同一操作を対応付けるID。
   */
  opId: string;

  /**
   * この変更を作成した時点でのHost文書バージョン。
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

/** 現在の見出し構成に対応する折りたたみ状態。 */
interface OutlineCollapseState {
  /** 開閉状態が有効な見出し構成の署名。 */
  signature: string;

  /** 折りたたまれている見出しID。 */
  collapsedIds: Set<string>;
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
   * ローカル画像参照検査に使う要求形式のバージョンです。
   */
  version: number;

  /**
   * 古い非同期検査結果を破棄するための要求世代番号です。
   */
  generation: number;

  /**
   * 画像参照の検査を起動した操作の種類。
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
   * PDF.jsへ渡すPDFデータのBase64表現。
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
  mermaidFontSize: DEFAULT_MERMAID_FONT_SIZE,
  viewMode: "both",
  outlineVisible: true,
  scrollSyncEnabled: true,
  pdfOptions: DEFAULT_PDF_OPTIONS,
  htmlOptions: DEFAULT_HTML_EXPORT_SETTINGS,
  docxOptions: DEFAULT_DOCX_EXPORT_SETTINGS,
  workspaceTrusted: false,
};

/**
 * Markdown preview再描画をまとめる遅延時間（ミリ秒）。
 */
const PREVIEW_UPDATE_DELAY_MS = 120;

/**
 * 文書変換の履歴として保持する最大件数。Undoで表示形式を戻すために、変換前後の本文の指紋（長さとハッシュ）を持つ。
 * 上限を超えた古い変換をUndoで戻した場合、表示形式は追従しない。
 */
const MAX_FORMAT_CONVERSION_HISTORY = 10;

/**
 * 変換の後に本文を編集したとき、拡張機能が保持する表示形式を最新の本文の指紋で保持し直すまでの待ち時間（ミリ秒）。
 * 入力のたびにワークスペースの状態へ書き込まないよう、編集が止まってから送る。
 */
const RENDER_FORMAT_FINGERPRINT_DELAY_MS = 1500;

/**
 * Webviewルートへ渡す設定または境界値。
 */
const PDF_OPTIONS_PERSIST_DELAY_MS = 250;

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
  const [outlineWidth, setOutlineWidth] = useState(() =>
    clampOutlineWidth(restored?.outlineWidth ?? 220),
  );
  const [splitRatio, setSplitRatio] = useState(() =>
    clampSplitRatio(restored?.splitRatio ?? 0.5),
  );
  const [zoom, setZoom] = useState(() => clampZoom(restored?.zoom ?? 1));
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [splitView, setSplitView] = useState<ViewMode>(
    restoreViewMode(
      restored?.viewMode ?? restored?.splitView ?? bootstrap?.settings.viewMode,
    ),
  );
  const [initialized, setInitialized] = useState(Boolean(bootstrap));
  const [markdown, setMarkdown] = useState(bootstrap?.text ?? "");
  const [renderFormat, setRenderFormat] = useState<MarkdownRenderFormat>(
    () =>
      // 変換タブで切り替えた表示形式は、同じ文書を再生成したWebviewでも引き継ぐ。
      readRenderFormatOverride(restored, bootstrap?.uri ?? "")?.format ??
      getRenderFormatForUri(bootstrap?.uri),
  );
  const isTextileDocument = renderFormat === "textile";
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
  const previewVisible =
    mode === "preview" || (mode === "split" && splitView !== "text");
  const hasMarpFrontMatterCandidateValue = useMemo(
    () =>
      renderFormat !== "textile" &&
      hasMarpFrontMatterCandidate(previewMarkdown),
    [previewMarkdown, renderFormat],
  );
  const [isMarpDetected, setIsMarpDetected] = useState(false);
  const [marpDetectionMarkdown, setMarpDetectionMarkdown] = useState<string>();
  const [marpDetectionPending, setMarpDetectionPending] = useState(false);
  const [marpDetectionFailedMarkdown, setMarpDetectionFailedMarkdown] =
    useState<string>();
  const marpDetectionResolvedForCurrentMarkdown =
    marpDetectionMarkdown === previewMarkdown;
  const marpDetectionFailed =
    hasMarpFrontMatterCandidateValue &&
    marpDetectionFailedMarkdown === previewMarkdown;
  const marpDetectionUnresolved =
    hasMarpFrontMatterCandidateValue &&
    (!marpDetectionResolvedForCurrentMarkdown || marpDetectionPending);
  const marpDetectionLoading = marpDetectionUnresolved;
  const isMarpDocument =
    hasMarpFrontMatterCandidateValue && !marpDetectionFailed && isMarpDetected;
  // 再判定中も確定済みのスライドを保持し、表示の取り外しによるスクロール位置の縮退を防ぐ。
  const marpPreviewMarkdown = marpDetectionMarkdown ?? previewMarkdown;
  const markdownSnapshotEnabled =
    initialized &&
    (!previewVisible || previewMarkdown === markdown) &&
    (!previewVisible ||
      !hasMarpFrontMatterCandidateValue ||
      (marpDetectionResolvedForCurrentMarkdown && !isMarpDetected)) &&
    !marpDetectionFailed;
  const [previewSnapshot, cancelActivePreviewRender] =
    useMarkdownPreviewSnapshot(
      previewMarkdown,
      settings.remoteImagesEnabled,
      settings.language,
      renderFormat,
      markdownSnapshotEnabled,
      stagePreviewRefinementViewportRestore,
    );
  const cancelPreviewWork = useCallback(() => {
    if (document.body.dataset.mveInputActive !== "true") {
      document.body.dataset.mveInputActive = "true";
      window.dispatchEvent(new Event("mve-preview-input-active"));
    }
    cancelPendingPreviewUpdate();
    cancelActivePreviewRender();
  }, [cancelPendingPreviewUpdate, cancelActivePreviewRender]);
  const renderedPreviewMarkdown = previewSnapshot.markdown;
  const marpDetectionRequestRef = useRef<
    { requestId: string; markdown: string } | undefined
  >(undefined);
  const previewMarkdownForMarpRef = useRef(previewMarkdown);
  previewMarkdownForMarpRef.current = previewMarkdown;
  const messages = useMemo(
    () => getMessages(settings.language),
    [settings.language],
  );
  useEffect(
    /**
     * front matter候補だけをHostで解析し、プレビュー用途がない間は判定要求を送らない。
     */
    () => {
      if (
        !initialized ||
        !previewVisible ||
        !hasMarpFrontMatterCandidateValue
      ) {
        marpDetectionRequestRef.current = undefined;
        setMarpDetectionPending(false);
        setIsMarpDetected(false);
        setMarpDetectionMarkdown(undefined);
        setMarpDetectionFailedMarkdown(undefined);
        return;
      }

      const request = {
        requestId: createClientId(),
        markdown: previewMarkdown,
      };
      marpDetectionRequestRef.current = request;
      setMarpDetectionFailedMarkdown(undefined);
      setMarpDetectionPending(true);
      vscode.postMessage({
        type: "detectMarpMarkdown",
        requestId: request.requestId,
        markdown: request.markdown,
      });
      return () => {
        if (marpDetectionRequestRef.current === request) {
          marpDetectionRequestRef.current = undefined;
        }
      };
    },
    [
      hasMarpFrontMatterCandidateValue,
      initialized,
      mode,
      previewMarkdown,
      splitView,
    ],
  );
  const reportMarpStartupStage = useCallback(
    (stage: string, detail?: string) => {
      if (!settings.startupProbe) return;
      vscode.postMessage({
        type: "startupMarpStage",
        clientId: clientIdRef.current,
        stage,
        detail,
      });
      if (
        stage === "preview-ready" &&
        initialized &&
        !startupReportedRef.current
      ) {
        startupReportedRef.current = true;
        vscode.postMessage({
          type: "startupReady",
          clientId: clientIdRef.current,
          markdownLength: previewMarkdownForMarpRef.current.length,
          metrics: collectStartupMetrics(startupInitReceivedAtRef.current),
        });
      }
    },
    [initialized, settings.startupProbe],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     */
    () => {
      if (settings.language) document.documentElement.lang = settings.language;
    },
    [settings.language],
  );
  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
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
     * HTML/PDF出力ではMermaidテーマを既定値に固定する。
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
  const printPreviewRef = useRef(printPreview);
  printPreviewRef.current = printPreview;
  const [printSettingsVisible, setPrintSettingsVisible] = useState(false);
  const [helpTopic, setHelpTopic] = useState<HelpTopic>();
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchReplacement, setSearchReplacement] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [linkDialogVisible, setLinkDialogVisible] = useState(false);
  const [linkHref, setLinkHref] = useState("https://example.com");
  const [linkLabel, setLinkLabel] = useState("");
  const [pdfOptions, setPdfOptions] = useState<NormalizedPdfOptions>(() =>
    normalizePdfOptions(bootstrap?.settings.pdfOptions ?? DEFAULT_PDF_OPTIONS),
  );
  /**
   * PDFの描画・保存処理が参照する最新の正規化済み出力設定。
   */
  const pdfOptionsRef = useRef(pdfOptions);
  /**
   * 変更したPDF設定をHostへまとめて送信するための遅延保存タイマーID。
   */
  const pdfOptionsPersistTimerRef = useRef<number | undefined>(undefined);
  const [htmlOptions, setHtmlOptions] = useState<HtmlExportOptions>(() => ({
    ...mergeHtmlExportOptions(
      DEFAULT_HTML_EXPORT_OPTIONS,
      bootstrap?.settings.htmlOptions ?? DEFAULT_HTML_EXPORT_SETTINGS,
    ),
  }));
  /**
   * HTML出力処理が参照する最新のHTML出力設定。
   */
  const htmlOptionsRef = useRef(htmlOptions);
  const pendingHtmlOptionsRef = useRef<HtmlExportSettings | undefined>(
    undefined,
  );
  htmlOptionsRef.current = htmlOptions;
  /**
   * リボンのDOCXグループに表示するDOCX出力設定。初期値はHostのbootstrap設定で、旧Host（未指定）では既定値。
   */
  const [docxOptions, setDocxOptions] = useState<DocxExportSettings>(() =>
    normalizeDocxExportSettings(bootstrap?.settings.docxOptions),
  );
  /**
   * DOCX出力処理と設定比較が参照する最新のDOCX出力設定。
   */
  const docxOptionsRef = useRef(docxOptions);
  /**
   * Hostへ保存を依頼し、まだ同じ値のsettingsChangedが届いていないDOCX設定。
   * 届くまでは古い通知で画面のチェック状態を戻さない。
   */
  const pendingDocxOptionsRef = useRef<DocxExportSettings | undefined>(
    undefined,
  );
  docxOptionsRef.current = docxOptions;
  const [pdfPreview, setPdfPreview] = useState<PdfPreviewState>({
    requestId: "",
    loading: false,
  });
  const [toast, setToast] = useState("");
  const [sectionLinkMenu, setSectionLinkMenu] = useState<SectionLinkMenuState>();
  const sectionLinkMenuRef = useRef<HTMLDivElement>(null);

  const clientIdRef = useRef(createClientId());
  // リンク先補完の要求と応答を対応付ける。アンマウント時に待機中の要求を打ち切る。
  const linkCompletionClient = useLinkCompletionClient(
    /**
     * Host へ補完要求を送る。
     * @param message - requestLinkCompletions メッセージ。
     */
    (message) => vscode.postMessage(message),
  );
  const sourceRef = useRef<TextEditorHandle>(null);
  const splitPreviewRef = useRef<HTMLDivElement>(null);
  const marpPreviewRef = useRef<MarpPreviewHandle>(null);
  const editorAreaRef = useRef<HTMLElement>(null);
  const exportRootRef = useRef<HTMLDivElement>(null);
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
      trustedEditorChanges?: boolean,
    ) => void
  >(() => undefined);
  const versionRef = useRef(bootstrap?.version ?? 0);
  const initializedRef = useRef(Boolean(bootstrap));
  const startupReportedRef = useRef(false);
  const startupMermaidReportedRef = useRef(false);
  const startupVisibleMermaidReportedRef = useRef(false);
  const startupRichReportedRef = useRef(false);
  const startupInitReceivedAtRef = useRef<number | undefined>(
    bootstrap
      ? (
          globalThis as typeof globalThis & {
            /**
             * 初期化スクリプトが実行された時刻のUNIXミリ秒。
             */
            __mveBundleExecutedAt?: number;
          }
        ).__mveBundleExecutedAt
      : undefined,
  );
  useEffect(
    /**
     * 起動計測専用。最初の最終描画（簡易描画ではないスナップショット）がコミットされた後に一度だけHostへ通知する。
     * useEffectはRenderedMarkdownのDOM照合（layout effect）より後に走るため、通知時点でDOM反映は完了している。
     */
    () => {
      if (
        !settings.startupProbe ||
        startupRichReportedRef.current ||
        previewSnapshot.preliminary !== false
      )
        return;
      startupRichReportedRef.current = true;
      vscode.postMessage({
        type: "startupRichReady",
        clientId: clientIdRef.current,
      });
    },
    [previewSnapshot, settings.startupProbe],
  );
  // ACK待ちは常に1件だけとし、その間の入力はlocalTextRefの最新値へ上書き集約する。
  const inFlightOperationRef = useRef<PendingLocalOperation | undefined>(
    undefined,
  );
  /** 出力前のACK待機を、同期イベントでのみ再評価する。 */
  const exportSyncWaitersRef = useRef(new Set<() => void>());
  const pendingHistoryCommandsRef = useRef<Array<"undo" | "redo">>([]);
  const selectionStateRef = useRef<TextSelection>({ from: 0, to: 0 });
  const imageRequestsRef = useRef(new Set<string>());
  const drawioRequestsRef = useRef(new Set<string>());
  const pdfRequestsRef = useRef(new Set<string>());
  const pdfExportInProgressRef = useRef(false);
  const htmlRequestsRef = useRef(new Set<string>());
  /** 応答待ちのDOCX出力要求ID。失敗通知の文言の選択と、応答待ち中の重複要求の抑止に使う。 */
  const docxRequestsRef = useRef(new Set<string>());
  /** 原文のACK待ちから要求送信までの間、DOCX出力の重複開始を抑止する。 */
  const docxExportInProgressRef = useRef(false);
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
     * 分割プレビュー側で後から復元する表示位置。
     */
    splitPreview?: PreviewViewportAnchor;

    /**
     * プレビュー単独表示側で後から復元する表示位置。
     */
    previewOnly?: PreviewViewportAnchor;
  }>({});
  const pendingNavigationRef = useRef<TextSelection | undefined>(undefined);
  const recentRibbonCommandsRef = useRef(new Map<string, number>());
  /** 現在Webviewが表示している文書のURI。表示形式の上書きを同じ文書に限定するために保持する。 */
  const documentUriRef = useRef(bootstrap?.uri ?? "");
  /**
   * 変換タブで切り替えた表示形式。拡張子由来の既定形式より優先し、Webview再生成後は
   * 同じURIの文書に限って復元する。undefinedなら拡張子由来の形式を使う。
   */
  const renderFormatOverrideRef = useRef(
    readRenderFormatOverride(restored, bootstrap?.uri ?? ""),
  );
  /** 変換の適用前検査（変換前後の描画比較）を実行中ならtrue。重複した変換操作を受け付けない。 */
  const formatConversionPendingRef = useRef(false);
  useEffect(
    /**
     * 変換の後に本文を編集した場合も、拡張機能が保持する表示形式を最新の本文の指紋で保持し直す（開き直したときに、
     * 本文が変換後の続きのものか確かめるため）。入力のたびに書き込まないよう、編集が止まってから送る。
     * @returns 待機中の送信を取り消す関数。
     */
    () => {
      const override = renderFormatOverrideRef.current;
      if (!override || override.uri !== documentUriRef.current) return undefined;
      const timer = window.setTimeout(
        /** 編集が止まった時点の本文の指紋で、表示形式を保持し直す。 */
        () => persistRenderFormatOverride(override.format, localTextRef.current),
        RENDER_FORMAT_FINGERPRINT_DELAY_MS,
      );
      return () => window.clearTimeout(timer);
    },
    [markdown],
  );
  /**
   * 文書変換の前後本文の指紋と表示形式の履歴（古い順）。Undo/Redoで本文がいずれかの変換の前（後）と一致したとき、
   * 表示形式も一緒に戻す（進める）ために使う。本文そのものは保持せず、指紋（{@link fingerprintText}）だけを持つ。
   * 連続して変換してもUndoを重ねた分だけ戻せるよう複数件を保持し、件数を制限する。
   */
  const formatConversionHistoryRef = useRef<
    Array<{
      /** 変換前の本文の指紋。 */
      before: string;
      /** 変換前の表示形式。 */
      beforeFormat: MarkdownRenderFormat;
      /** 変換後の本文の指紋。 */
      after: string;
      /** 変換後の表示形式。 */
      afterFormat: MarkdownRenderFormat;
    }>
  >([]);
  /**
   * 最新の描画状態で文書変換を始める関数。変換の検査中に本文が編集された場合、検査の終了後に最新の本文で変換し直すために使う。
   */
  const convertDocumentRef = useRef<(target: DocumentSyntax) => void>(() => undefined);
  const previousModeBeforePrintRef = useRef<EditorMode>("split");
  const previewUserScrollPendingRef = useRef(new WeakSet<HTMLElement>());
  const previewPointerScrollActiveRef = useRef(new WeakSet<HTMLElement>());
  const previewTouchScrollActiveRef = useRef(new WeakSet<HTMLElement>());
  /** Pointer Events の各段階で参照する最新の見出し並べ替え状態。 */
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
         * プログラムによる復元ではなく利用者操作で発生したスクロールかどうか。
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
         * 自動再試行を行った文書状態のバージョン番号です。
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
    () => undefined,
  );
  const persistViewStateTimerRef = useRef<number | undefined>(undefined);
  const pendingPersistViewModeRef = useRef<ViewMode | undefined>(undefined);
  const hostMessageHandlerRef = useRef<(message: HostToWebviewMessage) => void>(
    () => undefined,
  );
  versionRef.current = version;
  markdownForSelectionRef.current = markdown;
  pdfOptionsRef.current = pdfOptions;
  hostMessageHandlerRef.current = handleHostMessage;

  /** プレビューを伴う分割表示で、本文エディターの操作用ハンドルを返す。 */
  function getActiveEditor(): TextEditorHandle | undefined {
    if (mode === "split" && splitView !== "preview")
      return sourceRef.current ?? undefined;
    return undefined;
  }

  const outline = useMemo(
    () =>
      isMarpDocument
        ? getOutline(marpPreviewMarkdown)
        : previewSnapshot.outline,
    [isMarpDocument, marpPreviewMarkdown, previewSnapshot.outline],
  );
  const outlineStructureSignature = useMemo(
    /**
     * 現在の見出し構成から開閉状態の識別子を作成する。
     * @returns 見出し構成の署名。
     */
    () => getOutlineStructureSignature(outline),
    [outline],
  );
  const {
    outlineDrag,
    outlineDragRef,
    skipOutlineContextMenuRef,
    outlineDisclosureRightPointerRef,
    beginOutlineDrag,
    updateOutlineDrag,
    finishOutlineDrag,
    trackOutlineDisclosurePointer,
  } = useOutlineReorder({
    editingEnabled: isEditingEnabled(mode, splitView),
    markdown,
    previewMarkdown: previewSnapshot.markdown,
    outline,
    /**
     * 並べ替えの確定直前に、ドラッグ開始時の本文と比べるための最新本文を返す。
     * @returns 現在の本文。
     */
    getText: () => localTextRef.current,
    prepareLayoutRestore,
    /**
     * 並べ替え後の本文を反映する。
     * @param text - 並べ替え後の本文。
     */
    applyMarkdown: (text) => updateMarkdownRef.current(text),
    openSectionLinkMenu: setSectionLinkMenu,
  });
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

  const diagnostics = useMemo(
    () =>
      mergeCollectedDiagnostics(
        previewSnapshot.diagnostics,
        localResourceDiagnostics,
      ),
    [previewSnapshot.diagnostics, localResourceDiagnostics],
  );
  const diagnosticSummary = useMemo(
    () => summarizeDiagnostics(diagnostics),
    [diagnostics],
  );
  const stats = previewSnapshot.stats;
  const searchHits = useMemo(
    () => findSearchHits(renderedPreviewMarkdown, searchQuery),
    [renderedPreviewMarkdown, searchQuery],
  );
  const previewHtml = previewSnapshot.html;

  useEffect(
    /**
     * 依存状態の変化に応じて購読を更新し、解除処理を返す。
     */
    () => {
      // ホストへWebviewの準備完了を通知し、以後のメッセージを現在のハンドラーへ渡す。
      mveDebug("webview.ready", { clientId: clientIdRef.current });
      vscode.postMessage({ type: "ready", clientId: clientIdRef.current });

      const onMessage = /**
       * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
       * @param event - ホストから受信したwebview向けメッセージイベント。
       * @returns Hostから受信したメッセージの処理結果。
       */ (event: MessageEvent<HostToWebviewMessage>) =>
        hostMessageHandlerRef.current(event.data);
      window.addEventListener("message", onMessage);
      /**
       * メッセージ購読と未完了タイマー・描画フレームを解除する。
       */
      return () => {
        window.removeEventListener("message", onMessage);
        clearTimeoutRef(persistViewStateTimerRef);
        if (pdfOptionsPersistTimerRef.current !== undefined) {
          flushPdfOptionsPersistence();
        }
        cancelAnimationFrameRef(previewScrollFrameRef);
        clearTimeoutRef(previewToSourceSyncTimerRef);
        clearTimeoutRef(sourceToPreviewSyncTimerRef);
        cancelAnimationFrameRef(renderedPreviewRestoreFrameRef);
        clearTimeoutRef(renderedPreviewRestoreTimerRef);
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
     */
    () => {
      if (previewSnapshot.markdown !== localTextRef.current) return;
      const waiters = previewSnapshotWaitersRef.current.splice(0);
      waiters.forEach(
        /**
         * 成功結果通知ごとに成功結果通知を実行する。
         * @param resolve - Promiseの成功を通知する関数。
         */
        (resolve) => resolve(),
      );
    },
    [previewSnapshot.markdown],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
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
     */
    () => {
      // 本文が変わったら、前の本文に対するローカル参照診断を破棄する。
      resourceCheckGenerationRef.current += 1;
      setLocalResourceDiagnostics(
        /**

         * @param previous - Markdown変更前のローカルリソース診断一覧。未解決診断が残る場合にクリアする基準値。
         * @returns 未解決診断をすべて解消した場合は空配列、それ以外は既存診断一覧。
         */
        (previous) => (previous.length ? [] : previous),
      );
    },
    [markdown],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     */
    () => {
      if (
        !printPreview ||
        isMarpDocument ||
        marpDetectionUnresolved ||
        marpDetectionFailed
      ) {
        pdfPreviewRequestRef.current = createClientId();
        pdfPreviewSignatureRef.current = undefined;
        if (isMarpDocument || marpDetectionUnresolved || marpDetectionFailed) {
          setPdfPreview({ requestId: "", loading: false });
        }
      }
    },
    [
      isMarpDocument,
      marpDetectionFailed,
      marpDetectionUnresolved,
      printPreview,
    ],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて購読を更新し、解除処理を返す。
     */
    () => {
      if (
        !printPreview ||
        isMarpDocument ||
        marpDetectionUnresolved ||
        marpDetectionFailed ||
        !initialized ||
        !settings.workspaceTrusted
      )
        return;
      if (pdfPreviewTimerRef.current !== undefined)
        window.clearTimeout(pdfPreviewTimerRef.current);
      pdfPreviewTimerRef.current = window.setTimeout(
        /**
         * 指定時間の経過後に後続処理を実行する。
         */
        () => {
          pdfPreviewTimerRef.current = undefined;
          void requestPdfPreview();
        },
        350,
      );
      /**
       * effectの再実行前に保留中のPDFプレビュー要求を取り消す。
       */
      return () => {
        clearTimeoutRef(pdfPreviewTimerRef);
      };
    },
    [
      initialized,
      isMarpDocument,
      marpDetectionFailed,
      marpDetectionUnresolved,
      markdown,
      pdfOptions,
      printPreview,
      settings.language,
      settings.remoteImagesEnabled,
      settings.editorTheme,
      version,
    ],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて購読を更新し、解除処理を返す。
     */
    () => {
      // 検索パネルが開いた直後に入力欄へフォーカスし、既存文字列を選択する。
      if (!searchVisible) return;
      const frame = requestAnimationFrame(
        /**
         * 次の描画フレームで表示更新を実行する。
         */
        () => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        },
      );
      /**
       * パネルが閉じたとき、入力欄へ要求したフォーカスフレームを取り消す。
       */
      return () => cancelAnimationFrame(frame);
    },
    [searchVisible],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
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
     */
    () => {
      // CtrlまたはCmdを押しながらのホイール入力で表示倍率を変更する。
      const editorArea = editorAreaRef.current;
      if (!editorArea) return;

      const onWheel = /**
       * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
       * @param event - Ctrl+ホイールによるプレビュー倍率変更を判定するwheel event。
       */ (event: WheelEvent) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        adjustZoom(event.deltaY < 0 ? 0.1 : -0.1);
      };
      editorArea.addEventListener("wheel", onWheel, { passive: false });
      /**
       * wheelリスナーを解除する。
       */
      return () => editorArea.removeEventListener("wheel", onWheel);
    },
    [initialized],
  );

  /** ズーム倍率を範囲内に補正し、表示位置を保ったままプレビューを更新する。
   * @param delta - ズーム倍率へ加える変更量。ホイール操作では0.1刻みで増減する。
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

  useLayoutEffect(() => {
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
       */
      () => {
        restoreVisibleViewports();
        pendingViewportRestoreRef.current = false;
      },
    );
    /**
     * effectの再実行前に要求した描画フレームを取り消す。
     */
    return () => cancelAnimationFrame(frame);
  }, [
    mode,
    splitView,
    zoom,
    splitRatio,
    outlineVisible,
    diagnosticsVisible,
    Boolean(inspector),
    markdown,
    renderedPreviewMarkdown,
  ]);

  useLayoutEffect(() => {
    // 寸法の測定はデバッグログ専用。無効時に測ると、初回表示などで描画前の強制レイアウトが発生するため省く。
    if (!isMveDebugEnabled()) return;
    const area = editorAreaRef.current;
    const split = area?.querySelector<HTMLElement>(".split-editor");
    const source = area?.querySelector<HTMLElement>(".split-source-pane");
    const preview = area?.querySelector<HTMLElement>(".split-preview-pane");
    if (!area) return;

    const size = /**
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
      columns: split ? getComputedStyle(split).gridTemplateColumns : undefined,
    });
  }, [
    initialized,
    mode,
    splitView,
    outlineVisible,
    splitRatio,
    zoom,
    diagnosticsVisible,
    Boolean(inspector),
  ]);

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
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
             * 分割プレビュー側で後から復元する表示位置。
             */
            splitPreview?: PreviewViewportAnchor;

            /**
             * プレビュー単独表示側で後から復元する表示位置。
             */
            previewOnly?: PreviewViewportAnchor;

            /**
             * スナップショット取得後に利用者が移動したかを判定する世代番号。
             */
            intentGeneration: number;
          }
        | undefined;

      const onResize = /**
       * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
       * リサイズ時の表示位置を記録し、レイアウト更新後に復元する。
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
           */
          () => {
            resizeSnapshot = undefined;
          },
          120,
        );
      };

      const endPreviewPointerScroll = () => {
        const splitPreview = splitPreviewRef.current;
        const editorArea = editorAreaRef.current;
        if (splitPreview)
          previewPointerScrollActiveRef.current.delete(splitPreview);
        if (editorArea)
          previewPointerScrollActiveRef.current.delete(editorArea);
      };

      const endPreviewTouchScroll = () => {
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
     */
    () => () => {
      outlineDragRef.current = undefined;
      document.body.classList.remove("mve-dragging-outline");
    },
    [],
  );

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     */
    () => {
      // 貼り付け・ドラッグ&ドロップ・キーボードショートカットを文書編集へ接続する。

      const onPaste = /**
       * 貼り付け画像を保存し、そのMarkdown参照を本文へ挿入する。
       * @param event - 編集中の本文に貼り付けられた画像またはテキストを処理するclipboard event。
       */ (event: ClipboardEvent) => void handlePaste(event);

      const onDragOver = /**
       * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
       * @param event - 画像ファイルのdrag-overを受け取り、copy dropを許可するdrag event。
       * ドラッグ中のファイルを受け入れ可能なドロップ位置として表示する。
       */ (event: DragEvent) => {
        if (
          isEditingEnabled(mode, splitView) &&
          Array.from(event.dataTransfer?.items ?? []).some(
            /**

             * @param item - DataTransferから取得した貼り付け項目。画像ファイルかを判定する。
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
       * Escapeキーリスナーを解除する。
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
     */
    () => {
      // 通知トーストを一定時間後に自動的に閉じる。
      if (!toast) return;
      const timer = window.setTimeout(
        /**
         * 指定時間の経過後に後続処理を実行する。
         */
        () => setToast(""),
        2600,
      );
      /**
       * effectの再実行前に設定したタイマーを取り消す。
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

  /** メニュー表示中の閉じる操作を登録し、依存状態の変更時にすべて解除する。 */
  useEffect(() => {
    if (!sectionLinkMenu) return;
    /** メニュー外のポインター操作でセクションリンクメニューを閉じる。 */
    const closeOnPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        sectionLinkMenuRef.current?.contains(event.target)
      )
        return;
      setSectionLinkMenu(undefined);
    };
    /** Escapeでメニューを閉じ、ブラウザー側のEscape動作を抑止する。 */
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setSectionLinkMenu(undefined);
    };
    /** スクロール、リサイズ、ウィンドウのフォーカス喪失時に共通でメニューを閉じる。 */
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

  /** 右ドラッグの完了状態を保ち、完了後に発生する標準コンテキストメニューだけを抑止する。 */
  useEffect(() => {
    /** 新しい右ポインター操作では、前回のドラッグ抑止状態をリセットする。 */
    const resetOnRightPointerDown = (event: PointerEvent) => {
      if (event.button === 2) skipOutlineContextMenuRef.current = false;
    };
    /** 右ドラッグ処理が完了したときだけ標準コンテキストメニューを止める。 */
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
      case "marpDetectionResult": {
        const request = marpDetectionRequestRef.current;
        if (
          !request ||
          request.requestId !== message.requestId ||
          request.markdown !== previewMarkdownForMarpRef.current
        )
          return;
        marpDetectionRequestRef.current = undefined;
        setMarpDetectionPending(false);
        setIsMarpDetected(message.isMarp);
        setMarpDetectionMarkdown(request.markdown);
        setMarpDetectionFailedMarkdown(undefined);
        return;
      }
      case "init": {
        // 変換タブで切り替えた表示形式は同じ文書の再初期化でだけ維持し、別文書へ移ったら拡張子由来へ戻す。
        documentUriRef.current = message.uri;
        const override = renderFormatOverrideRef.current;
        if (override && override.uri !== message.uri) {
          formatConversionHistoryRef.current = [];
        }
        // 表示形式は、拡張機能が保持する値（保持した本文の指紋が現在の本文と一致する場合だけ届く）に従う。
        // Webviewの状態から復元した上書きは本文の指紋を持たず、外部の変更などで古くなり得るため、ここで置き換える。
        renderFormatOverrideRef.current = message.renderFormat
          ? { uri: message.uri, format: message.renderFormat }
          : undefined;
        setRenderFormat(
          renderFormatOverrideRef.current?.format ??
            getRenderFormatForUri(message.uri),
        );
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
      }
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
        notifyExportSyncWaiters();
        return;
      }
      case "externalChanges":
        applyExternalChanges(message);
        notifyExportSyncWaiters();
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
        notifyExportSyncWaiters();
        return;
      case "settingsChanged":
        applyHostSettings(message.settings);
        if (message.settings.viewMode)
          setSplitView(restoreViewMode(message.settings.viewMode));
        return;
      case "mermaidRendered":
        acceptMermaidRenderResult(message);
        return;
      case "mermaidRenderProgress":
        acceptMermaidRenderProgress(message);
        return;
      case "drawioSvgCreated":
        if (!drawioRequestsRef.current.delete(message.requestId)) return;
        // プレビューでは画像として表示し、クリックでdraw.io編集画面を開けるようリンク付き画像で挿入する。
        getActiveEditor()?.insert(drawioImageMarkdown(message.path), true);
        setToast(messages.app.toast.imagesSaved(1));
        return;
      case "localResourceChanged":
        // draw.ioで保存した図などをキャッシュではなく最新のファイルから表示し直す。
        markLocalResourceChanged(message.resource);
        return;
      case "imagesSaved":
        imageRequestsRef.current.delete(message.requestId);
        if (message.paths.length) {
          getActiveEditor()?.insert(
            message.paths
              .map(
                /**
                 * 画像参照ごとに表示可能なMarkdownを作る。
                 * @param item - 走査中の要素。

                 */
                (item) => imageMarkdown(item, messages.editor.defaultImageAlt),
              )
              .join("\n"),
            true,
          );
          // 既存画像を参照しただけの場合に「保存しました」と伝えないよう、保存件数で文言を分ける。
          const savedCount = message.savedCount ?? message.paths.length;
          setToast(
            savedCount > 0
              ? messages.app.toast.imagesSaved(savedCount)
              : messages.app.toast.imagesInserted(message.paths.length),
          );
        }
        return;
      case "linkCompletions":
        linkCompletionClient.accept(message);
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
          const marpDetectionRequest = marpDetectionRequestRef.current;
          if (
            message.requestId &&
            marpDetectionRequest?.requestId === message.requestId
          ) {
            marpDetectionRequestRef.current = undefined;
            setMarpDetectionPending(false);
            setIsMarpDetected(false);
            setMarpDetectionMarkdown(marpDetectionRequest.markdown);
            if (
              marpDetectionRequest.markdown ===
              previewMarkdownForMarpRef.current
            ) {
              setMarpDetectionFailedMarkdown(marpDetectionRequest.markdown);
            }
            console.error(
              "[Markdown Easy Visual Editor] Marp detection failed.",
              message.message,
            );
            return;
          }
          if (
            message.requestId &&
            message.requestId === pdfPreviewRequestRef.current
          ) {
            setPdfPreview(
              /**

               * @param previous - 更新前のPDFプレビュー状態。loadingとerrorを更新し、他の状態を保つ基準値。
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
          const drawioFailed = message.requestId
            ? drawioRequestsRef.current.delete(message.requestId)
            : false;
          const imageFailed = message.requestId
            ? imageRequestsRef.current.delete(message.requestId)
            : false;
          const pdfFailed = message.requestId
            ? pdfRequestsRef.current.delete(message.requestId)
            : false;
          const htmlFailed = message.requestId
            ? htmlRequestsRef.current.delete(message.requestId)
            : false;
          const docxFailed = message.requestId
            ? docxRequestsRef.current.delete(message.requestId)
            : false;
          const resourceCheckRequest = message.requestId
            ? resourceCheckRequestsRef.current.get(message.requestId)
            : undefined;
          const resourceCheckFailed = message.requestId
            ? resourceCheckRequestsRef.current.delete(message.requestId)
            : false;
          setToast(
            drawioFailed || imageFailed
              ? messages.app.toast.imageSaveFailed(message.message)
              : pdfFailed
                ? messages.app.toast.pdfExportFailed(message.message)
                : htmlFailed
                  ? messages.app.toast.htmlExportFailed(message.message)
                  : docxFailed
                    ? messages.app.toast.docxExportFailed(message.message)
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
      case "docxExported":
        docxRequestsRef.current.delete(message.requestId);
        setToast(messages.app.toast.docxExported(message.path));
        return;
      case "pdfPreviewReady":
        if (isMarpDocument) return;
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
        if (message.command === "exportDocx")
          void requestDocxExport(docxOptionsRef.current);
        if (message.command === "undo" || message.command === "redo")
          requestHistoryCommand(message.command);
        return;
    }
  }

  /**
   * Webviewルートの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param message - HostとWebviewの間で受け渡すメッセージ。
   */
  function applyExternalChanges(
    message: Extract<
      HostToWebviewMessage,
      {
        /**
         * 拡張ホストから届いた文書本文の外部変更メッセージを選ぶ判別値。
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
   * Hostへ現在の本文の再同期を要求する。
   * @param reason - 処理を中断または失敗させた理由。
   * @param opId - 再同期対象の編集操作ID。未指定時は現在進行中の操作IDを使う。
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
   * エディター最新本文をReact stateへ反映し、その本文スナップショットを返す。

   */
  function commitSourceSnapshot(): string {
    const current = localTextRef.current;
    setMarkdown(
      /**

       * @param previous - 更新前のMarkdown本文。エディター最新値へ置き換えるか判定する基準値。
       */
      (previous) => (previous === current ? previous : current),
    );
    return current;
  }

  /** ACK・再同期・外部編集後に、出力要求の同期待機を再評価する。 */
  function notifyExportSyncWaiters(): void {
    for (const notify of exportSyncWaitersRef.current) notify();
  }

  /**
   * Webviewの最新編集をHostへ適用してから本文と文書版を固定する。
   * 未解決の再同期やACK不一致は時間切れで失敗し、古い本文を出力しない。
   */
  async function waitForHostExportSnapshot(): Promise<{
    markdown: string;
    version: number;
  }> {
    commitSourceSnapshot();
    sendNextLocalOperation();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        exportSyncWaitersRef.current.delete(check);
        if (error) reject(error);
        else
          resolve({
            markdown: hostTextRef.current,
            version: versionRef.current,
          });
      };
      const check = () => {
        if (
          !initializedRef.current ||
          resyncInFlightRef.current ||
          inFlightOperationRef.current ||
          localTextRef.current !== hostTextRef.current
        )
          return;
        finish();
      };
      const timeout = window.setTimeout(
        () => finish(new Error("Host edit ACK timed out.")),
        10_000,
      );
      exportSyncWaitersRef.current.add(check);
      check();
    });
  }

  /**
   * UndoまたはRedo要求を確定済み本文に対して順番待ちへ追加する。
   * @param command - Webviewへ送信するundoまたはredoコマンド。
   */
  function requestHistoryCommand(command: "undo" | "redo"): void {
    commitSourceSnapshot();
    pendingHistoryCommandsRef.current.push(command);
    flushHistoryCommands();
  }

  /**
   * Webviewルートの処理順序と完了状態を管理する。
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

  /** 完了済み操作IDを記録し、重複通知を判定するため最新256件を保持する。
   * @param opId - 完了済みとして記録するWebview編集操作ID。
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
      renderFormatOverride: renderFormatOverrideRef.current,
    });
  }

  /**
   * Webviewルートの処理順序と完了状態を管理する。
   * @param viewModeOverride - 保存処理の実行まで保留する分割表示状態。
   */
  function schedulePersistViewState(viewModeOverride?: ViewMode): void {
    if (viewModeOverride !== undefined)
      pendingPersistViewModeRef.current = viewModeOverride;
    if (persistViewStateTimerRef.current !== undefined) return;
    persistViewStateTimerRef.current = window.setTimeout(
      /**
       * 指定時間の経過後に後続処理を実行する。
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
   */
  function setOutlineVisibility(visible: boolean): void {
    if (outlineVisible === visible) return;
    setOutlineVisible(visible);
    vscode.postMessage({ type: "setOutlineVisible", visible });
  }

  /**
   * Webviewルートの変更または利用者の操作意図を記録し、後続処理へ渡す。
   * @param nextMode - 切り替え先の本文・分割・プレビュー表示モード。
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
   */
  function handleRibbon(command: RibbonCommand): void {
    if (isTextileDocument) {
      switch (command.type) {
        case "sourceAction":
        case "heading":
        case "insert":
        case "tableInsert":
        case "codeBlock":
        case "link":
        case "image":
        case "drawio":
        case "table":
          return;
        default:
          break;
      }
    }
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
      case "drawio":
        requestDrawioSvg();
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

           * @param current - 現在のWebview設定。スクロール同期だけを切り替え、他設定を保つ基準値。
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
      case "exportDocx":
        void requestDocxExport(command.options);
        return;
      case "setImageDirectory":
        setSettings(
          /**

           * @param current - 現在のWebview設定。画像保存先だけを置き換え、他設定を保つ基準値。
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

           * @param current - 現在のWebview設定。エディター・プレビューのフォントとPDF設定を更新する基準値。
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
      case "setMermaidFontSize": {
        const fontSize = normalizeMermaidFontSize(command.fontSize);
        setSettings(
          /**
           * Mermaid文字サイズを出力用レンダーへ即時反映するため、他設定を保って更新する。
           * @param current - 現在のWebview設定。
           * @returns Mermaid文字サイズだけを更新した設定。
           */
          (current) => ({ ...current, mermaidFontSize: fontSize }),
        );
        vscode.postMessage({
          type: "setMermaidFontSize",
          fontSize,
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
      case "convertDocument":
        convertDocument(command.target);
        return;
    }
  }

  convertDocumentRef.current = convertDocument;

  /**
   * 文書全体を指定した記法へ書き換え、プレビューの表示形式を変換先へ切り替える。変換は止めずに必ず適用する。
   * ブロックごとに同じ意味の変換先の記法へ書き換え（HTMLへは変換しない）、変換前後の描画を比べて変換の誤りを直す
   * （{@link convertPreservingPreview}）。一致させきれなかった場合や、描画Workerが使えず比べられなかった場合も
   * 変換を適用し、プレビューが変わる可能性があることを通知する。Marp文書も変換し、スライド表示が使えなくなることを通知する。
   * 検査中に本文が編集された場合は、検査の終了後に最新の本文で変換し直す。別の文書へ切り替わった場合だけ中止する。
   * 本文の置換はCodeMirrorの1トランザクション（編集面が非表示ならHost同期の1操作）として適用し、
   * Undoで本文が変換前へ戻ったときは表示形式も戻す。書き換える記法がなければ通知を出し、表示形式だけを変換先へ切り替える。
   * @param target - 変換先の記法。現在の表示形式と同じなら何もしない。変換の検査中は受け付けない（実行中の変換が適用される）。
   */
  function convertDocument(target: DocumentSyntax): void {
    const current: DocumentSyntax = isTextileDocument ? "textile" : "markdown";
    if (current === target || formatConversionPendingRef.current) return;
    const source = localTextRef.current;
    const uri = documentUriRef.current;
    const currentFormat = renderFormat;
    const marpDocument = isMarpDocument;
    // Markdown文書は拡張子由来と同じ「Textile混在」形式で表示し、未変換で残したTextile記法も同じ見た目に保つ。
    const nextFormat: MarkdownRenderFormat =
      target === "textile" ? "textile" : "mixed";
    formatConversionPendingRef.current = true;
    setToast(messages.app.toast.documentConversionRunning);
    // リモート画像を無効にした設定で描画すると画像が「表示できない」表示に置き換わり、埋め込むHTMLから画像のURLが失われる。
    // 変換のための描画では常にリモート画像を有効にし、URLを保ったまま比べる（表示設定は変換後のプレビューにそのまま適用される）。
    const renderOptions = {
      remoteImagesEnabled: true,
      language: settings.language,
    };
    const userRemoteImagesEnabled = settings.remoteImagesEnabled;
    /**
     * 本文が変わったか判定する。文書が切り替わった場合は含めない（別途中止する）。
     * @returns 同じ文書で本文が変わっていればtrue。
     */
    const edited = (): boolean =>
      documentUriRef.current === uri && localTextRef.current !== source;
    let rerun = false;
    // 変換のあいだ1つのWorkerを使い回し、終わったら必ず終了する。
    const session = createPreviewRenderSession();
    void convertPreservingPreview(
      source,
      current,
      currentFormat,
      target,
      nextFormat,
      /**
       * 変換用のWorkerで描画する。
       * @param text - 描画する文書。
       * @param format - 描画形式。
       * @returns 描画ブロック。
       */
      (text, format) =>
        session.render(text, {
          ...renderOptions,
          renderFormat: format,
          // 変換は原文の位置と描画を単位ごとに対応付けるため、脚注を含むTextile文書も描画単位ごとに描画する。
          splitTextileBlocks: true,
        }),
      /**
       * 本文や文書が変わったら、描画の繰り返しを打ち切る。
       * @returns 打ち切る場合はtrue。
       */
      () => localTextRef.current !== source || documentUriRef.current !== uri,
    )
      .then(
        /**
         * 変換結果を適用する。プレビューが同じにならなかった場合も適用し、変わり得る行を通知する。
         * @param result - 変換結果。
         */
        async (result) => {
          if (documentUriRef.current !== uri) {
            setToast(messages.app.toast.documentConversionCancelled);
            return;
          }
          if (result.cancelled || edited()) {
            rerun = true;
            return;
          }
          let offset = result.firstDifferenceOffset;
          let equal = result.equal;
          // 変換用の描画はリモート画像を有効にして行うため、リモート画像を無効にしている場合は、
          // 実際のプレビューと同じ設定でも変換前後を比べ、違いが出る場合はその行を通知する（変換は適用する）。
          if (equal && !userRemoteImagesEnabled) {
            const userOptions = { remoteImagesEnabled: false, language: settings.language };
            // 追加の比較が描画の失敗で行えなくても、検査済みの変換結果は捨てずに適用する（見た目が変わり得ると通知する）。
            try {
              const comparison = comparePreviewBlocks(
                await session.render(source, { ...userOptions, renderFormat: currentFormat }),
                await session.render(result.text, { ...userOptions, renderFormat: nextFormat }),
              );
              equal = comparison.equal;
              offset = comparison.firstDifferenceOffset;
            } catch {
              equal = false;
              offset = undefined;
            }
            if (documentUriRef.current !== uri) {
              setToast(messages.app.toast.documentConversionCancelled);
              return;
            }
            if (edited()) {
              rerun = true;
              return;
            }
          }
          applyDocumentConversion(source, result.text, currentFormat, nextFormat);
          if (result.text === source) return;
          // 本文の見た目が変わり得る場合は、その行の通知を優先する。Marp文書の比較はfront matterを除いた本文で行われるため、
          // 本文に違いがなければ、スライド表示が通常のプレビューになったことを通知する。
          if (marpDocument && equal) {
            setToast(messages.app.toast.documentConvertedMarp);
          } else if (!equal) {
            setToast(messages.app.toast.documentConvertedMayDiffer(
              offset === undefined ? "?" : String(lineNumberAtOffset(source, offset)),
            ));
          } else {
            setToast(messages.app.toast.documentConverted);
          }
        },
      )
      .catch(
        /**
         * 描画Workerの起動・描画に失敗した場合も変換は止めず、記法の変換だけを適用して、確かめられなかったことを知らせる。
         * @param error - 失敗の理由。
         */
        (error: unknown) => {
          if (documentUriRef.current !== uri) {
            setToast(messages.app.toast.documentConversionCancelled);
            return;
          }
          if (edited()) {
            rerun = true;
            return;
          }
          const converted = convertDocumentSyntax(source, current, target).text;
          applyDocumentConversion(source, converted, currentFormat, nextFormat);
          if (converted !== source) {
            setToast(messages.app.toast.documentConvertedUnverified(errorMessage(error)));
          }
        },
      )
      .finally(
        /** 変換用のWorkerを終了して次の変換操作を受け付け、検査中に本文が編集されていれば最新の本文で変換し直す。 */
        () => {
          session.dispose();
          formatConversionPendingRef.current = false;
          if (rerun) convertDocumentRef.current(target);
        },
      );
  }

  /**
   * 検査を通った変換を適用する。本文はCodeMirrorの1トランザクション（編集面が非表示ならHost同期の1操作）として置き換え、
   * Undoで戻せるよう前後の本文と表示形式を履歴へ記録してから、表示形式を変換先へ切り替える。
   * 書き換える記法がなかった場合は本文を変えず、表示形式だけを切り替えて通知する。
   * @param source - 変換前の本文。
   * @param converted - 変換後の本文。
   * @param currentFormat - 変換前の表示形式。
   * @param nextFormat - 変換後の表示形式。
   */
  function applyDocumentConversion(
    source: string,
    converted: string,
    currentFormat: MarkdownRenderFormat,
    nextFormat: MarkdownRenderFormat,
  ): void {
    if (converted !== source) {
      const history = formatConversionHistoryRef.current;
      history.push({
        before: fingerprintText(source),
        beforeFormat: currentFormat,
        after: fingerprintText(converted),
        afterFormat: nextFormat,
      });
      if (history.length > MAX_FORMAT_CONVERSION_HISTORY) history.shift();
    }
    renderFormatOverrideRef.current = {
      uri: documentUriRef.current,
      format: nextFormat,
    };
    setRenderFormat(nextFormat);
    schedulePersistViewState();
    persistRenderFormatOverride(nextFormat, converted);
    if (converted === source) {
      setToast(messages.app.toast.documentConversionUnchanged);
      return;
    }
    const editor = getActiveEditor();
    if (editor) {
      const selection = editor.getSelection();
      editor.applyEdit({
        text: converted,
        selection: {
          from: Math.min(selection.from, converted.length),
          to: Math.min(selection.to, converted.length),
        },
      });
    } else {
      updateMarkdown(converted);
    }
  }

  /**
   * Undo/Redoで本文がいずれかの文書変換の前後と一致したとき、表示形式も対応する形式へ戻す。
   * 新しい変換から順に照合するため、連続して変換した後もUndoを重ねるたびに対応する形式へ戻る。
   * 本文の比較は指紋（{@link fingerprintText}）の一致で判定し、それ以外の編集では何もしない。
   * @param nextText - 更新後の本文。
   */
  function restoreRenderFormatForConversion(nextText: string): void {
    const history = formatConversionHistoryRef.current;
    if (history.length === 0) return;
    // 指紋は長さで終わるため、長さが履歴のどれとも合わない編集では全文のハッシュを計算しない（入力のたびの全文走査を避ける）。
    const length = `:${nextText.length}`;
    if (!history.some((record) => record.before.endsWith(length) || record.after.endsWith(length))) return;
    const fingerprint = fingerprintText(nextText);
    let format: MarkdownRenderFormat | undefined;
    for (
      let index = history.length - 1;
      index >= 0 && format === undefined;
      index -= 1
    ) {
      const record = history[index];
      if (fingerprint === record.after) format = record.afterFormat;
      else if (fingerprint === record.before) format = record.beforeFormat;
    }
    if (format === undefined) return;
    renderFormatOverrideRef.current = {
      uri: documentUriRef.current,
      format,
    };
    setRenderFormat(format);
    schedulePersistViewState();
    persistRenderFormatOverride(format, nextText);
  }

  /**
   * 変換タブで切り替えた表示形式を、その表示形式で表示する本文の指紋と一緒に拡張機能へ保持させる。拡張子から決まる既定の形式と
   * 同じなら保持を解除する（文書を閉じて開き直しても、本文が変わっていなければ変換後の記法で表示するため）。
   * @param format - 現在の表示形式。
   * @param text - その表示形式で表示する本文。
   */
  function persistRenderFormatOverride(format: MarkdownRenderFormat, text: string): void {
    const uri = documentUriRef.current;
    const keep = format !== getRenderFormatForUri(uri);
    vscode.postMessage({
      type: "renderFormatOverride",
      format: keep ? format : undefined,
      fingerprint: keep ? fingerprintText(text) : undefined,
    });
  }

  /**
   * Webviewルートの処理順序と完了状態を管理する。
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
   * 現在のMarkdown本文に対するローカル参照診断をHostへ要求する。
   * @param purpose - 診断要求が設定変更後の再確認か、ユーザーによる手動確認かを示す理由。
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
   */
  function openSearch(): void {
    if (mode === "preview") changeMode("split");
    if (splitView === "preview") changeSplitView("text");
    setSearchVisible(true);
  }

  /**
   * Webviewルートの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   */
  function applyLinkDialog(): void {
    const href = linkHref.trim();
    if (!href) return;
    getActiveEditor()?.link(href, linkLabel.trim() || undefined);
    setLinkDialogVisible(false);
  }

  /**
   * Webviewルートの処理またはリソースを終了し、後続利用可能な状態へ戻す。
   */
  function closeSearch(): void {
    setSearchVisible(false);
    setSearchIndex(0);
  }

  /** 検索ヒットを指定方向へ巡回し、選択した箇所へ本文とプレビューを移動する。
   * @param direction - 検索ヒットを進む場合は1、戻る場合は-1。
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

         */
        (item) => item.kind === "file" && item.type.startsWith("image/"),
      )
      .map(
        /**
         * 画像クリップボード項目からFileを取得する。
         * @param item - 画像ファイルかを確認済みのDataTransferItem。
         */
        (item) => item.getAsFile(),
      )
      .filter(
        /**
         * 未定義または無効なfileを除外する。
         * @param file - 有効性を判定するfile。

         */
        (file): file is File => Boolean(file),
      );
    if (imageFiles.length) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!isTextileDocument) await saveImageFiles(imageFiles);
      return;
    }
    const html = event.clipboardData?.getData("text/html");
    const editor = getActiveEditor();
    const plainText = event.clipboardData?.getData("text/plain") ?? "";
    const hasHtmlTable = /<table\b[^>]*>[\s\S]*<\/table>/i.test(html ?? "");
    const hasTsvMime = Array.from(event.clipboardData?.types ?? []).some(
      /**

       * @param type - Clipboard APIが報告したクリップボード項目のMIME type。
       */
      (type) => type === "text/tab-separated-values" || type === "text/tsv",
    );
    const hasTableClipboard =
      hasHtmlTable || (!html && (hasTsvMime || plainText.includes("\t")));
    if (
      !isTextileDocument &&
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
    if (html && editor && !isTextileDocument) {
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
   */
  async function saveImageFiles(files: File[]): Promise<void> {
    if (isTextileDocument) return;
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
      setToast(errorMessage(error));
    }
  }

  /**
   * draw.io図のテンプレートを保存して相対画像リンクを挿入するようHostに要求する。
   */
  function requestDrawioSvg(): void {
    if (isTextileDocument) return;
    const requestId = createClientId();
    drawioRequestsRef.current.add(requestId);
    vscode.postMessage({
      type: "createDrawioSvg",
      requestId,
      imageDirectory: settings.imageDirectory,
    });
  }

  /**
   * Hostへ画像選択を要求し、応答を識別するIDを登録する。
   */
  function requestImagePicker(): void {
    if (isTextileDocument) return;
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
       */
      (resolve) => {
        let waiter: (() => void) | undefined;
        const timeout = window.setTimeout(
          /**
           * 指定時間の経過後に後続処理を実行する。
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
   * Webviewルートの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param update - 現在の正規化済みPDF設定を受け取り、次に保存するPDF設定を返す更新関数。
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

  /** 保留中のPDF設定保存タイマーを止め、現在の設定をHostへ即時送信する。 */
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
   * 出力を始められるか確認し、始められない理由があれば通知する。
   * ワークスペースが信頼されていない場合と、無効な正規表現の置換ルールがある場合は出力しない。
   * @param rules - 出力に適用する置換ルール。
   * @returns 出力を始めてよければtrue。
   */
  function canStartOutput(rules: readonly TextReplacementRule[]): boolean {
    if (!settings.workspaceTrusted) {
      setToast(messages.app.toast.workspaceTrustRequired);
      return false;
    }
    if (rules.some(
      /**
       * 空でなく、正規表現として解釈できないルールか判定する。
       * @param rule - 置換ルール。
       * @returns 無効なルールならtrue。
       */
      (rule) => rule.pattern.length > 0 && !isTextReplacementPatternValid(rule.pattern))) {
      setToast(messages.app.invalidOutputReplacementPattern);
      return false;
    }
    return true;
  }

  /**
   * 出力要求に添える描画条件を、プレビューと同じ設定から作る。
   * @returns Host がプレビューと同じ描画を再現するための条件。
   */
  function exportRendering() {
    return {
      renderFormat,
      mermaidTheme: settings.mermaidTheme,
      mermaidFontSize: normalizeMermaidFontSize(settings.mermaidFontSize),
      fontFamily: settings.previewFontFamily,
      remoteImagesEnabled: settings.remoteImagesEnabled,
      language: settings.language,
    };
  }

  /**
   * 出力要求の準備中に起きた失敗を通知する。
   * @param error - 発生した例外。
   */
  function notifyOutputFailure(error: unknown): void {
    setToast(messages.app.toast.operationFailed(errorMessage(error)));
  }

  /** HostのACKと文書版を固定した原文から、CLIと同じPDF出力を要求する。 */
  async function requestPdfExport(): Promise<void> {
    const options = pdfOptionsRef.current;
    if (!canStartOutput(options.textReplacements)) return;
    if (pdfExportInProgressRef.current || pdfRequestsRef.current.size > 0)
      return;
    pdfExportInProgressRef.current = true;
    try {
      setToast(messages.host.pdfProgress);
      flushPdfOptionsPersistence();
      requestLocalResourceCheck("pdf");
      const diagnostics = summarizeDiagnostics(
        mergeDiagnostics(
          localTextRef.current,
          localResourceDiagnostics,
          settings.language,
        ),
      );
      const diagnosticNotice = diagnostics.errors
        .map(
          /**
           * エラー診断を通知用の1行へ整える。
           * @param item - エラー診断。
           * @returns 行番号付きの説明。
           */
          (item) => `${item.line ? `行${item.line}: ` : ""}${item.message}`,
        )
        .join(" / ");
      if (diagnosticNotice)
        setToast(
          messages.app.toast.pdfStartedWithDiagnostics(
            diagnostics.errors.length,
            diagnosticNotice,
          ),
        );
      const snapshot = await waitForHostExportSnapshot();
      const requestId = createClientId();
      pdfRequestsRef.current.add(requestId);
      vscode.postMessage({
        type: "exportPdf",
        requestId,
        markdown: snapshot.markdown,
        documentVersion: snapshot.version,
        rendering: exportRendering(),
        options,
        editorTheme: settings.editorTheme ?? "dark",
      } satisfies WebviewToHostMessage);
    } catch (error) {
      notifyOutputFailure(error);
    } finally {
      pdfExportInProgressRef.current = false;
    }
  }

  /**
   * 最新編集のACK後に固定した原文と全設定をHTML出力へ送る。
   * リンク先文書も出力エンジンが同じ描画経路で処理する。
   * @param options - 画像の埋め込み、リンク先Markdownの変換などのHTML出力オプション。
   */
  async function requestHtmlExport(options: HtmlExportOptions): Promise<void> {
    const textReplacements = pdfOptionsRef.current.textReplacements;
    if (!canStartOutput(textReplacements)) return;
    try {
      setToast(messages.host.htmlProgress);
      const snapshot = await waitForHostExportSnapshot();
      const requestId = createClientId();
      htmlRequestsRef.current.add(requestId);
      vscode.postMessage({
        type: "exportHtml",
        requestId,
        markdown: snapshot.markdown,
        documentVersion: snapshot.version,
        rendering: exportRendering(),
        editorTheme: settings.editorTheme ?? "dark",
        options,
        textReplacements,
      } satisfies WebviewToHostMessage);
    } catch (error) {
      notifyOutputFailure(error);
    }
  }

  /**
   * 最新編集のACK後に固定した原文と印刷設定をDOCX出力へ送る。
   * 用紙・余白・文字組みは画面に表示中の印刷設定を使い、未保存の印刷設定もHostへ保存を依頼する。
   * DOCXはブラウザー描画を伴い時間がかかるため、PDF出力と同じく応答待ちの要求がある間は新しい要求を受け付けない
   * （連打で同じファイルへの重複出力や保存ダイアログの連続表示を起こさないため）。
   * リンク切れ画像の事前確認はHTML出力と同じく行わず、出力エンジンの警告に任せる。
   * @param options - 保存ダイアログを省略するかなどのDOCX出力設定。
   */
  async function requestDocxExport(options: DocxExportSettings): Promise<void> {
    const pdfOptions = pdfOptionsRef.current;
    if (!canStartOutput(pdfOptions.textReplacements)) return;
    if (docxExportInProgressRef.current || docxRequestsRef.current.size > 0)
      return;
    docxExportInProgressRef.current = true;
    try {
      setToast(messages.host.docxProgress);
      flushPdfOptionsPersistence();
      const snapshot = await waitForHostExportSnapshot();
      const requestId = createClientId();
      docxRequestsRef.current.add(requestId);
      vscode.postMessage({
        type: "exportDocx",
        requestId,
        markdown: snapshot.markdown,
        documentVersion: snapshot.version,
        rendering: exportRendering(),
        editorTheme: settings.editorTheme ?? "dark",
        options: normalizeDocxExportSettings(options),
        pdfOptions,
      } satisfies WebviewToHostMessage);
    } catch (error) {
      notifyOutputFailure(error);
    } finally {
      docxExportInProgressRef.current = false;
    }
  }

  /** 印刷プレビュー用の置換を実行し、重複要求を避けて最新のPDFデータをHostへ送る。 */
  async function requestPdfPreview(): Promise<void> {
    if (
      !printPreview ||
      isMarpDocument ||
      marpDetectionUnresolved ||
      marpDetectionFailed ||
      !settings.workspaceTrusted
    )
      return;
    if (
      pdfOptions.textReplacements.some(
        /**
         * 入力済みパターンを検証し、未入力の追加行は保留として扱う。
         * @param rule 検証対象の出力置換ルール。
         * @returns 不正なパターンならtrue。
         */
        (rule) =>
          rule.pattern.length > 0 &&
          !isTextReplacementPatternValid(rule.pattern),
      )
    ) {
      pdfPreviewRequestRef.current = createClientId();
      pdfPreviewSignatureRef.current = undefined;
      setPdfPreview((previous) => ({
        ...previous,
        loading: false,
        error: messages.app.invalidOutputReplacementPattern,
      }));
      return;
    }
    // 画像のloadやResizeObserverでexport-stageのDOMが変わっても、同じ本文のPDFを再生成しない。
    // 画像サイズの変更はMarkdown本文が変わるため、このキーも変わる。
    // 言語・テーマ・PDF設定・本文が同じ要求だけを同一PDFとして扱う。
    const signature = `${settings.language}\0${settings.editorTheme ?? "dark"}\0${settings.remoteImagesEnabled}\0${settings.mermaidTheme}\0${normalizeMermaidFontSize(settings.mermaidFontSize)}\0${JSON.stringify(pdfOptions)}\0${markdown}`;
    if (pdfPreviewSignatureRef.current === signature) return;
    const requestId = createClientId();
    pdfPreviewRequestRef.current = requestId;
    const root = exportRootRef.current;
    if (
      !root ||
      root.querySelector(
        '.mermaid:not([data-mermaid-status]), .mermaid[data-mermaid-status="rendering"]',
      )
    ) {
      pdfPreviewSignatureRef.current = undefined;
      return;
    }
    pdfPreviewSignatureRef.current = signature;
    setPdfPreview(
      /**
       * 更新前のプレビュー情報を保ち、新しい要求IDと読み込み状態を設定する。
       * @param previous 更新前のPDFプレビュー状態。
       * @returns 新しい要求IDとloading状態を持つPDFプレビュー状態。
       */
      (previous) => ({
        ...previous,
        requestId,
        loading: true,
        error: undefined,
      }),
    );
    let pdfOutput: { html: string; options: PdfOptions };
    try {
      pdfOutput = await serializePdfExport(
        root,
        pdfOptions,
        () => pdfPreviewRequestRef.current === requestId,
      );
    } catch (error) {
      if (
        error instanceof TextReplacementCancelledError ||
        pdfPreviewRequestRef.current !== requestId
      ) {
        return;
      }
      setPdfPreview((previous) => ({
        ...previous,
        loading: false,
        error:
          error instanceof TextReplacementTimeoutError
            ? messages.app.outputReplacementTimeout
            : messages.app.outputReplacementFailed,
      }));
      return;
    }
    if (pdfPreviewRequestRef.current !== requestId) return;
    const css = collectPrintableCss(settings.previewFontFamily, false);
    mveDebug("pdf.preview-request", {
      requestId,
      htmlChars: pdfOutput.html.length,
      cssChars: css.length,
    });
    vscode.postMessage({
      type: "renderPdfPreview",
      requestId,
      html: pdfOutput.html,
      css,
      options: pdfOutput.options,
      editorTheme: settings.editorTheme ?? "dark",
    });
  }

  /**
   * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
   * @param element - 寸法または属性を読み取るDOM要素。
   */
  function handleExportRendered(element: HTMLElement): void {
    exportRootRef.current = element as HTMLDivElement;
    if (
      printPreview &&
      !isMarpDocument &&
      !marpDetectionUnresolved &&
      !marpDetectionFailed &&
      settings.workspaceTrusted
    ) {
      if (pdfPreviewTimerRef.current !== undefined)
        window.clearTimeout(pdfPreviewTimerRef.current);
      pdfPreviewTimerRef.current = window.setTimeout(
        /**
         * 指定時間の経過後に後続処理を実行する。
         */
        () => {
          pdfPreviewTimerRef.current = undefined;
          void requestPdfPreview();
        },
        80,
      );
    }
  }

  /**
   * Inspectorで編集中の画像、リンク、数式、またはMermaid内容を更新する。
   * @param nextSource Inspectorで編集中の対象へ設定する新しい内容。
   * @param alt 画像の代替テキスト。画像Inspectorで使う場合に指定する。
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

  /** プレビュー画像の幅を変更し、Markdown本文に保存する。
   * @param imageIndex - Markdown本文内でサイズを変更するプレビュー画像の0始まりインデックス。
   * @param width - 画像へ記録するCSSピクセル単位の幅。
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
   */
  function resetPreviewImage(imageIndex: number): void {
    if (!(mode === "split" && splitView !== "text")) return;
    updateMarkdown(resetImageSizeInMarkdown(localTextRef.current, imageIndex));
  }

  /** プレビュー画像の配置を変更し、Markdown本文に保存する。
   * @param imageIndex - Markdown本文内で配置を変えるプレビュー画像の0始まりインデックス。
   * @param alignment - 画像を左・中央・右のどこへ配置するかを示す値。
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
   */
  function changeInspector(next: InspectorTarget | undefined): void {
    prepareLayoutRestore();
    setInspector(next);
  }

  /**
   * 表示中のペイン位置を記録し、次回レイアウト確定後の復元を予約する。
   */
  function prepareLayoutRestore(): void {
    captureVisibleViewports();
    pendingViewportRestoreRef.current = true;
  }

  /** 指定した本文オフセットへ選択位置と表示位置を移動する。
   * @param offset アウトライン見出しのMarkdown本文内UTF-16オフセット。
   */
  function goToOffset(offset: number): void {
    navigateToSelection({ from: offset, to: offset });
  }

  /** 目次項目の本文オフセットへ移動し、分割プレビューの見出し位置も揃える。
   * @param offset - 見出しの開始位置を示すMarkdown本文内のUTF-16オフセット。
   */
  function goToOutlineOffset(offset: number): void {
    const nextSelection = { from: offset, to: offset };
    if (mode === "preview" && isMarpDocument) {
      marpPreviewRef.current?.scrollToOffset(offset);
      return;
    }
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
         */
        () => {
          window.requestAnimationFrame(
            /**
             * 次の描画フレームで表示更新を実行する。
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
   */
  function revealOutlineInSplitPreview(
    offset: number,
    alignWithSource: boolean,
  ): void {
    const preview = splitPreviewRef.current;
    if (!preview) return;
    if (isMarpDocument) {
      const anchor = marpPreviewRef.current?.captureViewport() ?? {
        offset,
        topOffset: 18,
      };
      viewportStateRef.current.splitPreview = anchor;
      pendingPreviewViewportRestoreRef.current.splitPreview = undefined;
      pendingRenderedPreviewKindsRef.current.delete("splitPreview");
      pendingViewportRestoreRef.current = false;
      marpPreviewRef.current?.scrollToOffset(offset);
      return;
    }
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

  /** 診断行を本文オフセットへ変換し、その行へ移動する。
   * @param line - 診断が示す1始まりのMarkdown行番号。
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
   */
  function updateMarkdown(
    nextText: string,
    knownChanges?: TextChange[],
    origin: "local" | "remote" = "local",
    updateRenderedState = true,
    trustedEditorChanges = false,
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
    if (origin === "local" && !trustedEditorChanges) {
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
    restoreRenderFormatForConversion(nextText);
    if (updateRenderedState) {
      stagePreviewViewportRestore();
      setMarkdown(nextText);
    }
    if (origin === "local") {
      sendNextLocalOperation(
        trustedEditorChanges
          ? { baseText: previous, resultText: nextText, changes }
          : undefined,
      );
    }
  }

  updateMarkdownRef.current = updateMarkdown;

  /**
   * ローカル本文の変更を差分操作にしてHostへ送信する。
   */
  function sendNextLocalOperation(changeHint?: {
    baseText: string;
    resultText: string;
    changes: TextChange[];
  }): void {
    if (resyncInFlightRef.current || inFlightOperationRef.current) return;
    const baseText = hostTextRef.current;
    const resultText = localTextRef.current;
    if (baseText === resultText) return;
    const changes =
      changeHint?.baseText === baseText && changeHint.resultText === resultText
        ? changeHint.changes
        : computeTextChanges(baseText, resultText);
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

  /** 本文変更前後で同じ内容を指すよう、保存済み表示位置のオフセットを写像する。
   * @param changes - 本文へ適用する変更範囲の一覧。
   * @param baseLength - changesを計算した変更前本文のUTF-16文字数。
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

  /** 現在のレイアウトに表示中の本文・プレビュー位置を保存する。
   */
  function captureVisibleViewports(): void {
    const currentMarpViewport = marpPreviewRef.current?.isMarkdownRendered(
      localTextRef.current,
    )
      ? marpPreviewRef.current.captureViewport()
      : undefined;
    if (mode === "split" && splitView !== "preview") {
      viewportStateRef.current.source =
        sourceRef.current?.getViewport() ?? viewportStateRef.current.source;
    }
    if (mode === "split" && splitView !== "text" && splitPreviewRef.current) {
      viewportStateRef.current.splitPreview =
        (isMarpDocument
          ? currentMarpViewport
          : capturePreviewViewport(splitPreviewRef.current)) ??
        viewportStateRef.current.splitPreview;
    }
    if (mode === "preview" && editorAreaRef.current) {
      viewportStateRef.current.previewOnly =
        (isMarpDocument
          ? currentMarpViewport
          : capturePreviewViewport(editorAreaRef.current)) ??
        viewportStateRef.current.previewOnly;
    }
  }

  /** 現在のレイアウトに対応する保存済み本文・プレビュー位置を復元する。 */
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

  /** 描画完了後に適用するプレビュー位置アンカーを退避する。 */
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

  /** 描画精緻化前に実測位置を保存し、完了後の復元位置として登録する。 */
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
    const marpPreview = marpPreviewRef.current;
    if (marpPreview && !marpPreview.isMarkdownRendered(localTextRef.current))
      return;
    const previewAnchor = marpPreview
      ? { offset: anchor.offset, topOffset: 0 }
      : {
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
   */
  function handlePreviewScroll(
    kind: "splitPreview" | "previewOnly",
    container: HTMLElement,
  ): void {
    const startedAt = performance.now();
    if (isMarpDocument) {
      const programmatic = programmaticPreviewScrollsRef.current.has(container);
      const explicitUserIntent =
        previewUserScrollPendingRef.current.has(container) ||
        previewPointerScrollActiveRef.current.has(container) ||
        previewTouchScrollActiveRef.current.has(container);
      if (!programmatic && explicitUserIntent) {
        cancelPendingCrossPaneScrollSync();
        cancelPendingRenderedPreviewRestore();
        viewportUserIntentGenerationRef.current += 1;
        lastPreviewUserScrollAtRef.current = performance.now();
      }
      if (programmatic) programmaticPreviewScrollsRef.current.delete(container);
      const anchor = marpPreviewRef.current?.isMarkdownRendered(
        localTextRef.current,
      )
        ? marpPreviewRef.current.captureViewport()
        : undefined;
      if (anchor) viewportStateRef.current[kind] = anchor;
      if (!programmatic) {
        previewUserScrollPendingRef.current.delete(container);
        schedulePersistViewState();
      }
      performance.clearMeasures("mve-preview-scroll-handler");
      performance.measure("mve-preview-scroll-handler", {
        start: startedAt,
        end: performance.now(),
      });
      return;
    }
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
   */
  function schedulePreviewToSourceSync(anchor: PreviewViewportAnchor): void {
    if (!scrollSyncEnabledRef.current) return;
    const marpSync = Boolean(marpPreviewRef.current);
    const sourceMarkdown = localTextRef.current;
    if (marpSync && !marpPreviewRef.current?.isMarkdownRendered(sourceMarkdown))
      return;
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
       */
      () => {
        previewToSourceSyncTimerRef.current = undefined;
        lastPreviewToSourceSyncRef.current = performance.now();
        const pending = pendingPreviewToSourceAnchorRef.current;
        pendingPreviewToSourceAnchorRef.current = undefined;
        if (!scrollSyncEnabledRef.current || !pending) return;
        if (
          marpSync &&
          (sourceMarkdown !== localTextRef.current ||
            !marpPreviewRef.current?.isMarkdownRendered(sourceMarkdown))
        )
          return;
        mveDebug("preview.scroll.sync-source", { pending });
        restoreSource(pending);
      },
      delay,
    );
  }

  /**
   * Webviewルートの処理順序と完了状態を管理する。
   * @param anchor - 本文エディター側で取得し、プレビューへ同期する保留中の可視位置アンカー。
   */
  function scheduleSourceToPreviewSync(anchor: EditorViewportAnchor): void {
    if (!scrollSyncEnabledRef.current) return;
    const marpSync = Boolean(marpPreviewRef.current);
    const sourceMarkdown = localTextRef.current;
    if (marpSync && !marpPreviewRef.current?.isMarkdownRendered(sourceMarkdown))
      return;
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
       */
      () => {
        sourceToPreviewSyncTimerRef.current = undefined;
        lastSourceToPreviewSyncRef.current = performance.now();
        const pending = pendingSourceToPreviewAnchorRef.current;
        pendingSourceToPreviewAnchorRef.current = undefined;
        const preview = splitPreviewRef.current;
        if (!scrollSyncEnabledRef.current || !pending || !preview) return;
        if (marpSync && sourceMarkdown !== localTextRef.current) return;
        const marpPreview = marpPreviewRef.current;
        if (marpPreview) {
          if (!marpPreview.isMarkdownRendered(localTextRef.current)) return;
          marpPreview.scrollToOffset(pending.offset, 0, true);
          return;
        }
        if (marpSync) return;
        programmaticPreviewScrollsRef.current.add(preview);
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
    clearTimeoutRef(previewToSourceSyncTimerRef);
    clearTimeoutRef(sourceToPreviewSyncTimerRef);
    pendingPreviewToSourceAnchorRef.current = undefined;
    pendingSourceToPreviewAnchorRef.current = undefined;
  }

  /**
   * Webviewルートの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param nextSettings - Webviewルートへ渡す設定または境界値。
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
      pendingHtmlSettings.showOutlineSidebar ===
        nextHtmlSettings.showOutlineSidebar &&
      pendingHtmlSettings.saveWithoutDialog ===
        nextHtmlSettings.saveWithoutDialog
    ) {
      pendingHtmlOptionsRef.current = undefined;
    }
    // 起動直後のinit再送など内容が同じ設定では前の参照を保ち、再レンダーと設定依存effectの再実行を避ける。
    const effectiveHtmlOptions = reuseIfStructurallyEqual(
      htmlOptionsRef.current,
      mergeHtmlExportOptions(htmlOptionsRef.current, effectiveHtmlSettings),
    );
    htmlOptionsRef.current = effectiveHtmlOptions;
    setHtmlOptions(effectiveHtmlOptions);
    // HTML設定と同じく、保存待ちの値と一致する通知が届くまでは画面の値を優先する。
    const nextDocxSettings = normalizeDocxExportSettings(
      nextSettings.docxOptions,
    );
    const pendingDocxSettings = pendingDocxOptionsRef.current;
    const effectiveDocxSettings = reuseIfStructurallyEqual(
      docxOptionsRef.current,
      pendingDocxSettings ?? nextDocxSettings,
    );
    if (
      pendingDocxSettings &&
      pendingDocxSettings.saveWithoutDialog ===
        nextDocxSettings.saveWithoutDialog
    ) {
      pendingDocxOptionsRef.current = undefined;
    }
    docxOptionsRef.current = effectiveDocxSettings;
    setDocxOptions(effectiveDocxSettings);
    // 自分の入力を保存するまでの間に届いた古いsettingsChangedで、画面の最新値を戻さない。
    const hasPendingPdfOptions =
      pdfOptionsPersistTimerRef.current !== undefined;
    const effectivePdfOptions = hasPendingPdfOptions
      ? pdfOptionsRef.current
      : nextPdfOptions;
    if (!hasPendingPdfOptions) {
      pdfOptionsRef.current = reuseIfStructurallyEqual(
        pdfOptionsRef.current,
        nextPdfOptions,
      );
      setPdfOptions(pdfOptionsRef.current);
    }
    const mergedSettings = {
      ...nextSettings,
      htmlOptions: effectiveHtmlSettings,
      docxOptions: effectiveDocxSettings,
      pdfOptions: effectivePdfOptions,
    };
    setSettings(
      /**
       * 内容が同じなら現在の設定オブジェクトを返し、Reactに更新を省かせる。
       * @param current - 現在の設定。
       * @returns 反映する設定。
       */
      (current) => reuseIfStructurallyEqual(current, mergedSettings),
    );
  }

  /**
   * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
   * @param nextOptions - Webviewルートへ渡す設定または境界値。
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
      currentSettings.showOutlineSidebar !== nextSettings.showOutlineSidebar ||
      currentSettings.saveWithoutDialog !== nextSettings.saveWithoutDialog
    ) {
      pendingHtmlOptionsRef.current = nextSettings;
      vscode.postMessage({ type: "setHtmlOptions", options: nextSettings });
    }
  }

  /**
   * リボンのDOCX「保存ダイアログなし」の切替を画面へ即時反映し、値が変わった場合だけHostへ保存を依頼する。
   * @param enabled - 保存ダイアログを省略するかどうか。
   */
  function handleDocxSaveWithoutDialogChange(enabled: boolean): void {
    if (docxOptionsRef.current.saveWithoutDialog === enabled) return;
    const nextSettings: DocxExportSettings = { saveWithoutDialog: enabled };
    docxOptionsRef.current = nextSettings;
    setDocxOptions(nextSettings);
    pendingDocxOptionsRef.current = nextSettings;
    vscode.postMessage({ type: "setDocxOptions", options: nextSettings });
  }

  /**
   * Webviewルートの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param anchor - 本文エディターへ復元する可視位置アンカー。
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
   */
  function restorePreview(
    container: HTMLElement,
    anchor: PreviewViewportAnchor,
  ): void {
    if (isMarpDocument) {
      marpPreviewRef.current?.scrollToOffset(anchor.offset, anchor.topOffset);
      return;
    }
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
   */
  function handlePreviewRendered(kind: "splitPreview" | "previewOnly"): void {
    const currentRenderedMarkdown = isMarpDocument
      ? marpPreviewMarkdown
      : renderedPreviewMarkdown;
    if (
      settings.startupProbe &&
      initialized &&
      !startupReportedRef.current &&
      (isMarpDocument || currentRenderedMarkdown === localTextRef.current)
    ) {
      startupReportedRef.current = true;
      vscode.postMessage({
        type: "startupReady",
        clientId: clientIdRef.current,
        markdownLength: currentRenderedMarkdown.length,
        metrics: collectStartupMetrics(startupInitReceivedAtRef.current),
      });
    }
    pendingRenderedPreviewKindsRef.current.add(kind);
    scheduleRenderedPreviewRestore();
  }

  /**
   * Webviewルートのイベントまたはメッセージを受け取り、状態を更新する。
   */
  function handleStartupMermaidRendered(): void {
    if (!settings.startupProbe) return;
    if (!startupMermaidReportedRef.current) {
      startupMermaidReportedRef.current = true;
      vscode.postMessage({
        type: "startupMermaidReady",
        clientId: clientIdRef.current,
      });
    }
    if (startupVisibleMermaidReportedRef.current) return;
    const visible = countVisibleMermaidNodes(splitPreviewRef.current);
    if (!visible || visible.pending > 0) return;
    startupVisibleMermaidReportedRef.current = true;
    vscode.postMessage({
      type: "startupVisibleMermaidReady",
      clientId: clientIdRef.current,
      visibleCount: visible.total,
    });
  }

  /**
   * Webviewルートの処理順序と完了状態を管理する。
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
       */
      () => {
        renderedPreviewRestoreFrameRef.current = undefined;
        const kinds = Array.from(pendingRenderedPreviewKindsRef.current);
        pendingRenderedPreviewKindsRef.current.clear();
        kinds.forEach(
          /**
           * 分割表示とプレビュー単独表示を区別して位置を復元する。
           * @param pendingKind - 復元するプレビュー種別。分割表示かプレビュー単独表示を示す。
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
    cancelAnimationFrameRef(renderedPreviewRestoreFrameRef);
    clearTimeoutRef(renderedPreviewRestoreTimerRef);
    pendingRenderedPreviewKindsRef.current.clear();
  }

  /**
   * Webviewルートの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
   * @param kind - 復元するプレビュー領域。splitPreviewまたはpreviewOnly。
   * @param container - 保留中の位置アンカーを適用するプレビューコンテナー。
   */
  function restorePendingPreview(
    kind: "splitPreview" | "previewOnly",
    container: HTMLElement,
  ): void {
    if (
      marpPreviewRef.current &&
      !marpPreviewRef.current.isMarkdownRendered(localTextRef.current)
    )
      return;
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
     */ (moveEvent: PointerEvent) => {
      const bounds = container.getBoundingClientRect();
      if (bounds.width) {
        pendingViewportRestoreRef.current = true;
        setSplitRatio(
          clampSplitRatio((moveEvent.clientX - bounds.left) / bounds.width),
        );
      }
    };

    const end = () => {
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
   * ソース面の右クリックでは選択範囲と本文指紋をHostへ送り、見出し上では見出しIDに対応するメニューを開く。
   * @param event - 右クリックされたソース面またはアウトライン要素のマウスイベント。
   */
  function handleSectionContextMenu(
    event: React.MouseEvent<HTMLDivElement>,
  ): void {
    if (!(event.target instanceof Element)) return;
    if (
      event.nativeEvent.button === 2 &&
      outlineDisclosureRightPointerRef.current
    ) {
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
  const marpImageResizeEnabled =
    (imageResizeEnabled || mode === "preview") &&
    marpPreviewMarkdown === markdown;
  const splitPreviewImageResize = useCallback(
    /**
     * @param imageIndex - Markdown本文内でサイズを変更するプレビュー画像の0始まりインデックス。
     * @param width - 表示領域または列の幅。
     */
    (imageIndex: number, width: number) => {
      if (imageResizeEnabled) resizePreviewImage(imageIndex, width);
    },
    [imageResizeEnabled, mode, splitView],
  );
  const splitMarpPreviewImageResize = useCallback(
    (
      imageIndex: number,
      width: number,
      sourceMarkdown: string,
      target: MarpImageResizeTarget,
    ) => {
      if (imageResizeEnabled && sourceMarkdown === localTextRef.current) {
        const viewportAnchor = marpPreviewRef.current?.captureViewport();
        if (viewportAnchor) {
          viewportStateRef.current.splitPreview = viewportAnchor;
        }
        updateMarkdownRef.current(
          resizeMarpImageInMarkdown(
            localTextRef.current,
            imageIndex,
            width,
            target,
          ),
        );
      }
    },
    [imageResizeEnabled, mode, splitView],
  );
  const previewMarpPreviewImageResize = useCallback(
    (
      imageIndex: number,
      width: number,
      sourceMarkdown: string,
      target: MarpImageResizeTarget,
    ) => {
      if (
        marpImageResizeEnabled &&
        mode === "preview" &&
        sourceMarkdown === localTextRef.current
      ) {
        const viewportAnchor = marpPreviewRef.current?.captureViewport();
        if (viewportAnchor) {
          viewportStateRef.current.previewOnly = viewportAnchor;
        }
        updateMarkdownRef.current(
          resizeMarpImageInMarkdown(
            localTextRef.current,
            imageIndex,
            width,
            target,
          ),
        );
      }
    },
    [marpImageResizeEnabled, mode],
  );
  const splitPreviewImageReset = useCallback(
    /**
     * @param imageIndex - Markdown本文内で元のサイズへ戻すプレビュー画像の0始まりインデックス。
     */
    (imageIndex: number) => {
      if (imageResizeEnabled) resetPreviewImage(imageIndex);
    },
    [imageResizeEnabled, mode, splitView],
  );
  const splitPreviewImageAlign = useCallback(
    /**
     * @param imageIndex - Markdown本文内で配置を変えるプレビュー画像の0始まりインデックス。
     * @param alignment - 画像を左・中央・右のどこへ配置するかを示す値。
     */
    (imageIndex: number, alignment: ImageAlignment) => {
      if (imageResizeEnabled) alignPreviewImage(imageIndex, alignment);
    },
    [imageResizeEnabled, mode, splitView],
  );
  const splitPreviewInspect = useCallback(
    /**
     * @param target - プレビューで選択されたMermaid図、数式、画像のInspector対象。
     */
    (target: InspectorTarget) => changeInspector(target),
    [mode, splitView],
  );
  const splitPreviewNavigate = useCallback(
    /**
     * @param href - プレビュー内で開くMarkdownリンクのhref文字列。
     */
    (href: string, workspaceRooted = false, internal = false) =>
      vscode.postMessage({
        type: "openResource",
        href,
        workspaceRooted,
        internal,
      }),
    [],
  );
  const splitMarpActiveSlide = useCallback(
    /**
     * Marpで現在表示中のスライド範囲を既存の本文スクロール同期へ渡す。
     * @param range - 表示中のスライドとMarkdown本文の対応範囲。
     * @param sourceMarkdown - スライド位置の生成元。現在本文と異なる間は同期を保留する。
     */
    (range: MarpSlideSourceRange, sourceMarkdown: string) => {
      if (
        mode !== "split" ||
        splitView !== "both" ||
        sourceMarkdown !== localTextRef.current
      )
        return;
      schedulePreviewToSourceSync({ offset: range.startOffset, topOffset: 0 });
    },
    [mode, splitView],
  );
  const previewOnlyMarpActiveSlide = useCallback(
    /**
     * Marpのプレビュー専用表示で現在のスライド位置を既存の同期経路へ渡す。
     * @param range - 表示中のスライドとMarkdown本文の対応範囲。
     * @param sourceMarkdown - スライド位置の生成元。現在本文と異なる間は同期を保留する。
     */
    (range: MarpSlideSourceRange, sourceMarkdown: string) => {
      if (mode !== "preview" || sourceMarkdown !== localTextRef.current) return;
      schedulePreviewToSourceSync({ offset: range.startOffset, topOffset: 0 });
    },
    [mode],
  );
  const splitPreviewRendered = useCallback(
    () => handlePreviewRendered("splitPreview"),
    [
      initialized,
      isMarpDocument,
      marpPreviewMarkdown,
      mode,
      previewMarkdown,
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
      let trustedEditorChanges = false;
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
        } else {
          trustedEditorChanges = true;
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
        trustedEditorChanges,
      );
    },
    [],
  );
  const sourceEditorSettled = useCallback(() => {
    stagePreviewViewportRestore();
    setMarkdown(localTextRef.current);
    delete document.body.dataset.mveInputActive;
    window.dispatchEvent(new Event("mve-preview-input-settled"));
  }, []);

  const sourceEditorSelectionChange = useCallback(
    /**
     * UIイベントを表示または編集状態へ反映する。
     * @param nextSelection CodeMirrorとプレビューへ反映する新しい選択範囲。
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

           * @param key - 選択範囲に適用中のMarkdown書式名。
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
     * @param anchor - 本文エディターから通知された可視位置アンカー。
     * @param userInitiated - ユーザー操作で始まったスクロールならtrue。
     */
    (anchor: EditorViewportAnchor, userInitiated: boolean) =>
      handleSourceViewport(anchor, userInitiated),
    [isMarpDocument, mode, splitView],
  );
  const sourceEditorUserScrollIntent = useCallback(() => {
    cancelPendingCrossPaneScrollSync();
    cancelPendingRenderedPreviewRestore();
    viewportUserIntentGenerationRef.current += 1;
    sourceViewportIntentGenerationRef.current =
      viewportUserIntentGenerationRef.current;
    pendingSourceViewportRestoreRef.current = undefined;
    skipNextSourceViewportRestoreRef.current = false;
    pendingPreviewViewportRestoreRef.current = {};
    pendingViewportRestoreRef.current = false;
  }, []);

  /**
   * 本文エディターでCtrl+クリックされたリンクを開く最新の処理。
   * 表示モードやアウトラインに依存するため描画ごとに差し替え、SourceEditorへは下の安定した関数だけを渡す
   * （React.memoのSourceEditorを再描画させないため）。
   * `#見出し` だけのリンクは同じ文書の見出しへ移動し、それ以外はプレビューのリンクと同じopenResourceでHostへ委ねる。
   * 見出しIDは、プレビューの描画結果に合わせたアウトライン（previewSnapshot由来）で照合する。
   * プレビューはDOMの任意のidへ移動できるが、こちらはアウトラインに載る見出しだけが対象で、
   * HTMLのid属性や脚注、アウトラインに載らない見出しへのリンクは何もしない。
   * アウトラインはプレビューの描画後に更新されるため、入力直後は見出しの位置が描画前のままのことがある。
   */
  const openEditorLinkRef = useRef<(link: EditorLinkTarget) => void>(undefined);
  openEditorLinkRef.current = (link: EditorLinkTarget) => {
    if (link.href.startsWith("#")) {
      let id = link.href.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        // 不正な%エスケープを含むIDも文字列のまま照合する。
      }
      const heading = outline.find(
        /**
         * @param item - 照合するアウトライン項目。
         * @returns 見出しIDが一致すればtrue。
         */
        (item) => item.id === id,
      );
      if (heading) goToOutlineOffset(heading.offset);
      return;
    }
    vscode.postMessage({
      type: "openResource",
      href: link.href,
      workspaceRooted: link.workspaceRooted,
    });
  };
  const sourceEditorOpenLink = useCallback(
    /**
     * 本文エディターのリンクを、その時点の最新の処理で開く。
     * @param link - Ctrl+クリックされたリンク。
     */
    (link: EditorLinkTarget) => openEditorLinkRef.current?.(link),
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
        textileDocument={isTextileDocument}
        activeMarks={activeMarks}
        outlineVisible={outlineVisible}
        scrollSyncEnabled={scrollSyncEnabled}
        splitView={splitView}
        htmlOptions={htmlOptions}
        pdfSaveWithoutDialog={pdfOptions.saveWithoutDialog}
        docxOptions={docxOptions}
        onDocxSaveWithoutDialogChange={handleDocxSaveWithoutDialogChange}
        imageDirectory={settings.imageDirectory}
        editorFontFamily={settings.editorFontFamily}
        previewFontFamily={settings.previewFontFamily}
        mermaidFontSize={normalizeMermaidFontSize(settings.mermaidFontSize)}
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
          <OutlinePanel
            messages={messages}
            width={outlineWidth}
            tree={outlineTree}
            collapsedIds={collapsedOutlineIds}
            drag={outlineDrag}
            onClose={
              /** レイアウト復元の準備をしてからアウトラインを閉じる。 */
              () => {
                prepareLayoutRestore();
                setOutlineVisibility(false);
              }
            }
            onToggle={toggleOutlineSection}
            onDisclosureContextMenu={
              /** 開閉ボタン上の右クリックを、並べ替えの開始として扱わない。 */
              () => {
                outlineDisclosureRightPointerRef.current = false;
              }
            }
            onNavigate={goToOutlineOffset}
            onDragStart={beginOutlineDrag}
            onDragMove={updateOutlineDrag}
            onDragEnd={finishOutlineDrag}
            onResizeStart={beginOutlineResize}
            onResizeBy={
              /**
               * アウトラインの幅を変える。
               * @param delta - 変化量（ピクセル）。
               */
              (delta) => setOutlineWidth(
                /**
                 * 現在の幅に変化量を加えて範囲内へ収める。
                 * @param value - 現在の幅。
                 * @returns 新しい幅。
                 */
                (value) => clampOutlineWidth(value + delta))
            }
          />
        ) : (
          <button
            className="outline-reopen"
            type="button"
            title={messages.app.showOutline}
            aria-label={messages.app.showOutline}
            onClick={
              /**
               * click操作を表示または編集状態へ反映する。
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
          onMouseUp={() => {
            selectionStateRef.current =
              getActiveEditor()?.getSelection() ?? selectionStateRef.current;
          }}
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
                 * @param event - preview-only paneのscroll event。
                 */
                (event) =>
                  handlePreviewScroll("previewOnly", event.currentTarget)
              : undefined
          }
        >
          {searchVisible && (
            <SearchPanel
              messages={messages}
              inputRef={searchInputRef}
              query={searchQuery}
              replacement={searchReplacement}
              hitCount={searchHits.length}
              hitIndex={searchIndex}
              onQueryChange={
                /**
                 * 検索語を更新し、一致位置を先頭へ戻す。
                 * @param value - 新しい検索語。
                 */
                (value) => {
                  setSearchQuery(value);
                  setSearchIndex(0);
                }
              }
              onReplacementChange={setSearchReplacement}
              onJump={jumpToSearch}
              onReplace={replaceSearch}
              onClose={closeSearch}
            />
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
                  renderFormat={renderFormat}
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
                  onOpenLink={sourceEditorOpenLink}
                  onRequestLinkFiles={linkCompletionClient.requestFiles}
                  onRequestLinkHeadings={linkCompletionClient.requestHeadings}
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
                   */
                  (event) => {
                    if (
                      event.key === "ArrowLeft" ||
                      event.key === "ArrowRight"
                    ) {
                      prepareLayoutRestore();
                      setSplitRatio(
                        /**
                         * @param value - キー操作前の左右ペイン分割比率。
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
                   * @param event - split previewのscroll event。
                   */
                  (event) =>
                    handlePreviewScroll("splitPreview", event.currentTarget)
                }
              >
                {isMarpDocument ? (
                  <MarpPreview
                    ref={marpPreviewRef}
                    markdown={marpPreviewMarkdown}
                    settings={settings}
                    messages={messages}
                    zoom={zoom}
                    onStartupStage={reportMarpStartupStage}
                    scrollContainerRef={splitPreviewRef}
                    onImageResize={
                      marpImageResizeEnabled
                        ? splitMarpPreviewImageResize
                        : undefined
                    }
                    onNavigate={splitPreviewNavigate}
                    onRendered={splitPreviewRendered}
                    onActiveSlide={splitMarpActiveSlide}
                  />
                ) : marpDetectionFailed ? (
                  <p className="mve-marp-preview-error" role="alert">
                    {messages.app.marpPreview.detectionFailed}
                  </p>
                ) : marpDetectionLoading ? (
                  <p
                    className="mve-marp-preview-loading mve-marp-detection-loading"
                    role="status"
                    aria-live="polite"
                  >
                    {messages.app.marpPreview.loading}
                  </p>
                ) : (
                  <RenderedMarkdown
                    markdown={renderedPreviewMarkdown}
                    renderFormat={renderFormat}
                    html={previewHtml}
                    settings={settings}
                    imageZoom={zoom}
                    onImageResize={
                      imageResizeEnabled && !isTextileDocument
                        ? splitPreviewImageResize
                        : undefined
                    }
                    onImageReset={
                      imageResizeEnabled && !isTextileDocument
                        ? splitPreviewImageReset
                        : undefined
                    }
                    onImageAlign={
                      imageResizeEnabled && !isTextileDocument
                        ? splitPreviewImageAlign
                        : undefined
                    }
                    onInspect={splitPreviewInspect}
                    onNavigate={splitPreviewNavigate}
                    onRendered={splitPreviewRendered}
                    onMermaidRendered={handleStartupMermaidRendered}
                    deferMermaid
                  />
                )}
              </div>
            </div>
          )}
          {mode === "preview" &&
            (isMarpDocument ? (
              <MarpPreview
                ref={marpPreviewRef}
                className="mve-marp-preview-print"
                markdown={marpPreviewMarkdown}
                settings={settings}
                messages={messages}
                zoom={zoom}
                onStartupStage={reportMarpStartupStage}
                scrollContainerRef={editorAreaRef}
                onImageResize={
                  marpImageResizeEnabled
                    ? previewMarpPreviewImageResize
                    : undefined
                }
                showZoomControls
                onZoom={adjustZoom}
                onNavigate={(href, workspaceRooted = false, internal = false) =>
                  vscode.postMessage({
                    type: "openResource",
                    href,
                    workspaceRooted,
                    internal,
                  })
                }
                onRendered={() => handlePreviewRendered("previewOnly")}
                onActiveSlide={previewOnlyMarpActiveSlide}
              />
            ) : marpDetectionFailed ? (
              <p className="mve-marp-preview-error" role="alert">
                {messages.app.marpPreview.detectionFailed}
              </p>
            ) : marpDetectionLoading ? (
              <p
                className="mve-marp-preview-loading mve-marp-detection-loading"
                role="status"
                aria-live="polite"
              >
                {messages.app.marpPreview.loading}
              </p>
            ) : (
              <PdfPreview
                markdown={renderedPreviewMarkdown}
                renderFormat={renderFormat}
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
                   * @param target - プレビューで選択されたMermaid図、数式、画像のInspector対象。
                   */
                  (target) => changeInspector(target)
                }
                onNavigate={
                  /**
                   * @param href - PDFプレビュー内で開くMarkdownリンクのhref文字列。
                   */
                  (href, workspaceRooted = false) =>
                    vscode.postMessage({
                      type: "openResource",
                      href,
                      workspaceRooted,
                    })
                }
                onZoom={adjustZoom}
                onRendered={() => handlePreviewRendered("previewOnly")}
              />
            ))}
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
               */
              () => changeInspector(undefined)
            }
            onOpenResource={
              /**
               * @param href - Inspectorから開くMarkdownリソースのhref文字列。
               */
              (href) => vscode.postMessage({ type: "openResource", href })
            }
          />
        )}
        {diagnosticsVisible && (
          <DiagnosticsPanel
            messages={messages}
            diagnostics={diagnostics}
            summary={diagnosticSummary}
            onGoToLine={goToDiagnosticLine}
            onClose={
              /** レイアウト復元の準備をしてから閉じる。 */
              () => {
                prepareLayoutRestore();
                setDiagnosticsVisible(false);
              }
            }
          />
        )}
        {printSettingsVisible && (
          <PrintSettingsPanel
            messages={messages}
            pdfOptions={pdfOptions}
            updatePdfOptions={updatePdfOptions}
            onClose={
              /** 保留中の設定保存を確定してから閉じる。 */
              () => {
                flushPdfOptionsPersistence();
                setPrintSettingsVisible(false);
              }
            }
            onExportPdf={/** PDF を出力する。 */ () => void requestPdfExport()}
          />
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
      {printPreview && (
        <div className="export-stage" aria-hidden="true">
          <RenderedMarkdown
            markdown={renderedPreviewMarkdown}
            renderFormat={renderFormat}
            html={previewHtml}
            settings={exportSettings}
            onRendered={handleExportRendered}
          />
        </div>
      )}
      {helpTopic && (
        <HelpDialog
          topic={helpTopic}
          messages={messages}
          onClose={() => setHelpTopic(undefined)}
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
          onClose={() => setLinkDialogVisible(false)}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {sectionLinkMenu && (
        <SectionLinkMenu
          messages={messages}
          menu={sectionLinkMenu}
          menuRef={sectionLinkMenuRef}
          onCopy={
            /**
             * 見出しのリンクのコピーを Host へ依頼し、メニューを閉じる。
             * @param scope - 同じ文書内のリンクか、ワークスペース基準のリンクか。
             */
            (scope) => {
              vscode.postMessage({
                type: "copySectionLink",
                scope,
                id: sectionLinkMenu.id,
                text: sectionLinkMenu.text,
              });
              setSectionLinkMenu(undefined);
            }
          }
        />
      )}
    </div>
  );
}

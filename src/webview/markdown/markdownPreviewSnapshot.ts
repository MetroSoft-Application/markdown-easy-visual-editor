/**
 * @fileoverview Markdown プレビューの描画スナップショットを管理する Webview 側モジュール。
 * 描画 Worker の先行起動・投機的な初回描画・世代管理付きの再描画を担当し、古い世代の結果を破棄する不変条件を守る。
 * Worker と Blob URL はモジュール単位で共有し、起動計測（performance mark）を副作用として記録する。
 */
import type { WebviewSettings } from "../../shared/protocol";
import type { MarkdownRenderFormat, UnsafeMarkdownBlock } from "./markdownRendererCore";
import type { MarkdownPreviewSnapshot, MarkdownWorkerResponse } from "./markdownPreviewTypes";
import { getRenderFormatForUri, readWebviewBootstrap, vscode } from "../runtime/webviewState";
import { useCallback, useEffect, useRef, useState } from "react";
import { renderMarkdownFallback } from "./markdownFallback";
import { escapeHtml } from "../../shared/escapeHtml";
import { getOutlineForFormat } from "./markdownOutline";
import { collectDiagnostics, type Diagnostic, type OutlineItem, wordStats } from "../../shared/markdown";
import { recordLatestPerformanceMark, recordLatestPerformanceMeasure, recordPerformanceDuration } from "../runtime/performanceMetrics";
import { restoreViewMode } from "../components/appHelpers";
import { hasMarpFrontMatterCandidate } from "../../shared/marpFrontMatter";
import { sanitizeRenderedMarkdown } from "./markdownSanitizer";

/**
 * Web WorkerでMarkdownプレビューを更新し、古い世代の結果を破棄しながら最新のスナップショットを返す。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param remoteImagesEnabled - リモート画像を出力へ含める場合はtrue。
 * @param language - プレビュー内のコードブロックに適用する表示言語コード。
 * @param renderFormat - 本文の記法。markdown または textile で、Worker の解析経路を切り替える。
 * @param enabled - 現在の表示モードでWorker描画が必要な場合はtrue。
 * @param onBeforeRefinement - Worker描画の精緻化結果を反映する直前に、プレビュー位置などを退避する処理。
 * @returns 最新の描画スナップショットと、保留中の描画を中断する関数。
 */
export function useMarkdownPreviewSnapshot(
  markdown: string,
  remoteImagesEnabled: boolean,
  language: WebviewSettings["language"],
  renderFormat: MarkdownRenderFormat,
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
  const cancelSanitizationRef = useRef<() => void>(() => undefined);
  const generationRef = useRef(0);
  const onBeforeRefinementRef = useRef(onBeforeRefinement);
  onBeforeRefinementRef.current = onBeforeRefinement;
  /** workerRef が highlight.js を含む rich Worker なら true。 */
  const workerIsRichRef = useRef(false);
  /** rich Worker への差し替えを準備中なら true。二重起動を防ぐ。 */
  const promotingRef = useRef(false);
  /** hook のアンマウント後に届いた非同期結果で Worker を残さないための印。 */
  const disposedRef = useRef(false);

  /**
   * 軽量Workerの結果を最終結果として使った後、以降の編集を従来どおりrich Workerの1回描画で処理できるよう、
   * バックグラウンドでrich Workerを起動して差し替える。描画中・世代変更・アンマウント時は差し替えず、起動したWorkerを破棄する。
   * 取得や起動に失敗した場合は軽量Workerを使い続け、ハイライトが必要な描画では従来どおりrich Workerの起動とフォールバックを行う。
   * @param lightWorker - 現在workerRefに入っている軽量Worker。差し替え時点でも同じ個体である場合だけ差し替える。
   */
  const promoteToRichWorker = useCallback((lightWorker: Worker) => {
    if (promotingRef.current || richWorkerPromotionUnavailable) return;
    promotingRef.current = true;
    // 本文の予測で先行起動したrich Workerがあれば、先行描画の完了とエラー有無を確認してから再利用する。
    // エラー済みなら破棄して新しく起動し、停止したWorkerを描画に使わない。
    const speculativeRich = takeSpeculativeRichRender();
    const richWorkerPromise = speculativeRich
      ? settleSpeculativeRender(speculativeRich).then(
          /**
           * 先行rich描画が成功していればそのWorkerを、失敗していれば新しいWorkerを返す。
           * @param outcome - 先行rich描画の確定結果。
           * @returns 差し替えに使うrich Worker。
           */
          (outcome) => {
            if (!("error" in outcome)) return speculativeRich.worker;
            void speculativeRich.worker.then(
              /**
               * 失敗した先行rich Workerを終了する。
               * @param worker - 先行rich Worker。
               */
              (worker) => worker.terminate(),
              () => undefined,
            );
            return acquireMarkdownWorker(true);
          },
        )
      : acquireMarkdownWorker(true);
    void richWorkerPromise.then(
      /**
       * 起動したrich Workerを、軽量Workerが待機中の場合だけ採用する。
       * @param richWorker - 差し替えに使うrich Worker。
       */
      (richWorker) => {
        promotingRef.current = false;
        if (
          disposedRef.current ||
          workerRef.current !== lightWorker ||
          workerBusyRef.current
        ) {
          richWorker.terminate();
          return;
        }
        // スクリプト評価の失敗は描画要求より前に起こり得る。待機中なら破棄し、次の描画で軽量Workerから取り直す。
        richWorker.addEventListener(
          "error",
          /**
           * 待機中に失敗したrich Workerを外す。描画中ならonerrorがフォールバックを担う。
           */
          () => {
            if (workerRef.current !== richWorker || workerBusyRef.current)
              return;
            richWorker.terminate();
            workerRef.current = undefined;
            workerIsRichRef.current = false;
          },
        );
        lightWorker.terminate();
        workerRef.current = richWorker;
        workerIsRichRef.current = true;
      },
      () => {
        promotingRef.current = false;
        // 取得できない環境で編集のたびに再取得しないよう、このセッションでは差し替えを諦める。
        // ハイライトが必要な描画では、従来どおりrich Workerの起動とフォールバックが行われる。
        richWorkerPromotionUnavailable = true;
      },
    );
  }, []);

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

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     */
    () => {
      cancelActiveRender();
      if (!enabled) return;
      const id = generationRef.current;
      const startedAt = performance.now();

      const applySynchronousFallback = /**
       * Worker を使えない場合に同期描画へ切り替える。古い世代の要求なら何もしない。
       * @param error - 処理に失敗した理由または例外。
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
            renderFormat,
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
          outline: getOutlineForFormat(
            markdown,
            renderFormat,
            [...headingIds].map(([offset, headingId]) => ({
              html: "",
              headingOffset: offset,
              headingId,
              requiresSanitization: false,
            })),
          ),
          diagnostics: collectDiagnostics(markdown, language),
          stats: wordStats(markdown),
          preliminary: false,
        });
        recordLatestPerformanceMeasure(
          "mve-preview-markdown",
          fallbackStartedAt,
        );
      };

      const startWorker = /**
       * 描画 Worker を取得（必要なら生成）し、現在の世代の描画要求を送る。
       * @param rich - リッチMarkdown用Workerを選ぶ場合はtrue。
       * @param refinement - 完成HTMLの反映として描画する場合はtrue。初回の簡易描画はfalse。
       * @returns 戻り値はなく、Workerの生成または再利用を開始する。
       */ async (rich = false, refinement = false) => {
        try {
          let worker = workerRef.current;
          let adopted: SpeculativeFirstRender | undefined;
          if (!worker) {
            document.body.dataset.mveMarkdownWorkerStatus = "loading";
            // マウント前に同じ入力で始めた先行描画があれば、そのWorkerと結果を引き継ぐ。
            adopted = takeSpeculativeFirstRender(
              rich ? "rich" : "light",
              /**
               * 先行描画が残っている場合だけ照合キーを作る。本文全体の文字列化を通常の編集で繰り返さないため。
               * @returns この描画要求の照合キー。
               */
              () =>
                markdownRenderKey(markdown, {
                  remoteImagesEnabled,
                  language,
                  renderFormat,
                }),
            );
            worker = adopted
              ? await adopted.worker
              : await acquireMarkdownWorker(rich);
            if (generationRef.current !== id) {
              worker.terminate();
              return;
            }
            workerRef.current = worker;
            workerIsRichRef.current = rich;
          }
          if (generationRef.current !== id) return;
          workerBusyRef.current = true;
          document.body.dataset.mveMarkdownWorkerStatus = "running";
          worker.onmessage =
            /**
             * @param event - Markdown rendering workerから応答を受信するmessage event。
             * @returns 戻り値はない。現在の世代の応答だけをスナップショットへ反映する。
             */
            (event: MessageEvent<MarkdownWorkerResponse>) => {
              const response = event.data;
              if (
                response.id !== id ||
                generationRef.current !== id ||
                workerRef.current !== worker
              )
                return;
              // 古い世代や先行描画IDの応答で計測値を上書きしないよう、受理した応答だけを記録する。
              // 先行描画を引き継いだ場合は、hookが結果を受理した時刻になる。
              recordLatestPerformanceMark("mve-preview-worker-response");
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
              // rich Workerのスクリプト取得を簡易結果のサニタイズと並行して始め、精緻化までの待ちを縮める。
              // 取得失敗はキャッシュに残らず、後続の起動時に従来どおり再取得・フォールバックされる。
              if (preliminary)
                void resolveMarkdownWorkerLaunchUrl(true).catch(
                  () => undefined,
                );
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
                 * 応答を受け付ける前に描画要求IDが現在の世代かを確認する。
                 */
                () => generationRef.current === id,

                /**
                 * @param html - 表示または出力するHTML本文。
                 * @param maximumChunkDuration - 1回のHTMLサニタイズ処理にかかった最長チャンク時間（ミリ秒）。
                 */
                (html, maximumChunkDuration) => {
                  recordLatestPerformanceMark("mve-preview-sanitize-complete");
                  cancelSanitizationRef.current = () => undefined;
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
                    preliminary,
                  });
                  if (preliminary) void startWorker(true, true);
                  else if (
                    !workerIsRichRef.current &&
                    workerRef.current === worker
                  )
                    promoteToRichWorker(worker);
                },
              );
            };
          worker.onerror =
            /**
             * @param event - Markdown rendering workerで処理失敗を受信するerror event。
             * @returns 戻り値はない。現在の Worker の失敗だけを同期描画へのフォールバックとして扱う。
             */
            (event) => {
              if (generationRef.current !== id || workerRef.current !== worker)
                return;
              workerBusyRef.current = false;
              worker.terminate();
              workerRef.current = undefined;
              void applySynchronousFallback(event.message);
            };
          if (adopted) {
            const adoptedWorker = worker;
            const handleMessage = worker.onmessage;
            void settleSpeculativeRender(adopted).then(
              /**
               * 先行描画の結果を、この世代の要求IDの応答として通常の受信処理へ渡す。エラーなら通常のWorker障害と同じくフォールバックする。
               * @param outcome - 先行描画の応答またはエラー。
               */
              (outcome) => {
                if (
                  generationRef.current !== id ||
                  workerRef.current !== adoptedWorker
                )
                  return;
                if ("error" in outcome) {
                  workerBusyRef.current = false;
                  adoptedWorker.terminate();
                  workerRef.current = undefined;
                  void applySynchronousFallback(outcome.error);
                  return;
                }
                handleMessage?.call(
                  adoptedWorker,
                  new MessageEvent("message", {
                    data: { ...outcome.response, id },
                  }),
                );
              },
            );
          } else {
            worker.postMessage({
              id,
              markdown,
              options: { remoteImagesEnabled, language, renderFormat },
            });
          }
        } catch (error) {
          void applySynchronousFallback(error);
        }
      };
      void startWorker();
      return cancelActiveRender;
    },
    [
      markdown,
      remoteImagesEnabled,
      language,
      renderFormat,
      enabled,
      cancelActiveRender,
    ],
  );

  useEffect(
    /**
     * マウント中であることを記録し、アンマウント時にWorkerと未使用の先行描画を破棄する後始末を登録する。
     * 開発時のStrictModeによる再マウントでも、マウント時に破棄済みの印を戻す。
     */
    () => {
      disposedRef.current = false;
      return (
        /**
         * アンマウント時にWorkerを終了し、準備中のrich Workerも結果到着時に破棄させる。
         */
        () => {
          disposedRef.current = true;
          discardSpeculativeFirstRenders();
          workerRef.current?.terminate();
          workerRef.current = undefined;
          workerBusyRef.current = false;
          workerIsRichRef.current = false;
        }
      );
    },
    [],
  );

  return [snapshot, cancelActiveRender];
}

/**
 * Worker スクリプトの Blob URL 生成結果を、軽量版・リッチ版の URL ごとに共有するキャッシュ。
 */
const markdownWorkerBlobUrlPromises = new Map<string, Promise<string>>();
/**
 * 先行生成した描画Worker、失敗情報、エラー通知リスナーを保持します。
 */
interface PreloadedMarkdownWorker {
  /**
   * プレビュー描画用に先行生成したWorkerインスタンス。
   */
  worker: Worker;

  /**
   * 処理に失敗した理由または例外。
   */
  error?: unknown;
  /**
   * preload中に起きたエラーをstate.errorへ保存するリスナー。
   * @param event - Markdown worker preload失敗のmessageまたはerrorを保持するErrorEvent。
   */
  errorListener: (event: ErrorEvent) => void;
}
/**
 * React のマウント前に先行生成した軽量描画 Worker。最初の描画要求で一度だけ引き渡す。
 */
let preloadedMarkdownWorkerPromise:
  | Promise<PreloadedMarkdownWorker>
  | undefined;

/**
 * 設定済みURL、またはWebview本体の位置を基準にWorkerスクリプトURLを解決する。
 * @param rich - リッチMarkdown用WorkerスクリプトのURLを解決する場合はtrue。
 * @returns 選択したWorkerスクリプトのURL。
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
 * WorkerスクリプトをBlob URLへ変換し、同じURLの変換Promiseを共有する。
 * @param rich - リッチMarkdown用Workerスクリプトの起動URLを解決する場合はtrue。
 * @returns new Workerへ渡せるURL。すでにblob/data URLならそのまま返す。
 */
async function resolveMarkdownWorkerLaunchUrl(rich = false): Promise<string> {
  const resourceUrl = resolveMarkdownWorkerResourceUrl(rich);
  if (/^(?:blob:|data:)/i.test(resourceUrl)) return resourceUrl;
  let pending = markdownWorkerBlobUrlPromises.get(resourceUrl);
  pending ??= fetch(resourceUrl)
    .then(
      /**
       * @param response - Markdown Worker取得要求のHTTP応答。成功状態を確認して本文Blobを読み取る。
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
       * @param blob - 取得したMarkdown Workerスクリプト本文のBlob。Worker起動用Object URLを作る元データ。
       */
      (blob) => URL.createObjectURL(blob),
    )
    .catch(
      /**
       * @param error - 処理に失敗した理由または例外。
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
 * 既定のMarkdown Workerをバックグラウンドで一度だけ起動し、利用可能にしておく。
 */
export function preloadMarkdownWorker(): void {
  preloadedMarkdownWorkerPromise ??= resolveMarkdownWorkerLaunchUrl().then(
    /**
     * @param url - 起動するMarkdown WorkerのスクリプトURL。
     * @returns 起動したWorkerとerror listenerを保持する状態。
     */
    (url) => {
      const state = {} as PreloadedMarkdownWorker;
      const worker = new Worker(url);
      state.worker = worker;
      state.errorListener =
        /**
         * @param event - preload中に発生したworker errorの詳細を記録するErrorEvent。
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
     * 失敗はstate.errorに記録済みのため、未処理Promise拒否を防ぐ。
     */
    () => undefined,
  );
}

/**
 * 描画要求に使うWorkerを返す。リッチWorkerは個別に起動し、既定Workerはpreload済みの個体を再利用する。
 * @param rich - リッチMarkdown用Workerを取得する場合はtrue。
 * @returns 要求を処理するWorker。preloadが失敗した場合は例外を送出する。
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
 * Reactの初回マウント前に開始した、初回プレビューのWorker描画。
 * マウントには数百ミリ秒かかるため、その間にWorker側の解析を進めておき、プレビューのhookが同じ入力で描画を始めるときに結果を引き継ぐ。
 */
interface SpeculativeFirstRender {
  /** 描画入力（本文と描画設定）を一意に表すキー。hookの要求と完全一致した場合だけ結果を引き継ぐ。 */
  key: string;
  /** 描画を依頼したWorker。引き継ぎ後はhookが所有し、不一致時は破棄する。 */
  worker: Promise<Worker>;
  /** Workerの最初の応答、またはWorkerのエラー。応答後に起きたエラーは含まないため、利用時は settleSpeculativeRender を通す。 */
  outcome: Promise<{ response: MarkdownWorkerResponse } | { error: unknown }>;
  /**
   * 応答の後も含め、Workerで最初に起きたエラー。引き継ぎ前（onerror未設定の間）のエラーを取りこぼさないため、常設リスナーで記録する。
   */
  failure: { error?: unknown };
}

/**
 * 先行描画の結果を確定させる。応答が届いていても、その後にWorkerがエラーになっていればエラーとして返し、停止したWorkerを使わせない。
 * @param speculative - 確認する先行描画。
 * @returns 応答、またはエラー。
 */
function settleSpeculativeRender(
  speculative: SpeculativeFirstRender,
): Promise<{ response: MarkdownWorkerResponse } | { error: unknown }> {
  return speculative.outcome.then(
    /**
     * 応答後に記録されたエラーがあればエラーへ置き換える。
     * @param outcome - 最初の応答またはエラー。
     * @returns 確定した結果。
     */
    (outcome) =>
      "error" in outcome || speculative.failure.error === undefined
        ? outcome
        : { error: speculative.failure.error },
  );
}

/**
 * 先行描画の要求ID。hookの世代IDは0以上なので重ならない。応答はhookへ渡す前に現在の世代IDへ置き換える。
 */
const SPECULATIVE_RENDER_ID = -1;
/**
 * まだhookに引き継がれていない先行描画。軽量Worker（light）と、ハイライト付きのrich Workerを別々に保持する。
 * 引き継ぎ時、または入力不一致で破棄した時点で取り除く。
 */
const speculativeFirstRenders = new Map<
  "light" | "rich",
  SpeculativeFirstRender
>();

/**
 * 描画入力から先行描画との照合キーを作る。
 * @param markdown - 描画する本文。
 * @param options - Workerへ渡す描画設定。
 * @returns 照合キー。
 */
function markdownRenderKey(
  markdown: string,
  options: {
    remoteImagesEnabled: boolean;
    language: WebviewSettings["language"];
    renderFormat: MarkdownRenderFormat;
  },
): string {
  return JSON.stringify([
    markdown,
    options.remoteImagesEnabled,
    options.language,
    options.renderFormat,
  ]);
}

/**
 * rich Workerによる精緻化が必要になりそうかを、本文の簡易走査で予測する。mermaid以外のフェンス、またはHTMLのpre/code要素があればtrue。
 * 予測は先行起動の判断にだけ使う。外れても表示結果は変わらず（軽量Workerの判定が正）、無駄な先行描画か従来どおりの直列描画になるだけ。
 * @param text - 初期本文。
 * @returns 精緻化が必要になりそうならtrue。
 */
function mayNeedCodeHighlight(text: string): boolean {
  for (const match of text.matchAll(
    /^ {0,3}(?:`{3,}|~{3,})[ \t]*([^\s`{]*)/gm,
  )) {
    if (match[1].toLowerCase() !== "mermaid") return true;
  }
  return /<(?:pre|code)\b/i.test(text);
}

/**
 * 指定したWorkerへ先行描画を依頼し、最初の応答またはエラーを待つ。
 * @param worker - 描画を依頼するWorkerの取得Promise。
 * @param markdown - 描画する本文。
 * @param options - Workerへ渡す描画設定。
 * @returns 応答またはエラー。Worker取得の失敗もエラーとして返す。
 */
function requestSpeculativeRender(
  worker: Promise<Worker>,
  markdown: string,
  options: {
    remoteImagesEnabled: boolean;
    language: WebviewSettings["language"];
    renderFormat: MarkdownRenderFormat;
  },
): Promise<{ response: MarkdownWorkerResponse } | { error: unknown }> {
  return worker.then(
    /**
     * 取得したWorkerへ描画を依頼する。
     * @param target - 描画を依頼するWorker。
     * @returns 応答またはエラー。
     */
    (target) =>
      new Promise<{ response: MarkdownWorkerResponse } | { error: unknown }>(
        /**
         * 一時リスナーを付けて描画を依頼する。リスナーは最初の応答かエラーで外し、引き継ぎ後のonmessage/onerrorと重複させない。
         * @param resolve - 応答またはエラーを通知する関数。
         */
        (resolve) => {
          /**
           * 先行描画IDの応答だけを受け取る。
           * @param event - Workerからの応答。
           */
          const onMessage = (event: MessageEvent<MarkdownWorkerResponse>) => {
            if (event.data.id !== SPECULATIVE_RENDER_ID) return;
            cleanup();
            recordLatestPerformanceMark("mve-preview-worker-response");
            // 精緻化が必要な場合はrich Workerの取得をここで始め、hookへの引き継ぎを待たない。
            if (event.data.preliminary === true)
              void resolveMarkdownWorkerLaunchUrl(true).catch(() => undefined);
            resolve({ response: event.data });
          };
          /**
           * スクリプト評価や描画中の例外をエラー結果として記録する。
           * @param event - Workerのエラー。
           */
          const onError = (event: ErrorEvent) => {
            cleanup();
            resolve({
              error: event.message || event.error || "Markdown Worker failed",
            });
          };
          /**
           * 一時リスナーを外す。
           */
          const cleanup = () => {
            target.removeEventListener("message", onMessage);
            target.removeEventListener("error", onError);
          };
          target.addEventListener("message", onMessage);
          target.addEventListener("error", onError);
          target.postMessage({ id: SPECULATIVE_RENDER_ID, markdown, options });
        },
      ),
    (error: unknown) => ({ error }),
  );
}

/**
 * HTMLに埋め込まれた初期本文で、初回プレビューのWorker描画をReactのマウント前に開始する。
 * Appが初回描画で同じ要求を出すと確定できる条件（初期データあり・プレビュー表示・Marp判定不要）でだけ開始する。
 * 軽量描画に加え、コードハイライトが必要になりそうな本文ではrich描画も並行して始め、簡易表示から精緻化までの直列待ちを縮める。
 * 条件外や失敗時は何もせず、hookが従来どおり描画を開始する。結果はhookが入力の完全一致を確認してから使う。
 */
export function startSpeculativeFirstPreviewRender(): void {
  if (speculativeFirstRenders.size) return;
  const bootstrap = readWebviewBootstrap();
  if (!bootstrap) return;
  const restored = vscode.getState();
  const viewMode = restoreViewMode(
    restored?.viewMode ?? restored?.splitView ?? bootstrap.settings.viewMode,
  );
  if (viewMode === "text") return;
  const renderFormat = getRenderFormatForUri(bootstrap.uri);
  // Marp候補はHost判定の結果でプレビュー経路が変わるため、先行描画しない。
  if (renderFormat !== "textile" && hasMarpFrontMatterCandidate(bootstrap.text))
    return;
  const options = {
    remoteImagesEnabled: bootstrap.settings.remoteImagesEnabled,
    language: bootstrap.settings.language,
    renderFormat,
  };
  const markdown = bootstrap.text;
  const key = markdownRenderKey(markdown, options);
  const kinds: Array<"light" | "rich"> = mayNeedCodeHighlight(markdown)
    ? ["light", "rich"]
    : ["light"];
  for (const kind of kinds) {
    const worker = acquireMarkdownWorker(kind === "rich");
    const failure: { error?: unknown } = {};
    // 取得失敗は outcome に変換する。引き継がれなかった場合の未処理拒否も防ぐ。
    void worker.then(
      /**
       * 応答後のエラーも記録する常設リスナーを付ける。Workerのエラーは非同期タスクで届くため、ここで付ければ取りこぼさない。
       * @param target - 先行描画のWorker。
       */
      (target) =>
        target.addEventListener(
          "error",
          /**
           * 最初のエラーだけを記録する。
           * @param event - Workerのエラー。
           */
          (event: ErrorEvent) => {
            failure.error ??=
              event.message || event.error || "Markdown Worker failed";
          },
        ),
      () => undefined,
    );
    speculativeFirstRenders.set(kind, {
      key,
      worker,
      outcome: requestSpeculativeRender(worker, markdown, options),
      failure,
    });
  }
}

/**
 * 先行描画を取り出す。入力が一致すれば呼び出し側へ所有権を渡し、一致しなければWorkerを破棄する。
 * いずれの場合も先行描画は一度しか使われない。
 * @param kind - 取り出すWorkerの種類。
 * @param createKey - hookが今から依頼しようとしている描画入力のキーを作る関数。先行描画が残っている場合だけ呼ぶ。
 * @returns 一致した先行描画。無い、または不一致ならundefined。
 */
function takeSpeculativeFirstRender(
  kind: "light" | "rich",
  createKey: () => string,
): SpeculativeFirstRender | undefined {
  const pending = speculativeFirstRenders.get(kind);
  if (!pending) return undefined;
  speculativeFirstRenders.delete(kind);
  if (pending.key === createKey()) return pending;
  void pending.worker.then(
    /**
     * 使われなかった先行描画のWorkerを終了する。
     * @param worker - 先行描画のWorker。
     */
    (worker) => worker.terminate(),
    () => undefined,
  );
  return undefined;
}

/**
 * 結果を使わない先行rich描画を取り出す（軽量描画が最終結果になった後の差し替え用）。
 * Workerは先行描画を処理し終えてから次の要求を処理するため、結果を引き継がなくても再利用できる。利用側は settleSpeculativeRender でエラー有無を確認する。
 * @returns 先行rich描画。無ければundefined。
 */
function takeSpeculativeRichRender(): SpeculativeFirstRender | undefined {
  const pending = speculativeFirstRenders.get("rich");
  speculativeFirstRenders.delete("rich");
  return pending;
}

/**
 * 軽量描画の最終化後に行うrich Workerへの差し替えが、取得失敗のためこのWebviewセッションでは行えないことを示す。
 * trueの間は差し替えを試みない（ハイライトが必要な描画では従来の起動・フォールバック経路が別途働く）。
 */
let richWorkerPromotionUnavailable = false;

/**
 * 引き継がれずに残った先行描画をすべて破棄し、Workerを終了する。プレビューのhookが破棄されるときに呼び、Workerを残さない。
 */
function discardSpeculativeFirstRenders(): void {
  for (const kind of ["light", "rich"] as const) {
    void speculativeFirstRenders.get(kind)?.worker.then(
      /**
       * 使われなかった先行描画のWorkerを終了する。
       * @param worker - 先行描画のWorker。
       */
      (worker) => worker.terminate(),
      () => undefined,
    );
    speculativeFirstRenders.delete(kind);
  }
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
    /** 空入力の完了後も同じ型で呼び出し元へ中断関数を返す。 */
    return () => undefined;
  }
  const sanitized: string[] = [];
  let index = 0;
  let cancelled = false;
  let timer: number | undefined;
  let maximumChunkDuration = 0;
  let slowestBlock = { duration: 0, length: 0, prefix: "" };

  const close = /**
   * 分割実行中の処理を取り消し、保留中のタイマーを解除する。
   */ () => {
    cancelled = true;
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
  };

  const runChunk =
    /** 一度に最大4msだけ処理し、残りは次のタイマーへ分割する。 */ () => {
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
      } while (
        index < unsafeBlocks.length &&
        performance.now() - startedAt < 4
      );
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
      performance.mark("mve-preview-sanitize-slowest", {
        detail: slowestBlock,
      });
      (
        globalThis as typeof globalThis & {
          /** 最も時間のかかったサニタイズ対象ブロックの計測結果。 */
          __mveSlowestSanitizeBlock?: typeof slowestBlock;
        }
      ).__mveSlowestSanitizeBlock = slowestBlock;
      onComplete(sanitized.join(""), maximumChunkDuration);
    };
  timer = window.setTimeout(runChunk, 0);
  return close;
}

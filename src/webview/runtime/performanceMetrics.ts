/**
 * @fileoverview Webview の起動・描画計測を Performance API へ記録し、起動回帰テストが読む指標を集計する。
 * 副作用は performance mark / measure の追加と置換だけで、計測に失敗しても描画処理は止めない。
 */


/**
 * 同じ名前の古い計測を置き換え、直近1回分の処理時間を記録する。
 * @param name - 計測するPerformance Measureの名前。
 * @param startedAt - 計測開始時のperformance.now()値。
 */
export function recordLatestPerformanceMeasure(name: string, startedAt: number): void {
  performance.clearMeasures(name);
  performance.measure(name, { start: startedAt, end: performance.now() });
}

/**
 * 同じ名前の古いマークを置き換え、直近イベント時刻を記録する。
 * @param name - 記録するPerformance Markの名前。
 */
export function recordLatestPerformanceMark(name: string): void {
  performance.clearMarks(name);
  performance.mark(name);
}

/**
 * 既知の経過時間からPerformance Measureを記録し、同名の前回値を置き換える。
 * @param name - 計測するPerformance Measureの名前。
 * @param duration - 処理にかかった時間（ミリ秒）。
 */
export function recordPerformanceDuration(name: string, duration: number): void {
  performance.clearMeasures(name);
  performance.measure(name, { start: 0, duration });
}

/**
 * 起動計測専用。プレビューのスクロール領域に現在重なっているMermaid図の数と、そのうち未完了の数を数える。
 * 余白（先読み範囲）を含めず、利用者に見えている範囲だけを対象にする。
 * @param container - 分割プレビューのスクロール領域。未マウントならundefinedを返す。
 * @returns 表示範囲内の図の総数と未完了数。表示範囲に図が無い場合もundefinedを返す。
 */
export function countVisibleMermaidNodes(
  container: HTMLElement | null,
): { total: number; pending: number } | undefined {
  if (!container) return undefined;
  const viewport = container.getBoundingClientRect();
  let total = 0;
  let pending = 0;
  for (const node of container.querySelectorAll<HTMLElement>(".mermaid")) {
    const rect = node.getBoundingClientRect();
    if (rect.bottom <= viewport.top || rect.top >= viewport.bottom) continue;
    total += 1;
    const status = node.dataset.mermaidStatus;
    if (status !== "ready" && status !== "error") pending += 1;
  }
  return total ? { total, pending } : undefined;
}

/**
 * 初期化受信からプレビュー描画までに記録された起動時刻をまとめる。
 * @param initReceivedAt - 初期化メッセージ受信時のperformance.now()値。未計測ならundefined。
 * @returns 起動計測名からperformance.now()の時刻値へのMap。
 */
export function collectStartupMetrics(
  initReceivedAt: number | undefined,
): Record<string, number> {
  const metrics: Record<string, number> = {
    previewReportedAt: performance.now(),
  };
  const bundleExecutedAt = (
    globalThis as typeof globalThis & {
      /**
       * Webviewスクリプトの実行開始時刻。起動遅延の診断に使う。
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
      metrics.markdownWorkerResourceCount =
        (metrics.markdownWorkerResourceCount ?? 0) + 1;
    } else if (entry.name.includes("webview.js")) {
      metrics.webviewFetchStartedAt = entry.startTime;
      metrics.webviewFetchDuration = entry.duration;
    }
  }
  return metrics;
}

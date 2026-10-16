/**
 * @fileoverview Webview内のMarpプレビューが切り替わってもWorkerを再利用する。
 */

const IDLE_DISPOSAL_DELAY_MS = 500;

let sharedWorker: Worker | undefined;
let sharedWorkerObjectUrl: string | undefined;
let sharedWorkerFetch: Promise<Worker> | undefined;
let sharedWorkerFetchController: AbortController | undefined;
let activePreviewCount = 0;
let disposalTimer: number | undefined;

/**
 * Marpプレビューの利用を登録し、終了時にWorker破棄を予約する。
 * @returns 利用終了時に一度だけ呼び出す解放関数。
 */
export function retainMarpWorker(): () => void {
  activePreviewCount += 1;
  clearDisposalTimer();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activePreviewCount = Math.max(0, activePreviewCount - 1);
    if (activePreviewCount === 0) {
      disposalTimer = window.setTimeout(disposeMarpWorker, IDLE_DISPOSAL_DELAY_MS);
    }
  };
}

/**
 * 既存Workerを返し、なければ資産を一度だけ取得して生成する。
 * @param resourceUri - Marp Worker bundleを指すWebview URI。
 * @returns 利用可能なMarp Worker。
 */
export function getMarpWorker(resourceUri: string): Promise<Worker> {
  clearDisposalTimer();
  if (sharedWorker) return Promise.resolve(sharedWorker);
  if (sharedWorkerFetch) return sharedWorkerFetch;

  const controller = new AbortController();
  sharedWorkerFetchController = controller;
  sharedWorkerFetch = fetch(resourceUri, { signal: controller.signal })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Marp Worker request failed: ${response.status}`);
      const objectUrl = URL.createObjectURL(await response.blob());
      try {
        const worker = new Worker(objectUrl);
        sharedWorker = worker;
        sharedWorkerObjectUrl = objectUrl;
        return worker;
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        throw error;
      }
    })
    .finally(() => {
      if (sharedWorkerFetchController === controller) sharedWorkerFetchController = undefined;
      sharedWorkerFetch = undefined;
    });
  return sharedWorkerFetch;
}

/**
 * Worker実行エラー時に共有WorkerとそのBlob URLを直ちに破棄する。
 * @param worker - 破棄対象を制限するWorker。省略時は現在の共有Worker。
 */
export function terminateMarpWorker(worker?: Worker): void {
  if (worker && sharedWorker !== worker) return;
  clearDisposalTimer();
  sharedWorkerFetchController?.abort();
  sharedWorkerFetchController = undefined;
  sharedWorkerFetch = undefined;
  sharedWorker?.terminate();
  sharedWorker = undefined;
  if (sharedWorkerObjectUrl) URL.revokeObjectURL(sharedWorkerObjectUrl);
  sharedWorkerObjectUrl = undefined;
}

/** Marpプレビュー利用がなくなった後、短い切替猶予を置いてWorkerを破棄する。 */
function disposeMarpWorker(): void {
  disposalTimer = undefined;
  if (activePreviewCount !== 0) return;
  terminateMarpWorker();
}

/** 予約済みのアイドル破棄をキャンセルする。 */
function clearDisposalTimer(): void {
  if (disposalTimer === undefined) return;
  window.clearTimeout(disposalTimer);
  disposalTimer = undefined;
}

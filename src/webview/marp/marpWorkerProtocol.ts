/**
 * @fileoverview Marp Worker応答が現在の描画要求に属するかを判定する。
 */

/**
 * 別の描画要求から遅れて届いたWorker応答を現在の要求へ適用しない。
 * @param response - Marp Workerから受信した値。
 * @param expectedId - 現在処理中の描画要求ID。
 * @returns 応答にIDがないか、現在の要求IDと一致する場合はtrue。
 */
export function isCurrentMarpWorkerResponse(
  response: unknown,
  expectedId: number,
): boolean {
  if (!response || typeof response !== "object" || !("id" in response)) {
    return true;
  }
  return response.id === expectedId;
}

/**
 * @fileoverview Marp Workerの古い描画応答を適用しないことを検証する。
 */
import { describe, expect, it } from "vitest";
import { isCurrentMarpWorkerResponse } from "../src/webview/marp/marpWorkerProtocol";

describe("Marp Worker response correlation", () => {
  it("ignores a stale response before validating the latest response", () => {
    expect(isCurrentMarpWorkerResponse({ id: 4, slides: [] }, 5)).toBe(false);
    expect(isCurrentMarpWorkerResponse({ id: 5, slides: [] }, 5)).toBe(true);
  });

  it("leaves malformed response validation to the response validator", () => {
    expect(isCurrentMarpWorkerResponse({ error: "failed" }, 5)).toBe(true);
    expect(isCurrentMarpWorkerResponse(null, 5)).toBe(true);
  });
});

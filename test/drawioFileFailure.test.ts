/**
 * @fileoverview draw.io SVGの排他保存が失敗したとき、書きかけのファイルを残さず元の例外を返すことを検証する。
 *
 * 実行境界はtest（Extension Host側のNode.jsモジュール）。`node:fs/promises` をモックし、
 * 実ディスクでは再現しにくい書込み失敗とクローズ失敗を発生させる。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

/** ファイルハンドルとunlinkの呼出しを記録するモック。 */
const fsMock = vi.hoisted(() => {
  const handle = {
    writeFile: vi.fn(async (_contents: string, _encoding: string): Promise<void> => undefined),
    close: vi.fn(async (): Promise<void> => undefined),
  };
  return {
    handle,
    open: vi.fn(async (_path: string, _flags: string) => handle),
    unlink: vi.fn(async (_path: string): Promise<void> => undefined),
  };
});
vi.mock("node:fs/promises", () => ({ open: fsMock.open, unlink: fsMock.unlink }));

import { writeDrawioSvgExclusive } from "../src/extension/drawioFile";

afterEach(
  /** 各テストで差し替えた失敗動作を既定の成功動作へ戻す。 */
  () => {
    vi.clearAllMocks();
    fsMock.handle.writeFile.mockImplementation(async () => undefined);
    fsMock.handle.close.mockImplementation(async () => undefined);
  });

describe("writeDrawioSvgExclusive failure cleanup", () => {
  /** 既存ファイルを置換しない `wx` で開き、成功時は作成したファイルを削除しない。 */
  it("opens with the exclusive flag and keeps the file after a successful write", async () => {
    await writeDrawioSvgExclusive("/tmp/a.drawio.svg", "<svg/>");
    expect(fsMock.open).toHaveBeenCalledWith("/tmp/a.drawio.svg", "wx");
    expect(fsMock.handle.close).toHaveBeenCalledOnce();
    expect(fsMock.unlink).not.toHaveBeenCalled();
  });

  /** 書込み失敗時はハンドルを閉じたうえで不完全なファイルを削除し、書込みエラーを返す。 */
  it("closes, removes the partial file and rethrows the write error", async () => {
    const writeError = new Error("disk full");
    fsMock.handle.writeFile.mockRejectedValue(writeError);
    await expect(writeDrawioSvgExclusive("/tmp/b.drawio.svg", "<svg/>")).rejects.toBe(writeError);
    expect(fsMock.handle.close).toHaveBeenCalledOnce();
    expect(fsMock.unlink).toHaveBeenCalledWith("/tmp/b.drawio.svg");
  });

  /** 書込みとクローズが両方失敗しても、原因である書込みエラーを隠さずファイルも削除する。 */
  it("prefers the write error when closing also fails", async () => {
    const writeError = new Error("disk full");
    fsMock.handle.writeFile.mockRejectedValue(writeError);
    fsMock.handle.close.mockRejectedValue(new Error("close failed"));
    await expect(writeDrawioSvgExclusive("/tmp/c.drawio.svg", "<svg/>")).rejects.toBe(writeError);
    expect(fsMock.unlink).toHaveBeenCalledWith("/tmp/c.drawio.svg");
  });

  /** クローズだけが失敗した場合も、内容が確定していないファイルを残さない。 */
  it("removes the file and rethrows when only closing fails", async () => {
    const closeError = new Error("close failed");
    fsMock.handle.close.mockRejectedValue(closeError);
    await expect(writeDrawioSvgExclusive("/tmp/d.drawio.svg", "<svg/>")).rejects.toBe(closeError);
    expect(fsMock.unlink).toHaveBeenCalledWith("/tmp/d.drawio.svg");
  });
});

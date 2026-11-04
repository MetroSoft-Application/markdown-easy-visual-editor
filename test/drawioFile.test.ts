/**
 * @fileoverview draw.ioダミーSVGの排他保存と既存ファイル非破壊を検証する。
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeDrawioSvgExclusive } from "../src/extension/drawioFile";
import { createDrawioPlaceholderSvg } from "../src/shared/drawioSvg";

describe("writeDrawioSvgExclusive", () => {
  it("writes a standalone SVG without changing its embedded draw.io model", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mve-drawio-"));
    try {
      const svg = createDrawioPlaceholderSvg();
      const target = path.join(directory, "diagram.drawio.svg");
      await writeDrawioSvgExclusive(target, svg);
      expect(await fs.readFile(target, "utf8")).toBe(svg);
      expect((await fs.stat(target)).size).toBeGreaterThan(500);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("never overwrites an existing draw.io diagram", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mve-drawio-"));
    try {
      const target = path.join(directory, "diagram.drawio.svg");
      const original = "<svg>already edited</svg>";
      await fs.writeFile(target, original, "utf8");
      await expect(writeDrawioSvgExclusive(target, createDrawioPlaceholderSvg()))
        .rejects.toMatchObject({ code: "EEXIST" });
      expect(await fs.readFile(target, "utf8")).toBe(original);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});

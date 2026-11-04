/**
 * @fileoverview draw.io SVGをローカルファイルとして排他的に作成する。
 */
import { open, unlink } from "node:fs/promises";

/**
 * 既存ファイルやシンボリックリンクを置換せずSVGを保存する。
 * @param filePath - 新規SVGファイルの絶対パス。
 * @param contents - 保存するUTF-8 SVG。
 * @throws 既存ファイルとの衝突や書込失敗時に例外を送出する。
 */
export async function writeDrawioSvgExclusive(filePath: string, contents: string): Promise<void> {
    const handle = await open(filePath, "wx");
    let written = false;
    try {
        await handle.writeFile(contents, "utf8");
        written = true;
    } finally {
        await handle.close();
        if (!written) await unlink(filePath).catch(() => undefined);
    }
}

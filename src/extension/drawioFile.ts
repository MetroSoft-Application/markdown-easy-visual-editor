/**
 * @fileoverview draw.io SVGをローカルファイルとして排他的に作成する。
 *
 * 実行境界はExtension Host（Node.js）。`file` スキームの保存先だけで使用する。
 * 既存ファイルやシンボリックリンクを置換しないことと、失敗時に書きかけのファイルを残さないことを不変条件とする。
 */
import { open, unlink } from "node:fs/promises";

/**
 * 既存ファイルやシンボリックリンクを置換せずSVGを保存する。
 * `wx` フラグで作成するため、同名のファイルやリンクがあれば何も変更せず `EEXIST` で失敗する。
 * 書込みまたはクローズに失敗した場合は自分が作成したファイルを削除し、最初に起きたエラーを送出する。
 * @param filePath - 新規SVGファイルの絶対パス。
 * @param contents - 保存するUTF-8 SVG。
 * @throws 既存ファイルとの衝突、書込み失敗、クローズ失敗のいずれかの例外。
 */
export async function writeDrawioSvgExclusive(filePath: string, contents: string): Promise<void> {
    const handle = await open(filePath, "wx");
    let failure: unknown;
    try {
        await handle.writeFile(contents, "utf8");
    } catch (error) {
        failure = error;
    }
    try {
        await handle.close();
    } catch (error) {
        // 書込みエラーを優先し、クローズエラーで原因が隠れないようにする。
        failure ??= error;
    }
    if (failure !== undefined) {
        // 作成済みの不完全なファイルを残すと次回以降の図として誤って参照されるため削除する。
        await unlink(filePath).catch(() => undefined);
        throw failure;
    }
}

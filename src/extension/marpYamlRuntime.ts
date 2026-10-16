/**
 * @fileoverview Marp front matterのYAML判定器を通常のExtension Hostバンドルから分離する。
 */
import { isMap, parseDocument } from "yaml";

/**
 * Marp front matterを解析し、ルートの真偽値marpがtrueかを返す。
 * @param yaml - front matterから取り出したYAML本文。
 * @returns 解析に成功し、marpが真偽値trueの場合にtrue。
 */
export function parseMarpFrontMatter(yaml: string): boolean {
  const document = parseDocument(yaml, { strict: true, uniqueKeys: true });
  if (document.errors.length || document.warnings.length || !isMap(document.contents)) {
    return false;
  }
  const root = document.toJS({ mapAsMap: true });
  return root instanceof Map && root.get("marp") === true;
}

/**
 * @fileoverview Markdownコードフェンス内の描画言語を軽量に判定する。
 */

/**
 * MarkdownのコードフェンスにMermaid図が含まれるかを調べる。
 *
 * @param markdown - Mermaidコードフェンスの有無を調べるMarkdown本文。
 * @param maxBodyLength - Mermaidフェンス本文へ許可する最大文字数。
 * @returns Mermaid図のフェンスがある場合はtrue。
 */
export function hasMermaidFence(
  markdown: string,
  maxBodyLength = Number.POSITIVE_INFINITY,
): boolean {
  if (!/mermaid/i.test(markdown)) return false;

  let fenceCharacter: "`" | "~" | undefined;
  let fenceLength = 0;
  let mermaidBodyStart = -1;
  let lineStart = 0;
  while (lineStart <= markdown.length) {
    const lineFeed = markdown.indexOf("\n", lineStart);
    const lineEnd = lineFeed < 0 ? markdown.length : lineFeed;
    const line = markdown.slice(lineStart, lineEnd).replace(/\r$/, "");

    if (fenceCharacter) {
      const closingFence = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1];
      if (
        closingFence?.[0] === fenceCharacter &&
        closingFence.length >= fenceLength
      ) {
        if (
          mermaidBodyStart >= 0 &&
          lineStart - mermaidBodyStart <= maxBodyLength
        ) {
          return true;
        }
        fenceCharacter = undefined;
        fenceLength = 0;
        mermaidBodyStart = -1;
      }
    } else {
      const openingFence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (openingFence) {
        const marker = openingFence[1];
        const info = openingFence[2];
        if (marker[0] === "`" && info.includes("`")) {
          lineStart = lineFeed < 0 ? markdown.length + 1 : lineFeed + 1;
          continue;
        }
        if (info.trimStart().split(/[ \t]/, 1)[0].toLowerCase() === "mermaid") {
          mermaidBodyStart = lineFeed < 0 ? markdown.length : lineFeed + 1;
        }
        fenceCharacter = marker[0] as "`" | "~";
        fenceLength = marker.length;
      }
    }

    if (lineFeed < 0) break;
    lineStart = lineFeed + 1;
  }

  return (
    mermaidBodyStart >= 0 &&
    markdown.length - mermaidBodyStart <= maxBodyLength
  );
}

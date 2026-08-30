export interface ZeroBasedPosition {
  line: number;
  character: number;
}

export interface ChatAttachmentRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/** VS Code拡張APIの0始まり位置を、Chat内部コマンドの1始まり範囲へ変換する。 */
export function toChatAttachmentRange(
  start: ZeroBasedPosition,
  end: ZeroBasedPosition
): ChatAttachmentRange {
  return {
    startLineNumber: start.line + 1,
    startColumn: start.character + 1,
    endLineNumber: end.line + 1,
    endColumn: end.character + 1
  };
}

/** 元文書と同じ行・列に選択本文だけが存在する、Chat添付用の最小スナップショットを作る。 */
export function buildChatSelectionSnapshot(start: ZeroBasedPosition, selectedText: string): string {
  return `${'\n'.repeat(start.line)}${' '.repeat(start.character)}${selectedText}`;
}

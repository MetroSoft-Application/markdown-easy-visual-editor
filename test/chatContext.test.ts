import { describe, expect, it } from 'vitest';
import { buildChatSelectionSnapshot, toChatAttachmentRange } from '../src/extension/chatContext';

describe('Copilot Chat selection context', () => {
  it('converts extension positions to the one-based line and column range required by Chat', () => {
    expect(toChatAttachmentRange(
      { line: 62, character: 0 },
      { line: 62, character: 18 }
    )).toEqual({
      startLineNumber: 63,
      startColumn: 1,
      endLineNumber: 63,
      endColumn: 19
    });
  });

  it('keeps the original start line and column while exposing only the selected text', () => {
    expect(buildChatSelectionSnapshot({ line: 2, character: 3 }, 'selected\ntext'))
      .toBe('\n\n   selected\ntext');
  });
});

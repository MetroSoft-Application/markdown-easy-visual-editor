import { describe, expect, it } from 'vitest';
import { findExactSelectionMatches } from '../src/webview/cmSelectionMatchHighlight';

describe('findExactSelectionMatches', () => {
  it('matches the exact selected text case-sensitively and excludes the selection itself', () => {
    expect(findExactSelectionMatches('foo Foo foo', 'foo', 0, 3)).toEqual([
      { from: 8, to: 11 }
    ]);
  });

  it('preserves whitespace instead of trimming the selected text', () => {
    expect(findExactSelectionMatches('foo foo  foo ', 'foo ', 0, 4)).toEqual([
      { from: 4, to: 8 },
      { from: 9, to: 13 }
    ]);
  });

  it('finds overlapping occurrences', () => {
    expect(findExactSelectionMatches('banana', 'ana', 1, 4)).toEqual([
      { from: 3, to: 6 }
    ]);
  });

  it('supports multiline selections without changing line breaks', () => {
    expect(findExactSelectionMatches('aa\nbb\nxx\naa\nbb', 'aa\nbb', 0, 5)).toEqual([
      { from: 9, to: 14 }
    ]);
  });

  it('returns no highlight when the selected occurrence is the only occurrence', () => {
    expect(findExactSelectionMatches('only once', 'only', 0, 4)).toEqual([]);
  });

  it('respects the explicit match limit without changing match order', () => {
    expect(findExactSelectionMatches('aaaaa', 'a', 0, 1, 2)).toEqual([
      { from: 1, to: 2 },
      { from: 2, to: 3 }
    ]);
  });
});

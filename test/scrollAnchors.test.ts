import { describe, expect, it } from 'vitest';
import { getScrollRatio, getScrollTopForRatio } from '../src/shared/scroll';

describe('scroll synchronization ratio fallback', () => {
  it('uses source anchors for ordinary interior positions', () => {
    expect(getScrollRatio(250, 1200, 200)).toBeUndefined();
    expect(getScrollRatio(500, 1200, 200)).toBeUndefined();
  });

  it('keeps ratio synchronization at the document boundaries', () => {
    expect(getScrollRatio(-10, 1200, 200)).toBe(0);
    expect(getScrollRatio(2000, 1200, 200)).toBe(1);
    expect(getScrollRatio(0, 200, 200)).toBe(0);
  });

  it('maps an explicit ratio back to the matching scroll position', () => {
    expect(getScrollTopForRatio(0.25, 1200, 200)).toBe(250);
    expect(getScrollTopForRatio(-1, 1200, 200)).toBe(0);
    expect(getScrollTopForRatio(2, 1200, 200)).toBe(1000);
    expect(getScrollTopForRatio(0.75, 200, 200)).toBe(0);
  });
});

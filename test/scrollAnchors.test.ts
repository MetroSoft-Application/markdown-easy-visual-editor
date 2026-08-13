import { describe, expect, it } from 'vitest';
import { getScrollRatio, getScrollTopForRatio } from '../src/shared/scroll';

describe('scroll ratio mapping', () => {
  it('maps a scroll position to a clamped ratio', () => {
    expect(getScrollRatio(250, 1200, 200)).toBe(0.25);
    expect(getScrollRatio(-10, 1200, 200)).toBe(0);
    expect(getScrollRatio(2000, 1200, 200)).toBe(1);
  });

  it('returns zero when the content does not overflow', () => {
    expect(getScrollRatio(0, 200, 200)).toBe(0);
    expect(getScrollTopForRatio(0.75, 200, 200)).toBe(0);
  });

  it('maps a ratio back to the matching scroll position', () => {
    expect(getScrollTopForRatio(0.25, 1200, 200)).toBe(250);
    expect(getScrollTopForRatio(-1, 1200, 200)).toBe(0);
    expect(getScrollTopForRatio(2, 1200, 200)).toBe(1000);
  });
});

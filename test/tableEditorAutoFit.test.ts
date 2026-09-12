import { describe, expect, it } from 'vitest';
import {
  calculateAutoFitColumnWidth,
  rowResetStepCount,
} from '../src/webview/tableEditorAutoFit';

describe('table editor auto-fit sizing', () => {
  it('fits the widest cell and includes horizontal chrome', () => {
    const width = calculateAutoFitColumnWidth(
      ['A', 'longest text', 'mid'],
      (value) => value.length * 10,
      20,
    );
    expect(width).toBe(140);
  });

  it('uses the minimum width for empty or short content', () => {
    expect(calculateAutoFitColumnWidth(['', 'a'], (value) => value.length * 8, 20)).toBe(96);
  });

  it('caps very wide content', () => {
    expect(calculateAutoFitColumnWidth(['x'.repeat(500)], (value) => value.length * 10)).toBe(720);
  });

  it('measures each physical line separately', () => {
    expect(
      calculateAutoFitColumnWidth(['short\nlonger line'], (value) => value.length * 10, 20),
    ).toBe(130);
  });

  it('calculates row reset steps in 12px increments', () => {
    expect(rowResetStepCount(36)).toBe(0);
    expect(rowResetStepCount(37)).toBe(1);
    expect(rowResetStepCount(48)).toBe(1);
    expect(rowResetStepCount(49)).toBe(2);
    expect(rowResetStepCount(120)).toBe(7);
  });
});

import { describe, expect, it } from 'vitest';
import {
  applyTextChanges,
  composeTextChanges,
  computeTextChanges,
  mapTextChanges,
  mapTextOffset,
  validateTextChanges
} from '../src/shared/textChanges';

describe('text changes', () => {
  it('computes and applies a minimal replacement', () => {
    const before = 'alpha\r\nbeta\r\ngamma';
    const after = 'alpha\r\nBETA\r\ngamma';
    const changes = computeTextChanges(before, after);
    expect(changes).toEqual([{ rangeOffset: 7, rangeLength: 4, text: 'BETA' }]);
    expect(applyTextChanges(before, changes)).toBe(after);
  });

  it('applies multiple offsets against the same base document', () => {
    const changes = [
      { rangeOffset: 0, rangeLength: 1, text: 'A' },
      { rangeOffset: 4, rangeLength: 0, text: '-' }
    ];
    expect(applyTextChanges('abcde', changes)).toBe('Abcd-e');
  });

  it('composes a long sequence without retaining one full operation per key', () => {
    const base = 'alpha\r\nbeta\r\ngamma';
    let text = base;
    let composed: Array<{ rangeOffset: number; rangeLength: number; text: string }> = [];
    for (const [index, character] of [...'continuous-editing'].entries()) {
      const offset = 7 + index;
      const next = `${text.slice(0, offset)}${character}${text.slice(offset)}`;
      const incremental = [{ rangeOffset: offset, rangeLength: 0, text: character }];
      composed = composeTextChanges(composed, incremental, base.length);
      text = next;
    }
    expect(applyTextChanges(base, composed)).toBe(text);
    expect(composed).toHaveLength(1);
    expect(composed[0].text).toBe('continuous-editing');
  });

  it('composes edits that replace and then remove inserted and original text', () => {
    const base = '0123456789';
    const first = [
      { rangeOffset: 2, rangeLength: 2, text: 'ABCD' },
      { rangeOffset: 8, rangeLength: 0, text: 'xy' }
    ];
    const intermediate = applyTextChanges(base, first);
    const second = [
      { rangeOffset: 3, rangeLength: 3, text: '!' },
      { rangeOffset: 10, rangeLength: 2, text: '' }
    ];
    const expected = applyTextChanges(intermediate, second);
    expect(applyTextChanges(base, composeTextChanges(first, second, base.length))).toBe(expected);
  });

  it('maps local edits over an earlier remote insertion', () => {
    const local = [{ rangeOffset: 6, rangeLength: 4, text: 'BETA' }];
    const remote = [{ rangeOffset: 0, rangeLength: 0, text: '# ' }];
    const mapped = mapTextChanges(local, remote, 10);
    expect(mapped).toEqual([{ rangeOffset: 8, rangeLength: 4, text: 'BETA' }]);
    expect(applyTextChanges(applyTextChanges('alpha beta', remote), mapped)).toBe('# alpha BETA');
  });

  it('maps an anchor through replacements', () => {
    const changes = [{ rangeOffset: 2, rangeLength: 2, text: '12345' }];
    expect(mapTextOffset(6, changes, 8)).toBe(9);
  });

  it('maps CRLF insertions using raw UTF-16 lengths', () => {
    const local = [{ rangeOffset: 3, rangeLength: 0, text: 'local' }];
    const remote = [{ rangeOffset: 0, rangeLength: 0, text: 'a\r\nb\r\n' }];
    expect(mapTextChanges(local, remote, 3)).toEqual([
      { rangeOffset: 9, rangeLength: 0, text: 'local' }
    ]);
    expect(mapTextOffset(3, remote, 3)).toBe(9);
  });

  it('requires resync for overlapping concurrent replacements', () => {
    expect(() => mapTextChanges(
      [{ rangeOffset: 2, rangeLength: 3, text: 'local' }],
      [{ rangeOffset: 4, rangeLength: 2, text: 'remote' }],
      10
    )).toThrow(/overlap/);
  });

  it('rejects overlapping and out-of-range changes', () => {
    expect(() => validateTextChanges([
      { rangeOffset: 1, rangeLength: 3, text: '' },
      { rangeOffset: 2, rangeLength: 1, text: '' }
    ], 5)).toThrow(/Overlapping/);
    expect(() => applyTextChanges('abc', [{ rangeOffset: 4, rangeLength: 0, text: 'x' }])).toThrow(/Invalid/);
  });

  it('converges concurrent inserts by applying the same client ordering', () => {
    const base = 'document';
    const clientA = [{ rangeOffset: base.length, rangeLength: 0, text: 'A' }];
    const clientB = [{ rangeOffset: base.length, rangeLength: 0, text: 'B' }];
    const bAfterA = mapTextChanges(clientB, clientA, base.length, false);
    const aBeforeB = mapTextChanges(clientA, clientB, base.length, true);
    const server = applyTextChanges(applyTextChanges(base, clientA), bAfterA);
    const replicaB = applyTextChanges(applyTextChanges(base, clientB), aBeforeB);
    expect(server).toBe('documentAB');
    expect(replicaB).toBe(server);
  });

  it('keeps one hundred concurrent client operations convergent', () => {
    let server = '';
    let replicaA = '';
    let replicaB = '';
    for (let index = 0; index < 50; index += 1) {
      const baseLength = server.length;
      const clientA = [{ rangeOffset: baseLength, rangeLength: 0, text: `a${index}` }];
      const clientB = [{ rangeOffset: baseLength, rangeLength: 0, text: `b${index}` }];
      const bAfterA = mapTextChanges(clientB, clientA, baseLength, false);
      const aBeforeB = mapTextChanges(clientA, clientB, baseLength, true);
      server = applyTextChanges(applyTextChanges(server, clientA), bAfterA);
      replicaA = applyTextChanges(applyTextChanges(replicaA, clientA), bAfterA);
      replicaB = applyTextChanges(applyTextChanges(replicaB, clientB), aBeforeB);
    }
    expect(replicaA).toBe(server);
    expect(replicaB).toBe(server);
    expect(server).toContain('a49b49');
  });
});

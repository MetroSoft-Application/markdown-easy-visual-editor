import { describe, expect, it } from 'vitest';
import { decodeLocalResourceSource, isMissingResourceError } from '../src/extension/resourceCheck';

describe('Local resource checks', () => {
  it('normalizes URL-encoded paths and removes query and fragment', () => {
    expect(decodeLocalResourceSource('docs/spec%20v1.md?view=1#details')).toBe('docs/spec v1.md');
    expect(decodeLocalResourceSource('docs/broken%ZZ.md')).toBe('docs/broken%ZZ.md');
  });

  it('distinguishes missing resources from inspection failures', () => {
    expect(isMissingResourceError({ code: 'FileNotFound' })).toBe(true);
    expect(isMissingResourceError({ code: 'ENOENT' })).toBe(true);
    expect(isMissingResourceError(new Error('Permission denied'))).toBe(false);
    expect(isMissingResourceError({ code: 'NoPermissions' })).toBe(false);
  });
});

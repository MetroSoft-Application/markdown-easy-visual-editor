import { describe, expect, it } from 'vitest';
import { normalizeImageDirectoryRule, resolveImageDirectoryRule } from '../src/shared/imageDirectory';

describe('image directory rules', () => {
    it('normalizes relative paths and expands the document basename', () => {
        expect(normalizeImageDirectoryRule(' ./assets\\${documentBasename}/ ')).toBe('assets/${documentBasename}');
        expect(resolveImageDirectoryRule('assets/${documentBasename}', 'guide')).toBe('assets/guide');
    });

    it('allows saving beside the Markdown document', () => {
        expect(resolveImageDirectoryRule('.', 'guide')).toBe('.');
    });

    it('rejects absolute paths, traversal, URLs, and unsupported variables', () => {
        expect(normalizeImageDirectoryRule('../images')).toBeUndefined();
        expect(normalizeImageDirectoryRule('C:\\images')).toBeUndefined();
        expect(normalizeImageDirectoryRule('/images')).toBeUndefined();
        expect(normalizeImageDirectoryRule('https://example.com/images')).toBeUndefined();
        expect(normalizeImageDirectoryRule('assets/${workspaceFolder}')).toBeUndefined();
    });
});

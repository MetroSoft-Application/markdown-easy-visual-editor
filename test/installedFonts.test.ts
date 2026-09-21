import { describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_FONT_FAMILY_STACK,
    fontFamilyForCss,
    normalizeFontFamily,
    prependDefaultFontFamily
} from '../src/shared/fontFamily';
import {
    InstalledFontCatalog,
    enumerateInstalledFontFamilies,
    normalizeInstalledFontNames,
    parseInstalledFontNames
} from '../src/extension/installedFonts';

describe('font family settings', () => {
    it('normalizes values without changing valid family lists', () => {
        expect(normalizeFontFamily('  "Test Font", sans-serif  ')).toBe('"Test Font", sans-serif');
        expect(normalizeFontFamily('Test; color: red')).toBe('');
        expect(normalizeFontFamily('line\nfeed')).toBe('');
        expect(fontFamilyForCss('', 'fallback')).toBe('fallback');
        expect(fontFamilyForCss('Missing Font', DEFAULT_FONT_FAMILY_STACK)).toBe(
            `Missing Font, ${DEFAULT_FONT_FAMILY_STACK}`
        );
        expect(fontFamilyForCss(DEFAULT_FONT_FAMILY_STACK, DEFAULT_FONT_FAMILY_STACK)).toBe(
            DEFAULT_FONT_FAMILY_STACK
        );
    });

    it('deduplicates installed family names case-insensitively', () => {
        expect(normalizeInstalledFontNames(['Arial', 'arial', ' 日本語 ', '', '日本語'])).toEqual([
            'Arial',
            '日本語'
        ]);
        expect(parseInstalledFontNames('Arial\r\n日本語\nArial\n')).toEqual(['Arial', '日本語']);
    });

    it('places the existing default font stack first without duplicating it', () => {
        expect(prependDefaultFontFamily(['Arial', DEFAULT_FONT_FAMILY_STACK, 'Yu Gothic UI'])).toEqual([
            DEFAULT_FONT_FAMILY_STACK,
            'Arial',
            'Yu Gothic UI'
        ]);
    });

    it('does not enumerate until requested and caches the result', async () => {
        const enumerate = vi.fn().mockResolvedValue(['B', 'A']);
        const catalog = new InstalledFontCatalog(enumerate);

        expect(enumerate).not.toHaveBeenCalled();
        await expect(catalog.getFonts()).resolves.toEqual(['B', 'A']);
        await expect(catalog.getFonts()).resolves.toEqual(['B', 'A']);
        expect(enumerate).toHaveBeenCalledTimes(1);
    });

    it('keeps the free-input path available when enumeration fails', async () => {
        const catalog = new InstalledFontCatalog(() => Promise.reject(new Error('unavailable')));
        await expect(catalog.getFonts()).resolves.toEqual([]);
    });

    it('keeps the free-input path available when enumeration times out', async () => {
        const timeout = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
        const catalog = new InstalledFontCatalog(() => Promise.reject(timeout));
        await expect(catalog.getFonts()).resolves.toEqual([]);
    });

    it('passes a finite process timeout to the Windows enumerator', async () => {
        const commandRunner = vi.fn(async (_file, _args, options) => {
            expect(options.timeout).toBeGreaterThan(0);
            expect(options.maxBuffer).toBeGreaterThan(0);
            throw Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
        });

        await expect(enumerateInstalledFontFamilies({
            platform: 'win32',
            commandRunner
        })).resolves.toEqual([]);
        expect(commandRunner).toHaveBeenCalledTimes(1);
    });
});

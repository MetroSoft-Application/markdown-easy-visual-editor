import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HTML_EXPORT_SETTINGS,
  DEFAULT_HTML_EXPORT_OPTIONS,
  mergeHtmlExportOptions,
  normalizeHtmlExportSettings,
} from '../src/shared/protocol';

describe('HTML export settings', () => {
  it('uses the shared defaults for missing or invalid persisted values', () => {
    expect(normalizeHtmlExportSettings(undefined)).toEqual(DEFAULT_HTML_EXPORT_SETTINGS);
    expect(normalizeHtmlExportSettings({ embedImages: 'yes' })).toEqual(DEFAULT_HTML_EXPORT_SETTINGS);
  });

  it('preserves all global HTML export choices', () => {
    expect(normalizeHtmlExportSettings({
      embedImages: true,
      convertLinkedMarkdown: true,
      saveWithoutDialog: false,
    })).toEqual({
      embedImages: true,
      convertLinkedMarkdown: true,
      saveWithoutDialog: false,
    });
  });

  it('applies the global saveWithoutDialog choice to export options', () => {
    expect(mergeHtmlExportOptions(
      { ...DEFAULT_HTML_EXPORT_OPTIONS, saveWithoutDialog: false },
      { embedImages: true, convertLinkedMarkdown: true, saveWithoutDialog: true },
    )).toEqual({
      embedImages: true,
      convertLinkedMarkdown: true,
      saveWithoutDialog: true,
    });
    expect(mergeHtmlExportOptions(
      { ...DEFAULT_HTML_EXPORT_OPTIONS, saveWithoutDialog: true },
      { embedImages: true, convertLinkedMarkdown: false, saveWithoutDialog: false },
    ).saveWithoutDialog).toBe(false);
  });
});

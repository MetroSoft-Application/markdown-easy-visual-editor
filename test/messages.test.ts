import { describe, expect, it } from 'vitest';
import { getMessages, resolveLanguage } from '../src/shared/messages';
import localeCatalog from '../src/shared/locales.json';

describe('message language resolution', () => {
  it('follows the VS Code language for auto', () => {
    expect(resolveLanguage('auto', 'ja-JP')).toBe('ja');
    expect(resolveLanguage('auto', 'en-US')).toBe('en');
    expect(resolveLanguage('auto', 'zh-CN')).toBe('zh-cn');
    expect(resolveLanguage('auto', 'ko-KR')).toBe('ko');
    expect(resolveLanguage('auto', 'fr-FR')).toBe('fr');
    expect(resolveLanguage('auto', 'de-DE')).toBe('de');
    expect(resolveLanguage('auto', 'es-ES')).toBe('es');
  });

  it('prioritizes an explicit language over the detected language', () => {
    expect(resolveLanguage('ja', 'en-US')).toBe('ja');
    expect(resolveLanguage('en', 'ja-JP')).toBe('en');
    expect(resolveLanguage('zh-cn', 'ja-JP')).toBe('zh-cn');
  });

  it('returns the matching catalog', () => {
    expect(getMessages('ja').ribbon.tabs.home).toBe('ホーム');
    expect(getMessages('en').ribbon.tabs.home).toBe('Home');
    expect(getMessages('auto', 'ja-JP').editor.plainText).toBe('プレーンテキスト');
    expect(getMessages('zh-cn').ribbon.tabs.home).toBe('主页');
    expect(getMessages('ko').ribbon.tabs.home).toBe('홈');
    expect(getMessages('fr').ribbon.tabs.home).toBe('Accueil');
    expect(getMessages('de').ribbon.tabs.home).toBe('Start');
    expect(getMessages('es').ribbon.tabs.home).toBe('Inicio');
  });

  it('keeps a complete independent catalog for every supported language', () => {
    const walk = (value: unknown, prefix = ''): string[] => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix];
      return Object.keys(value).flatMap((key) => walk((value as Record<string, unknown>)[key], prefix ? `${prefix}.${key}` : key));
    };
    const baseKeys = walk(localeCatalog.en).sort();

    for (const language of ['ja', 'en', 'zh-cn', 'ko', 'fr', 'de', 'es'] as const) {
      expect(walk(localeCatalog[language]).sort(), language).toEqual(baseKeys);
    }
  });
});

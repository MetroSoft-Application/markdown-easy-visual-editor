/**
 * @fileoverview 対応言語ごとの表示文言、補間パラメーター、未登録キーのフォールバックを検証する。
 */
import { describe, expect, it } from 'vitest';
import { getMessages, resolveLanguage, SUPPORTED_LANGUAGES } from '../src/shared/messages';
import localeCatalog from '../src/shared/locales.json';

describe('message language resolution',
    () => {
        it('follows the VS Code language for auto',
            () => {
                expect(resolveLanguage('auto', 'ja-JP')).toBe('ja');
                expect(resolveLanguage('auto', 'en-US')).toBe('en');
                expect(resolveLanguage('auto', 'zh-CN')).toBe('zh-cn');
                expect(resolveLanguage('auto', 'ko-KR')).toBe('ko');
                expect(resolveLanguage('auto', 'fr-FR')).toBe('fr');
                expect(resolveLanguage('auto', 'de-DE')).toBe('de');
                expect(resolveLanguage('auto', 'es-ES')).toBe('es');
            });

        it('prioritizes an explicit language over the detected language',
            () => {
                expect(resolveLanguage('ja', 'en-US')).toBe('ja');
                expect(resolveLanguage('en', 'ja-JP')).toBe('en');
                expect(resolveLanguage('zh-cn', 'ja-JP')).toBe('zh-cn');
            });

        it('returns the matching catalog',
            () => {
                expect(getMessages('ja').ribbon.tabs.home).toBe('ホーム');
                expect(getMessages('en').ribbon.tabs.home).toBe('Home');
                expect(getMessages('auto', 'ja-JP').editor.plainText).toBe('プレーンテキスト');
                expect(getMessages('zh-cn').ribbon.tabs.home).toBe('主页');
                expect(getMessages('ko').ribbon.tabs.home).toBe('홈');
                expect(getMessages('fr').ribbon.tabs.home).toBe('Accueil');
                expect(getMessages('de').ribbon.tabs.home).toBe('Start');
                expect(getMessages('es').ribbon.tabs.home).toBe('Inicio');
                for (const language of SUPPORTED_LANGUAGES) {
                    expect(getMessages(language).ribbon.scrollSync, language).toBeTruthy();
                    expect(getMessages(language).ribbon.scrollSyncTitle, language).toBeTruthy();
                }
            });

        it('keeps a complete independent catalog for every supported language',
            () => {


                /**
                 * ロケールカタログを再帰走査し、葉のキーをドット区切りで集める。
                 * @param value - 現在走査しているロケール値。
                 * @param prefix - 現在の値までに連結したキーのパス。
                 * @returns カタログ内の葉を示すキーの一覧。
                 */
                const walk = (value: unknown, prefix = ''): string[] => {
                    if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix];
                    return Object.keys(value).flatMap((key) =>
                        walk((value as Record<string, unknown>)[key], prefix ? `${prefix}.${key}` : key));
                };
                const baseKeys = walk(localeCatalog.en).sort();

                for (const language of ['ja', 'en', 'zh-cn', 'ko', 'fr', 'de', 'es'] as const) {
                    expect(walk(localeCatalog[language]).sort(), language).toEqual(baseKeys);
                }
            });

        it('provides localized table editor messages and interpolates limits',
            () => {
                const languages = ['ja', 'en', 'zh-cn', 'ko', 'fr', 'de', 'es'] as const;
                const titles = languages.map(
                    (language) => getMessages(language).app.tableEditor.title);

                expect(new Set(titles).size).toBe(languages.length);
                for (const language of languages) {
                    const tableEditor = getMessages(language).app.tableEditor;
                    expect(tableEditor.title, language).toBeTruthy();
                    expect(tableEditor.navigationHint, language).toBeTruthy();
                    expect(tableEditor.copyColumn, language).toBeTruthy();
                    expect(tableEditor.copyRow, language).toBeTruthy();
                    expect(tableEditor.sortAscending, language).toBeTruthy();
                    expect(tableEditor.sortDescending, language).toBeTruthy();
                    expect(tableEditor.rowColumnLimit(2, 3), language).toContain('2');
                    expect(tableEditor.rowColumnLimit(2, 3), language).toContain('3');
                    expect(tableEditor.rowColumnLimit(2, 3), language).not.toContain('{rows}');
                    expect(tableEditor.rowColumnLimit(2, 3), language).not.toContain('{columns}');
                }
            });

        it('keeps the English catalog free of Japanese and CJK text',
            () => {


                /**
                 * 文字列にひらがな、カタカナ、またはCJK統合漢字が含まれるか調べる。
                 * @param value - 判定する翻訳文字列。
                 * @returns 対象文字を含む場合はtrue。
                 */
                const cjk = (value: string): boolean => Array.from(value).some((character) => {
                    const codePoint = character.codePointAt(0) ?? 0;
                    return (codePoint >= 0x3040 && codePoint <= 0x30ff)
                        || (codePoint >= 0x3400 && codePoint <= 0x9fff);
                });

                /**
                 * ロケールを再帰走査し、未翻訳のCJK文字を含むキーを集める。
                 * @param value - 現在走査しているロケール値。
                 * @param prefix - 現在の値までに連結したキーのパス。
                 * @returns CJK文字を含む翻訳項目のキー一覧。
                 */
                const findCjk = (value: unknown, prefix = ''): string[] => {
                    if (typeof value === 'string') return cjk(value) ? [prefix] : [];
                    if (!value || typeof value !== 'object') return [];
                    return Object.entries(value).flatMap(([key, child]) =>
                        findCjk(child, prefix ? `${prefix}.${key}` : key));
                };

                expect(findCjk(localeCatalog.en)).toEqual([]);
            });
    });

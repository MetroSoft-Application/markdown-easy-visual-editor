/**
 * @fileoverview 表示文言・テストの回帰の仕様と回帰条件を検証する。失敗時は期待値と実装差分を示す。
 */
import { describe, expect, it } from 'vitest';
import { getMessages, resolveLanguage, SUPPORTED_LANGUAGES } from '../src/shared/messages';
import localeCatalog from '../src/shared/locales.json';

describe('message language resolution',
    /**
     * 「message language resolution」の仕様と回帰条件を検証するテストケース。
     * @returns テストケースを実行し、値は返さない。
     */
    () => {
        it('follows the VS Code language for auto',
            /**
             * 「follows the VS Code language for auto」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
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
            /**
             * 「prioritizes an explicit language over the detected language」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                expect(resolveLanguage('ja', 'en-US')).toBe('ja');
                expect(resolveLanguage('en', 'ja-JP')).toBe('en');
                expect(resolveLanguage('zh-cn', 'ja-JP')).toBe('zh-cn');
            });

        it('returns the matching catalog',
            /**
             * 「returns the matching catalog」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
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
            /**
             * 「keeps a complete independent catalog for every supported language」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {


                const walk = /**
     * 表示文言・テストの回帰のwalkを処理し、呼び出し側へ結果または副作用を返す。
     * @param value - 検証・変換・保存の対象となる値。
     * @param prefix - 表示文言・テストの回帰の位置・寸法・件数・時間を表す数値。
     * @returns 表示文言・テストの回帰で利用する文字列。
     */ (value: unknown, prefix = ''): string[] => {
                        if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix];
                        return Object.keys(value).flatMap(
                            /**
                             * keyをwalkへ渡し、表示文言・テストの回帰の結果または副作用を処理する。
                             * @param key - 表示文言・テストの回帰の対象や分岐を識別する値。
                             * @returns 表示文言・テストの回帰で利用する文字列。
                             */
                            (key) => walk((value as Record<string, unknown>)[key], prefix ? `${prefix}.${key}` : key));
                    };
                const baseKeys = walk(localeCatalog.en).sort();

                for (const language of ['ja', 'en', 'zh-cn', 'ko', 'fr', 'de', 'es'] as const) {
                    expect(walk(localeCatalog[language]).sort(), language).toEqual(baseKeys);
                }
            });

        it('provides localized table editor messages and interpolates limits',
            /**
             * 「provides localized table editor messages and interpolates limits」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {
                const languages = ['ja', 'en', 'zh-cn', 'ko', 'fr', 'de', 'es'] as const;
                const titles = languages.map(
                    /**
                     * 各languageをget・messagesへ渡し、変換結果を一覧化する。
                     * @param language - 表示文言・テストの回帰の対象や分岐を識別する値。
                     * @returns 入力要素から生成した変換結果の一覧。
                     */
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
            /**
             * 「keeps the English catalog free of Japanese and CJK text」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
             */
            () => {


                const cjk = /**
     * 表示文言・テストの回帰のcjkを処理し、呼び出し側へ結果または副作用を返す。
     * @param value - 検証・変換・保存の対象となる値。
     * @returns 条件が成立したかを示す真偽値。
     */ (value: string): boolean => Array.from(value).some(
                    /**
                     * characterをcode・point・atへ渡し、表示文言・テストの回帰の結果または副作用を処理する。
                     * @param character - 表示文言・テストの回帰へ渡す入力。
                     * @returns 表示文言・テストの回帰で利用する文字列。
                     */
                    (character) => {
                        const codePoint = character.codePointAt(0) ?? 0;
                        return (codePoint >= 0x3040 && codePoint <= 0x30ff)
                            || (codePoint >= 0x3400 && codePoint <= 0x9fff);
                    });


                const findCjk = /**
     * 表示文言・テストの回帰から必要な値またはリソースを取得する。
     * @param value - 検証・変換・保存の対象となる値。
     * @param prefix - 表示文言・テストの回帰の位置・寸法・件数・時間を表す数値。
     * @returns 表示文言・テストの回帰で利用する文字列。
     */ (value: unknown, prefix = ''): string[] => {
                        if (typeof value === 'string') return cjk(value) ? [prefix] : [];
                        if (!value || typeof value !== 'object') return [];
                        return Object.entries(value).flatMap(
                            /**
                             * 設定をfind・cjkへ渡し、表示文言・テストの回帰の結果または副作用を処理する。
                             * @param options - 呼び出し側が指定する処理設定。
                             * @returns 表示文言・テストの回帰のコールバックが生成する結果。
                             */
                            ([key, child]) => findCjk(child, prefix ? `${prefix}.${key}` : key));
                    };

                expect(findCjk(localeCatalog.en)).toEqual([]);
            });
    });

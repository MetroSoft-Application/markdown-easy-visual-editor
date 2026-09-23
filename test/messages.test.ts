/**
 * @file messages.test.ts
 * 実行境界: テスト実行環境。
 * 責務: 現行実装の仕様と回帰条件を検証する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テスト用のモック、ブラウザー、ファイルを必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { describe, expect, it } from 'vitest';
import { getMessages, resolveLanguage, SUPPORTED_LANGUAGES } from '../src/shared/messages';
import localeCatalog from '../src/shared/locales.json';

describe('message language resolution',
/**
 * テスト「message language resolution」の前提条件を設定し、期待結果を検証するコールバックです。
 * @returns テストの前提条件と期待結果を検証し、値を返しません。
 */
() => {
  it('follows the VS Code language for auto',
  /**
 * テスト「follows the VS Code language for auto」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
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
 * テスト「prioritizes an explicit language over the detected language」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(resolveLanguage('ja', 'en-US')).toBe('ja');
    expect(resolveLanguage('en', 'ja-JP')).toBe('en');
    expect(resolveLanguage('zh-cn', 'ja-JP')).toBe('zh-cn');
  });

  it('returns the matching catalog',
  /**
 * テスト「returns the matching catalog」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
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
 * テスト「keeps a complete independent catalog for every supported language」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストデータまたは検証処理が生成した値を返します。
   */
  () => {

    /**
     * 「walk」は、各対象へ必要な副作用処理を適用します。
     * @param value 「walk」で検証・変換する入力値です。
     * @param prefix 文字列の先頭または末尾に付く部分文字列です。
     * @returns 「walk」が生成または変換した言語別メッセージの文字列を返します。
     */
    const walk = /**
 * 「walk」は、各対象へ必要な副作用処理を適用します。
 * @param value 「walk」で検証・変換する入力値です。
 * @param prefix 「prefix」は、「walk」が言語別メッセージで処理する対象を特定する入力です。
 * @returns テストデータまたは検証処理が生成した値を返します。
 */ (value: unknown, prefix = ''): string[] => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix];
      return Object.keys(value).flatMap(
      /**
 * テスト「keeps a complete independent catalog for every supported language」の前提条件を設定し、期待結果を検証するコールバックです。
       * @param key メッセージまたは設定表から値を取得する識別キーです。
       * @returns テストの前提条件と期待結果を検証し、値を返しません。
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
 * 登録された処理を比較し、並び順を示す数値を返すコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const languages = ['ja', 'en', 'zh-cn', 'ko', 'fr', 'de', 'es'] as const;
    const titles = languages.map(
    /**
 * 「language」を変換し、変換後の要素を返すコールバックです。
     * @param language 表示文言の解決に使用する言語コードまたはロケールです。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (language) => getMessages(language).app.tableEditor.title);

    expect(new Set(titles).size).toBe(languages.length);
    for (const language of languages) {
      const tableEditor = getMessages(language).app.tableEditor;
      expect(tableEditor.title, language).toBeTruthy();
      expect(tableEditor.navigationHint, language).toBeTruthy();
      expect(tableEditor.copyColumn, language).toBeTruthy();
      expect(tableEditor.copyRow, language).toBeTruthy();
      expect(tableEditor.rowColumnLimit(2, 3), language).toContain('2');
      expect(tableEditor.rowColumnLimit(2, 3), language).toContain('3');
      expect(tableEditor.rowColumnLimit(2, 3), language).not.toContain('{rows}');
      expect(tableEditor.rowColumnLimit(2, 3), language).not.toContain('{columns}');
    }
  });

  it('keeps the English catalog free of Japanese and CJK text',
  /**
 * 登録された処理が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
   * @returns テストデータまたは検証処理が生成した値を返します。
   */
  () => {

    /**
     * 「cjk」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
     * @param value 「cjk」で検証・変換する入力値です。
     * @returns 判定結果です。
     */
    const cjk = /**
 * 「cjk」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param value 「cjk」で検証・変換する入力値です。
 * @returns テストデータまたは検証処理が生成した値を返します。
 */ (value: string): boolean => Array.from(value).some(
    /**
 * 「character」が条件を満たすか判定し、該当する要素の有無を返すコールバックです。
     * @param character HTMLまたはテキストから取り出した対象文字列です。
     * @returns 条件判定の結果を示す真偽値を返します。
     */
    (character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (codePoint >= 0x3040 && codePoint <= 0x30ff)
        || (codePoint >= 0x3400 && codePoint <= 0x9fff);
    });

    /**
     * find・cjkを取得または解決します。
     * @param value 「findCjk」で検証・変換する入力値です。
     * @param prefix 文字列の先頭または末尾に付く部分文字列です。
     * @returns 「findCjk」が生成または変換した言語別メッセージの文字列を返します。
     */
    const findCjk = /**
 * 「findCjk」は、要求された状態、値、または対象を読み取ります。
 * @param value 「findCjk」で検証・変換する入力値です。
 * @param prefix 「prefix」は、「findCjk」が言語別メッセージで処理する対象を特定する入力です。
 * @returns 「findCjk」が読み取りまたは正規化した結果を返します。
 */ (value: unknown, prefix = ''): string[] => {
      if (typeof value === 'string') return cjk(value) ? [prefix] : [];
      if (!value || typeof value !== 'object') return [];
      return Object.entries(value).flatMap(
      /**
 * 「key」「child」を受け取り、登録された副作用または結果を生成する処理です。
       * @param options 分割代入で受け取る入力オブジェクトです。主なフィールドはkey、childです。
       * @returns 「options」から生成した処理結果を返します。
       */
      ([key, child]) => findCjk(child, prefix ? `${prefix}.${key}` : key));
    };

    expect(findCjk(localeCatalog.en)).toEqual([]);
  });
});

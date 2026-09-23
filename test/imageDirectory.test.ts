/**
 * @file imageDirectory.test.ts
 * 実行境界: テスト実行環境。
 * 責務: 現行実装の仕様と回帰条件を検証する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テスト用のモック、ブラウザー、ファイルを必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { describe, expect, it } from 'vitest';
import { normalizeImageDirectoryRule, resolveImageDirectoryRule } from '../src/shared/imageDirectory';

describe('image directory rules',
/**
 * テスト「image directory rules」の前提条件を設定し、期待結果を検証するコールバックです。
 * @returns テストの前提条件と期待結果を検証し、値を返しません。
 */
() => {
    it('normalizes relative paths and expands the document basename',
    /**
 * テスト「normalizes relative paths and expands the document basename」の前提条件を設定し、期待結果を検証するコールバックです。
     * @returns テストの前提条件と期待結果を検証し、値を返しません。
     */
    () => {
        expect(normalizeImageDirectoryRule(' ./assets\\${documentBasename}/ ')).toBe('assets/${documentBasename}');
        expect(resolveImageDirectoryRule('assets/${documentBasename}', 'guide')).toBe('assets/guide');
    });

    it('allows saving beside the Markdown document',
    /**
 * テスト「allows saving beside the Markdown document」の前提条件を設定し、期待結果を検証するコールバックです。
     * @returns テストの前提条件と期待結果を検証し、値を返しません。
     */
    () => {
        expect(resolveImageDirectoryRule('.', 'guide')).toBe('.');
    });

    it('rejects absolute paths, traversal, URLs, and unsupported variables',
    /**
 * テスト「rejects absolute paths, traversal, URLs, and unsupported variables」の前提条件を設定し、期待結果を検証するコールバックです。
     * @returns テストの前提条件と期待結果を検証し、値を返しません。
     */
    () => {
        expect(normalizeImageDirectoryRule('../images')).toBeUndefined();
        expect(normalizeImageDirectoryRule('C:\\images')).toBeUndefined();
        expect(normalizeImageDirectoryRule('/images')).toBeUndefined();
        expect(normalizeImageDirectoryRule('https://example.com/images')).toBeUndefined();
        expect(normalizeImageDirectoryRule('assets/${workspaceFolder}')).toBeUndefined();
    });
});

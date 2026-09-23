/**
 * @file vitest.config.mts
 * 実行境界: Vitest。
 * 責務: テスト対象と実行環境を設定する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テストランナーの解決と実行設定だけを変更する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { defineConfig } from 'vitest/config';

/** テスト対象、実行環境、カバレッジ出力を統一するVitest設定を生成する。 @returns Vitestが読み込む設定オブジェクト。 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html']
    }
  }
});

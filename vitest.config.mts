/**
 * @fileoverview Vitestの実行環境、テストファイルの対象範囲、カバレッジ出力形式を設定する。
 */
import { defineConfig } from 'vitest/config';

/**
 * Node環境でtest/**/*.test.tsを実行し、カバレッジをtextとHTMLで出力する設定。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html']
    }
  }
});

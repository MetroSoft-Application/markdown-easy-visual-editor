/**
 * @fileoverview Webviewのvitest・configを管理する。Hostとの通信、ユーザー操作、表示状態の契約を保つ。
 */
import { defineConfig } from 'vitest/config';

/**
 * vitest・configのexportを処理し、呼び出し側へ結果または副作用を返す。
 * @returns vitest・configのexportが生成する結果。
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

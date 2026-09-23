/**
 * @file samples.test.ts
 * 実行境界: テスト実行環境。
 * 責務: 現行実装の仕様と回帰条件を検証する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テスト用のモック、ブラウザー、ファイルを必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectDiagnostics, getOutline, splitMarkdownBlocks } from '../src/shared/markdown';

/** 「sampleRoot」は、対象ファイルまたは実行環境の場所を表す値です。 */
const sampleRoot = path.resolve('sample');
/** 「sampleFiles」は、対象ファイルまたは実行環境の場所を表す値です。 */
const sampleFiles = readdirSync(sampleRoot)
  // sample/ は手元の検証用ファイルも置けるため、製品の回帰fixtureだけを対象にする。
  .filter(
  /**
 * 「name」が条件に一致するか判定し、残す要素を決めるコールバックです。
   * @param name 対象を識別する名前で、表示または処理分岐に使用します。
   * @returns 要素を採用するかどうかの真偽値を返します。
   */
  (name) => /^(?:\d{2}-.+|outline-reorder-undo|README)\.md$/.test(name))
  .map(
  /**
 * 「name」を変換し、変換後の要素を返すコールバックです。
   * @param name 対象を識別する名前で、表示または処理分岐に使用します。
   * @returns 入力要素から生成した変換後の値を返します。
   */
  (name) => path.join(sampleRoot, name));

describe('sample Markdown documents',
/**
 * テスト「sample Markdown documents」の前提条件を設定し、期待結果を検証するコールバックです。
 * @returns テストの前提条件と期待結果を検証し、値を返しません。
 */
() => {
  it('contains the expected regression documents',
  /**
 * テスト「contains the expected regression documents」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(sampleFiles.length).toBeGreaterThanOrEqual(8);
  });

  for (const file of sampleFiles) {
    const name = path.basename(file);
    it(`${name} can be split without losing bytes`,
    /**
 * テスト「${name} can be split without losing bytes」の前提条件を設定し、期待結果を検証するコールバックです。
     * @returns テストの前提条件と期待結果を検証し、値を返しません。
     */
    () => {
      const markdown = readFileSync(file, 'utf8');
      expect(splitMarkdownBlocks(markdown).map(
      /**
 * 「block」を変換し、変換後の要素を返すコールバックです。
       * @param block blockとして渡される、このコールバックの入力値です。
       * @returns 入力要素から生成した変換後の値を返します。
       */
      (block) => block.raw).join('')).toBe(markdown);
      expect(getOutline(markdown).length).toBeGreaterThan(0);
    });
  }

  it('contains a valid local image fixture',
  /**
 * テスト「contains a valid local image fixture」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const image = path.join(sampleRoot, 'assets', 'local-sample.svg');
    expect(statSync(image).isFile()).toBe(true);
    expect(readFileSync(image, 'utf8')).toContain('<svg');
  });

  it('contains a dedicated diagnostics verification document',
  /**
 * テスト「contains a dedicated diagnostics verification document」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const markdown = readFileSync(path.join(sampleRoot, '08-diagnostics.md'), 'utf8');
    const codes = new Set(collectDiagnostics(markdown).map(
    /**
 * 「item」を変換し、変換後の要素を返すコールバックです。
     * @param item 変換または処理の対象となる値です。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (item) => item.code));
    expect(codes).toEqual(new Set([
      'broken-reference-link',
      'duplicate-heading',
      'empty-image-alt',
      'empty-table-header',
      'invalid-table-separator',
      'local-image',
      'table-column-mismatch',
      'unclosed-fence'
    ]));
  });
});

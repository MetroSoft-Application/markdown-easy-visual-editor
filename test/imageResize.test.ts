/**
 * @file imageResize.test.ts
 * 実行境界: テスト実行環境。
 * 責務: 現行実装の仕様と回帰条件を検証する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テスト用のモック、ブラウザー、ファイルを必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { describe, expect, it } from 'vitest';
import { alignImageInMarkdown, resetImageSizeInMarkdown, resizeImageInMarkdown } from '../src/shared/imageResize';

describe('画像リサイズ用Markdown編集',
/**
 * テスト「画像リサイズ用Markdown編集」の前提条件を設定し、期待結果を検証するコールバックです。
 * @returns テストの前提条件と期待結果を検証し、値を返しません。
 */
() => {
  it('Markdown画像を幅指定付きHTMLへ変換する',
  /**
 * テスト「Markdown画像を幅指定付きHTMLへ変換する」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(resizeImageInMarkdown('![図](assets/a.png)', 0, 240))
      .toBe('<img src="assets/a.png" alt="図" width="240">');
  });

  it('HTML画像のwidthを更新し、heightを除去する',
  /**
 * テスト「HTML画像のwidthを更新し、heightを除去する」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(resizeImageInMarkdown('<img src="assets/a.png" width="320" height="180">', 0, 180))
      .toBe('<img src="assets/a.png" width="180">');
  });

  it('HTML画像のサイズを自然サイズへ戻す',
  /**
 * テスト「HTML画像のサイズを自然サイズへ戻す」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(resetImageSizeInMarkdown('<img src="assets/a.png" width="320" height="180">', 0))
      .toBe('<img src="assets/a.png">');
  });

  it('コード中の画像を除外して表示順の画像を更新する',
  /**
 * テスト「コード中の画像を除外して表示順の画像を更新する」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const source = '```md\n![コード](assets/code.png)\n```\n\n![本文](assets/body.png)';
    expect(resizeImageInMarkdown(source, 1, 200)).toBe(source);
    expect(resizeImageInMarkdown(source, 0, 200))
      .toContain('<img src="assets/body.png" alt="本文" width="200">');
  });

  it('Markdown画像とHTML画像をソース順に扱う',
  /**
 * テスト「Markdown画像とHTML画像をソース順に扱う」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const source = '![Markdown](a.png)\n<img src="b.png">';
    expect(resizeImageInMarkdown(source, 1, 160)).toBe('![Markdown](a.png)\n<img src="b.png" width="160">');
  });

  it('参照形式のMarkdown画像をHTMLへ変換する',
  /**
 * テスト「参照形式のMarkdown画像をHTMLへ変換する」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const source = '![図][asset]\n\n[asset]: assets/a.png "説明"';
    expect(resizeImageInMarkdown(source, 0, 128))
      .toContain('<img src="assets/a.png" alt="図" width="128" title="説明">');
  });

  it('Markdown画像の揃え位置をHTMLへ変換する',
  /**
 * テスト「Markdown画像の揃え位置をHTMLへ変換する」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(alignImageInMarkdown('![図](assets/a.png)', 0, 'center'))
      .toBe('<img src="assets/a.png" alt="図" align="center">');
  });

  it('HTML画像の揃え位置を更新し、widthを保持する',
  /**
 * テスト「HTML画像の揃え位置を更新し、widthを保持する」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    expect(alignImageInMarkdown('<img src="assets/a.png" width="160" align="left">', 0, 'right'))
      .toBe('<img src="assets/a.png" width="160" align="right">');
  });
});

import { describe, expect, it } from 'vitest';
import { alignImageInMarkdown, resetImageSizeInMarkdown, resizeImageInMarkdown } from '../src/shared/imageResize';

describe('画像リサイズ用Markdown編集', () => {
  it('Markdown画像を幅指定付きHTMLへ変換する', () => {
    expect(resizeImageInMarkdown('![図](assets/a.png)', 0, 240))
      .toBe('<img src="assets/a.png" alt="図" width="240">');
  });

  it('HTML画像のwidthを更新し、heightを除去する', () => {
    expect(resizeImageInMarkdown('<img src="assets/a.png" width="320" height="180">', 0, 180))
      .toBe('<img src="assets/a.png" width="180">');
  });

  it('HTML画像のサイズを自然サイズへ戻す', () => {
    expect(resetImageSizeInMarkdown('<img src="assets/a.png" width="320" height="180">', 0))
      .toBe('<img src="assets/a.png">');
  });

  it('コード中の画像を除外して表示順の画像を更新する', () => {
    const source = '```md\n![コード](assets/code.png)\n```\n\n![本文](assets/body.png)';
    expect(resizeImageInMarkdown(source, 1, 200)).toBe(source);
    expect(resizeImageInMarkdown(source, 0, 200))
      .toContain('<img src="assets/body.png" alt="本文" width="200">');
  });

  it('Markdown画像とHTML画像をソース順に扱う', () => {
    const source = '![Markdown](a.png)\n<img src="b.png">';
    expect(resizeImageInMarkdown(source, 1, 160)).toBe('![Markdown](a.png)\n<img src="b.png" width="160">');
  });

  it('参照形式のMarkdown画像をHTMLへ変換する', () => {
    const source = '![図][asset]\n\n[asset]: assets/a.png "説明"';
    expect(resizeImageInMarkdown(source, 0, 128))
      .toContain('<img src="assets/a.png" alt="図" width="128" title="説明">');
  });

  it('Markdown画像の揃え位置をHTMLへ変換する', () => {
    expect(alignImageInMarkdown('![図](assets/a.png)', 0, 'center'))
      .toBe('<img src="assets/a.png" alt="図" align="center">');
  });

  it('HTML画像の揃え位置を更新し、widthを保持する', () => {
    expect(alignImageInMarkdown('<img src="assets/a.png" width="160" align="left">', 0, 'right'))
      .toBe('<img src="assets/a.png" width="160" align="right">');
  });
});

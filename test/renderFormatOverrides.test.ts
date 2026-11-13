/**
 * @fileoverview 変換タブで切り替えた文書ごとの表示形式を保持する値の読み書き（extension/renderFormatOverrides）を検証する。
 * 検証する仕様: 保持した本文の指紋と現在の本文が一致する場合だけ表示形式を使うこと（外部の変更・テキストエディターでの編集・
 * 保存せずに閉じた変換で本文が変わったら、古い表示形式を使わない）。不正な値と旧形式（指紋のない値）を捨てること。
 * 保持する文書の数を上限までに保ち、更新した文書を最も新しいものとして扱うこと。
 * 回帰リスク: 本文と切り離された表示形式で、元の記法の文書を誤った形式で描画すること。保持する値が際限なく増えること。
 * 実行境界はtest（Node）。VS Code APIに依存しない純粋な関数だけを呼ぶ。
 */
import { describe, expect, it } from 'vitest';
import { fingerprintText } from '../src/shared/canonicalText';
import { readStoredRenderFormat, updateStoredRenderFormats } from '../src/extension/renderFormatOverrides';

describe('stored render formats',
    () => {
        const uri = 'file:///e%3A/doc.textile';
        const converted = '# Title\n\ntext\n';

        it('uses the stored format only while the document text is the converted text',
            () => {
                const stored = updateStoredRenderFormats(undefined, uri, 'mixed', fingerprintText(converted), 500);
                expect(readStoredRenderFormat(stored, uri, converted)).toBe('mixed');
                // 外部の変更・テキストエディターでのUndo・保存せずに閉じた変換で本文が元のTextileに戻った場合は使わない。
                expect(readStoredRenderFormat(stored, uri, 'h1. Title\n\ntext\n')).toBeUndefined();
                expect(readStoredRenderFormat(stored, 'file:///e%3A/other.textile', converted)).toBeUndefined();
            });

        it('clears the stored format and ignores invalid or old values',
            () => {
                const stored = updateStoredRenderFormats(undefined, uri, 'mixed', fingerprintText(converted), 500);
                expect(updateStoredRenderFormats(stored, uri, undefined, undefined, 500)).toEqual({});
                for (const value of [null, 1, 'mixed', { [uri]: 'mixed' }, { [uri]: { format: 'html', fingerprint: fingerprintText(converted) } }, { [uri]: { format: 'mixed' } }]) {
                    expect(readStoredRenderFormat(value, uri, converted), JSON.stringify(value)).toBeUndefined();
                    expect(updateStoredRenderFormats(value, 'file:///x', undefined, undefined, 500), JSON.stringify(value)).toEqual({});
                }
            });

        it('keeps at most the given number of documents and treats the updated document as the newest',
            () => {
                let stored: unknown = undefined;
                for (let index = 0; index < 5; index += 1) stored = updateStoredRenderFormats(stored, `file:///${index}`, 'textile', 'f', 3);
                expect(Object.keys(stored as object)).toEqual(['file:///2', 'file:///3', 'file:///4']);
                stored = updateStoredRenderFormats(stored, 'file:///2', 'mixed', 'g', 3);
                stored = updateStoredRenderFormats(stored, 'file:///5', 'mixed', 'h', 3);
                expect(Object.keys(stored as object)).toEqual(['file:///4', 'file:///2', 'file:///5']);
            });
    });

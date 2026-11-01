/**
 * @fileoverview 全サンプル文書のアウトライン（見出しID・位置・階層）をゴールデンファイルと比較し、アウトライン抽出の実装移動による変化を検出する。
 * 実行境界: Vitest（Node）。アウトラインはプレビューの見出しID、アウトラインパネル、セクションリンクのコピーに使われるため、1件の差異でも利用者に見える回帰になる。
 * ゴールデンの更新: MVE_UPDATE_GOLDEN=1 で test/fixtures/outline-golden.json を書き直す。更新は抽出仕様を意図的に変えた場合に限り、差分をレビューする。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getOutlineForFormat, renderMarkdownUnsafeBlocks } from '../src/webview/markdown/markdownRendererCore';
import { listTrackedSampleDocuments, renderFormatsFor } from './sampleDocuments';

/**
 * ゴールデンファイルの場所。
 */
const goldenPath = path.resolve('test', 'fixtures', 'outline-golden.json');

/**
 * Git管理下の全サンプル・全描画形式のアウトラインを計算する。キーはリポジトリ相対パスと形式。
 * @returns キーからアウトライン項目一覧への対応。
 */
function computeOutlines(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const file of listTrackedSampleDocuments()) {
        const source = readFileSync(file, 'utf8');
        for (const renderFormat of renderFormatsFor(file)) {
            const blocks = renderMarkdownUnsafeBlocks(source, { remoteImagesEnabled: false, language: 'ja', renderFormat });
            const key = `${file}#${renderFormat}`;
            result[key] = getOutlineForFormat(source, renderFormat, blocks);
        }
    }
    return result;
}

describe('outline golden parity',
    () => {
        it('matches the recorded outlines for every sample document', () => {
            const actual = computeOutlines();
            if (process.env.MVE_UPDATE_GOLDEN === '1') {
                writeFileSync(goldenPath, `${JSON.stringify(actual, null, 1)}\n`, 'utf8');
            }
            // ゴールデンが欠けた状態で自動生成すると比較が空振りするため、明示的な更新指定がない限り失敗させる。
            expect(existsSync(goldenPath), `${goldenPath} がありません。MVE_UPDATE_GOLDEN=1 で生成してください。`).toBe(true);
            const expected = JSON.parse(readFileSync(goldenPath, 'utf8')) as Record<string, unknown>;
            expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
            for (const key of Object.keys(expected)) {
                expect(actual[key], key).toEqual(expected[key]);
            }
        });
    });

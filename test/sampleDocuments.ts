/**
 * @fileoverview 回帰テストが対象にする同梱サンプル文書（Git管理下の sample 配下のMarkdown・Textile）を列挙するテスト用ヘルパー。
 * 実行境界: Vitest（Node）。sample/ は .gitignore で手元の検証ファイルも置けるため、Git の索引に載っている文書だけを返して結果を環境に依存させない。
 * 失敗時: git コマンドが使えない場合は例外を投げる（対象を黙って減らさない）。
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { MarkdownRenderFormat } from '../src/webview/markdown/markdownRendererCore';

/**
 * Git管理下のサンプル文書を安定順で返す。
 * @returns リポジトリルートからの相対パス（区切りは /）の一覧。
 */
export function listTrackedSampleDocuments(): string[] {
    const output = execFileSync('git', ['ls-files', '-z', '--', 'sample'], { encoding: 'utf8' });
    return output
        .split('\0')
        .filter(
            /**
             * Markdown・Textile文書だけを残す。
             * @param file - git ls-files が返したパス。
             * @returns 対象文書ならtrue。
             */
            (file) => /\.(?:md|markdown|textile)$/i.test(file))
        .sort();
}

/**
 * 1文書に対して検証する描画形式を返す。Markdownは通常形式とTextile混在形式の両方、Textileは専用形式。
 * @param file - 文書ファイルのパス。
 * @returns 検証する描画形式の一覧。
 */
export function renderFormatsFor(file: string): MarkdownRenderFormat[] {
    return path.extname(file).toLowerCase() === '.textile' ? ['textile'] : ['markdown', 'mixed'];
}

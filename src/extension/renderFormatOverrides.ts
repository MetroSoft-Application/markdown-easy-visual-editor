/**
 * @fileoverview 変換タブで切り替えた文書ごとの表示形式を、ワークスペースの状態へ保持する値の読み書き（純粋な関数）。
 * 実行境界: Extension Host（extension.tsが workspaceState と組み合わせて使う）。VS Code APIに依存せず、単体テストで検証する。
 * 保持する値: 文書のURIの文字列 → { 表示形式, その表示形式で表示する本文の指紋 }。
 * 不変条件: 本文の指紋が現在の本文と一致する場合だけ表示形式を使う（外部の変更やテキストエディターでの編集で本文が変わったら、
 * 古い表示形式で誤って描画しない）。不正な値は捨てる。保持する文書の数は上限までとし、古いものから捨てる。
 */
import { fingerprintText } from '../shared/canonicalText';
import { isDocumentRenderFormat, type DocumentRenderFormat } from '../shared/protocol';

/** 保持する1文書分の値。 */
export interface StoredRenderFormat {
    /** 変換後の表示形式。 */
    format: DocumentRenderFormat;
    /** この表示形式で表示する本文の指紋（shared/canonicalTextのfingerprintText）。 */
    fingerprint: string;
}

/**
 * 保持している値から、文書の表示形式を読む。
 * @param stored - ワークスペースの状態に保持している値（不正な形でもよい）。
 * @param uri - 文書のURIの文字列。
 * @param text - 現在の本文（LF正規化済み）。
 * @returns 本文の指紋が一致する場合の表示形式。保持していない、不正な値、本文が変わった場合はundefined。
 */
export function readStoredRenderFormat(stored: unknown, uri: string, text: string): DocumentRenderFormat | undefined {
    const entry = stored && typeof stored === 'object' ? (stored as Record<string, unknown>)[uri] : undefined;
    if (!entry || typeof entry !== 'object') return undefined;
    const { format, fingerprint } = entry as { format?: unknown; fingerprint?: unknown };
    return isDocumentRenderFormat(format) && fingerprint === fingerprintText(text) ? format : undefined;
}

/**
 * 文書の表示形式を保持し直した値を作る。対象の文書は末尾へ入れ直し、上限を超えた分は古いものから捨てる。不正な値は捨てる。
 * @param stored - ワークスペースの状態に保持している値（不正な形でもよい）。
 * @param uri - 文書のURIの文字列。
 * @param format - 保持する表示形式。undefinedなら保持を解除する。
 * @param fingerprint - この表示形式で表示する本文の指紋。`format`を指定する場合に使う（なければ保持しない）。
 * @param max - 保持する文書の上限。
 * @returns 新しく保持する値。
 */
export function updateStoredRenderFormats(
    stored: unknown,
    uri: string,
    format: DocumentRenderFormat | undefined,
    fingerprint: string | undefined,
    max: number
): Record<string, StoredRenderFormat> {
    const next: Record<string, StoredRenderFormat> = {};
    for (const [key, value] of Object.entries(stored && typeof stored === 'object' ? stored : {})) {
        if (key === uri || !value || typeof value !== 'object') continue;
        const entry = value as { format?: unknown; fingerprint?: unknown };
        if (isDocumentRenderFormat(entry.format) && typeof entry.fingerprint === 'string') next[key] = { format: entry.format, fingerprint: entry.fingerprint };
    }
    if (format !== undefined && fingerprint !== undefined) next[uri] = { format, fingerprint };
    const keys = Object.keys(next);
    for (const key of keys.slice(0, Math.max(0, keys.length - max))) delete next[key];
    return next;
}

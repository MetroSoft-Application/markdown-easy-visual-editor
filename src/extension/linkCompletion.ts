/**
 * @fileoverview 本文エディターのリンク先補完に使う候補（ファイル一覧・見出し一覧）を Extension Host で集める。
 * 入力: 補完元の文書 URI と、見出し要求ではリンク先のパス。出力: protocol の LinkCompletionFile / LinkCompletionHeading。
 * 範囲は文書のワークスペースフォルダー（ない場合は文書のフォルダー）に限り、その外のファイルは列挙も読込みもしない。
 * ファイル一覧は短時間キャッシュし、VS Code 上でのファイル作成・削除・名前変更で破棄する。副作用はファイルの読み取りだけ。
 */
import * as vscode from 'vscode';
import path from 'node:path';
import { encodeLinkPath, relativePosixPath } from '../shared/linkPaths';
import { getOutlineForFormatSource } from '../shared/markdown';
import type { LinkCompletionFile, LinkCompletionHeading } from '../shared/protocol';
import { decodeLocalResourceSource } from './resourceCheck';
import { isDocumentRelativeResourcePath } from './resourceLink';
import { isExcludedWorkspacePath, pathIgnoreCase, readWorkspaceText } from './workspaceFiles';

/** 1回の列挙で扱うファイル数の上限。巨大なワークスペースで応答と通信量が膨らまないようにする。 */
const MAX_COMPLETION_FILES = 5000;

/** ファイル一覧キャッシュの有効期間。VS Code 外でのファイル操作は通知されないため、短めに再列挙する。 */
const FILE_CACHE_TTL_MS = 30_000;

/** Markdown文書として見出しを読む拡張子。 */
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);

/** 画像として候補の種類を分ける拡張子。 */
const IMAGE_EXTENSIONS = new Set([
    '.png', '.apng', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif', '.ico', '.heic', '.heif', '.jxl', '.tif', '.tiff'
]);

/** ワークスペースフォルダー単位でキャッシュするファイル一覧。 */
interface CachedFileList {
    /** キャッシュの有効期限（Date.now() 基準のミリ秒）。 */
    expiresAt: number;
    /** 列挙結果。列挙中の要求は同じ Promise を共有する。 */
    files: Promise<vscode.Uri[]>;
}

/**
 * リンク先補完の候補を集めるサービス。拡張機能の有効期間中に1つ作り、dispose でイベント購読を解除する。
 */
export class LinkCompletionProvider implements vscode.Disposable {
    /** 列挙範囲の URI 文字列をキーにしたファイル一覧キャッシュ。 */
    private readonly fileCache = new Map<string, CachedFileList>();

    /** ファイル操作イベントの購読。 */
    private readonly subscriptions: vscode.Disposable[];

    /**
     * VS Code 上でのファイル作成・削除・名前変更を購読し、キャッシュを破棄できるようにする。
     */
    constructor() {
        /** ファイル構成が変わったので、次の補完で一覧を作り直す。 */
        const invalidate = (): void => this.fileCache.clear();
        this.subscriptions = [
            vscode.workspace.onDidCreateFiles(invalidate),
            vscode.workspace.onDidDeleteFiles(invalidate),
            vscode.workspace.onDidRenameFiles(invalidate)
        ];
    }

    /**
     * イベント購読を解除し、キャッシュを破棄する。
     */
    dispose(): void {
        for (const subscription of this.subscriptions) subscription.dispose();
        this.fileCache.clear();
    }

    /**
     * 文書からリンクできるファイルの候補を返す。文書自身と除外フォルダー配下は含めない。
     * @param documentUri - 補完元の文書。
     * @returns Markdown、画像、その他の順、同じ種類では文書に近い順に並べた候補。未保存の文書では空配列。
     */
    async listFiles(documentUri: vscode.Uri): Promise<LinkCompletionFile[]> {
        if (documentUri.scheme === 'untitled') return [];
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
        const root = workspaceFolder?.uri ?? vscode.Uri.joinPath(documentUri, '..');
        const key = root.toString();
        const now = Date.now();
        let cached = this.fileCache.get(key);
        if (!cached || cached.expiresAt <= now) {
            cached = {
                expiresAt: now + FILE_CACHE_TTL_MS,
                // ワークスペース外の文書は、ホームフォルダーなどを深く走査しないよう、同じフォルダーの直下だけを列挙する。
                files: Promise.resolve(vscode.workspace.findFiles(
                    new vscode.RelativePattern(root, workspaceFolder ? '**/*' : '*'),
                    undefined,
                    MAX_COMPLETION_FILES
                ))
            };
            this.fileCache.set(key, cached);
            // 失敗した列挙をキャッシュに残さず、次の要求で再試行させる。
            cached.files.catch(() => {
                if (this.fileCache.get(key) === cached) this.fileCache.delete(key);
            });
        }
        const files = await cached.files;
        const ignoreCase = pathIgnoreCase(documentUri);
        const documentDirectory = path.posix.dirname(documentUri.path);
        const documentKey = comparablePath(documentUri.path, ignoreCase);
        const candidates: Array<LinkCompletionFile & { depth: number }> = [];
        for (const file of files) {
            if (file.scheme !== documentUri.scheme || comparablePath(file.path, ignoreCase) === documentKey) continue;
            const relative = relativePosixPath(documentDirectory, file.path, ignoreCase);
            if (!relative || isExcludedWorkspacePath(relative)) continue;
            candidates.push({
                path: encodeLinkPath(relative),
                kind: fileKind(file.path),
                depth: relative.split('/').length
            });
        }
        const kindOrder: Record<LinkCompletionFile['kind'], number> = { markdown: 0, image: 1, other: 2 };
        return candidates
            .sort(
                /**
                 * 種類、文書からの距離、パスの順に並べる。
                 * @param left - 比較する候補。
                 * @param right - 比較する候補。
                 * @returns 並び順を示す比較値。
                 */
                (left, right) => kindOrder[left.kind] - kindOrder[right.kind]
                    || left.depth - right.depth
                    || left.path.localeCompare(right.path))
            .map(({ path: candidatePath, kind }) => ({ path: candidatePath, kind }));
    }

    /**
     * リンク先パスが指す Markdown 文書の見出しを、プレビューと同じ ID 規則で返す。
     * 開いている文書は未保存の内容を使い、それ以外はファイルを読む。
     * @param documentUri - 補完元の文書。
     * @param rawPath - 本文に書かれたとおりのリンク先パス（`#` より前）。空文字なら補完元の文書自身。
     * @returns 見出し候補。範囲外・Markdown 以外・読込み失敗・サイズ超過の場合は空配列。
     */
    async listHeadings(documentUri: vscode.Uri, rawPath: string): Promise<LinkCompletionHeading[]> {
        const target = resolveHeadingTarget(documentUri, rawPath);
        if (!target) return [];
        const text = await readWorkspaceText(target);
        if (text === undefined) return [];
        return getOutlineForFormatSource(text, 'mixed').map(
            /**
             * 見出しを通信用の形へ変換する。
             * @param heading - アウトライン項目。
             * @returns 補完候補の見出し。
             */
            (heading) => ({ id: heading.id, text: heading.text, level: heading.level }));
    }
}

/**
 * 補完の対象範囲の基準フォルダーを返す。
 * @param documentUri - 補完元の文書。
 * @returns 文書のワークスペースフォルダー。ワークスペース外なら文書のフォルダー。
 */
function completionRoot(documentUri: vscode.Uri): vscode.Uri {
    return vscode.workspace.getWorkspaceFolder(documentUri)?.uri ?? vscode.Uri.joinPath(documentUri, '..');
}

/**
 * パスを比較用の形へそろえる。
 * @param value - Uri.path 形式のパス。
 * @param ignoreCase - 大文字小文字を区別しないファイルシステムならtrue。
 * @returns 正規化し、区別しない場合は小文字化したパス。
 */
function comparablePath(value: string, ignoreCase: boolean): string {
    const normalized = path.posix.normalize(value);
    return ignoreCase ? normalized.toLowerCase() : normalized;
}

/**
 * パスが基準フォルダーの中（同じ場所を含む）にあるか判定する。
 * @param target - 判定する Uri.path 形式のパス。
 * @param root - 基準フォルダーの Uri.path 形式のパス。
 * @param ignoreCase - 大文字小文字を区別しないファイルシステムならtrue。
 * @returns 基準フォルダー配下ならtrue。
 */
export function isPathInside(target: string, root: string, ignoreCase: boolean): boolean {
    const normalizedTarget = comparablePath(target, ignoreCase);
    const normalizedRoot = comparablePath(root, ignoreCase).replace(/\/+$/u, '');
    return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
}

/**
 * 拡張子から候補の種類を決める。
 * @param filePath - 候補ファイルのパス。
 * @returns Markdown、画像、その他のいずれか。
 */
function fileKind(filePath: string): LinkCompletionFile['kind'] {
    const extension = path.posix.extname(filePath).toLowerCase();
    if (MARKDOWN_EXTENSIONS.has(extension)) return 'markdown';
    if (IMAGE_EXTENSIONS.has(extension)) return 'image';
    return 'other';
}

/**
 * 見出しを読む文書の URI を、補完範囲の中に限って解決する。
 * @param documentUri - 補完元の文書。
 * @param rawPath - 本文に書かれたとおりのリンク先パス。
 * @returns 範囲内の Markdown 文書の URI。条件を満たさなければundefined。
 */
function resolveHeadingTarget(documentUri: vscode.Uri, rawPath: string): vscode.Uri | undefined {
    if (!rawPath) return documentUri;
    const decoded = decodeLocalResourceSource(rawPath);
    if (!isDocumentRelativeResourcePath(decoded)) return undefined;
    const segments = decoded.replace(/\\/g, '/').split('/').filter(Boolean);
    if (!segments.length) return undefined;
    const target = vscode.Uri.joinPath(documentUri, '..', ...segments);
    if (!MARKDOWN_EXTENSIONS.has(path.posix.extname(target.path).toLowerCase())) return undefined;
    return isPathInside(target.path, completionRoot(documentUri).path, pathIgnoreCase(documentUri)) ? target : undefined;
}

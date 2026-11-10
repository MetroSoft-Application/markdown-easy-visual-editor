/**
 * @fileoverview 画像の保存・参照・SVG サニタイズに使う、状態を持たない Extension Host 側の補助関数群。
 * MIME と拡張子の対応、文書からの相対パス、ローカルリソース URI の解決、draw.io SVG の安全化を扱う。
 * SVG は保存前に実行可能な内容と危険な参照を取り除き、draw.io の編集モデル部分は変更しない。
 */
import path from 'node:path';
import * as vscode from 'vscode';
import { encodeDrawioRelativePath } from '../shared/drawioSvg';
import { decodeLocalResourceSource } from './resourceCheck';
import { isDocumentRelativeResourcePath, workspaceRootPathSegments } from './resourceLink';
import { findDrawioModelRange } from '../shared/svgClipboard';
import { randomBytes } from 'node:crypto';

/**
 * 対応する画像MIMEタイプをファイル拡張子へ変換する。
 * @param mime - 画像または出力データのMIMEタイプ。
 * @returns MIMEタイプに対応する安全なファイル拡張子。未対応タイプではundefined。
 */
export function extensionForMime(mime: string): string | undefined {
    // MIMEタイプを画像ファイルの拡張子へ変換し、未対応形式はundefinedを返す。
    return (
        {
            'image/png': 'png',
            'image/apng': 'apng',
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/gif': 'gif',
            'image/webp': 'webp',
            'image/svg+xml': 'svg',
            'image/bmp': 'bmp',
            'image/x-ms-bmp': 'bmp',
            'image/avif': 'avif',
            'image/x-icon': 'ico',
            'image/vnd.microsoft.icon': 'ico',
            'image/heic': 'heic',
            'image/heif': 'heif',
            'image/jxl': 'jxl',
            'image/tiff': 'tiff'
        } as Record<string, string>
    )[mime.toLowerCase()];
}


/**
 * 保存を許可する画像拡張子の集合。
 */
const SAFE_IMAGE_EXTENSIONS = new Set([
    'png', 'apng', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif',
    'ico', 'heic', 'heif', 'jxl', 'tif', 'tiff'
]);

/**
 * 画像ペイロードの元ファイル名から、保存に使う安全な拡張子を取り出す。
 * @param name - 画像ペイロードの元ファイル名。
 * @param mime - 画像または出力データのMIMEタイプ。
 * @returns MIMEタイプが画像で、ファイル名の拡張子が許可される場合はその拡張子。それ以外はundefined。
 */
export function imageExtensionFromName(name: string | undefined, mime: string): string | undefined {
    if (!mime.toLowerCase().startsWith('image/') || !name) return undefined;
    const extension = path.extname(name).slice(1).toLowerCase();
    return SAFE_IMAGE_EXTENSIONS.has(extension) ? extension : undefined;
}

/**
 * ファイル拡張子から画像MIMEタイプを判定する。
 * @param filePath - 拡張子から画像MIMEタイプを判定するファイルパス。
 * @returns 対応する画像MIMEタイプ。未対応拡張子はapplication/octet-stream。
 */
export function mimeForFile(filePath: string): string {
    // ファイル拡張子を画像MIMEタイプへ変換し、未対応形式は汎用タイプにする。
    const extension = path.extname(filePath).toLowerCase();
    return (
        {
            '.png': 'image/png',
            '.apng': 'image/apng',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
            '.bmp': 'image/bmp',
            '.avif': 'image/avif',
            '.ico': 'image/x-icon',
            '.heic': 'image/heic',
            '.heif': 'image/heif',
            '.jxl': 'image/jxl',
            '.tif': 'image/tiff',
            '.tiff': 'image/tiff'
        } as Record<string, string>
    )[extension] ?? 'application/octet-stream';
}

/**
 * ファイル選択で選ばれた画像を、コピーせずに文書から直接参照できる場合のMarkdown相対パスを返す。
 * Webviewの `localResourceRoots`（文書フォルダーとワークスペースフォルダー）の外にある画像は、
 * 相対参照してもプレビューで表示できないため対象外にする。ドライブが異なるなど相対パスで表せない場合も対象外。
 * ファイルの読込みはせず、パスの位置関係だけで判定する。
 * @param documentUri - 画像を挿入するMarkdown文書のURI。
 * @param imageUri - ファイル選択ダイアログで選ばれた画像のURI。
 * @param workspaceFolders - 開いているワークスペースフォルダーのURI一覧。
 * @returns Markdownを壊す文字を%エスケープした相対パス。直接参照できない場合はundefined。
 */
export function selectedImageReference(
    documentUri: vscode.Uri,
    imageUri: vscode.Uri,
    workspaceFolders: readonly vscode.Uri[]
): string | undefined {
    if (imageUri.scheme !== documentUri.scheme || imageUri.authority !== documentUri.authority) return undefined;
    const roots = [vscode.Uri.joinPath(documentUri, '..'), ...workspaceFolders];
    const isInside = roots.some(
        /**
         * 画像がこのフォルダー配下にあるかを判定する。Windowsのローカルパスは大文字小文字を区別しない。
         * @param root - プレビューが読込みを許可するフォルダー。
         * @returns 配下にある場合はtrue。
         */
        (root) => {
            if (root.scheme !== imageUri.scheme || root.authority !== imageUri.authority) return false;
            const relative = imageUri.scheme === 'file'
                ? path.relative(root.fsPath, imageUri.fsPath)
                : path.posix.relative(root.path, imageUri.path);
            return relative !== '' && relative !== '..' && !relative.startsWith('../')
                && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
        });
    if (!isInside) return undefined;
    const relative = relativeUriPath(documentUri, imageUri);
    if (!relative || path.isAbsolute(relative) || relative.startsWith('/')) return undefined;
    return encodeDrawioRelativePath(relative);
}

/**
 * 保存先URIをMarkdown文書の場所からの相対パスへ変換する。
 * @param documentUri - 相対パスの基準となるMarkdown文書URI。
 * @param target - Markdown文書からの相対パスを作る保存先URI。
 * @returns Markdown文書の親フォルダーから保存先URIへの相対パス。
 */
export function relativeUriPath(documentUri: vscode.Uri, target: vscode.Uri): string {
    // 保存先URIをMarkdown文書からの相対パスへ変換し、仮想URIにも対応する。
    if (documentUri.scheme === 'file' && target.scheme === 'file') {
        return path.relative(path.dirname(documentUri.fsPath), target.fsPath).replace(/\\/g, '/');
    }
    const base = documentUri.path.slice(0, documentUri.path.lastIndexOf('/') + 1);
    return target.path.startsWith(base) ? target.path.slice(base.length) : target.path;
}

/**
 * Markdown内のローカルリソース参照を、文書位置に基づくVS Code URIへ解決する。
 * @param documentUri - 相対参照の基準となるMarkdown文書のURI。
 * @param source - Markdownから取り出した画像などのローカルURIまたはファイルパス。
 * @param workspaceRooted - true の場合、/ で始まるパスをワークスペースフォルダー基準として解決し、それ以外は文書相対パスだけを受け付ける。既定はfalse。
 * @returns 解決したURI（file: URI・絶対パス・UNC・文書相対パスに対応）。外部URL・アンカー・空文字、または workspaceRooted 指定時に解決できないパスはundefined。
 */
export function resolveLocalResourceUri(documentUri: vscode.Uri, source: string, workspaceRooted = false): vscode.Uri | undefined {
    const clean = decodeLocalResourceSource(source);
    if (workspaceRooted && clean.startsWith('/')) {
        const workspaceSegments = workspaceRootPathSegments(clean);
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
        return workspaceSegments && workspaceFolder
            ? vscode.Uri.joinPath(workspaceFolder.uri, ...workspaceSegments)
            : undefined;
    }
    if (workspaceRooted && !isDocumentRelativeResourcePath(clean)) return undefined;
    if (/^file:/i.test(clean)) return vscode.Uri.parse(clean);
    if (/^[A-Za-z]:[\\/]/.test(clean) && documentUri.scheme === 'file') {
        return vscode.Uri.file(clean.replace(/\\/g, path.sep));
    }
    if (/^\//.test(clean) && !/^\/\//.test(clean) && documentUri.scheme === 'file') {
        return vscode.Uri.file(clean);
    }
    if (/^(?:\\\\|\/\/)/.test(clean) && documentUri.scheme === 'file') {
        return vscode.Uri.file(clean.replace(/[\\/]/g, path.sep));
    }
    if (!clean || /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(clean)) return undefined;
    const segments = clean.replace(/\\/g, '/').split('/').filter(Boolean);
    return segments.length ? vscode.Uri.joinPath(documentUri, '..', ...segments) : undefined;
}

/**
 * 日時を画像ファイル名に使える形へ整える。
 * @param date - 画像ファイル名へ含める日時。
 * @returns YYYYMMDD-HHMMSS形式の日時文字列。
 */
export function compactTimestamp(date: Date): string {
    // 日付と時刻をファイル名に使える連続した文字列へ変換する。
    const parts = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
        '-',
        String(date.getHours()).padStart(2, '0'),
        String(date.getMinutes()).padStart(2, '0'),
        String(date.getSeconds()).padStart(2, '0')
    ];
    return parts.join('');
}

/**
 * SVGから実行可能な内容と危険な参照を取り除く。
 * @param value - 危険な要素や属性を除去するSVGマークアップ文字列。
 * @returns script要素、イベント属性、危険なURL参照を除いたSVGマークアップ。
 */
export function sanitizeSvg(value: string): string {
    // SVGからスクリプト・イベント属性・危険なURLスキームを除去する。
    return value
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
        .replace(/(?:javascript|data:text\/html):/gi, '');
}

/**
 * draw.io SVGの編集モデルを変更せずにサニタイズする。
 * sanitizeSvgは属性値の内外を区別しないため、モデルへ適用すると「JavaScript: 概要」のようなラベルや
 * 図形のリンクが壊れ、draw.ioでの再保存で欠落が確定する。findDrawioModelRangeはXMLとHTMLのどちらでも引用された属性値になる範囲だけを返し、
 * その範囲はSVGとして実行されないので、仮の文字列へ置き換えた文書だけをサニタイズし、最後に元の値へ戻す。
 * 除去によって引用符の対応が崩れるとモデルが属性値の外へ出るため、戻した結果を再度読み、同じ位置の属性値である場合だけ採用する。
 * モデルの外は従来どおりサニタイズするため、表示用の文字列は変わることがある。draw.ioで再保存するとモデルから再生成される。
 * 先頭のBOMは除く。クリップボードの経路はnormalizeSvgClipboardTextが除くため、ファイルの経路でも同じ判定結果にする。
 * @param value - SVG文字列。
 * @returns サニタイズ済みのdraw.io SVG。draw.io SVGでない場合やモデルを安全に保持できない場合はundefined。
 */
export function sanitizeDrawioSvg(value: string): string | undefined {
    const source = value.replace(/^\uFEFF/, '');
    const range = findDrawioModelRange(source);
    if (!range) return undefined;
    const model = source.slice(range.start, range.end);
    // 文書内の文字列と衝突させないため、実行ごとの乱数を使う。
    const placeholder = `mve-drawio-model-${randomBytes(16).toString('hex')}`;
    const sanitized = sanitizeSvg(source.slice(0, range.start) + placeholder + source.slice(range.end));
    const parts = sanitized.split(placeholder);
    if (parts.length !== 2) return undefined;
    const restored = parts[0] + model + parts[1];
    const restoredRange = findDrawioModelRange(restored);
    const unchangedPosition = restoredRange?.start === parts[0].length
        && restoredRange.end === parts[0].length + model.length;
    return unchangedPosition ? restored : undefined;
}

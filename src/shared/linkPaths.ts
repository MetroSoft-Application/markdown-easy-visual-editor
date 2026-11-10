/**
 * @fileoverview Markdown のリンク先パスを扱う、Extension Host と Webview で共通の純粋関数群。
 * - 入力補完: カーソル直前の行から「リンク先パス」または「見出しアンカー」を入力中かを判定する。
 * - ファイル移動: 移動前後のパス対応から、リンク先文字列の書き換え後の値を計算する。
 * パスはすべて `/` 区切りの絶対パス（VS Code の Uri.path 相当）で受け取り、ファイルシステムには触れない。
 * 書き換えでは、元の記法（`./` の有無、山括弧、百分率エンコードの方式、クエリとフラグメント）を保つ。
 */
import { encodeMarkdownPathSegment } from './markdown';

/** 入力中のリンク先がパス部分かアンカー部分かを表す補完文脈。 */
export type LinkCompletionContext =
    | {
        /** リンク先のパス部分（`#` より前）を入力中。 */
        kind: 'path';
        /** 補完で置き換える範囲の開始位置（判定に渡した行文字列内のオフセット）。 */
        from: number;
        /** 入力済みのパス文字列。 */
        query: string;
    }
    | {
        /** リンク先の `#` より後（見出しアンカー）を入力中。 */
        kind: 'anchor';
        /** 補完で置き換える範囲の開始位置（`#` の直後、行文字列内のオフセット）。 */
        from: number;
        /** `#` より前に書かれたパス。空文字なら同じ文書内のアンカー。 */
        path: string;
        /** 入力済みのアンカー文字列。 */
        query: string;
    };

/**
 * カーソル直前の行文字列から、Markdown のリンク先を入力中かどうかを判定する。
 * 対象はインラインリンク・画像 `](`、参照定義 `[id]: `、HTML の `src="` / `href="` の値。
 * URI スキーム付き（`https:` など）、`//` 始まり、脚注定義 `[^id]:` は対象外にする。
 * @param lineBefore - 行頭からカーソル位置までの文字列。
 * @returns 補完文脈。リンク先の入力中でなければundefined。
 */
export function detectLinkCompletionContext(lineBefore: string): LinkCompletionContext | undefined {
    const patterns: RegExp[] = [
        // 山括弧付きのインライン参照先は空白を含められる。
        /\]\(\s*<([^<>\r\n]*)$/u,
        /\]\(\s*([^\s()<>]*)$/u,
        /^\s{0,3}(?:>\s?)*\[(?!\^)[^\]]+\]:\s*<([^<>\r\n]*)$/u,
        /^\s{0,3}(?:>\s?)*\[(?!\^)[^\]]+\]:\s*([^\s<>]*)$/u,
        /<(?:img|a)\b[^>]*?\b(?:src|href)\s*=\s*"([^"]*)$/iu,
        /<(?:img|a)\b[^>]*?\b(?:src|href)\s*=\s*'([^']*)$/iu
    ];
    for (const pattern of patterns) {
        const match = pattern.exec(lineBefore);
        if (!match) continue;
        const destination = match[1];
        const destinationStart = lineBefore.length - destination.length;
        if (/^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/)/u.test(destination)) return undefined;
        const hash = destination.indexOf('#');
        if (hash >= 0) {
            return {
                kind: 'anchor',
                from: destinationStart + hash + 1,
                path: destination.slice(0, hash),
                query: destination.slice(hash + 1)
            };
        }
        return { kind: 'path', from: destinationStart, query: destination };
    }
    return undefined;
}

/**
 * 文書のあるフォルダーから対象ファイルへの相対パスを、`/` 区切りで作る。
 * @param fromDirectory - 基準フォルダーの絶対パス（末尾の `/` は任意）。
 * @param target - 対象ファイルの絶対パス。
 * @param ignoreCase - 大文字小文字を区別しないファイルシステムならtrue。共通の親フォルダーの判定に使う。
 * @returns `..` を含み得る相対パス。基準と同じ場所なら空文字。
 */
export function relativePosixPath(fromDirectory: string, target: string, ignoreCase = false): string {
    const from = splitPath(fromDirectory);
    const to = splitPath(target);
    let common = 0;
    while (common < from.length && common < to.length && samePathSegment(from[common], to[common], ignoreCase)) {
        common += 1;
    }
    return [...from.slice(common).map(() => '..'), ...to.slice(common)].join('/');
}

/**
 * 相対パスの各要素を、Markdown リンク先として安全な形へエンコードする。
 * @param relativePath - `/` 区切りの相対パス。
 * @param style - `markdown` はリンク構文を壊す文字だけ、`uri` は encodeURIComponent で全要素をエンコードする。
 *   `raw` は山括弧付きの参照先向けで、`<` と `>` と改行だけをエンコードする。
 * @returns エンコード済みのパス。
 */
export function encodeLinkPath(relativePath: string, style: 'markdown' | 'uri' | 'raw' = 'markdown'): string {
    return relativePath.split('/').map(
        /**
         * パス要素を指定の方式でエンコードする。`.` と `..` はそのまま残す。
         * @param segment - `/` を含まないパス要素。
         * @returns エンコード済みのパス要素。
         */
        (segment) => {
            if (segment === '.' || segment === '..') return segment;
            if (style === 'uri') return encodeURIComponent(segment);
            if (style === 'raw') return segment.replace(/[<>\r\n]/gu, (character) => encodeURIComponent(character));
            // encodeURIComponentは括弧を残すため、対応の取れていない括弧でリンクが途切れないよう明示的にエンコードする。
            return encodeMarkdownPathSegment(segment).replace(/\(/gu, '%28').replace(/\)/gu, '%29');
        }).join('/');
}

/** リンク先の書き換えに必要な、文書とワークスペースの位置。 */
export interface LinkRewriteLocation {
    /** 移動前のリンク元文書の絶対パス。相対パスの解決に使う。 */
    documentOldPath: string;
    /** 移動後のリンク元文書の絶対パス。新しい相対パスの基準になる。文書が移動していなければ documentOldPath と同じ。 */
    documentNewPath: string;
    /** ワークスペース基準リンク（`/` 始まり）の基準フォルダー。ワークスペース外の文書ならundefined。 */
    workspaceRootPath?: string;
    /** 大文字小文字を区別しないファイルシステムならtrue。 */
    ignoreCase?: boolean;
}

/** リンク先1件の記法情報。 */
export interface LinkDestinationSyntax {
    /** 本文に書かれたとおりの参照先（山括弧は除く）。 */
    destination: string;
    /** 参照先が `<...>` で囲まれている場合はtrue。 */
    angleBracketed: boolean;
    /** ワークスペース基準リンクならtrue。 */
    workspaceRooted: boolean;
}

/**
 * ファイル・フォルダーの移動に合わせて、リンク先文字列の新しい値を求める。
 * 文書相対パスとワークスペース基準パスだけを対象にし、URI スキーム付き・絶対パス・UNC・同じ文書内のアンカーは変更しない。
 * @param link - 書き換え候補のリンク先と記法。
 * @param location - リンク元文書の移動前後の位置とワークスペースの基準。
 * @param mapPath - 移動前の絶対パスを受け取り、移動していれば移動後の絶対パス、移動していなければundefinedを返す関数。
 * @returns 書き換え後のリンク先。変更が不要な場合はundefined。
 */
export function rewriteLinkDestination(
    link: LinkDestinationSyntax,
    location: LinkRewriteLocation,
    mapPath: (oldPath: string) => string | undefined
): string | undefined {
    const { destination } = link;
    const suffixStart = destination.search(/[?#]/u);
    const rawPath = suffixStart >= 0 ? destination.slice(0, suffixStart) : destination;
    const suffix = suffixStart >= 0 ? destination.slice(suffixStart) : '';
    if (!rawPath || /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/|\\\\)/u.test(rawPath)) return undefined;
    const decodedPath = decodeLinkPath(rawPath.replace(/\\([\\()])/gu, '$1'));
    const ignoreCase = location.ignoreCase === true;

    let oldTarget: string;
    const workspaceRooted = link.workspaceRooted && decodedPath.startsWith('/');
    if (workspaceRooted) {
        if (location.workspaceRootPath === undefined) return undefined;
        oldTarget = joinPath(location.workspaceRootPath, decodedPath.slice(1));
    } else {
        // `/` 始まり（ワークスペース基準の印なし）は環境依存の絶対パスなので変更しない。
        if (decodedPath.startsWith('/') || decodedPath.startsWith('\\')) return undefined;
        oldTarget = joinPath(parentPath(location.documentOldPath), decodedPath);
    }
    const newTarget = mapPath(oldTarget) ?? oldTarget;
    const documentMoved = !samePath(location.documentOldPath, location.documentNewPath, ignoreCase);
    if (samePath(newTarget, oldTarget, ignoreCase) && (!documentMoved || workspaceRooted)) return undefined;

    // 元の表記を移動後の文書の位置から解決しても同じ先を指すなら、`./a/../b.md` や `\` 区切りなどの表記を変えない。
    if (!workspaceRooted && samePath(joinPath(parentPath(location.documentNewPath), decodedPath), newTarget, ignoreCase)) {
        return undefined;
    }
    const trailingSlash = /[\\/]$/u.test(decodedPath);
    const style = link.angleBracketed ? 'raw' : /%[89A-Fa-f][0-9A-Fa-f]/u.test(rawPath) ? 'uri' : 'markdown';
    let nextPath: string;
    if (workspaceRooted) {
        const fromRoot = relativePosixPath(location.workspaceRootPath ?? '/', newTarget, ignoreCase);
        if (fromRoot.startsWith('..')) return undefined;
        nextPath = `/${encodeLinkPath(fromRoot, style)}`;
    } else {
        const relative = relativePosixPath(parentPath(location.documentNewPath), newTarget, ignoreCase) || '.';
        const keepDotPrefix = /^\.[\\/]/u.test(decodedPath) && !relative.startsWith('..');
        nextPath = `${keepDotPrefix ? './' : ''}${encodeLinkPath(relative, style)}`;
    }
    if (trailingSlash && !nextPath.endsWith('/')) nextPath += '/';
    const next = `${nextPath}${suffix}`;
    return next === destination ? undefined : next;
}

/**
 * 百分率エンコードを1要素ずつ復号する。不正なエスケープを含む要素はそのまま残す。
 * @param value - リンク先のパス部分。
 * @returns 復号したパス。
 */
function decodeLinkPath(value: string): string {
    return value.split('/').map(
        /**
         * パス要素を復号する。
         * @param segment - パス要素。
         * @returns 復号したパス要素。不正なエスケープなら入力のまま。
         */
        (segment) => {
            try {
                return decodeURIComponent(segment);
            } catch {
                return segment;
            }
        }).join('/');
}

/**
 * 絶対パスを要素へ分ける。`\` も区切りとして扱い、空要素と `.` は除く。
 * @param value - 分割するパス。
 * @returns パス要素の一覧。
 */
function splitPath(value: string): string[] {
    return value.split(/[\\/]/u).filter(
        /**
         * 空要素と現在フォルダーを表す `.` を除く。
         * @param segment - パス要素。
         * @returns 残す要素ならtrue。
         */
        (segment) => segment !== '' && segment !== '.');
}

/**
 * 基準の絶対パスへ相対パスを連結し、`.` と `..` を解決する。
 * @param base - 基準となる絶対パス。
 * @param relative - 連結する相対パス。
 * @returns 正規化した `/` 始まりの絶対パス。ルートより上へは出ない。
 */
function joinPath(base: string, relative: string): string {
    const segments = splitPath(base);
    for (const segment of relative.split(/[\\/]/u)) {
        if (!segment || segment === '.') continue;
        if (segment === '..') segments.pop();
        else segments.push(segment);
    }
    return `/${segments.join('/')}`;
}

/**
 * パスの親フォルダーを返す。
 * @param value - `/` 区切りの絶対パス。
 * @returns 親フォルダーの絶対パス。
 */
function parentPath(value: string): string {
    const segments = splitPath(value);
    segments.pop();
    return `/${segments.join('/')}`;
}

/**
 * 2つのパスが同じ場所を指すか判定する。
 * @param left - 比較するパス。
 * @param right - 比較するパス。
 * @param ignoreCase - 大文字小文字を区別しない場合はtrue。
 * @returns 正規化後に一致すればtrue。
 */
function samePath(left: string, right: string, ignoreCase: boolean): boolean {
    const a = joinPath('/', left);
    const b = joinPath('/', right);
    return ignoreCase ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * パス要素が一致するか判定する。
 * @param left - 比較するパス要素。
 * @param right - 比較するパス要素。
 * @param ignoreCase - 大文字小文字を区別しない場合はtrue。
 * @returns 一致すればtrue。
 */
function samePathSegment(left: string, right: string, ignoreCase: boolean): boolean {
    return ignoreCase ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/**
 * 移動元と移動先の組から、移動前の絶対パスを移動後へ写像する関数を作る。
 * フォルダーの移動では、その配下のパスも同じ相対位置へ写像する。複数の組が一致する場合は最も深い移動元を使う。
 * @param renames - 移動前と移動後の絶対パスの組。
 * @param ignoreCase - 大文字小文字を区別しない場合はtrue。
 * @returns 移動していればその移動後パス、移動していなければundefinedを返す関数。
 */
export function createRenameMapper(
    renames: ReadonlyArray<{ oldPath: string; newPath: string }>,
    ignoreCase = false
): (oldPath: string) => string | undefined {
    const normalized = renames
        .map(
            /**
             * 移動元を要素へ分け、移動先を正規化する。
             * @param rename - 移動前と移動後の組。
             * @returns 照合用に正規化した組。
             */
            (rename) => ({ oldSegments: splitPath(rename.oldPath), newPath: joinPath('/', rename.newPath) }))
        .sort(
            /**
             * 深い移動元を先に照合するよう並べる（フォルダー移動と、その中のファイル移動が同時にある場合）。
             * @param left - 比較対象の組。
             * @param right - 比較対象の組。
             * @returns 要素数の降順を示す比較値。
             */
            (left, right) => right.oldSegments.length - left.oldSegments.length);
    /**
     * 移動前の絶対パスを移動後へ写像する。
     * @param oldPath - 移動前の絶対パス。
     * @returns 移動後の絶対パス。どの移動にも含まれなければundefined。
     */
    return (oldPath) => {
        const segments = splitPath(oldPath);
        for (const rename of normalized) {
            if (segments.length < rename.oldSegments.length) continue;
            const isPrefix = rename.oldSegments.every(
                /**
                 * 移動元の各要素が、対象パスの同じ位置の要素と一致するか調べる。
                 * @param segment - 移動元のパス要素。
                 * @param index - 要素の位置。
                 * @returns 一致すればtrue。
                 */
                (segment, index) => samePathSegment(segment, segments[index], ignoreCase));
            if (!isPrefix) continue;
            const rest = segments.slice(rename.oldSegments.length);
            return rest.length ? joinPath(rename.newPath, rest.join('/')) : rename.newPath;
        }
        return undefined;
    };
}

/** 連続した移動を合成した、移動前後のパスの写像。 */
export interface ComposedRenameMapping {
    /**
     * 最初の移動より前のパスを、最後の移動の後のパスへ写像する。
     * @param oldPath - 最初の移動より前の絶対パス。
     * @returns 最後の移動の後の絶対パス。どの移動にも含まれなければundefined。
     */
    toNew: (oldPath: string) => string | undefined;
    /**
     * 最後の移動の後のパスを、最初の移動より前のパスへ戻す。
     * @param newPath - 最後の移動の後の絶対パス。
     * @returns 最初の移動より前の絶対パス。どの移動にも含まれなければundefined。
     */
    toOld: (newPath: string) => string | undefined;
}

/**
 * 発生順に並んだ複数回の移動（A→B の後に B→C など）を、1つの写像へ合成する。
 * リンクの書き換えを確認している間に次の移動が起きても、本文のリンク（最初の移動より前の位置が基準）を正しく写像するために使う。
 * @param batches - 発生順の移動。1回の移動に複数のファイルを含み得る。
 * @param ignoreCase - 大文字小文字を区別しない場合はtrue。
 * @returns 合成した写像。
 */
export function composeRenameMappings(
    batches: ReadonlyArray<ReadonlyArray<{ oldPath: string; newPath: string }>>,
    ignoreCase = false
): ComposedRenameMapping {
    const forward = batches.map(
        /**
         * 1回分の移動の順方向の写像を作る。
         * @param batch - 1回分の移動。
         * @returns 順方向の写像。
         */
        (batch) => createRenameMapper(batch, ignoreCase));
    const backward = batches.map(
        /**
         * 1回分の移動の逆方向の写像を作る。
         * @param batch - 1回分の移動。
         * @returns 逆方向の写像。
         */
        (batch) => createRenameMapper(batch.map(
            /**
             * 移動元と移動先を入れ替える。
             * @param rename - 移動前後の組。
             * @returns 入れ替えた組。
             */
            (rename) => ({ oldPath: rename.newPath, newPath: rename.oldPath })), ignoreCase)).reverse();
    /**
     * 写像を順に適用し、どれにも含まれなければundefinedを返す。
     * @param mappers - 適用する写像（適用順）。
     * @param value - 写像する絶対パス。
     * @returns 写像後のパス。どれにも含まれなければundefined。
     */
    const apply = (mappers: ReadonlyArray<(value: string) => string | undefined>, value: string): string | undefined => {
        let current = value;
        let moved = false;
        for (const mapper of mappers) {
            const next = mapper(current);
            if (next === undefined) continue;
            current = next;
            moved = true;
        }
        return moved ? current : undefined;
    };
    return {
        /**
         * 移動を発生順に適用する。
         * @param oldPath - 最初の移動より前の絶対パス。
         * @returns 最後の移動の後の絶対パス。どの移動にも含まれなければundefined。
         */
        toNew: (oldPath) => apply(forward, oldPath),
        /**
         * 移動を逆順に戻す。
         * @param newPath - 最後の移動の後の絶対パス。
         * @returns 最初の移動より前の絶対パス。どの移動にも含まれなければundefined。
         */
        toOld: (newPath) => apply(backward, newPath)
    };
}

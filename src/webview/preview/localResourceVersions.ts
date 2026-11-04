/**
 * @fileoverview プレビュー画像のローカルファイルが更新されたとき、ブラウザーキャッシュを避けて読み直させる。
 *
 * 実行境界はWebview。Hostの `localResourceChanged` 通知でファイルごとの版番号を進め、
 * プレビューのimg要素のsrcに `mve-v` クエリを付けて別URLとして再取得させる。
 * Markdown本文、`data-original-src`、HTML/PDF出力に使う参照は変更しない（表示用DOMだけを書き換える）。
 * 版番号はWebviewの寿命の間だけ保持し、再描画で元のsrcに戻った画像にも再適用する。
 */

/** 版番号を付けるクエリ名。利用者のURLクエリと衝突しにくい専用名にする。 */
const VERSION_PARAMETER = "mve-v";

/** プレビュー各インスタンスへ版番号の更新を知らせるwindowイベント名。 */
export const LOCAL_RESOURCE_CHANGED_EVENT = "mve-local-resource-changed";

/**
 * 次の読込完了時に自然幅で枠を決め直す画像へ付ける一時印のdatasetキー（`data-mve-resource-reloaded`）。
 * ファイル更新で読み直した画像と、枠の作成時点で未ロードだったdraw.io図に付ける。
 * 画像のload処理が、旧画像や仮幅の表示幅ではなく自然幅で枠を決め直すために使い、読込後に削除する。
 * サニタイズの許可属性ではないため、Markdown本文から偽装されることはない。
 */
export const LOCAL_RESOURCE_RELOADED_DATASET_KEY = "mveResourceReloaded";

/** 正規化したリソースキーごとの版番号。1以上だけを保持する。 */
const versions = new Map<string, number>();

/**
 * URLを、%エスケープの表記ゆれとWindowsドライブ文字の大小を吸収した比較用キーへ変換する。
 * クエリとフラグメントは比較に含めない。
 * @param url - 絶対URL、またはdocument.baseURI基準の相対URL。
 * @returns 比較用キー。URLとして解釈できない場合はundefined。
 */
function resourceKey(url: string): string | undefined {
    try {
        const parsed = new URL(url, document.baseURI);
        let pathname = parsed.pathname;
        try {
            pathname = decodeURIComponent(pathname);
        } catch {
            // 不正な%エスケープはそのまま比較する。
        }
        return `${parsed.origin}${pathname}`.toLowerCase();
    } catch {
        return undefined;
    }
}

/**
 * Hostから通知された変更ファイルの版番号を進め、表示中のプレビューへ再適用を依頼する。
 * @param resource - 受信パネル用のWebview URI。解釈できない値は無視する。
 */
export function markLocalResourceChanged(resource: string): void {
    const key = resourceKey(resource);
    if (!key) return;
    versions.set(key, (versions.get(key) ?? 0) + 1);
    window.dispatchEvent(new Event(LOCAL_RESOURCE_CHANGED_EVENT));
}

/**
 * 指定範囲のプレビュー画像のうち、更新済みファイルを参照するものへ版番号付きsrcを設定する。
 * 更新がない間は走査しないため、通常の描画コストは増えない。
 * srcが既に同じ版番号なら書き換えず、不要な再取得を起こさない。
 * @param root - プレビューのルート要素など、画像を含むDOM範囲。
 */
export function applyLocalResourceVersions(root: ParentNode): void {
    if (!versions.size) return;
    root.querySelectorAll<HTMLImageElement>("img[data-original-src]").forEach(
        /**
         * 画像の現在のsrcから既存の版番号を除いて照合し、最新の版番号を付け直す。
         * @param image - プレビュー内の画像要素。
         */
        (image) => {
            const current = image.getAttribute("src");
            if (!current || /^(?:data|blob):/i.test(current)) return;
            let url: URL;
            try {
                url = new URL(current, document.baseURI);
            } catch {
                return;
            }
            url.searchParams.delete(VERSION_PARAMETER);
            const version = versions.get(resourceKey(url.href) ?? "");
            if (!version) return;
            url.searchParams.set(VERSION_PARAMETER, String(version));
            if (image.src === url.href) return;
            image.dataset[LOCAL_RESOURCE_RELOADED_DATASET_KEY] = "true";
            image.setAttribute("src", url.href);
        },
    );
}

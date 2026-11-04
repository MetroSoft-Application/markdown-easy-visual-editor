/**
 * @fileoverview プレビュー画像のローカルファイルが更新されたとき、ブラウザーキャッシュを避けて読み直させる。
 *
 * 実行境界はWebview（通常プレビュー）とMarpの隔離iframe。Hostの `localResourceChanged` 通知で
 * ファイルごとの版番号を進め、img要素のsrcに `mve-v` クエリを付けて別URLとして再取得させる。
 * Markdown本文、`data-original-src`、HTML/PDF出力に使う参照は変更しない（表示用DOMだけを書き換える）。
 * 版番号はWebviewの寿命の間だけ保持し、再描画で元のsrcに戻った画像にも再適用する。
 * Marpのiframeはこのモジュールの状態を共有しないため、親が {@link getLocalResourceVersionEntries}
 * の結果を送り、iframe側は {@link applyResourceVersions} で同じ規則を適用する。
 */

/** 版番号を付けるクエリ名。利用者のURLクエリと衝突しにくい専用名にする。 */
const VERSION_PARAMETER = "mve-v";

/** プレビュー各インスタンスへ版番号の更新を知らせるwindowイベント名。 */
export const LOCAL_RESOURCE_CHANGED_EVENT = "mve-local-resource-changed";

/** 正規化したリソースキーごとの版番号。1以上だけを保持する。 */
const versions = new Map<string, number>();

/**
 * 次の読込完了時に、旧画像や仮幅の表示幅ではなく自然幅で枠を決め直す画像。
 * DOM属性ではなくモジュール内で保持するため、Markdown本文の生HTMLから偽装できない。
 * WeakSetなので、DOMから外れた画像は参照が残らず回収される。
 */
const imagesNeedingNaturalWidth = new WeakSet<HTMLImageElement>();

/**
 * 画像の次の読込完了時に自然幅で枠を決め直すよう印を付ける。
 * @param image - 対象の画像要素。
 */
export function requestNaturalWidthOnLoad(image: HTMLImageElement): void {
    imagesNeedingNaturalWidth.add(image);
}

/**
 * 自然幅で枠を決め直す印があれば消費して返す。読込完了ごとに1回だけtrueになる。
 * @param image - 読込が完了した画像要素。
 * @returns 印が付いていた場合はtrue。
 */
export function consumeNaturalWidthRequest(image: HTMLImageElement): boolean {
    return imagesNeedingNaturalWidth.delete(image);
}

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
 * Marpのiframeへ送るため、現在の版番号を構造化複製できる配列で返す。
 * @returns 正規化キーと版番号の組の一覧。更新がなければ空配列。
 */
export function getLocalResourceVersionEntries(): Array<[string, number]> {
    return [...versions];
}

/**
 * 指定範囲の画像のうち、版番号を持つファイルを参照するものへ版番号付きsrcを設定する。
 * 版番号が空なら走査しないため、更新のない文書の描画コストは増えない。
 * srcが既に同じ版番号なら書き換えず、不要な再取得を起こさない。
 * data:・blob: URLと、URLとして解釈できないsrcは対象外とする。
 * @param root - プレビューのルート要素など、画像を含むDOM範囲。
 * @param resourceVersions - 正規化キーごとの版番号。iframeでは親から受け取った値を渡す。
 */
export function applyResourceVersions(
    root: ParentNode,
    resourceVersions: ReadonlyMap<string, number>,
): void {
    if (!resourceVersions.size) return;
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
            const version = resourceVersions.get(resourceKey(url.href) ?? "");
            if (!version) return;
            url.searchParams.set(VERSION_PARAMETER, String(version));
            if (image.src === url.href) return;
            requestNaturalWidthOnLoad(image);
            image.setAttribute("src", url.href);
        },
    );
}

/**
 * このWebviewで受信した版番号を、指定範囲の画像へ適用する。
 * @param root - プレビューのルート要素など、画像を含むDOM範囲。
 */
export function applyLocalResourceVersions(root: ParentNode): void {
    applyResourceVersions(root, versions);
}

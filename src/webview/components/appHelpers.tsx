/**
 * @fileoverview Webview ルート（App）が使う状態を持たない補助関数群。
 * 画像ファイルの読み込み、検索、値の丸め、表示モードの復元、変更の対応付けなどを扱い、DOM・Host への副作用を持たない関数を中心に置く。
 * 例外として fileToPayload は File / Blob を読み込み、BMP を PNG へ変換するためにブラウザ API を使う。
 */
import React from "react";
import type { Messages } from "../../shared/messages";
import type { EditorMode, ImagePayload, NormalizedPdfOptions, ViewMode } from "../../shared/protocol";
import { mapTextOffset, type TextChange } from "../../shared/textChanges";

/**
 * 置換文字列の各半角スペースを既存の空白記号付きで描画する。
 * @param value 入力欄に保存される置換文字列。
 * @returns 空白表示用の装飾を含むReactノード。
 */
export function renderTextWithVisibleSpaces(value: string): React.ReactNode[] {
  const segments = value.split(" ");
  return segments.map((segment, index) => (
    <React.Fragment key={index}>
      {segment}
      {index < segments.length - 1 && (
        <span className="cm-visible-space"> </span>
      )}
    </React.Fragment>
  ));
}

/**
 * 置換文字列入力欄を重ねた空白表示レイヤーの横スクロールを同期する。
 * @param event 置換文字列入力欄のscroll event。
 */
export function syncReplacementInputVisualizationScroll(
  event: React.UIEvent<HTMLInputElement>,
): void {
  const visualization = event.currentTarget.nextElementSibling;
  if (visualization instanceof HTMLElement) {
    visualization.scrollLeft = event.currentTarget.scrollLeft;
  }
}

/**
 * 画像ファイルをサイズ上限内で読み込み、必要ならBMPをPNGへ変換してペイロードを作る。
 * @param file 読み込む画像ファイル。
 * @param maxSizeMb アップロードを許可するファイルサイズ上限（MiB）。
 * @param messages ファイルエラーに表示する翻訳済みメッセージ。
 * @returns Webviewから送信できる画像データの非同期結果。
 * @throws Error ファイルがサイズ上限を超える場合、またはBMPのPNG変換に失敗した場合。
 */
export async function fileToPayload(
  file: File,
  maxSizeMb: number,
  messages: Messages,
): Promise<ImagePayload> {
  if (file.size > maxSizeMb * 1024 * 1024)
    throw new Error(messages.app.errors.imageSize(maxSizeMb));
  if (file.type === "image/bmp") {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob>(
      /**
       * 非同期処理の成功結果と失敗理由を待機側へ通知する。
       * @param resolve - Promiseの成功を通知する関数。
       * @param reject - Promiseの失敗を通知する関数。
       */
      (resolve, reject) =>
        canvas.toBlob(
          /**
           * @param value - canvasから受け取る画像変換結果。nullなら変換に失敗している。
           */
          (value) =>
            value
              ? resolve(value)
              : reject(new Error(messages.app.errors.bmpConversion)),
          "image/png",
        ),
    );
    return {
      name: file.name.replace(/\.bmp$/i, ".png"),
      mime: "image/png",
      base64: await blobBase64(blob),
    };
  }
  return {
    name: file.name,
    mime: file.type || "image/png",
    base64: await blobBase64(file),
  };
}

/**
 * 貼り付け・ドロップされたファイルを画像として扱えるか判定する。MIME 型が image/ で始まるか、拡張子が PNG・JPEG・GIF・WebP・BMP・SVG なら画像とみなす。
 * @param file - 貼り付けまたはドロップされたファイル。
 * @returns 画像として保存対象にできる場合は true。
 */
export function isImageFile(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    /\.(?:png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name)
  );
}

/**
 * 画像BlobをBase64文字列へ変換し、巨大なUint8Arrayも小分けに処理する。
 * @param blob - Base64へ変換する画像ファイルのBlob。
 * @returns data URLのprefixを含まないBase64文字列。
 */
async function blobBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

/**
 * Markdown本文から編集ツールバーに表示する書式状態を推定する。
 * @param value - Markdown装飾の有無を推定する本文。
 * @returns 太字、斜体、取消線、下線、ハイライト、コード、リンクの有無。
 */
export function inferMarks(value: string): Record<string, boolean> {
  return {
    bold: /\*\*[^*]+\*\*/.test(value),
    italic: /(?:^|[^*])\*[^*]+\*/.test(value),
    strike: /~~.+~~/.test(value),
    underline: /\+\+.+\+\+/.test(value),
    highlight: /==.+==/.test(value),
    inlineCode: /`[^`]+`/.test(value),
    link: /\[[^\]]+]\([^)]+\)/.test(value),
  };
}

/**
 * 本文から指定した検索語の一致位置を抽出する。
 * @param value 検索対象となるMarkdown本文。
 * @param query 本文内で検索する語句。
 * @returns 本文内でqueryに一致した範囲の一覧。
 */
export function findSearchHits(
  value: string,
  query: string,
): Array<{
  /**
   * 検索一致範囲の開始位置を示す本文内UTF-16オフセットです。
   */
  from: number;
  /**
   * 検索一致範囲の終了位置を示す本文内UTF-16オフセットです。
   */
  to: number;
}> {
  if (!query) return [];
  const hits: Array<{
    /**
     * 検索一致範囲の開始位置を示す本文内UTF-16オフセットです。
     */
    from: number;
    /**
     * 検索一致範囲の終了位置を示す本文内UTF-16オフセットです。
     */
    to: number;
  }> = [];
  let offset = 0;
  while (offset <= value.length) {
    const index = value.indexOf(query, offset);
    if (index < 0) break;
    hits.push({ from: index, to: index + query.length });
    offset = index + query.length;
  }
  return hits;
}

/**
 * 左右ペインの分割比を表示可能な範囲へ制限する。
 * @param value - 左右ペイン分割比として要求された値。
 * @returns 0.2〜0.8 に丸めた分割比。有限値でない場合は 0.5。
 */
export function clampSplitRatio(value: number): number {
  return Math.max(0.2, Math.min(0.8, Number.isFinite(value) ? value : 0.5));
}

/**
 * PDF用紙サイズ表から寸法を取り出し、横向きなら幅と高さを入れ替える。
 * @param options 正規化済みの用紙サイズと向き。
 * @returns PDF用紙の幅と高さ（mm）。
 */
export function pdfPageDimensions(options: NormalizedPdfOptions): {
  /**
   * 表示領域または列の幅。
   */
  width: number;

  /**
   * 表示領域または行の高さ。
   */
  height: number;
} {
  const dimensions: {
    /**
     * 表示領域または列の幅。
     */
    width: number;
    /**
     * 表示領域または行の高さ。
     */
    height: number;
  } = {
    A0: { width: 841, height: 1189 },
    A1: { width: 594, height: 841 },
    A2: { width: 420, height: 594 },
    A3: { width: 297, height: 420 },
    A4: { width: 210, height: 297 },
    A5: { width: 148, height: 210 },
    A6: { width: 105, height: 148 },
    B4: { width: 257, height: 364 },
    B5: { width: 182, height: 257 },
  }[options.format];
  return options.orientation === "landscape"
    ? { width: dimensions.height, height: dimensions.width }
    : dimensions;
}

/**
 * 印刷設定画面のヘッダー・フッター見本用に、ページ番号の置換文字を 1 に置き換える。
 * @param value - {page}と{pages}を置換するPDFヘッダーまたはフッターのテンプレート。
 * @returns ページ番号プレースホルダーを1へ置き換えたテンプレート。
 */
export function formatPdfTemplate(value: string): string {
  return value.replace(/\{page\}/g, "1").replace(/\{pages\}/g, "1");
}

/**
 * PDF 余白欄の入力文字列を、設定可能な余白（mm）へ正規化する。
 * @param value - PDF余白欄に入力された文字列。
 * @returns 0〜50 の整数へ丸めた余白。数値として解釈できない場合は 0。
 */
export function clampPdfMargin(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(50, Math.round(parsed)))
    : 0;
}

/**
 * アウトライン欄の幅を、本文ペインを圧迫しない範囲へ制限する。
 * @param value - アウトライン幅として保存する数値（ピクセル）。
 * @returns 160〜420 の整数ピクセル。有限値でない場合は既定の 220。
 */
export function clampOutlineWidth(value: number): number {
  return Math.max(
    160,
    Math.min(420, Number.isFinite(value) ? Math.round(value) : 220),
  );
}

/**
 * 表示倍率を 0.1 刻みに丸め、操作可能な範囲へ制限する。
 * @param value - 現在の表示倍率。
 * @returns 0.1〜3.0 の範囲で 0.1 刻みに丸めた表示倍率。
 */
export function clampZoom(value: number): number {
  return Math.max(0.1, Math.min(3.0, Math.round(value * 10) / 10));
}

/**
 * 他方の変更範囲を考慮してローカル変更の位置を移動し、挿入位置ではローカル側を優先する。
 * @param changes - 本文へ適用する変更範囲の一覧。
 * @param over - 同じ変更前本文に対して計算した、競合を確認する他方の変更範囲。
 * @param baseLength - 変更範囲を計算した元本文のUTF-16文字数。
 * @returns 位置を写像したローカル変更範囲の一覧。
 */
export function mapChangesPreferLocal(
  changes: readonly TextChange[],
  over: readonly TextChange[],
  baseLength: number,
): TextChange[] {
  return [...changes]
    .sort(
      /**
       * 2つの値を比較して並び順を決める。
       * @param left - 比較対象の左側の値。
       * @param right - 比較対象の右側の値。
       * @returns 2つの要素の順序を示す数値。
       */
      (left, right) => left.rangeOffset - right.rangeOffset,
    )
    .map(
      /**
       * 各ローカル変更範囲の位置を他方の変更範囲に合わせて移動する。
       * @param change - 変更前本文に対して計算した、位置を移動するローカル変更。
       * @returns 対応する本文上の位置へ写像した変更範囲。
       */
      (change) => {
        const start = change.rangeOffset;
        if (change.rangeLength === 0) {
          return {
            ...change,
            rangeOffset: mapTextOffset(start, over, baseLength, 1),
          };
        }
        const mappedStart = mapTextOffset(start, over, baseLength, -1);
        const mappedEnd = mapTextOffset(
          start + change.rangeLength,
          over,
          baseLength,
          1,
        );
        return {
          ...change,
          rangeOffset: mappedStart,
          rangeLength: Math.max(0, mappedEnd - mappedStart),
        };
      },
    );
}

/**
 * 現在の表示構成で本文エディターを編集可能にするか判定する。
 * @param mode - 編集面とプレビューの表示構成。
 * @param splitView - 分割表示で見せるペイン。本文エディターを有効にするか判定する。
 * @returns プレビュー専用表示でなければ true。
 */
export function isEditingEnabled(
  mode: EditorMode,
  splitView: "both" | "text" | "preview",
): boolean {
  return mode !== "preview" && !(mode === "split" && splitView === "preview");
}

/**
 * 保存状態から読み取った候補を、対応する表示モードへ正規化する。
 * @param value - 永続化状態から読み取った表示モード候補。textまたはpreviewならその値を返し、それ以外はbothにする。
 * @returns 有効な表示モード。未対応の候補はbothへ戻す。
 */
export function restoreViewMode(value: unknown): ViewMode {
  return value === "text" || value === "preview" ? value : "both";
}

/**
 * 編集・プレビュー表示モードに対応するステータスラベルを返す。
 * @param mode 編集面とプレビューの表示構成。
 * @param messages 表示用に選択された翻訳済みメッセージ。
 * @returns split なら分割表示、それ以外ならプレビュー表示を示すローカライズ済みラベル。
 */
export function modeLabel(mode: EditorMode, messages: Messages): string {
  return mode === "split"
    ? messages.app.status.modeSplit
    : messages.app.status.modePreview;
}

/**
 * 開始・終了区切りで囲まれたブロックのうち、本文が previous と一致するものだけを next へ置き換える。
 * 改行コードの差は無視して照合し、置換後は元ブロックの改行コードを保つ。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param opening 置換対象ブロックの開始区切り。
 * @param closing 置換対象ブロックの終了区切り。
 * @param previous 置換対象として一致する既存ブロック本文。
 * @param next 区切りブロック内へ挿入する置換後の内容。
 * @returns 置換後の Markdown 本文。一致するブロックがなければ入力をそのまま返す。
 */
export function replaceDelimitedBlock(
  markdown: string,
  opening: string,
  closing: string,
  previous: string,
  next: string,
): string {
  const pattern = new RegExp(
    `(${escapeRegExp(opening)}[^\\r\\n]*(\\r\\n|\\r|\\n))([\\s\\S]*?)(\\r\\n|\\r|\\n)${escapeRegExp(closing)}`,
    "g",
  );
  const normalizedPrevious = previous.replace(/\r\n?|\n/g, "\n");
  return markdown.replace(
    pattern,

    /**
     * 区切りブロックの一致部分を調べ、内容が一致する場合に置換後の文字列を返す。
     * @param whole - 区切りブロック全体に一致した文字列。
     * @param prefix 一致した開始区切り行とその行末文字。
     * @param openingEol 開始区切り行の後にある改行文字。
     * @param body 一致した開始行と終了行の間にある既存内容。
     * @param closingEol 終了区切り行の前にある改行文字。
     * @returns 本文が一致した場合は置換後のブロック、一致しない場合は元の一致文字列。
     */
    (
      whole,
      prefix: string,
      openingEol: string,
      body: string,
      closingEol: string,
    ) => {
      if (body.replace(/\r\n?|\n/g, "\n") !== normalizedPrevious) return whole;
      const replacement = next
        .replace(/\r\n?|\n/g, "\n")
        .replace(/\n/g, openingEol);
      return `${prefix}${replacement}${closingEol}${closing}`;
    },
  );
}

/**
 * 正規表現内で特別な意味を持つ文字をエスケープする。
 * @param value - 正規表現内で文字どおり照合する文字列。
 * @returns 正規表現の特殊文字をバックスラッシュでエスケープした文字列。
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * ref に保持したタイマーを止め、ref を空にする。タイマーがなければ何もしない。
 * @param ref - window.setTimeout のIDを保持する ref。
 */
export function clearTimeoutRef(ref: { current: number | undefined }): void {
  if (ref.current === undefined) return;
  window.clearTimeout(ref.current);
  ref.current = undefined;
}

/**
 * ref に保持したアニメーションフレームの予約を取り消し、ref を空にする。予約がなければ何もしない。
 * @param ref - window.requestAnimationFrame のIDを保持する ref。
 */
export function cancelAnimationFrameRef(ref: { current: number | undefined }): void {
  if (ref.current === undefined) return;
  window.cancelAnimationFrame(ref.current);
  ref.current = undefined;
}

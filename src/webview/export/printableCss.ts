/**
 * @fileoverview 印刷プレビュー・PDF・HTML 出力で使う CSS を、ページ内のスタイルシートと埋め込みフォントから組み立てる。
 * 埋め込みフォント CSS は一度だけ取得してキャッシュし、取得に失敗した場合はキャッシュを破棄して次回再試行する。
 */
import { printContentCss } from "../../shared/printContentCss";
import { webviewAssetUrl } from "../runtime/assets";

/**
 * 印刷文書で使うスタイルシート規則を集める。
 * @param fontFamily 印刷CSSへ設定するフォントファミリー。
 * @param includeEmbeddedFonts Webview内の@font-face規則も含める場合はtrue。
 * @returns 印刷本文 CSS と、KaTeX・highlight.js（必要なら @font-face）の規則を改行で連結した CSS。
 */
export function collectPrintableCss(
  fontFamily: string,
  includeEmbeddedFonts = true,
): string {
  const rules: string[] = [printContentCss(fontFamily)];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (!includeEmbeddedFonts && rule.type === CSSRule.FONT_FACE_RULE)
          continue;
        const css = rule.cssText;
        if (
          (includeEmbeddedFonts && css.startsWith("@font-face")) ||
          css.includes(".katex") ||
          css.includes(".hljs")
        ) {
          rules.push(css);
        }
      }
    } catch {
      // 読み取りが禁止されたスタイルシートは印刷本文の生成を妨げないよう除外する。
    }
  }
  return rules.join("\n");
}

/**
 * 埋め込みフォント CSS の取得結果を共有するキャッシュ。取得失敗時は undefined へ戻して次回再試行する。
 */
let exportFontCssPromise: Promise<string> | undefined;

/**
 * 印刷CSSからフォント関連の規則を収集し、キャッシュ済みのCSSを返す。
 * @param fontFamily 印刷CSSへ設定するフォントファミリー。

 */
async function collectEmbeddedPrintableCss(
  fontFamily: string,
): Promise<string> {
  exportFontCssPromise ??= fetch(
    webviewAssetUrl(
      "export-fonts.css",
      document.body.dataset.mveExportFontsUri,
    ),
  )
    .then(
      /**
       * @param response - 埋め込みフォントCSS取得要求のHTTP応答。成功状態を確認してCSS本文を読み取る。
       */
      (response) => {
        if (!response.ok) {
          throw new Error(`Unable to load export fonts (${response.status})`);
        }
        return response.text();
      },
    )
    .catch(
      /**

       * @param error - 処理に失敗した理由または例外。
       */
      (error) => {
        exportFontCssPromise = undefined;
        throw error;
      },
    );
  return `${collectPrintableCss(fontFamily, false)}\n${await exportFontCssPromise}`;
}

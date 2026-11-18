/**
 * @fileoverview Extension Host で保存した印刷設定を適用するときの、書き込むキー・書き込みの選別・通知の順序を定める。
 * VS Code API に依存しない純粋な処理だけを置き、Vitest から直接検査できるようにする。
 * 不変条件: 適用要求には成否にかかわらず「全パネルへの設定通知 → 要求元への完了通知」の順で必ず応答する。
 * 不変条件: 保存した印刷設定の適用では、印刷設定パネルの項目（PDF設定）だけを書き、フォント・テーマ・HTML・DOCX・
 * 「同じフォルダへ直接出力」は書かない。
 */
import { isDeepStrictEqual } from 'node:util';
import type { NormalizedPdfOptions } from '../shared/protocol';
import type { OutputPresetValues } from '../shared/outputPresets';
import { GLOBAL_CONFIGURATION_KEYS } from './globalSettingsKeys';

/**
 * 正規化済みPDF設定を順序を保ったVS Code構成キーと保存値の組へ展開する。
 * 印刷設定パネルの変更の保存（setPdfOptions）は、「同じフォルダへ直接出力」を含めたすべてのキーを書く。
 * @param options global構成へ保存する正規化済みPDF設定。
 * @returns VS Codeのglobal構成更新に渡すキーと値の組。
 */
export function pdfConfigurationEntries(options: NormalizedPdfOptions): Array<[string, unknown]> {
    return [
        [GLOBAL_CONFIGURATION_KEYS.pdf.format, options.format],
        [GLOBAL_CONFIGURATION_KEYS.pdf.orientation, options.orientation],
        [GLOBAL_CONFIGURATION_KEYS.pdf.marginTop, options.margins.top],
        [GLOBAL_CONFIGURATION_KEYS.pdf.marginRight, options.margins.right],
        [GLOBAL_CONFIGURATION_KEYS.pdf.marginBottom, options.margins.bottom],
        [GLOBAL_CONFIGURATION_KEYS.pdf.marginLeft, options.margins.left],
        [GLOBAL_CONFIGURATION_KEYS.pdf.header, options.header],
        [GLOBAL_CONFIGURATION_KEYS.pdf.footer, options.footer],
        [GLOBAL_CONFIGURATION_KEYS.output.textReplacements, options.textReplacements],
        [GLOBAL_CONFIGURATION_KEYS.pdf.bodyFontSize, options.bodyFontSize],
        [GLOBAL_CONFIGURATION_KEYS.pdf.headingFontSizeH1, options.headingFontSizes.h1],
        [GLOBAL_CONFIGURATION_KEYS.pdf.headingFontSizeH2, options.headingFontSizes.h2],
        [GLOBAL_CONFIGURATION_KEYS.pdf.headingFontSizeH3, options.headingFontSizes.h3],
        [GLOBAL_CONFIGURATION_KEYS.pdf.headingFontSizeH4, options.headingFontSizes.h4],
        [GLOBAL_CONFIGURATION_KEYS.pdf.headingFontSizeH5, options.headingFontSizes.h5],
        [GLOBAL_CONFIGURATION_KEYS.pdf.headingFontSizeH6, options.headingFontSizes.h6],
        [GLOBAL_CONFIGURATION_KEYS.pdf.codeFontSize, options.codeFontSize],
        [GLOBAL_CONFIGURATION_KEYS.pdf.lineHeight, options.lineHeight],
        [GLOBAL_CONFIGURATION_KEYS.pdf.paragraphSpacing, options.paragraphSpacing],
        [GLOBAL_CONFIGURATION_KEYS.pdf.saveWithoutDialog, options.saveWithoutDialog]
    ];
}

/**
 * 保存した印刷設定を適用するときに書く構成キーと値を作る。
 * 印刷設定パネルの項目（PDF設定）だけを返す。保存内容の saveWithoutDialog は常に false なので、
 * 書くと利用者の「同じフォルダへ直接出力」が設定を選ぶたびにオフになる。そのため必ず除く。
 * フォントはプレビューと共通の設定（設定タブ）で、保存した印刷設定には含まれないので書かない。
 * @param preset 適用する保存した印刷設定。
 * @returns VS Codeのglobal構成更新に渡すキーと値の組（PDF設定の順）。
 */
export function savedPrintSettingsConfigurationEntries(preset: OutputPresetValues): Array<readonly [string, unknown]> {
    return pdfConfigurationEntries(preset.pdfOptions)
        .filter(([key]) => key !== GLOBAL_CONFIGURATION_KEYS.pdf.saveWithoutDialog);
}

/**
 * 構成へ書き込むキーだけを選ぶ。settings.json は1件ごとに書き込まれるため、書く件数を減らすほど適用が速く終わる。
 * @param entries - 書き込みを要求された構成キーと値。配列順を保って返す。
 * @param globalValueOf - キーの現在のglobal値を返す関数。未設定ならundefined。
 * @param onlyIfGlobalValueIsUnset - trueなら既にglobal値があるキーは書かない（設定の移行用）。
 * @returns 実際に書き込むキーと値。global値が既に同じ値のキーは除く。global値が未設定のキーは、既定値と同じ値でも
 * 明示した値として残す従来の動作を保つため含める。値の比較は isDeepStrictEqual（オブジェクトのキー順は問わない）。
 */
export function configurationEntriesToWrite(
    entries: ReadonlyArray<readonly [string, unknown]>,
    globalValueOf: (key: string) => unknown,
    onlyIfGlobalValueIsUnset: boolean
): Array<readonly [string, unknown]> {
    return entries.filter(([key, value]) => {
        const globalValue = globalValueOf(key);
        if (globalValue === undefined) return true;
        return !onlyIfGlobalValueIsUnset && !isDeepStrictEqual(globalValue, value);
    });
}

/** runOutputPresetApply が呼び出す Host 側の処理。 */
export interface OutputPresetApplySteps {
    /** 保存した設定を構成へ書き込む。失敗時はrejectする（部分的に書かれている場合がある）。 */
    apply: () => Promise<void>;
    /** 書き込み後の実際の設定を、すべてのパネルへ送る。 */
    broadcast: () => void;
    /** 要求元のパネルへ完了を知らせる。 */
    acknowledge: (succeeded: boolean) => void;
}

/**
 * 保存した設定を適用し、成否にかかわらず実際の設定を全パネルへ送ってから、要求元へ完了を知らせる。
 * Webview は選んだ時点で値を画面に出し、完了通知を受けるまで古い設定通知で戻さない。そのため完了通知を
 * 設定通知より先に送ったり、送り損ねたりすると、画面が適用前の値へ戻る、または選んだ値のまま固まる。
 * 設定通知の送信が例外を投げても完了通知は必ず送る（この場合 Webview は最後に受け取った設定、つまり選ぶ前の値へ戻る）。
 * apply または broadcast の例外は、完了通知を送った後で呼び出し元へ返す。両方が失敗した場合は、
 * 原因である apply の例外を返す（broadcast の例外は記録だけにする）。
 * @param steps - 書き込み、設定通知、完了通知の各処理。
 */
export async function runOutputPresetApply(steps: OutputPresetApplySteps): Promise<void> {
    let applyError: unknown;
    let succeeded = false;
    try {
        await steps.apply();
        succeeded = true;
    } catch (error) {
        applyError = error;
    }
    try {
        steps.broadcast();
    } catch (broadcastError) {
        // 書き込みも失敗していれば、利用者へ示すのは原因である書き込みの例外にする。
        if (succeeded) throw broadcastError;
        console.error('Failed to broadcast settings after a failed saved-settings apply.', broadcastError);
    } finally {
        steps.acknowledge(succeeded);
    }
    if (!succeeded) throw applyError;
}

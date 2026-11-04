/**
 * @fileoverview draw.io SVGをdraw.io拡張機能（hediet.vscode-drawio）の編集画面で開く。
 *
 * 実行境界はExtension Host。プレビュー内のリンクから解決済みのURIだけを受け取り、
 * パスの解決やワークスペース境界の判定は呼出元の既存リンク処理に任せる。
 * 拡張機能が見つからない場合も利用者の操作を無反応にせず、既定のエディターで開いて導入方法を案内する。
 */
import * as vscode from 'vscode';
import type { Messages } from '../shared/messages';

/** draw.io拡張機能のID。拡張機能の有無を判定し、未導入時の検索語にも使う。 */
export const DRAWIO_EXTENSION_ID = 'hediet.vscode-drawio';

/**
 * draw.io拡張機能が `*.drawio.svg` と `*.dio.svg` に登録しているカスタムエディターのviewType。
 * 拡張機能 1.x の package.json の customEditors 定義に合わせる。
 */
export const DRAWIO_SVG_EDITOR_VIEW_TYPE = 'hediet.vscode-drawio-text';

/**
 * draw.io SVGを編集用エディターで開く。
 * 拡張機能がある場合は `vscode.openWith` で明示的にdraw.ioエディターを指定し、
 * 利用者のエディター関連付けが別の既定値でも編集画面を開く。
 * 拡張機能がない場合は `vscode.open` で既定のエディターを開き、導入案内を非同期に表示する。
 * 案内の応答は待たないため、通知を閉じなくても呼出元の処理は完了する。
 * @param uri - 開くdraw.io SVGのURI。
 * @param messages - 案内に使う現在の表示言語の文言。
 * @throws エディターを開くコマンドが失敗した場合はその例外。
 */
export async function openDrawioSvgEditor(uri: vscode.Uri, messages: Messages): Promise<void> {
    if (vscode.extensions.getExtension(DRAWIO_EXTENSION_ID)) {
        await vscode.commands.executeCommand('vscode.openWith', uri, DRAWIO_SVG_EDITOR_VIEW_TYPE);
        return;
    }
    void vscode.window.showInformationMessage(
        messages.host.drawioExtensionMissing,
        messages.host.drawioShowExtension
    ).then(
        /**
         * 案内のボタンが押された場合だけ拡張機能ビューでdraw.io拡張機能を検索する。
         * @param choice - 押されたボタンの文言。通知を閉じた場合はundefined。
         */
        (choice) => {
            if (choice === messages.host.drawioShowExtension) {
                void vscode.commands.executeCommand('workbench.extensions.search', DRAWIO_EXTENSION_ID);
            }
        },
        /** 通知の表示失敗は図を開く操作に影響しないため無視する。 */
        () => undefined
    );
    await vscode.commands.executeCommand('vscode.open', uri);
}
